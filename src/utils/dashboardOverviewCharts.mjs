import { getProductDisplayName, hasStoredProductName } from './productDisplayName.js';

const asNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const wrapDashboardCategoryLabel = (value, maxCharacters = 22, maxLines = 2) => {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    words.forEach((word) => {
        if (word.length > maxCharacters) {
            if (current) lines.push(current);
            current = '';
            for (let index = 0; index < word.length; index += maxCharacters) {
                lines.push(word.slice(index, index + maxCharacters));
            }
            return;
        }
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxCharacters && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    });

    if (current) lines.push(current);
    const wrappedLines = lines.length ? lines : [''];
    if (wrappedLines.length <= maxLines) return wrappedLines;

    const visibleLines = wrappedLines.slice(0, maxLines);
    const lastLineIndex = visibleLines.length - 1;
    visibleLines[lastLineIndex] = `${visibleLines[lastLineIndex].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
    return visibleLines;
};

const getTopSellingProductRowIdentity = (product = {}) => {
    const code = String(product?.code || '').trim().toLocaleUpperCase();
    const name = String(product?.name || '').trim().toLocaleLowerCase();
    const unitIdentities = (product?.unitsSoldByUnit || [])
        .map((entry) => String(entry?.sellingUnit || '').trim().toLocaleLowerCase())
        .sort()
        .join('|');
    return `${code || name}\u0000${name}\u0000${unitIdentities}`;
};

export const areTopSellingProductRowsStable = (previousRows = [], nextRows = []) => (
    Array.isArray(previousRows)
    && Array.isArray(nextRows)
    && previousRows.length === nextRows.length
    && previousRows.every((product, index) => (
        getTopSellingProductRowIdentity(product) === getTopSellingProductRowIdentity(nextRows[index])
    ))
);

export const getBoundedChartTooltipPosition = ({
    anchorX,
    anchorY,
    containerWidth,
    containerHeight,
    tooltipWidth = 224,
    tooltipHeight = 68,
    gap = 12,
    padding = 8,
    minX = padding,
} = {}) => {
    const width = Math.max(0, Math.min(tooltipWidth, containerWidth - (padding * 2)));
    const height = Math.max(0, Math.min(tooltipHeight, containerHeight - (padding * 2)));
    const boundedMinX = Math.min(minX, Math.max(padding, containerWidth - width - padding));
    const maxX = Math.max(boundedMinX, containerWidth - width - padding);
    const maxY = Math.max(padding, containerHeight - height - padding);
    const bounded = (value, min, max) => Math.max(min, Math.min(max, value));

    const positionAxis = (coordinate, containerSize, tooltipSize, min, max) => {
        const after = coordinate + gap;
        if (after + tooltipSize <= containerSize - padding) return bounded(after, min, max);

        const before = coordinate - tooltipSize - gap;
        if (before >= padding) return bounded(before, min, max);

        return bounded(coordinate - (tooltipSize / 2), min, max);
    };

    return {
        x: positionAxis(anchorX, containerWidth, width, boundedMinX, maxX),
        y: positionAxis(anchorY, containerHeight, height, padding, maxY),
        width,
    };
};

export const buildDashboardTopSellingProducts = (transactions = [], inventory = [], limit = 10, categories = []) => {
    const inventoryByCode = new Map(
        inventory
            .filter((item) => item?.code)
            .map((item) => [String(item.code).trim().toUpperCase(), item])
    );
    const productStats = new Map();

    transactions.forEach((transaction) => {
        (transaction?.items || []).forEach((item) => {
            const code = String(item?.code || '').trim().toUpperCase();
            const linkedProduct = inventoryByCode.get(code);
            const displayProduct = hasStoredProductName(item) ? item : linkedProduct || item;
            const name = getProductDisplayName(displayProduct, categories) || 'Unknown product';
            const identity = code || String(item?.id || name).trim().toLowerCase();
            const sellingUnit = String(item?.sellingUnit || '').trim();
            const key = identity;
            if (!productStats.has(key)) {
                productStats.set(key, {
                    code,
                    name,
                    revenue: 0,
                    unitQuantities: new Map(),
                });
            }

            const product = productStats.get(key);
            const quantity = asNumber(item?.qty ?? item?.quantity);
            // Use the amount recorded on the historical sale line. The fallback
            // uses that line's saved unit price, never today's Product price.
            const recordedUnitPrice = asNumber(item?.price ?? item?.unitPrice);
            const lineRevenue = item?.subtotal != null
                ? asNumber(item.subtotal)
                : recordedUnitPrice * quantity;
            product.revenue += lineRevenue;

            if (quantity > 0) {
                const unitKey = sellingUnit.toLocaleLowerCase();
                const unitEntry = product.unitQuantities.get(unitKey) || { sellingUnit, quantity: 0 };
                unitEntry.quantity += quantity;
                product.unitQuantities.set(unitKey, unitEntry);
            }
        });
    });

    return Array.from(productStats.values())
        .filter((product) => product.revenue > 0)
        .map((product) => {
            const unitsSoldByUnit = Array.from(product.unitQuantities.values())
                .sort((left, right) => left.sellingUnit.localeCompare(right.sellingUnit));
            return {
                code: product.code,
                name: product.name,
                revenue: product.revenue,
                sellingUnit: unitsSoldByUnit.length === 1 ? unitsSoldByUnit[0].sellingUnit : '',
                unitsSoldByUnit,
            };
        })
        .sort((a, b) => b.revenue - a.revenue
            || a.name.localeCompare(b.name)
            || a.code.localeCompare(b.code))
        .slice(0, Math.max(0, Number(limit) || 0))
        .map((product, index) => ({ ...product, id: index + 1 }));
};

export const buildDashboardSalesByCategory = (transactions = [], inventory = []) => {
    const inventoryByCode = new Map(inventory.map((item) => [item.code, item]));
    const revenueByCategory = new Map();

    transactions.forEach((transaction) => {
        (transaction?.items || []).forEach((item) => {
            const price = asNumber(item?.price ?? item?.unitPrice);
            const quantity = asNumber(item?.qty ?? item?.quantity);
            const revenue = price * quantity;
            const inventoryItem = inventoryByCode.get(item?.code) || {};
            // Preserve the existing mapping: current product category first,
            // then the sale snapshot category, then Uncategorized.
            const category = String(inventoryItem.category || item?.category || 'Uncategorized').trim() || 'Uncategorized';
            revenueByCategory.set(category, (revenueByCategory.get(category) || 0) + revenue);
        });
    });

    return Array.from(revenueByCategory.entries())
        .filter(([, revenue]) => revenue > 0)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
};
