/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../src/utils/posVariantSelection.js');
const item = (code, attributes = {}, sellingUnit = '', extra = {}) => ({
  id: code, code, name: 'Test Product', category: 'Test', attributes, sellingUnit,
  stock: 10, price: 100, isActive: true, ...extra,
});
const field = (key, name, order, extra = {}) => ({ key, name, order, type: 'text', ...extra });

test('Paint keeps Brand as parent and offers configured Color then Volume without redundant unit group', async () => {
  const { getPosAttributeSelectionModel, groupProductsForPos, getPosVariantValueKey } = await load();
  const definitions = [field('color', 'Color', 0), field('brand', 'Brand', 1), field('volume', 'Volume', 2, { type: 'number_unit', unit: 'L' })];
  const rows = [
    item('WHITE', { brand: 'Boysen', color: 'White', volume: 1 }, 'can', { brand: 'Boysen', color: 'White' }),
    item('BLACK', { brand: 'Boysen', color: 'Black', volume: 2 }, 'can', { brand: 'Boysen', color: 'Black' }),
    item('PURPLE', { brand: 'Boysen', color: 'Purple', volume: 5 }, 'liter (L)', { brand: 'Boysen', color: 'Purple' }),
    item('OTHER', { brand: 'Nippon', color: 'Black', volume: 4 }, 'can', { brand: 'Nippon', color: 'Black' }),
  ];
  const category = { name: 'Test', attributeSchemaVersion: 1, productAttributes: definitions };
  const group = groupProductsForPos(rows, [category])[0];
  assert.equal(group.brandOptions.length, 2);
  const boysen = group.variants.filter((row) => getPosVariantValueKey(row, 'brand') === 'boysen');
  const model = getPosAttributeSelectionModel(boysen, definitions);
  assert.deepEqual(model.groups.map((entry) => entry.label), ['Color', 'Volume']);
  assert.deepEqual(model.groups[1].options.map((option) => option.label), ['1 L', '2 L', '5 L']);
  assert.equal(model.matchedVariant, null);
  const white = getPosAttributeSelectionModel(boysen, definitions, { color: 'white' });
  assert.equal(white.matchedVariant.code, 'WHITE');
  assert.equal(white.groups[1].options.find((option) => option.key === '2').exists, false);
  const black = getPosAttributeSelectionModel(boysen, definitions, { ...white.selections, color: 'black' });
  assert.equal(black.matchedVariant.code, 'BLACK');
  assert.equal(black.selections.volume, '2');
});

test('Hollow Blocks and legacy Coco Lumber use the configured size group without invented units', async () => {
  const { getPosAttributeSelectionModel } = await load();
  const thickness = [field('size_thickness', 'Size / Thickness', 0)];
  const blocks = [item('HB4', { size_thickness: '4"' }, 'pcs'), item('HB5', { size_thickness: '5"' }, 'pcs')];
  const blockModel = getPosAttributeSelectionModel(blocks, thickness);
  assert.deepEqual(blockModel.groups.map((group) => group.label), ['Size / Thickness']);
  assert.equal(getPosAttributeSelectionModel(blocks, thickness, { size_thickness: '4"' }).matchedVariant.code, 'HB4');
  const lumber = [item('LBR3', {}, '', { size: '2x3x8ft' }), item('LBR6', {}, '', { size: '2x6x8ft' })];
  const lumberModel = getPosAttributeSelectionModel(lumber, [field('size', 'Size / Variant', 0)]);
  assert.deepEqual(lumberModel.groups.map((group) => group.label), ['Size / Variant']);
  assert.deepEqual(lumberModel.groups[0].options.map((option) => option.label), ['2x3x8ft', '2x6x8ft']);
  assert.equal(getPosAttributeSelectionModel(lumber, [field('size', 'Size / Variant', 0)], { size: '2x6x8ft' }).matchedVariant.code, 'LBR6');
});

test('Concrete Nails requires Selling Unit only for same-size SKUs and never invents combinations', async () => {
  const { getPosAttributeSelectionModel } = await load();
  const definitions = [field('size_variant', 'Size / Variant', 0)];
  const rows = [item('PACK5', { size_variant: '5' }, 'pack'), item('PCS5', { size_variant: '5' }, 'pcs'), item('PCS6', { size_variant: '6' }, 'pcs')];
  const start = getPosAttributeSelectionModel(rows, definitions);
  assert.deepEqual(start.groups.map((group) => group.label), ['Size / Variant', 'Selling Unit']);
  assert.equal(start.matchedVariant, null);
  const five = getPosAttributeSelectionModel(rows, definitions, { size_variant: '5' });
  assert.equal(five.matchedVariant, null);
  assert.equal(getPosAttributeSelectionModel(rows, definitions, { size_variant: '5', sellingUnit: 'pack' }).matchedVariant.code, 'PACK5');
  const six = getPosAttributeSelectionModel(rows, definitions, { size_variant: '6' });
  assert.equal(six.matchedVariant.code, 'PCS6');
  assert.equal(six.groups[1].options.find((option) => option.key === 'pack').exists, false);
  const switched = getPosAttributeSelectionModel(rows, definitions, { ...five.selections, size_variant: '6', sellingUnit: 'pack' });
  assert.equal(switched.selections.sellingUnit, 'pcs');
  assert.equal(switched.matchedVariant.code, 'PCS6');
});

test('missing attributes and duplicate visible tuples require exact Item Code without fabricated values', async () => {
  const { getPosAttributeSelectionModel } = await load();
  const definitions = [field('color', 'Color', 0)];
  const rows = [item('RED', { color: 'Red' }), item('BLUE', { color: 'Blue' }), item('LEGACY')];
  const start = getPosAttributeSelectionModel(rows, definitions);
  assert.equal(start.groups[0].options.some((option) => option.label === 'Not specified'), false);
  assert.deepEqual(start.codeOptions.map((row) => row.code), ['LEGACY']);
  assert.equal(getPosAttributeSelectionModel(rows, definitions, {}, { id: 'LEGACY', code: 'LEGACY' }).matchedVariant.code, 'LEGACY');
  const twins = [item('A', { color: 'Black' }), item('B', { color: 'Black' })];
  const ambiguous = getPosAttributeSelectionModel(twins, definitions);
  assert.equal(ambiguous.matchedVariant, null);
  assert.deepEqual(ambiguous.codeOptions.map((row) => row.code), ['A', 'B']);
  assert.equal(getPosAttributeSelectionModel(twins, definitions, {}, { id: 'B', code: 'B' }).matchedVariant.code, 'B');
  assert.equal(getPosAttributeSelectionModel(twins, definitions, {}, { id: 'WRONG', code: 'B' }).matchedVariant, null);
});

test('archived, sold-out, and refreshed SKU states remain exact and cart reservations reduce addable quantity', async () => {
  const { getPosAttributeSelectionModel, getPosRemainingAddableQuantity } = await load();
  const definitions = [field('size', 'Size / Variant', 0)];
  const rows = [item('A', { size: '4' }, 'pcs', { stock: 0 }), item('B', { size: '5' }, 'pcs', { stock: 8 })];
  const model = getPosAttributeSelectionModel(rows, definitions);
  assert.equal(model.groups[0].options.find((option) => option.key === '4').hasStock, false);
  assert.equal(getPosAttributeSelectionModel(rows, definitions, { size: '4' }).matchedVariant.code, 'A');
  assert.equal(getPosRemainingAddableQuantity(rows[1], [{ code: 'B', qty: 3 }]), 5);
  assert.equal(getPosRemainingAddableQuantity(rows[1], [{ code: 'B', qty: 8 }]), 0);
  const refreshed = [{ ...rows[0], isActive: false }, { ...rows[1], stock: 2 }];
  assert.equal(getPosAttributeSelectionModel(refreshed, definitions, {}, { id: 'A', code: 'A' }).matchedVariant, null);
  assert.equal(getPosAttributeSelectionModel(refreshed, definitions, {}, { id: 'B', code: 'B' }).matchedVariant.stock, 2);
  assert.equal(getPosAttributeSelectionModel(refreshed, definitions).matchedVariant.code, 'B');
  assert.equal(getPosRemainingAddableQuantity(refreshed[1], [{ code: 'B', qty: 3 }]), 0);
});

test('a selected SKU survives a singleton refresh with current details and no stale option groups', async () => {
  const { getPosAttributeSelectionModel, getPosRemainingAddableQuantity } = await load();
  const definitions = [field('color', 'Color', 0), field('volume', 'Volume', 1, { type: 'number_unit', unit: 'L' })];
  const white = item('WHITE', { color: 'White', volume: 1 }, 'can', { imageUrl: 'white.png' });
  const black = item('BLACK', { color: 'Black', volume: 2 }, 'can');
  const before = getPosAttributeSelectionModel([white, black], definitions, { color: 'white' });
  assert.equal(before.matchedVariant, white);
  const refreshedWhite = { ...white, price: 199, stock: 7, sellingUnit: 'liter (L)', imageUrl: 'updated.png' };
  const identity = { id: white.id, code: white.code };
  const after = getPosAttributeSelectionModel([refreshedWhite, { ...black, isActive: false }], definitions, before.selections, identity);
  assert.equal(after.matchedVariant, refreshedWhite);
  assert.deepEqual(after.groups, []);
  assert.deepEqual(after.selections, {});
  assert.deepEqual(after.codeOptions, []);
  assert.equal(getPosRemainingAddableQuantity(after.matchedVariant, [{ code: 'WHITE', qty: 1 }]), 6);
  assert.equal(getPosAttributeSelectionModel([black], definitions, before.selections, identity).matchedVariant, null);
  assert.equal(getPosAttributeSelectionModel([{ ...white, isActive: false }, black], definitions, before.selections, identity).matchedVariant, null);
  assert.equal(getPosAttributeSelectionModel([{ ...white, id: 'REUSED' }], definitions, before.selections, identity).matchedVariant, null);
});

test('earlier choices preserve compatible downstream values and clear incompatible values without mutating input', async () => {
  const { getPosAttributeSelectionModel } = await load();
  const definitions = [field('color', 'Color', 0), field('volume', 'Volume', 1)];
  const rows = [item('BLACK1', { color: 'Black', volume: 1 }), item('BLACK2', { color: 'Black', volume: 2 }),
    item('WHITE1', { color: 'White', volume: 1 }), item('WHITE3', { color: 'White', volume: 3 })];
  const selections = { color: 'black', volume: '1' };
  const before = structuredClone(rows);
  const compatible = getPosAttributeSelectionModel(rows, definitions, { ...selections, color: 'white' });
  assert.equal(compatible.selections.volume, '1');
  assert.equal(compatible.matchedVariant.code, 'WHITE1');
  const incompatible = getPosAttributeSelectionModel(rows, definitions, { color: 'white', volume: '2' });
  assert.equal(incompatible.selections.volume, null);
  assert.equal(incompatible.matchedVariant, null);
  assert.deepEqual(incompatible.candidates.map((row) => row.code), ['WHITE1', 'WHITE3']);
  assert.equal(incompatible.groups[1].options.find((option) => option.key === '2').exists, false);
  assert.deepEqual(rows, before);
  assert.deepEqual(selections, { color: 'black', volume: '1' });
});

test('new identical-attribute siblings require a code for fresh selection but preserve an existing exact identity', async () => {
  const { getPosAttributeSelectionModel } = await load();
  const definitions = [field('color', 'Color', 0), field('volume', 'Volume', 1)];
  const white = item('WHITE', { color: 'White', volume: 1 }, 'can');
  const rows = [white, item('BLACK', { color: 'Black', volume: 2 }, 'can')];
  const previous = getPosAttributeSelectionModel(rows, definitions, { color: 'white' });
  rows.push(item('TWIN', { color: 'White', volume: 1 }, 'can', { price: 200 }));
  const fresh = getPosAttributeSelectionModel(rows, definitions, previous.selections);
  assert.equal(fresh.matchedVariant, null);
  assert.deepEqual(fresh.codeOptions.map((row) => row.code), ['WHITE', 'TWIN']);
  const preserved = getPosAttributeSelectionModel(rows, definitions, previous.selections, previous.matchedVariant);
  assert.equal(preserved.matchedVariant, white);
  assert.equal(getPosAttributeSelectionModel(rows.filter((row) => row !== white), definitions, previous.selections, previous.matchedVariant).matchedVariant, null);
});
