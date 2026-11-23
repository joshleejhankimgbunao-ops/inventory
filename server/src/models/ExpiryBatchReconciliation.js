const mongoose = require('mongoose');

const expiryBatchReconciliationSchema = new mongoose.Schema({
  requestId: { type: String, required: true, trim: true, unique: true, maxlength: 160 },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  trackingPeriodId: { type: String, default: null, trim: true },
  payloadHash: { type: String, required: true },
  stockAtReconciliation: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  batchCount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('ExpiryBatchReconciliation', expiryBatchReconciliationSchema);
