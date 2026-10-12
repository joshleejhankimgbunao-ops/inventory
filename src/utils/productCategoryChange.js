import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const normalized = (value) => String(value || '').trim().toLocaleLowerCase();

export const areAttributeDefinitionsCompatible = (current, target) => {
    if (!current || !target || current.key !== target.key || current.type !== target.type) return false;
    if (target.type === 'number_unit' && normalized(current.unit) !== normalized(target.unit)) return false;
    return true;
};

const targetAcceptsValue = (definition, value) => {
    if (!hasValue(value)) return true;
    if (definition.type === 'number' || definition.type === 'number_unit') return Number.isFinite(Number(value));
    if (definition.type === 'select') {
        return (definition.options || []).some((option) => normalized(option) === normalized(value));
    }
    return true;
};

export const buildCategoryAttributeMigration = ({ product, currentCategory, targetCategory }) => {
    const currentDefinitions = getEffectiveProductAttributes(currentCategory);
    const targetDefinitions = getEffectiveProductAttributes(targetCategory);
    const currentValues = productAttributeValues(product, currentDefinitions);
    const targetValues = {};
    const compatible = [];

    targetDefinitions.forEach((target) => {
        const current = currentDefinitions.find((definition) => areAttributeDefinitionsCompatible(definition, target));
        const value = current ? currentValues[current.key] : '';
        if (current && targetAcceptsValue(target, value)) {
            targetValues[target.key] = value;
            compatible.push({ definition: target, value });
        } else {
            targetValues[target.key] = '';
        }
    });

    const removed = currentDefinitions
        .filter((current) => {
            const target = targetDefinitions.find((definition) => areAttributeDefinitionsCompatible(current, definition));
            return hasValue(currentValues[current.key]) && (!target || !targetAcceptsValue(target, currentValues[current.key]));
        })
        .map((definition) => ({ definition, value: currentValues[definition.key] }));

    const added = targetDefinitions.filter((target) => (
        !currentDefinitions.some((current) => areAttributeDefinitionsCompatible(current, target))
        || !targetAcceptsValue(target, currentValues[target.key])
    ));

    return {
        currentDefinitions,
        targetDefinitions,
        currentValues,
        targetValues,
        compatible,
        removed,
        required: added.filter((definition) => definition.required),
        optional: added.filter((definition) => !definition.required),
    };
};
