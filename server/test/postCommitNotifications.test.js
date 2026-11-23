const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  deferPostCommitNotification,
  withPostCommitNotifications,
} = require('../src/services/postCommitNotifications');
const publishedLogEvents = [];
let nextLogId = 0;

const cacheMock = (filePath, exports) => {
  const resolvedPath = require.resolve(filePath);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
};

const createLog = async ([entry]) => [{ ...entry, _id: `log-${++nextLogId}`, createdAt: new Date('2026-10-28T00:00:00Z') }];
cacheMock('../src/models/ActivityLog', { create: createLog });
cacheMock('../src/models/InventoryLog', { create: createLog });
cacheMock('../src/services/realtimeService', {
  publishActivityLogged: (payload) => publishedLogEvents.push({ event: 'activity.logged', payload }),
  publishInventoryLogged: (payload) => publishedLogEvents.push({ event: 'inventory.logged', payload }),
});
const { writeActivityLog, writeInventoryLog } = require('../src/services/logService');

const makeSession = (runTransaction) => {
  let inTransaction = false;
  return {
    inTransaction: () => inTransaction,
    withTransaction: async (work) => {
      inTransaction = true;
      try {
        return await runTransaction(work);
      } finally {
        inTransaction = false;
      }
    },
  };
};

test('transaction notifications run only after the transaction callback commits', async () => {
  let committed = false;
  let delivered = 0;
  const session = makeSession(async (work) => {
    const result = await work();
    committed = true;
    return result;
  });

  const result = await withPostCommitNotifications(session, async () => {
    assert.equal(deferPostCommitNotification(session, () => {
      assert.equal(committed, true);
      delivered += 1;
    }), true);
    return 'saved';
  });

  assert.equal(result, 'saved');
  assert.equal(delivered, 1);
});

test('aborted transactions publish no queued notifications', async () => {
  let delivered = 0;
  const session = makeSession(async (work) => {
    await work();
    throw new Error('transaction aborted');
  });

  await assert.rejects(withPostCommitNotifications(session, async () => {
    deferPostCommitNotification(session, () => { delivered += 1; });
  }), /transaction aborted/);
  assert.equal(delivered, 0);
});

test('transaction callback retries discard notifications from failed attempts', async () => {
  let attempts = 0;
  let delivered = 0;
  const session = makeSession(async (work) => {
    try { await work(); } catch { /* simulate the driver's callback retry */ }
    return work();
  });

  await withPostCommitNotifications(session, async () => {
    attempts += 1;
    deferPostCommitNotification(session, () => { delivered += 1; });
    if (attempts === 1) throw new Error('transient transaction error');
    return 'committed';
  });

  assert.equal(attempts, 2);
  assert.equal(delivered, 1);
});

test('post-commit delivery failures do not convert committed writes into failures', async () => {
  const session = makeSession(async (work) => work());
  const result = await withPostCommitNotifications(session, async () => {
    deferPostCommitNotification(session, () => { throw new Error('stream unavailable'); });
    return 'committed';
  });
  assert.equal(result, 'committed');
});

test('logService defers transaction-bound activity and inventory events until commit', async () => {
  publishedLogEvents.length = 0;
  const session = makeSession(async (work) => {
    const result = await work();
    assert.equal(publishedLogEvents.length, 0, 'no event escapes while the transaction callback is active');
    return result;
  });

  await withPostCommitNotifications(session, async () => {
    await writeActivityLog({ action: 'Stock Updated', session });
    await writeInventoryLog({ action: 'ADD', code: 'SKU-1', session });
  });

  assert.deepEqual(publishedLogEvents.map(({ event }) => event), ['activity.logged', 'inventory.logged']);
  assert.deepEqual(publishedLogEvents.map(({ payload }) => payload.id), ['log-1', 'log-2']);
  assert.deepEqual(Object.keys(publishedLogEvents[0].payload).sort(), ['action', 'id', 'occurredAt', 'user']);
  assert.deepEqual(Object.keys(publishedLogEvents[1].payload).sort(), ['action', 'code', 'id', 'occurredAt', 'user']);
});

test('logService emits no transaction-bound log events after an aborted operation', async () => {
  publishedLogEvents.length = 0;
  const session = makeSession(async (work) => {
    await work();
    throw new Error('transaction aborted');
  });

  await assert.rejects(withPostCommitNotifications(session, async () => {
    await writeActivityLog({ action: 'Failed Operation', session });
    await writeInventoryLog({ action: 'DEDUCT', code: 'SKU-1', session });
  }), /transaction aborted/);
  assert.equal(publishedLogEvents.length, 0);
});

test('transactional stock writers use strict audits with post-commit notifications', () => {
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8');
  const logService = read('services/logService.js');
  const saleController = read('controllers/saleController.js');
  const productController = read('controllers/productController.js');
  const specialOrderController = read('controllers/specialOrderController.js');
  const auditedTransaction = read('services/auditedTransaction.js');

  assert.match(logService, /publishLogNotification\(session,\s*\(\) => publishActivityLogged/);
  assert.match(logService, /publishLogNotification\(session,\s*\(\) => publishInventoryLogged/);
  assert.match(saleController, /withPostCommitNotifications\(session, async \(\) => \{\s*const created = await executeSaleCreation/);
  assert.match(productController, /withAuditedTransaction\(async \(\{\s*session,\s*writeActivityLog: writeRequiredActivityLog,\s*writeInventoryLog: writeRequiredInventoryLog,/s);
  assert.match(productController, /await writeRequiredInventoryLog\(\{\s*action: 'DEDUCT'/s);
  assert.match(productController, /await writeRequiredActivityLog\(\{\s*user: req\.user, action: 'Removed Stock'/s);
  assert.doesNotMatch(specialOrderController, /session\.withTransaction/);
  assert.match(specialOrderController, /withPostCommitNotifications\(session, async \(\) => \{/);
  assert.match(auditedTransaction, /withPostCommitNotifications\(session, async/);
  assert.match(auditedTransaction, /afterCommit: \(notify\) => deferPostCommitNotification\(session, notify\)/);
});
