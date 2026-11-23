import { getEffectiveProductAttributes, normalizeAttributeKey, productAttributeValues } from './productAttributes.js';
import { getManualRecommendationLink } from './recommendationBasis.js';

const normalize = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const validPrice = (value) => ['number', 'string'].includes(typeof value) && present(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
const typeKeys = new Set(['product_type', 'specific_product_type']);

const categoryFor = (product, categories) => categories.find((category) => (
    product?.categoryRef && String(category._id || category.id) === String(product.categoryRef)
)) || categories.find((category) => normalize(category.name) === normalize(product?.category));

const definitionsFor = (product, category) => {
    if (category) return getEffectiveProductAttributes(category);
    // Legacy fixed fields are observed facts, not an invented category schema.
    return ['brand', 'color', 'size'].filter((key) => present(product?.[key])).map((key) => ({
        key, name: key[0].toUpperCase() + key.slice(1), type: 'text',
    }));
};

const equalValue = (left, right, definition) => {
    if (definition.type === 'number' || definition.type === 'number_unit') {
        return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right);
    }
    return normalize(left) === normalize(right);
};

export const compareRecommendationPrices = (target, candidate) => {
    const sameUnit = present(target?.sellingUnit) && normalize(target.sellingUnit) === normalize(candidate?.sellingUnit);
    const comparable = Boolean(sameUnit && target?.recommendationPriceValid !== false && candidate?.recommendationPriceValid !== false && validPrice(target?.price) && validPrice(candidate?.price));
    return {
        comparable,
        reason: comparable ? null : sameUnit ? 'Selling price is missing or invalid.' : 'Selling units differ or are not recorded; no conversion is assumed.',
        sellingUnit: comparable ? target.sellingUnit : null,
        targetPrice: validPrice(target?.price) ? Number(target.price) : null,
        candidatePrice: validPrice(candidate?.price) ? Number(candidate.price) : null,
        difference: comparable ? (Math.round(Number(candidate.price) * 100) - Math.round(Number(target.price) * 100)) / 100 : null,
    };
};

// No category currently stores an approved interchangeability policy. This
// evaluator records evidence and conflicts; it never certifies compatibility.
export const evaluateRecommendation = (target, candidate, options = {}) => {
    const categories = Array.isArray(options.categories) ? options.categories : [];
    const targetCategory = categoryFor(target, categories);
    const candidateCategory = categoryFor(candidate, categories);
    const sameCategory = present(target?.category) && normalize(target.category) === normalize(candidate?.category);
    const targetDefinitions = definitionsFor(target, targetCategory);
    const candidateDefinitions = definitionsFor(candidate, candidateCategory);
    const hasUnconfiguredAttributes = [target, candidate].some((product, index) => {
        const definitions = index === 0 ? targetDefinitions : candidateDefinitions;
        const values = product?.attributes instanceof Map ? Object.fromEntries(product.attributes) : product?.attributes || {};
        return Object.keys(values).some((key) => present(values[key]) && !definitions.some((definition) => definition.key === key));
    });
    const definitions = [...new Map([...targetDefinitions, ...candidateDefinitions].map((definition) => [definition.key, definition])).values()];
    const targetValues = productAttributeValues(target, definitions);
    const candidateValues = productAttributeValues(candidate, definitions);
    const matchedAttributes = [];
    const differences = [];
    const missingAttributes = [];

    for (const definition of definitions) {
        const left = targetValues[definition.key];
        const right = candidateValues[definition.key];
        const targetDefinition = targetDefinitions.find((row) => row.key === definition.key);
        const candidateDefinition = candidateDefinitions.find((row) => row.key === definition.key);
        const row = { key: definition.key, label: definition.name, targetValue: left, candidateValue: right, unit: targetDefinition?.unit || '', candidateUnit: candidateDefinition?.unit || '' };
        const schemaConflict = targetDefinition && candidateDefinition && (targetDefinition.type !== candidateDefinition.type || normalize(targetDefinition.unit) !== normalize(candidateDefinition.unit));
        if (!present(left) || !present(right)) {
            missingAttributes.push({ ...row, missingOn: !present(left) && !present(right) ? 'both' : !present(left) ? 'target' : 'candidate' });
        } else if (!schemaConflict && equalValue(left, right, definition)) {
            matchedAttributes.push(row);
        } else {
            differences.push(row);
        }
    }
    // Surface conflicting legacy/custom facts even when their schema is absent.
    // They cannot count as verified matches or establish automatic eligibility.
    const rawValues = (product) => product?.attributes instanceof Map ? Object.fromEntries(product.attributes) : product?.attributes || {};
    const leftRaw = rawValues(target);
    const rightRaw = rawValues(candidate);
    for (const key of new Set([...Object.keys(leftRaw), ...Object.keys(rightRaw)])) {
        if (definitions.some((definition) => definition.key === key)) continue;
        if (present(leftRaw[key]) && present(rightRaw[key]) && normalize(leftRaw[key]) !== normalize(rightRaw[key])) {
            differences.push({ key, label: key, targetValue: leftRaw[key], candidateValue: rightRaw[key], unit: '', candidateUnit: '' });
        }
    }

    const sameName = present(target?.name) && normalize(target.name) === normalize(candidate?.name);
    const documentedTypeMatch = matchedAttributes.some((row) => typeKeys.has(normalizeAttributeKey(row.key)));
    const identified = Boolean(sameCategory && (sameName || documentedTypeMatch));
    const sameUnit = present(target?.sellingUnit) && normalize(target.sellingUnit) === normalize(candidate?.sellingUnit);
    const unitConflict = present(target?.sellingUnit) && present(candidate?.sellingUnit) && !sameUnit;
    if (unitConflict) {
        differences.push({ key: 'sellingUnit', label: 'Selling unit', targetValue: target.sellingUnit, candidateValue: candidate.sellingUnit, unit: '', candidateUnit: '' });
    }
    // With no approved exception policy, a recorded non-brand specification
    // difference requires review rather than an assumption of interchangeability.
    const specificationDifferences = differences.filter((row) => normalizeAttributeKey(row.key) !== 'brand');
    const specificationMatches = matchedAttributes.filter((row) => normalizeAttributeKey(row.key) !== 'brand');
    const missingSpecifications = missingAttributes.filter((row) => normalizeAttributeKey(row.key) !== 'brand');
    const hasConflict = specificationDifferences.length > 0 || unitConflict;
    const sufficientEvidence = identified && specificationMatches.length > 0 && missingSpecifications.length === 0 && sameUnit && !hasUnconfiguredAttributes;

    const requestedQuantity = options.requestedQuantity === undefined ? 1 : Number(options.requestedQuantity);
    const validQuantity = Number.isSafeInteger(requestedQuantity) && requestedQuantity > 0;
    const reservedQuantity = Math.max(0, Number(options.cart?.find((item) => item.code === candidate?.code)?.qty) || 0);
    const stock = Number(candidate?.stock);
    const active = candidate?.isActive !== false && candidate?.isArchived !== true;
    const availableQuantity = Number.isFinite(stock) ? Math.max(0, stock - reservedQuantity) : 0;
    const canFulfill = active && validQuantity && availableQuantity >= requestedQuantity;
    const source = options.source || 'automatic';
    const manual = source === 'admin-managed';
    const isSelf = !candidate?.code || candidate.code === target?.code || Boolean(candidate?.id && target?.id && candidate.id === target.id);
    const automaticEligible = !isSelf && !hasConflict && sufficientEvidence;
    // A saved business choice preserves its history, but does not replace
    // positive product evidence when it is offered as a POS substitute.
    const manualAllowed = !isSelf && !hasConflict && sufficientEvidence;
    const status = isSelf ? 'ineligible' : hasConflict ? 'specification_conflict' : sufficientEvidence ? 'matching_recorded_specs' : 'insufficient_evidence';
    const priceComparison = compareRecommendationPrices(target, candidate);
    const reasons = matchedAttributes.map((row) => `Matching ${row.label}: ${row.candidateValue}${row.unit ? ` ${row.unit}` : ''}.`);
    if (documentedTypeMatch) reasons.unshift('Same documented product type.');
    if (sameName) reasons.unshift('Same recorded product name.');
    if (Number.isFinite(stock)) reasons.push(`${stock} ${candidate?.sellingUnit || 'units'} currently recorded in stock.`);
    const link = manual ? getManualRecommendationLink(target, candidate, options.relationshipType || 'alternative') : null;
    const record = link?.record;
    const justification = record?.justification?.trim() || '';
    const identityNeedsReview = link && !['current', 'legacy'].includes(link.status);

    return {
        source,
        relationshipType: options.relationshipType || 'alternative',
        matchedAttributes,
        differences,
        missingAttributes,
        dataLimitations: hasUnconfiguredAttributes ? ['Some saved attributes have no current category definition and cannot establish compatibility.'] : [],
        availability: { stock: Number.isFinite(stock) ? stock : null, active, requestedQuantity, reservedQuantity, availableQuantity, canFulfill },
        priceComparison,
        compatibility: {
            status, verified: false, identified, categoryMatches: Boolean(sameCategory), automaticEligible, manualAllowed,
            policyStatus: 'not_configured',
            message: hasConflict
                ? 'Recorded specifications differ; interchangeability requires review.'
                : 'Compatibility is not system-verified; category substitution rules are not configured.',
        },
        relationshipCode: link?.code || candidate?.code,
        relationshipStatus: link?.status || null,
        basisRelationshipType: manual ? options.relationshipType || 'alternative' : null,
        systemSuggestion: record?.systemSuggestion || null,
        adminJustification: {
            text: justification || null,
            limitations: record?.limitations || null,
            status: justification ? 'provided' : manual ? 'not_recorded' : 'not_applicable',
            createdAt: record?.createdAt || null, updatedAt: record?.updatedAt || null,
            updatedBy: record?.updatedBy || null, updatedByName: record?.updatedByName || null,
        },
        actionable: !identityNeedsReview && canFulfill && (manual ? manualAllowed : automaticEligible),
        reasons,
    };
};

// Evidence first, then comparable price proximity, then deterministic SKU order.
// No weighted score or similarity percentage is used as compatibility evidence.
export const compareEvaluatedRecommendations = (left, right) => {
    const evidence = (item) => item.recommendation.matchedAttributes.filter((row) => normalizeAttributeKey(row.key) !== 'brand').length;
    const evidenceDifference = evidence(right) - evidence(left);
    if (evidenceDifference) return evidenceDifference;
    const leftPrice = left.recommendation.priceComparison;
    const rightPrice = right.recommendation.priceComparison;
    if (leftPrice.comparable && rightPrice.comparable) {
        const difference = Math.abs(leftPrice.difference) - Math.abs(rightPrice.difference);
        if (difference) return difference;
    }
    return String(left.code).localeCompare(String(right.code));
};
