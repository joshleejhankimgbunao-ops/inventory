const assert = require('node:assert/strict');
const test = require('node:test');

const loadOfflineSync = () => import('../../src/utils/offlineTransactionSync.js');

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

const queuedSale = (suffix, overrides = {}) => ({
  id: `TRX-${suffix}`,
  clientRequestId: `sale:${suffix}`,
  paymentMethod: 'Cash',
  cashTendered: '100.00',
  vatMode: 'vatable',
  transactionReference: { referenceNumber: '00123456', supportingDocument: null },
  items: [{ id: `product-${suffix}`, qty: 1 }],
  ownerUserId: OWNER_A,
  ...overrides,
});

test('Auto-Sync is enabled by default and disabled only by an explicit saved false value', async () => {
  const { isAutoSyncEnabled, canAutoSyncOfflineTransactions } = await loadOfflineSync();
  const queue = [queuedSale('one')];

  assert.equal(isAutoSyncEnabled(undefined), true);
  assert.equal(isAutoSyncEnabled(false), false);
  assert.equal(canAutoSyncOfflineTransactions({ queue, online: true, autoSync: true, hasAuth: true }), true);
  assert.equal(canAutoSyncOfflineTransactions({ queue, online: true, autoSync: false, hasAuth: true }), false);
});

test('enabled reconnect sync uses the queued stable request token and removes only the confirmed sale', async () => {
  const { syncNextOfflineTransaction } = await loadOfflineSync();
  const first = queuedSale('one');
  const second = queuedSale('two');
  const requests = [];

  const result = await syncNextOfflineTransaction({
    queue: [first, second],
    online: true,
    autoSync: true,
    hasAuth: true,
    ownerUserId: OWNER_A,
    createSale: async (...args) => requests.push(args),
  });

  assert.equal(result.status, 'synced');
  assert.equal(requests.length, 1);
  assert.equal(requests[0][2], 'sale:one');
  assert.equal(requests[0][3].transactionReferenceNumber, '00123456');
  assert.deepEqual(result.queue, [second]);
});

test('offline Cash sync preserves a leading-zero numeric Reference No. and never queues document data', async () => {
  const {
    addOfflineTransactionToQueue,
    createOfflineSaleRequest,
    getOfflineSyncQueueKey,
    readOfflineSyncQueue,
  } = await loadOfflineSync();
  const sale = queuedSale('reference', {
    transactionReference: {
      referenceNumber: '00123456789',
      supportingDocument: { originalName: 'must-not-sync.jpg', data: 'ignored' },
    },
  });
  const queue = addOfflineTransactionToQueue([], sale, OWNER_A);
  const storage = new Map([[getOfflineSyncQueueKey(OWNER_A), JSON.stringify(queue)]]);
  const restored = readOfflineSyncQueue({ getItem: (key) => storage.get(key) || null }, OWNER_A);
  const request = createOfflineSaleRequest(restored[0]);

  assert.equal(restored[0].transactionReference.referenceNumber, '00123456789');
  assert.equal(request.options.transactionReferenceNumber, '00123456789');
  assert.equal(Object.hasOwn(request.options, 'supportingDocument'), false);
});

test('disabled reconnect leaves queued sales untouched and makes no request', async () => {
  const { syncNextOfflineTransaction } = await loadOfflineSync();
  const queue = [queuedSale('one')];
  let requestCount = 0;

  const result = await syncNextOfflineTransaction({
    queue,
    online: true,
    autoSync: false,
    hasAuth: true,
    ownerUserId: OWNER_A,
    createSale: async () => { requestCount += 1; },
  });

  assert.equal(result.status, 'skipped');
  assert.equal(requestCount, 0);
  assert.deepEqual(result.queue, queue);
});

test('failed sync remains queued while a later sale can proceed after rotation', async () => {
  const { syncNextOfflineTransaction } = await loadOfflineSync();
  const first = queuedSale('one');
  const second = queuedSale('two');
  const failure = Object.assign(new Error('Backend unavailable'), { status: 503 });

  const failed = await syncNextOfflineTransaction({
    queue: [first, second],
    online: true,
    autoSync: true,
    hasAuth: true,
    ownerUserId: OWNER_A,
    createSale: async () => { throw failure; },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.queue[0].clientRequestId, 'sale:two');
  assert.equal(failed.queue[1].clientRequestId, 'sale:one');
  assert.equal(failed.queue[1].syncErrorStatus, 503);

  const synced = await syncNextOfflineTransaction({
    queue: failed.queue,
    online: true,
    autoSync: true,
    hasAuth: true,
    ownerUserId: OWNER_A,
    createSale: async () => {},
  });
  assert.equal(synced.status, 'synced');
  assert.equal(synced.queue[0].clientRequestId, 'sale:one');
});

test('retries preserve the original request token and queue de-duplication', async () => {
  const { addOfflineTransactionToQueue, syncNextOfflineTransaction } = await loadOfflineSync();
  const sale = queuedSale('retry');
  const queue = addOfflineTransactionToQueue(addOfflineTransactionToQueue([], sale, OWNER_A), sale, OWNER_A);
  const requestIds = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await syncNextOfflineTransaction({
      queue,
      online: true,
      autoSync: true,
      hasAuth: true,
      ownerUserId: OWNER_A,
      createSale: async (...args) => {
        requestIds.push(args[2]);
        throw new Error('Temporary failure');
      },
    });
    assert.equal(result.status, 'failed');
  }

  assert.equal(queue.length, 1);
  assert.deepEqual(requestIds, ['sale:retry', 'sale:retry']);
});

test('a queued sale is owned by its authenticated user and another user cannot sync it', async () => {
  const { addOfflineTransactionToQueue, syncNextOfflineTransaction } = await loadOfflineSync();
  const queue = addOfflineTransactionToQueue([], queuedSale('owned'), OWNER_A);
  let requestCount = 0;

  const otherUserResult = await syncNextOfflineTransaction({
    queue,
    online: true,
    autoSync: true,
    hasAuth: true,
    ownerUserId: OWNER_B,
    createSale: async () => { requestCount += 1; },
  });

  assert.equal(otherUserResult.status, 'skipped');
  assert.equal(requestCount, 0);
  assert.deepEqual(otherUserResult.queue, queue);

  const ownerResult = await syncNextOfflineTransaction({
    queue,
    online: true,
    autoSync: true,
    hasAuth: true,
    ownerUserId: OWNER_A,
    createSale: async () => { requestCount += 1; },
  });
  assert.equal(ownerResult.status, 'synced');
  assert.equal(requestCount, 1);
});

test('per-user storage keys isolate account switches and persist the owner queue', async () => {
  const { getOfflineSyncQueueKey, readOfflineSyncQueue } = await loadOfflineSync();
  const storage = new Map();
  const localStorageLike = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const ownerQueue = [queuedSale('persisted')];
  localStorageLike.setItem(getOfflineSyncQueueKey(OWNER_A), JSON.stringify(ownerQueue));

  assert.deepEqual(readOfflineSyncQueue(localStorageLike, OWNER_A), ownerQueue);
  assert.deepEqual(readOfflineSyncQueue(localStorageLike, OWNER_B), []);
  assert.notEqual(getOfflineSyncQueueKey(OWNER_A), getOfflineSyncQueueKey(OWNER_B));
});

test('legacy global entries are quarantined without assigning them to the current user', async () => {
  const {
    LEGACY_OFFLINE_SYNC_QUEUE_KEY,
    LEGACY_UNASSIGNED_OFFLINE_SYNC_QUEUE_KEY,
    getOfflineSyncQueueKey,
    migrateLegacyOfflineSyncQueue,
    readOfflineSyncQueue,
  } = await loadOfflineSync();
  const storage = new Map([[LEGACY_OFFLINE_SYNC_QUEUE_KEY, JSON.stringify([queuedSale('legacy', { ownerUserId: undefined })])]]);
  const localStorageLike = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };

  assert.equal(migrateLegacyOfflineSyncQueue(localStorageLike), true);
  assert.equal(localStorageLike.getItem(LEGACY_OFFLINE_SYNC_QUEUE_KEY), null);
  const quarantined = JSON.parse(localStorageLike.getItem(LEGACY_UNASSIGNED_OFFLINE_SYNC_QUEUE_KEY));
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0].legacyUnassigned, true);
  assert.deepEqual(readOfflineSyncQueue(localStorageLike, OWNER_A), []);
  assert.equal(localStorageLike.getItem(getOfflineSyncQueueKey(OWNER_A)), null);
});

test('an in-flight sync result is ignored after logout or an account switch', async () => {
  const { getOfflineSyncQueueKey, isOfflineSyncSessionActive } = await loadOfflineSync();
  const ownerAQueueKey = getOfflineSyncQueueKey(OWNER_A);

  assert.equal(isOfflineSyncSessionActive({
    expectedQueueKey: ownerAQueueKey,
    currentQueueKey: '',
    hasAuth: false,
  }), false);
  assert.equal(isOfflineSyncSessionActive({
    expectedQueueKey: ownerAQueueKey,
    currentQueueKey: getOfflineSyncQueueKey(OWNER_B),
    hasAuth: true,
  }), false);
  assert.equal(isOfflineSyncSessionActive({
    expectedQueueKey: ownerAQueueKey,
    currentQueueKey: ownerAQueueKey,
    hasAuth: true,
  }), true);
});

test('a synced offline Sale reconciles to its persisted server ObjectId', async () => {
  const { reconcileSyncedSale } = await loadOfflineSync();
  const queued = queuedSale('identity');
  const persistedId = '68a01234567890abcdef1234';
  const transactions = reconcileSyncedSale([queued], queued, {
    _id: persistedId,
    clientRequestId: queued.clientRequestId,
    createdAt: '2026-01-20T10:00:00.000Z',
    paymentMethod: 'cash',
    paymentStatus: 'Paid',
    saleType: 'regular',
    totalAmount: 100,
    items: [{ product: '68a01234567890abcdef9999', code: 'SKU-1', name: 'Product', quantity: 1, unitPrice: 100, subtotal: 100 }],
  });

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].sourceId, persistedId);
  assert.equal(transactions[0].id, `TRX-${persistedId.slice(-8).toUpperCase()}`);
  assert.equal(transactions[0].status, 'completed');
});

test('an unsynced local Sale keeps no authoritative server identity', async () => {
  const { reconcileSyncedSale } = await loadOfflineSync();
  const queued = queuedSale('local-only');

  assert.deepEqual(reconcileSyncedSale([queued], queued, undefined), [queued]);
  assert.equal(queued.sourceId, undefined);
});
