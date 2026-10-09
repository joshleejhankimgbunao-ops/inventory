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
    productAttributes: {
      type: [{
        _id: false,
        name: { type: String, required: true, trim: true },
        key: { type: String, required: true, trim: true, lowercase: true },
        type: { type: String, enum: ['text', 'number', 'select', 'number_unit'], default: 'text' },
        required: { type: Boolean, default: false },
        unit: { type: String, default: '', trim: true },
        options: { type: [String], default: [] },
        order: { type: Number, default: 0 },
      }],
      default: undefined,
    },
    // Marks an explicit save through the configurable Product Attributes UI.
    // `0` means the legacy showBrand/showColor/showSize rules remain authoritative.
    attributeSchemaVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Category', categorySchema);
