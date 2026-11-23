const mongoose = require('mongoose');

const inventoryLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['ADD', 'DEDUCT', 'UPDATE', 'CREATE', 'ARCHIVE', 'RESTORE'],
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    productRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },
    saleRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null, index: true },
    specialOrderRef: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrder', default: null, index: true },
    batchMovementRefs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatchMovement' }],
    userRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    user: {
      type: String,
      required: true,
      trim: true,
      default: 'System',
      index: true,
    },
    details: {
      type: String,
      trim: true,
      default: '',
    },
    quantity: {
      type: Number,
      default: null,
      min: 0,
    },
    stockBefore: {
      type: Number,
      default: null,
      min: 0,
    },
    stockAfter: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

inventoryLogSchema.index({ createdAt: -1 });
inventoryLogSchema.index({ productRef: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('InventoryLog', inventoryLogSchema);
