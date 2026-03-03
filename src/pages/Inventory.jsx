import React, { useState, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken } from '../services/apiClient';
import { updateProductStockApi } from '../services/inventoryApi';

const Inventory = () => {
    const { inventory, setInventory, logAction, logActivity } = useInventory();
    const { appSettings } = useAuth();
    
    // Helper to log actions
    const log = (action, code, details) => {
        if (logAction) {
            logAction(action, code, details);
        }
    }; 

    const [isStockModalOpen, setIsStockModalOpen] = useState(false);
    const [modalAction, setModalAction] = useState('IN'); // 'IN' (Add Stock) or 'OUT' (Remove/Adjust)
    const [selectedItem, setSelectedItem] = useState(null);
    const [stockForm, setStockForm] = useState({ quantity: '', reason: '', notes: '' });

    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [sortBy, setSortBy] = useState('stock-asc'); 
    const [searchQuery, setSearchQuery] = useState('');
    
    // UI State for Filter Panel
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

    // Derived Categories
    const categories = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15; 

    // Active filter count for badge
    const activeFilterCount = (statusFilter !== 'All' ? 1 : 0) + (categoryFilter !== 'All' ? 1 : 0);

    // Filtered & Sorted Logic
    const filteredInventory = useMemo(() => {
        return inventory
            .filter(item => {
                // Hide archived
                if (item.isArchived) return false;

                // Status filter
                if (statusFilter !== 'All' && item.status !== statusFilter) return false;

                // Category filter
                if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;

                // Search
                const q = searchQuery.toLowerCase();
                const matchesSearch = !q || item.name.toLowerCase().includes(q) || 
                                    item.code.toLowerCase().includes(q) ||
                                    (item.brand || '').toLowerCase().includes(q) ||
                                    (item.color || '').toLowerCase().includes(q) ||
                                    (item.size && item.size.toLowerCase().includes(q));
                
                return matchesSearch;
            })
            .sort((a, b) => {
                switch(sortBy) {
                    case 'name-asc': return a.name.localeCompare(b.name);
                    case 'name-desc': return b.name.localeCompare(a.name);
                    case 'stock-asc': return a.stock - b.stock;
                    case 'stock-desc': return b.stock - a.stock;
                    default: return 0;
                }
            });
    }, [inventory, statusFilter, categoryFilter, searchQuery, sortBy]);

    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, categoryFilter, searchQuery, sortBy]);

    // Pagination Logic
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredInventory.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredInventory.length / itemsPerPage);

    // Status Helpers
    const getStatus = (stock) => {
        if (stock <= 10) return 'Critical';
        if (stock <= 50) return 'Low Stock';
        return 'In Stock';
    };
    
    const getStatusColor = (status) => {
        switch(status) {
            case 'Critical': return 'bg-rose-50 text-rose-600 border border-rose-200 font-bold'; 
            case 'Low Stock': return 'bg-yellow-50 text-yellow-600 border border-yellow-200 font-bold'; 
            default: return 'bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold'; 
        }
    };

    // --- STOCK MANAGEMENT LOGIC ---

    const handleOpenStockModal = (item, action) => {
        setSelectedItem(item);
        setModalAction(action);
        setStockForm({ quantity: '', reason: action === 'IN' ? 'Delivery' : 'Damage', notes: '' });
        setIsStockModalOpen(true);
    };

    const handleStockSubmit = async (e) => {
        e.preventDefault();
        const qty = parseInt(stockForm.quantity);
        if (!selectedItem || isNaN(qty) || qty <= 0) return;

        const currentStock = selectedItem.stock || 0;
        if (modalAction === 'OUT') {
            if (currentStock <= 0) {
                showToast('Cannot remove stock', 'Current stock is 0. Cannot perform Stock Out.', 'error', 'stock-zero');
                return;
            }
            if (qty > currentStock) {
                showToast('Insufficient stock', `Requested ${qty} but only ${currentStock} available.`, 'error', 'stock-insufficient');
                return;
            }
        }

        const maxStockLimit = (appSettings && appSettings.maxStockLimit) ? parseInt(appSettings.maxStockLimit) : 100;
        const updatedInventory = inventory.map(item => {
            if (item.code === selectedItem.code) {
                let newStock = item.stock;
                if (modalAction === 'IN') {
                    newStock += qty;
                    if (newStock > maxStockLimit) {
                        const capped = maxStockLimit;
                        showToast('Max Stock Reached', `Stock for ${item.code} capped to ${capped}.`, 'warning', 'stock-cap');
                        newStock = capped;
                    }
                } else {
                    newStock = Math.max(0, item.stock - qty);
                }
                return { 
                    ...item, 
                    stock: newStock,
                    status: getStatus(newStock)
                };
            }
            return item;
        });

        setInventory(updatedInventory);

        const selectedUpdatedItem = updatedInventory.find(item => item.code === selectedItem.code);
        const token = getAuthToken();
        if (token && selectedItem.id && selectedUpdatedItem) {
            try {
                await updateProductStockApi(selectedItem.id, selectedUpdatedItem.stock);
            } catch (error) {
                showToast('Sync Failed', error.message || 'Stock change was not synced to server.', 'error', 'stock-sync');
            }
        }
        
        // Detailed Logging
        const logAction = modalAction === 'IN' ? 'STOCK_IN' : 'STOCK_OUT';
        const logDesc = modalAction === 'IN' 
            ? `Received ${qty} Qty via ${stockForm.reason}` 
            : `Removed ${qty} Qty due to ${stockForm.reason}`;
            
        log(logAction, selectedItem.code, logDesc);
        logActivity('System', modalAction === 'IN' ? 'Stock In' : 'Stock Out', `${selectedItem.code}: ${logDesc}`);

        setIsStockModalOpen(false);
        if (modalAction === 'IN') {
            showToast('Success', 'Stock received successfully', 'success', 'stock-update');
        } else {
            showToast('Updated', 'Stock adjusted successfully', 'save', 'stock-update');
        }
    };

    return (
        <div className="h-[calc(100vh-80px)] flex flex-col overflow-auto md:overflow-hidden p-2 gap-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col md:h-full relative border-t-8 border-t-[#111827] dark:border-t-gray-600 transition-colors">
            
            {/* Header Area */}
            <div className="p-3 pb-0 md:shrink-0">
                <div className="flex items-center gap-2 mb-4">
                    <div>
                        <svg className="w-6 h-6 text-gray-900 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                    </div>
                    <div>
                        <h1 className="text-[8px] font-black text-gray-900 dark:text-white leading-tight">Stock Operations</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-xs font-medium mt-1">Manage stock in/out flow and adjustments</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-2 mb-3">
                     {/* Search */}
                     <div className="relative flex-1 md:flex-none md:w-64 group">
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-3 py-1.5 bg-gray-50 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 rounded-xl text-sm focus:bg-white dark:focus:bg-gray-600 focus:border-gray-900 dark:focus:border-gray-400 focus:ring-0 transition-all shadow-sm placeholder:text-gray-400 font-bold text-gray-800 dark:text-gray-200"
                        />
                         <div className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 bg-white dark:bg-gray-600 rounded-lg shadow-sm border border-gray-100 dark:border-gray-500 group-focus-within:border-gray-900 group-focus-within:bg-gray-900 dark:group-focus-within:border-gray-400 dark:group-focus-within:bg-gray-400 transition-all duration-300">
                            <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                     </div>

                     {/* Single Filter & Sort Button */}
                     <div className="relative z-30 inline-flex items-center gap-3">
                        <button 
                            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 ${
                                activeFilterCount > 0
                                ? 'bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'
                            }`}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                            <span>Filter & Sort</span>
                            {activeFilterCount > 0 && (
                                <span className="bg-white text-gray-900 dark:bg-gray-300 dark:text-gray-800 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>
                            )}
                            <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>

                            {/* Category select (adjacent to Filter & Sort) */}
                            <div className="hidden sm:inline-flex items-center">
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className={`appearance-none px-3 py-1.5 rounded-xl text-sm font-bold inline-flex items-center transition-all border-2 ${categoryFilter !== 'All' ? 'bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'}`}
                                >
                                    {categories.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>

                        {/* Combined Filter & Sort Panel */}
                        {isFilterPanelOpen && (
                            <div className="absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 py-2 z-50 right-0 md:left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[70vh] overflow-y-auto">
                                
                                {/* Status Section */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Status</div>
                                </div>
                                <div className="px-2 pb-2 flex flex-wrap gap-1">
                                    {['All', 'In Stock', 'Low Stock', 'Critical', 'Out of Stock'].map(status => (
                                        <button key={status} onClick={() => setStatusFilter(status)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                                statusFilter === status
                                                ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                : status === 'Critical' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400'
                                                : status === 'Low Stock' ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400'
                                                : status === 'Out of Stock' ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
                                            }`}>
                                            {status === 'All' ? 'All Status' : status}
                                        </button>
                                    ))}
                                </div>

                                <div className="border-t border-gray-100 dark:border-gray-700 mx-3"></div>

                                {/* Sort Section */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sort By</div>
                                </div>
                                <div className="px-2 pb-2">
                                    {[{key: 'stock-asc', label: 'Stock ↑ Lowest'}, {key: 'stock-desc', label: 'Stock ↓ Highest'}, {key: 'name-asc', label: 'Name A→Z'}, {key: 'name-desc', label: 'Name Z→A'}].map(opt => (
                                        <button key={opt.key} onClick={() => setSortBy(opt.key)}
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${
                                                sortBy === opt.key
                                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                            }`}>
                                            <span>{opt.label}</span>
                                            {sortBy === opt.key && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>}
                                        </button>
                                    ))}
                                </div>

                                {/* Clear All + Close */}
                                {activeFilterCount > 0 && (
                                    <>
                                        <div className="border-t border-gray-100 dark:border-gray-700 mx-3"></div>
                                        <div className="px-2 pt-2 pb-1">
                                            <button onClick={() => { setStatusFilter('All'); setCategoryFilter('All'); }}
                                                className="w-full text-center px-3 py-1.5 rounded-lg text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">
                                                Clear All Filters
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                     </div>

                     {/* Hint Text */}
                     <div className="ml-auto hidden md:block">
                        <span className="text-[10px] text-gray-400 font-medium bg-gray-50 dark:bg-gray-700/50 px-2 py-1 rounded-md border border-gray-100 dark:border-gray-700">
                            💡 Use <span className="font-bold text-gray-700 dark:text-gray-300">Product List</span> to add new items
                        </span>
                     </div>
                </div>
            
                {/* Backdrop for closing panel */}
                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}
            </div>

            {/* Inventory Table */}
            <div className="flex-1 md:overflow-auto px-4 pb-4">
                <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-[700px]">
                    <thead className="sticky top-0 z-10 shadow-sm">
                        <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                            <th className="py-2 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Item Code</th>
                            <th className="py-2 px-3 w-[25%] text-center text-xs font-bold border border-gray-700">Product</th>
                            <th className="py-2 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Category</th>
                            <th className="py-2 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Current Stock</th>
                            <th className="py-2 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Status</th>
                            <th className="py-2 px-3 w-[15%] text-center text-xs font-bold border border-gray-700">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-gray-100 dark:divide-gray-700">
                        {filteredInventory.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="p-12 text-center text-gray-400 dark:text-gray-500">
                                    <div className="flex flex-col items-center">
                                        <svg className="w-12 h-12 mb-3 text-gray-200 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                                        <p className="font-medium">No inventory items found matching your filters.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            currentItems.map((item) => (
                                <tr key={item.code} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className="font-mono text-gray-500 dark:text-gray-400 font-bold text-xs">{item.code}</span>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <div className="flex flex-col items-center">
                                            <span className="font-bold text-gray-900 dark:text-white text-sm">{item.brand ? `${item.brand} ` : ''}{item.name}</span>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">{item.size || '-'} {item.color ? `• ${item.color}` : ''}</span>
                                        </div>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{item.category}</span>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className="font-bold text-gray-900 dark:text-white text-base">{item.stock.toLocaleString()}</span>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusColor(item.status)}`}>
                                            {item.status}
                                        </span>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <div className="flex justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                            <button 
                                                onClick={() => handleOpenStockModal(item, 'IN')}
                                                className="flex items-center gap-0.5 px-1.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded text-[10px] font-bold transition-colors border border-emerald-100 dark:border-emerald-900/30"
                                                title="Received Stock"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                                IN
                                            </button>
                                            <button
                                                onClick={() => item.stock > 0 && handleOpenStockModal(item, 'OUT')}
                                                disabled={item.stock <= 0}
                                                title={item.stock <= 0 ? 'No stock available' : 'Remove/Adjust Stock'}
                                                className={`flex items-center gap-0.5 px-1.5 py-1 rounded text-[10px] font-bold transition-colors border ${
                                                    item.stock <= 0
                                                    ? 'opacity-40 cursor-not-allowed bg-rose-50/50 text-rose-300 border-rose-100'
                                                    : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 border-rose-100 dark:border-rose-900/30'
                                                }`}
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 12H4"></path></svg>
                                                OUT
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            <div className="shrink-0 flex justify-between items-center p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <div className="text-gray-500 dark:text-gray-400 text-xs font-medium">
                        Showing <span className="font-bold text-gray-900 dark:text-white">{filteredInventory.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-bold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, filteredInventory.length)}</span> of <span className="font-bold text-gray-900 dark:text-white">{filteredInventory.length}</span> results
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
                                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
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

            {/* Stock Adjustment Modal */}
            {isStockModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs md:max-w-sm overflow-hidden transform transition-all scale-100">
                        <div className={`p-4 flex items-center justify-between ${modalAction === 'IN' ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-rose-50 dark:bg-rose-900/30'}`}>
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-full ${modalAction === 'IN' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-rose-100 text-rose-600 dark:bg-rose-900 dark:text-rose-300'}`}>
                                    {modalAction === 'IN' 
                                        ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                        : <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4"></path></svg>
                                    }
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-gray-900 dark:text-white">{modalAction === 'IN' ? 'Stock In' : 'Stock Out'}</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{selectedItem?.name}</p>
                                </div>
                            </div>
                            <button onClick={() => setIsStockModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        
                        <form onSubmit={handleStockSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Quantity</label>
                                <input 
                                    type="text"
                                    inputMode="numeric"
                                    pattern="\\d*"
                                    autoFocus
                                    required
                                    value={stockForm.quantity}
                                    onChange={e => {
                                        const v = (e.target.value || '').replace(/\D/g, '');
                                        setStockForm({ ...stockForm, quantity: v });
                                    }}
                                    onInvalid={(e) => e.target.setCustomValidity('Please enter a valid quantity (whole number).')}
                                    onInput={(e) => e.target.setCustomValidity('')}
                                    className="w-full text-xl font-black text-center p-2.5 bg-gray-50 dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:border-gray-900 dark:focus:border-gray-400 outline-none transition-colors text-gray-900 dark:text-white placeholder-gray-300"
                                    placeholder="0"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Reason</label>
                                <select 
                                    className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                    value={stockForm.reason}
                                    onChange={e => setStockForm({...stockForm, reason: e.target.value})}
                                >
                                    {modalAction === 'IN' ? (
                                        <>
                                            <option>Delivery</option>
                                            <option>Return</option>
                                            <option>Adjustment (Found)</option>
                                        </>
                                    ) : (
                                        <>
                                            <option>Damage</option>
                                            <option>Expired</option>
                                            <option>Loss / Theft</option>
                                            <option>Store Use</option>
                                            <option>Adjustment (Correction)</option>
                                        </>
                                    )}
                                </select>
                            </div>

                            <button 
                                type="submit"
                                className="w-full py-3 rounded-xl font-bold uppercase tracking-widest text-white shadow-lg transition-transform transform hover:-translate-y-0.5 mt-2"
                                style={{ backgroundColor: '#111827' }}
                            >
                                Confirm {modalAction === 'IN' ? 'Receipt' : 'Removal'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Inventory;
