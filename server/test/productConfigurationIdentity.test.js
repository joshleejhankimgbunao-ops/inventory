const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProductConfigurationIdentity,
  findDuplicateConfigurationGroups,
} = require('../src/utils/productConfigurationIdentity');
const { getEffectiveDefinitions } = require('../src/utils/productAttributes');

const legacyDefinitions = getEffectiveDefinitions({ showBrand: true, showColor: true, showSize: true });
const schemaV1SizeOnly = getEffectiveDefinitions({
  attributeSchemaVersion: 1,
  productAttributes: [{ name: 'Size / Variant', key: 'size', type: 'text', required: false }],
});

const product = (overrides = {}) => ({
  _id: overrides._id || overrides.sku || 'product-1',
  category: overrides.category || 'Electrical',
  name: overrides.name || 'THHN Wire',
  sku: overrides.sku || 'TST-ELC-001',
  price: overrides.price ?? 100,
  stock: overrides.stock ?? 5,
  supplierName: overrides.supplierName || 'Supplier',
  imageUrl: overrides.imageUrl || '',
  brand: overrides.brand || '',
  color: overrides.color || '',
  size: overrides.size || '3.5mm',
  attributes: overrides.attributes || {},
});

test('identity ignores SKU, price, stock, supplier, image, and attribute order', () => {
  const left = product({ sku: 'A-001', price: 89, stock: 1, supplierName: 'A', imageUrl: 'a.png', brand: 'MetroWire', color: 'Black' });
  const right = product({ sku: 'B-001', price: 120, stock: 99, supplierName: 'B', imageUrl: 'b.png', brand: ' metrowire ', color: ' black ' });

  assert.equal(
    buildProductConfigurationIdentity({ ...left, definitions: legacyDefinitions }),
    buildProductConfigurationIdentity({ ...right, definitions: [...legacyDefinitions].reverse() })
  );
});

test('different configured Size or Brand produces a distinct identity', () => {
  const base = product({ brand: 'MetroWire', size: '3.5mm' });
  assert.notEqual(
    buildProductConfigurationIdentity({ ...base, definitions: legacyDefinitions }),
    buildProductConfigurationIdentity({ ...base, size: '2.0mm', definitions: legacyDefinitions })
  );
  assert.notEqual(
    buildProductConfigurationIdentity({ ...base, definitions: legacyDefinitions }),
    buildProductConfigurationIdentity({ ...base, brand: 'Philflex', definitions: legacyDefinitions })
  );
});

test('schema v1 identity ignores stale legacy Brand and Color when only Size is configured', () => {
  const left = product({ brand: 'MetroWire', color: 'Black', attributes: { size: '3.5mm' } });
  const right = product({ brand: 'Old Brand', color: 'Red', attributes: { size: '3.5mm' } });

  assert.equal(
    buildProductConfigurationIdentity({ ...left, definitions: schemaV1SizeOnly }),
    buildProductConfigurationIdentity({ ...right, definitions: schemaV1SizeOnly })
  );
});

test('numeric configured attributes use a stable numeric identity', () => {
  const definitions = [{ name: 'Gauge', key: 'gauge', type: 'number', order: 0 }];
  assert.equal(
    buildProductConfigurationIdentity({ ...product(), attributes: { gauge: '12.0' }, definitions }),
    buildProductConfigurationIdentity({ ...product(), attributes: { gauge: 12 }, definitions })
  );
});

test('read-only duplicate audit finds existing ambiguous configurations without changing rows', () => {
  const rows = [
    product({ _id: 'one', sku: 'A-001', price: 89, size: '3.5mm' }),
    product({ _id: 'two', sku: 'B-001', price: 120, size: '3.5mm' }),
    product({ _id: 'three', sku: 'C-001', price: 120, size: '2.0mm' }),
  ];
  const snapshot = JSON.stringify(rows);
  const groups = findDuplicateConfigurationGroups(rows, new Map([['Electrical', schemaV1SizeOnly]]));

  assert.deepEqual(groups.map((group) => group.map((item) => item.sku)), [['A-001', 'B-001']]);
  assert.equal(JSON.stringify(rows), snapshot);
});
