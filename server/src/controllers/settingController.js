const Setting = require('../models/Setting');

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

  return null;
};

const ensureSettingsDocument = async () => {
  const existing = await Setting.findOne({ singletonKey: 'default' });
  if (existing) {
    return existing;
  }

  return Setting.create({ singletonKey: 'default' });
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

    if ('lowStockAlert' in payload) payload.lowStockAlert = toNumberOrNull(payload.lowStockAlert);
    if ('maxStockLimit' in payload) payload.maxStockLimit = toNumberOrNull(payload.maxStockLimit);

    if ('stockRules' in payload) {
      payload.stockRules = {
        categories: sanitizeRulesMap(payload.stockRules?.categories || {}),
        products: sanitizeRulesMap(payload.stockRules?.products || {}),
      };
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

module.exports = {
  getSettings,
  updateSettings,
};
