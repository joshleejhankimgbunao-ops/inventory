import React, { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import { getSupplierRestockRecommendations } from '../utils/recommendationLogic';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { ROLES } from '../constants/roles';

const Partners = ({ viewOnly = false }) => {
    const { appSettings: settings, currentUserName, userRole } = useAuth();
    const { processedInventory: inventory, logActivity } = useInventory();
    const isViewOnly = viewOnly || userRole === ROLES.ADMIN;

    const successToastId = useRef(null);
    const [activeTab, setActiveTab] = useState('suppliers');
    const [searchQuery, setSearchQuery] = useState('');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    
    // New State for Menu
    const [openMenuId, setOpenMenuId] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [showArchived, setShowArchived] = useState(false);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [partnerToArchive, setPartnerToArchive] = useState(null);

    // New State for Restock Recommendations
    const [isRecModalOpen, setIsRecModalOpen] = useState(false);
    const [selectedSupplierRecs, setSelectedSupplierRecs] = useState({ supplier: null, items: [] });


    // Mock Data (with LocalStorage persistence)
    const [suppliers, setSuppliers] = useState(() => {
        const saved = localStorage.getItem('suppliers');
        return saved ? JSON.parse(saved) : [
            { id: 1, name: 'Cebu Home Builders', contact: '0917-123-4567', email: 'sales@cebuhome.com', address: 'Mandaue City', products: 'Tiles, Paints' },
            { id: 2, name: 'Atlantic Hardware', contact: '0918-987-6543', email: 'info@atlantic.ph', address: 'Cebu City', products: 'Steel, Cement' },
            { id: 3, name: 'Citi Hardware', contact: '0922-555-4444', email: 'support@citihardware.com', address: 'Talisay City', products: 'General Hardware' },
        ];
    });

    const [customers, setCustomers] = useState(() => {
        const saved = localStorage.getItem('customers');
        return saved ? JSON.parse(saved) : [
            { id: 1, name: 'Engr. Michael Tan', contact: '0917-888-9999', email: 'mike.tan@construct.com', address: 'Banilad, Cebu City', type: 'Contractor' },
            { id: 2, name: 'ABC Construction', contact: '0919-777-6666', email: 'purchasing@abcconst.com', address: 'Lapu-Lapu City', type: 'Construction Firm' },
            { id: 3, name: 'Juan Dela Cruz', contact: '0920-111-2222', email: 'juan.dc@gmail.com', address: 'Minglanilla', type: 'Loyal Customer' },
        ];
    });

    // Persistence Effects
    React.useEffect(() => {
        localStorage.setItem('suppliers', JSON.stringify(suppliers));
    }, [suppliers]);

    React.useEffect(() => {
        localStorage.setItem('customers', JSON.stringify(customers));
    }, [customers]);

    const [newPartner, setNewPartner] = useState({ name: '', contact: '', email: '', address: '', note: '' });

    const filteredData = (activeTab === 'suppliers' ? suppliers : customers).filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.contact.includes(searchQuery) ||
            item.email.toLowerCase().includes(searchQuery.toLowerCase());
        if (showArchived) return item.isArchived && matchesSearch;
        return !item.isArchived && matchesSearch;
    });

    const archivedCount = (activeTab === 'suppliers' ? suppliers : customers).filter(i => i.isArchived).length;

    const handleRestore = (id) => {
        if (isViewOnly) return;
        const restoreItem = (list) => list.map(item => item.id === id ? { ...item, isArchived: false } : item);
        if (activeTab === 'suppliers') {
            const item = suppliers.find(i => i.id === id);
            setSuppliers(restoreItem(suppliers));
            logActivity(currentUserName, 'Restored Partner', `Restored supplier: ${item?.name || 'Unknown'}`);
        } else {
            const item = customers.find(i => i.id === id);
            setCustomers(restoreItem(customers));
            logActivity(currentUserName, 'Restored Partner', `Restored customer: ${item?.name || 'Unknown'}`);
        }
        showToast('Partner Restored', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} has been restored.`, 'success', 'partner-restore');
        setOpenMenuId(null);
        const remaining = (activeTab === 'suppliers' ? suppliers : customers).filter(i => i.id !== id && i.isArchived).length;
        if (remaining === 0) setShowArchived(false);
    };

    const handleAddPartner = (e) => {
        if (isViewOnly) return;
        e.preventDefault();
        // Validate contact length if present
        const contactDigits = (newPartner.contact || '').toString().replace(/\D/g, '');
        if (contactDigits && contactDigits.length !== 11) {
            showToast('Invalid Contact', 'Contact number must be exactly 11 digits.', 'error', 'partner-validation');
            return;
        }
        
        if (isEditMode) {
             const updatedItem = {
                ...newPartner,
                [activeTab === 'suppliers' ? 'products' : 'type']: newPartner.note || (activeTab === 'suppliers' ? 'General' : 'Regular')
            };

            if (activeTab === 'suppliers') {
                setSuppliers(suppliers.map(item => item.id === editingId ? { ...item, ...updatedItem } : item));
            } else {
                setCustomers(customers.map(item => item.id === editingId ? { ...item, ...updatedItem } : item));
            }
            logActivity(currentUserName, 'Updated Partner', `Updated ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${newPartner.name}`);
            showToast('Partner Updated', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} details updated successfully.`, 'success', 'partner-save');
        } else {
            const newItem = {
                id: Date.now(),
                ...newPartner,
                isArchived: false,
                [activeTab === 'suppliers' ? 'products' : 'type']: newPartner.note || (activeTab === 'suppliers' ? 'General' : 'Regular')
            };

            if (activeTab === 'suppliers') {
                setSuppliers([...suppliers, newItem]);
            } else {
                setCustomers([...customers, newItem]);
            }
            logActivity(currentUserName, 'Added Partner', `Added new ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${newPartner.name}`);
            showToast('New Partner Added', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} has been added to the directory.`, 'success', 'partner-save');
        }
        
        setIsAddModalOpen(false);
        setNewPartner({ name: '', contact: '', email: '', address: '', note: '' });
        setIsEditMode(false);
        setEditingId(null);
    };

    const handleEdit = (item) => {
        if (isViewOnly) return;
        setNewPartner({
            name: item.name,
            contact: item.contact,
            email: item.email,
            address: item.address,
            note: activeTab === 'suppliers' ? item.products : item.type
        });
        setIsEditMode(true);
        setEditingId(item.id);
        setIsAddModalOpen(true);
        setOpenMenuId(null);
    };

    const handleArchive = (id) => {
        if (isViewOnly) return;
        const item = (activeTab === 'suppliers' ? suppliers : customers).find(i => i.id === id);
        setPartnerToArchive(item);
        setIsArchiveModalOpen(true);
        setOpenMenuId(null);
    };

    const confirmArchive = () => {
        if (isViewOnly) return;
        if (!partnerToArchive) return;
        const archiveItem = (list) => list.map(item => item.id === partnerToArchive.id ? { ...item, isArchived: true } : item);

        if (activeTab === 'suppliers') {
            setSuppliers(archiveItem(suppliers));
        } else {
            setCustomers(archiveItem(customers));
        }
        logActivity(currentUserName, 'Archived Partner', `Archived ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${partnerToArchive.name}`);
        showToast('Partner Archived', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} has been archived.`, 'success', 'partner-archive');
        setIsArchiveModalOpen(false);
        setPartnerToArchive(null);
    };

    const handleOpenRecommendations = (supplier) => {
        const recs = getSupplierRestockRecommendations(supplier, inventory, settings); // Pass settings here
        if (recs.length === 0) {
            // Dismiss previous notification to restart timer/animation (Like POS Error)
            if (successToastId.current) {
                toast.dismiss(successToastId.current);
            }

            const newId = toast.success(
                <div className="flex flex-col">
                    <span className="font-extrabold text-base text-white">Optimal Status</span>
                    <span className="text-xs font-medium text-gray-300">Optimal inventory levels maintained. No restocking required.</span>
                </div>, 
                { 
                    icon: (
                        <div className="bg-green-900/40 p-3 rounded-2xl border border-green-800 shadow-sm flex items-center justify-center">
                           <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                    ),
                    style: {
                        borderRadius: '16px',
                        padding: '12px',
                        background: '#333333',
                        color: '#fff',
                        border: '1px solid #4B5563',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                    }
                }
            );
            successToastId.current = newId;
            return;
        }
        setSelectedSupplierRecs({ supplier, items: recs });
        setIsRecModalOpen(true);
    };

    // Click outside to close menu
    React.useEffect(() => {
        const handleClickOutside = (event) => {
            if (openMenuId && !event.target.closest('.partner-menu-trigger') && !event.target.closest('.partner-menu-dropdown')) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openMenuId]);

    return (
        <div className="h-[calc(100vh-80px)] flex flex-col p-2 gap-2">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col h-full relative border-t-8 border-t-[#111827]">
                <div className="p-5 pb-0 shrink-0">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
                        <div className="flex items-center gap-3">
                            <div className="bg-gray-900 p-2.5 rounded-xl">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                            </div>
                            <div>
                                <h1 className="text-[8px] font-black text-gray-900 dark:text-white leading-tight
                                ">Partners & Directory</h1>
                                <p className="text-gray-500 text-xs font-medium mt-0.5">
                                    {isViewOnly ? 'View suppliers and regular customers (read-only)' : 'Manage your suppliers and regular customers'}
                                </p>
                            </div>
                        </div>
                        {!isViewOnly && (
                            <button 
                                onClick={() => {
                                    setIsEditMode(false);
                                    setIsAddModalOpen(true);
                                    setNewPartner({ name: '', contact: '', email: '', address: '', note: '' });
                                }}
                                className="w-full sm:w-auto px-4 py-2 rounded-lg text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 transition-all hover:opacity-90 transform hover:-translate-y-0.5 whitespace-nowrap"
                                style={{ backgroundColor: '#111827' }}
                            >
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                Add {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}
                            </button>
                        )}
                    </div>

                    {isViewOnly && (
                        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                            Admin mode: Viewing only. Add, edit, restore, and archive actions are disabled.
                        </div>
                    )}

                    {/* Tabs & Search */}
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                        <div className="flex bg-gray-100 p-1 rounded-lg w-full sm:w-auto">
                            <button 
                                onClick={() => setActiveTab('suppliers')}
                                className={`flex-1 sm:flex-none px-6 py-2 rounded-md text-sm font-bold transition-all ${
                                    activeTab === 'suppliers' 
                                        ? 'text-white shadow-sm' 
                                        : 'text-gray-500 hover:text-gray-900'
                                }`}
                                style={activeTab === 'suppliers' ? { backgroundColor: '#111827', color: '#ffffff' } : {}}
                            >
                                Suppliers
                            </button>
                            <button 
                                onClick={() => setActiveTab('customers')}
                                className={`flex-1 sm:flex-none px-6 py-2 rounded-md text-sm font-bold transition-all ${
                                    activeTab === 'customers' 
                                        ? 'text-white shadow-sm' 
                                        : 'text-gray-500 hover:text-gray-900'
                                }`}
                                style={activeTab === 'customers' ? { backgroundColor: '#111827', color: '#ffffff' } : {}}
                            >
                                Regular Customers
                            </button>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            {!isViewOnly && (
                                <button
                                    onClick={() => setShowArchived(!showArchived)}
                                    className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border ${
                                        showArchived 
                                            ? 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100' 
                                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100 hover:text-gray-700'
                                    }`}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                    {showArchived ? 'Back to Records' : `View Archive${archivedCount > 0 ? ` (${archivedCount})` : ''}`}
                                </button>
                            )}
                            <div className="relative flex-1 sm:w-56 group">
                                <input 
                                    type="text" 
                                    placeholder="Search directory..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-3 py-2 bg-gray-50 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 rounded-xl text-sm focus:bg-white dark:focus:bg-gray-600 focus:border-gray-900 dark:focus:border-gray-400 focus:ring-0 transition-all shadow-sm placeholder:text-gray-400 font-bold text-gray-800 dark:text-gray-200"
                                />
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1 bg-white dark:bg-gray-600 rounded-lg shadow-sm border border-gray-100 dark:border-gray-500 group-focus-within:border-gray-900 group-focus-within:bg-gray-900 dark:group-focus-within:border-gray-400 dark:group-focus-within:bg-gray-400 transition-all duration-300">
                                    <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                    <div className="flex-1 overflow-y-auto px-5 pb-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredData.map(item => (
                                <div key={item.id} className={`border text-left rounded-xl p-4 transition-shadow group relative overflow-hidden ${
                                    item.isArchived 
                                        ? 'bg-orange-50/50 border-orange-200 opacity-75' 
                                        : 'bg-white border-gray-100 hover:shadow-md'
                                }`}>
                                     <div className={`absolute top-0 left-0 right-0 h-1.5 ${item.isArchived ? 'bg-orange-400' : 'bg-[#111827]'}`}></div>
                                     {item.isArchived && (
                                        <div className="absolute top-3 left-4 z-10">
                                            <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 text-[10px] font-black uppercase tracking-wider">Archived</span>
                                        </div>
                                     )}
                                    
                                    {!isViewOnly && (
                                        <div className="absolute top-4 right-4 z-10">
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenMenuId(openMenuId === item.id ? null : item.id);
                                                }}
                                                className="partner-menu-trigger text-gray-300 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-all"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
                                            </button>
                                            
                                            {openMenuId === item.id && (
                                                <div className="partner-menu-dropdown absolute right-0 mt-1 w-32 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-20 animate-in fade-in zoom-in-95">
                                                    {item.isArchived ? (
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRestore(item.id);
                                                            }}
                                                            className="w-full text-left px-4 py-2 text-xs font-bold text-teal-600 hover:bg-teal-50 flex items-center gap-2"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                            Restore
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(item);
                                                                }}
                                                                className="w-full text-left px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                                            >
                                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                                                Edit
                                                            </button>
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleArchive(item.id);
                                                                }}
                                                                className="w-full text-left px-4 py-2 text-xs font-bold text-orange-600 hover:bg-orange-50 flex items-center gap-2"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                                                Archive
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0 bg-blue-100 text-blue-600">
                                            {item.name.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-gray-900 line-clamp-1">{item.name}</h3>
                                            <p className="text-xs text-gray-500 font-medium mb-2">{activeTab === 'suppliers' ? item.products : item.type}</p>
                                            
                                            <div className="flex flex-col gap-1.5 mt-3">
                                                <div className="flex items-center gap-2 text-xs text-gray-600">
                                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                                                    {item.contact}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-600">
                                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                                                    <a href={`mailto:${item.email}`} className="hover:text-gray-900 transition-colors">{item.email}</a>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-600">
                                                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                                    {item.address}
                                                </div>
                                            </div>
                                            
                                            {/* Smart Recommendations Button */}
                                            {activeTab === 'suppliers' && (
                                                <button 
                                                    onClick={() => handleOpenRecommendations(item)}
                                                    className="mt-4 w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2 rounded-lg text-xs transition-colors border border-indigo-100 flex items-center justify-center gap-2"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                                    View Restock Plan
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {showArchived && filteredData.length === 0 && (
                                <div className="col-span-1 md:col-span-2 lg:col-span-3 border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center text-center bg-gray-50/60">
                                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                    </div>
                                    <p className="text-sm font-black text-gray-800">No archive records</p>
                                    <p className="text-xs font-medium text-gray-500 mt-1">Archived records will appear here once you archive a supplier or customer.</p>
                                </div>
                            )}
                            {!isViewOnly && !showArchived && (
                                <button 
                                    onClick={() => {
                                        setIsEditMode(false);
                                        setNewPartner({ name: '', contact: '', email: '', address: '', note: '' });
                                        setIsAddModalOpen(true);
                                    }}
                                    className="border-2 border-dashed border-gray-200 rounded-xl p-4 flex flex-col items-center justify-center text-gray-400 hover:border-gray-900 hover:text-gray-900 transition-all min-h-[160px] group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-gray-50 group-hover:bg-gray-900 flex items-center justify-center transition-colors mb-2">
                                        <svg className="w-6 h-6 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                    </div>
                                    <span className="text-sm font-bold">Add New {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}</span>
                                </button>
                            )}
                        </div>
                    </div>

                {/* Add Modal */}
                {!isViewOnly && isAddModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-xl p-4 w-full max-w-sm md:max-w-md shadow-2xl border border-gray-100 ring-1 ring-black/5">
                            <div className="flex justify-between items-start mb-3 border-b-2 border-gray-200 pb-3">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-xl">
                                        {activeTab === 'suppliers' ? (
                                            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                                        ) : (
                                            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                        )}
                                    </div>
                                    <div>
                                        <h2 className="text-sm font-bold text-gray-900">{isEditMode ? 'Edit' : 'Add New'} {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}</h2>
                                        <p className="text-[10px] text-gray-500 mt-0.5">{isEditMode ? 'Update partner details.' : 'Register a new partner to the directory.'}</p>
                                    </div>
                                </div>
                                <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-50 rounded-lg transition-colors">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                            <form onSubmit={handleAddPartner} className="space-y-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Name / Company</label>
                                    <input 
                                        required 
                                        minLength="2"
                                        type="text" 
                                        title="Please enter a valid name (at least 2 characters)"
                                        placeholder={activeTab === 'suppliers' ? "e.g. ABC Hardware Inc." : "e.g. John A. Doe"}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                        value={newPartner.name}
                                        onChange={e => setNewPartner({...newPartner, name: e.target.value})}
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Contact No.</label>
                                        <input 
                                            required 
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="09171234567"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                            value={newPartner.contact}
                                            onChange={e => {
                                                // Allow only digits and limit to 11
                                                const digits = e.target.value.replace(/\D/g, '');
                                                if (digits.length <= 11) setNewPartner({...newPartner, contact: digits});
                                            }}
                                        />
                                        {newPartner.contact && newPartner.contact.length !== 11 && (
                                            <p className="text-rose-500 text-[11px] mt-1">Contact number must be exactly 11 digits.</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Email</label>
                                        <input 
                                            type="email" 
                                            placeholder="e.g. email@example.com"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                            value={newPartner.email}
                                            onChange={e => setNewPartner({...newPartner, email: e.target.value})}
                                            required
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Address</label>
                                    <input 
                                        required
                                        minLength="5"
                                        type="text" 
                                        placeholder="e.g. Mandaue City, Cebu"
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                        value={newPartner.address}
                                        onChange={e => setNewPartner({...newPartner, address: e.target.value})}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">{activeTab === 'suppliers' ? 'Products Supplied' : 'Customer Type'}</label>
                                    {activeTab === 'suppliers' ? (
                                        <>
                                            <input 
                                                required
                                                list="product-suggestions"
                                                type="text" 
                                                placeholder="e.g. Lumber, Cement, Paints"
                                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                                value={newPartner.note}
                                                onChange={e => setNewPartner({...newPartner, note: e.target.value})}
                                            />
                                            <datalist id="product-suggestions">
                                                {/* Common Categories */}
                                                <option value="Lumbers & Boards" />
                                                <option value="Cement" />
                                                <option value="Paints" />
                                                <option value="Steel" />
                                                <option value="Tiles" />
                                                <option value="Hardware" />
                                                <option value="Electrical" />
                                                <option value="Plumbing" />
                                                {/* Dynamic Categories from Inventory */}
                                                {[...new Set(inventory.map(i => i.category))].filter(Boolean).map(cat => (
                                                    <option key={cat} value={cat} />
                                                ))}
                                            </datalist>
                                        </>
                                    ) : (
                                        <input 
                                            required
                                            type="text" 
                                            placeholder="e.g. Contractor, Retail"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                            value={newPartner.note}
                                            onChange={e => setNewPartner({...newPartner, note: e.target.value})}
                                        />
                                    )}
                                </div>
                                <div className="pt-1">
                                    <button 
                                        type="submit" 
                                        className="w-full py-2 rounded-lg font-bold uppercase tracking-widest hover:opacity-90 transition-all duration-300 shadow-md transform hover:-translate-y-0.5 text-xs text-center"
                                        style={{ backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' }}
                                    >
                                        Save {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>

            {/* Smart Restock Recommendation Modal - OUTSIDE the relative container but inside the main flex col */}
            {isRecModalOpen && selectedSupplierRecs.supplier && (
                <div className="fixed inset-0 flex items-center justify-center z-50 transition-opacity duration-300" style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
                        <div className="bg-white rounded-2xl p-0 w-full max-w-lg md:max-w-xl shadow-2xl border border-gray-100 ring-1 ring-black/5 overflow-hidden flex flex-col max-h-[80vh]">
                            {/* Modal Header */}
                            <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="bg-indigo-100 p-1.5 rounded-lg">
                                            <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                        </div>
                                        <h2 className="text-xl font-black text-gray-900">Restock Recommendations</h2>
                                    </div>
                                    <p className="text-sm text-gray-500 font-medium ml-1">
                                        Suggested order for <span className="text-gray-900 font-bold">{selectedSupplierRecs.supplier.name}</span>
                                    </p>
                                </div>
                                <button onClick={() => setIsRecModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-200 rounded-full transition-colors">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>

                            {/* Modal Content - List */}
                            <div className="overflow-y-auto p-6 bg-white">
                                <div className="rounded-xl border border-gray-100 overflow-hidden">
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse min-w-[500px]">
                                        <thead>
                                            <tr className="bg-gray-900 text-xs uppercase tracking-wider text-white font-bold border-b border-gray-700">
                                                <th className="px-4 py-3 border border-gray-700">Item Details</th>
                                                <th className="px-4 py-3 text-center border border-gray-700">Current Stock</th>
                                                <th className="px-4 py-3 text-center border border-gray-700">Reorder Qty</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {selectedSupplierRecs.items.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-gray-50 transition-colors group">
                                                    <td className="px-4 py-3 border border-gray-200">
                                                        <p className="font-bold text-gray-900 text-sm">{item.name}</p>
                                                        <p className="text-[10px] text-gray-500 font-mono">{item.code} • {item.size}</p>
                                                    </td>
                                                    <td className="px-4 py-3 text-center border border-gray-200">
                                                        <span className={`px-2 py-1 rounded-md text-xs font-bold ${
                                                            item.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                                                        }`}>
                                                            {item.stock} Qty
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center border border-gray-200">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <span className="text-lg font-black text-indigo-600">+{item.recommendedOrder}</span>
                                                            <span className="text-xs text-gray-400 font-medium">to reach target</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                  </div>
                                </div>
                                <p className="text-xs text-center text-gray-400 mt-4 italic">
                                    * Recommendations based on maintaining healthy stock buffer (Target: 100 units).
                                </p>
                            </div>

                            {/* Footer */}
                            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                                <button 
                                    onClick={() => {
                                        setIsRecModalOpen(false);
                                    }}
                                    className="px-5 py-2.5 rounded-xl font-bold transition-all shadow-md transform hover:-translate-y-0.5 text-xs text-white"
                                    style={{ backgroundColor: '#111827' }}
                                >
                                    Close
                                </button>
                                {/* Removed Create Order Simulation */}
                            </div>
                        </div>
                    </div>
                )}

                {/* Archive Confirmation Modal */}
                {!isViewOnly && isArchiveModalOpen && partnerToArchive && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-6 text-center">
                                <div className="mx-auto flex items-center justify-center mb-4 text-red-600">
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                </div>
                                <h3 className="text-xl font-black text-gray-900 mb-2">
                                    Archive {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}?
                                </h3>
                                <p className="text-gray-500 text-sm mb-6">
                                    Are you sure you want to archive <span className="font-bold text-gray-900">{partnerToArchive.name}</span>?
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setIsArchiveModalOpen(false); setPartnerToArchive(null); }}
                                        className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors"
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

export default Partners;