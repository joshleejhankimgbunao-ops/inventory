import React, { useState, useMemo, useEffect } from 'react';
import { getAlternatives } from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toastHelper';

const Recommendation = () => {
    const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
    

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const { appSettings } = useAuth() || {};
    const maxStockLimit = appSettings && appSettings.maxStockLimit ? parseInt(appSettings.maxStockLimit) : 100;

    // Inventory helpers from context
    const { inventory: rawInventory, setInventory, processedInventory, logActivity, logAction } = useInventory();
    // Use the raw inventory directly first to ensure immediate visibility
    // of recent adds/edits; fall back to processedInventory if raw missing.
    const inventory = rawInventory || processedInventory || [];

    // Modal state for Add/Edit
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState('add');
    const [modalData, setModalData] = useState({});

    // Restore any soft-hidden items (clear hiddenFromRecommendations flag)
    useEffect(() => {
        if (!setInventory) return;
        setInventory(prev => (prev || []).map(p => p.hiddenFromRecommendations ? { ...p, hiddenFromRecommendations: false } : p));
    }, []);

    // Get unique categories for filter
    const categories = useMemo(() => {
        const cats = new Set(inventory.map(i => i.category || 'Uncategorized'));
        return ['All', ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
    }, [inventory]);
    
    // Logic to find items that need recommendation (Out of Stock or Low Stock)
    const criticalItems = useMemo(() => {
        return inventory.filter(item => {
            // Must be critical (low stock)
            if (item.stock > 10) return false;

            // Search filter
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch = item.name.toLowerCase().includes(searchLower) || 
                                  item.code.toLowerCase().includes(searchLower) ||
                                  (item.brand || '').toLowerCase().includes(searchLower) ||
                                  (item.color || '').toLowerCase().includes(searchLower);

            // Category filter
            const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;

            return matchesSearch && matchesCategory;
        });
    }, [inventory, searchTerm, selectedCategory]);

    return (
        <div className="h-full flex flex-col w-full overflow-hidden p-4 gap-2 mb-1 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300">
            {/* Fixed Header Section */}
            <div className="shrink-0 space-y-2 z-10">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <div>
                            <svg className="w-7 h-7 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                        </div>
                        <div>
                            <h1 className="text-[8px] font-black text-gray-900 dark:text-white leading-tight">Smart Recommendations</h1>
                            <p className="text-gray-500 text-xs font-medium mt-1">AI-driven alternatives for low stock items</p>
                        </div>
                    </div>

                    {/* Search and Filters */}
                    <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                        <div className="relative w-full sm:w-64 group">
                            <input 
                                type="text" 
                                placeholder="Search recommendations..." 
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
                        
                        <div>
                            <select 
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gray-900 border-2 border-gray-900 focus:outline-none focus:ring-4 focus:ring-gray-200 focus:bg-gray-800 cursor-pointer shadow-lg transition-all"
                            >
                                {categories.map(cat => (
                                    <option key={cat} value={cat} className="bg-white text-gray-900">{cat}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Scrollable Content Section */}
            <div className="flex-1 overflow-y-auto p-4 pt-0">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {criticalItems.length === 0 ? (
                    <div className="col-span-1 xl:col-span-2 p-8 text-center bg-white rounded-2xl border border-dashed border-gray-300">
                        <div className="w-16 h-16 mx-auto bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">Inventory Healthy</h3>
                        <p className="text-gray-500 text-sm">No low stock items found matching your filters.</p>
                    </div>
                ) : (
                    criticalItems.map(item => {
                        const alternatives = getAlternatives(item, inventory);
                        
                        return (
                            <div key={item.code} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
                                {/* Status Accent Border */}
                                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${item.stock === 0 ? 'bg-red-500' : 'bg-yellow-500'}`}></div>

                                <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3 pl-6">
                                    <div className="flex items-center gap-3">
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <h3 className="text-xl font-bold text-gray-900">{item.brand && <span className="text-gray-400">{item.brand} </span>}{item.name}{item.color && <span className="text-gray-400"> — {item.color}</span>}</h3>
                                                <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md uppercase tracking-wider ${
                                                    item.stock === 0 
                                                        ? 'bg-red-50 text-red-700 border border-red-100' 
                                                        : 'bg-yellow-50 text-yellow-700 border border-yellow-100'
                                                }`}>
                                                    {item.stock === 0 ? 'Out of Stock' : 'Low Stock'}
                                                </span>
                                            </div>
                                            <p className="text-gray-500 font-medium text-sm mt-1">Size: {item.size} • Code: <span className="font-mono text-gray-900">{item.code}</span></p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Stock Level</p>
                                        <p className={`text-3xl font-black ${item.stock === 0 ? 'text-red-500' : 'text-yellow-500'}`}>{item.stock}</p>
                                    </div>
                                </div>

                                <div className="p-4 bg-gray-50/50">
                                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                        </svg>
                                        Suggested Alternatives
                                    </h4>
                                    
                                    {alternatives.length > 0 ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {alternatives.map(alt => (
                                                <div key={alt.code} className="group p-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:shadow-lg transition-all relative">
                                                    
                                                    <div className="mb-2">
                                                        <div className="flex justify-between items-start">
                                                            <h5 className="font-bold text-gray-900 text-sm group-hover:text-indigo-900 transition-colors line-clamp-1">{alt.brand && <span className="text-gray-400 font-medium">{alt.brand} </span>}{alt.name}{alt.color && <span className="text-gray-400 font-normal"> — {alt.color}</span>}</h5>
                                                            {alt.category === item.category && (
                                                                <span className="shrink-0 ml-2 w-1.5 h-1.5 rounded-full bg-indigo-500" title="Same Category"></span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">{alt.code}</p>
                                                    </div>
                                                    
                                                    <div className="space-y-2 border-t border-gray-100 pt-3">
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-gray-500">Size</span>
                                                            <span className={`font-bold ${alt.size === item.size ? 'text-gray-900' : 'text-gray-500'}`}>{alt.size}</span>
                                                        </div>
                                                        
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-gray-500">Price</span>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-gray-900">₱{alt.price}</span>
                                                                {alt.price < item.price ? (
                                                                    <span className="text-xs text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded">-₱{item.price - alt.price}</span>
                                                                ) : (
                                                                    <span className="text-xs text-orange-600 font-bold bg-orange-50 px-1.5 py-0.5 rounded">+₱{alt.price - item.price}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 pt-3 flex items-center justify-between bg-gray-50 -mx-5 -mb-5 px-5 py-3 rounded-b-xl border-t border-gray-100 group-hover:bg-indigo-50 group-hover:border-indigo-100 transition-colors">
                                                        <span className="text-xs font-bold text-gray-400 group-hover:text-indigo-400">STOCK AVAILABLE</span>
                                                        <span className="text-xl font-black text-gray-900 group-hover:text-indigo-900">{alt.stock}</span>
                                                    </div>
                                                    <div className="mt-3 flex justify-center px-3">
                                                        {inventory.some(i => i.code === alt.code) ? (
                                                            <button
                                                                title="Edit"
                                                                aria-label="Edit"
                                                                className="p-1 bg-gray-900 border-2 border-gray-900 text-white rounded hover:bg-gray-800 mr-1"
                                                                onClick={() => {
                                                                    setModalMode('edit');
                                                                    setModalData({
                                                                        code: alt.code,
                                                                        name: alt.name || '',
                                                                        brand: alt.brand || '',
                                                                        price: alt.price !== undefined && alt.price !== null ? String(alt.price) : '',
                                                                        size: alt.size || '',
                                                                        supplier: alt.supplier || '',
                                                                        category: alt.category || '',
                                                                        stock: alt.stock !== undefined && alt.stock !== null ? String(Math.min(alt.stock, maxStockLimit)) : '0'
                                                                    });
                                                                    setIsModalOpen(true);
                                                                }}
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                                </svg>
                                                            </button>
                                                        ) : null}

                                                        <button
                                                            title="Add"
                                                            aria-label="Add"
                                                            className="p-1 bg-gray-900 border-2 border-gray-900 text-white rounded hover:bg-gray-800"
                                                            onClick={() => {
                                                                setModalMode('add');
                                                                setModalData({
                                                                    name: alt.name || '',
                                                                    brand: alt.brand || '',
                                                                    price: alt.price !== undefined && alt.price !== null ? String(alt.price) : '',
                                                                    size: alt.size || '',
                                                                    supplier: alt.supplier || '',
                                                                    category: alt.category || '',
                                                                    stock: alt.stock !== undefined && alt.stock !== null ? String(Math.min(alt.stock, maxStockLimit)) : String(Math.min(10, maxStockLimit))
                                                                });
                                                                setIsModalOpen(true);
                                                            }}
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-6 bg-white rounded-xl border border-gray-200 border-dashed text-center text-gray-400 text-base italic">
                                            No direct alternatives found in stock.
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
            </div>

            {/* Inline Add/Edit Product Modal */}
            {isModalOpen && (
                <div onClick={() => setIsModalOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-visible animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex justify-between items-center rounded-t-2xl">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
                                    {modalMode === 'add' ? (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                    ) : (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-black text-sm text-gray-900 leading-tight">
                                        {modalMode === 'add' ? 'Add Product' : 'Edit Product'}
                                    </h3>
                                    <p className="text-gray-400 text-[10px] mt-0.5">
                                        {modalMode === 'add' ? 'Add a new item to inventory' : 'Edit product details'}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <form onSubmit={(e) => { e.preventDefault();
                            if (!setInventory) return setIsModalOpen(false);

                            const name = (modalData.name || '').trim();
                            const price = parseFloat(modalData.price) || 0;
                            let stockVal = parseInt(modalData.stock) || 0;
                            if (stockVal > maxStockLimit) stockVal = maxStockLimit;

                            const combined = {
                                code: modalData.code || `${(modalData.category || 'OTH').slice(0,3).toUpperCase()}-${Math.floor(Math.random()*900+100)}`,
                                brand: modalData.brand || '',
                                name,
                                color: modalData.color || '',
                                category: modalData.category || 'Uncategorized',
                                size: modalData.size || '',
                                price,
                                stock: stockVal,
                                supplier: modalData.supplier || 'Local Supplier',
                            };

                            if (modalMode === 'add') {
                                // Do not add new product to inventory, just close modal
                                setIsModalOpen(false);
                                return;
                            } else {
                                // Always update by code
                                if (!combined.code) return setIsModalOpen(false);
                                setInventory(prev => (prev || []).map(p => p.code === combined.code ? { ...p, ...combined } : p));
                                if (logAction) logAction('UPDATE', combined.code, `Updated from Recommendation`);
                                if (logActivity) logActivity('System', 'Updated Product', `${combined.code} - ${combined.name}`);
                            }

                            setIsModalOpen(false);
                        }} className="px-5 py-4 space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-500 mb-1">Category</label>
                                <select
                                    value={modalData.category || ''}
                                    onChange={(e) => {
                                        const cat = e.target.value;
                                        setModalData({
                                            ...modalData,
                                            category: cat,
                                            code: '',
                                            name: '',
                                            brand: '',
                                            price: '',
                                            stock: ''
                                        });
                                    }}
                                    className="w-full p-2 border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 outline-none mb-2"
                                >
                                    <option value="">-- Choose category --</option>
                                    {(categories || []).filter(c => c !== 'All').map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>

                                <label className="block text-[10px] font-bold text-gray-500 mb-1">Select Product</label>
                                <select
                                    value={modalData.code || ''}
                                    onChange={(e) => {
                                        const code = e.target.value;
                                        if (!code) return setModalData({ ...modalData, code: '' });
                                        const sel = (rawInventory || []).find(i => i.code === code);
                                        if (!sel) return setModalData({ ...modalData, code: '' });
                                        setModalData({
                                            ...modalData,
                                            code: sel.code,
                                            name: sel.name || '',
                                            brand: sel.brand || '',
                                            price: sel.price !== undefined && sel.price !== null ? String(sel.price) : '',
                                            size: sel.size || '',
                                            supplier: sel.supplier || '',
                                            category: sel.category || '',
                                            stock: sel.stock !== undefined && sel.stock !== null ? String(Math.min(sel.stock, maxStockLimit)) : '0'
                                        });
                                    }}
                                    className="w-full p-2 border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 outline-none"
                                >
                                    <option value="">-- Choose product --</option>
                                    {(rawInventory || []).filter(i => (modalData.category ? i.category === modalData.category : true)).map(i => (
                                        <option key={i.code} value={i.code}>{`${i.code} — ${i.name}`}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Price</label>
                                    <input
                                        value={modalData.price !== undefined && modalData.price !== '' ? Number(modalData.price).toFixed(2) : ''}
                                        readOnly
                                        className="w-full p-2 border border-gray-200 rounded-lg text-xs font-medium bg-gray-50 cursor-not-allowed"
                                    />
                                </div>
                                <div className="w-36">
                                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Stock</label>
                                    <input
                                        value={modalData.stock || ''}
                                        readOnly
                                        className="w-full p-2 border border-gray-200 rounded-lg text-xs font-medium bg-gray-50 cursor-not-allowed"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 text-gray-900 rounded-xl border font-bold text-xs">Cancel</button>
                                {modalMode === 'edit' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setShowArchiveConfirm(true)}
                                            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold text-xs"
                                        >
                                            Remove
                                        </button>
                                        {showArchiveConfirm && (
                                            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40">
                                                <div className="bg-white rounded-xl shadow-xl p-6 max-w-xs w-full text-center">
                                                    <h3 className="font-bold text-lg mb-2 text-gray-900">Remove Product</h3>
                                                    <p className="text-gray-700 mb-4">Are you sure you want to remove Product <span className="font-mono text-red-600">{modalData.code}</span> from alternatives?</p>
                                                    <div className="flex justify-center gap-2">
                                                        <button className="px-3 py-1 rounded border text-sm" onClick={() => setShowArchiveConfirm(false)}>Cancel</button>
                                                        <button className="px-3 py-1 bg-red-600 text-white rounded text-sm" onClick={() => {
                                                            setInventory(prev => (prev || []).map(p => p.code === modalData.code ? { ...p, excludedFromAlternatives: true, archived: true } : p));
                                                            if (logAction) logAction('HIDE_ALT', modalData.code, `Excluded from alternatives`);
                                                            if (logActivity) logActivity('System', 'Excluded Product from Alternatives', `${modalData.code} - ${modalData.name}`);
                                                            setShowArchiveConfirm(false);
                                                            setIsModalOpen(false);
                                                        }}>Remove</button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                                <button type="submit" style={{ backgroundColor: '#111827', border: '2px solid #111827' }} className="flex-1 py-2.5 text-white rounded-xl font-bold uppercase tracking-widest shadow-lg transition-all transform text-xs mt-1 hover:-translate-y-0.5 hover:opacity-90">
                                        {modalMode === 'add' ? 'Add' : 'Save'}
                                    </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Recommendation;
