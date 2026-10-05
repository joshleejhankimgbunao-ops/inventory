const assert = require('node:assert/strict');
const test = require('node:test');

const mongoose = require('mongoose');
const ActivityLog = require('../src/models/ActivityLog');
const InventoryLog = require('../src/models/InventoryLog');

const realtimePath = require.resolve('../src/services/realtimeService');
const servicePath = require.resolve('../src/services/auditedTransaction');

const loadService = ({ activityCreate, inventoryCreate, publishActivity, publishInventory, session }) => {
  require.cache[realtimePath] = {
    id: realtimePath,
    filename: realtimePath,
    loaded: true,
    exports: {
      publishActivityLogged: publishActivity,
      publishInventoryLogged: publishInventory,
    },
  };
  delete require.cache[servicePath];
  ActivityLog.create = activityCreate;
  InventoryLog.create = inventoryCreate;
  mongoose.startSession = async () => session;
  return require('../src/services/auditedTransaction');
};

test('a required audit failure rejects the strict transactional operation', async (context) => {
  const originalStartSession = mongoose.startSession;
  const originalActivityCreate = ActivityLog.create;
  const originalInventoryCreate = InventoryLog.create;
  context.after(() => {
    mongoose.startSession = originalStartSession;
    ActivityLog.create = originalActivityCreate;
    InventoryLog.create = originalInventoryCreate;
    delete require.cache[servicePath];
  });

  let ended = false;
  let published = false;
  const { withAuditedTransaction } = loadService({
    activityCreate: async () => { throw new Error('audit unavailable'); },
    inventoryCreate: async () => [],
    publishActivity: () => { published = true; },
    publishInventory: () => { published = true; },
    session: {
      withTransaction: async (operation) => operation(),
      endSession: async () => { ended = true; },
    },
  });

  await assert.rejects(
    withAuditedTransaction(({ writeActivityLog }) => writeActivityLog({ action: 'Void Sale' })),
    /audit unavailable/
  );
  assert.equal(published, false);
  assert.equal(ended, true);
});

test('strict audit realtime is queued until the database transaction commits', async (context) => {
  const originalStartSession = mongoose.startSession;
  const originalActivityCreate = ActivityLog.create;
  const originalInventoryCreate = InventoryLog.create;
  context.after(() => {
    mongoose.startSession = originalStartSession;
    ActivityLog.create = originalActivityCreate;
    InventoryLog.create = originalInventoryCreate;
    delete require.cache[servicePath];
  });

  const order = [];
  const { withAuditedTransaction } = loadService({
    activityCreate: async () => {
      order.push('audit-written');
      return [{ _id: 'log-1', action: 'Void Sale', user: 'Admin', createdAt: new Date() }];
    },
    inventoryCreate: async () => [],
    publishActivity: () => { order.push('realtime-published'); },
    publishInventory: () => { order.push('inventory-published'); },
    session: {
      withTransaction: async (operation) => {
        await operation();
        order.push('committed');
      },
      endSession: async () => {},
    },
  });

  await withAuditedTransaction(({ writeActivityLog }) => writeActivityLog({
    action: 'Void Sale',
    details: 'Future foundation test',
    user: { name: 'Admin' },
  }));

  assert.deepEqual(order, ['audit-written', 'committed', 'realtime-published']);
});
