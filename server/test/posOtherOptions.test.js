/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = import('../../src/utils/recommendationLogic.js');
const presentation = import('../../src/utils/recommendationPresentation.js');
const categories = [{ name: 'Lumbers', showBrand: false, showColor: false, showSize: true }];
const product = (code, overrides = {}) => ({
  id: code, code, name: 'Coco Lumber', category: 'Lumbers', size: '2x4x8 ft',
  sellingUnit: 'pcs', stock: 10, price: 100, isActive: true, ...overrides,
});

test('POS splits matching substitutes from related dimension differences without granting cart eligibility', async () => {
  const { getPosRecommendationAvailability, getPosRecommendationReason, prepareRecommendationCartAddition } = await helpers;
  const target = product('TARGET', { manualAlternatives: ['MANUAL', 'MIXED'] });
  const matching = product('MATCH');
  const manual = product('MANUAL', { size: '2x6x8 ft' });
  const automatic = product('AUTO', { size: '2x3x8 ft' });
  const mixed = product('MIXED');
  const inventory = [target, matching, manual, automatic, mixed, mixed];
  const before = JSON.stringify(inventory);
  const result = getPosRecommendationAvailability(target, inventory, {}, { categories });
  assert.deepEqual(new Set(result.alternatives.map((item) => item.code)), new Set(['MATCH', 'MIXED']));
  assert.deepEqual(result.otherOptions.map((item) => item.code), ['MANUAL']);
  assert.equal(result.otherOptions[0].posReason, 'Different size / variant: 2x6x8 ft');
  assert.equal(result.otherOptions.every((item) => !item.recommendation.actionable), true);
  assert.equal(getPosRecommendationReason(result.alternatives[0]), 'Matching size / variant: 2x4x8 ft');
  assert.equal(prepareRecommendationCartAddition({ targetCode: target.code, candidateCode: manual.code, inventory, categories }).ok, false);
  assert.equal(prepareRecommendationCartAddition({ targetCode: target.code, candidateCode: matching.code, inventory, categories }).ok, true);
  assert.equal(JSON.stringify(inventory), before);
});

test('POS reasons reuse current Hollow Blocks facts, retain staff order, and keep differences visible', async () => {
  const { getPosRecommendationAvailability, prepareRecommendationCartAddition } = await helpers;
  const { getPosRecommendationPresentation, getRecommendationPresentation } = await presentation;
  const masonry = [{ name: 'Masonry', attributeSchemaVersion: 1, productAttributes: [{ key: 'size_thickness', name: 'Thickness', type: 'text' }] }];
  const target = product('OTH-011', { name: 'Hollow Blocks', category: 'Masonry', size: '', attributes: { size_thickness: '5"' }, sellingUnit: 'pcs', price: 30, manualAlternatives: ['OTH-010'] });
  const candidate = product('OTH-010', { name: 'Hollow Blocks', category: 'Masonry', size: '', attributes: { size_thickness: '4"' }, sellingUnit: 'pcs', price: 20, stock: 55 });
  const current = (next = candidate, original = target) => getPosRecommendationAvailability(original, [original, next], {}, { categories: masonry });
  const option = current().otherOptions[0];
  assert.equal(option.code, 'OTH-010');
  const view = getPosRecommendationPresentation(option.recommendation);
  assert.deepEqual(view.visible.map((row) => row.text), ['Same recorded product name', '₱10.00 cheaper', 'Different thickness: 5" vs 4"']);
  assert.ok(view.visible.every((row) => getRecommendationPresentation(option.recommendation).checklist.some((managed) => managed.text === row.text)));
  assert.equal(option.recommendation.actionable, false);
  assert.equal(prepareRecommendationCartAddition({ targetCode: target.code, candidateCode: candidate.code, inventory: [target, candidate], categories: masonry }).ok, false);
  const changed = getPosRecommendationPresentation(current({ ...candidate, price: 35, attributes: { size_thickness: '6"' } }).otherOptions[0].recommendation);
  assert.ok(changed.visible.some((row) => row.text === '₱5.00 more expensive'));
  assert.ok(changed.visible.some((row) => row.text === 'Different thickness: 5" vs 6"'));
  assert.ok(!changed.visible.some((row) => row.text.includes('cheaper') || row.text.includes('vs 4"')));
  const staffReasons = [{ indicator: 'check', text: 'Staff preference.' }, { indicator: 'neutral', text: 'Requested finish.' }, { indicator: 'check', text: 'Third staff note.' }, { indicator: 'warning', text: 'Confirm load rating.' }];
  const withStaff = { ...target, recommendationBases: [{ type: 'alternative', targetSku: target.code, candidateProduct: candidate.id, candidateSku: candidate.code, staffReasons }] };
  const staffView = getPosRecommendationPresentation(current(candidate, withStaff).otherOptions[0].recommendation);
  assert.deepEqual(staffView.visible.slice(0, 2).map((row) => row.text), ['Staff preference.', 'Requested finish.']);
  assert.ok(staffView.visible.some((row) => row.text === 'Confirm load rating.' && row.staff));
  assert.ok(staffView.visible.some((row) => row.text === 'Different thickness: 5" vs 4"' && !row.staff));
  assert.ok(staffView.more.some((row) => row.text === 'Third staff note.'));
  assert.equal(new Set([...staffView.visible, ...staffView.more].map((row) => row.text)).size, staffView.visible.length + staffView.more.length);
  assert.deepEqual(withStaff.recommendationBases[0].staffReasons, staffReasons);
  const repeated = getPosRecommendationPresentation({ ...option.recommendation, staffReasons: [{ indicator: 'check', text: 'Same recorded product name' }] });
  assert.equal([...repeated.visible, ...repeated.more].filter((row) => row.text === 'Same recorded product name').length, 1);
  const twoConflicts = getPosRecommendationPresentation({ ...option.recommendation, differences: [...option.recommendation.differences, { key: 'material', label: 'Material', targetValue: 'A', candidateValue: 'B' }] });
  assert.ok(twoConflicts.visible.some((row) => row.text === 'Different material: A vs B'));
  assert.equal(getPosRecommendationPresentation({ source: 'admin-managed', staffReasons: [], matchedAttributes: [], differences: [], compatibility: { verified: false } }), null);
});

test('same category alone and missing evidence do not populate Other Available Options', async () => {
  const { getPosRecommendationAvailability } = await helpers;
  const target = product('TARGET', { manualAlternatives: ['MISSING', 'UNRELATED'] });
  const inventory = [target, product('UNRELATED', { name: 'Plywood', size: '4x8 ft' }), product('MISSING', { size: '' })];
  const result = getPosRecommendationAvailability(target, inventory, {}, { categories });
  assert.deepEqual(result.otherOptions, []);
  assert.equal(result.hasAny, false);
});

test('both exclusion arrays, rejection, archive and stock/cart availability block discovery', async () => {
  const { getPosRecommendationAvailability, getPosRecommendationAction } = await helpers;
  const candidate = product('OTHER', { size: '2x6x8 ft', stock: 2 });
  const target = product('TARGET', { manualAlternatives: ['OTHER'] });
  const available = (t = target, c = candidate, options = {}) => getPosRecommendationAvailability(t, [t, c], {}, { categories, ...options });
  assert.equal(getPosRecommendationAction(available()), 'alternative');
  for (const field of ['excludedAlternatives', 'excludedBudgetOptions']) assert.equal(available({ ...target, [field]: ['OTHER'] }).hasAny, false);
  const review = { targetSku: 'TARGET', candidateProduct: 'OTHER', candidateSku: 'OTHER', decision: 'rejected' };
  assert.equal(available({ ...target, recommendationReviews: [review] }).hasAny, false);
  assert.equal(available({ ...target, recommendationReviews: [{ ...review, decision: 'approved' }] }).otherOptions[0].recommendation.actionable, false);
  assert.equal(available({ ...target, recommendationReviews: [{ ...review, candidateProduct: 'OLD' }] }).hasAny, false);
  for (const overrides of [{ isActive: false }, { isArchived: true }, { stock: 0 }]) assert.equal(available(target, { ...candidate, ...overrides }).hasAny, false);
  assert.equal(available({ ...target, isActive: false }).hasAny, false);
  assert.equal(available(target, candidate, { cart: [{ code: 'OTHER', qty: 2 }] }).hasAny, false);
  assert.equal(available(target, candidate, { requestedQuantity: 3 }).hasAny, false);
  assert.equal(available(target, candidate, { requestedQuantity: 0 }).hasAny, false);
});

test('SKU identity changes cannot reuse a saved manual link to discover a different product', async () => {
  const { getPosRecommendationAvailability } = await helpers;
  const target = product('TARGET', { manualAlternatives: ['OTHER'], recommendationBases: [
    { type: 'alternative', targetSku: 'TARGET', candidateProduct: 'ORIGINAL-ID', candidateSku: 'OTHER' },
  ] });
  const candidate = product('OTHER', { size: '2x6x8 ft' });
  assert.equal(getPosRecommendationAvailability(target, [target, candidate], {}, { categories }).hasAny, false);
});

test('a manual link and documented identity support discovery across names; unrelated links stay hidden', async () => {
  const { getPosRecommendationAvailability } = await helpers;
  const schema = [{ name: 'Electrical', attributeSchemaVersion: 1, productAttributes: [
    { key: 'product_type', name: 'Product Type', type: 'text' },
    { key: 'width', name: 'Width', type: 'number_unit', unit: 'mm' },
  ] }];
  const target = product('TARGET', { name: 'Tape Original', category: 'Electrical', attributes: { product_type: 'Electrical Tape', width: 19 }, manualAlternatives: ['RELATED', 'WIRE', 'MISNAMED'] });
  const related = product('RELATED', { name: 'Tape Wide', category: 'Electrical', attributes: { product_type: 'Electrical Tape', width: 50 } });
  const unrelated = product('WIRE', { name: 'Electrical Wire', category: 'Electrical', attributes: { product_type: 'Electrical Wire', width: 19 } });
  const misnamed = product('MISNAMED', { name: 'Tape Original', category: 'Electrical', attributes: { product_type: 'Electrical Wire', width: 50 } });
  const inventory = [target, related, unrelated, misnamed];
  const result = getPosRecommendationAvailability(target, inventory, {}, { categories: schema });
  assert.deepEqual(result.otherOptions.map((item) => item.code), ['RELATED']);
  assert.equal(result.otherOptions[0].posReason, 'Different width: 50 mm');
  assert.equal(result.hasAlternatives, false);
  const unlinked = { ...target, manualAlternatives: [], recommendationReviews: [
    { targetSku: 'TARGET', candidateProduct: 'RELATED', candidateSku: 'RELATED', decision: 'approved' },
  ] };
  assert.equal(getPosRecommendationAvailability(unlinked, [unlinked, related], {}, { categories: schema }).hasAny, false);
});

test('an Other-only SKU exposes recommendations while an empty or stale target does not', async () => {
  const { getPosRecommendationAvailability, getPosRecommendationAction } = await helpers;
  const target = product('TARGET', { stock: 0, manualBudgetOptions: ['OTHER'] });
  const other = product('OTHER', { sellingUnit: '', size: '2x6x8 ft' });
  const result = getPosRecommendationAvailability(target, [target, other], {}, { categories });
  assert.equal(result.hasAlternatives, false);
  assert.equal(result.hasOtherOptions, true);
  assert.equal(getPosRecommendationAction(result), 'alternative');
  assert.equal(getPosRecommendationAction(getPosRecommendationAvailability(target, [target], {}, { categories })), null);
  assert.equal(getPosRecommendationAvailability({ ...target, id: 'STALE' }, [target, other], {}, { categories }).hasAny, false);
});

test('unlinked family variants with different sizes or selling units do not create POS recommendation entry points', async () => {
  const { getPosRecommendationAvailability, getPosRecommendationAction } = await helpers;
  for (const name of ['Hollow Blocks', 'Concrete Nails', 'Coco Lumber', 'Latex Paint']) {
    const target = product('TARGET', { name, size: '5' });
    const otherSize = product('OTHER-SIZE', { name, size: '4' });
    const otherUnit = product('OTHER-UNIT', { name, size: '5', sellingUnit: 'pack' });
    const result = getPosRecommendationAvailability(target, [target, otherSize, otherUnit], {}, { categories });
    assert.deepEqual(result.alternatives, [], name);
    assert.deepEqual(result.otherOptions, [], name);
    assert.equal(getPosRecommendationAction(result), null, name);
  }
});

test('explicitly linked selling-unit differences stay View Product only and removal hides them', async () => {
  const { getPosRecommendationAvailability, prepareRecommendationCartAddition } = await helpers;
  const target = product('TARGET', { manualAlternatives: ['PACK'] });
  const pack = product('PACK', { sellingUnit: 'pack' });
  const result = getPosRecommendationAvailability(target, [target, pack, pack], {}, { categories });
  assert.deepEqual(result.alternatives, []);
  assert.deepEqual(result.otherOptions.map((item) => item.code), ['PACK']);
  assert.equal(result.otherOptions[0].posReason, 'Different selling unit: pack');
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'PACK', inventory: [target, pack], categories }).ok, false);
  const unlinked = { ...target, manualAlternatives: [] };
  assert.equal(getPosRecommendationAvailability(unlinked, [unlinked, pack], {}, { categories }).hasAny, false);
});

test('View Product resolves only the requested current SKU into normal product selection', async () => {
  const { getPosProductSelectionGroup, getPosVariantSelectionModel } = await import('../../src/utils/posVariantSelection.js');
  const candidate = product('OTHER', { size: '2x6x8 ft' });
  const selection = { id: candidate.id, code: candidate.code };
  const group = getPosProductSelectionGroup(selection, [product('TARGET'), candidate], categories);
  assert.deepEqual(group.variants, [candidate]);
  assert.equal(getPosVariantSelectionModel(group.variants).matchedVariant.code, 'OTHER');
  const updated = { ...candidate, stock: 3, price: 120 };
  assert.equal(getPosProductSelectionGroup(selection, [updated], categories).variants[0].stock, 3);
  for (const rows of [[], [{ ...candidate, id: 'REUSED' }], [{ ...candidate, isArchived: true }], [{ ...candidate, stock: 0 }]]) {
    assert.equal(getPosProductSelectionGroup(selection, rows, categories), null);
  }
});
