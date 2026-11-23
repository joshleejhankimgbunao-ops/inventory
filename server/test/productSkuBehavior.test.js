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
const Category = require('../src/models/Category');
const Sale = require('../src/models/Sale');
const {
  addProductRecommendation,
  createProduct,
  generateNextSku,
  listProducts,
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

test('Add Product distinguishes configured selling units but rejects same-unit, archived and legacy conflicts', async () => {
  const originalFind = Product.find;
  const originalFindOne = Product.findOne;
  const originalCreate = Product.create;
  const originalCategoryFindOne = Category.findOne;
  const categoryId = '507f1f77bcf86cd799439011';
  const category = {
    _id: categoryId, name: 'Fasteners', isActive: true, attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Size / Variant', key: 'size_variant', type: 'text', required: true }],
    sizeUnits: ['pcs', 'box', 'pack'],
  };
  const existing = { _id: 'existing', sku: 'OTH-012', name: 'Concrete Nails', category: 'Fasteners',
    categoryRef: categoryId, attributes: { size_variant: '4' }, sellingUnit: 'pcs', stock: 100, price: 10, isActive: true };
  let rows = [existing];
  const created = [];
  Product.find = async () => rows;
  Product.findOne = async () => null;
  Product.create = async (payload) => { created.push(payload); return { _id: `created-${created.length}`, ...payload }; };
  Category.findOne = async () => category;
  const add = async (sku, unit, size = '4') => {
    const response = makeResponse();
    await createProduct(makeRequest({ name: 'Concrete Nails', sku, category: 'Fasteners',
      attributes: { size_variant: size }, sellingUnit: unit, stock: 0, price: 25 }), response, assert.fail);
    return response;
  };
  try {
    assert.equal((await add('OTH-014', 'PCS')).statusCode, 409);
    assert.equal((await add('OTH-015', ' pack ')).statusCode, 201);
    assert.equal(created.at(-1).sellingUnit, 'pack');
    assert.equal(created.at(-1).sku, 'OTH-015');
    assert.equal(created.at(-1).stock, 0);
    assert.equal(created.at(-1).price, 25);
    assert.equal(existing.stock, 100);
    assert.equal((await add('OTH-016', 'pcs', '5')).statusCode, 201);
    assert.equal((await add('OTH-017', 'kg')).statusCode, 400);
    assert.equal(created.length, 2);

    category.sizeUnits = ['pcs'];
    assert.equal((await add('OTH-021', 'pack')).statusCode, 400);
    category.sizeUnits = ['pcs', 'box', 'pack'];

    rows = [{ ...existing, isActive: false }];
    assert.equal((await add('OTH-018', 'pcs')).statusCode, 409);
    rows = [{ ...existing, sellingUnit: '' }];
    assert.equal((await add('OTH-019', 'pack')).statusCode, 409);
    assert.equal((await add('OTH-020', 'pcs')).statusCode, 409);
    assert.equal(created.length, 2);
  } finally {
    Product.find = originalFind;
    Product.findOne = originalFindOne;
    Product.create = originalCreate;
    Category.findOne = originalCategoryFindOne;
  }
});

test('Edit Product excludes its own ID and checks changed attributes and selling unit against other SKUs', async () => {
  const originalFind = Product.find;
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalCategoryFindOne = Category.findOne;
  const originalSaleExists = Sale.exists;
  const categoryId = '507f1f77bcf86cd799439011';
  const category = {
    _id: categoryId, name: 'Fasteners', isActive: true, attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Size / Variant', key: 'size_variant', type: 'text', required: true }],
    sizeUnits: ['pcs', 'box', 'pack'],
  };
  const current = { _id: 'current', sku: 'OTH-009', name: 'Concrete Nails', category: 'Fasteners',
    categoryRef: categoryId, attributes: { size_variant: '5' }, sellingUnit: 'pack', stock: 0, price: 25, isActive: true };
  const other = { _id: 'other', sku: 'OTH-012', name: 'Concrete Nails', category: 'Fasteners',
    categoryRef: categoryId, attributes: { size_variant: '4' }, sellingUnit: 'pcs', stock: 100, price: 10, isActive: true };
  let rows = [current, other];
  let writes = 0;
  Product.findById = async () => current;
  Product.find = async (filter) => rows.filter((row) => String(row._id) !== String(filter._id?.$ne || ''));
  Product.findOneAndUpdate = async (_filter, payload) => { writes += 1; return { ...current, ...payload }; };
  Category.findOne = async () => category;
  Sale.exists = async () => false;
  const edit = async (body) => {
    const response = makeResponse();
    await updateProduct({ ...makeRequest(body), params: { id: current._id } }, response, assert.fail);
    return response;
  };
  try {
    assert.equal((await edit({ price: 30 })).statusCode, 200);
    assert.equal((await edit({ attributes: { size_variant: '4' }, sellingUnit: 'pack' })).statusCode, 200);
    assert.equal((await edit({ sellingUnit: 'pcs' })).statusCode, 200);
    assert.equal(writes, 3);

    rows = [current, { ...other, sellingUnit: 'pack' }];
    assert.equal((await edit({ attributes: { size_variant: '4' }, sellingUnit: 'pack' })).statusCode, 409);
    rows = [current, { ...other, attributes: { size_variant: '5' } }];
    assert.equal((await edit({ sellingUnit: 'pcs' })).statusCode, 409);
    assert.equal((await edit({ sellingUnit: 'kg' })).statusCode, 400);
    assert.equal(writes, 3);
  } finally {
    Product.find = originalFind;
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Category.findOne = originalCategoryFindOne;
    Sale.exists = originalSaleExists;
  }
});

const makeRequest = (body = {}) => ({
  body: { purchaseCost: 0, ...body },
  user: { _id: 'admin-1', name: 'Admin', role: 'admin' },
  ip: '127.0.0.1',
  get: () => '',
});

test('Product creation requires a separate non-negative purchase cost and preserves it independently of selling price', async () => {
  const originalFind = Product.find;
  const originalFindOne = Product.findOne;
  const originalCreate = Product.create;
  const originalCategoryFindOne = Category.findOne;
  const category = {
    _id: '507f1f77bcf86cd799439011', name: 'Fasteners', isActive: true, attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Size / Variant', key: 'size_variant', type: 'text', required: true }],
    sizeUnits: ['pcs'],
  };
  let createdPayload;
  Product.find = async () => [];
  Product.findOne = async () => null;
  Product.create = async (payload) => { createdPayload = payload; return { _id: 'created-cost', ...payload }; };
  Category.findOne = async () => category;

  try {
    const missingCost = makeResponse();
    await createProduct(makeRequest({
      name: 'Concrete Nails', sku: 'FAST-COST-1', category: 'Fasteners', attributes: { size_variant: '4' }, sellingUnit: 'pcs', stock: 0, price: 25, purchaseCost: undefined,
    }), missingCost, assert.fail);
    assert.equal(missingCost.statusCode, 400);
    assert.match(missingCost.body.message, /purchaseCost is required/i);

    const validCost = makeResponse();
    await createProduct(makeRequest({
      name: 'Concrete Nails', sku: 'FAST-COST-2', category: 'Fasteners', attributes: { size_variant: '5' }, sellingUnit: 'pcs', stock: 0, price: '25.50', purchaseCost: '12.75',
    }), validCost, assert.fail);
    assert.equal(validCost.statusCode, 201);
    assert.equal(createdPayload.price, 25.5);
    assert.equal(createdPayload.purchaseCost, 12.75);
  } finally {
    Product.find = originalFind;
    Product.findOne = originalFindOne;
    Product.create = originalCreate;
    Category.findOne = originalCategoryFindOne;
  }
});

test('Product cost remains available to product managers but is omitted from non-admin product responses', async () => {
  const originalFind = Product.find;
  const row = { _id: 'cost-visibility', sku: 'FAST-COST-3', name: 'Concrete Nails', stock: 10, reservedStock: 3, price: 25, purchaseCost: 12.75, isActive: true };
  Product.find = () => ({ sort: () => ({ lean: async () => [row] }) });

  try {
    const cashierResponse = makeResponse();
    await listProducts({ user: { role: 'cashier' } }, cashierResponse, assert.fail);
    assert.equal(cashierResponse.body[0].purchaseCost, undefined);
    assert.equal(cashierResponse.body[0].availableToSell, 7);

    const adminResponse = makeResponse();
    await listProducts({ user: { role: 'admin' } }, adminResponse, assert.fail);
    assert.equal(adminResponse.body[0].purchaseCost, 12.75);
  } finally {
    Product.find = originalFind;
  }
});

test('manual SKU is trimmed and normalized to uppercase without changing permitted business characters', () => {
  assert.equal(normalizeSku('  sup-123/blue  '), 'SUP-123/BLUE');
  assert.equal(validateSku('SUP-123/BLUE'), '');
  assert.match(validateSku(`A${String.fromCharCode(1)}B`), /control characters/i);
});

test('removing a manual recommendation preserves reviews and exclusions and rejects a no-op removal', async () => {
  const { getAlternatives } = await import('../../src/utils/recommendationLogic.js');
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalFindById = Product.findById;
  const originalExists = Product.exists;
  const request = makeRequest();
  request.params = { id: '111111111111111111111111', alternativeCode: 'alt-001' };
  const candidate = {
    id: '222222222222222222222222', code: 'ALT-001', name: 'Target Product',
    category: 'Lumbers', size: 'Standard', sellingUnit: 'pcs', stock: 10, price: 100, isActive: true,
  };

  try {
    for (const { exclusions, decision, remainsEligible } of [
      { exclusions: ['PRE-EXCLUDED'], decision: 'approved', remainsEligible: true },
      { exclusions: ['ALT-001'], decision: 'approved', remainsEligible: false },
      { exclusions: [], decision: 'rejected', remainsEligible: false },
    ]) {
      const review = { targetSku: 'TARGET-001', candidateProduct: candidate.id, candidateSku: candidate.code, decision };
      const budgetBasis = { type: 'budget', targetSku: 'TARGET-001', candidateSku: 'OTHER-001' };
      let currentTarget = {
        _id: request.params.id, id: request.params.id, sku: 'TARGET-001', code: 'TARGET-001',
        name: 'Target Product', category: 'Lumbers', size: 'Standard', sellingUnit: 'pcs',
        stock: 10, price: 100, recommendationRevision: 2,
        manualAlternatives: ['ALT-001'], manualBudgetOptions: ['OTHER-001'],
        excludedAlternatives: [...exclusions], excludedBudgetOptions: ['OTHER-EXCLUDED'],
        recommendationReviews: [review],
        recommendationBases: [
          { type: 'alternative', targetSku: 'TARGET-001', candidateProduct: candidate.id, candidateSku: candidate.code },
          budgetBasis,
        ],
      };
      Product.findById = async () => currentTarget;
      Product.findOneAndUpdate = async (filter, update) => {
        assert.equal(filter._id, request.params.id);
        assert.equal(filter.sku, 'TARGET-001');
        assert.equal(filter.manualAlternatives, 'ALT-001');
        assert.deepEqual(filter.$expr, { $eq: [{ $ifNull: ['$recommendationRevision', 0] }, 2] });
        assert.deepEqual(update.$pull, { manualAlternatives: 'ALT-001' });
        assert.equal(update.$addToSet, undefined);
        assert.equal(update.$unset, undefined);
        assert.equal(update.$inc.recommendationRevision, 1);
        assert.deepEqual(update.$set.recommendationBases, [budgetBasis]);
        currentTarget = {
          ...currentTarget,
          manualAlternatives: [],
          recommendationBases: update.$set.recommendationBases,
          recommendationRevision: 3,
        };
        return currentTarget;
      };

      const successResponse = makeResponse();
      await removeProductRecommendation(request, successResponse, assert.fail);

      assert.equal(successResponse.statusCode, 200);
      assert.deepEqual(successResponse.body.manualAlternatives, []);
      assert.deepEqual(successResponse.body.recommendationBases, [budgetBasis]);
      assert.deepEqual(successResponse.body.excludedAlternatives, exclusions);
      assert.deepEqual(successResponse.body.excludedBudgetOptions, ['OTHER-EXCLUDED']);
      assert.deepEqual(successResponse.body.recommendationReviews, [review]);
      assert.equal(getAlternatives(currentTarget, [candidate], {}).some((item) => item.code === candidate.code), remainsEligible);

      Product.findOneAndUpdate = async () => null;
      const noOpResponse = makeResponse();
      await removeProductRecommendation(request, noOpResponse, assert.fail);

      assert.equal(noOpResponse.statusCode, 409);
      assert.match(noOpResponse.body.message, /already removed|no longer available/i);
    }
  } finally {
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Product.findById = originalFindById;
    Product.exists = originalExists;
  }
});

test('adding a recommendation persists an exact active SKU relationship without changing the product', async () => {
  const originalFindById = Product.findById;
  const originalFindOne = Product.findOne;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const request = makeRequest({ type: 'budget', recommendationId: '222222222222222222222222', recommendationCode: 'alt-001' });
  request.params = { id: '111111111111111111111111' };
  const target = { _id: '111111111111111111111111', sku: 'TARGET-001', name: 'Target', manualBudgetOptions: [], excludedBudgetOptions: [] };
  const candidate = { _id: '222222222222222222222222', sku: 'ALT-001', name: 'Alternative', isActive: true };

  try {
    Product.findById = async () => target;
    Product.findOne = async (filter) => {
      assert.equal(filter._id, '222222222222222222222222');
      assert.equal(filter.sku, 'ALT-001');
      assert.deepEqual(filter.isActive, { $ne: false });
      assert.deepEqual(filter.stock, { $gt: 0 });
      return candidate;
    };
    Product.findOneAndUpdate = async (filter, update) => {
      assert.deepEqual(filter.manualBudgetOptions, { $ne: 'ALT-001' });
      assert.equal(update.$addToSet.manualBudgetOptions, 'ALT-001');
      assert.equal(update.$pull.excludedBudgetOptions, 'ALT-001');
      target.manualBudgetOptions = ['ALT-001'];
      assert.equal(update.$set.recommendationBases[0].candidateProduct, candidate._id);
      return target;
    };

    const response = makeResponse();
    await addProductRecommendation(request, response, assert.fail);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.manualBudgetOptions, ['ALT-001']);
  } finally {
    Product.findById = originalFindById;
    Product.findOne = originalFindOne;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
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
  const originalFind = Product.find;
  const originalCreate = Product.create;
  const originalCategoryFindOne = Category.findOne;
  let createdPayload = null;

  Product.findOne = async () => null;
  Product.find = async () => [];
  Category.findOne = async () => ({
    _id: '507f1f77bcf86cd799439011',
    name: 'Paints',
    isActive: true,
    sizeUnits: ['pcs'],
  });
  Product.create = async (payload) => {
    createdPayload = payload;
    return { _id: 'product-manual', ...payload };
  };

  try {
    const req = makeRequest({ name: 'Manual SKU Product', sku: '  sup-12345 ', category: 'Paints', stock: 0, price: 100, sellingUnit: 'pcs' });
    const res = makeResponse();
    await createProduct(req, res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(createdPayload.sku, 'SUP-12345');
    assert.equal(createdPayload.sellingUnit, 'pcs');
    assert.equal(res.body.sku, 'SUP-12345');
  } finally {
    Product.findOne = originalFindOne;
    Product.find = originalFind;
    Product.create = originalCreate;
    Category.findOne = originalCategoryFindOne;
  }
});

test('product creation requires and persists a category-configured selling unit', async () => {
  const originalFindOne = Product.findOne;
  const originalFind = Product.find;
  const originalCreate = Product.create;
  const originalCategoryFindOne = Category.findOne;
  let createdPayload = null;

  Product.findOne = async () => null;
  Product.find = async () => [];
  Category.findOne = async () => ({
    _id: '507f1f77bcf86cd799439011',
    name: 'Fasteners',
    isActive: true,
    sizeUnits: ['pcs', 'box', 'pack'],
  });
  Product.create = async (payload) => {
    createdPayload = payload;
    return { _id: 'product-selling-unit', ...payload };
  };

  try {
    const validResponse = makeResponse();
    await createProduct(makeRequest({
      name: 'Concrete Nails', sku: 'FAST-001', category: 'Fasteners', stock: 20, price: 150, sellingUnit: 'PACK',
    }), validResponse, assert.fail);
    assert.equal(validResponse.statusCode, 201);
    assert.equal(createdPayload.sellingUnit, 'pack');

    const missingResponse = makeResponse();
    await createProduct(makeRequest({
      name: 'Concrete Nails', sku: 'FAST-002', category: 'Fasteners', stock: 20, price: 150,
    }), missingResponse, assert.fail);
    assert.equal(missingResponse.statusCode, 400);
    assert.match(missingResponse.body.message, /select a selling unit/i);

    const invalidResponse = makeResponse();
    await createProduct(makeRequest({
      name: 'Concrete Nails', sku: 'FAST-003', category: 'Fasteners', stock: 20, price: 150, sellingUnit: 'kg',
    }), invalidResponse, assert.fail);
    assert.equal(invalidResponse.statusCode, 400);
    assert.match(invalidResponse.body.message, /not configured/i);
  } finally {
    Product.findOne = originalFindOne;
    Product.find = originalFind;
    Product.create = originalCreate;
    Category.findOne = originalCategoryFindOne;
  }
});

test('product creation rejects a category with no configured selling units', async () => {
  const originalCategoryFindOne = Category.findOne;
  Category.findOne = async () => ({
    _id: '507f1f77bcf86cd799439011',
    name: 'Unconfigured Category',
    isActive: true,
    sizeUnits: [],
  });

  try {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'Legacy-style Product', sku: 'UNC-001', category: 'Unconfigured Category', stock: 0, price: 100,
    }), response, assert.fail);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /no selling units are configured/i);
  } finally {
    Category.findOne = originalCategoryFindOne;
  }
});

test('blank SKU product creation retries after a unique-index collision', async () => {
  const originalFind = Product.find;
  const originalCreate = Product.create;
  const originalCategoryFindOne = Category.findOne;
  const existingSkus = ['PNT-001'];
  let createAttempts = 0;

  Product.find = (filter) => {
    if (filter?.sku instanceof RegExp) {
      return {
        select: () => ({
          lean: async () => existingSkus.map((sku) => ({ sku })),
        }),
      };
    }
    return Promise.resolve([]);
  };
  Category.findOne = async () => ({
    _id: '507f1f77bcf86cd799439011',
    name: 'Paints',
    isActive: true,
    sizeUnits: ['pcs'],
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
    const req = makeRequest({ name: 'Latex Paint', sku: '   ', category: 'Paints', stock: 0, price: 100, sellingUnit: 'pcs' });
    const res = makeResponse();
    await createProduct(req, res, assert.fail);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.sku, 'PNT-003');
    assert.equal(createAttempts, 2);
  } finally {
    Product.find = originalFind;
    Product.create = originalCreate;
    Category.findOne = originalCategoryFindOne;
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
