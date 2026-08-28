const assert = require('node:assert/strict');
const test = require('node:test');

const loadAutoSyncSetting = () => import('../../src/utils/autoSyncSetting.js');

test('immediate Auto-Sync ON and OFF saves use the existing partial settings update contract', async () => {
  const { persistAutoSyncImmediately } = await loadAutoSyncSetting();
  const calls = [];
  const updateSettings = async (...args) => {
    calls.push(args);
    return { autoSync: args[0].autoSync };
  };

  assert.equal(await persistAutoSyncImmediately(updateSettings, true), true);
  assert.equal(await persistAutoSyncImmediately(updateSettings, false), false);
  assert.deepEqual(calls, [
    [{ autoSync: true }, { partial: true, throwOnError: true }],
    [{ autoSync: false }, { partial: true, throwOnError: true }],
  ]);
});

test('a failed immediate Auto-Sync save rejects so the UI can restore its previous value', async () => {
  const { persistAutoSyncImmediately } = await loadAutoSyncSetting();
  await assert.rejects(
    () => persistAutoSyncImmediately(async () => { throw new Error('Network unavailable'); }, false),
    /Network unavailable/,
  );
});

test('the immediate-save guard rejects rapid repeated toggle attempts until the request completes', async () => {
  const { beginAutoSyncSave, endAutoSyncSave } = await loadAutoSyncSetting();
  const inFlightRef = { current: false };
  assert.equal(beginAutoSyncSave(inFlightRef), true);
  assert.equal(beginAutoSyncSave(inFlightRef), false);
  endAutoSyncSave(inFlightRef);
  assert.equal(beginAutoSyncSave(inFlightRef), true);
});

test('later General Save payloads exclude Auto-Sync and cannot overwrite its immediate value', async () => {
  const { excludeAutoSyncFromBulkSettings } = await loadAutoSyncSetting();
  const payload = excludeAutoSyncFromBulkSettings({ storeName: 'TLC', autoSync: false, contactPhone: '0917' });
  assert.deepEqual(payload, { storeName: 'TLC', contactPhone: '0917' });
  assert.equal(Object.hasOwn(payload, 'autoSync'), false);
});
