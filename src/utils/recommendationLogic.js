// --- Internal Scoring Helper ---
const _getSystemSuggestions = (targetItem, inventory) => {
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

        return sameCategory || similarName || sameSize;
    }).sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        if (a.category === targetItem.category) scoreA += 5;
        if (a.size === targetItem.size) scoreA += 3;
        scoreA -= Math.abs(a.price - targetItem.price) / 100;

        if (b.category === targetItem.category) scoreB += 5;
        if (b.size === targetItem.size) scoreB += 3;
        scoreB -= Math.abs(b.price - targetItem.price) / 100;

        return scoreB - scoreA;
    });
};

export const getAlternatives = (targetItem, inventory) => {
    if (!targetItem || !inventory) return [];
    
    const manualCodes = targetItem.manualAlternatives || [];
    const excludedCodes = targetItem.excludedAlternatives || [];

    // 1. Get explicitly manually added alternatives
    const manualAlternatives = inventory.filter(item => manualCodes.includes(item.code));

    // 2. Get AI suggestions (filtered for exclusions/duplicates)
    const suggestions = _getSystemSuggestions(targetItem, inventory).filter(item => {
        if (excludedCodes.includes(item.code)) return false;
        if (manualCodes.includes(item.code)) return false; // Already manually added
        return true;
    }).slice(0, 3); // Limit suggestions

    return [...manualAlternatives, ...suggestions];
};

// Returns raw top suggestions without filtering exclusions (for UI flagging)
export const getRawSystemRecommendations = (targetItem, inventory) => {
    if (!targetItem || !inventory) return [];
    // Return top 5 potential recommendations
    return _getSystemSuggestions(targetItem, inventory).slice(0, 5);
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
