import React, { useState, useMemo, useEffect, useRef } from 'react';
import { showToast } from '../utils/toastHelper';
import ArchiveIcon from '../components/ArchiveIcon';
import EditIcon from '../components/EditIcon';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { createCategoryApi, updateCategoryApi } from '../services/inventoryApi';
import { downloadSystemBackupApi, restoreSystemBackupApi } from '../services/settingsApi';
import { clearAuthToken } from '../services/apiClient';
import {
    isWholeNumberInput,
    preventInvalidWholeNumberKeyDown,
    preventInvalidWholeNumberPaste,
    sanitizeWholeNumberInput,
} from '../utils/numericInput';

const Settings = () => {
    const { appSettings: initialSettings, updateSettings, userPreferences, updateUserPreferences, currentUserName, userRole, ROLES } = useAuth();
    const { processedInventory: inventory, renameUserReferences, logActivity, categories: customCategories, fetchCategories } = useInventory();

    const isAdmin = userRole === ROLES.ADMIN;
    const isSuperAdmin = userRole === ROLES.SUPER_ADMIN;
    const availableTabs = useMemo(
        () => {
            if (isAdmin) {
                return ['notifications', 'categories'];
            }

            if (isSuperAdmin) {
                return ['general', 'notifications', 'stock rules', 'categories', 'backup'];
            }

            return ['general', 'notifications', 'stock rules', 'categories'];
        },
        [isAdmin, isSuperAdmin]
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
    const [debouncedCategorySearchTerm, setDebouncedCategorySearchTerm] = useState('');
    const [showArchivedCategories, setShowArchivedCategories] = useState(false);
    const [isDeleteCategoryModalOpen, setIsDeleteCategoryModalOpen] = useState(false);
    const [categoryToDelete, setCategoryToDelete] = useState(null);
    const [isBackupLoading, setIsBackupLoading] = useState(false);
    const [isRestoreLoading, setIsRestoreLoading] = useState(false);
    const [isAutomaticBackupSaving, setIsAutomaticBackupSaving] = useState(false);
    const restoreInputRef = useRef(null);
    
    const defaults = useMemo(() => ({
        storeName: 'Tableria La Confianza Co., Inc.',
        storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
        contactPhone: '0917-123-4567',
        currency: 'PHP',
        darkMode: false,
        autoSync: true, // Default to Auto-Sync ON
        automaticBackupEnabled: false,
        automaticBackupIntervalDays: 1,
        automaticBackupTime: '23:00',
        lastAutomaticBackupAt: null,
        lastAutomaticBackupStatus: 'not_run',
        lastAutomaticBackupError: '',
        nextAutomaticBackupAt: null,
        lowStockAlert: 10,
        maxStockLimit: 100, // Default Max Stock Limit
        budgetRanges: {
            low: { min: 0, max: 500 },
            moderate: { min: 500, max: 2000 },
            high: { min: 2000, max: Number.MAX_SAFE_INTEGER },
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
        const needle = String(debouncedCategorySearchTerm || '').trim().toLowerCase();
        const scoped = customCategories.filter((category) => {
            const isActiveCategory = category?.isActive !== false;
            return showArchivedCategories ? !isActiveCategory : isActiveCategory;
        });

        if (!needle) return scoped;
        return scoped.filter((category) => String(category?.name || '').toLowerCase().includes(needle));
    }, [customCategories, debouncedCategorySearchTerm, showArchivedCategories]);

    const categorySearchSuggestions = useMemo(() => {
        const terms = new Set();

        customCategories.forEach((category) => {
            const name = String(category?.name || '').trim();
            if (name) {
                terms.add(name);
            }
        });

        return Array.from(terms)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .slice(0, 120);
    }, [customCategories]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedCategorySearchTerm(categorySearchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [categorySearchTerm]);

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

    const applyWholeNumberSetting = (field, rawValue, options) => {
        const nextValue = sanitizeWholeNumberInput(rawValue);
        if (!isWholeNumberInput(nextValue, options)) return;
        applyAutoSaveSettings((prev) => ({ ...prev, [field]: Number(nextValue) }));
    };

    const addCategoryRule = () => {
        if(!newCategoryRule.name || !newCategoryRule.limit) return;
        if (!isWholeNumberInput(newCategoryRule.limit, { min: 1 })) {
            showToast('Invalid Limit', 'Category max limit must be a whole number greater than 0.', 'error', 'stock-rule-validation');
            return;
        }
        applyAutoSaveSettings(prev => ({
            ...prev,
            stockRules: {
                ...prev.stockRules,
                categories: { ...prev.stockRules.categories, [newCategoryRule.name]: Number(newCategoryRule.limit) }
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
        if (!isWholeNumberInput(newProductRule.limit, { min: 1 })) {
            showToast('Invalid Limit', 'Product max limit must be a whole number greater than 0.', 'error', 'stock-rule-validation');
            return;
        }
        applyAutoSaveSettings(prev => ({
            ...prev,
            stockRules: {
                ...prev.stockRules,
                products: { ...prev.stockRules.products, [newProductRule.code]: Number(newProductRule.limit) }
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
        const isRestoring = categoryToDelete?.isActive === false;

        setIsCategoryLoading(true);
        try {
            await updateCategoryApi(categoryToDelete._id, { isActive: isRestoring });
            await fetchCategories();
            showToast(
                isRestoring ? 'Category Restored' : 'Category Archived',
                isRestoring ? 'Category restored.' : 'Category archived.',
                'success'
            );
        } catch (error) {
            console.error(error);
            showToast('Error', error.message || `Failed to ${isRestoring ? 'restore' : 'archive'} category.`, 'error');
        } finally {
            setIsDeleteCategoryModalOpen(false);
            setCategoryToDelete(null);
            setIsCategoryLoading(false);
        }
    };

    const handleSave = () => {
        persistSettings(settings, { notify: true, log: true });
    };

    const handleSaveAutomaticBackup = async () => {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(settings.automaticBackupTime || ''))) {
            showToast('Invalid Backup Time', 'Choose a valid backup time.', 'error');
            return;
        }

        setIsAutomaticBackupSaving(true);
        try {
            const savedSettings = await updateSettings({
                automaticBackupEnabled: Boolean(settings.automaticBackupEnabled),
                automaticBackupIntervalDays: Number(settings.automaticBackupIntervalDays),
                automaticBackupTime: settings.automaticBackupTime,
            }, { partial: true, throwOnError: true });

            if (!savedSettings) {
                throw new Error('Unable to save automatic backup settings.');
            }

            setSettings((prev) => ({ ...prev, ...savedSettings }));
            showToast(
                'Automatic Backup Updated',
                savedSettings.automaticBackupEnabled
                    ? 'Automatic backup schedule is active.'
                    : 'Automatic backup schedule is disabled.',
                'success'
            );
        } catch (error) {
            showToast('Automatic Backup Failed', error.message || 'Unable to save automatic backup settings.', 'error');
        } finally {
            setIsAutomaticBackupSaving(false);
        }
    };

    const formatAutomaticBackupDate = (value, fallback = 'Not yet run') => {
        if (!value) return fallback;

        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? fallback
            : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    };

    const automaticBackupStatusLabel = !settings.automaticBackupEnabled
        ? 'Disabled'
        : {
            successful: 'Successful',
            failed: 'Failed',
            not_run: 'Scheduled',
        }[settings.lastAutomaticBackupStatus] || 'Scheduled';

    const handleDownloadBackup = async () => {
        setIsBackupLoading(true);
        try {
            const backupPayload = await downloadSystemBackupApi();
            if (!backupPayload) {
                throw new Error('Backup payload is empty.');
            }

            const generatedAt = backupPayload.generatedAt || new Date().toISOString();
            const safeTimestamp = generatedAt.replace(/[:.]/g, '-');
            const fileName = `inventory-backup-${safeTimestamp}.json`;

            const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);

            showToast('Backup Ready', 'System backup file downloaded successfully.', 'success');
        } catch (error) {
            console.error(error);
            showToast('Backup Failed', error.message || 'Unable to download backup.', 'error');
        } finally {
            setIsBackupLoading(false);
        }
    };

    const openRestorePicker = () => {
        if (isRestoreLoading) return;
        restoreInputRef.current?.click();
    };

    const handleRestoreFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        const confirmRestore = window.confirm('This will replace current system data with the selected backup. Continue?');
        if (!confirmRestore) {
            return;
        }

        setIsRestoreLoading(true);
        try {
            const rawContent = await file.text();
            const parsedBackup = JSON.parse(rawContent);
            const response = await restoreSystemBackupApi(parsedBackup);
            const restoredCount = Object.values(response?.restoredCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);

            showToast('Restore Completed', `Restored ${restoredCount} records. Please sign in again.`, 'success');
            window.setTimeout(() => {
                sessionStorage.removeItem('userRole');
                sessionStorage.removeItem('userName');
                sessionStorage.removeItem('userAvatar');
                sessionStorage.removeItem('authUsername');
                sessionStorage.removeItem('mustChangeCredentials');
                clearAuthToken();
                window.location.assign('/login');
            }, 1200);
        } catch (error) {
            console.error(error);
            showToast('Restore Failed', error.message || 'Unable to restore backup file.', 'error');
        } finally {
            setIsRestoreLoading(false);
        }
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 md:overflow-hidden">

            {/* Header */}
            <div className="relative z-20 bg-slate-200/50 p-4 sm:p-5 rounded-2xl shadow-inner border border-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                    <p className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">System Configuration</p>
                    <p className="text-gray-500 dark:text-gray-400 text-[11px] md:text-xs font-medium mt-0.5">Customize application behavior and preferences</p>
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
                            className={`w-full sm:w-auto bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-md transform ${isGeneralModified ? 'hover:opacity-90 hover:-translate-y-0.5 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
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
                <div className="w-full md:w-64 bg-white rounded-xl shadow-sm border border-gray-100 p-3 h-auto md:h-full md:overflow-y-auto shrink-0">
                    <p className="px-4 py-2 text-[10px] uppercase font-semibold text-gray-400 tracking-wider hidden md:block">Preferences</p>
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
                <div className="flex-1 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 p-6 overflow-y-auto">
                    {/* Content will go here based on activeTab */}
                    {activeTab === 'general' && (
                        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                             <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Store Information</h3>
                                <p className="text-sm text-gray-500 mb-4">Manage details about your business.</p>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Store Name</label>
                                        <input 
                                            type="text" 
                                            value={settings.storeName} 
                                            onChange={(e) => setSettings({...settings, storeName: e.target.value})}
                                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Store Location / Address</label>
                                        <input 
                                            type="text" 
                                            value={settings.storeAddress}
                                            onChange={(e) => setSettings({...settings, storeAddress: e.target.value})}
                                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Google Maps Link</label>
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
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Primary Email</label>
                                            <input 
                                                type="text" 
                                                value={settings.storePrimaryEmail || ''}
                                                onChange={(e) => setSettings({...settings, storePrimaryEmail: e.target.value})}
                                                className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Secondary Email</label>
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
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Mobile Number</label>
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
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Tel. / Landline</label>
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
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">System Preferences</h3>
                                <p className="text-sm text-gray-500 mb-4">Configure global application behavior.</p>
                                
                                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-1">
                                    <div className="flex items-center gap-4 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-gray-900 dark:text-white text-sm">Auto-Sync Transactions</p>
                                            <p className="text-xs text-gray-500">Automatically sync offline transactions when connection is restored</p>
                                        </div>
                                        <button 
                                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${!settings.autoSync ? 'bg-gray-200 dark:bg-gray-600' : ''}`} 
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
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Notification Preferences</h3>
                                <p className="text-sm text-gray-500 mb-4">Control when and how you get alerted.</p>
                                
                                <div className="space-y-4 bg-white dark:bg-gray-800 rounded-xl">

                                    <div className="flex items-center gap-4 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-700">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-gray-900 dark:text-white text-sm">Auto-Print Receipts</p>
                                            <p className="text-xs text-gray-500">Automatically print receipt after transaction</p>
                                        </div>
                                        <button 
                                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${!userPreferences.autoPrintReceipts ? 'bg-gray-200 dark:bg-gray-600' : ''}`}
                                            style={{ backgroundColor: userPreferences.autoPrintReceipts ? '#111827' : '' }}
                                            onClick={() => {
                                                void updateUserPreferences({ autoPrintReceipts: !userPreferences.autoPrintReceipts })
                                                    .catch((error) => showToast('Update Failed', error?.message || 'Unable to save Auto Print preference.', 'error'));
                                            }}
                                        >
                                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform ${userPreferences.autoPrintReceipts ? 'translate-x-5' : ''}`}></span>
                                        </button>
                                    </div>
                                    
                                    <div className="flex items-center gap-4 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-700">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-gray-900 dark:text-white text-sm">Desktop Push Notifications (Browser)</p>
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
                                                    className="mt-2 text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded border border-gray-300 font-semibold transition-colors"
                                                >
                                                    Test Alert
                                                </button>
                                            )}
                                        </div>
                                         <button 
                                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${!settings.desktopNotifications ? 'bg-gray-200 dark:bg-gray-600' : ''}`} 
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
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Stock Level Rules</h3>
                                <p className="text-sm text-gray-500 mb-4">Set granular maximum stock limits by category or product.</p>
                                
                                <div className="space-y-6">
                                    {/* Default Rule */}
                                    <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white tracking-wide">Global Default</h4>
                                            <p className="text-[10px] text-gray-500">Fallback target if no other rule matches.</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                className="w-20 p-2 text-center bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-semibold"
                                                value={settings.maxStockLimit || 100}
                                                onKeyDown={preventInvalidWholeNumberKeyDown}
                                                onPaste={preventInvalidWholeNumberPaste}
                                                onChange={(e) => applyWholeNumberSetting('maxStockLimit', e.target.value, { min: 1 })}
                                            />
                                            <span className="text-xs font-semibold text-gray-500">Qty</span>
                                        </div>
                                    </div>

                                    {/* Minimum Stock Level */}
                                    <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white tracking-wide">Restock Trigger Point</h4>
                                            <p className="text-[10px] text-gray-500">Suggest restock when stock hits this % of Max Limit.</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                className="w-20 p-2 text-center bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-semibold"
                                                value={settings.lowStockAlert}
                                                onKeyDown={preventInvalidWholeNumberKeyDown}
                                                onPaste={preventInvalidWholeNumberPaste}
                                                onChange={(e) => applyWholeNumberSetting('lowStockAlert', e.target.value, { max: 100 })}
                                            />
                                            <span className="text-xs font-semibold text-gray-500">%</span>
                                        </div>
                                    </div>

                                    {/* Category Rules */}
                                    <div className="bg-gray-50 dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 tracking-wide">Category Overrides</h4>
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
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                placeholder="Max Limit"
                                                className="w-24 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-semibold text-center"
                                                value={newCategoryRule.limit}
                                                onKeyDown={preventInvalidWholeNumberKeyDown}
                                                onPaste={preventInvalidWholeNumberPaste}
                                                onChange={e => setNewCategoryRule({...newCategoryRule, limit: sanitizeWholeNumberInput(e.target.value)})}
                                            />
                                            <button 
                                                onClick={addCategoryRule}
                                                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold uppercase disabled:opacity-50"
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
                                                        <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: {limit}</span>
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
                                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 tracking-wide">Product Specific Overrides</h4>
                                        <div className="flex gap-2 mb-4">
                                             <input 
                                                list="product-list"
                                                className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium"
                                                placeholder="Search SKU/Name..."
                                                value={newProductRule.code}
                                                onChange={e => setNewProductRule({...newProductRule, code: e.target.value})}
                                            />
                                            <datalist id="product-list">
                                                {productOptions.map(p => (
                                                    <option key={p.code} value={p.code}>{p.name}</option>
                                                ))}
                                            </datalist>
                                            <input 
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]*"
                                                placeholder="Max Limit"
                                                className="w-24 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-semibold text-center"
                                                value={newProductRule.limit}
                                                onKeyDown={preventInvalidWholeNumberKeyDown}
                                                onPaste={preventInvalidWholeNumberPaste}
                                                onChange={e => setNewProductRule({...newProductRule, limit: sanitizeWholeNumberInput(e.target.value)})}
                                            />
                                            <button 
                                                onClick={addProductRule}
                                                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold uppercase disabled:opacity-50"
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
                                                            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{prod ? prod.name : code}</span>
                                                            <span className="text-[10px] text-gray-500">{code}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded">Max: {limit}</span>
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
                                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Product Categories</h3>
                                        <p className="text-sm text-gray-500">Manage custom product categories for your inventory.</p>
                                   </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsCreateCategoryModalOpen(true)}
                                        className="w-full sm:w-auto px-3 py-1.5 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-xs font-semibold transition-all shadow-md flex items-center justify-center gap-1.5 hover:opacity-90 transform hover:-translate-y-0.5"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                        Add Category
                                    </button>
                               </div>

                               <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-6">
                                   <div className="p-5 border-b border-gray-100 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-900/30">
                                       <div className="flex items-center gap-3">
                                           <div className="relative flex-1 min-w-0 sm:flex-[0_1_78%]">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                                </div>
                                               <input
                                                   type="text"
                                                   value={categorySearchTerm}
                                                   list="settings-category-search-suggestions"
                                                   onChange={(e) => setCategorySearchTerm(e.target.value)}
                                                   placeholder="Search categories..."
                                                   className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 outline-none text-gray-900 dark:text-white transition-shadow"
                                               />
                                           </div>
                                           <button
                                               type="button"
                                               onClick={() => setShowArchivedCategories(prev => !prev)}
                                               className={`group shrink-0 inline-flex items-center rounded-xl border px-2.5 py-2.5 sm:ml-1 transition-all duration-300 ${showArchivedCategories ? 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200' : 'border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400'}`}
                                               title={showArchivedCategories ? 'Back to Active Categories' : 'View Archived Categories'}
                                           >
                                               {showArchivedCategories ? (
                                                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                                               ) : (
                                                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
                                               )}
                                               <span className={`ml-0 max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold opacity-0 transition-all duration-300 group-hover:ml-2 group-hover:opacity-100 ${showArchivedCategories ? 'group-hover:max-w-44' : 'group-hover:max-w-28'}`}>
                                                   {showArchivedCategories ? 'Back to Active' : 'View Archive'}
                                               </span>
                                           </button>
                                           <datalist id="settings-category-search-suggestions">
                                               {categorySearchSuggestions.map((term) => (
                                                   <option key={term} value={term} />
                                               ))}
                                           </datalist>
                                       </div>
                                   </div>

                                   <ul className="divide-y divide-gray-50/50 dark:divide-gray-700/50 max-h-[500px] overflow-y-auto">
                                       {filteredCustomCategories.length === 0 ? (
                                            <li className="p-10 text-center flex flex-col items-center justify-center text-gray-500">
                                                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex flex-col items-center justify-center mb-3">
                                                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                                                </div>
                                                <p className="text-sm font-medium">No custom categories found.</p>
                                                <p className="text-xs text-gray-400 mt-1">{showArchivedCategories ? 'No archived categories yet.' : 'Try a different search term or add a new one.'}</p>
                                            </li>
                                       ) : (
                                            filteredCustomCategories.map(category => (
                                               <li key={category._id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-slate-50/80 dark:hover:bg-gray-700/30 transition-colors group">
                                                   {false ? (
                                                       <div className="flex-1 space-y-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 ring-1 ring-black/5">
                                                           {/* Edit Mode */}
                                                           <div>
                                                                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Category Name</label>
                                                                <input
                                                                    type="text"
                                                                    value={editingCategory.name}
                                                                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                                                    className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-semibold text-gray-900 dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 outline-none"
                                                                    autoFocus
                                                                />
                                                           </div>
                                                           
                                                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                                <div className="space-y-2 p-3 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                                                    <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Visible Fields</p>
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
                                                                    <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Required Fields</p>
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
                                                                <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Measurement Units</p>
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
                                                                   <button type="button" onClick={addUnitToEditingCategory} className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-800 shadow-sm hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700 transition-colors">Add</button>
                                                               </div>
                                                               <div className="flex flex-wrap gap-2 pt-1">
                                                                   {(editingCategory.sizeUnits || []).map((unit) => (
                                                                       <span key={unit} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
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
                                                                   className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg transition-colors border border-transparent"
                                                               >
                                                                   Cancel
                                                               </button>
                                                               <button 
                                                                   onClick={() => handleUpdateCategory(category._id, editingCategory.name, editingCategory)}
                                                                   className="px-4 py-2 text-sm font-semibold text-white dark:text-gray-900 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 rounded-lg transition-colors shadow-sm flex items-center gap-2"
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
                                                                    <span className="text-base font-semibold text-gray-900 dark:text-white truncate">{category.name}</span>
                                                               </div>
                                                               
                                                               <div className="flex flex-wrap items-center gap-1.5 pl-10">
                                                                   {category.showBrand && (
                                                                        <span className="inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                                                                            Brand {category.requireBrand && <span className="ml-1 font-semibold">*</span>}
                                                                        </span>
                                                                   )}
                                                                   {category.showColor && (
                                                                        <span className="inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                                                                            Color {category.requireColor && <span className="ml-1 font-semibold">*</span>}
                                                                        </span>
                                                                   )}
                                                                   {category.showSize !== false && (
                                                                        <span className="inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-600 border-slate-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                                                                            Size {category.requireSize && <span className="ml-1 font-semibold">*</span>}
                                                                        </span>
                                                                   )}
                                                                   <span className="inline-flex items-center border border-gray-200 bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full text-[10px] font-semibold dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 ml-1">
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
                                                                    className="group/btn inline-flex shrink-0 items-center rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-800"
                                                                    title="Edit Category"
                                                                    aria-label={`Edit ${category.name}`}
                                                               >
                                                                    <EditIcon />
                                                                    <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-semibold opacity-0 transition-all duration-200 group-hover/btn:ml-1 group-hover/btn:max-w-12 group-hover/btn:opacity-100">Edit</span>
                                                               </button>
                                                               <button 
                                                                   onClick={() => openDeleteCategoryModal(category)}
                                                                   className={`group/btn inline-flex items-center rounded-lg transition-all px-2.5 py-2 ${category.isActive === false ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40' : 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40'}`}
                                                                   title={category.isActive === false ? 'Restore this category' : 'Archive this category'}
                                                               >
                                                                   {category.isActive === false ? (
                                                                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                                   ) : (
                                                                       <ArchiveIcon />
                                                                   )}
                                                                   <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-semibold group-hover/btn:ml-1 group-hover/btn:max-w-36 group-hover/btn:opacity-100">{category.isActive === false ? 'Restore Category' : 'Archive Category'}</span>
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
                                           <h4 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight uppercase tracking-wide">Create Category</h4>
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
                                       <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Basic Info</p>
                                       <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Category Name <span className="text-red-400">*</span></label>
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
                                       <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Visible & Required Fields</p>
                                       <div className="grid grid-cols-2 gap-2.5">
                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Brand</span>
                                                   <input type="checkbox" checked={newCategoryRules.showBrand} onChange={(e) => setNewCategoryRules(prev => ({...prev, showBrand: e.target.checked, requireBrand: e.target.checked ? prev.requireBrand : false}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${newCategoryRules.showBrand ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Brand</span>
                                                   <input type="checkbox" checked={newCategoryRules.requireBrand} disabled={!newCategoryRules.showBrand} onChange={(e) => setNewCategoryRules(prev => ({...prev, requireBrand: e.target.checked}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>
                                           
                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Color</span>
                                                   <input type="checkbox" checked={newCategoryRules.showColor} onChange={(e) => setNewCategoryRules(prev => ({...prev, showColor: e.target.checked, requireColor: e.target.checked ? prev.requireColor : false}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${newCategoryRules.showColor ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Color</span>
                                                   <input type="checkbox" checked={newCategoryRules.requireColor} disabled={!newCategoryRules.showColor} onChange={(e) => setNewCategoryRules(prev => ({...prev, requireColor: e.target.checked}))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>

                                           <div className="col-span-2 space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Size / Variant</span>
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
                                       <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 flex justify-between">Measurement Units <span className="normal-case opacity-70 font-medium">Optional</span></p>
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
                                               className="px-4 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600 transition-all shrink-0"
                                           >
                                               Add
                                           </button>
                                       </div>
                                       <div className="flex flex-wrap gap-1.5 p-2.5 min-h-[46px] border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-slate-50/50 dark:bg-gray-900/30">
                                           {(newCategoryRules.sizeUnits || []).length === 0 ? (
                                               <span className="text-[10px] text-gray-400 font-medium italic">No units added yet.</span>
                                           ) : (newCategoryRules.sizeUnits || []).map((unit) => (
                                               <span key={unit} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white dark:bg-gray-800 text-[10px] font-semibold text-gray-700 dark:text-gray-300 shadow-sm border border-gray-100 dark:border-gray-700">
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
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors uppercase tracking-widest"
                                   >
                                       Cancel
                                   </button>
                                   <button
                                       type="button"
                                       onClick={handleAddCategory}
                                       disabled={isCategoryLoading || !newCategoryName.trim()}
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-gray-900 hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest shadow-md flex items-center justify-center"
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
                                           <h4 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight uppercase tracking-wide">Edit Category</h4>
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
                                       <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Basic Info</p>
                                       <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Category Name <span className="text-red-400">*</span></label>
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
                                       <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Visible & Required Fields</p>
                                       <div className="grid grid-cols-2 gap-2.5">
                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Brand</span>
                                                   <input type="checkbox" checked={!!editingCategory.showBrand} onChange={(e) => setEditingCategory(prev => ({ ...prev, showBrand: e.target.checked, requireBrand: e.target.checked ? prev.requireBrand : false }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${editingCategory.showBrand ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Brand</span>
                                                   <input type="checkbox" checked={!!editingCategory.requireBrand} disabled={!editingCategory.showBrand} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireBrand: e.target.checked }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>

                                           <div className="space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Color</span>
                                                   <input type="checkbox" checked={!!editingCategory.showColor} onChange={(e) => setEditingCategory(prev => ({ ...prev, showColor: e.target.checked, requireColor: e.target.checked ? prev.requireColor : false }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900" />
                                               </label>
                                               <label className={`flex items-center justify-between cursor-pointer group ${editingCategory.showColor ? '' : 'opacity-40 cursor-not-allowed'}`}>
                                                   <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">Require Color</span>
                                                   <input type="checkbox" checked={!!editingCategory.requireColor} disabled={!editingCategory.showColor} onChange={(e) => setEditingCategory(prev => ({ ...prev, requireColor: e.target.checked }))} className="w-3.5 h-3.5 rounded-sm text-gray-900 border-gray-300 focus:ring-gray-900 disabled:opacity-50" />
                                               </label>
                                           </div>

                                           <div className="col-span-2 space-y-1.5 p-2 bg-slate-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                               <label className="flex items-center justify-between cursor-pointer group">
                                                   <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Size / Variant</span>
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
                                       <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 flex justify-between">Measurement Units <span className="normal-case opacity-70 font-medium">Optional</span></p>
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
                                           <button type="button" onClick={addUnitToEditingCategory} className="px-4 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600 transition-all shrink-0">Add</button>
                                       </div>
                                       <div className="flex flex-wrap gap-1.5 p-2.5 min-h-[46px] border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-slate-50/50 dark:bg-gray-900/30">
                                           {(editingCategory.sizeUnits || []).length === 0 ? (
                                               <span className="text-[10px] text-gray-400 font-medium italic">No units added yet.</span>
                                           ) : (editingCategory.sizeUnits || []).map((unit) => (
                                               <span key={unit} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white dark:bg-gray-800 text-[10px] font-semibold text-gray-700 dark:text-gray-300 shadow-sm border border-gray-100 dark:border-gray-700">
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
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors uppercase tracking-widest"
                                   >
                                       Cancel
                                   </button>
                                   <button
                                       type="button"
                                       onClick={() => handleUpdateCategory(editingCategory.id, editingCategory.name, editingCategory)}
                                       disabled={isCategoryLoading || !editingCategory.name?.trim()}
                                       className="flex-1 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-gray-900 hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest shadow-md flex items-center justify-center"
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
                                   <div className={`mx-auto flex items-center justify-center mb-4 ${categoryToDelete?.isActive === false ? 'text-emerald-600' : 'text-orange-600'}`}>
                                       {categoryToDelete?.isActive === false ? (
                                           <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                       ) : (
                                            <ArchiveIcon className="w-12 h-12" />
                                       )}
                                   </div>
                                   <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{categoryToDelete?.isActive === false ? 'Restore this category?' : 'Archive this category?'}</h3>
                                   <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                       Are you sure you want to {categoryToDelete?.isActive === false ? 'restore' : 'archive'} <span className="font-semibold text-gray-900 dark:text-white">{categoryToDelete.name}</span>?
                                   </p>
                                   <div className="flex gap-3">
                                       <button
                                           onClick={() => {
                                               setIsDeleteCategoryModalOpen(false);
                                               setCategoryToDelete(null);
                                           }}
                                           disabled={isCategoryLoading}
                                           className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
                                       >
                                           Cancel
                                       </button>
                                       <button
                                           onClick={handleDeleteCategory}
                                           disabled={isCategoryLoading}
                                           style={{ backgroundColor: '#111827' }}
                                           className="flex-1 py-2.5 text-white rounded-xl font-semibold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
                                       >
                                           {isCategoryLoading ? (categoryToDelete?.isActive === false ? 'Restoring...' : 'Archiving...') : (categoryToDelete?.isActive === false ? 'Restore' : 'Archive')}
                                       </button>
                                   </div>
                               </div>
                           </div>
                       </div>
                   )}

                    {activeTab === 'backup' && isSuperAdmin && (
                        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                             <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Data Management</h3>
                                <p className="text-sm text-gray-500 mb-4">Backup or restore system data.</p>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-5 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 transition-colors">
                                        <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mb-3">
                                            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        </div>
                                        <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Backup Data</h4>
                                        <p className="text-xs text-gray-500 mb-4">Download a JSON file of your entire inventory and transaction history.</p>
                                        <button 
                                            onClick={handleDownloadBackup}
                                            disabled={isBackupLoading || isRestoreLoading}
                                            className="w-full px-4 py-2 rounded-xl text-xs font-semibold text-white focus:outline-none focus:ring-4 focus:ring-gray-200 cursor-pointer shadow-lg transition-all flex items-center justify-center gap-2 transform hover:scale-105 shadow-md"
                                            style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                            {isBackupLoading ? 'Preparing Backup...' : 'Download Backup'}
                                        </button>
                                    </div>

                                    <div className="p-5 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 transition-colors">
                                        <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center justify-center mb-3">
                                            <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12a9 9 0 0 1 15.3-6.3L21 8" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 3v5h-5" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 0 1-15.3 6.3L3 16" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-5h5" />
                                            </svg>
                                        </div>
                                        <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Restore Backup</h4>
                                        <p className="text-xs text-gray-500 mb-4">Upload a previously downloaded JSON backup to restore system data.</p>
                                        <input
                                            ref={restoreInputRef}
                                            type="file"
                                            accept="application/json,.json"
                                            onChange={handleRestoreFile}
                                            className="hidden"
                                        />
                                        <button
                                            onClick={openRestorePicker}
                                            disabled={isRestoreLoading || isBackupLoading}
                                            className="w-full px-4 py-2 rounded-xl text-xs font-semibold text-white focus:outline-none focus:ring-4 focus:ring-gray-200 cursor-pointer shadow-lg transition-all flex items-center justify-center gap-2 transform hover:scale-105 shadow-md"
                                            style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 8l8-5 8 5M12 3v13"></path></svg>
                                            {isRestoreLoading ? 'Restoring Backup...' : 'Upload & Restore'}
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Automatic Backup</h4>
                                            <p className="mt-1 text-xs text-gray-500">Save the same restore-compatible JSON backup to the server on a schedule.</p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={Boolean(settings.automaticBackupEnabled)}
                                            aria-label="Automatic Backup"
                                            onClick={() => setSettings((prev) => ({ ...prev, automaticBackupEnabled: !prev.automaticBackupEnabled }))}
                                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${settings.automaticBackupEnabled ? 'bg-gray-900' : 'bg-gray-200 dark:bg-gray-600'}`}
                                        >
                                            <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${settings.automaticBackupEnabled ? 'translate-x-5' : ''}`} />
                                        </button>
                                    </div>

                                    <div className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${settings.automaticBackupEnabled ? '' : 'opacity-55'}`}>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Backup Frequency</label>
                                            <select
                                                value={settings.automaticBackupIntervalDays}
                                                disabled={!settings.automaticBackupEnabled || isAutomaticBackupSaving}
                                                onChange={(event) => setSettings((prev) => ({ ...prev, automaticBackupIntervalDays: Number(event.target.value) }))}
                                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            >
                                                <option value={1}>Daily</option>
                                                <option value={3}>Every 3 Days</option>
                                                <option value={5}>Every 5 Days</option>
                                                <option value={7}>Weekly</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Backup Time</label>
                                            <input
                                                type="time"
                                                value={settings.automaticBackupTime || '23:00'}
                                                disabled={!settings.automaticBackupEnabled || isAutomaticBackupSaving}
                                                onChange={(event) => setSettings((prev) => ({ ...prev, automaticBackupTime: event.target.value }))}
                                                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 text-xs sm:grid-cols-3 dark:border-gray-700">
                                        <div>
                                            <p className="font-semibold uppercase tracking-wider text-gray-400">Last Automatic Backup</p>
                                            <p className="mt-1 font-medium text-gray-800 dark:text-gray-100">{formatAutomaticBackupDate(settings.lastAutomaticBackupAt)}</p>
                                        </div>
                                        <div>
                                            <p className="font-semibold uppercase tracking-wider text-gray-400">Next Automatic Backup</p>
                                            <p className="mt-1 font-medium text-gray-800 dark:text-gray-100">{settings.automaticBackupEnabled ? formatAutomaticBackupDate(settings.nextAutomaticBackupAt, 'Scheduling after save') : 'Disabled'}</p>
                                        </div>
                                        <div>
                                            <p className="font-semibold uppercase tracking-wider text-gray-400">Status</p>
                                            <p className={`mt-1 font-medium ${settings.automaticBackupEnabled && settings.lastAutomaticBackupStatus === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>{automaticBackupStatusLabel}</p>
                                        </div>
                                    </div>

                                    {settings.lastAutomaticBackupStatus === 'failed' && settings.lastAutomaticBackupError && (
                                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{settings.lastAutomaticBackupError}</p>
                                    )}

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                        <p className="text-[11px] text-gray-500">Schedule uses the server&apos;s local deployment time. The browser does not need to remain open.</p>
                                        <button
                                            type="button"
                                            onClick={handleSaveAutomaticBackup}
                                            disabled={isAutomaticBackupSaving}
                                            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isAutomaticBackupSaving ? 'Saving...' : 'Save Automatic Backup'}
                                        </button>
                                    </div>
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
