/**
 * Swapnochura Samiti — SMS-only installment reminders.
 *
 * Firestore collections:
 * members, loans, collections, smsAlertLogs
 *
 * SMS:
 * - Two days before installment due date
 * - On installment due date
 * - No installment amount in the SMS
 *
 * SAFETY:
 * SMS_ALERTS_ENABLED defaults to false.
 * Do not enable live SMS before testing.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

const SMS_API_KEY = defineSecret('SMS_API_KEY');

const SMS_ALERTS_ENABLED = defineString('SMS_ALERTS_ENABLED', {
  default: 'false'
});

// --------------------------------------------------
// Date helpers — Bangladesh time
// --------------------------------------------------

function dhakaDateKey(date = new Date()) {
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

function shiftDateKey(key, days) {
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

function plusDays(key, days) {
  return shiftDateKey(key, days);
}

// --------------------------------------------------
// Monthly installment date helper
// Jan 31 -> Feb 28/29 -> Mar 31
// --------------------------------------------------

function monthlyDueDate(startKey, monthOffset) {
  const [year, month, day] = String(startKey)
    .slice(0, 10)
    .split('-')
    .map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(monthOffset) ||
    monthOffset < 0
  ) {
    throw new Error(`Invalid monthly date: ${startKey}`);
  }

  // Reject impossible starting dates such as February 31.
  const actualStartDay = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    actualStartDay.getUTCFullYear() !== year ||
    actualStartDay.getUTCMonth() !== month - 1 ||
    actualStartDay.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${startKey}`);
  }

  const targetMonthIndex = month - 1 + monthOffset;
  const targetYear =
    year + Math.floor(targetMonthIndex / 12);

  const normalizedMonth =
    ((targetMonthIndex % 12) + 12) % 12;

  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();

  const targetDay = Math.min(day, lastDay);

  return [
    targetYear,
    String(normalizedMonth + 1).padStart(2, '0'),
    String(targetDay).padStart(2, '0')
  ].join('-');
}

function scheduleIntervalDays(type) {
  const normalized = String(type || '').toLowerCase();

  if (normalized === 'weekly') return 7;

  if (
    normalized === '15-days' ||
    normalized === '15_days' ||
    normalized === 'fortnightly'
  ) {
    return 15;
  }

  return null;
}

// --------------------------------------------------
// Phone and date display helpers
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

function fmtDate(key) {
  const [year, month, day] = String(key).split('-');

  return `${day}-${month}-${year}`;
}

// --------------------------------------------------
// SMS message template
// No installment amount is included.
// --------------------------------------------------

function buildReminderMessage(dueDate) {
  return (
    `❤️স্বপ্নচূড়া❤️\n\n` +
    `আসসালামুয়ালাইকুম\n` +
    `সম্মানিত গ্রাহক, আপনার অবগতির জন্য জানাচ্ছি যে ` +
    `আপনার কিস্তি জমা দেওয়ার তারিখ ${fmtDate(dueDate)}। ` +
    `অনুগ্রহ করে নির্ধারিত তারিখে কিস্তি জমা দেওয়ার ` +
    `জন্য অনুরোধ রইল।🥰\n\n` +
    `ধন্যবাদান্তে,\n\n` +
    `.                    স্বপ্নচূড়া                  .`
  );
}

// --------------------------------------------------
// SMS provider
// --------------------------------------------------

async function sendSms(phone, message) {
  const apiKey = SMS_API_KEY.value();

  if (!apiKey) {
    throw new Error('SMS_API_KEY is missing');
  }

  const body = new URLSearchParams({
    api_key: apiKey,
    to: phone,
    msg: message
  });

  const response = await fetch(
    'https://api.sms.net.bd/sendsms',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    }
  );

  const responseText = await response.text();

  let json;

  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(
      'SMS provider returned an invalid response'
    );
  }

  if (!response.ok || Number(json.error) !== 0) {
    throw new Error(
      `SMS provider rejected request: ${
        JSON.stringify(json).slice(0, 400)
      }`
    );
  }

  return json.data?.request_id ?? null;
}

// --------------------------------------------------
// Find installment reminders
// --------------------------------------------------

async function loadCandidates(today) {
  const [
    memberSnap,
    loanSnap,
    collectionSnap
  ] = await Promise.all([
    db.collection('members').get(),
    db.collection('loans').get(),
    db.collection('collections').get()
  ]);

  const members = memberSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  const loans = loanSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  // Exclude pending and rejected collections.
  // Other records are included, as in the previous code.
  const approved = collectionSnap.docs
    .map(doc => doc.data())
    .filter(collection =>
      collection.status !== 'rejected' &&
      collection.status !== 'pending'
    );

  const findMember = loan =>
    members.find(member =>
      String(member.memberNo || '') ===
      String(loan.memberNo || '')
    ) || {};

  const candidates = [];

  for (const loan of loans) {
    if (
      !loan.startDate ||
      !loan.installmentAmount ||
      Number(loan.installments || 0) <= 0
    ) {
      continue;
    }

    const loanStatus = String(
      loan.status || ''
    ).toLowerCase();

    if (
      [
        'rejected',
        'closed',
        'settled',
        'paid',
        'cancelled'
      ].includes(loanStatus)
    ) {
      continue;
    }

    const loanKey = String(loan.loanNo || loan.id);

    // IMPORTANT:
    // Existing payment calculation is retained to determine
    // which installment is next. Verify your real data schema
    // before enabling live SMS.
    const paid = approved
      .filter(collection =>
        String(collection.loanNo || '') === loanKey
      )
      .reduce(
        (sum, collection) =>
          sum + Number(collection.amount || 0),
        0
      );

    const principal = Number(loan.principal || 0);
    const balance = Math.max(0, principal - paid);
    const per = Number(loan.installmentAmount || 0);
    const count = Number(loan.installments || 0);

    if (
      !Number.isFinite(paid) ||
      !Number.isFinite(principal) ||
      !Number.isFinite(per) ||
      !Number.isFinite(count) ||
      balance <= 0 ||
      per <= 0 ||
      count <= 0
    ) {
      continue;
    }

    // Retain the previous method for inferring paid installments.
    // This does not change the payment accounting rules.
    const paidInstallments = Math.min(
      count,
      Math.floor((paid + 0.00001) / per)
    );

    const nextIndex = paidInstallments + 1;

    if (nextIndex > count) {
      continue;
    }

    const installmentType = String(
      loan.installmentType || 'monthly'
    ).toLowerCase();

    const startKey = String(
      loan.startDate
    ).slice(0, 10);

    let due;

    if (installmentType === 'custom') {
      // Only the first custom date is supported by this schema.
      if (
        paidInstallments > 0 ||
        !loan.nextInstallmentDate
      ) {
        continue;
      }

      due = String(
        loan.nextInstallmentDate
      ).slice(0, 10);
    } else if (installmentType === 'monthly') {
      due = monthlyDueDate(
        startKey,
        nextIndex - 1
      );
    } else {
      const interval =
        scheduleIntervalDays(installmentType);

      if (!interval) {
        logger.warn(
          'Unsupported installment type; skipping loan',
          {
            loanNo: loanKey,
            installmentType
          }
        );

        continue;
      }

      due = plusDays(
        startKey,
        (nextIndex - 1) * interval
      );
    }

    // Validate date format and calendar validity.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      logger.warn('Invalid due date; skipping loan', {
        loanNo: loanKey,
        due
      });

      continue;
    }

    const [dueYear, dueMonth, dueDay] =
      due.split('-').map(Number);

    const checkDate = new Date(
      Date.UTC(dueYear, dueMonth - 1, dueDay)
    );

    if (
      checkDate.getUTCFullYear() !== dueYear ||
      checkDate.getUTCMonth() !== dueMonth - 1 ||
      checkDate.getUTCDate() !== dueDay
    ) {
      logger.warn('Impossible due date; skipping loan', {
        loanNo: loanKey,
        due
      });

      continue;
    }

    // Reminder stages:
    // 1. Two days before the due date.
    // 2. On the due date.
    let stage;

    if (due === shiftDateKey(today, 2)) {
      stage = 'two_days_before';
    } else if (due === today) {
      stage = 'due_today';
    } else {
      continue;
    }

    const member = findMember(loan);

    const phone = normalizePhone(
      loan.phone ||
      member.phone ||
      member.mobile ||
      member.phoneNumber ||
      ''
    );

    if (!phone) {
      logger.warn(
        'Skipping loan with missing/invalid phone',
        {
          loanNo: loanKey,
          memberNo: loan.memberNo || ''
        }
      );

      continue;
    }

    const name = String(
      loan.memberName || member.name || 'সদস্য'
    ).trim();

    // The SMS has no name or installment amount.
    // Only the institution name and due date are included.
    const message = buildReminderMessage(due);

    candidates.push({
      loanId: loan.id,
      loanNo: loanKey,
      memberNo: String(
        loan.memberNo || member.memberNo || ''
      ),
      phone,
      name,
      due,
      stage,
      message
    });
  }

  return candidates;
}

// --------------------------------------------------
// Duplicate prevention and SMS logs
// --------------------------------------------------

function logId(candidate) {
  return (
    `${encodeURIComponent(candidate.loanId)}` +
    `__${candidate.due}__${candidate.stage}`
  );
}

async function deliverOnce(candidate) {
  const ref = db
    .collection('smsAlertLogs')
    .doc(logId(candidate));

  const reserved = await db.runTransaction(
    async transaction => {
      const snap = await transaction.get(ref);

      if (
        snap.exists &&
        ['sent', 'sending'].includes(
          String(snap.data().status || '')
        )
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
        attempts:
          Number(snap.data()?.attempts || 0) + 1,
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
      provider: 'sms.bd',
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
      error: String(
        error.message || error
      ).slice(0, 500),
      updatedAt:
        admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    throw error;
  }
}

// --------------------------------------------------
// Daily scheduler — 9:00 AM Bangladesh time
// --------------------------------------------------

exports.installmentReminderScheduler = onSchedule({
  schedule: '0 9 * * *',
  timeZone: 'Asia/Dhaka',
  region: 'asia-south1',
  secrets: [SMS_API_KEY],
  retryCount: 0
}, async () => {
  const today = dhakaDateKey();

  // Safe by default: no SMS is sent unless enabled.
  if (SMS_ALERTS_ENABLED.value() !== 'true') {
    logger.info('SMS dry run only; no messages sent', {
      today,
      upcomingDueDate: shiftDateKey(today, 2)
    });

    const preview = await loadCandidates(today);

    logger.info(
      'SMS reminder preview count (no sends)',
      {
        count: preview.length,
        candidates: preview.map(candidate => ({
          loanNo: candidate.loanNo,
          memberNo: candidate.memberNo,
          due: candidate.due,
          stage: candidate.stage,
          message: candidate.message
        }))
      }
    );

    return;
  }

  const candidates = await loadCandidates(today);

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

      logger.error('SMS send failed', {
        loanNo: candidate.loanNo,
        due: candidate.due,
        stage: candidate.stage,
        error: String(error.message || error)
      });
    }
  }

  logger.info('SMS reminder run completed', {
    today,
    candidates: candidates.length,
    sent,
    skipped,
    failed
  });
});

// --------------------------------------------------
// Exposed helpers for testing
// --------------------------------------------------

exports._test = {
  dhakaDateKey,
  shiftDateKey,
  normalizePhone,
  scheduleIntervalDays,
  monthlyDueDate,
  fmtDate,
  buildReminderMessage
};
