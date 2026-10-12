const test = require('node:test');
const assert = require('node:assert/strict');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: { publishSaleCreated: () => {}, publishSaleUpdated: () => {}, publishInventoryUpdated: () => {}, publishCreditTransactionsUpdated: () => {} },
};

const {
  correctSaleTransactionReference,
  declineSaleVoidRequest,
  getPendingSaleVoidRequestCount,
  requestSaleVoid,
  updateSaleTransactionReference,
} = require('../src/controllers/saleController');
const { executeSaleVoid } = require('../src/services/saleVoidService');

const SALE_ID = '68a01234567890abcdef1234';
const USER_ID = '68a01234567890abcdef5678';
const PRODUCT_ID = '68a01234567890abcdef9999';
const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
});

test('pending void-request count is Admin-only and queries only pending request records', async () => {
  const denied = response();
  await getPendingSaleVoidRequestCount(req('cashier'), denied, assert.fail);
  assert.equal(denied.statusCode, 403);

  let capturedQuery = null;
  const allowed = response();
  await getPendingSaleVoidRequestCount(req('admin'), allowed, assert.fail, {
    countSales: async (query) => {
      capturedQuery = query;
      return 2;
    },
  });
  assert.deepEqual(capturedQuery, { 'voidRequest.status': 'pending' });
  assert.deepEqual(allowed.body, { count: 2 });
});
const sale = (overrides = {}) => ({
  _id: SALE_ID,
  status: 'completed',
  saleType: 'regular',
  paymentMethod: 'cash',
  paymentStatus: 'Paid',
  cashier: USER_ID,
  cashierName: 'Cashier User',
  totalAmount: 100,
  items: [{ product: PRODUCT_ID, name: 'Item', code: 'SKU-1', quantity: 1, unitPrice: 100, subtotal: 100 }],
  transactionReference: null,
  voidRequest: null,
  ...overrides,
});
const req = (role, body = {}, file = null) => ({
  user: { _id: USER_ID, role, name: role === 'cashier' ? 'Cashier User' : 'Admin User' },
  params: { id: SALE_ID },
  body,
  file,
  ip: '127.0.0.1',
  get: () => 'test',
});

test('Cashier initial save succeeds once and later overwrite is server-rejected', async () => {
  const initial = response();
  await updateSaleTransactionReference(req('cashier', { referenceNumber: '00123' }), initial, assert.fail, {
    findSale: async () => sale(),
    findSaleByReference: async () => null,
    updateSale: async (_query, update) => sale({ transactionReference: update.$set.transactionReference }),
  });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.body.transactionReference.referenceNumber, '00123');

  const locked = response();
  await updateSaleTransactionReference(req('cashier', { referenceNumber: '00999' }), locked, assert.fail, {
    findSale: async () => sale({ transactionReference: { referenceNumber: '00123' } }),
  });
  assert.equal(locked.statusCode, 409);
  assert.match(locked.body.message, /locked/i);
});

test('controlled correction requires Admin role, a reason, and an actual change', async () => {
  const current = sale({ transactionReference: { referenceNumber: '00123', supportingDocument: null } });
  for (const [role, body, expected] of [
    ['cashier', { referenceNumber: '00456', reason: 'Correction' }, 403],
    ['admin', { referenceNumber: '00456', reason: '' }, 400],
    ['admin', { referenceNumber: '00123', reason: 'No change' }, 400],
  ]) {
    const res = response();
    await correctSaleTransactionReference(req(role, body), res, assert.fail, { findSale: async () => current });
    assert.equal(res.statusCode, expected);
  }
});

test('Cashier Void request records requester, time, reason, and private proof metadata', async () => {
  const proof = { key: 'new-proof.jpg', originalName: 'proof.jpg', mimeType: 'image/jpeg', size: 4, uploadedAt: new Date() };
  let storedRequest;
  let publishedSale;
  const res = response();
  await requestSaleVoid(req('cashier', { reason: 'Duplicate sale' }, { buffer: Buffer.from('file') }), res, assert.fail, {
    findSale: async () => sale(),
    uploadProof: async () => proof,
    updateSale: async (_query, update) => {
      storedRequest = update.$set.voidRequest;
      return sale({ voidRequest: storedRequest });
    },
    writeActivityLog: async () => {},
    publishSale: (payload) => { publishedSale = payload; },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(storedRequest.status, 'pending');
  assert.equal(storedRequest.reason, 'Duplicate sale');
  assert.equal(storedRequest.requestedBy, USER_ID);
  assert.ok(storedRequest.requestedAt instanceof Date);
  assert.equal(res.body.voidRequest.supportingProof.key, undefined);
  assert.deepEqual(publishedSale, {
    saleId: SALE_ID,
    cashierId: USER_ID,
    changeType: 'sale.void-request.requested',
  });
});

test('Admin can decline a pending request without altering the completed Sale', async () => {
  const res = response();
  let update;
  let publishedSale;
  await declineSaleVoidRequest(req('admin'), res, assert.fail, {
    updateSale: async (_query, value) => {
      update = value;
      return sale({ voidRequest: { status: 'declined', reason: 'Duplicate', requestedBy: USER_ID, requestedByName: 'Cashier', requestedAt: new Date(), ...value.$set } });
    },
    writeActivityLog: async () => {},
    publishSale: (payload) => { publishedSale = payload; },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'completed');
  assert.equal(update.$set['voidRequest.status'], 'declined');
  assert.equal(update.$set['voidRequest.reviewedBy'], USER_ID);
  assert.deepEqual(publishedSale, {
    saleId: SALE_ID,
    cashierId: USER_ID,
    changeType: 'sale.void-request.declined',
  });
});

test('failed Void request persistence does not publish a refresh event', async () => {
  const res = response();
  let published = false;
  await requestSaleVoid(req('cashier', { reason: 'Duplicate sale' }), res, assert.fail, {
    findSale: async () => sale(),
    updateSale: async () => null,
    publishSale: () => { published = true; },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(published, false);
});

test('approved request reuses its proof, records reviewer, and restores stock exactly once', async () => {
  const requestProof = { key: 'request-proof.jpg', originalName: 'proof.jpg', mimeType: 'image/jpeg', size: 4 };
  let workingSale = sale({ voidRequest: { status: 'pending', reason: 'Duplicate', requestedBy: USER_ID, requestedByName: 'Cashier', requestedAt: new Date(), supportingProof: requestProof } });
  let stock = 5;
  let review;
  const dependencies = {
    runTransaction: async (work) => work({ session: {}, writeInventoryLog: async () => {}, writeActivityLog: async () => {}, afterCommit: () => {} }),
    findSale: async () => workingSale,
    checkEligibility: async () => ({ eligible: true, reason: '' }),
    claimSale: async (_id, voidInfo, _session, voidRequestReview) => {
      review = voidRequestReview;
      workingSale = { ...workingSale, status: 'voided', voidInfo, voidRequest: { ...workingSale.voidRequest, status: 'approved' } };
      return workingSale;
    },
    restoreProduct: async () => ({ _id: PRODUCT_ID, sku: 'SKU-1', stock: ++stock }),
  };
  const command = { saleId: SALE_ID, reason: 'Duplicate', requestId: 'void:req-1', user: { _id: USER_ID, role: 'admin', name: 'Admin User' } };
  const first = await executeSaleVoid(command, dependencies);
  const retry = await executeSaleVoid(command, dependencies);
  assert.equal(first.sale.voidInfo.supportingProof.key, 'request-proof.jpg');
  assert.equal(review.reviewedByName, 'Admin User');
  assert.equal(stock, 6);
  assert.equal(retry.replayed, true);
  assert.equal(stock, 6);
});
