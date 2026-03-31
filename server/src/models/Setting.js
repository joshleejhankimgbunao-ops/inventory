const mongoose = require('mongoose');

const stockRulesSchema = new mongoose.Schema(
  {
    categories: {
      type: Map,
      of: Number,
      default: {},
    },
    products: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { _id: false }
);

const settingSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: 'default',
      unique: true,
      immutable: true,
    },
    storeName: {
      type: String,
      default: 'Tableria La Confianza Co., Inc.',
      trim: true,
    },
    storeAddress: {
      type: String,
      default: 'Manila S Rd, Calamba, 4027 Laguna',
      trim: true,
    },
    contactPhone: {
      type: String,
      default: '0917-545-2166',
      trim: true,
    },
    contactPhoneSecondary: {
      type: String,
      default: '(049) 545-2166',
      trim: true,
    },
    storePrimaryEmail: {
      type: String,
      default: 'tableria@yahoo.com',
      trim: true,
      lowercase: true,
    },
    storeSecondaryEmail: {
      type: String,
      default: 'tableria1@gmail.com',
      trim: true,
      lowercase: true,
    },
    storeMapLink: {
      type: String,
      default: 'https://maps.app.goo.gl/9QdZo3bu4W62qTjQ8',
      trim: true,
    },
    currency: {
      type: String,
      default: 'PHP',
      trim: true,
      uppercase: true,
    },
    darkMode: {
      type: Boolean,
      default: false,
    },
    autoPrintReceipts: {
      type: Boolean,
      default: false,
    },
    autoSync: {
      type: Boolean,
      default: true,
    },
    lowStockAlert: {
      type: Number,
      default: 10,
      min: 0,
    },
    desktopNotifications: {
      type: Boolean,
      default: true,
    },
    maxStockLimit: {
      type: Number,
      default: 100,
      min: 1,
    },
    stockRules: {
      type: stockRulesSchema,
      default: () => ({ categories: {}, products: {} }),
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Setting', settingSchema);
