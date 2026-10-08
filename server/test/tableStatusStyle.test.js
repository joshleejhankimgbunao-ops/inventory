const test = require('node:test');
const assert = require('node:assert/strict');

test('table status styling groups only unresolved records as attention rows', async () => {
  const { getAttentionStatusGroup } = await import('../../src/utils/tableStatusStyle.js');

  for (const status of ['Pending', 'In Progress', 'Ready for Pickup', 'Unpaid', 'Partially Paid', 'Near Due', 'Due Today']) {
    assert.equal(getAttentionStatusGroup(status), 'active', status);
  }

  assert.equal(getAttentionStatusGroup('Overdue'), 'critical');

  for (const status of ['Completed', 'Paid', 'Cancelled']) {
    assert.equal(getAttentionStatusGroup(status), 'final', status);
  }
});
