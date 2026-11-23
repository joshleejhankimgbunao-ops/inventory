const crypto = require('crypto');

const createExpiryTrackingPeriodId = () => crypto.randomUUID();

const activeBatchFilter = (product) => ({
  product: product._id,
  trackingPeriodClosedAt: null,
  ...(product.expiryTrackingPeriodId
    ? { trackingPeriodId: product.expiryTrackingPeriodId }
    // A legacy SKU has no trustworthy way to distinguish its active batches
    // from a prior tracking period. Keep its old batches out of FEFO and
    // ordinary verification until an explicit physical verification starts
    // the first identified period.
    : { _id: { $in: [] } }),
});

const batchesToCloseFilter = (product) => ({
  product: product._id,
  trackingPeriodClosedAt: null,
  ...(product.expiryTrackingPeriodId ? { trackingPeriodId: product.expiryTrackingPeriodId } : {}),
});

const isBatchInActivePeriod = (product, batch) => {
  if (!product?.expiryTrackingEnabled || !product.expiryTrackingPeriodId || batch?.trackingPeriodClosedAt) return false;
  return String(batch?.trackingPeriodId || '') === String(product.expiryTrackingPeriodId);
};

module.exports = { createExpiryTrackingPeriodId, activeBatchFilter, batchesToCloseFilter, isBatchInActivePeriod };
