import React, { createContext, useState, useEffect, useMemo, useContext, useRef, useCallback } from 'react';
import { getStockStatus } from '../utils/recommendationLogic';
import { showToast } from '../utils/toastHelper';
import { useAuth } from './AuthContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import {
    addOfflineTransactionToQueue,
    canAutoSyncOfflineTransactions,
    getOfflineSyncQueueKey,
    isOfflineSyncSessionActive,
    migrateLegacyOfflineSyncQueue,
    readOfflineSyncQueue,
    removeSyncedOfflineTransaction,
    retainFailedOfflineTransaction,
    syncNextOfflineTransaction,
    reconcileSyncedSale,
} from '../utils/offlineTransactionSync';
import {
    listProductsApi,
    listProductImagesApi,
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
    categoriesError: null,
    transactions: [],
    setTransactions: () => {},
    inventoryLogs: [],
    setInventoryLogs: () => {},
    activityLogs: [],
    setActivityLogs: () => {},
    logActivity: () => {},
    processedInventory: [],
    ensureInventoryImages: async () => new Map(),
    productImageRevisions: {},
    logAction: () => {},
    handleResetHistory: () => {},
    renameUserReferences: () => {},
    syncUserIdentityReferences: () => {},
    removeUserReferences: () => {},
    syncQueue: [],
    addToSyncQueue: () => {},
    isOnline: true,
    isInventoryLoading: false,
    inventoryLoadError: null,
    retryInventory: () => {},
    isCategoriesLoading: false,
    isTransactionsLoading: false,
    transactionsError: '',
    retryTransactions: () => {},
    isInventoryLogsLoading: false,
    inventoryLogsError: null,
    retryInventoryLogs: () => {},
    ensureInventoryLogs: async () => false,
    isActivityLogsLoading: false,
    activityLogsError: null,
    retryActivityLogs: () => {},
    ensureActivityLogs: async () => false,
    isPageDataLoading: false,
};

const InventoryContext = createContext(INVENTORY_FALLBACK);

const TRANSACTIONS_CACHE_PREFIX = 'transactionsCache:';
const PRODUCT_IMAGE_BATCH_SIZE = 12;

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

const mergeCachedProductImages = (products, previousProducts, imageCache) => {
    const previousByIdentity = new Map();
    for (const product of Array.isArray(previousProducts) ? previousProducts : []) {
        const imageUrl = String(product?.imageUrl || '');
        if (!imageUrl) continue;
        if (product.id) previousByIdentity.set(`id:${product.id}`, imageUrl);
        if (product.code) previousByIdentity.set(`sku:${product.code}`, imageUrl);
    }

    return (Array.isArray(products) ? products : []).map((product) => {
        const idKey = product.id ? `id:${product.id}` : '';
        const skuKey = product.code ? `sku:${product.code}` : '';
        const imageUrl = String(product.imageUrl || '')
            || imageCache.current.get(idKey)
            || imageCache.current.get(skuKey)
            || previousByIdentity.get(idKey)
            || previousByIdentity.get(skuKey)
            || '';
        return imageUrl === product.imageUrl ? product : { ...product, imageUrl };
    });
};

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

// The hook is intentionally colocated with its provider so consumers share one context contract.
// eslint-disable-next-line react-refresh/only-export-components
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
    const syncQueueKey = getOfflineSyncQueueKey(currentAuthUserId);

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
    const [inventoryLoadError, setInventoryLoadError] = useState(null);
    const [inventoryRetryVersion, setInventoryRetryVersion] = useState(0);
    const retryInventory = () => {
        setIsInventoryLoading(true);
        setInventoryLoadError(null);
        setInventoryRetryVersion((version) => version + 1);
    };
    const inventoryRef = useRef([]);
    const inventoryRequestSequenceRef = useRef(0);
    const productImagesByIdentityRef = useRef(new Map());
    const productImagesLoadedRef = useRef(new Set());
    const productImagesRequestedRef = useRef(false);
    const productImagesInFlightRef = useRef(new Map());
    const productImagesResolversRef = useRef(new Map());
    const productImagesForceRefreshPromisesRef = useRef(new Map());
    const productImagesQueueRef = useRef(new Set());
    const productImagesFlushTimerRef = useRef(null);
    const productImagesRequestSequenceRef = useRef(0);
    const [productImageRevisions, setProductImageRevisions] = useState({});
    const productImagesSessionKey = `${currentAuthUserId || ''}:${currentAuthUsername || ''}`;
    const productImagesSessionKeyRef = useRef(productImagesSessionKey);
    const transactionsRequestSequenceRef = useRef(0);
    const activityLogsRequestSequenceRef = useRef(0);
    const inventoryLogsRequestSequenceRef = useRef(0);
    const activityLogsRequestedRef = useRef(false);
    const inventoryLogsRequestedRef = useRef(false);
    const logRequestSessionKey = `${currentAuthUserId || ''}:${currentAuthUsername || ''}:${userRole || ''}:${Boolean(getAuthToken())}`;
    const logRequestSessionKeyRef = useRef(logRequestSessionKey);

    useEffect(() => {
        if (logRequestSessionKeyRef.current === logRequestSessionKey) return;
        logRequestSessionKeyRef.current = logRequestSessionKey;
        activityLogsRequestedRef.current = false;
        inventoryLogsRequestedRef.current = false;
        activityLogsRequestSequenceRef.current += 1;
        inventoryLogsRequestSequenceRef.current += 1;
        setActivityLogs([]);
        setActivityLogsError(null);
        setIsActivityLogsLoading(false);
        setInventoryLogs([]);
        setInventoryLogsError(null);
        setIsInventoryLogsLoading(false);
    }, [logRequestSessionKey]);

    useEffect(() => {
        inventoryRef.current = inventory;
    }, [inventory]);

    useEffect(() => {
        if (productImagesSessionKeyRef.current === productImagesSessionKey) return;
        productImagesSessionKeyRef.current = productImagesSessionKey;
        productImagesRequestSequenceRef.current += 1;
        if (productImagesFlushTimerRef.current) clearTimeout(productImagesFlushTimerRef.current);
        productImagesFlushTimerRef.current = null;
        productImagesResolversRef.current.forEach((resolve) => resolve(''));
        productImagesLoadedRef.current.clear();
        productImagesRequestedRef.current = false;
        productImagesInFlightRef.current.clear();
        productImagesResolversRef.current.clear();
        productImagesForceRefreshPromisesRef.current.clear();
        productImagesQueueRef.current.clear();
        productImagesByIdentityRef.current.clear();
        setProductImageRevisions({});
    }, [productImagesSessionKey]);

    const flushProductImageQueue = useCallback(async () => {
        if (productImagesFlushTimerRef.current) clearTimeout(productImagesFlushTimerRef.current);
        productImagesFlushTimerRef.current = null;
        const ids = [...productImagesQueueRef.current].slice(0, PRODUCT_IMAGE_BATCH_SIZE);
        ids.forEach((id) => productImagesQueueRef.current.delete(id));
        if (!ids.length) return;

        const requestSequence = productImagesRequestSequenceRef.current;
        const sessionKey = productImagesSessionKeyRef.current;
        const requestsById = new Map(ids.map((id) => [id, productImagesInFlightRef.current.get(id)]));
        try {
            const rows = await listProductImagesApi(ids);
            if (requestSequence !== productImagesRequestSequenceRef.current
                || sessionKey !== productImagesSessionKeyRef.current) return;

            const rowsById = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row?.id || ''), row]));
            const codesById = new Map();
            setInventory((previous) => previous.map((product) => {
                const id = String(product.id || '');
                if (!ids.includes(id)) return product;
                const row = rowsById.get(id);
                const imageUrl = String(row?.imageUrl || '');
                const code = String(row?.code || product.code || '');
                codesById.set(id, code);
                productImagesByIdentityRef.current.set(`id:${id}`, imageUrl);
                if (code) productImagesByIdentityRef.current.set(`sku:${code}`, imageUrl);
                return imageUrl === product.imageUrl ? product : { ...product, imageUrl };
            }));

            ids.forEach((id) => {
                const row = rowsById.get(id);
                const imageUrl = String(row?.imageUrl || '');
                productImagesByIdentityRef.current.set(`id:${id}`, imageUrl);
                const code = String(row?.code || codesById.get(id) || '');
                if (code) productImagesByIdentityRef.current.set(`sku:${code}`, imageUrl);
                productImagesLoadedRef.current.add(id);
                productImagesResolversRef.current.get(id)?.(imageUrl);
            });
        } catch {
            if (requestSequence === productImagesRequestSequenceRef.current
                && sessionKey === productImagesSessionKeyRef.current) {
                ids.forEach((id) => productImagesResolversRef.current.get(id)?.(''));
            }
        } finally {
            if (requestSequence === productImagesRequestSequenceRef.current
                && sessionKey === productImagesSessionKeyRef.current) {
                ids.forEach((id) => {
                    if (productImagesInFlightRef.current.get(id) !== requestsById.get(id)) return;
                    productImagesInFlightRef.current.delete(id);
                    productImagesResolversRef.current.delete(id);
                });
                if (productImagesQueueRef.current.size && !productImagesFlushTimerRef.current) {
                    productImagesFlushTimerRef.current = setTimeout(() => { void flushProductImageQueue(); }, 0);
                }
            }
        }
    }, []);

    const ensureInventoryImages = useCallback(({ productIds = [], force = false } = {}) => {
        const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
            .map((id) => String(id || '').trim())
            .filter((id) => /^[a-f\d]{24}$/i.test(id)))];
        if (!ids.length) return Promise.resolve(new Map());
        productImagesRequestedRef.current = true;

        const imagePromises = ids.map((id) => {
            const activeRequest = productImagesInFlightRef.current.get(id);
            if (force && activeRequest) {
                const pendingRefresh = productImagesForceRefreshPromisesRef.current.get(id);
                if (pendingRefresh) return pendingRefresh;
                const requestSequence = productImagesRequestSequenceRef.current;
                const sessionKey = productImagesSessionKeyRef.current;
                const refreshPromise = activeRequest.then(async () => {
                    if (productImagesForceRefreshPromisesRef.current.get(id) === refreshPromise) {
                        productImagesForceRefreshPromisesRef.current.delete(id);
                    }
                    if (requestSequence !== productImagesRequestSequenceRef.current
                        || sessionKey !== productImagesSessionKeyRef.current) return '';
                    const refreshed = await ensureInventoryImages({ productIds: [id], force: true });
                    return refreshed.get(id) || '';
                });
                productImagesForceRefreshPromisesRef.current.set(id, refreshPromise);
                return refreshPromise;
            }

            if (force) {
                productImagesLoadedRef.current.delete(id);
                productImagesByIdentityRef.current.delete(`id:${id}`);
                const product = inventoryRef.current.find((entry) => String(entry.id || '') === id);
                if (product?.code) productImagesByIdentityRef.current.delete(`sku:${product.code}`);
                setProductImageRevisions((previous) => ({ ...previous, [id]: Number(previous[id] || 0) + 1 }));
                setInventory((previous) => previous.map((entry) => (
                    String(entry.id || '') === id && entry.imageUrl ? { ...entry, imageUrl: '' } : entry
                )));
            } else if (productImagesLoadedRef.current.has(id)) {
                return Promise.resolve(String(productImagesByIdentityRef.current.get(`id:${id}`) || ''));
            }

            const existingRequest = productImagesInFlightRef.current.get(id);
            if (existingRequest) return existingRequest;

            let resolveImage;
            const request = new Promise((resolve) => { resolveImage = resolve; });
            productImagesInFlightRef.current.set(id, request);
            productImagesResolversRef.current.set(id, resolveImage);
            productImagesQueueRef.current.add(id);
            return request;
        });

        if (productImagesQueueRef.current.size && !productImagesFlushTimerRef.current) {
            productImagesFlushTimerRef.current = setTimeout(() => { void flushProductImageQueue(); }, 0);
        }

        return Promise.all(imagePromises).then((imageUrls) => new Map(ids.map((id, index) => [id, imageUrls[index] || ''])));
    }, [flushProductImageQueue]);

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
                setInventoryLoadError(null);
            }

            const requestSequence = ++inventoryRequestSequenceRef.current;
            try {
                const remoteProducts = await listProductsApi({ includeImages: false });
                if (isMounted && requestSequence === inventoryRequestSequenceRef.current && Array.isArray(remoteProducts)) {
                    setInventory((previous) => mergeCachedProductImages(remoteProducts, previous, productImagesByIdentityRef));
                    setInventoryLoadError(null);
                }
            } catch (error) {
                // Keep the latest in-memory inventory when backend is unavailable.
                if (isMounted && requestSequence === inventoryRequestSequenceRef.current && inventoryRef.current.length === 0) setInventoryLoadError(error);
            } finally {
                if (isMounted && requestSequence === inventoryRequestSequenceRef.current) {
                    setIsInventoryLoading(false);
                }
            }
        };

        loadRemoteInventory();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername, inventoryRetryVersion]);

     // Categories State
    const [categories, setCategories] = useState([]);
    const [isCategoriesLoading, setIsCategoriesLoading] = useState(true);
    const [categoriesError, setCategoriesError] = useState(null);
    const categoriesRequestSequenceRef = useRef(0);
    const categoriesRefreshTimerRef = useRef(null);

    const fetchCategories = useCallback(async () => {
        const token = getAuthToken();
        if (!token) return;
        const requestSequence = ++categoriesRequestSequenceRef.current;
        setIsCategoriesLoading(true);
        setCategoriesError(null);
        try {
            const remoteCategories = await listCategoriesApi();
            if (requestSequence === categoriesRequestSequenceRef.current) {
                setCategories(Array.isArray(remoteCategories) ? remoteCategories : []);
                setCategoriesError(null);
            }
        } catch (error) {
            console.error("Failed to fetch categories:", error);
            if (requestSequence === categoriesRequestSequenceRef.current) setCategoriesError(error);
        } finally {
            if (requestSequence === categoriesRequestSequenceRef.current) setIsCategoriesLoading(false);
        }
    }, []);

     useEffect(() => {
        let isMounted = true;
        const scheduleRefresh = () => {
            window.clearTimeout(categoriesRefreshTimerRef.current);
            categoriesRefreshTimerRef.current = window.setTimeout(() => {
                if (isMounted) void fetchCategories();
            }, 100);
        };
        const onCategoriesUpdated = (event) => {
            let payload = {};
            try { payload = JSON.parse(event?.data || '{}'); } catch { /* Ignore malformed event data. */ }
            if (['category.archived', 'category.deleted', 'category.renamed'].includes(payload.reason)) {
                const affectedName = payload.previousName || payload.name || 'A category';
                showToast('Category Updated', `${affectedName} is no longer available for new selections. Review any open category filters or forms.`, 'warning', `category-unavailable-${payload.categoryId || payload.reason}`);
            }
            if (payload.reason === 'category.renamed') {
                setInventoryLoadError(null);
                setIsInventoryLoading(true);
                setInventoryRetryVersion((version) => version + 1);
            }
            scheduleRefresh();
        };

        void fetchCategories();
        const unsubscribeCategories = subscribeRealtimeEvent('categories.updated', onCategoriesUpdated);
        const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', scheduleRefresh);

        return () => {
            isMounted = false;
            window.clearTimeout(categoriesRefreshTimerRef.current);
            categoriesRequestSequenceRef.current += 1;
            unsubscribeCategories();
            unsubscribeResync();
        };
    }, [userRole, currentAuthUsername, fetchCategories]);

     // 2. Transactions State (backend-first)
    const [transactions, setTransactions] = useState([]);
    const [transactionsCacheOwner, setTransactionsCacheOwner] = useState('');
    const [isTransactionsLoading, setIsTransactionsLoading] = useState(true);
    const [transactionsError, setTransactionsError] = useState('');
    const [transactionsRetryVersion, setTransactionsRetryVersion] = useState(0);

    const retryTransactions = () => {
        setIsTransactionsLoading(true);
        setTransactionsError('');
        setTransactionsRetryVersion((version) => version + 1);
    };

     useEffect(() => {
        let isMounted = true;

        const loadRemoteTransactions = async () => {
            const token = getAuthToken();
            if (!token || !transactionsCacheScope) {
                if (isMounted) {
                    setTransactions([]);
                    setTransactionsCacheOwner('');
                    setIsTransactionsLoading(false);
                    setTransactionsError('');
                }
                return;
            }

            if (isMounted) {
                // Clear the prior account's in-memory data before exposing this
                // account's cache or authoritative API result.
                setTransactions([]);
                setTransactionsCacheOwner('');
                setIsTransactionsLoading(true);
                setTransactionsError('');
                const cachedTransactions = readTransactionsCache(transactionsCacheScope);
                setTransactions(cachedTransactions);
                setTransactionsCacheOwner(transactionsCacheScope);
            }

            const requestSequence = ++transactionsRequestSequenceRef.current;
            try {
                const remoteTransactions = await listSalesHistoryViewApi(true);
                if (!Array.isArray(remoteTransactions)) {
                    throw new Error('Sales history response is invalid.');
                }
                if (isMounted && requestSequence === transactionsRequestSequenceRef.current) {
                    setTransactions(remoteTransactions);
                    setTransactionsCacheOwner(transactionsCacheScope);
                    setTransactionsError('');
                }
            } catch {
                // Keep last known cached values when history API is temporarily unavailable.
                if (isMounted && requestSequence === transactionsRequestSequenceRef.current) {
                    const cachedTransactions = readTransactionsCache(transactionsCacheScope);
                    setTransactions(cachedTransactions);
                    setTransactionsCacheOwner(transactionsCacheScope);
                    setTransactionsError(cachedTransactions.length
                        ? 'Sales transaction records could not be refreshed; showing saved data.'
                        : 'Sales transaction records could not be loaded.');
                }
            } finally {
                if (isMounted && requestSequence === transactionsRequestSequenceRef.current) {
                    setIsTransactionsLoading(false);
                }
            }
        };

        loadRemoteTransactions();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername, currentAuthUserId, transactionsCacheScope, transactionsRetryVersion]);

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
        let transactionRefreshPending = false;
        let isInventoryRefreshInFlight = false;
        let inventoryRefreshPending = false;
        let isActivityLogsRefreshInFlight = false;
        let isInventoryLogsRefreshInFlight = false;
        let activityLogsRefreshPending = false;
        let inventoryLogsRefreshPending = false;

        const shouldShowStockAlerts = () => {
            return userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN || userRole === ROLES.CASHIER;
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
            if (disposed) return;
            if (isRefreshInFlight) {
                transactionRefreshPending = true;
                return;
            }

            isRefreshInFlight = true;
            const requestSequence = ++transactionsRequestSequenceRef.current;
            try {
                const remoteTransactions = await listSalesHistoryViewApi(true);
                if (!disposed && requestSequence === transactionsRequestSequenceRef.current && Array.isArray(remoteTransactions)) {
                    setTransactions(remoteTransactions);
                    setTransactionsCacheOwner(transactionsCacheScope);
                }
            } catch {
                // Ignore transient failures; reconnection/fallback handles eventual consistency.
            } finally {
                isRefreshInFlight = false;
                if (!disposed && requestSequence === transactionsRequestSequenceRef.current) setIsTransactionsLoading(false);
                if (transactionRefreshPending && !disposed) {
                    transactionRefreshPending = false;
                    void refreshTransactions();
                }
            }
        };

        const onSaleCreated = () => {
            void refreshTransactions();
        };

        const refreshInventory = async ({ notifyTransitions = false } = {}) => {
            if (disposed) return;
            if (isInventoryRefreshInFlight) {
                inventoryRefreshPending = true;
                return;
            }

            isInventoryRefreshInFlight = true;
            const requestSequence = ++inventoryRequestSequenceRef.current;

            try {
                const previousInventory = inventoryRef.current;
                const remoteProducts = await listProductsApi({ includeImages: false });
                if (!disposed && requestSequence === inventoryRequestSequenceRef.current && Array.isArray(remoteProducts)) {
                    const nextInventory = mergeCachedProductImages(remoteProducts, previousInventory, productImagesByIdentityRef);
                    setInventory(nextInventory);
                    setInventoryLoadError(null);
                    if (notifyTransitions) {
                        showStockTransitionAlerts(previousInventory, nextInventory);
                    }
                }
            } catch (error) {
                // Ignore transient failures; client will retry on next realtime event.
                if (requestSequence === inventoryRequestSequenceRef.current && inventoryRef.current.length === 0) setInventoryLoadError(error);
            } finally {
                isInventoryRefreshInFlight = false;
                if (!disposed && requestSequence === inventoryRequestSequenceRef.current) setIsInventoryLoading(false);
                if (inventoryRefreshPending && !disposed) {
                    inventoryRefreshPending = false;
                    void refreshInventory({ notifyTransitions });
                }
            }
        };

        const onInventoryUpdated = (event) => {
            void refreshInventory({ notifyTransitions: true });
            let payload = {};
            try { payload = JSON.parse(event?.data || '{}'); } catch { /* Ignore malformed event data. */ }
            if (productImagesRequestedRef.current && payload.reason === 'product.updated' && payload.imageChanged === true) {
                const changedCodes = new Set((Array.isArray(payload.productCodes) ? payload.productCodes : []).map((code) => String(code || '')));
                const changedIds = new Set((Array.isArray(payload.productIds) ? payload.productIds : []).map((id) => String(id || '')));
                inventoryRef.current
                    .filter((product) => changedCodes.has(String(product.code || '')))
                    .forEach((product) => changedIds.add(String(product.id || '')));
                if (changedIds.size) void ensureInventoryImages({ productIds: [...changedIds], force: true });
            }
        };

        const refreshActivityLogs = async () => {
            if (disposed || !activityLogsRequestedRef.current) return;
            if (isActivityLogsRefreshInFlight) {
                activityLogsRefreshPending = true;
                return;
            }

            isActivityLogsRefreshInFlight = true;
            const requestSequence = ++activityLogsRequestSequenceRef.current;
            try {
                const remoteLogs = await listActivityLogsApi(200);
                if (!disposed && requestSequence === activityLogsRequestSequenceRef.current && Array.isArray(remoteLogs)) {
                    setActivityLogs(remoteLogs);
                    setActivityLogsError(null);
                }
            } catch {
                // Ignore transient failures for realtime log refresh.
            } finally {
                isActivityLogsRefreshInFlight = false;
                if (!disposed && requestSequence === activityLogsRequestSequenceRef.current) setIsActivityLogsLoading(false);
                if (activityLogsRefreshPending && !disposed) {
                    activityLogsRefreshPending = false;
                    void refreshActivityLogs();
                }
            }
        };

        const refreshInventoryLogs = async () => {
            if (disposed || !inventoryLogsRequestedRef.current) return;
            if (isInventoryLogsRefreshInFlight) {
                inventoryLogsRefreshPending = true;
                return;
            }

            isInventoryLogsRefreshInFlight = true;
            const requestSequence = ++inventoryLogsRequestSequenceRef.current;
            try {
                const remoteLogs = await listInventoryLogsApi(200);
                if (!disposed && requestSequence === inventoryLogsRequestSequenceRef.current && Array.isArray(remoteLogs)) {
                    setInventoryLogs(remoteLogs);
                    setInventoryLogsError(null);
                }
            } catch {
                // Ignore transient failures for realtime log refresh.
            } finally {
                isInventoryLogsRefreshInFlight = false;
                if (!disposed && requestSequence === inventoryLogsRequestSequenceRef.current) setIsInventoryLogsLoading(false);
                if (inventoryLogsRefreshPending && !disposed) {
                    inventoryLogsRefreshPending = false;
                    void refreshInventoryLogs();
                }
            }
        };

        const onActivityLogged = () => {
            void refreshActivityLogs();
        };

        const onInventoryLogged = () => {
            void refreshInventoryLogs();
        };

        const refreshSaleRelatedState = () => {
            void refreshTransactions();
            void refreshInventory();
            if (activityLogsRequestedRef.current) void refreshActivityLogs();
            if (inventoryLogsRequestedRef.current) void refreshInventoryLogs();
        };

        const unsubscribeSaleCreated = subscribeRealtimeEvent('sale.created', onSaleCreated);
        const unsubscribeSaleUpdated = subscribeRealtimeEvent('sale.updated', refreshSaleRelatedState);
        const unsubscribeRealtimeResync = subscribeRealtimeEvent('realtime.resync', refreshSaleRelatedState);
        const unsubscribeInventoryUpdated = subscribeRealtimeEvent('inventory.updated', onInventoryUpdated);
        const unsubscribeActivityLogged = subscribeRealtimeEvent('activity.logged', onActivityLogged);
        const unsubscribeInventoryLogged = subscribeRealtimeEvent('inventory.logged', onInventoryLogged);

        return () => {
            disposed = true;
            unsubscribeSaleCreated();
            unsubscribeSaleUpdated();
            unsubscribeRealtimeResync();
            unsubscribeInventoryUpdated();
            unsubscribeActivityLogged();
            unsubscribeInventoryLogged();
        };
    }, [appSettings, userRole, currentAuthUsername, currentAuthUserId, transactionsCacheScope, ROLES, ensureInventoryImages]);
     
     // 3. Inventory Logs State (backend-first)
     const [inventoryLogs, setInventoryLogs] = useState([]);
    const [isInventoryLogsLoading, setIsInventoryLogsLoading] = useState(false);
    const [inventoryLogsError, setInventoryLogsError] = useState(null);
    const [inventoryLogsRetryVersion, setInventoryLogsRetryVersion] = useState(0);
    const retryInventoryLogs = () => {
        inventoryLogsRequestedRef.current = true;
        setIsInventoryLogsLoading(true);
        setInventoryLogsError(null);
        setInventoryLogsRetryVersion((version) => version + 1);
    };
    const ensureInventoryLogs = useCallback(() => {
        if (inventoryLogsRequestedRef.current) return;
        inventoryLogsRequestedRef.current = true;
        setIsInventoryLogsLoading(true);
        setInventoryLogsError(null);
        setInventoryLogsRetryVersion((version) => version + 1);
    }, []);

     useEffect(() => {
        if (!inventoryLogsRequestedRef.current) return undefined;
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
                setInventoryLogsError(null);
            }

            const requestSequence = ++inventoryLogsRequestSequenceRef.current;
            try {
                const remoteLogs = await listInventoryLogsApi(200);
                if (isMounted && requestSequence === inventoryLogsRequestSequenceRef.current && Array.isArray(remoteLogs)) {
                    setInventoryLogs(remoteLogs);
                    setInventoryLogsError(null);
                }
            } catch (error) {
                // Non-admin users may not have access to log endpoints.
                if (isMounted && requestSequence === inventoryLogsRequestSequenceRef.current) setInventoryLogsError(error);
            } finally {
                if (isMounted && requestSequence === inventoryLogsRequestSequenceRef.current) {
                    setIsInventoryLogsLoading(false);
                }
            }
        };

        loadRemoteInventoryLogs();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername, logRequestSessionKey, inventoryLogsRetryVersion]);

     // 3.1 Sync Queue State (Offline Config)
     const [syncQueue, setSyncQueue] = useState([]);
     const [activeSyncQueueKey, setActiveSyncQueueKey] = useState('');
     const syncInFlightRef = useRef(false);
     const currentSyncQueueKeyRef = useRef(syncQueueKey);
     currentSyncQueueKeyRef.current = syncQueueKey;
     // Never expose a previously loaded account's queue during the render that
     // follows logout or an account switch.
     const currentUserSyncQueue = useMemo(
        () => (activeSyncQueueKey === syncQueueKey ? syncQueue : []),
        [activeSyncQueueKey, syncQueue, syncQueueKey],
     );

     // The old browser-global queue had no reliable account owner. Preserve it in
     // quarantine rather than assigning it to whichever user next logs in.
     useEffect(() => {
        migrateLegacyOfflineSyncQueue(localStorage);
     }, []);

     // Only the authenticated owner's queue is ever loaded into application state.
     // Changing or clearing the authenticated account therefore hides the previous
     // user's pending transactions without deleting them.
     useEffect(() => {
        setActiveSyncQueueKey(syncQueueKey);
        setSyncQueue(syncQueueKey ? readOfflineSyncQueue(localStorage, currentAuthUserId) : []);
     }, [syncQueueKey, currentAuthUserId]);

     // Persist Sync Queue
     useEffect(() => {
        if (activeSyncQueueKey && activeSyncQueueKey === syncQueueKey) {
            localStorage.setItem(activeSyncQueueKey, JSON.stringify(syncQueue));
        }
     }, [activeSyncQueueKey, syncQueue, syncQueueKey]);

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
            const hasAuth = Boolean(getAuthToken() && currentAuthUserId);
            if (syncInFlightRef.current || !canAutoSyncOfflineTransactions({
                queue: currentUserSyncQueue,
                online: navigator.onLine,
                autoSync: appSettings?.autoSync,
                hasAuth,
            })) return;

            syncInFlightRef.current = true;
            const queueItem = currentUserSyncQueue[0];
            try {
                console.log("Attempting to sync transaction:", queueItem.id);
                const result = await syncNextOfflineTransaction({
                    queue: currentUserSyncQueue,
                    online: navigator.onLine,
                    autoSync: appSettings?.autoSync,
                    hasAuth,
                    ownerUserId: currentAuthUserId,
                    createSale: createSaleApi,
                });

                // The request may complete after logout or an account switch. Do
                // not let its result mutate or notify the new session.
                if (!isOfflineSyncSessionActive({
                    expectedQueueKey: syncQueueKey,
                    currentQueueKey: currentSyncQueueKeyRef.current,
                    hasAuth: Boolean(getAuthToken()),
                })) {
                    return;
                }

                if (result.status === 'synced') {
                    setTransactions((previous) => reconcileSyncedSale(previous, result.transaction, result.sale));
                    setSyncQueue((previous) => removeSyncedOfflineTransaction(previous, queueItem));
                
                    // The queued sale is already accepted. A follow-up refresh failure
                    // must not restore/retry that successfully synchronized sale.
                    try {
                        const remoteProducts = await listProductsApi({ includeImages: false });
                        if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
                            setInventory((previous) => mergeCachedProductImages(remoteProducts, previous, productImagesByIdentityRef));
                        }
                    } catch (refreshError) {
                        console.warn('Offline sale synchronized, but inventory refresh failed:', refreshError);
                    }

                    console.log("Sync successful for:", queueItem.id);
                    showToast('Offline Sale Synced', `Transaction ${queueItem.id} synchronized successfully.`, 'success', `offline-sync-success-${queueItem.id}`);
                    return;
                }

                if (result.status === 'failed') {
                    const status = Number(result.error?.status || 0);
                    const connectionFailed = isApiConnectionFailure(result.error);

                    console.error("Sync failed for transaction:", queueItem.id, result.error);

                    // Preserve the original sale and request identity for retry/recovery.
                    // Rotate a failed item behind later entries so one rejection does not
                    // permanently block the rest of the offline queue.
                    setSyncQueue((previous) => retainFailedOfflineTransaction(previous, queueItem, result.error));

                    showToast(
                        'Offline Sale Pending',
                        connectionFailed
                            ? `Transaction ${queueItem.id} remains queued until the backend is reachable.`
                            : `Transaction ${queueItem.id} was not accepted (${status || 'unknown error'}) and remains queued for recovery.`,
                        'warning',
                        `offline-sync-${queueItem.id}`
                    );
                }
            } finally {
                syncInFlightRef.current = false;
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
     }, [currentUserSyncQueue, appSettings, currentAuthUserId, syncQueueKey]);

     const addToSyncQueue = (transaction) => {
        if (!currentAuthUserId || !syncQueueKey) {
            showToast('Offline Sale Pending', 'Your authenticated account could not be identified, so this sale was not added to the sync queue.', 'warning', 'offline-sync-owner-missing');
            return false;
        }

        setSyncQueue((previous) => addOfflineTransactionToQueue(previous, transaction, currentAuthUserId));
        return true;
     };

     // 4. Activity Logs (backend-first)
     const [activityLogs, setActivityLogs] = useState([]);
    const [isActivityLogsLoading, setIsActivityLogsLoading] = useState(false);
    const [activityLogsError, setActivityLogsError] = useState(null);
    const [activityLogsRetryVersion, setActivityLogsRetryVersion] = useState(0);
    const retryActivityLogs = () => {
        activityLogsRequestedRef.current = true;
        setIsActivityLogsLoading(true);
        setActivityLogsError(null);
        setActivityLogsRetryVersion((version) => version + 1);
    };
    const ensureActivityLogs = useCallback(() => {
        if (activityLogsRequestedRef.current) return;
        activityLogsRequestedRef.current = true;
        setIsActivityLogsLoading(true);
        setActivityLogsError(null);
        setActivityLogsRetryVersion((version) => version + 1);
    }, []);

     useEffect(() => {
        if (!activityLogsRequestedRef.current) return undefined;
        let isMounted = true;

        const loadRemoteActivityLogs = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) {
                    setIsActivityLogsLoading(false);
                    setActivityLogsError(null);
                }
                return;
            }

            if (isMounted) {
                setIsActivityLogsLoading(true);
                setActivityLogsError(null);
            }

            const requestSequence = ++activityLogsRequestSequenceRef.current;
            try {
                const remoteLogs = await listActivityLogsApi(200);
                if (isMounted && requestSequence === activityLogsRequestSequenceRef.current && Array.isArray(remoteLogs)) {
                    setActivityLogs(remoteLogs);
                    setActivityLogsError(null);
                }
            } catch (error) {
                // Preserve any already loaded rows and expose a retry state when none are available.
                if (isMounted && requestSequence === activityLogsRequestSequenceRef.current) setActivityLogsError(error);
            } finally {
                if (isMounted && requestSequence === activityLogsRequestSequenceRef.current) {
                    setIsActivityLogsLoading(false);
                }
            }
        };

        loadRemoteActivityLogs();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUsername, logRequestSessionKey, activityLogsRetryVersion]);

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
       const actorName = String(user || currentUserName || 'System').trim() || 'System';
       const actorId = String(currentAuthUserId || '').trim();
       const actorReference = actorId
           ? {
               id: actorId,
               displayName: actorName,
               username: String(currentAuthUsername || '').trim(),
               role: String(userRole || '').trim(),
           }
           : null;

       setActivityLogs(prev => [{
           id: Date.now(),
           user: actorName,
           userRef: actorReference,
           action,
           details,
           timestamp: Date.now(),
       }, ...prev]);
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
            ensureInventoryImages,
            productImageRevisions,
            logAction,
            handleResetHistory,
            categories,
            setCategories,
            fetchCategories,
            categoriesError,
            renameUserReferences,
            syncUserIdentityReferences,
            removeUserReferences,
            syncQueue: currentUserSyncQueue,
            addToSyncQueue,
            isOnline,
            isInventoryLoading,
            inventoryLoadError,
            retryInventory,
            isCategoriesLoading,
            isTransactionsLoading,
            transactionsError,
            retryTransactions,
            isInventoryLogsLoading,
            inventoryLogsError,
            retryInventoryLogs,
            ensureInventoryLogs,
            isActivityLogsLoading,
            activityLogsError,
            retryActivityLogs,
            ensureActivityLogs,
            isPageDataLoading
        }}>
            {children}
        </InventoryContext.Provider>
    );
};
