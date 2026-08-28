const assert = require('node:assert/strict');
const test = require('node:test');

const Setting = require('../src/models/Setting');

test('Auto-Sync is a persisted Setting boolean with an enabled default', () => {
  const autoSyncPath = Setting.schema.path('autoSync');
  assert.ok(autoSyncPath);
  assert.equal(autoSyncPath.instance, 'Boolean');
  assert.equal(autoSyncPath.options.default, true);

  const disabled = new Setting({ autoSync: false });
  assert.equal(disabled.autoSync, false);
  assert.equal(disabled.validateSync(), undefined);
});
