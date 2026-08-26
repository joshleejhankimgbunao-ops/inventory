import React, { createContext, useState, useEffect, useMemo, useContext, useRef } from 'react';
import { getStockStatus } from '../utils/recommendationLogic';
import { showToast } from '../utils/toastHelper';
import { useAuth } from './AuthContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import {
    listProductsApi,
    createSaleApi,
    listCategoriesApi,
    listSalesHistoryViewApi,
    listActivityLogsApi,
    listInventoryLogsApi,
} from '../services/inventoryApi';

const INVENTORY_FALLBACK = {
    inventory: [],
    setInventory: () => {},
    categories: [],
    setCategories: () => {},
    fetchCategories: () => {},
    transactions: [],
    setTransactions: () => {},
    inventoryLogs: [],
    setInventoryLogs: () => {},
    activityLogs: [],
    setActivityLogs: () => {},
    logActivity: () => {},
    processedInventory: [],
    logAction: () => {},
    handleResetHistory: () => {},
    renameUserReferences: () => {},
    syncUserIdentityReferences: () => {},
    removeUserReferences: () => {},
    syncQueue: [],
    addToSyncQueue: () => {},
    isOnline: true,
    isInventoryLoading: false,
    isCategoriesLoading: false,
    isTransactionsLoading: false,
    isInventoryLogsLoading: false,
    isActivityLogsLoading: false,
    isPageDataLoading: false,
};

const InventoryContext = createContext(INVENTORY_FALLBACK);

const TRANSACTIONS_CACHE_PREFIX = 'transactionsCache:';

const getTransactionsCacheScope = (userId, username) => {
    const normalizedUserId = String(userId || '').trim();
    if (normalizedUserId) return `user:${normalizedUserId}`;

    // Compatibility only for sessions created before authUserId was stored.
    // Usernames are unique and are never display names.
    const normalizedUsername = String(username || '').trim().toLowerCase();
    return normalizedUsername ? `username:${normalizedUsername}` : '';
};

const getTransactionsCacheKey = (scope) => (
    scope ? `${TRANSACTIONS_CACHE_PREFIX}${scope}` : ''
);

const readTransactionsCache = (scope) => {
    const cacheKey = getTransactionsCacheKey(scope);
    if (!cacheKey) return [];

    try {
        const raw = localStorage.getItem(cacheKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const useInventory = () => {
    const context = useContext(InventoryContext);
    if (!context) {
        return INVENTORY_FALLBACK;
    }
    return context;
};

export const InventoryProvider = ({ children }) => {
    const { appSettings, userRole, currentUserName, currentAuthUsername, currentAuthUserId, ROLES } = useAuth(); // Depend on Auth Context for settings and auth session changes
    const transactionsCacheScope = getTransactionsCacheScope(currentAuthUserId, currentAuthUsername);

    const normalizeName = (value) => String(value || '').trim().toLowerCase();
    const preferredSuperAdminName = useMemo(() => {
        const configured = String(appSettings?.adminDisplayName || '').trim();
        const currentSessionName = String(currentUserName || '').trim();

        if (configured && normalizeName(configured) !== 'admin user') {
            return configured;
        }

        if (currentSessionName && normalizeName(currentSessionName) !== 'admin user') {
            return currentSessionName;
        }

        return configured || currentSessionName || 'Admin User';
    }, [appSettings?.adminDisplayName, currentUserName]);

    // 1. Inventory State (backend-first)
    const [inventory, setInventory] = useState([]);
    const [isInventoryLoading, setIsInventoryLoading] = useState(true);
    const inventoryRef = useRef([]);

    useEffect(() => {
        inventoryRef.current = inventory;
    }, [inventory]);

     useEffect(() => {
        let isMounted = true;

        const loadRemoteInventory = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) {
                    setIsInventoryLoading(false);
                }
                return;
            }

            if (isMounted) {
                setIsInventoryLoading(true);
            }

            try {
                const remoteProducts = await listProductsApi();
                if (isMounted && Array.isArray(remoteProducts)) {
                    setInventory(remoteProducts);
                }
            } catch {
                // Keep the latest in-memory inventory when backend is unavailable.
            } finally {
                if (isMounted) {
                    setIsInventoryLoading(false);
                }
            }
        };

        loadRemoteInventory();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername]);

     // Categories State
         const [categories, setCategories] = useState([]);
    const [isCategoriesLoading, setIsCategoriesLoading] = useState(true);

     const fetchCategories = async () => {
         const token = getAuthToken();
         if (!token) return;
         try {
             const remoteCategories = await listCategoriesApi();
            setCategories(Array.isArray(remoteCategories) ? remoteCategories : []);
         } catch (error) {
             console.error("Failed to fetch categories:", error);
         }
     };

     useEffect(() => {
        let isMounted = true;

        const loadRemoteCategories = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) {
                    setIsCategoriesLoading(false);
                }
                return;
            }

            if (isMounted) {
                setIsCategoriesLoading(true);
            }

            try {
                const remoteCategories = await listCategoriesApi();
                if (isMounted) {
                    setCategories(Array.isArray(remoteCategories) ? remoteCategories : []);
                }
            } catch (error) {
                console.error("Failed to fetch categories:", error);
            } finally {
                if (isMounted) {
                    setIsCategoriesLoading(false);
                }
            }
        };

        loadRemoteCategories();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername]);

     // 2. Transactions State (backend-first)
    const [transactions, setTransactions] = useState([]);
    const [transactionsCacheOwner, setTransactionsCacheOwner] = useState('');
    const [isTransactionsLoading, setIsTransactionsLoading] = useState(true);

     useEffect(() => {
        let isMounted = true;

        const loadRemoteTransactions = async () => {
            const token = getAuthToken();
            if (!token || !transactionsCacheScope) {
                if (isMounted) {
                    setTransactions([]);
                    setTransactionsCacheOwner('');
                    setIsTransactionsLoading(false);
                }
                return;
            }

            if (isMounted) {
                // Clear the prior account's in-memory data before exposing this
                // account's cache or authoritative API result.
                setTransactions([]);
                setTransactionsCacheOwner('');
                setIsTransactionsLoading(true);
                setTransactions(readTransactionsCache(transactionsCacheScope));
                setTransactionsCacheOwner(transactionsCacheScope);
            }

            try {
                const remoteTransactions = await listSalesHistoryViewApi(true);
                if (isMounted && Array.isArray(remoteTransactions)) {
                    setTransactions(remoteTransactions);
                    setTransactionsCacheOwner(transactionsCacheScope);
                }
            } catch {
                // Keep last known cached values when history API is temporarily unavailable.
                if (isMounted) {
                    setTransactions(readTransactionsCache(transactionsCacheScope));
                    setTransactionsCacheOwner(transactionsCacheScope);
                }
            } finally {
                if (isMounted) {
                    setIsTransactionsLoading(false);
                }
            }
        };

        loadRemoteTransactions();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername, currentAuthUserId, transactionsCacheScope]);

    useEffect(() => {
        if (!transactionsCacheScope || transactionsCacheOwner !== transactionsCacheScope || !getAuthToken()) {
            return;
        }

        try {
            localStorage.setItem(getTransactionsCacheKey(transactionsCacheScope), JSON.stringify(transactions));
        } catch {
            // Ignore storage errors (private mode/quota exceeded).
        }
    }, [transactions, transactionsCacheOwner, transactionsCacheScope]);

    useEffect(() => {
        const token = getAuthToken();
        if (!token) {
            return undefined;
        }

        let disposed = false;
        let isRefreshInFlight = false;
        let isInventoryRefreshInFlight = false;
        let isActivityLogsRefreshInFlight = false;
        let isInventoryLogsRefreshInFlight = false;

        const shouldShowStockAlerts = () => {
            return userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN;
        };

        const showStockTransitionAlerts = (previousInventory, latestInventory) => {
            if (!shouldShowStockAlerts()) {
                return;
            }

            const previousByCode = new Map(
                (previousInventory || []).map((item) => [String(item?.code || ''), item])
            );

            (latestInventory || []).forEach((currentItem) => {
                const code = String(currentItem?.code || '');
                if (!code) {
                    return;
                }

                const previousItem = previousByCode.get(code);
                if (!previousItem) {
                    return;
                }

                const previousStatus = getStockStatus(previousItem, appSettings);
                const nextStatus = getStockStatus(currentItem, appSettings);

                if (previousStatus === nextStatus) {
                    return;
                }

                if (nextStatus === 'Out of Stock') {
                    showToast(
                        'Out of Stock',
                        `${currentItem.name || code} (${code}) is now out of stock.`,
                        'warning',
                        `rt-stock-${code}-out-${Number(currentItem.stock || 0)}`
                    );
                    return;
                }

                if (nextStatus === 'Low Stock') {
                    showToast(
                        'Low Stock Alert',
                        `${currentItem.name || code} (${code}) dropped to low stock (${Number(currentItem.stock || 0)} left).`,
                        'warning',
                        `rt-stock-${code}-low-${Number(currentItem.stock || 0)}`
                    );
                }
            });
        };

        const refreshTransactions = async () => {
            if (isRefreshInFlight || disposed) {
                return;
            }

            isRefreshInFlight = true;
            try {
                const remoteTransactions = await listSalesHistoryViewApi(true);
                if (!disposed && Array.isArray(remoteTransactions)) {
                    setTransactions(remoteTransactions);
                    setTransactionsCacheOwner(transactionsCacheScope);
                }
            } catch {
                // Ignore transient failures; reconnection/fallback handles eventual consistency.
            } finally {
                isRefreshInFlight = false;
            }
        };

        const onSaleCreated = () => {
            void refreshTransactions();
        };

        const refreshInventory = async ({ notifyTransitions = false } = {}) => {
            if (isInventoryRefreshInFlight || disposed) {
                return;
            }

            isInventoryRefreshInFlight = true;

            try {
                const previousInventory = inventoryRef.current;
                const remoteProducts = await listProductsApi();
                if (!disposed && Array.isArray(remoteProducts)) {
                    setInventory(remoteProducts);
                    if (notifyTransitions) {
                        showStockTransitionAlerts(previousInventory, remoteProducts);
                    }
                }
            } catch {
                // Ignore transient failures; client will retry on next realtime event.
            } finally {
                isInventoryRefreshInFlight = false;
            }
        };

        const onInventoryUpdated = () => {
            void refreshInventory({ notifyTransitions: true });
        };

        const refreshActivityLogs = async () => {
            if (isActivityLogsRefreshInFlight || disposed) {
                return;
            }

            isActivityLogsRefreshInFlight = true;
            try {
                const remoteLogs = await listActivityLogsApi(200);
                if (!disposed && Array.isArray(remoteLogs)) {
                    setActivityLogs(remoteLogs);
                }
            } catch {
                // Ignore transient failures for realtime log refresh.
            } finally {
                isActivityLogsRefreshInFlight = false;
            }
        };

        const refreshInventoryLogs = async () => {
            if (isInventoryLogsRefreshInFlight || disposed) {
                return;
            }

            isInventoryLogsRefreshInFlight = true;
            try {
                const remoteLogs = await listInventoryLogsApi(200);
                if (!disposed && Array.isArray(remoteLogs)) {
                    setInventoryLogs(remoteLogs);
                }
            } catch {
                // Ignore transient failures for realtime log refresh.
            } finally {
                isInventoryLogsRefreshInFlight = false;
            }
        };

        const onActivityLogged = () => {
            void refreshActivityLogs();
        };

        const onInventoryLogged = () => {
            void refreshInventoryLogs();
        };

        const unsubscribeSaleCreated = subscribeRealtimeEvent('sale.created', onSaleCreated);
        const unsubscribeInventoryUpdated = subscribeRealtimeEvent('inventory.updated', onInventoryUpdated);
        const unsubscribeActivityLogged = subscribeRealtimeEvent('activity.logged', onActivityLogged);
        const unsubscribeInventoryLogged = subscribeRealtimeEvent('inventory.logged', onInventoryLogged);

        return () => {
            disposed = true;
            unsubscribeSaleCreated();
            unsubscribeInventoryUpdated();
            unsubscribeActivityLogged();
            unsubscribeInventoryLogged();
        };
    }, [appSettings, userRole, currentAuthUsername, currentAuthUserId, transactionsCacheScope, ROLES]);
     
     // 3. Inventory Logs State (backend-first)
     const [inventoryLogs, setInventoryLogs] = useState([]);
    const [isInventoryLogsLoading, setIsInventoryLogsLoading] = useState(true);

     useEffect(() => {
        let isMounted = true;

        const loadRemoteInventoryLogs = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) {
                    setIsInventoryLogsLoading(false);
                }
                return;
            }

            if (isMounted) {
                setIsInventoryLogsLoading(true);
            }

            try {
                const remoteLogs = await listInventoryLogsApi(200);
                if (isMounted && Array.isArray(remoteLogs)) {
                    setInventoryLogs(remoteLogs);
                }
            } catch {
                // Non-admin users may not have access to log endpoints.
            } finally {
                if (isMounted) {
                    setIsInventoryLogsLoading(false);
                }
            }
        };

        loadRemoteInventoryLogs();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername]);

     // 3.1 Sync Queue State (Offline Config)
     const [syncQueue, setSyncQueue] = useState(() => {
        try {
            const savedQueue = localStorage.getItem('syncQueue');
            return savedQueue ? JSON.parse(savedQueue) : [];
        } catch (error) {
            console.error("Failed to parse sync queue:", error);
            return [];
        }
     });

     // Persist Sync Queue
     useEffect(() => {
        localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
     }, [syncQueue]);

     // Online Status Tracking
     const [isOnline, setIsOnline] = useState(navigator.onLine);

     useEffect(() => {
        const handleStatusChange = () => {
            setIsOnline(navigator.onLine);
        };

        window.addEventListener('online', handleStatusChange);
        window.addEventListener('offline', handleStatusChange);

        return () => {
            window.removeEventListener('online', handleStatusChange);
            window.removeEventListener('offline', handleStatusChange);
        };
     }, []);

     // Background Sync Mechanism
     useEffect(() => {
        const processSyncQueue = async () => {
            // Check for Auto-Sync setting (default true if undefined)
            const autoSyncEnabled = appSettings?.autoSync !== false;

            if (syncQueue.length === 0 || !navigator.onLine || !autoSyncEnabled) return;

            const queueItem = syncQueue[0]; // FIFO
            try {
                // Ensure we have a valid token before trying to sync
                const token = getAuthToken();
                if (!token) return;

                console.log("Attempting to sync transaction:", queueItem.id);

                const apiItems = queueItem.items.map(item => ({
                    productId: item.id || item._id, // Handle legacy IDs
                    quantity: item.qty
                }));

                await createSaleApi(
                    apiItems,
                    queueItem.paymentMethod || 'cash',
                    queueItem.clientRequestId || queueItem.id,
                    {
                        vatMode: queueItem.vatMode,
                        ...(queueItem.paymentMethod === 'Cash' || String(queueItem.paymentMethod || '').toLowerCase() === 'cash'
                            ? { cashTendered: queueItem.cashTendered ?? queueItem.cash }
                            : {}),
                    }
                );
                
                // If successful, remove from queue
                setSyncQueue(prev => prev.slice(1));
                
                // The queued sale is already accepted. A follow-up refresh failure
                // must not restore/retry that successfully synchronized sale.
                try {
                    const remoteProducts = await listProductsApi();
                    if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
                        setInventory(remoteProducts);
                    }
                } catch (refreshError) {
                    console.warn('Offline sale synchronized, but inventory refresh failed:', refreshError);
                }
                
                console.log("Sync successful for:", queueItem.id);
            } catch (error) {
                const status = Number(error?.status || 0);
                const connectionFailed = isApiConnectionFailure(error);

                console.error("Sync failed for transaction:", queueItem.id, error);

                // Preserve the original sale and request identity for retry/recovery.
                // Rotate a failed item behind later entries so one rejection does not
                // permanently block the rest of the offline queue.
                setSyncQueue((prev) => {
                    if (prev.length === 0 || prev[0]?.id !== queueItem.id) return prev;

                    const failedItem = {
                        ...prev[0],
                        syncStatus: 'failed',
                        syncError: error?.message || 'Unable to synchronize transaction.',
                        syncErrorStatus: status || null,
                        lastSyncAttemptAt: new Date().toISOString(),
                    };

                    return prev.length === 1
                        ? [failedItem]
                        : [...prev.slice(1), failedItem];
                });

                showToast(
                    'Offline Sale Pending',
                    connectionFailed
                        ? `Transaction ${queueItem.id} remains queued until the backend is reachable.`
                        : `Transaction ${queueItem.id} was not accepted (${status || 'unknown error'}) and remains queued for recovery.`,
                    'warning',
                    `offline-sync-${queueItem.id}`
                );
            }
        };

        const intervalId = setInterval(processSyncQueue, 15000); // Check every 15s
        
        // Also run immediately when online status changes
        const handleOnline = () => processSyncQueue();
        window.addEventListener('online', handleOnline);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('online', handleOnline);
        };
     }, [syncQueue, appSettings]);

     const addToSyncQueue = (transaction) => {
        const requestId = transaction?.clientRequestId || transaction?.id;
        setSyncQueue((prev) => {
            const alreadyQueued = requestId && prev.some((entry) => (
                (entry?.clientRequestId || entry?.id) === requestId
            ));

            return alreadyQueued
                ? prev
                : [...prev, { ...transaction, clientRequestId: requestId }];
        });
     };

     // 4. Activity Logs (backend-first)
     const [activityLogs, setActivityLogs] = useState([]);
    const [isActivityLogsLoading, setIsActivityLogsLoading] = useState(true);

     useEffect(() => {
        let isMounted = true;

        const loadRemoteActivityLogs = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) {
                    setIsActivityLogsLoading(false);
                }
                return;
            }

            if (isMounted) {
                setIsActivityLogsLoading(true);
            }

            try {
                const remoteLogs = await listActivityLogsApi(200);
                if (isMounted && Array.isArray(remoteLogs)) {
                    setActivityLogs(remoteLogs);
                }
            } catch {
                // Non-admin users may not have access to activity log endpoints.
            } finally {
                if (isMounted) {
                    setIsActivityLogsLoading(false);
                }
            }
        };

        loadRemoteActivityLogs();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername]);

     useEffect(() => {
        if (!preferredSuperAdminName || normalizeName(preferredSuperAdminName) === 'admin user') {
            return;
        }

        setTransactions((prev) => {
            let changed = false;
            const next = prev.map((trx) => {
                if (normalizeName(trx?.cashier) === 'admin user') {
                    changed = true;
                    return { ...trx, cashier: preferredSuperAdminName };
                }
                return trx;
            });
            return changed ? next : prev;
        });

        setInventoryLogs((prev) => {
            let changed = false;
            const next = prev.map((log) => {
                if (normalizeName(log?.user) === 'admin user') {
                    changed = true;
                    return { ...log, user: preferredSuperAdminName };
                }
                return log;
            });
            return changed ? next : prev;
        });

        setActivityLogs((prev) => {
            let changed = false;
            const next = prev.map((log) => {
                if (normalizeName(log?.user) === 'admin user') {
                    changed = true;
                    return { ...log, user: preferredSuperAdminName };
                }
                return log;
            });
            return changed ? next : prev;
        });

        setSyncQueue((prev) => {
            let changed = false;
            const next = prev.map((entry) => {
                if (normalizeName(entry?.cashier) === 'admin user') {
                    changed = true;
                    return { ...entry, cashier: preferredSuperAdminName };
                }
                return entry;
            });
            return changed ? next : prev;
        });
     }, [preferredSuperAdminName]);

     // Activity Log Helper (used across pages)
     const logActivity = (user, action, details = '') => {
       setActivityLogs(prev => [{ id: Date.now(), user, action, details, timestamp: Date.now() }, ...prev]);
     };

    // 5. Log Action Helper
    // Use preferred superadmin display name as fallback when caller does not pass a user.
    const logAction = (action, code, details, user = preferredSuperAdminName) => {
        const newLog = {
            date: new Date().toLocaleString(),
            action, // ADD, DEDUCT, UPDATE, CREATE
            code,
            details,
            user
        };
        setInventoryLogs(prev => [...prev, newLog]);
    };

    // 6. Rename User References (for Settings update)
    const renameUserReferences = (oldName, newName) => {
        if (!oldName || !newName || oldName === newName) {
            return;
        }

        // Use functional updates to avoid stale-state overwrites when multiple updates happen quickly.
        setTransactions(prev => prev.map(t =>
            t.cashier === oldName ? { ...t, cashier: newName } : t
        ));

        setInventoryLogs(prev => prev.map(l =>
            l.user === oldName ? { ...l, user: newName } : l
        ));

        setActivityLogs(prev => prev.map(l =>
            l.user === oldName ? { ...l, user: newName } : l
        ));
    };

    const syncUserIdentityReferences = (user) => {
        const userId = String(user?.id || user?._id || '').trim();
        if (!userId) {
            return;
        }

        const userReference = {
            _id: userId,
            id: userId,
            displayName: String(user?.displayName || '').trim(),
            name: String(user?.name || '').trim(),
            username: String(user?.username || '').trim(),
            role: String(user?.role || '').trim(),
        };
        const referenceId = (reference) => String(
            reference && typeof reference === 'object'
                ? (reference._id || reference.id || '')
                : reference || ''
        ).trim();
        const mergeReference = (reference) => ({
            ...(reference && typeof reference === 'object' ? reference : {}),
            ...userReference,
        });

        setActivityLogs((prev) => prev.map((log) => (
            referenceId(log?.userRef) === userId
                ? { ...log, userRef: mergeReference(log.userRef) }
                : log
        )));

        setInventoryLogs((prev) => prev.map((log) => (
            referenceId(log?.userRef) === userId
                ? { ...log, userRef: mergeReference(log.userRef) }
                : log
        )));

        setTransactions((prev) => prev.map((transaction) => (
            referenceId(transaction?.cashierUser) === userId || String(transaction?.cashierId || '').trim() === userId
                ? { ...transaction, cashierUser: mergeReference(transaction.cashierUser) }
                : transaction
        )));
    };

    // 6.1 Remove All User References (for hard account deletion)
    const removeUserReferences = (targetName) => {
        if (!targetName) {
            return;
        }

        const normalizeName = (value) => String(value || '').trim().toLowerCase();
        const target = normalizeName(targetName);

        setTransactions(prev => prev.filter(t => normalizeName(t.cashier) !== target));
        setInventoryLogs(prev => prev.filter(l => normalizeName(l.user) !== target));
        setActivityLogs(prev => prev.filter(l => normalizeName(l.user) !== target));
        setSyncQueue(prev => prev.filter(entry => normalizeName(entry.cashier) !== target));
    };

    // 7. Reset History Logic
    const handleResetHistory = () => {
        setTransactions([]);
        setInventoryLogs([]);
    };

    // 8. Derived Processed Inventory (using appSettings from AuthContext)
    const processedInventory = useMemo(() => {
        return inventory.map(item => {
           return {
               ...item,
               status: getStockStatus(item, appSettings)
           };
        });
     }, [inventory, appSettings]);

    const isPageDataLoading = useMemo(() => {
        return (
            isInventoryLoading
            || isCategoriesLoading
            || isTransactionsLoading
            || isInventoryLogsLoading
            || isActivityLogsLoading
        );
    }, [
        isInventoryLoading,
        isCategoriesLoading,
        isTransactionsLoading,
        isInventoryLogsLoading,
        isActivityLogsLoading,
    ]);

    return (
        <InventoryContext.Provider value={{
            inventory, setInventory,
            transactions: transactionsCacheOwner === transactionsCacheScope && Boolean(getAuthToken()) ? transactions : [], setTransactions,
            inventoryLogs, setInventoryLogs,
            activityLogs, setActivityLogs,
            logActivity,
            processedInventory,
            logAction,
            handleResetHistory,
            categories,
            setCategories,
            fetchCategories,
            renameUserReferences,
            syncUserIdentityReferences,
            removeUserReferences,
            syncQueue,
            addToSyncQueue,
            isOnline,
            isInventoryLoading,
            isCategoriesLoading,
            isTransactionsLoading,
            isInventoryLogsLoading,
            isActivityLogsLoading,
            isPageDataLoading
        }}>
            {children}
        </InventoryContext.Provider>
    );
};
