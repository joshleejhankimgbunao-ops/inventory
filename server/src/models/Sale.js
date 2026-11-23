const mongoose = require('mongoose');

const batchVerificationAllocationSchema = new mongoose.Schema({
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true },
  batchId: { type: String, required: true, trim: true },
  expiryDate: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false });

const batchVerificationSchema = new mongoose.Schema({
  proposedAllocations: { type: [batchVerificationAllocationSchema], default: [] },
  verifiedAllocations: { type: [batchVerificationAllocationSchema], default: [] },
  overridden: { type: Boolean, default: false },
  overrideReason: { type: String, default: '', trim: true, maxlength: 500 },
  verifiedAt: { type: Date, required: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const saleItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    description: { type: String, default: '', trim: true },
    sellingUnit: { type: String, default: '', trim: true },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    batchVerification: { type: batchVerificationSchema, default: null },
  },
  { _id: false }
);

const supportingDocumentSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  originalName: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true, enum: ['image/jpeg', 'image/png'] },
  size: { type: Number, required: true, min: 1 },
  uploadedAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const transactionReferenceSchema = new mongoose.Schema({
  referenceNumber: { type: String, default: '', trim: true, maxlength: 80 },
  supportingDocument: { type: supportingDocumentSchema, default: null },
  savedAt: { type: Date, default: null },
  savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  correctedAt: { type: Date, default: null },
  correctionHistory: {
    type: [new mongoose.Schema({
      previousReferenceNumber: { type: String, default: '', trim: true, maxlength: 80 },
      previousSupportingDocument: { type: supportingDocumentSchema, default: null },
      correctedReferenceNumber: { type: String, default: '', trim: true, maxlength: 80 },
      correctedSupportingDocument: { type: supportingDocumentSchema, default: null },
      reason: { type: String, required: true, trim: true, maxlength: 500 },
      correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      correctedByName: { type: String, required: true, trim: true },
      correctedAt: { type: Date, required: true },
    }, { _id: false })],
    default: [],
  },
}, { _id: false });

const voidSupportingProofSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  originalName: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'application/pdf'] },
  size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
  uploadedAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const saleSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['completed', 'voided'],
      default: 'completed',
      index: true,
    },
    voidInfo: {
      type: new mongoose.Schema({
        reason: { type: String, trim: true, required: true },
        voidedAt: { type: Date, required: true },
        voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        voidedByName: { type: String, trim: true, required: true },
        authorizationMethod: { type: String, trim: true, required: true },
        requestId: { type: String, trim: true, required: true },
        supportingProof: { type: voidSupportingProofSchema, default: null },
        supportingProofs: { type: [voidSupportingProofSchema], default: [] },
      }, { _id: false }),
      default: null,
    },
    voidRequest: {
      type: new mongoose.Schema({
        status: { type: String, enum: ['pending', 'approved', 'declined'], required: true },
        reason: { type: String, trim: true, required: true, maxlength: 500 },
        requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        requestedByName: { type: String, trim: true, required: true },
        requestedAt: { type: Date, required: true },
        supportingProof: { type: voidSupportingProofSchema, default: null },
        supportingProofs: { type: [voidSupportingProofSchema], default: [] },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reviewedByName: { type: String, trim: true, default: '' },
        reviewedAt: { type: Date, default: null },
        declineReason: { type: String, trim: true, maxlength: 500, default: '' },
      }, { _id: false }),
      default: null,
    },
    items: {
      type: [saleItemSchema],
      default: [],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    netAmount: {
      type: Number,
      required() { return this.vatCalculationStatus !== 'not_calculated'; },
      min: 0,
      default: 0,
    },
    vatAmount: {
      type: Number,
      required() { return this.vatCalculationStatus !== 'not_calculated'; },
      min: 0,
      default: 0,
    },
    vatCalculationStatus: {
      type: String,
      enum: ['calculated', 'not_calculated'],
      default: 'calculated',
    },
    taxTreatment: {
      type: String,
      enum: ['standard', 'vat_zero_rated', 'exempt'],
      default: null,
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    pricingMode: {
      type: String,
      enum: ['inclusive', 'agreed'],
      default: 'inclusive',
    },
    vatMode: {
      type: String,
      enum: ['vatable', 'zero-rated'],
      default: 'vatable',
      index: true,
    },
    customerIsVatExempt: {
      type: Boolean,
      default: false,
      index: true,
    },
    hasVatApplicableItems: {
      type: Boolean,
      default: false,
    },
    hasVatableItems: {
      type: Boolean,
      default: false,
    },
    hasZeroRatedItems: {
      type: Boolean,
      default: false,
    },
    vatRatesUsed: {
      type: [Number],
      default: [],
    },
    paymentMethod: {
      type: String,
      default: 'cash',
      enum: ['cash', 'gcash', 'card', 'cheque', 'other', 'credit'],
    },
    saleType: {
      type: String,
      default: 'regular',
      enum: ['regular', 'special-order'],
      index: true,
    },
    specialOrderFulfillmentStatus: {
      type: String,
      enum: ['Awaiting Items', 'Partially Ready', 'Prepared', 'Ready for Pickup', 'Ready for Delivery', 'Picked Up', 'Delivered', 'Stock Available', 'Partially Available', 'Insufficient Stock', 'No Inventory Required', 'Completed', 'Administrative Closure'],
      default: null,
    },
    collectionSource: {
      type: String,
      enum: ['sale', 'special_order_ledger'],
      default: 'sale',
    },
    paymentStatus: {
      type: String,
      default: 'Paid',
      enum: ['Pending', 'Partially Paid', 'Paid'],
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
      default: '',
      trim: true,
    },
    customerDetails: {
      type: new mongoose.Schema({ address: { type: String, default: '' }, contact: { type: String, default: '' }, email: { type: String, default: '' } }, { _id: false }),
      default: null,
    },
    creditTermDays: {
      type: Number,
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    creditTransactionId: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    specialOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SpecialOrder',
      default: null,
      index: true,
    },
    specialOrderNumber: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
      index: true,
    },
    specialOrderQuotationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SpecialOrderQuotation',
      default: null,
      index: true,
    },
    specialOrderQuotationVersion: {
      type: Number,
      default: null,
    },
    clientRequestId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    transactionReference: {
      type: transactionReferenceSchema,
      default: null,
    },
    cashier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    cashierName: {
      type: String,
      default: '',
      trim: true,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
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

// Reporting ranges are bounded before line-item aggregation.
saleSchema.index({ createdAt: 1 });

saleSchema.pre('validate', function validateUncalculatedVat() {
  if (this.vatCalculationStatus === 'not_calculated' && (
    this.saleType !== 'special-order'
    || !this.specialOrderId
    || !this.specialOrderQuotationId
    || !this.clientRequestId
    || !['standard', 'vat_zero_rated'].includes(this.taxTreatment)
    || this.vatMode !== (this.taxTreatment === 'vat_zero_rated' ? 'zero-rated' : 'vatable')
    || this.netAmount !== null
    || this.vatAmount !== null
    || this.pricingMode !== 'agreed'
    || this.collectionSource !== 'special_order_ledger'
  )) {
    throw new Error('Uncalculated VAT requires an agreed-price Special Order linked to its payment ledger.');
  }
});

module.exports = mongoose.model('Sale', saleSchema);
