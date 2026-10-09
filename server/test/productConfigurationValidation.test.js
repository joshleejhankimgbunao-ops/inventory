const test = require('node:test');
const assert = require('node:assert/strict');

const logServicePath = require.resolve('../src/services/logService');
require.cache[logServicePath] = {
  id: logServicePath,
  filename: logServicePath,
  loaded: true,
  exports: { writeActivityLog: async () => {}, writeInventoryLog: async () => {} },
};

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: { publishInventoryUpdated: () => {} },
};

const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const {
  DUPLICATE_CONFIGURATION_MESSAGE,
  createProduct,
  updateProduct,
} = require('../src/controllers/productController');

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

const makeRequest = (body = {}, id = '') => ({
  body,
  params: id ? { id } : {},
  user: { _id: 'admin-1', name: 'Admin' },
  ip: '127.0.0.1',
  get: () => '',
});

const makeProduct = (overrides = {}) => ({
  _id: overrides._id || 'existing-1',
  sku: overrides.sku || 'TST-ELC-001',
  name: overrides.name || 'THHN Wire',
  category: overrides.category || 'Electrical',
  brand: overrides.brand || '',
  color: overrides.color || '',
  size: overrides.size || '3.5mm',
  attributes: overrides.attributes || {},
  stock: overrides.stock ?? 5,
  price: overrides.price ?? 89,
  supplierName: overrides.supplierName || 'Supplier',
  imageUrl: overrides.imageUrl || '',
  updatedAt: overrides.updatedAt || null,
  isActive: overrides.isActive ?? true,
});

const withProductStubs = async ({ category, products = [], existing = null, action }) => {
  const originalCategoryFindOne = Category.findOne;
  const originalProductFind = Product.find;
  const originalProductFindOne = Product.findOne;
  const originalProductFindById = Product.findById;
  const originalProductCreate = Product.create;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;

  try {
    Category.findOne = async () => category;
    Product.find = async () => products;
    Product.findOne = async () => null;
    Product.findById = async () => existing;
    Product.create = async (payload) => ({ _id: 'created-1', ...payload });
    Product.findOneAndUpdate = async (_filter, payload) => ({ ...existing, ...payload, _id: existing?._id || 'existing-1' });
    await action();
  } finally {
    Category.findOne = originalCategoryFindOne;
    Product.find = originalProductFind;
    Product.findOne = originalProductFindOne;
    Product.findById = originalProductFindById;
    Product.create = originalProductCreate;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
  }
};

test('create rejects same configured attributes even when price and SKU differ', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ sku: 'TST-ELC-001', price: 89, size: '3.5mm' });

  await withProductStubs({ category, products: [existing], action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({ name: ' thhn wire ', sku: 'TST-ELC-002', category: 'Electrical', size: '3.5mm', price: 120 }), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, DUPLICATE_CONFIGURATION_MESSAGE);
  }});
});

test('create rejects the same configuration when only the SKU differs', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ sku: 'TST-ELC-001', price: 89, size: '3.5mm' });

  await withProductStubs({ category, products: [existing], action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'THHN Wire',
      sku: 'TST-ELC-002',
      category: 'Electrical',
      size: '3.5mm',
      price: 89,
    }), response, assert.fail);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, DUPLICATE_CONFIGURATION_MESSAGE);
  }});
});

test('create allows a meaningful configured Size difference', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ size: '2.0mm' });

  await withProductStubs({ category, products: [existing], action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({ name: 'THHN Wire', sku: 'TST-ELC-002', category: 'Electrical', size: '3.5mm', price: 89 }), response, assert.fail);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.sku, 'TST-ELC-002');
  }});
});

test('create allows different configured Brand values', async () => {
  const category = {
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Size / Variant', key: 'size', type: 'text', order: 0 },
      { name: 'Brand', key: 'brand', type: 'text', order: 1 },
    ],
  };
  const existing = makeProduct({ brand: 'MetroWire', attributes: { size: '3.5mm', brand: 'MetroWire' } });

  await withProductStubs({ category, products: [existing], action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'THHN Wire', sku: 'TST-ELC-002', category: 'Electrical', price: 89,
      attributes: { size: '3.5mm', brand: 'Philflex' },
    }), response, assert.fail);
    assert.equal(response.statusCode, 201);
  }});
});

test('legacy schema keeps configured legacy Brand as a meaningful distinction', async () => {
  const category = { showSize: true, showBrand: true, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ brand: 'MetroWire', size: '3.5mm' });

  await withProductStubs({ category, products: [existing], action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'THHN Wire',
      sku: 'TST-ELC-002',
      category: 'Electrical',
      brand: 'Philflex',
      size: '3.5mm',
      price: 89,
    }), response, assert.fail);

    assert.equal(response.statusCode, 201);
  }});
});

test('schema v1 rejects a duplicate despite stale legacy Brand, Color, and Size differences', async () => {
  const category = {
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Model', key: 'model', type: 'text', order: 0 }],
  };
  const existing = makeProduct({
    brand: 'MetroWire', color: 'Black', size: '3.5mm', attributes: { model: 'THHN-35' },
  });

  await withProductStubs({ category, products: [existing], action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'THHN Wire', sku: 'TST-ELC-002', category: 'Electrical', brand: 'Old Brand', color: 'Red', size: '2.0mm', price: 120,
      attributes: { model: 'thhn-35' },
    }), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, DUPLICATE_CONFIGURATION_MESSAGE);
  }});
});

test('unchanged, price-only, stock-only, and supplier-only edits remain allowed', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct();
  const grandfatheredDuplicate = makeProduct({
    _id: 'existing-2',
    sku: 'TST-ELC-002',
    price: 120,
  });
  const changes = [{}, { price: 120 }, { stock: 7 }, { supplierName: 'New Supplier' }];

  for (const change of changes) {
    await withProductStubs({ category, existing, products: [grandfatheredDuplicate], action: async () => {
      const response = makeResponse();
      await updateProduct(makeRequest(change, existing._id), response, assert.fail);
      assert.equal(response.statusCode, 200);
    }});
  }
});

test('schema v1 maintenance edits preserve stale legacy values without making them authoritative', async () => {
  const category = {
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Model', key: 'model', type: 'text', order: 0 }],
  };
  const existing = makeProduct({
    brand: 'MetroWire',
    color: 'Black',
    size: '3.5mm',
    attributes: { model: 'THHN-35' },
  });

  await withProductStubs({ category, existing, products: [], action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({
      price: 120,
      brand: '',
      color: '',
      size: '',
      attributes: { model: 'THHN-35' },
    }, existing._id), response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.brand, 'MetroWire');
    assert.equal(response.body.color, 'Black');
    assert.equal(response.body.size, '3.5mm');
    assert.deepEqual(response.body.attributes, { model: 'THHN-35' });
  }});
});

test('editing into another existing configured product is rejected', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ _id: 'one', size: '2.0mm' });
  const other = makeProduct({ _id: 'two', sku: 'TST-ELC-002', size: '3.5mm' });

  await withProductStubs({ category, existing, products: [other], action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ size: '3.5mm' }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, DUPLICATE_CONFIGURATION_MESSAGE);
  }});
});
