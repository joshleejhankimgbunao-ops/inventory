export const getAlternatives = (targetItem, inventory) => {
    if (!targetItem || !inventory) return [];
    
    return inventory.filter(item => {
        // 1. Must be different from target
        if (item.code === targetItem.code) return false;
        // 1.5 Exclude items explicitly removed from alternatives
        if (item.excludedFromAlternatives) return false;
        
        // 2. Must have stock
        if (item.stock === 0) return false;

        // 3. Category Match Priority
        const sameCategory = item.category === targetItem.category;
        
        // 4. Name Match (e.g., both "Plywood")
        // Split name to find keywords, safe check for empty name
        const targetName = targetItem.name || '';
        const itemName = item.name || '';
        const keyword = targetName.split(' ')[1] || targetName.split(' ')[0] || '';
        const similarName = itemName.toLowerCase().includes(keyword.toLowerCase());
        
        // 5. Size Match
        const sameSize = item.size === targetItem.size;

        // Broaden matching: include items that match by category OR name OR size
        return sameCategory || similarName || sameSize;
    }).sort((a, b) => {
        // Scoring Logic for Better Recommendations
        let scoreA = 0;
        let scoreB = 0;

        if (a.category === targetItem.category) scoreA += 5;
        if (a.size === targetItem.size) scoreA += 3;
        // Closer price gets higher score
        scoreA -= Math.abs(a.price - targetItem.price) / 100;

        if (b.category === targetItem.category) scoreB += 5;
        if (b.size === targetItem.size) scoreB += 3;
        scoreB -= Math.abs(b.price - targetItem.price) / 100;

        return scoreB - scoreA;
    }).slice(0, 3); // Get top 3 alternatives
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
