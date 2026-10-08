import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Pagination from '../components/Pagination';
import TableSkeletonRows from '../components/TableSkeletonRows';
import IdentifierChip from '../components/IdentifierChip';
import ArchiveIcon from '../components/ArchiveIcon';
import EditIcon from '../components/EditIcon';
import TableActionButton from '../components/TableActionButton';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { createClientRequestId } from '../utils/clientRequestId';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { createProductApi, updateProductApi, listPartnersApi, listProductsApi } from '../services/inventoryApi';
import { getStockStatus } from '../utils/recommendationLogic';
import { formatMoney } from '../utils/numberFormat';
import { normalizeHumanReadable } from '../utils/textNormalization';
import {
    formatMoneyInput,
    isMoneyInput,
    isMoneyInputTooLarge,
    isWholeNumberInput,
    preventInvalidMoneyKeyDown,
    preventInvalidMoneyPaste,
    preventInvalidWholeNumberKeyDown,
    preventInvalidWholeNumberPaste,
    sanitizeMoneyInput,
    sanitizeWholeNumberInput,
} from '../utils/numericInput';

const ProductList = () => {
    const listContainerRef = useRef(null);
    const searchContainerRef = useRef(null);
    const productImageInputRef = useRef(null);
    const productSubmitInFlightRef = useRef(false);
    const productCreateRequestIdRef = useRef('');
    const productArchiveInFlightRef = useRef(false);
    const { appSettings: settings, currentUserName, ROLES, isAdminOrAbove } = useAuth();
    const { inventory, setInventory, logAction, logActivity, categories: customCategories = [], isInventoryLoading } = useInventory();

    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [sortBy, setSortBy] = useState('off');
    const [isSearchSuggestionOpen, setIsSearchSuggestionOpen] = useState(false);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
    const [productToArchive, setProductToArchive] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSavingProduct, setIsSavingProduct] = useState(false);
    const [isArchiveSubmitting, setIsArchiveSubmitting] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
    const [editingProduct, setEditingProduct] = useState(null);
    const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false); // Custom dropdown state
    const [supplierPartners, setSupplierPartners] = useState([]);
    const [enlargedProductImage, setEnlargedProductImage] = useState(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    
    const loadSupplierPartners = useCallback(async () => {
        try {
            const rows = await listPartnersApi({ type: 'supplier', includeArchived: false });

            setSupplierPartners(Array.isArray(rows) ? rows : []);
        } catch {
            setSupplierPartners([]);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            await loadSupplierPartners();
            if (cancelled) return;
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [loadSupplierPartners]);

    useEffect(() => {
        const token = getAuthToken();
        if (!token) {
            return undefined;
        }

        const unsubscribe = subscribeRealtimeEvent('partners.updated', () => {
            void loadSupplierPartners();
        });

        return () => {
            unsubscribe();
        };
    }, [loadSupplierPartners]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchTerm]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!searchContainerRef.current?.contains(event.target)) {
                setIsSearchSuggestionOpen(false);
                setActiveSuggestionIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Active filter count for Clear All visibility (status + sort; category has its own control)
    const activeFilterCount = (statusFilter !== 'All' ? 1 : 0) + (sortBy !== 'off' ? 1 : 0);

    const deriveStatus = (item) => getStockStatus(item, settings);

    const getStockBadgeClass = (item) => {
        const status = deriveStatus(item);
        if (status === 'Out of Stock') return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
        if (status === 'Low Stock') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    };

    const getProductImageUrl = (product) => String(product?.imageUrl || '').trim();

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
        const firstDbCategory = customCategories.find(
            (c) => c?.isActive !== false && String(c?.name || '').trim()
        )?.name;
        return firstDbCategory || 'General';
    }, [customCategories]);

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

    const getCategorySizeUnits = (catName) => getCategoryConfig(catName).sizeUnits || [];
    const getDefaultSizeUnit = (catName) => getCategorySizeUnits(catName)[0] || '';
    
    // Keep category list aligned with active custom categories from Settings.
    const CATEGORY_LIST = useMemo(() => {
        const dynamicCats = customCategories
            .filter((c) => c?.isActive !== false)
            .map((c) => String(c?.name || '').trim())
            .filter(Boolean);

        if (dynamicCats.length > 0) {
            return [...new Set(dynamicCats)].sort((a, b) => a.localeCompare(b));
        }

        return ['General'];
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
        imageUrl: '',
        category: defaultCategory,
        size: '',
        sizeUnit: getDefaultSizeUnit(defaultCategory),
        price: '',
        stock: '',
        supplier: '',
    };
    const [formData, setFormData] = useState(initialFormState);
    const categoryFieldRules = useMemo(() => getCategoryFieldRules(formData.category), [formData.category]);

    const supplierPartnerNames = useMemo(() => {
        return [...new Set((supplierPartners || [])
            .map((row) => String(row?.name || '').trim())
            .filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }, [supplierPartners]);

    // Derived suppliers list (strictly from supplier partners, no inventory fallback).
    const suggestedSuppliers = useMemo(() => supplierPartnerNames, [supplierPartnerNames]);

    useEffect(() => {
        if (!isModalOpen || !categoryFieldRules.showSupplier) return;

        const currentSupplier = String(formData?.supplier || '').trim();
        if (!currentSupplier) return;

        const hasMatch = supplierPartnerNames.some(
            (name) => name.toLowerCase() === currentSupplier.toLowerCase()
        );

        if (!hasMatch) {
            setFormData((prev) => ({ ...prev, supplier: '' }));
        }
    }, [categoryFieldRules.showSupplier, formData?.supplier, isModalOpen, supplierPartnerNames]);

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

    const handleProductImageChange = (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            showToast('Invalid Image', 'Please select a JPG, PNG, or WebP image.', 'error', 'product-image');
            event.target.value = '';
            return;
        }

        const maxImageSize = 2 * 1024 * 1024;
        if (file.size > maxImageSize) {
            showToast('Image Too Large', 'Please choose an image under 2 MB.', 'error', 'product-image');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            setFormData((prev) => ({
                ...prev,
                imageUrl: typeof reader.result === 'string' ? reader.result : '',
            }));
        };
        reader.onerror = () => {
            showToast('Image Error', 'We could not read that image file.', 'error', 'product-image');
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const clearProductImage = () => {
        setFormData((prev) => ({
            ...prev,
            imageUrl: '',
        }));

        if (productImageInputRef.current) {
            productImageInputRef.current.value = '';
        }
    };

    const openProductImagePreview = (product) => {
        const imageUrl = getProductImageUrl(product);
        if (!imageUrl) return;
        setEnlargedProductImage({
            src: imageUrl,
            alt: product.name || product.code || 'Product image',
            code: product?.code || imageUrl,
        });
    };

    const navigateProductImagePreview = (direction) => {
        if (!enlargedProductImage || previewableProducts.length <= 1) return;

        const currentIndex = previewableProducts.findIndex((product) => {
            const imageUrl = getProductImageUrl(product);
            return product.code === enlargedProductImage.code || imageUrl === enlargedProductImage.src;
        });

        if (currentIndex < 0) return;

        const nextIndex = (currentIndex + direction + previewableProducts.length) % previewableProducts.length;
        const nextProduct = previewableProducts[nextIndex];

        setEnlargedProductImage({
            src: getProductImageUrl(nextProduct),
            alt: nextProduct.name || nextProduct.code || 'Product image',
            code: nextProduct?.code || getProductImageUrl(nextProduct),
        });
    };

    const closeProductImagePreview = () => {
        setEnlargedProductImage(null);
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

    const categoryFilterOptions = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
    const filteredProductsBase = useMemo(() => {
        const normalizedQuery = debouncedSearchTerm.toLowerCase();

        return inventory.filter(item => {
            const matchesSearch = item.name.toLowerCase().includes(normalizedQuery) || 
                                item.code.toLowerCase().includes(normalizedQuery) ||
                                (item.brand || '').toLowerCase().includes(normalizedQuery) ||
                                (item.color || '').toLowerCase().includes(normalizedQuery);
            
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
    }, [inventory, debouncedSearchTerm, statusFilter, categoryFilter, settings]);

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

    const previewableProducts = useMemo(() => {
        return filteredProducts.filter((product) => getProductImageUrl(product));
    }, [filteredProducts]);

    useEffect(() => {
        if (!enlargedProductImage) return;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeProductImagePreview();
                return;
            }

            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                navigateProductImagePreview(-1);
                return;
            }

            if (event.key === 'ArrowRight') {
                event.preventDefault();
                navigateProductImagePreview(1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enlargedProductImage, previewableProducts]);

    const searchSuggestions = useMemo(() => {
        const query = String(searchTerm || '').trim().toLowerCase();
        if (!query) {
            return [];
        }

        const results = inventory
            .filter((item) => {
                const name = String(item?.name || '').toLowerCase();
                const code = String(item?.code || '').toLowerCase();
                const brand = String(item?.brand || '').toLowerCase();
                const category = String(item?.category || '').toLowerCase();
                const color = String(item?.color || '').toLowerCase();

                return (
                    name.includes(query) ||
                    code.includes(query) ||
                    brand.includes(query) ||
                    category.includes(query) ||
                    color.includes(query)
                );
            })
            .map((item) => {
                const name = String(item?.name || '');
                const code = String(item?.code || '');
                const brand = String(item?.brand || '');
                const category = String(item?.category || '');
                const color = String(item?.color || '');
                const nameLower = name.toLowerCase();
                const codeLower = code.toLowerCase();
                const brandLower = brand.toLowerCase();
                const categoryLower = category.toLowerCase();
                const colorLower = color.toLowerCase();

                let score = 99;
                let queryValue = name || code;

                if (codeLower.startsWith(query)) {
                    score = 0;
                    queryValue = code;
                } else if (nameLower.startsWith(query)) {
                    score = 1;
                    queryValue = name;
                } else if (nameLower.includes(query)) {
                    score = 2;
                    queryValue = name;
                } else if (brandLower.startsWith(query) || categoryLower.startsWith(query) || colorLower.startsWith(query)) {
                    score = 3;
                    queryValue = name || code;
                } else {
                    score = 4;
                }

                return {
                    key: code || `${name}-${category}`,
                    title: name || code,
                    meta: [code, category, brand].filter(Boolean).join(' • '),
                    queryValue,
                    score,
                };
            })
            .sort((a, b) => {
                if (a.score !== b.score) return a.score - b.score;
                return a.title.localeCompare(b.title);
            })
            .slice(0, 8);

        return results;
    }, [inventory, searchTerm]);

    const handleSearchSuggestionSelect = (suggestion) => {
        setSearchTerm(suggestion.queryValue);
        setIsSearchSuggestionOpen(false);
        setActiveSuggestionIndex(-1);
    };

    const handleSearchKeyDown = (event) => {
        if (!isSearchSuggestionOpen || searchSuggestions.length === 0) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveSuggestionIndex((prev) => {
                const next = prev + 1;
                return next >= searchSuggestions.length ? 0 : next;
            });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveSuggestionIndex((prev) => {
                const next = prev - 1;
                return next < 0 ? searchSuggestions.length - 1 : next;
            });
            return;
        }

        if (event.key === 'Enter') {
            if (activeSuggestionIndex >= 0) {
                event.preventDefault();
                handleSearchSuggestionSelect(searchSuggestions[activeSuggestionIndex]);
            }
            return;
        }

        if (event.key === 'Escape') {
            setIsSearchSuggestionOpen(false);
            setActiveSuggestionIndex(-1);
        }
    };

    // Pagination Logic
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const paginatedProducts = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);

    React.useEffect(() => {
        setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
    }, [totalPages]);

    // Reset page when filters change
    React.useEffect(() => { setCurrentPage(1); }, [searchTerm, statusFilter, categoryFilter, sortBy]);

    useEffect(() => {
        if (!listContainerRef.current) return;
        listContainerRef.current.scrollTop = 0;
    }, [currentPage]);

    // Check for changes (Memoized)
    const isFormModified = useMemo(() => {
        if (modalMode === 'add') return true;
        if (modalMode === 'edit' && editingProduct) {
            const stockVal = parseInt(formData.stock);
            const combinedSize = resolveCombinedSize(formData.size, formData.sizeUnit, formData.category);
            return (
                formData.name !== editingProduct.name ||
                String(formData.code || '').trim().toUpperCase() !== editingProduct.code ||
                (formData.brand || '') !== (editingProduct.brand || '') ||
                (formData.color || '') !== (editingProduct.color || '') ||
                (formData.imageUrl || '') !== (editingProduct.imageUrl || '') ||
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
        productCreateRequestIdRef.current = '';
        setModalMode('add');
        setFormData({
            ...initialFormState,
            sizeUnit: getDefaultSizeUnit(initialFormState.category)
        });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (product) => {
        productCreateRequestIdRef.current = '';
        setModalMode('edit');
        setEditingProduct(product);
        const parsed = parseSizeString(product.size || '', product.category);
        setFormData({
            code: product.code,
            brand: product.brand || '',
            name: product.name,
            color: product.color || '',
            imageUrl: product.imageUrl || '',
            category: product.category,
            size: parsed.value,
            sizeUnit: parsed.unit,
            price: product.price,
            stock: product.stock,
            supplier: product.supplier || 'Local Supplier',
        });
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (productSubmitInFlightRef.current) return;
        if (!navigator.onLine) {
            showToast("You're Offline", 'This action requires an internet connection.', 'warning', 'product-offline');
            return;
        }

        const rules = getCategoryFieldRules(formData.category);
        const normalizedBrand = rules.showBrand ? normalizeHumanReadable(formData.brand) : '';
        const normalizedColor = rules.showColor ? normalizeHumanReadable(formData.color) : '';
        const normalizedSupplier = rules.showSupplier ? String(formData.supplier || '').trim() : '';
        const supplierExists = supplierPartnerNames.some(
            (name) => name.toLowerCase() === normalizedSupplier.toLowerCase()
        );
        const combinedSize = rules.showSize
            ? resolveCombinedSize(formData.size, formData.sizeUnit, formData.category)
            : '';
        const normalizedPrice = formatMoneyInput(formData.price);
        
        // Basic Validation
        const normalizedSku = String(formData.code || '').trim().toUpperCase();
        if ((!normalizedSku && modalMode === 'edit') || !formData.name || String(formData.price ?? '').trim() === '') {
            showToast("Missing Fields", "Please fill in all required fields.", "error", "product-validation");
            return;
        }

        if (!isMoneyInput(normalizedPrice)) {
            showToast('Invalid Price', isMoneyInputTooLarge(normalizedPrice) ? 'Amount is too large. Please enter a smaller value.' : 'Price must be a non-negative number with up to 2 decimal places.', 'error', 'product-validation');
            return;
        }

        if (modalMode === 'add' && !isWholeNumberInput(formData.stock)) {
            showToast('Invalid Stock', 'Initial stock must be a non-negative whole number.', 'error', 'product-validation');
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

        if (rules.showSupplier && normalizedSupplier && !supplierExists) {
                showToast('Invalid Supplier', 'Supplier must be selected from Supplier Partners.', 'error', 'product-validation');
                return;
        }

        productSubmitInFlightRef.current = true;
        setIsSavingProduct(true);
        try {
            const maxStockLimit = (settings && settings.maxStockLimit) ? parseInt(settings.maxStockLimit) : 100;
            if (modalMode === 'add') {
            let stockVal = Number(formData.stock);
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
            const cleanedName = normalizeHumanReadable(normalized.name);
            const finalSize = combinedSize || normalized.size || '';
            const newProduct = {
                ...formData,
                code: normalizedSku,
                name: cleanedName,
                brand: normalizedBrand,
                color: normalizedColor,
                imageUrl: String(formData.imageUrl || '').trim(),
                size: finalSize,
                price: Number(normalizedPrice),
                stock: stockVal,
                supplier: normalizedSupplier || 'Local Supplier',
                clientRequestId: productCreateRequestIdRef.current || (productCreateRequestIdRef.current = createClientRequestId('product')),
            };
            newProduct.status = deriveStatus(newProduct);
            delete newProduct.sizeUnit;

            let productToInsert;
            try {
                productToInsert = await createProductApi(newProduct);
            } catch (error) {
                showToast(
                    isApiConnectionFailure(error) ? 'Cannot reach API server.' : 'Unable to Save Product',
                    error.message || 'Product was not saved.',
                    'error',
                    'product-sync'
                );
                return;
            }

            setInventory(prev => [...prev, productToInsert]);
            log('CREATE', productToInsert.code, `Created new product: ${newProduct.name}`);
            logActivity(currentUserName, 'Created Product', `${productToInsert.code} - ${newProduct.name}`);
            showToast("Product Created", `${newProduct.name} has been added.`, "success", "product-action");
        } else {
            // Update Logic
            const normalized = normalizeProductNameAndSize(formData.name, formData.category, combinedSize);
            const cleanedName = normalizeHumanReadable(normalized.name);
            const finalSize = combinedSize || normalized.size || '';
            // Check for changes
            const hasChanges = 
                cleanedName !== editingProduct.name ||
                normalizedSku !== editingProduct.code ||
                normalizedBrand !== (editingProduct.brand || '') ||
                normalizedColor !== (editingProduct.color || '') ||
                (String(formData.imageUrl || '').trim()) !== (String(editingProduct.imageUrl || '').trim()) ||
                formData.category !== editingProduct.category ||
                (finalSize || '') !== (editingProduct.size || '') ||
                parseFloat(formData.price) !== editingProduct.price ||
                (normalizedSupplier || 'Local Supplier') !== (editingProduct.supplier || 'Local Supplier');

            if (!hasChanges) {
               setIsModalOpen(false);
               return; 
            }

            const { sizeUnit: _su, ...saveData } = formData;
            const localUpdatedProduct = {
                ...editingProduct,
                ...saveData,
                code: normalizedSku,
                name: cleanedName,
                brand: normalizedBrand,
                color: normalizedColor,
                imageUrl: String(formData.imageUrl || '').trim(),
                size: finalSize,
                price: Number(normalizedPrice),
                stock: editingProduct.stock,
                supplier: normalizedSupplier || 'Local Supplier',
            };
            localUpdatedProduct.status = deriveStatus(localUpdatedProduct);

            if (!editingProduct?.id) {
                showToast('Unable to Save Product', 'Unable to identify the product to update.', 'error', 'product-sync');
                return;
            }

            let mergedUpdatedProduct;
            try {
                mergedUpdatedProduct = await updateProductApi(editingProduct.id, localUpdatedProduct, {
                    expectedUpdatedAt: editingProduct.updatedAt,
                });
            } catch (error) {
                if (Number(error?.status || 0) === 409) {
                    if (/SKU already exists/i.test(error.message || '')) {
                        showToast('Duplicate SKU', error.message, 'error', 'product-duplicate');
                        return;
                    }
                    showToast('Conflict Detected', 'This product was edited in another session. Data was refreshed.', 'warning', 'product-conflict');
                    try {
                        const remoteProducts = await listProductsApi();
                        if (Array.isArray(remoteProducts)) {
                            setInventory(remoteProducts);
                        }
                    } catch {
                        // Keep current UI state if refresh fails.
                    }
                    setIsModalOpen(false);
                    return;
                }
                showToast(
                    isApiConnectionFailure(error) ? 'Cannot reach API server.' : 'Unable to Save Product',
                    error.message || 'Product update was not saved.',
                    'error',
                    'product-sync'
                );
                return;
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
        productCreateRequestIdRef.current = '';
        } finally {
            productSubmitInFlightRef.current = false;
            setIsSavingProduct(false);
        }
    };

    // Soft Delete / Archive Logic (Modified to use Modal)
    const toggleArchive = (item) => {
        setProductToArchive(item);
        setIsArchiveModalOpen(true);
    };

    const confirmArchive = async () => {
        if (!productToArchive) return;
        if (productArchiveInFlightRef.current) return;
        if (!navigator.onLine) {
            showToast("You're Offline", 'This action requires an internet connection.', 'warning', 'product-offline');
            return;
        }

        const item = productToArchive;
        if (!item.id) {
            showToast('Unable to Update Product', 'Unable to identify the product to update.', 'error', 'product-archive');
            return;
        }

        productArchiveInFlightRef.current = true;
        setIsArchiveSubmitting(true);
        try {
            const updatedProduct = await updateProductApi(item.id, {
                ...item,
                isArchived: !item.isArchived,
            }, {
                expectedUpdatedAt: item.updatedAt,
            });

            setInventory((previous) => previous.map((product) => (
                product.id === item.id ? updatedProduct : product
            )));
            showToast(item.isArchived ? 'Product Restored' : 'Product Archived', `${item.name} has been ${item.isArchived ? 'restored' : 'archived'}.`, 'success', 'product-archive');

            setIsArchiveModalOpen(false);
            setProductToArchive(null);
        } catch (error) {
            if (Number(error?.status || 0) === 409) {
                showToast('Conflict Detected', 'This product was updated in another session. Please refresh and try again.', 'warning', 'product-conflict');
            } else {
                showToast(
                    isApiConnectionFailure(error) ? 'Cannot reach API server.' : 'Unable to Update Product',
                    error.message || 'Product archive status was not saved.',
                    'error',
                    'product-archive'
                );
            }
        } finally {
            productArchiveInFlightRef.current = false;
            setIsArchiveSubmitting(false);
        }
    };

    const stockLegendItems = [
        {
            key: 'in-stock',
            label: 'In Stock',
            description: 'Good quantity available',
            dotClass: 'bg-green-500',
            chipClass: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800',
        },
        {
            key: 'low-stock',
            label: 'Low Stock',
            description: 'Reorder soon',
            dotClass: 'bg-yellow-500',
            chipClass: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800',
        },
        {
            key: 'out-of-stock',
            label: 'Out of Stock',
            description: 'No quantity left',
            dotClass: 'bg-red-500',
            chipClass: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
        },
    ];

    const activeProductCount = useMemo(
        () => inventory.filter((item) => !item.isArchived).length,
        [inventory]
    );
    const inactiveProductCount = useMemo(
        () => inventory.filter((item) => item.isArchived).length,
        [inventory]
    );
    const totalProductCount = activeProductCount + inactiveProductCount;

    return (
        <div className="h-auto md:h-[calc(100vh-80px)] flex flex-col gap-2 md:overflow-hidden">

             {/* Unified Product List Container */}
             <div className="flex flex-col bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 md:overflow-hidden p-4 gap-4 md:flex-1 h-auto">
                 
                 {/* Header Section */}
                 <div className="flex items-center justify-between md:shrink-0">
                    <div>
                        <div>
                            <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Product Master List</p>
                            <p className="text-gray-500 dark:text-gray-400 text-[11px] md:text-xs font-medium mt-0.5">Manage catalog, prices, and stock levels</p>
                        </div>
                    </div>
                 </div>

             {/* Header Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:shrink-0">
                <div className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">Total Products</p>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{totalProductCount}</h2>
                        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                            {activeProductCount} active
                            <span className="mx-1 text-gray-300">•</span>
                            {inactiveProductCount} inactive
                        </p>
                    </div>
                     <div className="bg-gray-900 dark:bg-gray-700 p-2 rounded-lg text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                    </div>
                </div>
                {isAdminOrAbove() && (
                <div className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">Total Value</p>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">₱{formatMoney(inventory.filter(i => !i.isArchived).reduce((acc, item) => acc + (item.price * item.stock), 0))}</h2>
                    </div>
                    <div className="bg-gray-900 dark:bg-gray-700 p-2 rounded-lg text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>
                )}
                <div className="bg-white dark:bg-gray-900 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between transition-colors">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">Categories</p>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{categoryFilterOptions.length - 1}</h2>
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
                        <div ref={searchContainerRef} className="main-toolbar-search group">
                             <input 
                                type="text" 
                                placeholder="Search products..." 
                                value={searchTerm}
                                onChange={e => {
                                    const nextValue = e.target.value;
                                    setSearchTerm(nextValue);
                                    setIsSearchSuggestionOpen(Boolean(nextValue.trim()));
                                    setActiveSuggestionIndex(-1);
                                }}
                                onFocus={() => {
                                    if (String(searchTerm || '').trim()) {
                                        setIsSearchSuggestionOpen(true);
                                    }
                                }}
                                onKeyDown={handleSearchKeyDown}
                                className="main-toolbar-search-input"
                            />
                            <div className="main-toolbar-search-icon">
                                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>

                            {isSearchSuggestionOpen && String(searchTerm || '').trim().length > 0 && (
                                <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden z-40">
                                    {searchSuggestions.length > 0 ? (
                                        <div className="max-h-64 overflow-y-auto py-1">
                                            {searchSuggestions.map((suggestion, index) => (
                                                <button
                                                    type="button"
                                                    key={suggestion.key}
                                                    onClick={() => handleSearchSuggestionSelect(suggestion)}
                                                    className={`w-full text-left px-3 py-2 transition-colors ${
                                                        activeSuggestionIndex === index
                                                            ? 'bg-gray-100 dark:bg-gray-700'
                                                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/70'
                                                    }`}
                                                >
                                                    <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">{suggestion.title}</div>
                                                    {suggestion.meta && (
                                                        <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{suggestion.meta}</div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="px-3 py-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">No suggestions found</div>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        {/* Filter & Sort Panel */}
                        <div className="relative z-20 ml-2 sm:ml-2 inline-flex items-center gap-3">
                            <button 
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                className="shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-xl font-medium text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                                <span>Filter & Sort</span>
                                <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>

                            {/* Category select (adjacent to Filter & Sort) */}
                            <div className="hidden sm:inline-flex items-center">
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="appearance-none px-2.5 py-1.5 rounded-xl text-xs font-medium inline-flex items-center transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
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
                                        <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Status</div>
                                    </div>
                                    <div className="px-2 pb-2 flex flex-wrap gap-1">
                                        {['All', 'In Stock', 'Low Stock', 'Out of Stock', 'Archived'].map(status => (
                                            <button key={status} onClick={() => setStatusFilter(status)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
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
                                        <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sort By</div>
                                    </div>
                                    <div className="px-2 pb-2">
                                        {[
                                            { key: 'off', label: 'Default' },
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
                                                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
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
                                                    className="w-full text-center px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">
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
                        className="w-full sm:w-auto px-3 py-1.5 rounded-lg text-white font-semibold text-xs shadow-md flex items-center justify-center gap-1.5 transition-all hover:opacity-90 transform hover:-translate-y-0.5"
                        style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        Add Product
                    </button>
                    )}
                </div>

                <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
                    {stockLegendItems.map((item) => (
                        <span
                            key={item.key}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-semibold ${item.chipClass}`}
                        >
                            <span className={`w-2 h-2 rounded-full ${item.dotClass}`} aria-hidden="true" />
                            <span>{item.label}</span>
                        </span>
                    ))}
                </div>

                {/* Backdrop for closing panel */}
                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-10 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}

                 {/* Data Table */}
                <div ref={listContainerRef} className="w-full md:flex-1 md:overflow-y-auto px-1 md:px-3 pb-3 overflow-x-auto">
                    <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-175 md:min-w-225">
                        <thead className="sticky top-0 z-10 shadow-sm">
                            <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                                <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-[10%]">SKU</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-[10%]">Photo</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-[25%]">Product</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-[20%]">Category</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-[15%]">Price</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-[15%]">Stock</th>
                                {isAdminOrAbove() && <th className="px-4 py-2 text-[11px] font-semibold text-center border border-gray-700 w-42.5">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                            {isInventoryLoading ? (
                                <TableSkeletonRows
                                    rowKeyPrefix="products-skeleton"
                                    columnTypes={[...Array(6).fill('text'), ...(isAdminOrAbove() ? ['actions'] : [])]}
                                />
                            ) : filteredProducts.length === 0 ? (
                                <tr>
                                    <td colSpan={isAdminOrAbove() ? "7" : "6"} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
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
                                        <td className={`px-4 py-1.5 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700`}>
                                            <IdentifierChip className={product.isArchived ? 'opacity-60' : ''}>{product.code}</IdentifierChip>
                                        </td>
                                        {/* Photo */}
                                        <td className="px-4 py-1.5 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700">
                                            {product.imageUrl ? (
                                                <button
                                                    type="button"
                                                    onClick={() => openProductImagePreview(product)}
                                                    className={`group/photo mx-auto relative h-12 w-12 rounded-xl overflow-hidden border flex items-center justify-center transition-transform duration-150 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-300 ${
                                                        product.isArchived
                                                            ? 'bg-gray-50 border-gray-100 dark:bg-gray-800 dark:border-gray-700'
                                                            : 'bg-gray-100 border-gray-200 dark:bg-gray-700 dark:border-gray-600'
                                                    }`}
                                                    aria-label={`Enlarge image for ${product.name}`}
                                                >
                                                    <img
                                                        src={product.imageUrl}
                                                        alt={product.name}
                                                        className={`h-full w-full object-cover transition-all duration-200 group-hover/photo:scale-110 group-hover/photo:opacity-35 group-hover/photo:blur-[1.5px] ${product.isArchived ? 'opacity-40 grayscale' : ''}`}
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/0 opacity-0 transition-all duration-150 group-hover/photo:bg-black/45 group-hover/photo:opacity-100">
                                                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-gray-900 shadow-md ring-1 ring-black/5">
                                                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 3H3v5M3 3l6 6M16 3h5v5m0-5l-6 6M8 21H3v-5m0 5l6-6M16 21h5v-5m0 5l-6-6"></path>
                                                            </svg>
                                                        </span>
                                                    </div>
                                                </button>
                                            ) : (
                                                <div className="mx-auto h-12 w-12 rounded-xl border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 flex items-center justify-center text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                                                    IMG
                                                </div>
                                            )}
                                        </td>
                                        {/* Product (Brand + Name) */}
                                        <td className="px-4 py-1.5 whitespace-nowrap border border-gray-200 dark:border-gray-700">
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className={`text-sm font-semibold leading-tight truncate ${product.isArchived ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                                                        {product.name}
                                                    </span>
                                                    {product.brand && (
                                                        <span className={`shrink-0 text-[10px] font-medium leading-tight px-1.5 py-0.5 rounded-md ${product.isArchived ? 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                                                            {product.brand}
                                                        </span>
                                                    )}
                                                    {product.isArchived && (
                                                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-semibold uppercase">Archived</span>
                                                    )}
                                                </div>
                                                {(product.size || product.color) && (
                                                    <div className="mt-1 flex items-center gap-1.5 min-w-0">
                                                        <span className={`min-w-0 truncate px-1.5 py-0.5 rounded text-[10px] font-medium border ${product.isArchived ? 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-600 dark:border-gray-700' : 'bg-gray-50 text-black border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600'}`}>
                                                            {product.size ? `Size: ${product.size}` : ''}{product.size && product.color ? ' • ' : ''}{product.color ? `Color: ${product.color}` : ''}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        
                                        {/* Category */}
                                        <td className={`px-4 py-1.5 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700`}>
                                            <span className={`px-2.5 py-1.5 rounded-md text-xs font-semibold ${product.isArchived ? 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{product.category}</span>
                                        </td>
                                        {/* Price */}
                                        <td className={`px-4 py-1.5 whitespace-nowrap text-sm font-semibold text-center border border-gray-200 dark:border-gray-700 tabular-nums ${product.isArchived ? 'text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-white'}`}>
                                            ₱{formatMoney(product.price)}
                                        </td>
                                        {/* Stock */}
                                        <td className="px-4 py-1.5 whitespace-nowrap text-center border border-gray-200 dark:border-gray-700">
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
                                                <TableActionButton
                                                    onClick={() => handleOpenEdit(product)}
                                                    label="Edit"
                                                    aria-label={`Edit ${product.name}`}
                                                >
                                                    <EditIcon />
                                                </TableActionButton>
                                                
                                                <TableActionButton
                                                    onClick={() => toggleArchive(product)}
                                                    variant={product.isArchived ? 'positive' : 'destructive'}
                                                    label={product.isArchived ? 'Restore' : 'Archive'}
                                                    aria-label={`${product.isArchived ? 'Restore' : 'Archive'} ${product.name}`}
                                                >
                                                    {product.isArchived ? (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                                    ) : (
                                                        <ArchiveIcon />
                                                    )}
                                                </TableActionButton>
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
                <div className="mt-auto flex shrink-0 flex-col items-start gap-3 border-t border-slate-300 bg-transparent pt-3 pb-1 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
                        <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                            Showing <span className="font-semibold text-gray-900 dark:text-white">{filteredProducts.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-semibold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, filteredProducts.length)}</span> of <span className="font-semibold text-gray-900 dark:text-white">{filteredProducts.length}</span> results
                        </div>
                        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
                </div>
            </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-visible animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-linear-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800 flex justify-between items-center rounded-t-2xl">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-gray-900 dark:bg-gray-700 flex items-center justify-center">
                                    {modalMode === 'add' ? (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                    ) : (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm text-gray-900 dark:text-white leading-tight">
                                        {modalMode === 'add' ? 'New Product' : 'Edit Product'}
                                    </h3>
                                    <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5">
                                        {modalMode === 'add' ? 'Add a new item to inventory' : `Editing ${formData.code}`}
                                    </p>
                                </div>
                            </div>
                            <button type="button" onClick={() => setIsModalOpen(false)} disabled={isSavingProduct} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-all disabled:cursor-not-allowed disabled:opacity-50">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="px-5 py-4 space-y-4">
                            {/* ── Section 1: Product Image ── */}
                            <div>
                                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Product Image</p>
                                <div className="grid grid-cols-[96px_1fr] gap-3 items-start">
                                    <div className={`h-24 w-24 rounded-2xl border overflow-hidden flex items-center justify-center ${
                                        formData.imageUrl ? 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600' : 'bg-gray-50 dark:bg-gray-800 border-dashed border-gray-300 dark:border-gray-600'
                                    }`}>
                                        {formData.imageUrl ? (
                                            <img src={formData.imageUrl} alt="Product preview" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="text-center px-2">
                                                <svg className="w-6 h-6 mx-auto text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2l2-2a3 3 0 014 0l2 2m-14 4h16"></path></svg>
                                                <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 font-medium">No image</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <input
                                            ref={productImageInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleProductImageChange}
                                            className="hidden"
                                        />
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => productImageInputRef.current?.click()}
                                                className="px-3 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:opacity-90 transition-all"
                                            >
                                                {formData.imageUrl ? 'Replace Image' : 'Upload Image'}
                                            </button>
                                            {formData.imageUrl && (
                                                <button
                                                    type="button"
                                                    onClick={clearProductImage}
                                                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-all"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
                                            JPG, PNG, or WebP under 2 MB. The image is saved with the product and shown in the table.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* ── Section 1: Classification ── */}
                            <div>
                                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Classification</p>
                                <div className="grid grid-cols-5 gap-2.5">
                                    <div className="col-span-2">
                                        <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">SKU</label>
                                            <input 
                                            type="text" 
                                            value={formData.code}
                                            onChange={e => setFormData(prev => ({ ...prev, code: e.target.value }))}
                                            maxLength={100}
                                            className="w-full p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono font-semibold text-gray-800 dark:text-gray-100 focus:border-gray-900 dark:focus:border-gray-400 outline-none"
                                            placeholder={modalMode === 'add' ? 'Optional — auto-generate' : 'SKU'}
                                        />
                                        {modalMode === 'add' && <p className="mt-1 text-[10px] font-medium text-gray-400 dark:text-gray-500">Leave blank to auto-generate.</p>}
                                    </div>
                                    <div className="col-span-3">
                                        <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Category <span className="text-red-400">*</span></label>
                                        <select 
                                            value={formData.category}
                                            onChange={e => {
                                                const newCat = e.target.value;
                                                const newRules = getCategoryFieldRules(newCat);
                                                const newSizeUnits = getCategorySizeUnits(newCat);
                                                setFormData(prev => ({
                                                    ...prev, 
                                                    category: newCat,
                                                    brand: newRules.showBrand ? prev.brand : '',
                                                    color: newRules.showColor ? prev.color : '',
                                                    size: newRules.showSize ? prev.size : '',
                                                    sizeUnit: newRules.showSize
                                                        ? (
                                                            newSizeUnits.includes(prev.sizeUnit)
                                                                ? prev.sizeUnit
                                                                : (modalMode === 'add' ? (newSizeUnits[0] || '') : prev.sizeUnit)
                                                        )
                                                        : '',
                                                    supplier: newRules.showSupplier ? prev.supplier : ''
                                                }));
                                            }}
                                            required
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
                                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Product Details</p>
                                <div className="space-y-2.5">
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {categoryFieldRules.showBrand && (
                                        <div>
                                            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Brand {categoryFieldRules.requireBrand && <span className="text-red-400">*</span>}</label>
                                            <input 
                                                type="text" 
                                                value={formData.brand}
                                                onChange={e => setFormData({...formData, brand: e.target.value})}
                                                onBlur={e => setFormData((prev) => ({ ...prev, brand: normalizeHumanReadable(e.target.value) }))}
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
                                            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Product Name <span className="text-red-400">*</span></label>
                                            <input 
                                                type="text" 
                                                value={formData.name}
                                                onChange={e => setFormData({...formData, name: e.target.value})}
                                                onBlur={e => setFormData((prev) => ({ ...prev, name: normalizeHumanReadable(e.target.value) }))}
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
                                            <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Color / Variant {categoryFieldRules.requireColor && <span className="text-red-400">*</span>}</label>
                                            <input 
                                                type="text" 
                                                value={formData.color}
                                                onChange={e => setFormData({...formData, color: e.target.value})}
                                                onBlur={e => setFormData((prev) => ({ ...prev, color: normalizeHumanReadable(e.target.value) }))}
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
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                                                    {getCategoryConfig(formData.category).sizeLabel} {categoryFieldRules.requireSize && <span className="text-red-400">*</span>}
                                                </label>
                                                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 w-24 text-center">
                                                    Unit {categoryFieldRules.requireSize && <span className="text-red-400">*</span>}
                                                </label>
                                            </div>
                                            <div className="flex gap-1.5 items-start">
                                                <input 
                                                    type="text" 
                                                    value={formData.size}
                                                    onChange={e => setFormData({...formData, size: e.target.value})}
                                                    required={categoryFieldRules.requireSize}
                                                    className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                    placeholder={getCategoryConfig(formData.category).sizePlaceholder}
                                                />
                                                <div className="w-24">
                                                    <select
                                                        value={formData.sizeUnit}
                                                        onChange={e => setFormData({...formData, sizeUnit: e.target.value})}
                                                        required={categoryFieldRules.requireSize}
                                                        className="w-full p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] font-semibold focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white cursor-pointer"
                                                        aria-label="Size unit"
                                                    >
                                                        {(getCategoryConfig(formData.category).sizeUnits || []).map(u => (
                                                            <option key={u} value={u}>{u}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Section 4: Pricing & Stock ── */}
                            <div>
                                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Pricing & Stock</p>
                                <div className="grid grid-cols-2 gap-2.5">
                                    <div>
                                        <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Price (₱) <span className="text-red-400">*</span></label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                <span className="text-gray-400 font-semibold text-xs">₱</span>
                                            </div>
                                            <input 
                                                type="text"
                                                inputMode="decimal"
                                                pattern="^[0-9]*\.?[0-9]*$"
                                                value={formData.price}
                                                onKeyDown={preventInvalidMoneyKeyDown}
                                                onPaste={preventInvalidMoneyPaste}
                                                onChange={e => setFormData({ ...formData, price: sanitizeMoneyInput(e.target.value) })}
                                                onBlur={() => {
                                                    setFormData(prev => ({ ...prev, price: formatMoneyInput(prev.price) }));
                                                }}
                                                className="w-full pl-7 pr-2 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
                                            {modalMode === 'add' ? 'Initial Stock' : 'Current Stock'} <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            min="0"
                                            value={formData.stock}
                                            onKeyDown={preventInvalidWholeNumberKeyDown}
                                            onPaste={preventInvalidWholeNumberPaste}
                                            onChange={e => setFormData({ ...formData, stock: sanitizeWholeNumberInput(e.target.value) })}
                                            disabled={modalMode === 'edit'}
                                            className={`w-full p-2 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium outline-none text-gray-900 dark:text-white ${modalMode === 'edit' ? 'bg-gray-50 dark:bg-gray-800 cursor-not-allowed' : 'bg-white dark:bg-gray-700 focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500'}`}
                                            placeholder="0"
                                            required
                                        />
                                        {modalMode === 'edit' && <p className="text-[10px] text-gray-400 mt-0.5">Stock changes in Inventory only.</p>}
                                    </div>
                                </div>
                            </div>

                            {/* ── Section 5: Supplier ── */}
                            {categoryFieldRules.showSupplier && (
                            <div>
                                <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Supplier</p>
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
                                            className="w-full pl-3 pr-10 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                            placeholder={supplierPartnerNames.length > 0 ? 'Select supplier...' : 'No supplier partners available'}
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
                                                <li className="p-3 text-xs text-center text-gray-400 italic">No matching supplier partners.</li>
                                            )}
                                            {suggestedSuppliers.map(s => (
                                                <li 
                                                    key={s} 
                                                    className={`px-3 py-2 cursor-pointer text-xs flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors border-b border-gray-50 dark:border-gray-600/50 last:border-0 ${formData.supplier === s ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-700 dark:text-gray-200'}`}
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
                                disabled={!isFormModified || isSavingProduct}
                                style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                                className={`w-full py-2.5 text-white rounded-xl font-semibold tracking-widest shadow-lg transition-all transform text-xs mt-1 ${
                                    isFormModified && !isSavingProduct
                                    ? 'hover:-translate-y-0.5 hover:opacity-90' 
                                    : 'cursor-not-allowed opacity-50'
                                }`}
                            >
                                {isSavingProduct ? (modalMode === 'add' ? 'Creating...' : 'Saving...') : (modalMode === 'add' ? 'Create Product' : 'Save Changes')}
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
                            <div className={`mx-auto flex items-center justify-center mb-4 ${productToArchive.isArchived ? 'text-emerald-600' : 'text-orange-600'}`}>
                                {productToArchive.isArchived ? (
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                ) : (
                                    <ArchiveIcon className="w-12 h-12" />
                                )}
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                                {productToArchive.isArchived ? 'Restore Product?' : 'Archive Product?'}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                Are you sure you want to {productToArchive.isArchived ? 'restore' : 'archive'} <span className="font-semibold text-gray-900 dark:text-white">{productToArchive.name}</span>?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsArchiveModalOpen(false)}
                                    disabled={isArchiveSubmitting}
                                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmArchive}
                                    disabled={isArchiveSubmitting}
                                    style={{ backgroundColor: '#111827' }}
                                    className="flex-1 py-2.5 text-white rounded-xl font-semibold text-sm shadow-md hover:opacity-90 transition-all transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isArchiveSubmitting ? 'Saving...' : (productToArchive.isArchived ? 'Restore' : 'Archive')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {enlargedProductImage && (
                <div
                    className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 backdrop-blur-lg p-4 animate-in fade-in duration-200"
                    onClick={closeProductImagePreview}
                >
                    <div
                        className="relative w-full max-w-5xl h-[78vh] md:h-[80vh] flex items-center justify-center animate-in zoom-in-90 fade-in duration-250 overflow-visible px-12 md:px-16 py-12"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={closeProductImagePreview}
                            className="absolute top-3 right-3 z-10 h-10 w-10 rounded-full bg-white text-gray-900 shadow-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
                            aria-label="Close image preview"
                        >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                        {previewableProducts.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => navigateProductImagePreview(-1)}
                                    className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white/95 text-gray-900 shadow-lg flex items-center justify-center hover:bg-white transition-colors border border-black/5"
                                    aria-label="Previous image"
                                >
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path>
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigateProductImagePreview(1)}
                                    className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white/95 text-gray-900 shadow-lg flex items-center justify-center hover:bg-white transition-colors border border-black/5"
                                    aria-label="Next image"
                                >
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path>
                                    </svg>
                                </button>
                            </>
                        )}
                        <img
                            src={enlargedProductImage.src}
                            alt={enlargedProductImage.alt}
                            className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-white/10 bg-white"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductList;
