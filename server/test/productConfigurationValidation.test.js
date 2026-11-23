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
const Sale = require('../src/models/Sale');
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
  body: { sellingUnit: 'pcs', purchaseCost: 0, ...body },
  params: id ? { id } : {},
  user: { _id: 'admin-1', name: 'Admin' },
  ip: '127.0.0.1',
  get: () => '',
});

const DEFAULT_CATEGORY_ID = '507f1f77bcf86cd799439011';

const categoryFixture = (category, defaults = {}) => category && ({
  _id: DEFAULT_CATEGORY_ID,
  name: 'Electrical',
  isActive: true,
  sizeUnits: ['pcs'],
  ...defaults,
  ...category,
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
  sellingUnit: overrides.sellingUnit || '',
  supplierName: overrides.supplierName || 'Supplier',
  imageUrl: overrides.imageUrl || '',
  updatedAt: overrides.updatedAt || null,
  isActive: overrides.isActive ?? true,
});

const withProductStubs = async ({ category, products = [], existing = null, saleExists = null, action }) => {
  const originalCategoryFindOne = Category.findOne;
  const originalProductFind = Product.find;
  const originalProductFindOne = Product.findOne;
  const originalProductFindById = Product.findById;
  const originalProductCreate = Product.create;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalSaleExists = Sale.exists;

  try {
    Category.findOne = async (filter) => {
      const resolved = typeof category === 'function' ? category(filter) : category;
      return categoryFixture(resolved);
    };
    Product.find = async () => products;
    Product.findOne = async () => null;
    Product.findById = async () => existing;
    Product.create = async (payload) => ({ _id: 'created-1', ...payload });
    Product.findOneAndUpdate = async (_filter, payload) => ({ ...existing, ...payload, _id: existing?._id || 'existing-1' });
    Sale.exists = async () => saleExists;
    await action();
  } finally {
    Category.findOne = originalCategoryFindOne;
    Product.find = originalProductFind;
    Product.findOne = originalProductFindOne;
    Product.findById = originalProductFindById;
    Product.create = originalProductCreate;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Sale.exists = originalSaleExists;
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
  // The edit request helper submits the selected unit (`pcs`). Keep the saved
  // record aligned with that unit so these cases exercise maintenance-only
  // edits, rather than assigning a unit to an ambiguous legacy SKU.
  const existing = makeProduct({ sellingUnit: 'pcs' });
  const grandfatheredDuplicate = makeProduct({
    _id: 'existing-2',
    sku: 'TST-ELC-002',
    price: 120,
    sellingUnit: 'pcs',
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

test('assigning a unit to an ambiguous legacy SKU is rejected when it would collide with a duplicate', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ _id: 'legacy-1', sellingUnit: '' });
  const duplicate = makeProduct({ _id: 'legacy-2', sku: 'TST-ELC-002', sellingUnit: '' });

  await withProductStubs({ category, existing, products: [duplicate], action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({}, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, DUPLICATE_CONFIGURATION_MESSAGE);
  }});
});

test('selling unit changes cannot reinterpret a product with stock or sales history', async () => {
  const existing = makeProduct({ sellingUnit: 'pack', stock: 5 });

  await withProductStubs({ category: { sizeUnits: ['pack', 'kg'] }, existing, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ sellingUnit: 'kg' }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /cannot be changed after stock or sales history/i);
  }});

  const noStock = makeProduct({ sellingUnit: 'pack', stock: 0 });
  await withProductStubs({ category: { sizeUnits: ['pack', 'kg'] }, existing: noStock, saleExists: { _id: 'sale-1' }, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ sellingUnit: 'kg' }, noStock._id), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /cannot be changed after stock or sales history/i);
  }});
});

test('legacy products without a selling unit may assign a configured unit without changing stock', async () => {
  const existing = makeProduct({ sellingUnit: '', stock: 5 });

  await withProductStubs({ category: { sizeUnits: ['pack'] }, existing, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ sellingUnit: 'pack' }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.sellingUnit, 'pack');
  }});
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

test('editing Product Name updates only the selected Product record', async () => {
  const category = { showSize: true, showBrand: false, showColor: false, attributeSchemaVersion: 0 };
  const existing = makeProduct({ _id: 'one', sku: 'OTH-010', category: 'Masonry', name: 'Hollow Block', size: '4 in' });
  const sibling = makeProduct({ _id: 'two', sku: 'OTH-011', category: 'Masonry', name: 'Hollow Block', size: '5 in' });

  await withProductStubs({ category, existing, products: [sibling], action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ name: 'Concrete Hollow Block' }, existing._id), response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.name, 'Concrete Hollow Block');
    assert.equal(response.body.sku, 'OTH-010');
    assert.equal(response.body.price, existing.price);
    assert.equal(response.body.stock, existing.stock);
    assert.equal(sibling.name, 'Hollow Block');
  }});
});

test('category change updates one product, preserves unrelated fields, and removes incompatible attributes', async () => {
  const existing = makeProduct({
    _id: 'one',
    category: 'Masonry',
    sku: 'OTH-010',
    name: 'Hollow Block',
    attributes: { size: '4 in', material: 'Concrete' },
    brand: 'Legacy Brand',
    color: 'Gray',
    size: '4 in',
    imageUrl: 'block.jpg',
    supplierName: 'Block Supplier',
  });
  const sibling = makeProduct({ _id: 'two', sku: 'OTH-011', category: 'Masonry', name: 'Hollow Block', attributes: { size: '5 in' } });
  const target = {
    name: 'Tools & Abrasives',
    isActive: true,
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Material', key: 'material', type: 'text', required: false, order: 0 },
      { name: 'Grit', key: 'grit', type: 'number', required: true, order: 1 },
    ],
  };

  await withProductStubs({
    category: () => target,
    existing,
    products: [sibling],
    action: async () => {
      const response = makeResponse();
      await updateProduct(makeRequest({ category: target.name, attributes: { material: 'Concrete', grit: 80 } }, existing._id), response, assert.fail);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.category, target.name);
      assert.deepEqual(response.body.attributes, { material: 'Concrete', grit: 80 });
      assert.equal(response.body.sku, 'OTH-010');
      assert.equal(response.body.price, existing.price);
      assert.equal(response.body.stock, existing.stock);
      assert.equal(response.body.supplierName, 'Block Supplier');
      assert.equal(response.body.imageUrl, 'block.jpg');
      assert.equal(response.body.isActive, existing.isActive);
      assert.equal(response.body.brand, '');
      assert.equal(response.body.color, '');
      assert.equal(response.body.size, '');
      assert.equal(sibling.name, 'Hollow Block');
      assert.equal(sibling.category, 'Masonry');
    },
  });
});

test('category change rejects inactive targets, missing required attributes, and duplicate configurations', async () => {
  const existing = makeProduct({ _id: 'one', category: 'Masonry', name: 'Sanding Block', attributes: { size: '4 in' } });
  const target = {
    name: 'Tools & Abrasives',
    isActive: true,
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Grit', key: 'grit', type: 'number', required: true, order: 0 }],
  };

  await withProductStubs({ category: () => null, existing, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ category: target.name, attributes: { grit: 80 } }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /unavailable/i);
  }});

  await withProductStubs({ category: target, existing, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ category: target.name, attributes: {} }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /Grit is required/i);
  }});

  const duplicate = makeProduct({ _id: 'two', sku: 'ABR-080', category: target.name, name: existing.name, attributes: { grit: 80 } });
  await withProductStubs({ category: target, existing, products: [duplicate], action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ category: target.name, attributes: { grit: 80 } }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, DUPLICATE_CONFIGURATION_MESSAGE);
  }});
});

test('product creation accepts a blank Product Name and keeps the stored name blank', async () => {
  const category = {
    name: 'Electrical',
    isActive: true,
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Type', key: 'type', type: 'text', required: false, order: 0 },
      { name: 'Size', key: 'size_variant', type: 'text', required: false, order: 1 },
    ],
  };

  await withProductStubs({ category, action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: '   ',
      sku: 'ELC-099',
      category: 'Electrical',
      attributes: { type: 'Electrical Wire', size_variant: '2.0mm' },
      sellingUnit: 'pcs',
      price: 10,
    }), response, assert.fail);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.name, '');
    assert.deepEqual(response.body.attributes, { type: 'Electrical Wire', size_variant: '2.0mm' });
    assert.notEqual(Product.schema.path('name').options.required, true);
  }});
});

test('product creation preserves a supplied Product Name', async () => {
  const category = { name: 'Electrical', isActive: true, attributeSchemaVersion: 1, productAttributes: [] };
  await withProductStubs({ category, action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({ name: '  Electrical Wire  ', sku: 'ELC-098', category: 'Electrical', price: 10 }), response, assert.fail);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.name, 'Electrical Wire');
  }});
});

test('product editing accepts and persists a blank Product Name', async () => {
  const category = {
    name: 'Electrical',
    isActive: true,
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Type', key: 'type', type: 'text', required: false, order: 0 }],
  };
  const existing = makeProduct({ _id: 'blank-name-edit', name: 'Named Wire', attributes: { type: 'Electrical Wire' } });

  await withProductStubs({ category, existing, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ name: '   ' }, existing._id), response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.name, '');
    assert.equal(response.body.sku, existing.sku);
  }});
});

test('Product Master accepts validated legacy data-URL images and rejects spoofed image content', async () => {
  const category = { name: 'Electrical', isActive: true, attributeSchemaVersion: 1, productAttributes: [] };
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validImage = `data:image/png;base64,${pngBytes.toString('base64')}`;
  await withProductStubs({ category, action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'Wire', sku: 'ELC-097', category: 'Electrical', price: 10, imageUrl: validImage,
    }), response, assert.fail);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.imageUrl, validImage);
  }});

  await withProductStubs({ category, action: async () => {
    const response = makeResponse();
    await createProduct(makeRequest({
      name: 'Wire', sku: 'ELC-096', category: 'Electrical', price: 10,
      imageUrl: `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString('base64')}`,
    }), response, (error) => {
      response.statusCode = error.status;
      response.body = { message: error.message };
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /content does not match/i);
  }});
});

test('Product Master leaves an unchanged legacy image reference intact during other product edits', async () => {
  const category = { name: 'Electrical', isActive: true, attributeSchemaVersion: 1, productAttributes: [] };
  const existing = makeProduct({
    _id: 'legacy-image-product',
    imageUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
  });
  await withProductStubs({ category, existing, action: async () => {
    const response = makeResponse();
    await updateProduct(makeRequest({ name: 'Renamed Wire', imageUrl: existing.imageUrl }, existing._id), response, assert.fail);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.imageUrl, existing.imageUrl);
  }});
});
