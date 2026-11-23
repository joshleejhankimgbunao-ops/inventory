const test = require('node:test');
const assert = require('node:assert/strict');

const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath, filename: realtimePath, loaded: true,
  exports: { publishCreditTransactionsUpdated: () => {} },
};

const {
  recordCreditPayment,
  cancelCreditTransaction,
  getCreditPaymentHistoryProof,
  getCreditCancellationProof,
  __test: { applyPaymentToCreditTransaction, getProofImageMetadata },
} = require('../src/controllers/creditTransactionController');

const response = () => ({
  statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
  set(key, value) { this.headers[key] = value; return this; },
  type(value) { this.headers.type = value; return this; },
  send(value) { this.body = value; return this; },
});

const transaction = () => ({
  _id: 'credit-proof-set', orderId: 'sale-proof-set', creditTransactionId: 'CR-PROOF-SET',
  amountPaid: 20, remainingBalance: 80, totalAmount: 100, status: 'Partially Paid',
  dueDate: new Date('2099-01-01'),
  paymentHistory: [{ type: 'down_payment', amount: 20, clientRequestId: 'initial-down-payment:sale-proof-set' }],
  async save() {},
});

const files = (count) => Array.from({ length: count }, (_, index) => ({ buffer: Buffer.from([index + 1]) }));
const proof = (index) => ({ storageKey: `${index + 1}`.repeat(8) + '.jpg', fileName: `proof-${index}.jpg`, mimeType: 'image/jpeg' });

test('credit proof validation checks real JPG/PNG signatures and 5 MB per image', () => {
  assert.equal(getProofImageMetadata({ mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) }).mimeType, 'image/jpeg');
  assert.equal(getProofImageMetadata({ mimetype: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }).mimeType, 'image/png');
  assert.throws(() => getProofImageMetadata({ mimetype: 'image/jpeg', buffer: Buffer.from('not a jpeg') }), /valid JPG/);
  assert.throws(() => getProofImageMetadata({ mimetype: 'image/jpeg', buffer: Buffer.alloc((5 * 1024 * 1024) + 1) }), /5 MB/);
});

test('new credit payments require 1–3 photos and pass one independent proof set to the payment event', async () => {
  for (const count of [0, 1, 2, 3, 4]) {
    const row = transaction();
    const result = response();
    const persisted = [];
    const removed = [];
    let received;
    await recordCreditPayment({ params: { id: row._id }, body: { clientRequestId: `payment:${count}`, amount: '10', method: 'cash' }, files: { proofs: files(count) }, user: { _id: 'admin' }, get: () => '' }, result, assert.fail, {
      findTransaction: async () => row,
      findSale: async () => ({ collectionSource: 'sale' }),
      ensureOwnership: async () => {},
      claimPayment: async () => row,
      releasePayment: async () => {},
      persistProof: async () => { const item = proof(persisted.length); persisted.push(item); return item; },
      removeProof: async (key) => removed.push(key),
      applyPayment: async (input) => { received = input; input.onTransactionSaved(); return row; },
    });
    if (count === 0 || count === 4) {
      assert.equal(result.statusCode, 400);
      assert.equal(persisted.length, 0);
      assert.equal(received, undefined);
    } else {
      assert.equal(result.statusCode, 200);
      assert.equal(persisted.length, count);
      assert.deepEqual(received.proofs, persisted);
      assert.equal(received.proof, persisted[0]);
    }
    assert.deepEqual(removed, []);
  }
});

test('a failed second upload cleans the first proof without recording a payment', async () => {
  const row = transaction();
  const result = response();
  const removed = [];
  let attempts = 0;
  await recordCreditPayment({ params: { id: row._id }, body: { clientRequestId: 'payment:failed', amount: '10', method: 'cash' }, files: { proofs: files(2) }, user: { _id: 'admin' }, get: () => '' }, result, assert.fail, {
    findTransaction: async () => row,
    findSale: async () => ({ collectionSource: 'sale' }),
    ensureOwnership: async () => {}, claimPayment: async () => row, releasePayment: async () => {},
    persistProof: async () => { if (++attempts === 2) throw Object.assign(new Error('Upload failed'), { status: 503 }); return proof(0); },
    removeProof: async (key) => removed.push(key),
    applyPayment: async () => assert.fail('payment must not be recorded'),
  });
  assert.equal(result.statusCode, 503);
  assert.deepEqual(removed, [proof(0).storageKey]);
  assert.equal(row.paymentHistory.length, 1);
});

test('payment-history proof sets retain legacy first-proof access and independent later payments', async () => {
  const row = transaction();
  const firstSet = [proof(0), proof(1)];
  const secondSet = [proof(2)];
  const apply = (amount, requestId, proofs) => applyPaymentToCreditTransaction({
    transaction: row, amount, method: 'cash', clientRequestId: requestId,
    proof: proofs[0], proofs, user: { _id: 'admin' }, req: { get: () => '' },
    findSale: async () => ({ async save() {} }), writeLog: async () => {}, publishUpdate: () => {}, startSession: null,
  });
  await apply('10', 'payment:first', firstSet);
  await apply('20', 'payment:second', secondSet);
  assert.deepEqual(row.paymentHistory[1].proofs, firstSet);
  assert.deepEqual(row.paymentHistory[2].proofs, secondSet);
  assert.equal(row.paymentHistory[1].proof.storageKey, firstSet[0].storageKey);

  const viewed = response();
  await getCreditPaymentHistoryProof({ params: { id: row._id, requestId: 'payment:first', index: '1' }, user: { role: 'admin' } }, viewed, assert.fail, {
    findTransaction: async () => row,
    ensureOwnership: async () => {},
    getProof: async (key) => ({ type: 'r2', object: { Body: { transformToByteArray: async () => Buffer.from(key) } } }),
  });
  assert.equal(viewed.body.toString(), firstSet[1].storageKey);

  row.paymentHistory.push({ clientRequestId: 'payment:legacy', proof: proof(3) });
  const legacy = response();
  await getCreditPaymentHistoryProof({ params: { id: row._id, requestId: 'payment:legacy' }, user: { role: 'admin' } }, legacy, assert.fail, {
    findTransaction: async () => row,
    ensureOwnership: async () => {},
    getProof: async (key) => ({ type: 'r2', object: { Body: { transformToByteArray: async () => Buffer.from(key) } } }),
  });
  assert.equal(legacy.body.toString(), proof(3).storageKey);
});

test('final settlement keeps all final proof photos while retaining the legacy first-proof alias', async () => {
  const row = transaction();
  const finalProofs = [proof(0), proof(1), proof(2)];
  await applyPaymentToCreditTransaction({
    transaction: row, amount: '80.00', method: 'cheque', clientRequestId: 'payment:final',
    proof: finalProofs[0], proofs: finalProofs, user: { _id: 'admin' }, req: { get: () => '' },
    findSale: async () => ({ async save() {} }), writeLog: async () => {}, publishUpdate: () => {}, startSession: null,
  });
  assert.equal(row.status, 'Paid');
  assert.equal(row.remainingBalance, 0);
  assert.deepEqual(row.paymentHistory[1].proofs, finalProofs);
  assert.equal(row.proofOfPayment, finalProofs[0]);
});

test('cancellation requires a reason and 1–3 proofs, preserves payment history, and cleans rejected concurrent evidence', async () => {
  for (const count of [0, 1, 3, 4]) {
    const row = transaction();
    const result = response();
    const removed = [];
    let updated;
    await cancelCreditTransaction({ params: { id: row._id }, body: { reason: 'Customer cancelled' }, files: { proofs: files(count) }, user: { _id: 'admin' }, get: () => '' }, result, assert.fail, {
      findTransaction: async () => row, ensureOwnership: async () => {},
      persistProof: async () => proof(updated ? 2 : 0),
      removeProof: async (key) => removed.push(key),
      updateTransaction: async (query, change) => { updated = { ...row, ...change.$set }; return updated; },
      writeLog: async () => {}, publishUpdate: () => {},
    });
    assert.equal(result.statusCode, count === 0 || count === 4 ? 400 : 200);
    if (updated) {
      assert.equal(updated.cancelProofs.length, count);
      assert.deepEqual(updated.paymentHistory, row.paymentHistory);
      assert.equal(updated.amountPaid, 20);
    }
    assert.deepEqual(removed, []);
  }
  const row = transaction();
  const removed = [];
  const conflict = response();
  await cancelCreditTransaction({ params: { id: row._id }, body: { reason: 'Customer cancelled' }, files: { proofs: files(2) }, user: { _id: 'admin' }, get: () => '' }, conflict, assert.fail, {
    findTransaction: async () => row, ensureOwnership: async () => {},
    persistProof: async (_input) => proof(removed.length),
    removeProof: async (key) => removed.push(key),
    updateTransaction: async () => null,
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(removed.length, 2);
  assert.equal(row.status, 'Partially Paid');
});

test('cancellation evidence retrieval checks ownership and exact proof index', async () => {
  const row = { orderId: 'sale-proof-set', cancelProofs: [proof(0), proof(1)] };
  const denied = response();
  await getCreditCancellationProof({ params: { id: 'credit-proof-set', index: '1' }, user: { role: 'cashier' } }, denied, assert.fail, {
    findTransaction: async () => row,
    ensureOwnership: async () => { throw Object.assign(new Error('Not your credit transaction.'), { status: 403 }); },
    getProof: async () => assert.fail('storage must not be read'),
  });
  assert.equal(denied.statusCode, 403);

  const allowed = response();
  await getCreditCancellationProof({ params: { id: 'credit-proof-set', index: '1' }, user: { role: 'admin' } }, allowed, assert.fail, {
    findTransaction: async () => row, ensureOwnership: async () => {},
    getProof: async (key) => ({ type: 'r2', object: { Body: { transformToByteArray: async () => Buffer.from(key) } } }),
  });
  assert.equal(allowed.body.toString(), proof(1).storageKey);
  assert.equal(allowed.headers['Cache-Control'], 'private, no-store');
});
