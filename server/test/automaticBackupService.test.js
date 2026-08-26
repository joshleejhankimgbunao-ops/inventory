const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AUTOMATIC_BACKUP_RETENTION_COUNT,
  AUTOMATIC_BACKUP_R2_PREFIX,
  calculateFirstAutomaticBackupAt,
  calculateNextAutomaticBackupAt,
  pruneAutomaticBackupFiles,
  pruneAutomaticBackupObjects,
  runAutomaticBackup,
  storeAutomaticBackup,
} = require('../src/services/automaticBackupService');

test('calculates the first backup at the next server-local scheduled time', () => {
  const now = new Date(2026, 7, 25, 22, 0, 0);
  const next = calculateFirstAutomaticBackupAt({ now, time: '23:00' });

  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 7);
  assert.equal(next.getDate(), 25);
  assert.equal(next.getHours(), 23);
  assert.equal(next.getMinutes(), 0);
});

test('calculates the next every-five-days backup at the configured server-local time', () => {
  const lastRun = new Date(2026, 7, 25, 23, 0, 0);
  const next = calculateNextAutomaticBackupAt({
    from: lastRun,
    intervalDays: 5,
    time: '23:00',
  });

  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 7);
  assert.equal(next.getDate(), 30);
  assert.equal(next.getHours(), 23);
  assert.equal(next.getMinutes(), 0);
});

test('retention cleanup removes only old automatic backup files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-automatic-backup-'));

  try {
    await fs.writeFile(path.join(directory, 'manual-backup.json'), '{}');

    await Promise.all(Array.from({ length: AUTOMATIC_BACKUP_RETENTION_COUNT + 2 }, (_, index) => {
      const seconds = String(index).padStart(2, '0');
      return fs.writeFile(
        path.join(directory, `automatic-inventory-backup-2026-08-25_2300${seconds}.json`),
        '{}'
      );
    }));

    const retainedCount = await pruneAutomaticBackupFiles(directory);
    const remaining = await fs.readdir(directory);

    assert.equal(retainedCount, AUTOMATIC_BACKUP_RETENTION_COUNT);
    assert.equal(remaining.filter((name) => name.startsWith('automatic-inventory-backup-')).length, AUTOMATIC_BACKUP_RETENTION_COUNT);
    assert.ok(remaining.includes('manual-backup.json'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('automatic backups are uploaded to the R2 automatic-backup prefix', async () => {
  const uploads = [];
  const storage = {
    isConfigured: () => true,
    putObject: async (operation) => uploads.push(operation),
  };

  const stored = await storeAutomaticBackup({ schemaVersion: 2, generatedAt: '2026-08-26T00:00:00.000Z' }, { storage });

  assert.equal(stored.storage, 'r2');
  assert.match(stored.destination, /^database-backups\/automatic\/automatic-inventory-backup-/);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].key, stored.destination);
  assert.equal(uploads[0].contentType, 'application/json');
});

test('automatic backup upload failure records the existing Failed status', async () => {
  const states = [];
  const settings = {
    automaticBackupEnabled: false,
    automaticBackupIntervalDays: 1,
    automaticBackupTime: '23:00',
  };
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await runAutomaticBackup({
      settings,
      generateBackup: async () => ({ schemaVersion: 2 }),
      storeBackup: async () => {
        throw new Error('R2 upload unavailable.');
      },
      saveState: async (_settings, patch) => states.push(patch),
      writeLog: async () => assert.fail('a failed upload must not log completion'),
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(states.length, 1);
  assert.equal(states[0].lastAutomaticBackupStatus, 'failed');
  assert.equal(states[0].lastAutomaticBackupError, 'R2 upload unavailable.');
});

test('R2 retention keeps the latest 30 automatic backups and never touches payment proofs', async () => {
  const deleted = [];
  const automaticObjects = Array.from({ length: AUTOMATIC_BACKUP_RETENTION_COUNT + 2 }, (_, index) => ({
    key: `${AUTOMATIC_BACKUP_R2_PREFIX}automatic-inventory-backup-2026-08-25_2300${String(index).padStart(2, '0')}.json`,
  }));
  const paymentProof = { key: 'payment-proofs/proof.jpg' };
  const storage = {
    listObjectsByPrefix: async (prefix) => {
      assert.equal(prefix, AUTOMATIC_BACKUP_R2_PREFIX);
      return [...automaticObjects, paymentProof];
    },
    deleteObject: async (key) => deleted.push(key),
  };

  const retainedCount = await pruneAutomaticBackupObjects(storage);

  assert.equal(retainedCount, AUTOMATIC_BACKUP_RETENTION_COUNT);
  assert.equal(deleted.length, 2);
  assert.ok(deleted.every((key) => key.startsWith(AUTOMATIC_BACKUP_R2_PREFIX)));
  assert.ok(!deleted.includes(paymentProof.key));
});
