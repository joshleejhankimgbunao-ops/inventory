export const getAvailableBatchRemovalQuantity = (batch) => Math.max(
  0,
  Number(batch?.remainingQuantity || 0) - Number(batch?.reservedQuantity || 0),
);

export const getEligibleBatchRemovalBatches = (batches = []) => batches.filter(
  (batch) => getAvailableBatchRemovalQuantity(batch) > 0,
);

export const getBatchRemovalAllocationReviewRows = (batches = [], allocations = {}, snapshots = {}) => (
  Object.entries(allocations).flatMap(([batchId, rawQuantity]) => {
    const quantityText = String(rawQuantity ?? '').trim();
    if (!/^\d+$/.test(quantityText)) return [];
    const quantity = Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity < 1) return [];

    const batch = batches.find((candidate) => String(candidate?._id) === String(batchId));
    const snapshot = snapshots[batchId];
    const availableQuantity = batch ? getAvailableBatchRemovalQuantity(batch) : 0;
    const availabilityChanged = !batch
      || !Number.isSafeInteger(Number(snapshot?.availableQuantity))
      || Number(snapshot.availableQuantity) !== availableQuantity;
    const exceedsAvailable = !batch || quantity > availableQuantity;
    if (!availabilityChanged && !exceedsAvailable) return [];

    return [{
      batchId,
      batchReference: batch?.batchReference || snapshot?.batchReference || 'Batch no longer available',
      quantity,
      availableQuantity,
      availabilityChanged,
      exceedsAvailable,
      canConfirm: Boolean(batch && availableQuantity > 0 && quantity <= availableQuantity),
    }];
  })
);
