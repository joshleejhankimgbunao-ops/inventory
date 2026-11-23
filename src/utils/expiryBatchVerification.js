const allocationId = (allocation) => String(allocation?.batch || allocation?._id || '');
const allocationSignature = (allocations = []) => allocations
  .map((allocation) => `${allocationId(allocation)}:${Number(allocation.quantity || 0)}`)
  .sort()
  .join('|');

export const isExpiryBatchVerificationConfirmed = (item, record) => {
  const proposal = item?.proposedAllocations;
  if (!Array.isArray(proposal) || !proposal.length || !record?.confirmed) return false;
  const selected = Array.isArray(record.allocations) ? record.allocations : proposal;
  const quantity = Number(item.quantity || 0);
  const selectedTotal = selected.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
  const options = new Map((item.batchOptions || []).map((option) => [String(option.batch || option._id), Number(option.availableQuantity || 0)]));
  const perBatch = new Map();
  for (const allocation of selected) {
    const id = allocationId(allocation);
    const rowQuantity = Number(allocation.quantity || 0);
    perBatch.set(id, (perBatch.get(id) || 0) + rowQuantity);
  }
  const overrideRequiresReason = allocationSignature(proposal) !== allocationSignature(selected);
  return Number.isSafeInteger(quantity) && quantity > 0 && selectedTotal === quantity
    && selected.every((allocation) => allocationId(allocation) && Number.isSafeInteger(Number(allocation.quantity)) && Number(allocation.quantity) > 0)
    && [...perBatch.entries()].every(([id, amount]) => options.has(id) && amount <= options.get(id))
    && (!overrideRequiresReason || Boolean(String(record.reason || '').trim()));
};
