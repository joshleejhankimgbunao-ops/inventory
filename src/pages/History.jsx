import React, { useState, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';

const History = () => {
    const { userRole, currentUserName, appSettings, isAdminOrAbove, ROLES } = useAuth();
    const { 
        transactions, 
        setTransactions, 
        inventoryLogs, 
        handleResetHistory 
    } = useInventory();

    const currentUser = currentUserName;
    const adminName = appSettings.adminDisplayName;
    const onResetHistory = handleResetHistory;

    // Internal handler for archiving
    const onArchiveTransaction = (id) => {
        setTransactions(prev => prev.map(t => t.id === id ? { ...t, isArchived: !t.isArchived } : t));
    };

    const [activeTab, setActiveTab] = useState('sales');
    const [searchTerm, setSearchTerm] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [filterAction, setFilterAction] = useState('ALL'); // For Inventory Logs: ALL, ADD, DEDUCT, UPDATE, DELETE
    const [processedByFilter, setProcessedByFilter] = useState('ALL'); // NEW: Filter by user
    const [sortOrder, setSortOrder] = useState('desc'); // 'desc' (Newest) or 'asc' (Oldest)
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

    // Date Filters
    const [dateRange, setDateRange] = useState('all'); // 'today', 'week', 'month', 'all', 'specific_date', 'custom'
    const [specificDate, setSpecificDate] = useState('');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Get unique list of processors (users) from transactions
    const uniqueProcessors = useMemo(() => {
        const users = new Set(transactions.map(t => t.cashier || 'Admin'));
        return ['ALL', ...Array.from(users)];
    }, [transactions]);
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

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

            const matchesSearch = trx.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                trx.cashier?.toLowerCase().includes(searchTerm.toLowerCase());
            
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
            
            return matchesSearch && matchesDate;
        });
    }, [transactions, searchTerm, dateRange, specificDate, customStartDate, customEndDate, showArchived, activeTab, processedByFilter, userRole]);

    // Filter Logic for Inventory Logs
    const filteredLogs = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return inventoryLogs.filter(log => {
            const matchesSearch = 
                (log.code && log.code.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (log.details && log.details.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (log.user && log.user.toLowerCase().includes(searchTerm.toLowerCase()));
            
            const matchesFilter = filterAction === 'ALL' || log.action === filterAction;

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

            return matchesSearch && matchesFilter && matchesDate;
        });
    }, [inventoryLogs, searchTerm, filterAction, dateRange, specificDate, customStartDate, customEndDate]);

    // Reset pagination
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, searchTerm, filterAction, sortOrder, dateRange, specificDate, customStartDate, customEndDate]);

    // Pagination Logic
    const currentList = activeTab === 'sales' ? filteredTransactions : filteredLogs;
    const totalPages = Math.ceil(currentList.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    
    // items are naturally chronological (oldest -> newest) in the arrays usually
    // We want to show based on sortOrder
    const sortedItems = useMemo(() => {
        const list = [...currentList];
        if (sortOrder === 'desc') {
            return list.reverse(); // Newest first
        }
        return list; // Oldest first
    }, [currentList, sortOrder]);

    const currentItems = sortedItems.slice(indexOfFirstItem, indexOfLastItem);
    
    // Note: The original code used .slice().reverse() inside the render. 
    // I should apply reverse first then pagination to show latest items first properly.
    // The previous implementation was: filteredTransactions.slice().reverse().map(...)
    // So if I have 100 items, I want page 1 to show items 100-93.
    // My logic above: currentItems = currentList.slice().reverse().slice(...) does exactly that.

    // State for Reprinting Receipt (lifted from SalesHistory)
    const [selectedTransaction, setSelectedTransaction] = useState(null);
    const [showReceipt, setShowReceipt] = useState(false);
    const [printStatus, setPrintStatus] = useState('idle');

    // Archive Modal State
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [transactionToArchive, setTransactionToArchive] = useState(null);

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

    const handleViewReceipt = (transaction) => {
        setSelectedTransaction(transaction);
        setShowReceipt(true);
    };

    const handlePrint = () => {
        setPrintStatus('printing');
        
        setTimeout(() => {
            const printContent = document.getElementById('history-receipt-content').innerHTML;
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            
            const printStyle = `
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
                    @media print {
                        @page { margin: 0; size: auto; }
                        body { margin: 0; padding: 10px; font-family: 'Courier Prime', 'Courier New', monospace; color: black; background: white; width: 100%; max-width: 80mm; }
                        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                        .text-center { text-align: center; }
                        .text-right { text-align: right; }
                        .font-bold { font-weight: bold; }
                        .mb-6 { margin-bottom: 15px; }
                        .mb-4 { margin-bottom: 10px; }
                        .text-xs { font-size: 9pt; }
                        .text-sm { font-size: 10pt; }
                        .text-xl { font-size: 14pt; }
                        .text-2xl { font-size: 16pt; }
                        .border-t { border-top: 1px dashed black; }
                        .border-b { border-bottom: 1px dashed black; }
                        .py-2 { padding-top: 5px; padding-bottom: 5px; }
                        table { width: 100%; border-collapse: collapse; }
                        th { text-align: left; }
                        th:last-child, td:last-child { text-align: right; }
                    }
                </style>
            `;

            iframe.contentDocument.write('<html><head>' + printStyle + '</head><body><div style="max-width: 80mm; margin: 0 auto;">' + printContent + '</div></body></html>');
            iframe.contentDocument.close();
            
            iframe.contentWindow.focus();
            setTimeout(() => iframe.contentWindow.print(), 500);

            const cleanup = () => {
                if (document.body.contains(iframe)) document.body.removeChild(iframe);
                setPrintStatus('success');
                toast.success("Receipt reprinted successfully!");
                setTimeout(() => setPrintStatus('idle'), 2000);
            };

            if (iframe.contentWindow.matchMedia) {
                iframe.contentWindow.matchMedia('print').addEventListener('change', (mql) => !mql.matches && cleanup());
            }
            setTimeout(cleanup, 1000); 
        }, 50);
    };

    return (
        <div className="h-[calc(100vh-80px)] flex flex-col overflow-auto md:overflow-hidden p-2 gap-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 md:flex-1 flex flex-col border-t-8 border-t-[#111827] md:overflow-hidden">
                {/* Header + Controls */}
                <div className="p-5 flex flex-col gap-5 md:shrink-0">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <div>
                                <svg className="w-7 h-7 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                </svg>
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-[8px] font-black text-gray-900 dark:text-white leading-tight ">History Logs</h1>
                                </div>
                                <p className="text-gray-500 dark:text-gray-400 text-xs font-medium mt-1">Review past transactions and inventory movements</p>
                            </div>
                        </div>

                        {/* Tabs - Modern Segmented Control */}
                        <div className="flex p-1 bg-gray-100 rounded-lg border border-gray-200">
                             <button 
                                onClick={() => setActiveTab('sales')}
                                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all duration-300 ${
                                    activeTab === 'sales' 
                                    ? 'shadow-md transform scale-105' 
                                    : 'text-gray-500 hover:text-gray-900'
                                }`}
                                style={{
                                    backgroundColor: activeTab === 'sales' ? '#111827' : 'transparent',
                                    color: activeTab === 'sales' ? '#ffffff' : ''
                                }}
                            >
                                Sales Transactions
                            </button>
                            {isAdminOrAbove() && (
                            <button 
                                onClick={() => setActiveTab('inventory')}
                                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all duration-300 ${
                                    activeTab === 'inventory' 
                                    ? 'shadow-md transform scale-105' 
                                    : 'text-gray-500 hover:text-gray-900'
                                }`}
                                style={{
                                    backgroundColor: activeTab === 'inventory' ? '#111827' : 'transparent',
                                    color: activeTab === 'inventory' ? '#ffffff' : ''
                                }}
                            >
                                Inventory Logs
                            </button>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 mb-1">
                        {/* Search */}
                        <div className="relative flex-1 md:flex-none md:w-64 group">
                            <input 
                                type="text" 
                                placeholder={activeTab === 'sales' ? "Search Transaction ID..." : "Search Item Code..."}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-3 py-2 bg-gray-50 border-2 border-gray-100 rounded-xl text-sm focus:bg-white focus:border-gray-900 focus:ring-4 focus:ring-gray-100 transition-all shadow-sm placeholder:text-gray-400 font-bold text-gray-800"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1 bg-white rounded-lg shadow-sm border border-gray-100 group-focus-within:border-gray-900 group-focus-within:bg-gray-900 transition-all duration-300">
                                <svg className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                        </div>

                        {/* Combined Filter & Sort Button */}
                        <div className="relative z-30">
                            <button
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                className={`px-3 py-2 rounded-xl font-bold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 ${
                                    (dateRange !== 'all' || processedByFilter !== 'ALL' || filterAction !== 'ALL' || sortOrder !== 'desc')
                                    ? 'bg-gray-900 text-white border-gray-900'
                                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                                }`}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                                <span>Filter & Sort</span>
                                <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>

                            {/* Filter Panel */}
                            {isFilterPanelOpen && (
                                <div className="absolute top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-50 right-0 md:left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[75vh] overflow-y-auto">

                                    {/* Date Range */}
                                    <div className="px-3 pt-2 pb-1">
                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Date Range</div>
                                    </div>
                                    <div className="px-2 pb-2 flex flex-wrap gap-1">
                                        {[{key:'all',label:'All Time'},{key:'today',label:'Today'},{key:'week',label:'This Week'},{key:'month',label:'This Month'},{key:'specific_date',label:'Select Date'},{key:'custom',label:'Custom Range'}].map(d => (
                                            <button key={d.key} onClick={() => setDateRange(d.key)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
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
                                                className="w-full px-3 py-1.5 rounded-lg text-xs font-bold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all" />
                                        </div>
                                    )}
                                    {dateRange === 'custom' && (
                                        <div className="px-3 pb-2 flex gap-2">
                                            <input type="date" max={new Date().toISOString().split('T')[0]} value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)}
                                                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-bold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all" />
                                            <input type="date" max={new Date().toISOString().split('T')[0]} value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)}
                                                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-bold border-2 border-gray-200 focus:border-gray-900 focus:outline-none transition-all" />
                                        </div>
                                    )}

                                    <div className="border-t border-gray-100 mx-3"></div>

                                    {/* Sort Order */}
                                    <div className="px-3 pt-2 pb-1">
                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Sort By</div>
                                    </div>
                                    <div className="px-2 pb-2 flex gap-1">
                                        {[{key:'desc',label:'Newest First'},{key:'asc',label:'Oldest First'}].map(s => (
                                            <button key={s.key} onClick={() => setSortOrder(s.key)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
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
                                                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Processed By</div>
                                            </div>
                                            <div className="px-2 pb-2 flex flex-wrap gap-1">
                                                {uniqueProcessors.map(user => (
                                                    <button key={user} onClick={() => setProcessedByFilter(user)}
                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                                            processedByFilter === user
                                                            ? 'bg-gray-900 text-white shadow-sm'
                                                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                        }`}>{user === 'ALL' ? 'All Staff' : user}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}

                                    {/* Action Filter (Inventory tab) */}
                                    {activeTab === 'inventory' && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-3 pt-2 pb-1">
                                                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Action Type</div>
                                            </div>
                                            <div className="px-2 pb-2 flex flex-wrap gap-1">
                                                {[{key:'ALL',label:'All Actions'},{key:'ADD',label:'Restock'},{key:'DEDUCT',label:'Sales'},{key:'UPDATE',label:'Updates'},{key:'CREATE',label:'New Items'},{key:'ARCHIVE',label:'Archived'}].map(a => (
                                                    <button key={a.key} onClick={() => setFilterAction(a.key)}
                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                                            filterAction === a.key
                                                            ? 'bg-gray-900 text-white shadow-sm'
                                                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                        }`}>{a.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}

                                    {/* Archived Toggle (Sales tab) */}
                                    {activeTab === 'sales' && (
                                        <>
                                            <div className="border-t border-gray-100 mx-3"></div>
                                            <div className="px-2 pt-2 pb-1">
                                                <button onClick={() => setShowArchived(!showArchived)}
                                                    className={`w-full px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${
                                                        showArchived
                                                        ? 'bg-orange-50 text-orange-700'
                                                        : 'text-gray-500 hover:bg-gray-50'
                                                    }`}>
                                                    <span className="flex items-center gap-1.5">
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                                        {showArchived ? 'Showing Archived' : 'Show Archived'}
                                                    </span>
                                                    {showArchived && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>}
                                                </button>
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
                <div className="flex-1 md:overflow-y-auto w-full px-4 pb-4 pt-0 max-h-[calc(100vh-220px)]">
                        {activeTab === 'sales' ? (
                            <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-[700px]">
                               <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="py-3 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Transaction ID</th>
                                        <th className="py-3 px-3 w-[20%] text-center text-xs font-bold border border-gray-700">Date & Time</th>
                                        <th className="py-3 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Processed By</th>
                                        <th className="py-3 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Items</th>
                                        <th className="py-3 px-3 w-[20%] text-center text-xs font-bold border border-gray-700">Total Amount</th>
                                        <th className="py-3 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {currentList.length === 0 ? (
                                        <tr>
                                            <td colSpan="6" className="p-8 text-center">
                                                <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-3xl p-8 bg-gray-50/50">
                                                    <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                                                        </svg>
                                                    </div>
                                                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                                                        {searchTerm ? 'No transactions found' : 'No sales recorded'}
                                                    </h3>
                                                    <p className="text-gray-500 text-sm max-w-md mx-auto">
                                                        {searchTerm 
                                                            ? `We couldn't find any transactions matching "${searchTerm}". Try a different ID or keyword.`
                                                            : 'Sales transactions will appear here once you process payments in the POS system.'
                                                        }
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((trx) => (
                                            <tr key={trx.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors duration-200 group">
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <span className="font-mono text-black font-bold text-xs bg-white px-2 py-0.5 rounded-md border border-gray-300">{trx.id}</span>
                                                </td>
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center border border-gray-200">{formatExact(trx.date)}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[10px] uppercase font-bold text-gray-400 leading-tight">
                                                            {/* Check if matches current Admin Name, or contains 'Admin' (legacy) */}
                                                            {(trx.cashier === adminName || (trx.cashier || 'Admin').toLowerCase().includes('admin')) ? 'SUPER ADMIN' : 'CASHIER'}
                                                        </span>
                                                        <span className="text-gray-900 font-bold text-xs leading-tight">
                                                            {trx.cashier || 'Admin'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-2 px-2 text-gray-600 font-medium text-xs text-center border border-gray-200">{trx.items.length} items</td>
                                                <td className="py-2 px-2 font-bold text-black text-sm text-center border border-gray-200">₱{trx.total.toFixed(2)}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button 
                                                            onClick={() => handleViewReceipt(trx)}
                                                            className="group/btn relative inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md shadow-sm hover:opacity-90 transition-all whitespace-nowrap text-[10px] font-bold bg-white text-black border border-black hover:z-50"
                                           x             >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                                                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/btn:block z-[9999] w-max pointer-events-none">
                                                                <span className="bg-gray-900 text-white text-[10px] font-medium rounded py-1 px-2 shadow-lg block border border-gray-700">View Receipt</span>
                                                                <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2 block border-r border-b border-gray-700"></span>
                                                            </span>
                                                        </button>
                                                        {onArchiveTransaction && (
                                                            <button 
                                                                onClick={() => toggleArchive(trx)}
                                                                className={`group/btn relative inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md shadow-sm hover:opacity-90 transition-all whitespace-nowrap text-[10px] font-bold border hover:z-50 ${
                                                                    trx.isArchived 
                                                                    ? 'bg-green-50 text-green-700 border-green-200' 
                                                                    : 'bg-orange-50 text-orange-700 border-orange-200'
                                                                }`}
                                                            >
                                                                {trx.isArchived ? (
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                                ) : (
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                                                )}
                                                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/btn:block z-[9999] w-max pointer-events-none">
                                                                    <span className="bg-gray-900 text-white text-[10px] font-medium rounded py-1 px-2 shadow-lg block border border-gray-700">
                                                                        {trx.isArchived ? "Restore Transaction" : "Archive Transaction"}
                                                                    </span>
                                                                    <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2 block border-r border-b border-gray-700"></span>
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
                        ) : (
                            <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-[700px]">
                                <thead className="sticky top-0 z-10 shadow-sm">
                                    <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                        <th className="py-3 px-3 w-[18%] text-center text-xs font-bold border border-gray-700">Date & Time</th>
                                        <th className="py-3 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Action</th>
                                        <th className="py-3 px-3 w-[20%] text-center text-xs font-bold border border-gray-700">Item Code</th>
                                        <th className="py-3 px-3 w-[27%] text-center text-xs font-bold border border-gray-700">Details</th>
                                        <th className="py-3 px-3 w-[20%] text-center text-xs font-bold border border-gray-700">User</th>
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
                                                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                                                        {searchTerm ? 'No logs found' : 'No activity recorded'}
                                                    </h3>
                                                    <p className="text-gray-500 text-sm max-w-md mx-auto">
                                                        {searchTerm 
                                                            ? `We couldn't find any logs matching "${searchTerm}". Try a different item code or keyword.`
                                                            : 'Inventory movements such as adding stock or sales will be logged here automatically.'
                                                        }
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        currentItems.map((log, index) => (
                                            <tr key={index} className="border-b border-gray-200 hover:bg-gray-50 transition-colors duration-200 group">
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center whitespace-nowrap border border-gray-200">{formatExact(log.date)}</td>
                                                <td className="py-2 px-2 text-center border border-gray-200">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
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
                                                <td className="py-2 px-2 font-mono font-bold text-black text-xs text-center border border-gray-200">{log.code || '-'}</td>
                                                <td className="py-2 px-2 text-gray-800 font-medium text-xs text-center border border-gray-200">{log.details}</td>
                                                <td className="py-2 px-2 font-medium text-gray-800 text-xs text-center border border-gray-200">{log.user}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}
                            {/* Pagination Controls (bottom) */}
                            <div className="sticky bottom-0 z-20 shrink-0 flex justify-between items-center px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                        Showing <span className="font-bold text-gray-900 dark:text-white">{indexOfFirstItem + 1}</span> to <span className="font-bold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, currentList.length)}</span> of <span className="font-bold text-gray-900 dark:text-white">{currentList.length}</span> results
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1}
                                            className={`p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 transition-all ${currentPage === 1 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                                        </button>
                                        {(() => {
                                            const maxVisible = 5;
                                            let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                                            let end = start + maxVisible - 1;
                                            if (end > totalPages) { end = totalPages; start = Math.max(1, end - maxVisible + 1); }
                                            const pages = [];
                                            if (start > 1) pages.push(<button key="first" onClick={() => setCurrentPage(1)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">1</button>);
                                            if (start > 2) pages.push(<span key="dots-start" className="text-gray-400 text-xs px-0.5">...</span>);
                                            for (let i = start; i <= end; i++) {
                                                pages.push(
                                                    <button key={i} onClick={() => setCurrentPage(i)}
                                                        className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                                                            currentPage === i
                                                            ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                            : 'text.gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                        }`}
                                                    >{i}</button>
                                                );
                                            }
                                            if (end < totalPages - 1) pages.push(<span key="dots-end" className="text-gray-400 text-xs px-0.5">...</span>);
                                            if (end < totalPages) pages.push(<button key="last" onClick={() => setCurrentPage(totalPages)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">{totalPages}</button>);
                                            return pages;
                                        })()}
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages}
                                            className={`p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 transition-all ${currentPage === totalPages ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                                        </button>
                                    </div>
                            </div>
                        </div>


            </div>
            </div>


            {showReceipt && selectedTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md md:max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold text-xl text-gray-800">Reprint Receipt</h3>
                            <button onClick={() => setShowReceipt(false)} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 bg-white" id="history-receipt-content">
                            <div className="text-center mb-6">
                                <p className="text-2xl font-black uppercase tracking-wider text-gray-900 mb-1">Tableria La Confianza</p>
                                <div className="text-xs text-gray-400 mt-2 space-y-1">
                                    <p>Manila S Rd, Calamba, 4027 Laguna</p>
                                    <p>Tel: (049) 545-2166 | (049) 545 1929</p>
                                    <p>Cell: 0917-545-2166</p>
                                </div>
                            </div>
                            
                            <div className="border-t-2 border-dashed border-gray-200 py-4 mb-4 text-sm">
                                <div className="flex justify-between mb-1">
                                    <span className="text-gray-500">Transaction ID:</span>
                                    <span className="font-mono font-bold text-gray-800">{selectedTransaction.id}</span>
                                </div>
                                <div className="flex justify-between mb-1">
                                    <span className="text-gray-500">Date:</span>
                                    <span className="text-gray-800">{formatExact(selectedTransaction.date)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Cashier:</span>
                                    <span className="text-gray-800">{selectedTransaction.cashier}</span>
                                </div>
                            </div>

                            <table className="w-full text-sm mb-6">
                                <thead>
                                    <tr className="border-b-2 border-gray-100">
                                        <th className="py-2 text-left font-bold text-gray-700">Item</th>
                                        <th className="py-2 text-center font-bold text-gray-700">Qty</th>
                                        <th className="py-2 text-right font-bold text-gray-700">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600">
                                    {selectedTransaction.items.map((item, i) => (
                                        <tr key={i} className="border-b border-gray-50">
                                            <td className="py-2">
                                                <div className="font-bold text-gray-800">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                                <div className="text-xs">{item.code}</div>
                                            </td>
                                            <td className="py-2 text-center">{item.qty}</td>
                                            <td className="py-2 text-right">₱{(item.price * item.qty).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="space-y-2 text-right text-sm border-t border-gray-200 pt-4">
                                <div className="flex justify-between text-xl font-black text-gray-900 pt-2 border-t-2 border-gray-900 mt-2">
                                    <span>TOTAL</span>
                                    <span>₱{selectedTransaction.total.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="mt-8 text-center text-xs text-gray-400">
                                <p>Thank you for your business!</p>
                                <p>Please keep this receipt for warranty purposes.</p>
                                <p className="mt-2 font-mono">** REPRINT **</p>
                            </div>
                        </div>

                        <div className="p-6 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-4">
                            <button 
                                onClick={() => setShowReceipt(false)}
                                className="py-3 px-6 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-gray-200 transition-all duration-300 flex items-center justify-center gap-3 bg-gray-100 text-gray-600"
                            >
                                Close
                            </button>
                            <button 
                                onClick={handlePrint}
                                disabled={printStatus === 'printing'}
                                className={`py-3 px-6 rounded-xl text-sm font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-3 shadow-xl transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-1'}`}
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
                            <div className={`mx-auto flex items-center justify-center mb-4 ${transactionToArchive.isArchived ? 'text-emerald-600' : 'text-red-600'}`}>
                                {transactionToArchive.isArchived ? (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                ) : (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                )}
                            </div>
                            <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">
                                {transactionToArchive.isArchived ? 'Restore Transaction?' : 'Archive Transaction?'}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                Are you sure you want to {transactionToArchive.isArchived ? 'restore' : 'archive'} <span className="font-bold text-gray-900 dark:text-white">Transaction {transactionToArchive.id}</span>?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsArchiveModalOpen(false)}
                                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmArchive}
                                    style={{ backgroundColor: '#111827' }}
                                    className="flex-1 py-2.5 text-white rounded-xl font-bold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5"
                                >
                                    Confirm
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