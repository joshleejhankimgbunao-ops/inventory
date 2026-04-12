import React, { useState, useMemo, useEffect } from 'react';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { getAuthToken } from '../services/apiClient';
import { createProductApi, updateProductApi } from '../services/inventoryApi';
import { getStockStatus } from '../utils/recommendationLogic';

const ProductList = () => {
    const { userRole, appSettings: settings, currentUserName, ROLES, isAdminOrAbove } = useAuth();
    const { inventory, setInventory, logAction, logActivity, categories: customCategories = [] } = useInventory();

    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [sortBy, setSortBy] = useState('off');
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [productToArchive, setProductToArchive] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
    const [editingProduct, setEditingProduct] = useState(null);
    const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false); // Custom dropdown state

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;
    
    // Derived Suppliers List for Dropdown
    const suggestedSuppliers = useMemo(() => {
        const fromInventory = inventory
            .map(p => p.supplier)
            .filter(Boolean); // Get all non-empty suppliers from current items
            
        // Default popular/partner suppliers (Fallback/Suggestions)
        const defaults = ['Cebu Home Builders', 'Atlantic Hardware', 'Citi Hardware', 'Generic Supplier'];
        
        return [...new Set([...fromInventory, ...defaults])].sort();
    }, [inventory]);

    // Active filter count for badge (status + sort; category has its own control)
    const activeFilterCount = (statusFilter !== 'All' ? 1 : 0) + (sortBy !== 'off' ? 1 : 0);

    const deriveStatus = (item) => getStockStatus(item, settings);

    const getStockBadgeClass = (item) => {
        const status = deriveStatus(item);
        if (status === 'Out of Stock') return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
        if (status === 'Low Stock') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    };

    // Category config with code prefixes, size/unit hints, and unit options
    const CATEGORY_CONFIG = {
        'Lumbers':                     { prefix: 'LBR', sizePlaceholder: 'e.g. 2x4x8',          sizeLabel: 'Dimensions',        sizeUnits: ['ft', 'inches', 'meters', 'cm'] },
        'Steel Bars':                  { prefix: 'STL', sizePlaceholder: 'e.g. 10mm x 6m',      sizeLabel: 'Diameter / Length',  sizeUnits: ['mm', 'cm', 'm', 'ft', 'inches'] },
        'Galvanized Sheets':           { prefix: 'GS',  sizePlaceholder: 'e.g. Gauge 26 x 8',   sizeLabel: 'Gauge / Length',     sizeUnits: ['ft', 'm', 'inches', 'gauge'] },
        'Plywoods':                    { prefix: 'PLY', sizePlaceholder: 'e.g. 1/4 (4x8)',      sizeLabel: 'Thickness (Sheet)',  sizeUnits: ['inches', 'mm', 'ft', 'cm'] },
        'Boards':                      { prefix: 'BRD', sizePlaceholder: 'e.g. 4x8',            sizeLabel: 'Size / Thickness',   sizeUnits: ['mm', 'inches', 'ft', 'cm'] },
        'Steel Plates':                { prefix: 'SPL', sizePlaceholder: 'e.g. 4x8',            sizeLabel: 'Size / Thickness',   sizeUnits: ['mm', 'inches', 'ft', 'cm'] },
        'Pipes':                       { prefix: 'PIP', sizePlaceholder: 'e.g. 1/2 x 6',       sizeLabel: 'Diameter / Length',  sizeUnits: ['inches', 'mm', 'm', 'ft'] },
        'Paints':                      { prefix: 'PNT', sizePlaceholder: 'e.g. 4',              sizeLabel: 'Volume',            sizeUnits: ['Liters', 'Gallons', 'mL', 'quart'] },
        'Thinners':                    { prefix: 'THN', sizePlaceholder: 'e.g. 1',              sizeLabel: 'Volume',            sizeUnits: ['Liters', 'Gallons', 'mL'] },
        'Door Locksets':               { prefix: 'DLK', sizePlaceholder: 'e.g. Heavy Duty',     sizeLabel: 'Type / Model',      sizeUnits: ['inches', 'mm', 'set'] },
        'Drawer Handles':              { prefix: 'DRH', sizePlaceholder: 'e.g. 4',              sizeLabel: 'Size / Style',      sizeUnits: ['inches', 'cm', 'mm'] },
        'Padlocks':                    { prefix: 'PDL', sizePlaceholder: 'e.g. 50',             sizeLabel: 'Size',              sizeUnits: ['mm', 'inches'] },
        'Adhesives & Tapes':           { prefix: 'ADH', sizePlaceholder: 'e.g. 200',            sizeLabel: 'Volume / Width',    sizeUnits: ['mL', 'Liters', 'inches', 'meters'] },
        'Construction Tools':          { prefix: 'CTL', sizePlaceholder: 'e.g. 16',             sizeLabel: 'Size / Weight',     sizeUnits: ['inches', 'oz', 'mm', 'cm', 'lbs'] },
        'Galvanized Wires':            { prefix: 'GW',  sizePlaceholder: 'e.g. Gauge 16 x 1',   sizeLabel: 'Gauge / Weight',    sizeUnits: ['kg', 'm', 'ft', 'gauge'] },
        'Cement, Sand & Gravel':       { prefix: 'CMT', sizePlaceholder: 'e.g. 40',             sizeLabel: 'Weight / Volume',   sizeUnits: ['kg', 'bags', 'cu.m', 'Liters'] },
        'Bolts, Nuts, Screws & Nails': { prefix: 'BNS', sizePlaceholder: 'e.g. 4 / M10x50',    sizeLabel: 'Size / Length',     sizeUnits: ['inches', 'mm', 'cm'] },
        'Door Closers & Hinges':       { prefix: 'DCH', sizePlaceholder: 'e.g. 4',              sizeLabel: 'Size / Type',       sizeUnits: ['inches', 'mm', 'set'] },
        'Electrical & Lighting':       { prefix: 'ELC', sizePlaceholder: 'e.g. 3.5mm² x 150',   sizeLabel: 'Spec / Wattage',    sizeUnits: ['m', 'mm²', 'watts', 'ft'] },
        'Plumbing Materials':          { prefix: 'PLB', sizePlaceholder: 'e.g. 1/2',            sizeLabel: 'Diameter / Size',   sizeUnits: ['inches', 'mm', 'cm', 'm'] },
        'Pressure Tanks':              { prefix: 'PTK', sizePlaceholder: 'e.g. 50',             sizeLabel: 'Capacity',          sizeUnits: ['Liters', 'Gallons'] },
        'Caster Wheels':               { prefix: 'CW',  sizePlaceholder: 'e.g. 3',              sizeLabel: 'Size / Type',       sizeUnits: ['inches', 'mm', 'cm'] },
        'Ropes & Chains':              { prefix: 'RC',  sizePlaceholder: 'e.g. 10mm x 1',       sizeLabel: 'Diameter / Length', sizeUnits: ['mm', 'm', 'ft', 'inches'] },
        'Screens':                     { prefix: 'SCR', sizePlaceholder: 'e.g. 4 x 25',         sizeLabel: 'Width / Length',    sizeUnits: ['ft', 'm', 'inches'] },
        'Others':                      { prefix: 'OTH', sizePlaceholder: 'e.g. specify',        sizeLabel: 'Size / Variant',    sizeUnits: ['pcs', 'inches', 'mm', 'cm', 'ft', 'm', 'Liters', 'kg'] },
    };

    const defaultCategory = useMemo(() => {
        const firstDbCategory = customCategories.find((c) => String(c?.name || '').trim())?.name;
        const firstInventoryCategory = inventory.find((item) => String(item?.category || '').trim())?.category;
        return firstDbCategory || firstInventoryCategory || 'General';
    }, [customCategories, inventory]);

    // Prefer DB category settings and units when available.
    const getCategoryConfig = (catName) => {
        const staticConfig = CATEGORY_CONFIG[catName] || CATEGORY_CONFIG['Others'];
        const dynamicCategory = customCategories.find((c) => c.name === catName);
        if (!dynamicCategory) {
            return staticConfig;
        }

        const dynamicUnits = Array.isArray(dynamicCategory.sizeUnits)
            ? dynamicCategory.sizeUnits.map((unit) => String(unit || '').trim()).filter(Boolean)
            : [];

        return {
            ...staticConfig,
            sizeLabel: 'Size / Variant',
            sizePlaceholder: staticConfig.sizePlaceholder || 'e.g. specify',
            sizeUnits: dynamicUnits.length > 0 ? dynamicUnits : staticConfig.sizeUnits,
        };
    };
    
    // Keep category list aligned with DB + live inventory categories.
        const CATEGORY_LIST = useMemo(() => {
            const dynamicCats = customCategories
                .map((c) => String(c?.name || '').trim())
                .filter(Boolean);

            if (dynamicCats.length > 0) {
                return [...new Set(dynamicCats)].sort((a, b) => a.localeCompare(b));
            }

            return Object.keys(CATEGORY_CONFIG).sort((a, b) => a.localeCompare(b));
        }, [customCategories]);

    const CATEGORY_FIELD_RULES = {
        default: { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Lumbers': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Steel Bars': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Galvanized Sheets': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Plywoods': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Boards': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Steel Plates': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Pipes': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Paints': { showBrand: true, showColor: true, showSize: true, showSupplier: true, requireBrand: true, requireColor: true, requireSize: true },
        'Thinners': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: true, requireColor: false, requireSize: true },
        'Door Locksets': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: true, requireColor: false, requireSize: true },
        'Drawer Handles': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Padlocks': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: true, requireColor: false, requireSize: true },
        'Adhesives & Tapes': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Construction Tools': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Galvanized Wires': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Cement, Sand & Gravel': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: true, requireColor: false, requireSize: true },
        'Bolts, Nuts, Screws & Nails': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Door Closers & Hinges': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Electrical & Lighting': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Plumbing Materials': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Pressure Tanks': { showBrand: true, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Caster Wheels': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Ropes & Chains': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Screens': { showBrand: false, showColor: false, showSize: true, showSupplier: true, requireBrand: false, requireColor: false, requireSize: true },
        'Others': { showBrand: false, showColor: false, showSize: false, showSupplier: true, requireBrand: false, requireColor: false, requireSize: false },
    };

    const getCategoryFieldRules = (categoryName) => {
        // 1. Check if it's a dynamic category from DB
        const dynamicCat = customCategories.find((c) => c.name === categoryName);
        if (dynamicCat) {
            return {
                showBrand: dynamicCat.showBrand ?? false,
                requireBrand: dynamicCat.requireBrand ?? false,
                showColor: dynamicCat.showColor ?? false,
                requireColor: dynamicCat.requireColor ?? false,
                showSize: dynamicCat.showSize ?? true,
                requireSize: dynamicCat.requireSize ?? true,
                showSupplier: dynamicCat.showSupplier ?? true,
            };
        }
        // 2. Check static built-in config
        return CATEGORY_FIELD_RULES[categoryName] || CATEGORY_FIELD_RULES.default;
    };

    // Helper: parse a size string back into value + unit
    const parseSizeString = (sizeStr, category) => {
        if (!sizeStr) return { value: '', unit: '' };
        const units = getCategoryConfig(category).sizeUnits || [];
        // Try to match the unit at the end of the string (case-insensitive)
        for (const u of units) {
            const regex = new RegExp(`^(.+?)\\s*${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
            const match = sizeStr.match(regex);
            if (match) return { value: match[1].trim(), unit: u };
        }
        return { value: sizeStr, unit: '' };
    };

    const normalizeProductNameAndSize = (rawName, category, sizeString = '') => {
        const original = String(rawName || '').trim();
        const normalizedSize = String(sizeString || '').trim();
        if (!original) {
            return { name: '', size: normalizedSize };
        }

        const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const cleanByExplicitSize = (nameValue, explicitSize) => {
            const localSize = String(explicitSize || '').trim();
            if (!localSize) return String(nameValue || '').trim();

            const escapedSize = escapeRegex(localSize);
            const trailingPatterns = [
                new RegExp(`\\s*\\(${escapedSize}\\)\\s*$`, 'i'),
                new RegExp(`\\s*[-–—,:|/]\\s*${escapedSize}\\s*$`, 'i'),
                new RegExp(`\\s+${escapedSize}\\s*$`, 'i')
            ];

            let cleaned = String(nameValue || '').trim();
            trailingPatterns.forEach((pattern) => {
                cleaned = cleaned.replace(pattern, '').trim();
            });
            return cleaned;
        };

        const byKnownSize = cleanByExplicitSize(original, normalizedSize);
        if (normalizedSize) {
            return { name: byKnownSize || original, size: normalizedSize };
        }

        const units = (CATEGORY_CONFIG[category] || CATEGORY_CONFIG['Others']).sizeUnits || [];
        if (units.length === 0) {
            return { name: original, size: '' };
        }

        const unitPattern = units
            .slice()
            .sort((a, b) => b.length - a.length)
            .map(escapeRegex)
            .join('|');

        const inferredPatterns = [
            /^\s*(.*?)\s*\(([^)]+)\)\s*$/i,
            /^\s*(.*?)\s*[-–—,:|/]\s*([^,]+?)\s*$/i,
            new RegExp(`^\\s*(.*?[A-Za-z])\\s*((?:\\d+[A-Za-z²0-9./"]*)(?:\\s*[x×]\\s*(?:\\d+[A-Za-z²0-9./"]*)){1,3})\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?[A-Za-z])\\s*(\\d+[\\d./"]*(?:\\s*[x×]\\s*(?:\\d+[\\d./"]*)){1,3}(?:\\s*(?:${unitPattern}))?)\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?[A-Za-z])\\s*(\\d+[\\d./"]*\\s*(?:${unitPattern}))\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?)\\s+((?:\\d+[\\d./"]*)(?:\\s*[x×]\\s*(?:\\d+[\\d./"]*)){1,3}(?:\\s*(?:${unitPattern}))?)\\s*$`, 'i'),
            new RegExp(`^\\s*(.*?)\\s+(\\d+[\\d./"]*\\s*(?:${unitPattern}))\\s*$`, 'i')
        ];

        for (const pattern of inferredPatterns) {
            const match = original.match(pattern);
            if (!match) continue;

            const candidateName = String(match[1] || '').trim();
            const candidateSize = String(match[2] || '').trim();
            if (!candidateName || !candidateSize) continue;

            const endsWithKnownUnit = new RegExp(`(?:${unitPattern})\\s*$`, 'i').test(candidateSize);
            const looksLikeDimensions = /[x×]/i.test(candidateSize);
            if (!endsWithKnownUnit && !looksLikeDimensions) continue;

            const cleanedName = cleanByExplicitSize(candidateName, candidateSize) || candidateName;
            if (cleanedName && cleanedName !== original) {
                return { name: cleanedName, size: candidateSize };
            }
        }

        return { name: original, size: normalizedSize };
    };

    // Initial Form State
    const initialFormState = {
        code: '',
        brand: '',
        name: '',
        color: '',
        category: defaultCategory,
        size: '',
        sizeUnit: '',
        price: '',
        stock: '',
        supplier: 'Local Supplier'
    };
    const [formData, setFormData] = useState(initialFormState);
    const categoryFieldRules = useMemo(() => getCategoryFieldRules(formData.category), [formData.category]);

    const resolveCombinedSize = (sizeValue, sizeUnitValue, category) => {
        const trimmedSize = String(sizeValue || '').trim();
        if (!trimmedSize) return '';

        const parsed = parseSizeString(trimmedSize, category);
        if (parsed.unit) {
            return `${parsed.value} ${parsed.unit}`.trim();
        }

        if (sizeUnitValue) {
            return `${trimmedSize} ${sizeUnitValue}`.trim();
        }

        return trimmedSize;
    };

    // Cleanup legacy items whenever inventory changes (e.g. after remote refresh).
    useEffect(() => {
        setInventory((prev) => {
            let changed = false;
            const next = prev.map((item) => {
                const normalized = normalizeProductNameAndSize(item?.name, item?.category, item?.size || '');
                if (normalized.name !== item?.name || String(normalized.size || '') !== String(item?.size || '')) {
                    changed = true;
                    return { ...item, name: normalized.name, size: normalized.size };
                }
                return item;
            });
            return changed ? next : prev;
        });
    }, [inventory, setInventory]);



    // Helper for logging
    const log = (action, code, details) => {
        if (logAction) {
            logAction(action, code, details, currentUserName);
        }
    };

    // Derived Data
    const generateNextCode = (category = formData.category) => {
        const config = getCategoryConfig(category);
        const prefix = config.prefix;
        const codes = inventory.map(i => i.code);
        let counter = 1;
        let newCode = `${prefix}-${String(counter).padStart(3, '0')}`;
        while (codes.includes(newCode)) {
            counter++;
            newCode = `${prefix}-${String(counter).padStart(3, '0')}`;
        }
        return newCode;
    };

    const categoryFilterOptions = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
    const filteredProductsBase = useMemo(() => {
        return inventory.filter(item => {
            const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                (item.brand || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                (item.color || '').toLowerCase().includes(searchTerm.toLowerCase());
            
            // Special handling for Archived Items view
            if (statusFilter === 'Archived') {
                return matchesSearch && item.isArchived && (categoryFilter === 'All' || item.category === categoryFilter);
            }

            // For all other views, strictly hide archived items
            if (item.isArchived) return false;

            // Status filter
            const derivedStatus = deriveStatus(item);
            if (statusFilter !== 'All' && derivedStatus !== statusFilter) return false;

            // Category filter
            if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;

            return matchesSearch;
        });
    }, [inventory, searchTerm, statusFilter, categoryFilter, settings]);

    const filteredProducts = useMemo(() => {
        return [...filteredProductsBase].sort((a, b) => {
            switch (sortBy) {
                case 'name-asc':
                    return a.name.localeCompare(b.name);
                case 'name-desc':
                    return b.name.localeCompare(a.name);
                case 'stock-asc':
                    return a.stock - b.stock;
                case 'stock-desc':
                    return b.stock - a.stock;
                case 'price-asc':
                    return a.price - b.price;
                case 'price-desc':
                    return b.price - a.price;
                default:
                    return 0;
            }
        });
    }, [filteredProductsBase, sortBy]);

    // Pagination Logic
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const paginatedProducts = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);

    // Reset page when filters change
    React.useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, categoryFilter, sortBy]);

    // Check for changes (Memoized)
    const isFormModified = useMemo(() => {
        if (modalMode === 'add') return true;
        if (modalMode === 'edit' && editingProduct) {
            const stockVal = parseInt(formData.stock);
            const combinedSize = resolveCombinedSize(formData.size, formData.sizeUnit, formData.category);
            return (
                formData.name !== editingProduct.name ||
                (formData.brand || '') !== (editingProduct.brand || '') ||
                (formData.color || '') !== (editingProduct.color || '') ||
                formData.category !== editingProduct.category ||
                combinedSize !== (editingProduct.size || '') ||
                parseFloat(formData.price) !== editingProduct.price ||
                stockVal !== editingProduct.stock ||
                (formData.supplier || 'Local Supplier') !== (editingProduct.supplier || 'Local Supplier')
            );
        }
        return false;
    }, [formData, modalMode, editingProduct]);

    // Handlers
    const handleOpenAdd = () => {
        setModalMode('add');
        setFormData({
            ...initialFormState,
            code: generateNextCode(initialFormState.category)
        });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (product) => {
        setModalMode('edit');
        setEditingProduct(product);
        const parsed = parseSizeString(product.size || '', product.category);
        setFormData({
            code: product.code,
            brand: product.brand || '',
            name: product.name,
            color: product.color || '',
            category: product.category,
            size: parsed.value,
            sizeUnit: parsed.unit,
            price: product.price,
            stock: product.stock,
            supplier: 'Local Supplier' // Mock data
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();

        const rules = getCategoryFieldRules(formData.category);
        const normalizedBrand = rules.showBrand ? String(formData.brand || '').trim() : '';
        const normalizedColor = rules.showColor ? String(formData.color || '').trim() : '';
        const normalizedSupplier = rules.showSupplier ? String(formData.supplier || '').trim() : '';
        const combinedSize = rules.showSize
            ? resolveCombinedSize(formData.size, formData.sizeUnit, formData.category)
            : '';
        
        // Basic Validation
        if (!formData.code || !formData.name || !formData.price) {
            showToast("Missing Fields", "Please fill in all required fields.", "error", "product-validation");
            return;
        }

        if (rules.requireBrand && !normalizedBrand) {
            showToast('Missing Fields', `Brand is required for ${formData.category}.`, 'error', 'product-validation');
            return;
        }

        if (rules.requireColor && !normalizedColor) {
            showToast('Missing Fields', `Color or variant is required for ${formData.category}.`, 'error', 'product-validation');
            return;
        }

        if (rules.requireSize && !combinedSize) {
            showToast('Missing Fields', `${getCategoryConfig(formData.category).sizeLabel} is required for ${formData.category}.`, 'error', 'product-validation');
            return;
        }

            const maxStockLimit = (settings && settings.maxStockLimit) ? parseInt(settings.maxStockLimit) : 100;
            if (modalMode === 'add') {
            // Check for duplicate code
            if (inventory.some(i => i.code === formData.code)) {
                showToast("Duplicate Code", "Product code already exists!", "error", "product-duplicate");
                return;
            }

            let stockVal = parseInt(formData.stock) || 0;
            if (stockVal > maxStockLimit) {
                showToast('Stock Limit', `Initial stock capped to max (${maxStockLimit}).`, 'warning', 'stock-cap');
                stockVal = maxStockLimit;
            }
            
            // Check if there's a rule from settings? No, ProductList doesn't need to know the rule for creating.
            // But status calculation might depend on it.
            // Ideally we pass the resolved maxStock to calculateStatus if we wanted it perfect.
            // For now, let's keep status simple or just use global for basic 'In Stock'. 
            // Or better, let's use the helpers we just made? No they are in utils.
            // Let's simplified status based on global default for now, since visual status is less critical than the recommendation logic.
            // Or I can update `calculateStatus` to look at settings.stockRules if available.
            
            const normalized = normalizeProductNameAndSize(formData.name, formData.category, combinedSize);
            const cleanedName = normalized.name;
            const finalSize = combinedSize || normalized.size || '';
            const newProduct = {
                ...formData,
                name: cleanedName,
                brand: normalizedBrand,
                color: normalizedColor,
                size: finalSize,
                price: parseFloat(formData.price),
                stock: stockVal,
                supplier: normalizedSupplier || 'Local Supplier'
            };
            newProduct.status = deriveStatus(newProduct);
            delete newProduct.sizeUnit;

            let productToInsert = newProduct;
            const token = getAuthToken();
            if (token && navigator.onLine) {
                try {
                    productToInsert = await createProductApi(newProduct);
                } catch (error) {
                    showToast('Sync Failed', error.message || 'Saved locally only. Product was not synced to server.', 'warning', 'product-sync');
                }
            }

            setInventory(prev => [...prev, productToInsert]);
            log('CREATE', newProduct.code, `Created new product: ${newProduct.name}`);
            logActivity(currentUserName, 'Created Product', `${newProduct.code} - ${newProduct.name}`);
            showToast("Product Created", `${newProduct.name} has been added.`, "success", "product-action");
        } else {
            // Update Logic
            const stockVal = parseInt(formData.stock);
            
            const normalized = normalizeProductNameAndSize(formData.name, formData.category, combinedSize);
            const cleanedName = normalized.name;
            const finalSize = combinedSize || normalized.size || '';
            // Check for changes
            const hasChanges = 
                cleanedName !== editingProduct.name ||
                normalizedBrand !== (editingProduct.brand || '') ||
                normalizedColor !== (editingProduct.color || '') ||
                formData.category !== editingProduct.category ||
                (finalSize || '') !== (editingProduct.size || '') ||
                parseFloat(formData.price) !== editingProduct.price ||
                stockVal !== editingProduct.stock ||
                (normalizedSupplier || 'Local Supplier') !== (editingProduct.supplier || 'Local Supplier');

            if (!hasChanges) {
               setIsModalOpen(false);
               return; 
            }

            let updatedStockVal = parseInt(formData.stock) || 0;
            if (updatedStockVal > maxStockLimit) {
                showToast('Stock Limit', `Stock capped to max (${maxStockLimit}).`, 'warning', 'stock-cap');
                updatedStockVal = maxStockLimit;
            }
            const { sizeUnit: _su, ...saveData } = formData;
            const localUpdatedProduct = {
                ...editingProduct,
                ...saveData,
                name: cleanedName,
                brand: normalizedBrand,
                color: normalizedColor,
                size: finalSize,
                price: parseFloat(formData.price),
                stock: updatedStockVal,
                supplier: normalizedSupplier || 'Local Supplier'
            };
            localUpdatedProduct.status = deriveStatus(localUpdatedProduct);

            let mergedUpdatedProduct = localUpdatedProduct;
            const token = getAuthToken();
            if (token && navigator.onLine && editingProduct?.id) {
                try {
                    mergedUpdatedProduct = await updateProductApi(editingProduct.id, localUpdatedProduct);
                } catch (error) {
                    showToast('Sync Failed', error.message || 'Saved locally only. Product update was not synced to server.', 'warning', 'product-sync');
                }
            }

            setInventory(prev => prev.map(item => 
                item.code === editingProduct.code
                    ? { ...item, ...mergedUpdatedProduct }
                    : item
            ));
            log('UPDATE', editingProduct.code, `Updated product details`);
            logActivity(currentUserName, 'Updated Product', `${editingProduct.code} - ${editingProduct.name}`);
            showToast("Product Updated", "Product details have been saved.", "success", "product-action");
        }
        setIsModalOpen(false);
    };

    // Soft Delete / Archive Logic (Modified to use Modal)
    const toggleArchive = (item) => {
        setProductToArchive(item);
        setIsArchiveModalOpen(true);
    };

    const confirmArchive = () => {
        if (!productToArchive) return;

        const item = productToArchive;
        const action = item.isArchived ? 'RESTORE' : 'ARCHIVE';

        setInventory(prev => prev.map(p => 
            p.code === item.code 
            ? { ...p, isArchived: !item.isArchived }
            : p
        ));

        log(action, item.code, `${action}D product`);
        logActivity(currentUserName, item.isArchived ? 'Restored Product' : 'Archived Product', `${item.code} - ${item.name}`);
        showToast(item.isArchived ? "Product Restored" : "Product Archived", `${item.name} has been ${item.isArchived ? 'restored' : 'archived'}.`, "success", "product-archive");

        setIsArchiveModalOpen(false);
        setProductToArchive(null);
    };

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 md:overflow-hidden p-2">

             {/* Unified Product List Container */}
             <div className="flex flex-col bg-slate-200/50 rounded-xl shadow-sm border border-gray-100 border-t-8 border-t-[#111827] md:overflow-hidden p-4 gap-4 md:flex-1 h-auto">
                 
                 {/* Header Section */}
                 <div className="flex items-center justify-between md:shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="text-gray-900 hidden sm:block">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                        </div>

                        <div>
                            <h1 className="text-4xl md:text-5xl font-black text-gray-900 leading-tight">Product Master List</h1>
                            <p className="text-gray-500 dark:text-gray-400 text-xs font-medium mt-0.5">Manage catalog, prices, and stock levels</p>
                        </div>
                    </div>
                 </div>

             {/* Header Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:shrink-0">
                <div className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Total Products</p>
                        <h2 className="text-xl font-black text-gray-900 dark:text-white">{inventory.filter(i => !i.isArchived).length} <span className="text-xs font-medium text-gray-400">active</span></h2>
                    </div>
                     <div className="bg-gray-900 dark:bg-gray-700 p-2 rounded-lg text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                    </div>
                </div>
                {isAdminOrAbove() && (
                <div className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Total Value</p>
                        <h2 className="text-xl font-black text-gray-900 dark:text-white">₱{inventory.filter(i => !i.isArchived).reduce((acc, item) => acc + (item.price * item.stock), 0).toLocaleString()}</h2>
                    </div>
                    <div className="bg-gray-900 dark:bg-gray-700 p-2 rounded-lg text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                )}
                <div className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Categories</p>
                        <h2 className="text-xl font-black text-gray-900 dark:text-white">{categoryFilterOptions.length - 1}</h2>
                    </div>
                     <div className="bg-gray-900 dark:bg-gray-700 p-2 rounded-lg text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col md:overflow-hidden transition-colors bg-transparent pt-1">
                {/* Utilities Bar */}
                <div className="px-3 pb-3 flex flex-col sm:flex-row justify-between items-center gap-3 bg-transparent">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <div className="relative w-full sm:w-64 group">
                             <input 
                                type="text" 
                                placeholder="Search products..." 
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-3 py-1.5 bg-gray-50 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 rounded-xl text-sm focus:bg-white dark:focus:bg-gray-600 focus:border-gray-900 dark:focus:border-gray-400 focus:ring-0 transition-all shadow-sm placeholder:text-gray-400 font-bold text-gray-800 dark:text-gray-200"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 bg-white dark:bg-gray-600 rounded-lg shadow-sm border border-gray-100 dark:border-gray-500 group-focus-within:border-gray-900 group-focus-within:bg-gray-900 dark:group-focus-within:border-gray-400 dark:group-focus-within:bg-gray-400 transition-all duration-300">
                                <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300 group-focus-within:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
                        </div>
                        
                        {/* Filter & Sort Panel */}
                        <div className="relative z-20 ml-2 sm:ml-2 inline-flex items-center gap-3">
                            <button 
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                className="px-3 py-2 rounded-xl font-bold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                                <span>Filter & Sort</span>
                                {activeFilterCount > 0 && (
                                    <span className="bg-white text-gray-900 dark:bg-gray-300 dark:text-gray-800 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>
                                )}
                                <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>

                            {/* Category select (adjacent to Filter & Sort) */}
                            <div className="hidden sm:inline-flex items-center">
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="appearance-none px-3 py-1.5 rounded-xl text-sm font-bold inline-flex items-center transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                                >
                                    {categoryFilterOptions.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Combined Filter & Sort Panel */}
                            {isFilterPanelOpen && (
                                <div className="absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 py-2 z-50 left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[70vh] overflow-y-auto">
                                    
                                    {/* Status Section */}
                                    <div className="px-3 pt-2 pb-1">
                                        <div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Status</div>
                                    </div>
                                    <div className="px-2 pb-2 flex flex-wrap gap-1">
                                        {['All', 'In Stock', 'Low Stock', 'Out of Stock', 'Archived'].map(status => (
                                            <button key={status} onClick={() => setStatusFilter(status)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                                    statusFilter === status
                                                    ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                    : status === 'Low Stock' ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400'
                                                    : status === 'Out of Stock' ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'
                                                    : status === 'Archived' ? 'bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400'
                                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
                                                }`}>
                                                {status === 'All' ? 'All Status' : status}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="border-t border-gray-100 dark:border-gray-700 mx-3"></div>

                                    {/* Sort Section */}
                                    <div className="px-3 pt-2 pb-1">
                                        <div className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sort By</div>
                                    </div>
                                    <div className="px-2 pb-2">
                                        {[
                                            { key: 'off', label: 'OFF (No Sorting)' },
                                            { key: 'stock-asc', label: 'Stock ↑ Lowest' },
                                            { key: 'stock-desc', label: 'Stock ↓ Highest' },
                                            { key: 'name-asc', label: 'Name A→Z' },
                                            { key: 'name-desc', label: 'Name Z→A' },
                                            { key: 'price-asc', label: 'Price ↑ Lowest' },
                                            { key: 'price-desc', label: 'Price ↓ Highest' },
                                        ].map(opt => (
                                            <button
                                                key={opt.key}
                                                onClick={() => setSortBy(opt.key)}
                                                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${
                                                    sortBy === opt.key
                                                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                                }`}
                                            >
                                                <span>{opt.label}</span>
                                                {sortBy === opt.key && (
                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                                                )}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Clear All */}
                                    {activeFilterCount > 0 && (
                                        <>
                                            <div className="border-t border-gray-100 dark:border-gray-700 mx-3"></div>
                                            <div className="px-2 pt-2 pb-1">
                                                <button onClick={() => { setStatusFilter('All'); setSortBy('off'); }}
                                                    className="w-full text-center px-3 py-1.5 rounded-lg text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">
                                                    Clear All Filters
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {isAdminOrAbove() && (
                    <button 
                        onClick={handleOpenAdd}
                        className="w-full sm:w-auto px-3 py-1.5 rounded-lg text-white font-bold text-xs shadow-md flex items-center justify-center gap-1.5 transition-all hover:opacity-90 transform hover:-translate-y-0.5"
                        style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        Add Product
                    </button>
                    )}
                </div>

                {/* Backdrop for closing panel */}
                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-10 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}

                 {/* Data Table */}
                <div className="w-full md:flex-1 md:overflow-y-auto px-1 md:px-3 pb-3 overflow-x-auto">
                    <table className="w-full text-left border-separate border-spacing-0 table-fixed min-w-175 md:min-w-225">
                        <thead className="sticky top-0 z-10 shadow-sm">
                            <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                <th className="px-4 py-2 text-[10px] font-bold text-center border border-gray-700 w-[10%]">Code</th>
                                <th className="px-4 py-2 text-[10px] font-bold text-center border border-gray-700 w-[25%]">Product</th>
                                <th className="px-4 py-2 text-[10px] font-bold text-center border border-gray-700 w-[20%]">Category</th>
                                <th className="px-4 py-2 text-[10px] font-bold text-center border border-gray-700 w-[15%]">Price</th>
                                <th className="px-4 py-2 text-[10px] font-bold text-center border border-gray-700 w-[15%]">Stock</th>
                                {isAdminOrAbove() && <th className="px-4 py-2 text-[10px] font-bold text-center border border-gray-700 w-42.5">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                            {filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={isAdminOrAbove() ? "6" : "5"} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                                        <div className="flex flex-col items-center justify-center">
                                            <svg className="w-12 h-12 mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293H9.414a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 005.586 13H4"></path></svg>
                                            <p className="text-sm font-medium">No products found.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                paginatedProducts.map((product) => (
                                    <tr key={product.code} className={`hover:bg-gray-50/80 dark:hover:bg-gray-700/50 transition-colors group ${
                                        product.isArchived 
                                        ? 'bg-gray-50/50 dark:bg-gray-800'
                                        : ''
                                    }`}>
                                        {/* Code */}
                                        <td className={`px-4 py-2 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700`}>
                                            <span className={`text-xs font-mono font-bold ${product.isArchived ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'}`}>{product.code}</span>
                                        </td>
                                        {/* Product (Brand + Name) */}
                                        <td className="px-4 py-2 whitespace-nowrap border border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center gap-3">
                                                <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 border ${
                                                    product.isArchived 
                                                    ? 'bg-gray-50 text-gray-300 border-gray-100 dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700' 
                                                    : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                                                }`}>
                                                    {product.code.substring(0,2)}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-sm font-bold leading-tight truncate ${product.isArchived ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                                                            {product.name}
                                                        </span>
                                                        {product.brand && (
                                                            <span className={`text-[10px] font-medium leading-tight px-1.5 py-0.5 rounded-md ${product.isArchived ? 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                                                                {product.brand}
                                                            </span>
                                                        )}
                                                        {product.isArchived && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-bold uppercase">Archived</span>}
                                                    </div>
                                                    {(product.size || product.color) && (
                                                        <div className="flex items-center gap-2 mt-1.5">
                                                            {product.size && (
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${product.isArchived ? 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/30'}`}>
                                                                    Size: {product.size}
                                                                </span>
                                                            )}
                                                            {product.color && (
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${product.isArchived ? 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700' : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800/30'}`}>
                                                                    Color: {product.color}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        
                                        {/* Category */}
                                        <td className={`px-4 py-2 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700`}>
                                            <span className={`px-2.5 py-1.5 rounded-md text-xs font-semibold ${product.isArchived ? 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{product.category}</span>
                                        </td>
                                        {/* Price */}
                                        <td className={`px-4 py-2 whitespace-nowrap text-sm font-bold text-center border border-gray-200 dark:border-gray-700 ${product.isArchived ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-white'}`}>
                                            ₱{product.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        {/* Stock */}
                                        <td className="px-4 py-2 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700">
                                            <div className={`flex flex-col items-center ${product.isArchived ? 'opacity-30' : ''}`}>
                                                <span className={`px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                    getStockBadgeClass(product)
                                                }`}>
                                                    {product.stock} Qty
                                                </span>
                                            </div>
                                        </td>
                                        {/* Actions */}
                                        {isAdminOrAbove() && (
                                        <td className="w-42.5 px-4 py-2 whitespace-nowrap text-center text-sm font-medium border border-gray-200 dark:border-gray-700 overflow-hidden">
                                            <div className="flex items-center justify-center gap-2">
                                                <button 
                                                    onClick={() => handleOpenEdit(product)}
                                                    className="group/btn inline-flex items-center bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all px-2 py-1.5"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                                    <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-bold group-hover/btn:ml-1 group-hover/btn:max-w-16 group-hover/btn:opacity-100">Edit</span>
                                                </button>
                                                
                                                <button 
                                                    onClick={() => toggleArchive(product)}
                                                    className={`group/btn inline-flex items-center rounded-lg transition-all px-2 py-1.5 ${
                                                        product.isArchived 
                                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40' 
                                                        : 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                    }`}
                                                >
                                                    {product.isArchived ? (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                    ) : (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
                                                    )}
                                                    <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 text-[10px] font-bold group-hover/btn:ml-1 group-hover/btn:max-w-20 group-hover/btn:opacity-100">{product.isArchived ? "Restore" : "Archive"}</span>
                                                </button>
                                            </div>
                                        </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="shrink-0 flex justify-between items-center pt-3 pb-1 mt-auto border-t border-slate-300 dark:border-gray-700 bg-transparent">
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            Showing <span className="font-bold text-gray-900 dark:text-white">{indexOfFirstItem + 1}</span> - <span className="font-bold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, filteredProducts.length)}</span> of <span className="font-bold text-gray-900 dark:text-white">{filteredProducts.length}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className={`p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 transition-all ${currentPage === 1 ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                            </button>
                            {(() => {
                                const maxVisible = 5;
                                let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                                let end = start + maxVisible - 1;
                                if (end > totalPages) { end = totalPages; start = Math.max(1, end - maxVisible + 1); }
                                const pages = [];
                                if (start > 1) pages.push(<button key="first" onClick={() => setCurrentPage(1)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">1</button>);
                                if (start > 2) pages.push(<span key="dots-start" className="text-gray-400 text-xs px-0.5">...</span>);
                                for (let i = start; i <= end; i++) {
                                    pages.push(
                                        <button key={i} onClick={() => setCurrentPage(i)}
                                            className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                                                currentPage === i
                                                ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                            }`}
                                        >{i}</button>
                                    );
                                }
                                if (end < totalPages - 1) pages.push(<span key="dots-end" className="text-gray-400 text-xs px-0.5">...</span>);
                                if (end < totalPages) pages.push(<button key="last" onClick={() => setCurrentPage(totalPages)} className="w-7 h-7 rounded-lg text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">{totalPages}</button>);
                                return pages;
                            })()}
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className={`p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 transition-all ${currentPage === totalPages ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'}`}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                            </button>
                        </div>
                </div>
            </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-visible animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800 flex justify-between items-center rounded-t-2xl">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gray-900 dark:bg-gray-700 flex items-center justify-center">
                                    {modalMode === 'add' ? (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                    ) : (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-black text-sm text-gray-900 dark:text-white leading-tight">
                                        {modalMode === 'add' ? 'New Product' : 'Edit Product'}
                                    </h3>
                                    <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5">
                                        {modalMode === 'add' ? 'Add a new item to inventory' : `Editing ${formData.code}`}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-all">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="px-5 py-4 space-y-4">
                            {/* ── Section 1: Classification ── */}
                            <div>
                                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Classification</p>
                                <div className="grid grid-cols-5 gap-2.5">
                                    <div className="col-span-2">
                                        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Code</label>
                                        <input 
                                            type="text" 
                                            disabled={true}
                                            value={formData.code}
                                            className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono font-bold text-gray-400 cursor-not-allowed"
                                            placeholder="Auto"
                                        />
                                    </div>
                                    <div className="col-span-3">
                                        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Category</label>
                                        <select 
                                            value={formData.category}
                                            onChange={e => {
                                                const newCat = e.target.value;
                                                const newRules = getCategoryFieldRules(newCat);
                                                setFormData(prev => ({
                                                    ...prev, 
                                                    category: newCat,
                                                    code: modalMode === 'add' ? generateNextCode(newCat) : prev.code,
                                                    brand: newRules.showBrand ? prev.brand : '',
                                                    color: newRules.showColor ? prev.color : '',
                                                    size: newRules.showSize ? prev.size : '',
                                                    sizeUnit: newRules.showSize ? prev.sizeUnit : '',
                                                    supplier: newRules.showSupplier ? prev.supplier : ''
                                                }));
                                            }}
                                            className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                        >
                                            {CATEGORY_LIST.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* ── Section 2: Product Identity ── */}
                            <div>
                                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Product Details</p>
                                <div className="space-y-2.5">
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {categoryFieldRules.showBrand && (
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Brand</label>
                                            <input 
                                                type="text" 
                                                value={formData.brand}
                                                onChange={e => setFormData({...formData, brand: e.target.value})}
                                                required={categoryFieldRules.requireBrand}
                                                className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                placeholder={
                                                    ['Paints','Thinners'].includes(formData.category) ? 'e.g. Boysen, Davies' :
                                                    ['Cement, Sand & Gravel'].includes(formData.category) ? 'e.g. Holcim, Eagle' :
                                                    ['Electrical & Lighting'].includes(formData.category) ? 'e.g. Omni, Philips' :
                                                    ['Pipes','Plumbing Materials'].includes(formData.category) ? 'e.g. Neltex, Atlanta' :
                                                    ['Padlocks','Door Locksets'].includes(formData.category) ? 'e.g. Yale, Solex' :
                                                    ['Construction Tools'].includes(formData.category) ? 'e.g. Stanley, DeWalt' :
                                                    'e.g. Brand name'
                                                }
                                            />
                                        </div>
                                        )}
                                        <div className={!categoryFieldRules.showBrand ? 'col-span-2' : ''}>
                                            <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Product Name <span className="text-red-400">*</span></label>
                                            <input 
                                                type="text" 
                                                value={formData.name}
                                                onChange={e => setFormData({...formData, name: e.target.value})}
                                                required
                                                className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                placeholder={
                                                    ['Paints'].includes(formData.category) ? 'e.g. Flat Latex, Enamel' :
                                                    ['Lumbers'].includes(formData.category) ? 'e.g. Coco Lumber, Good Lumber' :
                                                    ['Steel Bars'].includes(formData.category) ? 'e.g. Deformed Bar' :
                                                    ['Plywoods'].includes(formData.category) ? 'e.g. Marine Plywood' :
                                                    ['Pipes'].includes(formData.category) ? 'e.g. GI Pipe, PVC Pipe' :
                                                    ['Cement, Sand & Gravel'].includes(formData.category) ? 'e.g. Portland Cement' :
                                                    ['Bolts, Nuts, Screws & Nails'].includes(formData.category) ? 'e.g. Common Nail, Hex Bolt' :
                                                    ['Electrical & Lighting'].includes(formData.category) ? 'e.g. THHN Wire, LED Bulb' :
                                                    'e.g. Product name'
                                                }
                                            />
                                        </div>
                                    </div>
                                    {(categoryFieldRules.showColor || categoryFieldRules.showSize) && (
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {categoryFieldRules.showColor && (
                                        <div className={!categoryFieldRules.showSize ? 'col-span-2' : ''}>
                                            <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Color / Variant</label>
                                            <input 
                                                type="text" 
                                                value={formData.color}
                                                onChange={e => setFormData({...formData, color: e.target.value})}
                                                required={categoryFieldRules.requireColor}
                                                className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                placeholder={
                                                    ['Paints','Thinners'].includes(formData.category) ? 'e.g. White, Red, Blue' :
                                                    ['Pipes'].includes(formData.category) ? 'e.g. Orange, Blue' :
                                                    ['Galvanized Sheets'].includes(formData.category) ? 'e.g. Plain, Corrugated' :
                                                    ['Adhesives & Tapes'].includes(formData.category) ? 'e.g. Clear, Brown' :
                                                    ['Ropes & Chains'].includes(formData.category) ? 'e.g. Nylon, Steel' :
                                                    'e.g. Color or variant'
                                                }
                                            />
                                        </div>
                                        )}
                                        {categoryFieldRules.showSize && (
                                        <div className={!categoryFieldRules.showColor ? 'col-span-2' : ''}>
                                            <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">
                                                {getCategoryConfig(formData.category).sizeLabel} {categoryFieldRules.requireSize && <span className="text-red-400">*</span>}
                                            </label>
                                            <div className="flex gap-1.5 items-center">
                                                <input 
                                                    type="text" 
                                                    value={formData.size}
                                                    onChange={e => setFormData({...formData, size: e.target.value})}
                                                    required={categoryFieldRules.requireSize}
                                                    className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                    placeholder={getCategoryConfig(formData.category).sizePlaceholder}
                                                />
                                                <select
                                                    value={formData.sizeUnit}
                                                    onChange={e => setFormData({...formData, sizeUnit: e.target.value})}
                                                    className="w-20 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] font-bold focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white cursor-pointer"
                                                    aria-label="Size unit"
                                                >
                                                    <option value="" disabled hidden>Unit</option>
                                                    {(getCategoryConfig(formData.category).sizeUnits || []).map(u => (
                                                        <option key={u} value={u}>{u}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Section 3: Pricing & Stock ── */}
                            <div>
                                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Pricing & Stock</p>
                                <div className="grid grid-cols-2 gap-2.5">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Price (₱) <span className="text-red-400">*</span></label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                <span className="text-gray-400 font-bold text-xs">₱</span>
                                            </div>
                                            <input 
                                                type="text"
                                                inputMode="decimal"
                                                pattern="^[0-9]*\.?[0-9]*$"
                                                value={formData.price}
                                                onChange={e => {
                                                    let v = e.target.value || '';
                                                    v = v.replace(/[,]/g, '.');
                                                    v = v.replace(/[^0-9.]/g, '');
                                                    const parts = v.split('.');
                                                    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
                                                    setFormData({ ...formData, price: v });
                                                }}
                                                onBlur={() => {
                                                    const raw = (formData.price || '').toString();
                                                    if (raw.trim() === '') {
                                                        setFormData(prev => ({ ...prev, price: '0' }));
                                                        return;
                                                    }
                                                    const num = parseFloat(raw.replace(/,/g, '.')) || 0;
                                                    const formatted = num.toFixed(2);
                                                    setFormData(prev => ({ ...prev, price: formatted }));
                                                }}
                                                className="w-full pl-7 pr-2 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">
                                            {modalMode === 'add' ? 'Initial Stock' : 'Stock Correction'} <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={formData.stock}
                                            onChange={e => setFormData({ ...formData, stock: e.target.value })}
                                            className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                            placeholder="0"
                                            required
                                        />
                                        {modalMode === 'edit' && <p className="text-[10px] text-gray-400 mt-0.5">Use Inventory page for daily stock ops.</p>}
                                    </div>
                                </div>
                            </div>

                            {/* ── Section 4: Supplier ── */}
                            {categoryFieldRules.showSupplier && (
                            <div>
                                <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Supplier</p>
                                <div className="w-full relative" ref={node => {
                                    if (node) {
                                        const handleClickOutside = (e) => {
                                            if (!node.contains(e.target)) setIsSupplierDropdownOpen(false);
                                        };
                                        document.addEventListener('mousedown', handleClickOutside);
                                        return () => document.removeEventListener('mousedown', handleClickOutside);
                                    }
                                }}>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            value={formData.supplier || ''}
                                            onChange={e => {
                                                setFormData({...formData, supplier: e.target.value});
                                                if (!isSupplierDropdownOpen) setIsSupplierDropdownOpen(true);
                                            }}
                                            onFocus={() => setIsSupplierDropdownOpen(true)}
                                            required
                                            className="w-full pl-3 pr-10 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                            placeholder="Select or type supplier name..."
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setIsSupplierDropdownOpen(!isSupplierDropdownOpen)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-600"
                                        >
                                           <svg className={`w-4 h-4 transition-transform ${isSupplierDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </button>
                                    </div>
                                    
                                    {isSupplierDropdownOpen && (
                                        <ul className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 max-h-36 overflow-y-auto shadow-xl rounded-lg animate-in fade-in zoom-in-95 duration-100">
                                            {suggestedSuppliers.length === 0 && (
                                                <li className="p-3 text-xs text-center text-gray-400 italic">Type to add new...</li>
                                            )}
                                            {suggestedSuppliers.map(s => (
                                                <li 
                                                    key={s} 
                                                    className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border-b border-gray-50 dark:border-gray-600/50 last:border-0 ${formData.supplier === s ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-700 dark:text-gray-200'}`}
                                                    onClick={() => {
                                                        setFormData({...formData, supplier: s});
                                                        setIsSupplierDropdownOpen(false);
                                                    }}
                                                >
                                                    <span>{s}</span>
                                                    {formData.supplier === s && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                            )}

                            {/* Submit */}
                            <button 
                                type="submit"
                                disabled={!isFormModified}
                                style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                                className={`w-full py-2.5 text-white rounded-xl font-bold uppercase tracking-widest shadow-lg transition-all transform text-xs mt-1 ${
                                    isFormModified 
                                    ? 'hover:-translate-y-0.5 hover:opacity-90' 
                                    : 'cursor-not-allowed opacity-50'
                                }`}
                            >
                                {modalMode === 'add' ? 'Create Product' : 'Save Changes'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Archive Confirmation Modal */}
            {isArchiveModalOpen && productToArchive && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center">
                            <div className={`mx-auto flex items-center justify-center mb-4 ${productToArchive.isArchived ? 'text-emerald-600' : 'text-red-600'}`}>
                                {productToArchive.isArchived ? (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                ) : (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                )}
                            </div>
                            <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">
                                {productToArchive.isArchived ? 'Restore Product?' : 'Archive Product?'}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                Are you sure you want to {productToArchive.isArchived ? 'restore' : 'archive'} <span className="font-bold text-gray-900 dark:text-white">{productToArchive.name}</span>?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsArchiveModalOpen(false)}
                                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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

export default ProductList;