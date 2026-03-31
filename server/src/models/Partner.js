const mongoose = require('mongoose');

const partnerSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['supplier', 'customer'],
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contact: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    note: {
      type: String,
      trim: true,
      default: '',
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

partnerSchema.index({ type: 1, name: 1 });
partnerSchema.index({ type: 1, email: 1 });

module.exports = mongoose.model('Partner', partnerSchema);
