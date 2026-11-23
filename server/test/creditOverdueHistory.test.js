const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { buildCustomerOverdueHistory, classifyCreditOrder, getPaymentTimeline } = require('../src/services/creditOverdueHistory');
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true, exports: { publishCreditTransactionsUpdated: () => {} } };
const { getCustomerOverdueHistory } = require('../src/controllers/creditTransactionController');

const asDate = (day, hour = '12:00:00') => new Date(`2026-10-${String(day).padStart(2, '0')}T${hour}+08:00`);
const now = asDate(26);

const makeCredit = (overrides = {}) => ({
  creditTransactionId: 'CR-1',
  customerId: 'partner-1',
  customerName: 'Ava Customer',
  totalAmount: 100,
  amountPaid: 0,
  remainingBalance: 100,
  dueDate: asDate(20),
  originalDueDate: null,
  status: 'Overdue',
  paymentHistory: [],
  createdAt: asDate(1),
  cancelledAt: null,
  ...overrides,
});

const getCustomer = (rows, key = 'id:partner-1') => rows.find((customer) => customer.customerKey === key);

test('counts a current overdue order once despite multiple partial payments', () => {
  const credit = makeCredit({
    amountPaid: 30,
    remainingBalance: 70,
    paymentHistory: [
      { paymentDate: asDate(21), amount: 10, type: 'payment' },
      { paymentDate: asDate(24), amount: 20, type: 'payment' },
    ],
  });

  const rows = buildCustomerOverdueHistory([credit], [], now);
  assert.equal(rows[0].lifetimeOverdueCount, 1);
  assert.equal(rows[0].currentlyOverdueCount, 1);
  assert.equal(rows[0].overdueOrders[0].paymentDaysLate, null);
  assert.equal(rows[0].overdueOrders[0].overdueBeforeExtensionDays, null);
  assert.equal(rows[0].overdueOrders[0].daysLate, null);
  assert.equal(rows[0].overdueOrders[0].paymentHistory.length, 2);
});

test('counts paid-late orders for lifetime but not currently overdue', () => {
  const credit = makeCredit({
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(22), amount: 100, type: 'payment' }],
  });

  const customer = getCustomer(buildCustomerOverdueHistory([credit], [], now));
  assert.equal(customer.lifetimeOverdueCount, 1);
  assert.equal(customer.currentlyOverdueCount, 0);
  assert.equal(customer.overdueOrders[0].daysLate, 2);
  assert.equal(customer.overdueOrders[0].paymentDaysLate, 2);
  assert.equal(customer.overdueOrders[0].overdueBeforeExtensionDays, null);
});

test('aggregates repeated overdue orders by customer while counting each distinct order once', () => {
  const currentPartials = makeCredit({
    creditTransactionId: 'CR-CURRENT',
    amountPaid: 40,
    remainingBalance: 60,
    paymentHistory: [
      { paymentDate: asDate(21), amount: 20, type: 'payment' },
      { paymentDate: asDate(23), amount: 20, type: 'payment' },
    ],
  });
  const paidLate = makeCredit({
    creditTransactionId: 'CR-PAID-LATE',
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [
      { paymentDate: asDate(21), amount: 25, type: 'down_payment' },
      { paymentDate: asDate(24), amount: 75, type: 'payment' },
    ],
  });

  const customer = getCustomer(buildCustomerOverdueHistory([currentPartials, paidLate], [], now));
  assert.equal(customer.totalCreditOrders, 2);
  assert.equal(customer.lifetimeOverdueCount, 2);
  assert.equal(customer.currentlyOverdueCount, 1);
  assert.deepEqual(customer.overdueOrders.map((order) => order.creditTransactionId), ['CR-CURRENT', 'CR-PAID-LATE']);
});

test('does not count on-time or partially paid orders that have not passed their due date', () => {
  const onTimePaid = makeCredit({
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(20), amount: 100, type: 'payment' }],
  });
  const notYetDue = makeCredit({
    creditTransactionId: 'CR-2',
    dueDate: asDate(28),
    amountPaid: 25,
    remainingBalance: 75,
    status: 'Partially Paid',
    paymentHistory: [{ paymentDate: asDate(10), amount: 25, type: 'down_payment' }],
  });

  const customer = getCustomer(buildCustomerOverdueHistory([onTimePaid, notYetDue], [], now));
  assert.equal(customer.totalCreditOrders, 2);
  assert.equal(customer.lifetimeOverdueCount, 0);
  assert.equal(customer.currentlyOverdueCount, 0);
  assert.equal(customer.unverifiedCount, 0);
});

test('respects on-time extensions and detects extensions granted after the due date', () => {
  const onTimeExtension = makeCredit({
    dueDate: asDate(25),
    originalDueDate: asDate(20),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(24), recordedAt: asDate(24), amount: 100, type: 'payment' }],
  });
  const lateExtension = makeCredit({
    creditTransactionId: 'CR-2',
    dueDate: asDate(25),
    originalDueDate: asDate(20),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(24), recordedAt: asDate(24), amount: 100, type: 'payment' }],
  });
  const logs = [
    { details: 'Credit transaction CR-1 term extended by 5 day(s). New term: 5 day(s).', createdAt: asDate(19), userRef: 'admin-1' },
    { details: 'Credit transaction CR-2 term extended by 5 day(s). New term: 5 day(s).', createdAt: asDate(22), userRef: 'admin-1' },
  ];

  const rows = buildCustomerOverdueHistory([onTimeExtension, lateExtension], logs, now);
  const customer = getCustomer(rows);
  assert.equal(customer.lifetimeOverdueCount, 1);
  assert.equal(customer.overdueOrders[0].creditTransactionId, 'CR-2');
  assert.equal(customer.overdueOrders[0].paymentDaysLate, 0);
  assert.equal(customer.overdueOrders[0].overdueBeforeExtensionDays, 2);
  assert.equal(customer.overdueOrders[0].daysLate, 0);
});

test('separates final payment lateness from confirmed overdue days before extensions', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20),
    dueDate: asDate(25),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(24), recordedAt: asDate(24), amount: 100, type: 'payment', clientRequestId: 'payment-final' }],
  });
  const extensionLogs = [{
    details: 'Credit transaction CR-1 term extended by 5 day(s). New term: 5 day(s).',
    createdAt: asDate(22),
    userRef: 'admin-1',
  }];
  const customer = getCustomer(buildCustomerOverdueHistory([transaction], extensionLogs, now));

  assert.equal(customer.lifetimeOverdueCount, 1);
  assert.equal(customer.overdueOrders.length, 1);
  assert.equal(customer.overdueOrders[0].paymentStatus, 'Paid');
  assert.equal(customer.overdueOrders[0].paymentDaysLate, 0);
  assert.equal(customer.overdueOrders[0].overdueBeforeExtensionDays, 2);
});

test('counts final payment lateness and pre-extension overdue days separately without double-counting the order', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20),
    dueDate: asDate(25),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(27), recordedAt: asDate(27), amount: 100, type: 'payment' }],
  });
  const customer = getCustomer(buildCustomerOverdueHistory([transaction], [{
    details: 'Credit transaction CR-1 term extended by 5 day(s). New term: 5 day(s).',
    createdAt: asDate(22),
    userRef: 'admin-1',
  }], now));

  assert.equal(customer.lifetimeOverdueCount, 1);
  assert.equal(customer.overdueOrders[0].paymentDaysLate, 2);
  assert.equal(customer.overdueOrders[0].overdueBeforeExtensionDays, 2);
});

test('uses the date the balance reached zero as the full-payment date', () => {
  const transaction = makeCredit({
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [
      { paymentDate: asDate(20), amount: 40, type: 'down_payment', clientRequestId: 'payment-1' },
      { paymentDate: asDate(22), amount: 60, type: 'payment', clientRequestId: 'payment-2' },
    ],
  });
  const result = classifyCreditOrder(transaction, [], now);
  assert.equal(result.paymentDaysLate, 2);
  assert.equal(result.confirmedOverdue, true);
});

test('keeps repeated payment request IDs in Needs Review instead of counting unsupported overdue history', () => {
  const transaction = makeCredit({
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [
      { paymentDate: asDate(21), amount: 50, type: 'payment', clientRequestId: 'duplicate-request' },
      { paymentDate: asDate(22), amount: 50, type: 'payment', clientRequestId: 'duplicate-request' },
    ],
  });
  const customer = getCustomer(buildCustomerOverdueHistory([transaction], [], now));

  assert.equal(customer.lifetimeOverdueCount, 0);
  assert.equal(customer.unverifiedCount, 1);
  assert.equal(customer.unverifiedOrders[0].paymentStatus, 'Paid');
  assert.match(customer.unverifiedOrders[0].reason, /duplicate payment entries/i);
});

test('keeps date-only payment dates in review when a later extension has no linked ledger timestamp', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20),
    dueDate: asDate(25),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(24), amount: 100, type: 'payment' }],
  });
  const customer = getCustomer(buildCustomerOverdueHistory([transaction], [{
    details: 'Credit transaction CR-1 term extended by 5 day(s). New term: 5 day(s).',
    createdAt: asDate(26), userRef: 'admin-1',
  }], now));

  assert.equal(customer.lifetimeOverdueCount, 0);
  assert.equal(customer.unverifiedCount, 1);
  assert.equal(customer.unverifiedOrders[0].paymentStatus, 'Paid');
  assert.match(customer.unverifiedOrders[0].reason, /ledger-recorded time.*unavailable/i);
});

const extensionAudit = (transactionId, date) => ({
  action: 'Extended Credit Term',
  userRef: 'admin-1',
  details: `Credit transaction ${transactionId} term extended by 5 day(s). New term: 15 day(s).`,
  createdAt: date,
});

const paymentAudit = (transactionId, date, amount = 100, remaining = 0, userRef = 'admin-1') => ({
  action: 'Recorded Credit Payment',
  userRef,
  details: `Credit transaction ${transactionId} payment recorded: ${amount}. Remaining balance: ${remaining}.`,
  createdAt: date,
});

test('same-day extension before payment recording uses linked ledger timestamps, not the date-only payment instant', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20), dueDate: asDate(25), amountPaid: 100, remainingBalance: 0, status: 'Paid',
    paymentHistory: [{ paymentDate: new Date('2026-10-22T00:00:00.000Z'), amount: 100, type: 'payment', recordedById: 'admin-1' }],
  });
  const extensionAt = asDate(22, '16:24:12');
  const paymentRecordedAt = asDate(22, '16:40:00');
  const result = classifyCreditOrder(transaction, [extensionAudit('CR-1', extensionAt)], now, [
    paymentAudit('CR-1', paymentRecordedAt),
  ]);

  assert.equal(result.unverifiedReason, '');
  assert.equal(result.confirmedOverdue, true);
  assert.equal(result.paymentDaysLate, 0);
  assert.equal(result.overdueBeforeExtensionDays, 2);
});

test('same-day payment recording before extension remains Needs Review as a post-settlement extension', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20), dueDate: asDate(25), amountPaid: 100, remainingBalance: 0, status: 'Paid',
    paymentHistory: [{ paymentDate: new Date('2026-10-22T00:00:00.000Z'), amount: 100, type: 'payment', recordedById: 'admin-1' }],
  });
  const result = classifyCreditOrder(transaction, [extensionAudit('CR-1', asDate(22, '16:40:01'))], now, [
    paymentAudit('CR-1', asDate(22, '16:40:00')),
  ]);

  assert.match(result.unverifiedReason, /after the full payment was recorded in the ledger/i);
  assert.equal(result.confirmedOverdue, false);
});

test('same-day date-only payment without a uniquely linked authenticated log stays Needs Review', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20), dueDate: asDate(25), amountPaid: 100, remainingBalance: 0, status: 'Paid',
    paymentHistory: [{ paymentDate: new Date('2026-10-22T00:00:00.000Z'), amount: 100, type: 'payment' }],
  });
  const result = classifyCreditOrder(transaction, [extensionAudit('CR-1', asDate(22, '16:24:12'))], now);

  assert.match(result.unverifiedReason, /share a calendar date.*cannot be confirmed/i);
  assert.equal(result.confirmedOverdue, false);
});

test('conflicting payment actor evidence and duplicate action logs do not establish ledger order', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(20), dueDate: asDate(25), amountPaid: 100, remainingBalance: 0, status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(22), amount: 100, type: 'payment', recordedById: 'admin-1' }],
  });
  const logs = [
    paymentAudit('CR-1', asDate(22, '16:40:00'), 100, 0, 'admin-2'),
    paymentAudit('CR-1', asDate(22, '16:40:01'), 100, 0, 'admin-1'),
  ];
  const result = classifyCreditOrder(transaction, [extensionAudit('CR-1', asDate(22, '16:24:12'))], now, logs);

  assert.match(result.unverifiedReason, /audit records do not establish a reliable ledger sequence/i);
  assert.equal(result.confirmedOverdue, false);
});

test('full-payment calendar date follows ledger entry order when partial payment dates are backdated', () => {
  const timeline = getPaymentTimeline(makeCredit({
    totalAmount: 100, amountPaid: 100, remainingBalance: 0,
    paymentHistory: [
      { paymentDate: asDate(23), amount: 40, type: 'payment', recordedAt: asDate(23, '09:00:00') },
      { paymentDate: asDate(22), amount: 60, type: 'payment', recordedAt: asDate(24, '09:00:00') },
    ],
  }));

  assert.equal(timeline.reliable, true);
  assert.equal(timeline.fullPaymentDate.toISOString(), asDate(22).toISOString());
});

test('the three audited same-day records use authenticated ledger action evidence after due-date repair simulation', () => {
  const cases = [
    { id: 'CR-20260820-QHK2W7', original: '2026-08-25T16:00:00.000Z', due: '2026-08-26T16:00:00.000Z', extensionAt: '2026-08-21T08:24:12.461Z', paymentAt: '2026-08-21T08:40:00.806Z', amount: 50, extensionDays: 1 },
    { id: 'CR-20261019-QGBODI', original: '2026-10-28T16:00:00.000Z', due: '2026-11-02T16:00:00.000Z', extensionAt: '2026-10-19T01:00:36.258Z', paymentAt: '2026-10-19T01:01:45.547Z', amount: 40.5, extensionDays: 5 },
    { id: 'CR-20261026-3QAW2R', original: '2026-10-30T16:00:00.000Z', due: '2026-12-24T16:00:00.000Z', extensionAt: '2026-10-26T05:52:13.480Z', paymentAt: '2026-10-26T05:52:51.553Z', amount: 20.5, extensionDays: 55 },
  ];

  for (const entry of cases) {
    const transaction = makeCredit({
      creditTransactionId: entry.id,
      totalAmount: entry.amount,
      amountPaid: entry.amount,
      remainingBalance: 0,
      status: 'Paid',
      // Existing bad originalDueDate values mirror the final due date. The
      // corrected value below is simulated in memory; no historical record is changed.
      originalDueDate: new Date(entry.due),
      dueDate: new Date(entry.due),
      termDays: entry.extensionDays + (entry.id === 'CR-20260820-QHK2W7' ? 6 : entry.id === 'CR-20261019-QGBODI' ? 10 : 5),
      paymentHistory: [{ paymentDate: new Date(`${entry.extensionAt.slice(0, 10)}T00:00:00.000Z`), amount: entry.amount, type: 'payment', recordedById: 'admin-1' }],
    });
    const extension = {
      action: 'Extended Credit Term', userRef: 'admin-1', createdAt: new Date(entry.extensionAt),
      details: `Credit transaction ${entry.id} term extended by ${entry.extensionDays} day(s). New term: ${transaction.termDays} day(s).`,
    };
    const payment = paymentAudit(entry.id, new Date(entry.paymentAt), entry.amount);
    const beforeCorrection = classifyCreditOrder(transaction, [extension], now, [payment]);
    const afterCorrection = classifyCreditOrder({ ...transaction, originalDueDate: new Date(entry.original) }, [extension], now, [payment]);

    assert.match(beforeCorrection.unverifiedReason, /extension history is incomplete/i, `${entry.id} remains flagged before a correction`);
    assert.equal(beforeCorrection.confirmedOverdue, false, entry.id);
    assert.equal(afterCorrection.unverifiedReason, '', entry.id);
    assert.equal(afterCorrection.confirmedOverdue, false, entry.id);
    assert.equal(afterCorrection.paymentDaysLate, 0, entry.id);
    assert.equal(afterCorrection.overdueBeforeExtensionDays, 0, entry.id);
  }
});

test('an inconsistent original due date remains Needs Review even with linked action timestamps', () => {
  const transaction = makeCredit({
    originalDueDate: asDate(25), dueDate: asDate(25), amountPaid: 100, remainingBalance: 0, status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(22), amount: 100, type: 'payment', recordedById: 'admin-1' }],
  });
  const result = classifyCreditOrder(transaction, [extensionAudit('CR-1', asDate(21))], now, [paymentAudit('CR-1', asDate(22, '13:00:00'))]);
  assert.match(result.unverifiedReason, /extension history is incomplete/i);
  assert.equal(result.confirmedOverdue, false);
});

test('keeps mismatched historical extension timelines in review without mutating source records', () => {
  const records = Array.from({ length: 6 }, (_, index) => makeCredit({
    creditTransactionId: `CR-HISTORICAL-${index + 1}`,
    originalDueDate: asDate(15),
    dueDate: asDate(25),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(22), amount: 100, type: 'payment' }],
  }));
  const before = structuredClone(records);
  const customer = getCustomer(buildCustomerOverdueHistory(records, [], now));

  assert.equal(customer.lifetimeOverdueCount, 0);
  assert.equal(customer.unverifiedCount, 6);
  assert.ok(customer.unverifiedOrders.every((order) => order.paymentStatus === 'Paid'));
  assert.deepEqual(records, before);
});

test('marks extension, payment, and cancellation records unverified when dates cannot establish lateness', () => {
  const extensionWithoutAudit = makeCredit({
    originalDueDate: asDate(15),
    dueDate: asDate(25),
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(18), amount: 100, type: 'payment' }],
  });
  const paidWithoutReconciledHistory = makeCredit({
    creditTransactionId: 'CR-2',
    amountPaid: 100,
    remainingBalance: 0,
    status: 'Paid',
    paymentHistory: [{ paymentDate: asDate(22), amount: 50, type: 'payment' }],
  });
  const cancelledWithoutDate = makeCredit({
    creditTransactionId: 'CR-3',
    status: 'Cancelled',
    cancelledAt: null,
  });

  const customer = getCustomer(buildCustomerOverdueHistory([extensionWithoutAudit, paidWithoutReconciledHistory, cancelledWithoutDate], [], now));
  assert.equal(customer.lifetimeOverdueCount, 0);
  assert.equal(customer.unverifiedCount, 3);
  assert.match(customer.unverifiedOrders[0].reason, /extension history/i);
  assert.match(customer.unverifiedOrders[1].reason, /payment entries/i);
  assert.equal(customer.unverifiedOrders[1].paymentHistory.length, 1);
  assert.match(customer.unverifiedOrders[2].reason, /cancellation date/i);
});

test('respects cancellations before/after the effective due date and sorts customers by lifetime count', () => {
  const earlyCancellation = makeCredit({
    status: 'Cancelled',
    cancelledAt: asDate(19),
  });
  const lateCancellation = makeCredit({
    creditTransactionId: 'CR-LATE-CANCEL',
    status: 'Cancelled',
    cancelledAt: asDate(22),
  });
  const otherCustomer = makeCredit({
    creditTransactionId: 'CR-OTHER',
    customerId: 'partner-2',
    customerName: 'Ben Customer',
  });

  const rows = buildCustomerOverdueHistory([earlyCancellation, lateCancellation, otherCustomer], [], now);
  assert.deepEqual(rows.map((customer) => customer.customerName), ['Ava Customer', 'Ben Customer']);
  assert.equal(getCustomer(rows).totalCreditOrders, 2);
  assert.equal(getCustomer(rows).lifetimeOverdueCount, 1);
  assert.equal(getCustomer(rows).currentlyOverdueCount, 0);
  assert.equal(rows[1].lifetimeOverdueCount, 1);
});

test('groups by customer identity where present and uses a flagged name fallback when the ID is absent', () => {
  const one = makeCredit({ customerId: null, customerName: 'Unlinked Customer' });
  const two = makeCredit({ creditTransactionId: 'CR-2', customerId: null, customerName: 'Unlinked Customer' });
  const unnamedOne = makeCredit({ creditTransactionId: 'CR-3', customerId: null, customerName: '' });
  const unnamedTwo = makeCredit({ creditTransactionId: 'CR-4', customerId: null, customerName: '' });
  const rows = buildCustomerOverdueHistory([one, two, unnamedOne, unnamedTwo], [], now);
  const nameFallback = rows.find((customer) => customer.customerKey.startsWith('name:'));
  assert.equal(nameFallback.totalCreditOrders, 2);
  const unidentified = buildCustomerOverdueHistory([unnamedOne, unnamedTwo], [], now);
  assert.equal(unidentified.length, 2);
  assert.notEqual(unidentified[0].customerKey, unidentified[1].customerKey);
});

test('read-only endpoint returns history without invoking mutations', async () => {
  let readCount = 0;
  let mutationCount = 0;
  const response = {
    body: null,
    json(value) { this.body = value; return this; },
  };
  const credit = makeCredit({ isArchived: true });

  await getCustomerOverdueHistory({ user: { role: 'admin' } }, response, (error) => { throw error; }, {
    findTransactions: async () => { readCount += 1; return [credit]; },
    findExtensionLogs: async () => { readCount += 1; return []; },
    findPaymentLogs: async () => { readCount += 1; return []; },
    updateTransaction: async () => { mutationCount += 1; },
    now,
  });

  assert.equal(readCount, 3);
  assert.equal(mutationCount, 0);
  assert.equal(response.body.customers[0].totalCreditOrders, 1);
  assert.equal(response.body.customers[0].lifetimeOverdueCount, 1);
});

test('Manila calendar-day overdue results are identical under Manila, UTC, and Los Angeles host timezones', () => {
  const servicePath = path.resolve(__dirname, '../src/services/creditOverdueHistory.js');
  const script = `
    const { buildCustomerOverdueHistory, getExtensionTimeline } = require(${JSON.stringify(servicePath)});
    const date = (value) => new Date(value);
    const makePaid = (id, paymentDate) => ({
      creditTransactionId: id, customerId: 'timezone-test', customerName: 'Timezone Test',
      totalAmount: 100, amountPaid: 100, remainingBalance: 0, status: 'Paid',
      dueDate: date('2026-03-07T16:00:00.000Z'), originalDueDate: null,
      paymentHistory: [{ paymentDate: date(paymentDate), amount: 100, type: 'payment' }],
    });
    const sameDayPaid = buildCustomerOverdueHistory(
      [makePaid('same-day', '2026-03-08T15:30:00.000Z')], [], date('2026-03-08T16:30:00.000Z'),
    )[0];
    const nextDayPaid = buildCustomerOverdueHistory(
      [makePaid('next-day', '2026-03-08T16:30:00.000Z')], [], date('2026-03-10T16:30:00.000Z'),
    )[0];
    const stillDueToday = buildCustomerOverdueHistory([{
      creditTransactionId: 'still-due', customerId: 'timezone-test', customerName: 'Timezone Test',
      totalAmount: 100, amountPaid: 0, remainingBalance: 100, status: 'Unpaid',
      dueDate: date('2026-03-07T16:00:00.000Z'), originalDueDate: null, paymentHistory: [],
    }], [], date('2026-03-08T15:30:00.000Z'))[0];
    const extensionTimeline = getExtensionTimeline({
      creditTransactionId: 'extension',
      originalDueDate: date('2026-03-07T16:00:00.000Z'),
      dueDate: date('2026-03-12T16:00:00.000Z'),
    }, [{
      details: 'Credit transaction extension term extended by 5 day(s). New term: 15 day(s).',
      createdAt: date('2026-03-08T16:30:00.000Z'),
    }]);
    process.stdout.write(JSON.stringify({
      sameDay: { overdue: sameDayPaid.lifetimeOverdueCount, unverified: sameDayPaid.unverifiedCount },
      nextDay: { overdue: nextDayPaid.lifetimeOverdueCount, paymentDaysLate: nextDayPaid.overdueOrders[0]?.paymentDaysLate },
      dueToday: { currentlyOverdue: stillDueToday.currentlyOverdueCount, status: stillDueToday.overdueOrders[0]?.paymentStatus ?? 'not-overdue' },
      extensionTimeline: { reliable: extensionTimeline.reliable, lateDays: extensionTimeline.lateDays },
    }));
  `;
  const results = ['Asia/Manila', 'UTC', 'America/Los_Angeles'].map((timeZone) => {
    const output = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timeZone },
    });
    return JSON.parse(output);
  });

  assert.deepEqual(results[0], {
    sameDay: { overdue: 0, unverified: 0 },
    nextDay: { overdue: 1, paymentDaysLate: 1 },
    dueToday: { currentlyOverdue: 0, status: 'not-overdue' },
    extensionTimeline: { reliable: true, lateDays: 1 },
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});
