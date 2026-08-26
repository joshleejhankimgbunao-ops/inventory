import React, { useState, useMemo, useEffect, useRef } from 'react';
import Pagination from '../components/Pagination';
import toast from 'react-hot-toast';
import { AnimatePresence, motion } from 'framer-motion';
import { showToast } from '../utils/toastHelper';
import { getAlternatives, getAlternativesByBudget, getBudgetTierByPrice, getLowStockThreshold, getStockStatus } from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { createSaleApi, listProductsApi, listPartnersApi } from '../services/inventoryApi';
import { printDocument, printReceipt } from '../services/receiptPrinter';
import {
    formatMoneyInput,
    isMoneyInputTooLarge,
    isWholeNumberInput,
    moneyFromCentavos,
    parseMoneyToCentavos,
    preventInvalidMoneyKeyDown,
    preventInvalidMoneyPaste,
    preventInvalidWholeNumberKeyDown,
    preventInvalidWholeNumberPaste,
    sanitizeMoneyInput,
    sanitizeWholeNumberInput,
} from '../utils/numericInput';
import { formatCurrency } from '../utils/numberFormat';

const getProductImageUrl = (item) => String(item?.imageUrl || '').trim();
const QUOTATION_NAME_MAX_LENGTH = 32;

const sanitizeCashTenderedInput = (value) => {
    const source = String(value ?? '');
    return /^\d*(?:\.\d{0,2})?$/.test(source) ? source : '';
};

const getMoneyCentavosFromAmount = (amount) => parseMoneyToCentavos(formatMoneyInput(amount));

const getCashChangeCentavos = (cashValue, payableTotal) => {
    const cashCentavos = parseMoneyToCentavos(cashValue);
    const totalCentavos = getMoneyCentavosFromAmount(payableTotal);

    if (cashCentavos === null || totalCentavos === null) return null;
    if (cashCentavos < totalCentavos) return 0;

    return cashCentavos - totalCentavos;
};

const formatCurrencyFromCentavos = (centavos) => {
    if (!Number.isSafeInteger(centavos) || centavos < 0) return formatCurrency(0);

    const pesos = Math.floor(centavos / 100);
    const remainingCentavos = String(centavos % 100).padStart(2, '0');
    return `\u20B1${pesos.toLocaleString('en-PH')}.${remainingCentavos}`;
};

const ProductThumbnail = ({ item, className = '', onPreview, fit = 'cover' }) => {
    const imageUrl = getProductImageUrl(item);
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        setImageFailed(false);
    }, [imageUrl]);

    const thumbnailClassName = `shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 ${className}`;

    if (imageUrl && !imageFailed) {
        return (
            <button
                type="button"
                onClick={(event) => onPreview?.(event, item)}
                className={`${thumbnailClassName} cursor-zoom-in transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-slate-900`}
                aria-label={`Enlarge image for ${item?.name || item?.code || 'product'}`}
            >
                <img
                    src={imageUrl}
                    alt={item?.name || item?.code || 'Product image'}
                    onError={() => setImageFailed(true)}
                    className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                />
            </button>
        );
    }

    return (
        <div className={thumbnailClassName}>
            <div className="flex h-full w-full items-center justify-center">
                <svg className="h-7 w-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2l2-2a3 3 0 014 0l2 2m-14 4h16" />
                </svg>
            </div>
        </div>
    );
};

const PointOfSale = () => {
    const MIN_CREDIT_TERM_DAYS = 1;
    const MAX_CREDIT_TERM_DAYS = 60;
    const CREDIT_PAYMENT_MODES = ['gcash', 'cheque', 'bank transfer', 'other'];
    const VAT_MODE_OPTIONS = [
        { value: 'vatable', label: 'VAT 12%' },
        { value: 'zero-rated', label: 'Zero Rated (0%)' },
    ];

    const productListRef = useRef(null);
    const printLockRef = useRef(false);
    const { processedInventory: inventory, setInventory, transactions, setTransactions, logAction, logActivity, addToSyncQueue, syncQueue, isOnline } = useInventory();
    const { appSettings: settings, userPreferences, currentUserName, userRole } = useAuth();

    const showErrorDetails = (message, title = 'Action Failed') => {
        showToast(title, message, 'error', 'pos-action-error');
    };

    const wrapText = (text, width = 32) => {
        const source = String(text || '').trim();
        if (!source) return [''];

        const words = source.split(/\s+/);
        const lines = [];
        let current = '';

        for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length <= width) {
                current = candidate;
                continue;
            }

            if (current) {
                lines.push(current);
            }

            if (word.length > width) {
                let start = 0;
                while (start < word.length) {
                    lines.push(word.slice(start, start + width));
                    start += width;
                }
                current = '';
                continue;
            }

            current = word;
        }

        if (current) {
            lines.push(current);
        }

        return lines.length > 0 ? lines : [''];
    };
    const getTierDisplayLabel = (tier) => {
        if (tier === 'low') return 'Value';
        if (tier === 'moderate') return 'Standard';
        if (tier === 'high') return 'Premium';
        return 'Standard';
    };
    const getRelativeTierKey = (candidatePrice, selectedPrice) => {
        const basePrice = Number(selectedPrice || 0);
        const altPrice = Number(candidatePrice || 0);

        // Fallback to global tiering when selected price is invalid.
        if (!Number.isFinite(basePrice) || basePrice <= 0) {
            return getBudgetTierByPrice(altPrice, settings);
        }

        // Use +/-10% with a minimum absolute band to avoid over-sensitivity on low-priced items.
        const toleranceBand = Math.max(basePrice * 0.1, 20);
        const delta = altPrice - basePrice;

        if (delta < -toleranceBand) return 'low';
        if (delta > toleranceBand) return 'high';
        return 'moderate';
    };
    const normalizeVariantOption = (value) => {
        return String(value || '')
            .trim()
            .replace(/\s*[x×]\s*/g, 'x')
            .replace(/\s+/g, ' ')
            .toLowerCase();
    };
    const formatVariantOptionLabel = (value) => {
        return String(value || '')
            .trim()
            .replace(/\s*[x×]\s*/g, 'x')
            .replace(/\s+/g, ' ');
    };

    const [enlargedProductImage, setEnlargedProductImage] = useState(null);

    const openProductImagePreview = (item) => {
        const imageUrl = getProductImageUrl(item);
        if (!imageUrl) return;

        setEnlargedProductImage({
            src: imageUrl,
            alt: item?.name || item?.code || 'Product image',
        });
    };

    const closeProductImagePreview = () => {
        setEnlargedProductImage(null);
    };

    useEffect(() => {
        if (!enlargedProductImage) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setEnlargedProductImage(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enlargedProductImage]);

    const handleProductImagePreviewClick = (event, item) => {
        event.preventDefault();
        event.stopPropagation();
        openProductImagePreview(item);
    };

    const [cart, setCart] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [recommendationModal, setRecommendationModal] = useState({ isOpen: false, item: null, alternatives: [], budgetOptions: null }); // Recommendation Modal State
    
    // Payment State
    const [paymentType, setPaymentType] = useState('cash');
    const [cashAmount, setCashAmount] = useState(''); // Use string for input handling
    const [selectedVatMode, setSelectedVatMode] = useState('vatable');
    const [creditCustomers, setCreditCustomers] = useState([]);
    const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState('');
    const [selectedCreditCustomerName, setSelectedCreditCustomerName] = useState('');
    const [selectedCreditTermDays, setSelectedCreditTermDays] = useState(MIN_CREDIT_TERM_DAYS);
    const [selectedCreditPaymentMode, setSelectedCreditPaymentMode] = useState('');
    const [customCreditPaymentMode, setCustomCreditPaymentMode] = useState('');
    const [isCreditPaymentModeOpen, setIsCreditPaymentModeOpen] = useState(false);
    const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false);
    const [isOrderSummaryDetailsCollapsed, setIsOrderSummaryDetailsCollapsed] = useState(false);
    const checkoutInFlightRef = useRef(false);
    
    // Quotation State
    const [showQuotationInput, setShowQuotationInput] = useState(false);
    const [quotationCustomerName, setQuotationCustomerName] = useState('');
    const [showQuotationPreview, setShowQuotationPreview] = useState(false);
    const [quotationData, setQuotationData] = useState(null);

    // Receipt Modal State
    const [showReceipt, setShowReceipt] = useState(false);
    const [lastTransaction, setLastTransaction] = useState(null);

    const creditPaymentModeRef = useRef(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 16;

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchQuery]);

    const createClosedVariantModalState = () => ({
        isOpen: false,
        group: null,
        step: 'brand',
        selectedBrand: null,
        selectedSize: null,
        selectedColor: null,
        quantity: 1,
    });
    const createOpenVariantModalState = (group) => ({
        isOpen: true,
        group,
        step: group?.availableBrands?.length > 1 ? 'brand' : 'variants',
        selectedBrand: null,
        selectedSize: null,
        selectedColor: null,
        quantity: 1,
    });
    const [variantModal, setVariantModal] = useState(createClosedVariantModalState);

    const variantModalImageItem = useMemo(() => {
        if (!variantModal.isOpen || !variantModal.group) return null;

        const variants = variantModal.group.variants.filter((variant) => (
            !variantModal.selectedBrand || variant.brand === variantModal.selectedBrand
        ));
        const selectedSize = variantModal.selectedSize;
        const selectedColor = variantModal.selectedColor;
        const hasSelection = selectedSize !== null || selectedColor !== null;
        const selectedVariant = hasSelection
            ? variants.find((variant) => (
                (selectedSize === null || normalizeVariantOption(variant.size) === selectedSize)
                && (selectedColor === null || normalizeVariantOption(variant.color) === selectedColor)
            ))
            : null;
        const brandRepresentative = variants.find((variant) => getProductImageUrl(variant)) || null;

        return getProductImageUrl(selectedVariant) ? selectedVariant : brandRepresentative;
    }, [variantModal]);

    const normalizeTransactionId = (value) => {
        return String(value || '').trim().toUpperCase();
    };

    const upsertTransactionByIdentity = (list, incoming) => {
        if (!incoming) return Array.isArray(list) ? list : [];

        const sourceId = String(incoming.sourceId || '').trim();
        const normalizedId = normalizeTransactionId(incoming.id);

        const rows = Array.isArray(list) ? list : [];
        const existingIndex = rows.findIndex((row) => {
            const rowSourceId = String(row?.sourceId || '').trim();
            if (sourceId && rowSourceId && rowSourceId === sourceId) {
                return true;
            }

            const rowId = normalizeTransactionId(row?.id);
            if (normalizedId && rowId && rowId === normalizedId) {
                return true;
            }

            return false;
        });

        if (existingIndex === -1) {
            return [incoming, ...rows];
        }

        const next = [...rows];
        next[existingIndex] = { ...rows[existingIndex], ...incoming };
        return next;
    };

    // Filter products based on search and category
    const filteredProducts = useMemo(() => {
        const normalizedQuery = debouncedSearchQuery.toLowerCase();
        const filtered = inventory.filter(item => {
            // Exclude archived items in POS
            if (item.isArchived) return false;

            const matchesSearch = item.name.toLowerCase().includes(normalizedQuery) || 
                                item.code.toLowerCase().includes(normalizedQuery) ||
                                (item.brand || '').toLowerCase().includes(normalizedQuery) ||
                                (item.color || '').toLowerCase().includes(normalizedQuery);
            const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });

        const groups = {};
        filtered.forEach(item => {
            // Group solely by Category and Name, allowing brands, sizes, colors, and other variations to be grouped together
            const key = `${item.category || ''}|${item.name || ''}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });

        const result = [];
        Object.values(groups).forEach(variants => {
            if (variants.length === 1) {
                result.push(variants[0]);
            } else {
                const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
                const prices = variants.map(v => v.price);
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const sample = variants[0];
                
                // Determine color text: if all same color, show it; if multiple, say "Multiple Colors"; otherwise null
                const uniqueColors = new Set(variants.map(v => v.color).filter(Boolean));
                const displayColor = uniqueColors.size === 1 ? [...uniqueColors][0] : (uniqueColors.size > 1 ? 'Multiple Colors' : null);
                
                // Determine brand text: if all same brand, show it; if multiple, say "Multiple Brands"
                const uniqueBrands = new Set(variants.map(v => v.brand).filter(Boolean));
                const displayBrand = uniqueBrands.size === 1 ? [...uniqueBrands][0] : (uniqueBrands.size > 1 ? 'Multiple Brands' : null);

                result.push({
                    isGroup: true,
                    code: `group-${sample.code}`, // unique key alias so map key works
                    name: sample.name,
                    brand: displayBrand,
                    color: displayColor,
                    imageUrl: variants.find((variant) => getProductImageUrl(variant))?.imageUrl || '',
                    category: sample.category,
                    stock: totalStock,
                    minPrice,
                    maxPrice,
                    availableBrands: [...uniqueBrands],
                    variants: [...variants].sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || a.price - b.price || (a.size || '').localeCompare(b.size || '') || (a.color || '').localeCompare(b.color || ''))
                });
            }
        });
        
        // Sort order:
        // 1) Out of Stock (alphabetical)
        // 2) Low Stock (alphabetical)
        // 3) In Stock (alphabetical)
        const statusPriority = {
            'Out of Stock': 0,
            'Low Stock': 1,
            'In Stock': 2,
        };

        return result.sort((a, b) => {
            const statusA = getStockStatus(a, settings);
            const statusB = getStockStatus(b, settings);
            const priorityA = statusPriority[statusA] ?? 99;
            const priorityB = statusPriority[statusB] ?? 99;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
            if (nameDiff !== 0) {
                return nameDiff;
            }

            return String(a?.code || '').localeCompare(String(b?.code || ''), undefined, { sensitivity: 'base' });
        });
    }, [inventory, debouncedSearchQuery, selectedCategory, settings]);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchQuery, selectedCategory]);

    useEffect(() => {
        if (cart.length === 0 && cashAmount !== '') {
            setCashAmount('');
        }
    }, [cart.length, cashAmount]);

    useEffect(() => {
        let isMounted = true;

        const loadEligibleCreditCustomers = async () => {
            try {
                const rows = await listPartnersApi({ type: 'customer', includeArchived: false });
                if (!isMounted) return;

                const eligible = (Array.isArray(rows) ? rows : []).filter((row) => {
                    const customerType = String(row?.customerType || 'regular').toLowerCase();
                    const isVerifiedCustomer = row?.isVerifiedCustomer !== false;
                    return row?.type === 'customer' && !row?.isArchived && customerType === 'regular' && isVerifiedCustomer;
                });

                setCreditCustomers(eligible);

                if (eligible.length === 0) {
                    setSelectedCreditCustomerId('');
                    setSelectedCreditCustomerName('');
                    return;
                }
            } catch {
                if (isMounted) {
                    setCreditCustomers([]);
                    setSelectedCreditCustomerId('');
                    setSelectedCreditCustomerName('');
                }
            }
        };

        loadEligibleCreditCustomers();

        return () => {
            isMounted = false;
        };
    }, []);

    const computedCreditDueDate = useMemo(() => {
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS));
        return base;
    }, [selectedCreditTermDays]);

    const selectedCreditCustomer = useMemo(() => {
        return creditCustomers.find((row) => String(row?._id || row?.id || '') === String(selectedCreditCustomerId || '')) || null;
    }, [creditCustomers, selectedCreditCustomerId]);

    const creditCustomerOptions = useMemo(() => {
        return creditCustomers.map((customer) => {
            const customerId = String(customer?._id || customer?.id || '');
            const customerName = String(customer?.name || '').trim();
            return {
                id: customerId,
                name: customerName,
            };
        });
    }, [creditCustomers]);


    const handleCreditCustomerInputChange = (value) => {
        setSelectedCreditCustomerName(value);

        const normalizedValue = String(value || '').trim().toLowerCase();
        if (!normalizedValue) {
            setSelectedCreditCustomerId('');
            return;
        }

        const matched = creditCustomerOptions.find((option) => option.name.toLowerCase() === normalizedValue);
        setSelectedCreditCustomerId(matched ? matched.id : '');
    };

    const normalizeCreditTerm = (value) => {
        if (!isWholeNumberInput(value, { min: MIN_CREDIT_TERM_DAYS, max: MAX_CREDIT_TERM_DAYS })) {
            return MIN_CREDIT_TERM_DAYS;
        }
        return Number(value);
    };

    const handleCreditTermInputChange = (value) => {
        if (value === '') {
            setSelectedCreditTermDays(MIN_CREDIT_TERM_DAYS);
            return;
        }

        setSelectedCreditTermDays(normalizeCreditTerm(value));
    };

    const incrementCreditTerm = () => {
        setSelectedCreditTermDays((prev) => normalizeCreditTerm(Math.min(MAX_CREDIT_TERM_DAYS, Number(prev || MIN_CREDIT_TERM_DAYS) + 1)));
    };

    const decrementCreditTerm = () => {
        setSelectedCreditTermDays((prev) => normalizeCreditTerm(Math.max(MIN_CREDIT_TERM_DAYS, Number(prev || MIN_CREDIT_TERM_DAYS) - 1)));
    };

    const resolveCreditPaymentModeLabel = () => {
        if (selectedCreditPaymentMode === 'other') {
            const customMode = String(customCreditPaymentMode || '').trim();
            return customMode;
        }
        return String(selectedCreditPaymentMode || '').trim();
    };

    const formatCreditPaymentModeLabel = (mode) => {
        if (mode === 'other') {
            return 'Other';
        }

        const labels = {
            gcash: 'GCash',
            cheque: 'Cheque',
            'bank transfer': 'Bank Transfer',
        };
        return labels[mode] || String(mode || '');
    };

    const normalizeCreditPaymentModeInput = (value) => {
        const trimmed = String(value || '').trim();
        const lower = trimmed.toLowerCase();
        if (!trimmed) {
            return { mode: '', custom: '' };
        }
        if (CREDIT_PAYMENT_MODES.includes(lower)) {
            return { mode: lower, custom: '' };
        }
        return { mode: 'other', custom: trimmed };
    };


    useEffect(() => {
        if (!productListRef.current) return;
        productListRef.current.scrollTop = 0;
    }, [currentPage]);

    // Get current items
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

    // Derived categories
    const categories = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

    const posSearchSuggestions = useMemo(() => {
        const terms = new Set();

        inventory.forEach((item) => {
            [item?.name, item?.code, item?.brand, item?.color, item?.category]
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

    const addToCart = (product, forceAdd = false, options = {}) => {
        const silentNotification = Boolean(options?.silentNotification);
        const requestedQty = Math.max(1, Math.floor(Number(options?.quantity) || 1));
        if (!forceAdd) {
            const alts = getAlternatives(product, inventory, settings, { maxSuggestions: 8 });
            const lowThreshold = Math.max(1, Number(getLowStockThreshold(product, settings)) || 10);

            if (product.stock <= 0) {
                setRecommendationModal({ isOpen: true, item: product, alternatives: alts, budgetOptions: null, type: 'out-of-stock' });
                return;
            }

            if (product.stock <= lowThreshold) {
                setRecommendationModal({ isOpen: true, item: product, alternatives: alts, budgetOptions: null, type: 'low-stock' });
                return;
            }
        }

        setCart(prevCart => {
            const existingItem = prevCart.find(item => item.code === product.code);
            
            // Check if adding requested quantity exceeds stock
            const currentQtyInCart = existingItem ? existingItem.qty : 0;
            if (currentQtyInCart + requestedQty > product.stock) {
                showErrorDetails(`Only ${product.stock} units available!`);
                return prevCart;
            }

            if (existingItem) {
                return prevCart.map(item => 
                    item.code === product.code 
                        ? { ...item, qty: item.qty + requestedQty } 
                        : item
                );
            } else {
                return [...prevCart, { ...product, qty: requestedQty }];
            }
        });

        if (forceAdd) {
            setRecommendationModal({ isOpen: false, item: null, alternatives: [], budgetOptions: null });
            if (!silentNotification) {
                showToast("Item Added", "Item added to cart.", "success", "pos-add-cart");
            }
        }
    };

    const selectRecommendedAlternative = (alternative) => {
        addToCart(alternative, true, { silentNotification: true });
        setRecommendationModal({ isOpen: false, item: null, alternatives: [] });
        showToast(
            'Selected Alternative',
            `${alternative.brand ? `${alternative.brand} ` : ''}${alternative.name}${alternative.color ? ` — ${alternative.color}` : ''}`,
            'success',
            'pos-selected-alternative'
        );
    };

    const openBudgetAlternatives = (product, options = {}) => {
        const budgetOnly = options?.budgetOnly === true;
        const forcedType = options?.forcedType;
        const status = getStockStatus(product, settings);
        const modalType = forcedType || (budgetOnly
            ? 'in-stock'
            : status === 'Out of Stock'
            ? 'out-of-stock'
            : status === 'Low Stock'
                ? 'low-stock'
                : 'in-stock');

        let alternatives = [];

        if (modalType === 'in-stock') {
            const byBudget = getAlternativesByBudget(product, inventory, settings, { limitPerTier: 4, maxSuggestions: 18, includeNonInStock: budgetOnly });
            // Budget-first order for Product Options: Value -> Standard -> Premium fallback.
            alternatives = [...(byBudget.low || []), ...(byBudget.moderate || []), ...(byBudget.high || [])];
        } else {
            alternatives = getAlternatives(product, inventory, settings, { maxSuggestions: 8 });
        }

        if (alternatives.length === 0) {
            showToast("No Alternatives", "No alternatives found for this item.", "info", "pos-budget-no-alternatives");
            return;
        }

        setRecommendationModal({ isOpen: true, item: product, alternatives, budgetOptions: null, type: modalType });
    };

    const removeFromCart = (code) => {
        setCart(prevCart => prevCart.filter(item => item.code !== code));
    };

    const updateQuantity = (code, newQty) => {
        if (newQty <= 0) {
            removeFromCart(code);
            return;
        }

        const product = inventory.find(i => i.code === code);
        if (!product) return;

        if (newQty > product.stock) {
            showErrorDetails(`Only ${product.stock} units available!`);
            return;
        }

        setCart(prevCart => prevCart.map(item => 
            item.code === code ? { ...item, qty: newQty } : item
        ));
    };

    const calculateTotal = () => {
        const vatBreakdown = calculateVatBreakdown();
        if (normalizeVatMode(selectedVatMode) === 'zero-rated') {
            return vatBreakdown.netAmount;
        }
        return vatBreakdown.grossAmount;
    };
    const normalizeVatMode = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (['vatable', 'zero-rated'].includes(normalized)) {
            return normalized;
        }
        return 'vatable';
    };

    const getVatRatePercent = (vatMode) => {
        const mode = normalizeVatMode(vatMode);
        return mode === 'zero-rated' ? 0 : 12;
    };

    const formatVatModeLabel = (vatMode) => {
        const mode = normalizeVatMode(vatMode);
        return mode === 'zero-rated' ? 'VAT (0%)' : 'VAT (12%)';
    };

    const calculateVatBreakdown = () => {
        const toMoney = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return 0;
            return Math.round((numeric + Number.EPSILON) * 100) / 100;
        };

        let grossAmount = 0;

        for (const item of cart) {
            const itemGross = toMoney(item.price * item.qty);
            grossAmount += itemGross;
        }

        const normalizedVatMode = normalizeVatMode(selectedVatMode);
        const normalizedGross = toMoney(grossAmount);
        const netAmount = toMoney(normalizedGross / 1.12);
        const vatAmount = normalizedVatMode === 'zero-rated'
            ? 0
            : toMoney(normalizedGross - netAmount);

        return {
            grossAmount: normalizedGross,
            netAmount,
            vatAmount,
        };
    };

    const handleCheckout = async () => {
        if (checkoutInFlightRef.current) {
            return;
        }

        if (cart.length === 0) return;

        const isCreditCheckout = paymentType === 'credit';
        const isCashCheckout = paymentType === 'cash';

        // Calculate totals (Tax removed)
        const total = calculateTotal();
        // compute VAT breakdown to attach to transaction data and display
        const vatForTransaction = calculateVatBreakdown();
        const normalizedCashAmount = formatMoneyInput(cashAmount);
        const cashCentavos = parseMoneyToCentavos(normalizedCashAmount);
        const totalCentavos = getMoneyCentavosFromAmount(total);
        const hasValidCashAmount = cashCentavos !== null;
        const cash = hasValidCashAmount ? moneyFromCentavos(cashCentavos) : 0;

        if (isCashCheckout) {
            if (cashCentavos === null || totalCentavos === null) {
                const tooLarge = isMoneyInputTooLarge(normalizedCashAmount) || totalCentavos === null;
                showErrorDetails(tooLarge ? 'Amount is too large. Please enter a smaller value.' : 'Enter a valid cash amount.');
                return;
            }
            if (cashCentavos < totalCentavos) {
                showErrorDetails("Insufficient cash amount!");
                return;
            }
        } else if (isCreditCheckout && !selectedCreditCustomer) {
            showErrorDetails('Select an eligible regular customer for credit checkout.');
            return;
        } else if (isCreditCheckout && !resolveCreditPaymentModeLabel()) {
            showErrorDetails('Please select mode of payment for credit checkout.');
            return;
        }

        checkoutInFlightRef.current = true;
        setIsCheckoutProcessing(true);

        const cartSnapshot = [...cart];

        const transactionData = {
            id: `TRX-${Date.now().toString().slice(-6)}`,
            date: new Date().toLocaleString(),
            items: [...cartSnapshot],
            total,
            netAmount: vatForTransaction.netAmount,
            vatAmount: vatForTransaction.vatAmount,
            grossAmount: vatForTransaction.grossAmount,
            pricingMode: 'inclusive',
            vatMode: normalizeVatMode(selectedVatMode),
            cash: isCashCheckout ? cash : 0,
            cashTendered: isCashCheckout ? normalizedCashAmount : '',
            change: isCashCheckout ? moneyFromCentavos(cashCentavos - totalCentavos) : 0,
            paymentMethod: isCreditCheckout ? 'Credit' : 'Cash',
            paymentStatus: isCreditCheckout ? 'Pending' : 'Paid',
            customerId: isCreditCheckout ? selectedCreditCustomerId : '',
            customerName: isCreditCheckout
                ? (selectedCreditCustomer?.name || '')
                : '',
            creditPaymentMode: isCreditCheckout ? resolveCreditPaymentModeLabel() : '',
            termDays: isCreditCheckout ? Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS) : null,
            dueDate: isCreditCheckout ? computedCreditDueDate.toISOString() : null,
            cashier: currentUserName,
            cashierRole: String(userRole || '').toLowerCase(),
        };

        const authToken = getAuthToken();
        const hasSession = Boolean(authToken);
        const canSyncOnline = hasSession && navigator.onLine && cartSnapshot.every(item => item.id);

        if (isCreditCheckout && !canSyncOnline) {
            showErrorDetails(
                !hasSession
                    ? 'Credit checkout requires an active authenticated session.'
                    : 'Credit checkout requires a live backend connection. Please reconnect and retry.'
            );
            checkoutInFlightRef.current = false;
            setIsCheckoutProcessing(false);
            return;
        }

        try {
            if (canSyncOnline) {
                try {
                    const apiItems = cartSnapshot.map(item => ({
                        productId: item.id,
                        quantity: item.qty,
                    }));

                    const savedSale = await createSaleApi(
                        apiItems,
                        isCreditCheckout ? 'credit' : paymentType,
                        transactionData.id,
                        isCreditCheckout
                            ? {
                                customerId: selectedCreditCustomerId,
                                customerName: selectedCreditCustomer?.name || '',
                                creditPaymentMode: selectedCreditPaymentMode,
                                creditPaymentModeOther: selectedCreditPaymentMode === 'other' ? customCreditPaymentMode : '',
                                termDays: Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS),
                                notes: `Preferred mode of payment: ${resolveCreditPaymentModeLabel()}`,
                                vatMode: normalizeVatMode(selectedVatMode),
                            }
                            : {
                                vatMode: normalizeVatMode(selectedVatMode),
                                cashTendered: normalizedCashAmount,
                            }
                    );
                    
                    // If we get here, sync was successful
                    try {
                        const remoteProducts = await listProductsApi();
                        if (Array.isArray(remoteProducts) && remoteProducts.length > 0) {
                            setInventory(remoteProducts);
                        }
                    } catch (refreshError) {
                        // The sale is already accepted at this point. A refresh failure must
                        // not reclassify it as an offline or rejected transaction.
                        console.warn('Sale completed, but inventory refresh failed:', refreshError);
                    }

                    const remoteTransaction = {
                        id: savedSale?._id ? `TRX-${savedSale._id.slice(-8).toUpperCase()}` : transactionData.id,
                        sourceId: savedSale?._id ? String(savedSale._id) : '',
                        date: savedSale?.createdAt ? new Date(savedSale.createdAt).toLocaleString() : transactionData.date,
                        items: [...cartSnapshot],
                        total: savedSale?.totalAmount ?? total,
                        netAmount: Number(savedSale?.netAmount || vatForTransaction.netAmount || total),
                        vatAmount: Number(savedSale?.vatAmount || vatForTransaction.vatAmount || 0),
                        grossAmount: Number(savedSale?.grossAmount || (savedSale?.totalAmount ?? total)),
                        pricingMode: 'inclusive',
                        vatMode: normalizeVatMode(savedSale?.vatMode || selectedVatMode),
                        customerIsVatExempt: false,
                        cash: isCashCheckout ? cash : 0,
                        cashTendered: isCashCheckout ? normalizedCashAmount : '',
                        change: isCashCheckout ? moneyFromCentavos(cashCentavos - totalCentavos) : 0,
                        paymentMethod: isCreditCheckout ? 'Credit' : 'Cash',
                        paymentStatus: savedSale?.paymentStatus || (isCreditCheckout ? 'Pending' : 'Paid'),
                        customerId: isCreditCheckout ? String(savedSale?.customer || selectedCreditCustomerId) : '',
                        customerName: isCreditCheckout
                            ? (savedSale?.customerName || selectedCreditCustomer?.name || '')
                            : '',
                        creditPaymentMode: isCreditCheckout
                            ? (resolveCreditPaymentModeLabel() || '')
                            : '',
                        termDays: isCreditCheckout ? Number(savedSale?.creditTermDays || selectedCreditTermDays) : null,
                        dueDate: isCreditCheckout ? (savedSale?.dueDate || computedCreditDueDate.toISOString()) : null,
                        cashImpactAmount: isCreditCheckout ? 0 : (savedSale?.totalAmount ?? total),
                        cashier: currentUserName,
                        cashierRole: String(userRole || '').toLowerCase(),
                    };

                    if (!isCreditCheckout) {
                        setTransactions(prev => upsertTransactionByIdentity(prev, remoteTransaction));
                    }
                    cartSnapshot.forEach(item => {
                        logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${remoteTransaction.id})`, currentUserName);
                    });

                    setCart([]);
                    setCashAmount('');
                    setLastTransaction(remoteTransaction);
                    setShowReceipt(true);
                    showToast(
                        isCreditCheckout ? 'Credit Order Created' : 'Transaction Complete',
                        isCreditCheckout ? 'Credit sale recorded with pending payment.' : 'Sale recorded successfully.',
                        'success',
                        'pos-checkout'
                    );
                    return;
                } catch (error) {
                    if (!isApiConnectionFailure(error) || isCreditCheckout) {
                        console.warn('Online checkout was rejected or failed after an HTTP response:', error);
                        const message = error?.message || 'Checkout failed. Please retry.';
                        showErrorDetails(message);
                        return;
                    }

                    console.warn('API connection failed before a response was received; using offline checkout:', error);
                }
            }

            // Queue for Sync (Offline Mode)
            // Ensure items have IDs for backend sync later
            addToSyncQueue({
                ...transactionData,
                clientRequestId: transactionData.id,
                items: cartSnapshot.map(i => ({ ...i, id: i.id || i._id })),
            });

            if (canSyncOnline) {
                showToast("Offline Mode", "Transaction saved locally and will sync when online.", "info", "pos-offline-sync");
            }

            // Offline / Fallback Handling
            // Deduct stock from inventory
            const newInventory = inventory.map(item => {
                const cartItem = cartSnapshot.find(c => c.code === item.code);
                if (cartItem) {
                    const newStock = item.stock - cartItem.qty;
                    const statusCarrier = { ...item, stock: newStock };
                    const newStatus = getStockStatus(statusCarrier, settings);
                    
                    return { ...item, stock: newStock, status: newStatus };
                }
                return item;
            });

            setInventory(newInventory);
            
            // Log Transaction & Deduction
            if (!isCreditCheckout) {
                setTransactions(prev => [transactionData, ...prev]);
            }
            cartSnapshot.forEach(item => {
                logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${transactionData.id})`, currentUserName);
            });

            setCart([]);
            setCashAmount('');
            setLastTransaction(transactionData);
            setShowReceipt(true);
            logActivity(
                currentUserName,
                isCreditCheckout ? 'Created Credit Sale' : 'Processed Sale',
                `${isCreditCheckout ? 'Credit transaction' : 'Transaction'} ${transactionData.id} — ${formatCurrency(total)}`
            );
            showToast(
                isCreditCheckout ? 'Credit Order Created' : 'Transaction Complete',
                isCreditCheckout ? 'Credit sale recorded with pending payment.' : 'Sale recorded successfully.',
                'success',
                'pos-checkout'
            );
        } finally {
            checkoutInFlightRef.current = false;
            setIsCheckoutProcessing(false);
        }
    };

    const [printStatus, setPrintStatus] = useState('idle'); // idle, printing, success

    const handleGenerateQuotation = () => {
        if (!quotationCustomerName.trim()) {
            showErrorDetails("Please enter customer name");
            return;
        }

        if (quotationCustomerName.length > QUOTATION_NAME_MAX_LENGTH) {
            showErrorDetails(`Quotation name cannot exceed ${QUOTATION_NAME_MAX_LENGTH} characters.`);
            return;
        }
        
        const quoteData = {
            customerName: quotationCustomerName,
            date: new Date().toLocaleString(),
            items: [...cart],
            total: calculateTotal()
        };

        setQuotationData(quoteData);
        setShowQuotationInput(false);
        setShowQuotationPreview(true);
    };

    const handlePrintQuotationDoc = () => {
        if (printLockRef.current) {
            return;
        }

        printLockRef.current = true;
        setPrintStatus('printing');

        const quote = quotationData;
        if (!quote) {
            printLockRef.current = false;
            setPrintStatus('idle');
            showErrorDetails('Please generate a quotation first.');
            return;
        }

        const lines = [
            String(settings?.storeName || 'Quotation').trim(),
            String(settings?.storeAddress || '').trim(),
            String(settings?.contactPhone || '').trim() ? `Contact: ${String(settings?.contactPhone || '').trim()}` : '',
            '--------------------------------',
            'QUOTATION',
            `Customer: ${String(quote.customerName || '').trim()}`,
            `Date: ${String(quote.date || '').trim()}`,
            '--------------------------------',
        ].filter((line) => String(line || '').trim().length > 0);

        quote.items.forEach((item) => {
            const itemName = String(item?.name || item?.label || 'Item').trim();
            const itemCode = String(item?.code || '').trim();
            const itemQty = Number(item?.qty || 0) || 0;
            const itemPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
            const itemTotal = itemQty * itemPrice;

            wrapText(itemName, 32).forEach((line) => lines.push(line));
            if (itemCode) {
                lines.push(`  Code: ${itemCode}`);
            }
            lines.push(`  ${itemQty} x ${formatCurrency(itemPrice).replace('₱', '')} = ${formatCurrency(itemTotal)}`);
        });

        lines.push('--------------------------------');
        lines.push(`TOTAL: ${formatCurrency(quote.total)}`);
        lines.push('');
        lines.push('Thank you for your business.');

        void printDocument({ lines })
            .then((result) => {
                setPrintStatus('success');
                showToast(
                    'Print Success',
                    result.source === 'local-service'
                        ? 'Quotation sent to the thermal printer.'
                        : 'Quotation printed successfully.',
                    'success',
                    'pos-print-quotation'
                );

                setTimeout(() => {
                    setShowQuotationPreview(false);
                    setPrintStatus('idle');
                    setQuotationCustomerName('');
                    printLockRef.current = false;
                }, 1500);
            })
            .catch((error) => {
                printLockRef.current = false;
                setPrintStatus('idle');
                showErrorDetails(error?.message || 'Unable to print quotation.');
            });
    };

    const handlePrint = async () => {
        if (!lastTransaction || printStatus === 'printing' || printLockRef.current) {
            return;
        }

        printLockRef.current = true;
        setPrintStatus('printing');
        try {
            const result = await printReceipt({
                transaction: lastTransaction,
                settings,
                elementId: 'receipt-content',
                paperWidthMm: 58,
            });

            setPrintStatus('success');
            showToast(
                'Print Success',
                result.source === 'local-service'
                    ? 'Receipt sent to the thermal printer.'
                    : 'Receipt printed successfully!',
                'success',
                'pos-print-receipt'
            );

            setTimeout(() => {
                setShowReceipt(false);
                setPrintStatus('idle');
                printLockRef.current = false;
            }, 1500);
        } catch (error) {
            printLockRef.current = false;
            setPrintStatus('idle');
            showErrorDetails(error?.message || 'Unable to print receipt.');
        }
    };

    // Auto-Print Receipt Effect
    useEffect(() => {
        if (!userPreferences?.autoPrintReceipts || !showReceipt || !lastTransaction) {
            return undefined;
        }

        // Slight delay to ensure modal DOM is fully rendered before printing.
        const autoPrintTimer = window.setTimeout(() => {
            void handlePrint();
        }, 500);

        return () => window.clearTimeout(autoPrintTimer);
    }, [userPreferences?.autoPrintReceipts, showReceipt, lastTransaction]);

    const receiptPaymentMethod = String(lastTransaction?.paymentMethod || 'Cash').trim();
    const isCreditReceipt = receiptPaymentMethod.toLowerCase() === 'credit';
    const receiptTitle = isCreditReceipt
        ? 'Credit Sales Receipt'
        : 'Cash Sales Receipt';
    const receiptContextLine = isCreditReceipt
        ? 'Issued once payment is completed.'
        : 'Official record of your purchase.';
    const payableTotalForChange = calculateTotal();
    const changeCentavosForDisplay = getCashChangeCentavos(cashAmount, payableTotalForChange);
    const isCashAmountTooLarge = paymentType === 'cash' && isMoneyInputTooLarge(cashAmount);
    const isCheckoutDisabled = cart.length === 0
        || isCheckoutProcessing
        || (paymentType === 'cash' && !cashAmount)
        || isCashAmountTooLarge
        || (paymentType === 'credit' && (!selectedCreditCustomer || !resolveCreditPaymentModeLabel()));
    const checkoutDisabledMessage = cart.length === 0
        ? 'Add item first'
        : isCheckoutProcessing
            ? 'Processing payment...'
            : isCashAmountTooLarge
                ? 'Amount is too large. Please enter a smaller value.'
            : paymentType === 'credit'
                ? (!selectedCreditCustomer ? 'Select an eligible regular customer first' : 'Select payment mode first')
                : 'Enter cash first';

    return (
        <div className="flex min-h-[calc(100dvh-80px)] flex-col gap-2 overflow-y-auto md:h-[calc(100vh-80px)] md:overflow-hidden">
            


            <div className="flex flex-col md:flex-row flex-1 gap-2 md:min-h-0">
            {/* Receipt Modal */}
            {showReceipt && lastTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-[58mm] overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <div>
                                <h3 className="font-semibold text-lg text-gray-800">{receiptTitle}</h3>
                                <p className="text-[11px] text-gray-500 mt-0.5">{receiptContextLine}</p>
                            </div>
                            <button onClick={() => setShowReceipt(false)} className="text-gray-400 hover:text-gray-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-2 bg-white" id="receipt-content">
                            <div className="w-full max-w-[58mm] mx-auto px-1 text-[9px] leading-tight">
                            <div className="text-center mb-3">
                                <p className="text-[14px] font-semibold text-gray-900 mb-1 leading-tight">{settings?.storeName || 'Tableria La Confianza'}</p>
                                <div className="text-[9px] text-gray-400 mt-1 space-y-0.5 leading-tight">
                                    <p>{settings?.storeAddress || 'Manila S Rd, Calamba, 4027 Laguna'}</p>
                                    <p>Contact: {settings?.contactPhone || '0917-545-2166'}</p>
                                </div>
                            </div>
                            
                            <div className="border-t border-dashed border-gray-200 py-2 mb-2">
                                <div className="flex justify-between mb-0.5">
                                    <span className="text-gray-500">Receipt No.:</span>
                                    <span className="font-mono font-semibold text-gray-800">{lastTransaction.id}</span>
                                </div>
                                <div className="flex justify-between mb-0.5">
                                    <span className="text-gray-500">Date:</span>
                                    <span className="text-gray-800">{lastTransaction.date}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Cashier:</span>
                                    <span className="text-gray-800">{lastTransaction.cashier}</span>
                                </div>
                            </div>

                            <table className="w-full mb-3">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="py-1 text-left font-semibold text-gray-700 text-[9px]">Item</th>
                                        <th className="py-1 text-center font-semibold text-gray-700 text-[9px]">Qty</th>
                                        <th className="py-1 text-right font-semibold text-gray-700 text-[9px]">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600 text-[9px] leading-tight">
                                    {lastTransaction.items.map((item, i) => (
                                        <tr key={i} className="border-b border-gray-50">
                                            <td className="py-1">
                                                <div className="font-semibold text-gray-800 leading-tight">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                                <div className="text-[8px] leading-tight">{item.code}</div>
                                            </td>
                                            <td className="py-1 text-center">{item.qty}</td>
                                            <td className="py-1 text-right">{formatCurrency(item.price * item.qty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="space-y-1 text-right border-t border-gray-200 pt-2 text-[9px] leading-tight">
                                {lastTransaction.vatAmount > 0 && (
                                    <>
                                        <div className="flex justify-between text-gray-600 text-[9px]">
                                            <span>Net Amount</span>
                                            <span>{formatCurrency(lastTransaction.netAmount)}</span>
                                        </div>
                                        <div className="flex justify-between text-gray-600 text-[9px]">
                                            <span>{formatVatModeLabel(lastTransaction.vatMode)}</span>
                                            <span>{formatCurrency(lastTransaction.vatAmount)}</span>
                                        </div>
                                    </>
                                )}
                                <div className="flex justify-between text-[13px] font-semibold text-gray-900 pt-1 border-t border-gray-900 mt-1">
                                    <span>TOTAL</span>
                                    <span>{formatCurrency(lastTransaction.total)}</span>
                                </div>
                                <div className="flex justify-between text-gray-600 pt-1 text-[9px] uppercase font-semibold">
                                    <span>{isCreditReceipt ? 'Credit Status' : 'Cash Received'}</span>
                                    <span>{isCreditReceipt ? (lastTransaction.paymentStatus || 'Pending') : formatCurrency(lastTransaction.cash)}</span>
                                </div>

                                {isCreditReceipt ? (
                                    <>
                                        <div className="flex justify-between text-gray-500 text-[9px]">
                                            <span>Due Date</span>
                                            <span>{lastTransaction.dueDate ? new Date(lastTransaction.dueDate).toLocaleDateString() : '-'}</span>
                                        </div>
                                        {lastTransaction.creditPaymentMode && (
                                            <div className="flex justify-between text-gray-500 text-[9px]">
                                                <span>Mode of Payment</span>
                                                <span>{lastTransaction.creditPaymentMode}</span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex justify-between text-gray-500 text-[9px]">
                                        <span>Change</span>
                                        <span>{formatCurrency(lastTransaction.change)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 text-center text-[9px] text-gray-400 leading-tight">
                                <p>Thank you for your business.</p>
                                <p>Please keep this receipt for returns and support.</p>
                            </div>
                            </div>
                        </div>

                        <div className="p-2 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => setShowReceipt(false)}
                                className="py-2 px-4 rounded-xl text-xs font-semibold tracking-widest hover:bg-gray-100 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform hover:-translate-y-0.5 text-gray-600 bg-white"
                                style={{ border: '2px solid #e5e7eb' }}
                            >
                                Close
                            </button>
                            <button 
                                onClick={handlePrint}
                                disabled={printStatus === 'printing'}
                                className={`py-2 px-4 rounded-xl text-xs font-semibold tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                                style={{ backgroundColor: printStatus === 'success' ? '#10B981' : '#111827', color: '#ffffff', border: printStatus === 'success' ? '2px solid #10B981' : '2px solid #111827' }}
                            >
                                {printStatus === 'printing' ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Printing...
                                    </>
                                ) : printStatus === 'success' ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        Printed
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2-4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                                        Print
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Left Side: Product Grid */}
            <div className="min-h-[400px] md:min-h-0 flex-1 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-5 pb-0 shrink-0">
                    <p className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">Point of Sale</p>
                    <p className="text-gray-500 font-medium text-[11px] md:text-xs mt-1">Process transactions and manage orders</p>
                </div>
                
                {/* Search and Filter Header */}
                <div className="px-5 pb-5 pt-5 border-b border-gray-200 bg-transparent z-10 shrink-0">
                    <div className="flex flex-col md:flex-row gap-4 mb-0">
                        <div className="relative w-full md:max-w-xs group">
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                list="pos-search-suggestions"
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-3 py-2 bg-gray-50 border-2 border-gray-100 rounded-xl text-sm focus:bg-white focus:border-gray-900 focus:ring-4 focus:ring-gray-100 transition-all shadow-sm placeholder:text-gray-400 font-semibold text-gray-800"
                            />
                            <datalist id="pos-search-suggestions">
                                {posSearchSuggestions.map((term) => (
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
                    </div>
                </div>

                {/* Product List */}
                <div ref={productListRef} className="flex-1 overflow-y-auto p-4 bg-transparent">
                    {filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full">
                            <div className="flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-300 rounded-xl p-8 bg-transparent">
                                <div className="bg-white p-4 rounded-full mb-4 shadow-sm ring-1 ring-gray-200">
                                    <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293H9.414a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 005.586 13H4"></path>
                                    </svg>
                                </div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-1">No products found</h3>
                                <p className="text-gray-500 text-sm max-w-xs mx-auto text-center">
                                    {searchQuery 
                                        ? `We couldn't find any items matching "${searchQuery}".`
                                        : 'Select a category to view products.'
                                    }
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 pb-4">
                                {currentItems.map(item => (
                                    (() => {
                                        if (item.isGroup) {
                                            const isOutOfStock = item.stock <= 0;
                                            const isLowStock = item.variants.some(v => getStockStatus(v, settings) === 'Low Stock');

                                            return (
                                                <div
                                                    key={item.code}
                                                    onClick={(e) => {
                                                        if (e.target?.closest?.('[data-pos-image-preview="true"]')) {
                                                            return;
                                                        }
                                                        setVariantModal(createOpenVariantModalState(item));
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            setVariantModal(createOpenVariantModalState(item));
                                                        }
                                                    }}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`relative flex flex-col rounded-2xl border transition-all duration-300 text-left group overflow-hidden bg-white
                                                        min-h-[196px]
                                                        ${isOutOfStock 
                                                            ? 'border-red-100 shadow-sm opacity-80' 
                                                            : 'border-slate-100 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-indigo-100 hover:-translate-y-1'
                                                        }`}
                                                >
                                                    <div className={`h-1 w-full absolute top-0 left-0 transition-opacity duration-300 ${isOutOfStock ? 'bg-red-300' : 'bg-gradient-to-r from-indigo-500 to-purple-500 opacity-0 group-hover:opacity-100'}`}></div>
            
                                                    <div className="p-3 flex flex-col flex-1 mt-0.5">
                                                        <button
                                                            type="button"
                                                            data-pos-image-preview="true"
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onMouseDown={(e) => e.stopPropagation()}
                                                                onTouchStart={(e) => e.stopPropagation()}
                                                                onClick={(e) => handleProductImagePreviewClick(e, item)}
                                                            disabled={!item.imageUrl}
                                                                className={`group/photo relative z-10 mb-2 mx-auto h-16 w-16 rounded-2xl overflow-hidden border transition-all duration-200 touch-manipulation select-none ${
                                                                item.imageUrl
                                                                    ? 'border-slate-200 bg-slate-50 hover:scale-[1.02] cursor-zoom-in'
                                                                    : 'border-dashed border-slate-200 bg-slate-50 cursor-default'
                                                            }`}
                                                            aria-label={item.imageUrl ? `Enlarge image for ${item.name}` : `No image for ${item.name}`}
                                                        >
                                                            {item.imageUrl ? (
                                                                <>
                                                                    <img
                                                                        src={item.imageUrl}
                                                                        alt={item.name}
                                                                        className="h-full w-full object-cover transition-all duration-200 group-hover/photo:scale-110 group-hover/photo:opacity-35 group-hover/photo:blur-[1.5px]"
                                                                    />
                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover/photo:bg-black/45 group-hover/photo:opacity-100 pointer-events-none">
                                                                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-gray-900 shadow-md ring-1 ring-black/5">
                                                                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 3H3v5M3 3l6 6M16 3h5v5m0-5l-6 6M8 21H3v-5m0 5l6-6M16 21h5v-5m0 5l-6-6"></path>
                                                                            </svg>
                                                                        </span>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2l2-2a3 3 0 014 0l2 2m-14 4h16"></path>
                                                                    </svg>
                                                                </div>
                                                            )}
                                                        </button>

                                                        <h3 className="font-semibold text-slate-800 text-[15px] leading-snug line-clamp-2 min-h-[44px] mb-2 group-hover:text-indigo-600 transition-colors">
                                                            {item.name}
                                                        </h3>
            
                                                        <div className="flex items-center gap-1.5 mb-3 overflow-hidden min-h-[22px]">
                                                            {item.brand && (
                                                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[86px]">{item.brand}</span>
                                                            )}
                                                            {item.color && (
                                                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md truncate max-w-[64px]">{item.color}</span>
                                                            )}
                                                            <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50/80 px-2 py-0.5 rounded-md border border-indigo-100 truncate shadow-sm">{item.variants.length} Options</span>
                                                        </div>
            
                                                        <div className="flex items-center justify-between mb-3 gap-2 min-h-[20px]">
                                                            <span className="text-[10px] font-mono font-medium text-slate-400 truncate shrink-0">Product Group</span>
                                                            {isOutOfStock ? (
                                                                <span className="text-[10px] font-semibold text-red-600 bg-red-50/80 px-2 py-0.5 rounded-md border border-red-100 shrink-0">Out of Stock</span>
                                                            ) : (
                                                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border shrink-0 ${isLowStock ? 'text-amber-700 bg-amber-50/80 border-amber-100' : 'text-emerald-700 bg-emerald-50/80 border-emerald-100'}`}>
                                                                    {item.stock} in stock
                                                                </span>
                                                            )}
                                                        </div>
            
                                                        <div className="mt-auto pt-3 border-t border-slate-100 space-y-2">
                                                            <div className="flex items-center justify-between gap-2 min-h-[28px]">
                                                                <span className="font-semibold text-slate-900 text-sm leading-none truncate tracking-tight">
                                                                    {item.minPrice === item.maxPrice ? formatCurrency(item.minPrice) : `${formatCurrency(item.minPrice)} - ${formatCurrency(item.maxPrice)}`}
                                                                </span>
                                                                <div className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-md shrink-0">
                                                                    <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
                                                                </div>
                                                            </div>
                                                            <div className="min-h-[26px]">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setVariantModal(createOpenVariantModalState(item));
                                                                    }}
                                                                    className="h-7 w-full rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-semibold tracking-wider transition-colors hover:bg-indigo-100 hover:border-indigo-300 flex items-center justify-center gap-1 shadow-sm"
                                                                >
                                                                    Select Options
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const status = getStockStatus(item, settings);
                                        const isOutOfStock = status === 'Out of Stock';
                                        const isLowStock = status === 'Low Stock';
                                        const hasAlternatives = (() => {
                                            if (status === 'In Stock') {
                                                const budget = getAlternativesByBudget(item, inventory, settings, { limitPerTier: 1, maxSuggestions: 9 });
                                                return [...(budget.low || []), ...(budget.moderate || []), ...(budget.high || [])].length > 0;
                                            }

                                            return getAlternatives(item, inventory, settings, { maxSuggestions: 1 }).length > 0;
                                        })();

                                        return (
                                    <div
                                        key={item.code}
                                        onClick={(e) => {
                                            if (e.target?.closest?.('[data-pos-image-preview="true"]')) {
                                                return;
                                            }
                                            addToCart(item);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                addToCart(item);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        className={`relative flex flex-col rounded-2xl border transition-all duration-300 text-left group overflow-hidden bg-white
                                            min-h-[220px]
                                            ${isOutOfStock 
                                                ? 'border-red-100 shadow-sm opacity-80' 
                                                : 'border-slate-100 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-slate-300 hover:-translate-y-1'
                                            }`}
                                    >
                                        {/* Top accent */}
                                        <div className={`h-1 w-full absolute top-0 left-0 transition-opacity duration-300 ${isOutOfStock ? 'bg-rose-500' : isLowStock ? 'bg-amber-500 opacity-0 group-hover:opacity-100' : 'bg-slate-800 opacity-0 group-hover:opacity-100'}`}></div>

                                        <div className="p-3 flex flex-col flex-1 mt-0.5">
                                            <button
                                                type="button"
                                                data-pos-image-preview="true"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onTouchStart={(e) => e.stopPropagation()}
                                                    onClick={(e) => handleProductImagePreviewClick(e, item)}
                                                disabled={!item.imageUrl}
                                                    className={`group/photo relative z-10 mb-2 mx-auto h-16 w-16 rounded-2xl overflow-hidden border transition-all duration-200 touch-manipulation select-none ${
                                                    item.imageUrl
                                                            ? 'border-slate-200 bg-slate-50 hover:scale-[1.02] cursor-zoom-in'
                                                        : 'border-dashed border-slate-200 bg-slate-50 cursor-default'
                                                }`}
                                                aria-label={item.imageUrl ? `Enlarge image for ${item.name}` : `No image for ${item.name}`}
                                            >
                                                {item.imageUrl ? (
                                                    <>
                                                        <img
                                                            src={item.imageUrl}
                                                            alt={item.name}
                                                            className="h-full w-full object-cover transition-all duration-200 group-hover/photo:scale-110 group-hover/photo:opacity-35 group-hover/photo:blur-[1.5px]"
                                                        />
                                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/0 opacity-0 transition-all duration-150 group-hover/photo:bg-black/45 group-hover/photo:opacity-100">
                                                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-gray-900 shadow-md ring-1 ring-black/5">
                                                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 3H3v5M3 3l6 6M16 3h5v5m0-5l-6 6M8 21H3v-5m0 5l6-6M16 21h5v-5m0 5l-6-6"></path>
                                                                </svg>
                                                            </span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2l2-2a3 3 0 014 0l2 2m-14 4h16"></path>
                                                        </svg>
                                                    </div>
                                                )}
                                            </button>

                                            {/* Row 1: Name (main focus) */}
                                            <h3 className="font-semibold text-slate-800 text-[14px] leading-snug line-clamp-2 min-h-[38px] mb-1.5 group-hover:text-black transition-colors">
                                                {item.name}
                                            </h3>

                                            {/* Row 2: Brand & Color/Variant tags */}
                                            <div className="flex items-center gap-1 mb-2.5 overflow-hidden min-h-[20px]">
                                                {item.brand && (
                                                    <span className="text-[9px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md truncate max-w-[78px]">{item.brand}</span>
                                                )}
                                                {item.color && (
                                                    <span className="text-[9px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md truncate max-w-[58px]">{item.color}</span>
                                                )}
                                                {item.size && (
                                                    <span className="text-[9px] font-semibold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-200 truncate max-w-[92px]">{item.size}</span>
                                                )}
                                            </div>

                                            {/* Row 3: Code + Stock (small info row) */}
                                            <div className="flex items-center justify-between mb-2.5 gap-2 min-h-[18px]">
                                                <span className="text-[9px] font-mono font-medium text-slate-400 truncate">{item.code}</span>
                                                {isOutOfStock ? (
                                                    <span className="text-[9px] font-semibold text-red-600 bg-red-50/80 px-1.5 py-0.5 rounded-md border border-red-100 shrink-0">Out of Stock</span>
                                                ) : (
                                                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-md border shrink-0 ${isLowStock ? 'text-amber-700 bg-amber-50/80 border-amber-100' : 'text-emerald-700 bg-emerald-50/80 border-emerald-100'}`}>
                                                        {item.stock} in stock
                                                    </span>
                                                )}
                                            </div>

                                            {/* Row 4: Price + actions */}
                                            <div className="mt-auto pt-2.5 border-t border-slate-100 space-y-1.5">
                                                <div className="flex items-center justify-between gap-2 min-h-[24px]">
                                                    <span className="font-semibold text-slate-900 text-[15px] leading-none truncate tracking-tight">{formatCurrency(item.price)}</span>
                                                    <div className="h-7 w-7 rounded-full bg-slate-800 text-white flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-md shrink-0">
                                                        <svg className="w-3.5 h-3.5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
                                                    </div>
                                                </div>
                                                <div className="min-h-[26px]">
                                                    {hasAlternatives && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openBudgetAlternatives(item, { budgetOnly: true });
                                                            }}
                                                            className="h-7 w-full rounded-lg border border-emerald-200 bg-emerald-50/80 text-emerald-700 text-[10px] font-semibold tracking-wider transition-colors hover:bg-emerald-100 hover:border-emerald-300 shadow-sm"
                                                        >
                                                            Product Options
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                        );
                                    })()
                                ))}
                            </div>

                            {/* Pagination Controls */}
                            <div className="mt-auto flex shrink-0 flex-col items-start gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-xs text-gray-500 font-medium">
                                        Showing <span className="font-semibold text-gray-900">{filteredProducts.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-semibold text-gray-900">{Math.min(indexOfLastItem, filteredProducts.length)}</span> of <span className="font-semibold text-gray-900">{filteredProducts.length}</span> results
                                    </div>
                                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Right Side: Cart / Order Summary */}
            <div className="w-full md:w-80 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 flex flex-col min-h-[300px] md:h-full z-20">
                <div className="p-3 border-b border-slate-300 flex justify-between items-center bg-slate-200/50 rounded-t-2xl shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                        <h3 className="font-semibold text-lg text-gray-900">Current Order</h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {!isOnline && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-rose-100 text-rose-800 border-rose-200">
                                Offline
                            </span>
                        )}
                        {syncQueue.length > 0 && (
                            <span
                                className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-200"
                                title={syncQueue.find((entry) => entry?.syncError)?.syncError || 'Waiting to synchronize with the backend'}
                            >
                                Pending Sync: {syncQueue.length}
                            </span>
                        )}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${paymentType === 'credit' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200'}`}>
                            {paymentType === 'credit' ? 'Credit' : 'Cash'}
                        </span>
                        <span className="bg-slate-300 text-gray-900 text-xs font-semibold px-2 py-0.5 rounded-full">{cart.reduce((acc, item) => acc + item.qty, 0)} items</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                            </div>
                            <p className="text-sm font-medium">Cart is empty</p>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.code} className="bg-white border border-gray-100 p-2 rounded-lg shadow-sm hover:border-gray-300 transition-colors group">
                                <div className="flex justify-between mb-1">
                                    <h4 className="font-semibold text-gray-800 text-sm line-clamp-1">
                                        {item.brand && <span className="text-gray-400 font-medium">{item.brand} </span>}
                                        {item.name}
                                        {item.color && <span className="text-gray-400 font-normal text-xs"> — {item.color}</span>}
                                    </h4>
                                    <button onClick={() => removeFromCart(item.code)} className="text-gray-400 hover:text-rose-500">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                    </button>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => updateQuantity(item.code, item.qty - 1)}
                                            className="w-6 h-6 rounded flex items-center justify-center hover:opacity-90 shadow-md transform hover:-translate-y-0.5 transition-all text-sm font-semibold pb-0.5"
                                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                                        >
                                            -
                                        </button>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            min="1"
                                            onFocus={(e) => e.target.select()}
                                            value={item.qty}
                                            onKeyDown={preventInvalidWholeNumberKeyDown}
                                            onPaste={preventInvalidWholeNumberPaste}
                                            onChange={(e) => {
                                                const value = sanitizeWholeNumberInput(e.target.value);
                                                if (isWholeNumberInput(value, { min: 1 })) {
                                                    updateQuantity(item.code, Number(value));
                                                }
                                            }}
                                            className="w-12 text-center text-sm font-semibold bg-white border border-gray-300 rounded focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none"
                                        />
                                        <button 
                                            onClick={() => updateQuantity(item.code, item.qty + 1)}
                                            className="w-6 h-6 rounded flex items-center justify-center hover:opacity-90 shadow-md transform hover:-translate-y-0.5 transition-all text-sm font-semibold pb-0.5"
                                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                                        >
                                            +
                                        </button>
                                    </div>
                                    <span className="font-semibold text-base text-gray-900">{formatCurrency(item.price * item.qty)}</span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-500 flex justify-between">
                                    <span>{item.code}</span>
                                    <span>@ {formatCurrency(item.price)}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="relative p-3 bg-slate-200/50 border-t border-slate-300 rounded-b-2xl shrink-0 z-30">
                    <div className="absolute right-3 top-0 z-10 -translate-y-1/2">
                        <motion.button
                            type="button"
                            onClick={() => setIsOrderSummaryDetailsCollapsed((prev) => !prev)}
                            initial={false}
                            whileHover={{ width: 96 }}
                            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                            className="group inline-flex h-7 w-7 items-center justify-start overflow-hidden whitespace-nowrap rounded-md border border-gray-300 bg-white px-1.5 text-[9px] font-semibold uppercase tracking-wider text-gray-700 shadow-sm hover:bg-gray-100"
                            aria-label={isOrderSummaryDetailsCollapsed ? 'Show details' : 'Hide details'}
                            title={isOrderSummaryDetailsCollapsed ? 'Show details' : 'Hide details'}
                        >
                            <svg className={`h-3 w-3 shrink-0 transition-transform ${isOrderSummaryDetailsCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="ml-0 max-w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:ml-1 group-hover:max-w-[72px] group-hover:opacity-100">
                                {isOrderSummaryDetailsCollapsed ? 'Show Details' : 'Hide Details'}
                            </span>
                        </motion.button>
                    </div>

                    <AnimatePresence initial={false}>
                    {!isOrderSummaryDetailsCollapsed && (
                    <motion.div
                        key="order-summary-details"
                        initial={{ height: 0, opacity: 0, y: -6 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -6 }}
                        transition={{ duration: 0.22, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                    <div className="space-y-2 mb-3 bg-white p-2 rounded-lg">
                        <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 border border-slate-200">
                            <button
                                type="button"
                                onClick={() => setPaymentType('cash')}
                                className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold tracking-wider transition-all ${paymentType === 'cash' ? 'bg-emerald-200 text-emerald-900 shadow-sm' : 'text-slate-600 hover:bg-white'}`}
                            >
                                Cash
                            </button>
                            <button
                                type="button"
                                onClick={() => setPaymentType('credit')}
                                className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold tracking-wider transition-all ${paymentType === 'credit' ? 'bg-amber-200 text-amber-900 shadow-sm' : 'text-slate-600 hover:bg-white'}`}
                            >
                                Credit
                            </button>
                        </div>

                        {paymentType === 'cash' ? (
                            <>
                                <div className="flex justify-between items-center text-sm text-gray-600 font-semibold">
                                    <span>Cash</span>
                                    <div className="relative group">
                                    <div className={`flex items-center gap-1 border-b transition-colors ${isCashAmountTooLarge ? 'border-red-500 focus-within:border-red-600' : 'border-gray-300'} ${cart.length > 0 && !isCashAmountTooLarge ? 'focus-within:border-gray-900' : ''}`}>
                                        <span>₱</span>
                                        <input 
                                            type="text"
                                            inputMode="decimal"
                                            disabled={cart.length === 0}
                                            value={cashAmount}
                                            onKeyDown={preventInvalidMoneyKeyDown}
                                            onPaste={preventInvalidMoneyPaste}
                                            onChange={(e) => setCashAmount(sanitizeCashTenderedInput(e.target.value))}
                                            onBlur={() => setCashAmount((value) => formatMoneyInput(value))}
                                            aria-label="Cash tendered"
                                            aria-invalid={isCashAmountTooLarge}
                                            aria-describedby={isCashAmountTooLarge ? 'cash-tendered-size-error' : undefined}
                                            placeholder="0.00"
                                            className={`w-20 text-right bg-transparent outline-none font-semibold text-sm text-gray-900 ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}
                                        />
                                    </div>
                                    {cart.length === 0 && (
                                        <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                            <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                                Add item first
                                            </div>
                                            <span className="absolute -bottom-1 right-4 h-2 w-2 rotate-45 bg-gray-900" />
                                        </div>
                                    )}
                                    </div>
                                </div>
                                {isCashAmountTooLarge && (
                                    <p id="cash-tendered-size-error" role="alert" className="-mt-1 text-right text-[10px] font-medium text-red-600">
                                        Amount is too large. Please enter a smaller value.
                                    </p>
                                )}
                                <div className="flex justify-between items-center text-sm text-gray-600 font-semibold">
                                    <span>Change</span>
                                    <span className="text-gray-900 font-semibold">
                                        {isCashAmountTooLarge ? '—' : formatCurrencyFromCentavos(changeCentavosForDisplay ?? 0)}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">VAT Mode</label>
                                    <select
                                        value={selectedVatMode}
                                        onChange={(e) => setSelectedVatMode(e.target.value)}
                                        disabled={cart.length === 0}
                                        className="w-full px-2 py-1.5 rounded-md border border-gray-300 text-xs font-semibold bg-white focus:border-emerald-500 focus:outline-none"
                                    >
                                        {VAT_MODE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Regular Customer</label>
                                    <input
                                        type="text"
                                        list="credit-customer-options"
                                        value={selectedCreditCustomerName}
                                        onChange={(e) => handleCreditCustomerInputChange(e.target.value)}
                                        disabled={cart.length === 0}
                                        placeholder="Select an eligible regular customer"
                                        className="w-full px-2.5 py-2 rounded-lg border border-gray-300 text-sm font-semibold bg-white focus:border-amber-500 focus:outline-none"
                                    />
                                    <datalist id="credit-customer-options">
                                        {creditCustomerOptions.map((customer) => (
                                            <option key={customer.id} value={customer.name} />
                                        ))}
                                    </datalist>
                                </div>
                                <div className="flex flex-col gap-1" ref={creditPaymentModeRef}>
                                    <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Mode of Payment</label>
                                    <button
                                        type="button"
                                        onClick={() => setIsCreditPaymentModeOpen((prev) => !prev)}
                                        disabled={cart.length === 0}
                                        className="w-full px-2.5 py-2 rounded-lg border border-gray-300 text-sm font-semibold bg-white text-gray-800 text-left focus:border-amber-500 focus:outline-none"
                                    >
                                        {selectedCreditPaymentMode
                                            ? (selectedCreditPaymentMode === 'other'
                                                ? (customCreditPaymentMode || 'Other')
                                                : formatCreditPaymentModeLabel(selectedCreditPaymentMode))
                                            : 'Select payment mode'}
                                    </button>
                                    {isCreditPaymentModeOpen && cart.length > 0 && (
                                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                                            <div className="max-h-48 overflow-y-auto py-1">
                                                {CREDIT_PAYMENT_MODES.map((mode) => (
                                                    <button
                                                        key={mode}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedCreditPaymentMode(mode);
                                                            if (mode !== 'other') {
                                                                setCustomCreditPaymentMode('');
                                                                setIsCreditPaymentModeOpen(false);
                                                            }
                                                        }}
                                                        className={`w-full px-3 py-2 text-left text-sm font-semibold hover:bg-amber-50 ${selectedCreditPaymentMode === mode ? 'bg-amber-50 text-amber-700' : 'text-gray-700'}`}
                                                    >
                                                        {formatCreditPaymentModeLabel(mode)}
                                                    </button>
                                                ))}
                                                {selectedCreditPaymentMode === 'other' && (
                                                    <div className="border-t border-gray-200 p-2">
                                                        <input
                                                            type="text"
                                                            value={customCreditPaymentMode}
                                                            onChange={(e) => setCustomCreditPaymentMode(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    setIsCreditPaymentModeOpen(false);
                                                                }
                                                                if (e.key === 'Escape') {
                                                                    e.preventDefault();
                                                                    setIsCreditPaymentModeOpen(false);
                                                                }
                                                            }}
                                                            placeholder="Type other payment mode"
                                                            className="w-full px-2.5 py-2 rounded-lg border border-gray-300 text-sm font-semibold bg-white text-gray-800 focus:border-amber-500 focus:outline-none"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Credit Term</label>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={decrementCreditTerm}
                                            disabled={cart.length === 0 || Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS) <= MIN_CREDIT_TERM_DAYS}
                                            className={`w-8 h-8 rounded-lg border border-gray-300 text-sm font-semibold ${cart.length === 0 ? 'text-gray-300 cursor-not-allowed bg-gray-50' : 'text-gray-700 bg-white hover:bg-gray-100'}`}
                                        >
                                            -
                                        </button>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            min={MIN_CREDIT_TERM_DAYS}
                                            max={MAX_CREDIT_TERM_DAYS}
                                            value={selectedCreditTermDays}
                                            onKeyDown={preventInvalidWholeNumberKeyDown}
                                            onPaste={preventInvalidWholeNumberPaste}
                                            onChange={(e) => handleCreditTermInputChange(e.target.value)}
                                            disabled={cart.length === 0}
                                            className="flex-1 px-2.5 py-2 rounded-lg border border-gray-300 text-sm font-semibold bg-white text-center focus:border-amber-500 focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={incrementCreditTerm}
                                            disabled={cart.length === 0 || Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS) >= MAX_CREDIT_TERM_DAYS}
                                            className={`w-8 h-8 rounded-lg border border-gray-300 text-sm font-semibold ${cart.length === 0 ? 'text-gray-300 cursor-not-allowed bg-gray-50' : 'text-gray-700 bg-white hover:bg-gray-100'}`}
                                        >
                                            +
                                        </button>
                                        <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">days</span>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-sm text-gray-600 font-semibold">
                                    <span>Due Date</span>
                                    <span className="text-gray-900 font-semibold">
                                        {computedCreditDueDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">VAT Mode</label>
                                    <select
                                        value={selectedVatMode}
                                        onChange={(e) => setSelectedVatMode(e.target.value)}
                                        disabled={cart.length === 0}
                                        className="w-full px-2 py-1.5 rounded-md border border-gray-300 text-xs font-semibold bg-white focus:border-amber-500 focus:outline-none"
                                    >
                                        {VAT_MODE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}

                        <div className="flex justify-between font-semibold text-xl text-gray-900 pt-2 border-t border-dashed border-gray-200">
                            <span>Total</span>
                            <span>{formatCurrency(calculateTotal())}</span>
                        </div>
                        {(() => {
                            const vat = calculateVatBreakdown();
                            if (!vat) return null;
                            return (
                                vat.netAmount > 0 ? (
                                    <div className="space-y-1 text-xs pt-2 border-t border-dashed border-gray-200">
                                        <div className="flex justify-between text-gray-600 font-medium">
                                            <span>Net Amount</span>
                                            <span className="text-gray-900 font-semibold">{formatCurrency(vat.netAmount)}</span>
                                        </div>
                                        {vat.vatAmount > 0 && (
                                            <div className="flex justify-between text-amber-600 font-medium">
                                                <span>{formatVatModeLabel(selectedVatMode)}</span>
                                                <span className="text-amber-800 font-semibold">{formatCurrency(vat.vatAmount)}</span>
                                            </div>
                                        )}
                                    </div>
                                ) : null
                            );
                        })()}
                    </div>
                    </motion.div>
                    )}
                    </AnimatePresence>
                    <div className="flex gap-2">
                        <div className={`relative group flex-1 ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}>
                            <button 
                                onClick={() => setShowQuotationInput(true)}
                                disabled={cart.length === 0}
                                style={{ backgroundColor: '#ffffff', color: '#111827', border: '2px solid #111827' }}
                                className={`w-full py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest flex items-center justify-center shadow-md transform transition-transform duration-150 ${cart.length === 0 ? 'pointer-events-none' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                            >
                                Quotation
                            </button>
                            {cart.length === 0 && (
                                <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                    <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                        Add item first
                                    </div>
                                    <span className="absolute -bottom-1 right-6 h-2 w-2 rotate-45 bg-gray-900" />
                                </div>
                            )}
                        </div>
                        <div className={`relative group flex-1 ${isCheckoutDisabled ? 'cursor-not-allowed' : ''}`}>
                            <button 
                                onClick={handleCheckout}
                                disabled={isCheckoutDisabled}
                                style={{ backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' }}
                                className={`w-full py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest flex items-center justify-center shadow-xl transform transition-transform duration-150 ${isCheckoutDisabled ? 'pointer-events-none' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                            >
                                {isCheckoutProcessing ? 'Processing...' : (paymentType === 'credit' ? 'Create Credit Order' : 'Process Payment')}
                            </button>
                            {isCheckoutDisabled && (
                                <div className="pointer-events-none absolute -top-11 right-0 z-30 hidden w-max max-w-[260px] group-hover:block group-focus-within:block">
                                    <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold text-white shadow-xl ring-1 ring-black/10">
                                        {checkoutDisabledMessage}
                                    </div>
                                    <span className="absolute -bottom-1 right-6 h-2 w-2 rotate-45 bg-gray-900" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        {/* Recommendation Modal */}
        {recommendationModal.isOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className={`p-3 border-b ${recommendationModal.type === 'out-of-stock' ? 'bg-red-50 border-red-100' : recommendationModal.type === 'low-stock' ? 'bg-yellow-50 border-yellow-100' : 'bg-emerald-50 border-emerald-100'}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-1.5 rounded-lg ${recommendationModal.type === 'out-of-stock' ? 'bg-red-100 text-red-600' : recommendationModal.type === 'low-stock' ? 'bg-yellow-100 text-yellow-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className={`text-base font-semibold tracking-tight ${recommendationModal.type === 'out-of-stock' ? 'text-red-900' : recommendationModal.type === 'low-stock' ? 'text-yellow-900' : 'text-emerald-900'}`}>
                                        {recommendationModal.type === 'out-of-stock'
                                            ? 'Item Out of Stock'
                                            : recommendationModal.type === 'low-stock'
                                                ? 'Low Stock Warning'
                                                : 'Budget Alternatives'}
                                    </h3>
                                    <p className={`text-xs font-medium mt-0 ${recommendationModal.type === 'out-of-stock' ? 'text-red-700' : recommendationModal.type === 'low-stock' ? 'text-yellow-700' : 'text-emerald-700'}`}>
                                        {recommendationModal.item.brand ? `${recommendationModal.item.brand} ` : ''}{recommendationModal.item.name}{recommendationModal.item.color ? ` — ${recommendationModal.item.color}` : ''} ({recommendationModal.item.code})
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}
                                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-white rounded-full transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    <div className="p-4">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            {recommendationModal.type === 'in-stock' ? 'Budget Alternatives' : 'Recommended Alternatives'}
                        </h4>

                        <p className="text-[11px] text-gray-500 mb-3">
                            {recommendationModal.type === 'in-stock'
                                ? 'Value/Standard/Premium is based on price relative to the selected product.'
                                : 'Low/Out-of-stock items use standard alternatives.'}
                        </p>
                        
                        {recommendationModal.alternatives.length > 0 ? (
                            <div className="max-h-[440px] overflow-y-auto pr-2 -mr-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pb-2">
                                    {recommendationModal.alternatives.map(alt => (
                                        <div 
                                            key={alt.code} 
                                            className="group p-4 rounded-2xl border border-slate-200 hover:border-slate-800 hover:shadow-xl transition-all duration-300 cursor-pointer relative bg-white flex flex-col min-h-[248px] overflow-hidden shrink-0 hover:-translate-y-1"
                                        onClick={() => selectRecommendedAlternative(alt)}
                                    >
                                        {/* Decorative Top Line */}
                                        <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                          
                                        <ProductThumbnail item={alt} className="absolute left-4 top-5 h-16 w-16" onPreview={handleProductImagePreviewClick} />
                                        <div className="mb-3 mt-1 ml-20 min-h-[64px]">
                                            <h5 className="text-[15px] font-semibold text-slate-800 group-hover:text-black leading-snug mb-2 break-words">
                                                {alt.brand && <span className="text-slate-400 font-semibold">{alt.brand} </span>}
                                                {alt.name}
                                                {alt.color && <span className="text-slate-500 font-medium"> — {alt.color}</span>}
                                            </h5>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-[11px] font-semibold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md inline-block font-mono">{alt.code}</p>
                                            {recommendationModal.type === 'in-stock' && (
                                                <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md inline-block ${(getRelativeTierKey(alt.price, recommendationModal.item?.price) === 'low') ? 'bg-emerald-50/80 text-emerald-700 border border-emerald-200/80' : (getRelativeTierKey(alt.price, recommendationModal.item?.price) === 'moderate') ? 'bg-amber-50/80 text-amber-700 border border-amber-200/80' : 'bg-blue-50/80 text-blue-700 border border-blue-200/80'}`}>
                                                    {getTierDisplayLabel(getRelativeTierKey(alt.price, recommendationModal.item?.price))}
                                                </span>
                                            )}
                                            </div>
                                        </div>
                                        
                                        <div className="mt-auto space-y-3">
                                            <div className="grid grid-cols-[48px_1fr] items-start border-b border-slate-100 pb-2 gap-2">
                                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">Size</span>
                                                <span className="text-[13px] font-semibold text-slate-800 leading-tight text-right break-words min-h-[18px]">{alt.size || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 items-end">
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Price</p>
                                                    <p className="text-lg font-semibold text-slate-900 truncate tracking-tight">{formatCurrency(alt.price)}</p>
                                                </div>
                                                <div className="text-right min-w-0">
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Stock</p>
                                                    <p className={`text-[15px] font-semibold truncate shadow-sm rounded-md px-2 py-0.5 inline-block border ${alt.stock < 20 ? 'text-amber-700 bg-amber-50/80 border-amber-100' : 'text-emerald-700 bg-emerald-50/80 border-emerald-100'}`}>{alt.stock}</p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    selectRecommendedAlternative(alt);
                                                }}
                                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold tracking-widest text-slate-700 shadow-sm transition-colors hover:border-slate-900 hover:bg-slate-900 hover:text-white focus:border-slate-900 focus:bg-slate-900 focus:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
                                            >
                                                SELECT
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        ) : (
                            <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                <svg className="w-12 h-12 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <h3 className="text-sm font-semibold text-gray-900">No alternatives found</h3>
                                <p className="text-gray-500 italic mt-0.5 text-xs">We couldn't find similar items in stock for this product.</p>
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                        <button 
                            onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}
                            className="px-4 py-2 rounded-xl text-xs font-semibold text-black bg-transparent hover:bg-gray-100 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                            style={{ border: '2px solid #000' }}
                        >
                            Cancel
                        </button>
                        {recommendationModal.type === 'low-stock' && (
                            <button 
                                onClick={() => addToCart(recommendationModal.item, true)}
                                className="px-5 py-2 rounded-xl text-xs font-semibold text-white hover:opacity-90 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                                style={{ backgroundColor: '#111827', border: '2px solid #111827' }}
                            >
                                Continue with Original ({recommendationModal.item.stock} left)
                            </button>
                        )}
                    </div>
                </div>
            </div>
        )}
        {enlargedProductImage && (
            <div
                className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 backdrop-blur-lg p-4 animate-in fade-in duration-200"
                onClick={closeProductImagePreview}
            >
                <div
                    className="relative max-w-4xl w-full max-h-[90vh] flex items-center justify-center animate-in zoom-in-90 fade-in duration-250"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={closeProductImagePreview}
                        className="absolute -top-3 -right-3 z-10 h-10 w-10 rounded-full bg-white text-gray-900 shadow-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
                        aria-label="Close image preview"
                    >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                    <img
                        src={enlargedProductImage.src}
                        alt={enlargedProductImage.alt}
                        className="max-h-[90vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/10 bg-white"
                    />
                </div>
            </div>
        )}
        {/* Variant Picker Modal */}
        {variantModal.isOpen && variantModal.group && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md transition-all">
                <div className="bg-white w-full max-w-lg rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.2)] flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-300 overflow-hidden ring-1 ring-slate-900/5">
                    <div className="px-5 py-4 border-b border-slate-100 bg-white/70 backdrop-blur-xl flex flex-col gap-3 relative z-10">
                        <div className="w-full">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                {variantModal.step === 'variants' && variantModal.group.availableBrands?.length > 1 && (
                                    <button 
                                        onClick={() => setVariantModal(prev => ({ ...prev, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null, quantity: 1 }))}
                                        className="text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 transition-all"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                        Back to Brands
                                    </button>
                                )}
                                <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full uppercase tracking-widest">{variantModal.step === 'brand' ? 'Select Brand' : 'Product Group'}</span>
                                {variantModal.step === 'variants' && variantModal.selectedBrand && <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">{variantModal.selectedBrand}</span>}
                                {variantModal.step === 'variants' && !variantModal.selectedBrand && variantModal.group.brand && variantModal.group.brand !== 'Multiple Brands' && <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">{variantModal.group.brand}</span>}
                            </div>
                            <h3 className="text-xl font-semibold text-slate-900 tracking-tight leading-tight text-center">
                                {variantModal.group.name}
                            </h3>
                            {variantModal.group.color && variantModal.group.color !== 'Multiple Colors' && <p className="text-xs font-medium text-slate-500 mt-1 text-center">Base Color: <span className="text-slate-800 font-semibold">{variantModal.group.color}</span></p>}
                            {variantModal.step === 'variants' && (
                                <div className="mt-3 flex justify-center">
                                    <ProductThumbnail item={variantModalImageItem} className="h-18 w-18" onPreview={handleProductImagePreviewClick} />
                                </div>
                            )}
                        </div>
                        <button 
                            onClick={() => setVariantModal(createClosedVariantModalState())}
                            className="absolute top-4 right-5 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-full transition-all"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto w-full max-h-full no-scrollbar">
                        {variantModal.step === 'brand' ? (
                            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3 pb-12">
                                 {variantModal.group.availableBrands.map(brand => {
                                     const brandVariants = variantModal.group.variants.filter(v => v.brand === brand);
                                    const brandImageItem = brandVariants.find((variant) => getProductImageUrl(variant)) || brandVariants[0] || null;
                                     const isBrandOutOfStock = brandVariants.every(v => v.stock <= 0);
                                    const brandPrices = brandVariants.map(v => Number(v.price) || 0);
                                    const minBrandPrice = brandPrices.length ? Math.min(...brandPrices) : 0;
                                    const maxBrandPrice = brandPrices.length ? Math.max(...brandPrices) : 0;
                                    const brandPriceLabel = minBrandPrice === maxBrandPrice
                                        ? formatCurrency(minBrandPrice)
                                        : `${formatCurrency(minBrandPrice)} - ${formatCurrency(maxBrandPrice)}`;
                                    
                                    return (
                                        <div 
                                            key={brand || 'unbranded'}
                                            className={`group p-4 rounded-2xl border-2 transition-all duration-300 relative flex flex-col items-center justify-center text-center min-h-[128px] 
                                                ${isBrandOutOfStock 
                                                    ? 'bg-rose-50/30 border-rose-100 cursor-not-allowed opacity-70 grayscale-[0.5]' 
                                                    : 'bg-white border-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_4px_10px_rgba(0,0,0,0.03)] hover:border-indigo-500/20 hover:shadow-[0_0_0_2px_rgba(99,102,241,0.2),0_10px_25px_-5px_rgba(0,0,0,0.1)] cursor-pointer hover:-translate-y-1'
                                                }`}
                                            onClick={() => {
                                                if (!isBrandOutOfStock) {
                                                    setVariantModal(prev => ({ ...prev, step: 'variants', selectedBrand: brand, selectedSize: null, selectedColor: null, quantity: 1 }));
                                                }
                                            }}
                                        >
                                            <ProductThumbnail item={brandImageItem} className="h-12 w-12 mb-3" onPreview={handleProductImagePreviewClick} fit="contain" />
                                            <h4 className="text-base font-semibold text-slate-800 tracking-tight leading-tight">{brand || 'Unbranded'}</h4>
                                            
                                            <div className="flex-1 flex flex-col justify-end mt-2 w-full">
                                                <div className={`text-[11px] font-semibold py-1 px-2.5 rounded-lg inline-block mx-auto transition-all duration-300 ${isBrandOutOfStock ? 'bg-transparent text-rose-500/0 hidden' : 'bg-slate-50 text-slate-600 border border-slate-100 shadow-sm group-hover:bg-indigo-50 group-hover:text-indigo-700 group-hover:border-indigo-100'}`}>
                                                    {brandPriceLabel}
                                                </div>
                                                {isBrandOutOfStock && (
                                                    <span className="text-[10px] font-semibold text-rose-600 bg-rose-100/80 border border-rose-200/50 px-3 py-1 rounded-full uppercase tracking-widest mt-1 shadow-sm">Out of Stock</span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col h-full relative">
                                {(() => {
                                    const filteredVariants = variantModal.group.variants.filter(v => variantModal.selectedBrand ? v.brand === variantModal.selectedBrand : true);
                                    const sizeOptionMap = new Map();
                                    filteredVariants.forEach((variant) => {
                                        const rawSize = String(variant?.size || '').trim();
                                        if (!rawSize) return;

                                        const normalizedSize = normalizeVariantOption(rawSize);
                                        if (!normalizedSize || sizeOptionMap.has(normalizedSize)) return;

                                        sizeOptionMap.set(normalizedSize, formatVariantOptionLabel(rawSize));
                                    });

                                    const colorOptionMap = new Map();
                                    filteredVariants.forEach((variant) => {
                                        const rawColor = String(variant?.color || '').trim();
                                        if (!rawColor) return;

                                        const normalizedColor = normalizeVariantOption(rawColor);
                                        if (!normalizedColor || colorOptionMap.has(normalizedColor)) return;

                                        colorOptionMap.set(normalizedColor, formatVariantOptionLabel(rawColor));
                                    });

                                    const uniqueSizes = Array.from(sizeOptionMap.entries())
                                        .map(([key, label]) => ({ key, label }))
                                        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
                                    const uniqueColors = Array.from(colorOptionMap.entries())
                                        .map(([key, label]) => ({ key, label }))
                                        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));

                                    const needsColor = uniqueColors.length > 0;
                                    const needsSize = uniqueSizes.length > 0;
                                    const resolvedSelectedColor = variantModal.selectedColor ?? (uniqueColors.length === 1 ? uniqueColors[0].key : null);
                                    const resolvedSelectedSize = variantModal.selectedSize ?? (uniqueSizes.length === 1 ? uniqueSizes[0].key : null);
                                    const hasSelectedColor = resolvedSelectedColor !== null;
                                    const hasSelectedSize = resolvedSelectedSize !== null;

                                    const isAllSelected = (!needsColor || hasSelectedColor) && (!needsSize || hasSelectedSize);

                                    const matchedVariant = isAllSelected ? filteredVariants.find(v => 
                                        (!needsColor || normalizeVariantOption(v.color) === resolvedSelectedColor) && 
                                        (!needsSize || normalizeVariantOption(v.size) === resolvedSelectedSize)
                                    ) : null;
                                    const narrowedVariants = filteredVariants.filter((variant) => (
                                        (!needsColor || !hasSelectedColor || normalizeVariantOption(variant.color) === resolvedSelectedColor)
                                        && (!needsSize || !hasSelectedSize || normalizeVariantOption(variant.size) === resolvedSelectedSize)
                                    ));
                                    const fallbackAlternativeTarget = matchedVariant
                                        || filteredVariants.find(v =>
                                            (needsSize && hasSelectedSize && normalizeVariantOption(v.size) === resolvedSelectedSize)
                                            || (needsColor && hasSelectedColor && normalizeVariantOption(v.color) === resolvedSelectedColor)
                                        )
                                        || filteredVariants[0]
                                        || null;
                                    const canAddSelectedVariant = Boolean(matchedVariant && Number(matchedVariant.stock) > 0);
                                    const canOpenAlternatives = Boolean(fallbackAlternativeTarget);
                                    const isPrimaryDisabled = !isAllSelected || (!canAddSelectedVariant && !canOpenAlternatives);
                                    const maxSelectableQty = Math.max(1, Number(matchedVariant?.stock) || 1);
                                    const selectedQuantity = Math.min(Math.max(1, Number(variantModal.quantity) || 1), maxSelectableQty);
                                    const selectedUnitPrice = Number(matchedVariant?.price || 0);
                                    const selectedTotalPrice = selectedUnitPrice * selectedQuantity;

                                    return (
                                        <div className="flex flex-col bg-white overflow-hidden h-full relative">
                                            <div className="flex-1 overflow-y-auto p-5 pb-32 no-scrollbar">
                                                <div className="flex justify-between items-start mb-5 bg-slate-50 border border-slate-100 rounded-2xl p-4 shadow-sm">
                                                    <div>
                                                        <h4 className="text-2xl font-semibold text-slate-900 tracking-tight">
                                                            {matchedVariant 
                                                                ? formatCurrency(selectedTotalPrice)
                                                                : (Math.min(...filteredVariants.map(v => v.price)) === Math.max(...filteredVariants.map(v => v.price)) 
                                                                    ? formatCurrency(Math.min(...filteredVariants.map(v => v.price))) 
                                                                    : `${formatCurrency(Math.min(...filteredVariants.map(v => v.price)))} - ${formatCurrency(Math.max(...filteredVariants.map(v => v.price)))}`)}
                                                        </h4>
                                                        {matchedVariant && (
                                                            <p className="text-[10px] font-semibold text-slate-500 mt-1">
                                                                {formatCurrency(selectedUnitPrice)} x {selectedQuantity}
                                                            </p>
                                                        )}
                                                        <div className="mt-1.5 flex items-center gap-1.5">
                                                            {!isAllSelected ? (
                                                                <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-widest border border-amber-100">Select options</span>
                                                            ) : !matchedVariant ? (
                                                                <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-widest border border-rose-100">Combination Not Found</span>
                                                            ) : (
                                                                (() => {
                                                                    const status = getStockStatus(matchedVariant, settings);

                                                                    if (status === 'Out of Stock') {
                                                                        return (
                                                                            <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-widest border border-rose-100">
                                                                                Out of Stock (0)
                                                                            </span>
                                                                        );
                                                                    }

                                                                    if (status === 'Low Stock') {
                                                                        return (
                                                                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-widest border border-amber-100">
                                                                                {matchedVariant.stock} left (Low Stock)
                                                                            </span>
                                                                        );
                                                                    }

                                                                    return (
                                                                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md uppercase tracking-widest border border-emerald-100">
                                                                            {matchedVariant.stock} in stock
                                                                        </span>
                                                                    );
                                                                })()
                                                            )}
                                                        </div>
                                                    </div>
                                                    {matchedVariant && (
                                                        <div className="text-right">
                                                            <p className="text-[9px] font-semibold tracking-widest text-slate-400 uppercase mb-1">SKU</p>
                                                            <p className="text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-sm">{matchedVariant.code}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {needsSize && (
                                                    <div className="mb-6">
                                                        <div className="flex items-center justify-between mb-2.5">
                                                            <h5 className="text-[11px] font-semibold text-slate-800 uppercase tracking-widest">Select Size/Variant</h5>
                                                            {hasSelectedSize && <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{sizeOptionMap.get(resolvedSelectedSize) || resolvedSelectedSize}</span>}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {uniqueSizes.map((sizeOption) => {
                                                                const isSelected = resolvedSelectedSize === sizeOption.key;
                                                                const hasMatchingCombination = filteredVariants.some((variant) => (
                                                                    normalizeVariantOption(variant.size) === sizeOption.key
                                                                    && (!needsColor || !hasSelectedColor || normalizeVariantOption(variant.color) === resolvedSelectedColor)
                                                                ));
                                                                const hasStock = filteredVariants.some((variant) => (
                                                                    normalizeVariantOption(variant.size) === sizeOption.key
                                                                    && (!needsColor || !hasSelectedColor || normalizeVariantOption(variant.color) === resolvedSelectedColor)
                                                                    && Number(variant.stock) > 0
                                                                ));

                                                                return (
                                                                    <div key={sizeOption.key} className="relative group">
                                                                        <button
                                                                            disabled={!hasMatchingCombination}
                                                                            onClick={() => {
                                                                                if (!hasMatchingCombination) return;
                                                                                setVariantModal(prev => ({ ...prev, selectedSize: isSelected ? null : sizeOption.key, quantity: 1 }));
                                                                            }}
                                                                            className={`min-w-[52px] px-3 py-2 text-[13px] font-semibold rounded-xl border-2 transition-all duration-200 ${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105' : !hasMatchingCombination ? 'border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed opacity-70' : hasStock ? 'border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 bg-white hover:shadow-sm hover:-translate-y-0.5' : 'border-rose-200 text-rose-700 bg-rose-50 hover:border-rose-300 hover:bg-rose-100 hover:-translate-y-0.5'}`}
                                                                        >
                                                                            {sizeOption.label}
                                                                        </button>
                                                                        {!hasMatchingCombination ? (
                                                                            <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 z-30 hidden w-max group-hover:block transition-all">
                                                                                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-xl">
                                                                                    Not available for selected color
                                                                                </div>
                                                                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-slate-900" />
                                                                            </div>
                                                                        ) : !hasStock && (
                                                                            <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 z-30 hidden w-max group-hover:block transition-all">
                                                                                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-xl">      
                                                                                    Sold Out
                                                                                </div>
                                                                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-slate-900" />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {needsColor && (
                                                    <div className="mb-4">
                                                        <div className="flex items-center justify-between mb-2.5">
                                                            <h5 className="text-[11px] font-semibold text-slate-800 uppercase tracking-widest">Select Color</h5>
                                                            {hasSelectedColor && <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{colorOptionMap.get(resolvedSelectedColor) || resolvedSelectedColor}</span>}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {uniqueColors.map((colorOption) => {
                                                                const isSelected = resolvedSelectedColor === colorOption.key;
                                                                const hasMatchingCombination = filteredVariants.some((variant) => (
                                                                    normalizeVariantOption(variant.color) === colorOption.key
                                                                    && (!needsSize || !hasSelectedSize || normalizeVariantOption(variant.size) === resolvedSelectedSize)
                                                                ));
                                                                const hasStock = filteredVariants.some((variant) => (
                                                                    normalizeVariantOption(variant.color) === colorOption.key
                                                                    && (!needsSize || !hasSelectedSize || normalizeVariantOption(variant.size) === resolvedSelectedSize)
                                                                    && Number(variant.stock) > 0
                                                                ));

                                                                return (
                                                                    <div key={colorOption.key} className="relative group">
                                                                        <button
                                                                            disabled={!hasMatchingCombination}
                                                                            onClick={() => {
                                                                                if (!hasMatchingCombination) return;
                                                                                setVariantModal(prev => ({ ...prev, selectedColor: isSelected ? null : colorOption.key, quantity: 1 }));
                                                                            }}
                                                                            className={`px-4 py-2 text-[13px] font-semibold rounded-xl border-2 transition-all duration-200 flex items-center justify-center ${isSelected ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105' : !hasMatchingCombination ? 'border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed opacity-70' : hasStock ? 'border-slate-200 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 bg-white hover:shadow-sm hover:-translate-y-0.5' : 'border-rose-200 text-rose-700 bg-rose-50 hover:border-rose-300 hover:bg-rose-100 hover:-translate-y-0.5'}`}
                                                                        >
                                                                            {colorOption.label}
                                                                        </button>
                                                                        {!hasMatchingCombination ? (
                                                                            <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 z-30 hidden w-max group-hover:block transition-all">
                                                                                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-xl">
                                                                                    Not available for selected size
                                                                                </div>
                                                                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-slate-900" />
                                                                            </div>
                                                                        ) : !hasStock && (
                                                                            <div className="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 z-30 hidden w-max group-hover:block transition-all">
                                                                                <div className="rounded-xl bg-slate-900 px-3 py-1.5 text-[10px] font-semibold text-white shadow-xl">      
                                                                                    Sold Out
                                                                                </div>
                                                                                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-slate-900" />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="absolute bottom-0 left-0 right-0 p-5 pt-5 bg-gradient-to-t from-white via-white to-transparent border-t-0 border-slate-100 z-20 pointer-events-none">
                                                {canAddSelectedVariant && (
                                                    <div className="mb-2.5 flex items-center justify-between gap-2.5 pointer-events-auto">
                                                        <div className="min-w-0">
                                                            <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-widest">Quantity</p>
                                                            <p className="text-[10px] text-slate-500">Max {maxSelectableQty} available</p>
                                                        </div>
                                                        <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                                                            <button
                                                                type="button"
                                                                disabled={selectedQuantity <= 1}
                                                                onClick={() => setVariantModal(prev => ({ ...prev, quantity: Math.max(1, (Number(prev.quantity) || 1) - 1) }))}
                                                                className={`h-9 w-9 flex items-center justify-center text-base font-semibold transition-colors ${selectedQuantity <= 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50'}`}
                                                            >
                                                                -
                                                            </button>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                pattern="[0-9]*"
                                                                min="1"
                                                                max={maxSelectableQty}
                                                                value={selectedQuantity}
                                                                onKeyDown={preventInvalidWholeNumberKeyDown}
                                                                onPaste={preventInvalidWholeNumberPaste}
                                                                onChange={(e) => {
                                                                    const value = sanitizeWholeNumberInput(e.target.value);
                                                                    if (!isWholeNumberInput(value, { min: 1 })) {
                                                                        setVariantModal(prev => ({ ...prev, quantity: 1 }));
                                                                        return;
                                                                    }

                                                                    const parsed = Number(value);
                                                                    const clamped = Math.min(maxSelectableQty, Math.max(1, parsed));
                                                                    setVariantModal(prev => ({ ...prev, quantity: clamped }));
                                                                }}
                                                                className="h-9 w-12 border-x border-slate-200 text-center text-sm font-semibold text-slate-900 outline-none"
                                                            />
                                                            <button
                                                                type="button"
                                                                disabled={selectedQuantity >= maxSelectableQty}
                                                                onClick={() => setVariantModal(prev => ({ ...prev, quantity: Math.min(maxSelectableQty, (Number(prev.quantity) || 1) + 1) }))}
                                                                className={`h-9 w-9 flex items-center justify-center text-base font-semibold transition-colors ${selectedQuantity >= maxSelectableQty ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50'}`}
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                <button
                                                    disabled={isPrimaryDisabled}
                                                    onClick={() => {
                                                        if (canAddSelectedVariant && matchedVariant) {
                                                            addToCart(matchedVariant, true, { quantity: selectedQuantity });
                                                            setVariantModal(createClosedVariantModalState());
                                                            return;
                                                        }

                                                        if (canOpenAlternatives && fallbackAlternativeTarget) {
                                                            const forcedType = matchedVariant
                                                                ? (Number(matchedVariant.stock) <= 0 ? 'out-of-stock' : (getStockStatus(matchedVariant, settings) === 'Low Stock' ? 'low-stock' : undefined))
                                                                : (isAllSelected && narrowedVariants.length === 0 ? 'out-of-stock' : undefined);

                                                            openBudgetAlternatives(fallbackAlternativeTarget, { forcedType });
                                                            setVariantModal(createClosedVariantModalState());
                                                        }
                                                    }}
                                                    className={`w-full py-3.5 rounded-2xl font-semibold text-[13px] uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 pointer-events-auto ${isPrimaryDisabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-[0_10px_20px_-10px_rgba(0,0,0,0.5)] hover:shadow-[0_15px_25px_-10px_rgba(0,0,0,0.6)] hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer ring-4 ring-slate-900/10'}`}
                                                >
                                                    {!isAllSelected ? "Select Options Required" : (canAddSelectedVariant ? "Add to Cart" : "View Alternatives")}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Quotation Input Modal */}
        {showQuotationInput && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                 <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs md:max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                            <h3 className="font-semibold text-base text-gray-900">Create Quotation</h3>
                        </div>
                        <button onClick={() => setShowQuotationInput(false)} className="text-gray-400 hover:text-gray-600">
                             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div className="p-4">
                        <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Customer Name</label>
                        <input 
                            type="text" 
                            autoFocus
                            maxLength={QUOTATION_NAME_MAX_LENGTH}
                            value={quotationCustomerName}
                            onChange={(e) => setQuotationCustomerName(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all text-sm"
                            placeholder="Enter customer name..."
                            onKeyDown={(e) => e.key === 'Enter' && handleGenerateQuotation()}
                        />
                        <p className="mt-1 text-right text-xs text-gray-500" aria-live="polite">
                            {quotationCustomerName.length} / {QUOTATION_NAME_MAX_LENGTH}
                        </p>
                        <p className="text-xs text-gray-500 mt-2 italic">A quotation document will be generated without deducting inventory stock.</p>
                    </div>
                    <div className="px-4 pb-4 flex justify-end gap-3">
                        <button 
                            onClick={() => setShowQuotationInput(false)}
                            className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleGenerateQuotation}
                            disabled={!quotationCustomerName.trim()}
                            style={{ backgroundColor: '#111827', color: '#ffffff' }}
                            className="px-5 py-2 font-semibold rounded-xl hover:opacity-90 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2-4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2-2v4h10z"></path></svg>
                            Generate
                        </button>
                    </div>
                 </div>
            </div>
        )}

        {/* Quotation Preview Modal */}
        {showQuotationPreview && quotationData && (
            <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm md:max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-semibold text-lg text-gray-800">Quotation Preview</h3>
                        <button onClick={() => setShowQuotationPreview(false)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 bg-white" id="quotation-content">
                        <div className="text-center mb-4">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-900 mb-1">PRODUCT QUOTATION</h2>
                            <div className="text-xs text-gray-400 mt-2 space-y-1">
                                <p className="text-xl font-semibold text-gray-900">Tableria La Confianza</p>
                                <p>Manila S Rd, Calamba, 4027 Laguna</p>
                                <p>Tel: (049) 545-2166</p>
                            </div>
                        </div>
                        

                        <div className="border-t border-dashed border-gray-200 py-2 mb-3 text-xs">
                            <div className="flex justify-between mb-1">
                                <span className="text-gray-500">Customer:</span>
                                <span className="font-semibold text-gray-800">{quotationData.customerName}</span>
                            </div>
                            <div className="flex justify-between mb-1">
                                <span className="text-gray-500">Date:</span>
                                <span className="text-gray-800">{quotationData.date}</span>
                            </div>
                            <div className="text-xs mt-2 italic text-gray-500 text-center">
                                *Estimate only. Prices subject to change.*
                            </div>
                        </div>

                        <table className="w-full text-xs mb-4">
                            <thead>
                                <tr className="border-b-2 border-gray-100">
                                    <th className="py-2 text-left font-semibold text-gray-700">Item</th>
                                    <th className="py-2 text-center font-semibold text-gray-700">Qty</th>
                                    <th className="py-2 text-right font-semibold text-gray-700">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-600">
                                {quotationData.items.map((item, i) => (
                                    <tr key={i} className="border-b border-gray-50">
                                        <td className="py-2">
                                            <div className="font-semibold text-gray-800">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                            <div className="text-xs">{item.code}</div>
                                        </td>
                                        <td className="py-2 text-center">{item.qty}</td>
                                        <td className="py-2 text-right">{formatCurrency(item.price * item.qty)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="space-y-1 text-right text-xs border-t border-gray-200 pt-2">
                            <div className="flex justify-between text-base font-semibold text-gray-900 pt-1 border-t border-gray-900 mt-1">
                                <span>ESTIMATED TOTAL</span>
                                <span>{formatCurrency(quotationData.total)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-3">
                        <button 
                            onClick={() => setShowQuotationPreview(false)}
                            className="py-2 px-4 rounded-xl text-xs font-semibold uppercase tracking-widest hover:bg-gray-100 transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform hover:-translate-y-0.5 text-gray-600 bg-white"
                            style={{ border: '2px solid #e5e7eb' }}
                        >
                            Close
                        </button>
                        <button 
                            onClick={handlePrintQuotationDoc}
                            disabled={printStatus === 'printing'}
                            className={`py-2 px-4 rounded-xl text-xs font-semibold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2 shadow-sm transform ${printStatus === 'printing' ? 'opacity-80 cursor-wait' : 'hover:opacity-90 hover:-translate-y-0.5'}`}
                            style={{ backgroundColor: printStatus === 'success' ? '#10B981' : '#111827', color: '#ffffff', border: printStatus === 'success' ? '2px solid #10B981' : '2px solid #111827' }}
                        >
                            {printStatus === 'printing' ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Printing
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2-4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2-2v4h10z"></path></svg>
                                    Print
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
};

export default PointOfSale;
