import React, { useState, useMemo, useEffect } from 'react';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { createCategoryApi, updateCategoryApi, deleteCategoryApi } from '../services/inventoryApi';

const Settings = () => {
    const { appSettings: initialSettings, updateSettings, currentUserName, userRole, ROLES } = useAuth();
    const { processedInventory: inventory, renameUserReferences, logActivity, categories: customCategories, fetchCategories } = useInventory();

    const isAdmin = userRole === ROLES.ADMIN;
    const availableTabs = useMemo(
        () => (isAdmin ? ['notifications', 'categories'] : ['general', 'notifications', 'stock rules', 'categories', 'backup']),
        [isAdmin]
    );

    const [activeTab, setActiveTab] = useState(availableTabs[0] || 'categories');
    
    // Category state
    const [isCategoryLoading, setIsCategoryLoading] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryRules, setNewCategoryRules] = useState({
        showBrand: false, requireBrand: false,
        showColor: false, requireColor: false,
        showSize: true, requireSize: true,
        showSupplier: true,
        sizeUnits: []
    });
    const [newCategoryUnitInput, setNewCategoryUnitInput] = useState('');
    const [editingCategory, setEditingCategory] = useState(null);
    const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false);
    const [categorySearchTerm, setCategorySearchTerm] = useState('');
    const [isDeleteCategoryModalOpen, setIsDeleteCategoryModalOpen] = useState(false);
    const [categoryToDelete, setCategoryToDelete] = useState(null);
    
    const defaults = useMemo(() => ({
        storeName: 'Tableria La Confianza Co., Inc.',
        storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
        contactPhone: '0917-123-4567',
        currency: 'PHP',
        darkMode: false,
        autoPrintReceipts: false,
        autoSync: true, // Default to Auto-Sync ON
        lowStockAlert: 10,
        maxStockLimit: 100, // Default Max Stock Limit
        budgetRanges: {
            low: { min: 0, max: 500 },
            moderate: { min: 500, max: 2000 },
            high: { min: 2000, max: 1000000 },
        },
        desktopNotifications: true,
        stockRules: { categories: {}, products: {} }
    }), []);

    // Initialize local state from props, ensuring defaults exist
    const [settings, setSettings] = useState({ ...defaults, ...initialSettings });

    // State for Rule Creators
    const [newCategoryRule, setNewCategoryRule] = useState({ name: '', limit: '' });
    const [newProductRule, setNewProductRule] = useState({ code: '', limit: '' });

    // Check for changes
    const isModified = useMemo(() => {
        if (!initialSettings) return false;
        
        // Reconstruct the baseline state
        const baseline = { 
            ...defaults, 
            ...initialSettings,
            stockRules: initialSettings.stockRules || { categories: {}, products: {} } 
        };

        return JSON.stringify(settings) !== JSON.stringify(baseline);
    }, [settings, initialSettings, defaults]);

    const generalSettingKeys = useMemo(() => ([
        'storeName',
        'storeAddress',
        'storeMapLink',
        'storePrimaryEmail',
        'storeSecondaryEmail',
        'contactPhone',
        'contactPhoneSecondary',
        'autoSync'
    ]), []);

    const isGeneralModified = useMemo(() => {
        if (!initialSettings) return false;

        const baseline = {
            ...defaults,
            ...initialSettings,
            stockRules: initialSettings.stockRules || { categories: {}, products: {} }
        };

        return generalSettingKeys.some((key) => {
            const currentValue = settings[key] ?? '';
            const baselineValue = baseline[key] ?? '';
            return currentValue !== baselineValue;
        });
    }, [settings, initialSettings, defaults, generalSettingKeys]);

    // Derived Data for Dropdowns
    const categories = useMemo(() => ['Lumbers & Boards', ...new Set(inventory.map(i => i.category).filter(Boolean))], [inventory]);
    const productOptions = useMemo(() => inventory.map(i => ({ code: i.code, name: `${i.brand ? i.brand + ' ' : ''}${i.name}${i.color ? ' — ' + i.color : ''}` })), [inventory]);
    const filteredCustomCategories = useMemo(() => {
        const needle = String(categorySearchTerm || '').trim().toLowerCase();
        if (!needle) return customCategories;
        return customCategories.filter((category) => String(category?.name || '').toLowerCase().includes(needle));
    }, [customCategories, categorySearchTerm]);

    useEffect(() => {
        if (!availableTabs.includes(activeTab)) {
            setActiveTab(availableTabs[0] || 'categories');
        }
    }, [activeTab, availableTabs]);

    const resetNewCategoryForm = () => {
        setNewCategoryName('');
        setNewCategoryRules({
            showBrand: false, requireBrand: false,
            showColor: false, requireColor: false,
            showSize: true, requireSize: true,
            showSupplier: true,
            sizeUnits: []
        });
        setNewCategoryUnitInput('');
    };

    // Update local state if props change (deep merge to keep defaults)
    React.useEffect(() => {
        if (initialSettings) {
             setSettings(prev => ({
                 ...prev,
                 ...initialSettings,
                 stockRules: initialSettings.stockRules || { categories: {}, products: {} }
             }));
        }
    }, [initialSettings]);

    const persistSettings = (nextSettings, { notify = false, log = false } = {}) => {
        const hasDisplayNameChange = nextSettings.adminDisplayName !== initialSettings?.adminDisplayName;

        // Handle side effects (renaming users in logs)
        if (hasDisplayNameChange) {
            renameUserReferences(initialSettings.adminDisplayName, nextSettings.adminDisplayName);
        }

        updateSettings(nextSettings);

        if (log) {
            const actorName = hasDisplayNameChange ? nextSettings.adminDisplayName : currentUserName;
            logActivity(actorName, 'Updated Settings', 'Changed system configuration');
        }

        if (notify) {
            showToast('Configuration Saved', 'System settings have been updated successfully.', 'success');
        }
    };

    const applyAutoSaveSettings = (updater) => {
        setSettings((prev) => {
            const nextSettings = typeof updater === 'function' ? updater(prev) : updater;
            persistSettings(nextSettings);
            return nextSettings;
        });
    };

    const addCategoryRule = () => {
        if(!newCategoryRule.name || !newCategoryRule.limit) return;
        applyAutoSaveSettings(prev => ({
            ...prev,
            stockRules: {
                ...prev.stockRules,
                categories: { ...prev.stockRules.categories, [newCategoryRule.name]: parseInt(newCategoryRule.limit) }
            }
        }));
        setNewCategoryRule({ name: '', limit: '' });
    };

    const removeCategoryRule = (catName) => {
        const newCats = { ...settings.stockRules.categories };
        delete newCats[catName];
        applyAutoSaveSettings(prev => ({
            ...prev,
            stockRules: { ...prev.stockRules, categories: newCats }
        }));
    };

    const addProductRule = () => {
        if(!newProductRule.code || !newProductRule.limit) return;
        applyAutoSaveSettings(prev => ({
            ...prev,
            stockRules: {
                ...prev.stockRules,
                products: { ...prev.stockRules.products, [newProductRule.code]: parseInt(newProductRule.limit) }
            }
        }));
        setNewProductRule({ code: '', limit: '' });
    };

    const removeProductRule = (code) => {
         const newProds = { ...settings.stockRules.products };
        delete newProds[code];
        applyAutoSaveSettings(prev => ({
            ...prev,
            stockRules: { ...prev.stockRules, products: newProds }
        }));
    };

    const normalizeUnits = (units) => {
        if (!Array.isArray(units)) {
            return [];
        }

        return [...new Set(
            units
                .map((unit) => String(unit || '').trim())
                .filter(Boolean)
        )];
    };

    const addUnitToNewCategory = () => {
        const value = String(newCategoryUnitInput || '').trim();
        if (!value) return;

        if ((newCategoryRules.sizeUnits || []).some((unit) => unit.toLowerCase() === value.toLowerCase())) {
            showToast('Duplicate Unit', 'Unit already exists in this category.', 'error');
            return;
        }

        setNewCategoryRules((prev) => ({
            ...prev,
            sizeUnits: normalizeUnits([...(prev.sizeUnits || []), value]),
        }));
        setNewCategoryUnitInput('');
    };

    const removeUnitFromNewCategory = (unitToRemove) => {
        setNewCategoryRules((prev) => ({
            ...prev,
            sizeUnits: normalizeUnits((prev.sizeUnits || []).filter((unit) => unit !== unitToRemove)),
        }));
    };

    const addUnitToEditingCategory = () => {
        const value = String(editingCategory?.unitInput || '').trim();
        if (!value || !editingCategory) return;

        if ((editingCategory.sizeUnits || []).some((unit) => unit.toLowerCase() === value.toLowerCase())) {
            showToast('Duplicate Unit', 'Unit already exists in this category.', 'error');
            return;
        }

        setEditingCategory((prev) => ({
            ...prev,
            sizeUnits: normalizeUnits([...(prev.sizeUnits || []), value]),
            unitInput: '',
        }));
    };

    const removeUnitFromEditingCategory = (unitToRemove) => {
        setEditingCategory((prev) => ({
            ...prev,
            sizeUnits: normalizeUnits((prev?.sizeUnits || []).filter((unit) => unit !== unitToRemove)),
        }));
    };

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) {
            return;
        }

        setIsCategoryLoading(true);
        try {
            await createCategoryApi({ 
                name: newCategoryName.trim(),
                ...newCategoryRules,
                sizeUnits: normalizeUnits(newCategoryRules.sizeUnits)
            });
            await fetchCategories();
            resetNewCategoryForm();
            setIsCreateCategoryModalOpen(false);
            showToast('Success', 'Category added.', 'success');
        } catch (error) {
            console.error(error);
            showToast('Error', error.message || 'Failed to add category.', 'error');
        } finally {
            setIsCategoryLoading(false);
        }
    };

    const handleUpdateCategory = async (id, updatedName, updatedRules = {}) => {
        if (!updatedName.trim()) {
            return setEditingCategory(null);
        }
        
        setIsCategoryLoading(true);
        try {
            await updateCategoryApi(id, { 
                name: updatedName.trim(),
                ...updatedRules,
                sizeUnits: normalizeUnits(updatedRules.sizeUnits)
            });
            await fetchCategories();
            setEditingCategory(null);
            showToast('Success', 'Category updated.', 'success');
        } catch (error) {
            console.error(error);
            showToast('Error', error.message || 'Failed to update category.', 'error');
        } finally {
            setIsCategoryLoading(false);
        }
    };

    const openDeleteCategoryModal = (category) => {
        if (!category?._id) return;
        setCategoryToDelete(category);
        setIsDeleteCategoryModalOpen(true);
    };

    const handleDeleteCategory = async () => {
        if (!categoryToDelete?._id) return;

        setIsCategoryLoading(true);
        try {
            await deleteCategoryApi(categoryToDelete._id);
            await fetchCategories();
            showToast('Delete this category?', 'Category deleted.', 'success');
        } catch (error) {
            console.error(error);
            showToast('Error', error.message || 'Failed to delete category.', 'error');
        } finally {
            setIsDeleteCategoryModalOpen(false);
            setCategoryToDelete(null);
            setIsCategoryLoading(false);
        }
    };

    const handleSave = () => {
        persistSettings(settings, { notify: true, log: true });
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 p-2 md:overflow-hidden">

            {/* Header */}
            <div className="relative z-20 bg-slate-200/50 dark:bg-gray-800 p-4 sm:p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0 border-t-8 border-t-[#111827]">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="text-gray-900 dark:text-white shrink-0 hidden sm:block">
                        <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-sm sm:text-base font-black text-gray-900 dark:text-white leading-tight">System Configuration</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-[11px] sm:text-xs font-medium mt-0.5">Customize application behavior and preferences</p>
                    </div>
                </div>
                {activeTab === 'general' && (
                    <div className="relative group w-full sm:w-auto shrink-0">
                        {!isGeneralModified && (
                            <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                    No pending updates. Make a settings change to enable saving.
                                </div>
                                <span className="absolute -bottom-1 right-6 h-2 w-2 rotate-45 bg-gray-900" />
                            </div>
                        )}
                        <button 
                            onClick={handleSave}
                            disabled={!isGeneralModified}
                            className={`w-full sm:w-auto bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-md transform ${isGeneralModified ? 'hover:opacity-90 hover:-translate-y-0.5 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                            style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                            Save Changes
                        </button>
                    </div>
                )}
            </div>

            {/* Main Content Area - Split View */}
            <div className="flex-1 flex flex-col md:flex-row gap-4 md:overflow-hidden min-h-0">
                
                {/* Sidebar Navigation */}
                <div className="w-full md:w-64 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3 h-auto md:h-full md:overflow-y-auto shrink-0">
                    <p className="px-4 py-2 text-[10px] uppercase font-bold text-gray-400 tracking-wider hidden md:block">Preferences</p>
                    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
                        {availableTabs.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${
                                    activeTab === tab 
                                    ? 'shadow-md transform scale-105 text-white' 
                                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'
                                }`}
                                style={
                                    activeTab === tab 
                                    ? { backgroundColor: '#111827', border: '2px solid #111827' }
                                    : {}
                                }
                            >
                                {tab === 'general' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>}
                                {tab === 'notifications' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>}
                                {tab === 'stock rules' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>}
                                {tab === 'categories' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>}
                                {tab === 'backup' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>}
                                <span className="capitalize">{tab}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Main View */}
                <div className="flex-1 bg-slate-200/50 dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 overflow-y-auto">
                    {/* Content will go here based on activeTab */}
                    {activeTab === 'general' && (
                        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                             <div>
                                <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1">Store Information</h3>
                                <p className="text-sm text-gray-500 mb-4">Manage details about your business.</p>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Store Name</label>
                                        <input 
                                            type="text" 
                                            value={settings.storeName} 
                                            onChange={(e) => setSettings({...settings, storeName: e.target.value})}
                                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Store Location / Address</label>
                                        <input 
                                            type="text" 
                                            value={settings.storeAddress}
                                            onChange={(e) => setSettings({...settings, storeAddress: e.target.value})}
                                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Google Maps Link</label>
                                        <input 
                                            type="text" 
                                            value={settings.storeMapLink || ''}
                                            onChange={(e) => setSettings({...settings, storeMapLink: e.target.value})}
                                            placeholder="https://maps.app.goo.gl/..."
                                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Primary Email</label>
                                            <input 
                                                type="text" 
                                                value={settings.storePrimaryEmail || ''}
                                                onChange={(e) => setSettings({...settings, storePrimaryEmail: e.target.value})}
                                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Secondary Email</label>
                                            <input 
                                                type="text" 
                                                value={settings.storeSecondaryEmail || ''}
                                                onChange={(e) => setSettings({...settings, storeSecondaryEmail: e.target.value})}
                                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Mobile Number</label>
                                            <input 
                                                type="text" 
                                                value={settings.contactPhone}
                                                onChange={(e) => {
                                                    const digits = e.target.value.replace(/\D/g, '');
                                                    if (digits.length <= 11) setSettings({...settings, contactPhone: digits});
                                                }}
                                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                                placeholder="Enter 11-digit mobile number"
                                            />
                                            {settings.contactPhone && settings.contactPhone.length !== 11 && (
                                                <p className="text-rose-500 text-[11px] mt-1">Phone number must be exactly 11 digits.</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Tel. / Landline</label>
                                            <input 
                                                type="text" 
                                                value={settings.contactPhoneSecondary || ''}
                                                onChange={(e) => {
                                                    const digits = e.target.value.replace(/\D/g, '');
                                                    if (digits.length <= 11) setSettings({...settings, contactPhoneSecondary: digits});
                                                }}
                                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                                placeholder="Enter landline or alternate number"
                                            />
                                        </div>
                                    </div>
                                </div>
                             </div>

                             {/* System Preferences Section */}
                             <div>
                                <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1">System Preferences</h3>
                                <p className="text-sm text-gray-500 mb-4">Configure global application behavior.</p>
                                
                                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-1">
                                    <div className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors">
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-white text-sm">Auto-Sync Transactions</p>
                                            <p className="text-xs text-gray-500">Automatically sync offline transactions when connection is restored</p>
                                        </div>
                                        <button 
                                            className={`w-11 h-6 rounded-full relative transition-colors ${!settings.autoSync ? 'bg-gray-200 dark:bg-gray-600' : ''}`} 
                                            style={{ backgroundColor: settings.autoSync ? '#111827' : '' }}
                                            onClick={() => setSettings(prev => ({ ...prev, autoSync: !prev.autoSync }))}
                                        >
                                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform ${settings.autoSync ? 'translate-x-5' : ''}`}></span>
                                        </button>
                                    </div>
                                </div>
                             </div>
                        </div>
                    )}

                   {activeTab === 'notifications' && (
                       <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                             <div>
                                <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1">Notification Preferences</h3>
                                <p className="text-sm text-gray-500 mb-4">Control when and how you get alerted.</p>
                                
                                <div className="space-y-4 bg-white dark:bg-gray-800 rounded-xl">

                                    <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-white text-sm">Auto-Print Receipts</p>
                                            <p className="text-xs text-gray-500">Automatically print receipt after transaction</p>
                                        </div>
                                        <button 
                                            className={`w-11 h-6 rounded-full relative transition-colors ${!settings.autoPrintReceipts ? 'bg-gray-200 dark:bg-gray-600' : ''}`} 
                                            style={{ backgroundColor: settings.autoPrintReceipts ? '#111827' : '' }}
                                            onClick={() => applyAutoSaveSettings((prev) => ({ ...prev, autoPrintReceipts: !prev.autoPrintReceipts }))}
                                        >
                                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform ${settings.autoPrintReceipts ? 'translate-x-5' : ''}`}></span>
                                        </button>
                                    </div>
                                    
                                    <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                        <div>
                                            <p className="font-bold text-gray-900 dark:text-white text-sm">Desktop Push Notifications (Browser)</p>
                                            <p className="text-xs text-gray-500">Show browser/OS pop-up alerts for critical updates. In-app low stock banners stay enabled.</p>
                                            
                                            {/* Helper for Denied Permission */}
                                            {settings.desktopNotifications && 'Notification' in window && Notification.permission === 'denied' && (
                                                <div className="mt-2 p-2 bg-red-50 text-red-600 rounded-lg text-[10px] border border-red-100 animate-in fade-in">
                                                    <strong>⚠️ Access Blocked by Browser</strong><br/>
                                                    To fix: Click the 🔒 lock icon in your address bar (top left), find <b>Notifications</b>, and change it to <b>Allow</b>.
                                                </div>
                                            )}

                                            {settings.desktopNotifications && 'Notification' in window && Notification.permission === 'granted' && (
                                                <button 
                                                    onClick={() => {
                                                        const notif = new Notification("Test Notification", {
                                                            body: "This is how alerts will appear!",
                                                            icon: "/vite.svg" 
                                                        });
                                                        showToast('Test Sent', 'Desktop notification dispatched.', 'info', 'test-notif');
                                                    }}
                                                    className="mt-2 text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded border border-gray-300 font-bold transition-colors"
                                                >
                                                    Test Alert
                                                </button>
                                            )}
                                        </div>
                                         <button 
                                            className={`w-11 h-6 rounded-full relative transition-colors ${!settings.desktopNotifications ? 'bg-gray-200 dark:bg-gray-600' : ''}`} 
                                            style={{ backgroundColor: settings.desktopNotifications ? '#111827' : '' }}
                                            onClick={() => {
                                                const newValue = !settings.desktopNotifications;
                                                applyAutoSaveSettings((prev) => ({ ...prev, desktopNotifications: !prev.desktopNotifications }));
                                                
                                                if (newValue && 'Notification' in window && Notification.permission !== 'granted') {
                                                    Notification.requestPermission().then(permission => {
                                                        if (permission === 'granted') {
                                                            showToast('Notifications Active', 'You will now receive desktop alerts.', 'success', 'notif-perm');
                                                            new Notification("Enabled", { body: "Desktop notifications are now active." });
                                                        } else {
                                                            showToast('Permission Denied', 'Browser blocked notifications.', 'error', 'notif-perm');
                                                        }
                                                    });
                                                }
                                            }}
                                        >
                                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform ${settings.desktopNotifications ? 'translate-x-5' : ''}`}></span>
                                        </button>
                                    </div>
                                </div>
                             </div>
                       </div>
                   )}

                   {activeTab === 'stock rules' && (
                       <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                             <div>
                                <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1">Stock Level Rules</h3>
                                <p className="text-sm text-gray-500 mb-4">Set granular maximum stock limits by category or product.</p>
                                
                                <div className="space-y-6">
                                    {/* Default Rule */}
                                    <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Global Default</h4>
                                            <p className="text-[10px] text-gray-500">Fallback target if no other rule matches.</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="number" 
                                                className="w-20 p-2 text-center bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-bold"
                                                value={settings.maxStockLimit || 100}
                                                onChange={(e) => applyAutoSaveSettings((prev) => ({ ...prev, maxStockLimit: Number(e.target.value) }))}
                                            />
                                            <span className="text-xs font-bold text-gray-500">Qty</span>
                                        </div>
                                    </div>

                                    {/* Minimum Stock Level */}
                                    <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">Restock Trigger Point</h4>
                                            <p className="text-[10px] text-gray-500">Suggest restock when stock hits this % of Max Limit.</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="number" 
                                                className="w-20 p-2 text-center bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-bold"
                                                value={settings.lowStockAlert}
                                                onChange={(e) => applyAutoSaveSettings((prev) => ({ ...prev, lowStockAlert: e.target.value }))}
                                            />
                                            <span className="text-xs font-bold text-gray-500">%</span>
                                        </div>
                                    </div>

                                    {/* Category Rules */}
                                    <div className="bg-gray-50 dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">Category Overrides</h4>
                                        <div className="flex gap-2 mb-4">
                                            <select 
                                                className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium"
                                                value={newCategoryRule.name}
                                                onChange={e => setNewCategoryRule({...newCategoryRule, name: e.target.value})}
                                            >
                                                <option value="">Select Category</option>
                                                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                            </select>
                                            <input 
                                                type="number" 
                                                placeholder="Max Limit"
                                                className="w-24 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-bold text-center"
                                                value={newCategoryRule.limit}
                                                onChange={e => setNewCategoryRule({...newCategoryRule, limit: e.target.value})}
                                            />
                                            <button 
                                                onClick={addCategoryRule}
                                                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold uppercase disabled:opacity-50"
                                                disabled={!newCategoryRule.name || !newCategoryRule.limit}
                                            >
                                                Add
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {Object.entries(settings.stockRules?.categories || {}).length === 0 && (
                                                <p className="text-xs text-gray-400 italic text-center py-2">No category rules set.</p>
                                            )}
                                            {Object.entries(settings.stockRules?.categories || {}).map(([cat, limit]) => (
                                                <div key={cat} className="flex items-center justify-between p-3 bg-white dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600 shadow-sm">
                                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{cat}</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: {limit}</span>
                                                        <button onClick={() => removeCategoryRule(cat)} className="text-red-500 hover:text-red-700">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Product Rules */}
                                    <div className="bg-gray-50 dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">Product Specific Overrides</h4>
                                        <div className="flex gap-2 mb-4">
                                             <input 
                                                list="product-list"
                                                className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium"
                                                placeholder="Search Product Code/Name..."
                                                value={newProductRule.code}
                                                onChange={e => setNewProductRule({...newProductRule, code: e.target.value})}
                                            />
                                            <datalist id="product-list">
                                                {productOptions.map(p => (
                                                    <option key={p.code} value={p.code}>{p.name}</option>
                                                ))}
                                            </datalist>
                                            <input 
                                                type="number" 
                                                placeholder="Max Limit"
                                                className="w-24 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-bold text-center"
                                                value={newProductRule.limit}
                                                onChange={e => setNewProductRule({...newProductRule, limit: e.target.value})}
                                            />
                                            <button 
                                                onClick={addProductRule}
                                                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold uppercase disabled:opacity-50"
                                                disabled={!newProductRule.code || !newProductRule.limit}
                                            >
                                                Add
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {Object.entries(settings.stockRules?.products || {}).length === 0 && (
                                                <p className="text-xs text-gray-400 italic text-center py-2">No product rules set.</p>
                                            )}
                                            {Object.entries(settings.stockRules?.products || {}).map(([code, limit]) => {
                                                const prod = productOptions.find(p => p.code === code);
                                                return (
                                                    <div key={code} className="flex items-center justify-between p-3 bg-white dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600 shadow-sm">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{prod ? prod.name : code}</span>
                                                            <span className="text-[10px] text-gray-500">{code}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: {limit}</span>
                                                            <button onClick={() => removeProductRule(code)} className="text-red-500 hover:text-red-700">
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                             </div>
                       </div>
                   )}
                   {activeTab === 'categories' && (
                       <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-right-4 duration-300">
                            <div>
                               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                   <div>
                                        <h3 className="text-xl font-black text-gray-900 dark:text-white mb-1">Product Categories</h3>
                                        <p className="text-sm text-gray-500">Manage custom product categories for your inventory.</p>
                                   </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsCreateCategoryModalOpen(true)}
                                        className="w-full sm:w-auto px-3 py-1.5 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 hover:opacity-90 transform hover:-translate-y-0.5"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                        Add Category
                                    </button>
                               </div>

                               <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-6">
                                   <div className="p-5 border-b border-gray-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-900/30">
                                       <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                            </div>
                                           <input
                                               type="text"
                                               value={categorySearchTerm}
                                               onChange={(e) => setCategorySearchTerm(e.target.value)}
                                               placeholder="Search categories..."
                                               className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 outline-none text-gray-900 dark:text-white transition-shadow"
                                           />
                                       </div>
                                   </div>

                                   <ul className="divide-y divide-gray-50/50 dark:divide-gray-700/50 max-h-[500px] overflow-y-auto">
                                       {filteredCustomCategories.length === 0 ? (
                                            <li className="p-10 text-center flex flex-col items-center justify-center text-gray-500">
                                                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex flex-col items-center justify-center mb-3">
                                                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                                                </div>
                                                <p className="text-sm font-medium">No custom categories found.</p>
                                                <p className="text-xs text-gray-400 mt-1">Try a different search term or add a new one.</p>
                                            </li>
                                       ) : (
                                            filteredCustomCategories.map(category => (
                                               <li key={category._id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-slate-50/80 dark:hover:bg-gray-700/30 transition-colors group">
                                                   {false ? (
                                                       <div className="flex-1 space-y-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 ring-1 ring-black/5">
                                                           {/* Edit Mode */}
                                                           <div>
                                                                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Category Name</label>
                                                                <input
                                                                    type="text"
                                                                    value={editingCategory.name}
                                                                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                                                    className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-bold text-gray-900 dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 outline-none"
                                                                    autoFocus
                                                                />
                                                           </div>
                                                           
                                                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                                <div className="space-y-2 p-3 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                                                    <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Visible Fields</p>
                                                                    <label className="flex items-center justify-between p-1 cursor-pointer">
                                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Show Brand</span>
                                                                        <input type="checkbox" checked={!!editingCategory.showBrand} onChange={(e) => setEditingCategory(prev => ({ ...prev, showBrand: e.target.checked, requireBrand: e.target.checked ? prev.requireBrand : false }))} className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
                                                                    </label>
                                                                    <label className="flex items-center justify-between p-1 cursor-pointer">
                                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Show Color</span>
                                                                        <input type="checkbox" checked={!!editingCategory.showColor} onChange={(e) => setEditingCategory(prev => ({ ...prev, showColor: e.target.checked, requireColor: e.target.checked ? prev.requireColor : false }))} className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
                                                                    </label>
                                                                    <label className="flex items-center justify-between p-1 cursor-pointer">
                                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Show Size</span>
                                                                        <input type="checkbox" checked={!!editingCategory.showSize} onChange={(e) => setEditingCategory(prev => ({ ...prev, showSize: e.target.checked, requireSize: e.target.checked ? prev.requireSize : false }))} className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900" />
                                                                    </label>
                                                                </div>

                                                                <div className="space-y-2 p-3 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                                                    <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Required Fields</p>
                                                                    <label className={`flex items-center justify-between p-1 cursor-pointer ${editingCategory.showBrand ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>
                                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Require Brand</span>
                                                                        <input type="checkbox" checked={!!editingCategory.requireBrand} disabled={!editingCategory.showBrand} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireBrand: e.target.checked }))} className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                                                    </label>
                                                                    <label className={`flex items-center justify-between p-1 cursor-pointer ${editingCategory.showColor ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>
                                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Require Color</span>
                                                                        <input type="checkbox" checked={!!editingCategory.requireColor} disabled={!editingCategory.showColor} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireColor: e.target.checked }))} className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                                                    </label>
                                                                    <label className={`flex items-center justify-between p-1 cursor-pointer ${editingCategory.showSize ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>
                                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Require Size</span>
                                                                        <input type="checkbox" checked={!!editingCategory.requireSize} disabled={!editingCategory.showSize} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireSize: e.target.checked }))} className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                                                    </label>
                                                                </div>
                                                           </div>

                                                           <div className="space-y-2">
                                                                <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Measurement Units</p>
                                                               <div className="flex gap-2">
                                                                   <input
                                                                       type="text"
                                                                       value={editingCategory.unitInput || ''}
                                                                       onChange={(e) => setEditingCategory((prev) => ({ ...prev, unitInput: e.target.value }))}
                                                                       onKeyDown={(e) => {
                                                                           if (e.key === 'Enter') {
                                                                               e.preventDefault();
                                                                               addUnitToEditingCategory();
                                                                           }
                                                                       }}
                                                                       placeholder="e.g. pcs, boxes, kg"
                                                                       className="flex-1 p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-900 dark:text-white outline-none focus:border-gray-900 dark:focus:border-gray-100"
                                                                   />
                                                                   <button type="button" onClick={addUnitToEditingCategory} className="px-4 py-2.5 rounded-lg text-sm font-bold bg-white border border-gray-200 text-gray-800 shadow-sm hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700 transition-colors">Add</button>
                                                               </div>
                                                               <div className="flex flex-wrap gap-2 pt-1">
                                                                   {(editingCategory.sizeUnits || []).map((unit) => (
                                                                       <span key={unit} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
                                                                           {unit}
                                                                           <button type="button" onClick={() => removeUnitFromEditingCategory(unit)} className="text-gray-400 hover:text-gray-900 hover:bg-gray-200 dark:hover:text-white dark:hover:bg-gray-700 rounded flex items-center justify-center w-5 h-5 transition-colors">
                                                                               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                                                                           </button>
                                                                       </span>
                                                                   ))}
                                                               </div>
                                                           </div>

                                                           <div className="flex gap-2 justify-end pt-2 border-t border-gray-100 dark:border-gray-700/50">
                                                               <button 
                                                                   onClick={() => setEditingCategory(null)}
                                                                   className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg transition-colors border border-transparent"
                                                               >
                                                                   Cancel
                                                               </button>
                                                               <button 
                                                                   onClick={() => handleUpdateCategory(category._id, editingCategory.name, editingCategory)}
                                                                   className="px-4 py-2 text-sm font-bold text-white dark:text-gray-900 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 rounded-lg transition-colors shadow-sm flex items-center gap-2"
                                                               >
                                                                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                                                   Save Changes
                                                               </button>
                                                           </div>
                                                       </div>
                                                   ) : (
                                                       <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between min-w-0 pr-4">
                                                           {/* View Mode */}
                                                           <div className="mb-3 sm:mb-0">
                                                               <div className="flex items-center gap-2 mb-1.5">
                                                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400">
                                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                                                                    </div>
                                                                    <span className="text-base font-black text-gray-900 dark:text-white truncate">{category.name}</span>
                                                               </div>
                                                               
                                                               <div className="flex flex-wrap items-center gap-1.5 pl-10">
                                                                   {category.showBrand && (
                                                                        <span className="inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                                                                            Brand {category.requireBrand && <span className="ml-1 font-bold">*</span>}
                                                                        </span>
                                                                   )}
                                                                   {category.showColor && (
                                                                        <span className="inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                                                                            Color {category.requireColor && <span className="ml-1 font-bold">*</span>}
                                                                        </span>
                                                                   )}
                                                                   {category.showSize !== false && (
                                                                        <span className="inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                                                                            Size {category.requireSize && <span className="ml-1 font-bold">*</span>}
                                                                        </span>
                                                                   )}
                                                                   <span className="inline-flex items-center border border-gray-200 bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full text-[10px] font-bold dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 ml-1">
                                                                       <svg className="w-3 h-3 mr-1 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>
                                                                       {(category.sizeUnits || []).length} Units
                                                                   </span>
                                                               </div>
                                                           </div>
                                                           
                                                           <div className="flex items-center gap-2 pl-10 sm:pl-0">
                                                               <button 
                                                                   onClick={() => setEditingCategory({
                                                                       id: category._id,
                                                                       name: category.name,
                                                                       showBrand: !!category.showBrand,
                                                                       requireBrand: !!category.requireBrand,
                                                                       showColor: !!category.showColor,
                                                                       requireColor: !!category.requireColor,
                                                                       showSize: category.showSize !== false,
                                                                       requireSize: !!category.requireSize,
                                                                       showSupplier: category.showSupplier !== false,
                                                                       sizeUnits: Array.isArray(category.sizeUnits) ? category.sizeUnits : [],
                                                                       unitInput: '',
                                                                   })}
                                                                   className="group/btn inline-flex items-center rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all px-2.5 py-2"
                                                                   title="Edit Category"
                                                               >
                                                                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                                   <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-bold group-hover/btn:ml-1 group-hover/btn:max-w-16 group-hover/btn:opacity-100">Edit</span>
                                                               </button>
                                                               <button 
                                                                   onClick={() => openDeleteCategoryModal(category)}
                                                                   className="group/btn inline-flex items-center rounded-lg transition-all bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 px-2.5 py-2"
                                                                   title="Delete this category?"
                                                               >
                                                                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                   <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-bold group-hover/btn:ml-1 group-hover/btn:max-w-36 group-hover/btn:opacity-100">Delete this category?</span>
                                                               </button>
                                                           </div>
                                                       </div>
                                                   )}
                                               </li>
                                           ))
                                       )}
                                   </ul>
                               </div>
                            </div>
                       </div>
                   )}

                   {isCreateCategoryModalOpen && (
                       <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => {setIsCreateCategoryModalOpen(false); resetNewCategoryForm();}}></div>
                           
                           <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-visible animate-in fade-in zoom-in-95 duration-200 border border-transparent dark:border-gray-700 flex flex-col max-h-[90vh]">
                               <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800 flex items-center justify-between shrink-0 rounded-t-2xl">
                                   <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center shrink-0 shadow-md">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                        </div>
                                       <div>
                                           <h4 className="text-sm font-black text-gray-900 dark:text-white leading-tight uppercase tracking-wide">Create Category</h4>
                                       </div>
                                   </div>
                                   <button
                                       type="button"
                                       onClick={() => {
                                           setIsCreateCategoryModalOpen(false);
                                           resetNewCategoryForm();
                                       }}
                                       className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-all shrink-0"
                                   >
                                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                   </button>
                               </div>

                               <div className="px-5 py-4 overflow-y-auto space-y-4">
                                   <div>
                                       <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Basic Info</p>
                                       <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Category Name <span className="text-red-400">*</span></label>
                                       <input
                                           type="text"
                                           value={newCategoryName}
                                           onChange={(e) => setNewCategoryName(e.target.value)}
                                           placeholder="e.g., Tools, Plumbing, Electrical"
                                           disabled={isCategoryLoading}
                                           className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                       />
                                   </div>

                                   <div>
                                       <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Visible & Required Fields</p>
                                       <div className="grid grid-cols-2 gap-2.5">
                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Brand</span>
                                                   <input type="checkbox" checked={newCategoryRules.showBrand} onChange={(e) => setNewCategoryRules(prev => ({...prev, showBrand: e.target.checked, requireBrand: e.target.checked ? prev.requireBrand : false}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${newCategoryRules.showBrand ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Brand</span>
                                                   <input type="checkbox" checked={newCategoryRules.requireBrand} disabled={!newCategoryRules.showBrand} onChange={(e) => setNewCategoryRules(prev => ({...prev, requireBrand: e.target.checked}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>
                                           
                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Color</span>
                                                   <input type="checkbox" checked={newCategoryRules.showColor} onChange={(e) => setNewCategoryRules(prev => ({...prev, showColor: e.target.checked, requireColor: e.target.checked ? prev.requireColor : false}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${newCategoryRules.showColor ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Color</span>
                                                   <input type="checkbox" checked={newCategoryRules.requireColor} disabled={!newCategoryRules.showColor} onChange={(e) => setNewCategoryRules(prev => ({...prev, requireColor: e.target.checked}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>

                                           <div className="col-span-2 space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Size / Variant</span>
                                                   <input type="checkbox" checked={newCategoryRules.showSize} onChange={(e) => setNewCategoryRules(prev => ({...prev, showSize: e.target.checked, requireSize: e.target.checked ? prev.requireSize : false}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${newCategoryRules.showSize ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Size</span>
                                                   <input type="checkbox" checked={newCategoryRules.requireSize} disabled={!newCategoryRules.showSize} onChange={(e) => setNewCategoryRules(prev => ({...prev, requireSize: e.target.checked}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>
                                       </div>
                                   </div>

                                   <div>
                                       <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 flex justify-between">Measurement Units <span className="normal-case opacity-70 font-medium">Optional</span></p>
                                       <div className="flex gap-2.5 items-center mb-2">
                                           <input
                                               type="text"
                                               value={newCategoryUnitInput}
                                               onChange={(e) => setNewCategoryUnitInput(e.target.value)}
                                               onKeyDown={(e) => {
                                                   if (e.key === 'Enter') {
                                                       e.preventDefault();
                                                       addUnitToNewCategory();
                                                   }
                                               }}
                                               placeholder="e.g. pcs"
                                               className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                           />
                                           <button
                                               type="button"
                                               onClick={addUnitToNewCategory}
                                               className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600 transition-all shrink-0"
                                           >
                                               Add
                                           </button>
                                       </div>
                                       <div className="flex flex-wrap gap-1.5 p-2.5 min-h-[46px] border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-slate-50/50 dark:bg-gray-900/30">
                                           {(newCategoryRules.sizeUnits || []).length === 0 ? (
                                               <span className="text-[10px] text-gray-400 font-medium italic">No units added yet.</span>
                                           ) : (newCategoryRules.sizeUnits || []).map((unit) => (
                                               <span key={unit} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white dark:bg-gray-800 text-[10px] font-bold text-gray-700 dark:text-gray-300 shadow-sm border border-gray-100 dark:border-gray-700">
                                                   {unit}
                                                   <button
                                                       type="button"
                                                       onClick={() => removeUnitFromNewCategory(unit)}
                                                       className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded p-0.5 transition-colors"
                                                   >
                                                       <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                                                   </button>
                                               </span>
                                           ))}
                                       </div>
                                   </div>
                               </div>

                               <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 flex gap-3 shrink-0 rounded-b-2xl">
                                   <button
                                       type="button"
                                       onClick={() => {
                                           setIsCreateCategoryModalOpen(false);
                                           resetNewCategoryForm();
                                       }}
                                       disabled={isCategoryLoading}
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors uppercase tracking-widest"
                                   >
                                       Cancel
                                   </button>
                                   <button
                                       type="button"
                                       onClick={handleAddCategory}
                                       disabled={isCategoryLoading || !newCategoryName.trim()}
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-gray-900 hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest shadow-md flex items-center justify-center"
                                   >
                                       {isCategoryLoading ? <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> : 'Create Category'}
                                   </button>
                               </div>
                           </div>
                       </div>
                   )}

                   {editingCategory && (
                       <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setEditingCategory(null)}></div>

                           <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-visible animate-in fade-in zoom-in-95 duration-200 border border-transparent dark:border-gray-700 flex flex-col max-h-[90vh]">
                               <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800 flex items-center justify-between shrink-0 rounded-t-2xl">
                                   <div className="flex items-center gap-3">
                                       <div className="w-8 h-8 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center shrink-0 shadow-md">
                                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                       </div>
                                       <div>
                                           <h4 className="text-sm font-black text-gray-900 dark:text-white leading-tight uppercase tracking-wide">Edit Category</h4>
                                       </div>
                                   </div>
                                   <button
                                       type="button"
                                       onClick={() => setEditingCategory(null)}
                                       className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-all shrink-0"
                                   >
                                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                   </button>
                               </div>

                               <div className="px-5 py-4 overflow-y-auto space-y-4">
                                   <div>
                                       <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Basic Info</p>
                                       <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Category Name <span className="text-red-400">*</span></label>
                                       <input
                                           type="text"
                                           value={editingCategory.name}
                                           onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                           disabled={isCategoryLoading}
                                           className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                           autoFocus
                                       />
                                   </div>

                                   <div>
                                       <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Visible & Required Fields</p>
                                       <div className="grid grid-cols-2 gap-2.5">
                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Brand</span>
                                                   <input type="checkbox" checked={!!editingCategory.showBrand} onChange={(e) => setEditingCategory(prev => ({ ...prev, showBrand: e.target.checked, requireBrand: e.target.checked ? prev.requireBrand : false }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${editingCategory.showBrand ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Brand</span>
                                                   <input type="checkbox" checked={!!editingCategory.requireBrand} disabled={!editingCategory.showBrand} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireBrand: e.target.checked }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>

                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Color</span>
                                                   <input type="checkbox" checked={!!editingCategory.showColor} onChange={(e) => setEditingCategory(prev => ({ ...prev, showColor: e.target.checked, requireColor: e.target.checked ? prev.requireColor : false }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${editingCategory.showColor ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Color</span>
                                                   <input type="checkbox" checked={!!editingCategory.requireColor} disabled={!editingCategory.showColor} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireColor: e.target.checked }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>

                                           <div className="col-span-2 space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Size / Variant</span>
                                                   <input type="checkbox" checked={!!editingCategory.showSize} onChange={(e) => setEditingCategory(prev => ({ ...prev, showSize: e.target.checked, requireSize: e.target.checked ? prev.requireSize : false }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${editingCategory.showSize ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Size</span>
                                                   <input type="checkbox" checked={!!editingCategory.requireSize} disabled={!editingCategory.showSize} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireSize: e.target.checked }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>
                                       </div>
                                   </div>

                                   <div className="space-y-2">
                                       <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 flex justify-between">Measurement Units <span className="normal-case opacity-70 font-medium">Optional</span></p>
                                       <div className="flex gap-2.5 items-center mb-2">
                                           <input
                                               type="text"
                                               value={editingCategory.unitInput || ''}
                                               onChange={(e) => setEditingCategory((prev) => ({ ...prev, unitInput: e.target.value }))}
                                               onKeyDown={(e) => {
                                                   if (e.key === 'Enter') {
                                                       e.preventDefault();
                                                       addUnitToEditingCategory();
                                                   }
                                               }}
                                               placeholder="e.g. pcs"
                                               className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                           />
                                           <button type="button" onClick={addUnitToEditingCategory} className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600 transition-all shrink-0">Add</button>
                                       </div>
                                       <div className="flex flex-wrap gap-1.5 p-2.5 min-h-[46px] border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-slate-50/50 dark:bg-gray-900/30">
                                           {(editingCategory.sizeUnits || []).length === 0 ? (
                                               <span className="text-[10px] text-gray-400 font-medium italic">No units added yet.</span>
                                           ) : (editingCategory.sizeUnits || []).map((unit) => (
                                               <span key={unit} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white dark:bg-gray-800 text-[10px] font-bold text-gray-700 dark:text-gray-300 shadow-sm border border-gray-100 dark:border-gray-700">
                                                   {unit}
                                                   <button type="button" onClick={() => removeUnitFromEditingCategory(unit)} className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded p-0.5 transition-colors">
                                                       <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                                                   </button>
                                               </span>
                                           ))}
                                       </div>
                                   </div>
                               </div>

                               <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-800/50 flex gap-3 shrink-0 rounded-b-2xl">
                                   <button
                                       type="button"
                                       onClick={() => setEditingCategory(null)}
                                       disabled={isCategoryLoading}
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors uppercase tracking-widest"
                                   >
                                       Cancel
                                   </button>
                                   <button
                                       type="button"
                                       onClick={() => handleUpdateCategory(editingCategory.id, editingCategory.name, editingCategory)}
                                       disabled={isCategoryLoading || !editingCategory.name?.trim()}
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-gray-900 hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest shadow-md flex items-center justify-center"
                                   >
                                       {isCategoryLoading ? <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> : 'Save Changes'}
                                   </button>
                               </div>
                           </div>
                       </div>
                   )}

                   {isDeleteCategoryModalOpen && categoryToDelete && (
                       <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                           <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                               <div className="p-6 text-center">
                                   <div className="mx-auto flex items-center justify-center mb-4 text-red-600">
                                       <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                   </div>
                                   <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">Delete this category?</h3>
                                   <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                       Are you sure you want to delete <span className="font-bold text-gray-900 dark:text-white">{categoryToDelete.name}</span>?
                                   </p>
                                   <div className="flex gap-3">
                                       <button
                                           onClick={() => {
                                               setIsDeleteCategoryModalOpen(false);
                                               setCategoryToDelete(null);
                                           }}
                                           disabled={isCategoryLoading}
                                           className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
                                       >
                                           Cancel
                                       </button>
                                       <button
                                           onClick={handleDeleteCategory}
                                           disabled={isCategoryLoading}
                                           style={{ backgroundColor: '#111827' }}
                                           className="flex-1 py-2.5 text-white rounded-xl font-bold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
                                       >
                                           {isCategoryLoading ? 'Deleting...' : 'Confirm'}
                                       </button>
                                   </div>
                               </div>
                           </div>
                       </div>
                   )}

                    {activeTab === 'backup' && (
                        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                             <div>
                                <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1">Data Management</h3>
                                <p className="text-sm text-gray-500 mb-4">Backup or restore system data.</p>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-5 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 transition-colors">
                                        <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mb-3">
                                            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        </div>
                                        <h4 className="font-bold text-gray-900 dark:text-white mb-1">Backup Data</h4>
                                        <p className="text-xs text-gray-500 mb-4">Download a JSON file of your entire inventory and transaction history.</p>
                                        <button 
                                            className="w-full px-4 py-2 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-4 focus:ring-gray-200 cursor-pointer shadow-lg transition-all flex items-center justify-center gap-2 transform hover:scale-105 shadow-md"
                                            style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                            Download Backup
                                        </button>
                                    </div>

                                    {/* Factory Reset removed for safety */}
                                </div>
                             </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default Settings;
