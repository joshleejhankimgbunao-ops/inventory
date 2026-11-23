const mongoose = require('mongoose');

const batchAllocationSchema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true },
  batchId: { type: String, required: true },
  expiryDate: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false });

const reservationSchema = new mongoose.Schema({
  specialOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrder', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: { type: String, required: true },
  orderedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  reservedQuantity: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  batchAllocations: { type: [batchAllocationSchema], default: [] },
  status: { type: String, enum: ['Active', 'Released', 'Consumed'], default: 'Active' },
  consumedAt: { type: Date, default: null },
  consumedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  consumedSale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  history: [{
    action: { type: String, enum: ['Reserve', 'Release', 'Cancel', 'Consume', 'Reconcile', 'Physical Verify'], required: true },
    quantity: { type: Number, required: true, min: 1 },
    requestId: { type: String, required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batchAllocations: { type: [batchAllocationSchema], default: [] },
    proposedBatchAllocations: { type: [batchAllocationSchema], default: [] },
    reason: { type: String, default: '', trim: true, maxlength: 500 },
    at: { type: Date, required: true, default: Date.now },
  }],
}, { timestamps: true });

reservationSchema.index({ specialOrder: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('SpecialOrderStockReservation', reservationSchema);
