/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const makeVariant = (overrides = {}) => ({
  id: overrides.code || 'SKU-001',
  code: overrides.code || 'SKU-001',
  name: overrides.name || 'THHN Wire',
  category: overrides.category || 'Electrical',
  brand: overrides.brand || '',
  size: overrides.size || '',
  color: overrides.color || '',
  attributes: overrides.attributes || {},
  price: overrides.price ?? 50,
  stock: overrides.stock ?? 10,
  imageUrl: '',
});

const loadHelpers = () => import('../../src/utils/posVariantSelection.js');

test('two stocked sizes are both enabled from actual SKU rows', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm² × 150m', stock: 10 }),
    makeVariant({ code: 'WIRE-35', size: '3.5mm² × 150m', stock: 9 }),
  ];

  const model = getPosVariantSelectionModel(variants);
  assert.deepEqual(model.optionGroups.size.map(({ label, hasStock }) => [label, hasStock]), [
    ['2.0mm²x150m', true],
    ['3.5mm²x150m', true],
  ]);
});

test('a stocked no-color size and a stocked Black size are both reachable', async () => {
  const { getPosVariantSelectionModel, updatePosVariantSelection } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm² × 150m', stock: 10 }),
    makeVariant({ code: 'WIRE-35-BLK', size: '3.5mm² × 150m', color: 'Black', stock: 9 }),
  ];

  const size20 = updatePosVariantSelection(variants, { size: null, color: null }, 'size', '2.0mm²x150m');
  assert.equal(getPosVariantSelectionModel(variants, size20).matchedVariant.code, 'WIRE-20');

  const size35 = updatePosVariantSelection(variants, { size: null, color: null }, 'size', '3.5mm²x150m');
  const black = updatePosVariantSelection(variants, size35, 'color', 'black');
  assert.equal(getPosVariantSelectionModel(variants, black).matchedVariant.code, 'WIRE-35-BLK');
});

test('missing optional Color does not make a size incompatible with Black', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm', stock: 10 }),
    makeVariant({ code: 'WIRE-35-BLK', size: '3.5mm', color: 'Black', stock: 9 }),
  ];

  const model = getPosVariantSelectionModel(variants, { size: null, color: 'black' });
  const size20 = model.optionGroups.size.find((option) => option.key === '2.0mm');
  assert.equal(size20.exists, true);
  assert.equal(size20.hasStock, true);
});

test('an out-of-stock variant option is not enabled', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const model = getPosVariantSelectionModel([
    makeVariant({ code: 'WIRE-20', size: '2.0mm', stock: 0 }),
    makeVariant({ code: 'WIRE-35', size: '3.5mm', stock: 9 }),
  ]);

  assert.equal(model.optionGroups.size.find((option) => option.key === '2.0mm').hasStock, false);
});

test('the same option becomes enabled when refreshed stock becomes positive', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm', stock: 0 }),
    makeVariant({ code: 'WIRE-35', size: '3.5mm', stock: 9 }),
  ];
  assert.equal(getPosVariantSelectionModel(variants).optionGroups.size[0].hasStock, false);

  const refreshed = variants.map((variant) => (
    variant.code === 'WIRE-20' ? { ...variant, stock: 6 } : variant
  ));
  assert.equal(getPosVariantSelectionModel(refreshed).optionGroups.size[0].hasStock, true);
});

test('a product group is out of stock only when every child SKU is out of stock', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const partlyStocked = groupProductsForPos([
    makeVariant({ code: 'WIRE-20', stock: 0 }),
    makeVariant({ code: 'WIRE-35', stock: 9 }),
  ])[0];
  const allEmpty = groupProductsForPos([
    makeVariant({ code: 'WIRE-20', stock: 0 }),
    makeVariant({ code: 'WIRE-35', stock: 0 }),
  ])[0];

  assert.equal(partlyStocked.stock, 9);
  assert.equal(allEmpty.stock, 0);
});

test('all three observed THHN SKUs can resolve to their exact product', async () => {
  const {
    POS_VARIANT_NOT_APPLICABLE,
    getPosVariantSelectionModel,
  } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-A', size: '2.0mm', stock: 10 }),
    makeVariant({ code: 'WIRE-B', size: '3.5mm', color: 'Black', stock: 9 }),
    makeVariant({ code: 'WIRE-C', size: '3.5mm', stock: 15 }),
  ];

  assert.equal(getPosVariantSelectionModel(variants, { size: '2.0mm', color: POS_VARIANT_NOT_APPLICABLE }).matchedVariant.code, 'WIRE-A');
  assert.equal(getPosVariantSelectionModel(variants, { size: '3.5mm', color: 'black' }).matchedVariant.code, 'WIRE-B');
  assert.equal(getPosVariantSelectionModel(variants, { size: '3.5mm', color: POS_VARIANT_NOT_APPLICABLE }).matchedVariant.code, 'WIRE-C');
});

test('selecting a size recomputes an incompatible Color as Not Applicable', async () => {
  const {
    POS_VARIANT_NOT_APPLICABLE,
    updatePosVariantSelection,
  } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm', stock: 10 }),
    makeVariant({ code: 'WIRE-35-BLK', size: '3.5mm', color: 'Black', stock: 9 }),
  ];

  const next = updatePosVariantSelection(variants, { size: '3.5mm', color: 'black' }, 'size', '2.0mm');
  assert.equal(next.size, '2.0mm');
  assert.equal(next.color, POS_VARIANT_NOT_APPLICABLE);
});

test('brand, color, and size selections preserve existing exact variant behavior', async () => {
  const { getPosVariantSelectionModel, getPosVariantValueKey, groupProductsForPos } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'A-RED-S', brand: 'Brand A', size: 'Small', color: 'Red' }),
    makeVariant({ code: 'A-BLUE-L', brand: 'Brand A', size: 'Large', color: 'Blue' }),
    makeVariant({ code: 'B-RED-S', brand: 'Brand B', size: 'Small', color: 'Red' }),
  ];
  const group = groupProductsForPos(variants)[0];
  const brandA = group.variants.filter((variant) => getPosVariantValueKey(variant, 'brand') === 'brand a');
  const model = getPosVariantSelectionModel(brandA, { size: 'large', color: 'blue' });

  assert.deepEqual(group.brandOptions.map((option) => option.label), ['Brand A', 'Brand B']);
  assert.equal(model.matchedVariant.code, 'A-BLUE-L');
});

test('dynamic common attributes fall back into legacy POS dimensions', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'ATTR-20', attributes: { size: '2.0mm', color: 'Red' } }),
    makeVariant({ code: 'ATTR-35', attributes: { size: '3.5mm', color: 'Black' } }),
  ];
  const model = getPosVariantSelectionModel(variants, { size: '3.5mm', color: 'black' });

  assert.equal(model.matchedVariant.code, 'ATTR-35');
});

test('Add to Cart resolution returns the exact selected SKU and current stock', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm', price: 70, stock: 6 }),
    makeVariant({ code: 'WIRE-35', size: '3.5mm', price: 90, stock: 11 }),
  ];
  const model = getPosVariantSelectionModel(variants, { size: '3.5mm', color: null });

  assert.equal(model.matchedVariant.code, 'WIRE-35');
  assert.equal(model.matchedVariant.stock, 11);
  assert.equal(model.matchedVariant.price, 90);
});

test('group price range and option count use the actual child SKU collection', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-A', price: 40 }),
    makeVariant({ code: 'WIRE-B', price: 65 }),
    makeVariant({ code: 'WIRE-C', price: 90 }),
  ])[0];

  assert.equal(group.variants.length, 3);
  assert.equal(group.minPrice, 40);
  assert.equal(group.maxPrice, 90);
});

test('duplicate visible dimensions remain reachable through exact SKU selection', async () => {
  const { getPosVariantSelectionModel } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-X', size: '2.0mm', color: 'Black', stock: 4 }),
    makeVariant({ code: 'WIRE-Y', size: '2.0mm', color: 'Black', stock: 8 }),
  ];
  const pending = getPosVariantSelectionModel(variants, { size: '2.0mm', color: 'black' });
  const selected = getPosVariantSelectionModel(variants, { size: '2.0mm', color: 'black' }, 'WIRE-Y');

  assert.equal(pending.needsSkuSelection, true);
  assert.equal(pending.matchedVariant, null);
  assert.equal(selected.matchedVariant.code, 'WIRE-Y');
});

test('mixed missing and populated brand/color values are not presented as one common value', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-A', brand: '', color: '' }),
    makeVariant({ code: 'WIRE-B', brand: 'MetroWire', color: 'Black' }),
  ])[0];

  assert.equal(group.brand, 'Multiple Brands');
  assert.equal(group.color, 'Multiple Colors');
  assert.deepEqual(group.availableBrands, ['MetroWire', 'Not Applicable']);
});

test('POS grouping remains scoped to exact category and product name', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const rows = groupProductsForPos([
    makeVariant({ code: 'WIRE-A', name: 'THHN Wire', category: 'Electrical', brand: 'MetroWire' }),
    makeVariant({ code: 'WIRE-B', name: 'THHN Wire', category: 'Electrical', brand: '' }),
    makeVariant({ code: 'WIRE-C', name: 'THHN Wire', category: 'Other', brand: 'MetroWire' }),
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.isGroup).variants.length, 2);
});

test('PointOfSale consumes live grouped data and the shared selection model', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');

  assert.match(source, /groupProductsForPos\(filtered, categoryDefinitions\)/);
  assert.match(source, /getPosVariantSelectionModel\(filteredVariants/);
  assert.match(source, /setVariantModal\(\(previous\) => \(\{ \.\.\.previous, group: refreshedGroup \}\)\)/);
  assert.match(source, /disabled=\{!hasMatchingCombination\}/);
});

test('out-of-stock options stay actionable only for exact-SKU recommendations', async () => {
  const { getPosVariantSelectionModel, updatePosVariantSelection } = await loadHelpers();
  const variants = [
    makeVariant({ code: 'WIRE-20', size: '2.0mm', stock: 4 }),
    makeVariant({ code: 'WIRE-35', size: '3.5mm', stock: 0 }),
  ];
  const nextSelections = updatePosVariantSelection(variants, { size: null }, 'size', '3.5mm', ['size']);
  const resolved = getPosVariantSelectionModel(variants, nextSelections, null, ['size']);
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');

  assert.equal(resolved.matchedVariant.code, 'WIRE-35');
  assert.equal(resolved.matchedVariant.stock, 0);
  assert.match(source, /Sold out — click to view alternatives/);
  assert.match(source, /Out of stock\. View recommendations\./);
  assert.match(source, /openRecommendationResults\(exactUnavailableVariant, 'alternative', \{ type: 'out-of-stock' \}\)/);
});

test('grouped-product tooltips render through a viewport-aware portal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const tooltipSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ViewportTooltip.jsx'), 'utf8');

  assert.match(source, /<ViewportTooltip/);
  assert.doesNotMatch(source, /absolute -top-11 left-1\/2/);
  assert.match(tooltipSource, /createPortal/);
  assert.match(tooltipSource, /getBoundingClientRect/);
  assert.match(tooltipSource, /window\.innerWidth/);
  assert.match(tooltipSource, /window\.innerHeight/);
  assert.match(tooltipSource, /canFitAbove \? 'above' : 'below'/);
  assert.match(tooltipSource, /window\.addEventListener\('scroll', updatePosition, true\)/);
});

test('schema v1 without Brand ignores a stale legacy brand in POS dimensions', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Size / Variant', key: 'size', type: 'text', order: 0 }],
  };
  const group = groupProductsForPos([
    makeVariant({ code: 'TST-ELC-001', brand: 'MetroWire', size: '2.0mm' }),
    makeVariant({ code: 'TST-ELC-002', brand: '', size: '3.5mm' }),
  ], [category])[0];

  assert.equal(group.variants[0].brand || group.variants[1].brand, 'MetroWire');
  assert.deepEqual(group.variantDimensions, ['size']);
  assert.deepEqual(group.brandOptions, []);
  assert.equal(group.brand, null);
});

test('schema v1 shows Brand when Brand is explicitly configured', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Brand', key: 'brand', type: 'text', order: 0 }],
  };
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-A', brand: 'MetroWire' }),
    makeVariant({ code: 'WIRE-B', brand: 'PowerLine' }),
  ], [category])[0];

  assert.deepEqual(group.variantDimensions, ['brand']);
  assert.deepEqual(group.brandOptions.map((option) => option.label), ['MetroWire', 'PowerLine']);
});

test('legacy schema v0 continues to use showBrand for POS dimensions', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 0,
    showBrand: true,
    showColor: false,
    showSize: false,
  };
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-A', brand: 'MetroWire' }),
    makeVariant({ code: 'WIRE-B', brand: 'PowerLine' }),
  ], [category])[0];

  assert.deepEqual(group.variantDimensions, ['brand']);
  assert.equal(group.brandOptions.length, 2);
});

test('hiding stale Brand leaves each differently sized child SKU reachable', async () => {
  const { getPosVariantSelectionModel, groupProductsForPos } = await loadHelpers();
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Size / Variant', key: 'size', type: 'text', order: 0 }],
  };
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-20', brand: 'MetroWire', size: '2.0mm' }),
    makeVariant({ code: 'WIRE-35', brand: '', size: '3.5mm' }),
  ], [category])[0];
  const selectorDimensions = group.variantDimensions.filter((dimension) => dimension !== 'brand');

  assert.equal(getPosVariantSelectionModel(group.variants, { size: '2.0mm' }, null, selectorDimensions).matchedVariant.code, 'WIRE-20');
  assert.equal(getPosVariantSelectionModel(group.variants, { size: '3.5mm' }, null, selectorDimensions).matchedVariant.code, 'WIRE-35');
});

test('hidden Brand collisions use exact SKU fallback instead of restoring Brand', async () => {
  const { getPosVariantSelectionModel, groupProductsForPos } = await loadHelpers();
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [],
  };
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-METRO', brand: 'MetroWire' }),
    makeVariant({ code: 'WIRE-LEGACY', brand: '' }),
  ], [category])[0];
  const pending = getPosVariantSelectionModel(group.variants, {}, null, group.variantDimensions);
  const selected = getPosVariantSelectionModel(group.variants, {}, 'WIRE-METRO', group.variantDimensions);

  assert.deepEqual(group.variantDimensions, []);
  assert.equal(pending.needsSkuSelection, true);
  assert.equal(selected.matchedVariant.code, 'WIRE-METRO');
});

test('schema authority applies independently to Size and Color', async () => {
  const { groupProductsForPos } = await loadHelpers();
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Color', key: 'color', type: 'text', order: 0 }],
  };
  const group = groupProductsForPos([
    makeVariant({ code: 'WIRE-A', size: '2.0mm', color: 'Black' }),
    makeVariant({ code: 'WIRE-B', size: '3.5mm', color: 'Red' }),
  ], [category])[0];

  assert.deepEqual(group.variantDimensions, ['color']);
});

test('Product Master compact rows hide schema-v1 legacy badges without clearing stored values', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');

  assert.match(source, /attributeSchemaVersion/);
  assert.match(source, /isCompactLegacyAttributeVisible\(product\.category, 'brand'\)/);
  assert.match(source, /isCompactLegacyAttributeVisible\(product\.category, 'size'\)/);
  assert.match(source, /isCompactLegacyAttributeVisible\(product\.category, 'color'\)/);
  assert.doesNotMatch(source, /delete product\.brand/);
});
