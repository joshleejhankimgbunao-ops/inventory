import React, { useState, useMemo, useEffect, useRef } from 'react';
import Pagination from '../components/Pagination';
import IdentifierChip from '../components/IdentifierChip';
import ArchiveIcon from '../components/ArchiveIcon';
import ToolbarDropdown from '../components/ToolbarDropdown';
import { useLocation } from 'react-router-dom';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { getCreditTransactionByIdApi, listCreditTransactionsApi } from '../services/inventoryApi';
import { printReceipt } from '../services/receiptPrinter';
import { formatMoney as formatMoneyValue } from '../utils/numberFormat';
import { getActorDisplayName, getActorRoleLabel } from '../utils/actorDisplay';

const History = () => {
    const location = useLocation();
    const historyListRef = useRef(null);
    const { userRole, currentUserName, appSettings, isAdminOrAbove, ROLES } = useAuth();
    const { 
        transactions, 
        setTransactions, 
        processedInventory,
        inventoryLogs, 
        setInventoryLogs,
        handleResetHistory,
        isTransactionsLoading,
        isInventoryLogsLoading,
    } = useInventory();

    const currentUser = currentUserName;
    const adminName = appSettings.adminDisplayName;
    const onResetHistory = handleResetHistory;

    const [creditTransactions, setCreditTransactions] = useState([]);
    const [isCreditLoading, setIsCreditLoading] = useState(false);

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

    // Internal handler for archiving
    const onArchiveTransaction = (id) => {
        setTransactions(prev => prev.map(t => t.id === id ? { ...t, isArchived: !t.isArchived } : t));
    };

    const [activeTab, setActiveTab] = useState('sales');
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showArchived, setShowArchived] = useState(false);
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

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchTerm]);

    useEffect(() => {
        let isMounted = true;
        const loadCredits = async () => {
            setIsCreditLoading(true);
            try {
                const rows = await listCreditTransactionsApi({ status: 'All' });
                if (isMounted) {
                    setCreditTransactions(Array.isArray(rows) ? rows : []);
                }
            } catch (error) {
                showToast('Load Failed', error.message || 'Unable to load credit transactions.', 'error', 'credit-history-load');
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
    }, []);

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

                const name = String(item?.name || '').trim();
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
    }, [transactions]);

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
                .map((row) => String(row?.cashierName || '').trim())
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
                [item?.code, item?.name]
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
    }, [transactions, inventoryLogs, creditTransactions]);
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

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
            // Archive Filter
            if (activeTab === 'sales') {
               if (showArchived) {
                   if (!trx.isArchived) return false;
               } else {
                   if (trx.isArchived) return false;
               }
            }
            
            return matchesSearch && matchesDate && matchesProduct && matchesCategory;
        });
    }, [transactions, debouncedSearchTerm, dateRange, specificDate, customStartDate, customEndDate, showArchived, activeTab, processedByFilter, userRole, productFilter, categoryFilter]);

    const salesSummary = useMemo(() => {
        const summary = {
            totalSoldQty: 0,
            matchingTransactions: filteredTransactions.length,
        };

        filteredTransactions.forEach((trx) => {
            (trx?.items || []).forEach((item) => {
                const productMatch = productFilter === 'ALL' || String(item?.code || '').trim() === productFilter;
                const categoryMatch = categoryFilter === 'ALL' || resolveItemCategory(item) === categoryFilter;

                if (!productMatch || !categoryMatch) return;

                summary.totalSoldQty += Number(item?.qty || 0);
            });
        });

        return summary;
    }, [filteredTransactions, productFilter, categoryFilter]);

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
                || String(credit?.cashierName || '').toLowerCase().includes(searchNeedle);

            if (creditStatusFilter !== 'All') {
                const status = String(credit?.status || '').trim();
                if (status !== creditStatusFilter) return false;
            }

            if (creditCustomerFilter !== 'ALL') {
                const customer = String(credit?.customerName || '').trim();
                if (customer !== creditCustomerFilter) return false;
            }

            if (creditProcessedByFilter !== 'ALL') {
                const cashier = String(credit?.cashierName || '').trim();
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
    }, [activeTab, debouncedSearchTerm, filterAction, processedByFilter, inventoryProcessedByFilter, sortOrder, dateRange, specificDate, customStartDate, customEndDate, productFilter, categoryFilter, creditStatusFilter, creditCustomerFilter, creditProcessedByFilter]);

    useEffect(() => {
        if (!historyListRef.current) return;
        historyListRef.current.scrollTop = 0;
    }, [currentPage]);

    // Pagination Logic
    const currentList = activeTab === 'sales'
        ? filteredTransactions
        : (activeTab === 'credit' ? filteredCredits : filteredLogs);
    const isCurrentTabLoading = activeTab === 'sales'
        ? isTransactionsLoading
        : (activeTab === 'credit' ? isCreditLoading : isInventoryLogsLoading);
    const totalPages = Math.ceil(currentList.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    
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
    const [showReceipt, setShowReceipt] = useState(false);
    const [printStatus, setPrintStatus] = useState('idle');
    const printRequestInFlightRef = useRef(false);
    const [selectedCredit, setSelectedCredit] = useState(null);
    const [isCreditDetailsOpen, setIsCreditDetailsOpen] = useState(false);

    // Archive Modal State
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [transactionToArchive, setTransactionToArchive] = useState(null);
    const autoReceiptHandledRef = useRef(false);
    const [autoReceiptMode, setAutoReceiptMode] = useState(null);

    const toggleArchive = (trx) => {
        setTransactionToArchive(trx);
        setIsArchiveModalOpen(true);
    };

    const confirmArchive = () => {
        if (!transactionToArchive) return;
        
        if (onArchiveTransaction) {
            onArchiveTransaction(transactionToArchive.id);
            if (transactionToArchive.isArchived) {
                showToast('Restored', `Transaction ${transactionToArchive.id} restored successfully.`, 'save', 'archive-restore');
            } else {
                showToast('Archived', `Transaction ${transactionToArchive.id} archived successfully.`, 'error', 'archive-delete');
            }
        }
        
        setIsArchiveModalOpen(false);
        setTransactionToArchive(null);
    };

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

    const getLastPaymentDate = (payments) => {
        if (!Array.isArray(payments) || payments.length === 0) return '';
        const latest = payments
            .map((payment) => new Date(payment?.paymentDate || 0).getTime())
            .filter((value) => Number.isFinite(value) && value > 0)
            .sort((a, b) => b - a)[0];
        return latest ? new Date(latest) : '';
    };

    const creditStatusBadgeClass = (status) => {
        const value = String(status || '').toLowerCase();
        if (value === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
        if (value === 'overdue') return 'bg-rose-50 text-rose-700 border-rose-100';
        if (value === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-100';
        if (value === 'partially paid') return 'bg-amber-50 text-amber-700 border-amber-100';
        return 'bg-gray-100 text-gray-600 border-gray-200';
    };

    const handleViewReceipt = (transaction) => {
        setSelectedTransaction(transaction);
        setShowReceipt(true);
        setAutoReceiptMode(null);
    };

    const handleViewCreditDetails = async (credit) => {
        if (!credit?._id) return;
        try {
            const detail = await getCreditTransactionByIdApi(credit._id);
            setSelectedCredit(detail);
            setIsCreditDetailsOpen(true);
        } catch (error) {
            showToast('Load Failed', error.message || 'Unable to load credit transaction details.', 'error', 'credit-history-details');
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
    const isCreditReceipt = String(selectedTransaction?.paymentMethod || '').toLowerCase() === 'credit';
    const hasSavedCash = selectedTransaction?.cash !== null
        && selectedTransaction?.cash !== undefined
        && selectedTransaction?.cash !== ''
        && Number.isFinite(Number(selectedTransaction.cash));
    const hasSavedChange = selectedTransaction?.change !== null
        && selectedTransaction?.change !== undefined
        && selectedTransaction?.change !== ''
        && Number.isFinite(Number(selectedTransaction.change));

    const handlePrint = async () => {
        if (!selectedTransaction || printRequestInFlightRef.current) {
            return;
        }

        printRequestInFlightRef.current = true;
        setPrintStatus('printing');
        try {
            await printReceipt({
                transaction: selectedTransaction,
                settings: appSettings,
                isReprint: !isAutoReceipt,
                elementId: 'history-receipt-content',
                paperWidthMm: 58,
            });

            setPrintStatus('success');
            showToast(
                'Print Success',
                'Receipt sent to the thermal printer.',
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
            showToast('Print Failed', error?.message || 'Unable to reprint receipt.', 'error', 'history-print-error');
        }
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col md:overflow-hidden gap-2">
            <div className="relative bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 md:flex-1 flex flex-col md:overflow-hidden">
                {/* Header + Controls */}
                <div className="p-4 flex flex-col gap-5 md:shrink-0">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                            <p className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">History Logs</p>
                            <p className="text-gray-500 dark:text-gray-400 text-[11px] md:text-xs font-medium mt-1">Review past transactions and inventory movements</p>
                        </div>

                        {/* Section Selector */}
                        <div className="flex items-center gap-2">
                            <ToolbarDropdown
                                value={activeTab}
                                onChange={setActiveTab}
                                ariaLabel="Select history log type"
                                className="w-full sm:w-48"
                                options={[
                                    { value: 'sales', label: 'Sales Transactions' },
                                    { value: 'credit', label: 'Credit Transactions' },
                                    ...(isAdminOrAbove() ? [{ value: 'inventory', label: 'Inventory Logs' }] : []),
                                ]}
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        {/* Search */}
                        <div className="main-toolbar-search group">
                            <input 
                                type="text" 
                                placeholder={activeTab === 'sales'
                                    ? "Search Transaction ID..."
                                    : (activeTab === 'credit' ? "Search Credit ID / Customer..." : "Search SKU...")}
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

                        {/* Combined Filter & Sort Button + Archived Toggle */}
                        <div className="relative z-30 w-full sm:w-auto flex items-center gap-2">
                            <button
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                className="px-3 py-2 rounded-xl font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 text-white border-gray-900 hover:opacity-90"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                                <span>Filter & Sort</span>
                                <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>

                            {activeTab === 'sales' && (
                                <button
                                    type="button"
                                    onClick={() => setShowArchived(!showArchived)}
                                    className={`group flex items-center rounded-lg border px-2.5 py-2 transition-all duration-300 ${showArchived ? 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200' : 'border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400'}`}
                                    title={showArchived ? 'Back to Active Logs' : 'View Archive'}
                                >
                                    {showArchived ? (
                                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7M3 12h13a5 5 0 010 10h-1"></path></svg>
                                    ) : (
                                        <ArchiveIcon className="w-4 h-4 shrink-0" />
                                    )}
                                    <span className={`ml-0 max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold opacity-0 transition-all duration-300 group-hover:ml-2 group-hover:opacity-100 ${showArchived ? 'group-hover:max-w-40' : 'group-hover:max-w-28'}`}>
                                        {showArchived ? 'Back to Active Logs' : 'View Archive'}
                                    </span>
                                </button>
                            )}

                            {/* Filter Panel */}
                            {isFilterPanelOpen && (
                                <div className="absolute top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-50 right-0 md:left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[50vh] sm:max-h-[56vh] overflow-y-auto overscroll-contain">

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

                                    {/* Staff Filter (Sales tab, Admin only) */}
                                    {activeTab === 'sales' && isAdminOrAbove() && (
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

                                    {activeTab === 'sales' && (
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

                        {activeTab === 'sales' && (
                            <div className="ml-auto flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                                    Total Transactions: <span className="font-semibold text-gray-900 ml-1">{salesSummary.matchingTransactions}</span>
                                </span>
                                <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                                    Sold Qty: <span className="font-semibold text-emerald-800 ml-1">{salesSummary.totalSoldQty}</span>
                                </span>
                            </div>
                        )}

                        {/* Backdrop */}
                        {isFilterPanelOpen && (
                            <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                        )}
                </div>
                {/* Content Area */}
                <div ref={historyListRef} className="w-full pb-32 pt-0 overflow-x-hidden md:flex-1 md:overflow-y-auto md:max-h-[calc(100vh-220px)] md:pb-28">
                        {activeTab === 'sales' ? (
                            <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[800px]">
                               <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="py-3 px-3 w-[13%] text-center text-[11px] font-semibold border border-gray-700">Transaction ID</th>
                                        <th className="py-3 px-3 w-[17%] text-center text-[11px] font-semibold border border-gray-700">Date & Time</th>
                                        <th className="py-3 px-3 w-[14%] text-center text-[11px] font-semibold border border-gray-700">Processed By</th>
                                        <th className="py-3 px-3 w-[13%] text-center text-[11px] font-semibold border border-gray-700">Items</th>
                                        <th className="py-3 px-3 w-[16%] text-center text-[11px] font-semibold border border-gray-700">Total Amount</th>
                                        <th className="py-3 px-3 w-[13%] text-center text-[11px] font-semibold border border-gray-700">Payment Method</th>
                                        <th className="py-3 px-3 w-[14%] text-center text-[11px] font-semibold border border-gray-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="7" className="p-8 text-center">
                                                <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-3xl p-8 bg-gray-50/50">
                                                    <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                                                        </svg>
                                                    </div>
                                                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                                        {isCurrentTabLoading ? 'Loading sales history...' : (searchTerm ? 'No transactions found' : 'No sales recorded')}
                                                    </h3>
                                                    <p className="text-gray-500 text-sm max-w-md mx-auto">
                                                        {isCurrentTabLoading
                                                            ? 'Fetching sales records from backend. Please wait a moment.'
                                                            : (searchTerm 
                                                            ? `We couldn't find any transactions matching "${searchTerm}". Try a different ID or keyword.`
                                                            : 'Sales transactions will appear here once you process payments in the POS system.'
                                                            )}
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((trx) => (
                                            <tr key={trx.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors duration-200 group">
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <IdentifierChip>{trx.id}</IdentifierChip>
                                                </td>
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center border border-gray-200">{formatExact(trx.date)}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-gray-900 font-semibold text-xs leading-tight">
                                                            {getProcessorDisplayName(trx)}
                                                        </span>
                                                        <span className="text-[10px] font-medium text-gray-400 leading-tight">
                                                            {getActorRoleLabel(trx?.cashierUser, getProcessorRoleLabel(trx)) || getProcessorRoleLabel(trx)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-2 px-2 text-gray-600 font-medium text-xs text-center border border-gray-200">
                                                    <div className="flex flex-col items-center leading-tight">
                                                        <span>{trx.items.length} items</span>
                                                        <span className="text-[10px] font-semibold text-gray-800">
                                                            {(trx.items || []).reduce((sum, item) => sum + Number(item?.qty || 0), 0)} qty sold
                                                        </span>
                                                        {String(trx?.saleType || '').toLowerCase() === 'special-order' && (
                                                            <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                                                                Special Order
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-2 px-3 font-semibold text-black text-sm text-center border border-gray-200 tabular-nums">₱{formatMoney(trx.total)}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <span className="inline-flex rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                                                        {trx.paymentMethod || 'Cash'}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button 
                                                            onClick={() => handleViewReceipt(trx)}
                                                            className="group/btn inline-flex items-center rounded-lg bg-white dark:bg-gray-800 text-black dark:text-white border border-black dark:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all px-2 py-1.5"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                                            <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-semibold group-hover/btn:ml-1 group-hover/btn:max-w-20 group-hover/btn:opacity-100">View Receipt</span>
                                                        </button>
                                                        {onArchiveTransaction && (
                                                            <button 
                                                                onClick={() => toggleArchive(trx)}
                                                                className={`group/btn inline-flex items-center rounded-lg transition-all px-2 py-1.5 ${
                                                                    trx.isArchived 
                                                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40' 
                                                                    : 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                                }`}
                                                                title={trx.isArchived ? 'Restore' : 'Archive'}
                                                                aria-label={`${trx.isArchived ? 'Restore' : 'Archive'} transaction ${trx.id}`}
                                                            >
                                                                {trx.isArchived ? (
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                                ) : (
                                                                    <ArchiveIcon />
                                                                )}
                                                                <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-semibold group-hover/btn:ml-1 group-hover/btn:max-w-20 group-hover/btn:opacity-100">
                                                                    {trx.isArchived ? "Restore" : "Archive"}
                                                                </span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        ) : activeTab === 'credit' ? (
                            <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[980px]">
                                <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="py-3 px-3 w-[15%] text-center text-[11px] font-semibold border border-gray-700">Credit ID</th>
                                        <th className="py-3 px-3 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Created</th>
                                        <th className="py-3 px-3 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Due Date</th>
                                        <th className="py-3 px-3 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Last Payment</th>
                                        <th className="py-3 px-3 w-[18%] text-center text-[11px] font-semibold border border-gray-700">Customer</th>
                                        <th className="py-3 px-3 w-[12%] text-center text-[11px] font-semibold border border-gray-700">Order Ref</th>
                                        <th className="py-3 px-3 w-[10%] text-center text-[11px] font-semibold border border-gray-700">Total</th>
                                        <th className="py-3 px-3 w-[7%] text-center text-[11px] font-semibold border border-gray-700">Status</th>
                                        <th className="py-3 px-3 w-[10%] text-center text-[11px] font-semibold border border-gray-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="9" className="p-8 text-center">
                                                <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-3xl p-8 bg-gray-50/50">
                                                    <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                                                        </svg>
                                                    </div>
                                                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                                        {isCurrentTabLoading ? 'Loading credit transactions...' : (searchTerm ? 'No credit transactions found' : 'No credit transactions recorded')}
                                                    </h3>
                                                    <p className="text-gray-500 text-sm max-w-md mx-auto">
                                                        {isCurrentTabLoading
                                                            ? 'Fetching credit records from backend. Please wait a moment.'
                                                            : (searchTerm
                                                            ? `We couldn't find any credit transactions matching "${searchTerm}". Try a different keyword.`
                                                            : 'Credit transactions will appear here once customers purchase on credit.'
                                                            )}
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((credit) => (
                                            <tr key={credit._id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors duration-200 group">
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
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${creditStatusBadgeClass(credit.status)}`}>
                                                        {credit.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => handleViewCreditDetails(credit)}
                                                            className="group/btn inline-flex items-center rounded-lg bg-white text-black border border-black hover:bg-gray-100 transition-all px-2 py-1.5"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                                            <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-semibold group-hover/btn:ml-1 group-hover/btn:max-w-20 group-hover/btn:opacity-100">View Details</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        ) : (
                            <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[700px]">
                                <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="py-3 px-3 w-[18%] text-center text-[11px] font-semibold border border-gray-700">Date & Time</th>
                                        <th className="py-3 px-3 w-[15%] text-center text-[11px] font-semibold border border-gray-700">Action</th>
                                        <th className="py-3 px-3 w-[20%] text-center text-[11px] font-semibold border border-gray-700">SKU</th>
                                        <th className="py-3 px-3 w-[27%] text-center text-[11px] font-semibold border border-gray-700">Details</th>
                                        <th className="py-3 px-3 w-[20%] text-center text-[11px] font-semibold border border-gray-700">User</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-8 text-center">
                                                <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-3xl p-8 bg-gray-50/50">
                                                    <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                                                        </svg>
                                                    </div>
                                                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                                        {isCurrentTabLoading ? 'Loading inventory logs...' : (searchTerm ? 'No logs found' : 'No activity recorded')}
                                                    </h3>
                                                    <p className="text-gray-500 text-sm max-w-md mx-auto">
                                                        {isCurrentTabLoading
                                                            ? 'Fetching inventory activity from backend. Please wait a moment.'
                                                            : (searchTerm 
                                                            ? `We couldn't find any logs matching "${searchTerm}". Try a different SKU or keyword.`
                                                            : 'Inventory movements such as adding stock or sales will be logged here automatically.'
                                                            )}
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((log, index) => (
                                            <tr key={index} className="border-b border-gray-200 hover:bg-gray-50 transition-colors duration-200 group">
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center whitespace-nowrap border border-gray-200">{formatExact(log.date)}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${
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
                                                <td className="py-2 px-2 font-mono font-semibold text-black text-xs text-center border border-gray-200">{log.code || '-'}</td>
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center border border-gray-200">{log.details}</td>
                                                <td className="py-2 px-2 font-medium text-gray-800 text-xs text-center border border-gray-200">{getActorDisplayName(log.userRef, log.user)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}
                        </div>

                {/* Floating Pagination Controls */}
                <div className="absolute bottom-0 left-0 right-0 z-30 w-full border-t border-gray-200 bg-slate-200/95 px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm md:px-6 md:py-3 dark:border-gray-700 dark:bg-slate-800/90">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            Showing <span className="font-semibold text-gray-900 dark:text-white">{displayStart}</span> to <span className="font-semibold text-gray-900 dark:text-white">{displayEnd}</span> of <span className="font-semibold text-gray-900 dark:text-white">{currentList.length}</span> results
                        </div>
                        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                    </div>
                </div>


            </div>
            </div>

            {isCreditDetailsOpen && selectedCredit && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                            <div>
                                <h3 className="font-semibold text-gray-900">Credit Transaction Details</h3>
                                <p className="text-xs text-gray-500">{selectedCredit.creditTransactionId} - {selectedCredit.customerName}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">Order: {selectedCredit.orderReference || '-'} | Cashier: {selectedCredit.orderId?.cashierName || selectedCredit.cashierName || '-'}</p>
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
                            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-sm">
                                <div className="bg-gray-50 rounded-lg border border-gray-100 p-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total</p>
                                    <p className="font-semibold text-gray-900">₱{formatMoney(selectedCredit.totalAmount)}</p>
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
                                <span className="font-semibold uppercase tracking-wider text-gray-500">Mode of Payment:</span> {selectedCredit.creditPaymentMode || '-'}
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
                                                            <div className="font-semibold text-gray-900">{item.name || 'Item'}</div>
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
                                                <th className="px-2 py-1.5">Method</th>
                                                <th className="px-2 py-1.5">Recorded By</th>
                                                <th className="px-2 py-1.5">Note</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(selectedCredit.paymentHistory || []).length === 0 ? (
                                                <tr>
                                                    <td className="px-2 py-3 text-gray-500 text-center" colSpan={5}>No payments recorded yet.</td>
                                                </tr>
                                            ) : (
                                                selectedCredit.paymentHistory.map((payment, idx) => (
                                                    <tr key={`${payment.paymentDate || 'date'}-${idx}`} className="border-b border-gray-100">
                                                        <td className="px-2 py-1.5">{payment.paymentDate ? new Date(payment.paymentDate).toLocaleString() : '-'}</td>
                                                        <td className="px-2 py-1.5 font-semibold">₱{formatMoney(payment.amount)}</td>
                                                        <td className="px-2 py-1.5 uppercase">{payment.method || '-'}</td>
                                                        <td className="px-2 py-1.5">{payment.recordedBy || '-'}</td>
                                                        <td className="px-2 py-1.5">{payment.note || '-'}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {showReceipt && selectedTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-[58mm] overflow-hidden flex flex-col max-h-[90vh]">
                            <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <div>
                                    <h3 className="font-semibold text-lg text-gray-800">
                                        {isCreditReceipt ? 'Credit Sales Receipt' : 'Cash Sales Receipt'}
                                    </h3>
                                    <p className="text-[11px] text-gray-500 mt-0.5">
                                        {isAutoReceipt ? 'Payment confirmed. Receipt generated.' : 'Official record copy'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowReceipt(false);
                                        setAutoReceiptMode(null);
                                    }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-2 bg-white" id="history-receipt-content">
                            <div className="w-full max-w-[58mm] mx-auto px-1 text-[9px] leading-tight">
                            <div className="text-center mb-3">
                                <p className="text-[14px] font-semibold text-gray-900 mb-1 leading-tight">Tableria La Confianza</p>
                                <div className="text-[9px] text-gray-400 mt-1 space-y-0.5 leading-tight">
                                    <p>Manila S Rd, Calamba, 4027 Laguna</p>
                                    <p>Tel: (049) 545-2166 | (049) 545 1929</p>
                                    <p>Cell: 0917-545-2166</p>
                                </div>
                            </div>
                            
                            <div className="border-t border-dashed border-gray-200 py-2 mb-2">
                                <div className="flex justify-between mb-1">
                                    <span className="text-gray-500">Receipt No.:</span>
                                    <span className="font-mono font-semibold text-gray-800">{selectedTransaction.id}</span>
                                </div>
                                {String(selectedTransaction?.saleType || '').toLowerCase() === 'special-order' && (
                                    <div className="flex justify-between mb-1">
                                        <span className="text-gray-500">Type:</span>
                                        <span className="font-semibold text-amber-700">Special Order</span>
                                    </div>
                                )}
                                <div className="flex justify-between mb-1">
                                    <span className="text-gray-500">Date:</span>
                                    <span className="text-gray-800">{formatExact(selectedTransaction.date)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Cashier:</span>
                                    <span className="text-gray-800">{selectedTransaction.cashier}</span>
                                </div>
                            </div>

                            <table className="w-full mb-3">
                                <thead>
                                    <tr className="border-b-2 border-gray-100">
                                        <th className="py-1 text-left font-semibold text-gray-700 text-[9px]">Item</th>
                                        <th className="py-1 text-center font-semibold text-gray-700 text-[9px]">Qty</th>
                                        <th className="py-1 text-right font-semibold text-gray-700 text-[9px]">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600 text-[9px] leading-tight">
                                    {selectedTransaction.items.map((item, i) => (
                                        <tr key={i} className="border-b border-gray-50">
                                            <td className="py-1">
                                                <div className="font-semibold text-gray-800 leading-tight">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                                <div className="text-[8px] leading-tight">{item.code}</div>
                                            </td>
                                            <td className="py-1 text-center">{item.qty}</td>
                                            <td className="py-1 text-right">₱{formatMoney(item.price * item.qty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="space-y-1 text-right border-t border-gray-200 pt-2 text-[9px] leading-tight">
                                <div className="flex justify-between text-[13px] font-semibold text-gray-900 pt-1 border-t border-gray-900 mt-1">
                                    <span>TOTAL</span>
                                    <span>₱{formatMoney(selectedTransaction.total)}</span>
                                </div>
                                {isCreditReceipt ? (
                                    <>
                                        <div className="flex justify-between text-gray-600 pt-1 text-[9px] font-semibold uppercase">
                                            <span>Credit Status</span>
                                            <span>{selectedTransaction.paymentStatus || 'Pending'}</span>
                                        </div>
                                        <div className="flex justify-between text-gray-500 text-[9px]">
                                            <span>Due Date</span>
                                            <span>{selectedTransaction.dueDate ? new Date(selectedTransaction.dueDate).toLocaleDateString() : '-'}</span>
                                        </div>
                                        {selectedTransaction.creditPaymentMode && (
                                            <div className="flex justify-between text-gray-500 text-[9px]">
                                                <span>Mode of Payment</span>
                                                <span>{selectedTransaction.creditPaymentMode}</span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {hasSavedCash && (
                                            <div className="flex justify-between text-gray-600 pt-1 text-[9px] font-semibold uppercase">
                                                <span>Cash Received</span>
                                                <span>₱{formatMoney(selectedTransaction.cash)}</span>
                                            </div>
                                        )}
                                        {hasSavedChange && (
                                            <div className="flex justify-between text-gray-500 text-[9px]">
                                                <span>Change</span>
                                                <span>₱{formatMoney(selectedTransaction.change)}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            <div className="mt-3 text-center text-[9px] text-gray-400 leading-tight">
                                <p>Thank you for your business.</p>
                                <p>Please keep this receipt for returns and support.</p>
                                {!isAutoReceipt && <p className="mt-2 font-mono">** REPRINT **</p>}
                            </div>
                            </div>
                        </div>

                        <div className="p-2 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => {
                                    setShowReceipt(false);
                                    setAutoReceiptMode(null);
                                }}
                                className="py-2 px-4 rounded-xl text-xs font-semibold uppercase tracking-widest hover:bg-gray-100 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform hover:-translate-y-0.5 text-gray-600 bg-white"
                            >
                                Close
                            </button>
                            <button 
                                onClick={handlePrint}
                                disabled={printStatus === 'printing'}
                                className={`py-2 px-4 rounded-xl text-xs font-semibold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                                style={{ backgroundColor: printStatus === 'success' ? '#10B981' : '#111827', color: '#ffffff', border: printStatus === 'success' ? '2px solid #10B981' : '2px solid #111827' }}
                            >
                                {printStatus === 'printing' ? 'Printing...' : printStatus === 'success' ? 'Printed!' : 'Reprint'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Archive Confirmation Modal */}
            {isArchiveModalOpen && transactionToArchive && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center">
                            <div className={`mx-auto flex items-center justify-center mb-4 ${transactionToArchive.isArchived ? 'text-emerald-600' : 'text-orange-600'}`}>
                                {transactionToArchive.isArchived ? (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                ) : (
                                    <ArchiveIcon className="w-12 h-12" />
                                )}
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                                {transactionToArchive.isArchived ? 'Restore Transaction?' : 'Archive Transaction?'}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                Are you sure you want to {transactionToArchive.isArchived ? 'restore' : 'archive'} <span className="font-semibold text-gray-900 dark:text-white">Transaction {transactionToArchive.id}</span>?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsArchiveModalOpen(false)}
                                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmArchive}
                                    style={{ backgroundColor: '#111827' }}
                                    className="flex-1 py-2.5 text-white rounded-xl font-semibold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5"
                                >
                                    {transactionToArchive.isArchived ? 'Restore' : 'Archive'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default History;
