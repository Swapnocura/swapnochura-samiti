/**
 * Swapnochura Samiti — SMS-only installment reminders.
 * Reads the existing collections: members, loans, collections.
 * Safe by default: SMS_ALERTS_ENABLED=false. No WhatsApp integration.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const SMS_API_KEY = defineSecret('SMS_API_KEY');
const SMS_ALERTS_ENABLED = defineString('SMS_ALERTS_ENABLED', { default: 'false' });

function dhakaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function shiftDateKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function plusDays(key, days) { return shiftDateKey(key, days); }
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return `880${digits.slice(1)}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return digits;
  return null;
}
function money(value) {
  return Math.round(Number(value || 0)).toLocaleString('en-US');
}
function fmtDate(key) {
  const [y, m, d] = String(key).split('-');
  return `${d}-${m}-${y}`;
}
function scheduleIntervalDays(type) {
  if (type === 'weekly') return 7;
  if (type === 'fortnightly') return 15;
  if (type === 'custom') return null;
  // The current app's preview uses 30 days for monthly and any non-weekly,
  // non-fortnightly recurring type.
  return 30;
}

async function sendSms(phone, message) {
  const apiKey = SMS_API_KEY.value();
  if (!apiKey) throw new Error('SMS_API_KEY is missing');
  const body = new URLSearchParams({ api_key: apiKey, to: phone, msg: message });
  const response = await fetch('https://api.sms.net.bd/sendsms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await response.json();
  if (!response.ok || Number(json.error) !== 0) {
    throw new Error(`sms.bd rejected request: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json.data?.request_id ?? null;
}

async function loadCandidates(today) {
  const [memberSnap, loanSnap, collectionSnap] = await Promise.all([
    db.collection('members').get(),
    db.collection('loans').get(),
    db.collection('collections').get()
  ]);
  const members = memberSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const loans = loanSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Match the current app's own alert preview: pending and rejected records
  // do not count as payments; approved (and legacy records with no status) do.
  const approved = collectionSnap.docs.map(d => d.data()).filter(c => c.status !== 'rejected' && c.status !== 'pending');
  const findMember = loan => members.find(m => String(m.memberNo || '') === String(loan.memberNo || '')) || {};
  const candidates = [];

  for (const loan of loans) {
    if (!loan.startDate || !loan.installmentAmount || Number(loan.installments || 0) <= 0) continue;
    if (['rejected', 'closed', 'settled', 'paid', 'cancelled'].includes(String(loan.status || '').toLowerCase())) continue;

    const loanKey = String(loan.loanNo || loan.id);
    const paid = approved.filter(c => String(c.loanNo || '') === loanKey)
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const principal = Number(loan.principal || 0);
    const balance = Math.max(0, principal - paid);
    const per = Number(loan.installmentAmount || 0);
    const count = Number(loan.installments || 0);
    if (balance <= 0 || per <= 0) continue;

    const paidInstallments = Math.min(count, Math.floor((paid + 0.00001) / per));
    const nextIndex = paidInstallments + 1;
    if (nextIndex > count) continue;

    let due;
    if (loan.installmentType === 'custom') {
      // Only the first custom date is reliable in the current app schema.
      if (paidInstallments > 0 || !loan.nextInstallmentDate) continue;
      due = String(loan.nextInstallmentDate).slice(0, 10);
    } else {
      const interval = scheduleIntervalDays(loan.installmentType);
      if (!interval) continue;
      due = plusDays(String(loan.startDate).slice(0, 10), (nextIndex - 1) * interval);
    }

    // Exactly two alert stages: 2 days before, and on the due date.
    let stage;
    if (due === shiftDateKey(today, 2)) stage = 'two_days_before';
    else if (due === today) stage = 'due_today';
    else continue;

    const member = findMember(loan);
    const phone = normalizePhone(loan.phone || member.phone || member.mobile || member.phoneNumber || '');
    if (!phone) {
      logger.warn('Skipping loan with missing/invalid member phone', { loanNo: loanKey, memberNo: loan.memberNo || '' });
      continue;
    }
    const name = String(loan.memberName || member.name || 'সদস্য').trim();
    const amount = Math.min(per, balance);
    const stageText = stage === 'two_days_before' ? 'আর ২ দিন পরে' : 'আজ';
    const message = `স্বপ্নচূড়া সমিতি: প্রিয় ${name}, আপনার ${money(amount)} টাকার কিস্তি ${fmtDate(due)} তারিখে নির্ধারিত (${stageText})। অনুগ্রহ করে সময়মতো পরিশোধ করুন।`;
    candidates.push({ loanId: loan.id, loanNo: loanKey, memberNo: String(loan.memberNo || member.memberNo || ''), phone, name, due, stage, amount, message });
  }
  return candidates;
}

function logId(candidate) {
  return `${encodeURIComponent(candidate.loanId)}__${candidate.due}__${candidate.stage}`;
}
async function deliverOnce(candidate) {
  const ref = db.collection('smsAlertLogs').doc(logId(candidate));
  const reserved = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && ['sent', 'sending'].includes(String(snap.data().status || ''))) return false;
    tx.set(ref, {
      loanId: candidate.loanId, loanNo: candidate.loanNo, memberNo: candidate.memberNo,
      phone: candidate.phone, dueDate: candidate.due, stage: candidate.stage,
      amount: candidate.amount, message: candidate.message,
      status: 'sending', attempts: Number(snap.data()?.attempts || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
  if (!reserved) return 'skipped_duplicate';
  try {
    const requestId = await sendSms(candidate.phone, candidate.message);
    await ref.set({ status: 'sent', provider: 'sms.bd', requestId: requestId == null ? null : String(requestId), sentAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return 'sent';
  } catch (error) {
    await ref.set({ status: 'failed', error: String(error.message || error).slice(0, 500), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

exports.installmentReminderScheduler = onSchedule({
  schedule: '0 9 * * *',
  timeZone: 'Asia/Dhaka',
  region: 'asia-south1',
  secrets: [SMS_API_KEY],
  retryCount: 0
}, async () => {
  const today = dhakaDateKey();
  if (SMS_ALERTS_ENABLED.value() !== 'true') {
    logger.info('SMS dry run only; no messages sent', { today, upcomingDueDate: shiftDateKey(today, 2) });
    const preview = await loadCandidates(today);
    logger.info('SMS reminder preview count (no sends)', { count: preview.length, candidates: preview.map(c => ({ loanNo: c.loanNo, memberNo: c.memberNo, due: c.due, stage: c.stage })) });
    return;
  }
  const candidates = await loadCandidates(today);
  let sent = 0, skipped = 0, failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await deliverOnce(candidate);
      if (result === 'sent') sent++; else skipped++;
    } catch (error) {
      failed++;
      logger.error('SMS send failed', { loanNo: candidate.loanNo, due: candidate.due, stage: candidate.stage, error: String(error.message || error) });
    }
  }
  logger.info('SMS reminder run completed', { today, candidates: candidates.length, sent, skipped, failed });
});

exports._test = { dhakaDateKey, shiftDateKey, normalizePhone, scheduleIntervalDays };
