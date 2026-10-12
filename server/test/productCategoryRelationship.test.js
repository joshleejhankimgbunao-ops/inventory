const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

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
const Partner = require('../src/models/Partner');
const Setting = require('../src/models/Setting');
const { createProduct, updateProduct } = require('../src/controllers/productController');
const { deleteCategory, updateCategory } = require('../src/controllers/categoryController');
const { resolveProductCategory } = require('../src/utils/categoryResolution');
const {
  propagateCategoryRename,
  renameStockRuleCategoryKey,
} = require('../src/services/categoryAssociationService');

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

test('Product categoryRef is an optional indexed Category ObjectId reference', () => {
  const path = Product.schema.path('categoryRef');
  assert.equal(path.instance, 'ObjectId');
  assert.equal(path.options.ref, 'Category');
  assert.equal(path.options.index, true);
  assert.equal(path.options.required, undefined);

  const legacyProduct = new Product({ sku: 'LEG-001', name: 'Legacy', category: 'Legacy Category', price: 1 });
  assert.equal(legacyProduct.validateSync(), undefined);
  assert.equal(legacyProduct.categoryRef, null);
});

test('legacy resolution falls back to normalized case-insensitive exact category name', async () => {
  let receivedFilter;
  const expected = { _id: new mongoose.Types.ObjectId(), name: 'Electrical & Lighting' };
  const CategoryModel = {
    findOne: async (filter) => { receivedFilter = filter; return expected; },
  };

  const resolved = await resolveProductCategory({ category: '  electrical   & lighting  ' }, { CategoryModel });
  assert.equal(resolved, expected);
  assert.equal(receivedFilter.name.$options, 'i');
  assert.equal(receivedFilter.name.$regex, '^Electrical & Lighting$');
});

test('categoryRef is preferred over the legacy category snapshot', async () => {
  const categoryId = new mongoose.Types.ObjectId();
  let receivedFilter;
  const CategoryModel = {
    findOne: async (filter) => { receivedFilter = filter; return { _id: categoryId, name: 'Canonical' }; },
  };
  const resolved = await resolveProductCategory({ categoryRef: categoryId, category: 'Stale' }, { CategoryModel });
  assert.equal(resolved.name, 'Canonical');
  assert.equal(String(receivedFilter._id), String(categoryId));
});

test('new Product creation saves categoryRef and the canonical active category name', async () => {
  const categoryId = new mongoose.Types.ObjectId();
  const originals = {
    categoryFindOne: Category.findOne,
    productFindOne: Product.findOne,
    productFind: Product.find,
    productCreate: Product.create,
  };
  let created;
  try {
    Category.findOne = async () => ({ _id: categoryId, name: 'Electrical & Lighting', isActive: true, sizeUnits: ['pcs'] });
    Product.findOne = async () => null;
    Product.find = async () => [];
    Product.create = async (payload) => { created = payload; return { _id: 'created', ...payload }; };
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'Wire', sku: 'ELC-100', category: ' electrical & lighting ', stock: 0, price: 10, sellingUnit: 'pcs',
    }), response, assert.fail);

    assert.equal(response.statusCode, 201);
    assert.equal(created.category, 'Electrical & Lighting');
    assert.equal(String(created.categoryRef), String(categoryId));
  } finally {
    Category.findOne = originals.categoryFindOne;
    Product.findOne = originals.productFindOne;
    Product.find = originals.productFind;
    Product.create = originals.productCreate;
  }
});

test('new Product creation rejects a missing or inactive category', async () => {
  const originals = { categoryFindOne: Category.findOne, productFindOne: Product.findOne };
  try {
    Product.findOne = async () => null;
    Category.findOne = async () => null;
    for (const category of ['Missing', 'Inactive']) {
      const response = makeResponse();
      await createProduct(makeRequest({ name: 'Wire', sku: `ELC-${category}`, category, price: 10 }), response, assert.fail);
      assert.equal(response.statusCode, 400);
      assert.match(response.body.message, /category is unavailable/i);
    }
  } finally {
    Category.findOne = originals.categoryFindOne;
    Product.findOne = originals.productFindOne;
  }
});

test('category change saves both target identity fields while preserving attribute validation', async () => {
  const oldCategoryId = new mongoose.Types.ObjectId();
  const targetCategoryId = new mongoose.Types.ObjectId();
  const existing = {
    _id: 'product-1', sku: 'WIRE-001', name: 'Wire', category: 'Old', categoryRef: oldCategoryId,
    attributes: { size: '1mm' }, brand: '', color: '', size: '1mm', stock: 2, price: 10,
    supplierName: '', imageUrl: '', isActive: true, updatedAt: null,
  };
  const originals = {
    categoryFindOne: Category.findOne,
    productFindById: Product.findById,
    productFind: Product.find,
    productFindOneAndUpdate: Product.findOneAndUpdate,
  };
  let updatePayload;
  try {
    Category.findOne = async () => ({
      _id: targetCategoryId,
      name: 'New Category',
      isActive: true,
      attributeSchemaVersion: 1,
      productAttributes: [{ name: 'Grit', key: 'grit', type: 'number', required: true, order: 0 }],
    });
    Product.findById = async () => existing;
    Product.find = async () => [];
    Product.findOneAndUpdate = async (_filter, payload) => {
      updatePayload = payload;
      return { ...existing, ...payload };
    };
    const response = makeResponse();
    await updateProduct(makeRequest({ category: 'new category', attributes: { grit: 80 } }, existing._id), response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.equal(updatePayload.category, 'New Category');
    assert.equal(String(updatePayload.categoryRef), String(targetCategoryId));
    assert.deepEqual(updatePayload.attributes, { grit: 80 });
  } finally {
    Category.findOne = originals.categoryFindOne;
    Product.findById = originals.productFindById;
    Product.find = originals.productFind;
    Product.findOneAndUpdate = originals.productFindOneAndUpdate;
  }
});

test('legacy Product with no resolvable Category fails safely when attributes require Category rules', async () => {
  const existing = {
    _id: 'legacy-product', sku: 'LEG-001', name: 'Legacy', category: 'Missing Category',
    attributes: {}, brand: '', color: '', size: '', stock: 1, price: 1,
    supplierName: '', imageUrl: '', isActive: true, updatedAt: null,
  };
  const originals = { categoryFindOne: Category.findOne, productFindById: Product.findById };
  try {
    Category.findOne = async () => null;
    Product.findById = async () => existing;
    const response = makeResponse();
    await updateProduct(makeRequest({ attributes: {} }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /could not be resolved/i);
  } finally {
    Category.findOne = originals.categoryFindOne;
    Product.findById = originals.productFindById;
  }
});

test('category rename propagation updates current snapshots but never rewrites categoryRef', async () => {
  const categoryId = new mongoose.Types.ObjectId();
  let productUpdate;
  let partnerUpdate;
  const settings = {
    stockRules: { categories: new Map([['Old Name', 12], ['Other', 4]]) },
    markModified: () => {},
    save: async () => {},
  };
  const result = await propagateCategoryRename({
    categoryId,
    previousName: 'Old Name',
    nextName: 'New Name',
    ProductModel: { updateMany: async (...args) => { productUpdate = args; return { modifiedCount: 2 }; } },
    PartnerModel: { updateMany: async (...args) => { partnerUpdate = args; return { modifiedCount: 1 }; } },
    SettingModel: { findOne: async () => settings },
  });

  assert.equal(String(productUpdate[0].categoryRef), String(categoryId));
  assert.deepEqual(productUpdate[1], { $set: { category: 'New Name' } });
  assert.equal(productUpdate[1].$set.categoryRef, undefined);
  assert.equal(partnerUpdate[1].$set['supplierCapabilities.$[capability].category'], 'New Name');
  assert.equal(settings.stockRules.categories.has('Old Name'), false);
  assert.equal(settings.stockRules.categories.get('New Name'), 12);
  assert.deepEqual(result, { productsUpdated: 2, partnersUpdated: 1, settingsUpdated: true });
});

test('stock-rule key rename preserves an existing target rule instead of overwriting it', () => {
  const settings = {
    stockRules: { categories: new Map([['Old Name', 12], ['New Name', 7]]) },
    markModified: () => {},
  };
  assert.equal(renameStockRuleCategoryKey(settings, 'Old Name', 'New Name'), true);
  assert.equal(settings.stockRules.categories.has('Old Name'), false);
  assert.equal(settings.stockRules.categories.get('New Name'), 7);
});

test('hard delete is blocked when linked or legacy Products still reference a Category', async () => {
  const originals = { categoryFindById: Category.findById, productExists: Product.exists };
  let deleted = false;
  try {
    Category.findById = async () => ({
      _id: new mongoose.Types.ObjectId(),
      name: 'Electrical',
      deleteOne: async () => { deleted = true; },
    });
    Product.exists = async () => ({ _id: 'product-1' });
    const response = makeResponse();
    await deleteCategory({ params: { id: 'category-1' } }, response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /archive it instead/i);
    assert.equal(deleted, false);
  } finally {
    Category.findById = originals.categoryFindById;
    Product.exists = originals.productExists;
  }
});

test('Category rename runs association propagation in one transaction', async () => {
  const categoryId = new mongoose.Types.ObjectId();
  const category = {
    _id: categoryId,
    name: 'Old Name',
    isActive: true,
    save: async () => category,
    toObject: () => ({ _id: categoryId, name: category.name, isActive: category.isActive }),
  };
  const originals = {
    startSession: mongoose.startSession,
    categoryFindById: Category.findById,
    categoryFindOne: Category.findOne,
    productUpdateMany: Product.updateMany,
    partnerUpdateMany: Partner.updateMany,
    settingFindOne: Setting.findOne,
  };
  let transactionCalls = 0;
  let updatedProductName;
  try {
    mongoose.startSession = async () => ({
      withTransaction: async (work) => { transactionCalls += 1; await work(); },
      endSession: async () => {},
    });
    Category.findById = async () => category;
    Category.findOne = async () => null;
    Product.updateMany = async (_filter, update) => {
      updatedProductName = update.$set.category;
      return { modifiedCount: 1 };
    };
    Partner.updateMany = async () => ({ modifiedCount: 0 });
    Setting.findOne = async () => null;

    const response = makeResponse();
    await updateCategory(makeRequest({ name: 'New Name' }, String(categoryId)), response, assert.fail);
    assert.equal(response.statusCode, 200);
    assert.equal(transactionCalls, 1);
    assert.equal(category.name, 'New Name');
    assert.equal(updatedProductName, 'New Name');
  } finally {
    mongoose.startSession = originals.startSession;
    Category.findById = originals.categoryFindById;
    Category.findOne = originals.categoryFindOne;
    Product.updateMany = originals.productUpdateMany;
    Partner.updateMany = originals.partnerUpdateMany;
    Setting.findOne = originals.settingFindOne;
  }
});

test('Category archive remains a normal non-destructive update', async () => {
  const category = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Electrical',
    isActive: true,
    save: async () => category,
    toObject: () => ({ _id: category._id, name: category.name, isActive: category.isActive }),
  };
  const originalFindById = Category.findById;
  try {
    Category.findById = async () => category;
    const response = makeResponse();
    await updateCategory(makeRequest({ isActive: false }, String(category._id)), response, assert.fail);
    assert.equal(response.statusCode, 200);
    assert.equal(category.isActive, false);
  } finally {
    Category.findById = originalFindById;
  }
});
