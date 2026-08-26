import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    getAlternatives,
    getAlternativesByBudget,
    getRelativePriceTier,
    getRawSystemRecommendations,
    getStockStatus,
} from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toastHelper';
import Pagination from '../components/Pagination';
import { formatCurrency } from '../utils/numberFormat';
import { removeProductRecommendationApi } from '../services/inventoryApi';

const DEFAULT_VISIBLE_RECOMMENDATIONS = 3;

const Recommendation = () => {
    const listContainerRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [stockScope, setStockScope] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 16;
    const { appSettings } = useAuth() || {};
    const getTierDisplayLabel = (tier) => {
        if (tier === 'value') return 'Value';
        if (tier === 'standard') return 'Standard';
        if (tier === 'premium') return 'Premium';
        if (tier === 'low') return 'Value';
        if (tier === 'moderate') return 'Standard';
        if (tier === 'high') return 'Premium';
        return 'Standard';
    };
    const getTierBadgeClass = (tier) => {
        if (tier === 'value' || tier === 'low') return 'text-emerald-700 bg-emerald-50 border-emerald-100';
        if (tier === 'premium' || tier === 'high') return 'text-blue-700 bg-blue-50 border-blue-100';
        return 'text-amber-700 bg-amber-50 border-amber-100';
    };

    // Inventory helpers from context
    const { inventory: rawInventory, setInventory, processedInventory, logActivity, logAction } = useInventory();
    
    // Use processed items
    const inventory = rawInventory || processedInventory || [];

    // State for Add Alternative Modal
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [activeTargetItem, setActiveTargetItem] = useState(null); // The item we are adding alternatives TO
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const [debouncedAddSearchTerm, setDebouncedAddSearchTerm] = useState('');
    const [addFilterCategory, setAddFilterCategory] = useState('All'); // New state for category filter in modal

    // State for Product Details Modal
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [viewDetailsItem, setViewDetailsItem] = useState(null);

    // State for Confirmation Modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState(null); // { targetCode, alternativeCode, alternativeName }
    const [recommendationDrawerTarget, setRecommendationDrawerTarget] = useState(null);

    // Restore hidden items on mount
    useEffect(() => {
        if (!setInventory) return;
        setInventory(prev => (prev || []).map(p => p.hiddenFromRecommendations ? { ...p, hiddenFromRecommendations: false } : p));
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchTerm]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedAddSearchTerm(addSearchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [addSearchTerm]);

    // Unique filter categories
    const categories = useMemo(() => {
        const cats = new Set(inventory.map(i => i.category || 'Uncategorized'));
        return ['All', ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
    }, [inventory]);

    // Logic to find items that need recommendation
    const attentionItems = useMemo(() => {
        return inventory.filter(item => {
            const status = getStockStatus(item, appSettings);

            if (stockScope === 'needs-attention' && status === 'In Stock') return false;
            if (stockScope === 'in-stock' && status !== 'In Stock') return false;
            
            const searchLower = debouncedSearchTerm.toLowerCase();
            const matchesSearch = item.name.toLowerCase().includes(searchLower) || 
                                  item.code.toLowerCase().includes(searchLower) ||
                                  (item.brand || '').toLowerCase().includes(searchLower);

            const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;

            return matchesSearch && matchesCategory;
        }).sort((a, b) => {
            const nameCompare = String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
            if (nameCompare !== 0) return nameCompare;
            return String(a?.code || '').localeCompare(String(b?.code || ''), undefined, { sensitivity: 'base' });
        });
    }, [inventory, debouncedSearchTerm, selectedCategory, appSettings, stockScope]);

    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, selectedCategory, stockScope]);

    const totalPages = Math.ceil(attentionItems.length / itemsPerPage);
    const hasResults = attentionItems.length > 0;
    const displayStart = hasResults ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const displayEnd = hasResults ? Math.min(currentPage * itemsPerPage, attentionItems.length) : 0;

    useEffect(() => {
        if (totalPages > 0 && currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const paginatedAttentionItems = useMemo(() => {
        if (!hasResults) return [];
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        return attentionItems.slice(startIndex, endIndex);
    }, [attentionItems, currentPage, hasResults]);

    useEffect(() => {
        if (!listContainerRef.current) return;
        listContainerRef.current.scrollTop = 0;
    }, [currentPage]);

    // Remove Alternative Trigger
    const handleRemoveAlternative = (targetItem, alternativeCode, alternativeName) => {
        setPendingRemoval({
            targetId: targetItem?.id,
            targetCode: targetItem?.code,
            alternativeCode,
            alternativeName,
        });
        setIsConfirmModalOpen(true);
    };

    // Confirm Removal Logic
    const confirmRemoval = async () => {
        if (!pendingRemoval || !setInventory) return;

        const { targetId, targetCode, alternativeCode } = pendingRemoval;
        const targetItem = inventory.find((item) => item.id === targetId || item.code === targetCode);
        const currentAlternatives = targetItem
            ? getAlternatives(targetItem, inventory, appSettings, { maxSuggestions: 6 })
            : [];

        if (!targetItem?.id || !currentAlternatives.some((alternative) => alternative.code === alternativeCode)) {
            showToast('Unable to Remove', 'This recommendation is no longer available. Refresh and try again.', 'error');
            setIsConfirmModalOpen(false);
            setPendingRemoval(null);
            return;
        }

        try {
            const updatedTarget = await removeProductRecommendationApi(targetItem.id, alternativeCode);
            const wasPersisted = updatedTarget.excludedAlternatives.includes(alternativeCode)
                && !updatedTarget.manualAlternatives.includes(alternativeCode);

            if (!wasPersisted) {
                throw new Error('The recommendation was not removed.');
            }

            setInventory((current) => current.map((item) => (
                item.id === targetItem.id ? updatedTarget : item
            )));
            setRecommendationDrawerTarget((current) => (
                current?.id === targetItem.id ? updatedTarget : current
            ));

            showToast('Success', 'Alternative removed.', 'success');
            setIsConfirmModalOpen(false);
            setPendingRemoval(null);
        } catch (error) {
            showToast('Unable to Remove', error?.message || 'The recommendation could not be removed.', 'error');
        }
    };

    // Add Alternative Logic
    const handleAddAlternative = (alternativeCode) => {
        if (!setInventory || !activeTargetItem) return;

        setInventory(prev => prev.map(item => {
            if (item.code !== activeTargetItem.code) return item;

            // Add to manual list
            const currentManual = item.manualAlternatives || [];
            const newManual = [...new Set([...currentManual, alternativeCode])];

            // Remove from excluded list if present
            const currentExcluded = item.excludedAlternatives || [];
            const newExcluded = currentExcluded.filter(c => c !== alternativeCode);

            return { ...item, manualAlternatives: newManual, excludedAlternatives: newExcluded };
        }));
        
        setIsAddModalOpen(false);
        setAddSearchTerm('');
        showToast('Success', 'Alternative added.', 'success');
    };

    // Filter items for "Add Alternative" modal
    const potentialAlternatives = useMemo(() => {
        if (!activeTargetItem) return [];
        
        // Get raw top recommendations by system (ignoring exclusions) to flag them
        const systemRecs = getRawSystemRecommendations(activeTargetItem, inventory, appSettings);
        const systemRecCodes = systemRecs.map(r => r.code);
        
        const search = debouncedAddSearchTerm.toLowerCase();

        return inventory.filter(i => {
             // Exclude self
            if (i.code === activeTargetItem.code) return false;
            // Exclude already linked as manual
            if ((activeTargetItem.manualAlternatives || []).includes(i.code)) return false;

            // Apply Category Filter
            if (addFilterCategory !== 'All' && i.category !== addFilterCategory) return false;

            // Apply Search (if empty, show all logic applies but we limit via slice)
            if (!search) return true;

            const nameMatch = i.name.toLowerCase().includes(search);
            const codeMatch = i.code.toLowerCase().includes(search);
            const brandMatch = (i.brand || '').toLowerCase().includes(search);

            return nameMatch || codeMatch || brandMatch;
        })
        .map(item => ({
             ...item,
               recommendationTier: getRelativePriceTier(activeTargetItem?.price, item?.price),
             isSystemRecommended: systemRecCodes.includes(item.code)
        }))
        .sort((a, b) => {
             // Sort recommended items to top
             if (a.isSystemRecommended && !b.isSystemRecommended) return -1;
             if (!a.isSystemRecommended && b.isSystemRecommended) return 1;
             // Secondary sort: Alphabetical by name
             return a.name.localeCompare(b.name);
        })
        .slice(0, 50); // Increased limit to show more items, or unlimited if paginated
    }, [inventory, activeTargetItem, debouncedAddSearchTerm, addFilterCategory]);

    const recommendationSearchSuggestions = useMemo(() => {
        const terms = new Set();

        inventory.forEach((item) => {
            [item?.name, item?.category, item?.code]
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
    }, [inventory]);

    const addAlternativeSearchSuggestions = useMemo(() => {
        const terms = new Set();

        potentialAlternatives.forEach((item) => {
            [item?.name, item?.category, item?.code]
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
    }, [potentialAlternatives]);

    const drawerAlternatives = recommendationDrawerTarget
        ? getAlternatives(recommendationDrawerTarget, inventory, appSettings, { maxSuggestions: 6 })
        : [];
    const drawerIsInStock = recommendationDrawerTarget
        ? getStockStatus(recommendationDrawerTarget, appSettings) === 'In Stock'
        : false;

    return (
        <div className="flex flex-col h-auto md:h-full bg-slate-200/50 p-6 md:overflow-hidden rounded-2xl shadow-inner border border-slate-300">
            {/* Header Section */}
            <div className="flex flex-col gap-4 mb-8 shrink-0 relative z-10">
                <div className="overflow-hidden">
                    <p className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight whitespace-nowrap">Product Recommendations</p>
                    <p className="text-gray-500 font-medium text-[11px] md:text-xs mt-1 truncate">Manage product alternatives and view system suggestions.</p>
                </div>
                {/* Search / Filter Controls */}
                <div className="flex flex-col sm:flex-row gap-3 w-full items-stretch sm:items-center">
                    <div className="relative w-full md:max-w-xs group z-20">
                        <input
                            type="text"
                            placeholder="Search products..."
                            value={searchTerm}
                            list="recommendation-search-suggestions"
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-gray-50 border-2 border-gray-100 rounded-xl text-sm focus:bg-white focus:border-gray-900 focus:ring-4 focus:ring-gray-100 transition-all shadow-sm placeholder:text-gray-400 font-semibold text-gray-800"
                        />
                        <datalist id="recommendation-search-suggestions">
                            {recommendationSearchSuggestions.map((term) => (
                                <option key={term} value={term} />
                            ))}
                        </datalist>
                         <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1 bg-gray-900 rounded-lg shadow-sm border border-gray-900 transition-all duration-300">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="appearance-none w-full md:w-48 px-3 py-1.5 rounded-xl text-sm font-semibold inline-flex items-center transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                    >
                        {categories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                    <select
                        value={stockScope}
                        onChange={(e) => setStockScope(e.target.value)}
                        className="appearance-none w-full md:w-48 px-3 py-1.5 rounded-xl text-sm font-semibold inline-flex items-center transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                    >
                        <option value="all" className="bg-white text-gray-900 py-1">All Products</option>
                        <option value="needs-attention" className="bg-white text-gray-900 py-1">Low/Out Stock</option>
                        <option value="in-stock" className="bg-white text-gray-900 py-1">In Stock</option>
                    </select>
                </div>
            </div>

            {/* Main Content Grid */}
            <div ref={listContainerRef} className="flex-1 overflow-y-auto pr-2 pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-200">
                {attentionItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                        <div className="w-16 h-16 bg-gray-100/50 rounded-full flex items-center justify-center mb-4 border border-gray-100">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">No Recommendations</h3>
                        <p className="text-gray-500 text-sm">No products match your current filters.</p>
                    </div>
                ) : (
                    <>
                    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
                        {paginatedAttentionItems.map((item) => {
                            const stockStatus = getStockStatus(item, appSettings);
                            const alternatives = getAlternatives(item, inventory, appSettings, { maxSuggestions: 6 });
                            const budgetOptions = getAlternativesByBudget(item, inventory, appSettings, { limitPerTier: 1, maxSuggestions: 9 });
                            const isOutOfStock = stockStatus === 'Out of Stock';
                            const isLowStock = stockStatus === 'Low Stock';
                            const isInStock = stockStatus === 'In Stock';
                            const hasMoreAlternatives = alternatives.length > DEFAULT_VISIBLE_RECOMMENDATIONS;
                            const visibleAlternatives = alternatives.slice(0, DEFAULT_VISIBLE_RECOMMENDATIONS);
                            
                            return (
                                <div key={item.code} className="self-start bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all shadow-sm hover:shadow-md flex flex-col overflow-hidden min-h-[220px]">
                                    <div className="p-4 flex flex-col sm:flex-row gap-4 items-stretch h-full">
                                        {/* Left Side: Product Details (No Adjust Stock Button) */}
                                        <div className="flex-1 flex flex-col justify-between h-full w-full min-h-[160px] rounded-lg bg-slate-50/70 px-3 py-3">
                                            <div>
                                                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">Current Product</p>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                                                        isOutOfStock
                                                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                                            : isLowStock
                                                                ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                    }`}>
                                                        {stockStatus}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-gray-400">{item.code}</span>
                                                </div>
                                                <h3 className="text-sm font-semibold text-gray-900 leading-tight mb-0.5 truncate">{item.name}</h3>
                                                <p className="text-[10px] text-gray-500 font-medium mb-3 truncate">{item.brand} {item.size ? `• ${item.size}` : ''}</p>
                                                
                                                <div className="grid grid-cols-2 gap-3 bg-slate-50/50 rounded-lg p-2.5 border border-slate-100">
                                                    <div>
                                                        <span className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Current</span>
                                                        <span className={`text-lg font-semibold ${item.stock <= 0 ? 'text-rose-600' : 'text-gray-900'}`}>{item.stock}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Price</span>
                                                        <span className="text-lg font-semibold text-gray-900">{formatCurrency(item.price)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {/* Button to view full product details */}
                                            <div className="mt-3">
                                                <button
                                                    onClick={() => {
                                                        setViewDetailsItem(item);
                                                        setIsDetailsModalOpen(true);
                                                    }}
                                                    className="w-full py-1.5 px-3 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 text-slate-500 text-[10px] font-semibold rounded-lg transition-all shadow-sm flex items-center justify-center gap-2 group"
                                                >
                                                    <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    View Details
                                                </button>
                                            </div>
                                        </div>

                                        {/* Right Side: Alternatives Management */}
                                        <div className="flex w-full shrink-0 flex-col gap-1.5 border-t border-slate-100 pt-3 sm:w-56 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4 xl:w-60">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-[10px] font-semibold text-gray-900 flex items-center gap-1.5 uppercase tracking-wide">
                                                    <svg className="w-3 h-3 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                                    {isInStock ? 'Budget Options & Alternatives' : 'Alternatives'}
                                                </h4>
                                                <button 
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveTargetItem(item);
                                                        setAddSearchTerm('');
                                                        setAddFilterCategory('All'); // Default all or item.category
                                                        setIsAddModalOpen(true);
                                                    }}
                                                    className="group/btn inline-flex items-center rounded-md border border-gray-900 bg-gray-900 text-white hover:bg-black hover:border-black shadow-sm transition-all px-2 py-1"
                                                    aria-label="Add Alternative"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                                                    <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-semibold group-hover/btn:ml-1 group-hover/btn:max-w-24 group-hover/btn:opacity-100">Add Alternative</span>
                                                </button>
                                            </div>

                                            <p className="text-[9px] leading-snug text-gray-400">
                                                {isInStock
                                                    ? 'Budget options are shown only for in-stock products.'
                                                    : 'Low/Out-of-stock uses standard alternatives only.'}
                                            </p>
                                            
                                            {isInStock && (
                                                <div className="grid grid-cols-3 gap-1">
                                                    {[
                                                        { key: 'low', label: 'Value', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                                                        { key: 'moderate', label: 'Standard', color: 'bg-amber-50 border-amber-200 text-amber-700' },
                                                        { key: 'high', label: 'Premium', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                                                    ].map((tier) => {
                                                        return (
                                                            <div key={tier.key} className={`rounded-md border px-1.5 py-1 flex items-center justify-center text-center ${tier.color}`}>
                                                                <p className="text-[9px] font-semibold uppercase tracking-wider leading-none">{tier.label}</p>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            <div className="grid min-h-[18rem] content-start gap-1.5">
                                                {alternatives.length > 0 ? (
                                                    visibleAlternatives.map(alt => (
                                                        <div key={alt.code} className="relative min-h-[5.75rem] p-2.5 bg-white rounded-xl border border-slate-100 hover:border-slate-300 shadow-sm hover:shadow-md transition-all group/alt">
                                                            
                                                            {/* View Details Button (Absolute Top Left) */}
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setViewDetailsItem(alt);
                                                                    setIsDetailsModalOpen(true);
                                                                }}
                                                                className="group/btn absolute -top-2 -left-2 opacity-0 group-hover/alt:opacity-100 w-6 h-6 bg-white border border-gray-200 text-gray-400 hover:text-white hover:bg-[#111827] hover:border-gray-900 rounded-full flex items-center justify-center shadow-sm transition-all z-10 transform scale-90 group-hover/alt:scale-100"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                                <span className="absolute top-full left-0 mt-2 z-50 w-max pointer-events-none opacity-0 transition-opacity duration-150 group-hover/btn:opacity-100">
                                                                    <span className="bg-gray-900 text-white text-[10px] rounded py-1 px-2 shadow-lg block whitespace-nowrap">
                                                                        View Details
                                                                    </span>
                                                                    <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -top-1 left-3 block"></span>
                                                                </span>
                                                            </button>

                                                            {/* Remove Button (Absolute Top Right) */}
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRemoveAlternative(item, alt.code, alt.name);
                                                                }}
                                                                className="group/btn absolute -top-2 -right-2 opacity-0 group-hover/alt:opacity-100 w-6 h-6 bg-white border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 rounded-full flex items-center justify-center shadow-sm transition-all z-10 transform scale-90 group-hover/alt:scale-100"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                                                                <span className="absolute top-full right-0 mt-2 z-50 w-max pointer-events-none opacity-0 transition-opacity duration-150 group-hover/btn:opacity-100">
                                                                    <span className="bg-gray-900 text-white text-[10px] rounded py-1 px-2 shadow-lg block whitespace-nowrap">
                                                                        Remove from alternatives
                                                                    </span>
                                                                    <span className="w-2 h-2 bg-gray-900 rotate-45 absolute -top-1 right-3 block"></span>
                                                                </span>
                                                            </button>

                                                            {/* Card Content using Flex and Grid for stability */}
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex justify-between items-start gap-2">
                                                                    <span className="text-[11px] font-semibold text-gray-800 leading-snug line-clamp-2" title={alt.name}>{alt.name}</span>
                                                                    <span className="text-[11px] font-semibold text-gray-900 bg-gray-50 px-1.5 py-0.5 rounded shrink-0">{formatCurrency(alt.price)}</span>
                                                                </div>
                                                                {isInStock && (
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        {(() => {
                                                                            const tier = alt.recommendationTier || getRelativePriceTier(item?.price, alt?.price);
                                                                            return (
                                                                                <span className={`text-[9px] font-semibold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${getTierBadgeClass(tier)}`}>
                                                                                    {getTierDisplayLabel(tier)}
                                                                                </span>
                                                                            );
                                                                        })()}
                                                                    </div>
                                                                )}
                                                                
                                                                <div className="flex justify-between items-center border-t border-slate-50 pt-0.5 mt-0.5">
                                                                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider truncate max-w-[80px]">{alt.brand || 'No Brand'}</span>
                                                                    <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${alt.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                                        <div className={`w-1.5 h-1.5 rounded-full ${alt.stock > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                                                                        {alt.stock}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="h-20 flex flex-col items-center justify-center text-center text-gray-400">
                                                        <span className="text-[10px]">No alternatives</span>
                                                        <span className="text-[9px] mt-1 text-gray-300">Adding some is recommended</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex min-h-6 items-start">
                                                {hasMoreAlternatives && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setRecommendationDrawerTarget(item)}
                                                        aria-haspopup="dialog"
                                                        className="inline-flex self-start items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1"
                                                    >
                                                        View All Recommendations
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 18 6-6-6-6" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-4 w-full border border-slate-300 bg-slate-200 px-4 py-2 rounded-xl">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-gray-500 font-medium">
                                Showing <span className="font-semibold text-gray-900">{displayStart}</span> to <span className="font-semibold text-gray-900">{displayEnd}</span> of <span className="font-semibold text-gray-900">{attentionItems.length}</span> results
                            </div>
                            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                        </div>
                    </div>
                    </>
                )}
            </div>

            {recommendationDrawerTarget && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="all-recommendations-title"
                    className="fixed inset-0 z-[65] flex justify-end bg-black/25 animate-in fade-in duration-200"
                    onClick={() => setRecommendationDrawerTarget(null)}
                >
                    <aside
                        className="flex h-full min-h-0 w-full max-w-[22.5rem] flex-col bg-slate-50 shadow-lg animate-in slide-in-from-right duration-200"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-3 py-2.5">
                            <div className="min-w-0 pr-4">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                    {drawerIsInStock ? 'Budget Options & Alternatives' : 'Alternatives'}
                                </p>
                                <h3 id="all-recommendations-title" className="mt-0.5 truncate text-sm font-semibold text-gray-900">
                                    {recommendationDrawerTarget.name}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRecommendationDrawerTarget(null)}
                                aria-label="Close all recommendations"
                                className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                            >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto p-3 overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300">
                            <div className="space-y-1.5">
                                {drawerAlternatives.map((alternative) => {
                                    const tier = alternative.recommendationTier || getRelativePriceTier(recommendationDrawerTarget?.price, alternative?.price);

                                    return (
                                        <div key={alternative.code} className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                                            <div className="flex items-start gap-2">
                                                <p className="min-w-0 flex-1 text-xs font-semibold leading-snug text-gray-900">{alternative.name}</p>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setViewDetailsItem(alternative);
                                                            setIsDetailsModalOpen(true);
                                                        }}
                                                        aria-label="View Details"
                                                        className="group/drawer-view relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition-all hover:border-gray-900 hover:bg-[#111827] hover:text-white"
                                                    >
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                        <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/drawer-view:opacity-100 group-focus-visible/drawer-view:opacity-100">View Details</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveAlternative(recommendationDrawerTarget, alternative.code, alternative.name)}
                                                        aria-label="Remove from Recommendation"
                                                        className="group/drawer-remove relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition-all hover:border-rose-200 hover:text-rose-500"
                                                    >
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                                        <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/drawer-remove:opacity-100 group-focus-visible/drawer-remove:opacity-100">Remove from Recommendation</span>
                                                    </button>
                                                    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-900">
                                                        {formatCurrency(alternative.price)}
                                                    </span>
                                                </div>
                                            </div>
                                            {drawerIsInStock && (
                                                <span className={`mt-1.5 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${getTierBadgeClass(tier)}`}>
                                                    {getTierDisplayLabel(tier)}
                                                </span>
                                            )}
                                            <div className="mt-1.5 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10px]">
                                                <span className="truncate pr-3 font-semibold uppercase tracking-wider text-gray-400">{alternative.brand || 'No Brand'}</span>
                                                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 font-semibold ${alternative.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${alternative.stock > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                    {alternative.stock}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </aside>
                </div>
            )}

            {/* Remove Confirmation Modal */}
            {isConfirmModalOpen && (
                <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center transform scale-100 transition-all">
                        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Alternative?</h3>
                        <p className="text-gray-500 text-sm mb-6">
                            Are you sure you want to remove <span className="font-semibold text-gray-800">{pendingRemoval?.alternativeName}</span> from alternatives?
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => {
                                    setIsConfirmModalOpen(false);
                                    setPendingRemoval(null);
                                }}
                                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmRemoval}
                                className="flex-1 px-4 py-2 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors shadow-lg"
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Alternative Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 h-[500px] flex flex-col">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
                            <div>
                                <h3 className="font-semibold text-gray-900">Add Alternative</h3>
                                <p className="text-xs text-gray-500">For {activeTargetItem?.name}</p>
                            </div>
                            <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-900 transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        
                        <div className="p-4 border-b border-gray-100 bg-white shrink-0 space-y-3">
                            <input 
                                type="text" 
                                placeholder="Search inventory..." 
                                value={addSearchTerm}
                                list="recommendation-add-search-suggestions"
                                onChange={(e) => setAddSearchTerm(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-gray-900 focus:outline-none"
                                autoFocus
                            />
                            <datalist id="recommendation-add-search-suggestions">
                                {addAlternativeSearchSuggestions.map((term) => (
                                    <option key={term} value={term} />
                                ))}
                            </datalist>
                            {/* Category Filter Pills */}
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-200">
                                {categories.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setAddFilterCategory(cat)}
                                        className={`px-3 py-1 text-xs font-semibold rounded-full border shrink-0 transition-colors ${
                                            addFilterCategory === cat 
                                            ? 'bg-gray-900 text-white border-gray-900' 
                                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                        }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2 bg-gray-50">
                            {potentialAlternatives.length > 0 ? (
                                <div className="space-y-2">
                                    {potentialAlternatives.map(item => (
                                        <div 
                                            key={item.code}
                                            onClick={() => handleAddAlternative(item.code)}
                                            className={`w-full p-3 bg-white border rounded-xl hover:shadow-sm transition-all text-left flex justify-between items-center group cursor-pointer ${
                                                item.isSystemRecommended ? 'border-indigo-100 hover:border-indigo-300 bg-indigo-50/10' : 'border-gray-200 hover:border-gray-400'
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0 mr-3">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-semibold text-gray-900 text-sm leading-tight truncate">{item.name}</span>
                                                    {item.isSystemRecommended && (
                                                        <span className="bg-indigo-100 text-indigo-700 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-indigo-200 flex items-center gap-1 shrink-0 uppercase tracking-wide">
                                                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                                                            Recommended
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">{item.brand} • {formatCurrency(item.price)} • {item.stock} in stock • {getTierDisplayLabel(item.recommendationTier || getRelativePriceTier(activeTargetItem?.price, item?.price))}</div>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 shrink-0">
                                                {/* View Details Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setViewDetailsItem(item);
                                                        setIsDetailsModalOpen(true);
                                                    }}
                                                    className="p-1.5 text-gray-400 hover:text-white hover:bg-[#111827] rounded-lg transition-colors"
                                                    title="View Full Details"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                </button>

                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                                    item.isSystemRecommended 
                                                        ? 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white' 
                                                        : 'bg-gray-100 text-gray-400 group-hover:bg-gray-900 group-hover:text-white'
                                                }`}>
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                                    {addSearchTerm ? 'No matching items found' : 'Type to search...'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Product Details Modal */}
            {isDetailsModalOpen && viewDetailsItem && (
                <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setIsDetailsModalOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 border border-gray-100" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-100/50">
                            <h3 className="font-semibold text-lg text-gray-900">Product Details</h3>
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                className="p-1.5 rounded-full hover:bg-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto space-y-4 bg-slate-50/50">
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="pr-4">
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Product Name</p>
                                        <p className="text-lg font-semibold text-gray-900 leading-tight">{viewDetailsItem.name}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">SKU</p>
                                        <span className="inline-block bg-slate-100 border border-slate-200 px-2 py-1 rounded text-xs font-mono font-semibold text-slate-700 select-all">{viewDetailsItem.code}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Category</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.category || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Brand</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.brand || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Stock</p>
                                        <div className={`text-sm font-semibold ${viewDetailsItem.stock <= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {viewDetailsItem.stock} {viewDetailsItem.unit}
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Price</p>
                                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(viewDetailsItem.price)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Size</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.size || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Color</p>
                                        <div className="flex items-center gap-2">
                                            {viewDetailsItem.color && (
                                                <div className="w-3 h-3 rounded-full border border-gray-200 shadow-sm" style={{ backgroundColor: viewDetailsItem.color }}></div>
                                            )}
                                            <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.color || 'N/A'}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Reorder Point</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.reorderPoint || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Supplier</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.supplier || 'N/A'}</p>
                                    </div>
                                </div>

                                {viewDetailsItem.description && (
                                    <div className="border-t border-slate-100 mt-4 pt-4">
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Description</p>
                                        <p className="text-sm text-gray-600 leading-relaxed">{viewDetailsItem.description}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                         <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors text-sm shadow-sm hover:shadow"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Recommendation;
