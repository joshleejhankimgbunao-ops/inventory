const test = require('node:test');
const assert = require('node:assert/strict');

const logServicePath = require.resolve('../src/services/logService');
require.cache[logServicePath] = {
  id: logServicePath,
  filename: logServicePath,
  loaded: true,
  exports: {
    writeActivityLog: async () => {},
    writeInventoryLog: async () => {},
  },
};

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: {
    publishInventoryUpdated: () => {},
  },
};

const Product = require('../src/models/Product');
const {
  createProduct,
  generateNextSku,
  normalizeSku,
  removeProductRecommendation,
  updateProduct,
  validateSku,
} = require('../src/controllers/productController');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const makeRequest = (body = {}) => ({
  body,
  user: { _id: 'admin-1', name: 'Admin' },
  ip: '127.0.0.1',
  get: () => '',
});

test('manual SKU is trimmed and normalized to uppercase without changing permitted business characters', () => {
  assert.equal(normalizeSku('  sup-123/blue  '), 'SUP-123/BLUE');
  assert.equal(validateSku('SUP-123/BLUE'), '');
  assert.match(validateSku(`A${String.fromCharCode(1)}B`), /control characters/i);
});

test('removing a recommendation persists the exclusion and rejects a no-op removal', async () => {
  const originalUpdateOne = Product.updateOne;
  const originalFindById = Product.findById;
  const originalExists = Product.exists;
  const request = makeRequest();
  request.params = { id: 'product-1', alternativeCode: 'alt-001' };
  const updatedProduct = {
    _id: 'product-1',
    sku: 'TARGET-001',
    name: 'Target Product',
    manualAlternatives: [],
    excludedAlternatives: ['ALT-001'],
  };

  try {
    Product.updateOne = async (filter, update) => {
      assert.equal(filter._id, 'product-1');
      assert.equal(filter.$or[0].manualAlternatives, 'ALT-001');
      assert.equal(update.$addToSet.excludedAlternatives, 'ALT-001');
      assert.equal(update.$pull.manualAlternatives, 'ALT-001');
      return { matchedCount: 1, modifiedCount: 1 };
    };
    Product.findById = async () => updatedProduct;
    Product.exists = async () => ({ _id: 'product-1' });

    const successResponse = makeResponse();
    await removeProductRecommendation(request, successResponse, assert.fail);

    assert.equal(successResponse.statusCode, 200);
    assert.deepEqual(successResponse.body.excludedAlternatives, ['ALT-001']);

    Product.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });
    const noOpResponse = makeResponse();
    await removeProductRecommendation(request, noOpResponse, assert.fail);

    assert.equal(noOpResponse.statusCode, 409);
    assert.match(noOpResponse.body.message, /already removed|no longer available/i);
  } finally {
    Product.updateOne = originalUpdateOne;
    Product.findById = originalFindById;
    Product.exists = originalExists;
  }
});

test('blank SKU generation preserves the existing category prefix and first available sequence', async () => {
  const originalFind = Product.find;
  Product.find = () => ({
    select: () => ({
      lean: async () => [{ sku: 'PNT-001' }, { sku: 'PNT-003' }, { sku: 'OTHER-001' }],
    }),
  });

  try {
    assert.equal(await generateNextSku('Paints'), 'PNT-002');
    assert.equal(await generateNextSku('A custom category'), 'OTH-001');
  } finally {
    Product.find = originalFind;
  }
});

test('manual SKU creation saves the supplied normalized SKU instead of generating another one', async () => {
  const originalFindOne = Product.findOne;
  const originalCreate = Product.create;
  let createdPayload = null;

  Product.findOne = async () => null;
  Product.create = async (payload) => {
    createdPayload = payload;
    return { _id: 'product-manual', ...payload };
  };

  try {
    const req = makeRequest({ name: 'Manual SKU Product', sku: '  sup-12345 ', category: 'Paints', stock: 0, price: 100 });
    const res = makeResponse();
    await createProduct(req, res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(createdPayload.sku, 'SUP-12345');
    assert.equal(res.body.sku, 'SUP-12345');
  } finally {
    Product.findOne = originalFindOne;
    Product.create = originalCreate;
  }
});

test('blank SKU product creation retries after a unique-index collision', async () => {
  const originalFind = Product.find;
  const originalCreate = Product.create;
  const existingSkus = ['PNT-001'];
  let createAttempts = 0;

  Product.find = () => ({
    select: () => ({
      lean: async () => existingSkus.map((sku) => ({ sku })),
    }),
  });
  Product.create = async (payload) => {
    createAttempts += 1;
    if (createAttempts === 1) {
      existingSkus.push(payload.sku);
      const collision = new Error('duplicate key');
      collision.code = 11000;
      throw collision;
    }
    return { _id: 'product-1', ...payload };
  };

  try {
    const req = makeRequest({ name: 'Latex Paint', sku: '   ', category: 'Paints', stock: 0, price: 100 });
    const res = makeResponse();
    await createProduct(req, res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.sku, 'PNT-003');
    assert.equal(createAttempts, 2);
  } finally {
    Product.find = originalFind;
    Product.create = originalCreate;
  }
});

test('editing to another product SKU is rejected before update', async () => {
  const originalFindById = Product.findById;
  const originalFindOne = Product.findOne;

  Product.findById = async () => ({ _id: 'product-1', sku: 'PNT-001', stock: 5, updatedAt: null });
  Product.findOne = async () => ({ _id: 'product-2', sku: 'PNT-002' });

  try {
    const req = makeRequest({ sku: 'pnt-002' });
    req.params = { id: 'product-1' };
    const res = makeResponse();
    await updateProduct(req, res, assert.fail);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, 'SKU already exists.');
  } finally {
    Product.findById = originalFindById;
    Product.findOne = originalFindOne;
  }
});
