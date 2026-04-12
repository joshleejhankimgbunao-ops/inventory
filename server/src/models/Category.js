const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Field Rules
    showBrand: { type: Boolean, default: false },
    requireBrand: { type: Boolean, default: false },
    showColor: { type: Boolean, default: false },
    requireColor: { type: Boolean, default: false },
    showSize: { type: Boolean, default: true },
    requireSize: { type: Boolean, default: false },
    sizeUnits: {
      type: [String],
      default: [],
    },
    showSupplier: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Category', categorySchema);