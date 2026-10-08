const test = require('node:test');
const assert = require('node:assert/strict');

const loadAutomaticBackupSetting = () => import('../../src/utils/automaticBackupSetting.js');

test('Automatic Backup immediate save persists explicit OFF without omitting false', async () => {
  const { persistAutomaticBackupEnabledImmediately } = await loadAutomaticBackupSetting();
  const calls = [];
  const updateSettings = async (...args) => {
    calls.push(args);
    return { automaticBackupEnabled: false };
  };

  assert.equal(await persistAutomaticBackupEnabledImmediately(updateSettings, false), false);
  assert.deepEqual(calls, [[
    { automaticBackupEnabled: false },
    { partial: true, throwOnError: true },
  ]]);
});

test('Automatic Backup immediate save persists ON and rejects a response that omits the boolean', async () => {
  const { persistAutomaticBackupEnabledImmediately } = await loadAutomaticBackupSetting();

  assert.equal(
    await persistAutomaticBackupEnabledImmediately(async () => ({ automaticBackupEnabled: true }), true),
    true,
  );
  await assert.rejects(
    () => persistAutomaticBackupEnabledImmediately(async () => ({}), false),
    /could not be saved/i,
  );
});

test('schedule save excludes the immediate enabled flag and leaves an explicit false intact', async () => {
  const { excludeAutomaticBackupEnabledFromScheduleSave } = await loadAutomaticBackupSetting();
  const schedule = excludeAutomaticBackupEnabledFromScheduleSave({
    automaticBackupEnabled: false,
    automaticBackupIntervalDays: 7,
    automaticBackupTime: '01:30',
  });

  assert.equal(Object.hasOwn(schedule, 'automaticBackupEnabled'), false);
  assert.equal(schedule.automaticBackupIntervalDays, 7);
  assert.equal(schedule.automaticBackupTime, '01:30');
});
