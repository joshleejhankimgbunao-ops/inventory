const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TZ = 'Asia/Manila';

const CreditTransaction = require('../src/models/CreditTransaction');
const { classifyCreditOrder, getExtensionTimeline } = require('../src/services/creditOverdueHistory');
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: { publishCreditTransactionsUpdated: () => {} },
};
const { __test: { applyCreditTermExtension, saveCreditTermExtension } } = require('../src/controllers/creditTransactionController');

const manilaDate = (value) => new Date(`${value}+08:00`);
const transactionFixture = (overrides = {}) => new CreditTransaction({
  creditTransactionId: 'CR-EXTENSION-TEST',
  customerName: 'Test Customer',
  totalAmount: 100,
  amountPaid: 0,
  remainingBalance: 100,
  termDays: 10,
  dueDate: manilaDate('2026-10-29T00:00:00'),
  originalDueDate: null,
  status: 'Unpaid',
  paymentHistory: [],
  ...overrides,
});

const captureExpectedState = (transaction) => ({
  _id: transaction._id,
  updatedAt: transaction.updatedAt ? new Date(transaction.updatedAt) : null,
  dueDate: new Date(transaction.dueDate),
  termDays: Number(transaction.termDays || 0),
  amountPaid: Number(transaction.amountPaid || 0),
  remainingBalance: Number(transaction.remainingBalance || 0),
});

const extensionLog = (days, createdAt, termDays, transactionId = 'CR-EXTENSION-TEST') => ({
  userRef: 'admin-1',
  details: `Credit transaction ${transactionId} term extended by ${days} day(s). New term: ${termDays} day(s).`,
  createdAt: manilaDate(createdAt),
});

const paymentLog = (transactionId, createdAt, amount = 100, remaining = 0) => ({
  action: 'Recorded Credit Payment',
  userRef: 'admin-1',
  details: `Credit transaction ${transactionId} payment recorded: ${amount}. Remaining balance: ${remaining}.`,
  createdAt: manilaDate(createdAt),
});

test('a 5-day extension from a 10-day term preserves the original date and produces a 15-day term', async () => {
  const transaction = transactionFixture();
  const originalDueDate = new Date(transaction.dueDate);

  await applyCreditTermExtension({ transaction, extensionDays: 5 });

  assert.equal(transaction.termDays, 15);
  assert.equal(transaction.originalDueDate.toISOString(), originalDueDate.toISOString());
  assert.equal(transaction.dueDate.toISOString(), manilaDate('2026-11-03T00:00:00').toISOString());
  assert.notStrictEqual(transaction.originalDueDate, transaction.dueDate);
});

test('sequential extensions continue from the current due date and never move the original due date', async () => {
  const transaction = transactionFixture();
  const originalDueDate = new Date(transaction.dueDate);

  await applyCreditTermExtension({ transaction, extensionDays: 5 });
  await applyCreditTermExtension({ transaction, extensionDays: 3 });

  assert.equal(transaction.termDays, 18);
  assert.equal(transaction.originalDueDate.toISOString(), originalDueDate.toISOString());
  assert.equal(transaction.dueDate.toISOString(), manilaDate('2026-11-06T00:00:00').toISOString());
  assert.notStrictEqual(transaction.originalDueDate, transaction.dueDate);

  const logs = [
    extensionLog(5, '2026-10-20T09:00:00', 15),
    extensionLog(3, '2026-10-21T09:00:00', 18),
  ];
  const timeline = getExtensionTimeline(transaction, logs);
  assert.equal(timeline.reliable, true);
  assert.equal(timeline.lateDays, 0);
});

test('an established original due date is preserved when another extension is applied', async () => {
  const transaction = transactionFixture({
    termDays: 15,
    originalDueDate: manilaDate('2026-10-24T00:00:00'),
  });
  const originalDueDate = new Date(transaction.originalDueDate);

  await applyCreditTermExtension({ transaction, extensionDays: 5 });

  assert.equal(transaction.originalDueDate.toISOString(), originalDueDate.toISOString());
  assert.equal(transaction.dueDate.toISOString(), manilaDate('2026-11-03T00:00:00').toISOString());
  assert.equal(transaction.termDays, 20);
});

test('maximum and invalid extension attempts leave all transaction fields unchanged', async () => {
  const transaction = transactionFixture({ termDays: 55 });
  await applyCreditTermExtension({ transaction, extensionDays: 5 });
  assert.equal(transaction.termDays, 60);
  const atMaximum = {
    termDays: transaction.termDays,
    dueDate: transaction.dueDate.toISOString(),
    originalDueDate: transaction.originalDueDate.toISOString(),
  };

  await assert.rejects(applyCreditTermExtension({ transaction, extensionDays: 1 }), (error) => error.status === 400);
  assert.deepEqual({
    termDays: transaction.termDays,
    dueDate: transaction.dueDate.toISOString(),
    originalDueDate: transaction.originalDueDate.toISOString(),
  }, atMaximum);

  const invalidTransaction = transactionFixture();
  const invalidBefore = {
    termDays: invalidTransaction.termDays,
    dueDate: invalidTransaction.dueDate.toISOString(),
    originalDueDate: invalidTransaction.originalDueDate,
  };
  await assert.rejects(applyCreditTermExtension({ transaction: invalidTransaction, extensionDays: 0 }), (error) => error.status === 400);
  assert.deepEqual({
    termDays: invalidTransaction.termDays,
    dueDate: invalidTransaction.dueDate.toISOString(),
    originalDueDate: invalidTransaction.originalDueDate,
  }, invalidBefore);
});

test('the corrected extension timeline keeps a paid-before-due order paid and not overdue', () => {
  const transaction = {
    creditTransactionId: 'CR-EXTENSION-TEST',
    customerName: 'Test Customer',
    totalAmount: 68.5,
    amountPaid: 68.5,
    remainingBalance: 0,
    termDays: 15,
    originalDueDate: manilaDate('2026-10-29T00:00:00'),
    dueDate: manilaDate('2026-11-03T00:00:00'),
    status: 'Paid',
    paymentHistory: [
      { paymentDate: manilaDate('2026-10-20T08:00:00'), recordedAt: manilaDate('2026-10-20T08:00:00'), amount: 40.5, type: 'payment' },
      { paymentDate: manilaDate('2026-10-20T08:59:50'), recordedAt: manilaDate('2026-10-20T08:59:50'), amount: 28, type: 'down_payment' },
    ],
  };
  const logs = [extensionLog(5, '2026-10-19T09:00:36', 15)];
  const result = classifyCreditOrder(transaction, logs, manilaDate('2026-11-10T12:00:00'));

  assert.equal(result.paymentStatus, 'Paid');
  assert.equal(result.unverifiedReason, '');
  assert.equal(result.confirmedOverdue, false);
  assert.equal(result.paymentDaysLate, 0);
  assert.equal(result.overdueBeforeExtensionDays, 0);
  assert.equal(result.daysLate, 0);
});

test('a reconciled extension timeline still identifies payment after the effective due date as overdue', () => {
  const transaction = {
    creditTransactionId: 'CR-EXTENSION-TEST',
    customerName: 'Test Customer',
    totalAmount: 100,
    amountPaid: 100,
    remainingBalance: 0,
    termDays: 15,
    originalDueDate: manilaDate('2026-10-29T00:00:00'),
    dueDate: manilaDate('2026-11-03T00:00:00'),
    status: 'Paid',
    paymentHistory: [{ paymentDate: manilaDate('2026-11-05T09:00:00'), recordedAt: manilaDate('2026-11-05T09:00:00'), amount: 100, type: 'payment' }],
  };
  const result = classifyCreditOrder(transaction, [extensionLog(5, '2026-10-19T09:00:36', 15)], manilaDate('2026-11-10T12:00:00'));

  assert.equal(result.paymentStatus, 'Paid');
  assert.equal(result.confirmedOverdue, true);
  assert.equal(result.daysLate, 2);
});

test('historical overdue periods and final-payment lateness are reported separately', () => {
  const cases = [
    {
      id: 'CR-20260825-6DG4K2',
      originalDueDate: manilaDate('2026-08-26T00:00:00'),
      dueDate: manilaDate('2026-10-24T00:00:00'),
      termDays: 60,
      initialTermDays: 1,
      paymentDate: manilaDate('2026-10-26T12:00:00'),
      paymentRecordedAt: manilaDate('2026-10-26T12:00:00'),
      extensions: [
        [5, '2026-08-31T12:00:00'], [1, '2026-09-01T12:00:00'],
        [4, '2026-09-05T12:00:00'], [9, '2026-09-14T12:00:00'],
        [3, '2026-09-17T12:00:00'], [37, '2026-10-04T12:00:00'],
      ],
      expectedPaymentDaysLate: 2,
      expectedOverdueBeforeExtensionDays: 39,
    },
    {
      id: 'CR-20260830-RIUUGO',
      originalDueDate: manilaDate('2026-09-04T00:00:00'),
      dueDate: manilaDate('2026-10-19T00:00:00'),
      termDays: 50,
      initialTermDays: 5,
      paymentDate: manilaDate('2026-10-21T12:00:00'),
      paymentRecordedAt: manilaDate('2026-10-21T12:00:00'),
      extensions: [
        [1, '2026-09-05T12:00:00'], [17, '2026-09-07T12:00:00'],
        [25, '2026-09-25T12:00:00'], [2, '2026-11-06T12:00:00'],
      ],
      expectedPaymentDaysLate: null,
      expectedOverdueBeforeExtensionDays: null,
      expectedUnverified: true,
    },
  ];

  for (const entry of cases) {
    const transaction = {
      creditTransactionId: entry.id,
      customerName: 'Test Customer',
      totalAmount: 100,
      amountPaid: 100,
      remainingBalance: 0,
      termDays: entry.termDays,
      originalDueDate: entry.originalDueDate,
      dueDate: entry.dueDate,
      status: 'Paid',
      paymentHistory: [{ paymentDate: entry.paymentDate, recordedAt: entry.paymentRecordedAt, amount: 100, type: 'payment', recordedById: 'admin-1' }],
    };
    const logs = entry.extensions.map(([days, createdAt], index) => extensionLog(
      days,
      createdAt,
      entry.initialTermDays + entry.extensions.slice(0, index + 1).reduce((sum, [extensionDays]) => sum + extensionDays, 0),
      entry.id,
    ));
    const result = classifyCreditOrder(transaction, logs, manilaDate('2026-12-01T12:00:00'), [
      paymentLog(entry.id, entry.paymentRecordedAt),
    ]);

    assert.equal(result.paymentStatus, 'Paid', entry.id);
    assert.equal(result.confirmedOverdue, !entry.expectedUnverified, entry.id);
    assert.equal(result.paymentDaysLate, entry.expectedPaymentDaysLate, entry.id);
    assert.equal(result.overdueBeforeExtensionDays, entry.expectedOverdueBeforeExtensionDays, entry.id);
    if (entry.expectedUnverified) {
      assert.match(result.unverifiedReason, /after the full payment was recorded in the ledger/i, entry.id);
    }
    assert.equal(
      (manilaDate(entry.paymentDate.toISOString().slice(0, 10) + 'T00:00:00').getTime() - entry.dueDate.getTime()) / 86400000,
      2,
      `${entry.id} final payment remains two days after the final due date`,
    );
  }
});

test('a paid-before-final-due account retains one overdue day before an extension approved after the original due date', () => {
  const transaction = {
    creditTransactionId: 'CR-20261017-9TBZQL',
    customerName: 'Sinag',
    totalAmount: 100,
    amountPaid: 100,
    remainingBalance: 0,
    termDays: 11,
    originalDueDate: manilaDate('2026-10-18T00:00:00'),
    dueDate: manilaDate('2026-10-28T00:00:00'),
    status: 'Paid',
    paymentHistory: [{ paymentDate: manilaDate('2026-10-26T12:00:00'), recordedAt: manilaDate('2026-10-26T12:00:00'), amount: 100, type: 'payment' }],
  };
  const result = classifyCreditOrder(
    transaction,
    [extensionLog(10, '2026-10-19T09:00:00', 11, 'CR-20261017-9TBZQL')],
    manilaDate('2026-11-10T12:00:00'),
  );

  assert.equal(result.paymentStatus, 'Paid');
  assert.equal(result.confirmedOverdue, true);
  assert.equal(result.paymentDaysLate, 0);
  assert.equal(result.overdueBeforeExtensionDays, 1);
  assert.equal(result.daysLate, 0);
});

test('concurrent extension writes use compare-and-set so only one stale request can succeed', async () => {
  const initialUpdatedAt = manilaDate('2026-10-19T08:59:50');
  const initial = transactionFixture({ updatedAt: initialUpdatedAt });
  const firstRequest = transactionFixture({ _id: initial._id, updatedAt: initialUpdatedAt });
  const secondRequest = transactionFixture({ _id: initial._id, updatedAt: initialUpdatedAt });
  const firstExpectedState = captureExpectedState(firstRequest);
  const secondExpectedState = captureExpectedState(secondRequest);
  const initialState = {
    _id: initial._id,
    updatedAt: new Date(initialUpdatedAt),
    dueDate: new Date(initial.dueDate),
    termDays: initial.termDays,
    amountPaid: initial.amountPaid,
    remainingBalance: initial.remainingBalance,
    paymentProcessingRequestId: '',
    paymentProcessingStartedAt: null,
  };
  const sharedState = { ...initialState };
  const model = {
    async findOneAndUpdate(filter, update) {
      const fieldsMatch = String(sharedState._id) === String(filter._id)
        && sharedState.updatedAt.getTime() === (filter.updatedAt instanceof Date ? filter.updatedAt.getTime() : NaN)
        && sharedState.dueDate.getTime() === filter.dueDate.getTime()
        && sharedState.termDays === filter.termDays
        && sharedState.amountPaid === filter.amountPaid
        && sharedState.remainingBalance === filter.remainingBalance
        && !sharedState.paymentProcessingRequestId;
      if (!fieldsMatch) return null;
      Object.assign(sharedState, update.$set);
      sharedState.updatedAt = manilaDate('2026-10-19T09:00:00');
      return { ...sharedState };
    },
  };
  await Promise.all([
    applyCreditTermExtension({ transaction: firstRequest, extensionDays: 5 }),
    applyCreditTermExtension({ transaction: secondRequest, extensionDays: 5 }),
  ]);
  firstRequest.status = 'Partially Paid';
  secondRequest.status = 'Partially Paid';

  const results = await Promise.all([
    saveCreditTermExtension({ transaction: firstRequest, expectedState: firstExpectedState, model, now: manilaDate('2026-10-19T09:00:00') }),
    saveCreditTermExtension({ transaction: secondRequest, expectedState: secondExpectedState, model, now: manilaDate('2026-10-19T09:00:00') }),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.filter((result) => result === null).length, 1);
  assert.equal(sharedState.termDays, 15);
  assert.equal(sharedState.originalDueDate.toISOString(), manilaDate('2026-10-29T00:00:00').toISOString());
  assert.equal(sharedState.dueDate.toISOString(), manilaDate('2026-11-03T00:00:00').toISOString());
});
