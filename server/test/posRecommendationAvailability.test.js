/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settings = {
  maxStockLimit: 100,
  lowStockAlert: 10,
  budgetRanges: {
    low: { min: 0, max: 100 },
    moderate: { min: 100, max: 500 },
    high: { min: 500, max: Number.MAX_SAFE_INTEGER },
  },
};

const makeProduct = (overrides) => ({
  id: overrides.code.toLowerCase(),
  code: overrides.code,
  name: overrides.name || 'Test Product',
  category: overrides.category || 'Test Category',
  brand: overrides.brand || 'Test Brand',
  size: overrides.size || 'Standard',
  color: overrides.color || '',
  imageUrl: overrides.imageUrl || '',
  price: overrides.price ?? 100,
  stock: overrides.stock ?? 20,
  sellingUnit: overrides.sellingUnit ?? 'pcs',
  manualAlternatives: overrides.manualAlternatives || [],
  excludedAlternatives: overrides.excludedAlternatives || [],
  manualBudgetOptions: overrides.manualBudgetOptions || [],
  excludedBudgetOptions: overrides.excludedBudgetOptions || [],
  isActive: overrides.isActive ?? true,
  isArchived: overrides.isArchived ?? false,
});

test('POS recommendation availability uses one alternative list at every stock state', async () => {
  const { getPosRecommendationAction, getRecommendationAvailability, getRecommendationModeForStockState } = await import('../../src/utils/recommendationLogic.js');
  const replacement = makeProduct({ code: 'ALT-001', price: 80, stock: 30 });
  const inStock = makeProduct({ code: 'IN-001', stock: 50 });
  const lowStock = makeProduct({ code: 'LOW-001', stock: 5 });
  const outOfStock = makeProduct({ code: 'OUT-001', stock: 0 });
  const inventory = [inStock, lowStock, outOfStock, replacement];

  const inStockAvailability = getRecommendationAvailability(inStock, inventory, settings);
  assert.equal(inStockAvailability.stockStatus, 'In Stock');
  assert.equal(inStockAvailability.hasAlternatives, true);
  assert.equal(inStockAvailability.hasBudgetOptions, false);
  assert.equal(getRecommendationModeForStockState(inStockAvailability), 'alternative');
  assert.equal(getPosRecommendationAction(inStockAvailability), 'alternative');

  const lowStockAvailability = getRecommendationAvailability(lowStock, inventory, settings);
  assert.equal(lowStockAvailability.stockStatus, 'Low Stock');
  assert.equal(lowStockAvailability.hasAlternatives, true);
  assert.equal(lowStockAvailability.hasBudgetOptions, false);
  assert.equal(getRecommendationModeForStockState(lowStockAvailability), 'alternative');
  assert.equal(getPosRecommendationAction(lowStockAvailability), 'alternative');

  const outOfStockAvailability = getRecommendationAvailability(outOfStock, inventory, settings);
  assert.equal(outOfStockAvailability.stockStatus, 'Out of Stock');
  assert.equal(outOfStockAvailability.hasAlternatives, true);
  assert.equal(outOfStockAvailability.hasBudgetOptions, false);
  assert.equal(getRecommendationModeForStockState(outOfStockAvailability), 'alternative');
  assert.equal(getPosRecommendationAction(outOfStockAvailability), 'alternative');
  assert.equal(getPosRecommendationAction({ stockStatus: 'In Stock', hasAlternatives: true, hasBudgetOptions: false }), 'alternative');
  assert.equal(getPosRecommendationAction({ stockStatus: 'In Stock', hasAlternatives: false, hasBudgetOptions: true }), null);
  assert.equal(getPosRecommendationAction({ stockStatus: 'In Stock', hasAlternatives: false, hasBudgetOptions: false }), null);
});

test('POS alternative add revalidates the exact active SKU and remaining cart-aware quantity', async () => {
  const { getPosRecommendationForCartAddition } = await import('../../src/utils/recommendationLogic.js');
  const target = makeProduct({ code: 'TARGET-CART', manualAlternatives: ['ALT-CART'] });
  const alternative = makeProduct({ code: 'ALT-CART', stock: 5, sellingUnit: 'can', price: 123, color: 'White', attributes: { finish: 'Gloss' } });
  const inventory = [target, alternative];
  const cart = [{ ...alternative, qty: 2 }];
  const common = {
    targetCode: target.code,
    targetId: target.id,
    candidateCode: alternative.code,
    candidateId: alternative.id,
    inventory,
    cart,
    settings,
  };

  const exactAvailable = getPosRecommendationForCartAddition({ ...common, requestedQuantity: 3 });
  assert.equal(exactAvailable.ok, true);
  assert.equal(exactAvailable.product.code, alternative.code);
  assert.equal(exactAvailable.product.recommendation.availability.availableQuantity, 3);
  assert.equal(exactAvailable.product.price, alternative.price);
  assert.equal(exactAvailable.product.sellingUnit, alternative.sellingUnit);
  assert.equal(exactAvailable.product.color, alternative.color);
  assert.deepEqual(exactAvailable.product.attributes, alternative.attributes);

  const overCartLimit = getPosRecommendationForCartAddition({ ...common, requestedQuantity: 4 });
  assert.equal(overCartLimit.ok, false);
  assert.match(overCartLimit.error, /Only 3 can available/);

  const duplicateCartLines = getPosRecommendationForCartAddition({
    ...common,
    cart: [{ ...alternative, qty: 2 }, { ...alternative, qty: 2 }],
    requestedQuantity: 2,
  });
  assert.equal(duplicateCartLines.ok, false);
  assert.match(duplicateCartLines.error, /Only 1 can available/);

  const refreshedStock = getPosRecommendationForCartAddition({
    ...common,
    inventory: [target, { ...alternative, stock: 3 }],
    requestedQuantity: 2,
  });
  assert.equal(refreshedStock.ok, false);
  assert.match(refreshedStock.error, /Only 1 can available/);

  const inactive = getPosRecommendationForCartAddition({
    ...common,
    inventory: [target, { ...alternative, isActive: false }],
    requestedQuantity: 1,
  });
  assert.equal(inactive.ok, false);
  assert.match(inactive.error, /no longer available/);
});

test('POS alternative cards add directly with per-card quantities instead of opening a product modal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const recommendationModal = source.slice(source.indexOf('{/* Recommendation Modal */}'), source.indexOf('{enlargedProductImage && (', source.indexOf('{/* Recommendation Modal */}')));
  const addHandler = source.slice(source.indexOf('const addRecommendedAlternativeToCart'), source.indexOf('const getRecommendationResults'));
  const cartMerge = source.slice(source.indexOf('const getCartAdditionResult'), source.indexOf('const addToCart'));

  assert.match(recommendationModal, /aria-modal="true"/);
  assert.match(recommendationModal, /aria-label=\{`Quantity to add for \$\{alt\.name\}`\}/);
  assert.match(recommendationModal, /Decrease quantity for/);
  assert.match(recommendationModal, /Increase quantity for/);
  assert.match(recommendationModal, /Add to Cart/);
  assert.doesNotMatch(recommendationModal, /View Product/);
  assert.match(addHandler, /getPosRecommendationForCartAddition/);
  assert.match(addHandler, /addToCart\(result\.product, true, \{/);
  assert.match(addHandler, /fromVariantModal: true/);
  assert.match(cartMerge, /previousCart\.map\(item => item\.code === product\.code/);
  assert.match(cartMerge, /\[\.\.\.previousCart, \{ \.\.\.product, qty: requestedQty \}\]/);
  assert.doesNotMatch(addHandler, /setCart\(/);
});

test('POS unifies managed relationships and honors either legacy exclusion list', async () => {
  const { getRecommendationAvailability } = await import('../../src/utils/recommendationLogic.js');
  const target = makeProduct({
    code: 'TARGET-MANAGED',
    name: 'Managed Target',
    stock: 30,
    manualAlternatives: ['MANUAL-ALT', 'UNRELATED'],
    excludedAlternatives: ['AUTO-ALT'],
    manualBudgetOptions: ['MANUAL-BUDGET'],
    excludedBudgetOptions: ['AUTO-BUDGET'],
  });
  const manualAlt = makeProduct({ code: 'MANUAL-ALT', name: 'Managed Target', brand: 'Other', imageUrl: 'manual-alt.png' });
  const manualBudget = makeProduct({ code: 'MANUAL-BUDGET', name: 'Managed Target', brand: 'Another', price: 70, imageUrl: 'manual-budget.png' });
  const unrelated = makeProduct({ code: 'UNRELATED', name: 'Unrelated Alternative', category: 'Other' });
  const autoAlt = makeProduct({ code: 'AUTO-ALT', name: 'Managed Target Plus' });
  const autoBudget = makeProduct({ code: 'AUTO-BUDGET', name: 'Managed Target Value', price: 60 });
  const availability = getRecommendationAvailability(target, [target, manualAlt, manualBudget, unrelated, autoAlt, autoBudget], settings);

  assert.ok(availability.alternatives.some((item) => item.code === 'MANUAL-ALT' && item.imageUrl === 'manual-alt.png'));
  assert.ok(!availability.alternatives.some((item) => item.code === 'AUTO-ALT'));
  assert.ok(availability.alternatives.some((item) => item.code === 'MANUAL-BUDGET' && item.imageUrl === 'manual-budget.png'));
  assert.ok(!availability.alternatives.some((item) => item.code === 'AUTO-BUDGET'));
  assert.deepEqual(availability.budgetOptions, []);
  assert.ok(!availability.alternatives.some((item) => item.code === 'UNRELATED'));
  assert.deepEqual(target.manualAlternatives, ['MANUAL-ALT', 'UNRELATED']);
});

test('group indicators and exact child SKU resolution use child recommendation availability', async () => {
  const { getRecommendationAvailability } = await import('../../src/utils/recommendationLogic.js');
  const eligibleChild = makeProduct({ code: 'GROUP-001', name: 'Grouped Item', stock: 30, manualAlternatives: ['ALT-002'] });
  const noRecommendationChild = makeProduct({ code: 'GROUP-002', name: 'SolitaryWidget', category: 'Isolated', brand: 'Unique', size: 'Unique', stock: 30 });
  const replacement = makeProduct({ code: 'ALT-002', name: 'Grouped Item', stock: 25 });
  const inventory = [eligibleChild, noRecommendationChild, replacement];

  const eligible = getRecommendationAvailability(eligibleChild, inventory, settings);
  const unavailable = getRecommendationAvailability(noRecommendationChild, inventory, settings);

  assert.equal(eligible.hasAny, true);
  assert.equal(eligible.alternatives[0].code, 'ALT-002');
  assert.equal(unavailable.hasAny, false);
  assert.equal([eligibleChild, noRecommendationChild].some((child) => (
    getRecommendationAvailability(child, inventory, settings).hasAny
  )), true);
});

test('no-recommendation state stays empty and relative price tiers retain existing boundaries', async () => {
  const { getRecommendationAvailability, getRecommendationModeForStockState, getRelativePriceTier } = await import('../../src/utils/recommendationLogic.js');
  const isolated = makeProduct({ code: 'NONE-001', category: 'Only Category', brand: 'Only Brand', size: 'Only Size', stock: 30 });
  const availability = getRecommendationAvailability(isolated, [isolated], settings);

  assert.equal(availability.hasAny, false);
  assert.equal(getRecommendationModeForStockState(availability), null);
  assert.deepEqual(availability.alternatives, []);
  assert.deepEqual(availability.budgetOptions, []);
  assert.equal(getRelativePriceTier(100, 79), 'value');
  assert.equal(getRelativePriceTier(100, 80), 'standard');
  assert.equal(getRelativePriceTier(100, 120), 'standard');
  assert.equal(getRelativePriceTier(100, 121), 'premium');
});

test('managed budget additions and removals feed the existing dynamic price classification', async () => {
  const { getAlternativesByBudget } = await import('../../src/utils/recommendationLogic.js');
  const target = makeProduct({ code: 'TARGET-001', name: 'Target Widget', stock: 30, price: 100, manualBudgetOptions: ['MANUAL-001'], excludedBudgetOptions: ['AUTO-001'] });
  const manual = makeProduct({ code: 'MANUAL-001', name: 'Target Widget', stock: 20, price: 70 });
  const automatic = makeProduct({ code: 'AUTO-001', name: 'Target Widget Plus', stock: 20, price: 90 });
  const buckets = getAlternativesByBudget(target, [target, manual, automatic], { lowStockAlert: 10, maxStockLimit: 100 }, { limitPerTier: 10, maxSuggestions: 20 });

  assert.ok(buckets.low.some((item) => item.code === 'MANUAL-001'));
  assert.ok(!Object.values(buckets).flat().some((item) => item.code === 'AUTO-001'));
  assert.equal(buckets.low.find((item) => item.code === 'MANUAL-001').recommendationTier, 'value');
});

test('manual recommendation picker keeps the full eligible inventory and ranks without hiding candidates', async () => {
  const { getManualRecommendationCandidates } = await import('../../src/utils/recommendationLogic.js');
  const target = makeProduct({ id: 'target-id', code: 'TARGET-001', name: 'Target Item', stock: 20 });
  const products = Array.from({ length: 65 }, (_, index) => makeProduct({
    id: `candidate-${index}`,
    code: `CAND-${String(index).padStart(3, '0')}`,
    name: `Candidate ${index}`,
    stock: index === 64 ? 0 : 20,
  }));
  products.push(target);
  products.push(makeProduct({ id: 'archived-id', code: 'ARCH-001', isActive: false }));
  products.push(makeProduct({ id: 'duplicate-id', code: 'CAND-001', name: 'Duplicate SKU' }));
  products.push({ code: 'NO-ID', name: 'Malformed' });

  const results = getManualRecommendationCandidates(target, products, {
    existingCodes: ['CAND-002'],
    systemCodes: ['CAND-060'],
    recommendationType: 'alternative',
  });

  assert.equal(results.length, 64);
  assert.equal(results[0].code, 'CAND-060');
  assert.ok(results.some((item) => item.code === 'CAND-064' && item.stock === 0));
  assert.ok(!results.some((item) => item.code === target.code || item.code === 'ARCH-001' || item.code === 'CAND-002' || item.code === 'NO-ID'));
  assert.equal(results.filter((item) => item.code === 'CAND-001').length, 1);

  const budgetResults = getManualRecommendationCandidates(target, products, {
    systemCodes: ['CAND-060'],
    recommendationType: 'budget',
  });
  assert.equal(budgetResults.find((item) => item.code === 'CAND-060').isSystemRecommended, false);

  const mixedShapeResults = getManualRecommendationCandidates(target, [
    { _id: 'single-id', sku: 'GI-001', name: 'GI Corrugated Sheet', category: 'Roofing', stock: 10, price: 500, isActive: true },
    { _id: 'child-id', sku: 'PVC-CHILD-001', name: 'PVC Pipe', category: 'Plumbing', size: '1/2in', stock: 8, price: 80, isActive: true },
  ]);
  assert.deepEqual(mixedShapeResults.map((item) => item.code).sort(), ['GI-001', 'PVC-CHILD-001']);
  assert.ok(mixedShapeResults.every((item) => item.id));
});

test('budget preview selects up to three representative options from the View All collection', async () => {
  const { getBudgetPreviewOptions } = await import('../../src/utils/recommendationLogic.js');
  const valueA = makeProduct({ code: 'VALUE-A', price: 60 });
  const valueB = makeProduct({ code: 'VALUE-B', price: 70 });
  const premiumA = makeProduct({ code: 'PREMIUM-A', price: 140 });
  const premiumB = makeProduct({ code: 'PREMIUM-B', price: 150 });
  const preview = getBudgetPreviewOptions({ low: [valueA, valueB], moderate: [], high: [premiumA, premiumB] }, 3);

  assert.deepEqual(preview.allOptions.map((item) => item.code), ['VALUE-A', 'VALUE-B', 'PREMIUM-A', 'PREMIUM-B']);
  assert.deepEqual(preview.visibleOptions.map((item) => item.code), ['VALUE-A', 'PREMIUM-A', 'VALUE-B']);
  assert.equal(preview.hiddenCount, 1);
  assert.ok(preview.visibleOptions.every((item) => preview.allOptions.includes(item)));
  assert.equal(getBudgetPreviewOptions({ low: [valueA], moderate: [], high: [] }, 3).hiddenCount, 0);
});

test('Current Product summary contains one Alternative Products count', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Recommendation.jsx'), 'utf8');
  const summarySection = source.slice(
    source.indexOf('aria-label="Recommendation Summary"'),
    source.indexOf('/* Button to view full product details */')
  );

  assert.match(summarySection, /Alternative Products/);
  assert.doesNotMatch(summarySection, /Budget Options/);
});

test('POS recommendation entry opens Alternative Products without the legacy chooser', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const productCardSection = source.slice(source.indexOf('/* Product List */'), source.indexOf('/* Pagination Controls */'));

  assert.doesNotMatch(productCardSection, /Recommendations available/);
  assert.match(productCardSection, /View Recommendations/);
  assert.match(productCardSection, /const recommendationLabel = 'Recommendations'/);
  assert.doesNotMatch(productCardSection, /'View Alternatives'/);
  assert.doesNotMatch(productCardSection, /'Alternatives available'/);
  assert.doesNotMatch(productCardSection, /'Budget options available'/);
  assert.doesNotMatch(source, /Back to Recommendation Type|Choose Recommendation Type|Budget Options/);
  assert.match(source, /Alternative Products/);
});

test('grouped SKU selector keeps quantity, primary cart action, then recommendations in one fixed action stack', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const actionStack = source.slice(source.indexOf('className="shrink-0 border-t border-slate-200 bg-white p-4"'));

  assert.match(actionStack, /max=\{maxSelectableQty\}/);
  assert.match(actionStack, /inline-flex shrink-0 items-center overflow-hidden rounded-lg/);
  assert.match(actionStack, /className=\{`flex h-10 w-full/);
  assert.match(actionStack, /className="mt-2 flex h-9 w-full/);
  assert.ok(actionStack.indexOf('disabled={isPrimaryDisabled}') < actionStack.indexOf('selectedRecommendationAction && ('));
});

test('grouped SKU selector uses the selected controls as the source of option context without duplicate chips', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const modalStart = source.indexOf('{/* Variant Picker Modal */}');
  const selectorBody = source.slice(source.indexOf('const selectionModel = getPosAttributeSelectionModel(', modalStart), source.indexOf('className="shrink-0 border-t border-slate-200 bg-white p-4"', modalStart));

  assert.match(selectorBody, /bg-slate-50\/70/);
  assert.match(selectorBody, /Available Stock/);
  assert.match(selectorBody, /selectionModel.groups.map/);
  assert.match(selectorBody, /selectionModel.codeOptions.map/);
  assert.doesNotMatch(selectorBody, /hasSelectedSize && <span/);
  assert.doesNotMatch(selectorBody, /hasSelectedColor && <span/);
  assert.match(selectorBody, /border-slate-900 bg-slate-900 text-white/);
});

test('POS product cards use restrained semantic stock accents and stack unavailable actions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const productCardSection = source.slice(source.indexOf('/* Product List */'), source.indexOf('/* Pagination Controls */'));

  assert.match(productCardSection, /border border-slate-100 bg-white/);
  assert.match(productCardSection, /hover:border-emerald-300 hover:bg-emerald-50\/20 hover:shadow-lg/);
  assert.match(productCardSection, /hover:border-amber-400 hover:bg-amber-50\/20 hover:shadow-lg/);
  assert.match(productCardSection, /border-slate-100 hover:border-red-400 hover:bg-red-50\/20 hover:shadow-md/);
  assert.match(productCardSection, /isOutOfStock \? 'flex-col items-stretch gap-1\.5'/);
  assert.match(productCardSection, /inline-flex h-7 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md/);
  assert.match(productCardSection, /flex h-7 w-full items-center justify-center gap-1\.5 rounded-md bg-slate-900 text-\[10px\] font-medium/);
  assert.match(productCardSection, /flex h-7 w-full items-center justify-center rounded-md bg-slate-900 text-\[10px\] font-medium/);
  assert.match(productCardSection, /View Recommendations/);
  assert.match(productCardSection, /whitespace-nowrap text-\[9px\] font-medium text-slate-400/);
});
