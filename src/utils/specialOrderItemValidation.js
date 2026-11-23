import { isMoneyInput, isMoneyInputTooLarge, isWholeNumberInput } from './numericInput.js';
import { isProductImageReference } from './specialOrderProductImages.mjs';

const isValidCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const itemIdentity = (item) => String(item?.itemId || item?.__rowId || '');

/** Validate quotation item rows and key field errors by stable row identity. */
export const validateSpecialOrderItemRows = (items, { userRole = '', isDateValid = () => true, expiryBatchInfoByItemId = {} } = {}) => {
  const errors = {};
  let firstInvalidField = '';

  const addError = (item, field, message) => {
    const id = itemIdentity(item);
    if (!firstInvalidField) firstInvalidField = `items.${id}.${field}`;
    errors[id] = { ...(errors[id] || {}), [field]: message };
  };

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const itemNumber = index + 1;
    if (item.itemType === 'inventory' && (!item.inventoryProduct || !item.sku)) {
      addError(item, 'sku', 'Select an exact inventory SKU.');
    }
    if (!String(item.itemName || '').trim()) addError(item, 'itemName', 'Item name is required.');
    if (!String(item.sellingUnit || '').trim()) addError(item, 'sellingUnit', 'Selling Unit is required.');
    if (!isWholeNumberInput(item.quantity, { min: 1 })) {
      addError(item, 'quantity', 'Quantity must be a whole number of at least 1.');
    }
    if (item.itemType === 'custom' && String(item.expiryDate || '').trim() && !isValidCalendarDate(String(item.expiryDate).trim())) {
      addError(item, 'expiryDate', 'Enter a valid expiry date.');
    }
    const expirySelections = Array.isArray(item.quotationExpirySelections) ? item.quotationExpirySelections : [];
    if (expirySelections.length) {
      if (item.itemType !== 'inventory' || item.expiryTrackingEnabled !== true) {
        addError(item, 'quotationExpirySelections', 'Select batches only for an expiry-tracked inventory product.');
      } else {
        const availability = expiryBatchInfoByItemId?.[itemIdentity(item)]?.data;
        if (availability?.reconciled !== true) {
          addError(item, 'quotationExpirySelections', 'Refresh verified batch availability before confirming expiry selections.');
        } else {
          const options = new Map((availability.batchOptions || []).map((batch) => [String(batch.batch), batch]));
          let selectedQuantity = 0;
          const invalidSelection = expirySelections.some((selection) => {
            const selected = Number(selection?.quantity);
            const option = options.get(String(selection?.batch || ''));
            selectedQuantity += selected;
            return !option || !Number.isSafeInteger(selected) || selected < 1
              || !Number.isSafeInteger(Number(option.availableQuantity))
              || selected > Number(option.availableQuantity)
              || String(selection.expiryDate || '') !== String(option.expiryDate || '');
          });
          if (invalidSelection) addError(item, 'quotationExpirySelections', 'A selected batch is expired or no longer has enough available stock. Refresh and adjust the selection.');
          else if (!isWholeNumberInput(item.quantity, { min: 1 }) || selectedQuantity > Number(item.quantity)) {
            addError(item, 'quotationExpirySelections', 'Selected batch quantities cannot exceed the item quantity.');
          }
        }
      }
    }

    const hasValidPurchaseCost = item.purchaseCost === '' || (isMoneyInput(item.purchaseCost) && Number(item.purchaseCost) >= 0);
    if (!hasValidPurchaseCost) addError(item, 'purchaseCost', 'Enter a valid purchase cost if known.');

    const hasValidSellingPrice = isMoneyInput(item.sellingPrice) && Number(item.sellingPrice) >= 0;
    if (!hasValidSellingPrice) {
      addError(item, 'sellingPrice', isMoneyInputTooLarge(item.sellingPrice)
        ? 'Amount is too large. Please enter a smaller value.'
        : 'Enter a valid proposed unit price.');
    }
    if (item.itemType === 'inventory' && Number(item.sellingPrice) !== Number(item.originalUnitPrice)) {
      if (!['admin', 'superadmin'].includes(userRole)) {
        addError(item, 'sellingPrice', 'Only Admin or Super Admin may adjust an inventory price.');
      } else if (!String(item.priceOverrideReason || '').trim()) {
        addError(item, 'priceOverrideReason', 'Enter a reason for the price adjustment.');
      }
    }

    if (item.expectedArrivalDate && !isDateValid(item.expectedArrivalDate)) {
      addError(item, 'expectedArrivalDate', 'Expected date cannot be earlier than today.');
    }
    const photos = item.photos || [];
    if (photos.length > 3) {
      addError(item, 'photos', `Item ${itemNumber} can have at most 3 product photos.`);
    } else if (photos.some((photo) => !isProductImageReference(photo)
      && (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)
        || photo.size > 5 * 1024 * 1024 || photo.size === 0))) {
      addError(item, 'photos', `Item ${itemNumber} photos must be JPG, PNG, or WebP and no larger than 5 MB each.`);
    }
  });

  return { errors, firstInvalidField };
};
