const mongoose = require('mongoose');

const expiryBatchMovementSchema = new mongoose.Schema({
  operationKey: { type: String, required: true, trim: true, unique: true, maxlength: 220 },
  requestId: { type: String, default: '', trim: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  sku: { type: String, required: true, trim: true, uppercase: true, index: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true, index: true },
  batchId: { type: String, required: true, trim: true },
  expiryDate: { type: String, required: true },
  type: {
    type: String,
    enum: [
      'RECONCILIATION', 'STOCK_IN', 'SALE', 'SPECIAL_ORDER_RESERVE',
      'SPECIAL_ORDER_RELEASE', 'SPECIAL_ORDER_CONSUME', 'STOCK_OUT',
      'SALE_VOID', 'RESERVATION_RECONCILE',
    ],
    required: true,
    index: true,
  },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  remainingDelta: { type: Number, required: true, validate: Number.isSafeInteger },
  reservedDelta: { type: Number, required: true, validate: Number.isSafeInteger },
  sourceType: { type: String, enum: ['Reconciliation', 'StockIn', 'Sale', 'SpecialOrder', 'StockOut', 'SaleVoid'], required: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  unit: { type: String, default: '', trim: true },
  reason: { type: String, default: '', trim: true, maxlength: 500 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

expiryBatchMovementSchema.index({ product: 1, createdAt: -1 });
expiryBatchMovementSchema.index({ sourceType: 1, sourceId: 1, type: 1 });

module.exports = mongoose.model('ExpiryBatchMovement', expiryBatchMovementSchema);
