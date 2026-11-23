import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';
import { getProductDisplayName, hasStoredProductName } from './productDisplayName.js';

export const normalizeProductFamilyText = (value) => String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

export const getProductFamilyKey = (product, categories = []) => JSON.stringify([
    normalizeProductFamilyText(product?.category),
    normalizeProductFamilyText(hasStoredProductName(product) ? product.name : getProductDisplayName(product, categories)),
    hasStoredProductName(product)
        ? ''
        : `standalone:${normalizeProductFamilyText(product?.sku || product?.code || product?.id || product?._id)}`,
]);

const categoryForProduct = (categories, categoryName) => (
    (Array.isArray(categories) ? categories : []).find(
        (category) => normalizeProductFamilyText(category?.name) === normalizeProductFamilyText(categoryName)
    ) || {}
);

export const formatProductAttributeValue = (definition, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return 'Not specified';
    if (definition?.type === 'number_unit' && definition?.unit) {
        return `${value} ${definition.unit}`;
    }
    return String(value);
};

const familySearchText = (family) => family.variants.map((variant) => {
    const attributes = variant?.attributes instanceof Map
        ? Object.fromEntries(variant.attributes)
        : (variant?.attributes || {});
    return [
        family.name,
        variant?.name,
        variant?.code,
        variant?.category,
        variant?.brand,
        variant?.color,
        variant?.size,
        ...Object.values(attributes),
    ].map((value) => normalizeProductFamilyText(value)).join(' ');
});

export const matchesProductFamilySearch = (family, query) => {
    const normalizedQuery = normalizeProductFamilyText(query);
    if (!normalizedQuery) return true;
    return familySearchText(family).some((searchText) => searchText.includes(normalizedQuery));
};

export const getMatchingFamilyVariants = (family, query) => {
    const normalizedQuery = normalizeProductFamilyText(query);
    if (!normalizedQuery) return [];
    const searchTexts = familySearchText(family);
    return family.variants.filter((_, index) => searchTexts[index].includes(normalizedQuery));
};

export const getFamilyGeneralImageUrl = (variants) => (Array.isArray(variants) ? variants : [])
    .map((variant, index) => {
        const createdAt = Date.parse(variant?.createdAt || '');
        const id = String(variant?.id || '');
        const fallbackCreatedAt = /^[a-f\d]{24}$/i.test(id) ? parseInt(id.slice(0, 8), 16) * 1000 : Infinity;
        return {
            imageUrl: String(variant?.imageUrl || '').trim(),
            createdAt: Number.isFinite(createdAt) ? createdAt : fallbackCreatedAt,
            id: /^[a-f\d]{24}$/i.test(id) ? id.toLowerCase() : '',
            index,
        };
    })
    .sort((left, right) => left.createdAt - right.createdAt || (left.id && right.id ? left.id.localeCompare(right.id) : 0) || left.index - right.index)
    .find(({ imageUrl }) => imageUrl)?.imageUrl || '';

export const groupProductsIntoFamilies = (products, categories = []) => {
    const groups = new Map();

    (Array.isArray(products) ? products : []).forEach((product) => {
        const key = getProductFamilyKey(product, categories);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(product);
    });

    return [...groups.entries()].map(([key, rawVariants]) => {
        const variants = [...rawVariants].sort((left, right) => (
            String(left?.code || '').localeCompare(String(right?.code || ''))
        ));
        const representative = variants[0] || {};
        const category = categoryForProduct(categories, representative.category);
        const attributeDefinitions = getEffectiveProductAttributes(category);
        const prices = variants.map((variant) => Number(variant?.price)).filter(Number.isFinite);
        const imageUrls = [...new Set(variants.map((variant) => String(variant?.imageUrl || '').trim()).filter(Boolean))];
        const suppliers = [...new Set(variants.map((variant) => String(variant?.supplier || '').trim()).filter(Boolean))];

        const representativeImageUrl = imageUrls[0] || '';

        return {
            key,
            name: getProductDisplayName(representative, categories),
            storedName: String(representative?.name || '').trim(),
            categoryName: String(representative?.category || '').trim(),
            category,
            variants,
            representative,
            attributeDefinitions,
            attributeValues: variants.map((variant) => productAttributeValues(variant, attributeDefinitions)),
            minPrice: prices.length ? Math.min(...prices) : 0,
            maxPrice: prices.length ? Math.max(...prices) : 0,
            totalStock: variants.reduce((total, variant) => total + Math.max(0, Number(variant?.stock) || 0), 0),
            activeCount: variants.filter((variant) => !variant?.isArchived).length,
            archivedCount: variants.filter((variant) => variant?.isArchived).length,
            sharedImageUrl: imageUrls.length === 1 ? imageUrls[0] : '',
            representativeImageUrl,
            imageProduct: variants.find((variant) => String(variant?.imageUrl || '').trim() === representativeImageUrl) || representative,
            hasMixedImages: imageUrls.length > 1,
            sharedSupplier: suppliers.length === 1 ? suppliers[0] : '',
            hasMixedSuppliers: suppliers.length > 1,
        };
    });
};

export const getProductFamilyAttributeSummary = (family, maxValues = 4) => (
    (family?.attributeDefinitions || []).map((definition) => {
        const values = [...new Set((family?.attributeValues || [])
            .map((attributes) => attributes?.[definition.key])
            .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
            .map((value) => formatProductAttributeValue(definition, value)))];
        if (!values.length) return '';
        const displayed = values.slice(0, maxValues);
        const remaining = values.length - displayed.length;
        return `${definition.name}: ${displayed.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}`;
    }).filter(Boolean)
);
