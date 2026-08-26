const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AUTOMATIC_BACKUP_RETENTION_COUNT,
  calculateFirstAutomaticBackupAt,
  calculateNextAutomaticBackupAt,
  pruneAutomaticBackupFiles,
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
