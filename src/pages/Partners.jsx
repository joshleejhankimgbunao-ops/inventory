import React, { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { showToast } from '../utils/toastHelper';
import TableSkeletonRows from '../components/TableSkeletonRows';
import { showPageLoadError } from '../utils/pageLoadError';
import { getSupplierRestockRecommendations } from '../utils/recommendationLogic';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { ROLES } from '../constants/roles';
import {
    listPartnersApi,
    createPartnerApi,
    updatePartnerApi,
    archivePartnerApi,
    restorePartnerApi,
} from '../services/inventoryApi';
import { getAuthToken } from '../services/apiClient';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import Pagination from '../components/Pagination';
import ArchiveIcon from '../components/ArchiveIcon';
import EditIcon from '../components/EditIcon';
import TableActionButton from '../components/TableActionButton';
import { createClientRequestId } from '../utils/clientRequestId';
import { normalizeHumanReadable } from '../utils/textNormalization';

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseLegacySupplierNoteToCapabilities = (noteValue) => {
    const note = String(noteValue || '').trim();
    if (!note) return [];

    const chunks = note
        .split(/[\n,;]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);

    const normalized = chunks
        .map((chunk) => {
            const parenthesisMatch = chunk.match(/^(.+?)\s*\((.+)\)$/);
            if (parenthesisMatch) {
                return {
                    category: String(parenthesisMatch[1] || '').trim(),
                    brand: String(parenthesisMatch[2] || '').trim(),
                };
            }

            const bulletParts = chunk.split(/\s*[•:-]\s*/).map((part) => String(part || '').trim()).filter(Boolean);
            if (bulletParts.length >= 2) {
                return {
                    category: bulletParts[0],
                    brand: bulletParts.slice(1).join(' '),
                };
            }

            return {
                category: chunk,
                brand: '',
            };
        })
        .filter((entry) => entry.category && !['general', 'regular', 'n/a'].includes(entry.category.toLowerCase()));

    const seen = new Set();
    return normalized.filter((entry) => {
        const key = `${entry.category.toLowerCase()}::${entry.brand.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const Partners = ({ viewOnly = false }) => {
    const { appSettings: settings, currentUserName, userRole } = useAuth();
    const { processedInventory: inventory, logActivity } = useInventory();
    const isViewOnly = viewOnly || userRole === ROLES.ADMIN;

    const successToastId = useRef(null);
    const [activeTab, setActiveTab] = useState('suppliers');
    const showActionsColumn = !isViewOnly || activeTab === 'suppliers';
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingUpdatedAt, setEditingUpdatedAt] = useState(null);
    const [showArchived, setShowArchived] = useState(false);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [partnerToArchive, setPartnerToArchive] = useState(null);
    const [isLoadingPartners, setIsLoadingPartners] = useState(false);
    const [isSavingPartner, setIsSavingPartner] = useState(false);
    const partnerSubmitInFlightRef = useRef(false);
    const partnerCreateRequestIdRef = useRef('');

    // New State for Restock Recommendations
    const [isRecModalOpen, setIsRecModalOpen] = useState(false);
    const [selectedSupplierRecs, setSelectedSupplierRecs] = useState({ supplier: null, items: [] });

    const [suppliers, setSuppliers] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [capabilityDraft, setCapabilityDraft] = useState({ category: '', brand: '' });

    const syncSupplierNoteFromCapabilities = React.useCallback((capabilities) => {
        const categories = [...new Set((Array.isArray(capabilities) ? capabilities : [])
            .map((entry) => String(entry?.category || '').trim())
            .filter(Boolean))];
        return categories.length > 0 ? categories.join(', ') : 'General';
    }, []);

    const mapPartnerToUi = React.useCallback((partner) => {
        const base = {
            id: String(partner?._id || partner?.id || ''),
            name: partner?.name || '',
            contact: partner?.contact || '',
            email: partner?.email || '',
            address: partner?.address || '',
            isArchived: Boolean(partner?.isArchived),
            updatedAt: partner?.updatedAt || null,
        };

        if ((partner?.type || '').toLowerCase() === 'supplier') {
            const capabilities = (Array.isArray(partner?.supplierCapabilities) ? partner.supplierCapabilities : [])
                .map((entry) => ({
                    category: String(entry?.category || '').trim(),
                    brand: String(entry?.brand || '').trim(),
                }))
                .filter((entry) => entry.category);

            const noteText = String(partner?.note || '').trim();
            const legacyCapabilities = capabilities.length === 0 ? parseLegacySupplierNoteToCapabilities(noteText) : [];
            const effectiveCapabilities = capabilities.length > 0 ? capabilities : legacyCapabilities;

            const displayProducts = effectiveCapabilities.length > 0
                ? syncSupplierNoteFromCapabilities(effectiveCapabilities)
                : (noteText || 'General');

            return { ...base, products: displayProducts, supplierCapabilities: effectiveCapabilities };
        }

        return {
            ...base,
            type: partner?.note || 'Regular',
        };
    }, [syncSupplierNoteFromCapabilities]);

    const loadPartners = React.useCallback(async () => {
        setIsLoadingPartners(true);
        try {
            let [supplierRows, customerRows] = await Promise.all([
                listPartnersApi({ type: 'supplier', includeArchived: true }),
                listPartnersApi({ type: 'customer', includeArchived: true }),
            ]);

            if (!isViewOnly) {
                const suppliersToMigrate = (supplierRows || []).filter((partner) => {
                    const currentCapabilities = Array.isArray(partner?.supplierCapabilities) ? partner.supplierCapabilities : [];
                    if (currentCapabilities.length > 0) return false;
                    return parseLegacySupplierNoteToCapabilities(partner?.note).length > 0;
                });

                if (suppliersToMigrate.length > 0) {
                    await Promise.allSettled(
                        suppliersToMigrate.map((partner) => {
                            const migratedCapabilities = parseLegacySupplierNoteToCapabilities(partner?.note);
                            const migratedNote = syncSupplierNoteFromCapabilities(migratedCapabilities);
                            const partnerId = String(partner?._id || partner?.id || '').trim();

                            if (!partnerId || migratedCapabilities.length === 0) {
                                return Promise.resolve();
                            }

                            return updatePartnerApi(
                                partnerId,
                                {
                                    supplierCapabilities: migratedCapabilities,
                                    note: migratedNote,
                                    type: 'supplier',
                                },
                                { expectedUpdatedAt: partner?.updatedAt || null }
                            );
                        })
                    );

                    supplierRows = await listPartnersApi({ type: 'supplier', includeArchived: true });
                }
            }

            setSuppliers((supplierRows || []).map(mapPartnerToUi));
            setCustomers((customerRows || []).map(mapPartnerToUi));
        } catch (error) {
            showPageLoadError(showToast, error, 'partner-load');
        } finally {
            setIsLoadingPartners(false);
        }
    }, [isViewOnly, mapPartnerToUi, syncSupplierNoteFromCapabilities]);

    React.useEffect(() => {
        loadPartners();
    }, [loadPartners]);

    React.useEffect(() => {
        const token = getAuthToken();
        if (!token) {
            return undefined;
        }

        const unsubscribe = subscribeRealtimeEvent('partners.updated', () => {
            void loadPartners();
        });

        return () => {
            unsubscribe();
        };
    }, [loadPartners]);

    const [newPartner, setNewPartner] = useState({ name: '', contact: '', email: '', address: '', note: '', supplierCapabilities: [] });

    const supplierCategoryOptions = React.useMemo(
        () => [...new Set(inventory.map((item) => String(item?.category || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b)),
        [inventory]
    );

    const supplierBrandOptions = React.useMemo(() => {
        const selectedCategory = String(capabilityDraft.category || '').trim().toLowerCase();
        const rows = (inventory || []).filter((item) => {
            if (!selectedCategory) return true;
            return String(item?.category || '').trim().toLowerCase() === selectedCategory;
        });

        return [...new Set(rows.map((item) => String(item?.brand || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }, [capabilityDraft.category, inventory]);

    React.useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchQuery]);

    const filteredDataBase = (activeTab === 'suppliers' ? suppliers : customers).filter(item => {
        const query = debouncedSearchQuery.toLowerCase();
        const matchesSearch = !query
            || item.name.toLowerCase().includes(query)
            || item.contact.includes(debouncedSearchQuery)
            || item.email.toLowerCase().includes(query);
        if (showArchived) return item.isArchived && matchesSearch;
        return !item.isArchived && matchesSearch;
    });

    const filteredData = filteredDataBase;
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const activePage = Math.min(currentPage, Math.max(totalPages, 1));
    const indexOfFirstPartner = (activePage - 1) * itemsPerPage;
    const paginatedData = filteredData.slice(indexOfFirstPartner, indexOfFirstPartner + itemsPerPage);
    const displayStart = filteredData.length === 0 ? 0 : indexOfFirstPartner + 1;
    const displayEnd = Math.min(indexOfFirstPartner + itemsPerPage, filteredData.length);
    React.useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, debouncedSearchQuery, showArchived]);

    React.useEffect(() => {
        setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
    }, [totalPages]);

    const directorySearchSuggestions = React.useMemo(() => {
        const sourceRows = activeTab === 'suppliers' ? suppliers : customers;
        const terms = new Set();

        sourceRows.forEach((item) => {
            [item?.name, item?.contact, item?.email]
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
    }, [activeTab, suppliers, customers]);

    const archivedCount = (activeTab === 'suppliers' ? suppliers : customers).filter(i => i.isArchived).length;

    const addSupplierCapability = () => {
        const category = String(capabilityDraft.category || '').trim();
        const brand = String(capabilityDraft.brand || '').trim();
        if (!category) return;

        setNewPartner((prev) => {
            const current = Array.isArray(prev.supplierCapabilities) ? prev.supplierCapabilities : [];
            const key = `${category.toLowerCase()}::${brand.toLowerCase()}`;
            const exists = current.some((entry) => (`${String(entry?.category || '').trim().toLowerCase()}::${String(entry?.brand || '').trim().toLowerCase()}`) === key);
            if (exists) return prev;

            const supplierCapabilities = [...current, { category, brand }];
            return {
                ...prev,
                supplierCapabilities,
                note: syncSupplierNoteFromCapabilities(supplierCapabilities),
            };
        });

        setCapabilityDraft({ category: '', brand: '' });
    };

    const removeSupplierCapability = (indexToRemove) => {
        setNewPartner((prev) => {
            const current = Array.isArray(prev.supplierCapabilities) ? prev.supplierCapabilities : [];
            const supplierCapabilities = current.filter((_, index) => index !== indexToRemove);
            return {
                ...prev,
                supplierCapabilities,
                note: syncSupplierNoteFromCapabilities(supplierCapabilities),
            };
        });
    };

    const handleRestore = async (id) => {
        if (isViewOnly) return;
        try {
            await restorePartnerApi(id);
            await loadPartners();
            showToast('Partner Restored', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} has been restored.`, 'success', 'partner-restore');

            const source = activeTab === 'suppliers' ? suppliers : customers;
            const item = source.find((entry) => entry.id === id);
            logActivity(currentUserName, 'Restored Partner', `Restored ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${item?.name || 'Unknown'}`);
        } catch (error) {
            showToast('Restore Failed', error.message || 'Unable to restore partner.', 'error', 'partner-restore');
        }
    };

    const handleAddPartner = async (e) => {
        if (isViewOnly) return;
        e.preventDefault();
        if (partnerSubmitInFlightRef.current) return;
        const normalizedEmail = (newPartner.email || '').trim().toLowerCase();

        if (!EMAIL_RULE.test(normalizedEmail)) {
            showToast('Invalid Email', 'Please enter a complete valid email address (e.g. name@example.com).', 'error', 'partner-validation');
            return;
        }

        // Validate contact length if present
        const contactDigits = (newPartner.contact || '').toString().replace(/\D/g, '');
        if (contactDigits && contactDigits.length !== 11) {
            showToast('Invalid Contact', 'Contact number must be exactly 11 digits.', 'error', 'partner-validation');
            return;
        }

        if (activeTab === 'suppliers') {
            const capabilities = Array.isArray(newPartner.supplierCapabilities) ? newPartner.supplierCapabilities : [];
            if (capabilities.length === 0) {
                showToast('Missing Fields', 'Add at least one supply capability.', 'error', 'partner-validation');
                return;
            }
        }
        
        const payload = {
            type: activeTab === 'suppliers' ? 'supplier' : 'customer',
            name: normalizeHumanReadable(newPartner.name),
            contact: newPartner.contact,
            email: normalizedEmail,
            address: normalizeHumanReadable(newPartner.address),
            note: newPartner.note || (activeTab === 'suppliers' ? 'General' : 'Regular'),
            supplierCapabilities: activeTab === 'suppliers'
                ? (Array.isArray(newPartner.supplierCapabilities) ? newPartner.supplierCapabilities : [])
                : [],
            ...(!isEditMode ? {
                clientRequestId: partnerCreateRequestIdRef.current || (partnerCreateRequestIdRef.current = createClientRequestId('partner')),
            } : {}),
        };

        partnerSubmitInFlightRef.current = true;
        setIsSavingPartner(true);
        try {
            if (isEditMode && editingId) {
                await updatePartnerApi(editingId, payload, { expectedUpdatedAt: editingUpdatedAt });
                logActivity(currentUserName, 'Updated Partner', `Updated ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${newPartner.name}`);
                showToast('Partner Updated', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} details updated successfully.`, 'success', 'partner-save');
            } else {
                await createPartnerApi(payload);
                logActivity(currentUserName, 'Added Partner', `Added new ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${newPartner.name}`);
                showToast('New Partner Added', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} has been added to the directory.`, 'success', 'partner-save');
            }

            await loadPartners();
            setIsAddModalOpen(false);
            setNewPartner({ name: '', contact: '', email: '', address: '', note: '', supplierCapabilities: [] });
            setCapabilityDraft({ category: '', brand: '' });
            setIsEditMode(false);
            setEditingId(null);
            partnerCreateRequestIdRef.current = '';
        } catch (error) {
            if (Number(error?.status || 0) === 409) {
                await loadPartners();
                showToast('Conflict Detected', 'This partner was edited in another session. Data was refreshed.', 'warning', 'partner-conflict');
                setIsAddModalOpen(false);
                setIsEditMode(false);
                setEditingId(null);
                setEditingUpdatedAt(null);
                return;
            }
            showToast('Save Failed', error.message || 'Unable to save partner.', 'error', 'partner-save');
        } finally {
            partnerSubmitInFlightRef.current = false;
            setIsSavingPartner(false);
        }
    };

    const handleEdit = (item) => {
        if (isViewOnly) return;

        const existingCapabilities = activeTab === 'suppliers' && Array.isArray(item?.supplierCapabilities)
            ? item.supplierCapabilities.map((entry) => ({
                category: String(entry?.category || '').trim(),
                brand: String(entry?.brand || '').trim(),
            })).filter((entry) => entry.category)
            : [];

        setCapabilityDraft({
            category: existingCapabilities[0]?.category || '',
            brand: '',
        });

        setNewPartner({
            name: item.name,
            contact: item.contact,
            email: item.email,
            address: item.address,
            note: activeTab === 'suppliers' ? item.products : item.type,
            supplierCapabilities: existingCapabilities,
        });
        setIsEditMode(true);
        setEditingId(item.id);
        setEditingUpdatedAt(item.updatedAt || null);
        partnerCreateRequestIdRef.current = '';
        setIsAddModalOpen(true);
    };

    const handleArchive = (id) => {
        if (isViewOnly) return;
        const item = (activeTab === 'suppliers' ? suppliers : customers).find(i => i.id === id);
        setPartnerToArchive(item);
        setIsArchiveModalOpen(true);
    };

    const confirmArchive = async () => {
        if (isViewOnly) return;
        if (!partnerToArchive) return;
        try {
            await archivePartnerApi(partnerToArchive.id);
            await loadPartners();
            logActivity(currentUserName, 'Archived Partner', `Archived ${activeTab === 'suppliers' ? 'supplier' : 'customer'}: ${partnerToArchive.name}`);
            showToast('Partner Archived', `${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} has been archived.`, 'success', 'partner-archive');
        } catch (error) {
            showToast('Archive Failed', error.message || 'Unable to archive partner.', 'error', 'partner-archive');
        }
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
                    <span className="font-semibold text-base text-white">Optimal Status</span>
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

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2">
            <div className="bg-slate-200/50 rounded-2xl border border-slate-300 shadow-inner flex flex-col h-auto md:h-full relative">
                <div className="p-5 pb-0 shrink-0">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
                        <div>
                            <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Partners & Directory</p>
                            <p className="text-gray-500 font-medium text-[11px] md:text-xs mt-0.5">
                                {isViewOnly ? 'View suppliers and regular customers (read-only)' : 'Manage your suppliers and regular customers'}
                            </p>
                        </div>
                        {!isViewOnly && (
                            <button 
                                onClick={() => {
                                    setIsEditMode(false);
                                    partnerCreateRequestIdRef.current = '';
                                    setIsAddModalOpen(true);
                                    setCapabilityDraft({ category: '', brand: '' });
                                    setNewPartner({ name: '', contact: '', email: '', address: '', note: '', supplierCapabilities: [] });
                                }}
                                className="w-full sm:w-auto px-4 py-2 rounded-lg text-white font-semibold text-xs shadow-md flex items-center justify-center gap-2 transition-all hover:opacity-90 transform hover:-translate-y-0.5 whitespace-nowrap"
                                style={{ backgroundColor: '#111827' }}
                            >
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                Add {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}
                            </button>
                        )}
                    </div>

                    {/* Tabs & Search */}
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                        <div className="inline-flex rounded-lg bg-gray-100 p-1 w-full sm:w-auto">
                            <button 
                                onClick={() => setActiveTab('suppliers')}
                                className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-xs font-semibold transition-all ${
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
                                className={`flex-1 sm:flex-none px-4 py-2 rounded-md text-xs font-semibold transition-all ${
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
                                    title={showArchived ? `Back to Active ${activeTab === 'suppliers' ? 'Suppliers' : 'Customers'}` : `View Archived ${activeTab === 'suppliers' ? 'Suppliers' : 'Customers'}`}
                                    className={`group/btn shrink-0 px-2.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center transition-all border ${
                                        showArchived 
                                            ? 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100 hover:text-gray-700' 
                                            : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100'
                                    }`}
                                >
                                    {showArchived ? (
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7M3 12h13a5 5 0 010 10h-1"></path></svg>
                                    ) : (
                                        <ArchiveIcon className="w-3.5 h-3.5" />
                                    )}
                                    <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover/btn:ml-2 group-hover/btn:max-w-40 group-hover/btn:opacity-100">
                                        {showArchived
                                            ? `Back to Active ${activeTab === 'suppliers' ? 'Suppliers' : 'Customers'}`
                                            : `View Archived ${activeTab === 'suppliers' ? 'Suppliers' : 'Customers'}${archivedCount > 0 ? ` (${archivedCount})` : ''}`}
                                    </span>
                                </button>
                            )}
                            <div className="main-toolbar-search group">
                                <input 
                                    type="text" 
                                    placeholder="Search directory..." 
                                    value={searchQuery}
                                    list="partners-search-suggestions"
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="main-toolbar-search-input"
                                />
                                <datalist id="partners-search-suggestions">
                                    {directorySearchSuggestions.map((term) => (
                                        <option key={term} value={term} />
                                    ))}
                                </datalist>
                                <div className="main-toolbar-search-icon">
                                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mx-5 mb-5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="min-h-[280px] flex-1 overflow-auto">
                        <table className={`main-data-table w-full table-fixed border-separate border-spacing-0 text-left ${showActionsColumn ? 'min-w-[960px]' : 'min-w-[800px]'}`}>
                            <thead className="sticky top-0 z-10 shadow-sm">
                                <tr className="bg-gray-900 text-white uppercase tracking-wider">
                                    <th className={`${showActionsColumn ? 'w-[18%]' : 'w-[21%]'} border border-gray-700 px-3 py-3 text-center text-[11px] font-semibold`}>{activeTab === 'suppliers' ? 'Supplier' : 'Customer'}</th>
                                    <th className={`${showActionsColumn ? 'w-[18%]' : 'w-[21%]'} border border-gray-700 px-3 py-3 text-center text-[11px] font-semibold`}>{activeTab === 'suppliers' ? 'Category / Product Type' : 'Customer Type'}</th>
                                    <th className={`${showActionsColumn ? 'w-[14%]' : 'w-[16%]'} border border-gray-700 px-3 py-3 text-center text-[11px] font-semibold`}>Contact</th>
                                    <th className={`${showActionsColumn ? 'w-[18%]' : 'w-[21%]'} border border-gray-700 px-3 py-3 text-center text-[11px] font-semibold`}>Email</th>
                                    <th className={`${showActionsColumn ? 'w-[18%]' : 'w-[21%]'} border border-gray-700 px-3 py-3 text-center text-[11px] font-semibold`}>Location</th>
                                    {showActionsColumn && <th className="w-[14%] border border-gray-700 px-3 py-3 text-center text-[11px] font-semibold">Actions</th>}
                                </tr>
                            </thead>
                            <tbody className="text-sm">
                                {isLoadingPartners ? (
                                    <TableSkeletonRows
                                        rowKeyPrefix="partners-skeleton"
                                        columnTypes={[...Array(5).fill('text'), ...(showActionsColumn ? ['actions'] : [])]}
                                    />
                                ) : filteredData.length === 0 ? (
                                    <tr>
                                        <td colSpan={showActionsColumn ? 6 : 5} className="p-8 text-center">
                                            <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-3xl border-2 border-dashed border-gray-300 bg-gray-50/50 p-8 text-gray-500">
                                                <h3 className="mb-1 text-lg font-semibold text-gray-900">
                                                    {isLoadingPartners
                                                        ? `Loading ${activeTab === 'suppliers' ? 'suppliers' : 'customers'}...`
                                                        : showArchived
                                                            ? 'No archive records'
                                                            : searchQuery
                                                                ? `No matching ${activeTab === 'suppliers' ? 'suppliers' : 'customers'}`
                                                                : `No ${activeTab === 'suppliers' ? 'suppliers' : 'customers'} recorded`}
                                                </h3>
                                                <p className="text-sm text-gray-500">
                                                    {isLoadingPartners
                                                        ? 'Fetching partner records from the backend. Please wait a moment.'
                                                        : showArchived
                                                            ? 'Archived records will appear here once a partner is archived.'
                                                            : searchQuery
                                                                ? 'Try a different name, contact number, or email address.'
                                                                : `Use the Add ${activeTab === 'suppliers' ? 'Supplier' : 'Customer'} button to create the first record.`}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedData.map((item) => (
                                        <tr key={item.id} className={`border-b border-gray-200 transition-colors duration-200 ${item.isArchived ? 'bg-orange-50/50 hover:bg-orange-50' : 'hover:bg-gray-50'}`}>
                                            <td className="border border-gray-200 px-3 py-2 text-center">
                                                <div className="flex flex-col items-center leading-tight">
                                                    <span className="max-w-full truncate text-xs font-semibold text-gray-900">{item.name}</span>
                                                    {item.isArchived && <span className="mt-1 rounded border border-orange-200 bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600">Archived</span>}
                                                </div>
                                            </td>
                                            <td className="border border-gray-200 px-3 py-2 text-center text-xs font-medium text-gray-700">{activeTab === 'suppliers' ? item.products : item.type}</td>
                                            <td className="border border-gray-200 px-3 py-2 text-center text-xs font-medium text-gray-700">{item.contact || '-'}</td>
                                            <td className="truncate border border-gray-200 px-3 py-2 text-center text-xs font-medium text-gray-700">
                                                {item.email ? <a href={`mailto:${item.email}`} className="hover:text-gray-900 hover:underline">{item.email}</a> : '-'}
                                            </td>
                                            <td className="border border-gray-200 px-3 py-2 text-center text-xs font-medium text-gray-700">{item.address || '-'}</td>
                                            {showActionsColumn && (
                                            <td className="border border-gray-200 px-2 py-2 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    {activeTab === 'suppliers' && (
                                                        <TableActionButton
                                                            type="button"
                                                            onClick={() => handleOpenRecommendations(item)}
                                                            label="View Restock Plan"
                                                            aria-label={`View restock plan for ${item.name}`}
                                                        >
                                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                                        </TableActionButton>
                                                    )}
                                                    {!isViewOnly && (item.isArchived ? (
                                                        <TableActionButton
                                                            type="button"
                                                            onClick={() => handleRestore(item.id)}
                                                            variant="positive"
                                                            label="Restore"
                                                            aria-label={`Restore ${item.name}`}
                                                        >
                                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                        </TableActionButton>
                                                    ) : (
                                                        <>
                                                            <TableActionButton
                                                                type="button"
                                                                onClick={() => handleEdit(item)}
                                                                label="Edit"
                                                                aria-label={`Edit ${item.name}`}
                                                            >
                                                                <EditIcon />
                                                            </TableActionButton>
                                                            <TableActionButton
                                                                type="button"
                                                                onClick={() => handleArchive(item.id)}
                                                                variant="destructive"
                                                                label="Archive"
                                                                aria-label={`Archive ${item.name}`}
                                                            >
                                                                <ArchiveIcon />
                                                            </TableActionButton>
                                                        </>
                                                    ))}
                                                </div>
                                            </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="shrink-0 border-t border-gray-200 bg-slate-200/95 px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-sm md:px-6 md:py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-medium text-gray-500">
                                Showing <span className="font-semibold text-gray-900">{displayStart}</span> to <span className="font-semibold text-gray-900">{displayEnd}</span> of <span className="font-semibold text-gray-900">{filteredData.length}</span> results
                            </div>
                            <Pagination currentPage={activePage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
                        </div>
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
                                        <h2 className="text-sm font-semibold text-gray-900">{isEditMode ? 'Edit' : 'Add New'} {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}</h2>
                                        <p className="text-[10px] text-gray-500 mt-0.5">{isEditMode ? 'Update partner details.' : 'Register a new partner to the directory.'}</p>
                                    </div>
                                </div>
                                <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={isSavingPartner} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-50 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                            <form onSubmit={handleAddPartner} className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 mb-1">Name / Company</label>
                                    <input 
                                        required 
                                        minLength="2"
                                        type="text" 
                                        title="Please enter a valid name (at least 2 characters)"
                                        placeholder={activeTab === 'suppliers' ? "e.g. ABC Hardware Inc." : "e.g. John A. Doe"}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                        value={newPartner.name}
                                        onChange={e => setNewPartner({...newPartner, name: e.target.value})}
                                        onBlur={e => setNewPartner((prev) => ({ ...prev, name: normalizeHumanReadable(e.target.value) }))}
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-700 mb-1">Contact No.</label>
                                        <input 
                                            required 
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="Enter 11-digit contact number"
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
                                        <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
                                        <input 
                                            type="email" 
                                            placeholder="e.g. partner@example.com"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                            value={newPartner.email}
                                            onChange={e => setNewPartner({...newPartner, email: e.target.value})}
                                            required
                                        />
                                        <p className="text-[10px] text-gray-400 mt-1">Use a complete valid email address (e.g. name@example.com).</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 mb-1">Address</label>
                                    <input 
                                        required
                                        minLength="5"
                                        type="text" 
                                        placeholder="e.g. Mandaue City, Cebu"
                                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                        value={newPartner.address}
                                        onChange={e => setNewPartner({...newPartner, address: e.target.value})}
                                        onBlur={e => setNewPartner((prev) => ({ ...prev, address: normalizeHumanReadable(e.target.value) }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 mb-1">{activeTab === 'suppliers' ? 'Supply Capabilities' : 'Customer Type'}</label>
                                    {activeTab === 'suppliers' ? (
                                        <>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                                                <select
                                                    value={capabilityDraft.category}
                                                    onChange={(e) => setCapabilityDraft({ category: e.target.value, brand: '' })}
                                                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all"
                                                >
                                                    <option value="">Select category</option>
                                                    {supplierCategoryOptions.map((category) => (
                                                        <option key={category} value={category}>{category}</option>
                                                    ))}
                                                </select>

                                                <input
                                                    list="supplier-brand-suggestions"
                                                    value={capabilityDraft.brand}
                                                    onChange={(e) => setCapabilityDraft((prev) => ({ ...prev, brand: e.target.value }))}
                                                    placeholder="Brand (optional)"
                                                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all"
                                                />
                                                <datalist id="supplier-brand-suggestions">
                                                    {supplierBrandOptions.map((brand) => (
                                                        <option key={brand} value={brand} />
                                                    ))}
                                                </datalist>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={addSupplierCapability}
                                                disabled={!capabilityDraft.category}
                                                className={`w-full mb-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${capabilityDraft.category ? 'bg-gray-900 text-white border-gray-900 hover:opacity-90' : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}`}
                                            >
                                                Add Capability
                                            </button>

                                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 min-h-[56px]">
                                                {(Array.isArray(newPartner.supplierCapabilities) ? newPartner.supplierCapabilities : []).length === 0 ? (
                                                    <p className="text-[11px] text-gray-500">No capabilities added yet.</p>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {(newPartner.supplierCapabilities || []).map((entry, index) => (
                                                            <span key={`${entry.category}-${entry.brand}-${index}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-white border border-gray-300 text-gray-700">
                                                                {entry.category}{entry.brand ? ` • ${entry.brand}` : ''}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeSupplierCapability(index)}
                                                                    className="text-gray-400 hover:text-gray-700"
                                                                    aria-label="Remove capability"
                                                                >
                                                                    x
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-[10px] text-gray-400 mt-1">Add category and optional brand per supplier (example: Paints • Boysen).</p>
                                        </>
                                    ) : (
                                        <div className="space-y-2.5">
                                            <input 
                                                required
                                                type="text" 
                                                placeholder="e.g. Contractor, Retail"
                                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
                                                value={newPartner.note}
                                                onChange={e => setNewPartner({...newPartner, note: e.target.value})}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="pt-1">
                                    <button 
                                        type="submit" 
                                        disabled={isSavingPartner}
                                        className="w-full py-2 rounded-lg font-semibold tracking-widest hover:opacity-90 transition-all duration-300 shadow-md transform hover:-translate-y-0.5 text-xs text-center"
                                        style={{ backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' }}
                                    >
                                        {isSavingPartner ? 'Saving...' : `Save ${activeTab === 'suppliers' ? 'Supplier' : 'Customer'}`}
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
                                        <div className="bg-gray-100 p-1.5 rounded-lg">
                                            <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                        </div>
                                        <h2 className="text-xl font-semibold text-gray-900">Restock Recommendations</h2>
                                    </div>
                                    <p className="text-sm text-gray-500 font-medium ml-1">
                                        Suggested order for <span className="text-gray-900 font-semibold">{selectedSupplierRecs.supplier.name}</span>
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
                                            <tr className="bg-gray-900 text-[11px] uppercase tracking-wider text-white font-semibold border-b border-gray-700">
                                                <th className="px-4 py-3 border border-gray-700">Item Details</th>
                                                <th className="px-4 py-3 text-center border border-gray-700">Current Stock</th>
                                                <th className="px-4 py-3 text-center border border-gray-700">Reorder Qty</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {selectedSupplierRecs.items.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-gray-50 transition-colors group">
                                                    <td className="px-4 py-3 border border-gray-200">
                                                        <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                                                        <p className="text-[10px] text-gray-500 font-mono">{item.code} • {item.size}</p>
                                                    </td>
                                                    <td className="px-4 py-3 text-center border border-gray-200">
                                                        <span className={`px-2 py-1 rounded-md text-xs font-semibold ${
                                                            item.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                                                        }`}>
                                                            {item.stock} Qty
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center border border-gray-200">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <span className="text-lg font-semibold text-black">+{item.recommendedOrder}</span>
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
                                    * Recommendations based on maintaining healthy stock buffer (Target: {Number(settings?.maxStockLimit || 100)} units).
                                </p>
                            </div>

                            {/* Footer */}
                            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                                <button 
                                    onClick={() => {
                                        setIsRecModalOpen(false);
                                    }}
                                    className="px-5 py-2.5 rounded-xl font-semibold transition-all shadow-md transform hover:-translate-y-0.5 text-xs text-white"
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
                                <div className="mx-auto flex items-center justify-center mb-4 text-orange-600">
                                    <ArchiveIcon className="w-12 h-12" />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                                    Archive {activeTab === 'suppliers' ? 'Supplier' : 'Customer'}?
                                </h3>
                                <p className="text-gray-500 text-sm mb-6">
                                    Are you sure you want to archive <span className="font-semibold text-gray-900">{partnerToArchive.name}</span>?
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setIsArchiveModalOpen(false); setPartnerToArchive(null); }}
                                        className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmArchive}
                                        style={{ backgroundColor: '#111827' }}
                                        className="flex-1 py-2.5 text-white rounded-xl font-semibold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5"
                                    >
                                        Archive
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
