export const normalizeAttributeKey = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

export const getEffectiveProductAttributes = (category = {}) => {
    if (Number(category?.attributeSchemaVersion || 0) >= 1) {
        if (!Array.isArray(category?.productAttributes)) return [];
        return [...category.productAttributes].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    }
    const definitions = [];
    if (category?.showBrand) definitions.push({ name: 'Brand', key: 'brand', type: 'text', required: !!category.requireBrand });
    if (category?.showColor) definitions.push({ name: 'Color', key: 'color', type: 'text', required: !!category.requireColor });
    if (category?.showSize !== false) definitions.push({ name: 'Size / Variant', key: 'size', type: 'text', required: !!category.requireSize });
    return definitions.map((item, order) => ({ ...item, unit: '', options: [], order }));
};

export const productAttributeValues = (product, definitions) => {
    const raw = product?.attributes instanceof Map
        ? Object.fromEntries(product.attributes)
        : (product?.attributes || {});
    return definitions.reduce((values, definition) => {
        values[definition.key] = raw[definition.key]
            ?? (['brand', 'color', 'size'].includes(definition.key) ? product?.[definition.key] : '')
            ?? '';
        return values;
    }, {});
};

export const legacyValuesFromAttributes = (definitions, values) => {
    const legacy = { brand: '', color: '', size: '' };
    definitions.forEach((definition) => {
        if (!Object.hasOwn(legacy, definition.key)) return;
        const value = values?.[definition.key];
        legacy[definition.key] = value === undefined || value === null || value === ''
            ? ''
            : `${value}${definition.type === 'number_unit' && definition.unit ? ` ${definition.unit}` : ''}`;
    });
    return legacy;
};

export const validateAttributeValues = (definitions, values) => {
    for (const definition of definitions) {
        const value = values?.[definition.key];
        if (definition.required && (value === undefined || value === null || String(value).trim() === '')) {
            return `${definition.name} is required.`;
        }
    }
    return '';
};
