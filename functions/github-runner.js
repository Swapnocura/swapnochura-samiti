
/**
 * Swapnochura Samiti — GitHub Actions SMS Runner
 *
 * Reminders:
 * - Two days before the installment date
 * - On the installment date
 *
 * Date priority:
 * 1. customInstallmentDate
 * 2. nextInstallmentDate
 *
 * Default mode: DRY RUN
 * SMS_ALERTS_ENABLED=false means no SMS will be sent.
 */

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}'
);

if (!serviceAccount.project_id) {
  throw new Error(
    'Firebase service account secret is missing or invalid.'
  );
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const SMS_API_KEY = process.env.SMS_BD_API_KEY;

// --------------------------------------------------
// Bangladesh date helpers
// --------------------------------------------------

function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const p = Object.fromEntries(
    parts.map(item => [item.type, item.value])
  );

  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDate(key, days) {
  const [year, month, day] = String(key)
    .split('-')
    .map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day + days, 12)
  );

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function validDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) {
    return false;
  }

  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeMemberNo(value) {
  return String(value || '').trim();
}

// --------------------------------------------------
// Phone helper
// --------------------------------------------------

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

// --------------------------------------------------
// SMS template
// No customer name, installment amount or count.
// --------------------------------------------------

function messageFor(due) {
  const [year, month, day] = due.split('-');

  return (
    `❤️স্বপ্নচূড়া❤️\n\n` +
    `আসসালামুয়ালাইকুম\n` +
    `সম্মানিত গ্রাহক, আপনার অবগতির জন্য জানাচ্ছি যে ` +
    `আপনার কিস্তি জমা দেওয়ার তারিখ ${day}-${month}-${year}। ` +
    `অনুগ্রহ করে নির্ধারিত তারিখে কিস্তি জমা দেওয়ার ` +
    `জন্য অনুরোধ রইল।🥰\n\n` +
    `ধন্যবাদান্তে,\n\n` +
    `.                    স্বপ্নচূড়া                  .`
  );
}

// --------------------------------------------------
// Load reminder candidates
// --------------------------------------------------

async function loadCandidates(today) {
  const [membersSnap, loansSnap] = await Promise.all([
    db.collection('members').get(),
    db.collection('loans').get()
  ]);

  // Index members by memberNo for reliable lookup.
  const membersByNo = new Map();

  for (const doc of membersSnap.docs) {
    const member = doc.data();
    const memberNo = normalizeMemberNo(member.memberNo);

    if (memberNo) {
      membersByNo.set(memberNo, {
        id: doc.id,
        ...member
      });
    }
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
    const loan = {
      id: doc.id,
      ...doc.data()
    };

    const status = String(loan.status || '')
      .trim()
      .toLowerCase();

    if (
      [
        'rejected',
        'closed',
        'settled',
        'paid',
        'cancelled'
      ].includes(status)
    ) {
      diagnostics.skippedClosedStatus++;
      continue;
    }

    // Prefer customInstallmentDate.
    // Fall back to nextInstallmentDate if custom date is empty.
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
      console.warn(
        'Invalid installment date for loan:',
        loan.loanNo || loan.id
      );
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
      console.warn(
        'No matching memberNo for loan:',
        loan.loanNo || loan.id
      );
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
      console.warn(
        'Missing or invalid phone for loan:',
        loan.loanNo || loan.id
      );
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

  console.log(
    'Candidate diagnostics:',
    JSON.stringify(diagnostics, null, 2)
  );

  return candidates;
}

// --------------------------------------------------
// SMS.NET.BD API
// --------------------------------------------------

async function sendSms(phone, message) {
  if (!SMS_API_KEY) {
    throw new Error('SMS_BD_API_KEY is missing.');
  }

  const response = await fetch(
    'https://api.sms.net.bd/sendsms',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        api_key: SMS_API_KEY,
        to: phone,
        msg: message
      })
    }
  );

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      'SMS provider returned an invalid response.'
    );
  }

  if (!response.ok || Number(result.error) !== 0) {
    throw new Error(
      `SMS provider rejected request: ${
        JSON.stringify(result).slice(0, 300)
      }`
    );
  }

  return result.data?.request_id ?? null;
}

// --------------------------------------------------
// Duplicate prevention and SMS logs
// --------------------------------------------------

async function deliverOnce(candidate) {
  const id =
    `${encodeURIComponent(candidate.loanId)}` +
    `__${candidate.due}__${candidate.stage}`;

  const ref = db.collection('smsAlertLogs').doc(id);

  const reserved = await db.runTransaction(
    async transaction => {
      const snap = await transaction.get(ref);
      const previousStatus = String(
        snap.data()?.status || ''
      );

      if (
        snap.exists &&
        ['sent', 'sending'].includes(previousStatus)
      ) {
        return false;
      }

      transaction.set(ref, {
        loanId: candidate.loanId,
        loanNo: candidate.loanNo,
        memberNo: candidate.memberNo,
        phone: candidate.phone,
        dueDate: candidate.due,
        stage: candidate.stage,
        message: candidate.message,
        status: 'sending',
        attempts: Number(snap.data()?.attempts || 0) + 1,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return true;
    }
  );

  if (!reserved) {
    return 'skipped_duplicate';
  }

  try {
    const requestId = await sendSms(
      candidate.phone,
      candidate.message
    );

    await ref.set({
      status: 'sent',
      provider: 'sms.net.bd',
      requestId:
        requestId == null ? null : String(requestId),
      sentAt:
        admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:
        admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return 'sent';
  } catch (error) {
    await ref.set({
      status: 'failed',
      error: String(error.message || error).slice(0, 500),
      updatedAt:
        admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    throw error;
  }
}

// --------------------------------------------------
// Main runner
// --------------------------------------------------

async function main() {
  const today = dateKey();
  const candidates = await loadCandidates(today);

  const enabled =
    process.env.SMS_ALERTS_ENABLED === 'true';

  console.log(JSON.stringify({
    mode: enabled ? 'LIVE' : 'DRY RUN',
    date: today,
    candidateCount: candidates.length,
    candidates: candidates.map(candidate => ({
      loanNo: candidate.loanNo,
      due: candidate.due,
      stage: candidate.stage,
      phone: candidate.phone
    }))
  }, null, 2));

  if (!enabled) {
    console.log(
      'DRY RUN: No SMS sent. Verify dates and recipients first.'
    );
    return;
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await deliverOnce(candidate);

      if (result === 'sent') {
        sent++;
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;
      console.error(
        'SMS failed for loan:',
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

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => admin.app().delete())
  .catch(async error => {
    console.error(error);

    try {
      await admin.app().delete();
    } catch {}

    process.exitCode = 1;
  });
