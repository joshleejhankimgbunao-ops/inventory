const Setting = require('../models/Setting');
const mongoose = require('mongoose');
const { publishSettingsUpdated } = require('../services/realtimeService');
const { parseStrictDecimal, parseStrictWholeNumber } = require('../utils/numericValidation');
const { toPublicSettings } = require('../config/publicSettings');
const { BACKUP_SCHEMA_VERSION, BACKUP_COLLECTIONS, generateSystemBackup } = require('../services/systemBackupService');
const {
  getAutomaticBackupObject,
  getLatestAutomaticBackupObject,
  isAutomaticBackupFileName,
  listAutomaticBackupHistory,
  reloadAutomaticBackupScheduler,
} = require('../services/automaticBackupService');
const { isObjectNotFoundError } = require('../services/r2StorageService');

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BACKUP_TIME_RULE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
  'autoSync',
  'automaticBackupEnabled',
  'automaticBackupIntervalDays',
  'automaticBackupTime',
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
  return parseStrictDecimal(value);
};

const sanitizeRulesMap = (source = {}) => {
  const sanitized = {};

  for (const [key, rawValue] of Object.entries(source || {})) {
    const normalizedKey = normalizeString(key);
    const numericValue = parseStrictWholeNumber(rawValue, { min: 1 });

    if (!normalizedKey || numericValue === null) {
      const error = new Error('Stock rule limits must be whole numbers greater than 0.');
      error.status = 400;
      throw error;
    }

    sanitized[normalizedKey] = numericValue;
  }

  return sanitized;
};

const sanitizeBudgetBand = (band = {}, fallback = {}) => {
  const minSource = band.min ?? fallback.min ?? 0;
  const maxSource = band.max ?? fallback.max ?? 0;
  const min = parseStrictDecimal(minSource);
  const max = parseStrictDecimal(maxSource);

  if (min === null || max === null) {
    const error = new Error('Budget range values must be non-negative numbers with up to 2 decimal places.');
    error.status = 400;
    throw error;
  }

  return {
    min,
    max,
  };
};

const sanitizeBudgetRanges = (source = {}) => {
  const low = sanitizeBudgetBand(source.low || {}, { min: 0, max: 500 });
  const moderate = sanitizeBudgetBand(source.moderate || {}, { min: low.max, max: 2000 });
  const high = sanitizeBudgetBand(source.high || {}, { min: moderate.max, max: Number.MAX_SAFE_INTEGER });

  low.max = Math.max(low.min, low.max);
  moderate.min = Math.max(low.max, moderate.min);
  moderate.max = Math.max(moderate.min, moderate.max);
  high.min = Math.max(moderate.max, high.min);
  high.max = Math.max(high.min, high.max);

  return { low, moderate, high };
};

const validatePayload = (payload) => {
  if ('automaticBackupEnabled' in payload && typeof payload.automaticBackupEnabled !== 'boolean') {
    return 'automaticBackupEnabled must be a boolean.';
  }

  if ('automaticBackupIntervalDays' in payload) {
    const intervalDays = parseStrictWholeNumber(payload.automaticBackupIntervalDays, { min: 1, max: 30 });
    if (intervalDays === null) {
      return 'automaticBackupIntervalDays must be a whole number from 1 to 30.';
    }
  }

  if ('automaticBackupTime' in payload && !BACKUP_TIME_RULE.test(String(payload.automaticBackupTime || ''))) {
    return 'automaticBackupTime must use HH:mm 24-hour format.';
  }

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

const ensureSettingsDocument = async ({ session = null } = {}) => {
  const existingQuery = Setting.findOne({ singletonKey: 'default' });
  if (session) {
    existingQuery.session(session);
  }

  const existing = await existingQuery;
  if (existing) {
    return existing;
  }

  const settings = new Setting({ singletonKey: 'default' });
  await settings.save(session ? { session } : undefined);
  return settings;
};

const BACKUP_COLLECTION_KEYS = BACKUP_COLLECTIONS.map(([key]) => key);

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
    return res.json(req.user ? settings : toPublicSettings(settings));
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

    let settings = await ensureSettingsDocument();
    const changesAutomaticBackup = (
      ('automaticBackupEnabled' in payload && Boolean(payload.automaticBackupEnabled) !== Boolean(settings.automaticBackupEnabled))
      || ('automaticBackupIntervalDays' in payload && Number(payload.automaticBackupIntervalDays) !== Number(settings.automaticBackupIntervalDays))
      || ('automaticBackupTime' in payload && String(payload.automaticBackupTime || '').trim() !== String(settings.automaticBackupTime || ''))
    );
    if (changesAutomaticBackup && req.user?.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only Super Admin can change automatic backup settings.' });
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

    if ('lowStockAlert' in payload) {
      const lowStockAlert = parseStrictWholeNumber(payload.lowStockAlert, { max: 100 });
      if (lowStockAlert === null) {
        return res.status(400).json({ message: 'lowStockAlert must be a whole number from 0 to 100.' });
      }
      payload.lowStockAlert = lowStockAlert;
    }
    if ('maxStockLimit' in payload) {
      const maxStockLimit = parseStrictWholeNumber(payload.maxStockLimit, { min: 1 });
      if (maxStockLimit === null) {
        return res.status(400).json({ message: 'maxStockLimit must be a whole number greater than 0.' });
      }
      payload.maxStockLimit = maxStockLimit;
    }
    if ('automaticBackupIntervalDays' in payload) {
      const automaticBackupIntervalDays = parseStrictWholeNumber(payload.automaticBackupIntervalDays, { min: 1, max: 30 });
      if (automaticBackupIntervalDays === null) {
        return res.status(400).json({ message: 'automaticBackupIntervalDays must be a whole number from 1 to 30.' });
      }
      payload.automaticBackupIntervalDays = automaticBackupIntervalDays;
    }
    if ('automaticBackupTime' in payload) {
      payload.automaticBackupTime = String(payload.automaticBackupTime || '').trim();
    }

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

    for (const [key, value] of Object.entries(payload)) {
      settings[key] = value;
    }

    await settings.save();

    if (changesAutomaticBackup) {
      settings = await reloadAutomaticBackupScheduler({ reschedule: true });
    }

    publishSettingsUpdated({
      keys: Object.keys(payload),
      changedBy: req.user?.username || req.user?.name || '',
    });

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
    const backup = await generateSystemBackup({
      generatedBy: req.user?.username || req.user?.name || 'superadmin',
    });

    return res.json({
      message: 'Backup generated.',
      backup,
    });
  } catch (error) {
    return next(error);
  }
};

const requireAutomaticBackupAccess = (req, res) => {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized.' });
    return false;
  }

  if (req.user.role !== 'superadmin') {
    res.status(403).json({ message: 'Forbidden: insufficient role.' });
    return false;
  }

  return true;
};

const streamAutomaticBackupDownload = async ({ backup, res, next }) => {
  const fileName = String(backup?.fileName || '');
  const body = backup?.object?.Body;

  if (!isAutomaticBackupFileName(fileName) || !body) {
    return res.status(404).json({ message: 'Automatic backup is not available.' });
  }

  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', `attachment; filename="${fileName}"`);
  res.type('application/json');

  if (typeof body.pipe === 'function') {
    body.on('error', (error) => next(error));
    body.pipe(res);
    return undefined;
  }

  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    return res.send(Buffer.from(bytes));
  }

  return res.status(404).json({ message: 'Automatic backup is not available.' });
};

const getAutomaticBackupHistory = async (req, res, next, dependencies = {}) => {
  if (!requireAutomaticBackupAccess(req, res)) return undefined;

  try {
    const listBackups = dependencies.listBackups || listAutomaticBackupHistory;
    const backups = await listBackups();
    return res.json({ backups });
  } catch (error) {
    return next(error);
  }
};

const downloadAutomaticBackup = async (req, res, next, dependencies = {}) => {
  if (!requireAutomaticBackupAccess(req, res)) return undefined;

  const fileName = String(req.params?.fileName || '');
  if (!isAutomaticBackupFileName(fileName)) {
    return res.status(400).json({ message: 'Invalid automatic backup identifier.' });
  }

  try {
    const getBackup = dependencies.getBackup || getAutomaticBackupObject;
    const backup = await getBackup(fileName);
    return streamAutomaticBackupDownload({ backup, res, next });
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      return res.status(404).json({ message: 'Automatic backup is not available.' });
    }
    return next(error);
  }
};

const downloadLatestAutomaticBackup = async (req, res, next, dependencies = {}) => {
  if (!requireAutomaticBackupAccess(req, res)) return undefined;

  try {
    const getLatestBackup = dependencies.getLatestBackup || getLatestAutomaticBackupObject;
    const backup = await getLatestBackup();
    if (!backup) {
      return res.status(404).json({ message: 'No automatic backups are available.' });
    }
    return streamAutomaticBackupDownload({ backup, res, next });
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      return res.status(404).json({ message: 'Automatic backup is not available.' });
    }
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
      const legacyMessage = schemaVersion === '1.0.0'
        ? 'Legacy backup schemaVersion 1.0.0 is incomplete because it does not include Special Orders and Credit Transactions. Restore was not started.'
        : `Unsupported backup schemaVersion. Expected ${BACKUP_SCHEMA_VERSION}, received ${schemaVersion}.`;

      return res.status(400).json({
        message: legacyMessage,
      });
    }

    if (!collections || typeof collections !== 'object') {
      return res.status(400).json({ message: 'Invalid backup file: missing collections payload.' });
    }

    const missingCollections = BACKUP_COLLECTION_KEYS.filter((key) => !Array.isArray(collections[key]));
    if (missingCollections.length > 0) {
      return res.status(400).json({
        message: `Restore rejected: current backup is incomplete. Missing collection arrays: ${missingCollections.join(', ')}. Restore was not started.`,
      });
    }

    const usersPayload = ensureArrayPayload(collections.users);
    const hasSuperAdmin = usersPayload.some((user) => user.role === 'superadmin');
    if (!hasSuperAdmin) {
      return res.status(400).json({ message: 'Restore rejected: backup must include at least one superadmin user.' });
    }

    const restoredCounts = {};
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        for (const [, Model] of BACKUP_COLLECTIONS) {
          await Model.deleteMany({}, { session });
        }

        for (const [key, Model] of BACKUP_COLLECTIONS) {
          const docs = toInsertableDocs(collections[key]);
          restoredCounts[key] = docs.length;

          if (docs.length > 0) {
            await Model.insertMany(docs, { ordered: true, session });
          }
        }

        if (restoredCounts.settings === 0) {
          await ensureSettingsDocument({ session });
          restoredCounts.settings = 1;
        }
      });
    } finally {
      await session.endSession();
    }

    await reloadAutomaticBackupScheduler();

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
  getAutomaticBackupHistory,
  downloadAutomaticBackup,
  downloadLatestAutomaticBackup,
  __test: {
    requireAutomaticBackupAccess,
    streamAutomaticBackupDownload,
  },
};
