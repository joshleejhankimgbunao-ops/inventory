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

const budgetRangeBandSchema = new mongoose.Schema(
  {
    min: {
      type: Number,
      default: 0,
      min: 0,
    },
    max: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const budgetRangesSchema = new mongoose.Schema(
  {
    low: {
      type: budgetRangeBandSchema,
      default: () => ({ min: 0, max: 500 }),
    },
    moderate: {
      type: budgetRangeBandSchema,
      default: () => ({ min: 500, max: 2000 }),
    },
    high: {
      type: budgetRangeBandSchema,
      default: () => ({ min: 2000, max: Number.MAX_SAFE_INTEGER }),
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
    autoSync: {
      type: Boolean,
      default: true,
    },
    automaticBackupEnabled: {
      type: Boolean,
      default: false,
    },
    automaticBackupIntervalDays: {
      type: Number,
      default: 1,
      min: 1,
      max: 30,
    },
    automaticBackupTime: {
      type: String,
      default: '23:00',
      trim: true,
    },
    automaticBackupTimeZone: {
      type: String,
      default: '',
      trim: true,
    },
    lastAutomaticBackupAt: {
      type: Date,
      default: null,
    },
    lastAutomaticBackupStatus: {
      type: String,
      enum: ['not_run', 'successful', 'failed'],
      default: 'not_run',
    },
    lastAutomaticBackupError: {
      type: String,
      default: '',
      trim: true,
    },
    nextAutomaticBackupAt: {
      type: Date,
      default: null,
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
    budgetRanges: {
      type: budgetRangesSchema,
      default: () => ({
        low: { min: 0, max: 500 },
        moderate: { min: 500, max: 2000 },
        high: { min: 2000, max: Number.MAX_SAFE_INTEGER },
      }),
    },
    adminUser: {
      type: String,
      default: 'Owner',
      trim: true,
      lowercase: true,
    },
    adminDisplayName: {
      type: String,
      default: 'Admin User',
      trim: true,
    },
    adminFullName: {
      type: String,
      default: 'Admin User',
      trim: true,
    },
    adminContactNumber: {
      type: String,
      default: '',
      trim: true,
    },
    avatar: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Setting', settingSchema);
