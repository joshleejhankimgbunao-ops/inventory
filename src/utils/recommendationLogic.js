import { compareEvaluatedRecommendations, evaluateRecommendation } from './recommendationEvaluation.js';
import { getManualRecommendationLink, getRecommendationReview } from './recommendationBasis.js';
import { normalizeAttributeKey } from './productAttributes.js';

export { evaluateRecommendation } from './recommendationEvaluation.js';

export const isActiveRecommendationProduct = (item) => Boolean(item) && item.isActive !== false;

const BUDGET_TIERS = ['low', 'moderate', 'high'];

const DEFAULT_BUDGET_RANGES = {
    low: { min: 0, max: 500 },
    moderate: { min: 500, max: 2000 },
    high: { min: 2000, max: Number.POSITIVE_INFINITY },
};

const toFiniteNumber = (value, fallback) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeBudgetRanges = (settings) => {
    const source = settings?.budgetRanges || {};

    const lowMin = Math.max(0, toFiniteNumber(source.low?.min, DEFAULT_BUDGET_RANGES.low.min));
    const lowMax = Math.max(lowMin, toFiniteNumber(source.low?.max, DEFAULT_BUDGET_RANGES.low.max));

    const moderateMinRaw = toFiniteNumber(source.moderate?.min, lowMax);
    const moderateMin = Math.max(lowMax, moderateMinRaw);
    const moderateMax = Math.max(moderateMin, toFiniteNumber(source.moderate?.max, DEFAULT_BUDGET_RANGES.moderate.max));

    const highMinRaw = toFiniteNumber(source.high?.min, moderateMax);
    const highMin = Math.max(moderateMax, highMinRaw);
    const highMaxRaw = toFiniteNumber(source.high?.max, DEFAULT_BUDGET_RANGES.high.max);
    const highMax = Math.max(highMin, highMaxRaw);

    return {
        low: { min: lowMin, max: lowMax },
        moderate: { min: moderateMin, max: moderateMax },
        high: { min: highMin, max: highMax },
    };
};

const resolveTier = (item, settings) => {
    if (BUDGET_TIERS.includes(item?.budgetTier)) {
        return item.budgetTier;
    }

    const price = toFiniteNumber(item?.price, 0);
    const ranges = normalizeBudgetRanges(settings);

    if (price <= ranges.low.max) return 'low';
    if (price <= ranges.moderate.max) return 'moderate';
    return 'high';
};

const RELATIVE_PRICE_THRESHOLD_PERCENT = 10;
const RELATIVE_PRICE_MIN_ALLOWANCE = 20;

export const getRelativePriceTier = (
    targetPrice,
    candidatePrice,
    thresholdPercent = RELATIVE_PRICE_THRESHOLD_PERCENT,
) => {
    const safeTargetPrice = toFiniteNumber(targetPrice, 0);
    const safeCandidatePrice = toFiniteNumber(candidatePrice, 0);
    const safeThreshold = Math.max(0, toFiniteNumber(thresholdPercent, RELATIVE_PRICE_THRESHOLD_PERCENT));

    // When target has no usable price, keep alternatives neutral.
    if (safeTargetPrice <= 0) return 'standard';

    const percentDiff = ((safeCandidatePrice - safeTargetPrice) / safeTargetPrice) * 100;
    const minimumPercentEquivalent = (RELATIVE_PRICE_MIN_ALLOWANCE / safeTargetPrice) * 100;
    const effectiveThreshold = Math.max(safeThreshold, minimumPercentEquivalent);

    if (percentDiff < -effectiveThreshold) return 'value';
    if (percentDiff > effectiveThreshold) return 'premium';
    return 'standard';
};

const relativeTierToBucket = (relativeTier) => {
    if (relativeTier === 'value') return 'low';
    if (relativeTier === 'premium') return 'high';
    return 'moderate';
};

const evaluateItem = (target, item, settings, options = {}) => {
    const recommendation = evaluateRecommendation(target, item, options);
    const review = getRecommendationReview(target, item);
    const links = ['alternative', 'budget'].map((type) => getManualRecommendationLink(target, item, type)).filter(Boolean);
    const excluded = [...(target.excludedAlternatives || []), ...(target.excludedBudgetOptions || [])];
    recommendation.excluded = excluded.includes(item.code) || links.some((link) => excluded.includes(link.code));
    recommendation.staffReview = review;
    // Presentation metadata only: custom indicators never enter the evaluator.
    const basisLink = recommendation.source === 'admin-managed' ? getManualRecommendationLink(target, item, recommendation.basisRelationshipType) : null;
    recommendation.staffReasons = (basisLink?.record || review.record)?.staffReasons;
    recommendation.relationshipIdentityCurrent = links.every((link) => ['current', 'legacy'].includes(link.status));
    const manualSource = recommendation.source === 'admin-managed';
    const systemGenerated = recommendation.source === 'automatic'
        || options.systemGenerated === true
        || (manualSource && links.some((link) => link.record?.systemGenerated === true));
    recommendation.sources = {
        manual: manualSource,
        automatic: systemGenerated,
    };
    // A system review is not an approval gate for a separately stored manual
    // relationship. Keep the two sources and their decisions independent.
    const reviewAllowsUse = manualSource || (review.identityCurrent && review.decision !== 'rejected');
    recommendation.actionable = recommendation.actionable && recommendation.relationshipIdentityCurrent && !recommendation.excluded && reviewAllowsUse;
    if (review.record && recommendation.source !== 'admin-managed') {
        recommendation.adminJustification = { text: review.record.justification || null, limitations: review.record.limitations || null, updatedAt: review.record.updatedAt, updatedByName: review.record.updatedByName };
    }
    recommendation.availability.stockStatus = getStockStatus(item, settings);
    return {
        ...item,
        recommendation,
        budgetTier: resolveTier(item, settings),
        recommendationTier: recommendation.priceComparison.comparable ? getRelativePriceTier(target.price, item.price) : null,
    };
};

const _getSystemSuggestions = (target, inventory, settings, options = {}) => {
    if (!isActiveRecommendationProduct(target)) return [];
    return inventory
    .filter(isActiveRecommendationProduct)
    .map((item) => evaluateItem(target, item, settings, { ...options, source: 'automatic' }))
    .filter((item) => item.recommendation.actionable)
    .sort(compareEvaluatedRecommendations);
};

const currentTarget = (target, inventory) => inventory.find((item) => target.id ? item.id === target.id : item.code === target.code) || target;

export const getBudgetTierByPrice = (price, settings) => {
    const ranges = normalizeBudgetRanges(settings);
    const safePrice = toFiniteNumber(price, 0);

    if (safePrice <= ranges.low.max) return 'low';
    if (safePrice <= ranges.moderate.max) return 'moderate';
    return 'high';
};

export const getAlternatives = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !Array.isArray(inventory) || !isActiveRecommendationProduct(targetItem)) return [];
    targetItem = currentTarget(targetItem, inventory);
    if (!isActiveRecommendationProduct(targetItem)) return [];

    const maxSuggestions = Number.isFinite(Number(options.maxSuggestions))
        ? Math.max(1, Number(options.maxSuggestions))
        : 3;
    
    const seen = new Set();
    const managed = [];
    const automatic = [];
    for (const item of inventory) {
        if (!isActiveRecommendationProduct(item)) continue;
        if (!item.code || seen.has(item.code) || item.code === targetItem.code || (item.id && item.id === targetItem.id)) continue;
        seen.add(item.code);
        // Prefer alternative basis; preserve budget-only basis and its edit path.
        const alternative = getManualRecommendationLink(targetItem, item);
        const budget = getManualRecommendationLink(targetItem, item, 'budget');
        const relationshipType = alternative ? 'alternative' : budget ? 'budget' : 'alternative';
        const linked = Boolean(alternative || budget);
        const assessed = evaluateItem(targetItem, item, settings, { ...options, relationshipType, source: linked ? 'admin-managed' : 'automatic' });
        const basis = assessed.recommendation;
        const blocked = basis.excluded || (!linked && (basis.staffReview.decision === 'rejected' || !basis.staffReview.identityCurrent));
        if (blocked && options.includeBlocked !== true) continue;
        const reviewable = options.includeUnavailable === true && (linked || basis.staffReview.record || !basis.staffReview.identityCurrent || blocked);
        if (!basis.actionable && !reviewable) continue;
        (linked ? managed : automatic).push(assessed);
    }
    return [...managed.sort(compareEvaluatedRecommendations), ...automatic.sort(compareEvaluatedRecommendations).slice(0, maxSuggestions)];
};

// Flags current actionable system suggestions in the management picker.
export const getRawSystemRecommendations = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !Array.isArray(inventory)) return [];
    targetItem = currentTarget(targetItem, inventory);
    return _getSystemSuggestions(targetItem, inventory, settings, options).slice(0, 5);
};

// Source classification is based on the rule evaluator, independently of
// approval/rejection, stock blocks, and the capped picker preview.
export const getSystemRecommendationSourceCodes = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !Array.isArray(inventory) || !isActiveRecommendationProduct(targetItem)) return [];
    targetItem = currentTarget(targetItem, inventory);
    if (!isActiveRecommendationProduct(targetItem)) return [];
    return inventory
        .filter((item) => isActiveRecommendationProduct(item) && item.code && item.code !== targetItem.code && (!item.id || item.id !== targetItem.id))
        .map((item) => evaluateItem(targetItem, item, settings, { ...options, source: 'automatic' }))
        .filter((item) => item.recommendation.compatibility.automaticEligible)
        .sort(compareEvaluatedRecommendations)
        .map((item) => item.code);
};

export const getAlternativesByBudget = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !Array.isArray(inventory) || !isActiveRecommendationProduct(targetItem)) return { low: [], moderate: [], high: [] };
    targetItem = currentTarget(targetItem, inventory);
    if (!isActiveRecommendationProduct(targetItem)) return { low: [], moderate: [], high: [] };

    const targetStatus = getStockStatus(targetItem, settings);
    const includeNonInStock = options.includeNonInStock === true;
    if (!includeNonInStock && targetStatus !== 'In Stock') {
        return { low: [], moderate: [], high: [] };
    }

    const limitPerTier = Number.isFinite(Number(options.limitPerTier))
        ? Math.max(1, Number(options.limitPerTier))
        : 2;

    const excludedBudgetCodes = targetItem.excludedBudgetOptions || [];
    const manualBudgetCodes = targetItem.manualBudgetOptions || [];
    const alternatives = getAlternatives(targetItem, inventory, settings, {
        ...options,
        maxSuggestions: options.maxSuggestions || 9,
    }).filter((item) => !excludedBudgetCodes.includes(item.code));
    const manualBudgetOptions = inventory
        .filter((item) => {
            if (!isActiveRecommendationProduct(item)) return false;
            const link = getManualRecommendationLink(targetItem, item, 'budget');
            return link && item.code !== targetItem.code && !excludedBudgetCodes.includes(link.code) && !excludedBudgetCodes.includes(item.code);
        })
        .map((item) => evaluateItem(targetItem, item, settings, { ...options, source: 'admin-managed', relationshipType: 'budget' }))
        .filter((item) => options.includeUnavailable === true || item.recommendation.actionable);
    const budgetCandidates = [
        ...manualBudgetOptions,
        ...alternatives.filter((item) => !manualBudgetCodes.includes(item.code) && !getManualRecommendationLink(targetItem, item, 'budget')),
    ];

    const grouped = {
        low: [],
        moderate: [],
        high: [],
    };

    budgetCandidates.forEach((alt) => {
        const comparable = alt.recommendation.priceComparison.comparable;
        if (!comparable && !(options.includeUnavailable === true && alt.recommendation.source === 'admin-managed')) return;
        const relativeTier = comparable ? getRelativePriceTier(targetItem?.price, alt?.price) : null;
        const tier = relativeTierToBucket(relativeTier);
        if (grouped[tier]) {
            grouped[tier].push({ ...alt, budgetTier: tier, recommendationTier: relativeTier, recommendation: { ...alt.recommendation, relationshipType: 'budget' } });
        }
    });

    BUDGET_TIERS.forEach((tier) => {
        grouped[tier] = grouped[tier]
            .sort(compareEvaluatedRecommendations)
            .slice(0, limitPerTier);
    });

    return grouped;
};

export const getRecommendationAvailability = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !Array.isArray(inventory)) {
        return {
            stockStatus: getStockStatus(targetItem, settings),
            alternatives: [],
            budgetOptions: [],
            hasAlternatives: false,
            hasBudgetOptions: false,
            hasAny: false,
        };
    }
    targetItem = currentTarget(targetItem, inventory);
    if (!isActiveRecommendationProduct(targetItem)) {
        return {
            stockStatus: getStockStatus(targetItem, settings),
            alternatives: [], budgetOptions: [], hasAlternatives: false, hasBudgetOptions: false, hasAny: false,
        };
    }

    const stockStatus = getStockStatus(targetItem, settings);
    const alternatives = getAlternatives(targetItem, inventory, settings, {
        ...options,
        maxSuggestions: options.alternativeLimit || 8,
    });
    // Retain the legacy response shape for old callers, without a second list.
    const budgetOptions = [];
    const hasAlternatives = alternatives.length > 0;
    const hasBudgetOptions = budgetOptions.length > 0;

    return {
        stockStatus,
        alternatives,
        budgetOptions,
        hasAlternatives,
        hasBudgetOptions,
        hasAny: hasAlternatives || hasBudgetOptions,
    };
};

export const getRecommendationModeForStockState = (availability) => {
    return availability?.hasAlternatives ? 'alternative' : null;
};

// POS discovery is separate from substitute eligibility. Only the strict list
// above can be used by prepareRecommendationCartAddition.
export const getPosRecommendationAvailability = (targetItem, inventory, settings, options = {}) => {
    const empty = { ...getRecommendationAvailability(null, [], settings), otherOptions: [], hasOtherOptions: false };
    if (!targetItem || !Array.isArray(inventory)) return empty;
    const target = inventory.find((item) => item.code === targetItem.code && (!targetItem.id || item.id === targetItem.id));
    if (!target || target.isActive === false || target.isArchived === true) return empty;
    const baseAvailability = getRecommendationAvailability(target, inventory, settings, { ...options, includeUnavailable: false, includeBlocked: false });
    const alternatives = baseAvailability.alternatives.filter((item) => {
        const manual = getManualRecommendationLink(target, item, 'alternative') || getManualRecommendationLink(target, item, 'budget');
        if (manual) return true;
        const review = getRecommendationReview(target, item);
        return review.identityCurrent && review.decision === 'approved';
    });
    const availability = {
        ...baseAvailability,
        alternatives,
        hasAlternatives: alternatives.length > 0,
        hasAny: alternatives.length > 0,
    };
    const seen = new Set([target.code, ...availability.alternatives.map((item) => item.code)]);
    const otherOptions = [];
    for (const item of inventory) {
        if (!isActiveRecommendationProduct(item)) continue;
        if (!item.code || seen.has(item.code) || (item.id && item.id === target.id)) continue;
        seen.add(item.code);
        const alternativeLink = getManualRecommendationLink(target, item);
        const link = alternativeLink || getManualRecommendationLink(target, item, 'budget');
        if (!link) continue;
        const assessed = evaluateItem(target, item, settings, { ...options, source: 'admin-managed', relationshipType: alternativeLink ? 'alternative' : 'budget' });
        const basis = assessed.recommendation;
        if (basis.actionable || !basis.availability.canFulfill || basis.excluded || !basis.relationshipIdentityCurrent
            || !basis.staffReview.identityCurrent || basis.staffReview.decision === 'rejected' || !basis.compatibility.identified) continue;
        // A saved link cannot make conflicting product types related options.
        if (basis.differences.some((row) => ['product_type', 'specific_product_type'].includes(normalizeAttributeKey(row.key)))) continue;
        const difference = basis.differences.find((row) => normalizeAttributeKey(row.key) !== 'brand');
        if (!difference) continue;
        otherOptions.push({ ...assessed, posReason: `Different ${difference.label.toLowerCase()}: ${difference.candidateValue}${difference.candidateUnit ? ` ${difference.candidateUnit}` : ''}` });
    }
    return { ...availability, otherOptions, hasOtherOptions: otherOptions.length > 0, hasAny: availability.hasAlternatives || otherOptions.length > 0 };
};

export const getPosRecommendationReason = (item) => {
    const match = item.recommendation?.matchedAttributes?.find((row) => normalizeAttributeKey(row.key) !== 'brand');
    return match ? `Matching ${match.label.toLowerCase()}: ${match.candidateValue}${match.candidateUnit ? ` ${match.candidateUnit}` : ''}` : '';
};

export const getPosRecommendationAction = (availability) => {
    return availability?.hasAlternatives || availability?.hasOtherOptions ? 'alternative' : null;
};

// Re-resolve the selected SKU against the live POS catalog and recommendation
// rules immediately before the shared cart-add handler is called.
export const getPosRecommendationForCartAddition = ({
    targetCode,
    targetId,
    candidateCode,
    candidateId,
    inventory = [],
    cart = [],
    settings,
    categories = [],
    requestedQuantity = 1,
}) => {
    const quantity = Number(requestedQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return { ok: false, error: 'Enter a quantity of at least 1.' };
    }

    const getIdentity = (item) => String(item?.id ?? item?._id ?? '');
    const target = inventory.find((item) => item?.code === targetCode
        && (!targetId || getIdentity(item) === String(targetId)));
    const candidate = inventory.find((item) => item?.code === candidateCode
        && (!candidateId || getIdentity(item) === String(candidateId)));
    if (!target || target.isActive === false || target.isArchived === true
        || !candidate || candidate.isActive === false || candidate.isArchived === true) {
        return { ok: false, error: 'This product or alternative is no longer available. Recheck stock and try again.' };
    }

    const cartQuantity = cart
        .filter((item) => item.code === candidate.code)
        .reduce((total, item) => total + Math.max(0, Number(item.qty) || 0), 0);
    const remainingQuantity = Math.max(0, (Number(candidate.stock) || 0) - cartQuantity);
    if (remainingQuantity < quantity) {
        return {
            ok: false,
            error: `Only ${remainingQuantity} ${candidate.sellingUnit || 'units'} available. Recheck stock or adjust the quantity.`,
        };
    }

    const availability = getPosRecommendationAvailability(target, inventory, settings, {
        categories,
        cart,
        requestedQuantity: quantity,
        maxSuggestions: inventory.length,
    });
    const current = [...availability.alternatives, ...availability.otherOptions]
        .find((item) => item.code === candidateCode && getIdentity(item) === getIdentity(candidate));
    if (!current) {
        return { ok: false, error: 'This alternative is no longer eligible. Recheck recommendations and try again.' };
    }

    if (!current.recommendation?.availability?.canFulfill) {
        const availableQuantity = Math.max(0, Number(current.recommendation?.availability?.availableQuantity) || 0);
        return {
            ok: false,
            error: `Only ${availableQuantity} ${current.sellingUnit || 'units'} available. Recheck stock or adjust the quantity.`,
        };
    }
    return { ok: true, product: current };
};

// Re-evaluate a modal selection against current SKU data and cart quantities.
// The caller commits this result and announces success only when ok is true.
export const prepareRecommendationCartAddition = ({ targetCode, targetId, candidateCode, candidateId, inventory, cart = [], settings, categories = [], requestedQuantity = 1 }) => {
    const target = inventory.find((item) => item.code === targetCode && (!targetId || item.id === targetId));
    const candidate = inventory.find((item) => item.code === candidateCode && (!candidateId || item.id === candidateId));
    if (!isActiveRecommendationProduct(target) || !isActiveRecommendationProduct(candidate)) return { ok: false, error: 'This product is no longer available. Refresh and try again.' };
    const options = { categories, cart, requestedQuantity, maxSuggestions: inventory.length, limitPerTier: inventory.length };
    const assessment = evaluateItem(target, candidate, settings, { ...options, source: 'admin-managed' }).recommendation;
    if (!assessment.availability.canFulfill) {
        return { ok: false, error: `Only ${assessment.availability.availableQuantity} additional ${candidate.sellingUnit || 'units'} available.` };
    }
    const manualLink = getManualRecommendationLink(target, candidate, 'alternative') || getManualRecommendationLink(target, candidate, 'budget');
    const review = getRecommendationReview(target, candidate);
    if (!manualLink && (!review.identityCurrent || review.decision !== 'approved')) {
        return { ok: false, error: 'This system-generated recommendation must be approved before use.' };
    }
    const candidates = getAlternatives(target, inventory, settings, options);
    const selected = candidates.find((item) => item.code === candidateCode);
    if (!selected) return { ok: false, error: 'This recommendation requires review or is no longer eligible.' };
    const existing = cart.find((item) => item.code === candidateCode);
    const nextCart = existing
        ? cart.map((item) => item.code === candidateCode ? { ...item, ...selected, qty: Number(item.qty) + Number(requestedQuantity) } : item)
        : [...cart, { ...selected, qty: Number(requestedQuantity) }];
    return { ok: true, product: selected, cart: nextCart };
};

export const getManualRecommendationCandidates = (targetItem, inventory, options = {}) => {
    if (!targetItem || !Array.isArray(inventory) || !isActiveRecommendationProduct(targetItem)) return [];
    targetItem = currentTarget(targetItem, inventory);
    if (!isActiveRecommendationProduct(targetItem)) return [];

    const existingCodes = new Set(options.existingCodes || []);
    const systemCodes = new Set(options.systemCodes || []);
    const search = String(options.search || '').trim().toLowerCase();
    const category = options.category || 'All';
    const seenCodes = new Set();

    return inventory
        .map((item) => ({
            ...item,
            id: String(item?.id || item?._id || '').trim(),
            code: String(item?.code || item?.sku || '').trim(),
        }))
        .filter((item) => {
            const code = String(item?.code || '').trim();
            if (!item?.id || !code || seenCodes.has(code)) return false;
            if (item.id === targetItem.id || code === targetItem.code) return false;
            if (item.isActive === false || item.isArchived === true) return false;
            if (existingCodes.has(code)) return false;
            if (category !== 'All' && item.category !== category) return false;
            if (search && ![item.name, code, item.brand]
                .some((value) => String(value || '').toLowerCase().includes(search))) return false;
            seenCodes.add(code);
            return true;
        })
        .map((item) => {
            const isSystemRecommended = options.recommendationType === 'alternative' && systemCodes.has(item.code);
            return {
                ...item,
                ...evaluateItem(targetItem, item, options.settings, { ...options, source: 'candidate', relationshipType: options.recommendationType, systemGenerated: isSystemRecommended }),
                isSystemRecommended,
            };
        })
        .sort((a, b) => {
            if (a.isSystemRecommended !== b.isSystemRecommended) return a.isSystemRecommended ? -1 : 1;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });
};

export const getBudgetPreviewOptions = (budgetBuckets, limit = 3) => {
    const safeLimit = Math.max(0, Number(limit) || 0);
    const tiers = ['low', 'moderate', 'high'];
    const allOptions = tiers.flatMap((tier) => budgetBuckets?.[tier] || []);
    const selected = tiers
        .map((tier) => budgetBuckets?.[tier]?.[0])
        .filter(Boolean)
        .slice(0, safeLimit);
    const selectedCodes = new Set(selected.map((item) => item.code));

    for (const option of allOptions) {
        if (selected.length >= safeLimit) break;
        if (!selectedCodes.has(option.code)) {
            selected.push(option);
            selectedCodes.add(option.code);
        }
    }

    return { allOptions, visibleOptions: selected, hiddenCount: Math.max(0, allOptions.length - selected.length) };
};

// --- Helper Functions for Stock Logic ---

export const getTargetStock = (item, settings) => {
    // Default fallback
    const defaultMax = 100;
    
    // Check if settings exists, if not use safe defaults
    if (!settings) return defaultMax;

    const TARGET_STOCK_LEVEL_GLOBAL = settings.maxStockLimit || defaultMax;
    
    // 1. Specific Product Rule from Settings
    if (settings.stockRules && settings.stockRules.products && settings.stockRules.products[item.code]) {
        return Number(settings.stockRules.products[item.code]);
    }
    // 2. Category Rule from Settings
    if (item.category && settings.stockRules && settings.stockRules.categories && settings.stockRules.categories[item.category]) {
        return Number(settings.stockRules.categories[item.category]);
    }
    // 3. Item Level Override (Legacy/Direct)
    if (item.maxStock) {
        return Number(item.maxStock);
    }

    // 4. Global Default
    return Number(TARGET_STOCK_LEVEL_GLOBAL);
};

export const getLowStockThreshold = (item, settings) => {
    // Safety check for settings
    const defaultLow = 10;
    
    // Get target stock (Max Stock)
    const itemMaxStock = getTargetStock(item, settings);
    
    // Get percentage (e.g., 10% of Max Stock)
    const lowStockPercent = (settings && settings.lowStockAlert !== undefined) ? settings.lowStockAlert : defaultLow;
    
    // Logic: Threshold is X% of Max Stock. 
    // Wait, if lowStockAlert is a NUMBER (qty) or PERCENTAGE?
    // Looking at Settings.jsx default: lowStockAlert: 10. Usually means 10 units?
    // But previous code was treating it as PERCENTAGE (/ 100).
    // Let's assume it IS percentage based on previous logic.
    
    return Math.floor(itemMaxStock * (lowStockPercent / 100));
};

export const getStockStatus = (item, settings) => {
    const stock = Number(item?.stock || 0);
    if (stock <= 0) return 'Out of Stock';

    const lowThreshold = Math.max(1, Number(getLowStockThreshold(item, settings)) || 10);
    if (stock <= lowThreshold) return 'Low Stock';
    return 'In Stock';
};

// NEW: Smart Restock Recommendation for Suppliers
export const getSupplierRestockRecommendations = (supplier, inventory, settings) => {
    if (!supplier || !inventory) return [];

    const keywords = supplier.products ? supplier.products.toLowerCase().split(',').map(s => s.trim()).filter(Boolean) : [];
    const supplierName = (supplier?.name || '').toLowerCase();
    const capabilities = Array.isArray(supplier?.supplierCapabilities)
        ? supplier.supplierCapabilities
            .map((entry) => ({
                category: String(entry?.category || '').trim().toLowerCase(),
                brand: String(entry?.brand || '').trim().toLowerCase(),
            }))
            .filter((entry) => entry.category)
        : [];

    return inventory.filter(item => {
        const lowStockThreshold = getLowStockThreshold(item, settings);

        const itemCategory = (item.category || '').toLowerCase();
        const itemName = (item.name || '').toLowerCase();
        const itemBrand = (item.brand || '').toLowerCase();
        const itemSupplier = (item.supplier || '').toLowerCase();

        const matchesCapabilities = capabilities.length > 0 && capabilities.some((entry) => {
            if (entry.category !== itemCategory) return false;
            if (!entry.brand) return true;
            return entry.brand === itemBrand;
        });

        const matchesLegacyKeywords = keywords.some(keyword => itemCategory.includes(keyword) || itemName.includes(keyword));

        const isMatch = (itemSupplier && itemSupplier === supplierName) || matchesCapabilities || matchesLegacyKeywords;

        return isMatch && item.stock <= lowStockThreshold;
    }).map(item => {
        const itemMaxStock = getTargetStock(item, settings);
        return {
            ...item,
            recommendedOrder: Math.max(0, itemMaxStock - item.stock)
        };
    });
};
