const assert = require('node:assert/strict');
const test = require('node:test');

const inventoryLogs = [];
const activityLogs = [];
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: { publishInventoryUpdated: () => {} },
};

const logPath = require.resolve('../src/services/logService');
require.cache[logPath] = {
  id: logPath,
  filename: logPath,
  loaded: true,
  exports: {
    writeActivityLog: async (entry) => { activityLogs.push(entry); },
    writeInventoryLog: async (entry) => { inventoryLogs.push(entry); },
  },
};

const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const { archiveSelectedVariants, updateProduct } = require('../src/controllers/productController');

const ids = {
  family: '000000000000000000000001',
  second: '000000000000000000000002',
  third: '000000000000000000000003',
  other: '000000000000000000000004',
};

const response = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const makeFamilyHarness = (familyProducts, matchedCount = null) => {
  const originalStartSession = mongoose.startSession;
  const originalFindById = Product.findById;
  const originalFind = Product.find;
  const originalUpdateMany = Product.updateMany;
  const session = {
    ended: false,
    async withTransaction(callback) { await callback(); },
    async endSession() { this.ended = true; },
  };
  let writeFilter;
  let writeOptions;
  let updateCalls = 0;
  mongoose.startSession = async () => session;
  Product.findById = () => ({ session: async () => familyProducts[0] || null });
  Product.find = (filter = {}) => {
    if (Object.keys(filter).length === 0) {
      return { session: () => ({ lean: async () => familyProducts }) };
    }
    return { lean: async () => familyProducts
      .filter((product) => filter._id.$in.map(String).includes(String(product._id)))
      .map((product) => ({ ...product, isActive: false })) };
  };
  Product.updateMany = async (filter, _update, options) => {
    updateCalls += 1;
    writeFilter = filter;
    writeOptions = options;
    return { matchedCount: matchedCount === null ? filter._id.$in.length : matchedCount };
  };
  return {
    session,
    get writeFilter() { return writeFilter; },
    get writeOptions() { return writeOptions; },
    get updateCalls() { return updateCalls; },
    restore() {
      mongoose.startSession = originalStartSession;
      Product.findById = originalFindById;
      Product.find = originalFind;
      Product.updateMany = originalUpdateMany;
    },
  };
};

const product = (id, sku, overrides = {}) => ({
  _id: id,
  name: 'Paint',
  category: 'Paints',
  sku,
  stock: 0,
  reservedStock: 0,
  sellingUnit: 'can',
  isActive: true,
  ...overrides,
});

test('selected variant archive rejects mixed selections if any selected active SKU has stock or reservations', async () => {
  const products = [
    product(ids.family, 'PNT-1'),
    product(ids.second, 'PNT-2', { stock: 3 }),
    product(ids.third, 'PNT-3', { reservedStock: 1 }),
  ];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.family, ids.second, ids.third] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /No variants were archived/);
    assert.match(res.body.message, /PNT-2: This item still has 3 can in stock/);
    assert.match(res.body.message, /PNT-3: This item still has 0 can in stock\. 1 can remain reserved or allocated\./);
    assert.deepEqual(res.body.notArchivedSkus, ['PNT-1', 'PNT-2', 'PNT-3']);
    assert.equal(harness.updateCalls, 0);
    assert.equal(harness.session.ended, true);
  } finally {
    harness.restore();
  }
});

test('selected variant archive atomically targets only the explicitly selected eligible SKU', async () => {
  inventoryLogs.length = 0;
  activityLogs.length = 0;
  const products = [
    product(ids.family, 'PNT-1'),
    product(ids.second, 'PNT-2'),
    product(ids.third, 'PNT-3', { stock: 4 }),
  ];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.second] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.writeFilter._id.$in, [ids.second]);
    assert.deepEqual(harness.writeFilter.isActive, { $ne: false });
    assert.equal(harness.writeFilter.stock, 0);
    assert.deepEqual(harness.writeFilter.$or, [
      { reservedStock: 0 },
      { reservedStock: { $exists: false } },
    ]);
    assert.equal(harness.writeOptions.session, harness.session);
    assert.equal(res.body.products.length, 1);
    assert.deepEqual(res.body.archivedSkus, ['PNT-2']);
    assert.deepEqual(inventoryLogs.map((entry) => entry.code), ['PNT-2']);
    assert.match(activityLogs[0].details, /PNT-2/);
  } finally {
    harness.restore();
  }
});

test('selected variant archive rejects IDs from another product family without archiving any SKU', async () => {
  const products = [
    product(ids.family, 'PNT-1'),
    product(ids.other, 'BRUSH-1', { name: 'Brush', category: 'Tools' }),
  ];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.other] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /do not belong to Paint/);
    assert.deepEqual(res.body.notArchivedSkus, ['BRUSH-1']);
    assert.equal(harness.updateCalls, 0);
  } finally {
    harness.restore();
  }
});

test('selected variant archive does not group unrelated blank-name products in the same category', async () => {
  const products = [
    product(ids.family, 'TLS-1', { name: '', category: 'Tools' }),
    product(ids.second, 'TLS-2', { name: '', category: 'Tools' }),
  ];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.second] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /No variants were archived/);
    assert.deepEqual(res.body.notArchivedSkus, ['TLS-2']);
    assert.equal(harness.updateCalls, 0);
  } finally {
    harness.restore();
  }
});

test('bulk archive refuses the entire selection if a stock/reservation change races the conditional write', async () => {
  const products = [product(ids.family, 'PNT-1'), product(ids.second, 'PNT-2')];
  const harness = makeFamilyHarness(products, 1);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.family, ids.second] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /No variants were archived\. Stock, reservations, or archive status changed/);
    assert.deepEqual(res.body.notArchivedSkus, ['PNT-1', 'PNT-2']);
    assert.equal(harness.session.ended, true);
  } finally {
    harness.restore();
  }
});

test('repeating a bulk archive request is idempotent and does not create duplicate logs', async () => {
  inventoryLogs.length = 0;
  activityLogs.length = 0;
  const products = [product(ids.family, 'PNT-1', { isActive: false })];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.family] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.archivedSkus, []);
    assert.equal(harness.updateCalls, 0);
    assert.equal(inventoryLogs.length, 0);
    assert.equal(activityLogs.length, 0);
  } finally {
    harness.restore();
  }
});

test('bulk archive validates that selected IDs are present and valid', async () => {
  const originalStartSession = mongoose.startSession;
  let starts = 0;
  mongoose.startSession = async () => { starts += 1; throw new Error('should not start'); };
  try {
    const emptyResponse = response();
    await archiveSelectedVariants({ params: { id: ids.family }, body: { variantIds: [] } }, emptyResponse, assert.fail);
    assert.equal(emptyResponse.statusCode, 400);
    const invalidResponse = response();
    await archiveSelectedVariants({ params: { id: ids.family }, body: { variantIds: ['not-an-id'] } }, invalidResponse, assert.fail);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(starts, 0);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test('bulk archive fails closed for an unknown physical stock value', async () => {
  const products = [product(ids.family, 'PNT-1', { stock: undefined, reservedStock: undefined })];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.family] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /unknown stock quantity/);
    assert.deepEqual(res.body.notArchivedSkus, ['PNT-1']);
    assert.equal(harness.updateCalls, 0);
  } finally {
    harness.restore();
  }
});

test('bulk archive treats a missing legacy reservation counter according to the schema zero default', async () => {
  const products = [product(ids.family, 'PNT-1', { reservedStock: undefined })];
  const harness = makeFamilyHarness(products);
  const res = response();
  try {
    await archiveSelectedVariants({
      params: { id: ids.family },
      body: { variantIds: [ids.family] },
      user: {},
      get: () => '',
    }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.archivedSkus, ['PNT-1']);
    assert.deepEqual(harness.writeFilter.$or, [
      { reservedStock: 0 },
      { reservedStock: { $exists: false } },
    ]);
  } finally {
    harness.restore();
  }
});

test('a stock-in that races after archive preflight cannot increase an archived product', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalCategoryFindOne = require('../src/models/Category').findOne;
  let readCount = 0;
  Product.findById = async () => {
    readCount += 1;
    return readCount === 1
      ? { _id: 'stock-in-race', stock: 0, reservedStock: 0, sellingUnit: 'pcs', isActive: true }
      : { _id: 'stock-in-race', stock: 0, reservedStock: 0, sellingUnit: 'pcs', isActive: false };
  };
  Product.findOneAndUpdate = async (filter) => {
    assert.deepEqual(filter.isActive, { $ne: false });
    return null;
  };

  const res = response();
  try {
    await updateProduct({ params: { id: 'stock-in-race' }, body: { stock: 4 }, user: {} }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /no longer available/);
  } finally {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    require('../src/models/Category').findOne = originalCategoryFindOne;
  }
});

test('restoring a previously archived stocked product remains available', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  Product.findById = async () => ({
    _id: 'restore-stocked',
    stock: 6,
    reservedStock: 0,
    sellingUnit: 'pcs',
    isActive: false,
    updatedAt: null,
  });
  Product.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter.stock, 6);
    assert.equal(update.isActive, true);
    return { _id: 'restore-stocked', stock: 6, reservedStock: 0, sellingUnit: 'pcs', isActive: true };
  };
  const res = response();
  try {
    await updateProduct({ params: { id: 'restore-stocked' }, body: { isActive: true, stock: 6 }, user: {}, get: () => '' }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isActive, true);
    assert.equal(res.body.stock, 6);
  } finally {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
