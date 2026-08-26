const mongoose = require('mongoose');

const paymentHistorySchema = new mongoose.Schema(
  {
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      default: 'cash',
      trim: true,
      lowercase: true,
    },
    reference: {
      type: String,
      default: '',
      trim: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    recordedBy: {
      type: String,
      default: '',
      trim: true,
    },
    recordedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: false }
);

const proofOfPaymentSchema = new mongoose.Schema(
  {
    storageKey: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      enum: ['image/jpeg', 'image/png'],
    },
    uploadedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: false }
);

const creditTransactionSchema = new mongoose.Schema(
  {
    creditTransactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: true,
      index: true,
    },
    customerId: {
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
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    netAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    vatAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    pricingMode: {
      type: String,
      enum: ['inclusive'],
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
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingBalance: {
      type: Number,
      required: true,
      min: 0,
    },
    termDays: {
      type: Number,
      required: true,
      min: 1,
      max: 60,
    },
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    originalDueDate: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      required: true,
      default: 'Unpaid',
      enum: ['Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
      index: true,
    },
    paymentHistory: {
      type: [paymentHistorySchema],
      default: [],
    },
    proofOfPayment: {
      type: proofOfPaymentSchema,
      default: null,
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
    cancelReason: {
      type: String,
      default: '',
      trim: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

creditTransactionSchema.index({ customerName: 1 });
creditTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
