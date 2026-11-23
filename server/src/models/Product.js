const mongoose = require('mongoose');
const { isValidExpiryDate } = require('../utils/productExpiry');
const basisLimits = require('../../../shared/recommendationBasisLimits.json');

const staffReasonSchema = new mongoose.Schema({
  indicator: { type: String, enum: ['check', 'neutral', 'warning'], required: true },
  text: { type: String, required: true, trim: true, maxlength: basisLimits.reasonText },
}, { _id: false });
const staffReasonsField = { type: [staffReasonSchema], default: undefined, validate: (rows) => !rows || rows.length <= basisLimits.reasonCount };

const recommendationBasisSchema = new mongoose.Schema({
  staffReasons: staffReasonsField,
  type: { type: String, enum: ['alternative', 'budget'], required: true },
  targetSku: { type: String, required: true },
  candidateProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  candidateSku: { type: String, required: true },
  systemGenerated: { type: Boolean, default: false },
  systemSuggestion: { type: String, default: undefined, trim: true, maxlength: basisLimits.systemSuggestion },
  justification: { type: String, default: '', trim: true, maxlength: basisLimits.justification },
  limitations: { type: String, default: '', trim: true, maxlength: basisLimits.limitations },
  createdAt: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedAt: { type: Date, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedByName: { type: String, default: '' },
}, { _id: false });

// Staff review is independent of legacy relationship membership and basis.
const recommendationReviewSchema = new mongoose.Schema({
  staffReasons: staffReasonsField,
  targetSku: { type: String, required: true },
  candidateProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  candidateSku: { type: String, required: true },
  decision: { type: String, enum: ['not_reviewed', 'approved', 'rejected'], required: true },
  reviewReason: { type: String, default: '', trim: true, maxlength: basisLimits.reviewReason },
  justification: { type: String, default: '', trim: true, maxlength: basisLimits.justification },
  limitations: { type: String, default: '', trim: true, maxlength: basisLimits.limitations },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedByName: { type: String, default: '' },
  updatedAt: { type: Date, required: true },
  revision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false });

// Initial receipt only: this is not a remaining/sellable batch balance.
// Embedded so product + initial quantity + batch are one atomic insert.
const initialStockBatchSchema = new mongoose.Schema({
  quantityReceived: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  sellingUnit: { type: String, required: true, trim: true },
  expiryDate: { type: String, required: true, validate: isValidExpiryDate },
  lotNumber: { type: String, default: '', trim: true, maxlength: 100 },
  receivedAt: { type: Date, default: Date.now, required: true },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
});

const productSchema = new mongoose.Schema(
  {
    brand: {
      type: String,
      default: '',
      trim: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    color: {
      type: String,
      default: '',
      trim: true,
    },
    size: {
      type: String,
      default: '',
      trim: true,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    supplierName: {
      type: String,
      default: '',
      trim: true,
    },
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
    },
    // Stable Category relationship introduced as an additive migration field.
    // `category` remains the compatibility/display snapshot until all legacy
    // products have been backfilled and the frontend no longer relies on it.
    categoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },
    // The primary unit used when this product is priced and stocked. It is
    // selected from the owning Category's configured selling units.
    sellingUnit: {
      type: String,
      default: '',
      trim: true,
    },
    expiryTrackingEnabled: { type: Boolean, default: false },
    // Current sellable batch lifecycle. Closed-period batches remain in the
    // ledger for audit and historical Sale Void references, but are never
    // considered by current-period stock operations.
    expiryTrackingPeriodId: { type: String, default: null, trim: true },
    expiryTrackingPeriodStartedAt: { type: Date, default: null },
    // Aggregate stock that predates the current tracking period and still
    // needs a physical batch assignment. Product.stock remains authoritative.
    expiryUnassignedStock: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    // Batch balances are authoritative only after an administrator reconciles
    // physical lots against aggregate stock and active reservation holds.
    expiryBatchReconciled: { type: Boolean, default: false },
    expiryBatchReconciledAt: { type: Date, default: null },
    expiryBatchReconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    initialStockBatch: { type: initialStockBatchSchema, default: null },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Physical stock remains in `stock`; this counter is only an active hold.
    reservedStock: { type: Number, default: 0, min: 0 },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    // Cost is recorded per sellable SKU. It is intentionally optional so
    // historical products with no captured purchase cost remain unknown.
    purchaseCost: {
      type: Number,
      min: 0,
      default: undefined,
    },
    budgetTier: {
      type: String,
      enum: ['low', 'moderate', 'high'],
      default: 'moderate',
      trim: true,
      lowercase: true,
    },
    alternativeGroupKey: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    clientRequestId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    lastStockAdjustmentRequestId: {
      type: String,
      default: '',
      trim: true,
    },
    manualAlternatives: {
      type: [String],
      default: [],
    },
    excludedAlternatives: {
      type: [String],
      default: [],
    },
    manualBudgetOptions: {
      type: [String],
      default: [],
    },
    excludedBudgetOptions: {
      type: [String],
      default: [],
    },
    recommendationBases: { type: [recommendationBasisSchema], default: [] },
    recommendationReviews: { type: [recommendationReviewSchema], default: [] },
    recommendationRevision: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Product', productSchema);
