import React, { useState, useMemo, useEffect } from 'react';
import { getAlternatives, getRawSystemRecommendations } from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toastHelper';

const Recommendation = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const { appSettings } = useAuth() || {};

    // Inventory helpers from context
    const { inventory: rawInventory, setInventory, processedInventory, logActivity, logAction } = useInventory();
    
    // Use processed items
    const inventory = rawInventory || processedInventory || [];

    // State for Add Alternative Modal
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [activeTargetItem, setActiveTargetItem] = useState(null); // The item we are adding alternatives TO
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const [addFilterCategory, setAddFilterCategory] = useState('All'); // New state for category filter in modal

    // State for Product Details Modal
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [viewDetailsItem, setViewDetailsItem] = useState(null);

    // State for Confirmation Modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState(null); // { targetCode, alternativeCode, alternativeName }

    // Restore hidden items on mount
    useEffect(() => {
        if (!setInventory) return;
        setInventory(prev => (prev || []).map(p => p.hiddenFromRecommendations ? { ...p, hiddenFromRecommendations: false } : p));
    }, []);

    // Unique filter categories
    const categories = useMemo(() => {
        const cats = new Set(inventory.map(i => i.category || 'Uncategorized'));
        return ['All', ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
    }, [inventory]);
    
    // Logic to find items that need recommendation
    const criticalItems = useMemo(() => {
        return inventory.filter(item => {
            if (item.stock > 10) return false; // Threshold filters
            
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch = item.name.toLowerCase().includes(searchLower) || 
                                  item.code.toLowerCase().includes(searchLower) ||
                                  (item.brand || '').toLowerCase().includes(searchLower);

            const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;

            return matchesSearch && matchesCategory;
        });
    }, [inventory, searchTerm, selectedCategory]);

    // Remove Alternative Trigger
    const handleRemoveAlternative = (targetItemCode, alternativeCode, alternativeName) => {
        setPendingRemoval({ targetCode: targetItemCode, alternativeCode, alternativeName });
        setIsConfirmModalOpen(true);
    };

    // Confirm Removal Logic
    const confirmRemoval = () => {
        if (!pendingRemoval || !setInventory) return;
        
        const { targetCode, alternativeCode } = pendingRemoval;

        setInventory(prev => prev.map(item => {
            if (item.code !== targetCode) return item;

            // Add to excluded list
            const currentExcluded = item.excludedAlternatives || [];
            const newExcluded = [...new Set([...currentExcluded, alternativeCode])];

            // Remove from manual list if present
            const currentManual = item.manualAlternatives || [];
            const newManual = currentManual.filter(c => c !== alternativeCode);

            return { ...item, excludedAlternatives: newExcluded, manualAlternatives: newManual };
        }));
        
        showToast('Success', 'Alternative removed.', 'success');
        setIsConfirmModalOpen(false);
        setPendingRemoval(null);
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
        const systemRecs = getRawSystemRecommendations(activeTargetItem, inventory);
        const systemRecCodes = systemRecs.map(r => r.code);
        
        const search = addSearchTerm.toLowerCase();

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
    }, [inventory, activeTargetItem, addSearchTerm, addFilterCategory]);

    return (
        <div className="flex flex-col h-auto md:h-full bg-slate-200/50 p-6 md:overflow-hidden rounded-2xl shadow-inner border border-slate-300">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 shrink-0 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-100 rounded-lg shrink-0 hidden sm:block">
                        <svg className="w-6 h-6 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                    </div>
                    <div className="overflow-hidden">
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Product Recommendations</h1>
                        <p className="text-gray-500 text-sm mt-1 truncate">Manage product alternatives and view system suggestions.</p>
                    </div>
                </div>
                {/* Search / Filter Controls */}
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-center">
                    <div className="relative w-full md:max-w-xs group z-20">
                        <input
                            type="text"
                            placeholder="Search critical items..."
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
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className={`appearance-none w-full md:w-56 px-3 py-2 rounded-xl text-sm font-bold inline-flex items-center transition-all border-2 ${selectedCategory !== 'All' ? 'bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'}`}
                    >
                        {categories.map(cat => (
                            <option key={cat} value={cat} className="bg-white text-gray-900 py-1">{cat}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="flex-1 overflow-y-auto pr-2 pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-200">
                {criticalItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                        <div className="w-16 h-16 bg-gray-100/50 rounded-full flex items-center justify-center mb-4 border border-gray-100">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">No Recommendations</h3>
                        <p className="text-gray-500 text-sm">No items require immediate attention.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {criticalItems.map((item) => {
                            const alternatives = getAlternatives(item, inventory);
                            const isOutOfStock = item.stock <= 0;
                            
                            return (
                                <div key={item.code} className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-all shadow-sm hover:shadow-md flex flex-col font-sans overflow-hidden min-h-[220px]">
                                    <div className="p-4 flex flex-col sm:flex-row gap-4 items-stretch h-full">
                                        {/* Left Side: Product Details (No Adjust Stock Button) */}
                                        <div className="flex-1 flex flex-col justify-between h-full w-full min-h-[160px]">
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                                                        isOutOfStock ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
                                                    }`}>
                                                        {isOutOfStock ? 'Out of Stock' : 'Low Stock'}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-gray-400">{item.code}</span>
                                                </div>
                                                <h3 className="text-sm font-bold text-gray-900 leading-tight mb-0.5 truncate">{item.name}</h3>
                                                <p className="text-[10px] text-gray-500 font-medium mb-3 truncate">{item.brand} {item.size ? `• ${item.size}` : ''}</p>
                                                
                                                <div className="grid grid-cols-2 gap-3 bg-slate-50/50 rounded-lg p-2.5 border border-slate-100">
                                                    <div>
                                                        <span className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Current</span>
                                                        <span className={`text-lg font-bold ${item.stock <= 0 ? 'text-rose-600' : 'text-gray-900'}`}>{item.stock}</span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Price</span>
                                                        <span className="text-lg font-bold text-gray-900">₱{item.price}</span>
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
                                                    className="w-full py-1.5 px-3 bg-white border border-slate-200 hover:border-gray-900 hover:text-white hover:bg-[#111827] text-slate-500 text-[10px] font-bold rounded-lg transition-all shadow-sm flex items-center justify-center gap-2 group"
                                                >
                                                    <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    View Details
                                                </button>
                                            </div>
                                        </div>

                                        {/* Right Side: Alternatives Management */}
                                        <div className="w-full sm:w-56 xl:w-60 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-4 flex flex-col">
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-[10px] font-bold text-gray-900 flex items-center gap-1.5 uppercase tracking-wide">
                                                    <svg className="w-3 h-3 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                                    Alternatives
                                                </h4>
                                                <button 
                                                    onClick={() => {
                                                        setActiveTargetItem(item);
                                                        setAddSearchTerm('');
                                                        setAddFilterCategory('All'); // Default all or item.category
                                                        setIsAddModalOpen(true);
                                                    }}
                                                    className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                                                    title="Add Alternative Product"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                                                </button>
                                            </div>
                                            
                                            <div className="space-y-2 overflow-y-auto max-h-40 scrollbar-thin scrollbar-thumb-gray-200 pr-1">
                                                {alternatives.length > 0 ? (
                                                    alternatives.map(alt => (
                                                        <div key={alt.code} className="relative p-3 bg-white rounded-xl border border-slate-100 hover:border-slate-300 shadow-sm hover:shadow-md transition-all group/alt">
                                                            
                                                            {/* View Details Button (Absolute Top Left) */}
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setViewDetailsItem(alt);
                                                                    setIsDetailsModalOpen(true);
                                                                }}
                                                                className="absolute -top-2 -left-2 opacity-0 group-hover/alt:opacity-100 w-6 h-6 bg-white border border-gray-200 text-gray-400 hover:text-white hover:bg-[#111827] hover:border-gray-900 rounded-full flex items-center justify-center shadow-sm transition-all z-10 transform scale-90 group-hover/alt:scale-100"
                                                                title="View Details"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                            </button>

                                                            {/* Remove Button (Absolute Top Right) */}
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRemoveAlternative(item.code, alt.code, alt.name);
                                                                }}
                                                                className="absolute -top-2 -right-2 opacity-0 group-hover/alt:opacity-100 w-6 h-6 bg-white border border-gray-200 text-gray-400 hover:text-rose-500 hover:border-rose-200 rounded-full flex items-center justify-center shadow-sm transition-all z-10 transform scale-90 group-hover/alt:scale-100"
                                                                title="Remove from alternatives"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                                                            </button>

                                                            {/* Card Content using Flex and Grid for stability */}
                                                            <div className="flex flex-col gap-1.5">
                                                                <div className="flex justify-between items-start gap-2">
                                                                    <span className="text-[11px] font-bold text-gray-800 leading-snug line-clamp-2" title={alt.name}>{alt.name}</span>
                                                                    <span className="text-[11px] font-bold text-gray-900 bg-gray-50 px-1.5 py-0.5 rounded shrink-0">₱{alt.price}</span>
                                                                </div>
                                                                
                                                                <div className="flex justify-between items-center pt-1 border-t border-slate-50 mt-1">
                                                                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider truncate max-w-[80px]">{alt.brand || 'No Brand'}</span>
                                                                    <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${alt.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
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
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Remove Confirmation Modal */}
            {isConfirmModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center transform scale-100 transition-all">
                        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-2">Remove Alternative?</h3>
                        <p className="text-gray-500 text-sm mb-6">
                            Are you sure you want to remove <span className="font-bold text-gray-800">{pendingRemoval?.alternativeName}</span> from alternatives?
                        </p>
                        <div className="flex gap-3">
                            <button 
                                onClick={() => {
                                    setIsConfirmModalOpen(false);
                                    setPendingRemoval(null);
                                }}
                                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmRemoval}
                                className="flex-1 px-4 py-2 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors shadow-lg"
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
                                <h3 className="font-bold text-gray-900">Add Alternative</h3>
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
                                onChange={(e) => setAddSearchTerm(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-gray-900 focus:outline-none"
                                autoFocus
                            />
                            {/* Category Filter Pills */}
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-200">
                                {categories.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setAddFilterCategory(cat)}
                                        className={`px-3 py-1 text-xs font-bold rounded-full border shrink-0 transition-colors ${
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
                                                    <span className="font-bold text-gray-900 text-sm leading-tight truncate">{item.name}</span>
                                                    {item.isSystemRecommended && (
                                                        <span className="bg-indigo-100 text-indigo-700 text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-indigo-200 flex items-center gap-1 shrink-0 uppercase tracking-wide">
                                                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                                                            Recommended
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">{item.brand} • ₱{item.price} • {item.stock} in stock</div>
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
                            <h3 className="font-bold text-lg text-gray-900">Product Details</h3>
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
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Product Name</p>
                                        <p className="text-lg font-bold text-gray-900 leading-tight">{viewDetailsItem.name}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Code</p>
                                        <span className="inline-block bg-slate-100 border border-slate-200 px-2 py-1 rounded text-xs font-mono font-bold text-slate-700 select-all">{viewDetailsItem.code}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Category</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.category || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Brand</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.brand || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Stock</p>
                                        <div className={`text-sm font-bold ${viewDetailsItem.stock <= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {viewDetailsItem.stock} {viewDetailsItem.unit}
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Price</p>
                                        <p className="text-sm font-bold text-gray-900">₱{viewDetailsItem.price}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Size</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.size || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Color</p>
                                        <div className="flex items-center gap-2">
                                            {viewDetailsItem.color && (
                                                <div className="w-3 h-3 rounded-full border border-gray-200 shadow-sm" style={{ backgroundColor: viewDetailsItem.color }}></div>
                                            )}
                                            <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.color || 'N/A'}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Reorder Point</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.reorderPoint || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Supplier</p>
                                        <p className="text-sm font-semibold text-gray-700">{viewDetailsItem.supplier || 'N/A'}</p>
                                    </div>
                                </div>

                                {viewDetailsItem.description && (
                                    <div className="border-t border-slate-100 mt-4 pt-4">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description</p>
                                        <p className="text-sm text-gray-600 leading-relaxed">{viewDetailsItem.description}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                         <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors text-sm shadow-sm hover:shadow"
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