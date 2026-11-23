const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getQuotationImage,
  inspectImage,
  isPublicAddress,
  resolveProductImageSourceUrl,
  snapshotProductMasterImage,
  uploadQuotationImage,
} = require('../src/services/specialOrderQuotationImage');
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

test('Product Master image selections are copied into independent R2 quotation snapshots', async () => {
  const productBytes = jpeg();
  const operations = [];
  const storage = {
    isConfigured: () => true,
    putObject: async (value) => { operations.push({ type: 'put', ...value }); },
    getObject: async (key) => {
      operations.push({ type: 'get', key });
      return { Body: productBytes };
    },
  };
  const product = {
    _id: 'product-id', sku: 'SKU-1', name: 'Paint',
    imageUrl: `data:image/jpeg;base64,${productBytes.toString('base64')}`,
  };
  const snapshot = await snapshotProductMasterImage(product, 0, { storage });

  assert.match(snapshot.key, /^[a-f0-9-]+\.jpg$/i);
  assert.equal(Object.hasOwn(snapshot, 'sourceProductId'), false);
  assert.equal(Object.hasOwn(snapshot, 'sourceUrl'), false);
  assert.equal(operations[0].key, `special-order-quotation-images/${snapshot.key}`);
  assert.deepEqual(operations[0].body, productBytes);

  product.imageUrl = '';
  const retrieved = await getQuotationImage(snapshot.key, { storage });
  assert.equal(retrieved.type, 'r2');
  assert.deepEqual(retrieved.object.Body, productBytes);
});

test('product image snapshots reject malformed data and private or non-HTTPS sources', async () => {
  const storage = { isConfigured: () => true, putObject: async () => assert.fail('must not upload invalid image') };
  await assert.rejects(() => snapshotProductMasterImage({ _id: 'p', imageUrl: 'data:image/png;base64,AA==' }, 0, { storage }), /content does not match/);
  assert.throws(() => resolveProductImageSourceUrl('http://example.com/photo.jpg'), /public HTTPS/);
  assert.throws(() => resolveProductImageSourceUrl('https://127.0.0.1/photo.jpg'), /public HTTPS hostname/);
  assert.throws(() => resolveProductImageSourceUrl('//example.com/photo.jpg'), /relative image path/);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('10.0.0.1'), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});

test('production quotation image uploads fail closed when R2 is not configured', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => snapshotProductMasterImage({
      _id: 'p', imageUrl: `data:image/jpeg;base64,${jpeg().toString('base64')}`,
    }, 0, { storage: { isConfigured: () => false } }), { code: 'R2_NOT_CONFIGURED' });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

test('legacy historical quotation image references still resolve from their original Product Master source', async () => {
  const SpecialOrder = require('../src/models/SpecialOrder');
  const SpecialOrderQuotation = require('../src/models/SpecialOrderQuotation');
  const Product = require('../src/models/Product');
  const controller = require('../src/controllers/specialOrderController');
  const productBytes = jpeg();
  const productId = '507f1f77bcf86cd799439011';
  const sourceUrl = `data:image/jpeg;base64,${productBytes.toString('base64')}`;
  const original = {
    findById: SpecialOrder.findById,
    findOne: SpecialOrderQuotation.findOne,
    productFindById: Product.findById,
  };
  const response = {
    statusCode: 200,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    type(value) { this.headers['Content-Type'] = value; return this; },
    send(value) { this.body = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    redirect(value, url) { this.statusCode = value; this.redirectUrl = url; return this; },
  };
  try {
    SpecialOrder.findById = async () => ({ createdBy: 'user-id' });
    SpecialOrderQuotation.findOne = () => ({ lean: async () => ({
      items: [{ itemId: 'item-1', images: [{
        key: `product-${productId}-0-legacy`, sourceProductId: productId,
        sourceImageIndex: 0, sourceUrl, mimeType: 'image/jpeg',
      }] }],
    }) });
    Product.findById = () => ({ lean: async () => ({ _id: productId, imageUrl: sourceUrl }) });

    await controller.getSpecialOrderQuotationImage({
      params: { id: 'order-id', quotationId: 'quote-id', itemId: 'item-1', imageKey: `product-${productId}-0-legacy` },
      user: { _id: 'admin-id', role: 'admin' },
    }, response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(response.headers['Content-Type'], 'image/jpeg');
    assert.deepEqual(response.body, productBytes);
  } finally {
    SpecialOrder.findById = original.findById;
    SpecialOrderQuotation.findOne = original.findOne;
    Product.findById = original.productFindById;
  }
});
