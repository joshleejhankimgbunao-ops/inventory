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

module.exports = mongoose.model('InventoryLog', inventoryLogSchema);
