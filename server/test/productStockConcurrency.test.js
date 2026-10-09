const assert = require('node:assert/strict');
const test = require('node:test');

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
  exports: { writeActivityLog: async () => {}, writeInventoryLog: async () => {} },
};

const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const { updateProduct } = require('../src/controllers/productController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('a stale absolute stock adjustment cannot overwrite a concurrent stock change', async (context) => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalCategoryFindOne = Category.findOne;
  context.after(() => {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Category.findOne = originalCategoryFindOne;
  });

  const version = new Date('2026-01-01T00:00:00.000Z');
  let readCount = 0;
  let writeFilter;
  Product.findById = async () => {
    readCount += 1;
    return readCount === 1
      ? { _id: '68a01234567890abcdef9999', stock: 10, updatedAt: version, lastStockAdjustmentRequestId: '' }
      : { _id: '68a01234567890abcdef9999', stock: 11, updatedAt: new Date('2026-01-01T00:01:00.000Z'), lastStockAdjustmentRequestId: '' };
  };
  Product.findOneAndUpdate = async (filter) => {
    writeFilter = filter;
    return null; // MongoDB predicate loses because a concurrent update already won.
  };
  Category.findOne = async () => null;

  const response = createResponse();
  await updateProduct({
    params: { id: '68a01234567890abcdef9999' },
    body: {
      stock: 12,
      expectedStock: 10,
      expectedUpdatedAt: version.toISOString(),
      adjustmentRequestId: 'stock:req-1',
    },
    user: { _id: '68a01234567890abcdef1111', name: 'Admin' },
    ip: '127.0.0.1',
    get: () => 'test-agent',
  }, response, assert.fail);

  assert.equal(writeFilter.stock, 10);
  assert.equal(writeFilter.updatedAt.getTime(), version.getTime());
  assert.deepEqual(writeFilter.lastStockAdjustmentRequestId, { $ne: 'stock:req-1' });
  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /refresh and retry/i);
});
