import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';
import { hasRecordedDetail } from './productDetailDisplay.js';

export const getRecommendationSpecificationComparison = (current, alternative, categories = []) => {
    if (!current || !alternative) return [];
    const definitionsFor = (product) => getEffectiveProductAttributes(
        categories.find((category) => category.name === product.category) || {}
    );
    const currentDefinitions = definitionsFor(current);
    const alternativeDefinitions = definitionsFor(alternative);
    const currentValues = productAttributeValues(current, currentDefinitions);
    const alternativeValues = productAttributeValues(alternative, alternativeDefinitions);
    const definitions = new Map([
        ...currentDefinitions.map((attribute) => [attribute.key, attribute]),
        ...alternativeDefinitions.map((attribute) => [attribute.key, attribute]),
    ]);
    const fields = [
        { key: 'category', label: 'Category', currentValue: current.category, alternativeValue: alternative.category },
        { key: 'sellingUnit', label: 'Selling unit', currentValue: current.sellingUnit, alternativeValue: alternative.sellingUnit },
        ...[...definitions].map(([key, attribute]) => ({
            key,
            label: attribute.name,
            currentValue: currentValues[key] ?? (['brand', 'color', 'size'].includes(key) ? current[key] : undefined),
            alternativeValue: alternativeValues[key] ?? (['brand', 'color', 'size'].includes(key) ? alternative[key] : undefined),
            currentUnit: currentDefinitions.find((row) => row.key === key)?.unit,
            alternativeUnit: alternativeDefinitions.find((row) => row.key === key)?.unit,
        })),
    ];
    return fields.filter(({ currentValue, alternativeValue }) => hasRecordedDetail(currentValue) || hasRecordedDetail(alternativeValue))
        .map((field) => {
            const display = (value, unit) => hasRecordedDetail(value) ? `${value}${hasRecordedDetail(unit) ? ` ${unit}` : ''}` : '';
            const currentText = display(field.currentValue, field.currentUnit);
            const alternativeText = display(field.alternativeValue, field.alternativeUnit);
            return { key: field.key, label: field.label, currentText, alternativeText,
                status: !currentText || !alternativeText ? 'unrecorded' : currentText.trim().toLocaleLowerCase() === alternativeText.trim().toLocaleLowerCase() ? 'match' : 'different' };
        });
};
