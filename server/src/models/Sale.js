const mongoose = require('mongoose');

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
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
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
    clientRequestId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
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

module.exports = mongoose.model('Sale', saleSchema);
