import React, { useState, useMemo, useEffect, useRef } from 'react';
import Pagination from '../components/Pagination';
import { AnimatePresence, motion } from 'framer-motion';
import { showToast } from '../utils/toastHelper';
import { getPosRecommendationAction, getRecommendationAvailability, getRelativePriceTier, getStockStatus } from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { createPartnerApi, createSaleApi, listProductsApi, listPartnersApi } from '../services/inventoryApi';
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
    sanitizeWholeNumberInput,
} from '../utils/numericInput';
import { formatCurrency } from '../utils/numberFormat';
import { buildQuotationPrintLines, buildQuotationReceiptModel } from '../utils/quotationReceipt';
import { normalizeHumanReadable } from '../utils/textNormalization';
import { createClientRequestId } from '../utils/clientRequestId';
import { removeSelectedCartItems, toggleAllCartItemSelections, toggleCartItemSelection } from '../utils/cartSelection';
import { ROLES } from '../constants/roles';
import TransactionReferenceModal from '../components/TransactionReferenceModal';
import ViewportTooltip from '../components/ViewportTooltip';
import { ORDER_CONFIRMATION_PREVIEW_SIZE } from '../constants/orderConfirmationPreview';
import {
    getPosVariantSelectionModel,
    getPosVariantValueKey,
    groupProductsForPos,
    updatePosVariantSelection,
} from '../utils/posVariantSelection';

const getProductImageUrl = (item) => String(item?.imageUrl || '').trim();
const sanitizeCashTenderedInput = (value) => {
    const source = String(value ?? '');
    return /^\d*(?:\.\d{0,2})?$/.test(source) ? source : '';
};

const getMoneyCentavosFromAmount = (amount) => parseMoneyToCentavos(formatMoneyInput(amount));

const isEligibleCreditCustomer = (row) => {
    const customerType = String(row?.customerType || 'regular').toLowerCase();
    const isVerifiedCustomer = row?.isVerifiedCustomer !== false;
    return row?.type === 'customer' && !row?.isArchived && customerType === 'regular' && isVerifiedCustomer;
};

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

const MotionButton = motion.button;
const MotionDiv = motion.div;

const PosFieldTooltip = ({ id, children }) => (
    <div
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-max max-w-[260px] group-hover/pos-field-tooltip:block"
    >
        <div className="rounded-lg bg-gray-900 px-3 py-2 text-[10px] font-semibold leading-snug text-white shadow-xl ring-1 ring-black/10">
            {children}
        </div>
        <span className="absolute -bottom-1 right-4 h-2 w-2 rotate-45 bg-gray-900" aria-hidden="true" />
    </div>
);

const ProductThumbnail = ({ item, className = '', onPreview, fit = 'cover' }) => {
    const imageUrl = getProductImageUrl(item);
    const [failedImageUrl, setFailedImageUrl] = useState('');
    const imageFailed = Boolean(imageUrl && failedImageUrl === imageUrl);

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
                    onError={() => setFailedImageUrl(imageUrl)}
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
    const CREDIT_PAYMENT_MODES = ['cash', 'gcash', 'cheque', 'bank transfer', 'other'];
    const VAT_MODE_OPTIONS = [
        { value: 'vatable', label: 'VAT 12%' },
        { value: 'zero-rated', label: 'Zero Rated (0%)' },
    ];

    const productListRef = useRef(null);
    const printLockRef = useRef(false);
    const {
        processedInventory: inventory,
        categories: categoryDefinitions,
        setInventory,
        setTransactions,
        logAction,
        logActivity,
        addToSyncQueue,
        syncQueue,
        isOnline,
    } = useInventory();
    const { appSettings: settings, userPreferences, currentUserName, currentUserFullName, userRole } = useAuth();
    const canQuickAddCreditCustomer = userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN;

    const showErrorDetails = (message, title = 'Action Failed') => {
        showToast(title, message, 'error', 'pos-action-error');
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
    const [isCartSelectionMode, setIsCartSelectionMode] = useState(false);
    const [selectedCartItemCodes, setSelectedCartItemCodes] = useState([]);
    const [isBulkRemoveConfirmationOpen, setIsBulkRemoveConfirmationOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [recommendationModal, setRecommendationModal] = useState({ isOpen: false, item: null, alternatives: [], budgetOptions: null, kind: 'alternative' }); // Recommendation Modal State
    const [recommendationChooserItem, setRecommendationChooserItem] = useState(null);
    const [productDetailsItem, setProductDetailsItem] = useState(null);
    
    // Payment State
    const [paymentType, setPaymentType] = useState('cash');
    const [cashAmount, setCashAmount] = useState(''); // Use string for input handling
    const [selectedVatMode, setSelectedVatMode] = useState('vatable');
    const [creditCustomers, setCreditCustomers] = useState([]);
    const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState('');
    const [creditCustomerSearchQuery, setCreditCustomerSearchQuery] = useState('');
    const [isCreditCustomerComboboxOpen, setIsCreditCustomerComboboxOpen] = useState(false);
    const [isQuickAddCreditCustomerOpen, setIsQuickAddCreditCustomerOpen] = useState(false);
    const [quickAddCreditCustomerName, setQuickAddCreditCustomerName] = useState('');
    const [isSavingQuickAddCreditCustomer, setIsSavingQuickAddCreditCustomer] = useState(false);
    const [selectedCreditTermDays, setSelectedCreditTermDays] = useState(MIN_CREDIT_TERM_DAYS);
    const [selectedCreditPaymentMode, setSelectedCreditPaymentMode] = useState('');
    const [customCreditPaymentMode, setCustomCreditPaymentMode] = useState('');
    const [isCreditPaymentModeOpen, setIsCreditPaymentModeOpen] = useState(false);
    const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false);
    const [isOrderSummaryDetailsCollapsed, setIsOrderSummaryDetailsCollapsed] = useState(false);
    const checkoutInFlightRef = useRef(false);
    
    // Quotation State
    const [showQuotationPreview, setShowQuotationPreview] = useState(false);
    const [quotationData, setQuotationData] = useState(null);

    // Receipt Modal State
    const [showReceipt, setShowReceipt] = useState(false);
    const [lastTransaction, setLastTransaction] = useState(null);
    const [pendingReferenceSaleId, setPendingReferenceSaleId] = useState('');
    const [pendingOfflineCheckout, setPendingOfflineCheckout] = useState(null);

    const creditPaymentModeRef = useRef(null);
    const creditCustomerComboboxRef = useRef(null);
    const customCreditPaymentModeInputRef = useRef(null);
    const cartSelectionEntryButtonRef = useRef(null);
    const quickAddCreditCustomerInFlightRef = useRef(false);
    const quickAddCreditCustomerRequestIdRef = useRef('');

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

    useEffect(() => {
        if (!recommendationChooserItem) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setRecommendationChooserItem(null);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [recommendationChooserItem]);

    useEffect(() => {
        if (!isCreditPaymentModeOpen) return undefined;

        const closeWhenFocusLeaves = (target) => {
            if (!creditPaymentModeRef.current?.contains(target)) {
                setIsCreditPaymentModeOpen(false);
            }
        };
        const handlePointerDown = (event) => closeWhenFocusLeaves(event.target);
        const handleFocusIn = (event) => closeWhenFocusLeaves(event.target);
        const handleKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            setIsCreditPaymentModeOpen(false);
            creditPaymentModeRef.current?.querySelector('button')?.focus();
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isCreditPaymentModeOpen]);

    const createClosedVariantModalState = () => ({
        isOpen: false,
        group: null,
        step: 'brand',
        selectedBrand: null,
        selectedSize: null,
        selectedColor: null,
        selectedVariantCode: null,
        quantity: 1,
    });
    const createOpenVariantModalState = (group) => ({
        isOpen: true,
        group,
        step: group?.brandOptions?.length > 1 ? 'brand' : 'variants',
        selectedBrand: null,
        selectedSize: null,
        selectedColor: null,
        selectedVariantCode: null,
        quantity: 1,
    });
    const [variantModal, setVariantModal] = useState(createClosedVariantModalState);

    const variantModalImageItem = useMemo(() => {
        if (!variantModal.isOpen || !variantModal.group) return null;

        const variants = variantModal.group.variants.filter((variant) => (
            !variantModal.selectedBrand || getPosVariantValueKey(variant, 'brand') === variantModal.selectedBrand
        ));
        const selectedVariant = getPosVariantSelectionModel(variants, {
            size: variantModal.selectedSize,
            color: variantModal.selectedColor,
        }, variantModal.selectedVariantCode, variantModal.group.variantDimensions?.filter((dimension) => dimension !== 'brand')).matchedVariant;
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

        const result = groupProductsForPos(filtered, categoryDefinitions);
        
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
    }, [inventory, categoryDefinitions, debouncedSearchQuery, selectedCategory, settings]);

    useEffect(() => {
        if (!variantModal.isOpen || !variantModal.group?.groupKey) return;

        const refreshedGroup = filteredProducts.find((item) => (
            item.isGroup && item.groupKey === variantModal.group.groupKey
        ));

        if (refreshedGroup && refreshedGroup !== variantModal.group) {
            setVariantModal((previous) => ({ ...previous, group: refreshedGroup }));
        }
    }, [filteredProducts, variantModal.isOpen, variantModal.group]);

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

                const eligible = (Array.isArray(rows) ? rows : []).filter(isEligibleCreditCustomer);

                    setCreditCustomers(eligible);

                if (eligible.length === 0) {
                    setSelectedCreditCustomerId('');
                    return;
                }
            } catch {
                if (isMounted) {
                    setCreditCustomers([]);
                    setSelectedCreditCustomerId('');
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

    const filteredCreditCustomers = useMemo(() => {
        const normalizedQuery = String(creditCustomerSearchQuery || '').trim().toLowerCase();
        if (!normalizedQuery) return creditCustomers;
        return creditCustomers.filter((customer) => String(customer?.name || '').toLowerCase().includes(normalizedQuery));
    }, [creditCustomers, creditCustomerSearchQuery]);

    const selectCreditCustomer = (customer) => {
        const customerId = String(customer?._id || customer?.id || '');
        const customerName = String(customer?.name || '').trim();
        setSelectedCreditCustomerId(customerId);
        setCreditCustomerSearchQuery(customerName);
        setIsCreditCustomerComboboxOpen(false);
    };

    const clearCreditCustomerSelection = () => {
        setSelectedCreditCustomerId('');
        setCreditCustomerSearchQuery('');
    };

    const quickAddCreditCustomerMatches = useMemo(() => {
        const normalizedName = String(quickAddCreditCustomerName || '').trim().toLowerCase();
        if (!normalizedName) return [];

        return creditCustomers.filter((customer) => String(customer?.name || '').toLowerCase().includes(normalizedName));
    }, [creditCustomers, quickAddCreditCustomerName]);

    const openQuickAddCreditCustomer = () => {
        if (!isOnline) {
            showErrorDetails('This action requires an internet connection.', "You're Offline");
            return;
        }

        quickAddCreditCustomerRequestIdRef.current = '';
        setQuickAddCreditCustomerName(String(creditCustomerSearchQuery || '').trim());
        setIsCreditCustomerComboboxOpen(false);
        setIsQuickAddCreditCustomerOpen(true);
    };

    const closeQuickAddCreditCustomer = () => {
        if (isSavingQuickAddCreditCustomer) return;
        setIsQuickAddCreditCustomerOpen(false);
        setQuickAddCreditCustomerName('');
        quickAddCreditCustomerRequestIdRef.current = '';
    };

    const handleQuickAddCreditCustomer = async (event) => {
        event.preventDefault();
        if (quickAddCreditCustomerInFlightRef.current) return;

        const name = normalizeHumanReadable(quickAddCreditCustomerName);
        if (!name) {
            showErrorDetails('Customer name is required.', 'Missing Customer Name');
            return;
        }
        if (!isOnline) {
            showErrorDetails('This action requires an internet connection.', "You're Offline");
            return;
        }

        quickAddCreditCustomerInFlightRef.current = true;
        setIsSavingQuickAddCreditCustomer(true);
        try {
            const createdCustomer = await createPartnerApi({
                type: 'customer',
                name,
                clientRequestId: quickAddCreditCustomerRequestIdRef.current
                    || (quickAddCreditCustomerRequestIdRef.current = createClientRequestId('partner')),
            });
            const createdCustomerId = String(createdCustomer?._id || createdCustomer?.id || '');
            const refreshedCustomers = await listPartnersApi({ type: 'customer', includeArchived: false });
            const eligibleCustomers = (Array.isArray(refreshedCustomers) ? refreshedCustomers : []).filter(isEligibleCreditCustomer);
            setCreditCustomers(eligibleCustomers);

            const eligibleCreatedCustomer = eligibleCustomers.find((customer) => String(customer?._id || customer?.id || '') === createdCustomerId);
            setIsQuickAddCreditCustomerOpen(false);
            setQuickAddCreditCustomerName('');
            quickAddCreditCustomerRequestIdRef.current = '';

            if (eligibleCreatedCustomer) {
                selectCreditCustomer(eligibleCreatedCustomer);
                showToast('Customer Added', `${eligibleCreatedCustomer.name} is selected for this credit order.`, 'success', 'pos-quick-add-customer');
            } else {
                showToast('Customer Added', 'The customer was created but is not currently eligible for Credit checkout. Verify the customer before continuing.', 'warning', 'pos-quick-add-customer-ineligible');
            }
        } catch (error) {
            showErrorDetails(error.message || 'Unable to add the customer.', 'Customer Save Failed');
        } finally {
            quickAddCreditCustomerInFlightRef.current = false;
            setIsSavingQuickAddCreditCustomer(false);
        }
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
            const customMode = normalizeHumanReadable(customCreditPaymentMode);
            return customMode;
        }
        return String(selectedCreditPaymentMode || '').trim();
    };

    const formatCreditPaymentModeLabel = (mode) => {
        if (mode === 'other') {
            return 'Other';
        }

        const labels = {
            cash: 'Cash',
            gcash: 'GCash',
            cheque: 'Cheque',
            'bank transfer': 'Bank Transfer',
        };
        return labels[mode] || String(mode || '');
    };

    const focusCustomCreditPaymentModeInput = () => {
        window.requestAnimationFrame(() => {
            const input = customCreditPaymentModeInputRef.current;
            if (!input) return;

            input.focus({ preventScroll: true });
            if (input.value) {
                input.select();
            }

            const inputBounds = input.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            if (inputBounds.top < 0 || inputBounds.bottom > viewportHeight) {
                input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
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
    const categoryNames = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

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
            if (product.stock <= 0) {
                const availability = getRecommendationAvailability(product, inventory, settings);
                if (availability.hasAlternatives) {
                    setRecommendationModal({ isOpen: true, item: product, alternatives: availability.alternatives, budgetOptions: null, type: 'out-of-stock', kind: 'alternative' });
                } else {
                    showToast('No Alternatives', 'No alternatives found for this item.', 'info', 'pos-budget-no-alternatives');
                }
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

    const getRecommendationResults = (product, kind) => {
        const availability = getRecommendationAvailability(product, inventory, settings);
        return kind === 'budget' ? availability.budgetOptions : availability.alternatives;
    };

    const openRecommendationResults = (product, kind, options = {}) => {
        const alternatives = getRecommendationResults(product, kind);
        if (alternatives.length === 0) {
            showToast('No Alternatives', 'No alternatives found for this item.', 'info', 'pos-budget-no-alternatives');
            return;
        }

        const status = getStockStatus(product, settings);
        const type = options.type || (status === 'Out of Stock' ? 'out-of-stock' : status === 'Low Stock' ? 'low-stock' : 'in-stock');
        setRecommendationModal({
            isOpen: true,
            item: product,
            alternatives,
            budgetOptions: null,
            type,
            kind,
            returnToChooser: options.returnToChooser === true,
        });
    };

    const openAvailableRecommendations = (product, availability, options = {}) => {
        const action = getPosRecommendationAction(availability);
        if (action === 'chooser') {
            setRecommendationChooserItem(product);
            return;
        }
        if (action) openRecommendationResults(product, action, options);
    };

    const removeFromCart = (code) => {
        setCart(prevCart => prevCart.filter(item => item.code !== code));
    };

    const exitCartSelectionMode = ({ restoreFocus = false } = {}) => {
        setIsCartSelectionMode(false);
        setSelectedCartItemCodes([]);
        setIsBulkRemoveConfirmationOpen(false);

        if (restoreFocus) {
            window.requestAnimationFrame(() => cartSelectionEntryButtonRef.current?.focus());
        }
    };

    const toggleCartSelection = (code) => {
        setSelectedCartItemCodes((previousCodes) => toggleCartItemSelection(previousCodes, code));
    };

    const toggleAllCartSelections = () => {
        setSelectedCartItemCodes((previousCodes) => toggleAllCartItemSelections(previousCodes, cart));
    };

    const removeSelectedCartLines = () => {
        setCart((previousCart) => removeSelectedCartItems(previousCart, selectedCartItemCodes));
        exitCartSelectionMode({ restoreFocus: true });
    };

    const requestBulkRemove = () => {
        if (selectedCartItemCodes.length === 0) return;

        if (selectedCartItemCodes.length === 1) {
            removeSelectedCartLines();
            return;
        }

        setIsBulkRemoveConfirmationOpen(true);
    };

    const handlePaymentTypeChange = (nextPaymentType) => {
        setPaymentType(nextPaymentType);
        if (isCartSelectionMode) exitCartSelectionMode();
    };

    useEffect(() => {
        setSelectedCartItemCodes((previousCodes) => previousCodes.filter((code) => cart.some((item) => item.code === code)));

        if (cart.length === 0 && isCartSelectionMode) {
            setIsCartSelectionMode(false);
            setSelectedCartItemCodes([]);
            setIsBulkRemoveConfirmationOpen(false);
        }
    }, [cart, isCartSelectionMode]);

    useEffect(() => {
        if (!isBulkRemoveConfirmationOpen) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsBulkRemoveConfirmationOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isBulkRemoveConfirmationOpen]);

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

    const completeOfflineCheckout = ({ transactionData, cartSnapshot, canSyncOnline, total, referenceNumber }) => {
        const referencedTransaction = {
            ...transactionData,
            transactionReference: {
                referenceNumber: String(referenceNumber || '').trim(),
                supportingDocument: null,
            },
        };
        const queued = addToSyncQueue({
            ...referencedTransaction,
            clientRequestId: referencedTransaction.clientRequestId,
            items: cartSnapshot.map((item) => ({ ...item, id: item.id || item._id })),
        });
        if (!queued) throw new Error('The sale could not be added to your offline sync queue.');

        if (canSyncOnline) {
            showToast('Offline Mode', 'Transaction saved locally and will sync when online.', 'info', 'pos-offline-sync');
        }

        setInventory(inventory.map((item) => {
            const cartItem = cartSnapshot.find((candidate) => candidate.code === item.code);
            if (!cartItem) return item;
            const stock = item.stock - cartItem.qty;
            return { ...item, stock, status: getStockStatus({ ...item, stock }, settings) };
        }));
        setTransactions((previous) => [referencedTransaction, ...previous]);
        cartSnapshot.forEach((item) => {
            logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${referencedTransaction.id})`, currentUserName);
        });
        setCart([]);
        setCashAmount('');
        setLastTransaction(referencedTransaction);
        setShowReceipt(true);
        logActivity(currentUserName, 'Processed Sale', `Transaction ${referencedTransaction.id} — ${formatCurrency(total)}`);
        showToast('Transaction Complete', 'Sale recorded successfully.', 'success', 'pos-checkout');
        return referencedTransaction;
    };

    const handleCheckout = async () => {
        if (checkoutInFlightRef.current) {
            return;
        }

        if (pendingOfflineCheckout) return;

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
            showErrorDetails('Please select a payment method for credit checkout.');
            return;
        }

        checkoutInFlightRef.current = true;
        setIsCheckoutProcessing(true);

        const cartSnapshot = [...cart];
        const saleRequestId = createClientRequestId('sale');

        const transactionData = {
            id: `TRX-${saleRequestId.slice(-8).toUpperCase()}`,
            clientRequestId: saleRequestId,
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
            cashier: currentUserFullName || currentUserName,
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
                        transactionData.clientRequestId,
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
                        cashier: currentUserFullName || currentUserName,
                        cashierRole: String(userRole || '').toLowerCase(),
                        transactionReference: savedSale?.transactionReference || null,
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
                    if (remoteTransaction.sourceId) {
                        setPendingReferenceSaleId(remoteTransaction.sourceId);
                        setShowReceipt(false);
                    } else {
                        setShowReceipt(true);
                    }
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

            // Offline Cash Sales require a Reference No. before any local stock,
            // history, or sync-queue mutation is applied.
            setPendingOfflineCheckout({ transactionData, cartSnapshot, canSyncOnline, total });
            return;
        } finally {
            checkoutInFlightRef.current = false;
            setIsCheckoutProcessing(false);
        }
    };

    const [printStatus, setPrintStatus] = useState('idle'); // idle, printing, success

    const handleGenerateQuotation = () => {
        const quoteData = {
            items: [...cart],
            total: calculateTotal()
        };

        setQuotationData(quoteData);
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

        const quotationReceipt = buildQuotationReceiptModel(quote, settings);

        void printDocument({ lines: buildQuotationPrintLines(quotationReceipt) })
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
                transaction: { ...lastTransaction, documentType: 'order-confirmation' },
                settings,
                elementId: 'receipt-content',
                paperWidthMm: 58,
            });

            setPrintStatus('success');
            showToast(
                'Print Success',
                result.source === 'local-service'
                    ? 'Order confirmation sent to the thermal printer.'
                    : 'Order confirmation printed successfully!',
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
            showErrorDetails(error?.message || 'Unable to print order confirmation.');
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
    const receiptTitle = 'Order Confirmation';
    const receiptContextLine = 'For transaction reference only';
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
                ? (!selectedCreditCustomer ? 'Select an eligible regular customer first' : 'Select payment method first')
                : 'Enter cash first';
    const selectedCartItemCount = selectedCartItemCodes.filter((code) => cart.some((item) => item.code === code)).length;
    const areAllCartItemsSelected = cart.length > 0 && selectedCartItemCount === cart.length;

    return (
        <div className="flex min-h-[calc(100dvh-80px)] flex-col gap-2 overflow-y-auto md:h-[calc(100vh-80px)] md:overflow-hidden">
            


            <div className="flex flex-col md:flex-row flex-1 gap-2 md:min-h-0">
            {pendingOfflineCheckout && (
                <TransactionReferenceModal
                    requiredFlow
                    referenceNumberOnly
                    saveLabel="Save Offline Sale"
                    failureMessage="The offline sale was not saved."
                    onSave={({ referenceNumber }) => completeOfflineCheckout({
                        ...pendingOfflineCheckout,
                        referenceNumber,
                    })}
                    onSaved={() => setPendingOfflineCheckout(null)}
                />
            )}
            {pendingReferenceSaleId && lastTransaction && (
                <TransactionReferenceModal
                    saleId={pendingReferenceSaleId}
                    requiredFlow
                    onSaved={(updated) => {
                        const nextTransaction = { ...lastTransaction, transactionReference: updated.transactionReference };
                        setLastTransaction(nextTransaction);
                        if (String(nextTransaction.paymentMethod).toLowerCase() !== 'credit') {
                            setTransactions((previous) => upsertTransactionByIdentity(previous, nextTransaction));
                        }
                        setPendingReferenceSaleId('');
                        setShowReceipt(true);
                    }}
                />
            )}
            {/* Receipt Modal */}
            {showReceipt && lastTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className={`flex ${ORDER_CONFIRMATION_PREVIEW_SIZE.modal} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
                        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3.5 sm:px-5 sm:py-4">
                            <div>
                                <h3 className="text-xl font-semibold text-gray-800 sm:text-2xl">{receiptTitle}</h3>
                                <p className="mt-1 text-xs text-gray-500">{receiptContextLine}</p>
                            </div>
                            <button onClick={() => setShowReceipt(false)} className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" aria-label="Close Order Confirmation preview">
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-6 sm:py-5" id="receipt-content">
                            <div className={`${ORDER_CONFIRMATION_PREVIEW_SIZE.content} px-1 text-xs leading-relaxed text-gray-600 sm:text-[13px]`}>
                            <div className="mb-5 text-center">
                                <p className="mb-1 text-lg font-semibold leading-tight text-gray-900">{settings?.storeName || 'Tableria La Confianza'}</p>
                                <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-gray-400 sm:text-xs">
                                    <p>{settings?.storeAddress || 'Manila S Rd, Calamba, 4027 Laguna'}</p>
                                    <p>Contact: {settings?.contactPhone || '0917-545-2166'}</p>
                                </div>
                                <p className="mt-3 text-xs font-semibold tracking-wider text-gray-900">ORDER CONFIRMATION</p>
                                <p className="text-[11px] text-gray-500">For transaction reference only</p>
                            </div>
                            
                            <div className="mb-4 border-y border-dashed border-gray-200 py-3">
                                <div className="mb-1 flex justify-between gap-3">
                                    <span className="text-gray-500">Transaction ID:</span>
                                    <span className="font-mono font-semibold text-gray-800">{lastTransaction.id}</span>
                                </div>
                                {lastTransaction.transactionReference?.referenceNumber && (
                                    <div className="mb-1 flex justify-between gap-3">
                                        <span className="shrink-0 text-gray-500">Transaction Reference:</span>
                                        <span className="min-w-0 break-all text-right text-gray-800">{lastTransaction.transactionReference.referenceNumber}</span>
                                    </div>
                                )}
                                <div className="mb-1 flex justify-between gap-3">
                                    <span className="text-gray-500">Date:</span>
                                    <span className="text-gray-800">{lastTransaction.date}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span className="text-gray-500">Cashier:</span>
                                    <span className="text-gray-800">{lastTransaction.cashier}</span>
                                </div>
                            </div>

                            <table className="mb-4 w-full table-fixed">
                                <colgroup>
                                    <col className="w-[43%]" />
                                    <col className="w-[10%]" />
                                    <col className="w-[22%]" />
                                    <col className="w-[25%]" />
                                </colgroup>
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="py-1.5 pr-2 text-left text-xs font-semibold text-gray-700">Item</th>
                                        <th className="py-1.5 text-center text-xs font-semibold text-gray-700">Qty</th>
                                        <th className="py-1.5 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">Unit Price</th>
                                        <th className="py-1.5 text-right text-xs font-semibold text-gray-700">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="text-xs leading-relaxed text-gray-600 sm:text-[13px]">
                                    {lastTransaction.items.map((item, i) => (
                                        <tr key={i} className="border-b border-gray-50">
                                            <td className="py-2 pr-2">
                                                <div className="font-semibold text-gray-800 leading-tight">{item.brand ? `${item.brand} ` : ''}{item.name}{item.color ? ` — ${item.color}` : ''}</div>
                                                <div className="text-[11px] leading-tight text-gray-500">{item.code}</div>
                                            </td>
                                            <td className="py-2 text-center">{item.qty}</td>
                                            <td className="py-2 text-right font-medium whitespace-nowrap">{formatCurrency(item.price)}</td>
                                            <td className="py-2 text-right font-medium">{formatCurrency(item.price * item.qty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="space-y-1.5 border-t border-gray-200 pt-3 text-right text-xs leading-relaxed sm:text-[13px]">
                                {lastTransaction.vatAmount > 0 && (
                                    <>
                                        <div className="flex justify-between text-gray-600">
                                            <span>Net Amount</span>
                                            <span>{formatCurrency(lastTransaction.netAmount)}</span>
                                        </div>
                                        <div className="flex justify-between text-gray-600">
                                            <span>{formatVatModeLabel(lastTransaction.vatMode)}</span>
                                            <span>{formatCurrency(lastTransaction.vatAmount)}</span>
                                        </div>
                                    </>
                                )}
                                <div className="mt-2 flex justify-between border-t border-gray-900 pt-2 text-lg font-semibold text-gray-900">
                                    <span>TOTAL</span>
                                    <span>{formatCurrency(lastTransaction.total)}</span>
                                </div>
                                <div className="flex justify-between pt-1 text-xs font-semibold uppercase text-gray-600 sm:text-[13px]">
                                    <span>{isCreditReceipt ? 'Credit Status' : 'Cash Received'}</span>
                                    <span>{isCreditReceipt ? (lastTransaction.paymentStatus || 'Pending') : formatCurrency(lastTransaction.cash)}</span>
                                </div>

                                {isCreditReceipt ? (
                                    <>
                                        <div className="flex justify-between text-gray-500">
                                            <span>Due Date</span>
                                            <span>{lastTransaction.dueDate ? new Date(lastTransaction.dueDate).toLocaleDateString() : '-'}</span>
                                        </div>
                                        {lastTransaction.creditPaymentMode && (
                                            <div className="flex justify-between text-gray-500">
                                                <span>Payment Method</span>
                                                <span>{lastTransaction.creditPaymentMode}</span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex justify-between text-gray-500">
                                        <span>Change</span>
                                        <span>{formatCurrency(lastTransaction.change)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="mt-5 text-center text-[11px] leading-relaxed text-gray-400 sm:text-xs">
                                <p>Thank you for your business.</p>
                                <p>Please keep this confirmation for reference.</p>
                            </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 bg-gray-50 p-3 sm:p-4">
                            <button 
                                onClick={() => setShowReceipt(false)}
                                className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold tracking-widest text-gray-600 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100"
                                style={{ border: '2px solid #e5e7eb' }}
                            >
                                Close
                            </button>
                            <button 
                                onClick={handlePrint}
                                disabled={printStatus === 'printing'}
                                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold tracking-widest shadow-sm transition-all duration-300 ${printStatus === 'printing' ? 'cursor-wait opacity-80' : 'hover:-translate-y-0.5 hover:opacity-90'}`}
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
                    <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Point of Sale</p>
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
                            {categoryNames.map(cat => (
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
                            <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                                {currentItems.map(item => (
                                    (() => {
                                        if (item.isGroup) {
                                            const groupStockStatus = getStockStatus(item, settings);
                                            const isOutOfStock = groupStockStatus === 'Out of Stock';
                                            const isLowStock = groupStockStatus === 'Low Stock';
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
                                                    className={`group relative flex min-h-[318px] flex-col overflow-hidden rounded-xl border bg-white text-left transition-colors duration-200
                                                        ${isOutOfStock
                                                            ? 'border-slate-200 hover:border-red-300 hover:bg-red-50/20'
                                                            : isLowStock
                                                                ? 'border-slate-200 hover:border-amber-300 hover:bg-amber-50/20'
                                                                : 'border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/20'
                                                        }`}
                                                >
                                                    <div className="flex flex-1 flex-col p-3">
                                                        <button
                                                            type="button"
                                                            data-pos-image-preview="true"
                                                                onPointerDown={(e) => e.stopPropagation()}
                                                                onMouseDown={(e) => e.stopPropagation()}
                                                                onTouchStart={(e) => e.stopPropagation()}
                                                                onClick={(e) => handleProductImagePreviewClick(e, item)}
                                                            disabled={!item.imageUrl}
                                                                className={`group/photo relative z-10 mb-3 h-24 w-full touch-manipulation select-none overflow-hidden rounded-lg border transition-colors duration-200 ${
                                                                item.imageUrl
                                                                    ? 'cursor-zoom-in border-slate-200 bg-slate-50 hover:border-slate-300'
                                                                    : 'border-dashed border-slate-200 bg-slate-50 cursor-default'
                                                            }`}
                                                            aria-label={item.imageUrl ? `Enlarge image for ${item.name}` : `No image for ${item.name}`}
                                                        >
                                                            {item.imageUrl ? (
                                                                <>
                                                                    <img
                                                                        src={item.imageUrl}
                                                                        alt={item.name}
                                                                        className="h-full w-full object-contain p-1.5"
                                                                    />
                                                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover/photo:bg-black/20 group-hover/photo:opacity-100">
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

                                                        <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400">{item.category || 'Product Group'}</p>
                                                        <h3 className="mb-1.5 min-h-[38px] line-clamp-2 text-[14px] font-semibold leading-snug text-slate-900">
                                                            {item.name}
                                                        </h3>
            
                                                        <div className="mb-2 flex min-h-[18px] items-center gap-1.5 overflow-hidden text-[10px] text-slate-500">
                                                            {item.brand && (
                                                                <span className="truncate font-medium">{item.brand}</span>
                                                            )}
                                                            {item.brand && item.color && <span className="text-slate-300">•</span>}
                                                            {item.color && (
                                                                <span className="truncate">{item.color}</span>
                                                            )}
                                                        </div>
            
                                                        <div className="mb-2.5 flex min-h-[20px] items-center justify-between gap-2">
                                                            <span className="shrink-0 truncate text-[10px] font-medium text-slate-400">{item.variants.length} options</span>
                                                            {isOutOfStock ? (
                                                                <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-semibold text-red-700">Out of Stock</span>
                                                            ) : (
                                                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${isLowStock ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                                                    {isLowStock ? 'Low Stock' : 'In Stock'}: {item.stock}
                                                                </span>
                                                            )}
                                                        </div>
            
                                                        <div className="mt-auto space-y-1.5 border-t border-slate-100 pt-2.5">
                                                            <div className="flex min-h-[24px] items-center justify-between gap-2">
                                                                <span className="truncate text-sm font-semibold leading-none tracking-tight text-slate-900">
                                                                    {item.minPrice === item.maxPrice ? formatCurrency(item.minPrice) : `${formatCurrency(item.minPrice)} - ${formatCurrency(item.maxPrice)}`}
                                                                </span>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setVariantModal(createOpenVariantModalState(item));
                                                                    }}
                                                                    className="flex h-7 w-full items-center justify-center rounded-md bg-slate-900 text-[10px] font-medium tracking-wide text-white transition-colors hover:bg-slate-800"
                                                                >
                                                                    Select Options
                                                                </button>
                                                                <div className="flex h-6 min-w-0 items-center justify-center">
                                                                    <button
                                                                        type="button"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            setProductDetailsItem(item);
                                                                        }}
                                                                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[9px] font-medium text-slate-400 transition-colors hover:text-slate-700"
                                                                    >
                                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                        View Details
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const status = getStockStatus(item, settings);
                                        const isOutOfStock = status === 'Out of Stock';
                                        const isLowStock = status === 'Low Stock';
                                        const recommendationAvailability = getRecommendationAvailability(item, inventory, settings, {
                                            alternativeLimit: 1,
                                            limitPerTier: 1,
                                            budgetLimit: 9,
                                        });
                                        const hasAlternatives = recommendationAvailability.hasAlternatives;
                                        const recommendationAction = getPosRecommendationAction(recommendationAvailability);
                                        const recommendationLabel = 'Recommendations';

                                        return (
                                    <div
                                        key={item.code}
                                        onClick={(e) => {
                                            if (e.target?.closest?.('[data-pos-image-preview="true"]')) {
                                                return;
                                            }
                                            if (isOutOfStock) return;
                                            addToCart(item);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                if (isOutOfStock) return;
                                                addToCart(item);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        className={`group relative flex min-h-[318px] flex-col overflow-hidden rounded-xl border bg-white text-left transition-colors duration-200
                                            ${isOutOfStock
                                                ? 'border-slate-200 hover:border-red-300 hover:bg-red-50/20'
                                                : isLowStock
                                                    ? 'border-slate-200 hover:border-amber-300 hover:bg-amber-50/20'
                                                    : 'border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/20'
                                            }`}
                                    >
                                        <div className="flex flex-1 flex-col p-3">
                                            <button
                                                type="button"
                                                data-pos-image-preview="true"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onTouchStart={(e) => e.stopPropagation()}
                                                    onClick={(e) => handleProductImagePreviewClick(e, item)}
                                                disabled={!item.imageUrl}
                                                    className={`group/photo relative z-10 mb-3 h-24 w-full touch-manipulation select-none overflow-hidden rounded-lg border transition-colors duration-200 ${
                                                    item.imageUrl
                                                            ? 'cursor-zoom-in border-slate-200 bg-slate-50 hover:border-slate-300'
                                                        : 'border-dashed border-slate-200 bg-slate-50 cursor-default'
                                                }`}
                                                aria-label={item.imageUrl ? `Enlarge image for ${item.name}` : `No image for ${item.name}`}
                                            >
                                                {item.imageUrl ? (
                                                    <>
                                                        <img
                                                            src={item.imageUrl}
                                                            alt={item.name}
                                                            className="h-full w-full object-contain p-1.5"
                                                        />
                                                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover/photo:bg-black/20 group-hover/photo:opacity-100">
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

                                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400">{item.category || 'Product'}</p>
                                            <h3 className="mb-1.5 min-h-[38px] line-clamp-2 text-[14px] font-semibold leading-snug text-slate-900">
                                                {item.name}
                                            </h3>

                                            <div className="mb-2 flex min-h-[18px] items-center gap-1 overflow-hidden text-[10px] text-slate-500">
                                                {item.brand && (
                                                    <span className="truncate font-medium">{item.brand}</span>
                                                )}
                                                {item.brand && (item.color || item.size) && <span className="text-slate-300">•</span>}
                                                {item.color && (
                                                    <span className="truncate">{item.color}</span>
                                                )}
                                                {item.color && item.size && <span className="text-slate-300">•</span>}
                                                {item.size && (
                                                    <span className="truncate">{item.size}</span>
                                                )}
                                            </div>

                                            <div className="mb-2.5 flex min-h-[18px] items-center justify-end gap-2">
                                                {isOutOfStock ? (
                                                    <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-semibold text-red-700">Out of Stock</span>
                                                ) : (
                                                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${isLowStock ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                                        {isLowStock ? 'Low Stock' : 'In Stock'}: {item.stock}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-auto space-y-1.5 border-t border-slate-100 pt-2.5">
                                                <div className="flex min-h-[24px] items-center justify-between gap-2">
                                                    <span className="truncate text-[15px] font-semibold leading-none tracking-tight text-slate-900">{formatCurrency(item.price)}</span>
                                                </div>
                                                {!isOutOfStock && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            addToCart(item);
                                                        }}
                                                        className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 text-[10px] font-medium tracking-wide text-white transition-colors hover:bg-slate-800"
                                                    >
                                                        Add to Cart
                                                    </button>
                                                )}
                                                <div className={`flex min-h-6 whitespace-nowrap ${isOutOfStock ? 'flex-col items-stretch gap-1.5' : 'items-center justify-center gap-1.5'}`}>
                                                    {isOutOfStock && hasAlternatives && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                openRecommendationResults(item, 'alternative', { type: 'out-of-stock' });
                                                            }}
                                                            className="inline-flex h-7 w-full items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 text-[10px] font-medium tracking-wide text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
                                                        >
                                                            <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                            </svg>
                                                            View Recommendations
                                                        </button>
                                                    )}
                                                    {recommendationAction && !isOutOfStock && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openAvailableRecommendations(item, recommendationAvailability);
                                                            }}
                                                            className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[9px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                                                        >
                                                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                                            {recommendationLabel}
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setProductDetailsItem(item);
                                                        }}
                                                        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[9px] font-medium text-slate-400 transition-colors hover:text-slate-700 ${isOutOfStock ? 'h-5 justify-center' : ''}`}
                                                    >
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                        View Details
                                                    </button>
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
            <div className="pos-current-order w-full md:w-80 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm flex flex-col min-h-[300px] md:h-full z-20">
                {/* Current Order Header */}
                <div className="pos-current-order-header flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-3 py-3">
                    <h3 className="shrink-0 text-base font-semibold text-slate-900">Current Order</h3>
                    <div className="flex items-center justify-end gap-1.5">
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                            {paymentType === 'credit' ? 'Credit Mode' : 'Cash Mode'}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{cart.reduce((acc, item) => acc + item.qty, 0)} items</span>
                    </div>
                </div>

                {/* Cart List Management */}
                {cart.length > 0 && (
                    <div className={`pos-cart-management shrink-0 border-b border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[11px] ${isCartSelectionMode ? 'pos-cart-selection-toolbar' : ''}`}>
                        {isCartSelectionMode ? (
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                                <button type="button" onClick={toggleAllCartSelections} className="pos-cart-selection-toggle inline-flex items-center gap-1.5 rounded font-medium text-slate-700 transition-colors hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" aria-label={areAllCartItemsSelected ? 'Deselect all order items' : 'Select all order items'}>
                                    <span data-checked={areAllCartItemsSelected} className={`pos-cart-selection-checkbox flex h-3.5 w-3.5 items-center justify-center rounded border ${areAllCartItemsSelected ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 bg-white'}`} aria-hidden="true">
                                        {areAllCartItemsSelected && <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="m5 12 4 4L19 6" /></svg>}
                                    </span>
                                    {areAllCartItemsSelected ? 'Deselect All' : 'Select All'}
                                </button>
                                <span className="pos-cart-selection-count text-[10px] font-medium text-slate-500">{selectedCartItemCount} selected</span>
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={requestBulkRemove} disabled={selectedCartItemCount === 0} className="pos-cart-selection-remove rounded font-medium text-rose-600 transition-colors hover:text-rose-700 disabled:cursor-not-allowed disabled:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300" aria-label={`Remove ${selectedCartItemCount} selected order item${selectedCartItemCount === 1 ? '' : 's'}`}>Remove</button>
                                    <button type="button" onClick={() => exitCartSelectionMode({ restoreFocus: true })} className="pos-cart-selection-cancel rounded font-medium text-slate-500 transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="pos-cart-items-label font-medium text-slate-500">Items</span>
                                    {!isOnline && <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700">Offline</span>}
                                    {syncQueue.length > 0 && (
                                        <span className="truncate rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700" title={syncQueue.find((entry) => entry?.syncError)?.syncError || 'Waiting to synchronize with the backend'}>
                                            Pending Sync: {syncQueue.length}
                                        </span>
                                    )}
                                </div>
                                <button ref={cartSelectionEntryButtonRef} type="button" onClick={() => setIsCartSelectionMode(true)} className="pos-cart-select-action shrink-0 rounded font-medium text-slate-600 transition-colors hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" aria-label="Select order items for bulk removal">Select</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Cart Item List */}
                <div className="pos-cart-list flex-1 min-h-0 overflow-y-auto bg-slate-100/70 p-3 space-y-2">
                    {cart.length === 0 ? (
                        <div className="pos-cart-empty flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
                            <div className="pos-cart-empty-icon w-11 h-11 rounded-full bg-white border border-slate-100 flex items-center justify-center">
                                <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                            </div>
                            <p className="text-sm font-medium">Cart is empty</p>
                        </div>
                    ) : (
                        cart.map(item => {
                            const isSelected = selectedCartItemCodes.includes(item.code);

                            return (
                            <div
                                key={item.code}
                                onClick={() => {
                                    if (isCartSelectionMode) toggleCartSelection(item.code);
                                }}
                                data-selected={isCartSelectionMode ? isSelected : undefined}
                                className={`pos-cart-item group rounded-xl border p-2.5 transition-colors ${isCartSelectionMode ? isSelected ? 'cursor-pointer border-slate-400 bg-slate-50/80 hover:border-slate-500' : 'cursor-pointer border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                            >
                                <div className="flex justify-between mb-1.5 gap-2">
                                    <div className="flex min-w-0 items-start gap-2">
                                        {isCartSelectionMode && (
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleCartSelection(item.code)}
                                                onClick={(event) => event.stopPropagation()}
                                                className="pos-cart-item-checkbox mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
                                                aria-label={`Select ${item.name} for removal`}
                                            />
                                        )}
                                    <h4 className="min-w-0 font-semibold text-slate-800 text-xs leading-4 line-clamp-2">
                                        {item.brand && <span className="text-slate-400 font-medium">{item.brand} </span>}
                                        {item.name}
                                        {item.color && <span className="text-gray-400 font-normal text-xs"> — {item.color}</span>}
                                    </h4>
                                    </div>
                                    {!isCartSelectionMode && <button onClick={() => removeFromCart(item.code)} className="shrink-0 rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-500" aria-label={`Remove ${item.name} from order`}>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                    </button>}
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                    <div onClick={(event) => event.stopPropagation()} className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                                        <button 
                                            onClick={() => updateQuantity(item.code, item.qty - 1)}
                                            className="w-6 h-6 rounded flex items-center justify-center bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 text-sm font-semibold pb-0.5"
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
                                            className="w-9 text-center text-xs font-semibold bg-transparent outline-none"
                                        />
                                        <button 
                                            onClick={() => updateQuantity(item.code, item.qty + 1)}
                                            className="w-6 h-6 rounded flex items-center justify-center bg-slate-900 text-white transition-colors hover:bg-slate-700 text-sm font-semibold pb-0.5"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <span className="font-semibold text-sm text-slate-900">{formatCurrency(item.price * item.qty)}</span>
                                </div>
                                <div className="mt-1.5 text-[10px] text-slate-500 flex justify-between">
                                    <span>{item.code}</span>
                                    <span>@ {formatCurrency(item.price)}</span>
                                </div>
                            </div>
                            );
                        })
                    )}
                </div>

                <div className="pos-checkout-panel relative shrink-0 border-t border-slate-200/80 bg-slate-50/80 p-3 z-30">
                    <div className="absolute right-3 top-0 z-10 -translate-y-1/2">
                        <MotionButton
                            type="button"
                            onClick={() => setIsOrderSummaryDetailsCollapsed((prev) => !prev)}
                            initial={false}
                            whileHover={{ width: 96 }}
                            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                            className="pos-summary-collapse group inline-flex h-7 w-7 items-center justify-start overflow-hidden whitespace-nowrap rounded-md border border-gray-300 bg-white px-1.5 text-[9px] font-semibold uppercase tracking-wider text-gray-700 shadow-sm hover:bg-gray-100"
                            aria-label={isOrderSummaryDetailsCollapsed ? 'Show details' : 'Hide details'}
                            title={isOrderSummaryDetailsCollapsed ? 'Show details' : 'Hide details'}
                        >
                            <svg className={`h-3 w-3 shrink-0 transition-transform ${isOrderSummaryDetailsCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="ml-0 max-w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:ml-1 group-hover:max-w-[72px] group-hover:opacity-100">
                                {isOrderSummaryDetailsCollapsed ? 'Show Details' : 'Hide Details'}
                            </span>
                        </MotionButton>
                    </div>

                    <AnimatePresence initial={false}>
                    {!isOrderSummaryDetailsCollapsed && (
                    <MotionDiv
                        key="order-summary-details"
                        initial={{ height: 0, opacity: 0, y: -6 }}
                        animate={{ height: 'auto', opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -6 }}
                        transition={{ duration: 0.22, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                    <div className="pos-checkout-form mb-3 space-y-2.5 rounded-xl border border-slate-200 bg-white p-2.5">
                        <div className="pos-payment-switch inline-flex w-full rounded-lg bg-slate-100 p-1 border border-slate-200">
                            <button
                                type="button"
                                onClick={() => handlePaymentTypeChange('cash')}
                                className={`pos-payment-option ${paymentType === 'cash' ? 'pos-payment-option-active' : ''} flex-1 py-1.5 rounded-md text-[11px] transition-all ${paymentType === 'cash' ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200' : 'font-medium text-slate-500 hover:bg-white/70'}`}
                            >
                                Cash
                            </button>
                            <button
                                type="button"
                                onClick={() => handlePaymentTypeChange('credit')}
                                className={`pos-payment-option ${paymentType === 'credit' ? 'pos-payment-option-active' : ''} flex-1 py-1.5 rounded-md text-[11px] transition-all ${paymentType === 'credit' ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200' : 'font-medium text-slate-500 hover:bg-white/70'}`}
                            >
                                Credit
                            </button>
                        </div>

                        {paymentType === 'cash' ? (
                            <>
                                <div className="group/pos-field-tooltip relative flex justify-between items-center text-sm font-medium text-slate-600">
                                    <span>Cash Received</span>
                                    <div className="relative">
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
                                            className={`w-20 bg-transparent text-right text-sm font-medium text-gray-900 outline-none ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}
                                        />
                                    </div>
                                    </div>
                                    {cart.length === 0 && (
                                        <PosFieldTooltip id="cash-received-disabled-help">
                                            Add an item first to enter cash received.
                                        </PosFieldTooltip>
                                    )}
                                </div>
                                {isCashAmountTooLarge && (
                                    <p id="cash-tendered-size-error" role="alert" className="-mt-1 text-right text-[10px] font-medium text-red-600">
                                        Amount is too large. Please enter a smaller value.
                                    </p>
                                )}
                                <div className="flex justify-between items-center text-sm font-medium text-slate-600">
                                    <span>Change</span>
                                    <span className="text-gray-900 font-semibold">
                                        {isCashAmountTooLarge ? '—' : formatCurrencyFromCentavos(changeCentavosForDisplay ?? 0)}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">VAT Mode</label>
                                    <div className="group/pos-field-tooltip relative">
                                        <select
                                            value={selectedVatMode}
                                            onChange={(e) => setSelectedVatMode(e.target.value)}
                                            disabled={cart.length === 0}
                                            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-medium bg-white focus:border-slate-500 focus:outline-none"
                                        >
                                            {VAT_MODE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                        {cart.length === 0 && (
                                            <PosFieldTooltip id="cash-vat-mode-help">
                                                Add an item first to configure the VAT mode.
                                            </PosFieldTooltip>
                                        )}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div
                                    className="group/pos-field-tooltip relative flex flex-col gap-1"
                                    ref={creditCustomerComboboxRef}
                                >
                                    <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Regular Customer</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={creditCustomerSearchQuery}
                                            onFocus={() => setIsCreditCustomerComboboxOpen(true)}
                                            onChange={(e) => {
                                                setCreditCustomerSearchQuery(e.target.value);
                                                if (selectedCreditCustomerId) {
                                                    setSelectedCreditCustomerId('');
                                                }
                                                setIsCreditCustomerComboboxOpen(true);
                                            }}
                                            onBlur={() => window.setTimeout(() => setIsCreditCustomerComboboxOpen(false), 150)}
                                            disabled={cart.length === 0}
                                            placeholder="Select an eligible regular customer"
                                            role="combobox"
                                            aria-expanded={isCreditCustomerComboboxOpen}
                                            aria-autocomplete="list"
                                            className="w-full px-2.5 py-2 pr-8 rounded-lg border border-slate-300 text-sm font-medium bg-white focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50"
                                        />
                                        {(creditCustomerSearchQuery || selectedCreditCustomerId) && cart.length > 0 && (
                                            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearCreditCustomerSelection} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700" aria-label="Clear regular customer">
                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                            </button>
                                        )}
                                        {cart.length === 0 && (
                                            <PosFieldTooltip id="credit-customer-disabled-help">
                                                Add an item first to select a regular customer.
                                            </PosFieldTooltip>
                                        )}
                                    </div>
                                    {isCreditCustomerComboboxOpen && cart.length > 0 && (
                                        <div className="absolute z-20 top-full mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg" role="listbox">
                                            {creditCustomers.length === 0 ? (
                                                <p className="px-3 py-2 text-xs text-gray-500">No eligible regular customers available</p>
                                            ) : filteredCreditCustomers.length === 0 ? (
                                                <p className="px-3 py-2 text-xs text-gray-500">No customers found</p>
                                            ) : filteredCreditCustomers.map((customer) => {
                                                const customerId = String(customer?._id || customer?.id || '');
                                                const customerName = String(customer?.name || '').trim();
                                                return (
                                                    <button
                                                        key={customerId}
                                                        type="button"
                                                        role="option"
                                                        aria-selected={customerId === selectedCreditCustomerId}
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() => selectCreditCustomer(customer)}
                                                        className={`block w-full px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:outline-none ${customerId === selectedCreditCustomerId ? 'bg-amber-50 text-amber-800' : 'text-gray-700'}`}
                                                    >
                                                        {customerName}
                                                    </button>
                                                );
                                            })}
                                            {canQuickAddCreditCustomer && (
                                                <div className="mt-1 border-t border-gray-200 px-1 pt-1">
                                                    <button
                                                        type="button"
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={openQuickAddCreditCustomer}
                                                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:outline-none"
                                                    >
                                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                                        Add New Regular Customer
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div
                                    className="group/pos-field-tooltip relative flex flex-col gap-1"
                                    ref={creditPaymentModeRef}
                                >
                                    <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Payment Method</label>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsCreditCustomerComboboxOpen(false);
                                                setIsCreditPaymentModeOpen((prev) => !prev);
                                            }}
                                            disabled={cart.length === 0}
                                            aria-haspopup="listbox"
                                            aria-expanded={isCreditPaymentModeOpen}
                                            className="flex w-full items-center justify-between px-2.5 py-2 rounded-lg border border-slate-300 text-sm font-medium bg-white text-slate-800 text-left transition-colors hover:border-slate-400 focus:border-slate-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50"
                                        >
                                            <span>{selectedCreditPaymentMode
                                                ? formatCreditPaymentModeLabel(selectedCreditPaymentMode)
                                                : 'Select payment method'}</span>
                                            <svg className={`h-4 w-4 text-gray-400 transition-transform ${isCreditPaymentModeOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 9 6 6 6-6" /></svg>
                                        </button>
                                        {cart.length === 0 && (
                                            <PosFieldTooltip id="credit-payment-method-disabled-help">
                                                Add an item first to select a payment method.
                                            </PosFieldTooltip>
                                        )}
                                    </div>
                                    {isCreditPaymentModeOpen && cart.length > 0 && (
                                        <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg" role="listbox">
                                            <div className="max-h-40 overflow-y-auto py-1">
                                                {CREDIT_PAYMENT_MODES.map((mode) => (
                                                    <button
                                                        key={mode}
                                                        type="button"
                                                        role="option"
                                                        aria-selected={selectedCreditPaymentMode === mode}
                                                        onClick={() => {
                                                            setSelectedCreditPaymentMode(mode);
                                                            setIsCreditPaymentModeOpen(false);
                                                            if (mode === 'other') {
                                                                focusCustomCreditPaymentModeInput();
                                                            } else {
                                                                setCustomCreditPaymentMode('');
                                                            }
                                                        }}
                                                        className={`w-full px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-amber-50 focus:bg-amber-50 focus:outline-none ${selectedCreditPaymentMode === mode ? 'bg-amber-50 text-amber-700' : 'text-gray-700'}`}
                                                    >
                                                        {formatCreditPaymentModeLabel(mode)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {selectedCreditPaymentMode === 'other' && cart.length > 0 && (
                                        <input
                                            ref={customCreditPaymentModeInputRef}
                                            type="text"
                                            value={customCreditPaymentMode}
                                            onChange={(e) => setCustomCreditPaymentMode(e.target.value)}
                                            onBlur={(e) => setCustomCreditPaymentMode(normalizeHumanReadable(e.target.value))}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                }
                                                if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    creditPaymentModeRef.current?.querySelector('button')?.focus();
                                                }
                                            }}
                                            placeholder="Type other payment mode"
                                            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm font-medium bg-white text-slate-800 focus:border-slate-500 focus:outline-none"
                                        />
                                    )}
                                </div>
                                <div
                                    className="group/pos-field-tooltip relative flex flex-col gap-1"
                                >
                                    <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Credit Term</label>
                                    <div className="relative flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={decrementCreditTerm}
                                            disabled={cart.length === 0 || Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS) <= MIN_CREDIT_TERM_DAYS}
                                            aria-label="Decrease credit term"
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-lg font-medium leading-none transition-colors active:scale-[0.98] dark:border-slate-600 ${cart.length === 0 ? 'cursor-not-allowed bg-slate-50 text-slate-300 dark:bg-slate-800 dark:text-slate-600' : 'bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100 active:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700 dark:active:bg-slate-600'}`}
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
                                            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-center text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                        />
                                        <button
                                            type="button"
                                            onClick={incrementCreditTerm}
                                            disabled={cart.length === 0 || Number(selectedCreditTermDays || MIN_CREDIT_TERM_DAYS) >= MAX_CREDIT_TERM_DAYS}
                                            aria-label="Increase credit term"
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-lg font-medium leading-none transition-colors active:scale-[0.98] dark:border-slate-600 ${cart.length === 0 ? 'cursor-not-allowed bg-slate-50 text-slate-300 dark:bg-slate-800 dark:text-slate-600' : 'bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100 active:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700 dark:active:bg-slate-600'}`}
                                        >
                                            +
                                        </button>
                                        <span className="text-xs font-medium text-gray-500 whitespace-nowrap">days</span>
                                        {cart.length === 0 && (
                                            <PosFieldTooltip id="credit-term-disabled-help">
                                                Add an item first to set the credit term.
                                            </PosFieldTooltip>
                                        )}
                                    </div>
                                </div>
                                <div
                                    className="group/pos-field-tooltip relative flex justify-between items-center text-sm font-medium text-gray-600"
                                >
                                    <span className="font-medium text-slate-600">Due Date</span>
                                    <span className="text-gray-900 font-semibold">
                                        {computedCreditDueDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                    </span>
                                    {cart.length === 0 && (
                                        <PosFieldTooltip id="credit-due-date-disabled-help">
                                            The due date will be calculated after setting the credit term.
                                        </PosFieldTooltip>
                                    )}
                                </div>
                                <div
                                    className="group/pos-field-tooltip relative flex flex-col gap-1"
                                >
                                    <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">VAT Mode</label>
                                    <div className="relative">
                                        <select
                                            value={selectedVatMode}
                                            onChange={(e) => setSelectedVatMode(e.target.value)}
                                            disabled={cart.length === 0}
                                            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-xs font-medium bg-white focus:border-slate-500 focus:outline-none"
                                        >
                                            {VAT_MODE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                        {cart.length === 0 && (
                                            <PosFieldTooltip id="credit-vat-mode-disabled-help">
                                                Add an item first to configure the VAT mode.
                                            </PosFieldTooltip>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="pos-totals flex justify-between items-end rounded-lg bg-slate-100/80 px-2.5 py-2.5 font-semibold text-xl text-slate-900">
                            <span>Total</span>
                            <span>{formatCurrency(calculateTotal())}</span>
                        </div>
                        {(() => {
                            const vat = calculateVatBreakdown();
                            if (!vat) return null;
                            return (
                                vat.netAmount > 0 ? (
                                    <div className="space-y-1 text-xs px-1 pt-1">
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
                    </MotionDiv>
                    )}
                    </AnimatePresence>
                    <div className="flex gap-2 border-t border-slate-100 pt-2.5">
                        <div className={`relative group w-[34%] shrink-0 ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}>
                            <button 
                                onClick={handleGenerateQuotation}
                                disabled={cart.length === 0}
                                className={`w-full py-2.5 rounded-lg border border-slate-300 bg-white text-[10px] font-semibold uppercase tracking-wider text-slate-700 flex items-center justify-center transition-colors duration-150 ${cart.length === 0 ? 'pointer-events-none opacity-50' : 'hover:bg-slate-50 hover:border-slate-400'}`}
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
                                className={`w-full py-2.5 rounded-lg border border-slate-900 bg-slate-900 text-[10px] font-semibold uppercase tracking-wider text-white flex items-center justify-center shadow-sm transition-colors duration-150 ${isCheckoutDisabled ? 'pointer-events-none opacity-50' : 'hover:bg-slate-800'}`}
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
        
        {productDetailsItem && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
                onClick={() => setProductDetailsItem(null)}
            >
                <div
                    className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Product Details</h3>
                                <p className="text-[10px] text-slate-500">Reference information only</p>
                            </div>
                        </div>
                        <button type="button" onClick={() => setProductDetailsItem(null)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Close product details">
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="max-h-[min(560px,calc(100vh-8rem))] overflow-y-auto p-4">
                        <div className="flex gap-4">
                            <ProductThumbnail item={productDetailsItem} className="h-28 w-28 shrink-0 rounded-xl" onPreview={handleProductImagePreviewClick} fit="contain" />
                            <div className="min-w-0 py-1">
                                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">{productDetailsItem.category || 'Product'}</p>
                                <h4 className="mt-1 text-base font-semibold leading-snug text-slate-900">{productDetailsItem.name}</h4>
                                <p className="mt-1 text-xs text-slate-500">
                                    {[productDetailsItem.brand, productDetailsItem.size, productDetailsItem.color].filter(Boolean).join(' · ') || 'No variant details available'}
                                </p>
                                <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
                                    {productDetailsItem.isGroup
                                        ? (productDetailsItem.minPrice === productDetailsItem.maxPrice ? formatCurrency(productDetailsItem.minPrice) : `${formatCurrency(productDetailsItem.minPrice)} - ${formatCurrency(productDetailsItem.maxPrice)}`)
                                        : formatCurrency(productDetailsItem.price)}
                                </p>
                            </div>
                        </div>
                        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-slate-100 pt-4 text-xs">
                            <div>
                                <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">{productDetailsItem.isGroup ? 'Options' : 'SKU'}</dt>
                                <dd className="mt-1 font-medium text-slate-800">{productDetailsItem.isGroup ? productDetailsItem.variants.length : productDetailsItem.code}</dd>
                            </div>
                            <div>
                                <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Stock</dt>
                                <dd className="mt-1 font-medium text-slate-800">{productDetailsItem.stock} available</dd>
                            </div>
                            <div>
                                <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Product Type</dt>
                                <dd className="mt-1 font-medium text-slate-800">{productDetailsItem.category || 'General'}</dd>
                            </div>
                            {productDetailsItem.isGroup ? (
                                <div>
                                    <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Brands</dt>
                                    <dd className="mt-1 font-medium text-slate-800">{productDetailsItem.availableBrands?.join(', ') || 'Not specified'}</dd>
                                </div>
                            ) : (
                                productDetailsItem.supplierName && <div>
                                    <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Supplier</dt>
                                    <dd className="mt-1 font-medium text-slate-800">{productDetailsItem.supplierName}</dd>
                                </div>
                            )}
                        </dl>
                    </div>
                </div>
            </div>
        )}

        {recommendationChooserItem && (
            <div className="recommendation-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setRecommendationChooserItem(null)}>
                <div role="dialog" aria-modal="true" aria-labelledby="recommendation-type-title" className="recommendation-modal recommendation-chooser-modal w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="recommendation-modal-header flex items-start justify-between border-b border-slate-100 px-4 py-3">
                        <div className="min-w-0 pr-3">
                            <h3 id="recommendation-type-title" className="text-sm font-semibold text-slate-900">Choose Recommendation Type</h3>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">{recommendationChooserItem.name} ({recommendationChooserItem.code})</p>
                        </div>
                        <button type="button" onClick={() => setRecommendationChooserItem(null)} aria-label="Close recommendation choices" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="recommendation-modal-body space-y-2 bg-slate-50/60 p-4">
                        <button type="button" onClick={() => { const item = recommendationChooserItem; setRecommendationChooserItem(null); openRecommendationResults(item, 'alternative', { returnToChooser: true }); }} className="recommendation-choice-card flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50">
                            <span className="recommendation-choice-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" /></svg>
                            </span>
                            <span><span className="block text-xs font-semibold text-slate-900">Alternative Products</span><span className="mt-0.5 block text-[10px] text-slate-500">Similar or compatible replacement products.</span></span>
                        </button>
                        <button type="button" onClick={() => { const item = recommendationChooserItem; setRecommendationChooserItem(null); openRecommendationResults(item, 'budget', { returnToChooser: true }); }} className="recommendation-choice-card recommendation-choice-card-budget flex w-full items-center gap-3 rounded-xl border border-emerald-100 bg-white p-3 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/40">
                            <span className="recommendation-choice-icon recommendation-choice-icon-budget flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2v-2m2-6h-6a2 2 0 000 4h6V9z" /></svg>
                            </span>
                            <span><span className="block text-xs font-semibold text-slate-900">Budget Options</span><span className="mt-0.5 block text-[10px] text-slate-500">Compare Value, Standard, and Premium price options.</span></span>
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Recommendation Modal */}
        {recommendationModal.isOpen && (
            <div className="recommendation-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}>
                <div className="recommendation-modal recommendation-results-modal w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200" onClick={(event) => event.stopPropagation()}>
                    <div className="recommendation-modal-header border-b border-slate-100 bg-white px-4 py-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold tracking-tight text-slate-900">
                                        {recommendationModal.kind === 'budget' ? 'Budget Options' : 'Alternative Products'}
                                    </h3>
                                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                                        {recommendationModal.item.brand ? `${recommendationModal.item.brand} ` : ''}{recommendationModal.item.name}{recommendationModal.item.color ? ` — ${recommendationModal.item.color}` : ''} ({recommendationModal.item.code})
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Close recommendations"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    <div className="recommendation-modal-body bg-slate-50/60 p-4">
                        <p className="mb-2 text-[11px] text-slate-500">
                            {recommendationModal.kind === 'budget'
                                ? 'Compare price-relative options for the selected product.'
                                : recommendationModal.type === 'out-of-stock'
                                    ? 'Choose a suitable in-stock replacement. Nothing is substituted automatically.'
                                    : 'Choose a similar or compatible replacement product.'}
                        </p>
                        {recommendationModal.returnToChooser && (
                            <button
                                type="button"
                                onClick={() => {
                                    const item = recommendationModal.item;
                                    setRecommendationModal({ isOpen: false, item: null, alternatives: [] });
                                    setRecommendationChooserItem(item);
                                }}
                                className="recommendation-back-link mb-3 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 transition-colors hover:text-slate-800"
                            >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 18l-6-6 6-6" />
                                </svg>
                                Back to Recommendation Type
                            </button>
                        )}
                        
                        {recommendationModal.alternatives.length > 0 ? (
                            <div className="recommendation-results-scroll -mr-2 max-h-[430px] overflow-y-auto pr-2">
                                <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2">
                                    {recommendationModal.alternatives.map(alt => {
                                        const originalPrice = Number(recommendationModal.item?.price || 0);
                                        const alternativePrice = Number(alt.price || 0);
                                        const savings = Math.max(0, originalPrice - alternativePrice);
                                        const priceDifference = alternativePrice - originalPrice;
                                        const priceTier = getRelativePriceTier(recommendationModal.item?.price, alt.price);
                                        const tierPresentation = {
                                            value: { label: 'Value', className: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
                                            standard: { label: 'Standard', className: 'border-slate-200 bg-slate-50 text-slate-600' },
                                            premium: { label: 'Premium', className: 'border-indigo-100 bg-indigo-50 text-indigo-700' },
                                        }[priceTier];

                                        return (
                                            <div
                                                key={alt.code}
                                                className={`recommendation-result-card cursor-pointer rounded-xl border p-3 transition-colors hover:border-slate-400 ${recommendationModal.type === 'out-of-stock' ? 'border-red-200 bg-red-50/30' : 'border-slate-200 bg-white'}`}
                                                onClick={() => selectRecommendedAlternative(alt)}
                                            >
                                                <div className="flex gap-3">
                                                    <ProductThumbnail item={alt} className="h-20 w-20 shrink-0 rounded-lg" onPreview={handleProductImagePreviewClick} fit="contain" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="mb-1 flex flex-wrap items-center gap-1">
                                                            {recommendationModal.kind === 'budget' && (
                                                                <span className={`recommendation-tier-badge recommendation-tier-${priceTier} rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${tierPresentation.className}`}>
                                                                    {tierPresentation.label}
                                                                </span>
                                                            )}
                                                            {recommendationModal.kind === 'alternative' && (
                                                                <span className="text-[9px] font-medium text-slate-400">Alternative Product</span>
                                                            )}
                                                        </div>
                                                        <h5 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
                                                            {alt.brand && <span className="text-slate-500">{alt.brand} </span>}
                                                            {alt.name}
                                                        </h5>
                                                        <p className="mt-1 truncate text-[10px] text-slate-500">
                                                            {[alt.size, alt.color].filter(Boolean).join(' · ') || 'Standard option'}
                                                        </p>
                                                        <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">{alt.code}</p>
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                                                    <div>
                                                        <p className="text-[15px] font-semibold tracking-tight text-slate-900">{formatCurrency(alt.price)}</p>
                                                        {recommendationModal.kind === 'budget' && priceTier === 'value' && savings > 0 && (
                                                            <p className="text-[10px] font-medium text-emerald-700">Save {formatCurrency(savings)}</p>
                                                        )}
                                                        {recommendationModal.kind === 'budget' && priceTier === 'standard' && Math.abs(priceDifference) > 0 && (
                                                            <p className="text-[10px] font-medium text-slate-500">
                                                                {priceDifference < 0 ? `${formatCurrency(Math.abs(priceDifference))} cheaper` : `${formatCurrency(priceDifference)} higher`}
                                                            </p>
                                                        )}
                                                        {recommendationModal.kind === 'budget' && priceTier === 'premium' && priceDifference > 0 && (
                                                            <p className="text-[10px] font-medium text-indigo-700">{formatCurrency(priceDifference)} higher</p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span data-stock-state={alt.stock < 20 ? 'low' : 'in-stock'} className={`recommendation-stock-badge rounded-full px-2 py-1 text-[9px] font-semibold ${alt.stock < 20 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                            {alt.stock} in stock
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                selectRecommendedAlternative(alt);
                                                            }}
                                                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
                                                        >
                                                            Add
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
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

                    <div className="recommendation-modal-footer flex justify-end gap-3 border-t border-slate-100 bg-white px-4 py-3">
                        <button 
                            onClick={() => setRecommendationModal({ isOpen: false, item: null, alternatives: [] })}
                            className="recommendation-modal-cancel rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        {recommendationModal.type === 'low-stock' && (
                            <button 
                                onClick={() => addToCart(recommendationModal.item, true)}
                                className="recommendation-modal-continue rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
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
                <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-[0_16px_44px_-20px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/10 max-h-[82vh] animate-in fade-in zoom-in-95 duration-300">
                    <div className="relative z-10 flex flex-col gap-2 border-b border-slate-200 bg-white/95 px-4 py-3">
                        <div className="w-full">
                            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                {variantModal.step === 'variants' && variantModal.group.brandOptions?.length > 1 && (
                                    <button 
                                        onClick={() => setVariantModal(prev => ({ ...prev, step: 'brand', selectedBrand: null, selectedSize: null, selectedColor: null, selectedVariantCode: null, quantity: 1 }))}
                                        className="text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 transition-all"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                        Back to Brands
                                    </button>
                                )}
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-slate-600">{variantModal.step === 'brand' ? 'Select Brand' : 'Product Group'}</span>
                                {variantModal.step === 'variants' && variantModal.selectedBrand && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-500">{variantModal.group.brandOptions?.find((option) => option.key === variantModal.selectedBrand)?.label || variantModal.selectedBrand}</span>}
                                {variantModal.step === 'variants' && !variantModal.selectedBrand && variantModal.group.brand && variantModal.group.brand !== 'Multiple Brands' && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-500">{variantModal.group.brand}</span>}
                            </div>
                            <h3 className="text-center text-lg font-semibold leading-tight tracking-tight text-slate-900">
                                {variantModal.group.name}
                            </h3>
                            {variantModal.group.color && variantModal.group.color !== 'Multiple Colors' && <p className="mt-0.5 text-center text-[11px] font-medium text-slate-500">Base Color: <span className="font-semibold text-slate-800">{variantModal.group.color}</span></p>}
                            {variantModal.step === 'variants' && (
                                <div className="mt-2 flex justify-center">
                                    <ProductThumbnail item={variantModalImageItem} className="h-16 w-16" onPreview={handleProductImagePreviewClick} fit="contain" />
                                </div>
                            )}
                        </div>
                        <button 
                            onClick={() => setVariantModal(createClosedVariantModalState())}
                            className="absolute right-4 top-3 rounded-lg bg-slate-50 p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto w-full max-h-full no-scrollbar">
                        {variantModal.step === 'brand' ? (
                            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3 pb-12">
                                 {variantModal.group.brandOptions.map((brandOption) => {
                                     const brandVariants = variantModal.group.variants.filter((variant) => getPosVariantValueKey(variant, 'brand') === brandOption.key);
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
                                            key={brandOption.key}
                                            className={`group relative flex min-h-[120px] flex-col items-center justify-center rounded-xl border p-3 text-center transition-colors duration-200
                                                ${isBrandOutOfStock 
                                                    ? 'cursor-not-allowed border-rose-100 bg-rose-50/30 opacity-70 grayscale-[0.5]'
                                                    : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                                }`}
                                            onClick={() => {
                                                if (!isBrandOutOfStock) {
                                                    setVariantModal(prev => ({ ...prev, step: 'variants', selectedBrand: brandOption.key, selectedSize: null, selectedColor: null, selectedVariantCode: null, quantity: 1 }));
                                                }
                                            }}
                                        >
                                            <ProductThumbnail item={brandImageItem} className="mb-2 h-12 w-12" onPreview={handleProductImagePreviewClick} fit="contain" />
                                            <h4 className="text-sm font-semibold leading-tight tracking-tight text-slate-800">{brandOption.label}</h4>
                                            
                                            <div className="flex-1 flex flex-col justify-end mt-2 w-full">
                                                <div className={`mx-auto inline-block rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${isBrandOutOfStock ? 'hidden bg-transparent text-rose-500/0' : 'border-slate-200 bg-slate-50 text-slate-600 group-hover:bg-white'}`}>
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
                            <div className="flex h-full min-h-0 flex-col">
                                {(() => {
                                    const filteredVariants = variantModal.group.variants.filter((variant) => (
                                        !variantModal.selectedBrand || getPosVariantValueKey(variant, 'brand') === variantModal.selectedBrand
                                    ));
                                    const selectionModel = getPosVariantSelectionModel(filteredVariants, {
                                        size: variantModal.selectedSize,
                                        color: variantModal.selectedColor,
                                    }, variantModal.selectedVariantCode, variantModal.group.variantDimensions?.filter((dimension) => dimension !== 'brand'));
                                    const uniqueSizes = selectionModel.optionGroups.size || [];
                                    const uniqueColors = selectionModel.optionGroups.color || [];
                                    const needsSize = selectionModel.dimensions.includes('size');
                                    const needsColor = selectionModel.dimensions.includes('color');
                                    const resolvedSelectedSize = selectionModel.resolvedSelections.size ?? null;
                                    const resolvedSelectedColor = selectionModel.resolvedSelections.color ?? null;
                                    const isAllSelected = selectionModel.isComplete
                                        && (!selectionModel.needsSkuSelection || Boolean(selectionModel.resolvedCode));
                                    const matchedVariant = selectionModel.matchedVariant;
                                    const canAddSelectedVariant = Boolean(matchedVariant && Number(matchedVariant.stock) > 0);
                                    const selectedRecommendationAvailability = matchedVariant
                                        ? getRecommendationAvailability(matchedVariant, inventory, settings)
                                        : null;
                                    const canOpenAlternatives = Boolean(matchedVariant && selectedRecommendationAvailability?.hasAlternatives);
                                    const selectedRecommendationAction = getPosRecommendationAction(selectedRecommendationAvailability);
                                    const selectedRecommendationLabel = 'Recommendations';
                                    const isPrimaryDisabled = !isAllSelected || (!canAddSelectedVariant && !canOpenAlternatives);
                                    const maxSelectableQty = Math.max(1, Number(matchedVariant?.stock) || 1);
                                    const selectedQuantity = Math.min(Math.max(1, Number(variantModal.quantity) || 1), maxSelectableQty);
                                    const selectedUnitPrice = Number(matchedVariant?.price || 0);
                                    const selectedTotalPrice = selectedUnitPrice * selectedQuantity;
                                    const selectorDimensions = variantModal.group.variantDimensions?.filter((dimension) => dimension !== 'brand');
                                    const handleUnavailableVariantOption = (dimension, optionKey) => {
                                        const nextSelections = updatePosVariantSelection(filteredVariants, {
                                            size: resolvedSelectedSize,
                                            color: resolvedSelectedColor,
                                        }, dimension, optionKey, selectorDimensions);
                                        const nextModel = getPosVariantSelectionModel(
                                            filteredVariants,
                                            nextSelections,
                                            null,
                                            selectorDimensions
                                        );
                                        const exactUnavailableVariant = nextModel.matchingVariants.length === 1
                                            && Number(nextModel.matchingVariants[0]?.stock) <= 0
                                            ? nextModel.matchingVariants[0]
                                            : null;

                                        if (exactUnavailableVariant) {
                                            openRecommendationResults(exactUnavailableVariant, 'alternative', { type: 'out-of-stock' });
                                            setVariantModal(createClosedVariantModalState());
                                            return;
                                        }

                                        // More than one legacy SKU can share the same visible option.
                                        // Keep narrowing through the existing selectors/SKU fallback
                                        // without treating the unavailable option as purchasable.
                                        setVariantModal((previous) => ({
                                            ...previous,
                                            selectedSize: nextSelections.size ?? null,
                                            selectedColor: nextSelections.color ?? null,
                                            selectedVariantCode: null,
                                            quantity: 1,
                                        }));
                                    };

                                    return (
                                        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/70">
                                            <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
                                                <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
                                                    <div>
                                                        <h4 className="text-xl font-semibold tracking-tight text-slate-900">
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
                                                        <div className="mt-1 flex items-center gap-1.5">
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
                                                            <p className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700">{matchedVariant.code}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {needsSize && (
                                                    <div className="mb-4">
                                                        <div className="mb-2 flex items-center">
                                                            <h5 className="text-[11px] font-semibold text-slate-800 uppercase tracking-widest">Select Size/Variant</h5>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {uniqueSizes.map((sizeOption) => {
                                                                const isSelected = resolvedSelectedSize === sizeOption.key;
                                                                const hasMatchingCombination = sizeOption.exists;
                                                                const hasStock = sizeOption.hasStock;

                                                                return (
                                                                    <ViewportTooltip
                                                                        key={sizeOption.key}
                                                                        content={!hasMatchingCombination
                                                                            ? 'Not available for selected color'
                                                                            : (!hasStock ? 'Sold out — click to view alternatives' : null)}
                                                                    >
                                                                        <button
                                                                            disabled={!hasMatchingCombination}
                                                                            aria-disabled={!hasMatchingCombination || !hasStock}
                                                                            aria-label={!hasStock && hasMatchingCombination ? `${sizeOption.label}. Out of stock. View recommendations.` : undefined}
                                                                            onClick={() => {
                                                                                if (!hasMatchingCombination) return;
                                                                                if (!hasStock) {
                                                                                    handleUnavailableVariantOption('size', sizeOption.key);
                                                                                    return;
                                                                                }
                                                                                const nextSelections = updatePosVariantSelection(filteredVariants, {
                                                                                    size: resolvedSelectedSize,
                                                                                    color: resolvedSelectedColor,
                                                                                }, 'size', isSelected ? null : sizeOption.key, variantModal.group.variantDimensions?.filter((dimension) => dimension !== 'brand'));
                                                                                setVariantModal(prev => ({
                                                                                    ...prev,
                                                                                    selectedSize: nextSelections.size ?? null,
                                                                                    selectedColor: nextSelections.color ?? null,
                                                                                    selectedVariantCode: null,
                                                                                    quantity: 1,
                                                                                }));
                                                                            }}
                                                                            className={`min-h-9 min-w-[52px] rounded-lg border px-3 py-2 text-[13px] font-semibold transition-colors ${isSelected ? 'border-slate-900 bg-slate-900 text-white' : !hasMatchingCombination ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300 opacity-70' : !hasStock ? 'cursor-pointer border-rose-200 bg-rose-50 text-rose-500 opacity-75 hover:border-rose-300 hover:bg-rose-100/70' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'}`}
                                                                        >
                                                                            {sizeOption.label}
                                                                        </button>
                                                                    </ViewportTooltip>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {needsColor && (
                                                    <div className="mb-4">
                                                        <div className="mb-2 flex items-center">
                                                            <h5 className="text-[11px] font-semibold text-slate-800 uppercase tracking-widest">Select Color</h5>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {uniqueColors.map((colorOption) => {
                                                                const isSelected = resolvedSelectedColor === colorOption.key;
                                                                const hasMatchingCombination = colorOption.exists;
                                                                const hasStock = colorOption.hasStock;

                                                                return (
                                                                    <ViewportTooltip
                                                                        key={colorOption.key}
                                                                        content={!hasMatchingCombination
                                                                            ? 'Not available for selected size'
                                                                            : (!hasStock ? 'Sold out — click to view alternatives' : null)}
                                                                    >
                                                                        <button
                                                                            disabled={!hasMatchingCombination}
                                                                            aria-disabled={!hasMatchingCombination || !hasStock}
                                                                            aria-label={!hasStock && hasMatchingCombination ? `${colorOption.label}. Out of stock. View recommendations.` : undefined}
                                                                            onClick={() => {
                                                                                if (!hasMatchingCombination) return;
                                                                                if (!hasStock) {
                                                                                    handleUnavailableVariantOption('color', colorOption.key);
                                                                                    return;
                                                                                }
                                                                                const nextSelections = updatePosVariantSelection(filteredVariants, {
                                                                                    size: resolvedSelectedSize,
                                                                                    color: resolvedSelectedColor,
                                                                                }, 'color', isSelected ? null : colorOption.key, variantModal.group.variantDimensions?.filter((dimension) => dimension !== 'brand'));
                                                                                setVariantModal(prev => ({
                                                                                    ...prev,
                                                                                    selectedSize: nextSelections.size ?? null,
                                                                                    selectedColor: nextSelections.color ?? null,
                                                                                    selectedVariantCode: null,
                                                                                    quantity: 1,
                                                                                }));
                                                                            }}
                                                                            className={`flex min-h-9 items-center justify-center rounded-lg border px-4 py-2 text-[13px] font-semibold transition-colors ${isSelected ? 'border-slate-900 bg-slate-900 text-white' : !hasMatchingCombination ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300 opacity-70' : !hasStock ? 'cursor-pointer border-rose-200 bg-rose-50 text-rose-500 opacity-75 hover:border-rose-300 hover:bg-rose-100/70' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'}`}
                                                                        >
                                                                            {colorOption.label}
                                                                        </button>
                                                                    </ViewportTooltip>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {selectionModel.needsSkuSelection && (
                                                    <div className="mb-4">
                                                        <div className="mb-2 flex items-center">
                                                            <h5 className="text-[11px] font-semibold uppercase tracking-widest text-slate-800">Select SKU</h5>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {selectionModel.matchingVariants.map((variant) => {
                                                                const hasStock = Number(variant.stock) > 0;
                                                                const isSelected = selectionModel.resolvedCode === variant.code;

                                                                return (
                                                                    <ViewportTooltip
                                                                        key={variant.code}
                                                                        content={!hasStock ? 'Sold out — click to view alternatives' : null}
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            aria-disabled={!hasStock}
                                                                            aria-label={!hasStock ? `${variant.code}. Out of stock. View recommendations.` : undefined}
                                                                            onClick={() => {
                                                                                if (!hasStock) {
                                                                                    openRecommendationResults(variant, 'alternative', { type: 'out-of-stock' });
                                                                                    setVariantModal(createClosedVariantModalState());
                                                                                    return;
                                                                                }
                                                                                setVariantModal((previous) => ({
                                                                                    ...previous,
                                                                                    selectedVariantCode: variant.code,
                                                                                    quantity: 1,
                                                                                }));
                                                                            }}
                                                                            className={`min-h-9 rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors ${isSelected ? 'border-slate-900 bg-slate-900 text-white' : !hasStock ? 'cursor-pointer border-rose-200 bg-rose-50 text-rose-500 opacity-75 hover:border-rose-300 hover:bg-rose-100/70' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'}`}
                                                                        >
                                                                            {variant.code}
                                                                        </button>
                                                                    </ViewportTooltip>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                                                {canAddSelectedVariant && (
                                                    <div className="mb-4 flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-widest">Quantity</p>
                                                            <p className="text-[10px] text-slate-500">Max {maxSelectableQty} available</p>
                                                        </div>
                                                        <div className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                                                            <button
                                                                type="button"
                                                                disabled={selectedQuantity <= 1}
                                                                onClick={() => setVariantModal(prev => ({ ...prev, quantity: Math.max(1, (Number(prev.quantity) || 1) - 1) }))}
                                                                className={`flex h-8 w-8 items-center justify-center text-base font-semibold transition-colors ${selectedQuantity <= 1 ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-50'}`}
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
                                                                className="h-8 w-11 border-x border-slate-200 text-center text-sm font-semibold text-slate-900 outline-none"
                                                            />
                                                            <button
                                                                type="button"
                                                                disabled={selectedQuantity >= maxSelectableQty}
                                                                onClick={() => setVariantModal(prev => ({ ...prev, quantity: Math.min(maxSelectableQty, (Number(prev.quantity) || 1) + 1) }))}
                                                                className={`flex h-8 w-8 items-center justify-center text-base font-semibold transition-colors ${selectedQuantity >= maxSelectableQty ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-50'}`}
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

                                                        if (canOpenAlternatives && matchedVariant) {
                                                            const forcedType = Number(matchedVariant.stock) <= 0
                                                                ? 'out-of-stock'
                                                                : (getStockStatus(matchedVariant, settings) === 'Low Stock' ? 'low-stock' : undefined);

                                                            openRecommendationResults(matchedVariant, 'alternative', { type: forcedType });
                                                            setVariantModal(createClosedVariantModalState());
                                                        }
                                                    }}
                                                    className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold uppercase tracking-widest transition-colors ${isPrimaryDisabled ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                                                >
                                                    {!isAllSelected ? "Select Options Required" : (canAddSelectedVariant ? "Add to Cart" : canOpenAlternatives ? "View Recommendations" : "Unavailable")}
                                                </button>
                                                {canAddSelectedVariant && matchedVariant && selectedRecommendationAction && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            openAvailableRecommendations(matchedVariant, selectedRecommendationAvailability);
                                                            setVariantModal(createClosedVariantModalState());
                                                        }}
                                                        className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                                                    >
                                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                        </svg>
                                                        {selectedRecommendationLabel}
                                                    </button>
                                                )}
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

        {isQuickAddCreditCustomerOpen && (
            <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="quick-add-credit-customer-title">
                <form onSubmit={handleQuickAddCreditCustomer} className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
                        <div>
                            <h3 id="quick-add-credit-customer-title" className="text-sm font-semibold text-gray-900">Add New Regular Customer</h3>
                            <p className="mt-0.5 text-[11px] text-gray-500">Create a customer without leaving this Credit order.</p>
                        </div>
                        <button
                            type="button"
                            onClick={closeQuickAddCreditCustomer}
                            disabled={isSavingQuickAddCreditCustomer}
                            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed"
                            aria-label="Close quick add customer"
                        >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                        <div>
                            <label htmlFor="quick-add-credit-customer-name" className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Customer Name</label>
                            <input
                                id="quick-add-credit-customer-name"
                                type="text"
                                value={quickAddCreditCustomerName}
                                onChange={(event) => setQuickAddCreditCustomerName(event.target.value)}
                                onBlur={(event) => setQuickAddCreditCustomerName(normalizeHumanReadable(event.target.value))}
                                autoFocus
                                maxLength={120}
                                placeholder="Enter customer name"
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:border-amber-500 focus:outline-none"
                            />
                            <p className="mt-1 text-[10px] text-gray-500">Only a name is required. The customer is created using the existing Partner rules.</p>
                        </div>
                        {quickAddCreditCustomerMatches.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                                <p className="text-[11px] font-semibold text-amber-900">Similar eligible customers found</p>
                                <p className="mt-0.5 text-[10px] text-amber-800">Select an existing record when it is the correct customer. Creating a new record will not link by name.</p>
                                <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
                                    {quickAddCreditCustomerMatches.slice(0, 3).map((customer) => {
                                        const customerId = String(customer?._id || customer?.id || '');
                                        const customerName = String(customer?.name || '').trim();
                                        return (
                                            <button
                                                key={customerId}
                                                type="button"
                                                onClick={() => {
                                                    selectCreditCustomer(customer);
                                                    setIsQuickAddCreditCustomerOpen(false);
                                                    setQuickAddCreditCustomerName('');
                                                    quickAddCreditCustomerRequestIdRef.current = '';
                                                }}
                                                className="block w-full rounded-md bg-white px-2 py-1.5 text-left text-xs font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 focus:outline-none"
                                            >
                                                Select {customerName}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
                        <button
                            type="button"
                            onClick={closeQuickAddCreditCustomer}
                            disabled={isSavingQuickAddCreditCustomer}
                            className="flex-1 rounded-xl bg-white py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSavingQuickAddCreditCustomer || !String(quickAddCreditCustomerName || '').trim()}
                            className="flex-1 rounded-xl bg-gray-900 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSavingQuickAddCreditCustomer ? 'Saving...' : 'Save Customer'}
                        </button>
                    </div>
                </form>
            </div>
        )}

        {/* Quotation Preview Modal */}
        {showQuotationPreview && quotationData && (
            <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className={`flex ${ORDER_CONFIRMATION_PREVIEW_SIZE.modal} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
                    <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3.5 sm:px-5 sm:py-4">
                        <h3 className="text-xl font-semibold text-gray-800 sm:text-2xl">Quotation Preview</h3>
                        <button onClick={() => setShowQuotationPreview(false)} className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" aria-label="Close quotation preview">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-6 sm:py-5" id="quotation-content">
                        {(() => {
                            const quotationReceipt = buildQuotationReceiptModel(quotationData, settings);

                            return (
                                <div className={`${ORDER_CONFIRMATION_PREVIEW_SIZE.content} px-1 text-xs leading-relaxed text-gray-600 sm:text-[13px]`}>
                                    <div className="mb-5 text-center">
                                        <p className="mb-1 text-lg font-semibold leading-tight text-gray-900">{quotationReceipt.storeName}</p>
                                        <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-gray-400 sm:text-xs">
                                            {quotationReceipt.storeAddress && <p>{quotationReceipt.storeAddress}</p>}
                                            {quotationReceipt.contactPhone && <p>Contact: {quotationReceipt.contactPhone}</p>}
                                        </div>
                                        <p className="mt-3 text-xs font-semibold tracking-wider text-gray-900">{quotationReceipt.title}</p>
                                    </div>

                                    <div className="grid grid-cols-[minmax(0,1.95fr)_2rem_minmax(0,1fr)_minmax(0,1.1fr)] gap-x-2 border-b-2 border-gray-100 py-1.5 text-xs font-semibold text-gray-700">
                                        <span>Item</span>
                                        <span className="text-center">Qty</span>
                                        <span className="text-right whitespace-nowrap">Unit Price</span>
                                        <span className="text-right">Amount</span>
                                    </div>

                                    <div className="divide-y divide-gray-100">
                                        {quotationReceipt.items.map((item, index) => (
                                            <div key={`${item.code || item.name}-${index}`} className="grid grid-cols-[minmax(0,1.95fr)_2rem_minmax(0,1fr)_minmax(0,1.1fr)] gap-x-2 py-2">
                                                <div className="min-w-0">
                                                    <p className="break-words font-semibold leading-tight text-gray-800">{item.name}</p>
                                                </div>
                                                <span className="text-center text-gray-600">{item.quantity}</span>
                                                <span className="text-right font-medium text-gray-600 whitespace-nowrap">{formatCurrency(item.unitPrice)}</span>
                                                <span className="text-right font-medium text-gray-600 whitespace-nowrap">{formatCurrency(item.amount)}</span>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-2 border-t border-gray-900 pt-2">
                                        <div className="flex items-baseline justify-between gap-2 text-lg font-semibold text-gray-900">
                                            <span>TOTAL</span>
                                            <span className="whitespace-nowrap">{formatCurrency(quotationReceipt.total)}</span>
                                        </div>
                                    </div>

                                    <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400 sm:text-xs">{quotationReceipt.footer}</p>
                                </div>
                            );
                        })()}
                    </div>

                    <div className="border-t border-gray-100 bg-gray-50 p-3 sm:p-4">
                        <p className="mb-2 text-center text-[9px] font-medium text-gray-400">Printing is optional.</p>
                        <div className="grid grid-cols-2 gap-2">
                        <button 
                            onClick={() => setShowQuotationPreview(false)}
                            className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-gray-600 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100"
                            style={{ border: '2px solid #e5e7eb' }}
                        >
                            Close
                        </button>
                        <div className="min-w-0">
                            <button
                                onClick={handlePrintQuotationDoc}
                                disabled={printStatus === 'printing'}
                                className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold uppercase tracking-widest shadow-sm transition-all duration-300 ${printStatus === 'printing' ? 'cursor-wait opacity-80' : 'hover:-translate-y-0.5 hover:opacity-90'}`}
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
                                    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 8V4h12v4m-1 10H7v-6h10v6Zm2-10H5a2 2 0 0 0-2 2v5h3m12 0h3v-5a2 2 0 0 0-2-2Z" /></svg>
                                    Print
                                </>
                                )}
                            </button>
                        </div>
                        </div>
                    </div>
                </div>
            </div>
        )}
        {isBulkRemoveConfirmationOpen && (
            <div
                className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm"
                onClick={() => setIsBulkRemoveConfirmationOpen(false)}
            >
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="bulk-remove-order-items-title"
                    className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                >
                    <h3 id="bulk-remove-order-items-title" className="text-sm font-semibold text-slate-900">Remove {selectedCartItemCount} items?</h3>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">This will remove the selected items from the current order.</p>
                    <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setIsBulkRemoveConfirmationOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">Cancel</button>
                        <button type="button" onClick={removeSelectedCartLines} className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">Remove</button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
};

export default PointOfSale;
