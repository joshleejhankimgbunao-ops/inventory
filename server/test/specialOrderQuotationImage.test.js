const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectImage, uploadQuotationImage } = require('../src/services/specialOrderQuotationImage');
const { createSpecialOrderQuotationDocument } = require('../src/services/specialOrderQuotationDocument');

const file = (buffer, mimetype = 'image/jpeg') => ({ buffer, mimetype, originalname: 'photo.jpg' });
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = () => Buffer.from('RIFFxxxxWEBP');

test('quotation image storage accepts authentic JPG, PNG, and WebP files, never the supplied MIME type alone', async () => {
  assert.equal(inspectImage(file(jpeg())).mimeType, 'image/jpeg');
  assert.equal(inspectImage(file(png(), 'image/png')).mimeType, 'image/png');
  assert.equal(inspectImage(file(webp(), 'image/webp')).mimeType, 'image/webp');
  assert.throws(() => inspectImage(file(Buffer.from('not an image'), 'image/png')), /valid JPG, PNG, or WebP/);
  const written = [];
  const image = await uploadQuotationImage(file(webp(), 'image/webp'), { storage: { isConfigured: () => true, putObject: async (value) => written.push(value) } });
  assert.equal(image.mimeType, 'image/webp');
  assert.equal(written.length, 1);
  await assert.rejects(() => uploadQuotationImage(file(Buffer.concat([jpeg(), Buffer.alloc((5 * 1024 * 1024) + 1)])), { storage: { isConfigured: () => true } }), /5 MB or smaller/);
});

test('issued quotation snapshots retain per-item ordered image metadata without image bytes', () => {
  const snapshot = createSpecialOrderQuotationDocument({
    order: { orderNumber: 'SO-1' },
    quotation: { quotationNumber: 'PQ-1', version: 1, customerName: 'Customer', customer: null, customerDetails: {}, quotationDetails: { authorizedSignatoryName: 'Signer' }, subtotal: 100, total: 100, items: [{ itemId: 'item-1', itemName: 'Item', description: '', sellingUnit: 'pcs', quantity: 1, unitPrice: 100, lineAmount: 100, images: [{ key: 'a.jpg', originalName: 'a.jpg', mimeType: 'image/jpeg', size: 10, uploadedAt: new Date() }, { key: 'b.png', originalName: 'b.png', mimeType: 'image/png', size: 11, uploadedAt: new Date() }] }] },
    settings: { storeName: 'Store' }, issuedAt: new Date(),
  });
  assert.deepEqual(snapshot.items[0].images.map((image) => image.key), ['a.jpg', 'b.png']);
  assert.equal(Object.hasOwn(snapshot.items[0].images[0], 'buffer'), false);
});
