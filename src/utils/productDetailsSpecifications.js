import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';
import { formatProductAttributeValue } from './productFamilies.js';

const hasRecordedValue = (value) => value !== null
    && value !== undefined
    && String(value).trim() !== '';

export const getProductDetailsSpecifications = (item, categories = []) => {
    if (!item) return [];

    const category = (Array.isArray(categories) ? categories : []).find((entry) => entry?.name === item.category) || {};
    const definitions = item.isGroup && Array.isArray(item.attributeDefinitions)
        ? item.attributeDefinitions
        : getEffectiveProductAttributes(category);
    const products = item.isGroup && Array.isArray(item.variants) ? item.variants : [item];

    return definitions.map((definition) => {
        const name = String(definition?.name || '').trim();
        const values = [];

        products.forEach((product) => {
            const rawValue = productAttributeValues(product, [definition])[definition.key];
            if (!hasRecordedValue(rawValue)) return;

            const formattedValue = formatProductAttributeValue(definition, rawValue).trim();
            if (!formattedValue) return;

            const normalizedValue = formattedValue.normalize('NFKC').toLocaleLowerCase();
            if (!values.some((value) => value.normalized === normalizedValue)) {
                values.push({ normalized: normalizedValue, label: formattedValue });
            }
        });

        return { name, value: values.map(({ label }) => label).join(', ') };
    }).filter(({ name, value }) => name && value);
};
