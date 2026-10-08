const assert = require('node:assert/strict');
const test = require('node:test');

const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: {
    publishSaleUpdated: () => {},
    publishInventoryUpdated: () => {},
    publishActivityLogged: () => {},
    publishInventoryLogged: () => {},
  },
};

const { executeSaleVoid } = require('../src/services/saleVoidService');
const { getSaleVoidProof, mapSaleToTransactionContract, voidSale } = require('../src/controllers/saleController');
const { PREFIX, uploadProof, validateProofFile } = require('../src/services/saleVoidProof');

const SALE_ID = '68a01234567890abcdef1234';
const USER_ID = '68a01234567890abcdef2222';
const PRODUCT_ID = '68a01234567890abcdef9991';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const pdf = Buffer.from('%PDF-1.7\nproof', 'ascii');

const proofFile = (buffer = jpeg, originalname = 'void-proof.jpg', mimetype = 'image/jpeg') => ({
  buffer,
  originalname,
  mimetype,
});

const storedProof = () => ({
  key: '11111111-1111-4111-8111-111111111111.jpg',
  originalName: 'void-proof.jpg',
  mimeType: 'image/jpeg',
  size: jpeg.length,
  uploadedAt: new Date('2026-10-07T00:00:00.000Z'),
});

const saleFixture = (overrides = {}) => ({
  _id: SALE_ID,
  status: 'completed',
  saleType: 'regular',
  paymentMethod: 'cash',
  paymentStatus: 'Paid',
  cashier: USER_ID,
  totalAmount: 100,
  items: [{ product: PRODUCT_ID, code: 'SKU-1', name: 'Product', quantity: 1 }],
  ...overrides,
});

const responseCapture = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
  set(name, value) { this.headers[name] = value; return this; },
  type(value) { this.headers['Content-Type'] = value; return this; },
  send(body) { this.body = body; return body; },
  sendFile(filePath) { this.body = filePath; return filePath; },
});

test('Supporting Proof validation accepts genuine JPG, PNG, and PDF signatures', () => {
  assert.equal(validateProofFile(proofFile()).mimeType, 'image/jpeg');
  assert.equal(validateProofFile(proofFile(png, 'proof.png', 'image/png')).mimeType, 'image/png');
  assert.equal(validateProofFile(proofFile(pdf, 'proof.pdf', 'application/pdf')).mimeType, 'application/pdf');
});

test('Supporting Proof validation rejects spoofed types, mismatched extensions, and oversized files', () => {
  assert.throws(() => validateProofFile(proofFile(Buffer.from('not an image'), 'proof.jpg', 'image/jpeg')), /valid JPG/i);
  assert.throws(() => validateProofFile(proofFile(pdf, 'proof.jpg', 'image/jpeg')), /valid JPG/i);
  assert.throws(() => validateProofFile(proofFile(jpeg, 'proof.png', 'image/jpeg')), /valid JPG/i);
  assert.throws(() => validateProofFile(proofFile(Buffer.alloc((5 * 1024 * 1024) + 1), 'proof.jpg', 'image/jpeg')), /5 MB/i);
});

test('Supporting Proof uploads to the private Sale Void prefix and returns metadata only', async () => {
  let put;
  const metadata = await uploadProof(proofFile(pdf, '../proof.pdf', 'application/pdf'), {
    allowLocal: false,
    storage: {
      isConfigured: () => true,
      putObject: async (payload) => { put = payload; },
    },
  });
  assert.match(put.key, new RegExp(`^${PREFIX}.+\\.pdf$`));
  assert.equal(put.contentType, 'application/pdf');
  assert.equal(metadata.originalName, 'proof.pdf');
  assert.match(metadata.key, /^[a-f0-9-]+\.pdf$/i);
  assert.equal(metadata.key.includes(PREFIX), false);
});

test('atomic Sale Void persists one proof with lifecycle, stock, and audit state', async () => {
  const proof = storedProof();
  const state = { sale: saleFixture(), stock: 4, activity: [], inventory: [] };
  const result = await executeSaleVoid({
    saleId: SALE_ID,
    reason: 'Duplicate transaction',
    requestId: 'void-proof-1',
    supportingProof: proof,
    user: { _id: USER_ID, name: 'Admin' },
  }, {
    runTransaction: async (work) => work({
      session: {},
      writeActivityLog: async (entry) => state.activity.push(entry),
      writeInventoryLog: async (entry) => state.inventory.push(entry),
      afterCommit: () => {},
    }),
    findSale: async () => state.sale,
    checkEligibility: async () => ({ eligible: true }),
    claimSale: async (_id, voidInfo) => {
      state.sale = { ...state.sale, status: 'voided', voidInfo };
      return state.sale;
    },
    restoreProduct: async () => ({ _id: PRODUCT_ID, sku: 'SKU-1', stock: ++state.stock }),
    publishSale: () => {},
    publishInventory: () => {},
  });
  assert.deepEqual(result.sale.voidInfo.supportingProof, proof);
  assert.equal(state.stock, 5);
  assert.equal(state.activity.length, 1);
  assert.match(state.activity[0].details, /Supporting proof: attached/);
  assert.doesNotMatch(state.activity[0].details, new RegExp(proof.key));
});

test('void endpoint cleans staged proof after failure and never runs the void after upload failure', async () => {
  const req = {
    user: { _id: USER_ID, role: 'admin', name: 'Admin' },
    params: { id: SALE_ID },
    body: { reason: 'Duplicate', requestId: 'void-proof-2' },
    file: proofFile(),
    get: () => 'agent',
    ip: '127.0.0.1',
  };
  const removed = [];
  const failedVoid = responseCapture();
  await voidSale(req, failedVoid, assert.fail, {
    findSale: async () => saleFixture(),
    uploadProof: async () => storedProof(),
    removeProof: async (key) => removed.push(key),
    executeSaleVoid: async () => { const error = new Error('void failed'); error.status = 409; throw error; },
  });
  assert.equal(failedVoid.statusCode, 409);
  assert.deepEqual(removed, [storedProof().key]);

  let executions = 0;
  const failedUpload = responseCapture();
  await voidSale(req, failedUpload, assert.fail, {
    findSale: async () => saleFixture(),
    uploadProof: async () => { const error = new Error('upload failed'); error.status = 503; throw error; },
    executeSaleVoid: async () => { executions += 1; },
  });
  assert.equal(failedUpload.statusCode, 503);
  assert.equal(executions, 0);
});

test('successful void keeps the proof, hides its key, and retries do not upload a second object', async () => {
  const proof = storedProof();
  const voided = saleFixture({ status: 'voided', voidInfo: {
    reason: 'Duplicate', voidedAt: new Date(), voidedBy: USER_ID, voidedByName: 'Admin',
    authorizationMethod: 'role_authorized', requestId: 'void-proof-3', supportingProof: proof,
  } });
  let uploads = 0;
  let removals = 0;
  const res = responseCapture();
  await voidSale({
    user: { _id: USER_ID, role: 'admin', name: 'Admin' }, params: { id: SALE_ID },
    body: { reason: 'Duplicate', requestId: 'void-proof-3' }, file: proofFile(), get: () => '', ip: '',
  }, res, assert.fail, {
    findSale: async () => voided,
    uploadProof: async () => { uploads += 1; return proof; },
    removeProof: async () => { removals += 1; },
    executeSaleVoid: async () => ({ sale: voided, replayed: true, restorations: [] }),
  });
  assert.equal(uploads, 0);
  assert.equal(removals, 0);
  assert.equal(res.body.sale.voidInfo.supportingProof.originalName, 'void-proof.jpg');
  assert.equal(Object.hasOwn(res.body.sale.voidInfo.supportingProof, 'key'), false);

  const mapped = mapSaleToTransactionContract(voided);
  assert.equal(Object.hasOwn(mapped.voidInfo.supportingProof, 'key'), false);
});

test('a successful first void retains its staged proof without orphan cleanup', async () => {
  const proof = storedProof();
  let removals = 0;
  const res = responseCapture();
  await voidSale({
    user: { _id: USER_ID, role: 'admin', name: 'Admin' }, params: { id: SALE_ID },
    body: { reason: 'Duplicate', requestId: 'void-proof-4' }, file: proofFile(), get: () => '', ip: '',
  }, res, assert.fail, {
    findSale: async () => saleFixture(),
    uploadProof: async () => proof,
    removeProof: async () => { removals += 1; },
    executeSaleVoid: async ({ supportingProof }) => ({
      sale: saleFixture({ status: 'voided', voidInfo: {
        reason: 'Duplicate', voidedAt: new Date(), voidedBy: USER_ID, voidedByName: 'Admin',
        authorizationMethod: 'role_authorized', requestId: 'void-proof-4', supportingProof,
      } }),
      replayed: false,
      restorations: [],
    }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(removals, 0);
  assert.equal(res.body.sale.voidInfo.supportingProof.originalName, proof.originalName);
});

test('authenticated proof retrieval enforces Sale access and streams safe content headers', async () => {
  const proof = storedProof();
  const forbidden = responseCapture();
  await getSaleVoidProof({ params: { id: SALE_ID }, user: { _id: '68a01234567890abcdef7777', role: 'cashier' } }, forbidden, assert.fail, {
    findSale: async () => saleFixture({ status: 'voided', voidInfo: { supportingProof: proof } }),
  });
  assert.equal(forbidden.statusCode, 403);

  const allowed = responseCapture();
  await getSaleVoidProof({ params: { id: SALE_ID }, user: { _id: USER_ID, role: 'cashier' } }, allowed, assert.fail, {
    findSale: async () => saleFixture({ status: 'voided', voidInfo: { supportingProof: proof } }),
    read: async () => ({ type: 'r2', object: { Body: { transformToByteArray: async () => jpeg } } }),
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['Cache-Control'], 'private, no-store');
  assert.equal(allowed.headers['Content-Type'], 'image/jpeg');
  assert.match(allowed.headers['Content-Disposition'], /^inline; filename="void-proof\.jpg"$/);
  assert.deepEqual(allowed.body, jpeg);
});
