import limits from '../../shared/recommendationBasisLimits.json' with { type: 'json' };

export const RECOMMENDATION_BASIS_LIMITS = limits;
const referenceId = (value) => String(value?._id || value || '');

export const mergeRecommendationProduct = (current, incoming) => {
    if (!current || Number(current.recommendationRevision || 0) > Number(incoming.recommendationRevision || 0)) return current || incoming;
    if (new Date(current.updatedAt).getTime() <= new Date(incoming.updatedAt).getTime() || !current.updatedAt) return incoming;
    // Keep a newer stock/price snapshot while accepting acknowledged link fields.
    return { ...current, ...Object.fromEntries(['manualAlternatives', 'excludedAlternatives', 'manualBudgetOptions', 'excludedBudgetOptions', 'recommendationBases', 'recommendationReviews', 'recommendationRevision'].map((key) => [key, incoming[key]])) };
};

export const validateRecommendationBasis = ({ justification = '', limitations = '', staffReasons, systemSuggestion }) => {
    for (const [key, label] of [['justification', 'Manual Justification'], ['limitations', 'Important Differences / Limitations']]) {
        const value = key === 'justification' ? justification : limitations;
        if (typeof value !== 'string') return `${label} must be text.`;
        if (value.trim().length > limits[key]) return `${label} cannot exceed ${limits[key]} characters.`;
        if ([...value].some((char) => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char))) return 'Basis text contains unsupported control characters.';
    }
    if (systemSuggestion !== undefined) {
        if (typeof systemSuggestion !== 'string') return 'Original system suggestion must be text.';
        if (systemSuggestion.trim().length > limits.systemSuggestion) return `Original system suggestion cannot exceed ${limits.systemSuggestion} characters.`;
        if ([...systemSuggestion].some((char) => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char))) return 'Original system suggestion contains unsupported control characters.';
    }
    if (staffReasons !== undefined) {
        if (!Array.isArray(staffReasons) || staffReasons.length > limits.reasonCount) return `Use up to ${limits.reasonCount} staff reasons.`;
        for (const row of staffReasons) {
            if (!row || !['check', 'neutral', 'warning'].includes(row.indicator)) return 'Choose a valid staff reason indicator.';
            if (typeof row.text !== 'string' || !row.text.trim() || row.text.trim().length > limits.reasonText) return `Each staff reason needs 1 to ${limits.reasonText} characters.`;
            if ([...row.text].some((char) => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char))) return 'Staff reason contains unsupported control characters.';
        }
    }
    return '';
};

// The SKU lists remain authoritative. Metadata adds a stable identity binding,
// so a renamed/reused SKU cannot inherit another product's saved justification.
export const getManualRecommendationLink = (target, candidate, type = 'alternative') => {
    const codes = target?.[type === 'budget' ? 'manualBudgetOptions' : 'manualAlternatives'] || [];
    const rows = (target?.recommendationBases || []).filter((row) => row.type === type && codes.includes(row.candidateSku));
    const byId = rows.find((row) => referenceId(row.candidateProduct) === referenceId(candidate?.id || candidate?._id));
    if (byId) return { code: byId.candidateSku, record: byId, status: byId.targetSku && byId.targetSku !== target?.code ? 'target_sku_changed' : byId.candidateSku === candidate?.code ? 'current' : 'sku_changed' };
    if (!codes.includes(candidate?.code)) return null;
    const byCode = rows.find((row) => row.candidateSku === candidate.code);
    return { code: candidate.code, record: null, status: byCode ? 'identity_mismatch' : 'legacy' };
};

export const getRecommendationReview = (target, candidate) => {
    const rows = target?.recommendationReviews || [];
    const record = rows.find((row) => referenceId(row.candidateProduct) === referenceId(candidate?.id || candidate?._id))
        || rows.find((row) => row.candidateSku === candidate?.code);
    const identityCurrent = !record || (referenceId(record.candidateProduct) === referenceId(candidate?.id || candidate?._id)
        && record.candidateSku === candidate?.code && record.targetSku === target?.code);
    return { record: identityCurrent ? record || null : null, identityCurrent, decision: identityCurrent ? record?.decision || 'not_reviewed' : 'not_reviewed' };
};

// Manual membership is stored; automatic suggestions are derived from current
// product facts. A saved review remains manageable even when now blocked.
export const getRecommendationActionSources = (target, candidate, systemCodes = new Set()) => {
    const alternative = getManualRecommendationLink(target, candidate, 'alternative');
    const budget = getManualRecommendationLink(target, candidate, 'budget');
    const manual = Boolean(alternative || budget);
    const persistedSources = candidate?.recommendation?.sources;
    const review = getRecommendationReview(target, candidate);
    return {
        manual,
        // Approval state never determines where a recommendation came from.
        // New manual links persist whether they were also surfaced by the
        // system; legacy unlinked review records remain system-managed.
        automatic: typeof persistedSources?.automatic === 'boolean'
            ? persistedSources.automatic
            : manual ? alternative?.record?.systemGenerated === true || budget?.record?.systemGenerated === true
                : systemCodes.has(candidate?.code) || Boolean(review.record),
        manualType: alternative ? 'alternative' : budget ? 'budget' : null,
        overlappingBasis: Boolean(alternative && budget),
    };
};

// The review drawer shows active blocks, not every historical review or a
// manual link that was simply removed.
export const getBlockedRecommendationEntries = (entries = []) => entries.filter((entry) =>
    entry?.recommendation?.excluded === true || entry?.recommendation?.staffReview?.decision === 'rejected'
);
