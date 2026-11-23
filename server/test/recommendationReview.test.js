/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = import('../../src/utils/recommendationLogic.js');
const presentation = import('../../src/utils/recommendationPresentation.js');
const product = (code, extra = {}) => ({ id: code, code, name: 'Tape', category: 'Electrical', size: '19mm', sellingUnit: 'roll', stock: 20, price: 100, ...extra });
const target = product('TARGET', { stock: 50 });
const candidate = product('ALT', { price: 80 });
const review = (extra = {}) => ({ targetSku: 'TARGET', candidateProduct: 'ALT', candidateSku: 'ALT', decision: 'approved', justification: 'Staff reason.', limitations: 'Check application.', reviewReason: 'Reviewed specifications.', revision: 1, ...extra });

test('unified list deduplicates automatic/manual/budget overlap and retains primary and legacy basis', async () => {
  const { getAlternatives, getRecommendationAvailability } = await logic;
  const configured = { ...target, manualAlternatives: ['ALT'], manualBudgetOptions: ['ALT'], recommendationBases: [
    { type: 'alternative', candidateProduct: 'ALT', candidateSku: 'ALT', justification: 'Primary reason.' },
    { type: 'budget', candidateProduct: 'ALT', candidateSku: 'ALT', justification: 'Legacy reason.' },
  ] };
  const before = JSON.stringify(configured);
  const list = getAlternatives(configured, [configured, candidate, candidate], {});
  assert.equal(list.length, 1);
  assert.equal(list[0].recommendation.adminJustification.text, 'Primary reason.');
  assert.equal(list[0].recommendation.basisRelationshipType, 'alternative');
  const budgetOnly = { ...configured, manualAlternatives: [] };
  const [legacy] = getAlternatives(budgetOnly, [candidate], {});
  assert.equal(legacy.recommendation.adminJustification.text, 'Legacy reason.');
  assert.equal(legacy.recommendation.basisRelationshipType, 'budget');
  assert.equal(getRecommendationAvailability(configured, [candidate], {}).alternatives.length, 1);
  assert.equal(JSON.stringify(configured), before);
});

test('manual, automatic and mixed actions follow stored links and current system suggestions', async () => {
  const { getAlternatives, getRawSystemRecommendations } = await logic;
  const { getRecommendationActionSources } = await import('../../src/utils/recommendationBasis.js');
  const systemCodes = (requested, item = candidate) => new Set(getRawSystemRecommendations(requested, [item], {}).map((entry) => entry.code));
  const automatic = getAlternatives(target, [candidate], {})[0];
  assert.deepEqual(getRecommendationActionSources(target, automatic, systemCodes(target)), { manual: false, automatic: true, manualType: null, overlappingBasis: false });

  const linked = { ...target, manualAlternatives: ['ALT'] };
  const mixed = getAlternatives(linked, [candidate], {})[0];
  assert.deepEqual(getRecommendationActionSources(linked, mixed, systemCodes(linked)), { manual: true, automatic: false, manualType: 'alternative', overlappingBasis: false });
  const mixedSource = { ...linked, recommendationBases: [{ type: 'alternative', targetSku: 'TARGET', candidateProduct: 'ALT', candidateSku: 'ALT', systemGenerated: true }] };
  const [mixedSourceEntry] = getAlternatives(mixedSource, [candidate], {});
  assert.deepEqual(getRecommendationActionSources(mixedSource, mixedSourceEntry, systemCodes(mixedSource)), { manual: true, automatic: true, manualType: 'alternative', overlappingBasis: false });
  const afterRemove = { ...linked, manualAlternatives: [] };
  assert.equal(getAlternatives(afterRemove, [candidate], {})[0].recommendation.source, 'automatic');

  const incomplete = { ...candidate, size: '' };
  const manualOnly = getAlternatives(linked, [incomplete], {}, { includeUnavailable: true })[0];
  assert.deepEqual(getRecommendationActionSources(linked, manualOnly, systemCodes(linked, incomplete)), { manual: true, automatic: false, manualType: 'alternative', overlappingBasis: false });
  assert.deepEqual(getAlternatives(afterRemove, [incomplete], {}), []);

  const rejected = { ...linked, recommendationReviews: [review({ decision: 'rejected' })] };
  const [manualWithRejectedSystemReview] = getAlternatives(rejected, [candidate], {});
  assert.equal(manualWithRejectedSystemReview.recommendation.actionable, true);
  assert.equal(getRecommendationActionSources(rejected, manualWithRejectedSystemReview, systemCodes(rejected)).automatic, false);
  assert.deepEqual(getAlternatives({ ...rejected, manualAlternatives: [] }, [candidate], {}), []);
  const excluded = { ...linked, excludedAlternatives: ['ALT'] };
  assert.deepEqual(getAlternatives({ ...excluded, manualAlternatives: [] }, [candidate], {}), []);
});

test('POS requires approval for system suggestions but keeps manual relationships active independently', async () => {
  const { getPosRecommendationAvailability, prepareRecommendationCartAddition } = await logic;
  const automaticTarget = { ...target, manualAlternatives: [], recommendationBases: [] };
  const unreviewed = getPosRecommendationAvailability(automaticTarget, [automaticTarget, candidate], {});
  assert.deepEqual(unreviewed.alternatives, []);
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'ALT', inventory: [automaticTarget, candidate] }).ok, false);

  const approvedTarget = { ...automaticTarget, recommendationReviews: [review({ decision: 'approved' })] };
  const approved = getPosRecommendationAvailability(approvedTarget, [approvedTarget, candidate], {});
  assert.deepEqual(approved.alternatives.map((item) => item.code), ['ALT']);
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'ALT', inventory: [approvedTarget, candidate] }).ok, true);

  const manuallyAdded = { ...automaticTarget, manualAlternatives: ['ALT'], recommendationReviews: [review({ decision: 'rejected' })] };
  assert.deepEqual(getPosRecommendationAvailability(manuallyAdded, [manuallyAdded, candidate], {}).alternatives.map((item) => item.code), ['ALT']);
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'ALT', inventory: [manuallyAdded, candidate] }).ok, true);
});

test('recommendation source labels remain independent from system review decisions', async () => {
  const { getAlternatives } = await logic;
  const { getRecommendationPresentation } = await presentation;
  for (const decision of ['not_reviewed', 'approved', 'rejected']) {
    const targetWithReview = { ...target, recommendationReviews: [review({ decision })] };
    const entries = getAlternatives(targetWithReview, [candidate], {}, { includeUnavailable: true, includeBlocked: true });
    const view = getRecommendationPresentation(entries[0].recommendation);
    assert.equal(view.source, 'System-generated');
    assert.equal(view.sourceStatus, decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Needs Review');
  }
  const manualAndSystem = { ...target, manualAlternatives: ['ALT'], recommendationBases: [{ type: 'alternative', candidateProduct: 'ALT', candidateSku: 'ALT', targetSku: 'TARGET', systemGenerated: true }] };
  const [entry] = getAlternatives(manualAndSystem, [candidate], {});
  const combined = getRecommendationPresentation(entry.recommendation);
  assert.equal(combined.source, 'Manually Added · System-generated');
  assert.equal(combined.sourceStatus, 'Active');
});

test('approval never overrides conflicts, missing data, unavailable stock, or either exclusion', async () => {
  const { getAlternatives, prepareRecommendationCartAddition } = await logic;
  const approved = { ...target, manualBudgetOptions: ['ALT'], recommendationReviews: [review()] };
  for (const [requested, item, extra] of [
    [approved, { ...candidate, size: '50mm' }, {}],
    [approved, { ...candidate, size: '' }, {}],
    [approved, { ...candidate, sellingUnit: '' }, {}],
    [approved, { ...candidate, stock: 0 }, {}],
    [approved, { ...candidate, isActive: false }, {}],
    [{ ...approved, excludedAlternatives: ['ALT'] }, candidate, {}],
    [{ ...approved, excludedBudgetOptions: ['ALT'] }, candidate, {}],
    [approved, candidate, { cart: [{ code: 'ALT', qty: 20 }] }],
    [approved, candidate, { requestedQuantity: 21 }],
  ]) {
    assert.deepEqual(getAlternatives(requested, [item], {}, extra), []);
    const result = prepareRecommendationCartAddition({ targetCode: requested.code, candidateCode: item.code, inventory: [requested, item], ...extra, kind: 'budget' });
    assert.equal(result.ok, false);
  }
  const [valid] = getAlternatives(approved, [candidate], {});
  assert.equal(valid.recommendation.compatibility.verified, false);
  assert.equal(valid.recommendation.staffReview.decision, 'approved');
});

test('rejected and excluded rows stay manageable; restoring review alone cannot clear exclusions', async () => {
  const { getAlternatives } = await logic;
  const rejected = { ...target, recommendationReviews: [review({ decision: 'rejected' })] };
  assert.deepEqual(getAlternatives(rejected, [candidate], {}), []);
  const [visible] = getAlternatives(rejected, [candidate], {}, { includeUnavailable: true, includeBlocked: true });
  assert.equal(visible.recommendation.actionable, false);
  assert.equal(visible.recommendation.staffReview.decision, 'rejected');
  assert.equal(getAlternatives({ ...rejected, recommendationReviews: [review({ decision: 'not_reviewed' })] }, [candidate], {}).length, 1);
  assert.equal(getAlternatives({ ...rejected, excludedBudgetOptions: ['ALT'], recommendationReviews: [review({ decision: 'approved' })] }, [candidate], {}).length, 0);
});

test('excluded/rejected review contains active blocks only, including legacy exclusions', async () => {
  const { getAlternatives } = await logic;
  const { getBlockedRecommendationEntries } = await import('../../src/utils/recommendationBasis.js');
  const items = [candidate, product('SECOND'), product('THIRD')];
  const configured = { ...target, excludedAlternatives: ['ALT'], excludedBudgetOptions: ['SECOND'], recommendationReviews: [
    review({ candidateProduct: 'THIRD', candidateSku: 'THIRD', decision: 'rejected' }),
  ] };
  const entries = getAlternatives(configured, items, {}, { includeUnavailable: true, includeBlocked: true, maxSuggestions: items.length });
  assert.deepEqual(getBlockedRecommendationEntries(entries).map((entry) => entry.code).sort(), ['ALT', 'SECOND', 'THIRD']);
  assert.deepEqual(getAlternatives(configured, items, {}, { maxSuggestions: items.length }), []);
  const manualRemoved = { ...target, manualAlternatives: [], excludedAlternatives: [], recommendationReviews: [] };
  assert.deepEqual(getBlockedRecommendationEntries(getAlternatives(manualRemoved, [candidate], {}, { includeUnavailable: true, includeBlocked: true })), []);
  assert.equal(getAlternatives(manualRemoved, [candidate], {}).length, 1);
  const restored = { ...configured, excludedAlternatives: [], excludedBudgetOptions: [], recommendationReviews: [] };
  assert.deepEqual(getBlockedRecommendationEntries(getAlternatives(restored, items, {}, { includeUnavailable: true, includeBlocked: true, maxSuggestions: items.length })), []);
});

test('review identity snapshots block renamed/reused SKUs and stale POS selections', async () => {
  const { getAlternatives, prepareRecommendationCartAddition } = await logic;
  const approved = { ...target, recommendationReviews: [review()] };
  for (const item of [{ ...candidate, code: 'RENAMED' }, { ...candidate, id: 'NEW' }]) {
    assert.deepEqual(getAlternatives(approved, [item], {}), []);
    assert.equal(getAlternatives(approved, [item], {}, { includeUnavailable: true, includeBlocked: true })[0].recommendation.staffReview.identityCurrent, false);
  }
  assert.deepEqual(getAlternatives({ ...approved, code: 'NEW-TARGET' }, [candidate], {}), []);
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', targetId: 'OLD', candidateCode: 'ALT', inventory: [target, candidate] }).ok, false);
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'ALT', candidateId: 'OLD', inventory: [target, candidate] }).ok, false);
  assert.deepEqual(getAlternatives(target, [], {}), []);
});

test('secondary legacy identity bindings and exclusions cannot be bypassed by a current primary link', async () => {
  const { getAlternatives } = await logic;
  const configured = { ...target, manualAlternatives: ['ALT'], manualBudgetOptions: ['OLD'], recommendationBases: [
    { type: 'alternative', targetSku: 'TARGET', candidateProduct: 'ALT', candidateSku: 'ALT', justification: 'Current reason.' },
    { type: 'budget', targetSku: 'TARGET', candidateProduct: 'ALT', candidateSku: 'OLD', justification: 'Historical reason.' },
  ] };
  assert.deepEqual(getAlternatives(configured, [candidate], {}), []);
  const [visible] = getAlternatives(configured, [candidate], {}, { includeUnavailable: true });
  assert.equal(visible.recommendation.relationshipIdentityCurrent, false);
  assert.equal(visible.recommendation.actionable, false);
  assert.deepEqual(getAlternatives({ ...configured, excludedBudgetOptions: ['OLD'] }, [candidate], {}), []);
});

test('archived targets and candidates are excluded from recommendation lists, drawers, counts and selection', async () => {
  const {
    getAlternatives,
    getAlternativesByBudget,
    getManualRecommendationCandidates,
    getPosRecommendationAvailability,
    getRawSystemRecommendations,
    getRecommendationAvailability,
    getSystemRecommendationSourceCodes,
    prepareRecommendationCartAddition,
  } = await logic;
  const archivedManual = product('ALT-ARCHIVED', { isActive: false });
  const activeCandidate = product('ALT-ACTIVE');
  const manualTarget = {
    ...target,
    manualAlternatives: ['ALT-ARCHIVED'],
    recommendationBases: [{ type: 'alternative', targetSku: 'TARGET', candidateProduct: 'ALT-ARCHIVED', candidateSku: 'ALT-ARCHIVED', justification: 'Existing staff basis.' }],
  };
  const savedBefore = JSON.stringify(manualTarget);
  const allRows = getAlternatives(manualTarget, [manualTarget, archivedManual, activeCandidate], {}, {
    includeUnavailable: true, includeBlocked: true, maxSuggestions: 10,
  });
  assert.deepEqual(allRows.map((row) => row.code), ['ALT-ACTIVE']);
  const budgetBuckets = getAlternativesByBudget(manualTarget, [manualTarget, archivedManual, activeCandidate], {}, { includeUnavailable: true });
  assert.equal(Object.values(budgetBuckets).flat().some((row) => row.code === 'ALT-ARCHIVED'), false);
  assert.deepEqual(getManualRecommendationCandidates(manualTarget, [archivedManual, activeCandidate], { settings: {}, recommendationType: 'alternative' }).map((row) => row.code), ['ALT-ACTIVE']);
  assert.equal(getRawSystemRecommendations(manualTarget, [archivedManual], {}).some((row) => row.code === 'ALT-ARCHIVED'), false);
  assert.equal(getSystemRecommendationSourceCodes(manualTarget, [archivedManual], {}).includes('ALT-ARCHIVED'), false);
  const inactiveTarget = { ...manualTarget, isActive: false };
  assert.deepEqual(getRecommendationAvailability(inactiveTarget, [inactiveTarget, activeCandidate], {}).alternatives, []);
  assert.deepEqual(getPosRecommendationAvailability(manualTarget, [manualTarget, archivedManual], {}).alternatives, []);
  assert.equal(prepareRecommendationCartAddition({ targetCode: 'TARGET', candidateCode: 'ALT-ARCHIVED', inventory: [manualTarget, archivedManual] }).ok, false);
  assert.equal(JSON.stringify(manualTarget), savedBefore);

  // Restoring a manual item reuses its existing source/basis. Restoring a
  // rejected system suggestion does not implicitly approve or expose it.
  const restoredManual = getAlternatives(manualTarget, [manualTarget, { ...archivedManual, isActive: true }], {});
  assert.equal(restoredManual[0].recommendation.source, 'admin-managed');
  const rejectedTarget = { ...target, recommendationReviews: [review({ candidateSku: 'ALT-ARCHIVED', candidateProduct: 'ALT-ARCHIVED', decision: 'rejected' })] };
  assert.deepEqual(getAlternatives(rejectedTarget, [rejectedTarget, archivedManual], {}, { includeUnavailable: true, includeBlocked: true }), []);
  assert.deepEqual(getAlternatives(rejectedTarget, [rejectedTarget, { ...archivedManual, isActive: true }], {}), []);
  const rejectedAfterRestore = getAlternatives(rejectedTarget, [rejectedTarget, { ...archivedManual, isActive: true }], {}, { includeUnavailable: true, includeBlocked: true });
  assert.equal(rejectedAfterRestore[0].recommendation.staffReview.decision, 'rejected');
});

test('price facts use current comparable units once and never mark higher prices as favorable', async () => {
  const { getAlternatives } = await logic;
  const { getRecommendationPresentation } = await presentation;
  for (const [price, phrase, kind] of [[80, 'cheaper', 'match'], [100, 'Same selling price', 'neutral'], [120, 'more expensive', 'neutral']]) {
    const [item] = getAlternatives(target, [{ ...candidate, price }], {});
    const result = getRecommendationPresentation(item.recommendation);
    const prices = result.checklist.filter((row) => row.key === 'price');
    assert.equal(prices.length, 1); assert.match(prices[0].text, new RegExp(phrase)); assert.equal(prices[0].kind, kind);
  }
  const { compareRecommendationPrices } = await import('../../src/utils/recommendationEvaluation.js');
  for (const item of [{ ...candidate, sellingUnit: 'box' }, { ...candidate, sellingUnit: '' }, { ...candidate, price: '' }, { ...candidate, price: NaN }, { ...candidate, price: true }, { ...candidate, price: 0, recommendationPriceValid: false }]) {
    const result = getRecommendationPresentation({ priceComparison: compareRecommendationPrices(target, item) });
    assert.ok(!result.checklist.some((row) => row.key === 'price'));
  }
});
