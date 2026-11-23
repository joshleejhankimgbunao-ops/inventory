import { formatCurrency } from './numberFormat.js';

const sourceLabel = (basis) => {
    const manual = basis.sources?.manual ?? basis.source === 'admin-managed';
    const automatic = basis.sources?.automatic ?? basis.source === 'automatic';
    const labels = [];
    if (manual) labels.push('Manually Added');
    if (automatic) labels.push('System-generated');
    return labels.length ? labels.join(' · ') : basis.source === 'candidate' ? 'Candidate for review' : 'System-generated';
};
const typeKeys = new Set(['product_type', 'specific_product_type']);
const textValue = (value, unit) => {
    const text = String(value ?? '').trim();
    const suffix = String(unit ?? '').trim();
    return suffix && text && !text.toLowerCase().endsWith(suffix.toLowerCase()) ? text + ' ' + suffix : text;
};
const matchText = (row) => 'Same ' + String(row.label || row.key).toLowerCase() + ': ' + textValue(row.candidateValue, row.candidateUnit || row.unit);
const differenceText = (row) => 'Different ' + String(row.label || row.key).toLowerCase() + ': '
    + textValue(row.targetValue, row.unit) + ' vs ' + textValue(row.candidateValue, row.candidateUnit || row.unit);

export const getRecommendationPresentation = (basis) => {
    if (!basis) return null;
    const differences = basis.differences || [];
    const missing = (basis.missingAttributes || []).filter((row) => row.key !== 'brand');
    const matches = (basis.matchedAttributes || [])
        .filter((row) => row.key !== 'brand' && String(row.candidateValue ?? '').trim())
        .sort((left, right) => Number(typeKeys.has(right.key)) - Number(typeKeys.has(left.key)))
        .map((row) => ({ kind: 'match', key: row.key, text: matchText(row) }));
    if (matches.length === 0 && basis.reasons?.includes('Same recorded product name.')) {
        matches.push({ kind: 'match', key: 'recorded-name', text: 'Same recorded product name' });
    }

    const savedReason = basis.adminJustification?.text?.trim() || '';
    const manual = basis.sources?.manual ?? basis.source === 'admin-managed';
    const automatic = basis.sources?.automatic ?? !manual;
    const reviewDecision = basis.staffReview?.decision || 'not_reviewed';
    const reviewStatus = reviewDecision === 'approved' ? 'Approved' : reviewDecision === 'rejected' ? 'Rejected' : 'Needs Review';
    const sourceStatus = manual ? 'Active' : reviewStatus;
    const staffReasons = (basis.staffReasons || []).map((row, index) => ({ key: `staff-${index}`, kind: row.indicator === 'check' ? 'match' : row.indicator, text: row.text, staff: true }));
    // Existing prose stays readable without inventing a structured check or
    // migrating stored text. Explicit [] means staff chose no custom reasons.
    const legacyPrimary = manual && basis.staffReasons === undefined && savedReason;
    const shortStaffReason = savedReason && savedReason.length <= 100 && !savedReason.includes('\n');
    const staffRow = basis.source === 'admin-managed' || savedReason
        ? { kind: 'neutral', key: 'staff', text: savedReason
            ? shortStaffReason ? 'Staff note: ' + savedReason : 'Staff note available in More details'
            : 'No reason added yet.' }
        : null;
    const identityChanged = basis.relationshipIdentityCurrent === false || ['sku_changed', 'identity_mismatch', 'target_sku_changed'].includes(basis.relationshipStatus);
    const unitDifference = differences.some((row) => row.key === 'sellingUnit');
    const unavailable = basis.availability?.active === false
        ? 'Unavailable for sale.'
        : basis.availability?.canFulfill === false ? 'Not enough stock.' : '';
    const warning = identityChanged
        ? 'Saved product identity changed. Review this recommendation.'
        : unitDifference ? 'Different selling units. Check before recommending.'
            : differences.length ? 'Product details are different. Check before recommending.'
                : missing.length || basis.dataLimitations?.length
                    ? 'Some product details need review.'
                    : basis.actionable === false && !unavailable ? 'Check product details before recommending.' : '';

    const mainDifference = differences.find((row) => row.key !== 'brand') || differences[0];
    let issue = null;
    if (basis.excluded) issue = { kind: 'warning', key: 'excluded', text: 'Excluded from POS alternatives' };
    else if (basis.staffReview?.decision === 'rejected') issue = { kind: 'warning', key: 'rejected', text: 'Rejected by staff' };
    else if (basis.staffReview?.identityCurrent === false) issue = { kind: 'warning', key: 'review-identity', text: 'Saved review identity needs attention' };
    else if (unavailable) issue = { kind: 'warning', key: 'availability', text: unavailable };
    else if (identityChanged) issue = { kind: 'warning', key: 'identity', text: 'Saved product identity needs review' };
    else if (mainDifference) issue = { kind: mainDifference.key === 'brand' ? 'neutral' : 'warning', key: 'difference:' + mainDifference.key, text: differenceText(mainDifference) };
    else if (missing.length) issue = { kind: 'neutral', key: 'missing', text: 'Missing product details: ' + missing.slice(0, 2).map((row) => row.label).join(', ') };
    else if (basis.dataLimitations?.length) issue = { kind: 'neutral', key: 'data-limitations', text: 'Some saved details cannot be compared' };
    const verified = basis.compatibility?.verified === true;
    const review = !verified && issue?.kind !== 'warning' && matches.length === 0 && !staffReasons.length
        ? { kind: 'warning', key: 'review', text: 'Confirm suitability before use' }
        : null;
    const price = basis.priceComparison;
    const priceRow = price?.comparable ? { kind: price.difference < 0 ? 'match' : 'neutral', key: 'price', text: price.difference === 0 ? 'Same selling price' : formatCurrency(Math.abs(price.difference)) + (price.difference < 0 ? ' cheaper' : ' more expensive') } : null;
    const ending = [priceRow, issue, review].filter(Boolean);
    const limit = 4;
    const shownMatches = matches.slice(0, Math.max(0, limit - ending.length - Number(Boolean(staffRow))));
    const checklist = [...shownMatches];
    if (staffRow && checklist.length + ending.length < limit) checklist.push(staffRow);
    checklist.push(...ending);
    const manualReasons = staffReasons.length ? staffReasons : legacyPrimary ? [{ ...staffRow, staff: true }] : [];
    const essential = [];
    const addWarning = (key, text) => essential.push({ key, kind: 'warning', text });
    if (basis.excluded) addWarning('excluded', 'Excluded from POS alternatives');
    if (basis.staffReview?.decision === 'rejected') addWarning('rejected', 'Rejected by staff');
    if (basis.staffReview?.identityCurrent === false || identityChanged) addWarning('identity', 'Saved product identity needs review');
    if (unavailable) addWarning('availability', unavailable);
    const conflict = differences.find((row) => row.key !== 'brand');
    if (conflict) addWarning('difference:' + conflict.key, differenceText(conflict));
    else if (missing.length || basis.dataLimitations?.length || basis.compatibility?.status === 'insufficient_evidence') addWarning('evidence', 'Product details are incomplete; confirm suitability');
    else if (!verified && manualReasons.length === 0) addWarning('review', 'Confirm suitability before use');
    const limitations = basis.adminJustification?.limitations?.trim();
    if (manual && limitations && !staffReasons.some((row) => row.kind === 'warning' && row.text === limitations)) addWarning('limitations', limitations.length <= 160 ? 'Staff limitation: ' + limitations : 'Staff limitations apply; see More details');

    const normalizedText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const uniqueRows = (rows) => {
        const seen = new Set();
        return rows.filter((row) => {
            const text = normalizedText(row.text);
            if (!text || seen.has(text)) return false;
            seen.add(text);
            return true;
        });
    };
    // Saved staff input remains first. Factual rows are derived from the latest
    // assessment, never written back to the staff basis.
    const manualFacts = [
        ...matches.filter((row) => row.key === 'recorded-name'),
        priceRow,
        ...matches.filter((row) => row.key !== 'recorded-name'),
    ].filter(Boolean).slice(0, 2);
    const visibleManualRows = uniqueRows([...manualReasons, ...manualFacts, ...essential]);
    return {
        source: sourceLabel(basis),
        status: verified ? 'Verified' : 'Needs Review',
        sourceStatus,
        systemReviewStatus: manual && automatic ? reviewStatus : null,
        compatibilityNote: verified ? '' : 'Compatibility is not system-verified.',
        showSystemSuggestionInDetails: Boolean(manual && basis.systemSuggestion?.trim()),
        isManual: manual,
        hasStaffReasons: manualReasons.length > 0,
        checklist: manual ? visibleManualRows : checklist,
        staffChecklist: manual ? [] : staffReasons,
        additionalMatches: manual ? matches.filter((row) => !visibleManualRows.some((visible) => visible.key === row.key || normalizedText(visible.text) === normalizedText(row.text))) : matches.slice(shownMatches.length),
        additionalDifferences: differences.filter((row) => !(manual ? visibleManualRows : [issue]).some((visible) => visible?.key === 'difference:' + row.key)),
        additionalMissing: missing.filter((row) => issue?.key !== 'missing' || !missing.slice(0, 2).includes(row)),
        showDataLimitationsInDetails: Boolean(basis.dataLimitations?.length && issue?.key !== 'data-limitations'),
        showStaffReasonInDetails: Boolean(savedReason && (!shortStaffReason || (manual && !legacyPrimary))),
        showLimitationsInDetails: Boolean(limitations && (!manual || limitations.length > 160)),
        warning,
        unavailable,
    };
};

export const getPosRecommendationPresentation = (basis) => {
    const presentation = getRecommendationPresentation(basis);
    if (!presentation) return null;

    const staff = [...presentation.checklist.filter((row) => row.staff), ...presentation.staffChecklist];
    const savedNote = basis.adminJustification?.text?.trim();
    const normalized = (value) => String(value ?? '').trim().replace(/^Staff note:\s*/i, '').replace(/\s+/g, ' ').toLowerCase();
    if (savedNote && !staff.some((row) => normalized(row.text) === normalized(savedNote))) {
        staff.push({ key: 'staff-note', kind: 'neutral', text: `Staff note: ${savedNote}`, staff: true });
    }
    const system = presentation.checklist.filter((row) => !row.staff && row.key !== 'staff');
    const differences = presentation.additionalDifferences.map((row) => ({
        kind: row.key === 'brand' ? 'neutral' : 'warning',
        key: `difference:${row.key}`,
        text: differenceText(row),
    }));
    const rows = [...staff, ...system, ...differences];
    const seen = new Set();
    const unique = (row) => {
        const value = String(row?.text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (!value || value === 'no reason added yet.' || seen.has(value)) return false;
        seen.add(value);
        return true;
    };
    const ordered = rows.filter(unique);
    const warnings = ordered.filter((row) => row.kind === 'warning' && row.key !== 'review');
    const reasons = ordered.filter((row) => row.kind !== 'warning').slice(0, 2);
    const selectedKeys = new Set([...reasons, ...warnings].map((row) => row.key));
    const visible = ordered.filter((row) => selectedKeys.has(row.key));
    if (!visible.length) return null;
    const moreSeen = new Set(visible.map((row) => String(row.text).trim().replace(/\s+/g, ' ').toLowerCase()));
    const more = [...ordered.filter((row) => row.kind !== 'warning' && !selectedKeys.has(row.key)), ...presentation.additionalMatches]
        .filter((row) => {
            const value = String(row?.text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
            if (!value || moreSeen.has(value)) return false;
            moreSeen.add(value);
            return true;
        });
    return { visible, more };
};
