import { getEffectiveProductAttributes, normalizeAttributeKey } from './productAttributes.js';
import { getProductDetailsSpecifications } from './productDetailsSpecifications.js';

const hasRecordedValue = (value) => value !== null
    && value !== undefined
    && String(value).trim() !== '';

const normalizeLookupKey = (value) => normalizeAttributeKey(
    String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2'),
);

const normalizeComparableValue = (value) => String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

const toEntries = (value) => {
    if (value instanceof Map) return [...value.entries()];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value);
};

const findValue = (entries, aliases) => {
    const matchingEntries = entries.filter(([key]) => aliases.has(normalizeLookupKey(key)));
    return matchingEntries.find(([, value]) => hasRecordedValue(value))?.[1];
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getAttributeNamePattern = (name) => escapeRegExp(String(name || '').trim())
    .replace(/\s+/g, '\\s+');

const getEmbeddedAttributePatterns = ({ name, value }) => {
    const escapedValue = escapeRegExp(value).replace(/\s+/g, '\\s+');
    const label = getAttributeNamePattern(name);
    const patterns = [];
    if (label) {
        patterns.push(new RegExp(`(^|[^\\p{L}\\p{N}])${label}\\s*[:=#-]?\\s+${escapedValue}(?=$|[^\\p{L}\\p{N}])`, 'iu'));
    }
    // An unlabeled configured value is treated as part of a composed name
    // only when it is a suffix/segment after a separator. This avoids turning
    // coincidental words such as Material=Pine in "Pine Board" into a spec.
    patterns.push(new RegExp(`([^\\p{L}\\p{N}])(?:[([{]\\s*)?${escapedValue}(?:[)\\]}])?(?=$|[^\\p{L}\\p{N}])`, 'iu'));
    return patterns;
};

const removeEmptyNameDelimiters = (value) => String(value || '')
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(/[\s\-,\u2010-\u2015:;|\x2f]+$/g, '')
    .replace(/^[\s\-,\u2010-\u2015:;|\x2f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const getInventoryProductNameParts = (product, categories = [], displayName = '') => {
    const category = (Array.isArray(categories) ? categories : []).find(
        (entry) => normalizeLookupKey(entry?.name) === normalizeLookupKey(product?.category),
    );
    const definitions = getEffectiveProductAttributes(category || {});
    const specifications = getConfiguredSpecifications(product, category, definitions);
    const fullName = String(displayName || product?._inventoryTableDisplayName
        || product?._inventoryTableProductName || product?.name || product?._displayName || '').trim();
    let baseName = fullName;
    const embeddedSpecifications = [];

    // Prefer longer values first so a shorter configured value cannot consume
    // part of a more descriptive value (for example, "red" in "dark red").
    specifications
        .filter(({ value }) => hasRecordedValue(value))
        .sort((left, right) => String(right.value).length - String(left.value).length)
        .forEach((specification) => {
            const pattern = getEmbeddedAttributePatterns(specification)
                .find((candidate) => candidate.test(baseName));
            if (!pattern) return;
            embeddedSpecifications.push(specification);
            baseName = baseName.replace(new RegExp(pattern.source, `${pattern.flags}g`), '$1');
        });

    return {
        name: removeEmptyNameDelimiters(baseName) || fullName,
        fullName,
        embeddedSpecifications,
    };
};

export const getInventoryProductSpecificationGroupKey = (product, displayName = '', categories = []) => {
    const category = normalizeLookupKey(product?.category);
    const nameParts = getInventoryProductNameParts(product, categories, displayName);
    const name = normalizeLookupKey(product?._inventoryTableProductBaseName || nameParts.name);
    return category && name ? `${category}::${name}` : String(product?.id || product?._id || '');
};

const getConfiguredSpecifications = (product, category, definitions) => {
    const attributeEntries = toEntries(product?.attributes);
    const productEntries = Object.entries(product || {});
    const normalizedAttributes = {};

    definitions.forEach((definition) => {
        const aliases = new Set([definition?.key, definition?.name].map(normalizeLookupKey).filter(Boolean));
        const savedValue = findValue(attributeEntries, aliases);
        const legacyFieldValue = findValue(productEntries, aliases);
        const value = hasRecordedValue(savedValue) ? savedValue : legacyFieldValue;
        if (hasRecordedValue(value)) normalizedAttributes[definition.key] = value;
    });

    const displayProduct = {
        ...product,
        ...(category ? { category: category.name } : {}),
        attributes: normalizedAttributes,
    };
    return getProductDetailsSpecifications(displayProduct, category ? [category] : []);
};

const isAlreadyInName = (value, productName) => {
    const normalizedValue = normalizeLookupKey(value).replace(/_/g, ' ').trim();
    const normalizedName = normalizeLookupKey(productName).replace(/_/g, ' ').trim();
    if (!normalizedValue || !normalizedName) return false;
    return ` ${normalizedName} `.includes(` ${normalizedValue} `);
};

const hasUniqueAttributeCombinations = (peerSpecifications, specifications) => {
    const signatures = peerSpecifications.map((peer) => JSON.stringify(specifications.map(({ name }) => (
        normalizeComparableValue(peer.get(normalizeLookupKey(name)))
    ))));
    return new Set(signatures).size === peerSpecifications.length;
};

const getMinimumIdentifyingSpecifications = (specifications, peerSpecifications) => {
    const candidates = specifications.filter(({ name }) => {
        const key = normalizeLookupKey(name);
        return new Set(peerSpecifications.map((peer) => normalizeComparableValue(peer.get(key)))).size > 1;
    });
    if (!candidates.length || !hasUniqueAttributeCombinations(peerSpecifications, candidates)) return candidates;

    // Category configurations are normally short. Search by subset size so a
    // single attribute that uniquely identifies every variant wins over a
    // longer list of merely differing attributes. For unusually large custom
    // schemas, use a deterministic greedy fallback to keep table rendering fast.
    if (candidates.length <= 12) {
        const isUnique = (selected) => hasUniqueAttributeCombinations(peerSpecifications, selected);
        for (let targetSize = 1; targetSize <= candidates.length; targetSize += 1) {
            let result = null;
            const visit = (start, remaining, selected) => {
                if (result) return;
                if (remaining === 0) {
                    if (isUnique(selected)) result = selected;
                    return;
                }
                for (let index = start; index <= candidates.length - remaining; index += 1) {
                    visit(index + 1, remaining - 1, [...selected, candidates[index]]);
                    if (result) return;
                }
            };
            visit(0, targetSize, []);
            if (result) return result;
        }
        return candidates;
    }

    const selected = [];
    while (selected.length < candidates.length && !hasUniqueAttributeCombinations(peerSpecifications, selected)) {
        const selectedKeys = new Set(selected.map(({ name }) => normalizeLookupKey(name)));
        const best = candidates
            .filter(({ name }) => !selectedKeys.has(normalizeLookupKey(name)))
            .map((candidate) => {
                const candidateKey = normalizeLookupKey(candidate.name);
                let separatedPairs = 0;
                for (let left = 0; left < peerSpecifications.length; left += 1) {
                    for (let right = left + 1; right < peerSpecifications.length; right += 1) {
                        const sameSelectedValues = selected.every(({ name }) => normalizeComparableValue(
                            peerSpecifications[left].get(normalizeLookupKey(name)),
                        ) === normalizeComparableValue(peerSpecifications[right].get(normalizeLookupKey(name))));
                        if (sameSelectedValues && normalizeComparableValue(peerSpecifications[left].get(candidateKey))
                            !== normalizeComparableValue(peerSpecifications[right].get(candidateKey))) separatedPairs += 1;
                    }
                }
                return { candidate, separatedPairs };
            })
            .sort((left, right) => right.separatedPairs - left.separatedPairs)[0];
        if (!best?.separatedPairs) break;
        selected.push(best.candidate);
    }
    return selected.length ? selected : candidates;
};

export const getInventoryProductSpecifications = (
    product,
    categories = [],
    productName = '',
    sameNameProducts = [product],
) => {
    if (!product) return [];

    const nameParts = getInventoryProductNameParts(product, categories, productName);
    const category = (Array.isArray(categories) ? categories : []).find(
        (entry) => normalizeLookupKey(entry?.name) === normalizeLookupKey(product.category),
    );
    const definitions = getEffectiveProductAttributes(category || {});
    const specifications = getConfiguredSpecifications(product, category, definitions);
    const targetGroupKey = getInventoryProductSpecificationGroupKey(product, productName, categories);
    const peers = (Array.isArray(sameNameProducts) ? sameNameProducts : [product])
        .filter((candidate) => candidate === product
            || getInventoryProductSpecificationGroupKey(candidate, candidate?._inventoryTableDisplayName, categories) === targetGroupKey);
    const peerSpecifications = peers.map((peer) => new Map(
        getConfiguredSpecifications(peer, category, definitions)
            .map(({ name, value }) => [normalizeLookupKey(name), value]),
    ));

    if (peers.length < 2) return nameParts.embeddedSpecifications;
    const identifyingSpecifications = getMinimumIdentifyingSpecifications(specifications, peerSpecifications);

    return identifyingSpecifications.filter(({ value }) => !isAlreadyInName(value, nameParts.name));
};
