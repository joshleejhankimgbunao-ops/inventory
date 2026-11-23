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
    sellingUnit: { type: String, default: '', trim: true },
    expiryDate: { type: String, default: '', trim: true },
    quotationExpirySelections: { type: [{
      batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true },
      batchId: { type: String, required: true, trim: true },
      batchReference: { type: String, default: '', trim: true },
      lotNumber: { type: String, default: '', trim: true },
      expiryDate: { type: String, required: true, trim: true },
      quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    }], default: [] },
    itemType: { type: String, enum: ['custom', 'inventory'], default: 'custom' },
    inventoryProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    inventorySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    originalUnitPrice: { type: Number, default: null, min: 0 },
    priceOverrideReason: { type: String, default: '', trim: true },
    priceOverrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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

const customSourcingSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  sourcedQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  updatedAt: { type: Date, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const fulfillmentOperationSchema = new mongoose.Schema({
  requestId: { type: String, required: true },
  action: { type: String, enum: ['Source Custom', 'Confirm Ready', 'Confirm Handover', 'Complete Order'], required: true },
  itemId: { type: String, default: '' },
  quantity: { type: Number, default: 0, min: 0 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, required: true, default: Date.now },
}, { _id: false });

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
    clientRequestId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
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
    workflowVersion: { type: Number, default: 1 },
    taxTreatment: { type: String, enum: ['standard', 'vat_zero_rated', 'exempt'], default: null },
    fulfillment: { type: mongoose.Schema.Types.Mixed, default: null },
    customSourcing: { type: [customSourcingSchema], default: [] },
    fulfillmentOperations: { type: [fulfillmentOperationSchema], default: [] },
    readyConfirmation: {
      method: { type: String, enum: ['Store Pickup', 'Free Delivery'], default: null },
      confirmedAt: { type: Date, default: null },
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      requestId: { type: String, default: '' },
    },
    fulfillmentHandover: {
      method: { type: String, enum: ['Store Pickup', 'Free Delivery'], default: null },
      status: { type: String, enum: ['Picked Up', 'Delivered'], default: null },
      confirmedAt: { type: Date, default: null },
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      requestId: { type: String, default: '' },
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
    financialRecordedAt: { type: Date, default: null },
    financialRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    currentQuotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SpecialOrderQuotation',
      default: null,
      index: true,
    },
    transactionQuotation: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrderQuotation', default: null },
    transactionStartedAt: { type: Date, default: null },
    transactionStartedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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
