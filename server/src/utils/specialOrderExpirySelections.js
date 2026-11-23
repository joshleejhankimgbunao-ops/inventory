const mongoose = require('mongoose');
const { getManilaBusinessDate, isValidExpiryDate } = require('./productExpiry');

const fail = (status, message) => Object.assign(new Error(message), { status });

const normalizeQuotationExpirySelections = ({ product, selections, quantity, availability, now = new Date() }) => {
  if (!Array.isArray(selections)) throw fail(400, 'Quotation expiry batch selections are invalid.');
  if (selections.length === 0) return [];
  if (!product?.expiryTrackingEnabled) throw fail(400, 'Expiry batch selections are only valid for expiry-tracked products.');
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw fail(400, 'Enter a valid item quantity before selecting expiry batches.');
  if (!availability?.tracked || !availability.reconciled || !availability.valid) {
    throw fail(409, 'Verified expiry batch availability changed. Refresh the item and retry, or leave expiry unassigned.');
  }

  const today = getManilaBusinessDate(now);
  const batchesById = new Map((availability.batches || []).map((batch) => [String(batch._id), batch]));
  const seen = new Set();
  const normalized = [];
  let totalSelected = 0;
  for (const selection of selections) {
    const batchId = String(selection?.batch || '').trim();
    const selectedQuantity = Number(selection?.quantity);
    if (!mongoose.isValidObjectId(batchId) || seen.has(batchId)
      || !Number.isSafeInteger(selectedQuantity) || selectedQuantity < 1) {
      throw fail(400, 'Choose valid expiry batch quantities.');
    }
    seen.add(batchId);
    const batch = batchesById.get(batchId);
    if (!batch || !isValidExpiryDate(batch.expiryDate) || batch.expiryDate <= today) {
      throw fail(409, 'A selected expiry batch is expired or no longer available. Refresh the item and review its selections.');
    }
    const availableQuantity = Number(batch.remainingQuantity) - Number(batch.reservedQuantity || 0);
    if (!Number.isSafeInteger(availableQuantity) || availableQuantity < selectedQuantity
      || (selection.batchId && String(selection.batchId) !== String(batch.batchId))
      || (selection.expiryDate && String(selection.expiryDate) !== String(batch.expiryDate))) {
      throw fail(409, 'Selected expiry batch availability changed. Refresh the item and review its selections.');
    }
    totalSelected += selectedQuantity;
    if (!Number.isSafeInteger(totalSelected) || totalSelected > quantity) {
      throw fail(400, 'Selected expiry batch quantities cannot exceed the quotation item quantity.');
    }
    normalized.push({
      batch: batch._id,
      batchId: String(batch.batchId),
      batchReference: String(batch.batchReference || ''),
      lotNumber: String(batch.lotNumber || ''),
      expiryDate: batch.expiryDate,
      quantity: selectedQuantity,
    });
  }
  return normalized;
};

module.exports = { normalizeQuotationExpirySelections };
