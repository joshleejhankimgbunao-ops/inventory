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

const getTierDistance = (tierA, tierB) => {
    const idxA = BUDGET_TIERS.indexOf(tierA);
    const idxB = BUDGET_TIERS.indexOf(tierB);
    if (idxA < 0 || idxB < 0) return 0;
    return Math.abs(idxA - idxB);
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

// --- Internal Scoring Helper ---
const _getSystemSuggestions = (targetItem, inventory, settings) => {
    const targetTier = resolveTier(targetItem, settings);

    return inventory.filter(item => {
        // Must be different
        if (item.code === targetItem.code) return false;
        
        // Exclusions/Manuals are handled by caller if needed

        // Must have stock
        if (item.stock === 0) return false;

        // Matching Logic
        const sameCategory = item.category === targetItem.category;
        
        const targetName = targetItem.name || '';
        const itemName = item.name || '';
        // Look for similar keyword in name (first or second word)
        const keyword = targetName.split(' ')[1] || targetName.split(' ')[0] || '';
        // Skip keyword matching if keyword is too short or common
        const hasKeyword = keyword && keyword.length > 2;
        const similarName = hasKeyword && itemName.toLowerCase().includes(keyword.toLowerCase());
        
        const sameSize = item.size === targetItem.size;
        const sameBrand = (item.brand || '').trim().toLowerCase() === (targetItem.brand || '').trim().toLowerCase();

        return sameCategory || similarName || sameSize || sameBrand;
    }).sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        const tierA = resolveTier(a, settings);
        const tierB = resolveTier(b, settings);
        const tierDistanceA = getTierDistance(tierA, targetTier);
        const tierDistanceB = getTierDistance(tierB, targetTier);

        if (a.category === targetItem.category) scoreA += 5;
        if (a.size === targetItem.size) scoreA += 3;
        if ((a.brand || '').trim().toLowerCase() === (targetItem.brand || '').trim().toLowerCase()) scoreA += 2;
        if (tierDistanceA === 0) scoreA += 4;
        else if (tierDistanceA === 1) scoreA += 2;
        scoreA -= Math.abs(a.price - targetItem.price) / 100;

        if (b.category === targetItem.category) scoreB += 5;
        if (b.size === targetItem.size) scoreB += 3;
        if ((b.brand || '').trim().toLowerCase() === (targetItem.brand || '').trim().toLowerCase()) scoreB += 2;
        if (tierDistanceB === 0) scoreB += 4;
        else if (tierDistanceB === 1) scoreB += 2;
        scoreB -= Math.abs(b.price - targetItem.price) / 100;

        return scoreB - scoreA;
    });
};

export const getBudgetTierByPrice = (price, settings) => {
    const ranges = normalizeBudgetRanges(settings);
    const safePrice = toFiniteNumber(price, 0);

    if (safePrice <= ranges.low.max) return 'low';
    if (safePrice <= ranges.moderate.max) return 'moderate';
    return 'high';
};

export const getAlternatives = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !inventory) return [];

    const maxSuggestions = Number.isFinite(Number(options.maxSuggestions))
        ? Math.max(1, Number(options.maxSuggestions))
        : 3;
    
    const manualCodes = targetItem.manualAlternatives || [];
    const excludedCodes = targetItem.excludedAlternatives || [];

    // 1. Get explicitly manually added alternatives
    const manualAlternatives = inventory
        .filter(item => manualCodes.includes(item.code))
        .map(item => ({
            ...item,
            budgetTier: resolveTier(item, settings),
            recommendationTier: getRelativePriceTier(targetItem?.price, item?.price),
        }));

    // 2. Get AI suggestions (filtered for exclusions/duplicates)
    const suggestions = _getSystemSuggestions(targetItem, inventory, settings).filter(item => {
        if (excludedCodes.includes(item.code)) return false;
        if (manualCodes.includes(item.code)) return false; // Already manually added
        return true;
        }).slice(0, maxSuggestions)
            .map(item => ({
                    ...item,
                    budgetTier: resolveTier(item, settings),
                    recommendationTier: getRelativePriceTier(targetItem?.price, item?.price),
            })); // Limit suggestions

    return [...manualAlternatives, ...suggestions];
};

// Returns raw top suggestions without filtering exclusions (for UI flagging)
export const getRawSystemRecommendations = (targetItem, inventory, settings) => {
    if (!targetItem || !inventory) return [];
    // Return top 5 potential recommendations
    return _getSystemSuggestions(targetItem, inventory, settings)
        .slice(0, 5)
        .map(item => ({
            ...item,
            budgetTier: resolveTier(item, settings),
            recommendationTier: getRelativePriceTier(targetItem?.price, item?.price),
        }));
};

export const getAlternativesByBudget = (targetItem, inventory, settings, options = {}) => {
    if (!targetItem || !inventory) return { low: [], moderate: [], high: [] };

    const targetStatus = getStockStatus(targetItem, settings);
    const includeNonInStock = options.includeNonInStock === true;
    if (!includeNonInStock && targetStatus !== 'In Stock') {
        return { low: [], moderate: [], high: [] };
    }

    const limitPerTier = Number.isFinite(Number(options.limitPerTier))
        ? Math.max(1, Number(options.limitPerTier))
        : 2;

    const alternatives = getAlternatives(targetItem, inventory, settings, {
        maxSuggestions: options.maxSuggestions || 9,
    });

    const grouped = {
        low: [],
        moderate: [],
        high: [],
    };

    alternatives.forEach((alt) => {
        const relativeTier = getRelativePriceTier(targetItem?.price, alt?.price);
        const tier = relativeTierToBucket(relativeTier);
        if (grouped[tier]) {
            grouped[tier].push({ ...alt, budgetTier: tier, recommendationTier: relativeTier });
        }
    });

    const targetPrice = toFiniteNumber(targetItem?.price, 0);

    BUDGET_TIERS.forEach((tier) => {
        grouped[tier] = grouped[tier]
            .sort((a, b) => {
                const priceDeltaA = Math.abs(toFiniteNumber(a.price, 0) - targetPrice);
                const priceDeltaB = Math.abs(toFiniteNumber(b.price, 0) - targetPrice);
                if (priceDeltaA !== priceDeltaB) return priceDeltaA - priceDeltaB;
                return (b.stock || 0) - (a.stock || 0);
            })
            .slice(0, limitPerTier);
    });

    return grouped;
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
    if (!supplier || !inventory || !supplier.products) return [];

    // 1. Parse Supplier's Product Keywords (e.g. 'Tiles, Paints' -> ['tiles', 'paints'])
    const keywords = supplier.products ? supplier.products.toLowerCase().split(',').map(s => s.trim()).filter(Boolean) : [];
    const supplierName = (supplier?.name || '').toLowerCase();

    return inventory.filter(item => {
        // Resolve Threshold
        const lowStockThreshold = getLowStockThreshold(item, settings);

        // Check if item matches any supplier keyword (Category or Name)
        const itemCategory = (item.category || '').toLowerCase();
        const itemName = (item.name || '').toLowerCase();
        const itemSupplier = (item.supplier || '').toLowerCase(); // Added direct supplier check

        // Match Logic: 
        // 1. Direct Supplier Name Match (Strongest)
        // 2. Keyword Match in Category or Name (Fallback)
        const isMatch = (itemSupplier && itemSupplier === supplierName) || 
                        keywords.some(keyword => itemCategory.includes(keyword) || itemName.includes(keyword));

        // Filter: Match Found AND Stock is Low (using dynamic threshold)
        return isMatch && item.stock <= lowStockThreshold;
    }).map(item => {
        const itemMaxStock = getTargetStock(item, settings);
        return {
            ...item,
            recommendedOrder: Math.max(0, itemMaxStock - item.stock)
        };
    });
};
