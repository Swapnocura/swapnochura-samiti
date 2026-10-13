
/**
 * Swapnochura Samiti — GitHub Actions SMS Runner
 * Reminders: 2 days before and on installment date.
 * Default mode: DRY RUN.
 */

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}'
);

if (!serviceAccount.project_id) {
  throw new Error('Firebase service account secret is missing or invalid.');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const SMS_API_KEY = process.env.SMS_BD_API_KEY;

// Bangladesh date helpers
function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDate(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function validDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return false;

  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));

  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d;
}

function normalizeMemberNo(value) {
  return String(value || '').trim();
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (/^01[3-9]\d{8}$/.test(digits)) {
    return `880${digits.slice(1)}`;
  }

  if (/^8801[3-9]\d{8}$/.test(digits)) {
    return digits;
  }

  return null;
}

function maskPhone(phone) {
  const s = String(phone || '');
  return s.length >= 8
    ? `${s.slice(0, 4)}******${s.slice(-3)}`
    : 'masked';
}

function messageFor(due) {
  const [year, month, day] = due.split('-');

  return `❤️স্বপ্নচূড়া❤️

আসসালামুয়ালাইকুম
সম্মানিত গ্রাহক, আপনার অবগতির জন্য জানাচ্ছি যে আপনার কিস্তি জমা দেওয়ার তারিখ ${day}-${month}-${year}। অনুগ্রহ করে নির্ধারিত তারিখে কিস্তি জমা দেওয়ার জন্য অনুরোধ রইল।🥰

ধন্যবাদান্তে,

.                    স্বপ্নচূড়া                  .`;
}

// Load eligible reminders
async function loadCandidates(today) {
  const [membersSnap, loansSnap] = await Promise.all([
    db.collection('members').get(),
    db.collection('loans').get()
  ]);

  const membersByNo = new Map();

  for (const doc of membersSnap.docs) {
    const member = doc.data();
    const no = normalizeMemberNo(member.memberNo);

    if (no) membersByNo.set(no, member);
  }

  const candidates = [];
  const diagnostics = {
    loansRead: loansSnap.size,
    membersRead: membersSnap.size,
    skippedClosedStatus: 0,
    missingInstallmentDate: 0,
    invalidInstallmentDate: 0,
    dateNotDueForReminder: 0,
    memberNotFound: 0,
    missingOrInvalidPhone: 0
  };

  for (const doc of loansSnap.docs) {
    const loan = { id: doc.id, ...doc.data() };
    const status = String(loan.status || '').trim().toLowerCase();

    if ([
      'rejected', 'closed', 'settled', 'paid', 'cancelled'
    ].includes(status)) {
      diagnostics.skippedClosedStatus++;
      continue;
    }

    const rawDue =
      loan.customInstallmentDate ||
      loan.nextInstallmentDate ||
      '';

    const due = String(rawDue).trim().slice(0, 10);

    if (!due) {
      diagnostics.missingInstallmentDate++;
      continue;
    }

    if (!validDate(due)) {
      diagnostics.invalidInstallmentDate++;
      console.warn('Invalid installment date for loan:', loan.loanNo || loan.id);
      continue;
    }

    let stage;

    if (due === shiftDate(today, 2)) {
      stage = 'two_days_before';
    } else if (due === today) {
      stage = 'due_today';
    } else {
      diagnostics.dateNotDueForReminder++;
      continue;
    }

    const memberNo = normalizeMemberNo(loan.memberNo);
    const member = membersByNo.get(memberNo);

    if (!member) {
      diagnostics.memberNotFound++;
      console.warn('No matching member for loan:', loan.loanNo || loan.id);
      continue;
    }

    const phone = normalizePhone(
      loan.phone ||
      member.phone ||
      member.mobile ||
      member.phoneNumber ||
      ''
    );

    if (!phone) {
      diagnostics.missingOrInvalidPhone++;
      console.warn('Missing/invalid phone for loan:', loan.loanNo || loan.id);
      continue;
    }

    candidates.push({
      loanId: loan.id,
      loanNo: String(loan.loanNo || loan.id),
      memberNo,
      phone,
      due,
      stage,
      message: messageFor(due)
    });
  }

  console.log('Candidate diagnostics:', JSON.stringify(diagnostics, null, 2));
  return candidates;
}

// SMS provider errors
class ProviderRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderRejectedError';
  }
}

async function sendSms(phone, message) {
  if (!SMS_API_KEY) {
    throw new ProviderRejectedError('SMS_BD_API_KEY is missing.');
  }

  let response;

  try {
    response = await fetch('https://api.sms.net.bd/sendsms', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        api_key: SMS_API_KEY,
        to: phone,
        msg: message
      }),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    const error = new Error(
      'Network error; SMS delivery status is unknown. Check provider reports.'
    );
    error.deliveryUnknown = true;
    throw error;
  }

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    const error = new Error(
      'Unreadable provider response; SMS delivery status is unknown.'
    );
    error.deliveryUnknown = true;
    throw error;
  }

  if (Number(result?.error) !== 0) {
    throw new ProviderRejectedError(
      'SMS provider explicitly rejected the request.'
    );
  }

  if (!response.ok) {
    const error = new Error(
      `Provider HTTP ${response.status}; delivery status is unknown.`
    );
    error.deliveryUnknown = true;
    throw error;
  }

  return result?.data?.request_id ?? null;
}

// Duplicate prevention and delivery logs
async function deliverOnce(candidate) {
  const id =
    `${encodeURIComponent(candidate.loanId)}` +
    `__${candidate.due}__${candidate.stage}`;

  const ref = db.collection('smsAlertLogs').doc(id);

  const reservation = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.data() : {};
    const status = String(previous.status || '');

    // Never automatically resend sent, sending, or unknown records.
    if (['sent', 'sending', 'unknown'].includes(status)) {
      return { allowed: false, status };
    }

    // Retry only a previous explicit provider rejection.
    if (status === 'failed' && previous.retrySafe !== true) {
      return { allowed: false, status: 'manual_review' };
    }

    tx.set(ref, {
      loanId: candidate.loanId,
      loanNo: candidate.loanNo,
      memberNo: candidate.memberNo,
      phoneMasked: maskPhone(candidate.phone),
      dueDate: candidate.due,
      stage: candidate.stage,
      status: 'sending',
      attempts: Number(previous.attempts || 0) + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { allowed: true };
  });

  if (!reservation.allowed) {
    console.log(
      `Reminder not sent automatically: loan=${candidate.loanNo}, status=${reservation.status}`
    );

    return reservation.status === 'sent'
      ? 'skipped_duplicate'
      : 'skipped_review';
  }

  try {
    const requestId = await sendSms(candidate.phone, candidate.message);

    await ref.set({
      status: 'sent',
      provider: 'sms.net.bd',
      requestId: requestId == null ? null : String(requestId),
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      retrySafe: false
    }, { merge: true });

    return 'sent';
  } catch (error) {
    const unknown = error.deliveryUnknown === true;
    const safeToRetry =
      error instanceof ProviderRejectedError &&
      error.message !== 'SMS_BD_API_KEY is missing.';

    await ref.set({
      status: unknown ? 'unknown' : 'failed',
      retrySafe: safeToRetry,
      error: String(error.message || error).slice(0, 300),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    throw error;
  }
}

// Main runner
async function main() {
  const today = dateKey();
  const candidates = await loadCandidates(today);
  const enabled = process.env.SMS_ALERTS_ENABLED === 'true';

  console.log(JSON.stringify({
    mode: enabled ? 'LIVE' : 'DRY RUN',
    date: today,
    candidateCount: candidates.length,
    candidates: candidates.map(c => ({
      loanNo: c.loanNo,
      due: c.due,
      stage: c.stage,
      phone: maskPhone(c.phone)
    }))
  }, null, 2));

  if (!enabled) {
    console.log('DRY RUN: No SMS sent. Verify dates and recipients first.');
    return;
  }

  if (!SMS_API_KEY) {
    throw new Error('SMS_BD_API_KEY is missing; refusing live run.');
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await deliverOnce(candidate);

      if (result === 'sent') sent++;
      else skipped++;
    } catch (error) {
      failed++;
      console.error(
        'SMS attempt failed/needs review for loan:',
        candidate.loanNo,
        String(error.message || error)
      );
    }
  }

  console.log(JSON.stringify({
    date: today,
    candidates: candidates.length,
    sent,
    skipped,
    failed
  }, null, 2));

  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => admin.app().delete())
  .catch(async error => {
    console.error(String(error.message || error));

    try {
      await admin.app().delete();
    } catch {}

    process.exitCode = 1;
  });
