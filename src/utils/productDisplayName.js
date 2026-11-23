import { getEffectiveProductAttributes, normalizeAttributeKey, productAttributeValues } from './productAttributes.js';

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const normalizeText = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase();

const getStoredName = (product) => [product?.name, product?.itemName, product?.productName, product?.label]
    .find(hasValue);

export const hasStoredProductName = (product) => hasValue(getStoredName(product));

const toAttributeEntries = (attributes) => {
    if (attributes instanceof Map) return [...attributes.entries()];
    if (Array.isArray(attributes)) return attributes.map((entry) => [entry?.key || entry?.name, entry?.value]).filter(([key]) => hasValue(key));
    if (!attributes || typeof attributes !== 'object') return [];
    return Object.entries(attributes);
};

const resolveCategory = (product, categories) => {
    const categoryRef = String(product?.categoryRef?._id || product?.categoryRef || '');
    const categoryName = normalizeText(product?.category);
    return (Array.isArray(categories) ? categories : []).find((category) => (
        (categoryRef && String(category?._id || category?.id || '') === categoryRef)
        || (categoryName && normalizeText(category?.name) === categoryName)
    )) || {};
};

const formatAttributeValue = (definition, value) => {
    if (!hasValue(value) || typeof value === 'object') return '';
    const text = String(value).trim();
    const unit = String(definition?.type === 'number_unit' ? definition.unit || '' : '').trim();
    const normalizedText = text.toLocaleLowerCase().replace(/\s+/g, '');
    const normalizedUnit = unit.toLocaleLowerCase().replace(/\s+/g, '');
    return unit && text && !normalizedText.endsWith(normalizedUnit) ? `${text} ${unit}` : text;
};

/** Resolve a product label for presentation without changing its stored name. */
export const getProductDisplayName = (product, categories = []) => {
    if (!product) return '';
    const name = String(getStoredName(product) || '').trim();
    if (name) return name;

    const definitions = getEffectiveProductAttributes(resolveCategory(product, categories));
    const configuredValues = productAttributeValues(product, definitions);
    const rawEntries = toAttributeEntries(product.attributes);
    const rawByKey = new Map(rawEntries.map(([key, value]) => [normalizeAttributeKey(key), value]));
    const parts = [];
    const seen = new Set();
    const add = (value) => {
        if (!hasValue(value) || typeof value === 'object') return;
        const text = String(value).trim();
        const comparable = normalizeText(text);
        if (!comparable || seen.has(comparable)) return;
        seen.add(comparable);
        parts.push(text);
    };

    const configuredKeys = new Set();
    definitions.forEach((definition) => {
        const key = normalizeAttributeKey(definition.key);
        const nameKey = normalizeAttributeKey(definition.name);
        configuredKeys.add(key);
        configuredKeys.add(nameKey);
        const configuredValue = configuredValues[definition.key];
        const value = hasValue(configuredValue)
            ? configuredValue
            : hasValue(rawByKey.get(key)) ? rawByKey.get(key) : rawByKey.get(nameKey);
        add(formatAttributeValue(definition, value));
    });
    rawEntries.forEach(([key, value]) => {
        if (!configuredKeys.has(normalizeAttributeKey(key))) add(value);
    });

    // These fixed fields are retained for products created before category
    // attributes were stored in the attributes map.
    ['type', 'size', 'variant', 'brand', 'material', 'color'].forEach((key) => {
        if (!configuredKeys.has(normalizeAttributeKey(key))) add(product[key]);
    });

    if (parts.length) return parts.join(' – ');
    return [product.sku, product.code, product.id, product._id].find(hasValue)?.toString().trim() || 'Unnamed product';
};

/** Use a linked current SKU only when a legacy transaction lacks its own name snapshot. */
export const getTransactionProductDisplayName = (item, inventory = [], categories = []) => {
    if (hasStoredProductName(item)) return getProductDisplayName(item, categories);
    const rows = Array.isArray(inventory) ? inventory : [];
    const productId = String(item?.product || item?.productId || item?.id || '').trim();
    const sku = normalizeText(item?.code || item?.sku);
    const linkedProduct = rows.find((product) => productId && String(product?.id || product?._id || '').trim() === productId)
        || rows.find((product) => sku && normalizeText(product?.code || product?.sku) === sku);
    return getProductDisplayName(linkedProduct || item, categories);
};
