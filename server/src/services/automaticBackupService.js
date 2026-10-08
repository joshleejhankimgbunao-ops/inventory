const fs = require('fs/promises');
const path = require('path');
const Setting = require('../models/Setting');
const { generateSystemBackup } = require('./systemBackupService');
const { R2StorageError, r2Storage } = require('./r2StorageService');

const AUTOMATIC_BACKUP_DIRECTORY = path.resolve(__dirname, '../../backups');
const AUTOMATIC_BACKUP_FILE_PREFIX = 'automatic-inventory-backup-';
const AUTOMATIC_BACKUP_FILE_PATTERN = /^automatic-inventory-backup-\d{4}-\d{2}-\d{2}_\d{6}\.json$/;
const AUTOMATIC_BACKUP_R2_PREFIX = 'database-backups/automatic/';
const AUTOMATIC_BACKUP_RETENTION_COUNT = 30;
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_APP_TIME_ZONE = 'Asia/Manila';

let schedulerTimer = null;
let schedulerInitialized = false;
let backupInFlight = false;

const toSafeIntervalDays = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    return 1;
  }
  return parsed;
};

const parseBackupTime = (value) => {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(String(value || ''));
  if (!match) {
    return { hours: 23, minutes: 0, value: '23:00' };
  }

  const [hours, minutes] = value.split(':').map(Number);
  return { hours, minutes, value: String(value) };
};

const getAppTimeZone = (environment = process.env) => {
  const configuredTimeZone = String(environment.APP_TIME_ZONE || '').trim() || DEFAULT_APP_TIME_ZONE;

  try {
    Intl.DateTimeFormat('en-US', { timeZone: configuredTimeZone }).format();
    return configuredTimeZone;
  } catch {
    return DEFAULT_APP_TIME_ZONE;
  }
};

const getZonedDateTimeParts = (date, timeZone) => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(date))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hours: values.hour,
    minutes: values.minute,
    seconds: values.second,
  };
};

const addCalendarDays = ({ year, month, day }, days) => {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const getTimeZoneOffsetMilliseconds = (date, timeZone) => {
  const parts = getZonedDateTimeParts(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds)
    - new Date(date).getTime();
};

const zonedDateTimeToUtc = ({ year, month, day, hours, minutes, seconds = 0 }, timeZone) => {
  const approximateUtc = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  const offsetMilliseconds = getTimeZoneOffsetMilliseconds(approximateUtc, timeZone);
  return new Date(approximateUtc.getTime() - offsetMilliseconds);
};

const calculateFirstAutomaticBackupAt = ({ now = new Date(), time = '23:00', timeZone = getAppTimeZone() } = {}) => {
  const { hours, minutes } = parseBackupTime(time);
  const current = new Date(now);
  const currentParts = getZonedDateTimeParts(current, timeZone);
  let calendarDate = currentParts;
  let next = zonedDateTimeToUtc({ ...calendarDate, hours, minutes }, timeZone);

  if (next <= current) {
    calendarDate = addCalendarDays(calendarDate, 1);
    next = zonedDateTimeToUtc({ ...calendarDate, hours, minutes }, timeZone);
  }

  return next;
};

const calculateNextAutomaticBackupAt = ({
  from = new Date(),
  intervalDays = 1,
  time = '23:00',
  timeZone = getAppTimeZone(),
} = {}) => {
  const { hours, minutes } = parseBackupTime(time);
  const fromParts = getZonedDateTimeParts(from, timeZone);
  const calendarDate = addCalendarDays(fromParts, toSafeIntervalDays(intervalDays));
  return zonedDateTimeToUtc({ ...calendarDate, hours, minutes }, timeZone);
};

const formatBackupFileTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const isLocalAutomaticBackupStorageAllowed = () => process.env.NODE_ENV !== 'production';

const toAutomaticBackupObjectKey = (fileName) => `${AUTOMATIC_BACKUP_R2_PREFIX}${fileName}`;

const isAutomaticBackupFileName = (fileName) => AUTOMATIC_BACKUP_FILE_PATTERN.test(String(fileName || ''));

const toAutomaticBackupMetadata = (object = {}) => {
  const key = String(object.key || '');
  if (!key.startsWith(AUTOMATIC_BACKUP_R2_PREFIX)) return null;

  const fileName = key.slice(AUTOMATIC_BACKUP_R2_PREFIX.length);
  if (!isAutomaticBackupFileName(fileName) || key !== toAutomaticBackupObjectKey(fileName)) return null;

  const createdAt = object.lastModified ? new Date(object.lastModified) : null;
  return {
    id: fileName,
    fileName,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    size: Math.max(0, Number(object.size || 0)),
    status: 'available',
  };
};

const listAutomaticBackupHistory = async ({ storage = r2Storage } = {}) => {
  if (!storage.isConfigured()) {
    throw new R2StorageError('Cloud storage is required for automatic backup history.', {
      code: 'R2_NOT_CONFIGURED',
    });
  }

  const objects = await storage.listObjectsByPrefix(AUTOMATIC_BACKUP_R2_PREFIX);
  return objects
    .map(toAutomaticBackupMetadata)
    .filter(Boolean)
    .sort((left, right) => {
      const rightTime = right.createdAt ? right.createdAt.getTime() : 0;
      const leftTime = left.createdAt ? left.createdAt.getTime() : 0;
      return rightTime - leftTime || right.fileName.localeCompare(left.fileName);
    });
};

const getAutomaticBackupObject = async (fileName, { storage = r2Storage } = {}) => {
  if (!isAutomaticBackupFileName(fileName)) {
    throw new R2StorageError('Invalid automatic backup identifier.', {
      code: 'R2_INVALID_KEY',
      status: 400,
    });
  }

  if (!storage.isConfigured()) {
    throw new R2StorageError('Cloud storage is required for automatic backup downloads.', {
      code: 'R2_NOT_CONFIGURED',
    });
  }

  return {
    fileName,
    object: await storage.getObject(toAutomaticBackupObjectKey(fileName)),
  };
};

const getLatestAutomaticBackupObject = async ({ storage = r2Storage } = {}) => {
  const backups = await listAutomaticBackupHistory({ storage });
  if (backups.length === 0) return null;
  return getAutomaticBackupObject(backups[0].fileName, { storage });
};

const ensureSettingsDocument = async () => {
  const existing = await Setting.findOne({ singletonKey: 'default' });
  if (existing) return existing;

  const settings = new Setting({ singletonKey: 'default' });
  await settings.save();
  return settings;
};

const publishBackupStatus = (keys) => {
  const { publishSettingsUpdated } = require('./realtimeService');
  publishSettingsUpdated({
    keys,
    changedBy: 'system',
  });
};

const clearScheduledBackupTimer = () => {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
};

const pruneAutomaticBackupFiles = async (backupDirectory = AUTOMATIC_BACKUP_DIRECTORY) => {
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const automaticFiles = entries
    .filter((entry) => entry.isFile() && AUTOMATIC_BACKUP_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const filesToDelete = automaticFiles.slice(AUTOMATIC_BACKUP_RETENTION_COUNT);
  await Promise.all(filesToDelete.map((fileName) => fs.unlink(path.join(backupDirectory, fileName))));

  return automaticFiles.length - filesToDelete.length;
};

const pruneAutomaticBackupObjects = async (storage = r2Storage) => {
  const objects = await storage.listObjectsByPrefix(AUTOMATIC_BACKUP_R2_PREFIX);
  const automaticFiles = objects
    .filter((object) => AUTOMATIC_BACKUP_FILE_PATTERN.test(path.basename(String(object.key || ''))))
    .sort((left, right) => String(right.key).localeCompare(String(left.key)));

  const objectsToDelete = automaticFiles.slice(AUTOMATIC_BACKUP_RETENTION_COUNT);
  await Promise.all(objectsToDelete.map((object) => storage.deleteObject(object.key)));

  return automaticFiles.length - objectsToDelete.length;
};

const writeAutomaticBackupFile = async (backup) => {
  await fs.mkdir(AUTOMATIC_BACKUP_DIRECTORY, { recursive: true });

  const fileName = `${AUTOMATIC_BACKUP_FILE_PREFIX}${formatBackupFileTimestamp()}.json`;
  const destination = path.join(AUTOMATIC_BACKUP_DIRECTORY, fileName);
  const temporaryDestination = `${destination}.tmp`;

  try {
    await fs.writeFile(temporaryDestination, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryDestination, destination);
  } catch (error) {
    await fs.unlink(temporaryDestination).catch(() => {});
    throw error;
  }
  return { fileName, destination };
};

const storeAutomaticBackup = async (backup, { storage = r2Storage } = {}) => {
  const fileName = `${AUTOMATIC_BACKUP_FILE_PREFIX}${formatBackupFileTimestamp()}.json`;

  if (storage.isConfigured()) {
    const objectKey = toAutomaticBackupObjectKey(fileName);
    await storage.putObject({
      key: objectKey,
      body: JSON.stringify(backup, null, 2),
      contentType: 'application/json',
      metadata: {
        schemaversion: String(backup?.schemaVersion || ''),
        generatedat: String(backup?.generatedAt || ''),
      },
    });
    return { fileName, destination: objectKey, storage: 'r2' };
  }

  if (isLocalAutomaticBackupStorageAllowed()) {
    const stored = await writeAutomaticBackupFile(backup);
    return { ...stored, storage: 'local' };
  }

  throw new R2StorageError('Cloud storage is required for automatic backups in production.', {
    code: 'R2_NOT_CONFIGURED',
  });
};

const applyAutomaticBackupRetention = async ({ storage = r2Storage, storageType } = {}) => {
  if (storageType === 'r2') {
    return pruneAutomaticBackupObjects(storage);
  }
  if (storageType === 'local') {
    return pruneAutomaticBackupFiles();
  }
  return 0;
};

const scheduleBackupCheck = (nextAutomaticBackupAt) => {
  clearScheduledBackupTimer();
  if (!nextAutomaticBackupAt) return;

  const delay = Math.max(0, new Date(nextAutomaticBackupAt).getTime() - Date.now());
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    void checkAutomaticBackupDue();
  }, Math.min(delay, MAX_TIMER_DELAY_MS));
};

const saveAutomaticBackupState = async (settings, patch, keys) => {
  Object.assign(settings, patch);
  await settings.save();
  publishBackupStatus(keys);
  return settings;
};

const runAutomaticBackup = async ({
  settings,
  scheduledFor = null,
  generateBackup = generateSystemBackup,
  storeBackup = storeAutomaticBackup,
  saveState = saveAutomaticBackupState,
  writeLog,
  applyRetention = applyAutomaticBackupRetention,
} = {}) => {
  if (!settings?.automaticBackupEnabled) return;
  if (backupInFlight) return;

  backupInFlight = true;
  const now = new Date();
  const intervalDays = toSafeIntervalDays(settings.automaticBackupIntervalDays);
  const time = parseBackupTime(settings.automaticBackupTime).value;
  const timeZone = getAppTimeZone();
  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  const scheduleBase = scheduledDate && scheduledDate > now ? scheduledDate : now;
  const nextAutomaticBackupAt = calculateNextAutomaticBackupAt({
    from: scheduleBase,
    intervalDays,
    time,
    timeZone,
  });

  try {
    const backup = await generateBackup({ generatedBy: 'system' });
    const storedBackup = await storeBackup(backup);
    const { fileName } = storedBackup;

    await saveState(settings, {
      lastAutomaticBackupAt: now,
      lastAutomaticBackupStatus: 'successful',
      lastAutomaticBackupError: '',
      nextAutomaticBackupAt,
      automaticBackupTimeZone: timeZone,
    }, [
      'lastAutomaticBackupAt',
      'lastAutomaticBackupStatus',
      'lastAutomaticBackupError',
      'nextAutomaticBackupAt',
      'automaticBackupTimeZone',
    ]);

    const logActivity = writeLog || require('./logService').writeActivityLog;
    await logActivity({
      action: 'Automatic Backup Completed',
      details: `Saved ${fileName}.`,
    });

    try {
      await applyRetention({ storageType: storedBackup.storage });
    } catch (retentionError) {
      console.error('[AUTOMATIC BACKUP] Retention cleanup failed:', retentionError);
    }
  } catch (error) {
    const message = String(error?.message || 'Unable to create automatic backup.').slice(0, 240);
    console.error('[AUTOMATIC BACKUP] Failed:', error);

    await saveState(settings, {
      lastAutomaticBackupStatus: 'failed',
      lastAutomaticBackupError: message,
      nextAutomaticBackupAt,
      automaticBackupTimeZone: timeZone,
    }, [
      'lastAutomaticBackupStatus',
      'lastAutomaticBackupError',
      'nextAutomaticBackupAt',
      'automaticBackupTimeZone',
    ]);
  } finally {
    backupInFlight = false;
    scheduleBackupCheck(settings.automaticBackupEnabled ? nextAutomaticBackupAt : null);
  }
};

const checkAutomaticBackupDue = async () => {
  try {
    const settings = await ensureSettingsDocument();
    if (!settings.automaticBackupEnabled) {
      clearScheduledBackupTimer();
      return;
    }

    const now = new Date();
    const nextAutomaticBackupAt = settings.nextAutomaticBackupAt
      ? new Date(settings.nextAutomaticBackupAt)
      : null;

    if (nextAutomaticBackupAt && nextAutomaticBackupAt <= now) {
      await runAutomaticBackup({ settings, scheduledFor: nextAutomaticBackupAt });
      return;
    }

    scheduleBackupCheck(nextAutomaticBackupAt);
  } catch (error) {
    console.error('[AUTOMATIC BACKUP] Scheduler check failed:', error);
  }
};

const reloadAutomaticBackupScheduler = async ({ reschedule = false } = {}) => {
  clearScheduledBackupTimer();
  const settings = await ensureSettingsDocument();

  if (!settings.automaticBackupEnabled) {
    if (settings.nextAutomaticBackupAt) {
      await saveAutomaticBackupState(settings, { nextAutomaticBackupAt: null }, ['nextAutomaticBackupAt']);
    }
    return settings;
  }

  const time = parseBackupTime(settings.automaticBackupTime).value;
  const intervalDays = toSafeIntervalDays(settings.automaticBackupIntervalDays);
  const timeZone = getAppTimeZone();
  const now = new Date();
  const needsTimeZoneMigration = String(settings.automaticBackupTimeZone || '') !== timeZone;
  let nextAutomaticBackupAt = settings.nextAutomaticBackupAt
    ? new Date(settings.nextAutomaticBackupAt)
    : null;

  if (reschedule) {
    nextAutomaticBackupAt = calculateFirstAutomaticBackupAt({ now, time, timeZone });
  } else if (needsTimeZoneMigration && settings.lastAutomaticBackupAt) {
    nextAutomaticBackupAt = calculateNextAutomaticBackupAt({
      from: new Date(settings.lastAutomaticBackupAt),
      intervalDays,
      time,
      timeZone,
    });
  } else if (needsTimeZoneMigration || !nextAutomaticBackupAt) {
    nextAutomaticBackupAt = calculateFirstAutomaticBackupAt({ now, time, timeZone });
  }

  if (nextAutomaticBackupAt <= now) {
    await runAutomaticBackup({ settings, scheduledFor: nextAutomaticBackupAt });
    return settings;
  }

  if (
    needsTimeZoneMigration
    || !settings.nextAutomaticBackupAt
    || settings.nextAutomaticBackupAt.getTime() !== nextAutomaticBackupAt.getTime()
  ) {
    await saveAutomaticBackupState(settings, {
      nextAutomaticBackupAt,
      automaticBackupTimeZone: timeZone,
    }, ['nextAutomaticBackupAt', 'automaticBackupTimeZone']);
  }

  scheduleBackupCheck(nextAutomaticBackupAt);
  return settings;
};

const initializeAutomaticBackupScheduler = async () => {
  if (schedulerInitialized) return;
  schedulerInitialized = true;

  try {
    await reloadAutomaticBackupScheduler();
  } catch (error) {
    console.error('[AUTOMATIC BACKUP] Scheduler initialization failed:', error);
  }
};

module.exports = {
  AUTOMATIC_BACKUP_DIRECTORY,
  AUTOMATIC_BACKUP_FILE_PREFIX,
  AUTOMATIC_BACKUP_FILE_PATTERN,
  AUTOMATIC_BACKUP_R2_PREFIX,
  AUTOMATIC_BACKUP_RETENTION_COUNT,
  DEFAULT_APP_TIME_ZONE,
  calculateFirstAutomaticBackupAt,
  calculateNextAutomaticBackupAt,
  formatBackupFileTimestamp,
  getAppTimeZone,
  initializeAutomaticBackupScheduler,
  applyAutomaticBackupRetention,
  getAutomaticBackupObject,
  getLatestAutomaticBackupObject,
  isAutomaticBackupFileName,
  listAutomaticBackupHistory,
  pruneAutomaticBackupFiles,
  pruneAutomaticBackupObjects,
  reloadAutomaticBackupScheduler,
  runAutomaticBackup,
  storeAutomaticBackup,
  toAutomaticBackupObjectKey,
};
