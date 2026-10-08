import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    getAlternatives,
    getAlternativesByBudget,
    getBudgetPreviewOptions,
    getManualRecommendationCandidates,
    getRelativePriceTier,
    getRawSystemRecommendations,
    getStockStatus,
} from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toastHelper';
import Pagination from '../components/Pagination';
import { formatCurrency } from '../utils/numberFormat';
import { addProductRecommendationApi, removeProductRecommendationApi } from '../services/inventoryApi';

const DEFAULT_VISIBLE_RECOMMENDATIONS = 3;

const countUniqueRecommendationEntries = (entries = []) => new Set(
    entries
        .map((entry) => String(entry?.code || entry?.id || '').trim())
        .filter(Boolean)
).size;

const getPriceDifferenceDisplay = (currentPrice, recommendationPrice) => {
    const difference = Number(recommendationPrice || 0) - Number(currentPrice || 0);

    if (difference === 0) {
        return { label: 'Same price', isSaving: false };
    }

    return {
        label: `${difference < 0 ? 'Save ' : '+'}${formatCurrency(Math.abs(difference))}`,
        isSaving: difference < 0,
    };
};

const RecommendationThumbnail = ({ item, className = 'h-10 w-10' }) => (
    <div className={`shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${className}`}>
        {item?.imageUrl ? (
            <img src={item.imageUrl} alt="" className="h-full w-full object-contain p-0.5" />
        ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2 2-2a3 3 0 014 0l2 2m-14 4h16" />
                </svg>
            </div>
        )}
    </div>
);

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
    const { inventory: rawInventory, setInventory, processedInventory } = useInventory();
    
    // Use processed items
    const inventory = rawInventory || processedInventory || [];

    // State for Add Alternative Modal
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [activeTargetItem, setActiveTargetItem] = useState(null); // The item we are adding alternatives TO
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const [debouncedAddSearchTerm, setDebouncedAddSearchTerm] = useState('');
    const [addFilterCategory, setAddFilterCategory] = useState('All'); // New state for category filter in modal
    const [addRecommendationType, setAddRecommendationType] = useState('alternative');

    // State for Product Details Modal
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [viewDetailsItem, setViewDetailsItem] = useState(null);

    // State for Confirmation Modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState(null); // { targetCode, alternativeCode, alternativeName }
    const [recommendationDrawerTarget, setRecommendationDrawerTarget] = useState(null);
    const [recommendationDrawerMode, setRecommendationDrawerMode] = useState('alternative');

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
    const handleRemoveAlternative = (targetItem, alternativeCode, alternativeName, type = 'alternative') => {
        setPendingRemoval({
            targetId: targetItem?.id,
            targetCode: targetItem?.code,
            alternativeCode,
            alternativeName,
            type,
        });
        setIsConfirmModalOpen(true);
    };

    // Confirm Removal Logic
    const confirmRemoval = async () => {
        if (!pendingRemoval || !setInventory) return;

        const { targetId, targetCode, alternativeCode, type } = pendingRemoval;
        const targetItem = inventory.find((item) => item.id === targetId || item.code === targetCode);
        const currentRecommendations = targetItem
            ? (type === 'budget'
                ? Object.values(getAlternativesByBudget(targetItem, inventory, appSettings, { limitPerTier: 20, maxSuggestions: 50 })).flat()
                : getAlternatives(targetItem, inventory, appSettings, { maxSuggestions: 50 }))
            : [];

        if (!targetItem?.id || !currentRecommendations.some((alternative) => alternative.code === alternativeCode)) {
            showToast('Unable to Remove', 'This recommendation is no longer available. Refresh and try again.', 'error');
            setIsConfirmModalOpen(false);
            setPendingRemoval(null);
            return;
        }

        try {
            const updatedTarget = await removeProductRecommendationApi(targetItem.id, alternativeCode, type);
            const excludedField = type === 'budget' ? 'excludedBudgetOptions' : 'excludedAlternatives';
            const manualField = type === 'budget' ? 'manualBudgetOptions' : 'manualAlternatives';
            const wasPersisted = updatedTarget[excludedField].includes(alternativeCode)
                && !updatedTarget[manualField].includes(alternativeCode);

            if (!wasPersisted) {
                throw new Error('The recommendation was not removed.');
            }

            setInventory((current) => current.map((item) => (
                item.id === targetItem.id ? updatedTarget : item
            )));
            setRecommendationDrawerTarget((current) => (
                current?.id === targetItem.id ? updatedTarget : current
            ));

            showToast('Success', `${type === 'budget' ? 'Budget option' : 'Alternative'} removed.`, 'success');
            setIsConfirmModalOpen(false);
            setPendingRemoval(null);
        } catch (error) {
            showToast('Unable to Remove', error?.message || 'The recommendation could not be removed.', 'error');
        }
    };

    // Add Alternative Logic
    const handleAddAlternative = async (alternative) => {
        if (!setInventory || !activeTargetItem) return;
        try {
            const updatedTarget = await addProductRecommendationApi(activeTargetItem.id, {
                type: addRecommendationType,
                recommendationId: alternative.id,
                recommendationCode: alternative.code,
            });
            setInventory((current) => current.map((item) => item.id === activeTargetItem.id ? updatedTarget : item));
            setIsAddModalOpen(false);
            setAddSearchTerm('');
            showToast('Success', `${addRecommendationType === 'budget' ? 'Budget option' : 'Alternative'} added.`, 'success');
        } catch (error) {
            showToast('Unable to Add', error?.message || 'The recommendation could not be added.', 'error');
        }
    };

    // Filter items for "Add Alternative" modal
    const potentialAlternatives = useMemo(() => {
        if (!activeTargetItem) return [];
        
        // Get raw top recommendations by system (ignoring exclusions) to flag them
        const systemRecs = getRawSystemRecommendations(activeTargetItem, inventory, appSettings);
        const systemRecCodes = systemRecs.map(r => r.code);
        const existingCodes = new Set(addRecommendationType === 'budget'
            ? Object.values(getAlternativesByBudget(activeTargetItem, inventory, appSettings, { limitPerTier: 20, maxSuggestions: 50 })).flat().map((entry) => entry.code)
            : getAlternatives(activeTargetItem, inventory, appSettings, { maxSuggestions: 50 }).map((entry) => entry.code));
        
        return getManualRecommendationCandidates(activeTargetItem, inventory, {
            existingCodes,
            systemCodes: systemRecCodes,
            recommendationType: addRecommendationType,
            search: debouncedAddSearchTerm,
            category: addFilterCategory,
        });
    }, [inventory, activeTargetItem, debouncedAddSearchTerm, addFilterCategory, addRecommendationType, appSettings]);

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
        ? getAlternatives(recommendationDrawerTarget, inventory, appSettings, { maxSuggestions: 50 })
        : [];
    const drawerBudgetBuckets = recommendationDrawerTarget
        ? getAlternativesByBudget(recommendationDrawerTarget, inventory, appSettings, { limitPerTier: 6, maxSuggestions: 18 })
        : { low: [], moderate: [], high: [] };
    const drawerRecommendations = recommendationDrawerMode === 'budget'
        ? [...drawerBudgetBuckets.low, ...drawerBudgetBuckets.moderate, ...drawerBudgetBuckets.high]
        : drawerAlternatives;

    return (
        <div className="recommendation-page flex flex-col h-auto md:h-full bg-slate-200/50 p-6 md:overflow-hidden rounded-2xl shadow-inner border border-slate-300">
            {/* Header Section */}
            <div className="flex flex-col gap-4 mb-8 shrink-0 relative z-10">
                <div className="overflow-hidden">
                    <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Product Recommendation</p>
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
                    <div className="grid grid-cols-1 items-start gap-5">
                        {paginatedAttentionItems.map((item) => {
                            const stockStatus = getStockStatus(item, appSettings);
                            const alternatives = getAlternatives(item, inventory, appSettings, { maxSuggestions: 6 });
                            const fullAlternatives = getAlternatives(item, inventory, appSettings, { maxSuggestions: 50 });
                            const budgetOptions = getAlternativesByBudget(item, inventory, appSettings, { limitPerTier: 6, maxSuggestions: 18 });
                            const budgetPreview = getBudgetPreviewOptions(budgetOptions, 3);
                            const isOutOfStock = stockStatus === 'Out of Stock';
                            const isLowStock = stockStatus === 'Low Stock';
                            const isInStock = stockStatus === 'In Stock';
                            const hasMoreAlternatives = alternatives.length > DEFAULT_VISIBLE_RECOMMENDATIONS;
                            const visibleAlternatives = alternatives.slice(0, DEFAULT_VISIBLE_RECOMMENDATIONS);
                            const currentProductDetails = [
                                { label: 'Category', value: item.category },
                                { label: 'Color', value: item.color },
                            ].filter(({ value }) => String(value || '').trim());
                            const alternativeCount = countUniqueRecommendationEntries(fullAlternatives);
                            const budgetOptionCount = countUniqueRecommendationEntries(Object.values(budgetOptions).flat());
                            
                            return (
                                <div key={item.code} className="recommendation-current-card self-start bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all shadow-sm hover:shadow-md flex flex-col overflow-hidden min-h-[220px]">
                                    <div className="p-4 flex flex-col sm:flex-row gap-4 items-stretch h-full">
                                        {/* Left Side: Product Details (No Adjust Stock Button) */}
                                        <div className="recommendation-current-summary flex-1 flex flex-col justify-between h-full w-full min-h-[160px] rounded-lg bg-slate-50/70 px-3 py-3">
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

                                                {currentProductDetails.length > 0 && (
                                                    <section className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-700" aria-label="Product Details">
                                                        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">Product Details</p>
                                                        <dl className="space-y-1.5">
                                                            {currentProductDetails.map(({ label, value }) => (
                                                                <div key={label} className="flex items-center justify-between gap-3 text-[10px]">
                                                                    <dt className="text-slate-400">{label}</dt>
                                                                    <dd className="truncate font-medium text-slate-700 dark:text-slate-100">{value}</dd>
                                                                </div>
                                                            ))}
                                                        </dl>
                                                    </section>
                                                )}

                                                <section className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-700" aria-label="Recommendation Summary">
                                                    <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">Recommendations</p>
                                                    <dl className="space-y-1.5">
                                                        <div className="flex items-center justify-between gap-3 text-[10px]">
                                                            <dt className="text-slate-400">Alternative Products</dt>
                                                            <dd className="font-semibold text-slate-700 dark:text-slate-100">{alternativeCount}</dd>
                                                        </div>
                                                        {isInStock && (
                                                            <div className="flex items-center justify-between gap-3 text-[10px]">
                                                                <dt className="text-slate-400">Budget Options</dt>
                                                                <dd className="font-semibold text-slate-700 dark:text-slate-100">{budgetOptionCount}</dd>
                                                            </div>
                                                        )}
                                                    </dl>
                                                </section>
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

                                        {/* Right Side: Separate recommendation concepts */}
                                        <div className="flex min-w-0 flex-[1.8] flex-col gap-3 border-t border-slate-100 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[9px] font-medium leading-snug text-slate-400">
                                                    Recommendations use this exact product and its current stock state.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveTargetItem(item);
                                                        setAddRecommendationType('alternative');
                                                        setAddSearchTerm('');
                                                        setAddFilterCategory('All');
                                                        setIsAddModalOpen(true);
                                                    }}
                                                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-[9px] font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                                                    aria-label="Add Recommendation"
                                                >
                                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                                    Add Recommendation
                                                </button>
                                            </div>

                                            {alternatives.length > 0 && (
                                                <section className="recommendation-section recommendation-alternative-section rounded-xl border border-slate-200 bg-slate-50/40 p-3" aria-label={`Alternative Products for ${item.name}`}>
                                                    <div className="mb-2.5 flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-900">
                                                                <svg className="h-3.5 w-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" /></svg>
                                                                Alternative Products
                                                            </h4>
                                                            <p className="mt-0.5 text-[9px] leading-snug text-slate-400">Similar or compatible products that can be used as replacements.</p>
                                                        </div>
                                                        {hasMoreAlternatives && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setRecommendationDrawerMode('alternative');
                                                                    setRecommendationDrawerTarget(item);
                                                                }}
                                                                aria-haspopup="dialog"
                                                                className="shrink-0 text-[9px] font-semibold text-slate-600 hover:text-slate-900"
                                                            >
                                                                View All Alternatives
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="grid gap-2 md:grid-cols-3">
                                                        {visibleAlternatives.map((alternative) => (
                                                            <div key={alternative.code} className="recommendation-option-card group/alt min-w-0 rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:border-slate-300">
                                                                <div className="flex min-w-0 gap-2">
                                                                    <RecommendationThumbnail item={alternative} />
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="line-clamp-2 text-[10px] font-semibold leading-snug text-slate-900">{alternative.name}</p>
                                                                        <p className="mt-0.5 truncate text-[9px] text-slate-400">{[alternative.brand, alternative.size].filter(Boolean).join(' • ') || 'No brand'}</p>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                                                                    <span className="text-[10px] font-semibold text-slate-900">{formatCurrency(alternative.price)}</span>
                                                                    <span className="text-[9px] font-medium text-emerald-700">Stock: {alternative.stock}</span>
                                                                </div>
                                                                <div className="mt-1.5 flex items-center justify-between">
                                                                    <button type="button" onClick={() => { setViewDetailsItem(alternative); setIsDetailsModalOpen(true); }} className="text-[9px] font-medium text-slate-400 hover:text-slate-700">View Details</button>
                                                                    <button type="button" onClick={() => handleRemoveAlternative(item, alternative.code, alternative.name)} className="text-[9px] font-medium text-slate-400 hover:text-rose-600">Remove</button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}

                                            {isInStock && Object.values(budgetOptions).some((options) => options.length > 0) && (
                                                <section className="recommendation-section recommendation-budget-section rounded-xl border border-emerald-100 bg-emerald-50/25 p-3" aria-label={`Budget Options for ${item.name}`}>
                                                    <div className="mb-2.5 flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-900">
                                                                <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2v-2m2-6h-6a2 2 0 000 4h6V9z" /></svg>
                                                                Budget Options
                                                            </h4>
                                                            <p className="mt-0.5 text-[9px] leading-snug text-slate-400">Compare value, similar-price, and premium choices.</p>
                                                        </div>
                                                        {budgetPreview.hiddenCount > 0 && (
                                                            <div className="flex shrink-0 items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setRecommendationDrawerMode('budget');
                                                                        setRecommendationDrawerTarget(item);
                                                                    }}
                                                                    aria-haspopup="dialog"
                                                                    className="text-[9px] font-semibold text-emerald-700 hover:text-emerald-900"
                                                                >
                                                                    View All Budget Options
                                                                </button>
                                                                <span className="rounded-full bg-white px-1.5 py-0.5 text-[8px] font-medium text-slate-400">+{budgetPreview.hiddenCount} more</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="grid gap-2 md:grid-cols-3">
                                                        {budgetPreview.visibleOptions.map((option) => {
                                                            const tier = option.recommendationTier || getRelativePriceTier(item?.price, option?.price);
                                                            const priceDifference = getPriceDifferenceDisplay(item?.price, option?.price);
                                                            return (
                                                                <div key={option.code} className="recommendation-option-card min-w-0 rounded-lg border border-emerald-100 bg-white p-2 transition-colors hover:border-emerald-200">
                                                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                                                        <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${getTierBadgeClass(tier)}`}>{getTierDisplayLabel(tier)}</span>
                                                                        <span className={`text-[9px] font-medium ${priceDifference.isSaving ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-400'}`}>{priceDifference.label}</span>
                                                                    </div>
                                                                    <div className="flex min-w-0 gap-2">
                                                                        <RecommendationThumbnail item={option} />
                                                                        <div className="min-w-0 flex-1">
                                                                            <p className="line-clamp-2 text-[10px] font-semibold leading-snug text-slate-900">{option.name}</p>
                                                                            <p className="mt-0.5 truncate text-[9px] text-slate-400">{[option.brand, option.size].filter(Boolean).join(' • ') || 'No brand'}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                                                                        <span className="text-[10px] font-semibold text-slate-900">{formatCurrency(option.price)}</span>
                                                                        <span className="text-[9px] font-medium text-emerald-700">Stock: {option.stock}</span>
                                                                    </div>
                                                                    <div className="mt-1.5 flex items-center justify-between">
                                                                        <button type="button" onClick={() => { setViewDetailsItem(option); setIsDetailsModalOpen(true); }} className="text-[9px] font-medium text-slate-400 hover:text-slate-700">View Details</button>
                                                                        <button type="button" onClick={() => handleRemoveAlternative(item, option.code, option.name, 'budget')} className="text-[9px] font-medium text-slate-400 hover:text-rose-600">Remove</button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </section>
                                            )}

                                            {alternatives.length === 0 && (!isInStock || !Object.values(budgetOptions).some((options) => options.length > 0)) && (
                                                <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 text-center text-[10px] font-medium text-slate-400">
                                                    No recommendations available
                                                </div>
                                            )}
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
                        className="recommendation-modal flex h-full min-h-0 w-full max-w-[26rem] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-xl animate-in slide-in-from-right duration-200"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
                            <div className="min-w-0 pr-4">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                    {recommendationDrawerMode === 'budget' ? 'Budget Options' : 'Alternative Products'}
                                </p>
                                <h3 id="all-recommendations-title" className="mt-0.5 truncate text-sm font-semibold text-gray-900">
                                    {recommendationDrawerTarget.name}
                                </h3>
                                <p className="mt-1 text-[10px] leading-snug text-slate-400">
                                    {recommendationDrawerMode === 'budget' ? 'Compare Value, Standard, and Premium options.' : 'Review similar or compatible replacement products.'}
                                </p>
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

                        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300">
                            <div className="space-y-2.5">
                                {drawerRecommendations.map((alternative) => {
                                    const tier = alternative.recommendationTier || getRelativePriceTier(recommendationDrawerTarget?.price, alternative?.price);
                                    const priceDifference = getPriceDifferenceDisplay(recommendationDrawerTarget?.price, alternative?.price);

                                    return (
                                        <div key={alternative.code} className="rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <RecommendationThumbnail item={alternative} className="h-14 w-14" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900">{alternative.name}</p>
                                                    <p className="mt-0.5 truncate text-[9px] text-slate-400">{[alternative.brand, alternative.size].filter(Boolean).join(' • ') || 'No brand'}</p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setViewDetailsItem(alternative);
                                                            setIsDetailsModalOpen(true);
                                                        }}
                                                        aria-label="View Details"
                                                        title="View Details"
                                                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                                                    >
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                    </button>
                                                    <button
                                                            type="button"
                                                            onClick={() => handleRemoveAlternative(recommendationDrawerTarget, alternative.code, alternative.name, recommendationDrawerMode)}
                                                            aria-label="Remove from Recommendation"
                                                            title="Remove"
                                                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-rose-600"
                                                        >
                                                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                                    </button>
                                                    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-900">
                                                        {formatCurrency(alternative.price)}
                                                    </span>
                                                </div>
                                            </div>
                                            {recommendationDrawerMode === 'budget' && (
                                                <div className="mt-1.5 flex items-center justify-between gap-3">
                                                    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${getTierBadgeClass(tier)}`}>
                                                        {getTierDisplayLabel(tier)}
                                                    </span>
                                                    <span className={`shrink-0 text-[10px] font-medium ${priceDifference.isSaving ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-400'}`}>
                                                        {priceDifference.label}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px]">
                                                <span className="truncate pr-3 font-semibold uppercase tracking-wider text-gray-400">{alternative.brand || 'No Brand'}</span>
                                                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 font-semibold ${alternative.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${alternative.stock > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                    Stock: {alternative.stock}
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
                    <div className="recommendation-modal bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center transform scale-100 transition-all">
                        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Alternative?</h3>
                        <p className="text-gray-500 text-sm mb-6">
                            Are you sure you want to remove <span className="font-semibold text-gray-800">{pendingRemoval?.alternativeName}</span> from {pendingRemoval?.type === 'budget' ? 'budget options' : 'alternatives'}?
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

            {/* Add Recommendation Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="recommendation-modal bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 h-[500px] flex flex-col">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
                            <div>
                                <h3 className="font-semibold text-gray-900">Add Recommendation</h3>
                                <p className="text-xs text-gray-500">For {activeTargetItem?.name}</p>
                            </div>
                            <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-900 transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        
                        <div className="p-4 border-b border-gray-100 bg-white shrink-0 space-y-3">
                            {getStockStatus(activeTargetItem, appSettings) === 'In Stock' && (
                                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                                    <button type="button" onClick={() => setAddRecommendationType('alternative')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${addRecommendationType === 'alternative' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Alternative Product</button>
                                    <button type="button" onClick={() => setAddRecommendationType('budget')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${addRecommendationType === 'budget' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Budget Option</button>
                                </div>
                            )}
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
                                    {potentialAlternatives.map(item => {
                                        const candidateStatus = getStockStatus(item, appSettings);
                                        const isUnavailable = candidateStatus === 'Out of Stock';
                                        return (
                                        <div 
                                            key={item.code}
                                            onClick={() => { if (!isUnavailable) handleAddAlternative(item); }}
                                            className={`w-full p-3 bg-white border rounded-xl transition-all text-left flex justify-between items-center group ${isUnavailable ? 'cursor-not-allowed border-slate-200 opacity-65' : 'cursor-pointer hover:shadow-sm'} ${
                                                addRecommendationType === 'alternative' && item.isSystemRecommended ? 'border-indigo-100 hover:border-indigo-300 bg-indigo-50/10' : 'border-gray-200 hover:border-gray-400'
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0 mr-3">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-semibold text-gray-900 text-sm leading-tight truncate">{item.name}</span>
                                                    {addRecommendationType === 'alternative' && item.isSystemRecommended && (
                                                        <span className="bg-indigo-100 text-indigo-700 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-indigo-200 flex items-center gap-1 shrink-0 uppercase tracking-wide">
                                                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                                                            Recommended
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {[item.code, item.brand, item.size].filter(Boolean).join(' • ')} • {formatCurrency(item.price)} • {candidateStatus}
                                                    {addRecommendationType === 'budget' ? ` • ${getTierDisplayLabel(item.recommendationTier || getRelativePriceTier(activeTargetItem?.price, item?.price))}` : ''}
                                                </div>
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

                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isUnavailable ? 'bg-slate-100 text-slate-300' :
                                                    addRecommendationType === 'alternative' && item.isSystemRecommended
                                                        ? 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white' 
                                                        : 'bg-gray-100 text-gray-400 group-hover:bg-gray-900 group-hover:text-white'
                                                }`}>
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })}
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
                    <div className="recommendation-modal flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="recommendation-modal-header flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Inventory Item</p>
                                <h3 className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">Product Details</h3>
                            </div>
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                aria-label="Close product details"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                            >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        
                        <div className="recommendation-modal-body overflow-y-auto bg-slate-50/70 p-4 sm:p-5">
                            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                                    <div className="min-w-0">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Product Name</p>
                                        <p className="text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">{viewDetailsItem.name}</p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">SKU</p>
                                        <span className="inline-flex max-w-36 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 select-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{viewDetailsItem.code}</span>
                                    </div>
                                </div>

                                <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Category</dt>
                                        <dd className={`text-sm font-semibold ${viewDetailsItem.category ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{viewDetailsItem.category || 'N/A'}</dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Brand</dt>
                                        <dd className={`text-sm font-semibold ${viewDetailsItem.brand ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{viewDetailsItem.brand || 'N/A'}</dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Stock</dt>
                                        <dd className={`inline-flex rounded-md px-2 py-0.5 text-sm font-semibold ${viewDetailsItem.stock <= 0 ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                                            {viewDetailsItem.stock} {viewDetailsItem.unit}
                                        </dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Price</dt>
                                        <dd className="text-base font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(viewDetailsItem.price)}</dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Size</dt>
                                        <dd className={`text-sm font-semibold ${viewDetailsItem.size ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{viewDetailsItem.size || 'N/A'}</dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Color</dt>
                                        <dd className={`flex items-center gap-2 text-sm font-semibold ${viewDetailsItem.color ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
                                            {viewDetailsItem.color && (
                                                <span className="h-3 w-3 shrink-0 rounded-full border border-slate-200 dark:border-slate-600" style={{ backgroundColor: viewDetailsItem.color }} />
                                            )}
                                            {viewDetailsItem.color || 'N/A'}
                                        </dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Reorder Point</dt>
                                        <dd className={`text-sm font-semibold ${viewDetailsItem.reorderPoint ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{viewDetailsItem.reorderPoint || 'N/A'}</dd>
                                    </div>
                                    <div className="border-b border-slate-100 py-3">
                                        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Supplier</dt>
                                        <dd className={`truncate text-sm font-semibold ${viewDetailsItem.supplier ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>{viewDetailsItem.supplier || 'N/A'}</dd>
                                    </div>
                                </dl>

                                {viewDetailsItem.description && (
                                    <div className="mt-4 border-t border-slate-100 pt-4">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Description</p>
                                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{viewDetailsItem.description}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                         <div className="recommendation-modal-footer flex justify-end border-t border-slate-200 bg-white px-5 py-3.5">
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
