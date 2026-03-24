import React, { createContext, useState, useEffect, useMemo, useContext } from 'react';
import { getLowStockThreshold } from '../utils/recommendationLogic';
import { useAuth } from './AuthContext';
import { getAuthToken } from '../services/apiClient';
import { listProductsApi, createSaleApi } from '../services/inventoryApi';

const InventoryContext = createContext();

export const useInventory = () => {
    const context = useContext(InventoryContext);
    if (!context) {
        throw new Error('useInventory must be used within an InventoryProvider');
    }
    return context;
};

export const InventoryProvider = ({ children }) => {
    const { appSettings } = useAuth(); // Depend on Auth Context for settings

    // 1. Inventory State
    const INVENTORY_VERSION = 2; // Bump this to force fresh data reload

    const [inventory, setInventory] = useState(() => {
        try {
            const savedVersion = localStorage.getItem('inventoryVersion');
            if (savedVersion && parseInt(savedVersion) === INVENTORY_VERSION) {
                const savedInventory = localStorage.getItem('inventoryDiff');
                if (savedInventory) return JSON.parse(savedInventory);
            } else {
                // Version mismatch — clear old data
                localStorage.removeItem('inventoryDiff');
                localStorage.setItem('inventoryVersion', INVENTORY_VERSION);
            }
        } catch (error) {
            console.error("Failed to parse inventory from localStorage:", error);
            localStorage.removeItem('inventoryDiff');
        }
        
        return [
           // Lumbers
           { code: 'LBR-001', brand: '', name: 'Coco Lumber', color: '', size: '2x4x8 ft', category: 'Lumbers', price: 180, stock: 150, status: 'In Stock' },
           { code: 'LBR-002', brand: '', name: 'Coco Lumber', color: '', size: '2x3x10 ft', category: 'Lumbers', price: 160, stock: 0, status: 'Out of Stock' },
           { code: 'LBR-003', brand: '', name: 'Good Lumber', color: '', size: '2x4x8 ft', category: 'Lumbers', price: 280, stock: 45, status: 'In Stock' },
           
           // Steel Bars
           { code: 'STL-001', brand: '', name: 'Deformed Bar', color: '', size: '10mm x 6m', category: 'Steel Bars', price: 220, stock: 8, status: 'Critical' },
           { code: 'STL-002', brand: '', name: 'Deformed Bar', color: '', size: '12mm x 6m', category: 'Steel Bars', price: 340, stock: 50, status: 'In Stock' },
           
           // Galvanized Sheets
           { code: 'GS-001', brand: '', name: 'GI Plain Sheet', color: '', size: 'Gauge 26 x 8 ft', category: 'Galvanized Sheets', price: 380, stock: 60, status: 'In Stock' },
           { code: 'GS-002', brand: '', name: 'GI Corrugated Sheet', color: '', size: 'Gauge 26 x 10 ft', category: 'Galvanized Sheets', price: 450, stock: 35, status: 'In Stock' },
           
           // Plywoods
           { code: 'PLY-001', brand: '', name: 'Marine Plywood', color: '', size: '1/4" (4x8)', category: 'Plywoods', price: 450, stock: 85, status: 'In Stock' },
           { code: 'PLY-002', brand: '', name: 'Marine Plywood', color: '', size: '1/2" (4x8)', category: 'Plywoods', price: 850, stock: 0, status: 'Out of Stock' },
           { code: 'PLY-003', brand: '', name: 'Ordinary Plywood', color: '', size: '1/4" (4x8)', category: 'Plywoods', price: 320, stock: 120, status: 'In Stock' },
           
           // Boards
           { code: 'BRD-001', brand: 'Hardiflex', name: 'Fiber Cement Board', color: '', size: '4x8 (4.5mm)', category: 'Boards', price: 280, stock: 40, status: 'In Stock' },
           
           // Steel Plates
           { code: 'SPL-001', brand: '', name: 'Mild Steel Plate', color: '', size: '4x8 (3mm)', category: 'Steel Plates', price: 3200, stock: 10, status: 'In Stock' },
           
           // Pipes
           { code: 'PIP-001', brand: '', name: 'GI Pipe', color: '', size: '1/2" x 6 m', category: 'Pipes', price: 320, stock: 45, status: 'In Stock' },
           { code: 'PIP-002', brand: 'Neltex', name: 'PVC Pipe', color: 'Orange', size: '4" x 3 m', category: 'Pipes', price: 280, stock: 55, status: 'In Stock' },
           
           // Paints
           { code: 'PNT-001', brand: 'Boysen', name: 'Flat Latex', color: 'White', size: '4 Liters', category: 'Paints', price: 650, stock: 30, status: 'In Stock' },
           { code: 'PNT-002', brand: 'Davies', name: 'Quick Dry Enamel', color: 'Red', size: '1 Liter', category: 'Paints', price: 280, stock: 0, status: 'Out of Stock' },
           { code: 'PNT-003', brand: 'Boysen', name: 'Permacoat', color: 'Ivory', size: '4 Liters', category: 'Paints', price: 720, stock: 18, status: 'In Stock' },
           
           // Thinners
           { code: 'THN-001', brand: 'Boysen', name: 'Lacquer Thinner', color: '', size: '1 Liter', category: 'Thinners', price: 120, stock: 80, status: 'In Stock' },
           
           // Cement, Sand & Gravel
           { code: 'CMT-001', brand: 'Republic', name: 'Portland Cement', color: '', size: '40 kg', category: 'Cement, Sand & Gravel', price: 240, stock: 100, status: 'In Stock' },
           { code: 'CMT-002', brand: 'Holcim', name: 'Excel Cement', color: '', size: '40 kg', category: 'Cement, Sand & Gravel', price: 245, stock: 0, status: 'Out of Stock' },
           { code: 'CMT-003', brand: 'Eagle', name: 'Portland Cement', color: '', size: '40 kg', category: 'Cement, Sand & Gravel', price: 235, stock: 75, status: 'In Stock' },
           
           // Bolts, Nuts, Screws & Nails
           { code: 'BNS-001', brand: '', name: 'Common Nail', color: '', size: '4 inches', category: 'Bolts, Nuts, Screws & Nails', price: 85, stock: 200, status: 'In Stock' },
           { code: 'BNS-002', brand: '', name: 'Concrete Nail', color: '', size: '3 inches', category: 'Bolts, Nuts, Screws & Nails', price: 95, stock: 150, status: 'In Stock' },
           { code: 'BNS-003', brand: '', name: 'Hex Bolt', color: '', size: 'M10x50 mm', category: 'Bolts, Nuts, Screws & Nails', price: 12, stock: 500, status: 'In Stock' },
           
           // Electrical & Lighting
           { code: 'ELC-001', brand: 'Delaware', name: 'THHN Wire', color: '', size: '3.5mm² x 150 m', category: 'Electrical & Lighting', price: 4500, stock: 12, status: 'In Stock' },
           { code: 'ELC-002', brand: 'Philips', name: 'LED Bulb', color: 'Warm White', size: '12 watts', category: 'Electrical & Lighting', price: 85, stock: 100, status: 'In Stock' },
           { code: 'ELC-003', brand: 'Omni', name: 'Convenience Outlet', color: 'White', size: '', category: 'Electrical & Lighting', price: 65, stock: 60, status: 'In Stock' },
           
           // Plumbing Materials
           { code: 'PLB-001', brand: '', name: 'PVC Elbow', color: '', size: '1/2 inches', category: 'Plumbing Materials', price: 12, stock: 300, status: 'In Stock' },
           { code: 'PLB-002', brand: '', name: 'Gate Valve', color: '', size: '1/2 inches', category: 'Plumbing Materials', price: 180, stock: 25, status: 'In Stock' },
           
           // Adhesives & Tapes
           { code: 'ADH-001', brand: 'Pioneer', name: 'Epoxy', color: 'Clear', size: '25 mL', category: 'Adhesives & Tapes', price: 45, stock: 90, status: 'In Stock' },
           { code: 'ADH-002', name: 'Masking Tape', brand: '', color: 'Beige', size: '1 inches', category: 'Adhesives & Tapes', price: 35, stock: 120, status: 'In Stock' },

           // Construction Tools
           { code: 'CTL-001', brand: 'Stanley', name: 'Claw Hammer', color: '', size: '16 oz', category: 'Construction Tools', price: 380, stock: 15, status: 'In Stock' },
           { code: 'CTL-002', brand: 'DeWalt', name: 'Tape Measure', color: 'Yellow', size: '5 m', category: 'Construction Tools', price: 450, stock: 10, status: 'In Stock' },
           
           // Padlocks
           { code: 'PDL-001', brand: 'Yale', name: 'Padlock', color: 'Silver', size: '50 mm', category: 'Padlocks', price: 350, stock: 20, status: 'In Stock' },
           
           // Door Locksets
           { code: 'DLK-001', brand: 'Yale', name: 'Entrance Lockset', color: 'Satin Nickel', size: '', category: 'Door Locksets', price: 850, stock: 8, status: 'In Stock' },
           
           // Galvanized Wires
           { code: 'GW-001', brand: '', name: 'GI Tie Wire', color: '', size: 'Gauge 16 x 1 kg', category: 'Galvanized Wires', price: 70, stock: 65, status: 'In Stock' },
        ];
     });

     useEffect(() => {
        let isMounted = true;

        const loadRemoteInventory = async () => {
            const token = getAuthToken();
            if (!token) {
                return;
            }

            try {
                const remoteProducts = await listProductsApi();
                if (isMounted && remoteProducts.length > 0) {
                    setInventory(remoteProducts);
                }
            } catch {
                // keep existing local inventory when backend is unavailable
            }
        };

        loadRemoteInventory();

        return () => {
            isMounted = false;
        };
     }, []);
   
     // Persist Inventory Changes
     useEffect(() => {
       localStorage.setItem('inventoryDiff', JSON.stringify(inventory));
     }, [inventory]);

     // 2. Transactions State
     const [transactions, setTransactions] = useState(() => {
       try {
           const savedTrx = localStorage.getItem('transactions');
           return savedTrx ? JSON.parse(savedTrx) : [];
       } catch (error) {
           console.error("Failed to parse transactions:", error);
           return [];
       }
     });
   
     // Persist Transactions
     useEffect(() => {
       localStorage.setItem('transactions', JSON.stringify(transactions));
     }, [transactions]);
     
     // 3. Inventory Logs State
     const [inventoryLogs, setInventoryLogs] = useState(() => {
       try {
           const savedLogs = localStorage.getItem('inventoryLogs');
           return savedLogs ? JSON.parse(savedLogs) : [];
       } catch (error) {
           console.error("Failed to parse inventory logs:", error);
           return [];
       }
     });
   
     // Persist Logs
     useEffect(() => {
       localStorage.setItem('inventoryLogs', JSON.stringify(inventoryLogs));
     }, [inventoryLogs]);

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

     // 4. Activity Logs (Login/System Access + All Actions)
     const [activityLogs, setActivityLogs] = useState(() => {
       try {
           const saved = localStorage.getItem('activityLogs');
           if (saved) return JSON.parse(saved);
       } catch (error) {
           console.error("Failed to parse activity logs:", error);
       }
       return [
          { id: 1, user: 'Admin User', action: 'Logged In', timestamp: Date.now() - 1000 * 60 * 60 * 2 }, 
          { id: 2, user: 'Admin User', action: 'Logged In', timestamp: Date.now() - 1000 * 60 * 60 * 24 }, 
          { id: 3, user: 'Admin User', action: 'Logged Out', timestamp: Date.now() - 1000 * 60 * 60 * 25 }, 
          { id: 4, user: 'Admin User', action: 'Logged In', timestamp: Date.now() - 1000 * 60 * 60 * 26 },
       ];
     });

     // Persist Activity Logs
     useEffect(() => {
       localStorage.setItem('activityLogs', JSON.stringify(activityLogs));
     }, [activityLogs]);

     // Activity Log Helper (used across pages)
     const logActivity = (user, action, details = '') => {
       setActivityLogs(prev => [{ id: Date.now(), user, action, details, timestamp: Date.now() }, ...prev]);
     };

    // 5. Log Action Helper
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
            syncQueue,
            addToSyncQueue,
            isOnline
        }}>
            {children}
        </InventoryContext.Provider>
    );
};
