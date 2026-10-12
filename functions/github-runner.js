/**
 * Swapnochura Samiti — GitHub Actions SMS Runner
 * Default mode: DRY RUN. No SMS sent unless enabled.
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
const SMS_API_KEY = process.env.SMS_BD_API_KEY;

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
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function monthlyDueDate(start, offset) {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  const index = m - 1 + offset;
  const targetYear = y + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();

  return [
    targetYear,
    String(targetMonth + 1).padStart(2, '0'),
    String(Math.min(d, lastDay)).padStart(2, '0')
  ].join('-');
}

function intervalDays(type) {
  type = String(type || '').toLowerCase();
  if (type === 'weekly') return 7;
  if (['15-days', '15_days', 'fortnightly'].includes(type)) return 15;
  return null;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return `880${digits.slice(1)}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return digits;
  return null;
}

function validDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d;
}

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

async function loadCandidates(today) {
  const [membersSnap, loansSnap, collectionsSnap] = await Promise.all([
    db.collection('members').get(),
    db.collection('loans').get(),
    db.collection('collections').get()
  ]);

  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const loans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const collections = collectionsSnap.docs
    .map(d => d.data())
    .filter(c => c.status !== 'rejected' && c.status !== 'pending');

  const candidates = [];

  for (const loan of loans) {
    if (!loan.startDate || !loan.installmentAmount ||
        Number(loan.installments || 0) <= 0) continue;

    const status = String(loan.status || '').toLowerCase();
    if (['rejected', 'closed', 'settled', 'paid', 'cancelled'].includes(status)) {
      continue;
    }

    const loanKey = String(loan.loanNo || loan.id);
    const paid = collections
      .filter(c => String(c.loanNo || '') === loanKey)
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const principal = Number(loan.principal || 0);
    const per = Number(loan.installmentAmount || 0);
    const count = Number(loan.installments || 0);

    if (![paid, principal, per, count].every(Number.isFinite) ||
        principal - paid <= 0 || per <= 0 || count <= 0) continue;

    const paidCount = Math.min(count, Math.floor((paid + 0.00001) / per));
    const nextIndex = paidCount + 1;
    if (nextIndex > count) continue;

    const type = String(loan.installmentType || 'monthly').toLowerCase();
    const start = String(loan.startDate).slice(0, 10);
    let due;

    if (type === 'custom') {
      if (paidCount > 0 || !loan.nextInstallmentDate) continue;
      due = String(loan.nextInstallmentDate).slice(0, 10);
    } else if (type === 'monthly') {
      due = monthlyDueDate(start, nextIndex - 1);
    } else {
      const days = intervalDays(type);
      if (!days) continue;
      due = shiftDate(start, (nextIndex - 1) * days);
    }

    if (!validDate(due)) continue;

    let stage;
    if (due === shiftDate(today, 2)) stage = 'two_days_before';
    else if (due === today) stage = 'due_today';
    else continue;

    const member = members.find(m =>
      String(m.memberNo || '') === String(loan.memberNo || '')
    ) || {};

    const phone = normalizePhone(
      loan.phone || member.phone || member.mobile || member.phoneNumber
    );
    if (!phone) continue;

    candidates.push({
      loanId: loan.id,
      loanNo: loanKey,
      memberNo: String(loan.memberNo || member.memberNo || ''),
      phone,
      due,
      stage,
      message: messageFor(due)
    });
  }

  return candidates;
}

async function sendSms(phone, message) {
  if (!SMS_API_KEY) throw new Error('SMS_BD_API_KEY is missing.');

  const response = await fetch('https://api.sms.net.bd/sendsms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_key: SMS_API_KEY,
      to: phone,
      msg: message
    })
  });

  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error('SMS provider returned an invalid response.');
  }

  if (!response.ok || Number(result.error) !== 0) {
    throw new Error(`SMS provider rejected request: ${JSON.stringify(result).slice(0, 300)}`);
  }

  return result.data?.request_id ?? null;
}

async function deliverOnce(c) {
  const id = `${encodeURIComponent(c.loanId)}__${c.due}__${c.stage}`;
  const ref = db.collection('smsAlertLogs').doc(id);

  const reserved = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && ['sent', 'sending'].includes(snap.data().status)) {
      return false;
    }

    tx.set(ref, {
      loanId: c.loanId,
      loanNo: c.loanNo,
      memberNo: c.memberNo,
      phone: c.phone,
      dueDate: c.due,
      stage: c.stage,
      message: c.message,
      status: 'sending',
      attempts: Number(snap.data()?.attempts || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return true;
  });

  if (!reserved) return 'skipped';

  try {
    const requestId = await sendSms(c.phone, c.message);
    await ref.set({
      status: 'sent',
      provider: 'sms.bd',
      requestId: requestId == null ? null : String(requestId),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return 'sent';
  } catch (err) {
    await ref.set({
      status: 'failed',
      error: String(err.message || err).slice(0, 500),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    throw err;
  }
}

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
      phone: c.phone
    }))
  }, null, 2));

  if (!enabled) {
    console.log('DRY RUN: no SMS sent. Verify candidates before enabling.');
    return;
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const result = await deliverOnce(c);
      if (result === 'sent') sent++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error('SMS failed for loan', c.loanNo, String(err.message || err));
    }
  }

  console.log(JSON.stringify({ sent, skipped, failed }));
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => admin.app().delete())
  .catch(async err => {
    console.error(err);
    try { await admin.app().delete(); } catch {}
    process.exitCode = 1;
  });
