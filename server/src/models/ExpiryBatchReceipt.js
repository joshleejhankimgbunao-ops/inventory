const mongoose = require('mongoose');

const expiryBatchReceiptSchema = new mongoose.Schema({
  requestId: { type: String, required: true, trim: true, unique: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true, index: true },
  batchMovementRef: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatchMovement', default: null },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  expiryDate: { type: String, required: true },
  lotNumber: { type: String, default: '', trim: true, maxlength: 100 },
  enabledExpiryTracking: { type: Boolean, default: false },
  stockBefore: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  stockAfter: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  receivedAt: { type: Date, required: true, default: Date.now },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

expiryBatchReceiptSchema.index({ product: 1, receivedAt: -1 });

module.exports = mongoose.model('ExpiryBatchReceipt', expiryBatchReceiptSchema);
