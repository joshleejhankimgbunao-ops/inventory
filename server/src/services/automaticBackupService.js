const fs = require('fs/promises');
const path = require('path');
const Setting = require('../models/Setting');
const { generateSystemBackup } = require('./systemBackupService');

const AUTOMATIC_BACKUP_DIRECTORY = path.resolve(__dirname, '../../backups');
const AUTOMATIC_BACKUP_FILE_PREFIX = 'automatic-inventory-backup-';
const AUTOMATIC_BACKUP_FILE_PATTERN = /^automatic-inventory-backup-\d{4}-\d{2}-\d{2}_\d{6}\.json$/;
const AUTOMATIC_BACKUP_RETENTION_COUNT = 30;
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

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

const calculateFirstAutomaticBackupAt = ({ now = new Date(), time = '23:00' } = {}) => {
  const { hours, minutes } = parseBackupTime(time);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
};

const calculateNextAutomaticBackupAt = ({
  from = new Date(),
  intervalDays = 1,
  time = '23:00',
} = {}) => {
  const { hours, minutes } = parseBackupTime(time);
  const next = new Date(from);
  next.setDate(next.getDate() + toSafeIntervalDays(intervalDays));
  next.setHours(hours, minutes, 0, 0);
  return next;
};

const formatBackupFileTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
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
  await pruneAutomaticBackupFiles();

  return { fileName, destination };
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

const runAutomaticBackup = async ({ settings, scheduledFor = null } = {}) => {
  if (backupInFlight) return;

  backupInFlight = true;
  const now = new Date();
  const intervalDays = toSafeIntervalDays(settings.automaticBackupIntervalDays);
  const time = parseBackupTime(settings.automaticBackupTime).value;
  const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
  const scheduleBase = scheduledDate && scheduledDate > now ? scheduledDate : now;
  const nextAutomaticBackupAt = calculateNextAutomaticBackupAt({
    from: scheduleBase,
    intervalDays,
    time,
  });

  try {
    const backup = await generateSystemBackup({ generatedBy: 'system' });
    const { fileName } = await writeAutomaticBackupFile(backup);

    await saveAutomaticBackupState(settings, {
      lastAutomaticBackupAt: now,
      lastAutomaticBackupStatus: 'successful',
      lastAutomaticBackupError: '',
      nextAutomaticBackupAt,
    }, [
      'lastAutomaticBackupAt',
      'lastAutomaticBackupStatus',
      'lastAutomaticBackupError',
      'nextAutomaticBackupAt',
    ]);

    const { writeActivityLog } = require('./logService');
    await writeActivityLog({
      action: 'Automatic Backup Completed',
      details: `Saved ${fileName}.`,
    });
  } catch (error) {
    const message = String(error?.message || 'Unable to create automatic backup.').slice(0, 240);
    console.error('[AUTOMATIC BACKUP] Failed:', error);

    await saveAutomaticBackupState(settings, {
      lastAutomaticBackupStatus: 'failed',
      lastAutomaticBackupError: message,
      nextAutomaticBackupAt,
    }, [
      'lastAutomaticBackupStatus',
      'lastAutomaticBackupError',
      'nextAutomaticBackupAt',
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
  const now = new Date();
  let nextAutomaticBackupAt = settings.nextAutomaticBackupAt
    ? new Date(settings.nextAutomaticBackupAt)
    : null;

  if (reschedule) {
    nextAutomaticBackupAt = calculateFirstAutomaticBackupAt({ now, time });
  } else if (!nextAutomaticBackupAt && settings.lastAutomaticBackupAt) {
    nextAutomaticBackupAt = calculateNextAutomaticBackupAt({
      from: new Date(settings.lastAutomaticBackupAt),
      intervalDays,
      time,
    });
  } else if (!nextAutomaticBackupAt) {
    nextAutomaticBackupAt = calculateFirstAutomaticBackupAt({ now, time });
  }

  if (nextAutomaticBackupAt <= now) {
    await runAutomaticBackup({ settings, scheduledFor: nextAutomaticBackupAt });
    return settings;
  }

  if (!settings.nextAutomaticBackupAt || settings.nextAutomaticBackupAt.getTime() !== nextAutomaticBackupAt.getTime()) {
    await saveAutomaticBackupState(settings, { nextAutomaticBackupAt }, ['nextAutomaticBackupAt']);
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
  AUTOMATIC_BACKUP_RETENTION_COUNT,
  calculateFirstAutomaticBackupAt,
  calculateNextAutomaticBackupAt,
  formatBackupFileTimestamp,
  initializeAutomaticBackupScheduler,
  pruneAutomaticBackupFiles,
  reloadAutomaticBackupScheduler,
};
