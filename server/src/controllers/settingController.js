const Setting = require('../models/Setting');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const User = require('../models/User');
const Category = require('../models/Category');
const Partner = require('../models/Partner');
const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');

const BACKUP_SCHEMA_VERSION = '1.0.0';

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_UPDATE_FIELDS = new Set([
  'storeName',
  'storeAddress',
  'contactPhone',
  'contactPhoneSecondary',
  'storePrimaryEmail',
  'storeSecondaryEmail',
  'storeMapLink',
  'currency',
  'darkMode',
  'autoPrintReceipts',
  'autoSync',
  'lowStockAlert',
  'desktopNotifications',
  'maxStockLimit',
  'stockRules',
  'budgetRanges',
  'adminUser',
  'adminDisplayName',
  'adminFullName',
  'adminContactNumber',
  'avatar',
]);

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
};

const normalizeEmail = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sanitizeRulesMap = (source = {}) => {
  const sanitized = {};

  for (const [key, rawValue] of Object.entries(source || {})) {
    const normalizedKey = normalizeString(key);
    const numericValue = toNumberOrNull(rawValue);

    if (!normalizedKey || numericValue === null || numericValue < 0) {
      continue;
    }

    sanitized[normalizedKey] = numericValue;
  }

  return sanitized;
};

const sanitizeBudgetBand = (band = {}, fallback = {}) => {
  const min = toNumberOrNull(band.min);
  const max = toNumberOrNull(band.max);

  return {
    min: min === null || min < 0 ? Number(fallback.min || 0) : min,
    max: max === null || max < 0 ? Number(fallback.max || 0) : max,
  };
};

const sanitizeBudgetRanges = (source = {}) => {
  const low = sanitizeBudgetBand(source.low || {}, { min: 0, max: 500 });
  const moderate = sanitizeBudgetBand(source.moderate || {}, { min: low.max, max: 2000 });
  const high = sanitizeBudgetBand(source.high || {}, { min: moderate.max, max: 1000000 });

  low.max = Math.max(low.min, low.max);
  moderate.min = Math.max(low.max, moderate.min);
  moderate.max = Math.max(moderate.min, moderate.max);
  high.min = Math.max(moderate.max, high.min);
  high.max = Math.max(high.min, high.max);

  return { low, moderate, high };
};

const validatePayload = (payload) => {
  if ('storePrimaryEmail' in payload && payload.storePrimaryEmail && !EMAIL_RULE.test(payload.storePrimaryEmail)) {
    return 'storePrimaryEmail must be a valid email.';
  }

  if ('storeSecondaryEmail' in payload && payload.storeSecondaryEmail && !EMAIL_RULE.test(payload.storeSecondaryEmail)) {
    return 'storeSecondaryEmail must be a valid email.';
  }

  if ('lowStockAlert' in payload) {
    const value = toNumberOrNull(payload.lowStockAlert);
    if (value === null || value < 0) {
      return 'lowStockAlert must be a non-negative number.';
    }
  }

  if ('maxStockLimit' in payload) {
    const value = toNumberOrNull(payload.maxStockLimit);
    if (value === null || value < 1) {
      return 'maxStockLimit must be at least 1.';
    }
  }

  if ('adminContactNumber' in payload && payload.adminContactNumber) {
    const digits = String(payload.adminContactNumber).replace(/\D/g, '');
    if (digits.length !== 11) {
      return 'adminContactNumber must be exactly 11 digits.';
    }
  }

  if ('budgetRanges' in payload) {
    const low = payload.budgetRanges?.low;
    const moderate = payload.budgetRanges?.moderate;
    const high = payload.budgetRanges?.high;

    if (!low || !moderate || !high) {
      return 'budgetRanges must include low, moderate, and high bands.';
    }

    const values = [
      low.min, low.max,
      moderate.min, moderate.max,
      high.min, high.max,
    ];

    const invalidValue = values.some((value) => toNumberOrNull(value) === null || Number(value) < 0);
    if (invalidValue) {
      return 'budgetRanges values must be non-negative numbers.';
    }
  }

  return null;
};

const ensureSettingsDocument = async () => {
  const existing = await Setting.findOne({ singletonKey: 'default' });
  if (existing) {
    return existing;
  }

  return Setting.create({ singletonKey: 'default' });
};

const BACKUP_COLLECTIONS = [
  ['settings', Setting],
  ['users', User],
  ['products', Product],
  ['sales', Sale],
  ['categories', Category],
  ['partners', Partner],
  ['activityLogs', ActivityLog],
  ['inventoryLogs', InventoryLog],
];

const ensureArrayPayload = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => entry && typeof entry === 'object');
};

const toInsertableDocs = (docs = []) => {
  return docs.map((doc) => {
    const cloned = { ...doc };
    delete cloned.__v;
    return cloned;
  });
};

const getSettings = async (req, res, next) => {
  try {
    const settings = await ensureSettingsDocument();
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const rawPayload = req.body || {};
    const payload = {};

    for (const [key, value] of Object.entries(rawPayload)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        payload[key] = value;
      }
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: 'No valid settings fields provided.' });
    }

    if ('storeName' in payload) payload.storeName = normalizeString(payload.storeName);
    if ('storeAddress' in payload) payload.storeAddress = normalizeString(payload.storeAddress);
    if ('contactPhone' in payload) payload.contactPhone = normalizeString(payload.contactPhone);
    if ('contactPhoneSecondary' in payload) payload.contactPhoneSecondary = normalizeString(payload.contactPhoneSecondary);
    if ('storePrimaryEmail' in payload) payload.storePrimaryEmail = normalizeEmail(payload.storePrimaryEmail);
    if ('storeSecondaryEmail' in payload) payload.storeSecondaryEmail = normalizeEmail(payload.storeSecondaryEmail);
    if ('storeMapLink' in payload) payload.storeMapLink = normalizeString(payload.storeMapLink);
    if ('currency' in payload && typeof payload.currency === 'string') payload.currency = payload.currency.trim().toUpperCase();
    if ('adminUser' in payload && typeof payload.adminUser === 'string') payload.adminUser = payload.adminUser.trim().toLowerCase();
    if ('adminDisplayName' in payload) payload.adminDisplayName = normalizeString(payload.adminDisplayName);
    if ('adminFullName' in payload) payload.adminFullName = normalizeString(payload.adminFullName);
    if ('adminContactNumber' in payload && typeof payload.adminContactNumber === 'string') payload.adminContactNumber = payload.adminContactNumber.replace(/\D/g, '').slice(0, 11);
    if ('avatar' in payload) payload.avatar = normalizeString(payload.avatar);

    if ('lowStockAlert' in payload) payload.lowStockAlert = toNumberOrNull(payload.lowStockAlert);
    if ('maxStockLimit' in payload) payload.maxStockLimit = toNumberOrNull(payload.maxStockLimit);

    if ('stockRules' in payload) {
      payload.stockRules = {
        categories: sanitizeRulesMap(payload.stockRules?.categories || {}),
        products: sanitizeRulesMap(payload.stockRules?.products || {}),
      };
    }

    if ('budgetRanges' in payload) {
      payload.budgetRanges = sanitizeBudgetRanges(payload.budgetRanges || {});
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const settings = await ensureSettingsDocument();

    for (const [key, value] of Object.entries(payload)) {
      settings[key] = value;
    }

    await settings.save();

    return res.json({
      message: 'Settings updated.',
      settings,
    });
  } catch (error) {
    return next(error);
  }
};

const getSystemBackup = async (req, res, next) => {
  try {
    const [
      settings,
      users,
      products,
      sales,
      categories,
      partners,
      activityLogs,
      inventoryLogs,
    ] = await Promise.all([
      Setting.find({}).lean(),
      User.find({})
        .select('+password +pinHash +passwordResetTokenHash +pinResetTokenHash')
        .lean(),
      Product.find({}).lean(),
      Sale.find({}).lean(),
      Category.find({}).lean(),
      Partner.find({}).lean(),
      ActivityLog.find({}).lean(),
      InventoryLog.find({}).lean(),
    ]);

    return res.json({
      message: 'Backup generated.',
      backup: {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        generatedBy: req.user?.username || req.user?.name || 'superadmin',
        collections: {
          settings,
          users,
          products,
          sales,
          categories,
          partners,
          activityLogs,
          inventoryLogs,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
};

const restoreSystemBackup = async (req, res, next) => {
  try {
    const incomingBackup = req.body?.backup || req.body || {};
    const schemaVersion = String(incomingBackup.schemaVersion || '').trim();
    const collections = incomingBackup.collections || {};

    if (!schemaVersion) {
      return res.status(400).json({ message: 'Invalid backup file: missing schemaVersion.' });
    }

    if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
      return res.status(400).json({
        message: `Unsupported backup schemaVersion. Expected ${BACKUP_SCHEMA_VERSION}, received ${schemaVersion}.`,
      });
    }

    if (!collections || typeof collections !== 'object') {
      return res.status(400).json({ message: 'Invalid backup file: missing collections payload.' });
    }

    const usersPayload = ensureArrayPayload(collections.users);
    const hasSuperAdmin = usersPayload.some((user) => user.role === 'superadmin');
    if (!hasSuperAdmin) {
      return res.status(400).json({ message: 'Restore rejected: backup must include at least one superadmin user.' });
    }

    for (const [, Model] of BACKUP_COLLECTIONS) {
      await Model.deleteMany({});
    }

    const restoredCounts = {};

    for (const [key, Model] of BACKUP_COLLECTIONS) {
      const docs = toInsertableDocs(ensureArrayPayload(collections[key]));
      restoredCounts[key] = docs.length;

      if (docs.length > 0) {
        await Model.insertMany(docs, { ordered: true });
      }
    }

    if (restoredCounts.settings === 0) {
      await ensureSettingsDocument();
      restoredCounts.settings = 1;
    }

    return res.json({
      message: 'Backup restored successfully.',
      restoredCounts,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getSettings,
  updateSettings,
  getSystemBackup,
  restoreSystemBackup,
};
