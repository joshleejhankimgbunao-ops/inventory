const mongoose = require('mongoose');

const quotationItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true, trim: true },
  itemName: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
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
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineAmount: { type: Number, required: true, min: 0 },
  images: { type: [{
    key: { type: String, required: true }, originalName: { type: String, default: '' }, mimeType: { type: String, required: true }, size: { type: Number, required: true }, uploadedAt: { type: Date, default: Date.now },
    sourceProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null }, sourceImageIndex: { type: Number, default: null, min: 0 }, sourceUrl: { type: String, default: '' },
  }], default: [] },
}, { _id: false });

const specialOrderQuotationSchema = new mongoose.Schema({
  specialOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrder', required: true, index: true },
  quotationNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
  version: { type: Number, required: true, min: 1 },
  isCurrent: { type: Boolean, default: true, index: true },
  status: { type: String, enum: ['Draft', 'Awaiting Decision', 'Accepted', 'Declined', 'Superseded'], default: 'Draft', index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
  customerName: { type: String, required: true, trim: true },
  customerDetails: {
    address: { type: String, default: '', trim: true },
    contact: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    attentionName: { type: String, default: '', trim: true },
    attentionPosition: { type: String, default: '', trim: true },
    taxTreatment: { type: String, default: 'standard', trim: true },
  },
  quotationDetails: {
    attentionName: { type: String, default: '', trim: true, maxlength: 150 },
    attentionPosition: { type: String, default: '', trim: true, maxlength: 150 },
    authorizedSignatoryName: { type: String, default: '', trim: true, maxlength: 150 },
  },
  fulfillment: { type: mongoose.Schema.Types.Mixed, default: null },
  items: { type: [quotationItemSchema], default: [] },
  subtotal: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  // Set once by the atomic Draft -> Awaiting Decision operation. Draft PATCH
  // cannot write this field and revisions deliberately start without it.
  documentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  issuedAt: { type: Date, default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
  decision: { type: String, enum: ['', 'Accepted', 'Declined'], default: '' },
  revisionOf: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrderQuotation', default: null },
}, { timestamps: true });

specialOrderQuotationSchema.index({ specialOrder: 1, version: 1 }, { unique: true });
specialOrderQuotationSchema.index({ specialOrder: 1, isCurrent: 1 });

module.exports = mongoose.model('SpecialOrderQuotation', specialOrderQuotationSchema);
