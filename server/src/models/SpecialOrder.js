const mongoose = require('mongoose');

const specialOrderItemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
      index: true,
    },
    supplierName: {
      type: String,
      default: '',
      trim: true,
    },
    purchaseCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    expectedArrivalDate: {
      type: Date,
      default: null,
    },
    remarks: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const specialOrderStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      trim: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const specialOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    items: {
      type: [specialOrderItemSchema],
      default: [],
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
      index: true,
    },
    supplierName: {
      type: String,
      default: '',
      trim: true,
    },
    purchaseCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    expectedArrivalDate: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'In Progress', 'Ready for Pickup', 'Completed', 'Cancelled'],
      default: 'Pending',
      index: true,
    },
    remarks: {
      type: String,
      default: '',
      trim: true,
    },
    linkedSaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledReason: {
      type: String,
      default: '',
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    statusHistory: {
      type: [specialOrderStatusHistorySchema],
      default: [],
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

specialOrderSchema.index({ customerName: 1 });
specialOrderSchema.index({ supplierName: 1 });
specialOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SpecialOrder', specialOrderSchema);