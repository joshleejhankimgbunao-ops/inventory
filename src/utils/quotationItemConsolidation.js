import { isWholeNumberInput, parseMoneyToCentavos } from './numericInput.js';
import { isProductImageReference } from './specialOrderProductImages.mjs';

const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US');

const normalizeComparableValue = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? normalizeText(value) : '';
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeComparableValue);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => [normalizeText(key), normalizeComparableValue(entry)])
      .filter(([key, entry]) => key && entry !== '')
      .sort(([left], [right]) => left.localeCompare(right));
  }
  return normalizeText(value);
};

const productReference = (value) => {
  if (value && typeof value === 'object') return String(value.id || value._id || value.productId || '');
  return String(value || '');
};

const batchReference = (value) => (value && typeof value === 'object'
  ? String(value._id || value.toString?.() || '')
  : String(value || ''));

const normalizedMoney = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const centavos = parseMoneyToCentavos(text);
  return centavos === null ? normalizeText(text) : `centavos:${centavos}`;
};

/** Stable comparison key; quantity and photos are merged separately. */
export const quotationItemIdentityKey = (item) => {
  if (!item || typeof item !== 'object') return '';
  const itemType = normalizeText(item.itemType || 'custom');
  const itemName = normalizeText(item.itemName);
  if (!itemName) return '';

  const productId = productReference(item.inventoryProduct || item.productId || item.inventorySnapshot?.productId);
  const sku = normalizeText(item.sku || item.inventorySnapshot?.sku);
  if (itemType === 'inventory' && (!productId || !sku)) return '';

  const specifications = {
    variant: normalizeComparableValue(item.variant || item.selectedVariant || item.variantId || item.selectedVariantId),
    attributes: normalizeComparableValue(item.attributes),
    specifications: normalizeComparableValue(item.specifications),
    categoryAttributes: normalizeComparableValue(item.categoryAttributes),
    productAttributes: normalizeComparableValue(item.productAttributes),
    variantAttributes: normalizeComparableValue(item.variantAttributes),
  };
  return JSON.stringify({
    itemType,
    productId: itemType === 'inventory' ? normalizeText(productId) : normalizeText(productId),
    sku,
    itemName,
    specifications,
    description: normalizeText(item.description),
    sellingUnit: normalizeText(item.sellingUnit),
    sellingPrice: normalizedMoney(item.sellingPrice ?? item.unitPrice),
    originalUnitPrice: normalizedMoney(item.originalUnitPrice),
    supplierId: normalizeText(item.supplierId || item.supplier?.id || item.supplier?._id),
    supplierName: normalizeText(item.supplierName || item.supplier?.name),
    purchaseCost: normalizedMoney(item.purchaseCost),
    expectedArrivalDate: normalizeText(item.expectedArrivalDate),
    expiryDate: normalizeText(item.expiryDate),
    quotationExpirySelections: normalizeComparableValue([...(item.quotationExpirySelections || [])]
      .map((selection) => ({
        batch: batchReference(selection.batch), batchId: selection.batchId,
        expiryDate: selection.expiryDate, quantity: selection.quantity,
      }))
      .sort((left, right) => String(left.batch || left.batchId).localeCompare(String(right.batch || right.batchId)))),
    priceOverrideReason: normalizeText(item.priceOverrideReason),
    remarks: normalizeText(item.remarks || item.notes),
  });
};

const stableItemId = (item) => String(item?.itemId || item?.__rowId || '');
const isValidQuantity = (item) => isWholeNumberInput(item?.quantity, { min: 1 });

const photoIdentity = (photo) => {
  if (typeof photo === 'string') return `text:${normalizeText(photo)}`;
  if (!photo || typeof photo !== 'object') return '';
  if (isProductImageReference(photo)) return `product:${photo.productId}:${photo.imageIndex}`;
  const persistentId = photo.id || photo._id || photo.key;
  const source = photo.src || photo.url || photo.imageUrl;
  return persistentId || source ? `reference:${String(photo.source || '')}:${String(persistentId || source)}` : '';
};

const combinePhotos = (items) => {
  const photos = [];
  const seenObjects = new Set();
  const seenKeys = new Set();
  for (const item of items) {
    for (const photo of item.photos || []) {
      const identity = photoIdentity(photo);
      if (identity && seenKeys.has(identity)) continue;
      if (!identity && photo && typeof photo === 'object' && seenObjects.has(photo)) continue;
      if (identity) seenKeys.add(identity);
      else if (photo && typeof photo === 'object') seenObjects.add(photo);
      photos.push(photo);
    }
  }
  return photos;
};

const combineQuotationExpirySelections = (items) => {
  const combined = new Map();
  for (const item of items) {
    for (const selection of item.quotationExpirySelections || []) {
      const key = batchReference(selection.batch) || String(selection.batchId || '');
      const current = combined.get(key);
      combined.set(key, {
        ...selection,
        quantity: Number(selection.quantity || 0) + Number(current?.quantity || 0),
      });
    }
  }
  return [...combined.values()];
};

const mergeGroup = (group) => {
  const survivor = group[0];
  const totalQuantity = group.reduce((total, item) => total + Number(item.quantity), 0);
  if (!Number.isSafeInteger(totalQuantity) || totalQuantity < 1) {
    return { error: { itemId: stableItemId(survivor), field: 'quantity', message: 'Combined quantity exceeds the supported limit.' } };
  }

  const photos = combinePhotos(group);
  if (photos.length > 3) {
    return { error: { itemId: stableItemId(survivor), field: 'photos', message: 'These items have more than 3 different photos combined. Remove a photo before combining them.' } };
  }

  const unitPriceCentavos = parseMoneyToCentavos(String(survivor.sellingPrice ?? survivor.unitPrice ?? ''));
  if (unitPriceCentavos === null || !Number.isSafeInteger(unitPriceCentavos * totalQuantity)) {
    return { error: { itemId: stableItemId(survivor), field: 'quantity', message: 'Combined line amount exceeds the supported limit.' } };
  }

  return {
    survivor: { ...survivor, quantity: String(totalQuantity), photos, quotationExpirySelections: combineQuotationExpirySelections(group) },
    removedItemIds: group.slice(1).map(stableItemId),
    group: {
      survivorItemId: stableItemId(survivor),
      removedItemIds: group.slice(1).map(stableItemId),
      quantity: totalQuantity,
    },
  };
};

/** Consolidate only complete, quantity-valid rows. Returns no partial edits on failure. */
export const consolidateQuotationItems = (items, { candidateItemId = '' } = {}) => {
  const originalItems = Array.isArray(items) ? items : [];
  const candidate = candidateItemId
    ? originalItems.find((item) => stableItemId(item) === String(candidateItemId))
    : null;
  const candidateKey = candidate ? quotationItemIdentityKey(candidate) : '';
  const groupsByKey = new Map();

  originalItems.forEach((item) => {
    if (!isValidQuantity(item)) return;
    const key = quotationItemIdentityKey(item);
    if (!key || (candidateItemId && key !== candidateKey)) return;
    groupsByKey.set(key, [...(groupsByKey.get(key) || []), item]);
  });

  let consolidatedItems = [...originalItems];
  const mergedGroups = [];
  for (const group of groupsByKey.values()) {
    if (group.length < 2) continue;
    const merged = mergeGroup(group);
    if (merged.error) return { items: originalItems, mergedGroups: [], error: merged.error };
    const redundantItems = new Set(group.slice(1));
    consolidatedItems = consolidatedItems
      .filter((item) => !redundantItems.has(item))
      .map((item) => (item === group[0] ? merged.survivor : item));
    mergedGroups.push(merged.group);
  }

  return { items: consolidatedItems, mergedGroups, error: null };
};
