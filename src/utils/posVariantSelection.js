import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';
import { formatProductAttributeValue } from './productFamilies.js';

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

export const getPosVariantOptionLabel = (variant, definitions = []) => {
    const values = productAttributeValues(variant, definitions);
    const attributes = definitions
        .filter((definition) => values[definition.key] !== null && values[definition.key] !== undefined && String(values[definition.key]).trim() !== '')
        .map((definition) => `${definition.name}: ${formatProductAttributeValue(definition, values[definition.key])}`);
    const code = String(variant?.code || '').trim();
    const unit = String(variant?.sellingUnit || '').trim();
    return [attributes.join(', ') || code, unit, attributes.length ? code : ''].filter(Boolean).join(' · ');
};

export const getPosVariantChoicePresentation = (variants = [], definitions = []) => {
    const rows = Array.isArray(variants) ? variants : [];
    const configured = (Array.isArray(definitions) ? definitions : []).filter((definition) => String(definition?.name || '').trim());
    const valuesByCode = new Map(rows.map((variant) => [variant.code, productAttributeValues(variant, configured)]));
    const recorded = configured.filter((definition) => rows.some((variant) => {
        const value = valuesByCode.get(variant.code)?.[definition.key];
        return value !== null && value !== undefined && String(value).trim() !== '';
    }));
    const distinguishing = recorded.filter((definition) => new Set(rows.map((variant) => {
        const value = valuesByCode.get(variant.code)?.[definition.key];
        return value === null || value === undefined ? '' : String(value).trim().toLocaleLowerCase();
    })).size > 1);
    const shownDefinitions = distinguishing.length ? distinguishing : recorded.slice(0, 1);
    const headingDefinition = distinguishing.length === 1 ? distinguishing[0] : distinguishing.length === 0 && recorded.length === 1 ? recorded[0] : null;
    const attributeName = String(headingDefinition?.name || '').trim();
    const heading = attributeName && !attributeName.includes('_') ? `Select ${attributeName}` : 'Select Variant';
    const initial = rows.map((variant) => {
        const values = valuesByCode.get(variant.code) || {};
        const attributes = shownDefinitions.map((definition) => values[definition.key] === null
            || values[definition.key] === undefined
            || String(values[definition.key]).trim() === ''
            ? '' : formatProductAttributeValue(definition, values[definition.key]).trim()).filter(Boolean);
        const unit = String(variant.sellingUnit || '').trim();
        const code = String(variant.code || '').trim();
        const label = attributes.length ? [attributes.join(' · '), unit].filter(Boolean).join(' · ') : [code, unit].filter(Boolean).join(' · ');
        return { code, label };
    });
    const counts = new Map();
    const normalizedLabel = (label) => String(label).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    initial.forEach(({ label }) => {
        const key = normalizedLabel(label);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    const labels = Object.fromEntries(initial.map(({ code, label }) => [
        code,
        counts.get(normalizedLabel(label)) > 1 ? [label, code].filter(Boolean).join(' · ') : label,
    ]));
    return { heading, labels };
};

// Attribute choices are projections of real SKUs, never a Cartesian product.
// Missing values have no invented option: those SKUs remain reachable by code.
const choiceKey = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const choiceValue = (variant, group) => group.key === 'sellingUnit'
    ? variant?.sellingUnit
    : productAttributeValues(variant, [group.definition])[group.key];
const matchesChoice = (variant, group, key) => choiceKey(choiceValue(variant, group)) === key;

export const getPosAttributeSelectionModel = (variants = [], definitions = [], selections = {}, selectedSku = null) => {
    const rows = (Array.isArray(variants) ? variants : []).filter((variant) => variant?.isActive !== false && variant?.isArchived !== true);
    const configured = (Array.isArray(definitions) ? definitions : [])
        .filter((definition) => definition?.key && definition.key !== 'brand' && String(definition.name || '').trim())
        .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    const makeGroup = (definition) => ({ key: definition.key, label: definition.name, definition });
    const groups = configured.map(makeGroup).filter((group) => new Set(rows.map((row) => choiceKey(choiceValue(row, group))).filter(Boolean)).size > 1);
    const unitGroup = { key: 'sellingUnit', label: 'Selling Unit' };
    const unitNeeded = rows.some((row) => rows.some((other) => row !== other
        && groups.every((group) => choiceKey(choiceValue(row, group)) === choiceKey(choiceValue(other, group)))
        && choiceKey(row.sellingUnit) !== choiceKey(other.sellingUnit)));
    if (unitNeeded && new Set(rows.map((row) => choiceKey(row.sellingUnit)).filter(Boolean)).size > 1) groups.push(unitGroup);

    const resolvedSelections = {};
    const optionGroups = [];
    let candidates = rows;
    for (const group of groups) {
        const allValues = new Map();
        rows.forEach((row) => {
            const raw = choiceValue(row, group);
            const key = choiceKey(raw);
            if (key && !allValues.has(key)) allValues.set(key, group.definition ? formatProductAttributeValue(group.definition, raw) : String(raw).trim());
        });
        const options = [...allValues].map(([key, label]) => {
            const matches = candidates.filter((row) => matchesChoice(row, group, key));
            return { key, label, exists: matches.length > 0, hasStock: matches.some((row) => Number(row.stock) > 0), candidateCodes: matches.map((row) => row.code) };
        }).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true }));
        const available = options.filter((option) => option.exists);
        const requested = choiceKey(selections[group.key]);
        // A sole value is implicit only if every remaining SKU records it.
        const selected = available.some((option) => option.key === requested) ? requested
            : (available.length === 1 && candidates.every((row) => choiceKey(choiceValue(row, group)) === available[0].key) ? available[0].key : null);
        resolvedSelections[group.key] = selected;
        optionGroups.push({ ...group, options });
        if (selected) candidates = candidates.filter((row) => matchesChoice(row, group, selected));
    }

    const selected = selectedSku && candidates.find((row) => row.code === selectedSku.code
        && String(row.id ?? row._id) === String(selectedSku.id)) || null;
    const matchedVariant = selectedSku ? selected : (candidates.length === 1 ? candidates[0] : null);
    const allGroupsSelected = groups.every((group) => resolvedSelections[group.key]);
    const codeOptions = candidates.length <= 1 ? [] : candidates.filter((row) => allGroupsSelected
        || groups.some((group) => !resolvedSelections[group.key] && !choiceKey(choiceValue(row, group))));

    return { groups: optionGroups, selections: resolvedSelections, candidates, codeOptions, matchedVariant };
};

export const getPosRemainingAddableQuantity = (variant, cart = []) => {
    if (!variant) return 0;
    const reserved = (Array.isArray(cart) ? cart : [])
        .filter((item) => item.code === variant.code)
        .reduce((total, item) => total + Math.max(0, Number(item.qty) || 0), 0);
    return Math.max(0, (Number(variant.stock) || 0) - reserved);
};

export const getPosVariantOptionSellingUnit = (variants, candidateCodes = []) => {
    const units = variants.filter((variant) => candidateCodes.includes(variant.code))
        .map((variant) => String(variant.sellingUnit || '').trim());
    return units.length && units.every((unit) => unit && unit.toLowerCase() === units[0].toLowerCase()) ? units[0] : '';
};

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

// Open one explicitly requested SKU in the existing quantity/selection UI.
// Resolve it from current inventory rather than trusting a discovery snapshot.
export const getPosProductSelectionGroup = (selection, inventory, categories = []) => {
    const product = inventory.find((item) => item.code === selection?.code && item.id === selection?.id);
    if (!product || product.isActive === false || product.isArchived === true || Number(product.stock) <= 0) return null;
    const category = categories.find((item) => item.name === product.category);
    return {
        ...product,
        variants: [product],
        brandOptions: [],
        variantDimensions: getPosVariantDimensionsForCategory(category),
        attributeDefinitions: getEffectiveProductAttributes(category),
    };
};

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
        const category = categoryMap.get(sample.category);
        const attributeDefinitions = getEffectiveProductAttributes(category);
        const variantDimensions = getPosVariantDimensionsForCategory(category);
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
            attributeDefinitions,
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
