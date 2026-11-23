/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');

const logic = import('../../src/utils/recommendationLogic.js');
const categories = [{
  name: 'Electrical', attributeSchemaVersion: 1,
  productAttributes: [
    { key: 'product_type', name: 'Product Type', type: 'select', options: ['Electrical Tape', 'Electrical Wire'] },
    { key: 'width', name: 'Width', type: 'number_unit', unit: 'mm' },
    { key: 'material', name: 'Material', type: 'text' },
    { key: 'brand', name: 'Brand', type: 'text' },
  ],
}];
const settings = { maxStockLimit: 100, lowStockAlert: 30 };
const product = (code, overrides = {}) => ({
  id: code.toLowerCase(), code, name: 'Electrical Tape', category: 'Electrical', sellingUnit: 'roll',
  attributes: { product_type: 'Electrical Tape', width: 19, material: 'PVC', brand: 'Original' },
  stock: 25, price: 100, imageUrl: `${code}.png`, isActive: true,
  manualAlternatives: [], excludedAlternatives: [], manualBudgetOptions: [], excludedBudgetOptions: [],
  ...overrides,
});
const options = { categories, maxSuggestions: 100 };

test('category, brand and generic keywords alone cannot identify automatic substitutes', async () => {
  const { getAlternatives } = await logic;
  const target = product('TARGET');
  const wire = product('WIRE', { name: 'Electrical Wire', attributes: { product_type: 'Electrical Wire', width: 19, material: 'PVC', brand: 'Original' } });
  const sameBrand = product('BRAND', { name: 'Floor Cleaner', category: 'Cleaning' });
  const keyword = product('KEYWORD', { name: 'Electrical Conduit', attributes: {} });
  assert.deepEqual(getAlternatives(target, [wire, sameBrand, keyword], settings, options), []);
});

test('blank attributes never count as evidence, even for identical names and categories', async () => {
  const { evaluateRecommendation, getAlternatives } = await logic;
  const target = product('TARGET', { attributes: {} });
  const candidate = product('EMPTY', { attributes: { product_type: ' ', width: '', material: '', brand: '' } });
  const result = evaluateRecommendation(target, candidate, options);
  assert.deepEqual(result.matchedAttributes, []);
  assert.equal(result.missingAttributes.length, 4);
  assert.equal(result.compatibility.status, 'insufficient_evidence');
  assert.deepEqual(getAlternatives(target, [candidate], settings, options), []);
});

test('documented type and exact specifications produce factual unverified automatic results', async () => {
  const { getAlternatives } = await logic;
  const target = product('TARGET');
  const candidate = product('OTHER-SKU', { name: 'Another Tape', price: 50, imageUrl: 'variant-specific.png', attributes: { ...target.attributes, brand: 'Other Brand' } });
  const [result] = getAlternatives(target, [candidate], settings, options);
  assert.equal(result.code, 'OTHER-SKU');
  assert.equal(result.id, 'other-sku');
  assert.equal(result.imageUrl, 'variant-specific.png');
  assert.equal(result.price, 50);
  assert.equal(result.recommendation.source, 'automatic');
  assert.equal(result.recommendation.compatibility.status, 'matching_recorded_specs');
  assert.equal(result.recommendation.compatibility.verified, false);
  assert.equal(result.recommendation.compatibility.policyStatus, 'not_configured');
  assert.ok(result.recommendation.matchedAttributes.some((row) => row.key === 'width' && row.candidateValue === 19 && row.unit === 'mm'));
  assert.ok(result.recommendation.differences.some((row) => row.key === 'brand'));
  assert.equal(result.recommendation.priceComparison.difference, -50);
  assert.equal(result.recommendation.availability.stockStatus, 'Low Stock');
  assert.equal(result.recommendation.similarityPercentage, undefined);
  assert.equal(result.recommendation.score, undefined);
});

test('recorded size, grade, rating, material or application conflicts cannot be overridden by a manual link', async () => {
  const { getAlternatives } = await logic;
  for (const key of ['width', 'size', 'grade', 'electrical_rating', 'material', 'intended_application', 'finish']) {
    const definition = { key, name: key, type: 'text' };
    const schema = [{ ...categories[0], productAttributes: [categories[0].productAttributes[0], definition] }];
    const target = product('TARGET', { attributes: { product_type: 'Electrical Tape', [key]: 'A' }, manualAlternatives: ['CONFLICT'] });
    const candidate = product('CONFLICT', { attributes: { product_type: 'Electrical Tape', [key]: 'B' } });
    const opts = { categories: schema };
    assert.deepEqual(getAlternatives(target, [candidate], settings, opts), [], key);
    const [review] = getAlternatives(target, [candidate], settings, { ...opts, includeUnavailable: true });
    assert.equal(review.recommendation.compatibility.status, 'specification_conflict', key);
    assert.equal(review.recommendation.actionable, false);
    assert.equal(review.recommendation.source, 'admin-managed');
    assert.equal(review.recommendation.differences[0].key, key);
    assert.deepEqual(target.manualAlternatives, ['CONFLICT']);
  }
});

test('missing specifications retain manual links for Admin review without POS actionability', async () => {
  const { getAlternatives } = await logic;
  const target = product('TARGET', { manualAlternatives: ['MANUAL'] });
  const candidate = product('MANUAL', { name: 'Business Choice', attributes: { product_type: 'Electrical Tape' } });
  assert.deepEqual(getAlternatives(target, [candidate], settings, options), []);
  const [result] = getAlternatives(target, [candidate], settings, { ...options, includeUnavailable: true });
  assert.equal(result.recommendation.source, 'admin-managed');
  assert.equal(result.recommendation.compatibility.verified, false);
  assert.equal(result.recommendation.actionable, false);
  assert.equal(result.recommendation.adminJustification.status, 'not_recorded');
  assert.equal(result.recommendation.adminJustification.text, null);
  assert.ok(result.recommendation.missingAttributes.some((row) => row.key === 'width'));
  assert.deepEqual(getAlternatives(product('TARGET'), [candidate], settings, options), []);
});

test('legacy relationships stay intact while either exclusion blocks the unified list', async () => {
  const { getAlternatives, getAlternativesByBudget } = await logic;
  const target = product('TARGET', { stock: 50, manualAlternatives: ['ALT'], excludedAlternatives: ['EXCLUDED'], manualBudgetOptions: ['BUDGET'], excludedBudgetOptions: ['ALT'] });
  const inventory = [product('ALT'), product('EXCLUDED'), product('BUDGET')];
  const before = JSON.stringify({ target, inventory });
  assert.ok(!getAlternatives(target, inventory, settings, options).some((item) => item.code === 'ALT'));
  assert.ok(!getAlternatives(target, inventory, settings, options).some((item) => item.code === 'EXCLUDED'));
  const budget = Object.values(getAlternativesByBudget(target, inventory, settings, options)).flat();
  assert.ok(budget.some((item) => item.code === 'BUDGET' && item.recommendation.relationshipType === 'budget'));
  assert.ok(!budget.some((item) => item.code === 'ALT'));
  assert.equal(JSON.stringify({ target, inventory }), before);
});

test('zero, invalid and insufficient stock is not sellable; stored choices remain available for admin review', async () => {
  const { getAlternatives } = await logic;
  for (const stock of [0, -1, NaN, 2]) {
    const target = product('TARGET', { manualAlternatives: ['MANUAL'] });
    const candidate = product('MANUAL', { stock });
    const opts = { ...options, requestedQuantity: 3 };
    assert.deepEqual(getAlternatives(target, [candidate], settings, opts), []);
    const [review] = getAlternatives(target, [candidate], settings, { ...opts, includeUnavailable: true });
    assert.equal(review.recommendation.availability.canFulfill, false);
    assert.equal(review.recommendation.actionable, false);
  }
});

test('requested quantity includes units already in the cart and uses configured stock thresholds', async () => {
  const { getAlternatives } = await logic;
  const target = product('TARGET');
  const candidate = product('CANDIDATE', { stock: 25 });
  const opts = { ...options, requestedQuantity: 6, cart: [{ code: 'CANDIDATE', qty: 20 }] };
  assert.deepEqual(getAlternatives(target, [candidate], settings, opts), []);
  const [result] = getAlternatives(target, [candidate], settings, { ...opts, requestedQuantity: 5 });
  assert.equal(result.recommendation.availability.availableQuantity, 5);
  assert.equal(result.recommendation.availability.stockStatus, 'Low Stock');
  const [otherThreshold] = getAlternatives(target, [candidate], { ...settings, lowStockAlert: 5 }, options);
  assert.equal(otherThreshold.recommendation.availability.stockStatus, 'In Stock');
});

test('different or absent selling units never create savings or budget claims', async () => {
  const { getAlternatives, getAlternativesByBudget } = await logic;
  const target = product('TARGET', { stock: 50, manualAlternatives: ['OTHER'], manualBudgetOptions: ['OTHER'] });
  for (const sellingUnit of ['box', '']) {
    const candidate = product('OTHER', { sellingUnit, price: 1 });
    const [review] = getAlternatives(target, [candidate], settings, { ...options, includeUnavailable: true });
    assert.equal(review.recommendation.priceComparison.comparable, false);
    assert.equal(review.recommendation.priceComparison.difference, null);
    assert.equal(review.recommendationTier, null);
    assert.equal(Object.values(getAlternativesByBudget(target, [candidate], settings, options)).flat().length, 0);
    const storedBudget = Object.values(getAlternativesByBudget(target, [candidate], settings, { ...options, includeUnavailable: true })).flat();
    assert.equal(storedBudget.length, 1);
    assert.equal(storedBudget[0].recommendationTier, null);
  }
});

test('attribute schema unit differences are disclosed rather than numerically equated', async () => {
  const { evaluateRecommendation } = await logic;
  const schema = [...categories, { ...categories[0], name: 'Other', productAttributes: categories[0].productAttributes.map((row) => row.key === 'width' ? { ...row, unit: 'cm' } : row) }];
  const result = evaluateRecommendation(product('TARGET'), product('CANDIDATE', { category: 'Other' }), { categories: schema, source: 'admin-managed' });
  assert.equal(result.actionable, false);
  assert.ok(result.differences.some((row) => row.key === 'width' && row.unit === 'mm' && row.candidateUnit === 'cm'));
});

test('attributes without definitions prevent automatic compatibility assumptions', async () => {
  const { getAlternatives, evaluateRecommendation } = await logic;
  const target = product('TARGET', { size: '19mm' });
  const candidate = product('OTHER', { size: '19mm' });
  assert.deepEqual(getAlternatives(target, [candidate], settings), []);
  const result = evaluateRecommendation(target, candidate);
  assert.ok(result.dataLimitations.length > 0);
  assert.equal(result.compatibility.verified, false);
});

test('ranking uses recorded specification evidence before price without a numeric compatibility score', async () => {
  const { getAlternatives } = await logic;
  const target = product('TARGET');
  const a = product('A', { price: 80 });
  const b = product('B', { price: 90 });
  assert.deepEqual(getAlternatives(target, [a, b], settings, options).map((row) => row.code), ['B', 'A']);
  // Brands do not inflate evidence or make a distant price rank above an equally specified product.
  a.attributes.brand = 'Original'; b.attributes.brand = 'Different';
  assert.deepEqual(getAlternatives(target, [a, b], settings, options).map((row) => row.code), ['B', 'A']);
  const managed = product('TARGET', { manualAlternatives: ['MISSING', 'FULL'] });
  const missing = product('MISSING', { price: 99, attributes: { product_type: 'Electrical Tape' } });
  const full = product('FULL', { price: 50 });
  assert.deepEqual(getAlternatives(managed, [missing, full], settings, options).map((row) => row.code), ['FULL']);
  assert.deepEqual(getAlternatives(managed, [missing, full], settings, { ...options, includeUnavailable: true }).map((row) => row.code), ['FULL', 'MISSING']);
});

test('open management snapshots resolve latest target exclusions and prices', async () => {
  const { getAlternatives } = await logic;
  const snapshot = product('TARGET');
  const latest = product('TARGET', { price: 200 });
  const candidate = product('OTHER', { price: 150 });
  const [result] = getAlternatives(snapshot, [latest, candidate], settings, options);
  assert.equal(result.recommendation.priceComparison.difference, -50);
  latest.excludedAlternatives = ['OTHER'];
  assert.deepEqual(getAlternatives(snapshot, [latest, candidate], settings, options), []);
});

test('unconfigured conflicting facts and inactive SKUs cannot become manual POS alternatives', async () => {
  const { getAlternatives } = await logic;
  const target = product('TARGET', { manualAlternatives: ['OTHER'], size: '19mm', attributes: { rating: '600V' } });
  const conflicting = product('OTHER', { size: '19mm', attributes: { rating: '300V' } });
  assert.deepEqual(getAlternatives(target, [conflicting], settings), []);
  const inactive = product('OTHER', { isActive: false, attributes: { rating: '600V' } });
  assert.deepEqual(getAlternatives(target, [inactive], settings), []);
  assert.equal(getAlternatives(target, [inactive], settings, { includeUnavailable: true }).length, 0);
});

test('POS selection fails without changing cart when current inventory cannot fulfill the request', async () => {
  const { prepareRecommendationCartAddition } = await logic;
  const target = product('TARGET');
  const candidate = product('OTHER', { stock: 2 });
  const cart = [{ code: 'OTHER', qty: 2 }];
  const result = prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'OTHER', inventory: [target, candidate], cart, settings, categories });
  assert.equal(result.ok, false);
  assert.match(result.error, /Only 0 additional roll available/);
  assert.deepEqual(cart, [{ code: 'OTHER', qty: 2 }]);
  assert.equal(result.cart, undefined);
});

test('POS selection rechecks exclusions and commits current variant data only on success', async () => {
  const { prepareRecommendationCartAddition } = await logic;
  const target = product('TARGET');
  const candidate = product('OTHER', { price: 55, imageUrl: 'current-variant.png' });
  const args = { targetCode: 'TARGET', candidateCode: 'OTHER', inventory: [target, candidate], settings, categories, requestedQuantity: 3 };
  assert.equal(prepareRecommendationCartAddition(args).ok, false);
  target.recommendationReviews = [{ targetSku: 'TARGET', candidateProduct: candidate.id, candidateSku: 'OTHER', decision: 'approved' }];
  const result = prepareRecommendationCartAddition(args);
  assert.equal(result.ok, true);
  assert.equal(result.cart[0].qty, 3);
  assert.equal(result.cart[0].price, 55);
  assert.equal(result.cart[0].imageUrl, 'current-variant.png');
  target.excludedAlternatives = ['OTHER'];
  assert.equal(prepareRecommendationCartAddition(args).ok, false);
});

test('manual POS substitutes require positive identity and complete recorded evidence without deleting history', async () => {
  const { getAlternatives, getAlternativesByBudget, prepareRecommendationCartAddition } = await logic;
  const cases = [
    ['different product type', { name: 'Electrical Wire', attributes: { ...product('BASE').attributes, product_type: 'Electrical Wire' } }, 'specification_conflict'],
    ['missing product type', { name: 'Electrical Wire', attributes: { width: 19, material: 'PVC', brand: 'Original' } }, 'insufficient_evidence'],
    ['missing width', { attributes: { product_type: 'Electrical Tape', material: 'PVC' } }, 'insufficient_evidence'],
    ['category and brand only', { name: 'Electrical Wire', attributes: { brand: 'Original' } }, 'insufficient_evidence'],
    ['cross-category history', { category: 'Other' }, 'insufficient_evidence'],
    ['missing selling unit', { sellingUnit: '' }, 'insufficient_evidence'],
    ['unconfigured evidence', { attributes: { ...product('BASE').attributes, unknown_rating: '600V' } }, 'insufficient_evidence'],
  ];
  for (const [label, overrides, status] of cases) {
    const target = product('TARGET', { stock: 50, manualAlternatives: ['OTHER'], manualBudgetOptions: ['OTHER'], recommendationBases: [{ type: 'alternative', targetSku: 'TARGET', candidateProduct: 'other', candidateSku: 'OTHER', justification: 'Historical staff choice.' }] });
    const candidate = product('OTHER', overrides);
    const inventory = [target, candidate];
    const before = JSON.stringify(inventory);
    assert.deepEqual(getAlternatives(target, inventory, settings, options), [], label);
    assert.deepEqual(Object.values(getAlternativesByBudget(target, inventory, settings, options)).flat(), [], label);
    const [review] = getAlternatives(target, inventory, settings, { ...options, includeUnavailable: true });
    assert.equal(review.recommendation.compatibility.status, status, label);
    assert.equal(review.recommendation.actionable, false, label);
    assert.equal(review.recommendation.adminJustification.text, 'Historical staff choice.', label);
    for (const kind of ['alternative', 'budget']) {
      const result = prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'OTHER', inventory, cart: [], settings, categories, kind });
      assert.equal(result.ok, false, `${label}: ${kind}`);
      assert.equal(result.cart, undefined, label);
    }
    assert.equal(JSON.stringify(inventory), before, label);
  }
});

test('matching manual identities remain eligible but unverified and selection rechecks changing evidence and availability', async () => {
  const { getAlternatives, prepareRecommendationCartAddition } = await logic;
  const target = product('TARGET', { manualAlternatives: ['OTHER'] });
  const candidate = product('OTHER', { name: 'Another Tape', stock: 5 });
  const args = { targetCode: 'TARGET', candidateCode: 'OTHER', inventory: [target, candidate], cart: [{ code: 'OTHER', qty: 2 }], requestedQuantity: 3, settings, categories };
  const [shown] = getAlternatives(target, args.inventory, settings, { ...options, cart: args.cart, requestedQuantity: 3 });
  assert.equal(shown.recommendation.actionable, true);
  assert.equal(shown.recommendation.compatibility.verified, false);
  assert.equal(prepareRecommendationCartAddition(args).cart[0].qty, 5);
  for (const changes of [{ stock: 4 }, { isActive: false }, { isArchived: true }, { attributes: { product_type: 'Electrical Tape' } }, { attributes: { ...candidate.attributes, width: 50 } }]) {
    const result = prepareRecommendationCartAddition({ ...args, inventory: [target, { ...candidate, ...changes }] });
    assert.equal(result.ok, false);
    assert.equal(result.cart, undefined);
    assert.equal(args.cart[0].qty, 2);
  }
  for (const requestedQuantity of [0, -1, 1.5, NaN]) {
    assert.equal(prepareRecommendationCartAddition({ ...args, requestedQuantity }).ok, false);
  }
  target.excludedAlternatives = ['OTHER'];
  assert.equal(prepareRecommendationCartAddition(args).ok, false);
});
