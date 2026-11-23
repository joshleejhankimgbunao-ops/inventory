const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProductConfigurationIdentity,
  findDuplicateConfigurationGroups,
  productConfigurationsConflict,
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
  sellingUnit: overrides.sellingUnit === undefined ? 'pcs' : overrides.sellingUnit,
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

test('selling unit distinguishes otherwise identical configurations after case and whitespace normalization', () => {
  const base = product({ category: 'Fasteners', name: 'Concrete Nails', attributes: { size: '4' }, sellingUnit: ' pack ' });
  const same = product({ ...base, sku: 'OTH-012', sellingUnit: 'PACK', price: 250, stock: 100 });
  const differentUnit = product({ ...base, sku: 'OTH-013', sellingUnit: 'pcs' });
  const differentSize = product({ ...base, sku: 'OTH-014', attributes: { size: '5' } });

  assert.equal(productConfigurationsConflict(base, same, schemaV1SizeOnly), true);
  assert.equal(productConfigurationsConflict(base, differentUnit, schemaV1SizeOnly), false);
  assert.equal(productConfigurationsConflict(base, differentSize, schemaV1SizeOnly), false);
  assert.notEqual(
    buildProductConfigurationIdentity({ ...base, definitions: schemaV1SizeOnly }),
    buildProductConfigurationIdentity({ ...differentUnit, definitions: schemaV1SizeOnly })
  );
});

test('missing legacy selling units still conflict with each otherwise identical configured unit', () => {
  const legacy = product({ sku: 'LEGACY', sellingUnit: '' });
  const pieces = product({ sku: 'PIECES', sellingUnit: 'pcs' });
  const packs = product({ sku: 'PACKS', sellingUnit: 'pack' });
  assert.equal(productConfigurationsConflict(legacy, pieces, schemaV1SizeOnly), true);
  assert.equal(productConfigurationsConflict(packs, legacy, schemaV1SizeOnly), true);
  assert.equal(productConfigurationsConflict(pieces, packs, schemaV1SizeOnly), false);
  assert.deepEqual(
    findDuplicateConfigurationGroups([legacy, pieces, packs], new Map([['Electrical', schemaV1SizeOnly]]))
      .map((group) => group.map((item) => item.sku)),
    [['LEGACY', 'PIECES', 'PACKS']]
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
