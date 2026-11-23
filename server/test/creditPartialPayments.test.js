const test = require('node:test');
const assert = require('node:assert/strict');

const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: { publishCreditTransactionsUpdated: () => {} },
};

const {
  recordCreditPayment,
  __test: { applyPaymentToCreditTransaction },
} = require('../src/controllers/creditTransactionController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

const createTransaction = () => ({
  _id: 'credit-partial-1',
  creditTransactionId: 'CR-PARTIAL-1',
  orderId: 'sale-partial-1',
  totalAmount: 100,
  amountPaid: 20,
  remainingBalance: 80,
  dueDate: new Date('2099-01-01'),
  status: 'Partially Paid',
  paymentHistory: [{ type: 'down_payment', amount: 20, method: 'cash', clientRequestId: 'initial-down-payment:sale-partial-1' }],
  async save() {},
});

const applyPayment = (transaction, amount, method, proof = null) => applyPaymentToCreditTransaction({
  transaction,
  amount,
  method,
  paymentDate: '2026-10-17',
  proof,
  clientRequestId: `payment:${transaction.paymentHistory.length}`,
  user: { _id: 'cashier-1', name: 'Cashier One' },
  req: { ip: '127.0.0.1', get: () => '' },
  findSale: async () => ({ paymentStatus: 'Partially Paid', async save() {} }),
  writeLog: async () => {},
  publishUpdate: () => {},
  startSession: null,
});

test('multiple partial payments preserve the down payment, method-specific events, and exact balances', async () => {
  const transaction = createTransaction();
  const proof = { storageKey: '11111111-1111-4111-8111-111111111111.jpg', fileName: 'gcash.jpg', mimeType: 'image/jpeg' };

  await applyPayment(transaction, '30.00', 'gcash', proof);
  assert.equal(transaction.amountPaid, 50);
  assert.equal(transaction.remainingBalance, 50);
  assert.equal(transaction.status, 'Partially Paid');
  assert.deepEqual(transaction.paymentHistory.map((entry) => entry.type), ['down_payment', 'payment']);
  assert.equal(transaction.paymentHistory[1].method, 'gcash');
  assert.ok(transaction.paymentHistory[1].recordedAt instanceof Date);
  assert.equal(transaction.paymentHistory[1].paymentDate.toISOString(), '2026-10-17T00:00:00.000Z');
  assert.notEqual(transaction.paymentHistory[1].recordedAt.toISOString(), transaction.paymentHistory[1].paymentDate.toISOString());
  assert.equal(transaction.paymentHistory[1].proof.storageKey, proof.storageKey);

  await applyPayment(transaction, '50.00', 'cheque', { storageKey: '22222222-2222-4222-8222-222222222222.jpg', fileName: 'cheque.jpg', mimeType: 'image/jpeg' });
  assert.equal(transaction.amountPaid, 100);
  assert.equal(transaction.remainingBalance, 0);
  assert.equal(transaction.status, 'Paid');
  assert.equal(transaction.paymentHistory[2].method, 'cheque');
  assert.equal(transaction.proofOfPayment.fileName, 'cheque.jpg');
});

test('partial payments reject empty, zero, negative, malformed, overprecision, and over-balance amounts without mutation', async () => {
  for (const amount of ['', '0', '-1', 'abc', '1.001', '80.01']) {
    const transaction = createTransaction();
    await assert.rejects(() => applyPayment(transaction, amount, 'cash'), { status: 400 });
    assert.equal(transaction.amountPaid, 20);
    assert.equal(transaction.remainingBalance, 80);
    assert.equal(transaction.paymentHistory.length, 1);
  }
});

test('a payment commits the credit balance and linked sale status in one transaction callback', async () => {
  const transaction = createTransaction();
  const events = [];
  const session = {
    async withTransaction(work) { events.push('begin'); await work(); events.push('commit'); },
    async endSession() { events.push('end'); },
  };
  transaction.save = async (options) => { assert.equal(options.session, session); events.push('credit-save'); };
  const sale = { paymentStatus: 'Partially Paid', async save(options) { assert.equal(options.session, session); events.push('sale-save'); } };

  await applyPaymentToCreditTransaction({
    transaction,
    amount: '80.00',
    method: 'cheque',
    paymentDate: '2026-10-17',
    clientRequestId: 'credit-payment:atomic',
    user: { _id: 'cashier-1', name: 'Cashier One' },
    req: { ip: '127.0.0.1', get: () => '' },
    findSale: async (_id, receivedSession) => { assert.equal(receivedSession, session); return sale; },
    writeLog: async () => {},
    publishUpdate: () => {},
    startSession: async () => session,
  });

  assert.equal(transaction.status, 'Paid');
  assert.equal(sale.paymentStatus, 'Paid');
  assert.deepEqual(events, ['begin', 'credit-save', 'sale-save', 'commit', 'end']);
});

test('duplicate partial-payment requests do not persist a second proof or payment event', async () => {
  const transaction = createTransaction();
  transaction.paymentHistory.push({ type: 'payment', amount: 10, method: 'cash', clientRequestId: 'credit-payment:retry' });
  const response = createResponse();
  let proofPersisted = false;
  let paymentApplied = false;

  await recordCreditPayment({
    params: { id: transaction._id },
    body: { clientRequestId: 'credit-payment:retry', amount: '10.00', method: 'cash' },
    user: { _id: 'cashier-1' },
    get: () => '',
  }, response, assert.fail, {
    findTransaction: async () => transaction,
    findSale: async () => ({ collectionSource: 'sale' }),
    ensureOwnership: async () => {},
    persistProof: async () => { proofPersisted = true; },
    applyPayment: async () => { paymentApplied = true; },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(proofPersisted, false);
  assert.equal(paymentApplied, false);
});

test('record-payment passes its distinct proof to the existing partial-payment processor', async () => {
  const transaction = createTransaction();
  const response = createResponse();
  const proof = { storageKey: '33333333-3333-4333-8333-333333333333.png', fileName: 'payment.png', mimeType: 'image/png' };
  let received = null;

  await recordCreditPayment({
    params: { id: transaction._id },
    body: { clientRequestId: 'credit-payment:new', amount: '30.00', method: 'bank transfer', paymentDate: '2026-10-17', recordedAt: '1900-01-01T00:00:00.000Z' },
    file: { buffer: Buffer.from([1]) },
    user: { _id: 'cashier-1' },
    get: () => '',
  }, response, assert.fail, {
    findTransaction: async () => transaction,
    findSale: async () => ({ collectionSource: 'sale' }),
    ensureOwnership: async () => {},
    claimPayment: async () => transaction,
    releasePayment: async () => {},
    persistProof: async () => proof,
    applyPayment: async (input) => {
      received = input;
      return { ...transaction, paymentHistory: [...transaction.paymentHistory, { ...input, type: 'payment' }] };
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(received.amount, '30.00');
  assert.equal(received.method, 'bank transfer');
  assert.equal(received.proof.storageKey, proof.storageKey);
  assert.equal(Object.hasOwn(received, 'recordedAt'), false);
});
