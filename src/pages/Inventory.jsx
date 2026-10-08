import React, { useState, useMemo, useEffect, useRef } from 'react';
import Pagination from '../components/Pagination';
import TableSkeletonRows from '../components/TableSkeletonRows';
import IdentifierChip from '../components/IdentifierChip';
import { showToast } from '../utils/toastHelper';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { updateProductStockApi } from '../services/inventoryApi';
import { getStockStatus } from '../utils/recommendationLogic';
import { formatNumber } from '../utils/numberFormat';
import { createClientRequestId } from '../utils/clientRequestId';
import {
    isWholeNumberInput,
    preventInvalidWholeNumberKeyDown,
    preventInvalidWholeNumberPaste,
    sanitizeWholeNumberInput,
} from '../utils/numericInput';

const Inventory = () => {
    const listContainerRef = useRef(null);
    const stockSubmitInFlightRef = useRef(false);
    const stockAdjustmentRequestIdRef = useRef('');
    const { inventory, setInventory, isInventoryLoading } = useInventory();
    const { appSettings } = useAuth();

    const stripTrailingSizeFromName = (nameValue, sizeValue) => {
        const name = String(nameValue || '').trim();
        const size = String(sizeValue || '').trim();
        if (!name || !size) return name;

        const escapedSize = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`\\s*\\(${escapedSize}\\)\\s*$`, 'i'),
            new RegExp(`\\s*[-–—,:|/]\\s*${escapedSize}\\s*$`, 'i'),
            new RegExp(`\\s+${escapedSize}\\s*$`, 'i')
        ];

        let cleaned = name;
        patterns.forEach((pattern) => {
            cleaned = cleaned.replace(pattern, '').trim();
        });

        return cleaned || name;
    };

    const extractTrailingSizeFromName = (nameValue) => {
        const name = String(nameValue || '').trim();
        if (!name) return { name: '', size: '' };

        const unitPattern = 'ft|inches|inch|mm|cm|m|meters|kg|g|bags|cu\\.m|liters|liter|ml|gallons|gallon|oz|lbs|watts|mm²|set|pcs|quart|gauge';
        const patterns = [
            /^\s*(.*?)\s*\(([^)]+)\)\s*$/i,
            /^\s*(.*?)\s*[-–—,:|/]\s*([^,]+?)\s*$/i,
            new RegExp(`^\\s*(.*?[A-Za-z])\\s*((?:\\d+[A-Za-z²0-9./"]*)(?:\\s*[x×]\\s*(?:\\d+[A-Za-z²0-9./"]*)){1,3})\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?[A-Za-z])\\s*(\\d+[\\d./"]*(?:\\s*[x×]\\s*(?:\\d+[\\d./"]*)){1,3}(?:\\s*(?:${unitPattern}))?)\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?[A-Za-z])\\s*(\\d+[\\d./"]*\\s*(?:${unitPattern}))\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?)\\s+((?:\\d+[\\d./"]*)(?:\\s*[x×]\\s*(?:\\d+[\\d./"]*)){1,3}(?:\\s*(?:${unitPattern}))?)\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?)\\s+(\\d+[\\d./"]*\\s*(?:${unitPattern}))\\s*$`, 'i')
        ];

        for (const pattern of patterns) {
            const match = name.match(pattern);
            if (!match) continue;

            const candidateName = String(match[1] || '').trim();
            const candidateSize = String(match[2] || '').trim();
            if (!candidateName || !candidateSize) continue;

            const endsWithUnit = new RegExp(`(?:${unitPattern})\\s*$`, 'i').test(candidateSize);
            const looksLikeDimensions = /[x×]/i.test(candidateSize);
            if (!endsWithUnit && !looksLikeDimensions) continue;

            return { name: candidateName, size: candidateSize };
        }

        return { name, size: '' };
    };
    
    // Helper to log actions
    const [isStockModalOpen, setIsStockModalOpen] = useState(false);
    const [isStockSubmitting, setIsStockSubmitting] = useState(false);
    const [modalAction, setModalAction] = useState('IN'); // 'IN' (Add Stock) or 'OUT' (Remove/Adjust)
    const [selectedItem, setSelectedItem] = useState(null);
    const [stockForm, setStockForm] = useState({ quantity: '', reason: '', notes: '', otherReason: '' });

    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [sortBy, setSortBy] = useState('off'); 
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [enlargedProductImage, setEnlargedProductImage] = useState(null);
    
    // UI State for Filter Panel
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchQuery]);

    const deriveStatus = (item) => getStockStatus(item, appSettings);

    const normalizedInventory = useMemo(() => {
        return inventory.map((item) => {
            const storedSize = String(item?.size || '').trim();
            if (storedSize) {
                const cleanedName = stripTrailingSizeFromName(item?.name, storedSize);
                return { ...item, _displayName: cleanedName, _displaySize: storedSize };
            }

            const inferred = extractTrailingSizeFromName(item?.name);
            return { ...item, _displayName: inferred.name, _displaySize: inferred.size };
        });
    }, [inventory]);

    // Derived Categories
    const categories = ['All', ...Array.from(new Set(normalizedInventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

    const inventorySearchSuggestions = useMemo(() => {
        const terms = new Set();

        normalizedInventory.forEach((item) => {
            [
                item?._displayName,
                item?.code,
                item?.brand,
                item?.color,
                item?._displaySize,
                item?.category,
            ].forEach((value) => {
                const text = String(value || '').trim();
                if (text) {
                    terms.add(text);
                }
            });
        });

        return Array.from(terms)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .slice(0, 120);
    }, [normalizedInventory]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Active filter count for Clear All visibility
    const activeFilterCount = (statusFilter !== 'All' ? 1 : 0) + (categoryFilter !== 'All' ? 1 : 0) + (sortBy !== 'off' ? 1 : 0);

    // Filtered & Sorted Logic
    const filteredInventory = useMemo(() => {
        return normalizedInventory
            .filter(item => {
                // Hide archived
                if (item.isArchived) return false;

                // Status filter
                const derivedStatus = deriveStatus(item);
                if (statusFilter !== 'All' && derivedStatus !== statusFilter) return false;

                // Category filter
                if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;

                // Search
                const q = debouncedSearchQuery.toLowerCase();
                const matchesSearch = !q || item._displayName.toLowerCase().includes(q) || 
                                    item.code.toLowerCase().includes(q) ||
                                    (item.brand || '').toLowerCase().includes(q) ||
                                    (item.color || '').toLowerCase().includes(q) ||
                                    (item._displaySize && item._displaySize.toLowerCase().includes(q));
                
                return matchesSearch;
            })
            .sort((a, b) => {
                switch(sortBy) {
                    case 'name-asc': return a._displayName.localeCompare(b._displayName);
                    case 'name-desc': return b._displayName.localeCompare(a._displayName);
                    case 'stock-asc': return a.stock - b.stock;
                    case 'stock-desc': return b.stock - a.stock;
                    default: return 0;
                }
            });
    }, [normalizedInventory, statusFilter, categoryFilter, debouncedSearchQuery, sortBy, appSettings]);

    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, categoryFilter, debouncedSearchQuery, sortBy]);

    useEffect(() => {
        if (!listContainerRef.current) return;
        listContainerRef.current.scrollTop = 0;
    }, [currentPage]);

    // Pagination Logic
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredInventory.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredInventory.length / itemsPerPage);
    useEffect(() => {
        setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
    }, [totalPages]);
    const getProductImageUrl = (item) => String(item?.imageUrl || '').trim();
    const previewableInventoryItems = useMemo(() => {
        return filteredInventory.filter((item) => getProductImageUrl(item));
    }, [filteredInventory]);

    const getStatusColor = (status) => {
        switch(status) {
            case 'Out of Stock': return 'bg-red-50 text-red-600 border border-red-200 font-semibold';
            case 'Low Stock': return 'bg-yellow-50 text-yellow-600 border border-yellow-200 font-semibold'; 
            default: return 'bg-emerald-50 text-emerald-600 border border-emerald-200 font-semibold'; 
        }
    };

    const openProductImagePreview = (item) => {
        const imageUrl = getProductImageUrl(item);
        if (!imageUrl) return;

        setEnlargedProductImage({
            src: imageUrl,
            alt: item?._displayName || item?.name || item?.code || 'Product image',
            code: item?.code || imageUrl,
        });
    };

    const navigateProductImagePreview = (direction) => {
        if (!enlargedProductImage || previewableInventoryItems.length <= 1) return;

        const currentIndex = previewableInventoryItems.findIndex((item) => {
            const itemImageUrl = getProductImageUrl(item);
            return item.code === enlargedProductImage.code || itemImageUrl === enlargedProductImage.src;
        });

        if (currentIndex < 0) return;

        const nextIndex = (currentIndex + direction + previewableInventoryItems.length) % previewableInventoryItems.length;
        const nextItem = previewableInventoryItems[nextIndex];

        setEnlargedProductImage({
            src: getProductImageUrl(nextItem),
            alt: nextItem?._displayName || nextItem?.name || nextItem?.code || 'Product image',
            code: nextItem?.code || getProductImageUrl(nextItem),
        });
    };

    const closeProductImagePreview = () => {
        setEnlargedProductImage(null);
    };

    useEffect(() => {
        if (!enlargedProductImage) return;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeProductImagePreview();
                return;
            }

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                navigateProductImagePreview(-1);
                return;
            }

            if (event.key === 'ArrowRight') {
                event.preventDefault();
                navigateProductImagePreview(1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enlargedProductImage, previewableInventoryItems]);

    // --- STOCK MANAGEMENT LOGIC ---

    const handleOpenStockModal = (item, action) => {
        stockAdjustmentRequestIdRef.current = createClientRequestId('stock-adjustment');
        setSelectedItem(item);
        setModalAction(action);
        setStockForm({ quantity: '', reason: action === 'IN' ? 'Delivery' : 'Damage', notes: '', otherReason: '' });
        setIsStockModalOpen(true);
    };

    const handleStockSubmit = async (e) => {
        e.preventDefault();
        if (stockSubmitInFlightRef.current) return;
        if (!navigator.onLine) {
            showToast("You're Offline", 'Stock adjustments require an internet connection.', 'warning', 'stock-offline');
            return;
        }
        const hasValidQuantity = isWholeNumberInput(stockForm.quantity, { min: 1 });
        const qty = hasValidQuantity ? Number(stockForm.quantity) : 0;
        const reasonValue = stockForm.reason === 'Other'
            ? String(stockForm.otherReason || '').trim()
            : String(stockForm.reason || '').trim();
        if (!selectedItem || !hasValidQuantity) {
            showToast('Invalid Quantity', 'Please enter a valid quantity (whole number).', 'error', 'stock-qty');
            return;
        }
        if (!reasonValue) {
            showToast('Missing Reason', 'Please select or enter a reason.', 'error', 'stock-reason');
            return;
        }

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

        stockSubmitInFlightRef.current = true;
        setIsStockSubmitting(true);

        try {
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
                const statusCarrier = { ...item, stock: newStock };
                return { 
                    ...item, 
                    stock: newStock,
                    status: deriveStatus(statusCarrier)
                };
            }
            return item;
        });

        const selectedUpdatedItem = updatedInventory.find(item => item.code === selectedItem.code);
        const token = getAuthToken();
        if (!token || !selectedItem.id || !selectedUpdatedItem) {
            showToast('Stock Adjustment Failed', 'Unable to identify the product for this stock adjustment.', 'error', 'stock-sync');
            return;
        }

        let persistedProduct;
        try {
            persistedProduct = await updateProductStockApi(selectedItem.id, selectedUpdatedItem.stock, {
                adjustmentReason: reasonValue,
                adjustmentRequestId: stockAdjustmentRequestIdRef.current,
                expectedStock: inventory.find((item) => item.code === selectedItem.code)?.stock,
                expectedUpdatedAt: inventory.find((item) => item.code === selectedItem.code)?.updatedAt,
            });
        } catch (error) {
            showToast(
                isApiConnectionFailure(error) ? 'Cannot reach API server.' : 'Stock Adjustment Failed',
                error.message || 'Stock change was not saved.',
                'error',
                'stock-sync'
            );
            return;
        }

        const confirmedStock = Number(persistedProduct?.stock ?? selectedUpdatedItem.stock);
        setInventory((previous) => previous.map((item) => {
            if (item.id !== selectedItem.id) return item;
            const confirmedItem = { ...item, stock: confirmedStock, updatedAt: persistedProduct?.updatedAt || item.updatedAt };
            return { ...confirmedItem, status: deriveStatus(confirmedItem) };
        }));
        setIsStockModalOpen(false);
        stockAdjustmentRequestIdRef.current = '';
        if (modalAction === 'IN') {
            showToast('Success', 'Stock received successfully', 'success', 'stock-update');
        } else {
            showToast('Updated', 'Stock adjusted successfully', 'save', 'stock-update');
        }
        } finally {
            stockSubmitInFlightRef.current = false;
            setIsStockSubmitting(false);
        }
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 md:overflow-hidden">
            <div className="bg-slate-200/50 rounded-2xl border border-slate-300 shadow-inner flex flex-col md:h-full md:overflow-hidden relative transition-colors">

            {/* Header Area */}
            <div className="p-3 pb-0 md:shrink-0">
                <div className="mb-4">
                    <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Stock Operations</p>
                    <p className="text-gray-500 dark:text-gray-400 text-[11px] md:text-xs font-medium mt-1">Manage stock in/out flow and adjustments</p>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-2 mb-3">
                     {/* Search */}
                     <div className="main-toolbar-search group">
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={searchQuery}
                            list="inventory-search-suggestions"
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="main-toolbar-search-input"
                        />
                        <datalist id="inventory-search-suggestions">
                            {inventorySearchSuggestions.map((term) => (
                                <option key={term} value={term} />
                            ))}
                        </datalist>
                         <div className="main-toolbar-search-icon">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                     </div>

                     {/* Single Filter & Sort Button */}
                     <div className="relative z-30 inline-flex items-center gap-3">
                        <button 
                            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                            className="shrink-0 whitespace-nowrap px-3 py-2 rounded-xl font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                            <span>Filter & Sort</span>
                            <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>

                            {/* Category select (adjacent to Filter & Sort) */}
                            <div className="hidden sm:inline-flex items-center">
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="appearance-none px-3 py-1.5 rounded-xl text-sm font-semibold inline-flex items-center transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
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
                                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Status</div>
                                </div>
                                <div className="px-2 pb-2 flex flex-wrap gap-1">
                                    {['All', 'In Stock', 'Low Stock', 'Out of Stock'].map(status => (
                                        <button key={status} onClick={() => setStatusFilter(status)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                statusFilter === status
                                                ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                : status === 'Low Stock' ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400'
                                                : status === 'Out of Stock' ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'
                                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
                                            }`}>
                                            {status === 'All' ? 'All Status' : status}
                                        </button>
                                    ))}
                                </div>

                                <div className="border-t border-gray-100 dark:border-gray-700 mx-3"></div>

                                {/* Sort Section */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sort By</div>
                                </div>
                                <div className="px-2 pb-2">
                                    {[{key: 'off', label: 'Default'}, {key: 'stock-asc', label: 'Stock ↑ Lowest'}, {key: 'stock-desc', label: 'Stock ↓ Highest'}, {key: 'name-asc', label: 'Name A→Z'}, {key: 'name-desc', label: 'Name Z→A'}].map(opt => (
                                        <button key={opt.key} onClick={() => setSortBy(opt.key)}
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
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
                                            <button onClick={() => { setStatusFilter('All'); setCategoryFilter('All'); setSortBy('off'); }}
                                                className="w-full text-center px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">
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
                             Use <span className="font-semibold text-gray-700 dark:text-gray-300">Product Master List</span> to add new items
                        </span>
                     </div>
                </div>
            
                {/* Backdrop for closing panel */}
                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}
            </div>

            {/* Inventory Table */}
            <div ref={listContainerRef} className="flex-1 overflow-x-auto overscroll-x-contain md:overflow-y-auto px-4 pb-4">
                <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[980px] md:min-w-205">
                    <thead className="sticky top-0 z-10 shadow-sm">
                        <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                            <th className="py-2 px-3 w-[15%] text-center text-[11px] font-semibold border border-gray-700">SKU</th>
                            <th className="py-2 px-3 w-[10%] text-center text-[11px] font-semibold border border-gray-700">Photo</th>
                            <th className="py-2 px-3 w-[21%] md:w-[25%] text-center text-[11px] font-semibold border border-gray-700">Product</th>
                            <th className="py-2 px-3 w-[13%] md:w-[15%] text-center text-[11px] font-semibold border border-gray-700">Category</th>
                            <th className="py-2 px-3 w-[14%] md:w-[15%] text-center text-[11px] font-semibold border border-gray-700">Current Stock</th>
                            <th className="py-2 px-3 w-[12%] md:w-[10%] text-center text-[11px] font-semibold border border-gray-700">Status</th>
                            <th className="py-2 pl-3 pr-5 w-[15%] md:w-[10%] text-center text-[11px] font-semibold border border-gray-700">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-gray-100 dark:divide-gray-700">
                        {isInventoryLoading ? (
                            <TableSkeletonRows rowKeyPrefix="inventory-skeleton" columnTypes={['text', 'text', 'text', 'text', 'text', 'pill', 'actions']} />
                        ) : filteredInventory.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="p-12 text-center text-gray-400 dark:text-gray-500">
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
                                        <IdentifierChip>{item.code}</IdentifierChip>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        {getProductImageUrl(item) ? (
                                            <button
                                                type="button"
                                                onClick={() => openProductImagePreview(item)}
                                                className="group/photo mx-auto relative h-12 w-12 rounded-xl overflow-hidden border flex items-center justify-center transition-transform duration-150 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300 bg-gray-100 border-gray-200 dark:bg-gray-700 dark:border-gray-600"
                                                aria-label={`Enlarge image for ${item._displayName || item.name || item.code || 'product'}`}
                                            >
                                                <img
                                                    src={getProductImageUrl(item)}
                                                    alt={item._displayName || item.name || item.code || 'Product'}
                                                    className="h-full w-full object-cover transition-all duration-200 group-hover/photo:scale-110 group-hover/photo:opacity-35 group-hover/photo:blur-[1.5px]"
                                                    loading="lazy"
                                                />
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/0 opacity-0 transition-all duration-150 group-hover/photo:bg-black/45 group-hover/photo:opacity-100">
                                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-gray-900 shadow-md ring-1 ring-black/5">
                                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 3H3v5M3 3l6 6M16 3h5v5m0-5l-6 6M8 21H3v-5m0 5l6-6M16 21h5v-5m0 5l-6-6"></path>
                                                        </svg>
                                                    </span>
                                                </div>
                                            </button>
                                        ) : (
                                            <div className="mx-auto h-12 w-12 rounded-xl border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 flex items-center justify-center text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                                                IMG
                                            </div>
                                        )}
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <div className="flex flex-col items-center">
                                            <span className="font-semibold text-gray-900 dark:text-white text-sm">{item.brand ? `${item.brand} ` : ''}{item._displayName || item.name}</span>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">{item._displaySize || item.size || '-'} {item.color ? `• ${item.color}` : ''}</span>
                                        </div>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{item.category}</span>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className="font-semibold text-gray-900 dark:text-white text-base">{formatNumber(item.stock)}</span>
                                    </td>
                                    <td className="py-2 px-3 text-center border border-gray-200 dark:border-gray-700">
                                        <span className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusColor(deriveStatus(item))}`}>
                                            {deriveStatus(item)}
                                        </span>
                                    </td>
                                    <td className="py-2 pl-3 pr-5 text-center border border-gray-200 dark:border-gray-700">
                                        <div className="flex flex-nowrap items-center justify-center gap-2 whitespace-nowrap">
                                            <button 
                                                onClick={() => handleOpenStockModal(item, 'IN')}
                                                className="inline-flex h-8 w-14 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] font-medium tracking-wide text-slate-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:bg-emerald-100 focus-visible:border-emerald-200 focus-visible:bg-emerald-50 focus-visible:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25 focus-visible:ring-offset-1 dark:border-slate-700 dark:bg-[#282b30] dark:text-slate-200 dark:hover:border-emerald-800/60 dark:hover:bg-emerald-950/35 dark:hover:text-emerald-300 dark:active:bg-emerald-900/35 dark:focus-visible:border-emerald-800/60 dark:focus-visible:bg-emerald-950/35 dark:focus-visible:text-emerald-300 dark:focus-visible:ring-emerald-400/25 dark:focus-visible:ring-offset-[#222428]"
                                                title="Received Stock"
                                            >
                                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                                IN
                                            </button>
                                            <button
                                                onClick={() => item.stock > 0 && handleOpenStockModal(item, 'OUT')}
                                                disabled={item.stock <= 0}
                                                title={item.stock <= 0 ? 'No stock available' : 'Remove/Adjust Stock'}
                                                className={`inline-flex h-8 w-14 shrink-0 items-center justify-center gap-1 rounded-lg border px-1.5 text-[11px] font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/25 focus-visible:ring-offset-1 dark:focus-visible:ring-rose-400/25 dark:focus-visible:ring-offset-[#222428] ${
                                                    item.stock <= 0
                                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-[#24262a] dark:text-slate-500'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 active:bg-rose-100 focus-visible:border-rose-200 focus-visible:bg-rose-50 focus-visible:text-rose-700 dark:border-slate-700 dark:bg-[#282b30] dark:text-slate-200 dark:hover:border-rose-800/60 dark:hover:bg-rose-950/35 dark:hover:text-rose-300 dark:active:bg-rose-900/35 dark:focus-visible:border-rose-800/60 dark:focus-visible:bg-rose-950/35 dark:focus-visible:text-rose-300'
                                                }`}
                                            >
                                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" d="M20 12H4"></path></svg>
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
            <div className="flex shrink-0 flex-col items-start gap-3 border-t border-gray-100 bg-slate-200/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-gray-500 dark:text-gray-400 text-xs font-medium">
                        Showing <span className="font-semibold text-gray-900 dark:text-white">{filteredInventory.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-semibold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, filteredInventory.length)}</span> of <span className="font-semibold text-gray-900 dark:text-white">{filteredInventory.length}</span> results
                    </div>
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
            </div>

            {isStockModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl transition-all dark:bg-gray-800 sm:max-w-sm">
                        <div className="flex items-center justify-between border-b-2 border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {modalAction === 'IN' ? 'Stock In' : 'Stock Out'}
                                </h2>
                                <p className="mt-0.5 truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                                    {selectedItem?.name || selectedItem?.code || 'Inventory item'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsStockModalOpen(false)}
                                disabled={isStockSubmitting}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                aria-label={`Close ${modalAction === 'IN' ? 'stock in' : 'stock out'} modal`}
                            >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <form onSubmit={handleStockSubmit} className="space-y-4 p-4 sm:p-6">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Quantity</label>
                                <div className="flex min-w-0 items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const current = Number(stockForm.quantity || 0);
                                            const next = Math.max(1, Math.floor(current || 1) - 1);
                                            setStockForm({ ...stockForm, quantity: String(next) });
                                        }}
                                        className="h-10 w-10 shrink-0 rounded-xl border border-gray-200 bg-white text-lg font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                        aria-label="Decrease quantity"
                                    >
                                        -
                                    </button>
                                    <input 
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        min="1"
                                        step="1"
                                        autoFocus
                                        required
                                        value={stockForm.quantity}
                                        onKeyDown={preventInvalidWholeNumberKeyDown}
                                        onPaste={preventInvalidWholeNumberPaste}
                                        onChange={e => setStockForm({ ...stockForm, quantity: sanitizeWholeNumberInput(e.target.value) })}
                                        className="min-w-0 flex-1 rounded-xl border-2 border-gray-200 bg-gray-50 p-2.5 text-center text-xl font-semibold text-gray-900 outline-none transition-colors placeholder-gray-300 focus:border-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-gray-400"
                                        placeholder="0"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const current = Number(stockForm.quantity || 0);
                                            const next = Math.max(1, Math.floor(current || 0) + 1);
                                            setStockForm({ ...stockForm, quantity: String(next) });
                                        }}
                                        className="h-10 w-10 shrink-0 rounded-xl border border-gray-200 bg-white text-lg font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                        aria-label="Increase quantity"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Reason</label>
                                <select 
                                    className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                    value={stockForm.reason}
                                    onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setStockForm((prev) => ({
                                            ...prev,
                                            reason: nextValue,
                                            otherReason: nextValue === 'Other' ? prev.otherReason : '',
                                        }));
                                    }}
                                >
                                    {modalAction === 'IN' ? (
                                        <>
                                            <option>Delivery</option>
                                            <option>Return</option>
                                            <option>Adjustment (Found)</option>
                                            <option>Other</option>
                                        </>
                                    ) : (
                                        <>
                                            <option>Damage</option>
                                            <option>Expired</option>
                                            <option>Loss / Theft</option>
                                            <option>Store Use</option>
                                            <option>Adjustment (Correction)</option>
                                            <option>Other</option>
                                        </>
                                    )}
                                </select>
                            </div>
                            {stockForm.reason === 'Other' && (
                                <div>
                                    <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Other Reason</label>
                                    <input
                                        type="text"
                                        value={stockForm.otherReason}
                                        onChange={(e) => setStockForm((prev) => ({ ...prev, otherReason: e.target.value }))}
                                        className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                        placeholder="Enter reason"
                                    />
                                </div>
                            )}

                            <button 
                                type="submit"
                                disabled={isStockSubmitting}
                                className="w-full py-3 rounded-xl font-semibold tracking-widest text-white shadow-lg transition-transform transform hover:-translate-y-0.5 mt-2"
                                style={{ backgroundColor: '#111827' }}
                            >
                                {isStockSubmitting ? 'Processing...' : `Confirm ${modalAction === 'IN' ? 'Stock' : 'Removal'}`}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {enlargedProductImage && (
                <div
                    className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 backdrop-blur-lg p-4 animate-in fade-in duration-200"
                    onClick={closeProductImagePreview}
                >
                    <div
                        className="relative w-full max-w-5xl h-[78vh] md:h-[80vh] flex items-center justify-center animate-in zoom-in-90 fade-in duration-250 overflow-visible px-12 md:px-16 py-12"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={closeProductImagePreview}
                            className="absolute top-3 right-3 z-10 h-10 w-10 rounded-full bg-white text-gray-900 shadow-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
                            aria-label="Close image preview"
                        >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                        {previewableInventoryItems.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => navigateProductImagePreview(-1)}
                                    className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white/95 text-gray-900 shadow-lg flex items-center justify-center hover:bg-white transition-colors border border-black/5"
                                    aria-label="Previous image"
                                >
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path>
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigateProductImagePreview(1)}
                                    className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white/95 text-gray-900 shadow-lg flex items-center justify-center hover:bg-white transition-colors border border-black/5"
                                    aria-label="Next image"
                                >
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path>
                                    </svg>
                                </button>
                            </>
                        )}
                        <img
                            src={enlargedProductImage.src}
                            alt={enlargedProductImage.alt}
                            className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-white/10 bg-white"
                        />
                    </div>
                </div>
            )}
        </div>
    </div>
    );
};

export default Inventory;
