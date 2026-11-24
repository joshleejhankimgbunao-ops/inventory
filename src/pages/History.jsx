import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Pagination from '../components/Pagination';
import IdentifierChip from '../components/IdentifierChip';
import ToolbarDropdown from '../components/ToolbarDropdown';
import ReceiptPreviewModal from '../components/ReceiptPreviewModal';
import OrderConfirmationModal from '../components/OrderConfirmationModal';
import TableActionButton from '../components/TableActionButton';
import RecordActionIcon from '../components/RecordActionIcon';
import EvidenceUploadField from '../components/EvidenceUploadField';
import TransactionReferenceModal from '../components/TransactionReferenceModal';
import TransactionReferenceCorrectionModal from '../components/TransactionReferenceCorrectionModal';
import { useLocation } from 'react-router-dom';
import { showToast } from '../utils/toastHelper';
import TableSkeletonRows from '../components/TableSkeletonRows';
import ContextualEmptyState from '../components/ContextualEmptyState';
import { showPageLoadError } from '../utils/pageLoadError';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { declineSaleVoidRequestApi, getCreditCancellationProofApi, getCreditPaymentProofApi, getCreditTransactionByIdApi, getSaleHistoryViewApi, getSaleSupportingDocumentApi, getSaleVoidProofApi, listCreditTransactionsApi, requestSaleVoidApi, voidSaleApi } from '../services/inventoryApi';
import { printReceipt } from '../services/receiptPrinter';
import { formatMoney as formatMoneyValue } from '../utils/numberFormat';
import { getActorDisplayName, getActorRoleLabel } from '../utils/actorDisplay';
import { createClientRequestId } from '../utils/clientRequestId';
import { canOfferSaleVoid } from '../utils/saleVoid';
import { PENDING_VOID_REQUEST_FILTER, countPendingVoidRequests, isPendingVoidRequest } from '../utils/pendingVoidRequests';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { getTransactionProductDisplayName } from '../utils/productDisplayName';

const isSpecialOrderSale = (transaction) => String(transaction?.saleType || '').trim().toLowerCase() === 'special-order'
    || Boolean(String(transaction?.specialOrderId || '').trim());

const mobileHistoryActionBaseClass = 'inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-center text-xs font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2';
const mobileHistoryActionClass = {
    primary: 'border-slate-900 bg-slate-900 text-white hover:border-slate-700 hover:bg-slate-700',
    secondary: 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
};

const History = () => {
    const location = useLocation();
    const historyListRef = useRef(null);
    const { userRole, currentUserName, currentAuthUserId, currentAuthUsername, appSettings, isAdminOrAbove, ROLES } = useAuth();
    const { 
        transactions, 
        setTransactions, 
        processedInventory,
        categories: productCategories = [],
        inventoryLogs, 
        isTransactionsLoading,
        transactionsError,
        retryTransactions,
        isInventoryLogsLoading,
        inventoryLogsError,
        retryInventoryLogs,
        ensureInventoryLogs,
    } = useInventory();

    const currentUser = currentUserName;
    const adminName = appSettings.adminDisplayName;
    const getHistoryProductDisplayName = useCallback((item) => getTransactionProductDisplayName(item, processedInventory, productCategories), [processedInventory, productCategories]);
    const [creditTransactions, setCreditTransactions] = useState([]);
    const [isCreditLoading, setIsCreditLoading] = useState(true);
    const [creditHistoryError, setCreditHistoryError] = useState(null);
    const [creditRetryVersion, setCreditRetryVersion] = useState(0);
    const creditHistoryLoadedRef = useRef(false);
    const retryCreditHistory = () => {
        creditHistoryLoadedRef.current = false;
        setCreditRetryVersion((version) => version + 1);
    };

    const getProcessorRoleLabel = (trx) => {
        const role = String(trx?.cashierRole || '').trim().toLowerCase();
        if (role === ROLES.SUPER_ADMIN) return 'SUPER ADMIN';
        if (role === ROLES.ADMIN) return 'ADMIN';
        if (role === ROLES.CASHIER) return 'CASHIER';

        // Backward-compatible fallback for older cached records without role.
        if (trx?.cashier === adminName || String(trx?.cashier || '').toLowerCase().includes('admin')) {
            return 'SUPER ADMIN';
        }

        return 'CASHIER';
    };

    const getProcessorDisplayName = (trx) => {
        return getActorDisplayName(trx?.cashierUser, trx?.cashier, adminName || 'Admin');
    };

    const getCreditProcessorDisplayName = (credit) => {
        return getActorDisplayName(credit?.cashierUser, credit?.cashierName, '-');
    };

    const [activeTab, setActiveTab] = useState('sales');

    useEffect(() => {
        if (activeTab === 'inventory') ensureInventoryLogs();
    }, [activeTab, currentAuthUserId, currentAuthUsername, userRole, ensureInventoryLogs]);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [salesRecordView, setSalesRecordView] = useState('ALL');
    const [filterAction, setFilterAction] = useState('ALL'); // For Inventory Logs: ALL, ADD, DEDUCT, UPDATE, DELETE
    const [processedByFilter, setProcessedByFilter] = useState('ALL'); // NEW: Filter by user
    const [inventoryProcessedByFilter, setInventoryProcessedByFilter] = useState('ALL');
    const [creditStatusFilter, setCreditStatusFilter] = useState('All');
    const [creditCustomerFilter, setCreditCustomerFilter] = useState('ALL');
    const [creditProcessedByFilter, setCreditProcessedByFilter] = useState('ALL');
    const [productFilter, setProductFilter] = useState('ALL');
    const [categoryFilter, setCategoryFilter] = useState('ALL');
    const [sortOrder, setSortOrder] = useState('desc'); // 'desc' (Newest) or 'asc' (Oldest)
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

    // Date Filters
    const [dateRange, setDateRange] = useState('all'); // 'today', 'week', 'month', 'all', 'specific_date', 'custom'
    const [specificDate, setSpecificDate] = useState('');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    const pendingVoidRequestCount = useMemo(
        () => countPendingVoidRequests(transactions.filter((transaction) => !isSpecialOrderSale(transaction))),
        [transactions]
    );

    useEffect(() => {
        const requestedFilter = new URLSearchParams(location.search).get('filter');
        if (requestedFilter === 'pending-void' && isAdminOrAbove()) {
            setActiveTab('sales');
            setSalesRecordView(PENDING_VOID_REQUEST_FILTER);
            setCurrentPage(1);
        }
    }, [location.search, isAdminOrAbove]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchTerm]);

    useEffect(() => {
        if (activeTab !== 'credit' || creditHistoryLoadedRef.current) return undefined;
        let isMounted = true;
        const loadCredits = async () => {
            setIsCreditLoading(true);
            setCreditHistoryError(null);
            try {
                const rows = await listCreditTransactionsApi({ status: 'All' });
                if (isMounted) {
                    setCreditTransactions(Array.isArray(rows) ? rows : []);
                    setCreditHistoryError(null);
                    creditHistoryLoadedRef.current = true;
                }
            } catch (error) {
                if (isMounted) setCreditHistoryError(error);
                showPageLoadError(showToast, error, 'credit-history-load');
            } finally {
                if (isMounted) {
                    setIsCreditLoading(false);
                }
            }
        };

        void loadCredits();

        return () => {
            isMounted = false;
        };
    }, [activeTab, creditRetryVersion]);

    useEffect(() => {
        let refreshTimer = null;
        const scheduleCreditRefresh = () => {
            creditHistoryLoadedRef.current = false;
            if (activeTab !== 'credit') return;
            if (refreshTimer) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                setCreditRetryVersion((version) => version + 1);
            }, 80);
        };
        const unsubscribeCredit = subscribeRealtimeEvent('credit-transactions.updated', scheduleCreditRefresh);
        const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', scheduleCreditRefresh);
        return () => {
            if (refreshTimer) window.clearTimeout(refreshTimer);
            unsubscribeCredit();
            unsubscribeResync();
        };
    }, [activeTab]);

    // Get unique list of processors (users) from transactions
    const uniqueProcessors = useMemo(() => {
        const users = new Set(transactions.map(t => t.cashier || 'Admin'));
        return ['ALL', ...Array.from(users)];
    }, [transactions]);

    const inventoryProcessedByOptions = useMemo(() => {
        const users = new Set(
            inventoryLogs
                .map((log) => getActorDisplayName(log?.userRef, log?.user))
                .filter(Boolean)
        );

        return ['ALL', ...Array.from(users).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))];
    }, [inventoryLogs]);

    const productFilterOptions = useMemo(() => {
        const map = new Map();

        transactions.forEach((trx) => {
            (trx?.items || []).forEach((item) => {
                const code = String(item?.code || '').trim();
                if (!code) return;

                const name = getHistoryProductDisplayName(item);
                const label = name ? `${code} - ${name}` : code;
                if (!map.has(code)) {
                    map.set(code, label);
                }
            });
        });

        return [
            { value: 'ALL', label: 'All Products' },
            ...Array.from(map.entries())
                .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
                .map(([value, label]) => ({ value, label })),
        ];
    }, [getHistoryProductDisplayName, transactions]);

    const creditCustomerOptions = useMemo(() => {
        const unique = new Set(
            creditTransactions
                .map((row) => String(row?.customerName || '').trim())
                .filter(Boolean)
        );
        return ['ALL', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
    }, [creditTransactions]);

    const creditProcessedByOptions = useMemo(() => {
        const unique = new Set(
            creditTransactions
                .map((row) => getCreditProcessorDisplayName(row))
                .filter(Boolean)
        );
        return ['ALL', ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
    }, [creditTransactions]);

    const categoryByCode = useMemo(() => {
        const map = new Map();

        (processedInventory || []).forEach((item) => {
            const code = String(item?.code || '').trim();
            const category = String(item?.category || '').trim();
            if (!code || !category) return;
            map.set(code, category);
        });

        return map;
    }, [processedInventory]);

    const resolveItemCategory = (item) => {
        const directCategory = String(item?.category || '').trim();
        if (directCategory) return directCategory;

        const code = String(item?.code || '').trim();
        if (!code) return '';

        return String(categoryByCode.get(code) || '').trim();
    };

    const categoryFilterOptions = useMemo(() => {
        const categories = new Set();

        transactions.forEach((trx) => {
            (trx?.items || []).forEach((item) => {
                const category = resolveItemCategory(item);
                if (category) {
                    categories.add(category);
                }
            });
        });

        return ['ALL', ...Array.from(categories).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))];
    }, [transactions, categoryByCode]);

    const historySearchSuggestions = useMemo(() => {
        const terms = new Set();

        transactions.forEach((trx) => {
            [trx?.id, trx?.cashier]
                .forEach((value) => {
                    const text = String(value || '').trim();
                    if (text) {
                        terms.add(text);
                    }
                });

            (trx?.items || []).forEach((item) => {
                [item?.code, getHistoryProductDisplayName(item)]
                    .forEach((value) => {
                        const text = String(value || '').trim();
                        if (text) {
                            terms.add(text);
                        }
                    });
            });
        });

        inventoryLogs.forEach((log) => {
            [log?.code, log?.user, log?.details]
                .forEach((value) => {
                    const text = String(value || '').trim();
                    if (text) {
                        terms.add(text);
                    }
                });
        });

        creditTransactions.forEach((credit) => {
            [credit?.creditTransactionId, credit?.customerName, credit?.orderReference]
                .forEach((value) => {
                    const text = String(value || '').trim();
                    if (text) {
                        terms.add(text);
                    }
                });
        });

        return Array.from(terms)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .slice(0, 120);
    }, [transactions, inventoryLogs, creditTransactions, getHistoryProductDisplayName]);
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const handleProductFilterChange = (value) => {
        setProductFilter(value);
        if (value !== 'ALL') {
            setCategoryFilter('ALL');
        }
    };

    const handleCategoryFilterChange = (value) => {
        setCategoryFilter(value);
        if (value !== 'ALL') {
            setProductFilter('ALL');
        }
    };

    // Filter Logic for Sales
    const filteredTransactions = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return transactions.filter(trx => {
            // `specialOrderId` is the authoritative finalized-order relation;
            // do not classify incomplete legacy data from labels or amounts.
            if (isSpecialOrderSale(trx)) return false;
            // Role Based Filtering: Cashier only sees their own transactions
            if (userRole === ROLES.CASHIER) {
                const cashierName = currentUser || 'Cashier';
                // Only filter if the filter is strict, or assume logged in cashier is the filtering key.
                // If there's no match for "Juan Cashier", we check against currentUser.
                if (trx.cashier !== cashierName) return false;
            }

            // Filter by Processor (User)
            if (processedByFilter !== 'ALL') {
                const trxUser = trx.cashier || 'Admin';
                if (trxUser !== processedByFilter) return false;
            }

            const searchNeedle = debouncedSearchTerm.toLowerCase();
            const matchesSearch = trx.id.toLowerCase().includes(searchNeedle) ||
                trx.cashier?.toLowerCase().includes(searchNeedle);

            const matchesProduct = productFilter === 'ALL' || (trx?.items || []).some((item) => String(item?.code || '').trim() === productFilter);
            const matchesCategory = categoryFilter === 'ALL' || (trx?.items || []).some((item) => resolveItemCategory(item) === categoryFilter);
            
            let matchesDate = true;
            const tDate = new Date(trx.date);
            
            if (dateRange === 'today') {
                matchesDate = tDate >= today;
            } else if (dateRange === 'week') {
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                matchesDate = tDate >= weekAgo;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                matchesDate = tDate >= monthAgo;
            } else if (dateRange === 'specific_date' && specificDate) {
                const targetDate = new Date(specificDate);
                const endTarget = new Date(specificDate);
                endTarget.setHours(23, 59, 59, 999);
                matchesDate = tDate >= targetDate && tDate <= endTarget;
            } else if (dateRange === 'custom' && customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end = new Date(customEndDate);
                end.setHours(23, 59, 59, 999);
                matchesDate = tDate >= start && tDate <= end;
            }
            const isVoided = String(trx.status || '').trim().toUpperCase() === 'VOIDED';
            const matchesRecordView = salesRecordView === 'VOIDED'
                ? isVoided
                : salesRecordView === PENDING_VOID_REQUEST_FILTER
                    ? isPendingVoidRequest(trx)
                    : true;
            
            return matchesSearch && matchesDate && matchesProduct && matchesCategory && matchesRecordView;
        });
    }, [transactions, debouncedSearchTerm, dateRange, specificDate, customStartDate, customEndDate, salesRecordView, processedByFilter, userRole, productFilter, categoryFilter]);

    const filteredSpecialOrders = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return transactions.filter((trx) => {
            if (!isSpecialOrderSale(trx)) return false;
            if (userRole === ROLES.CASHIER && trx.cashier !== (currentUser || 'Cashier')) return false;
            if (processedByFilter !== 'ALL' && (trx.cashier || 'Admin') !== processedByFilter) return false;
            const searchNeedle = debouncedSearchTerm.toLowerCase();
            const matchesSearch = String(trx.id || '').toLowerCase().includes(searchNeedle)
                || String(trx.specialOrderNumber || '').toLowerCase().includes(searchNeedle)
                || String(trx.customerName || '').toLowerCase().includes(searchNeedle)
                || String(trx.cashier || '').toLowerCase().includes(searchNeedle)
                || (trx.items || []).some((item) => String(item.code || '').toLowerCase().includes(searchNeedle) || getHistoryProductDisplayName(item).toLowerCase().includes(searchNeedle));
            const matchesProduct = productFilter === 'ALL' || (trx.items || []).some((item) => String(item?.code || '').trim() === productFilter);
            const matchesCategory = categoryFilter === 'ALL' || (trx.items || []).some((item) => String(item?.category || categoryByCode.get(String(item?.code || '').trim()) || '').trim() === categoryFilter);
            const tDate = new Date(trx.date);
            let matchesDate = true;
            if (dateRange === 'today') matchesDate = tDate >= today;
            else if (dateRange === 'week') { const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7); matchesDate = tDate >= weekAgo; }
            else if (dateRange === 'month') { const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1); matchesDate = tDate >= monthAgo; }
            else if (dateRange === 'specific_date' && specificDate) { const start = new Date(specificDate); const end = new Date(specificDate); end.setHours(23, 59, 59, 999); matchesDate = tDate >= start && tDate <= end; }
            else if (dateRange === 'custom' && customStartDate && customEndDate) { const start = new Date(customStartDate); const end = new Date(customEndDate); end.setHours(23, 59, 59, 999); matchesDate = tDate >= start && tDate <= end; }
            const isVoided = String(trx.status || '').trim().toUpperCase() === 'VOIDED';
            const matchesRecordView = salesRecordView === 'VOIDED' ? isVoided : salesRecordView === PENDING_VOID_REQUEST_FILTER ? isPendingVoidRequest(trx) : true;
            return matchesSearch && matchesDate && matchesProduct && matchesCategory && matchesRecordView;
        });
    }, [transactions, debouncedSearchTerm, dateRange, specificDate, customStartDate, customEndDate, salesRecordView, processedByFilter, userRole, productFilter, categoryFilter, ROLES.CASHIER, currentUser, categoryByCode, getHistoryProductDisplayName]);

    const salesSummary = useMemo(() => {
        const summary = {
            totalSoldQty: 0,
            totalAmount: 0,
            matchingTransactions: filteredTransactions.length,
        };

        filteredTransactions.forEach((trx) => {
            const amount = Number(trx?.total);
            if (Number.isFinite(amount)) summary.totalAmount += amount;
            (trx?.items || []).forEach((item) => {
                const productMatch = productFilter === 'ALL' || String(item?.code || '').trim() === productFilter;
                const categoryMatch = categoryFilter === 'ALL' || resolveItemCategory(item) === categoryFilter;

                if (!productMatch || !categoryMatch) return;

                summary.totalSoldQty += Number(item?.qty || 0);
            });
        });

        return summary;
    }, [filteredTransactions, productFilter, categoryFilter]);

    const specialOrdersSummary = useMemo(() => filteredSpecialOrders.reduce((summary, trx) => {
        summary.totalSoldQty += (trx.items || []).reduce((sum, item) => sum + Number(item?.qty || 0), 0);
        const amount = Number(trx?.total);
        if (Number.isFinite(amount)) summary.totalAmount += amount;
        return summary;
    }, { totalSoldQty: 0, totalAmount: 0 }), [filteredSpecialOrders]);

    // Filter Logic for Inventory Logs
    const filteredLogs = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return inventoryLogs.filter(log => {
            const searchNeedle = debouncedSearchTerm.toLowerCase();
            const matchesSearch = 
                (log.code && log.code.toLowerCase().includes(searchNeedle)) ||
                (log.details && log.details.toLowerCase().includes(searchNeedle)) ||
                (log.user && log.user.toLowerCase().includes(searchNeedle));
            
            const matchesFilter = filterAction === 'ALL' || log.action === filterAction;
            const matchesProcessedBy = inventoryProcessedByFilter === 'ALL'
                || getActorDisplayName(log?.userRef, log?.user) === inventoryProcessedByFilter;

            let matchesDate = true;
            const logDate = new Date(log.date);
            
            if (dateRange === 'today') {
                matchesDate = logDate >= today;
            } else if (dateRange === 'week') {
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                matchesDate = logDate >= weekAgo;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                matchesDate = logDate >= monthAgo;
            } else if (dateRange === 'specific_date' && specificDate) {
                const targetDate = new Date(specificDate);
                const endTarget = new Date(specificDate);
                endTarget.setHours(23, 59, 59, 999);
                matchesDate = logDate >= targetDate && logDate <= endTarget;
            } else if (dateRange === 'custom' && customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end = new Date(customEndDate);
                end.setHours(23, 59, 59, 999);
                matchesDate = logDate >= start && logDate <= end;
            }

            return matchesSearch && matchesFilter && matchesProcessedBy && matchesDate;
        });
    }, [inventoryLogs, debouncedSearchTerm, filterAction, inventoryProcessedByFilter, dateRange, specificDate, customStartDate, customEndDate]);

    const filteredCredits = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return creditTransactions.filter((credit) => {
            const searchNeedle = debouncedSearchTerm.toLowerCase();
            const matchesSearch = String(credit?.creditTransactionId || '').toLowerCase().includes(searchNeedle)
                || String(credit?.customerName || '').toLowerCase().includes(searchNeedle)
                || String(credit?.orderReference || '').toLowerCase().includes(searchNeedle)
                || getCreditProcessorDisplayName(credit).toLowerCase().includes(searchNeedle);

            if (creditStatusFilter !== 'All') {
                const status = String(credit?.status || '').trim();
                if (status !== creditStatusFilter) return false;
            }

            if (creditCustomerFilter !== 'ALL') {
                const customer = String(credit?.customerName || '').trim();
                if (customer !== creditCustomerFilter) return false;
            }

            if (creditProcessedByFilter !== 'ALL') {
                const cashier = getCreditProcessorDisplayName(credit);
                if (cashier !== creditProcessedByFilter) return false;
            }

            let matchesDate = true;
            const creditDate = new Date(credit.createdAt || credit.date || 0);

            if (dateRange === 'today') {
                matchesDate = creditDate >= today;
            } else if (dateRange === 'week') {
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                matchesDate = creditDate >= weekAgo;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                matchesDate = creditDate >= monthAgo;
            } else if (dateRange === 'specific_date' && specificDate) {
                const targetDate = new Date(specificDate);
                const endTarget = new Date(specificDate);
                endTarget.setHours(23, 59, 59, 999);
                matchesDate = creditDate >= targetDate && creditDate <= endTarget;
            } else if (dateRange === 'custom' && customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end = new Date(customEndDate);
                end.setHours(23, 59, 59, 999);
                matchesDate = creditDate >= start && creditDate <= end;
            }

            return matchesSearch && matchesDate;
        });
    }, [creditTransactions, debouncedSearchTerm, dateRange, specificDate, customStartDate, customEndDate, creditStatusFilter, creditCustomerFilter, creditProcessedByFilter]);

    // Reset pagination
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, debouncedSearchTerm, filterAction, salesRecordView, processedByFilter, inventoryProcessedByFilter, sortOrder, dateRange, specificDate, customStartDate, customEndDate, productFilter, categoryFilter, creditStatusFilter, creditCustomerFilter, creditProcessedByFilter]);

    useEffect(() => {
        if (!historyListRef.current) return;
        historyListRef.current.scrollTop = 0;
    }, [currentPage]);

    // Pagination Logic
    const currentList = activeTab === 'sales'
        ? filteredTransactions
        : (activeTab === 'special-orders' ? filteredSpecialOrders : (activeTab === 'credit' ? filteredCredits : filteredLogs));
    const isCurrentTabLoading = activeTab === 'sales' || activeTab === 'special-orders'
        ? isTransactionsLoading
        : (activeTab === 'credit' ? isCreditLoading : isInventoryLogsLoading);
    const currentTabLoadError = activeTab === 'sales' || activeTab === 'special-orders'
        ? transactionsError
        : (activeTab === 'credit' ? creditHistoryError : inventoryLogsError);
    const hasCurrentTabFilters = Boolean(debouncedSearchTerm.trim()) || (activeTab === 'sales' || activeTab === 'special-orders'
        ? salesRecordView !== 'ALL' || processedByFilter !== 'ALL' || productFilter !== 'ALL' || categoryFilter !== 'ALL'
            || dateRange !== 'all' || Boolean(specificDate) || Boolean(customStartDate) || Boolean(customEndDate)
        : activeTab === 'credit'
            ? creditStatusFilter !== 'All' || creditCustomerFilter !== 'ALL' || creditProcessedByFilter !== 'ALL'
                || dateRange !== 'all' || Boolean(specificDate) || Boolean(customStartDate) || Boolean(customEndDate)
            : filterAction !== 'ALL' || inventoryProcessedByFilter !== 'ALL'
                || dateRange !== 'all' || Boolean(specificDate) || Boolean(customStartDate) || Boolean(customEndDate));
    const resetCurrentTabFilters = () => {
        setSearchTerm('');
        setDateRange('all');
        setSpecificDate('');
        setCustomStartDate('');
        setCustomEndDate('');
        if (activeTab === 'sales' || activeTab === 'special-orders') {
            setSalesRecordView('ALL');
            setProcessedByFilter('ALL');
            setProductFilter('ALL');
            setCategoryFilter('ALL');
        } else if (activeTab === 'credit') {
            setCreditStatusFilter('All');
            setCreditCustomerFilter('ALL');
            setCreditProcessedByFilter('ALL');
        } else {
            setFilterAction('ALL');
            setInventoryProcessedByFilter('ALL');
        }
        setIsFilterPanelOpen(false);
    };
    const retryCurrentTab = activeTab === 'sales' || activeTab === 'special-orders'
        ? retryTransactions
        : (activeTab === 'credit' ? retryCreditHistory : retryInventoryLogs);
    const currentEmptyState = currentTabLoadError
        ? {
            title: 'Records could not be loaded',
            description: currentTabLoadError?.message || 'Please try again.',
            actionLabel: 'Retry',
            onAction: retryCurrentTab,
        }
        : hasCurrentTabFilters
            ? { title: 'No matching results', description: 'Try a different search or filter.', actionLabel: 'Clear Filters', onAction: resetCurrentTabFilters }
            : {
                title: activeTab === 'inventory' ? 'No activity recorded' : activeTab === 'credit' ? 'No credit transactions recorded' : activeTab === 'special-orders' ? 'No Special Order transactions recorded' : 'No sales recorded',
                description: activeTab === 'inventory'
                    ? 'Inventory movements will appear here when activity is recorded.'
                    : activeTab === 'credit'
                        ? 'Credit transactions will appear here when customers purchase on credit.'
                        : activeTab === 'special-orders'
                            ? 'Completed Special Order transactions will appear here.'
                            : 'Sales transactions will appear here after POS payments are processed.',
            };
    const totalPages = Math.ceil(currentList.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;

    useEffect(() => {
        setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
    }, [totalPages]);
    
    const sortedItems = useMemo(() => {
        const withMeta = currentList.map((item, index) => {
            const parsedTime = new Date(item.date || item.createdAt || item.timestamp || item.occurredAt || 0).getTime();
            return {
                item,
                index,
                time: Number.isNaN(parsedTime) ? null : parsedTime,
            };
        });

        withMeta.sort((a, b) => {
            if (a.time !== null && b.time !== null && a.time !== b.time) {
                return sortOrder === 'desc' ? b.time - a.time : a.time - b.time;
            }

            if (a.time !== null && b.time === null) {
                return -1;
            }

            if (a.time === null && b.time !== null) {
                return 1;
            }

            return sortOrder === 'desc' ? b.index - a.index : a.index - b.index;
        });

        return withMeta.map((entry) => entry.item);
    }, [currentList, sortOrder]);

    const currentItems = sortedItems.slice(indexOfFirstItem, indexOfLastItem);
    const hasResults = currentList.length > 0;
    const displayStart = hasResults ? indexOfFirstItem + 1 : 0;
    const displayEnd = hasResults ? Math.min(indexOfLastItem, currentList.length) : 0;
    
    // Note: The original code used .slice().reverse() inside the render. 
    // I should apply reverse first then pagination to show latest items first properly.
    // The previous implementation was: filteredTransactions.slice().reverse().map(...)
    // So if I have 100 items, I want page 1 to show items 100-93.
    // My logic above: currentItems = currentList.slice().reverse().slice(...) does exactly that.

    // State for Reprinting Receipt (lifted from SalesHistory)
    const [selectedTransaction, setSelectedTransaction] = useState(null);
    const [selectedSaleDetails, setSelectedSaleDetails] = useState(null);
    const [isEditingSaleReference, setIsEditingSaleReference] = useState(false);
    const [isCorrectingSaleReference, setIsCorrectingSaleReference] = useState(false);
    const [isCorrectionHistoryOpen, setIsCorrectionHistoryOpen] = useState(false);
    const [documentPreview, setDocumentPreview] = useState(null);
    const [showReceipt, setShowReceipt] = useState(false);
    const [printStatus, setPrintStatus] = useState('idle');
    const printRequestInFlightRef = useRef(false);
    const [selectedCredit, setSelectedCredit] = useState(null);
    const [isCreditDetailsOpen, setIsCreditDetailsOpen] = useState(false);
    const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
    const [voidReason, setVoidReason] = useState('');
    const [voidProofFiles, setVoidProofFiles] = useState([]);
    const [voidProofPreview, setVoidProofPreview] = useState(null);
    const isSaleDetailsChildActive = Boolean(
        isEditingSaleReference
        || isCorrectingSaleReference
        || isCorrectionHistoryOpen
        || isVoidModalOpen
        || documentPreview
        || voidProofPreview
    );
    const [isVoidSubmitting, setIsVoidSubmitting] = useState(false);
    const voidRequestIdRef = useRef('');
    const voidRequestInFlightRef = useRef(false);

    const autoReceiptHandledRef = useRef(false);
    const [autoReceiptMode, setAutoReceiptMode] = useState(null);

    const formatExact = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatMoney = (value) => {
        return formatMoneyValue(value);
    };

    const formatDateShort = (value) => {
        if (!value) return '-';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '-';
        return d.toLocaleDateString();
    };

    const formatOptionalDate = (value) => {
        const formatted = formatDateShort(value);
        return formatted === '-' ? '' : formatted;
    };

    const getLastPaymentDate = (payments) => {
        if (!Array.isArray(payments) || payments.length === 0) return '';
        const latest = payments
            .map((payment) => new Date(payment?.paymentDate || 0).getTime())
            .filter((value) => Number.isFinite(value) && value > 0)
            .sort((a, b) => b - a)[0];
        return latest ? new Date(latest) : '';
    };

    const getCreditPaymentMethod = (credit) => {
        const payments = Array.isArray(credit?.paymentHistory) ? credit.paymentHistory : [];
        const method = String(payments[payments.length - 1]?.method || credit?.creditPaymentMode || '-').trim();
        const labels = {
            cash: 'Cash',
            gcash: 'GCash',
            cheque: 'Cheque',
            'bank transfer': 'Bank Transfer',
        };
        return labels[method.toLowerCase()] || method || '-';
    };

    const getDownPayment = (credit) => {
        const event = (credit?.paymentHistory || []).find((payment) => payment?.type === 'down_payment');
        const amount = Number(event?.amount ?? credit?.downPaymentAmount ?? 0);
        return Number.isFinite(amount) && amount > 0 ? { amount, method: String(event?.method || credit?.creditPaymentMode || '').trim() } : null;
    };

    const getCreditPaymentEventLabel = (credit, payment, index) => {
        if (payment?.type === 'down_payment') return 'Down Payment';
        const payments = Array.isArray(credit?.paymentHistory) ? credit.paymentHistory : [];
        if (String(credit?.status || '').toLowerCase() === 'paid' && index === payments.length - 1) return 'Final Payment';
        return 'Partial Payment';
    };

    const creditStatusBadgeClass = (status) => {
        const value = String(status || '').toLowerCase();
        if (value === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
        if (value === 'overdue') return 'bg-rose-50 text-rose-700 border-rose-100';
        if (value === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-100';
        if (value === 'partially paid') return 'bg-amber-50 text-amber-700 border-amber-100';
        return 'bg-gray-100 text-gray-600 border-gray-200';
    };

    const isRegularSale = (transaction) => !isSpecialOrderSale(transaction);

    const handleViewReceipt = async (transaction) => {
        try {
            const current = transaction?.sourceId && isRegularSale(transaction)
                ? await getSaleHistoryViewApi(transaction.sourceId)
                : transaction;
            setSelectedTransaction(current);
            setShowReceipt(true);
            setAutoReceiptMode(null);
        } catch (error) {
            showToast('Unable to Open', error.message || 'Unable to load the current Sale record.', 'error', 'sale-preview-current');
        }
    };

    const canVoidSale = (transaction) => canOfferSaleVoid(transaction, {
        isAdmin: isAdminOrAbove(),
        isOnline: typeof navigator === 'undefined' || navigator.onLine,
    });

    const canRequestVoid = (transaction) => userRole === ROLES.CASHIER
        && transaction?.sourceId
        && transaction?.voidEligible
        && String(transaction?.status || '').toLowerCase() === 'completed'
        && transaction?.voidRequest?.status !== 'pending'
        && (typeof navigator === 'undefined' || navigator.onLine);

    const openVoidModal = () => {
        if (!canVoidSale(selectedSaleDetails) && !canRequestVoid(selectedSaleDetails)) return;
        setVoidReason(selectedSaleDetails?.voidRequest?.status === 'pending' ? selectedSaleDetails.voidRequest.reason : '');
        setVoidProofFiles([]);
        voidRequestIdRef.current = createClientRequestId('sale-void');
        setIsVoidModalOpen(true);
    };

    const closeVoidModal = () => {
        if (voidRequestInFlightRef.current) return;
        setIsVoidModalOpen(false);
        setVoidReason('');
        setVoidProofFiles([]);
        voidRequestIdRef.current = '';
    };

    const confirmVoidSale = async () => {
        const reason = voidReason.trim();
        if (!selectedSaleDetails?.sourceId || !reason || voidRequestInFlightRef.current) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            showToast('Connection Required', 'Reconnect before voiding this Sale.', 'error', 'sale-void-offline');
            return;
        }
        voidRequestInFlightRef.current = true;
        setIsVoidSubmitting(true);
        try {
            const isCashierRequest = userRole === ROLES.CASHIER;
            const result = isCashierRequest
                ? await requestSaleVoidApi(selectedSaleDetails.sourceId, { reason, proofFiles: voidProofFiles })
                : await voidSaleApi(selectedSaleDetails.sourceId, {
                    reason,
                    requestId: voidRequestIdRef.current || createClientRequestId('sale-void'),
                    proofFiles: voidProofFiles,
                });
            const updated = isCashierRequest ? result : result.sale;
            setTransactions((previous) => previous.map((transaction) => (
                transaction.sourceId === updated.sourceId ? updated : transaction
            )));
            setSelectedSaleDetails(updated);
            setSelectedTransaction((previous) => previous?.sourceId === updated.sourceId ? updated : previous);
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('sale:void-requests-changed'));
            setIsVoidModalOpen(false);
            setVoidReason('');
            setVoidProofFiles([]);
            voidRequestIdRef.current = '';
            showToast(
                isCashierRequest ? 'Void Requested' : result.replayed ? 'Sale Already Voided' : 'Sale Voided',
                isCashierRequest ? `${updated.id} is pending Admin review.` : `${updated.id} is recorded as voided.`,
                'success',
                isCashierRequest ? 'sale-void-request-success' : 'sale-void-success'
            );
        } catch (error) {
            showToast('Void Failed', error.message || 'The Sale was not voided. No inventory changes were applied.', 'error', 'sale-void-failed');
        } finally {
            voidRequestInFlightRef.current = false;
            setIsVoidSubmitting(false);
        }
    };

    const declineVoidRequest = async () => {
        if (!selectedSaleDetails?.sourceId || selectedSaleDetails.voidRequest?.status !== 'pending') return;
        try {
            const updated = await declineSaleVoidRequestApi(selectedSaleDetails.sourceId);
            setTransactions((previous) => previous.map((transaction) => transaction.sourceId === updated.sourceId ? updated : transaction));
            setSelectedSaleDetails(updated);
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('sale:void-requests-changed'));
            showToast('Void Request Declined', `${updated.id} remains completed.`, 'success', 'sale-void-request-declined');
        } catch (error) {
            showToast('Unable to Decline', error.message || 'The Void request was not changed.', 'error', 'sale-void-request-decline-failed');
        }
    };

    useEffect(() => {
        if (!isSaleDetailsChildActive) return undefined;
        const handleEscape = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            if (documentPreview) return setDocumentPreview(null);
            if (voidProofPreview) return setVoidProofPreview(null);
            if (isVoidModalOpen) return closeVoidModal();
            if (isCorrectionHistoryOpen) return setIsCorrectionHistoryOpen(false);
            if (isCorrectingSaleReference) return setIsCorrectingSaleReference(false);
            if (isEditingSaleReference) setIsEditingSaleReference(false);
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [documentPreview, voidProofPreview, isVoidModalOpen, isCorrectionHistoryOpen, isCorrectingSaleReference, isEditingSaleReference, isSaleDetailsChildActive]);

    useEffect(() => () => {
        if (documentPreview?.url) URL.revokeObjectURL(documentPreview.url);
    }, [documentPreview]);

    useEffect(() => () => {
        if (voidProofPreview?.url) URL.revokeObjectURL(voidProofPreview.url);
    }, [voidProofPreview]);

    const viewSaleDocument = async () => {
        if (!selectedSaleDetails?.sourceId) return;
        try {
            const blob = await getSaleSupportingDocumentApi(selectedSaleDetails.sourceId);
            setDocumentPreview({ url: URL.createObjectURL(blob), name: selectedSaleDetails.transactionReference?.supportingDocument?.originalName || 'Supporting Document' });
        } catch (error) {
            showToast('Document Unavailable', error.message || 'Unable to load the supporting document.', 'error', 'sale-document-view');
        }
    };

    const viewCorrectionDocument = async (correctionIndex, version, document) => {
        if (!selectedSaleDetails?.sourceId || !document) return;
        try {
            const blob = await getSaleSupportingDocumentApi(selectedSaleDetails.sourceId, { correctionIndex, version });
            setDocumentPreview({ url: URL.createObjectURL(blob), name: document.originalName || 'Supporting Document' });
        } catch (error) {
            showToast('Document Unavailable', error.message || 'Unable to load the historical supporting document.', 'error', 'sale-correction-document-view');
        }
    };

    const viewSaleVoidProof = async (stage = 'void', index = 0) => {
        const source = stage === 'request' ? selectedSaleDetails?.voidRequest : selectedSaleDetails?.voidInfo;
        const proof = source?.supportingProofs?.[index] || (index === 0 ? source?.supportingProof : null);
        if (!selectedSaleDetails?.sourceId || !proof) return;
        try {
            const blob = await getSaleVoidProofApi(selectedSaleDetails.sourceId, { stage, index });
            setVoidProofPreview({
                url: URL.createObjectURL(blob),
                name: proof.originalName || 'Supporting Proof',
                mimeType: proof.mimeType || blob.type,
            });
        } catch (error) {
            showToast('Proof Unavailable', error.message || 'Unable to load the Supporting Proof.', 'error', 'sale-void-proof-view');
        }
    };

    const viewCreditEvidence = async ({ payment, index = 0, cancellation = false }) => {
        if (!selectedCredit?._id) return;
        const proof = cancellation ? selectedCredit.cancelProofs?.[index] : payment?.proofs?.[index] || (index === 0 ? payment?.proof : null);
        if (!proof?.storageKey) return;
        try {
            const blob = cancellation
                ? await getCreditCancellationProofApi(selectedCredit._id, index)
                : await getCreditPaymentProofApi(selectedCredit._id, payment.clientRequestId, index);
            setVoidProofPreview({ url: URL.createObjectURL(blob), name: proof.fileName || 'Credit evidence', mimeType: blob.type });
        } catch (error) {
            showToast('Proof Unavailable', error.message || 'Unable to load credit evidence.', 'error', 'credit-history-proof-view');
        }
    };

    const handleViewCreditDetails = async (credit) => {
        if (!credit?._id) return;
        try {
            const detail = await getCreditTransactionByIdApi(credit._id);
            setSelectedCredit(detail);
            setIsCreditDetailsOpen(true);
        } catch (error) {
            showPageLoadError(showToast, error, 'credit-history-details');
        }
    };

    useEffect(() => {
        if (autoReceiptHandledRef.current) return;

        const state = location.state || {};
        if (!state || Object.keys(state).length === 0) return;

        if (state.autoReceiptTransaction) {
            setActiveTab('sales');
            setSelectedTransaction(state.autoReceiptTransaction);
            setShowReceipt(true);
            setAutoReceiptMode(state.autoReceiptMode || 'paid-credit');
            autoReceiptHandledRef.current = true;
            return;
        }

        const targetId = String(state.autoReceiptTransactionId || '').trim();
        const creditId = String(state.autoReceiptCreditId || '').trim();
        if (!targetId && !creditId) return;

        if (Array.isArray(transactions) && transactions.length > 0) {
            const match = transactions.find((trx) => {
                const trxId = String(trx?.id || '').trim();
                const trxCreditId = String(trx?.creditTransactionId || '').trim();
                return (targetId && trxId === targetId)
                    || (creditId && trxCreditId === creditId);
            });

            if (match) {
                setActiveTab('sales');
                setSelectedTransaction(match);
                setShowReceipt(true);
                setAutoReceiptMode(state.autoReceiptMode || 'paid-credit');
                autoReceiptHandledRef.current = true;
            }
        }
    }, [location.state, transactions]);

    const isAutoReceipt = autoReceiptMode === 'paid-credit';
    const isOrderConfirmation = !isAutoReceipt && isRegularSale(selectedTransaction);
    const handlePrint = async () => {
        if (!selectedTransaction || printRequestInFlightRef.current) {
            return;
        }

        printRequestInFlightRef.current = true;
        setPrintStatus('printing');
        try {
            const currentTransaction = isOrderConfirmation && selectedTransaction.sourceId
                ? await getSaleHistoryViewApi(selectedTransaction.sourceId)
                : selectedTransaction;
            if (currentTransaction !== selectedTransaction) setSelectedTransaction(currentTransaction);
            await printReceipt({
                transaction: isOrderConfirmation
                    ? { ...currentTransaction, documentType: 'order-confirmation' }
                    : currentTransaction,
                settings: appSettings,
                isReprint: !isAutoReceipt && !isOrderConfirmation,
                elementId: 'history-receipt-content',
                paperWidthMm: 58,
            });

            setPrintStatus('success');
            showToast(
                'Print Success',
                isOrderConfirmation ? 'Order Confirmation sent to the thermal printer.' : 'Receipt sent to the thermal printer.',
                'success',
                'history-print-receipt'
            );

            setTimeout(() => {
                setPrintStatus('idle');
                printRequestInFlightRef.current = false;
            }, 2000);
        } catch (error) {
            printRequestInFlightRef.current = false;
            setPrintStatus('idle');
            showToast('Print Failed', error?.message || (isOrderConfirmation ? 'Unable to print Order Confirmation.' : 'Unable to reprint receipt.'), 'error', 'history-print-error');
        }
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col md:overflow-hidden gap-2">
            <div className="relative rounded-none border-0 bg-transparent shadow-none md:flex-1 md:rounded-2xl md:border md:border-slate-300 md:bg-slate-200/50 md:shadow-inner flex flex-col md:overflow-hidden">
                {/* Header + Controls */}
                <div className="flex flex-col gap-3 px-2 py-4 md:shrink-0 md:p-4">
                    <div className="relative z-40 flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">History Logs</p>
                            <p className="text-gray-500 dark:text-gray-400 text-[11px] md:text-xs font-medium mt-1">Review past transactions and inventory movements</p>
                        </div>
                        <div className="w-full sm:w-44 sm:shrink-0">
                            <ToolbarDropdown
                                value={activeTab}
                                onChange={setActiveTab}
                                ariaLabel="Select history log type"
                                className="w-full [&_[role=option]]:whitespace-nowrap"
                                options={[
                                    { value: 'sales', label: 'Sales Transactions' },
                                    { value: 'credit', label: 'Credit Transactions' },
                                    { value: 'special-orders', label: 'Special Orders' },
                                    ...(userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN || userRole === ROLES.CASHIER ? [{ value: 'inventory', label: 'Inventory Logs' }] : []),
                                ]}
                            />
                        </div>
                    </div>

                    {(activeTab === 'sales' || activeTab === 'special-orders') && (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="History summary">
                            {[
                                { label: 'Total Transactions', value: activeTab === 'special-orders' ? filteredSpecialOrders.length : salesSummary.matchingTransactions, icon: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></> },
                                { label: 'Total Sold Quantity', value: activeTab === 'special-orders' ? specialOrdersSummary.totalSoldQty : salesSummary.totalSoldQty, icon: <><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4M12 11v10" /></> },
                                { label: 'Total Amount', value: `₱${formatMoney(activeTab === 'special-orders' ? specialOrdersSummary.totalAmount : salesSummary.totalAmount)}`, icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M15 14h3" /></> },
                            ].map(({ label, value, icon }) => (
                                <div key={label} className="app-dashboard-card-hover rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
                                            <p className="mt-1 break-words text-lg font-semibold tabular-nums text-gray-900">{isCurrentTabLoading ? '—' : value}</p>
                                        </div>
                                        <div className="shrink-0 rounded-lg bg-gray-900 p-2 text-white">
                                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Search */}
                        <div className="main-toolbar-search group">
                            <input 
                                type="text" 
                                placeholder={activeTab === 'sales'
                                    ? "Search Transaction ID..."
                                    : (activeTab === 'special-orders' ? "Search Transaction ID / Special Order..." : (activeTab === 'credit' ? "Search Credit ID / Customer..." : "Search SKU..."))}
                                value={searchTerm}
                                list="history-search-suggestions"
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="main-toolbar-search-input"
                            />
                            <datalist id="history-search-suggestions">
                                {historySearchSuggestions.map((term) => (
                                    <option key={term} value={term} />
                                ))}
                            </datalist>
                            <div className="main-toolbar-search-icon">
                                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                        </div>

                        {/* Filter & Sort */}
                        <div className="relative z-30 w-full sm:w-auto flex items-center gap-2">
                            <button
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                className="px-3 py-2 rounded-xl font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 text-white border-gray-900 hover:opacity-90"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                                <span>Filter & Sort</span>
                                <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>

                            {/* Filter Panel */}
                            {isFilterPanelOpen && (
                                <div className="absolute top-full mt-2 w-[min(20rem,calc(100vw-2rem))] bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-50 right-0 md:left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[50vh] sm:max-h-[56vh] overflow-y-auto overscroll-contain">

                                    {/* Date Range */}
                                    <div className="px-3 pt-2 pb-1">
                                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Date Range</div>
                                    </div>
                                    <div className="px-2 pb-2 flex flex-wrap gap-1">
                                        {[{key:'all',label:'All Time'},{key:'today',label:'Today'},{key:'week',label:'This Week'},{key:'month',label:'This Month'},{key:'specific_date',label:'Select Date'},{key:'custom',label:'Custom Range'}].map(d => (
                                            <button key={d.key} onClick={() => setDateRange(d.key)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                    dateRange === d.key
                                                    ? 'bg-gray-900 text-white shadow-sm'
                                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                }`}>{d.label}
                                            </button>
                                        ))}
                                    </div>
                                    {dateRange === 'specific_date' && (
                                        <div className="px-3 pb-2">
                                            <input type="date" max={new Date().toISOString().split('T')[0]} value={specificDate} onChange={(e) => setSpecificDate(e.target.value)}
                                                className="w-full px-3 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all" />
                                        </div>
                                    )}
                                    {dateRange === 'custom' && (
                                        <div className="px-3 pb-2 flex gap-2">
                                            <input type="date" max={new Date().toISOString().split('T')[0]} value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)}
                                                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all" />
                                            <input type="date" max={new Date().toISOString().split('T')[0]} value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)}
                                                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all" />
                                        </div>
                                    )}

                                    <div className="border-t border-gray-100 mx-3"></div>

                                    {/* Sort Order */}
                                    <div className="px-3 pt-2 pb-1">
                                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Sort By</div>
                                    </div>
                                    <div className="px-2 pb-2 flex gap-1">
                                        {[{key:'desc',label:'Newest First'},{key:'asc',label:'Oldest First'}].map(s => (
                                            <button key={s.key} onClick={() => setSortOrder(s.key)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                    sortOrder === s.key
                                                    ? 'bg-gray-900 text-white shadow-sm'
                                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                }`}>{s.label}
                                            </button>
                                        ))}
                                    </div>

                                    {(activeTab === 'sales' || activeTab === 'special-orders') && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3" />
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Record View</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={salesRecordView}
                                                    onChange={(event) => {
                                                        setSalesRecordView(event.target.value);
                                                        setCurrentPage(1);
                                                    }}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    <option value="ALL">All</option>
                                                    {isAdminOrAbove() && <option value={PENDING_VOID_REQUEST_FILTER}>Pending Void Requests ({pendingVoidRequestCount})</option>}
                                                    <option value="VOIDED">Voided</option>
                                                </select>
                                            </div>
                                        </>
                                    )}

                                    {/* Staff Filter (Sales tab, Admin only) */}
                                    {(activeTab === 'sales' || activeTab === 'special-orders') && isAdminOrAbove() && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Processed By</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={processedByFilter}
                                                    onChange={(e) => setProcessedByFilter(e.target.value)}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    {uniqueProcessors.map((user) => (
                                                        <option key={user} value={user}>{user === 'ALL' ? 'All Staff' : user}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    )}

                                    {(activeTab === 'sales' || activeTab === 'special-orders') && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Product</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={productFilter}
                                                    onChange={(e) => handleProductFilterChange(e.target.value)}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    {productFilterOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="px-3 pt-1 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Category</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={categoryFilter}
                                                    onChange={(e) => handleCategoryFilterChange(e.target.value)}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    {categoryFilterOptions.map((category) => (
                                                        <option key={category} value={category}>{category === 'ALL' ? 'All Categories' : category}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="h-4" />
                                        </>
                                    )}

                                    {activeTab === 'credit' && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</div>
                                            </div>
                                            <div className="px-2 pb-2 flex flex-wrap gap-1">
                                                {['All', 'Unpaid', 'Paid', 'Overdue', 'Cancelled'].map((status) => (
                                                    <button
                                                        key={status}
                                                        onClick={() => setCreditStatusFilter(status)}
                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                            creditStatusFilter === status
                                                                ? 'bg-gray-900 text-white shadow-sm'
                                                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                        }`}
                                                    >
                                                        {status === 'All' ? 'All Status' : status}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Customer</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={creditCustomerFilter}
                                                    onChange={(e) => setCreditCustomerFilter(e.target.value)}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    {creditCustomerOptions.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option === 'ALL' ? 'All Customers' : option}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Processed By</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={creditProcessedByFilter}
                                                    onChange={(e) => setCreditProcessedByFilter(e.target.value)}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    {creditProcessedByOptions.map((option) => (
                                                        <option key={option} value={option}>
                                                            {option === 'ALL' ? 'All Processors' : option}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="h-4" />
                                        </>
                                    )}

                                    {/* Action Filter (Inventory tab) */}
                                    {activeTab === 'inventory' && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Action Type</div>
                                            </div>
                                            <div className="px-2 pb-2 flex flex-wrap gap-1">
                                                {[{key:'ALL',label:'All Actions'},{key:'ADD',label:'Restock'},{key:'DEDUCT',label:'Sales'},{key:'UPDATE',label:'Updates'},{key:'CREATE',label:'New Items'}].map(a => (
                                                    <button key={a.key} onClick={() => setFilterAction(a.key)}
                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                            filterAction === a.key
                                                            ? 'bg-gray-900 text-white shadow-sm'
                                                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                        }`}>{a.label}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Processed By</div>
                                            </div>
                                            <div className="px-3 pb-2">
                                                <select
                                                    value={inventoryProcessedByFilter}
                                                    onChange={(e) => setInventoryProcessedByFilter(e.target.value)}
                                                    className="w-full rounded-lg border-2 border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:border-gray-900 focus:outline-none"
                                                >
                                                    {inventoryProcessedByOptions.map((user) => (
                                                        <option key={user} value={user}>{user === 'ALL' ? 'All Staff' : user}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Backdrop */}
                        {isFilterPanelOpen && (
                            <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                        )}
                </div>
                {/* Content Area */}
                <div ref={historyListRef} className="w-full min-w-0 overflow-x-hidden pb-32 pt-0 md:flex-1 md:overflow-x-auto md:overflow-y-auto md:max-h-[calc(100vh-220px)] md:pb-28">
                    <div className="flex flex-col gap-3 px-2 py-2 md:hidden" aria-busy={isCurrentTabLoading}>
                        {isCurrentTabLoading ? (
                            <div className="flex flex-col gap-3" role="status" aria-label="Loading history records">
                                {[0, 1, 2].map((card) => (
                                    <div key={card} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <div className="h-9 animate-pulse rounded bg-slate-100" />
                                            <div className="h-9 animate-pulse rounded bg-slate-100" />
                                        </div>
                                    </div>
                                ))}
                                <span className="sr-only">Loading history records</span>
                            </div>
                        ) : currentList.length === 0 ? (
                            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                                <ContextualEmptyState {...currentEmptyState} />
                            </div>
                        ) : activeTab === 'sales' || activeTab === 'special-orders' ? (
                            currentItems.map((trx) => {
                                const items = Array.isArray(trx?.items) ? trx.items : [];
                                const hasCompleteQuantities = items.length > 0 && items.every((item) => item?.qty !== null && item?.qty !== undefined && String(item.qty).trim() !== '' && Number.isFinite(Number(item.qty)));
                                const quantitySold = hasCompleteQuantities ? items.reduce((sum, item) => sum + Number(item.qty), 0) : null;
                                const amount = trx?.total !== null && trx?.total !== undefined && String(trx.total).trim() !== '' && Number.isFinite(Number(trx.total)) ? Number(trx.total) : null;
                                const rawPaymentMethod = String(trx?.paymentMethod || '').trim().toLowerCase();
                                const transactionType = activeTab === 'special-orders' ? 'Special Order' : ({ cash: 'Cash', credit: 'Credit', gcash: 'GCash', cheque: 'Cheque', 'bank transfer': 'Bank Transfer', other: 'Other' }[rawPaymentMethod] || (rawPaymentMethod ? rawPaymentMethod.replace(/(^|[\s_-])\w/g, (part) => part.toUpperCase()) : ''));
                                const status = String(trx?.status || '').trim();
                                const isVoided = status.toLowerCase() === 'voided';
                                const pendingVoid = isPendingVoidRequest(trx);

                                return (
                                    <article key={trx.id} className="app-dashboard-card-hover min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                        <div className="flex min-w-0 items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Transaction ID</p>
                                                <h3 className="mt-0.5 break-all font-mono text-sm font-bold leading-5 text-slate-900">{trx.id}</h3>
                                                {activeTab === 'special-orders' && trx.specialOrderNumber && <p className="mt-1 break-words text-xs font-medium text-amber-700">{trx.specialOrderNumber}</p>}
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                                {trx.isArchived && <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Archived</span>}
                                                {status && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isVoided ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{status}</span>}
                                                {pendingVoid && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Void Request Pending</span>}
                                            </div>
                                        </div>
                                        <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3">
                                            {[
                                                { label: 'Date & time', value: formatExact(trx.date) },
                                                { label: 'Customer', value: trx.customerName },
                                                { label: 'Transaction type', value: transactionType },
                                                { label: 'Total amount', value: amount === null ? '' : `₱${formatMoney(amount)}`, valueClass: 'font-semibold tabular-nums text-slate-900' },
                                                { label: 'Quantity sold', value: quantitySold === null ? '' : quantitySold.toLocaleString() },
                                            ].filter((field) => field.value !== null && field.value !== undefined && String(field.value).trim() !== '').map((field) => (
                                                <div key={field.label} className="min-w-0">
                                                    <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{field.label}</dt>
                                                    <dd className={`mt-0.5 break-words text-xs text-slate-800 ${field.valueClass || ''}`}>{field.value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                                            {activeTab === 'sales' && (
                                                <button type="button" onClick={() => handleViewReceipt(trx)} className={`${mobileHistoryActionBaseClass} ${mobileHistoryActionClass.primary}`}>
                                                    <RecordActionIcon name={isRegularSale(trx) ? 'file-text' : 'receipt-text'} />
                                                    {isRegularSale(trx) ? 'View Order Confirmation' : 'View Receipt'}
                                                </button>
                                            )}
                                            <button type="button" onClick={() => setSelectedSaleDetails(trx)} className={`${mobileHistoryActionBaseClass} ${activeTab === 'special-orders' ? mobileHistoryActionClass.primary : mobileHistoryActionClass.secondary} ${activeTab === 'special-orders' ? 'col-span-2' : ''}`}>
                                                <RecordActionIcon name={activeTab === 'special-orders' ? 'eye' : 'file-search'} />
                                                {activeTab === 'special-orders' ? 'View Transaction' : 'Sale Details'}
                                            </button>
                                        </div>
                                    </article>
                                );
                            })
                        ) : activeTab === 'credit' ? (
                            currentItems.map((credit) => (
                                <article key={credit._id || credit.creditTransactionId} className="app-dashboard-card-hover min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                    <div className="flex min-w-0 items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Credit transaction</p>
                                            <h3 className="mt-0.5 break-all font-mono text-sm font-bold leading-5 text-slate-900">{credit.creditTransactionId}</h3>
                                        </div>
                                        {credit.status && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${creditStatusBadgeClass(credit.status)}`}>{credit.status}</span>}
                                    </div>
                                    <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3">
                                        {[
                                            { label: 'Created', value: formatExact(credit.createdAt || credit.date) },
                                            { label: 'Customer', value: credit.customerName },
                                            { label: 'Due date', value: formatOptionalDate(credit.dueDate) },
                                            { label: 'Last payment', value: formatOptionalDate(getLastPaymentDate(credit.paymentHistory)) },
                                            { label: 'Order reference', value: credit.orderReference },
                                            { label: 'Transaction type', value: 'Credit' },
                                            { label: 'Total amount', value: credit.totalAmount !== null && credit.totalAmount !== undefined && String(credit.totalAmount).trim() !== '' && Number.isFinite(Number(credit.totalAmount)) ? `₱${formatMoney(credit.totalAmount)}` : '', valueClass: 'font-semibold tabular-nums text-slate-900' },
                                        ].filter((field) => field.value !== null && field.value !== undefined && String(field.value).trim() !== '').map((field) => (
                                            <div key={field.label} className="min-w-0">
                                                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{field.label}</dt>
                                                <dd className={`mt-0.5 break-words text-xs text-slate-800 ${field.valueClass || ''}`}>{field.value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                    <div className="mt-4 border-t border-slate-100 pt-3">
                                        <button type="button" onClick={() => handleViewCreditDetails(credit)} className={`${mobileHistoryActionBaseClass} ${mobileHistoryActionClass.primary} w-full`}><RecordActionIcon name="eye" />View Details</button>
                                    </div>
                                </article>
                            ))
                        ) : (
                            currentItems.map((log, index) => {
                                const actor = getActorDisplayName(log?.userRef, log?.user);
                                const hasQuantity = log?.quantity !== null && log?.quantity !== undefined && String(log.quantity).trim() !== '' && Number.isFinite(Number(log.quantity));
                                const quantityUnit = String(log?.sellingUnit || log?.unit || '').trim();
                                const actionClass = log.action === 'ADD' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : log.action === 'DEDUCT' ? 'bg-amber-50 text-amber-700 border-amber-100' : log.action === 'UPDATE' ? 'bg-blue-50 text-blue-700 border-blue-100' : log.action === 'CREATE' ? 'bg-purple-50 text-purple-700 border-purple-100' : log.action === 'ARCHIVE' ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-gray-100 text-gray-600 border-gray-200';
                                return (
                                    <article key={log._id || `${log.code}-${log.date}-${index}`} className="app-dashboard-card-hover min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                        <div className="flex min-w-0 items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SKU</p>
                                                <h3 className="mt-0.5 break-all font-mono text-sm font-bold leading-5 text-slate-900">{log.code}</h3>
                                            </div>
                                            {log.action && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${actionClass}`}>{log.action}</span>}
                                        </div>
                                        <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3">
                                            {[
                                                { label: 'Date & time', value: formatExact(log.date || log.createdAt) },
                                                { label: 'Quantity changed', value: hasQuantity ? `${Number(log.quantity).toLocaleString()}${quantityUnit ? ` ${quantityUnit}` : ''}` : '' },
                                                { label: 'Reason / details', value: log.details, full: true },
                                                { label: 'Recorded by', value: actor },
                                            ].filter((field) => field.value !== null && field.value !== undefined && String(field.value).trim() !== '').map((field) => (
                                                <div key={field.label} className={`min-w-0 ${field.full ? 'col-span-2' : ''}`}>
                                                    <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{field.label}</dt>
                                                    <dd className="mt-0.5 break-words text-xs text-slate-800">{field.value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </article>
                                );
                            })
                        )}
                    </div>

                    <div className="hidden md:block">
                        {(activeTab === 'sales' || activeTab === 'special-orders') ? (
                            <table className={`main-data-table w-full text-left border-separate border-spacing-0 table-fixed ${activeTab === 'sales' ? 'min-w-[1200px]' : 'min-w-[920px]'}`}>
                               <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="w-[13%] py-3 px-3 text-center text-[11px] font-semibold border border-gray-700">Transaction ID</th>
                                        <th className={`py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 ${activeTab === 'special-orders' ? 'w-[16%]' : 'w-[14%]'}`}>Date & Time</th>
                                        <th className={`py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 ${activeTab === 'special-orders' ? 'w-[15%]' : 'w-[14%]'}`}>{activeTab === 'special-orders' ? 'Customer' : 'Processed By'}</th>
                                        <th className={`py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 ${activeTab === 'special-orders' ? 'w-[11%]' : 'w-[12%]'}`}>Items</th>
                                        <th className={`py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 ${activeTab === 'special-orders' ? 'w-[15%]' : 'w-[14%]'}`}>Total Amount</th>
                                        <th className={`py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 ${activeTab === 'special-orders' ? 'w-[14%]' : 'w-[15%]'}`}>{activeTab === 'special-orders' ? 'Status' : 'Payment Method'}</th>
                                        <th className={`py-3 px-2 text-center text-[11px] font-semibold border border-gray-700 ${activeTab === 'sales' ? 'w-[18%]' : 'w-[16%]'}`}>Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {isCurrentTabLoading ? (
                                        <TableSkeletonRows rowKeyPrefix="sales-history-skeleton" columnTypes={['text', 'text', 'text', 'text', 'text', 'pill', 'actions']} />
                                    ) : currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="7" className="p-3">
                                                <ContextualEmptyState {...currentEmptyState} className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white" />
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((trx) => (
                                            <tr key={trx.id} className="app-dashboard-table-row-hover border-b border-gray-200 group">
                                                <td className="py-2 px-3 text-center border border-gray-200">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <IdentifierChip>{trx.id}</IdentifierChip>
                                                        {activeTab === 'special-orders' && trx.specialOrderNumber && <span className="text-[10px] font-medium text-amber-700">{trx.specialOrderNumber}</span>}
                                                        {String(trx.status || '').toLowerCase() === 'voided' && (
                                                            <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300">
                                                                Voided
                                                            </span>
                                                        )}
                                                        {isPendingVoidRequest(trx) && (
                                                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300">
                                                                Void Request Pending
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="whitespace-nowrap py-2 px-3 text-gray-800 font-medium text-xs text-center border border-gray-200">{formatExact(trx.date)}</td>
                                                <td className="py-2 px-3 text-center border border-gray-200">
                                                    {activeTab === 'special-orders' ? <span className="text-xs font-semibold text-gray-900">{trx.customerName || '-'}</span> : <div className="flex flex-col items-center">
                                                        <span className="whitespace-nowrap text-gray-900 font-semibold text-xs leading-tight">
                                                            {getProcessorDisplayName(trx)}
                                                        </span>
                                                        <span className="text-[10px] font-medium text-gray-400 leading-tight">
                                                            {getActorRoleLabel(trx?.cashierUser, getProcessorRoleLabel(trx)) || getProcessorRoleLabel(trx)}
                                                        </span>
                                                    </div>}
                                                </td>
                                                <td className="py-2 px-3 text-gray-600 font-medium text-xs text-center border border-gray-200">
                                                    <div className="flex flex-col items-center leading-tight">
                                                        <span>{trx.items.length} items</span>
                                                        <span className="text-[10px] font-semibold text-gray-800">
                                                            {(trx.items || []).reduce((sum, item) => sum + Number(item?.qty || 0), 0)} qty sold
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-2 px-3 font-semibold text-black text-sm text-center border border-gray-200 tabular-nums">₱{formatMoney(trx.total)}</td>
                                                <td className="py-2 px-3 text-center border border-gray-200">
                                                    <span className="inline-flex whitespace-nowrap rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                                                        {activeTab === 'special-orders' ? (trx.status || 'Completed') : (trx.paymentMethod || 'Cash')}
                                                    </span>
                                                </td>
                                                <td className={`py-2 text-center border border-gray-200 ${activeTab === 'sales' ? 'px-0' : 'px-1'}`}>
                                                    <div className={`history-action-group mx-auto grid w-fit max-w-full gap-1.5 ${activeTab === 'sales' ? 'history-sales-action-group grid-cols-[max-content_max-content]' : 'grid-cols-1'}`}>
                                                        {activeTab === 'sales' && <div className="history-action-cell">
                                                            <TableActionButton
                                                                onClick={() => handleViewReceipt(trx)}
                                                                label={isRegularSale(trx) ? 'View Order Confirmation' : 'View Receipt'}
                                                                aria-label={isRegularSale(trx) ? `View Order Confirmation for ${trx.id}` : `View Receipt for ${trx.id}`}
                                                                className="history-labeled-action reference-table-action history-sales-action history-labeled-action--primary"
                                                            >
                                                                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                                                <span className="history-action-label">Confirmation</span>
                                                            </TableActionButton>
                                                        </div>}
                                                        <div className="history-action-cell">
                                                            <TableActionButton onClick={() => setSelectedSaleDetails(trx)} label={activeTab === 'special-orders' ? 'View Transaction' : 'Sale Details'} aria-label={`View ${activeTab === 'special-orders' ? 'Special Order transaction details' : 'sale details'} for ${trx.id}`} className={`history-labeled-action reference-table-action ${activeTab === 'sales' ? 'history-sales-action' : ''} ${activeTab === 'special-orders' ? 'history-labeled-action--primary' : ''}`}>
                                                                <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 4h8l3 3v13H5V4h3Zm2 7h4m-4 4h6" /></svg>
                                                                <span className="history-action-label">{activeTab === 'special-orders' ? 'View Transaction' : 'Details'}</span>
                                                            </TableActionButton>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        ) : activeTab === 'credit' ? (
                            <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[920px]">
                                <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="py-3 px-2 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Credit ID</th>
                                        <th className="py-3 px-2 w-[9%] text-center text-[11px] font-semibold border border-gray-700">Created</th>
                                        <th className="py-3 px-2 w-[9%] text-center text-[11px] font-semibold border border-gray-700">Due Date</th>
                                        <th className="py-3 px-2 w-[9%] text-center text-[11px] font-semibold border border-gray-700">Last Payment</th>
                                        <th className="py-3 px-2 w-[14%] text-center text-[11px] font-semibold border border-gray-700">Customer</th>
                                        <th className="py-3 px-2 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Order Ref</th>
                                        <th className="py-3 px-2 w-[10%] text-center text-[11px] font-semibold border border-gray-700">Total</th>
                                        <th className="py-3 px-2 w-[13%] text-center text-[11px] font-semibold border border-gray-700">Status</th>
                                        <th className="py-3 px-2 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {isCurrentTabLoading ? (
                                        <TableSkeletonRows rowKeyPrefix="credit-history-skeleton" columnTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text', 'pill', 'actions']} />
                                    ) : currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="9" className="p-3">
                                                <ContextualEmptyState {...currentEmptyState} className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white" />
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((credit) => (
                                            <tr key={credit._id} className="app-dashboard-table-row-hover border-b border-gray-200 group">
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <IdentifierChip className="!whitespace-nowrap !break-normal">{credit.creditTransactionId}</IdentifierChip>
                                                </td>
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center border border-gray-200">{formatDateShort(credit.createdAt)}</td>
                                                <td className="py-2 px-2 text-gray-700 font-medium text-xs text-center border border-gray-200">{formatDateShort(credit.dueDate)}</td>
                                                <td className="py-2 px-2 text-gray-700 font-medium text-xs text-center border border-gray-200">
                                                    {formatDateShort(getLastPaymentDate(credit.paymentHistory))}
                                                </td>
                                                <td className="py-2 px-2 text-gray-900 font-semibold text-xs text-center border border-gray-200">{credit.customerName}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">{credit.orderReference ? <IdentifierChip>{credit.orderReference}</IdentifierChip> : '-'}</td>
                                                <td className="py-2 px-2 font-semibold text-black text-sm text-center border border-gray-200 tabular-nums">₱{formatMoney(credit.totalAmount)}</td>
                                                <td className="whitespace-nowrap py-2 px-2 text-center border border-gray-200">
                                                    <span className={`inline-flex whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${creditStatusBadgeClass(credit.status)}`}>
                                                        {credit.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <TableActionButton
                                                            onClick={() => handleViewCreditDetails(credit)}
                                                            label="View Credit Details"
                                                            aria-label={`View credit transaction details for ${credit.creditTransactionId}`}
                                                            className="history-labeled-action reference-table-action history-labeled-action--primary"
                                                        >
                                                            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5 16.478 5 20.268 7.943 21.542 12c-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                                            <span className="history-action-label">View Details</span>
                                                        </TableActionButton>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        ) : (
                            <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[800px] md:min-w-0">
                                <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="w-[180px] py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 md:w-[18%]">Date & Time</th>
                                        <th className="w-[110px] py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 md:w-[15%]">Action</th>
                                        <th className="w-[130px] py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 md:w-[20%]">SKU</th>
                                        <th className="w-[240px] py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 md:w-[27%]">Details</th>
                                        <th className="w-[140px] py-3 px-3 text-center text-[11px] font-semibold border border-gray-700 md:w-[20%]">User</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {isCurrentTabLoading ? (
                                        <TableSkeletonRows rowKeyPrefix="inventory-history-skeleton" columnTypes={['text', 'pill', 'text', 'text', 'text']} />
                                    ) : currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-3">
                                                <ContextualEmptyState {...currentEmptyState} className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white" />
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((log, index) => (
                                            <tr key={index} className="app-dashboard-table-row-hover border-b border-gray-200 group">
                                                <td className="py-2 px-3 text-gray-800 font-medium text-xs text-center whitespace-nowrap border border-gray-200">{formatExact(log.date)}</td>
                                                <td className="py-2 px-3 text-center border border-gray-200">
                                                    <span className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${
                                                        log.action === 'ADD' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                        log.action === 'DEDUCT' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                                        log.action === 'UPDATE' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                        log.action === 'CREATE' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                                        log.action === 'ARCHIVE' ? 'bg-orange-50 text-orange-700 border-orange-100' :
                                                        'bg-gray-100 text-gray-600 border-gray-200'
                                                    }`}>
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 font-mono font-semibold text-black text-xs text-center border border-gray-200">{log.code || '-'}</td>
                                                <td className="py-2 px-3 text-gray-800 font-medium text-xs text-center border border-gray-200">{log.details}</td>
                                                <td className="py-2 px-3 font-medium text-gray-800 text-xs text-center border border-gray-200">{getActorDisplayName(log.userRef, log.user)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Floating Pagination Controls */}
                <div className="absolute bottom-0 left-0 right-0 z-30 w-full border-t border-gray-200 bg-slate-200/95 px-2 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm md:px-6 md:py-3 dark:border-gray-700 dark:bg-slate-800/90">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            Showing <span className="font-semibold text-gray-900 dark:text-white">{displayStart}</span> to <span className="font-semibold text-gray-900 dark:text-white">{displayEnd}</span> of <span className="font-semibold text-gray-900 dark:text-white">{currentList.length}</span> results
                        </div>
                        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
                    </div>
                </div>


            </div>
            </div>

            {isCreditDetailsOpen && selectedCredit && (
                <div className="app-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                            <div>
                                <h3 className="font-semibold text-gray-900">Credit Transaction Details</h3>
                                <p className="text-xs text-gray-500">{selectedCredit.creditTransactionId} - {selectedCredit.customerName}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">Order: {selectedCredit.orderReference || '-'} | Cashier: {getCreditProcessorDisplayName(selectedCredit)}</p>
                            </div>
                            <button
                                onClick={() => {
                                    setIsCreditDetailsOpen(false);
                                    setSelectedCredit(null);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                Close
                            </button>
                        </div>
                        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
                            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2 text-sm">
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total</p>
                                    <p className="font-semibold text-gray-900">₱{formatMoney(selectedCredit.totalAmount)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Down Payment</p>
                                    <p className="font-semibold text-gray-900">{getDownPayment(selectedCredit) ? `₱${formatMoney(getDownPayment(selectedCredit).amount)}` : '—'}</p>
                                    {getDownPayment(selectedCredit)?.method && <p className="mt-0.5 text-[10px] capitalize text-gray-500">{getDownPayment(selectedCredit).method}</p>}
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Paid</p>
                                    <p className="font-semibold text-gray-900">₱{formatMoney(selectedCredit.amountPaid)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Remaining</p>
                                    <p className="font-semibold text-gray-900">₱{formatMoney(selectedCredit.remainingBalance)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Due Date</p>
                                    <p className="font-semibold text-gray-900">{formatDateShort(selectedCredit.dueDate)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Created</p>
                                    <p className="font-semibold text-gray-900">{formatDateShort(selectedCredit.createdAt)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Last Payment</p>
                                    <p className="font-semibold text-gray-900">
                                        {formatDateShort(getLastPaymentDate(selectedCredit.paymentHistory))}
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                <span className="font-semibold uppercase tracking-wider text-gray-500">Payment Type:</span> Credit
                                <span className="mx-2 text-gray-300">|</span>
                                <span className="font-semibold uppercase tracking-wider text-gray-500">Latest Payment Method:</span> {getCreditPaymentMethod(selectedCredit)}
                            </div>

                            <div>
                                <h4 className="text-xs font-semibold tracking-wider text-gray-500 mb-2">Order Items</h4>
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                                                <th className="px-2 py-1.5">Item</th>
                                                <th className="px-2 py-1.5 text-center">Qty</th>
                                                <th className="px-2 py-1.5 text-right">Unit</th>
                                                <th className="px-2 py-1.5 text-right">Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(selectedCredit.orderId?.items || []).length === 0 ? (
                                                <tr>
                                                    <td className="px-2 py-3 text-gray-500 text-center" colSpan={4}>No order items available.</td>
                                                </tr>
                                            ) : (
                                                (selectedCredit.orderId?.items || []).map((item, idx) => (
                                                    <tr key={`${item.code || item.name || 'item'}-${idx}`} className="border-b border-gray-100">
                                                        <td className="px-2 py-1.5">
                                                            <div className="font-semibold text-gray-900">{getHistoryProductDisplayName(item)}</div>
                                                            <div className="text-[10px] text-gray-500">{item.code || '-'}</div>
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center font-semibold">{item.quantity}</td>
                                                        <td className="px-2 py-1.5 text-right">₱{formatMoney(item.unitPrice)}</td>
                                                        <td className="px-2 py-1.5 text-right font-semibold">₱{formatMoney(item.subtotal)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-xs font-semibold tracking-wider text-gray-500 mb-2">Payment History</h4>
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                                                <th className="px-2 py-1.5">Date</th>
                                                <th className="px-2 py-1.5">Amount</th>
                                                <th className="px-2 py-1.5">Type</th>
                                                <th className="px-2 py-1.5">Method</th>
                                                <th className="px-2 py-1.5">Recorded By</th>
                                                <th className="px-2 py-1.5">Note</th>
                                                <th className="px-2 py-1.5">Evidence</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(selectedCredit.paymentHistory || []).length === 0 ? (
                                                <tr>
                                                    <td className="px-2 py-3 text-gray-500 text-center" colSpan={7}>No payments recorded yet.</td>
                                                </tr>
                                            ) : (
                                                selectedCredit.paymentHistory.map((payment, idx) => (
                                                    <tr key={`${payment.paymentDate || 'date'}-${idx}`} className="border-b border-gray-100">
                                                        <td className="px-2 py-1.5">{payment.paymentDate ? new Date(payment.paymentDate).toLocaleString() : '-'}</td>
                                                        <td className="px-2 py-1.5 font-semibold">₱{formatMoney(payment.amount)}</td>
                                                        <td className="px-2 py-1.5">{getCreditPaymentEventLabel(selectedCredit, payment, idx)}</td>
                                                        <td className="px-2 py-1.5 uppercase">{payment.method || '-'}</td>
                                                        <td className="px-2 py-1.5">{getActorDisplayName(payment.recordedByUser || payment.recordedById, payment.recordedBy, '-')}</td>
                                                        <td className="px-2 py-1.5">{payment.note || '-'}</td>
                                                        <td className="px-2 py-1.5">{payment.clientRequestId && (payment.proofs?.length || payment.proof?.storageKey) ? (payment.proofs?.length ? payment.proofs : [payment.proof]).map((proof, index) => <button key={`${proof.storageKey}-${index}`} type="button" onClick={() => viewCreditEvidence({ payment, index })} className="mr-1 text-slate-800 underline focus-visible:ring-2 focus-visible:ring-slate-700">View {index + 1}</button>) : '—'}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {String(selectedCredit.status || '').toLowerCase() === 'cancelled' && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"><p className="font-semibold text-slate-900">Cancellation</p><p className="mt-1">Reason: {selectedCredit.cancelReason || '—'}</p>{(selectedCredit.cancelProofs || []).map((proof, index) => <button key={`${proof.storageKey}-${index}`} type="button" onClick={() => viewCreditEvidence({ cancellation: true, index })} className="mr-2 mt-2 text-slate-800 underline focus-visible:ring-2 focus-visible:ring-slate-700">View Cancellation Proof {index + 1}</button>)}</div>}
                        </div>
                    </div>
                </div>
            )}


            {selectedSaleDetails && !isSaleDetailsChildActive && (
                <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div role="dialog" aria-modal="true" aria-label={isSpecialOrderSale(selectedSaleDetails) ? 'Special Order transaction details' : 'Sale details'} onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#202225]">
                        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{isSpecialOrderSale(selectedSaleDetails) ? 'Special Order Transaction Details' : 'Sale Details'}</h3>
                                    {String(selectedSaleDetails.status || '').toLowerCase() === 'voided' && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300">Voided</span>}
                                </div>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedSaleDetails.id}</p>
                            </div>
                            <button type="button" onClick={() => setSelectedSaleDetails(null)} className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white">Close</button>
                        </div>
                        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div><p className="text-slate-500 dark:text-slate-400">Date</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{formatExact(selectedSaleDetails.date)}</p></div>
                                <div><p className="text-slate-500 dark:text-slate-400">Payment</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{selectedSaleDetails.paymentMethod}</p></div>
                                <div><p className="text-slate-500 dark:text-slate-400">Processed By</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{getProcessorDisplayName(selectedSaleDetails)}</p></div>
                                <div><p className="text-slate-500 dark:text-slate-400">Total</p><p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">₱{formatMoney(selectedSaleDetails.total)}</p></div>
                            </div>
                            {isSpecialOrderSale(selectedSaleDetails) && <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/30"><div><p className="text-slate-500 dark:text-slate-400">Customer</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{selectedSaleDetails.customerName || 'Not recorded'}</p></div><div><p className="text-slate-500 dark:text-slate-400">Special Order Reference</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{selectedSaleDetails.specialOrderNumber || 'Not recorded'}</p></div><div><p className="text-slate-500 dark:text-slate-400">Linked Sales Transaction</p><p className="mt-1 break-all font-medium text-slate-900 dark:text-slate-100">{selectedSaleDetails.id}</p></div>{selectedSaleDetails.specialOrderQuotationVersion && <div><p className="text-slate-500 dark:text-slate-400">Quotation Reference</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">Version {selectedSaleDetails.specialOrderQuotationVersion}</p></div>}<div><p className="text-slate-500 dark:text-slate-400">Financial Sale</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">Recorded</p></div>{selectedSaleDetails.specialOrderFulfillmentStatus && <div><p className="text-slate-500 dark:text-slate-400">{selectedSaleDetails.specialOrderFulfillmentStatus === 'Administrative Closure' ? 'Order Closure' : 'Fulfillment'}</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{selectedSaleDetails.specialOrderFulfillmentStatus}</p></div>}<div><p className="text-slate-500 dark:text-slate-400">Record Status</p><p className="mt-1 font-medium text-slate-900 dark:text-slate-100">{selectedSaleDetails.status || 'Completed'}</p></div></div>}
                            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Transaction Reference</h4>
                                        {selectedSaleDetails.transactionReference?.correctionHistory?.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">Corrected</span>}
                                    </div>
                                    {!isSpecialOrderSale(selectedSaleDetails) && selectedSaleDetails.sourceId && String(selectedSaleDetails.status || '').toLowerCase() !== 'voided' && !selectedSaleDetails.transactionReference?.referenceNumber && !selectedSaleDetails.transactionReference?.supportingDocument && <button type="button" onClick={() => setIsEditingSaleReference(true)} className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">Add Reference</button>}
                                    {!isSpecialOrderSale(selectedSaleDetails) && selectedSaleDetails.sourceId && String(selectedSaleDetails.status || '').toLowerCase() !== 'voided' && isAdminOrAbove() && (selectedSaleDetails.transactionReference?.referenceNumber || selectedSaleDetails.transactionReference?.supportingDocument) && <button type="button" onClick={() => setIsCorrectingSaleReference(true)} className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">Correct Reference</button>}
                                </div>
                                {selectedSaleDetails.transactionReference?.referenceNumber && <p className="mt-2 text-xs text-slate-700 dark:text-slate-200"><span className="text-slate-500 dark:text-slate-400">Invoice No.</span> {selectedSaleDetails.transactionReference.referenceNumber}</p>}
                                {selectedSaleDetails.transactionReference?.supportingDocument && <button type="button" onClick={viewSaleDocument} className="mt-2 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 dark:text-slate-200">View Supporting Document</button>}
                                {isAdminOrAbove() && selectedSaleDetails.transactionReference?.correctionHistory?.length > 0 && <button type="button" onClick={() => setIsCorrectionHistoryOpen(true)} className="ml-3 mt-2 text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">View correction history</button>}
                                {!selectedSaleDetails.sourceId && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Reference details can be added after this sale syncs.</p>}
                                {String(selectedSaleDetails.status || '').toLowerCase() === 'voided' && <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Reference metadata is preserved and read-only after voiding.</p>}
                            </div>
                            {selectedSaleDetails.voidRequest && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/30">
                                    <div className="flex items-center justify-between gap-3">
                                        <h4 className="font-semibold text-slate-800 dark:text-slate-200">Void Request</h4>
                                        <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">{selectedSaleDetails.voidRequest.status}</span>
                                    </div>
                                    <p className="mt-2 text-slate-600 dark:text-slate-300">{selectedSaleDetails.voidRequest.reason}</p>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{selectedSaleDetails.voidRequest.requestedByName} · {formatExact(selectedSaleDetails.voidRequest.requestedAt)}</p>
                                    {selectedSaleDetails.voidRequest.status === 'pending' && userRole === ROLES.CASHIER && <p className="mt-2 font-medium text-slate-600 dark:text-slate-300">Void request pending</p>}
                                    {(selectedSaleDetails.voidRequest.supportingProofs?.length ? selectedSaleDetails.voidRequest.supportingProofs : selectedSaleDetails.voidRequest.supportingProof ? [selectedSaleDetails.voidRequest.supportingProof] : []).map((proof, index) => <button key={`${proof.originalName}-${index}`} type="button" onClick={() => viewSaleVoidProof('request', index)} className="mr-2 mt-2 font-medium text-slate-700 underline underline-offset-2 dark:text-slate-200">View Request Proof {index + 1}</button>)}
                                </div>
                            )}
                            <div className="border-t border-slate-200 pt-3 dark:border-slate-700"><h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Items</h4>{(selectedSaleDetails.items || []).map((item, index) => <div key={`${item.code || item.name}-${index}`} className="flex justify-between gap-3 border-b border-slate-100 py-2 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-200"><span>{getHistoryProductDisplayName(item)} × {item.qty}{item.sellingUnit ? ` ${item.sellingUnit}` : ''}{isSpecialOrderSale(selectedSaleDetails) ? ` · ₱${formatMoney(item.price)} each` : ''}</span><span className="shrink-0">₱{formatMoney(item.subtotal ?? item.qty * item.price)}</span></div>)}</div>
                            {String(selectedSaleDetails.status || '').toLowerCase() === 'voided' && (
                                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-xs dark:border-rose-900/60 dark:bg-rose-950/20">
                                    <h4 className="font-semibold text-rose-800 dark:text-rose-200">Void Record</h4>
                                    <dl className="mt-2 space-y-1.5 text-slate-600 dark:text-slate-300">
                                        <div className="flex justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">Voided At</dt><dd className="text-right">{formatExact(selectedSaleDetails.voidInfo?.voidedAt)}</dd></div>
                                        <div className="flex justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">Voided By</dt><dd className="text-right">{selectedSaleDetails.voidInfo?.voidedByName || '-'}</dd></div>
                                        <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-slate-500 dark:text-slate-400">Reason</dt><dd className="break-words text-right">{selectedSaleDetails.voidInfo?.reason || '-'}</dd></div>
                                        {(selectedSaleDetails.voidInfo?.supportingProofs?.length || selectedSaleDetails.voidInfo?.supportingProof) && (
                                            <div className="flex items-start justify-between gap-3">
                                                <dt className="shrink-0 text-slate-500 dark:text-slate-400">Supporting Proof</dt>
                                                <dd className="min-w-0 text-right">
                                                    {(selectedSaleDetails.voidInfo.supportingProofs?.length ? selectedSaleDetails.voidInfo.supportingProofs : [selectedSaleDetails.voidInfo.supportingProof]).map((proof, index) => <button key={`${proof.originalName}-${index}`} type="button" onClick={() => viewSaleVoidProof('void', index)} className="ml-2 mt-1 font-medium text-rose-700 underline underline-offset-2 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-200">View Void Proof {index + 1}</button>)}
                                                </dd>
                                            </div>
                                        )}
                                    </dl>
                                </div>
                            )}
                        </div>
                        {!isSpecialOrderSale(selectedSaleDetails) && (canVoidSale(selectedSaleDetails) || canRequestVoid(selectedSaleDetails)) && (
                            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
                                {isAdminOrAbove() && selectedSaleDetails.voidRequest?.status === 'pending' && <button type="button" onClick={declineVoidRequest} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#202225] dark:text-slate-200 dark:hover:bg-slate-800">Decline</button>}
                                <button type="button" onClick={openVoidModal} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:border-rose-900/70 dark:bg-[#202225] dark:text-rose-300 dark:hover:bg-rose-950/30">
                                    {userRole === ROLES.CASHIER ? 'Request Void' : 'Void Transaction'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {isEditingSaleReference && !isSpecialOrderSale(selectedSaleDetails) && selectedSaleDetails?.sourceId && String(selectedSaleDetails.status || '').toLowerCase() !== 'voided' && (
                <TransactionReferenceModal saleId={selectedSaleDetails.sourceId} initialReference={selectedSaleDetails.transactionReference} saveLabel="Save Reference" onSkip={() => setIsEditingSaleReference(false)} onSaved={(updated) => {
                    setSelectedSaleDetails((previous) => ({ ...previous, transactionReference: updated.transactionReference }));
                    setTransactions((previous) => previous.map((transaction) => transaction.sourceId === updated.sourceId ? { ...transaction, transactionReference: updated.transactionReference } : transaction));
                    setIsEditingSaleReference(false);
                }} />
            )}
            {isCorrectingSaleReference && !isSpecialOrderSale(selectedSaleDetails) && selectedSaleDetails?.sourceId && (
                <TransactionReferenceCorrectionModal
                    saleId={selectedSaleDetails.sourceId}
                    currentReference={selectedSaleDetails.transactionReference}
                    onClose={() => setIsCorrectingSaleReference(false)}
                    onSaved={(updated) => {
                        setSelectedSaleDetails(updated);
                        setTransactions((previous) => previous.map((transaction) => transaction.sourceId === updated.sourceId ? updated : transaction));
                        setIsCorrectingSaleReference(false);
                        showToast('Reference Corrected', `${updated.id} now shows the corrected evidence.`, 'success', 'sale-reference-corrected');
                    }}
                />
            )}
            {isCorrectionHistoryOpen && !documentPreview && selectedSaleDetails?.transactionReference?.correctionHistory?.length > 0 && (
                <div className="app-modal-backdrop fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
                    <div role="dialog" aria-modal="true" aria-labelledby="correction-history-title" onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-xl dark:border-slate-700/80 dark:bg-[#24262a]">
                        <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
                            <h3 id="correction-history-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">Correction History</h3>
                            <button type="button" onClick={() => setIsCorrectionHistoryOpen(false)} className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">Close</button>
                        </div>
                        <div className="space-y-3 overflow-y-auto px-5 py-4">
                            {selectedSaleDetails.transactionReference.correctionHistory.map((entry, index) => (
                                <div key={`${entry.correctedAt}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-[#2d3035]">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div><p className="text-slate-500 dark:text-slate-400">Previous Invoice No.</p><p className="mt-1 break-all text-slate-800 dark:text-slate-100">{entry.previousReferenceNumber || 'Document only'}</p></div>
                                        <div><p className="text-slate-500 dark:text-slate-400">Corrected Invoice No.</p><p className="mt-1 break-all text-slate-800 dark:text-slate-100">{entry.correctedReferenceNumber || 'Document only'}</p></div>
                                    </div>
                                    <p className="mt-3 text-slate-600 dark:text-slate-300"><span className="text-slate-500 dark:text-slate-400">Reason:</span> {entry.reason}</p>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{entry.correctedByName} · {formatExact(entry.correctedAt)}</p>
                                    <div className="mt-2 flex flex-wrap gap-3">
                                        {entry.previousSupportingDocument && <button type="button" onClick={() => viewCorrectionDocument(index, 'previous', entry.previousSupportingDocument)} className="font-medium text-slate-600 underline underline-offset-2 dark:text-slate-300">View original document</button>}
                                        {entry.correctedSupportingDocument && (!entry.previousSupportingDocument || String(entry.correctedSupportingDocument.uploadedAt || '') !== String(entry.previousSupportingDocument.uploadedAt || '')) && <button type="button" onClick={() => viewCorrectionDocument(index, 'corrected', entry.correctedSupportingDocument)} className="font-medium text-slate-600 underline underline-offset-2 dark:text-slate-300">View corrected document</button>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {isVoidModalOpen && selectedSaleDetails && (
                <div className="app-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
                    <div role="dialog" aria-modal="true" aria-labelledby="void-sale-title" onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] dark:border-slate-700/80 dark:bg-[#24262a] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)]">
                        <div className="border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/70">
                            <h3 id="void-sale-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{userRole === ROLES.CASHIER ? 'Request Void' : 'Void Transaction'}</h3>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedSaleDetails.id}</p>
                        </div>
                        <div className="space-y-3 overflow-y-auto px-5 py-4">
                            <p className="text-sm leading-5 text-slate-700 dark:text-slate-200">{userRole === ROLES.CASHIER ? 'Submit this Sale for Admin review.' : 'This permanently voids the Sale and restores the exact sold quantities to inventory.'}</p>
                            <label className="block">
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Reason for voiding</span>
                                <textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} maxLength={500} rows={4} disabled={isVoidSubmitting} placeholder="Enter the reason for voiding this Sale" className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300/40 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70 dark:border-slate-600/80 dark:bg-[#2d3035] dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-500/25 dark:disabled:bg-[#292c30]" />
                            </label>
                            <EvidenceUploadField id="sale-void-proof" label="Supporting Proof" files={voidProofFiles} onChange={setVoidProofFiles} maxFiles={3} allowedTypes={['image/jpeg', 'image/png', 'application/pdf']} disabled={isVoidSubmitting} />
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-200/70 px-5 py-3 dark:border-slate-700/70">
                            <button type="button" onClick={closeVoidModal} disabled={isVoidSubmitting} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 dark:border-slate-600 dark:bg-[#2d3035] dark:text-slate-200 dark:hover:bg-[#373a40]">Cancel</button>
                            <button type="button" onClick={confirmVoidSale} disabled={!voidReason.trim() || isVoidSubmitting} className="rounded-lg border border-rose-700 bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:border-rose-300 disabled:bg-rose-300 dark:border-rose-800 dark:bg-rose-800 dark:hover:bg-rose-700 dark:disabled:border-rose-950 dark:disabled:bg-rose-950/60 dark:disabled:text-rose-400">{isVoidSubmitting ? (userRole === ROLES.CASHIER ? 'Submitting...' : 'Voiding...') : (userRole === ROLES.CASHIER ? 'Submit Request' : 'Void Transaction')}</button>
                        </div>
                    </div>
                </div>
            )}
            {documentPreview && <div className="app-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Supporting Document preview"><img src={documentPreview.url} alt={documentPreview.name} className="max-h-[85vh] max-w-full rounded-lg object-contain" /><button type="button" onClick={() => setDocumentPreview(null)} className="absolute right-5 top-5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-900">Close</button></div>}
            {voidProofPreview && (
                <div className="app-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Supporting Proof preview">
                    {voidProofPreview.mimeType === 'application/pdf'
                        ? <iframe src={voidProofPreview.url} title={voidProofPreview.name} className="h-[85vh] w-full max-w-4xl rounded-lg bg-white" />
                        : <img src={voidProofPreview.url} alt={voidProofPreview.name} className="max-h-[85vh] max-w-full rounded-lg object-contain" />}
                    <button type="button" onClick={() => setVoidProofPreview(null)} className="absolute right-5 top-5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-900">Close</button>
                </div>
            )}
            {showReceipt && selectedTransaction && (
                isOrderConfirmation ? (
                    <OrderConfirmationModal
                        transaction={selectedTransaction}
                        settings={appSettings}
                        inventory={processedInventory}
                        categories={productCategories}
                        readOnly
                        onContinue={() => {
                            setShowReceipt(false);
                            setAutoReceiptMode(null);
                        }}
                    />
                ) : (
                    <ReceiptPreviewModal
                        transaction={selectedTransaction}
                        settings={appSettings}
                        isOrderConfirmation={false}
                        subtitle={isAutoReceipt ? 'Payment confirmed. Receipt generated.' : 'Official record copy'}
                        isReprint={!isAutoReceipt}
                        printStatus={printStatus}
                        printLabel="Reprint"
                        printedLabel="Printed!"
                        contentId="history-receipt-content"
                        onClose={() => {
                            setShowReceipt(false);
                            setAutoReceiptMode(null);
                        }}
                        onPrint={handlePrint}
                    />
                )
            )}

        </div>
    );
};

export default History;
