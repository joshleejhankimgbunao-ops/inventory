import React, { createContext, useState, useEffect, useMemo, useContext } from 'react';
import { getLowStockThreshold } from '../utils/recommendationLogic';
import { useAuth } from './AuthContext';
import { getAuthToken } from '../services/apiClient';
import {
    listProductsApi,
    createSaleApi,
    listSalesHistoryApi,
    listInventoryLogsApi,
    listActivityLogsApi,
    archiveSaleApi,
    restoreSaleApi,
} from '../services/inventoryApi';

const InventoryContext = createContext();

export const useInventory = () => {
    const context = useContext(InventoryContext);
    if (!context) {
        throw new Error('useInventory must be used within an InventoryProvider');
    }
    return context;
};

export const InventoryProvider = ({ children }) => {
    const { appSettings, currentUserName } = useAuth(); // Depend on Auth Context for settings

    const [inventory, setInventory] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [inventoryLogs, setInventoryLogs] = useState([]);
    const [activityLogs, setActivityLogs] = useState([]);

    const refreshBackendData = async () => {
        const token = getAuthToken();
        if (!token) {
            setInventory([]);
            setTransactions([]);
            setInventoryLogs([]);
            setActivityLogs([]);
            return;
        }

        const [remoteProducts, remoteTransactions, remoteInventoryLogs, remoteActivityLogs] = await Promise.all([
            listProductsApi(),
            listSalesHistoryApi(true),
            listInventoryLogsApi(300),
            listActivityLogsApi(300),
        ]);

        setInventory(Array.isArray(remoteProducts) ? remoteProducts : []);
        setTransactions(Array.isArray(remoteTransactions) ? remoteTransactions : []);
        setInventoryLogs(Array.isArray(remoteInventoryLogs) ? remoteInventoryLogs : []);
        setActivityLogs(Array.isArray(remoteActivityLogs) ? remoteActivityLogs : []);
    };

     useEffect(() => {
        const loadRemoteInventory = async () => {
            const token = getAuthToken();
            if (!token) {
                setInventory([]);
                setTransactions([]);
                setInventoryLogs([]);
                setActivityLogs([]);
                return;
            }

            try {
                await refreshBackendData();
            } catch {
                // keep in-memory state when backend is unavailable
            }
        };

        loadRemoteInventory();
     }, [currentUserName]);

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

                await createSaleApi(apiItems, queueItem.paymentMethod || 'cash');
                
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


     // Activity Log Helper (used across pages)
     const logActivity = (user, action, details = '') => {
       setActivityLogs(prev => [{ id: Date.now(), user, action, details, timestamp: Date.now() }, ...prev]);
     };

    // 5. Log Action Helper (in-memory helper; backend actions are logged server-side)
    // Note: We need to use "Admin User" default if no user passed, but ideally we pass current user
    const logAction = (action, code, details, user = "Admin User") => {
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
        // Update Transactions
        const updatedTrx = transactions.map(t => 
            t.cashier === oldName ? { ...t, cashier: newName } : t
        );
        setTransactions(updatedTrx);

        // Update Inventory Logs
        const updatedLogs = inventoryLogs.map(l => 
            l.user === oldName ? { ...l, user: newName } : l
        );
        setInventoryLogs(updatedLogs);
        
        // Update Activity Logs
        const updatedActivity = activityLogs.map(l => 
            l.user === oldName ? { ...l, user: newName } : l
        );
        setActivityLogs(updatedActivity);
    };

    const toggleTransactionArchive = async (id) => {
        const trx = transactions.find((item) => item.id === id);
        if (!trx) return;

        try {
            if (trx.isArchived) {
                await restoreSaleApi(id);
            } else {
                await archiveSaleApi(id);
            }

            const refreshed = await listSalesHistoryApi(true);
            setTransactions(Array.isArray(refreshed) ? refreshed : []);
        } catch {
            // keep previous state if archive toggle fails
        }
    };

    // 7. Reset History Logic
    const handleResetHistory = () => {
        setTransactions([]);
        setInventoryLogs([]);
    };

    // 8. Derived Processed Inventory (using appSettings from AuthContext)
    const processedInventory = useMemo(() => {
        return inventory.map(item => {
           const threshold = getLowStockThreshold(item, appSettings);
           return {
               ...item,
               status: item.stock === 0 ? 'Out of Stock' : (item.stock <= threshold ? 'Critical' : 'In Stock')
           };
        });
     }, [inventory, appSettings]);

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
            renameUserReferences,
            toggleTransactionArchive,
            refreshBackendData,
            syncQueue,
            addToSyncQueue,
            isOnline
        }}>
            {children}
        </InventoryContext.Provider>
    );
};
