import React, { useState, useMemo } from 'react';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';

const Settings = () => {
    const { appSettings: initialSettings, updateSettings, currentUserName } = useAuth();
    const { processedInventory: inventory, renameUserReferences, logActivity } = useInventory();

    const [activeTab, setActiveTab] = useState('general');
    
    const defaults = useMemo(() => ({
        storeName: 'Tableria La Confianza Co., Inc.',
        storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
        contactPhone: '0917-123-4567',
        currency: 'PHP',
        darkMode: false,
        autoPrintReceipts: false,
        lowStockAlert: 10,
        maxStockLimit: 100, // Default Max Stock Limit
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
        'currency'
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
        // Handle side effects (renaming users in logs)
        if (nextSettings.adminDisplayName !== initialSettings?.adminDisplayName) {
            renameUserReferences(initialSettings.adminDisplayName, nextSettings.adminDisplayName);
        }

        updateSettings(nextSettings);

        if (log) {
            logActivity(currentUserName, 'Updated Settings', 'Changed system configuration');
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

    const handleSave = () => {
        persistSettings(settings, { notify: true, log: true });
    };

    return (
        <div className="h-[calc(100vh-80px)] flex flex-col gap-2 p-2 md:overflow-hidden overflow-y-auto">
            
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="text-gray-900 dark:text-white shrink-0">
                        <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-sm sm:text-base font-black text-gray-900 dark:text-white leading-tight">System Configuration</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-[11px] sm:text-xs font-medium mt-0.5">Customize application behavior and preferences</p>
                    </div>
                </div>
                {activeTab === 'general' && (
                    <button 
                        onClick={handleSave}
                        disabled={!isGeneralModified}
                        className={`w-full sm:w-auto bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-md transform shrink-0 ${isGeneralModified ? 'hover:opacity-90 hover:-translate-y-0.5 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                        style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                        Save Changes
                    </button>
                )}
            </div>

            {/* Main Content Area - Split View */}
            <div className="flex-1 flex flex-col md:flex-row gap-4 md:overflow-hidden min-h-0">
                
                {/* Sidebar Navigation */}
                <div className="w-full md:w-64 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3 h-auto md:h-full md:overflow-y-auto shrink-0">
                    <p className="px-4 py-2 text-[10px] uppercase font-bold text-gray-400 tracking-wider hidden md:block">Preferences</p>
                    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
                        {['general', 'notifications', 'stock rules', 'backup'].map(tab => (
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
                                {tab === 'backup' && <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>}
                                <span className="capitalize">{tab}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Main View */}
                <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 overflow-y-auto">
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
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 uppercase tracking-wide">Currency</label>
                                        <select 
                                            value={settings.currency}
                                            onChange={(e) => setSettings({...settings, currency: e.target.value})}
                                            className="w-full p-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-normal text-gray-900 dark:text-white focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all"
                                        >
                                            <option value="PHP">Philippine Peso (PHP)</option>
                                            <option value="USD">US Dollar (USD)</option>
                                        </select>
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
                                            <p className="font-bold text-gray-900 dark:text-white text-sm">Desktop Notifications</p>
                                            <p className="text-xs text-gray-500">Receive push alerts for critical updates</p>
                                            
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
