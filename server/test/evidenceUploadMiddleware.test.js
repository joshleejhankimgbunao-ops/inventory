const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { uploadSaleFinalization } = require('../src/middleware/saleDocumentUploadMiddleware');
const { uploadCreditPaymentProof } = require('../src/middleware/creditProofUploadMiddleware');
const { uploadSaleVoidProof } = require('../src/middleware/saleVoidProofUploadMiddleware');

const file = (type = 'image/jpeg', size = 4) => new Blob([new Uint8Array(size)], { type });
const request = async (base, route, entries) => {
  const form = new FormData();
  for (const [field, blob, name] of entries) form.append(field, blob, name);
  const response = await fetch(`${base}${route}`, { method: 'POST', body: form });
  return { status: response.status, body: await response.json() };
};

test('multipart middleware keeps invoice separate and enforces up to three payment/void evidence files', async () => {
  const app = express();
  app.post('/sale', uploadSaleFinalization, (req, res) => res.json({ invoice: Boolean(req.file), downPayment: req.downPaymentProofFiles.length }));
  app.post('/credit', uploadCreditPaymentProof, (req, res) => res.json({ count: (req.files?.proofs || []).length }));
  app.post('/void', uploadSaleVoidProof, (req, res) => res.json({ count: (req.files?.proofs || []).length }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sale = await request(base, '/sale', [
      ['document', file(), 'invoice.jpg'],
      ...Array.from({ length: 3 }, (_, index) => ['downPaymentProofs', file(), `down-${index}.jpg`]),
    ]);
    assert.deepEqual(sale, { status: 200, body: { invoice: true, downPayment: 3 } });
    const saleExcess = await request(base, '/sale', Array.from({ length: 4 }, (_, index) => ['downPaymentProofs', file(), `down-${index}.jpg`]));
    assert.equal(saleExcess.status, 400);

    const credit = await request(base, '/credit', Array.from({ length: 3 }, (_, index) => ['proofs', file(), `credit-${index}.jpg`]));
    assert.deepEqual(credit, { status: 200, body: { count: 3 } });
    const creditExcess = await request(base, '/credit', Array.from({ length: 4 }, (_, index) => ['proofs', file(), `credit-${index}.jpg`]));
    assert.equal(creditExcess.status, 400);
    const creditInvalid = await request(base, '/credit', [['proofs', file('image/webp'), 'wrong.webp']]);
    assert.equal(creditInvalid.status, 400);
    const creditLarge = await request(base, '/credit', [['proofs', file('image/jpeg', (5 * 1024 * 1024) + 1), 'large.jpg']]);
    assert.equal(creditLarge.status, 400);

    const voidFiles = await request(base, '/void', [
      ['proofs', file('image/jpeg'), 'one.jpg'],
      ['proofs', file('image/png'), 'two.png'],
      ['proofs', file('application/pdf'), 'three.pdf'],
    ]);
    assert.deepEqual(voidFiles, { status: 200, body: { count: 3 } });
    const voidExcess = await request(base, '/void', Array.from({ length: 4 }, (_, index) => ['proofs', file(), `void-${index}.jpg`]));
    assert.equal(voidExcess.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
