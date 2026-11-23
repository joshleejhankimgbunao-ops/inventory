/* global require, __dirname, module */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');
const helpers = import('../../src/utils/recommendationBasis.js');
const logic = import('../../src/utils/recommendationLogic.js');
const presentation = import('../../src/utils/recommendationPresentation.js');
const row = { type: 'alternative', targetSku: 'TARGET', candidateProduct: 'candidate-id', candidateSku: 'ALT', justification: 'Business reason.', limitations: 'Check intended use.', updatedBy: 'admin-id', updatedByName: 'Admin', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T01:00:00Z' };
const candidate = { id: 'candidate-id', code: 'ALT', name: 'Electrical Tape', category: 'Tape', stock: 5, price: 80, sellingUnit: 'roll', size: '19 mm' };
const target = { id: 'target-id', code: 'TARGET', name: 'Electrical Tape', category: 'Tape', stock: 50, price: 100, sellingUnit: 'roll', size: '19 mm', manualAlternatives: ['ALT'], recommendationBases: [row], recommendationRevision: 1 };
const loadComponent = (name, dependencies = {}) => {
  const filename = path.resolve(__dirname, `../../src/components/${name}.jsx`);
  const compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = module.paths;
  const nativeRequire = compiled.require.bind(compiled);
  compiled.require = (id) => dependencies[id] || nativeRequire(id);
  compiled._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code, filename);
  return compiled.exports.default;
};

test('basis input is optional, bounded, trimmed consistently and rejects unsupported controls', async () => {
  const { validateRecommendationBasis, RECOMMENDATION_BASIS_LIMITS } = await helpers;
  assert.equal(validateRecommendationBasis({ justification: ' ', limitations: '' }), '');
  assert.equal(validateRecommendationBasis({ justification: 'x'.repeat(RECOMMENDATION_BASIS_LIMITS.justification) }), '');
  assert.match(validateRecommendationBasis({ justification: 'x'.repeat(RECOMMENDATION_BASIS_LIMITS.justification + 1) }), /cannot exceed/);
  assert.match(validateRecommendationBasis({ limitations: {} }), /must be text/);
  assert.match(validateRecommendationBasis({ justification: 'bad\u0000text' }), /control characters/);
  assert.match(validateRecommendationBasis({ systemSuggestion: 'x'.repeat(RECOMMENDATION_BASIS_LIMITS.systemSuggestion + 1) }), /Original system suggestion cannot exceed/);
});

test('late mutation responses cannot replace newer basis or stock snapshots', async () => {
  const { mergeRecommendationProduct } = await helpers;
  const latest = { ...target, recommendationRevision: 3, updatedAt: '2026-10-15T03:00:00Z', stock: 1 };
  assert.equal(mergeRecommendationProduct(latest, { ...target, recommendationRevision: 2 }), latest);
  const changed = mergeRecommendationProduct({ ...latest, recommendationRevision: 1 }, { ...target, recommendationRevision: 2, updatedAt: '2026-10-15T02:00:00Z' });
  assert.equal(changed.recommendationRevision, 2); assert.equal(changed.stock, 1);
  assert.equal(changed.updatedAt, latest.updatedAt);
});

test('legacy links remain readable; saved basis binds to candidate ID and its original SKU', async () => {
  const { getManualRecommendationLink } = await helpers;
  assert.equal(getManualRecommendationLink({ ...target, recommendationBases: [] }, candidate).status, 'legacy');
  assert.equal(getManualRecommendationLink(target, candidate).record.justification, row.justification);
  assert.equal(getManualRecommendationLink(target, { ...candidate, code: 'RENAMED' }).status, 'sku_changed');
  const reused = getManualRecommendationLink(target, { ...candidate, id: 'different-product-id' });
  assert.equal(reused.status, 'identity_mismatch'); assert.equal(reused.record, null);
  assert.equal(getManualRecommendationLink({ ...target, manualAlternatives: [] }, candidate), null);
});

test('basis changes do not alter compatibility, availability or system-derived comparisons', async () => {
  const { getAlternatives } = await logic;
  const [before] = getAlternatives({ ...target, recommendationBases: [] }, [candidate], {}, { includeUnavailable: true });
  const [after] = getAlternatives(target, [candidate], {}, { includeUnavailable: true });
  assert.deepEqual(after.recommendation.compatibility, before.recommendation.compatibility);
  assert.deepEqual(after.recommendation.availability, before.recommendation.availability);
  assert.deepEqual(after.recommendation.priceComparison, before.recommendation.priceComparison);
  assert.equal(after.recommendation.adminJustification.text, row.justification);
  assert.equal(after.recommendation.adminJustification.limitations, row.limitations);
  assert.equal(after.recommendation.compatibility.verified, false);
});

test('saved prose cannot reactivate specification conflicts, zero stock or stale SKU identities', async () => {
  const { getAlternatives } = await logic;
  for (const item of [{ ...candidate, stock: 0 }, { ...candidate, size: '50 mm' }, { ...candidate, code: 'RENAMED' }, { ...candidate, id: 'different-product-id' }]) {
    assert.deepEqual(getAlternatives(target, [item], {}), []);
    const [review] = getAlternatives(target, [item], {}, { includeUnavailable: true });
    assert.equal(review.recommendation.actionable, false);
  }
});

test('budget display distinguishes its own basis from inherited alternative basis', async () => {
  const { getAlternativesByBudget } = await logic;
  const options = { limitPerTier: 10 };
  const inherited = Object.values(getAlternativesByBudget(target, [candidate], {}, options)).flat()[0];
  assert.equal(inherited.recommendation.basisRelationshipType, 'alternative');
  assert.equal(inherited.recommendation.adminJustification.text, 'Business reason.');
  const configured = { ...target, manualBudgetOptions: ['ALT'], recommendationBases: [row, { ...row, type: 'budget', justification: 'Budget-specific reason.' }] };
  const explicit = Object.values(getAlternativesByBudget(configured, [candidate], {}, options)).flat();
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].recommendation.basisRelationshipType, 'budget');
  assert.equal(explicit[0].recommendation.adminJustification.text, 'Budget-specific reason.');
});

test('read-only explanation separates escaped admin prose and recorded facts; empty reasons remain honest', async () => {
  const { getAlternatives } = await logic;
  const Basis = loadComponent('RecommendationBasis', { '../utils/numberFormat': { formatCurrency: (value) => `PHP ${value}` }, '../utils/recommendationPresentation': await presentation });
  const [item] = getAlternatives(target, [candidate], {}, { includeUnavailable: true });
  item.recommendation.adminJustification.text = '<script>unsupported claim</script>';
  const html = renderToStaticMarkup(React.createElement(Basis, { item }));
  assert.match(html, /Why Recommended\?/); assert.match(html, /Needs Review/);
  assert.match(html, /Manually Added/); assert.match(html, /Active/); assert.match(html, /Compatibility: Needs Review/);
  assert.match(html, /Recorded product facts|Staff recommendation/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<textarea|Save Changes|Edit Basis/);
  assert.equal(html.split('&lt;script&gt;unsupported claim&lt;/script&gt;').length - 1, 1);
  item.recommendation.adminJustification.text = null;
  const withoutStaffNote = renderToStaticMarkup(React.createElement(Basis, { item }));
  assert.doesNotMatch(withoutStaffNote, /No reason added yet/);
  assert.match(withoutStaffNote, /Same size: 19 mm/);
  assert.match(withoutStaffNote, /cheaper/);
  const tracedTarget = { ...target, recommendationBases: [{ ...row, systemSuggestion: 'Matching size: 19 mm.' }] };
  const [tracedItem] = getAlternatives(tracedTarget, [candidate], {}, { includeUnavailable: true });
  const tracedHtml = renderToStaticMarkup(React.createElement(Basis, { item: tracedItem }));
  assert.match(tracedHtml, /Displayed explanation:/);
  assert.match(tracedHtml, /Original system suggestion:/);
  assert.match(tracedHtml, /Matching size: 19 mm\./);
});

test('plain-language presentation retains warnings without claiming unverified compatibility', async () => {
  const { getRecommendationPresentation } = await presentation;
  const base = { source: 'admin-managed', adminJustification: { text: '', limitations: '' }, compatibility: { verified: false }, reasons: ['Same documented product type.', '5 rolls currently recorded in stock.'], differences: [], missingAttributes: [], dataLimitations: [], availability: { active: true, canFulfill: true }, actionable: true };
  const missing = getRecommendationPresentation(base);
  assert.equal(missing.status, 'Needs Review');
  assert.deepEqual(missing.checklist.map((row) => row.kind), ['warning']);
  assert.equal(missing.hasStaffReasons, false);
  const detailed = getRecommendationPresentation({ ...base, adminJustification: { text: 'Staff preference.' }, matchedAttributes: [
    { key: 'product_type', label: 'Product Type', candidateValue: 'Tape' },
    { key: 'size', label: 'Size', candidateValue: '1L' },
    { key: 'material', label: 'Material', candidateValue: 'PVC' },
  ] });
  assert.deepEqual(detailed.checklist.slice(0, 3).map((row) => row.kind), ['neutral', 'match', 'match']);
  assert.equal(detailed.checklist[0].text, 'Staff note: Staff preference.');
  assert.deepEqual(detailed.checklist.slice(1).map((row) => row.text), ['Same product type: Tape', 'Same size: 1L']);
  assert.deepEqual(detailed.additionalMatches.map((row) => row.text), ['Same material: PVC']);
  assert.equal(detailed.showStaffReasonInDetails, false);
  const longStaff = getRecommendationPresentation({ ...base, adminJustification: { text: 'A'.repeat(101) } });
  assert.equal(longStaff.checklist[0].text, 'Staff note available in More details');
  assert.equal(longStaff.showStaffReasonInDetails, true);
  const conflict = getRecommendationPresentation({ ...base, differences: [{ key: 'size', label: 'Size' }], adminJustification: { text: 'Staff preference.' } });
  assert.match(conflict.warning, /Product details are different/);
  assert.equal(conflict.status, 'Needs Review');
  assert.equal(conflict.checklist.find((row) => row.key === 'difference:size').kind, 'warning');
  const units = getRecommendationPresentation({ ...base, differences: [{ key: 'sellingUnit', label: 'Selling unit' }] });
  assert.match(units.warning, /Different selling units/);
  const empty = getRecommendationPresentation({ ...base, availability: { active: true, canFulfill: false } });
  assert.equal(empty.unavailable, 'Not enough stock.');
  assert.ok(empty.checklist.some((row) => row.text === 'Not enough stock.'));
  const archived = getRecommendationPresentation({ ...base, availability: { active: false, canFulfill: false } });
  assert.equal(archived.unavailable, 'Unavailable for sale.');
  const verified = getRecommendationPresentation({ ...base, compatibility: { verified: true } });
  assert.equal(verified.status, 'Verified');
  assert.ok(!verified.checklist.some((row) => row.key === 'review'));
});

test('manual cards lead with ordered staff indicators while automatic facts and eligibility stay unchanged', async () => {
  const { getAlternatives, evaluateRecommendation } = await logic;
  const { getRecommendationPresentation } = await presentation;
  const staffReasons = [{ indicator: 'check', text: 'Staff-positive statement.' }, { indicator: 'neutral', text: 'Customer preference.' }, { indicator: 'warning', text: 'Confirm color.' }];
  const configured = { ...target, recommendationBases: [{ ...row, staffReasons }] };
  const [manual] = getAlternatives(configured, [candidate], {});
  const view = getRecommendationPresentation(manual.recommendation);
  assert.deepEqual(view.checklist.slice(0, 3).map(({ kind, text }) => ({ kind, text })), staffReasons.map(({ indicator, text }) => ({ kind: indicator === 'check' ? 'match' : indicator, text })));
  assert.ok(view.checklist.some((reason) => reason.key === 'price'));
  assert.ok(view.checklist.some((reason) => reason.key === 'size'));
  assert.equal(view.showStaffReasonInDetails, true);
  const original = evaluateRecommendation(target, candidate, { source: 'admin-managed' });
  const after = evaluateRecommendation(configured, candidate, { source: 'admin-managed' });
  assert.deepEqual(after, original);
  assert.equal(manual.recommendation.compatibility.verified, false);
  const inventory = [candidate, { ...candidate, id: 'second-id', code: 'SECOND', price: 75 }];
  const assessment = (owner) => getAlternatives(owner, inventory, {}, { cart: [{ code: candidate.code, qty: 1 }], requestedQuantity: 2 }).map((item) => ({ code: item.code, actionable: item.recommendation.actionable, compatibility: item.recommendation.compatibility, availability: item.recommendation.availability }));
  assert.deepEqual(assessment(configured), assessment(target));
  for (const item of [{ ...candidate, size: '50 mm' }, { ...candidate, stock: 0 }, { ...candidate, sellingUnit: 'box' }]) {
    assert.deepEqual(getAlternatives(configured, [item], {}), []);
    const [blocked] = getAlternatives(configured, [item], {}, { includeUnavailable: true });
    assert.equal(blocked.recommendation.actionable, false);
    assert.ok(getRecommendationPresentation(blocked.recommendation).checklist.some((reason) => !reason.staff && reason.kind === 'warning'));
  }
  const [combined] = getAlternatives(configured, [{ ...candidate, size: '50 mm', stock: 0 }], {}, { includeUnavailable: true });
  const combinedWarnings = getRecommendationPresentation(combined.recommendation).checklist;
  assert.ok(combinedWarnings.some((reason) => reason.key === 'availability'));
  assert.ok(combinedWarnings.some((reason) => reason.key === 'difference:size'));
  const automaticTarget = { ...target, manualAlternatives: [], recommendationBases: [], recommendationReviews: [{ targetSku: target.code, candidateProduct: candidate.id, candidateSku: candidate.code, decision: 'not_reviewed', staffReasons }] };
  const [automatic] = getAlternatives(automaticTarget, [candidate], {});
  const autoView = getRecommendationPresentation(automatic.recommendation);
  assert.equal(autoView.isManual, false); assert.equal(autoView.staffChecklist.length, 3);
  assert.ok(autoView.checklist.some((reason) => reason.key === 'size'));
  assert.ok(autoView.checklist.some((reason) => reason.key === 'price'));
});

test('Hollow Blocks facts survive saving, refresh with product changes, and stay separate from staff input', async () => {
  const { getManualRecommendationCandidates, getAlternatives } = await logic;
  const { getRecommendationPresentation } = await presentation;
  const categories = [{ name: 'Masonry', productAttributes: [{ key: 'size_thickness', name: 'Size / Thickness', type: 'text' }], attributeSchemaVersion: 1 }];
  const original = { id: 'hb-5', code: 'OTH-011', name: 'Hollow Blocks', category: 'Masonry', attributes: { size_thickness: '5"' }, sellingUnit: 'pcs', price: 30, stock: 20 };
  const smaller = { id: 'hb-4', code: 'OTH-010', name: 'Hollow Blocks', category: 'Masonry', attributes: { size_thickness: '4"' }, sellingUnit: 'pcs', price: 20, stock: 15 };
  const options = { categories };
  const [candidate] = getManualRecommendationCandidates(original, [smaller], { ...options, settings: {} });
  const before = getRecommendationPresentation(candidate.recommendation);
  const saved = { ...original, manualAlternatives: [smaller.code], recommendationBases: [{ candidateProduct: smaller.id, candidateSku: smaller.code, targetSku: original.code, type: 'alternative', staffReasons: [] }] };
  const [linked] = getAlternatives(saved, [smaller], {}, { ...options, includeUnavailable: true });
  const after = getRecommendationPresentation(linked.recommendation);
  for (const view of [before, after]) {
    assert.ok(view.checklist.some((reason) => reason.text === 'Same recorded product name' && reason.kind === 'match'));
    assert.ok(view.checklist.some((reason) => reason.text.includes('10.00 cheaper') && reason.kind === 'match'));
    assert.ok(view.checklist.some((reason) => reason.text === 'Different size / thickness: 5" vs 4"' && reason.kind === 'warning'));
    assert.equal(view.status, 'Needs Review');
    assert.equal(new Set(view.checklist.map((reason) => reason.text)).size, view.checklist.length);
  }
  assert.deepEqual(saved.recommendationBases[0].staffReasons, []);
  const updated = getAlternatives(saved, [{ ...smaller, price: 35, attributes: { size_thickness: '6"' } }], {}, { ...options, includeUnavailable: true })[0];
  const refreshed = getRecommendationPresentation(updated.recommendation);
  assert.ok(refreshed.checklist.some((reason) => reason.text.includes('5.00 more expensive') && reason.kind === 'neutral'));
  assert.ok(refreshed.checklist.some((reason) => reason.text === 'Different size / thickness: 5" vs 6"'));
  assert.ok(!refreshed.checklist.some((reason) => reason.text.includes('cheaper') || reason.text.includes('vs 4"')));
  const withStaff = getRecommendationPresentation({ ...linked.recommendation, staffReasons: [{ indicator: 'warning', text: 'Check load requirements.' }, { indicator: 'neutral', text: 'Customer preference.' }] });
  assert.deepEqual(withStaff.checklist.slice(0, 2).map((reason) => reason.text), ['Check load requirements.', 'Customer preference.']);
  assert.ok(withStaff.checklist.slice(2).some((reason) => reason.text === 'Same recorded product name'));
});

test('POS shows current facts for empty manual reasons while preserving safety warnings and legacy prose', async () => {
  const { getAlternatives } = await logic;
  const Basis = loadComponent('RecommendationBasis', { '../utils/recommendationPresentation': await presentation });
  const [item] = getAlternatives({ ...target, recommendationBases: [{ ...row, staffReasons: [] }] }, [candidate], {});
  const pos = renderToStaticMarkup(React.createElement(Basis, { item, context: 'pos' }));
  assert.doesNotMatch(pos, /No reason added yet/);
  assert.match(pos, /Why Recommended\?|Same size|cheaper/);
  assert.match(pos, /Confirm suitability before use/); assert.match(pos, /Business reason\./);
  const management = renderToStaticMarkup(React.createElement(Basis, { item }));
  assert.doesNotMatch(management, /No reason added yet/);
  item.recommendation.staffReasons = [{ indicator: 'check', text: '<Staff & customer>' }];
  const shown = renderToStaticMarkup(React.createElement(Basis, { item, context: 'pos' }));
  assert.match(shown, /Staff-provided reasons; not independently verified/);
  assert.match(shown, /&lt;Staff &amp; customer&gt;/); assert.doesNotMatch(shown, /Edit Basis|<input|<select/);
});

test('reason editor and validation support optional ordered rows and retain additional text', async () => {
  const { validateRecommendationBasis, RECOMMENDATION_BASIS_LIMITS: limits } = await helpers;
  assert.equal(validateRecommendationBasis({ staffReasons: [] }), '');
  for (const staffReasons of [{}, [null], [{ indicator: 'approved', text: 'No.' }], [{ indicator: 'check', text: '  ' }], [{ indicator: 'check', text: 'x'.repeat(limits.reasonText + 1) }], Array(limits.reasonCount + 1).fill({ indicator: 'neutral', text: 'Extra.' }), [{ indicator: 'warning', text: 'bad\u0000text' }]]) assert.ok(validateRecommendationBasis({ staffReasons }));
  const Editor = loadComponent('RecommendationBasisEditor', { '../utils/recommendationBasis': await helpers });
  const html = renderToStaticMarkup(React.createElement(Editor, { target, candidate, initialBasis: { justification: 'Original prose.', limitations: 'Original limits.', staffReasons: [{ indicator: 'warning', text: 'x'.repeat(limits.reasonText) }, { indicator: 'neutral', text: 'Second.' }] }, onSave: () => {}, onClose: () => {} }));
  assert.match(html, /Indicator for reason 1/); assert.match(html, /Reason 2/); assert.match(html, /Move reason 2 up/);
  assert.match(html, /\u2713 Positive/); assert.match(html, /= Neutral/); assert.match(html, /\u26a0 Warning/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Move reason 1 up"/); assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Move reason 2 down"/);
  assert.match(html, /title="Move up"/); assert.match(html, /title="Move down"/);
  assert.match(html, /Your reasons do not change compatibility checks\./);
  assert.doesNotMatch(html, /Staff statements, not independently verified matches|\u2713 Match/);
  assert.match(html, /Remove reason 1/); assert.match(html, /\+ Add Reason/);
  assert.match(html, /saved text preserved/); assert.match(html, /Original prose\./); assert.match(html, /Original limits\./);
  assert.doesNotMatch(html, /required=""/);
});

test('Edit Basis form renders read-only identities and optional fields without saving placeholders', async () => {
  const Editor = loadComponent('RecommendationBasisEditor', { '../utils/recommendationBasis': await helpers });
  const html = renderToStaticMarkup(React.createElement(Editor, { target, candidate, initialBasis: {}, onSave: () => {}, onClose: () => {} }));
  assert.match(html, /role="dialog"/); assert.match(html, /aria-modal="true"/);
  assert.match(html, /TARGET/); assert.match(html, /ALT/);
  assert.match(html, /Displayed Explanation/); assert.match(html, /Important Differences \/ Limitations/);
  assert.match(html, /Save Changes/); assert.match(html, /Cancel/);
  assert.doesNotMatch(html, /required=""/);
  assert.match(html, /placeholder="Explain why this alternative is recommended"[^>]*><\/textarea>/);
});

test('manual reason editor preserves the original system suggestion and offers an explicit reset', async () => {
  const Editor = loadComponent('RecommendationBasisEditor', { '../utils/recommendationBasis': await helpers });
  const html = renderToStaticMarkup(React.createElement(Editor, {
    target, candidate,
    mode: 'edit',
    initialBasis: { justification: 'Staff-edited explanation.', systemSuggestion: 'Matching size: 19 mm. 5 rolls currently recorded in stock.' },
    onSave: () => {}, onClose: () => {},
  }));
  assert.match(html, /System Suggestion \(Original\)/);
  assert.match(html, /Matching size: 19 mm\. 5 rolls currently recorded in stock\./);
  assert.match(html, /Displayed Explanation/);
  assert.match(html, /Staff-edited explanation\./);
  assert.match(html, /Reset to System Suggestion/);
});

test('review editor exposes staff decisions and optional explanations without certifying compatibility', async () => {
  const Editor = loadComponent('RecommendationBasisEditor', { '../utils/recommendationBasis': await helpers });
  const html = renderToStaticMarkup(React.createElement(Editor, { target, candidate, mode: 'review', reviewDecision: 'rejected', restoreExclusions: true, initialBasis: { reviewReason: '<review>', justification: 'Staff note.' }, onSave: () => {}, onClose: () => {} }));
  assert.match(html, /Reject Recommendation\?/); assert.match(html, /Stop recommending Electrical Tape automatically\?/);
  assert.match(html, />Reject<\/button>/); assert.match(html, /Review Reason \(Optional\)/);
  assert.match(html, /value="rejected" selected=""/); assert.match(html, /&lt;review&gt;/);
  assert.match(html, /lifts its previous block/); assert.match(html, /Your reasons do not change compatibility checks/);
  assert.doesNotMatch(html, /required=""/);
});

test('automatic staff justification reuses the basis editor without exposing review decisions', async () => {
  const Editor = loadComponent('RecommendationBasisEditor', { '../utils/recommendationBasis': await helpers });
  const html = renderToStaticMarkup(React.createElement(Editor, {
    target, candidate, mode: 'staff', reviewDecision: 'not_reviewed',
    initialBasis: { justification: 'Staff context.', staffReasons: [{ indicator: 'neutral', text: 'Confirm intended use.' }] },
    onSave: () => {}, onClose: () => {},
  }));
  assert.match(html, /Staff Justification/);
  assert.match(html, /<details open=""/);
  assert.match(html, /Staff context\./);
  assert.match(html, /Confirm intended use\./);
  assert.match(html, /Save Changes/);
  assert.doesNotMatch(html, /recommendation-review-decision|>Approve<|>Reject<|>Restore</);
});

test('automatic staff notes leave system facts and Needs Review eligibility unchanged', async () => {
  const { getAlternatives } = await logic;
  const automaticTarget = { ...target, manualAlternatives: [], recommendationBases: [] };
  const [before] = getAlternatives(automaticTarget, [candidate], {});
  const [after] = getAlternatives({ ...automaticTarget, recommendationReviews: [{
    targetSku: target.code, candidateProduct: candidate.id, candidateSku: candidate.code,
    decision: 'not_reviewed', justification: 'Staff context.',
    staffReasons: [{ indicator: 'neutral', text: 'Confirm intended use.' }],
  }] }, [candidate], {});
  assert.deepEqual(after.recommendation.reasons, before.recommendation.reasons);
  assert.deepEqual(after.recommendation.compatibility, before.recommendation.compatibility);
  assert.equal(after.recommendation.actionable, before.recommendation.actionable);
  assert.equal(after.recommendation.staffReview.decision, 'not_reviewed');
  assert.equal(after.recommendation.adminJustification.text, 'Staff context.');
});

test('POS keeps automatic staff justification readable and separate from recorded facts', async () => {
  const { getPosRecommendationPresentation } = await presentation;
  const { getAlternatives } = await logic;
  const automaticTarget = { ...target, manualAlternatives: [], recommendationBases: [], recommendationReviews: [{
    targetSku: target.code, candidateProduct: candidate.id, candidateSku: candidate.code,
    decision: 'not_reviewed', justification: 'Confirm the customer application before suggesting this alternative.',
  }] };
  const [automatic] = getAlternatives(automaticTarget, [candidate], {});
  const shortView = getPosRecommendationPresentation(automatic.recommendation);
  assert.ok([...shortView.visible, ...shortView.more].some((reason) => reason.staff && reason.text.includes('Confirm the customer application')));
  assert.ok(![...shortView.visible, ...shortView.more].some((reason) => !reason.staff && reason.text.includes('Staff note')));

  const longNote = 'Confirm the customer application and documented specifications before suggesting this product. '.repeat(3).trim();
  const longView = getPosRecommendationPresentation({ ...automatic.recommendation, adminJustification: { text: longNote } });
  assert.ok([...longView.visible, ...longView.more].some((reason) => reason.staff && reason.text.includes(longNote)));
  assert.ok(![...longView.visible, ...longView.more].some((reason) => reason.text === 'Staff note available in More details'));
});

test('product data flow preserves metadata and Edit Basis uses its dedicated guarded API', () => {
  const filename = path.resolve(__dirname, '../../src/services/inventoryApi.js');
  const api = new Module(filename, module); api.filename = filename; api.paths = module.paths;
  let lastRequest;
  api.require = (id) => {
    if (id === './apiClient') return { apiRequest: async (url, options) => { lastRequest = { url, options }; return { _id: 'target-id', sku: 'TARGET', recommendationBases: [row], recommendationRevision: 2 }; } };
    if (id === '../utils/recommendationLogic') return { getStockStatus: () => 'In Stock' };
    throw new Error(`Unexpected import: ${id}`);
  };
  api._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'js', format: 'cjs' }).code, filename);
  assert.deepEqual(api.exports.mapApiProductToUi({ recommendationBases: [row] }).recommendationBases, [row]);
  assert.deepEqual(api.exports.mapApiProductToUi({}).recommendationBases, []);
  assert.deepEqual(api.exports.mapApiProductToUi({}).recommendationReviews, []);
  assert.equal(api.exports.mapApiProductToUi({ price: null }).recommendationPriceValid, false);
  assert.equal(api.exports.mapApiProductToUi({ price: 0 }).recommendationPriceValid, true);
  return api.exports.editProductRecommendationBasisApi('target-id', 'candidate-id', { expectedRevision: 1, justification: '' }).then((saved) => {
    assert.match(lastRequest.url, /recommendations\/candidate-id\/basis$/);
    assert.equal(lastRequest.options.method, 'PATCH');
    assert.deepEqual(JSON.parse(lastRequest.options.body), { expectedRevision: 1, justification: '' });
    assert.equal(saved.recommendationRevision, 2);
  });
});
