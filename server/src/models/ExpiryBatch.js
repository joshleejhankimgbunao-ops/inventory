const mongoose = require('mongoose');
const { isValidExpiryDate } = require('../utils/productExpiry');

const expiryBatchSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  sku: { type: String, required: true, trim: true, uppercase: true },
  trackingPeriodId: { type: String, default: null, trim: true, index: true },
  trackingPeriodClosedAt: { type: Date, default: null },
  batchId: { type: String, required: true, trim: true, unique: true },
  batchReference: { type: String, trim: true, immutable: true, match: /^BT-\d{8}-\d{3,}$/ },
  lotNumber: { type: String, default: '', trim: true, maxlength: 100 },
  lotKey: { type: String, required: true, trim: true },
  expiryDate: { type: String, required: true, validate: isValidExpiryDate },
  quantityReceived: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  remainingQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  reservedQuantity: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  // A verified physical opening balance, explicitly distinct from a receipt.
  openingBalanceQuantity: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  receivedAt: { type: Date, required: true },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

expiryBatchSchema.index({ product: 1, expiryDate: 1, lotKey: 1 }, { unique: true });
expiryBatchSchema.index({ product: 1, expiryDate: 1, receivedAt: 1 });
expiryBatchSchema.index({ batchReference: 1 }, {
  unique: true,
  sparse: true,
});

module.exports = mongoose.model('ExpiryBatch', expiryBatchSchema);
