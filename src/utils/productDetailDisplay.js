const EMPTY_FIELD_VALUES = new Set(['n/a', 'not specified', '—']);

export const hasRecordedDetail = (value) => {
    if (value == null) return false;
    if (typeof value === 'string') {
        const text = value.trim();
        return text !== '' && !EMPTY_FIELD_VALUES.has(text.toLowerCase());
    }
    return typeof value !== 'number' || Number.isFinite(value);
};

export const formatStockWithSellingUnit = (quantity, sellingUnit) => (
    hasRecordedDetail(quantity)
        ? `${quantity}${hasRecordedDetail(sellingUnit) ? ` ${String(sellingUnit).trim()}` : ''}`
        : ''
);

export const getRecordedProductDetails = (item, attributes = [], values = {}) => {
    if (!item) return [];
    const fields = [
        ['Category', item.category],
        ['Brand', item.brand],
        ['Stock', item.stock],
        ['Price', item.price],
        ['Size', item.size],
        ['Color', item.color],
        ['Reorder Point', item.reorderPoint],
        ['Supplier', item.supplier],
    ];
    return [
        ...fields.filter(([, value]) => hasRecordedDetail(value)).map(([label, value]) => ({ key: label, label, value })),
        ...attributes.filter((attribute) => !['brand', 'color', 'size'].includes(attribute.key) && hasRecordedDetail(values[attribute.key]))
            .map((attribute) => ({ key: attribute.key, label: attribute.name, value: values[attribute.key], unit: attribute.type === 'number_unit' ? attribute.unit : '' })),
    ];
};
