import { getEffectiveProductAttributes } from './productAttributes.js';

export const POS_VARIANT_NOT_APPLICABLE = '__not_applicable__';

const LEGACY_VARIANT_DIMENSIONS = ['brand', 'size', 'color'];
const DEFAULT_SELECTOR_DIMENSIONS = ['size', 'color'];

export const getPosVariantDimensionsForCategory = (category) => {
    if (!category) return [...LEGACY_VARIANT_DIMENSIONS];

    const configuredKeys = new Set(
        getEffectiveProductAttributes(category).map((definition) => definition.key)
    );
    return LEGACY_VARIANT_DIMENSIONS.filter((dimension) => configuredKeys.has(dimension));
};

export const normalizePosVariantValue = (value) => String(value || '')
    .trim()
    .replace(/\s*[x×]\s*/gi, 'x')
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const formatPosVariantValue = (value) => String(value || '')
    .trim()
    .replace(/\s*[x×]\s*/gi, 'x')
    .replace(/\s+/g, ' ');

export const getPosVariantValueKey = (variant, dimension) => {
    const legacyValue = variant?.[dimension];
    const attributeValue = variant?.attributes?.[dimension];
    const normalized = normalizePosVariantValue(
        legacyValue === undefined || legacyValue === null || String(legacyValue).trim() === ''
            ? attributeValue
            : legacyValue
    );
    return normalized || POS_VARIANT_NOT_APPLICABLE;
};

const getOptionLabel = (variant, dimension, key) => (
    key === POS_VARIANT_NOT_APPLICABLE
        ? 'Not Applicable'
        : formatPosVariantValue(
            variant?.[dimension] === undefined
                || variant?.[dimension] === null
                || String(variant?.[dimension]).trim() === ''
                ? variant?.attributes?.[dimension]
                : variant?.[dimension]
        )
);

export const getPosVariantOptions = (variants, dimension) => {
    const optionMap = new Map();

    (Array.isArray(variants) ? variants : []).forEach((variant) => {
        const key = getPosVariantValueKey(variant, dimension);
        if (!optionMap.has(key)) {
            optionMap.set(key, getOptionLabel(variant, dimension, key));
        }
    });

    const hasConfiguredValue = [...optionMap.keys()].some((key) => key !== POS_VARIANT_NOT_APPLICABLE);
    if (!hasConfiguredValue) return [];

    return [...optionMap.entries()]
        .map(([key, label]) => ({ key, label }))
        .sort((left, right) => {
            if (left.key === POS_VARIANT_NOT_APPLICABLE) return 1;
            if (right.key === POS_VARIANT_NOT_APPLICABLE) return -1;
            return left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true });
        });
};

const selectionAppliesToVariant = (variant, dimension, selectedKey) => {
    if (selectedKey === null || selectedKey === undefined) return true;

    const variantKey = getPosVariantValueKey(variant, dimension);
    if (variantKey === selectedKey) return true;

    // A missing optional value means this SKU does not participate in that
    // dimension; it must not conflict with a concrete selection elsewhere.
    return variantKey === POS_VARIANT_NOT_APPLICABLE
        && selectedKey !== POS_VARIANT_NOT_APPLICABLE;
};

const exactSelectionsMatch = (variant, selections, dimensions) => dimensions.every((dimension) => {
    const selectedKey = selections[dimension];
    return selectedKey === null
        || selectedKey === undefined
        || getPosVariantValueKey(variant, dimension) === selectedKey;
});

export const getPosVariantSelectionModel = (
    variants,
    selections = {},
    selectedCode = null,
    selectorDimensions = DEFAULT_SELECTOR_DIMENSIONS
) => {
    const rows = Array.isArray(variants) ? variants : [];
    const dimensions = selectorDimensions.filter((dimension) => getPosVariantOptions(rows, dimension).length > 0);
    const resolvedSelections = { ...selections };

    dimensions.forEach((dimension) => {
        const options = getPosVariantOptions(rows, dimension);
        const selectedKey = resolvedSelections[dimension];
        const selectedStillExists = options.some((option) => option.key === selectedKey);

        if (!selectedStillExists) {
            resolvedSelections[dimension] = options.length === 1 ? options[0].key : null;
        }
    });

    const optionGroups = dimensions.reduce((groups, dimension) => {
        groups[dimension] = getPosVariantOptions(rows, dimension).map((option) => {
            const candidates = rows.filter((variant) => (
                getPosVariantValueKey(variant, dimension) === option.key
                && dimensions
                    .filter((otherDimension) => otherDimension !== dimension)
                    .every((otherDimension) => selectionAppliesToVariant(
                        variant,
                        otherDimension,
                        resolvedSelections[otherDimension]
                    ))
            ));

            return {
                ...option,
                exists: candidates.length > 0,
                hasStock: candidates.some((variant) => Number(variant?.stock) > 0),
                candidateCodes: candidates.map((variant) => variant?.code).filter(Boolean),
            };
        });
        return groups;
    }, {});

    const isComplete = dimensions.every((dimension) => resolvedSelections[dimension] !== null);
    const matchingVariants = isComplete
        ? rows.filter((variant) => exactSelectionsMatch(variant, resolvedSelections, dimensions))
        : [];
    const resolvedCode = matchingVariants.some((variant) => variant?.code === selectedCode)
        ? selectedCode
        : (matchingVariants.length === 1 ? matchingVariants[0]?.code : null);
    const matchedVariant = resolvedCode
        ? matchingVariants.find((variant) => variant?.code === resolvedCode) || null
        : null;

    return {
        dimensions,
        resolvedSelections,
        optionGroups,
        isComplete,
        matchingVariants,
        needsSkuSelection: isComplete && matchingVariants.length > 1,
        resolvedCode,
        matchedVariant,
    };
};

export const updatePosVariantSelection = (
    variants,
    selections,
    dimension,
    optionKey,
    selectorDimensions = DEFAULT_SELECTOR_DIMENSIONS
) => {
    const rows = Array.isArray(variants) ? variants : [];
    const nextSelections = { ...selections, [dimension]: optionKey };

    if (optionKey === null) return nextSelections;

    const dimensions = selectorDimensions.filter((item) => getPosVariantOptions(rows, item).length > 0);
    const candidates = rows.filter((variant) => (
        getPosVariantValueKey(variant, dimension) === optionKey
        && dimensions
            .filter((otherDimension) => otherDimension !== dimension)
            .every((otherDimension) => selectionAppliesToVariant(
                variant,
                otherDimension,
                nextSelections[otherDimension]
            ))
    ));

    dimensions
        .filter((otherDimension) => otherDimension !== dimension)
        .forEach((otherDimension) => {
            const candidateKeys = [...new Set(candidates.map((variant) => getPosVariantValueKey(variant, otherDimension)))];
            if (candidateKeys.includes(nextSelections[otherDimension])) return;
            nextSelections[otherDimension] = candidateKeys.length === 1 ? candidateKeys[0] : null;
        });

    return nextSelections;
};

const commonGroupValue = (variants, field, multipleLabel) => {
    const rows = Array.isArray(variants) ? variants : [];
    const values = rows.map((variant) => String(variant?.[field] || '').trim());
    const nonEmptyValues = [...new Set(values.filter(Boolean))];

    if (nonEmptyValues.length === 0) return null;
    if (values.every((value) => value && normalizePosVariantValue(value) === normalizePosVariantValue(nonEmptyValues[0]))) {
        return nonEmptyValues[0];
    }
    return multipleLabel;
};

export const getPosProductGroupKey = (product) => `${product?.category || ''}|${product?.name || ''}`;

export const groupProductsForPos = (products, categories = []) => {
    const grouped = new Map();
    const categoryMap = new Map(
        (Array.isArray(categories) ? categories : []).map((category) => [category?.name, category])
    );

    (Array.isArray(products) ? products : []).forEach((product) => {
        const groupKey = getPosProductGroupKey(product);
        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        grouped.get(groupKey).push(product);
    });

    return [...grouped.entries()].map(([groupKey, variants]) => {
        if (variants.length === 1) return variants[0];

        const sample = variants[0];
        const prices = variants.map((variant) => Number(variant?.price) || 0);
        const variantDimensions = getPosVariantDimensionsForCategory(categoryMap.get(sample.category));
        const brandOptions = variantDimensions.includes('brand')
            ? getPosVariantOptions(variants, 'brand')
            : [];

        return {
            isGroup: true,
            groupKey,
            code: `group-${sample.code}`,
            name: sample.name,
            brand: variantDimensions.includes('brand')
                ? commonGroupValue(variants, 'brand', 'Multiple Brands')
                : null,
            color: variantDimensions.includes('color')
                ? commonGroupValue(variants, 'color', 'Multiple Colors')
                : null,
            imageUrl: variants.find((variant) => String(variant?.imageUrl || '').trim())?.imageUrl || '',
            category: sample.category,
            stock: variants.reduce((sum, variant) => sum + (Number(variant?.stock) || 0), 0),
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices),
            availableBrands: brandOptions.map((option) => option.label),
            brandOptions,
            variantDimensions,
            variants: [...variants].sort((left, right) => (
                String(left?.brand || '').localeCompare(String(right?.brand || ''))
                || (Number(left?.price) || 0) - (Number(right?.price) || 0)
                || String(left?.size || '').localeCompare(String(right?.size || ''))
                || String(left?.color || '').localeCompare(String(right?.color || ''))
                || String(left?.code || '').localeCompare(String(right?.code || ''))
            )),
        };
    });
};
