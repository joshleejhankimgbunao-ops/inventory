const mongoose = require('mongoose');

const proofSchema = new mongoose.Schema({
  storageKey: { type: String, required: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  uploadedAt: { type: Date, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  requestId: { type: String, required: true },
  type: { type: String, enum: ['down_payment', 'partial_payment', 'final_payment'], required: true },
  amountCentavos: { type: Number, required: true, min: 1 },
  method: { type: String, required: true },
  otherMethod: { type: String, default: '' },
  reference: { type: String, default: '' },
  internalReference: { type: String, trim: true },
  notes: { type: String, trim: true, maxlength: 500 },
  chequeCleared: { type: Boolean },
  proofs: { type: [proofSchema], default: [] },
  recordedAt: { type: Date, required: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const reservationSnapshotItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  itemType: { type: String, enum: ['inventory', 'custom'], required: true },
  sku: { type: String, default: '' },
  orderedQuantity: { type: Number, required: true, min: 0 },
  reservedQuantity: { type: Number, required: true, min: 0 },
  shortageQuantity: { type: Number, required: true, min: 0 },
}, { _id: false });

const ledgerSchema = new mongoose.Schema({
  specialOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrder', required: true, unique: true },
  approvedQuotation: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrderQuotation', required: true },
  paymentPlan: { type: String, enum: ['cash', 'credit'], default: 'cash', required: true },
  // Older ledgers predate configurable down-payment agreements and therefore
  // intentionally keep this field absent rather than assuming a percentage.
  downPaymentPercentage: { type: Number, min: 0.01, max: 100 },
  creditTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction', default: null },
  creditTransactionId: { type: String, trim: true, uppercase: true, default: '' },
  approvedTotalCentavos: { type: Number, required: true, min: 1 },
  amountPaidCentavos: { type: Number, required: true, min: 1 },
  remainingBalanceCentavos: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['Partially Paid', 'Fully Paid', 'Paid'], required: true },
  payments: { type: [paymentSchema], default: [] },
  reservationAtPayment: { type: [reservationSnapshotItemSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('SpecialOrderPaymentLedger', ledgerSchema);
