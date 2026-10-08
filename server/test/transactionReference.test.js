const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Sale = require('../src/models/Sale');
const { uploadDocument, getImageType, PREFIX } = require('../src/services/transactionSupportingDocument');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath, filename: realtimeServicePath, loaded: true,
  exports: { publishSaleCreated: () => {}, publishInventoryUpdated: () => {}, publishCreditTransactionsUpdated: () => {} },
};
const { createSale, updateSaleTransactionReference, getSaleSupportingDocument, mapSaleToTransactionContract } = require('../src/controllers/saleController');
const { markCreditTransactionFullyPaid } = require('../src/controllers/creditTransactionController');

const saleId = '68a01234567890abcdef1234';
const userId = '68a01234567890abcdef5678';
const makeSale = (reference = null) => ({ _id: saleId, cashier: userId, totalAmount: 100, items: [], transactionReference: reference });
const makeResponse = () => ({
  code: 200, body: null, headers: {},
  status(code) { this.code = code; return this; },
  json(value) { this.body = value; return this; },
  set(key, value) { this.headers[key] = value; return this; },
  type(value) { this.headers['Content-Type'] = value; return this; },
  send(value) { this.body = value; return this; },
});
const request = (body = {}, file = null) => ({ params: { id: saleId }, body, file, user: { _id: userId, role: 'cashier' } });
const jpeg = { mimetype: 'image/jpeg', originalname: 'reference.jpg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0x01]) };

test('transaction reference fields are optional on existing Sales', () => {
  assert.equal(Sale.schema.path('transactionReference').options.default, null);
  assert.equal(mapSaleToTransactionContract(makeSale()).transactionReference, null);
});

test('offline Cash Sale creation rejects non-numeric references before inventory work', async () => {
  const originalStartSession = mongoose.startSession;
  let endedSessions = 0;
  mongoose.startSession = async () => ({
    withTransaction: async (operation) => operation(),
    endSession: async () => { endedSessions += 1; },
  });

  try {
    const invalidResponse = makeResponse();
    await createSale({
      body: { items: [], paymentMethod: 'cash', transactionReferenceNumber: '123-456' },
      user: { _id: userId },
    }, invalidResponse, assert.fail);
    assert.equal(invalidResponse.code, 400);
    assert.equal(invalidResponse.body.message, 'Reference No. must contain numbers only.');

    const numericResponse = makeResponse();
    await createSale({
      body: { items: [], paymentMethod: 'cash', transactionReferenceNumber: '00123456' },
      user: { _id: userId },
    }, numericResponse, assert.fail);
    assert.equal(numericResponse.code, 400);
    assert.equal(numericResponse.body.message, 'items are required.');

    const standardCashResponse = makeResponse();
    await createSale({
      body: { items: [], paymentMethod: 'cash' },
      user: { _id: userId },
    }, standardCashResponse, assert.fail);
    assert.equal(standardCashResponse.code, 400);
    assert.equal(standardCashResponse.body.message, 'items are required.');
    assert.equal(endedSessions, 3);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test('reference only updates existing Sale metadata without touching transaction fields', async () => {
  const res = makeResponse();
  let update;
  await updateSaleTransactionReference(request({ referenceNumber: '  00123456  ' }), res, assert.fail, {
    findSale: async () => makeSale(),
    updateSale: async (_query, value) => { update = value; return makeSale(value.$set.transactionReference); },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.transactionReference.referenceNumber, '00123456');
  assert.deepEqual(Object.keys(update.$set), ['transactionReference']);
});

test('blank or whitespace-only input is rejected when no reference method exists', async () => {
  for (const body of [{}, { referenceNumber: '' }, { referenceNumber: '   ' }]) {
    const res = makeResponse();
    await updateSaleTransactionReference(request(body), res, assert.fail, {
      findSale: async () => makeSale(),
    });
    assert.equal(res.code, 400);
    assert.equal(res.body.message, 'Provide a Reference No. or Supporting Document.');
  }
});

test('an existing legacy Reference No. or Supporting Document satisfies the required method rule without mutation', async () => {
  const existingReference = { referenceNumber: 'EXISTING', supportingDocument: null };
  const referenceResponse = makeResponse();
  await updateSaleTransactionReference(request({}), referenceResponse, assert.fail, {
    findSale: async () => makeSale(existingReference),
    updateSale: async (_query, update) => makeSale(update.$set.transactionReference),
  });
  assert.equal(referenceResponse.code, 200);
  assert.equal(referenceResponse.body.transactionReference.referenceNumber, 'EXISTING');

  const existingDocument = { key: 'existing.jpg', originalName: 'existing.jpg', mimeType: 'image/jpeg', size: 4 };
  const documentResponse = makeResponse();
  await updateSaleTransactionReference(request({ referenceNumber: '   ' }), documentResponse, assert.fail, {
    findSale: async () => makeSale({ referenceNumber: '', supportingDocument: existingDocument }),
    updateSale: async (_query, update) => makeSale(update.$set.transactionReference),
  });
  assert.equal(documentResponse.code, 200);
  assert.equal(documentResponse.body.transactionReference.referenceNumber, '');
  assert.equal(documentResponse.body.transactionReference.supportingDocument.originalName, 'existing.jpg');
});

test('document only uses a separate prefix and does not expose storage key in history', async () => {
  const operations = [];
  const stored = await uploadDocument(jpeg, {
    storage: { isConfigured: () => true, putObject: async (operation) => operations.push(operation) },
    allowLocal: false,
  });
  assert.match(operations[0].key, /^transaction-supporting-documents\//);
  assert.equal(PREFIX, 'transaction-supporting-documents/');
  const res = makeResponse();
  await updateSaleTransactionReference(request({}, jpeg), res, assert.fail, {
    findSale: async () => makeSale(),
    upload: async () => stored,
    updateSale: async (_query, value) => makeSale(value.$set.transactionReference),
  });
  assert.equal(res.body.transactionReference.supportingDocument.originalName, 'reference.jpg');
  assert.equal(res.body.transactionReference.supportingDocument.key, undefined);
});

test('frontend reference validation requires one method and trims reference numbers', async () => {
  const {
    getTransactionReferenceNumberError,
    hasUsableTransactionReference,
    normalizeTransactionReferenceInput,
    normalizeTransactionReferenceNumber,
  } = await import('../../src/utils/transactionReference.js');
  assert.equal(normalizeTransactionReferenceNumber('  00123456  '), '00123456');
  assert.equal(hasUsableTransactionReference({ referenceNumber: '   ' }), false);
  assert.equal(hasUsableTransactionReference({ referenceNumber: ' 123456 ' }), true);
  for (const invalid of ['ABC123', '123ABC', '123-456', '123/456', '123 456', '123.456', '@123', '123#']) {
    assert.equal(hasUsableTransactionReference({ referenceNumber: invalid }), false);
    assert.equal(hasUsableTransactionReference({ referenceNumber: invalid, documentFile: jpeg }), false);
    assert.equal(getTransactionReferenceNumberError(invalid), 'Reference No. must contain numbers only.');
  }
  assert.equal(hasUsableTransactionReference({ documentFile: jpeg }), true);
  assert.equal(hasUsableTransactionReference({ existingReference: { supportingDocument: { originalName: 'existing.jpg' } } }), true);
  assert.equal(hasUsableTransactionReference({ referenceNumber: '', documentFile: jpeg, referenceNumberOnly: true }), false);
  assert.equal(normalizeTransactionReferenceInput('12AB-34'), '1234');
  assert.equal(normalizeTransactionReferenceInput('001 234'), '001234');
  assert.equal(normalizeTransactionReferenceInput('12@#😀34'), '1234');
  assert.equal(normalizeTransactionReferenceInput(`001${'2'.repeat(100)}`).length, 80);
});

test('Credit payment references remain governed by the Credit payment domain', async () => {
  const response = makeResponse();
  const transaction = { _id: 'credit-1', orderId: 'sale-1', remainingBalance: 100, paymentHistory: [] };
  let receivedReference = '';
  await markCreditTransactionFullyPaid({
    params: { id: 'credit-1' },
    body: { clientRequestId: 'credit-payment:reference', extensionDays: 0, method: 'gcash', reference: 'GCASH-REF/123' },
    file: jpeg,
    user: { _id: userId },
    get: () => '',
  }, response, assert.fail, {
    findTransaction: async () => transaction,
    ensureOwnership: async () => {},
    claimPayment: async () => transaction,
    persistProof: async () => ({ storageKey: 'proof.jpg' }),
    applyPayment: async ({ reference }) => {
      receivedReference = reference;
      return transaction;
    },
    releasePayment: async () => {},
  });
  assert.equal(response.code, 200);
  assert.equal(receivedReference, 'GCASH-REF/123');
});

test('reference and replacement document preserve existing Sale data and remove old object after save', async () => {
  const old = { referenceNumber: 'OLD', supportingDocument: { key: 'old.jpg', originalName: 'old.jpg' } };
  const removed = [];
  const res = makeResponse();
  await updateSaleTransactionReference(request({ referenceNumber: '987654321' }, jpeg), res, assert.fail, {
    findSale: async () => makeSale(old),
    upload: async () => ({ key: 'new.jpg', originalName: 'new.jpg', mimeType: 'image/jpeg', size: 4 }),
    updateSale: async (_query, update) => makeSale(update.$set.transactionReference),
    remove: async (key) => removed.push(key),
  });
  assert.equal(res.body.transactionReference.referenceNumber, '987654321');
  assert.deepEqual(removed, ['old.jpg']);
});

test('failed metadata persistence cleans up uploaded object and does not invalidate Sale', async () => {
  const removed = [];
  const errors = [];
  await updateSaleTransactionReference(request({}, jpeg), makeResponse(), (error) => errors.push(error), {
    findSale: async () => makeSale(),
    upload: async () => ({ key: 'new.jpg' }),
    updateSale: async () => { throw new Error('metadata write failed'); },
    remove: async (key) => removed.push(key),
  });
  assert.equal(errors[0].message, 'metadata write failed');
  assert.deepEqual(removed, ['new.jpg']);
});

test('invalid image signatures, long references, and non-numeric references are rejected', async () => {
  assert.throws(() => getImageType({ ...jpeg, buffer: Buffer.from('not an image') }), { status: 400 });
  await assert.rejects(uploadDocument({ ...jpeg, buffer: Buffer.concat([jpeg.buffer, Buffer.alloc(5 * 1024 * 1024)]) }, { storage: { isConfigured: () => true } }), { status: 400 });
  const res = makeResponse();
  await updateSaleTransactionReference(request({ referenceNumber: 'X'.repeat(81) }), res, assert.fail, { findSale: async () => makeSale() });
  assert.equal(res.code, 400);
  const controlCharResponse = makeResponse();
  await updateSaleTransactionReference(request({ referenceNumber: 'line\nbreak' }), controlCharResponse, assert.fail, { findSale: async () => makeSale() });
  assert.equal(controlCharResponse.code, 400);
  assert.equal(controlCharResponse.body.message, 'Reference No. must contain numbers only.');

  for (const referenceNumber of ['ABC123', '123ABC', '123-456', '123/456', '123 456', '123.456', '@123', '123#']) {
    const invalidResponse = makeResponse();
    let uploadCalled = false;
    await updateSaleTransactionReference(request({ referenceNumber }, jpeg), invalidResponse, assert.fail, {
      findSale: async () => makeSale(),
      upload: async () => { uploadCalled = true; },
    });
    assert.equal(invalidResponse.code, 400);
    assert.equal(invalidResponse.body.message, 'Reference No. must contain numbers only.');
    assert.equal(uploadCalled, false);
  }
});

test('cashiers cannot update or retrieve another cashier’s Sale document', async () => {
  const otherSale = { ...makeSale(), cashier: '68a01234567890abcdef9999' };
  const write = makeResponse();
  await updateSaleTransactionReference(request({ referenceNumber: '123' }), write, assert.fail, { findSale: async () => otherSale });
  assert.equal(write.code, 403);
  const read = makeResponse();
  await getSaleSupportingDocument(request(), read, assert.fail, { findSale: async () => otherSale });
  assert.equal(read.code, 403);
});

test('authorized supporting document retrieval streams the private object', async () => {
  const res = makeResponse();
  await getSaleSupportingDocument(request(), res, assert.fail, {
    findSale: async () => makeSale({ supportingDocument: { key: 'new.jpg', mimeType: 'image/jpeg' } }),
    read: async () => ({ type: 'r2', object: { Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } } }),
  });
  assert.deepEqual(res.body, Buffer.from([1, 2, 3]));
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});
