import React, { createContext, useState, useEffect, useMemo, useContext } from 'react';
import { getStockStatus } from '../utils/recommendationLogic';
import { useAuth } from './AuthContext';
import { getAuthToken } from '../services/apiClient';
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

export const useInventory = () => {
    const context = useContext(InventoryContext);
    if (!context) {
        return INVENTORY_FALLBACK;
    }
    return context;
};

export const InventoryProvider = ({ children }) => {
    const { appSettings, userRole, currentUserName, currentAuthUsername } = useAuth(); // Depend on Auth Context for settings and auth session changes

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
    }, [userRole, currentUserName, currentAuthUsername]);

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
    }, [userRole, currentUserName, currentAuthUsername]);

     // 2. Transactions State (backend-first)
     const [transactions, setTransactions] = useState([]);
    const [isTransactionsLoading, setIsTransactionsLoading] = useState(true);

     useEffect(() => {
        let isMounted = true;

        const loadRemoteTransactions = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) {
                    setIsTransactionsLoading(false);
                }
                return;
            }

            if (isMounted) {
                setIsTransactionsLoading(true);
            }

            try {
                const remoteTransactions = await listSalesHistoryViewApi(true);
                if (isMounted && Array.isArray(remoteTransactions)) {
                    setTransactions(remoteTransactions);
                }
            } catch {
                // Cashier role cannot list sales history in backend; keep in-memory values.
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
    }, [userRole, currentUserName, currentAuthUsername]);
     
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
    }, [userRole, currentUserName, currentAuthUsername]);

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

                await createSaleApi(apiItems, queueItem.paymentMethod || 'cash', queueItem.id);
                
                // If successful, remove from queue
                setSyncQueue(prev => prev.slice(1));
                
                // Refresh inventory from server to ensure consistency
                const remoteProducts = await listProductsApi();
                if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
                    setInventory(remoteProducts);
                }
                
                console.log("Sync successful for:", queueItem.id);
            } catch (error) {
                console.error("Sync failed for transaction:", queueItem.id, error);
                // We leave it in the queue to retry later
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
        setSyncQueue(prev => [...prev, transaction]);
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
    }, [userRole, currentUserName, currentAuthUsername]);

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
            transactions, setTransactions,
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
