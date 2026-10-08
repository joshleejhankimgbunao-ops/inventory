import { getSaleStatus } from '../../shared/saleLifecycle.mjs';

const getQueueEntryKey = (entry) => String(entry?.clientRequestId || entry?.id || '').trim();

export const reconcileSyncedSale = (transactions, queued, sale) => {
  if (!/^[a-f\d]{24}$/i.test(String(sale?._id || ''))) return transactions;
  const sourceId = String(sale._id);
  const requestId = sale.clientRequestId || getQueueEntryKey(queued);
  const document = sale.transactionReference?.supportingDocument;
  const incoming = {
    ...queued,
    id: `TRX-${sourceId.slice(-8).toUpperCase()}`,
    sourceId,
    clientRequestId: requestId,
    date: sale.createdAt,
    status: getSaleStatus(sale),
    voidInfo: sale.voidInfo || null,
    paymentStatus: sale.paymentStatus,
    paymentMethod: sale.paymentMethod,
    saleType: sale.saleType || 'regular',
    specialOrderId: sale.specialOrderId || null,
    specialOrderNumber: sale.specialOrderNumber || '',
    creditTransactionId: sale.creditTransactionId || '',
    total: sale.totalAmount,
    netAmount: sale.netAmount,
    vatAmount: sale.vatAmount,
    grossAmount: sale.grossAmount,
    vatMode: sale.vatMode,
    isArchived: Boolean(sale.isArchived),
    transactionReference: sale.transactionReference ? {
      referenceNumber: sale.transactionReference.referenceNumber || '',
      supportingDocument: document ? {
        originalName: document.originalName, mimeType: document.mimeType,
        size: document.size, uploadedAt: document.uploadedAt,
      } : null,
    } : null,
    items: (sale.items || []).map((item) => ({
      id: String(item.product || ''), code: item.code, name: item.name,
      qty: item.quantity, price: item.unitPrice, subtotal: item.subtotal,
    })),
  };
  const matches = (row) => row.sourceId === sourceId
    || row.clientRequestId === requestId
    || (!row.sourceId && row.id === queued.id);
  // A realtime fetch can win the race with the POST response. Prefer that
  // authoritative persisted row (which may already have a newer lifecycle).
  const existing = transactions.find((row) => row.sourceId === sourceId);
  return [existing ? { ...incoming, ...existing } : incoming, ...transactions.filter((row) => !matches(row))];
};
const normalizeOwnerUserId = (userId) => String(userId || '').trim();

export const LEGACY_OFFLINE_SYNC_QUEUE_KEY = 'syncQueue';
export const LEGACY_UNASSIGNED_OFFLINE_SYNC_QUEUE_KEY = 'syncQueue:legacy-unassigned';
const OFFLINE_SYNC_QUEUE_PREFIX = 'syncQueue:user:';

export const getOfflineSyncQueueKey = (userId) => {
  const normalizedUserId = normalizeOwnerUserId(userId);
  return normalizedUserId ? `${OFFLINE_SYNC_QUEUE_PREFIX}${normalizedUserId}` : '';
};

export const isOfflineSyncSessionActive = ({ expectedQueueKey, currentQueueKey, hasAuth }) => (
  Boolean(hasAuth)
  && Boolean(expectedQueueKey)
  && expectedQueueKey === currentQueueKey
);

export const readOfflineSyncQueue = (storage, userId) => {
  const key = getOfflineSyncQueueKey(userId);
  if (!key) return [];

  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const migrateLegacyOfflineSyncQueue = (storage) => {
  try {
    const rawLegacyQueue = storage.getItem(LEGACY_OFFLINE_SYNC_QUEUE_KEY);
    if (!rawLegacyQueue) return false;

    const legacyQueue = JSON.parse(rawLegacyQueue);
    if (!Array.isArray(legacyQueue)) return false;

    const existingQuarantine = JSON.parse(storage.getItem(LEGACY_UNASSIGNED_OFFLINE_SYNC_QUEUE_KEY) || '[]');
    const quarantine = Array.isArray(existingQuarantine) ? existingQuarantine : [];
    const merged = legacyQueue.reduce((entries, entry) => {
      const requestId = getQueueEntryKey(entry);
      if (!requestId || entries.some((queuedEntry) => getQueueEntryKey(queuedEntry) === requestId)) {
        return entries;
      }
      return [...entries, { ...entry, clientRequestId: requestId, legacyUnassigned: true }];
    }, quarantine);

    storage.setItem(LEGACY_UNASSIGNED_OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(merged));
    storage.removeItem(LEGACY_OFFLINE_SYNC_QUEUE_KEY);
    return true;
  } catch {
    // Leave unreadable legacy data untouched rather than risking data loss.
    return false;
  }
};

export const isAutoSyncEnabled = (autoSync) => autoSync !== false;

export const canAutoSyncOfflineTransactions = ({ queue = [], online, autoSync, hasAuth }) => (
  Array.isArray(queue)
  && queue.length > 0
  && Boolean(online)
  && Boolean(hasAuth)
  && isAutoSyncEnabled(autoSync)
);

export const isOfflineTransactionOwnedBy = (transaction = {}, userId) => (
  Boolean(normalizeOwnerUserId(userId))
  && String(transaction.ownerUserId || '').trim() === normalizeOwnerUserId(userId)
);

export const addOfflineTransactionToQueue = (queue = [], transaction = {}, ownerUserId) => {
  const requestId = getQueueEntryKey(transaction);
  const normalizedOwnerUserId = normalizeOwnerUserId(ownerUserId);
  if (!requestId || !normalizedOwnerUserId) return queue;

  return queue.some((entry) => getQueueEntryKey(entry) === requestId)
    ? queue
    : [...queue, { ...transaction, clientRequestId: requestId, ownerUserId: normalizedOwnerUserId }];
};

export const removeSyncedOfflineTransaction = (queue = [], transaction = {}) => {
  const requestId = getQueueEntryKey(transaction);
  if (!requestId) return queue;
  return queue.filter((entry) => getQueueEntryKey(entry) !== requestId);
};

export const retainFailedOfflineTransaction = (queue = [], transaction = {}, error = {}) => {
  const requestId = getQueueEntryKey(transaction);
  const index = queue.findIndex((entry) => getQueueEntryKey(entry) === requestId);
  if (index < 0) return queue;

  const failedEntry = {
    ...queue[index],
    syncStatus: 'failed',
    syncError: error?.message || 'Unable to synchronize transaction.',
    syncErrorStatus: Number(error?.status || 0) || null,
    lastSyncAttemptAt: new Date().toISOString(),
  };

  return queue.length === 1
    ? [failedEntry]
    : [...queue.slice(0, index), ...queue.slice(index + 1), failedEntry];
};

export const createOfflineSaleRequest = (transaction = {}) => ({
  items: (transaction.items || []).map((item) => ({
    productId: item.id || item._id,
    quantity: item.qty,
  })),
  paymentMethod: transaction.paymentMethod || 'cash',
  clientRequestId: getQueueEntryKey(transaction),
  options: {
    vatMode: transaction.vatMode,
    ...(String(transaction.paymentMethod || '').toLowerCase() === 'cash'
      ? {
        cashTendered: transaction.cashTendered ?? transaction.cash,
        transactionReferenceNumber: String(transaction.transactionReference?.referenceNumber || '').trim(),
      }
      : {}),
  },
});

export const syncNextOfflineTransaction = async ({ queue = [], online, autoSync, hasAuth, ownerUserId, createSale }) => {
  if (!canAutoSyncOfflineTransactions({ queue, online, autoSync, hasAuth })) {
    return { status: 'skipped', queue };
  }

  const transaction = queue.find((entry) => isOfflineTransactionOwnedBy(entry, ownerUserId));
  if (!transaction) {
    return { status: 'skipped', queue };
  }
  const request = createOfflineSaleRequest(transaction);
  try {
    const sale = await createSale(request.items, request.paymentMethod, request.clientRequestId, request.options);
    return {
      status: 'synced',
      transaction,
      sale,
      queue: removeSyncedOfflineTransaction(queue, transaction),
    };
  } catch (error) {
    return {
      status: 'failed',
      transaction,
      error,
      queue: retainFailedOfflineTransaction(queue, transaction, error),
    };
  }
};
