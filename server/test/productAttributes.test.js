const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyLegacyCompatibility,
  getEffectiveDefinitions,
  normalizeDefinitions,
  validateProductAttributeValues,
} = require('../src/utils/productAttributes');

test('normalizes configurable category attributes and stable keys', () => {
  const result = normalizeDefinitions([
    { name: 'Material Type', type: 'select', required: true, options: ['Wood', 'Steel', 'Wood'] },
    { name: 'Weight', type: 'number_unit', unit: 'kg' },
  ]);
  assert.deepEqual(result.map(({ name, key, type, required, unit, options }) => ({ name, key, type, required, unit, options })), [
    { name: 'Material Type', key: 'material_type', type: 'select', required: true, unit: '', options: ['Wood', 'Steel'] },
    { name: 'Weight', key: 'weight', type: 'number_unit', required: false, unit: 'kg', options: [] },
  ]);
});

test('rejects invalid definitions and product values', () => {
  assert.throws(() => normalizeDefinitions([{ name: 'Grade', type: 'select', options: [] }]), /at least one option/);
  const definitions = normalizeDefinitions([{ name: 'Grade', type: 'select', required: true, options: ['A', 'B'] }]);
  assert.throws(() => validateProductAttributeValues(definitions, {}), /Grade is required/);
  assert.throws(() => validateProductAttributeValues(definitions, { grade: 'C' }), /configured options/);
});

test('maps legacy category rules and product fields without migration', () => {
  const definitions = getEffectiveDefinitions({ showBrand: true, requireBrand: true, showColor: false, showSize: true });
  assert.deepEqual(definitions.map((item) => item.key), ['brand', 'size']);
  const values = validateProductAttributeValues(definitions, {}, { brand: 'Acme', size: '2x4' });
  assert.deepEqual(values, { brand: 'Acme', size: '2x4' });
});

test('an untouched legacy category continues to expose its configured Size / Variant field', () => {
  const definitions = getEffectiveDefinitions({ showSize: true, requireSize: true });
  assert.deepEqual(definitions.map((item) => item.key), ['size']);
  assert.equal(definitions[0].required, true);
});

test('explicit custom attribute categories do not re-inject legacy fields', () => {
  assert.deepEqual(getEffectiveDefinitions({
    attributeSchemaVersion: 1,
    showSize: true,
    productAttributes: [],
  }), []);

  assert.deepEqual(getEffectiveDefinitions({
    attributeSchemaVersion: 1,
    showSize: true,
    productAttributes: [{ name: 'Brand', key: 'brand', type: 'text', required: false }],
  }).map((item) => item.key), ['brand']);
});

test('an explicitly edited legacy category keeps old product values without restoring removed definitions', () => {
  const category = { attributeSchemaVersion: 1, showBrand: true, showSize: true, productAttributes: [] };
  assert.deepEqual(getEffectiveDefinitions(category), []);
  const legacyProduct = { brand: 'Acme', size: '2x4' };
  assert.deepEqual(legacyProduct, { brand: 'Acme', size: '2x4' });
});

test('preserves number values while mirroring compatible legacy fields', () => {
  const definitions = normalizeDefinitions([{ name: 'Size', type: 'number_unit', unit: 'mm' }]);
  const values = validateProductAttributeValues(definitions, { size: '12.5' });
  assert.equal(values.size, 12.5);
  assert.equal(applyLegacyCompatibility(definitions, values, {}).size, '12.5 mm');
});
