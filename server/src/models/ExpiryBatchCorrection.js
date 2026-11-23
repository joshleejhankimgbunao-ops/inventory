/* global require, module */
const mongoose = require('mongoose');

const expiryBatchCorrectionSchema = new mongoose.Schema({
  requestId: { type: String, required: true, trim: true, maxlength: 160, unique: true, immutable: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true, immutable: true },
  sku: { type: String, required: true, trim: true, uppercase: true, immutable: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true, index: true, immutable: true },
  batchId: { type: String, required: true, trim: true, immutable: true },
  batchReference: { type: String, default: '', trim: true, immutable: true },
  previousExpiryDate: { type: String, required: true, immutable: true },
  newExpiryDate: { type: String, required: true, immutable: true },
  reason: { type: String, required: true, trim: true, maxlength: 500, immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  actorName: { type: String, required: true, trim: true, immutable: true },
  historicalMovementCount: { type: Number, required: true, min: 0, immutable: true },
  historicalAllocationCount: { type: Number, required: true, min: 0, immutable: true },
  createdAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, timestamps: false });

expiryBatchCorrectionSchema.index({ batch: 1, createdAt: -1 });
expiryBatchCorrectionSchema.index({ product: 1, createdAt: -1 });

module.exports = mongoose.model('ExpiryBatchCorrection', expiryBatchCorrectionSchema);
