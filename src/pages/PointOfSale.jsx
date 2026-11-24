import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Pagination from '../components/Pagination';
import CartRemovalConfirmation from '../components/CartRemovalConfirmation';
import { DesktopProductGridSkeleton } from '../components/DesktopSkeletons';
import ContextualEmptyState from '../components/ContextualEmptyState';
import { showToast } from '../utils/toastHelper';
import { getPosRecommendationAction, getPosRecommendationAvailability, getPosRecommendationForCartAddition, getStockStatus } from '../utils/recommendationLogic';
import { getPosRecommendationPresentation } from '../utils/recommendationPresentation';
import { setFormValidationErrors } from '../utils/formValidationNavigation';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken } from '../services/apiClient';
import { getProductDisplayName, hasStoredProductName } from '../utils/productDisplayName';
import { createPartnerApi, finalizeSaleWithReferenceApi, listProductsApi, listPartnersApi, listProductExpiryBatchesApi } from '../services/inventoryApi';
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
import { buildQuotationPrintLayout, buildQuotationReceiptModel, downloadWalkInQuotationPdf } from '../utils/quotationReceipt';
import { buildQuotationThermalHeaderLines } from '../utils/quotationThermalHeader';
import { normalizeHumanReadable } from '../utils/textNormalization';
import { createClientRequestId } from '../utils/clientRequestId';
import { getSelectedCartItems, removeSelectedCartItems, toggleAllCartItemSelections, toggleCartItemSelection } from '../utils/cartSelection';
import { ROLES } from '../constants/roles';
import TransactionReferenceModal from '../components/TransactionReferenceModal';
import OrderConfirmationModal from '../components/OrderConfirmationModal';
import FormalPriceQuotationModal from '../components/FormalPriceQuotationModal';
import EvidenceUploadField from '../components/EvidenceUploadField';
import ViewportTooltip from '../components/ViewportTooltip';
import PosNavigationCartIcon from '../components/PosNavigationCartIcon';
import RecordActionIcon from '../components/RecordActionIcon';
import { ExpiryBatchPickEditor } from '../components/ExpiryBatchVerification';
import { isExpiryBatchVerificationConfirmed } from '../utils/expiryBatchVerification';
import ToolbarDropdown from '../components/ToolbarDropdown';
import ProductDetailsModalShell from '../components/ProductDetailsModalShell';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { ORDER_CONFIRMATION_PREVIEW_SIZE } from '../constants/orderConfirmationPreview';
import { getEffectiveProductAttributes, productAttributeValues } from '../utils/productAttributes';
import { formatProductAttributeValue } from '../utils/productFamilies';
import { getProductDetailsSpecifications } from '../utils/productDetailsSpecifications';
import {
    getPosAttributeSelectionModel,
    getPosRemainingAddableQuantity,
    getPosVariantOptionLabel,
    getPosVariantValueKey,
    getPosProductGroupKey,
    getPosProductSelectionGroup,
    groupProductsForPos,
} from '../utils/posVariantSelection';

const getProductImageUrl = (item) => String(item?.imageUrl || '').trim();
const getOrderListVariationDetails = (item, categories) => {
    if (item?.displayNameIsFallback) return '';
    const specifications = getProductDetailsSpecifications(item, categories)
        .filter(({ name }) => name.toLowerCase() !== 'brand');
    const specificationNames = new Set(specifications.map(({ name }) => name.toLowerCase()));
    const additionalSpecifications = [
        ['Color', item?.color],
        ['Size', item?.size],
        ['Volume', item?.volume],
        ['Finish', item?.finish],
        ['Type', item?.type],
    ]
        .filter(([name, value]) => value !== null && value !== undefined && String(value).trim() !== '' && !specificationNames.has(name.toLowerCase()))
        .map(([name, value]) => ({ name, value }));

    return [...specifications, ...additionalSpecifications]
        .map(({ name, value }) => `${name}: ${value}`)
        .join(', ');
};
const CART_ITEM_INTERACTIVE_TARGET_SELECTOR = 'button, a, input, select, textarea, [role="button"], [contenteditable="true"], [data-cart-long-press-disabled]';
const isMobilePosViewport = () => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 767px)').matches;
const isMobileTouchViewport = () => isMobilePosViewport()
    && window.matchMedia('(pointer: coarse)').matches;
const isCartItemInteractiveTarget = (target) => typeof target?.closest === 'function'
    && Boolean(target.closest(CART_ITEM_INTERACTIVE_TARGET_SELECTOR));
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

const isActiveRegularCustomer = (row) => {
    const customerType = String(row?.customerType || 'regular').toLowerCase();
    return row?.type === 'customer' && !row?.isArchived && customerType === 'regular';
};

const getCashChangeCentavos = (cashValue, payableTotal) => {
    const cashCentavos = parseMoneyToCentavos(cashValue);
    const totalCentavos = getMoneyCentavosFromAmount(payableTotal);

    if (cashCentavos === null || totalCentavos === null) return null;
    if (cashCentavos < totalCentavos) return 0;

    return cashCentavos - totalCentavos;
};

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

const ProductThumbnail = ({ item, className = '', onPreview, fit = 'cover', interactive = true }) => {
    const imageUrl = getProductImageUrl(item);
    const [failedImageUrl, setFailedImageUrl] = useState('');
    const imageFailed = Boolean(imageUrl && failedImageUrl === imageUrl);

    const thumbnailClassName = `shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 ${className}`;

    if (imageUrl && !imageFailed) {
        const image = (
            <img
                src={imageUrl}
                alt={item?.name || item?.code || 'Product image'}
                onError={() => setFailedImageUrl(imageUrl)}
                className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
            />
        );

        if (!interactive) {
            return <div aria-hidden="true" className={thumbnailClassName}>{image}</div>;
        }

        return (
            <button
                type="button"
                onClick={(event) => onPreview?.(event, item)}
                className={`${thumbnailClassName} cursor-zoom-in transition-all hover:opacity-90 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-slate-900`}
                aria-label={`Enlarge image for ${item?.name || item?.code || 'product'}`}
            >
                {image}
            </button>
        );
    }

    return (
        <div aria-hidden={!interactive || undefined} className={thumbnailClassName}>
            <div className="flex h-full w-full items-center justify-center">
                <svg className="h-7 w-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2l2-2a3 3 0 014 0l2 2m-14 4h16" />
                </svg>
            </div>
        </div>
    );
};

const PosRecommendationReasons = ({ recommendation }) => {
    const explanation = getPosRecommendationPresentation(recommendation);
    if (!explanation) return null;
    const staffRows = explanation.visible.filter((row) => row.staff);
    const recordedRows = explanation.visible.filter((row) => !row.staff);
    const reasonRow = (row) => <li key={row.key} data-reason-source={row.staff ? 'staff' : 'system'} className="flex min-w-0 items-start gap-1.5">
        <span aria-hidden="true" className={row.kind === 'match' ? 'text-emerald-700' : row.kind === 'warning' ? 'text-amber-700' : 'text-slate-500'}>{row.kind === 'match' ? '✓' : row.kind === 'warning' ? '⚠' : '='}</span>
        <span className="min-w-0 break-words">{row.text}</span>
    </li>;
    return <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-700">
        <p className="font-semibold text-slate-800">Why Recommended?</p>
        {staffRows.length > 0 && <><p className="mt-1 text-[10px] text-slate-500">Staff reasons</p><ul className="mt-0.5 space-y-1" aria-label="Staff recommendation reasons">{staffRows.map(reasonRow)}</ul></>}
        {recordedRows.length > 0 && <><p className="mt-1 text-[10px] text-slate-500">{staffRows.length ? 'Recorded facts and cautions' : 'Recorded facts'}</p><ul className="mt-0.5 space-y-1" aria-label="Recommendation reasons">{recordedRows.map(reasonRow)}</ul></>}
        {explanation.more.length > 0 && <details className="mt-1"><summary className="w-fit cursor-pointer rounded-sm text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700">More details</summary><ul className="mt-1 space-y-1">{explanation.more.map(reasonRow)}</ul></details>}
    </div>;
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
    const orderListGenerationInFlightRef = useRef(false);
    const pendingOrderListAutoPrintRef = useRef(false);
    const {
        processedInventory: sourceInventory,
        categories: categoryDefinitions,
        setInventory,
        setTransactions,
        logAction,
        logActivity,
        addToSyncQueue,
        syncQueue,
        isOnline,
        isInventoryLoading,
        inventoryLoadError,
        retryInventory,
    } = useInventory();
    const { appSettings: settings, currentUserName, currentUserFullName, userRole, userPreferences } = useAuth();
    // POS presents sellable stock; other modules retain the physical quantity.
    const inventory = useMemo(() => sourceInventory.map((item) => {
        const stock = Math.max(0, Number(item.availableToSell ?? (Number(item.stock || 0) - Number(item.reservedStock || 0))));
        const name = getProductDisplayName(item, categoryDefinitions);
        return {
            ...item,
            name,
            displayNameIsFallback: !hasStoredProductName(item),
            physicalStock: item.stock,
            stock,
            status: getStockStatus({ ...item, name, stock }, settings),
        };
    }), [categoryDefinitions, sourceInventory, settings]);
    const isInitialInventoryPending = isInventoryLoading && sourceInventory.length === 0;
    const canQuickAddCreditCustomer = userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN;

    const showErrorDetails = (message, title = 'Action Failed') => {
        showToast(title, message, 'error', 'pos-action-error');
    };

    const showTransactionCompletionToast = (transaction) => {
        const transactionId = String(transaction?.id || '').trim();
        showToast(
            'Transaction Completed',
            transactionId
                ? `Transaction ${transactionId} has been completed successfully.`
                : 'The sale has been recorded successfully.',
            'success',
            'pos-transaction-reference-complete',
            { duration: 4000 }
        );
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
    const [pendingCartRemoval, setPendingCartRemoval] = useState(null);
    const [isMobilePosLayout, setIsMobilePosLayout] = useState(() => isMobilePosViewport());
    const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
    const [isCurrentOrderCollapsed, setIsCurrentOrderCollapsed] = useState(false);
    const [isHeaderCartVisible, setIsHeaderCartVisible] = useState(true);
    const [cartCountFeedback, setCartCountFeedback] = useState(false);
    const cartItemCount = cart.reduce((total, item) => total + item.qty, 0);
    const lastCartCatalogWarningRef = useRef('');
    useEffect(() => {
        if (!sourceInventory.length || cart.length === 0) {
            lastCartCatalogWarningRef.current = '';
            return;
        }

        const changedItems = cart.flatMap((cartItem) => {
            const latest = sourceInventory.find((product) => (
                (cartItem.id && String(product.id || product._id) === String(cartItem.id))
                || String(product.code || '') === String(cartItem.code || '')
            ));
            if (!latest) return [{ code: cartItem.code, state: 'missing' }];

            const latestAvailable = Math.max(0, Number(latest.availableToSell ?? (Number(latest.stock || 0) - Number(latest.reservedStock || 0))));
            const cartAvailable = Number(cartItem.stock ?? cartItem.availableToSell);
            const latestPrice = Number(latest.price ?? latest.unitPrice);
            const cartPrice = Number(cartItem.price ?? cartItem.unitPrice);
            const inactive = latest.isActive === false || latest.isArchived === true;
            const availabilityChanged = Number.isFinite(cartAvailable) && cartAvailable !== latestAvailable;
            const priceChanged = Number.isFinite(latestPrice) && Number.isFinite(cartPrice) && latestPrice !== cartPrice;
            if (!inactive && latestAvailable >= Number(cartItem.qty || 0) && !availabilityChanged && !priceChanged) return [];
            return [{ code: cartItem.code, state: `${inactive ? 'inactive' : 'active'}:${latestAvailable}:${latestPrice}` }];
        });
        const warningSignature = changedItems.map(({ code, state }) => `${code}:${state}`).sort().join('|');
        if (warningSignature && warningSignature !== lastCartCatalogWarningRef.current) {
            showToast('Cart Needs Recheck', 'A product availability or price changed. Review the cart before checkout.', 'warning', `pos-cart-recheck-${warningSignature}`);
        }
        lastCartCatalogWarningRef.current = warningSignature;
    }, [cart, sourceInventory]);
    const cartToggleButtonRef = useRef(null);
    const floatingCartButtonRef = useRef(null);
    const cartDrawerRef = useRef(null);
    const cartDrawerCloseButtonRef = useRef(null);
    const bulkRemoveCancelButtonRef = useRef(null);
    const singleCartRemovalCancelButtonRef = useRef(null);
    const singleCartRemovalTriggerRef = useRef(null);
    const singleCartRemovalLockedRef = useRef(false);
    const cartDrawerRestoreFocusRef = useRef(true);
    const cartLongPressTimerRef = useRef(null);
    const cartLongPressTouchRef = useRef(null);
    const suppressedCartClickRef = useRef(null);
    const suppressedCartClickTimerRef = useRef(null);
    const cartCountFeedbackTimerRef = useRef(null);
    const previousCartItemCountRef = useRef(cartItemCount);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [recommendationModal, setRecommendationModal] = useState({ isOpen: false, item: null, alternatives: [], budgetOptions: null, kind: 'alternative' }); // Recommendation Modal State
    const recommendationAddInProgressRef = useRef(false);
    const [recommendationQuantities, setRecommendationQuantities] = useState({});
    const recommendationDialogRef = useRef(null);
    const recommendationCloseButtonRef = useRef(null);
    const recommendationReturnFocusRef = useRef(null);
    const [productDetailsItem, setProductDetailsItem] = useState(null);
    const productDetailsDialogRef = useRef(null);
    const productDetailsCloseButtonRef = useRef(null);
    const productDetailsTriggerRef = useRef(null);
    const returnFocusToProductDetailsTriggerRef = useRef(false);
    
    // Payment State
    const [paymentType, setPaymentType] = useState('cash');
    const [cashAmount, setCashAmount] = useState(''); // Use string for input handling
    const [selectedVatMode, setSelectedVatMode] = useState('vatable');
    const [, setRegularCustomers] = useState([]);
    const [creditCustomers, setCreditCustomers] = useState([]);
    const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState('');
    const creditCustomerRequestSequenceRef = useRef(0);
    const selectedCreditCustomerIdRef = useRef(selectedCreditCustomerId);
    selectedCreditCustomerIdRef.current = selectedCreditCustomerId;
    const [creditCustomerSearchQuery, setCreditCustomerSearchQuery] = useState('');
    const [isCreditCustomerComboboxOpen, setIsCreditCustomerComboboxOpen] = useState(false);
    const [highlightedCreditCustomerIndex, setHighlightedCreditCustomerIndex] = useState(-1);
    const [isQuickAddCreditCustomerOpen, setIsQuickAddCreditCustomerOpen] = useState(false);
    const [quickAddCreditCustomerName, setQuickAddCreditCustomerName] = useState('');
    const [isSavingQuickAddCreditCustomer, setIsSavingQuickAddCreditCustomer] = useState(false);
    const [selectedCreditTermDays, setSelectedCreditTermDays] = useState(MIN_CREDIT_TERM_DAYS);
    const [selectedCreditPaymentMode, setSelectedCreditPaymentMode] = useState('');
    const [customCreditPaymentMode, setCustomCreditPaymentMode] = useState('');
    const [downPaymentAmount, setDownPaymentAmount] = useState('');
    const [downPaymentProofFiles, setDownPaymentProofFiles] = useState([]);
    const [isCheckoutProcessing, setIsCheckoutProcessing] = useState(false);
    const checkoutInFlightRef = useRef(false);
    
    // Quotation State
    const [showQuotationPreview, setShowQuotationPreview] = useState(false);
    const [quotationData, setQuotationData] = useState(null);
    // Regular-customer quotations now belong to Special Orders. These inert values
    // keep legacy modal markup unreachable while it is removed in a later UI cleanup.
    const showQuotationCustomerSelector = false;
    const showQuotationDetails = false;
    const selectedQuotationCustomer = null;
    const quotationCustomerQuery = '';
    const quotationDetails = {};
    const filteredQuotationCustomers = [];
    const hasQuotationSignatoryName = false;
    const quotationType = 'walk_in';
    const formalQuotationData = null;
    const setShowQuotationCustomerSelector = () => {};
    const setShowQuotationDetails = () => {};
    const setQuotationCustomerQuery = () => {};
    const setQuotationDetails = () => {};
    const setFormalQuotationData = () => {};
    const openQuotationDetails = () => {};
    const returnToQuotationCustomerSelector = () => {};
    const previewFormalQuotation = () => {};

    // Receipt Modal State
    const [showReceipt, setShowReceipt] = useState(false);
    const [lastTransaction, setLastTransaction] = useState(null);
    const [checkoutDraft, setCheckoutDraft] = useState(null);
    const [checkoutReferenceDraft, setCheckoutReferenceDraft] = useState({ referenceNumber: '', documentFile: null });
    const [checkoutPhase, setCheckoutPhase] = useState(null);
    const [checkoutOpenedAt, setCheckoutOpenedAt] = useState('');
    const [posBatchPickData, setPosBatchPickData] = useState({});
    const [posBatchVerificationRecords, setPosBatchVerificationRecords] = useState({});
    const [posBatchPickLoading, setPosBatchPickLoading] = useState(false);
    const [posBatchPickError, setPosBatchPickError] = useState('');

    const [posBatchRefreshNonce, setPosBatchRefreshNonce] = useState(0);
    const expiryTrackedCartItems = useMemo(() => cart.filter((item) => item.expiryTrackingEnabled === true), [cart]);
    const posBatchVerificationItems = useMemo(() => expiryTrackedCartItems.map((item) => {
        const productKey = String(item.id || item.code);
        const data = posBatchPickData[productKey];
        return {
            productId: String(item.id || ''),
            productKey,
            name: item.name,
            sku: item.code,
            quantity: Number(item.qty || 0),
            unit: item.sellingUnit || '',
            loading: posBatchPickLoading && !data,
            error: data?.error || (!item.id ? 'This cart item has no current product ID. Refresh the catalog before proceeding.' : ''),
            reconciled: Boolean(data?.reconciled),
            provisional: Boolean(data?.provisional),
            proposedAllocations: data?.proposedAllocations || null,
            batchOptions: data?.batchOptions || [],
            productStock: data?.productStock,
            productReserved: data?.productReserved,
        };
    }), [expiryTrackedCartItems, posBatchPickData, posBatchPickLoading]);

    useEffect(() => {
        if (checkoutPhase !== 'order-list') return undefined;
        const tracked = cart.filter((item) => item.expiryTrackingEnabled === true);
        if (!tracked.length) {
            setPosBatchPickData({});
            setPosBatchVerificationRecords({});
            setPosBatchPickError('');
            setPosBatchPickLoading(false);
            return undefined;
        }
        let cancelled = false;
        setPosBatchPickData({});
        setPosBatchVerificationRecords({});
        setPosBatchPickError('');
        setPosBatchPickLoading(true);
        Promise.all(tracked.map(async (item) => {
            const key = String(item.id || item.code);
            if (!item.id) return [key, { error: 'This cart item has no current product ID.' }];
            try {
                const result = await listProductExpiryBatchesApi(item.id, item.qty);
                return [key, result];
            } catch (error) {
                return [key, { error: error?.message || 'Unable to check batches.' }];
            }
        })).then((entries) => {
            if (cancelled) return;
            setPosBatchPickData(Object.fromEntries(entries));
            const failed = entries.find(([, result]) => result?.error);
            if (failed) setPosBatchPickError('Unable to load batch picks. Refresh the Order List and try again.');
        }).finally(() => {
            if (!cancelled) setPosBatchPickLoading(false);
        });
        return () => { cancelled = true; };
    }, [checkoutPhase, cart, posBatchRefreshNonce]);

    useEffect(() => {
        if (checkoutPhase !== 'order-list' || expiryTrackedCartItems.length === 0) return undefined;
        let refreshTimer = null;
        const relevantCodes = new Set(expiryTrackedCartItems.map((item) => String(item.code || '').toUpperCase()));
        const scheduleBatchRefresh = (event) => {
            if (event?.type === 'inventory.updated') {
                try {
                    const payload = JSON.parse(event.data || '{}');
                    const changedCodes = Array.isArray(payload.productCodes) ? payload.productCodes.map((code) => String(code || '').toUpperCase()) : [];
                    if (changedCodes.length && !changedCodes.some((code) => relevantCodes.has(code))) return;
                } catch {
                    // Refresh conservatively if the event payload cannot be inspected.
                }
            }
            if (refreshTimer) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                setPosBatchRefreshNonce((value) => value + 1);
            }, 80);
        };
        const unsubscribeInventory = subscribeRealtimeEvent('inventory.updated', scheduleBatchRefresh);
        const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', scheduleBatchRefresh);
        return () => {
            if (refreshTimer) window.clearTimeout(refreshTimer);
            unsubscribeInventory();
            unsubscribeResync();
        };
    }, [checkoutPhase, expiryTrackedCartItems]);

    useEffect(() => {
        if (checkoutPhase !== 'order-list') {
            orderListGenerationInFlightRef.current = false;
        }
    }, [checkoutPhase]);

    const creditCustomerComboboxRef = useRef(null);
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

    const createClosedVariantModalState = () => ({
        isOpen: false,
        group: null,
        step: 'brand',
        selectedBrand: null,
        selectedAttributes: {},
        selectedVariantCode: null,
        selectedVariantId: null,
        quantity: 1,
    });
    const createOpenVariantModalState = (group) => ({
        isOpen: true,
        group,
        step: group?.brandOptions?.length > 1 ? 'brand' : 'variants',
        selectedBrand: null,
        selectedAttributes: {},
        selectedVariantCode: null,
        selectedVariantId: null,
        quantity: 1,
    });
    const [variantModal, setVariantModal] = useState(createClosedVariantModalState);
    const [isVariantAddProcessing, setIsVariantAddProcessing] = useState(false);
    const variantAddInProgressRef = useRef(false);
    const variantAddPendingRef = useRef(null);

    useEffect(() => {
        const pendingAdd = variantAddPendingRef.current;
        if (!pendingAdd) return;

        const addedItem = cart.find((item) => item.code === pendingAdd.code);
        if (Number(addedItem?.qty || 0) !== pendingAdd.expectedQuantity) return;

        setVariantModal((previous) => previous.isOpen ? { ...previous, quantity: 1 } : previous);
        variantAddPendingRef.current = null;
        variantAddInProgressRef.current = false;
        setIsVariantAddProcessing(false);
    }, [cart]);

    const variantModalSelectedVariant = useMemo(() => {
        if (!variantModal.isOpen || !variantModal.group || variantModal.step !== 'variants') return null;

        const variants = variantModal.group.variants.filter((variant) => (
            !variantModal.selectedBrand || getPosVariantValueKey(variant, 'brand') === variantModal.selectedBrand
        ));
        return getPosAttributeSelectionModel(
            variants, variantModal.group.attributeDefinitions, variantModal.selectedAttributes,
            variantModal.selectedVariantCode ? { code: variantModal.selectedVariantCode, id: variantModal.selectedVariantId } : null
        ).matchedVariant;
    }, [variantModal]);

    const variantModalImageItem = useMemo(() => {
        if (!variantModal.isOpen || !variantModal.group) return null;

        const variants = variantModal.group.variants.filter((variant) => (
            !variantModal.selectedBrand || getPosVariantValueKey(variant, 'brand') === variantModal.selectedBrand
        ));
        const brandRepresentative = variants.find((variant) => getProductImageUrl(variant)) || null;

        return variantModalSelectedVariant || brandRepresentative;
    }, [variantModal, variantModalSelectedVariant]);

    const productDetailsSpecifications = useMemo(
        () => getProductDetailsSpecifications(productDetailsItem, categoryDefinitions),
        [categoryDefinitions, productDetailsItem]
    );

    useEffect(() => {
        if (!productDetailsItem || !returnFocusToProductDetailsTriggerRef.current || enlargedProductImage) return undefined;

        const closeButton = productDetailsCloseButtonRef.current;
        closeButton?.focus();
        const handleDetailsKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setProductDetailsItem(null);
                return;
            }
            if (event.key !== 'Tab') return;

            const controls = [...(productDetailsDialogRef.current?.querySelectorAll(
                'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
            ) || [])].filter((control) => control.getClientRects().length > 0);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };

        window.addEventListener('keydown', handleDetailsKeyDown);
        return () => window.removeEventListener('keydown', handleDetailsKeyDown);
    }, [productDetailsItem, enlargedProductImage]);

    useEffect(() => {
        if (productDetailsItem || !returnFocusToProductDetailsTriggerRef.current) return undefined;
        returnFocusToProductDetailsTriggerRef.current = false;
        const frameId = window.requestAnimationFrame(() => productDetailsTriggerRef.current?.focus());
        return () => window.cancelAnimationFrame(frameId);
    }, [productDetailsItem]);

    useEffect(() => {
        if (recommendationModal.isOpen) {
            const frameId = window.requestAnimationFrame(() => recommendationCloseButtonRef.current?.focus());
            return () => window.cancelAnimationFrame(frameId);
        }

        const returnFocusTarget = recommendationReturnFocusRef.current;
        recommendationReturnFocusRef.current = null;
        if (!returnFocusTarget?.isConnected) return undefined;
        const frameId = window.requestAnimationFrame(() => returnFocusTarget.focus?.({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frameId);
    }, [recommendationModal.isOpen]);

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

    const clearProductFilters = () => {
        setSearchQuery('');
        setSelectedCategory('All');
    };
    const activeSellableProductCount = inventory.filter((item) => !item.isArchived && item.isActive !== false).length;
    const posEmptyState = inventoryLoadError && sourceInventory.length === 0
        ? { title: 'Products unavailable', description: 'Products could not be loaded. Please try again.', actionLabel: 'Retry', onAction: retryInventory }
        : (searchQuery.trim() || selectedCategory !== 'All') && activeSellableProductCount > 0
            ? { title: 'No matching results', description: 'Try a different search or filter.', actionLabel: 'Clear Filters', onAction: clearProductFilters }
            : { title: 'No products available', description: 'There are no active products available for sale.' };

    const activePosGroups = useMemo(() => groupProductsForPos(
        inventory.filter((item) => !item.isArchived && item.isActive !== false), categoryDefinitions
    ).map((item) => item.isGroup ? item : {
        ...item,
        isGroup: true,
        groupKey: getPosProductGroupKey(item),
        variants: [item],
        brandOptions: [],
        attributeDefinitions: getEffectiveProductAttributes(categoryDefinitions.find((category) => category.name === item.category)),
    }), [inventory, categoryDefinitions]);
    const openVariantGroup = (item) => setVariantModal(createOpenVariantModalState(
        activePosGroups.find((group) => group.isGroup && group.groupKey === item.groupKey) || item
    ));

    const viewedOptionGroup = useMemo(() => variantModal.selectionProduct
        ? getPosProductSelectionGroup(variantModal.selectionProduct, inventory, categoryDefinitions)
        : null, [variantModal.selectionProduct, inventory, categoryDefinitions]);

    useEffect(() => {
        if (variantModal.selectionProduct) {
            if (!viewedOptionGroup) setVariantModal(createClosedVariantModalState());
            else if (viewedOptionGroup !== variantModal.group) setVariantModal((previous) => ({ ...previous, group: viewedOptionGroup }));
            return;
        }
        if (!variantModal.isOpen || !variantModal.group?.groupKey) return;

        const refreshedGroup = activePosGroups.find((item) => (
            item.isGroup && item.groupKey === variantModal.group.groupKey
        ));
        if (!refreshedGroup) {
            setVariantModal((previous) => previous.group?.groupKey === variantModal.group.groupKey && !previous.selectionProduct
                ? createClosedVariantModalState() : previous);
            return;
        }
        if (refreshedGroup !== variantModal.group) {
            setVariantModal((previous) => {
                if (!previous.isOpen || previous.selectionProduct || previous.group?.groupKey !== refreshedGroup.groupKey
                    || previous.group === refreshedGroup) return previous;
                const selectedSku = previous.selectedVariantCode
                    ? { code: previous.selectedVariantCode, id: previous.selectedVariantId } : null;
                const brandVariants = (group) => group.variants.filter((item) => (
                    !previous.selectedBrand || getPosVariantValueKey(item, 'brand') === previous.selectedBrand
                ));
                const oldSelection = getPosAttributeSelectionModel(
                    brandVariants(previous.group), previous.group.attributeDefinitions,
                    previous.selectedAttributes, selectedSku
                ).matchedVariant;
                const nextModel = getPosAttributeSelectionModel(
                    brandVariants(refreshedGroup), refreshedGroup.attributeDefinitions,
                    previous.selectedAttributes, selectedSku
                );
                // Keep the cashier's latest resolved identity, even when a new
                // sibling makes its attributes ambiguous. Never replace a SKU.
                const previousIdentity = oldSelection || selectedSku;
                const retainedSelection = previousIdentity && nextModel.candidates.find((item) => (
                    item.code === previousIdentity.code && String(item.id) === String(previousIdentity.id)
                ));
                if (previousIdentity && !retainedSelection) return createClosedVariantModalState();
                return { ...previous,
                    group: refreshedGroup,
                    selectedAttributes: nextModel.selections,
                    selectedVariantCode: retainedSelection?.code || previous.selectedVariantCode,
                    selectedVariantId: retainedSelection?.id || previous.selectedVariantId,
                };
            });
        }
    }, [activePosGroups, variantModal.isOpen, variantModal.group, variantModal.selectionProduct, viewedOptionGroup]);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchQuery, selectedCategory]);

    useEffect(() => {
        if (cart.length === 0) {
            if (cashAmount !== '') setCashAmount('');
            if (downPaymentAmount !== '') setDownPaymentAmount('');
            if (downPaymentProofFiles.length) setDownPaymentProofFiles([]);
        }
    }, [cart.length, cashAmount, downPaymentAmount, downPaymentProofFiles.length]);

    useEffect(() => {
        let isMounted = true;
        let inFlight = false;
        let refreshPending = false;
        const loadEligibleCreditCustomers = async () => {
            if (inFlight) {
                refreshPending = true;
                return;
            }
            inFlight = true;
            const requestId = ++creditCustomerRequestSequenceRef.current;
            try {
                const rows = await listPartnersApi({ type: 'customer', includeArchived: false });
                if (!isMounted || requestId !== creditCustomerRequestSequenceRef.current) return;

                const activeRegularCustomers = (Array.isArray(rows) ? rows : []).filter(isActiveRegularCustomer);
                const eligible = activeRegularCustomers.filter(isEligibleCreditCustomer);
                const selectedId = String(selectedCreditCustomerIdRef.current || '');
                setRegularCustomers(activeRegularCustomers);
                setCreditCustomers(eligible);

                if (selectedId && !eligible.some((customer) => String(customer?._id || customer?.id || '') === selectedId)) {
                    setSelectedCreditCustomerId('');
                    showToast('Customer Needs Recheck', 'The selected customer is no longer eligible for credit checkout.', 'warning', 'pos-credit-customer-inactive');
                }
            } catch {
                // Keep the last known options and selection on transient refresh failures.
            } finally {
                inFlight = false;
                if (refreshPending && isMounted) {
                    refreshPending = false;
                    void loadEligibleCreditCustomers();
                }
            }
        };

        void loadEligibleCreditCustomers();
        const unsubscribePartners = subscribeRealtimeEvent('partners.updated', loadEligibleCreditCustomers);
        const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', loadEligibleCreditCustomers);

        return () => {
            isMounted = false;
            creditCustomerRequestSequenceRef.current += 1;
            unsubscribePartners();
            unsubscribeResync();
        };
    }, []);

    const parsedCreditTermDays = useMemo(() => {
        if (!isWholeNumberInput(selectedCreditTermDays, {
            min: MIN_CREDIT_TERM_DAYS,
            max: MAX_CREDIT_TERM_DAYS,
        })) {
            return null;
        }

        return Number(selectedCreditTermDays);
    }, [selectedCreditTermDays]);

    const creditInvoiceDate = useMemo(() => {
        const checkoutDate = checkoutOpenedAt ? new Date(checkoutOpenedAt) : new Date();
        return Number.isNaN(checkoutDate.getTime()) ? new Date() : checkoutDate;
    }, [checkoutOpenedAt]);

    const computedCreditDueDate = useMemo(() => {
        if (parsedCreditTermDays === null) return null;

        const base = new Date(creditInvoiceDate);
        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + parsedCreditTermDays);
        return base;
    }, [creditInvoiceDate, parsedCreditTermDays]);

    const selectedCreditCustomer = useMemo(() => {
        return creditCustomers.find((row) => String(row?._id || row?.id || '') === String(selectedCreditCustomerId || '')) || null;
    }, [creditCustomers, selectedCreditCustomerId]);

    const filteredCreditCustomers = useMemo(() => {
        const normalizedQuery = String(creditCustomerSearchQuery || '').trim().toLowerCase();
        if (!normalizedQuery) return creditCustomers;
        return creditCustomers.filter((customer) => String(customer?.name || '').toLowerCase().includes(normalizedQuery));
    }, [creditCustomers, creditCustomerSearchQuery]);

    useEffect(() => {
        if (!isCreditCustomerComboboxOpen || filteredCreditCustomers.length === 0) {
            setHighlightedCreditCustomerIndex(-1);
            return;
        }

        setHighlightedCreditCustomerIndex((currentIndex) => (
            currentIndex >= 0 && currentIndex < filteredCreditCustomers.length ? currentIndex : -1
        ));
    }, [filteredCreditCustomers, isCreditCustomerComboboxOpen]);

    useEffect(() => {
        if (!isCreditCustomerComboboxOpen || highlightedCreditCustomerIndex < 0) return;
        creditCustomerComboboxRef.current
            ?.querySelector(`[data-customer-index="${highlightedCreditCustomerIndex}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [highlightedCreditCustomerIndex, isCreditCustomerComboboxOpen]);

    const selectCreditCustomer = (customer) => {
        const customerId = String(customer?._id || customer?.id || '');
        const customerName = String(customer?.name || '').trim();
        if (customerId !== selectedCreditCustomerId) setDownPaymentProofFiles([]);
        setSelectedCreditCustomerId(customerId);
        setCreditCustomerSearchQuery(customerName);
        setIsCreditCustomerComboboxOpen(false);
        setHighlightedCreditCustomerIndex(-1);
    };

    const clearCreditCustomerSelection = () => {
        setDownPaymentProofFiles([]);
        setSelectedCreditCustomerId('');
        setCreditCustomerSearchQuery('');
        setHighlightedCreditCustomerIndex(-1);
    };

    const handleCreditCustomerKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setIsCreditCustomerComboboxOpen(false);
            setHighlightedCreditCustomerIndex(-1);
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIsCreditCustomerComboboxOpen(true);
            setHighlightedCreditCustomerIndex((currentIndex) => {
                if (filteredCreditCustomers.length === 0) return -1;
                if (event.key === 'ArrowDown') {
                    return currentIndex < filteredCreditCustomers.length - 1 ? currentIndex + 1 : 0;
                }
                return currentIndex > 0 ? currentIndex - 1 : filteredCreditCustomers.length - 1;
            });
            return;
        }

        if (event.key === 'Enter' && isCreditCustomerComboboxOpen && highlightedCreditCustomerIndex >= 0) {
            event.preventDefault();
            const highlightedCustomer = filteredCreditCustomers[highlightedCreditCustomerIndex];
            if (highlightedCustomer) selectCreditCustomer(highlightedCustomer);
        }
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
            setFormValidationErrors(event.currentTarget, { customerName: 'Enter the customer name.' });
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
            const activeRegularCustomers = (Array.isArray(refreshedCustomers) ? refreshedCustomers : []).filter(isActiveRegularCustomer);
            const eligibleCustomers = activeRegularCustomers.filter(isEligibleCreditCustomer);
            setRegularCustomers(activeRegularCustomers);
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

    const handleCreditTermInputChange = (value) => {
        setSelectedCreditTermDays(sanitizeWholeNumberInput(value));
    };

    const incrementCreditTerm = () => {
        setSelectedCreditTermDays((previousValue) => {
            if (previousValue === '') return MIN_CREDIT_TERM_DAYS;
            if (!isWholeNumberInput(previousValue, { min: MIN_CREDIT_TERM_DAYS, max: MAX_CREDIT_TERM_DAYS })) {
                return previousValue;
            }
            return Math.min(MAX_CREDIT_TERM_DAYS, Number(previousValue) + 1);
        });
    };

    const decrementCreditTerm = () => {
        setSelectedCreditTermDays((previousValue) => {
            if (!isWholeNumberInput(previousValue, { min: MIN_CREDIT_TERM_DAYS, max: MAX_CREDIT_TERM_DAYS })) {
                return previousValue;
            }
            return Math.max(MIN_CREDIT_TERM_DAYS, Number(previousValue) - 1);
        });
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

    const closeRecommendationModal = () => {
        setRecommendationModal({ isOpen: false, item: null, alternatives: [], budgetOptions: null });
        setRecommendationQuantities({});
    };

    const getCartAdditionResult = (previousCart, product, requestedQty) => {
        const existingItem = previousCart.find(item => item.code === product.code);
        const currentQtyInCart = existingItem ? existingItem.qty : 0;
        if (currentQtyInCart + requestedQty > product.stock) {
            return { ok: false, error: `Only ${product.stock} units available!` };
        }

        const nextCart = existingItem
            ? previousCart.map(item => item.code === product.code
                ? { ...item, qty: item.qty + requestedQty }
                : item)
            : [...previousCart, { ...product, qty: requestedQty }];
        return { ok: true, cart: nextCart };
    };

    const addToCart = (product, forceAdd = false, options = {}) => {
        const silentNotification = Boolean(options?.silentNotification);
        const requestedQty = Math.max(1, Math.floor(Number(options?.quantity) || 1));
        if (!forceAdd) {
            if (product.stock <= 0) {
                const availability = getPosRecommendationAvailability(product, inventory, settings, { categories: categoryDefinitions, cart });
                if (availability.hasAny) {
                    recommendationAddInProgressRef.current = false;
                    setRecommendationQuantities({});
                    recommendationReturnFocusRef.current = document.activeElement;
                    setRecommendationModal({ isOpen: true, item: product, alternatives: availability.alternatives, budgetOptions: null, type: 'out-of-stock', kind: 'alternative' });
                } else {
                    showToast('No Alternatives', 'No alternatives found for this item.', 'info', 'pos-budget-no-alternatives');
                }
                return;
            }
        }

        if (options?.fromVariantModal) {
            const result = getCartAdditionResult(cart, product, requestedQty);
            if (!result.ok) {
                showErrorDetails(result.error);
                return false;
            }
            setCart(result.cart);
        } else {
            setCart(prevCart => {
                const result = getCartAdditionResult(prevCart, product, requestedQty);
                if (!result.ok) {
                    showErrorDetails(result.error);
                    return prevCart;
                }
                return result.cart;
            });
        }

        if (forceAdd) {
            closeRecommendationModal();
            if (!silentNotification) {
                showToast("Item Added", "Item added to cart.", "success", "pos-add-cart");
            }
        }
        return true;
    };

    const addRecommendedAlternativeToCart = (alternative, requestedQuantity = 1) => {
        if (recommendationAddInProgressRef.current) return;
        const result = getPosRecommendationForCartAddition({
            targetCode: recommendationModal.item?.code,
            targetId: recommendationModal.item?.id,
            candidateCode: alternative.code,
            candidateId: alternative.id,
            inventory,
            cart,
            settings,
            categories: categoryDefinitions,
            requestedQuantity,
        });
        if (!result.ok) {
            showErrorDetails(result.error);
            return;
        }
        recommendationAddInProgressRef.current = true;
        const added = addToCart(result.product, true, {
            quantity: requestedQuantity,
            fromVariantModal: true,
        });
        if (!added) recommendationAddInProgressRef.current = false;
    };

    const getRecommendationResults = (product, options = {}) => {
        return getPosRecommendationAvailability(product, inventory, settings, { categories: categoryDefinitions, cart, ...options });
    };

    const updateRecommendationQuantity = (product, rawValue) => {
        const safeValue = sanitizeWholeNumberInput(rawValue);
        const maxQuantity = getPosRemainingAddableQuantity(product, cart);
        const parsed = Number(safeValue);
        const quantity = isWholeNumberInput(safeValue, { min: 1 })
            ? Math.min(maxQuantity, parsed)
            : 1;
        setRecommendationQuantities((previous) => ({ ...previous, [product.code]: Math.max(1, quantity) }));
    };

    const openRecommendationResults = (product, kind, options = {}) => {
        const requestedQuantity = options.requestedQuantity || product.requestedRecommendationQuantity || 1;
        const availability = getRecommendationResults(product, { requestedQuantity });
        if (!availability.hasAny) {
            showToast('No Alternatives', 'No alternatives found for this item.', 'info', 'pos-budget-no-alternatives');
            return;
        }

        const status = getStockStatus(product, settings);
        const type = options.type || (status === 'Out of Stock' ? 'out-of-stock' : status === 'Low Stock' ? 'low-stock' : 'in-stock');
        recommendationAddInProgressRef.current = false;
        setRecommendationQuantities({});
        recommendationReturnFocusRef.current = document.activeElement;
        setRecommendationModal({
            isOpen: true,
            item: product,
            alternatives: availability.alternatives,
            budgetOptions: null,
            type,
            kind,
            requestedQuantity,
        });
    };

    const openAvailableRecommendations = (product, availability, options = {}) => {
        const action = getPosRecommendationAction(availability);
        if (action) openRecommendationResults(product, action, options);
    };

    const activeRecommendationTarget = recommendationModal.isOpen
        ? inventory.find((item) => item.code === recommendationModal.item?.code && item.id === recommendationModal.item?.id)
        : null;
    const liveRecommendationOptions = activeRecommendationTarget
        ? getRecommendationResults(activeRecommendationTarget, { requestedQuantity: recommendationModal.requestedQuantity || 1 })
        : { alternatives: [], otherOptions: [], hasAny: false };

    const removeFromCart = (code) => {
        setCart(prevCart => prevCart.filter(item => item.code !== code));
    };

    const requestSingleCartRemoval = (item, event) => {
        if (!item || singleCartRemovalLockedRef.current) return;
        singleCartRemovalLockedRef.current = true;
        singleCartRemovalTriggerRef.current = event?.currentTarget || document.activeElement;
        setPendingCartRemoval({ code: item.code, item });
    };

    const closeSingleCartRemoval = () => {
        if (!pendingCartRemoval || !singleCartRemovalLockedRef.current) return;
        singleCartRemovalLockedRef.current = false;
        setPendingCartRemoval(null);
        const trigger = singleCartRemovalTriggerRef.current;
        window.requestAnimationFrame(() => {
            if (trigger?.isConnected) trigger.focus?.();
            singleCartRemovalTriggerRef.current = null;
        });
    };

    const confirmSingleCartRemoval = () => {
        if (!pendingCartRemoval || !singleCartRemovalLockedRef.current) return;
        const { code } = pendingCartRemoval;
        setCart((previousCart) => previousCart.filter((item) => item.code !== code));
        setPendingCartRemoval(null);
        window.requestAnimationFrame(() => {
            const nextRemoveButton = [...document.querySelectorAll('[data-pos-cart-item-remove]')]
                .find((button) => button.getClientRects().length > 0);
            const fallbackFocusTarget = isCartDrawerOpen && isMobilePosLayout
                ? cartDrawerCloseButtonRef.current
                : document.getElementById('pos-current-order-title');
            (nextRemoveButton || fallbackFocusTarget || cartToggleButtonRef.current)?.focus?.();
            singleCartRemovalTriggerRef.current = null;
            singleCartRemovalLockedRef.current = false;
        });
    };

    const handleSingleCartRemovalDialogKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeSingleCartRemoval();
            return;
        }
        if (event.key !== 'Tab') return;

        const cancelButton = singleCartRemovalCancelButtonRef.current;
        const removeButton = event.currentTarget.querySelector('[data-confirm-cart-removal]');
        if (event.shiftKey && document.activeElement === cancelButton) {
            event.preventDefault();
            removeButton?.focus();
        } else if (!event.shiftKey && document.activeElement === removeButton) {
            event.preventDefault();
            cancelButton?.focus();
        }
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

    const cancelCartItemLongPress = () => {
        if (cartLongPressTimerRef.current !== null) {
            window.clearTimeout(cartLongPressTimerRef.current);
            cartLongPressTimerRef.current = null;
        }
        cartLongPressTouchRef.current = null;
    };

    const handleCartItemTouchStart = (event, code) => {
        cancelCartItemLongPress();
        if (!isMobileTouchViewport() || event.touches.length !== 1 || isCartItemInteractiveTarget(event.target)) return;

        if (suppressedCartClickTimerRef.current !== null) {
            window.clearTimeout(suppressedCartClickTimerRef.current);
            suppressedCartClickTimerRef.current = null;
        }
        suppressedCartClickRef.current = null;

        const touch = event.touches[0];
        const gesture = { code, startX: touch.clientX, startY: touch.clientY, fired: false };
        cartLongPressTouchRef.current = gesture;
        cartLongPressTimerRef.current = window.setTimeout(() => {
            if (cartLongPressTouchRef.current !== gesture) return;

            gesture.fired = true;
            setIsCartSelectionMode(true);
            toggleCartSelection(code);

            const suppression = { code, expiresAt: Date.now() + 750 };
            suppressedCartClickRef.current = suppression;
            suppressedCartClickTimerRef.current = window.setTimeout(() => {
                if (suppressedCartClickRef.current === suppression) suppressedCartClickRef.current = null;
                suppressedCartClickTimerRef.current = null;
            }, 750);
        }, 500);
    };

    const handleCartItemTouchMove = (event, code) => {
        const gesture = cartLongPressTouchRef.current;
        if (!gesture || gesture.code !== code) return;
        if (event.touches.length !== 1) {
            cancelCartItemLongPress();
            return;
        }

        const touch = event.touches[0];
        const deltaX = touch.clientX - gesture.startX;
        const deltaY = touch.clientY - gesture.startY;
        if (Math.hypot(deltaX, deltaY) > 12) cancelCartItemLongPress();
    };

    const handleCartItemTouchEnd = () => {
        cancelCartItemLongPress();
    };

    const handleCartItemClick = (event, code) => {
        const suppression = suppressedCartClickRef.current;
        if (suppression) {
            suppressedCartClickRef.current = null;
            if (suppressedCartClickTimerRef.current !== null) {
                window.clearTimeout(suppressedCartClickTimerRef.current);
                suppressedCartClickTimerRef.current = null;
            }
            if (suppression.code === code && Date.now() <= suppression.expiresAt) {
                event.preventDefault();
                return;
            }
        }

        if (isCartSelectionMode) {
            toggleCartSelection(code);
            return;
        }

        const item = cart.find((cartItem) => cartItem.code === code);
        if (item) {
            productDetailsTriggerRef.current = event.currentTarget;
            returnFocusToProductDetailsTriggerRef.current = true;
            setProductDetailsItem(item);
        }
    };

    const handleCartItemKeyDown = (event, item) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;

        event.preventDefault();
        if (isCartSelectionMode) {
            toggleCartSelection(item.code);
            return;
        }

        productDetailsTriggerRef.current = event.currentTarget;
        returnFocusToProductDetailsTriggerRef.current = true;
        setProductDetailsItem(item);
    };

    const preventMobileCartCardSelection = (event) => {
        if (isMobileTouchViewport() && !isCartItemInteractiveTarget(event.target)) event.preventDefault();
    };

    const openCartDrawer = () => {
        cartDrawerRestoreFocusRef.current = true;
        setIsCartDrawerOpen(true);
    };

    const closeCartDrawer = ({ restoreFocus = true } = {}) => {
        cartDrawerRestoreFocusRef.current = restoreFocus;
        setIsCartDrawerOpen(false);
    };

    const runCartAction = (action) => {
        if (isCartDrawerOpen) closeCartDrawer({ restoreFocus: false });
        action();
    };

    const handleCartDrawerKeyDown = (event) => {
        if (isBulkRemoveConfirmationOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeCartDrawer();
            return;
        }
        if (event.key !== 'Tab') return;

        const controls = [...(cartDrawerRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])]
            .filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    };

    const toggleAllCartSelections = () => {
        setSelectedCartItemCodes((previousCodes) => toggleAllCartItemSelections(previousCodes, cart));
    };

    const removeSelectedCartLines = () => {
        setCart((previousCart) => removeSelectedCartItems(previousCart, selectedCartItemCodes));
        exitCartSelectionMode({ restoreFocus: true });
    };

    const requestBulkRemove = () => {
        if (selectedCartItemCount === 0) return;
        setIsBulkRemoveConfirmationOpen(true);
    };

    const handlePaymentTypeChange = (nextPaymentType) => {
        setPaymentType(nextPaymentType);
        if (nextPaymentType !== 'credit') setDownPaymentProofFiles([]);
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
        const mobileQuery = window.matchMedia('(max-width: 767px)');
        const syncViewport = () => {
            const isMobile = mobileQuery.matches;
            setIsMobilePosLayout(isMobile);
            if (!isMobile) {
                cartDrawerRestoreFocusRef.current = false;
                setIsCartDrawerOpen(false);
            }
        };
        syncViewport();
        if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', syncViewport);
        else mobileQuery.addListener?.(syncViewport);
        return () => {
            if (mobileQuery.removeEventListener) mobileQuery.removeEventListener('change', syncViewport);
            else mobileQuery.removeListener?.(syncViewport);
        };
    }, []);

    useEffect(() => {
        if (!isMobilePosLayout) {
            setIsHeaderCartVisible(true);
            return undefined;
        }

        const headerCartButton = cartToggleButtonRef.current;
        if (!headerCartButton || typeof IntersectionObserver === 'undefined') {
            setIsHeaderCartVisible(true);
            return undefined;
        }

        const observer = new IntersectionObserver(([entry]) => {
            setIsHeaderCartVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio > 0));
        }, { threshold: 0 });
        observer.observe(headerCartButton);
        return () => observer.disconnect();
    }, [isMobilePosLayout]);

    useEffect(() => {
        if (!isCartDrawerOpen || !isMobilePosLayout) return undefined;

        const previousBodyOverflow = document.body.style.overflow;
        const returnFocusTarget = cartToggleButtonRef.current;
        document.body.style.overflow = 'hidden';
        const focusFrame = window.requestAnimationFrame(() => cartDrawerCloseButtonRef.current?.focus());

        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.body.style.overflow = previousBodyOverflow;

            const shouldRestoreFocus = cartDrawerRestoreFocusRef.current;
            cartDrawerRestoreFocusRef.current = true;
            if (shouldRestoreFocus) {
                window.requestAnimationFrame(() => {
                    if (isMobilePosViewport() && returnFocusTarget?.isConnected) returnFocusTarget.focus();
                });
            }
        };
    }, [isCartDrawerOpen, isMobilePosLayout]);

    useEffect(() => {
        if (previousCartItemCountRef.current === cartItemCount) return undefined;
        previousCartItemCountRef.current = cartItemCount;
        setCartCountFeedback(true);

        if (cartCountFeedbackTimerRef.current !== null) window.clearTimeout(cartCountFeedbackTimerRef.current);
        const timer = window.setTimeout(() => {
            setCartCountFeedback(false);
            cartCountFeedbackTimerRef.current = null;
        }, 280);
        cartCountFeedbackTimerRef.current = timer;
        return () => {
            if (cartCountFeedbackTimerRef.current === timer) {
                window.clearTimeout(timer);
                cartCountFeedbackTimerRef.current = null;
            }
        };
    }, [cartItemCount]);

    useEffect(() => () => {
        if (cartLongPressTimerRef.current !== null) window.clearTimeout(cartLongPressTimerRef.current);
        if (suppressedCartClickTimerRef.current !== null) window.clearTimeout(suppressedCartClickTimerRef.current);
        if (cartCountFeedbackTimerRef.current !== null) window.clearTimeout(cartCountFeedbackTimerRef.current);
    }, []);

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

    useEffect(() => {
        if (!isBulkRemoveConfirmationOpen) return undefined;
        const previousFocus = document.activeElement;
        const frameId = window.requestAnimationFrame(() => bulkRemoveCancelButtonRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(frameId);
            if (previousFocus?.isConnected) window.requestAnimationFrame(() => previousFocus.focus?.());
        };
    }, [isBulkRemoveConfirmationOpen]);

    useEffect(() => {
        if (!pendingCartRemoval) return undefined;
        const frameId = window.requestAnimationFrame(() => singleCartRemovalCancelButtonRef.current?.focus());
        return () => window.cancelAnimationFrame(frameId);
    }, [pendingCartRemoval]);

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

    const _completeOfflineCheckout = ({ transactionData, cartSnapshot, canSyncOnline, total, referenceNumber }) => {
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

        setInventory(sourceInventory.map((item) => {
            const cartItem = cartSnapshot.find((candidate) => candidate.code === item.code);
            if (!cartItem) return item;
            const stock = item.stock - cartItem.qty;
            return { ...item, stock, availableToSell: Math.max(0, Number(item.availableToSell ?? item.stock) - cartItem.qty), status: getStockStatus({ ...item, stock }, settings) };
        }));
        setTransactions((previous) => [referencedTransaction, ...previous]);
        cartSnapshot.forEach((item) => {
            logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${referencedTransaction.id})`, currentUserName);
        });
        setCart([]);
        setCashAmount('');
        setLastTransaction(referencedTransaction);
        setShowReceipt(false);
        setCheckoutPhase('confirmation');
        logActivity(currentUserName, 'Processed Sale', `Transaction ${referencedTransaction.id} — ${formatCurrency(total)}`);
        return referencedTransaction;
    };

    const reportCheckoutFieldError = (field, message) => {
        const scope = document.querySelector('[data-validation-scope="pos-payment"]');
        if (scope) setFormValidationErrors(scope, { [field]: message });
    };

    const handleCheckout = async () => {
        if (checkoutInFlightRef.current) {
            return;
        }

        if (cart.length === 0) return;

        const isCreditCheckout = paymentType === 'credit';
        const isCashCheckout = paymentType === 'cash';

        if (cart.some((item) => item.expiryTrackingEnabled === true)
            && !posBatchVerificationItems.every((item) => isExpiryBatchVerificationConfirmed(item, posBatchVerificationRecords[item.productKey]))) {
            showErrorDetails('Confirm the physical batch picks in the Order List before continuing.');
            setCheckoutPhase('order-list');
            const item = posBatchVerificationItems.find((candidate) => !isExpiryBatchVerificationConfirmed(candidate, posBatchVerificationRecords[candidate.productKey]));
            if (item && item.reconciled && !item.loading && !item.error && item.proposedAllocations?.length) {
                window.requestAnimationFrame(() => {
                    const scope = document.querySelector('[data-validation-scope="pos-order-list"]');
                    if (!scope?.isConnected) return;
                    const validationPrefix = `batchPicks.${item.productKey}`;
                    const confirmButton = Array.from(scope.querySelectorAll('[data-validation-key]')).find((control) => control.dataset.validationKey === `${validationPrefix}.confirm`);
                    const field = confirmButton && !confirmButton.disabled ? 'confirm' : 'batch';
                    setFormValidationErrors(scope, { [`${validationPrefix}.${field}`]: `Review the physical batch allocation for ${item.name || item.sku || 'this product'}.` });
                });
            }
            return;
        }

        // Calculate totals (Tax removed)
        const total = calculateTotal();
        // compute VAT breakdown to attach to transaction data and display
        const vatForTransaction = calculateVatBreakdown();
        const normalizedCashAmount = formatMoneyInput(cashAmount);
        const cashCentavos = parseMoneyToCentavos(normalizedCashAmount);
        const totalCentavos = getMoneyCentavosFromAmount(total);
        const hasValidCashAmount = cashCentavos !== null;
        const cash = hasValidCashAmount ? moneyFromCentavos(cashCentavos) : 0;
        const normalizedDownPaymentAmount = formatMoneyInput(downPaymentAmount);
        const downPaymentCentavos = parseMoneyToCentavos(normalizedDownPaymentAmount);

        if (isCashCheckout) {
            if (cashCentavos === null || totalCentavos === null) {
                const tooLarge = isMoneyInputTooLarge(normalizedCashAmount) || totalCentavos === null;
                const message = tooLarge ? 'Amount is too large. Please enter a smaller value.' : 'Enter a valid cash amount.';
                reportCheckoutFieldError('cashAmount', message);
                showErrorDetails(message);
                return;
            }
            if (cashCentavos < totalCentavos) {
                reportCheckoutFieldError('cashAmount', 'Cash tendered must cover the total due.');
                showErrorDetails("Insufficient cash amount!");
                return;
            }
        } else if (isCreditCheckout && !selectedCreditCustomer) {
            reportCheckoutFieldError('customerId', 'Select an eligible regular customer.');
            showErrorDetails('Select an eligible regular customer for credit checkout.');
            return;
        } else if (isCreditCheckout && !resolveCreditPaymentModeLabel()) {
            reportCheckoutFieldError('creditPaymentMode', 'Select a down payment method.');
            showErrorDetails('Please select a payment method for credit checkout.');
            return;
        } else if (isCreditCheckout && (downPaymentCentavos === null || downPaymentCentavos < 1)) {
            reportCheckoutFieldError('downPayment', 'Enter a down payment of at least ₱0.01.');
            showErrorDetails('Enter a down payment of at least ₱0.01.');
            return;
        } else if (isCreditCheckout && (totalCentavos === null || downPaymentCentavos >= totalCentavos)) {
            reportCheckoutFieldError('downPayment', 'Down payment must be less than the total amount.');
            showErrorDetails('Down payment must be less than the total amount.');
            return;
        } else if (isCreditCheckout && (downPaymentProofFiles.length < 1 || downPaymentProofFiles.length > 3)) {
            reportCheckoutFieldError('proofFiles', 'Choose 1 to 3 Down Payment Proof photos.');
            showErrorDetails('Choose 1 to 3 Down Payment Proof photos.');
            return;
        } else if (isCreditCheckout && parsedCreditTermDays === null) {
            reportCheckoutFieldError('termDays', `Enter a whole-number credit term from ${MIN_CREDIT_TERM_DAYS} to ${MAX_CREDIT_TERM_DAYS} days.`);
            showErrorDetails(`Enter a whole-number credit term from ${MIN_CREDIT_TERM_DAYS} to ${MAX_CREDIT_TERM_DAYS} days.`);
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
            paymentStatus: isCreditCheckout ? 'Partially Paid' : 'Paid',
            customerId: isCreditCheckout ? selectedCreditCustomerId : '',
            customerName: isCreditCheckout
                ? (selectedCreditCustomer?.name || '')
                : '',
            creditPaymentMode: isCreditCheckout ? resolveCreditPaymentModeLabel() : '',
            downPaymentAmount: isCreditCheckout ? moneyFromCentavos(downPaymentCentavos) : 0,
            amountPaid: isCreditCheckout ? moneyFromCentavos(downPaymentCentavos) : 0,
            remainingBalance: isCreditCheckout ? moneyFromCentavos(totalCentavos - downPaymentCentavos) : 0,
            termDays: isCreditCheckout ? parsedCreditTermDays : null,
            dueDate: isCreditCheckout && computedCreditDueDate ? computedCreditDueDate.toISOString() : null,
            cashier: currentUserFullName || currentUserName,
            cashierRole: String(userRole || '').toLowerCase(),
        };

        const authToken = getAuthToken();
        const hasSession = Boolean(authToken);
        const canSyncOnline = hasSession && navigator.onLine && cartSnapshot.every(item => item.id);

        if (cartSnapshot.some((item) => item.expiryTrackingEnabled === true) && !canSyncOnline) {
            showErrorDetails('Expiry-tracked items need an online connection for physical batch verification and payment.');
            checkoutInFlightRef.current = false;
            setIsCheckoutProcessing(false);
            return;
        }

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

        // Payment only prepares an editable draft. No Sale, inventory mutation,
        // credit record, or activity log exists until Save Transaction.
        setCheckoutDraft({
            transactionData,
            cartSnapshot,
            canSyncOnline,
            isCreditCheckout,
            isCashCheckout,
            downPaymentProofFiles: isCreditCheckout ? [...downPaymentProofFiles] : [],
            apiItems: cartSnapshot.map((item) => ({ productId: item.id, quantity: item.qty })),
            saleOptions: isCreditCheckout
                ? {
                    customerId: selectedCreditCustomerId,
                    customerName: selectedCreditCustomer?.name || '',
                    creditPaymentMode: selectedCreditPaymentMode,
                    creditPaymentModeOther: selectedCreditPaymentMode === 'other' ? customCreditPaymentMode : '',
                    downPaymentAmount: normalizedDownPaymentAmount,
                    termDays: parsedCreditTermDays,
                    notes: `Down payment method: ${resolveCreditPaymentModeLabel()}`,
                    vatMode: normalizeVatMode(selectedVatMode),
                }
                : {
                    vatMode: normalizeVatMode(selectedVatMode),
                    cashTendered: normalizedCashAmount,
                },
            batchVerifications: expiryTrackedCartItems.map((item) => {
                const key = String(item.id || item.code);
                const record = posBatchVerificationRecords[key];
                return {
                    productId: String(item.id || ''),
                    proposedAllocations: record?.proposedAllocations || posBatchPickData[key]?.proposedAllocations || [],
                    verifiedAllocations: record?.allocations || [],
                    reason: String(record?.reason || '').trim(),
                    productStock: posBatchPickData[key]?.productStock,
                    productReserved: posBatchPickData[key]?.productReserved,
                };
            }),
        });
        setCheckoutPhase('confirmation');
        checkoutInFlightRef.current = false;
        setIsCheckoutProcessing(false);
        return;
    };

    const finalizeCheckoutDraft = async ({ referenceNumber, documentFile }) => {
        if (checkoutInFlightRef.current || !checkoutDraft) {
            throw new Error('The checkout draft is no longer available. Return to Payment and try again.');
        }

        checkoutInFlightRef.current = true;
        setIsCheckoutProcessing(true);
        try {
            const { transactionData, cartSnapshot, canSyncOnline, isCreditCheckout, apiItems, saleOptions, downPaymentProofFiles: draftProofFiles, batchVerifications = [] } = checkoutDraft;
            if (!canSyncOnline) {
                if (batchVerifications.length) throw new Error('Expiry-tracked items require a live connection for batch verification.');
                if (isCreditCheckout) throw new Error('Credit checkout requires a live backend connection. Please reconnect and retry.');
                if (documentFile) throw new Error('Supporting images require a live connection. Enter an Invoice No. to save this cash sale offline.');

                const referencedTransaction = {
                    ...transactionData,
                    transactionReference: { referenceNumber: String(referenceNumber || '').trim(), supportingDocument: null },
                };
                const queued = addToSyncQueue({
                    ...referencedTransaction,
                    clientRequestId: referencedTransaction.clientRequestId,
                    items: cartSnapshot.map((item) => ({ ...item, id: item.id || item._id })),
                });
                if (!queued) throw new Error('The sale could not be added to your offline sync queue.');
                return { transaction: referencedTransaction, offline: true };
            }

            const savedSale = await finalizeSaleWithReferenceApi({
                items: apiItems,
                paymentMethod: isCreditCheckout ? 'credit' : 'cash',
                clientRequestId: transactionData.clientRequestId,
                referenceNumber,
                documentFile,
                downPaymentProofFiles: draftProofFiles,
                batchVerifications,
                options: saleOptions,
            });

            const remoteTransaction = {
                ...transactionData,
                id: savedSale?._id ? `TRX-${savedSale._id.slice(-8).toUpperCase()}` : '',
                sourceId: savedSale?._id ? String(savedSale._id) : '',
                date: savedSale?.createdAt ? new Date(savedSale.createdAt).toLocaleString() : transactionData.date,
                total: savedSale?.totalAmount ?? transactionData.total,
                netAmount: Number(savedSale?.netAmount ?? transactionData.netAmount),
                vatAmount: Number(savedSale?.vatAmount ?? transactionData.vatAmount),
                grossAmount: Number(savedSale?.grossAmount ?? transactionData.grossAmount),
                paymentStatus: savedSale?.paymentStatus || transactionData.paymentStatus,
                downPaymentAmount: transactionData.downPaymentAmount,
                amountPaid: transactionData.amountPaid,
                remainingBalance: transactionData.remainingBalance,
                transactionReference: savedSale?.transactionReference || null,
            };
            try {
                const remoteProducts = await listProductsApi({ includeImages: false });
                if (Array.isArray(remoteProducts)) {
                    const cachedImages = new Map(sourceInventory.map((product) => [String(product.code || ''), String(product.imageUrl || '')]));
                    setInventory(remoteProducts.map((product) => ({
                        ...product,
                        imageUrl: product.imageUrl || cachedImages.get(String(product.code || '')) || '',
                    })));
                }
            } catch (refreshError) {
                console.warn('Sale finalized, but inventory refresh failed:', refreshError);
            }
            return { transaction: remoteTransaction, offline: false };
        } finally {
            checkoutInFlightRef.current = false;
            setIsCheckoutProcessing(false);
        }
    };

    const completeFinalizedCheckout = ({ transaction, offline }) => {
        const draft = checkoutDraft;
        if (!draft) return;
        if (offline) {
            setInventory((previous) => previous.map((item) => {
                const cartItem = draft.cartSnapshot.find((candidate) => candidate.code === item.code);
                if (!cartItem) return item;
                const stock = item.stock - cartItem.qty;
                return { ...item, stock, availableToSell: Math.max(0, Number(item.availableToSell ?? item.stock) - cartItem.qty), status: getStockStatus({ ...item, stock }, settings) };
            }));
        }
        if (!draft.isCreditCheckout) setTransactions((previous) => upsertTransactionByIdentity(previous, transaction));
        draft.cartSnapshot.forEach((item) => {
            logAction('DEDUCT', item.code, `Sold ${item.qty} Qty (TRX: ${transaction.id})`, currentUserName);
        });
        setCart([]);
        setPosBatchPickData({});
        setPosBatchVerificationRecords({});
        setCashAmount('');
        setDownPaymentAmount('');
        setDownPaymentProofFiles([]);
        setLastTransaction(transaction);
        setCheckoutDraft(null);
        setCheckoutReferenceDraft({ referenceNumber: '', documentFile: null });
        setShowReceipt(false);
        setCheckoutPhase(null);
        logActivity(currentUserName, 'Processed Sale', `Transaction ${transaction.id} — ${formatCurrency(transaction.total)}`);
        if (offline) showToast('Offline Mode', 'Transaction saved locally and will sync when online.', 'info', 'pos-offline-sync');
        showTransactionCompletionToast(transaction);
    };

    const [printStatus, setPrintStatus] = useState('idle'); // idle, printing, success
    const [quotationPdfStatus, setQuotationPdfStatus] = useState('idle');

    const openOrderList = () => {
        if (cart.length === 0 || isCheckoutProcessing || orderListGenerationInFlightRef.current) return;
        orderListGenerationInFlightRef.current = true;
        const openedAt = new Date().toLocaleString();
        setLastTransaction(null);
        setCheckoutDraft(null);
        setCheckoutReferenceDraft({ referenceNumber: '', documentFile: null });
        setCheckoutOpenedAt(openedAt);
        setCheckoutPhase('order-list');

        // This is the explicit Order List draft-generation action. Never auto-print
        // from cart changes, checkout completion, or the viewing-only confirmation.
        if (userPreferences.autoPrintReceipts) {
            if (cart.some((item) => item.expiryTrackingEnabled === true)) {
                pendingOrderListAutoPrintRef.current = true;
            } else {
                void handlePrintOrderList({ date: openedAt });
            }
        }
    };

    const openWalkInQuotation = () => {
        const generatedAt = new Date().toISOString();
        const quoteData = {
            quotationType: 'walk_in',
            items: [...cart],
            total: calculateTotal(),
            generatedAt,
            quotationNumber: `QTN-${new Date(generatedAt).getFullYear()}-${String(Date.now()).slice(-4)}`,
            cashierName: currentUserName,
        };

        setQuotationData(quoteData);
        setShowQuotationPreview(true);
    };

    const handleGenerateQuotation = () => {
        openWalkInQuotation();
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
        const quotationPrintLayout = buildQuotationPrintLayout(quotationReceipt);

        void printDocument(quotationPrintLayout)
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

    const handleDownloadQuotationPdf = () => {
        if (quotationPdfStatus === 'downloading') return;

        const quote = quotationData;
        if (!quote) {
            showErrorDetails('Please generate a quotation first.');
            return;
        }

        setQuotationPdfStatus('downloading');
        const quotationReceipt = buildQuotationReceiptModel(quote, settings);
        void downloadWalkInQuotationPdf(quotationReceipt)
            .then(() => {
                setQuotationPdfStatus('success');
                showToast('Download Success', 'Quotation PDF downloaded successfully.', 'success', 'pos-download-quotation');
                window.setTimeout(() => setQuotationPdfStatus('idle'), 1500);
            })
            .catch((error) => {
                setQuotationPdfStatus('idle');
                showErrorDetails(error?.message || 'Unable to download quotation PDF.');
            });
    };

    const completeOrderConfirmationPreview = () => {
        setShowReceipt(false);
        setCheckoutPhase(null);
    };

    const proceedToPayment = () => {
        if (posBatchPickLoading) return;
        if (expiryTrackedCartItems.length) {
            if (!getAuthToken() || !navigator.onLine) {
                showErrorDetails('Expiry-tracked items need an online connection for physical batch verification.');
                return;
            }
            const allConfirmed = posBatchVerificationItems.every((item) => isExpiryBatchVerificationConfirmed(
                item,
                posBatchVerificationRecords[item.productKey]
            ));
            if (!allConfirmed) {
                showErrorDetails('Confirm each batch pick before continuing to payment. Batch verification is needed in Inventory for existing stock.');
                return;
            }
        }
        setCheckoutPhase('payment');
    };

    const handlePrintOrderList = async (options = {}) => {
        if (cart.length === 0 || printStatus === 'printing' || printLockRef.current) {
            return;
        }

        printLockRef.current = true;
        setPrintStatus('printing');
        try {
            const result = await printReceipt({
                transaction: {
                    date: options?.date || checkoutOpenedAt || new Date().toLocaleString(),
                    cashier: currentUserFullName || currentUserName,
                    items: cart.map((item) => {
                        const key = String(item.id || item.code);
                        const pickData = posBatchPickData[key];
                        const verification = posBatchVerificationRecords[key];
                        const allocations = verification?.confirmed
                            ? verification.allocations
                            : pickData?.proposedAllocations || [];
                        return {
                            ...item,
                            batchPickNotice: item.expiryTrackingEnabled === true
                                ? pickData?.error
                                    ? 'Batch details not loaded; refresh before picking.'
                                    : !pickData?.reconciled
                                        ? 'Verify batches before picking.'
                                        : !pickData?.proposedAllocations
                                            ? 'Insufficient eligible batch stock.'
                                            : ''
                                : '',
                            batchPicks: allocations.map((allocation) => ({
                                batchId: allocation.batchId,
                                batchReference: allocation.batchReference || '',
                                lotNumber: allocation.lotNumber || '',
                                expiryDate: allocation.expiryDate,
                                quantity: Number(allocation.quantity || 0),
                                status: verification?.confirmed ? 'verified' : 'provisional',
                            })),
                        };
                    }),
                    documentType: 'order-list-draft',
                },
                settings,
                paperWidthMm: 58,
            });

            setPrintStatus('success');
            showToast(
                'Print Success',
                result.source === 'local-service'
                    ? 'Draft order list sent to the thermal printer.'
                    : 'Draft order list printed successfully!',
                'success',
                'pos-print-receipt'
            );

            window.setTimeout(() => {
                setPrintStatus('idle');
                printLockRef.current = false;
            }, 1500);
        } catch (error) {
            printLockRef.current = false;
            setPrintStatus('idle');
            console.error('Unable to print draft Order List:', error);
            showErrorDetails('Unable to print Order List. Please try again.');
        }
    };

    const handlePrintOrderListRef = useRef(handlePrintOrderList);
    handlePrintOrderListRef.current = handlePrintOrderList;

    useEffect(() => {
        if (!pendingOrderListAutoPrintRef.current) return;
        if (checkoutPhase !== 'order-list') {
            pendingOrderListAutoPrintRef.current = false;
            return;
        }
        if (posBatchPickLoading) return;
        const trackedData = expiryTrackedCartItems.map((item) => posBatchPickData[String(item.id || item.code)]);
        if (trackedData.some((item) => !item || item.error)) return;
        pendingOrderListAutoPrintRef.current = false;
        void handlePrintOrderListRef.current?.({ date: checkoutOpenedAt || new Date().toLocaleString() });
    }, [checkoutPhase, posBatchPickLoading, posBatchPickData, expiryTrackedCartItems, checkoutOpenedAt]);

    const receiptTitle = 'Order Confirmation';
    const payableTotalForChange = calculateTotal();
    const changeCentavosForDisplay = getCashChangeCentavos(cashAmount, payableTotalForChange);
    const isCashAmountTooLarge = paymentType === 'cash' && isMoneyInputTooLarge(cashAmount);
    const normalizedDownPaymentAmount = formatMoneyInput(downPaymentAmount);
    const downPaymentCentavos = parseMoneyToCentavos(normalizedDownPaymentAmount);
    const payableTotalCentavos = getMoneyCentavosFromAmount(payableTotalForChange);
    const downPaymentInputError = paymentType === 'credit' && downPaymentAmount !== '' && (
        downPaymentCentavos === null || downPaymentCentavos < 1
            ? 'Enter at least ₱0.01.'
            : payableTotalCentavos === null || downPaymentCentavos >= payableTotalCentavos
                ? 'Must be less than the total amount.'
                : ''
    );
    const creditRemainingBalance = downPaymentCentavos !== null && payableTotalCentavos !== null && downPaymentCentavos > 0 && downPaymentCentavos < payableTotalCentavos
        ? moneyFromCentavos(payableTotalCentavos - downPaymentCentavos)
        : null;
    const isCheckoutDisabled = cart.length === 0 || isCheckoutProcessing;
    const isConfirmationPaymentDisabled = cart.length === 0
        || isCheckoutProcessing
        || (paymentType === 'cash' && !cashAmount)
        || isCashAmountTooLarge
        || (paymentType === 'credit' && (
            !selectedCreditCustomer
            || !resolveCreditPaymentModeLabel()
            || downPaymentCentavos === null
            || downPaymentCentavos < 1
            || payableTotalCentavos === null
            || downPaymentCentavos >= payableTotalCentavos
            || downPaymentProofFiles.length < 1
            || downPaymentProofFiles.length > 3
            || parsedCreditTermDays === null
        ));
    const creditDateFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    const creditInvoiceDateLabel = creditInvoiceDate.toLocaleDateString(undefined, creditDateFormatOptions);
    const creditDueDateLabel = computedCreditDueDate
        ? computedCreditDueDate.toLocaleDateString(undefined, creditDateFormatOptions)
        : '—';
    const creditTermValidationMessage = parsedCreditTermDays === null
        ? `Enter a whole number from ${MIN_CREDIT_TERM_DAYS} to ${MAX_CREDIT_TERM_DAYS}.`
        : '';
    const checkoutDisabledMessage = cart.length === 0
        ? 'Add item first'
        : isCheckoutProcessing
            ? 'Processing payment...'
            : 'Review the order first';
    const getSellingUnit = (item) => String(item?.sellingUnit || item?.unit || '').trim();
    const confirmationItems = lastTransaction?.items || cart;
    const confirmationVat = lastTransaction
        ? { netAmount: lastTransaction.netAmount, vatAmount: lastTransaction.vatAmount, grossAmount: lastTransaction.grossAmount }
        : calculateVatBreakdown();
    const confirmationTotal = lastTransaction?.total ?? calculateTotal();
    const confirmationDate = lastTransaction?.date || checkoutOpenedAt;
    const confirmationCash = lastTransaction ? lastTransaction.cash : (changeCentavosForDisplay === null ? 0 : moneyFromCentavos(parseMoneyToCentavos(formatMoneyInput(cashAmount)) || 0));
    const confirmationChange = lastTransaction ? lastTransaction.change : (changeCentavosForDisplay === null ? 0 : moneyFromCentavos(changeCentavosForDisplay));
    const selectedCartItems = getSelectedCartItems(cart, selectedCartItemCodes);
    const selectedCartItemCount = selectedCartItems.length;
    const areAllCartItemsSelected = cart.length > 0 && selectedCartItemCount === cart.length;
    const isBlockingPosModalOpen = Boolean(
        isBulkRemoveConfirmationOpen
        || recommendationModal.isOpen
        || productDetailsItem
        || enlargedProductImage
        || isQuickAddCreditCustomerOpen
        || showQuotationPreview
        || showReceipt
        || checkoutPhase
        || variantModal.isOpen
    );
    const isFloatingCartVisible = isMobilePosLayout
        && !isHeaderCartVisible
        && !isCartDrawerOpen
        && !isBlockingPosModalOpen;
    const isInlineCartPanelCollapsed = isCurrentOrderCollapsed && !isMobilePosLayout;

    useEffect(() => {
        if (!isFloatingCartVisible && document.activeElement === floatingCartButtonRef.current && isHeaderCartVisible) {
            cartToggleButtonRef.current?.focus();
        }
    }, [isFloatingCartVisible, isHeaderCartVisible]);

    return (
        <div className="flex min-h-[calc(100dvh-80px)] flex-col gap-2 overflow-y-auto md:h-[calc(100vh-80px)] md:overflow-hidden">
            


            <div className="flex flex-col md:flex-row flex-1 gap-2 md:min-h-0">
            {checkoutPhase === 'confirmation' && checkoutDraft && (
                <OrderConfirmationModal
                    transaction={checkoutDraft.transactionData}
                    customer={checkoutDraft.isCreditCheckout ? selectedCreditCustomer : null}
                    settings={settings}
                    pending
                    onBack={() => setCheckoutPhase('payment')}
                    onContinue={() => setCheckoutPhase('reference')}
                />
            )}
            {checkoutPhase === 'reference' && checkoutDraft && (
                <TransactionReferenceModal
                    initialDraft={checkoutReferenceDraft}
                    onDraftChange={setCheckoutReferenceDraft}
                    onBack={() => setCheckoutPhase('confirmation')}
                    requiredFlow
                    referenceNumberOnly={!checkoutDraft.canSyncOnline}
                    saveLabel="Save Transaction"
                    failureMessage="The transaction was not saved. Check your connection and try again with the same draft."
                    onSave={finalizeCheckoutDraft}
                    onSaved={completeFinalizedCheckout}
                />
            )}
            {checkoutPhase === 'order-list' && (
                <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="order-list-title">
                    <div data-validation-scope="pos-order-list" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                        <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4"><div><h3 id="order-list-title" className="text-xl font-semibold text-slate-900">Order List</h3><p className="mt-0.5 text-xs text-slate-500">Review and adjust products before payment.</p></div><button type="button" onClick={() => setCheckoutPhase(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Back to POS cart">×</button></header>
                        <div className="pos-order-list-scroll-area min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
                            {cart.length === 0 ? (
                                <div className="flex min-h-[16rem] flex-col items-center justify-center px-4 py-8 text-center">
                                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden="true">
                                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M3 3h2l1.7 9.1a2 2 0 002 1.6h7.9a2 2 0 001.9-1.4L21 6H6m3 11.5h.01m7.99 0h.01" />
                                        </svg>
                                    </span>
                                    <h4 className="mt-3 text-sm font-semibold text-slate-800">No products in this order yet.</h4>
                                    <p className="mt-1 text-xs text-slate-500">Add items from the product list to continue.</p>
                                </div>
                            ) : cart.map((item) => (
                                <div key={item.code} className="pos-order-list-item-card grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:flex sm:gap-3">
                                    <ProductThumbnail item={item} className="row-span-2 h-12 w-12 self-start rounded-lg sm:row-span-1 sm:self-auto" onPreview={handleProductImagePreviewClick} fit="contain" />
                                    <div className="min-w-0 sm:flex-1">
                                        <p className="break-words text-sm font-semibold text-slate-900">{item.brand && !item.displayNameIsFallback ? `${item.brand} ` : ''}{item.name}</p>
                                        <p className="mt-0.5 break-all text-[11px] text-slate-500">SKU: {item.code}{getSellingUnit(item) ? ` | ${getSellingUnit(item)}` : ''}</p>
                                        {!item.displayNameIsFallback && <p className="mt-0.5 break-words text-[11px] text-slate-600">{getOrderListVariationDetails(item, categoryDefinitions)}</p>}
                                    </div>
                                    <div className="pos-order-list-item-controls col-start-2 flex min-w-0 items-center gap-1.5 sm:col-auto sm:ml-auto sm:shrink-0">
                                        <button type="button" onClick={() => updateQuantity(item.code, item.qty - 1)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={`Decrease ${item.name} quantity`}>&minus;</button>
                                        <span className="w-7 shrink-0 text-center text-sm font-semibold text-slate-900">{item.qty}</span>
                                        <button type="button" onClick={() => updateQuantity(item.code, item.qty + 1)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800" aria-label={`Increase ${item.name} quantity`}>+</button>
                                        <button type="button" onClick={() => removeFromCart(item.code)} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${item.name}`}>&times;</button>
                                    </div>
                                </div>
                            ))}
                            {expiryTrackedCartItems.length > 0 && <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-labelledby="pos-batch-verification-heading">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <h4 id="pos-batch-verification-heading" className="text-sm font-semibold text-slate-900">Physical Batch Verification</h4>
                                        <p className="mt-0.5 text-xs text-slate-600">Review the proposed batches and confirm each pick before saving the sale.</p>
                                    </div>
                                    <button type="button" onClick={() => setPosBatchRefreshNonce((value) => value + 1)} disabled={posBatchPickLoading} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50">{posBatchPickLoading ? 'Checking…' : 'Refresh Batches'}</button>
                                </div>
                                {posBatchPickLoading && <p role="status" className="text-xs text-slate-600">Loading current batch availability…</p>}
                                {posBatchPickError && <p role="alert" className="text-xs text-rose-700">{posBatchPickError}</p>}
                                <div className="space-y-2">
                                    {posBatchVerificationItems.map((item) => <ExpiryBatchPickEditor
                                        key={item.productKey}
                                        item={item}
                                        record={posBatchVerificationRecords[item.productKey]}
                                        disabled={posBatchPickLoading}
                                        validationKeyPrefix={`batchPicks.${item.productKey}`}
                                        onChange={(productKey, record) => setPosBatchVerificationRecords((previous) => ({ ...previous, [productKey]: record }))}
                                    />)}
                                </div>
                            </section>}
                        </div>
                        <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:p-4"><button type="button" onClick={handlePrintOrderList} disabled={printStatus === 'printing' || cart.length === 0 || posBatchPickLoading} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{printStatus === 'printing' ? 'Printing…' : 'Print Order List'}</button><button type="button" onClick={proceedToPayment} disabled={cart.length === 0 || posBatchPickLoading} className="rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Proceed to Payment</button></footer>
                    </div>
                </div>
            )}
            {checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen && (
                <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="order-confirmation-title">
                    <div data-validation-scope="pos-payment" className={`flex ${ORDER_CONFIRMATION_PREVIEW_SIZE.modal} max-h-[92vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
                        <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
                            <h3 id="order-confirmation-title" className="text-xl font-semibold text-slate-900">{lastTransaction ? 'Order Confirmation' : 'Payment'}</h3>
                            {!lastTransaction && <button type="button" onClick={() => setCheckoutPhase('order-list')} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Back to order list">×</button>}
                        </header>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="space-y-5 text-xs text-slate-600 sm:text-[13px]">
                            {!lastTransaction && (
                                <section className="space-y-4">
                                    <div>
                                        <label className="mb-1.5 block text-xs font-medium text-slate-600">Payment Method</label>
                                        <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-100 p-1">
                                            <button type="button" onClick={() => handlePaymentTypeChange('cash')} className={`flex-1 rounded-md py-2 text-xs font-semibold ${paymentType === 'cash' ? 'bg-slate-900 text-slate-200 shadow-sm' : 'bg-slate-100 text-slate-700'}`}>Cash</button>
                                            <button type="button" onClick={() => handlePaymentTypeChange('credit')} className={`flex-1 rounded-md py-2 text-xs font-semibold ${paymentType === 'credit' ? 'bg-slate-900 text-slate-200 shadow-sm' : 'bg-slate-100 text-slate-700'}`}>Credit</button>
                                        </div>
                                    </div>
                                    {paymentType === 'cash' ? (
                                        <>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <label className="block text-xs font-medium text-slate-600">Cash Tendered<input type="text" name="cashAmount" data-validation-key="cashAmount" inputMode="decimal" value={cashAmount} onKeyDown={preventInvalidMoneyKeyDown} onPaste={preventInvalidMoneyPaste} onChange={(event) => setCashAmount(sanitizeCashTenderedInput(event.target.value))} onBlur={() => setCashAmount((value) => formatMoneyInput(value))} placeholder="0.00" className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-right text-sm text-slate-900" /></label>
                                                <label className="block text-xs font-medium text-slate-600">VAT Mode<select value={selectedVatMode} onChange={(event) => setSelectedVatMode(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">{VAT_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                                            </div>
                                            <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3.5">
                                                <div className="flex items-center justify-between"><span className="font-medium text-slate-500">Total Due</span><span className="text-lg font-semibold text-slate-900">{formatCurrency(confirmationTotal)}</span></div>
                                                <div className="flex items-center justify-between border-t border-slate-200 pt-2"><span className="font-medium text-slate-500">Change</span><span className="font-semibold text-slate-900">{formatCurrency(confirmationChange)}</span></div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="space-y-3">
                                            <div ref={creditCustomerComboboxRef} className="space-y-1.5">
                                                <label htmlFor="credit-customer-search" className="block text-xs font-medium text-slate-600">Regular Customer</label>
                                                <div className="flex items-start gap-2">
                                                    <div className="relative min-w-0 flex-1">
                                                        <input
                                                            id="credit-customer-search"
                                                            name="customerId"
                                                            data-validation-key="customerId"
                                                            data-validation-aliases="customer"
                                                            type="text"
                                                            value={creditCustomerSearchQuery}
                                                            onFocus={() => setIsCreditCustomerComboboxOpen(true)}
                                                            onChange={(event) => {
                                                                setCreditCustomerSearchQuery(event.target.value);
                                                                if (selectedCreditCustomerId) setSelectedCreditCustomerId('');
                                                                setHighlightedCreditCustomerIndex(-1);
                                                                setIsCreditCustomerComboboxOpen(true);
                                                            }}
                                                            onKeyDown={handleCreditCustomerKeyDown}
                                                            onBlur={() => window.setTimeout(() => setIsCreditCustomerComboboxOpen(false), 150)}
                                                            placeholder="Search or select customer..."
                                                            role="combobox"
                                                            aria-autocomplete="list"
                                                            aria-controls="credit-customer-options"
                                                            aria-expanded={isCreditCustomerComboboxOpen}
                                                            aria-activedescendant={highlightedCreditCustomerIndex >= 0
                                                                ? `credit-customer-option-${highlightedCreditCustomerIndex}`
                                                                : undefined}
                                                            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                                                        />
                                                        {(creditCustomerSearchQuery || selectedCreditCustomerId) && (
                                                            <button
                                                                type="button"
                                                                onMouseDown={(event) => event.preventDefault()}
                                                                onClick={clearCreditCustomerSelection}
                                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                                                                aria-label="Clear regular customer"
                                                            >
                                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                                            </button>
                                                        )}
                                                        {isCreditCustomerComboboxOpen && (
                                                            <div id="credit-customer-options" className="absolute left-0 top-full z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
                                                                {creditCustomers.length === 0 ? (
                                                                    <p className="px-3 py-2 text-xs text-slate-500">No eligible regular customers available.</p>
                                                                ) : filteredCreditCustomers.length === 0 ? (
                                                                    <p className="px-3 py-2 text-xs text-slate-500">No matching customers found.</p>
                                                                ) : filteredCreditCustomers.map((customer, index) => {
                                                                    const customerId = String(customer?._id || customer?.id || '');
                                                                    return (
                                                                        <button
                                                                            id={`credit-customer-option-${index}`}
                                                                            data-customer-index={index}
                                                                            key={customerId}
                                                                            type="button"
                                                                            role="option"
                                                                            aria-selected={customerId === selectedCreditCustomerId}
                                                                            onMouseDown={(event) => event.preventDefault()}
                                                                            onMouseEnter={() => setHighlightedCreditCustomerIndex(index)}
                                                                            onClick={() => selectCreditCustomer(customer)}
                                                                            className={`block w-full px-3 py-2 text-left text-sm font-medium transition-colors ${index === highlightedCreditCustomerIndex || customerId === selectedCreditCustomerId ? 'bg-amber-50 text-amber-800' : 'text-slate-700 hover:bg-slate-50'}`}
                                                                        >
                                                                            {customer.name}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {canQuickAddCreditCustomer && (
                                                        <ViewportTooltip content="Add Regular Customer" triggerClassName="shrink-0" placementPreference="above" openDelay={250} closeDelay={80}>
                                                            <button
                                                                type="button"
                                                                onClick={openQuickAddCreditCustomer}
                                                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                                                                aria-label="Add Regular Customer"
                                                            >
                                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" /></svg>
                                                            </button>
                                                        </ViewportTooltip>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <label className="block text-xs font-medium text-slate-600">Down Payment Method<select name="creditPaymentMode" data-validation-key="creditPaymentMode" value={selectedCreditPaymentMode} onChange={(event) => { setSelectedCreditPaymentMode(event.target.value); if (event.target.value !== 'other') setCustomCreditPaymentMode(''); }} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"><option value="">Select payment method</option>{CREDIT_PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{formatCreditPaymentModeLabel(mode)}</option>)}</select></label>
                                                <label className="block text-xs font-medium text-slate-600">VAT Mode<select value={selectedVatMode} onChange={(event) => setSelectedVatMode(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">{VAT_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                                            </div>
                                            {selectedCreditPaymentMode === 'other' && <label className="block text-xs font-medium text-slate-600">Other Payment Method<input type="text" name="customCreditPaymentMode" data-validation-key="customCreditPaymentMode" data-validation-aliases="creditPaymentModeOther" value={customCreditPaymentMode} onChange={(event) => setCustomCreditPaymentMode(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900" /></label>}
                                            <label className="block text-xs font-medium text-slate-600" htmlFor="credit-down-payment">
                                                Down Payment (₱)
                                                <input
                                                    id="credit-down-payment"
                                                    name="downPayment"
                                                    data-validation-key="downPayment"
                                                    data-validation-aliases="downPaymentAmount amountPaid"
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={downPaymentAmount}
                                                    onKeyDown={preventInvalidMoneyKeyDown}
                                                    onPaste={preventInvalidMoneyPaste}
                                                    onChange={(event) => setDownPaymentAmount(sanitizeCashTenderedInput(event.target.value))}
                                                    onBlur={() => setDownPaymentAmount((value) => formatMoneyInput(value))}
                                                    aria-invalid={Boolean(downPaymentInputError)}
                                                    aria-describedby={downPaymentInputError ? 'credit-down-payment-error' : 'credit-down-payment-help'}
                                                    placeholder="0.00"
                                                    className={`mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-right text-sm text-slate-900 focus:outline-none ${downPaymentInputError ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-slate-500'}`}
                                                />
                                            </label>
                                            {downPaymentInputError ? <p id="credit-down-payment-error" role="alert" className="-mt-1 text-xs font-medium text-rose-600">{downPaymentInputError}</p> : <p id="credit-down-payment-help" className="-mt-1 text-xs text-slate-500">Required. Enter an amount greater than ₱0.00 and less than the total.</p>}
                                            <EvidenceUploadField id="credit-down-payment-proof-modal" label="Down Payment Proof" files={downPaymentProofFiles} onChange={setDownPaymentProofFiles} minFiles={1} maxFiles={3} disabled={isCheckoutProcessing} uploadPresentation="dashed" uploadLabel="Add Payment Proof" validationKey="proofFiles" validationAliases="downPaymentProofFiles" />
                                            <div>
                                                <label htmlFor="credit-term-days" className="block text-xs font-medium text-slate-600">Credit Term (Days)</label>
                                                <div className="mt-1.5 grid w-full grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={decrementCreditTerm}
                                                        disabled={parsedCreditTermDays === null || parsedCreditTermDays <= MIN_CREDIT_TERM_DAYS}
                                                        className="flex h-10 w-full items-center justify-center rounded-lg border border-slate-300 bg-white text-lg font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                                        aria-label="Decrease credit term by one day"
                                                    >
                                                        &minus;
                                                    </button>
                                                    <input
                                                        id="credit-term-days"
                                                        name="termDays"
                                                        data-validation-key="termDays"
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={selectedCreditTermDays}
                                                        onKeyDown={preventInvalidWholeNumberKeyDown}
                                                        onPaste={preventInvalidWholeNumberPaste}
                                                        onChange={(event) => handleCreditTermInputChange(event.target.value)}
                                                        aria-invalid={parsedCreditTermDays === null}
                                                        aria-describedby={creditTermValidationMessage ? 'credit-term-error' : 'credit-date-preview'}
                                                        className={`h-10 min-w-0 rounded-lg border bg-white px-3 text-center text-sm font-semibold leading-10 text-slate-900 focus:outline-none ${parsedCreditTermDays === null ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-slate-500'}`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={incrementCreditTerm}
                                                        disabled={(selectedCreditTermDays !== '' && parsedCreditTermDays === null) || parsedCreditTermDays >= MAX_CREDIT_TERM_DAYS}
                                                        className="flex h-10 w-full items-center justify-center rounded-lg border border-slate-900 bg-slate-900 text-lg font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                                                        aria-label="Increase credit term by one day"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                                {creditTermValidationMessage && <p id="credit-term-error" role="alert" className="mt-1.5 text-xs font-medium text-rose-600">{creditTermValidationMessage}</p>}
                                                <dl id="credit-date-preview" className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs">
                                                    <dt className="text-slate-500">Invoice Date</dt>
                                                    <dd className="text-right font-medium text-slate-800">{creditInvoiceDateLabel}</dd>
                                                    <dt className="text-slate-500">Due Date</dt>
                                                    <dd className="text-right font-semibold text-slate-900">{creditDueDateLabel}</dd>
                                                </dl>
                                            </div>
                                            <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3.5">
                                                <div className="flex items-center justify-between"><span className="font-medium text-slate-500">Total Due</span><span className="text-lg font-semibold text-slate-900">{formatCurrency(confirmationTotal)}</span></div>
                                                <div className="flex items-center justify-between border-t border-slate-200 pt-2"><span className="font-medium text-slate-500">Down Payment</span><span className="font-semibold text-slate-900">{downPaymentCentavos === null ? '—' : formatCurrency(moneyFromCentavos(downPaymentCentavos))}</span></div>
                                                <div className="flex items-center justify-between"><span className="font-medium text-slate-500">Remaining Balance</span><span className="font-semibold text-slate-900">{creditRemainingBalance === null ? '—' : formatCurrency(creditRemainingBalance)}</span></div>
                                            </div>
                                        </div>
                                    )}
                                </section>
                            )}
                            {lastTransaction && (<>
                            {lastTransaction && <div className="flex justify-between border-b border-slate-100 pb-2"><span>Transaction ID</span><span className="font-mono font-semibold text-slate-900">{lastTransaction.id}</span></div>}<div className="grid grid-cols-2 gap-x-5 gap-y-1.5 border-b border-slate-100 pb-3"><span>Date &amp; Time</span><span className="text-right text-slate-900">{confirmationDate}</span><span>Cashier</span><span className="text-right text-slate-900">{lastTransaction?.cashier || currentUserFullName || currentUserName}</span><span>Payment Type</span><span className="text-right text-slate-900">{lastTransaction?.paymentMethod || (paymentType === 'credit' ? 'Credit' : 'Cash')}</span></div>
                            <section className="space-y-3"><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Order Summary</p><table className="w-full table-fixed"><colgroup><col className="w-[40%]"/><col className="w-[10%]"/><col className="w-[12%]"/><col className="w-[18%]"/><col className="w-[20%]"/></colgroup><thead><tr className="border-b border-slate-100"><th className="py-1.5 text-left font-semibold text-slate-700">Item</th><th className="py-1.5 text-center font-semibold text-slate-700">Qty</th><th className="py-1.5 text-center font-semibold text-slate-700">Unit</th><th className="py-1.5 text-right font-semibold text-slate-700">Unit Price</th><th className="py-1.5 text-right font-semibold text-slate-700">Amount</th></tr></thead><tbody>{confirmationItems.map((item, index) => <tr key={`${item.code}-${index}`} className="border-b border-slate-50"><td className="py-2"><div className="font-semibold text-slate-900">{getProductDisplayName(item, categoryDefinitions)}</div><div className="text-[11px] text-slate-500">{item.code}</div></td><td className="py-2 text-center">{item.qty}</td><td className="py-2 text-center">{getSellingUnit(item) || '—'}</td><td className="py-2 text-right whitespace-nowrap">{formatCurrency(item.price)}</td><td className="py-2 text-right whitespace-nowrap">{formatCurrency(item.price * item.qty)}</td></tr>)}</tbody></table><div className="space-y-1.5 border-t border-slate-200 pt-3"><div className="flex justify-between"><span>Net Amount</span><span>{formatCurrency(confirmationVat?.netAmount || 0)}</span></div><div className="flex justify-between"><span>{formatVatModeLabel(lastTransaction?.vatMode || selectedVatMode)}</span><span>{formatCurrency(confirmationVat?.vatAmount || 0)}</span></div><div className="mt-2 flex justify-between border-t border-slate-900 pt-2 text-lg font-semibold text-slate-900"><span>TOTAL</span><span>{formatCurrency(confirmationTotal)}</span></div>{lastTransaction && <><div className="flex justify-between pt-1 font-semibold uppercase"><span>Payment Status</span><span>{lastTransaction.paymentStatus}</span></div><div className="flex justify-between"><span>Cash Received</span><span>{lastTransaction.paymentMethod === 'Cash' ? formatCurrency(confirmationCash) : '—'}</span></div><div className="flex justify-between"><span>Change</span><span>{lastTransaction.paymentMethod === 'Cash' ? formatCurrency(confirmationChange) : '—'}</span></div></>}</div></section>
                            </>)}
                        </div></div>
                        <footer className={`${lastTransaction ? 'grid grid-cols-2' : 'flex justify-end'} gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:p-4`}>{lastTransaction ? <button type="button" onClick={completeOrderConfirmationPreview} className="col-span-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800">Continue to Reference</button> : <button type="button" data-validation-submit onClick={handleCheckout} disabled={isConfirmationPaymentDisabled} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{isCheckoutProcessing ? 'Processing…' : 'Confirm & Process Payment'}</button>}</footer>
                    </div>
                </div>
            )}
            {/* Legacy post-sale preview kept inactive; checkout uses the staged workflow above. */}
            {showReceipt && lastTransaction && (
                <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className={`flex ${ORDER_CONFIRMATION_PREVIEW_SIZE.modal} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
                        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3.5 sm:px-5 sm:py-4">
                            <div>
                                <h3 className="text-xl font-semibold text-gray-800 sm:text-2xl">{receiptTitle}</h3>
                            </div>
                            <button onClick={completeOrderConfirmationPreview} className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" aria-label="Close Order List preview">
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-6 sm:py-5" id="receipt-content">
                            <div className={`${ORDER_CONFIRMATION_PREVIEW_SIZE.content} px-1 text-xs leading-relaxed text-gray-600 sm:text-[13px]`}>
                            <div className="mb-4 border-y border-dashed border-gray-200 py-3">
                                <div className="mb-1 flex justify-between gap-3">
                                    <span className="text-gray-500">Transaction ID:</span>
                                    <span className="font-mono font-semibold text-gray-800">{lastTransaction.id}</span>
                                </div>
                                <div className="mb-1 flex justify-between gap-3">
                                    <span className="text-gray-500">Date &amp; Time:</span>
                                    <span className="text-gray-800">{lastTransaction.date}</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                    <span className="text-gray-500">Cashier:</span>
                                    <span className="text-gray-800">{lastTransaction.cashier}</span>
                                </div>
                                <div className="mt-1 flex justify-between gap-3">
                                    <span className="text-gray-500">Payment Type:</span>
                                    <span className="text-gray-800">{lastTransaction.paymentMethod || 'Cash'}</span>
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
                                                <div className="font-semibold text-gray-800 leading-tight">{item.brand && !item.displayNameIsFallback ? `${item.brand} ` : ''}{getProductDisplayName(item, categoryDefinitions)}{item.color && !item.displayNameIsFallback ? ` — ${item.color}` : ''}</div>
                                                <div className="text-[11px] leading-tight text-gray-500">{item.code}</div>
                                            </td>
                                            <td className="py-2 text-center">{item.qty}</td>
                                            <td className="py-2 text-right font-medium whitespace-nowrap">{formatCurrency(item.price)}</td>
                                            <td className="py-2 text-right font-medium">{formatCurrency(item.price * item.qty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 bg-gray-50 p-3 sm:p-4">
                            <button 
                                onClick={completeOrderConfirmationPreview}
                                className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold tracking-widest text-gray-600 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100"
                                style={{ border: '2px solid #e5e7eb' }}
                            >
                                Close
                            </button>
                            <button 
                                onClick={handlePrintOrderList}
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
            <div className="min-h-[400px] md:min-h-0 min-w-0 flex-1 bg-slate-200/50 rounded-2xl shadow-inner border border-slate-300 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex shrink-0 items-start justify-between gap-2 p-5 pb-0">
                    <div className="min-w-0">
                        <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Point of Sale</p>
                        <p className="text-gray-500 font-medium text-[11px] md:text-xs mt-1">Process transactions and manage orders</p>
                    </div>
                    <button
                        ref={cartToggleButtonRef}
                        type="button"
                        onClick={openCartDrawer}
                        aria-haspopup="dialog"
                        aria-expanded={isCartDrawerOpen}
                        aria-controls="pos-current-order-panel"
                        aria-label={`Open cart, ${cartItemCount} item${cartItemCount === 1 ? '' : 's'}`}
                        className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 md:hidden"
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 3h2l2.2 11.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6m4 12h.01M17 20h.01" />
                        </svg>
                        <span>Cart</span>
                        <span aria-live="polite" className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white transition-colors duration-200 motion-reduce:transition-none ${cartCountFeedback ? 'bg-slate-600' : 'bg-slate-900'}`}>
                            {cartItemCount}
                        </span>
                    </button>
                </div>
                
                {/* Search and Filter Header */}
                <div className="px-3 pb-5 pt-5 border-b border-gray-200 bg-transparent z-10 shrink-0 md:px-5">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        <div className="main-toolbar-search group w-full max-w-none md:max-w-[27.5rem] md:flex-1">
                            <input
                                type="text"
                                placeholder="Search products..."
                                value={searchQuery}
                                list="pos-search-suggestions"
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="main-toolbar-search-input"
                            />
                            <datalist id="pos-search-suggestions">
                                {posSearchSuggestions.map((term) => (
                                    <option key={term} value={term} />
                                ))}
                            </datalist>
                            <div className="main-toolbar-search-icon" aria-hidden="true">
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                        </div>
                        <ToolbarDropdown
                            value={selectedCategory}
                            options={categoryNames.map((category) => ({
                                value: category,
                                label: category === 'All' ? 'All Categories' : category,
                            }))}
                            onChange={setSelectedCategory}
                            ariaLabel="Filter POS products by category"
                            className="w-fit max-w-full self-start md:self-auto"
                            menuClassName="w-max min-w-[min(16rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-[min(50vh,20rem)] overflow-y-auto pr-3 [scrollbar-gutter:stable]"
                            compact
                            portalMenu
                            fitSelectedValue
                            softForeground
                            focusVisibleRing
                        />
                    </div>
                </div>

                {/* Product List */}
                <div ref={productListRef} className="pos-product-list min-w-0 flex-1 overflow-y-auto p-2 bg-transparent md:p-4">
                    {isInitialInventoryPending ? (
                        <>
                            <DesktopProductGridSkeleton />
                            <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:hidden" role="status" aria-label="Loading products" aria-busy="true">
                                {[0, 1, 2, 3].map((index) => <div key={`pos-mobile-product-skeleton-${index}`} className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white p-3 motion-reduce:animate-none"><div className="h-28 rounded-lg bg-slate-100" /><div className="mt-3 h-3 w-3/4 rounded bg-slate-200" /><div className="mt-2 h-3 w-1/2 rounded bg-slate-100" /><div className="mt-5 h-8 rounded-lg bg-slate-100" /></div>)}
                                <span className="sr-only">Loading products</span>
                            </div>
                        </>
                    ) : filteredProducts.length === 0 ? (
                        <div className="flex min-h-full items-center justify-center p-3">
                            <ContextualEmptyState {...posEmptyState} className="w-full max-w-md rounded-xl border border-slate-200 bg-white" />
                        </div>
                    ) : (
                        <>
                            <div className={`pos-product-grid grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 ${isInlineCartPanelCollapsed ? 'pos-product-grid-collapsed' : 'lg:grid-cols-4'}`}>
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
                                                        openVariantGroup(item);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            openVariantGroup(item);
                                                        }
                                                    }}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`group relative flex min-h-[318px] flex-col overflow-hidden rounded-xl border border-slate-100 bg-white text-left shadow-sm transition-all duration-300 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 focus-visible:ring-offset-2
                                                        ${isOutOfStock
                                                    ? 'border-slate-100 hover:border-red-400 hover:bg-red-50/20 hover:shadow-md'
                                                            : isLowStock
                                                                ? 'transform hover:-translate-y-1 hover:border-amber-400 hover:bg-amber-50/20 hover:shadow-lg motion-reduce:hover:translate-y-0'
                                                                : 'transform hover:-translate-y-1 hover:border-emerald-300 hover:bg-emerald-50/20 hover:shadow-lg motion-reduce:hover:translate-y-0'
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
                                                            {item.brand && !item.displayNameIsFallback && (
                                                                <span className="truncate font-medium">{item.brand}</span>
                                                            )}
                                                            {item.brand && !item.displayNameIsFallback && item.color && <span className="text-slate-300">•</span>}
                                                            {item.color && !item.displayNameIsFallback && (
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
                                                                        openVariantGroup(item);
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
                                        const recommendationAvailability = getPosRecommendationAvailability(item, inventory, settings, {
                                            categories: categoryDefinitions, cart,
                                            alternativeLimit: 1,
                                            limitPerTier: 1,
                                            budgetLimit: 9,
                                        });
                                        const hasAlternatives = recommendationAvailability.hasAny;
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
                                        className={`group relative flex min-h-[318px] flex-col overflow-hidden rounded-xl border border-slate-100 bg-white text-left shadow-sm transition-all duration-300 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 focus-visible:ring-offset-2
                                            ${isOutOfStock
                                                ? 'border-slate-100 hover:border-red-400 hover:bg-red-50/20 hover:shadow-md'
                                                : isLowStock
                                                    ? 'transform hover:-translate-y-1 hover:border-amber-400 hover:bg-amber-50/20 hover:shadow-lg motion-reduce:hover:translate-y-0'
                                                    : 'transform hover:-translate-y-1 hover:border-emerald-300 hover:bg-emerald-50/20 hover:shadow-lg motion-reduce:hover:translate-y-0'
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
                                                {item.brand && !item.displayNameIsFallback && (
                                                    <span className="truncate font-medium">{item.brand}</span>
                                                )}
                                                {item.brand && !item.displayNameIsFallback && (item.color || item.size) && <span className="text-slate-300">•</span>}
                                                {item.color && !item.displayNameIsFallback && (
                                                    <span className="truncate">{item.color}</span>
                                                )}
                                                {item.color && !item.displayNameIsFallback && item.size && <span className="text-slate-300">•</span>}
                                                {item.size && !item.displayNameIsFallback && (
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
            {(() => {
                const currentOrderPanel = (
                    <div
                id="pos-current-order-panel"
                ref={cartDrawerRef}
                role={isCartDrawerOpen && isMobilePosLayout ? 'dialog' : undefined}
                aria-modal={isCartDrawerOpen && isMobilePosLayout ? 'true' : undefined}
                aria-labelledby="pos-current-order-title"
                onKeyDown={isCartDrawerOpen && isMobilePosLayout ? handleCartDrawerKeyDown : undefined}
                className={`pos-current-order overflow-hidden border border-slate-200 bg-white shadow-sm flex-col md:w-96 md:min-h-[300px] md:h-full md:rounded-2xl md:z-20 ${isCartDrawerOpen && isMobilePosLayout ? 'pos-current-order-mobile-drawer fixed inset-0 z-[80] flex min-h-0 w-full rounded-none pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] md:relative md:inset-auto md:flex md:h-full md:min-h-0 md:rounded-2xl md:pt-0 md:pb-0 md:pl-0 md:pr-0' : 'hidden md:flex md:bg-slate-50/80'}`}
                inert={isInlineCartPanelCollapsed || Boolean(isCartDrawerOpen && isMobilePosLayout && isBulkRemoveConfirmationOpen)}
                aria-hidden={isInlineCartPanelCollapsed || Boolean(isCartDrawerOpen && isMobilePosLayout && isBulkRemoveConfirmationOpen) || undefined}
            >
                {/* Current Order Header */}
                <div className="pos-current-order-header flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-slate-600"><PosNavigationCartIcon /></span>
                        <h3 id="pos-current-order-title" tabIndex="-1" className="shrink-0 text-base font-semibold text-slate-900">Current Order</h3>
                        <span className="pos-current-order-count rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-200">{cartItemCount} items</span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                        {isCartDrawerOpen && isMobilePosLayout && (
                            <button
                                ref={cartDrawerCloseButtonRef}
                                type="button"
                                onClick={() => closeCartDrawer()}
                                aria-label="Close Current Order"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 md:hidden"
                            >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 6l12 12M18 6L6 18" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {/* Cart List Management */}
                {cart.length > 0 && (
                    <div className={`pos-cart-management shrink-0 border-b border-slate-200/80 bg-white px-3 py-2 text-[11px] md:bg-slate-50/80 ${isCartSelectionMode ? 'pos-cart-selection-toolbar' : ''}`}>
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
                <div className="pos-cart-list min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white p-3 space-y-2 md:bg-slate-100/70">
                    {cart.length === 0 ? (
                        <div className="pos-cart-empty flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                            <div className="pos-cart-empty-icon flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500">
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                            </div>
                            <div className="space-y-0.5">
                                <h4 className="text-sm font-semibold text-slate-700">Your cart is empty</h4>
                                <p className="text-xs leading-5 text-slate-500">Add products from the list to start an order.</p>
                            </div>
                        </div>
                    ) : (
                        cart.map(item => {
                            const isSelected = selectedCartItemCodes.includes(item.code);

                            return (
                            <div
                                key={item.code}
                                data-pos-cart-item-card
                                tabIndex={0}
                                role="group"
                                aria-label={isCartSelectionMode
                                    ? `${item.name}, SKU ${item.code}. Press Enter or Space to toggle selection for removal.`
                                    : `View product details for ${item.name}, SKU ${item.code}. Press Enter or Space to open.`}
                                aria-keyshortcuts="Enter Space"
                                onClick={(event) => handleCartItemClick(event, item.code)}
                                onKeyDown={(event) => handleCartItemKeyDown(event, item)}
                                onTouchStart={(event) => handleCartItemTouchStart(event, item.code)}
                                onTouchMove={(event) => handleCartItemTouchMove(event, item.code)}
                                onTouchEnd={handleCartItemTouchEnd}
                                onTouchCancel={handleCartItemTouchEnd}
                                onContextMenu={preventMobileCartCardSelection}
                                onSelectStart={preventMobileCartCardSelection}
                                data-selected={isCartSelectionMode ? isSelected : undefined}
                                className={`pos-cart-item pos-current-order-item-card group rounded-xl border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500 ${isCartSelectionMode ? isSelected ? 'cursor-pointer border-slate-400 bg-slate-50/80 hover:border-slate-500' : 'cursor-pointer border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50/60' : 'cursor-pointer border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50/60'}`}
                            >
                                <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2.5">
                                    <ProductThumbnail item={item} className="h-12 w-12 rounded-lg" fit="contain" interactive={false} />
                                    <div className="min-w-0 space-y-1.5">
                                        <div className="flex min-w-0 items-start gap-1.5">
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
                                            <div className="min-w-0 flex-1">
                                                <h4 className="line-clamp-2 font-semibold text-xs leading-4 text-slate-800">
                                                    {item.brand && !item.displayNameIsFallback && <span className="font-medium text-slate-400">{item.brand} </span>}
                                                    {item.name}
                                                    {item.color && !item.displayNameIsFallback && <span className="text-gray-400 font-normal text-xs"> — {item.color}</span>}
                                                </h4>
                                                <p className="mt-0.5 truncate text-[10px] leading-3 text-slate-500" title={item.code}>{item.code}</p>
                                            </div>
                                            {!isCartSelectionMode && <button type="button" data-pos-cart-item-remove onClick={(event) => { event.stopPropagation(); requestSingleCartRemoval(item, event); }} className="pos-cart-item-remove inline-flex shrink-0 items-center gap-1 rounded-md p-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 md:gap-0 md:p-0.5 md:text-slate-400 md:hover:bg-slate-100 md:hover:text-rose-500" aria-label={`Remove ${item.name} from order`}>
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                                <span className="md:hidden">Remove</span>
                                            </button>}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <div onClick={(event) => event.stopPropagation()} className="pos-cart-item-controls flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                                                <button
                                                    onClick={(event) => item.qty <= 1 ? requestSingleCartRemoval(item, event) : updateQuantity(item.code, item.qty - 1)}
                                                    className="flex h-6 w-6 items-center justify-center rounded bg-white pb-0.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
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
                                                    className="w-9 bg-transparent text-center text-xs font-semibold outline-none"
                                                />
                                                <button
                                                    onClick={() => updateQuantity(item.code, item.qty + 1)}
                                                    className="flex h-6 w-6 items-center justify-center rounded bg-slate-900 pb-0.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
                                                >
                                                    +
                                                </button>
                                            </div>
                                            <div className="min-w-0 flex-1 text-right tabular-nums">
                                                <span className="block whitespace-nowrap text-sm font-semibold text-slate-900">{formatCurrency(item.price * item.qty)}</span>
                                                <p className="whitespace-nowrap text-[10px] leading-3 text-slate-500">@ {formatCurrency(item.price)}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            );
                        })
                    )}
                </div>

                <div className="pos-checkout-panel relative z-30 shrink-0 border-t border-slate-200/80 bg-white p-3 md:bg-slate-50/80">
                    <div className="flex gap-2 border-t border-slate-100 pt-2.5">
                        <div className={`relative group w-[34%] shrink-0 ${cart.length === 0 ? 'cursor-not-allowed' : ''}`}>
                            <button 
                                onClick={() => runCartAction(handleGenerateQuotation)}
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
                                onClick={() => runCartAction(openOrderList)}
                                disabled={isCheckoutDisabled}
                                className={`w-full py-2.5 rounded-lg border border-slate-900 bg-slate-900 text-[10px] font-semibold uppercase tracking-wider text-white flex items-center justify-center shadow-sm transition-colors duration-150 ${isCheckoutDisabled ? 'pointer-events-none opacity-50' : 'hover:bg-slate-800'}`}
                            >
                                Review Order
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
                );

                if (isCartDrawerOpen && isMobilePosLayout && typeof document !== 'undefined') {
                    return createPortal(
                        <>
                            <div
                                className="fixed inset-0 z-[79] bg-slate-950/40 backdrop-blur-[2px] md:hidden"
                                aria-hidden="true"
                                onClick={() => closeCartDrawer()}
                            />
                            {currentOrderPanel}
                        </>,
                        document.body,
                    );
                }

                return (
                    <div
                        id="pos-current-order-shell"
                        className={`pos-current-order-shell relative hidden h-full min-h-[300px] shrink-0 overflow-hidden rounded-2xl md:block md:transform-gpu md:transition-[width,transform] md:duration-420 md:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${isInlineCartPanelCollapsed ? 'md:w-11' : 'md:w-96'}`}
                    >
                        <div className={`absolute inset-y-0 left-0 z-20 w-96 md:transform-gpu md:transition-transform md:duration-420 md:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${isInlineCartPanelCollapsed ? 'md:translate-x-full' : 'md:translate-x-0'}`}>
                            {currentOrderPanel}
                        </div>
                        {isInlineCartPanelCollapsed ? (
                            <div
                                role="group"
                                aria-label="Current Order actions"
                                onClick={(event) => {
                                    if (!event.target.closest?.('[data-current-order-rail-action]')) setIsCurrentOrderCollapsed(false);
                                }}
                                className="absolute inset-y-0 right-0 z-30 flex h-full w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-0.5 py-2 text-slate-700 shadow-sm transition-colors hover:bg-white"
                            >
                                <ViewportTooltip content="Current Order" maxWidth={180} placementPreference="left" triggerGap={10} openDelay={140} closeDelay={80} animateAppearance>
                                    <button
                                        type="button"
                                        data-current-order-rail-action
                                        onClick={() => setIsCurrentOrderCollapsed(false)}
                                        aria-controls="pos-current-order-panel"
                                        aria-expanded="false"
                                        aria-label={`Current Order, ${cartItemCount} items`}
                                        className="inline-flex min-h-12 w-9 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-transparent text-slate-700 transition-colors hover:border-slate-200 hover:bg-white active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1"
                                    >
                                        <PosNavigationCartIcon />
                                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold leading-none tabular-nums text-white" aria-live="polite">{cartItemCount}</span>
                                    </button>
                                </ViewportTooltip>
                                <ViewportTooltip content="Prepare Quotation" maxWidth={180} placementPreference="left" triggerGap={10} openDelay={140} closeDelay={80} animateAppearance>
                                    <button
                                        type="button"
                                        data-current-order-rail-action
                                        onClick={(event) => { event.stopPropagation(); runCartAction(handleGenerateQuotation); }}
                                        disabled={cart.length === 0}
                                        aria-label="Prepare Quotation"
                                        title={cart.length === 0 ? 'Add item first' : undefined}
                                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-700 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <RecordActionIcon name="file-plus" className="h-5 w-5 shrink-0" />
                                    </button>
                                </ViewportTooltip>
                                <ViewportTooltip content="Review Order" maxWidth={180} placementPreference="left" triggerGap={10} openDelay={140} closeDelay={80} animateAppearance>
                                    <button
                                        type="button"
                                        data-current-order-rail-action
                                        onClick={(event) => { event.stopPropagation(); runCartAction(openOrderList); }}
                                        disabled={isCheckoutDisabled}
                                        aria-label="Review Order"
                                        title={isCheckoutDisabled ? checkoutDisabledMessage : undefined}
                                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-700 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <RecordActionIcon name="clipboard-check" className="h-5 w-5 shrink-0" />
                                    </button>
                                </ViewportTooltip>
                                <ViewportTooltip content="Show Current Order" maxWidth={180} placementPreference="left" triggerGap={10} openDelay={140} closeDelay={80} animateAppearance>
                                    <button
                                        type="button"
                                        data-current-order-rail-action
                                        onClick={() => setIsCurrentOrderCollapsed(false)}
                                        aria-controls="pos-current-order-panel"
                                        aria-expanded="false"
                                        aria-label={`Show Current Order, ${cartItemCount} items`}
                                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 active:bg-slate-100"
                                    >
                                        <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m15 18-6-6 6-6" /></svg>
                                    </button>
                                </ViewportTooltip>
                            </div>
                        ) : (
                            <ViewportTooltip
                                content="Hide Current Order"
                                maxWidth={180}
                                placementPreference="left"
                                positionAnchorId="pos-current-order-toggle-anchor"
                                triggerGap={10}
                                openDelay={140}
                                closeDelay={80}
                                animateAppearance
                                triggerClassName="absolute right-2 top-2 z-30 h-8 w-8"
                            >
                                <button
                                    type="button"
                                    onClick={() => setIsCurrentOrderCollapsed(true)}
                                    aria-controls="pos-current-order-panel"
                                    aria-expanded="true"
                                    aria-label="Hide Current Order"
                                    className="relative inline-flex h-full w-full shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1"
                                >
                                    <span id="pos-current-order-toggle-anchor" aria-hidden="true" className="pointer-events-none absolute -left-px top-1/2 h-px w-px -translate-y-1/2" />
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 18 6-6-6-6" /></svg>
                                </button>
                            </ViewportTooltip>
                        )}
                    </div>
                );
            })()}
        </div>
        
        {productDetailsItem && !enlargedProductImage && (
            <ProductDetailsModalShell
                dialogRef={productDetailsDialogRef}
                closeButtonRef={productDetailsCloseButtonRef}
                onClose={() => setProductDetailsItem(null)}
                backdropZIndexClassName={isCartDrawerOpen && isMobilePosLayout ? 'z-[90]' : 'z-50'}
                aria-labelledby="pos-product-details-title"
            >
                <div className="flex gap-4">
                    <ProductThumbnail item={productDetailsItem} className="h-28 w-28 shrink-0 rounded-xl" onPreview={handleProductImagePreviewClick} fit="contain" />
                    <div className="min-w-0 py-1">
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                            {productDetailsItem.category ? `Product Type · ${productDetailsItem.category}` : 'Product'}
                        </p>
                        <h4 className="mt-1 text-base font-semibold leading-snug text-slate-900">{productDetailsItem.name}</h4>
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
                        <dd className="mt-1 break-words font-medium text-slate-800">{productDetailsItem.isGroup ? productDetailsItem.variants.length : productDetailsItem.code}</dd>
                    </div>
                    <div>
                        <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Stock</dt>
                        <dd className="mt-1 break-words font-medium text-slate-800">{productDetailsItem.stock}{getSellingUnit(productDetailsItem) ? ` ${getSellingUnit(productDetailsItem)}` : ''} available</dd>
                    </div>
                    {!productDetailsItem.isGroup && productDetailsItem.supplierName && (
                        <div className="min-w-0">
                            <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Supplier</dt>
                            <dd className="mt-1 break-words font-medium text-slate-800">{productDetailsItem.supplierName}</dd>
                        </div>
                    )}
                </dl>
                {productDetailsSpecifications.length > 0 && (
                    <section className="mt-4 border-t border-slate-100 pt-4" aria-label="Product specifications">
                        <h5 className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Specifications</h5>
                        <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-3 text-xs min-[380px]:grid-cols-2">
                            {productDetailsSpecifications.map(({ name, value }) => (
                                <div key={name} className="min-w-0">
                                    <dt className="text-[10px] font-medium text-slate-500">{name}</dt>
                                    <dd className="mt-0.5 break-words font-medium leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                )}
            </ProductDetailsModalShell>
        )}

        {/* Recommendation Modal */}
        {recommendationModal.isOpen && (
            <div className="app-modal-backdrop recommendation-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                <div ref={recommendationDialogRef} tabIndex={-1} className="recommendation-modal recommendation-results-modal w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200" role="dialog" aria-modal="true" aria-labelledby="pos-recommendation-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        closeRecommendationModal();
                        return;
                    }
                    if (event.key !== 'Tab') return;
                    const controls = [...(recommendationDialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || [])].filter((control) => control.getClientRects().length > 0);
                    const first = controls[0];
                    const last = controls.at(-1);
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last?.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first?.focus();
                    }
                }}>
                    <div className="recommendation-modal-header border-b border-slate-100 bg-white px-4 py-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 id="pos-recommendation-title" className="text-sm font-semibold tracking-tight text-slate-900">
                                        Alternative Products
                                    </h3>
                                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                                        {recommendationModal.item.brand && !recommendationModal.item.displayNameIsFallback ? `${recommendationModal.item.brand} ` : ''}{recommendationModal.item.name}{recommendationModal.item.color && !recommendationModal.item.displayNameIsFallback ? ` — ${recommendationModal.item.color}` : ''} ({recommendationModal.item.code})
                                    </p>
                                </div>
                            </div>
                            <button
                                ref={recommendationCloseButtonRef}
                                type="button"
                                onClick={closeRecommendationModal}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Close recommendations"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    <div className="recommendation-modal-body bg-slate-50/60 p-4">
                        {liveRecommendationOptions.hasAny ? (
                            <div className="recommendation-results-scroll -mr-2 max-h-[430px] overflow-y-auto pr-2">
                                {[
                                    { title: 'Matching Alternatives', items: liveRecommendationOptions.alternatives },
                                    { title: 'Other Available Options', items: liveRecommendationOptions.otherOptions },
                                ].filter((section) => section.items.length > 0).map((section) => (
                                    <section key={section.title} aria-label={section.title} className="mb-4 last:mb-0">
                                        <h4 className="mb-2 text-xs font-semibold text-slate-700">{section.title}</h4>
                                        <div className="grid grid-cols-1 items-start gap-3 pb-2 sm:grid-cols-2">
                                    {section.items.map((alt) => {
                                        const maxAddable = getPosRemainingAddableQuantity(alt, cart);
                                        const storedQuantity = Number(recommendationQuantities[alt.code]) || 1;
                                        const selectedQuantity = Math.min(Math.max(1, storedQuantity), Math.max(1, maxAddable));
                                        const specifications = getProductDetailsSpecifications(alt, categoryDefinitions);
                                        return (
                                            <div key={alt.code} className="recommendation-result-card rounded-xl border border-slate-200 bg-white p-3">
                                                <div className="flex gap-3">
                                                    <ProductThumbnail item={alt} className="h-14 w-14 shrink-0 rounded-lg" onPreview={handleProductImagePreviewClick} fit="contain" />
                                                    <div className="min-w-0 flex-1">
                                                        <h5 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
                                                            {alt.brand && <span className="text-slate-500">{alt.brand} </span>}
                                                            {alt.name}
                                                        </h5>
                                                        <p className="mt-1 break-words text-[10px] leading-snug text-slate-500">
                                                            {getPosVariantOptionLabel(alt, getEffectiveProductAttributes(categoryDefinitions.find((category) => category.name === alt.category) || {}))}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                                                    <p className="text-[15px] font-semibold tracking-tight text-slate-900">{formatCurrency(alt.price)}</p>
                                                    <span className="recommendation-stock-badge text-[11px] text-slate-600">Available: {maxAddable} {alt.sellingUnit}</span>
                                                </div>
                                                <PosRecommendationReasons recommendation={alt.recommendation} />
                                                {specifications.length > 0 && (
                                                    <details className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
                                                        <summary className="w-fit cursor-pointer rounded-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700">View Details</summary>
                                                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                                            {specifications.map(({ name, value }) => <div key={name} className="min-w-0"><dt className="text-[9px] text-slate-400">{name}</dt><dd className="break-words font-medium text-slate-700">{value}</dd></div>)}
                                                        </dl>
                                                    </details>
                                                )}
                                                <div className="mt-3 flex items-center justify-between gap-2">
                                                    <div role="group" className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label={`Quantity for ${alt.name}`}>
                                                        <button type="button" disabled={selectedQuantity <= 1} onClick={() => updateRecommendationQuantity(alt, selectedQuantity - 1)} className="flex h-8 w-8 items-center justify-center text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-800" aria-label={`Decrease quantity for ${alt.name}`}>−</button>
                                                        <input type="text" inputMode="numeric" pattern="[0-9]*" min="1" max={maxAddable} value={selectedQuantity} onKeyDown={preventInvalidWholeNumberKeyDown} onPaste={preventInvalidWholeNumberPaste} onChange={(event) => updateRecommendationQuantity(alt, event.target.value)} className="h-8 w-10 border-x border-slate-200 text-center text-xs font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-800" aria-label={`Quantity to add for ${alt.name}`} />
                                                        <button type="button" disabled={selectedQuantity >= maxAddable} onClick={() => updateRecommendationQuantity(alt, selectedQuantity + 1)} className="flex h-8 w-8 items-center justify-center text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-800" aria-label={`Increase quantity for ${alt.name}`}>+</button>
                                                    </div>
                                                    <button type="button" disabled={maxAddable < 1 || recommendationAddInProgressRef.current} onClick={(event) => { event.stopPropagation(); addRecommendedAlternativeToCart(alt, selectedQuantity); }} className="min-h-8 whitespace-nowrap rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500">
                                                        Add to Cart
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                        </div>
                                    </section>
                                ))}
                        </div>
                        ) : (
                            <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                <svg className="w-12 h-12 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <h3 className="text-sm font-semibold text-gray-900">Alternatives are no longer available.</h3>
                                <p className="mt-0.5 text-xs text-gray-500">Recheck stock and recommendations, then try again.</p>
                            </div>
                        )}
                    </div>

                    <div className="recommendation-modal-footer flex justify-end gap-3 border-t border-slate-100 bg-white px-4 py-3">
                        <button 
                            onClick={closeRecommendationModal}
                            className="recommendation-modal-cancel rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                            {recommendationModal.type === 'low-stock' && (
                            <button
                                type="button"
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
        {variantModal.isOpen && variantModal.group && !enlargedProductImage && !recommendationModal.isOpen && !productDetailsItem && (
            <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md transition-all">
                <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-[0_16px_44px_-20px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/10 max-h-[82vh] animate-in fade-in zoom-in-95 duration-300">
                    <div className="relative z-10 border-b border-slate-200 bg-white/95 px-4 py-3">
                        <div className="flex items-center gap-3 pr-9">
                            {variantModal.step === 'variants' && (
                                <ProductThumbnail item={variantModalImageItem} className="h-12 w-12" onPreview={handleProductImagePreviewClick} fit="contain" />
                            )}
                            <div className="min-w-0 flex-1">
                                {variantModal.step === 'variants' && variantModal.group.brandOptions?.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => setVariantModal(prev => ({ ...prev, step: 'brand', selectedBrand: null, selectedAttributes: {}, selectedVariantCode: null, selectedVariantId: null, quantity: 1 }))}
                                        className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 transition-colors hover:text-slate-900"
                                    >
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                                        Brands
                                    </button>
                                )}
                                <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-slate-900">
                                    {variantModal.group.name}
                                </h3>
                                <p className="mt-1 truncate text-[10px] font-medium text-slate-500">
                                    {variantModal.step === 'brand'
                                        ? 'Select a brand'
                                        : [
                                            variantModal.group.brandOptions?.find((option) => option.key === variantModal.selectedBrand)?.label
                                                || (variantModal.group.brand !== 'Multiple Brands' ? variantModal.group.brand : ''),
                                            variantModalSelectedVariant?.code ? `Item Code: ${variantModalSelectedVariant.code}` : '',
                                        ].filter(Boolean).join(' · ') || 'Select product options'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setVariantModal(createClosedVariantModalState())}
                            className="absolute right-4 top-3 rounded-lg bg-slate-50 p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Close product options"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto w-full max-h-full">
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
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`${brandOption.label}${isBrandOutOfStock ? ', sold out' : ''}`}
                                            className={`group relative flex min-h-[120px] flex-col items-center justify-center rounded-xl border p-3 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-1
                                                ${isBrandOutOfStock 
                                                    ? 'cursor-pointer border-rose-200 bg-rose-50/30'
                                                    : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                                }`}
                                            onClick={() => {
                                                setVariantModal(prev => ({ ...prev, step: 'variants', selectedBrand: brandOption.key, selectedAttributes: {}, selectedVariantCode: null, selectedVariantId: null, quantity: 1 }));
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                                                event.preventDefault();
                                                setVariantModal(prev => ({ ...prev, step: 'variants', selectedBrand: brandOption.key, selectedAttributes: {}, selectedVariantCode: null, selectedVariantId: null, quantity: 1 }));
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
                                    const selectionModel = getPosAttributeSelectionModel(
                                        filteredVariants, variantModal.group.attributeDefinitions, variantModal.selectedAttributes,
                                        variantModal.selectedVariantCode ? { code: variantModal.selectedVariantCode, id: variantModal.selectedVariantId } : null
                                    );
                                    const matchedVariant = selectionModel.matchedVariant;
                                    const remainingAddable = getPosRemainingAddableQuantity(matchedVariant, cart);
                                    const reservedQuantity = matchedVariant
                                        ? Math.max(0, Number(matchedVariant.stock || 0) - remainingAddable) : 0;
                                    const canAddSelectedVariant = Boolean(matchedVariant && remainingAddable > 0);
                                    const maxSelectableQty = Math.max(1, remainingAddable);
                                    const selectedQuantity = Math.min(Math.max(1, Number(variantModal.quantity) || 1), maxSelectableQty);
                                    const selectedRecommendationAvailability = matchedVariant
                                        ? getPosRecommendationAvailability(matchedVariant, inventory, settings, { categories: categoryDefinitions, cart, requestedQuantity: selectedQuantity })
                                        : null;
                                    const canOpenAlternatives = Boolean(matchedVariant && selectedRecommendationAvailability?.hasAny);
                                    const selectedRecommendationAction = getPosRecommendationAction(selectedRecommendationAvailability);
                                    const selectedRecommendationLabel = 'Recommendations';
                                    const isPrimaryDisabled = !matchedVariant || (!canAddSelectedVariant && !canOpenAlternatives);
                                    const selectedUnitPrice = Number(matchedVariant?.price || 0);
                                    const selectedSellingUnit = matchedVariant ? getSellingUnit(matchedVariant) : '';
                                    const selectedStockStatus = matchedVariant ? getStockStatus(matchedVariant, settings) : '';
                                    const selectedAttributeValues = matchedVariant
                                        ? productAttributeValues(matchedVariant, variantModal.group.attributeDefinitions || [])
                                        : {};
                                    const selectedAttributes = (variantModal.group.attributeDefinitions || [])
                                        .map((definition) => ({
                                            key: definition.key,
                                            name: definition.name,
                                            rawValue: selectedAttributeValues[definition.key],
                                            value: formatProductAttributeValue(definition, selectedAttributeValues[definition.key]),
                                            distinctValueCount: new Set(filteredVariants.map((variant) => {
                                                const values = productAttributeValues(variant, [definition]);
                                                const value = values[definition.key];
                                                return value === undefined || value === null ? '' : String(value).trim().toLowerCase();
                                            })).size,
                                        }))
                                        .filter(({ rawValue, distinctValueCount }) => (
                                            distinctValueCount > 1
                                            && rawValue !== undefined
                                            && rawValue !== null
                                            && String(rawValue).trim() !== ''
                                        ));
                                    const selectAttribute = (key, optionKey) => {
                                        const next = getPosAttributeSelectionModel(
                                            filteredVariants, variantModal.group.attributeDefinitions,
                                            { ...selectionModel.selections, [key]: optionKey },
                                            variantModal.selectedVariantCode ? { code: variantModal.selectedVariantCode, id: variantModal.selectedVariantId } : null
                                        );
                                        const keepExplicitSku = next.matchedVariant?.code === variantModal.selectedVariantCode
                                            && String(next.matchedVariant?.id) === String(variantModal.selectedVariantId);
                                        setVariantModal((previous) => ({ ...previous,
                                            selectedAttributes: next.selections,
                                            selectedVariantCode: keepExplicitSku ? previous.selectedVariantCode : null,
                                            selectedVariantId: keepExplicitSku ? previous.selectedVariantId : null,
                                            quantity: 1,
                                        }));
                                    };

                                    return (
                                        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/70">
                                            <div className="flex-1 overflow-y-auto p-4">
                                                <div className="mb-4 border-b border-slate-200 pb-3">
                                                    {matchedVariant ? (
                                                        <>
                                                            <div className="flex items-end justify-between gap-4">
                                                                <div className="min-w-0">
                                                                    <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                                                                        {selectedSellingUnit ? `Price per ${selectedSellingUnit}` : 'Price'}
                                                                    </p>
                                                                    <p className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">{formatCurrency(selectedUnitPrice)}</p>
                                                                </div>
                                                                <div className="shrink-0 text-right">
                                                                    <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Available Stock</p>
                                                                    <p className={`mt-0.5 text-sm font-semibold ${
                                                                        selectedStockStatus === 'Out of Stock'
                                                                            ? 'text-rose-600'
                                                                            : selectedStockStatus === 'Low Stock'
                                                                                ? 'text-amber-600'
                                                                                : 'text-slate-800'
                                                                    }`}>
                                                                        {matchedVariant.stock}{selectedSellingUnit ? ` ${selectedSellingUnit}` : ''}
                                                                    </p>
                                                                    {reservedQuantity > 0 && <p className="text-[10px] text-slate-500">Available to add: {remainingAddable}</p>}
                                                                </div>
                                                            </div>
                                                            {selectedAttributes.length > 0 && (
                                                                <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                                                    {selectedAttributes.map((attribute) => (
                                                                        <div key={attribute.key} className="flex min-w-0 items-baseline gap-1.5 text-[11px]">
                                                                            <dt className="font-medium text-slate-500">{attribute.name}:</dt>
                                                                            <dd className="font-semibold text-slate-800">{attribute.value}</dd>
                                                                        </div>
                                                                    ))}
                                                                </dl>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div className="flex items-center justify-between gap-3">
                                                            <h4 className="text-lg font-semibold tracking-tight text-slate-900">
                                                                {Math.min(...filteredVariants.map(v => v.price)) === Math.max(...filteredVariants.map(v => v.price))
                                                                    ? formatCurrency(Math.min(...filteredVariants.map(v => v.price)))
                                                                    : `${formatCurrency(Math.min(...filteredVariants.map(v => v.price)))} - ${formatCurrency(Math.max(...filteredVariants.map(v => v.price)))}`}
                                                            </h4>
                                                            <p className="text-[10px] font-semibold text-slate-500">Select options</p>
                                                        </div>
                                                    )}
                                                    <button
                                                        ref={productDetailsTriggerRef}
                                                        type="button"
                                                        disabled={!matchedVariant}
                                                        aria-label={matchedVariant ? `View details for ${matchedVariant.name}, SKU ${matchedVariant.code}` : 'View product details after selecting all available options'}
                                                        title={matchedVariant ? `View details for ${matchedVariant.code}` : 'Select all product options to view variant details'}
                                                        onClick={() => {
                                                            if (!matchedVariant) return;
                                                            returnFocusToProductDetailsTriggerRef.current = true;
                                                            setProductDetailsItem(matchedVariant);
                                                        }}
                                                        className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white"
                                                    >
                                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" strokeWidth="2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v-4m0-4h.01" /></svg>
                                                        View Details
                                                    </button>
                                                </div>

                                                {selectionModel.groups.map((group) => (
                                                    <div key={group.key} className="mb-4">
                                                        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-800">{group.label}</h5>
                                                        <div className="flex flex-wrap gap-2">
                                                            {group.options.map((option) => {
                                                                const isSelected = selectionModel.selections[group.key] === option.key;
                                                                return (
                                                                    <ViewportTooltip key={option.key} content={!option.exists ? 'Not available with the selected options' : !option.hasStock ? 'Sold out' : null}>
                                                                        <button
                                                                            type="button"
                                                                            disabled={!option.exists}
                                                                            aria-pressed={isSelected}
                                                                            aria-label={!option.hasStock && option.exists ? option.label + '. Sold out.' : undefined}
                                                                            onClick={() => selectAttribute(group.key, isSelected ? null : option.key)}
                                                                            className={['min-h-9 min-w-[52px] max-w-full rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-1',
                                                                                isSelected ? 'border-slate-900 bg-slate-900 text-white' : !option.exists ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300' : !option.hasStock ? 'border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
                                                                            ].join(' ')}
                                                                        >
                                                                            {option.label}
                                                                        </button>
                                                                    </ViewportTooltip>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}

                                                {selectionModel.codeOptions.length > 0 && (
                                                    <div className="mb-4">
                                                        <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-800">Item Code</h5>
                                                        <div className="flex flex-wrap gap-2">
                                                            {selectionModel.codeOptions.map((variant) => {
                                                                const isSelected = matchedVariant?.code === variant.code && matchedVariant?.id === variant.id;
                                                                const hasStock = Number(variant.stock) > 0;
                                                                return (
                                                                    <ViewportTooltip key={variant.id || variant.code} content={!hasStock ? 'Sold out' : null}>
                                                                        <button
                                                                            type="button"
                                                                            aria-pressed={isSelected}
                                                                            aria-label={!hasStock ? variant.code + '. Sold out.' : undefined}
                                                                            onClick={() => setVariantModal((previous) => ({
                                                                                ...previous, selectedVariantCode: variant.code,
                                                                                selectedVariantId: variant.id, quantity: 1,
                                                                            }))}
                                                                            className={['min-h-9 max-w-full rounded-lg border px-3 py-2 text-left text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-1',
                                                                                isSelected ? 'border-slate-900 bg-slate-900 text-white' : !hasStock ? 'border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
                                                                            ].join(' ')}
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
                                                            <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-widest">
                                                                {selectedSellingUnit ? `Quantity (${selectedSellingUnit})` : 'Quantity'}
                                                            </p>
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
                                                    disabled={isPrimaryDisabled || isVariantAddProcessing}
                                                    aria-busy={isVariantAddProcessing || undefined}
                                                    onClick={() => {
                                                        if (canAddSelectedVariant && matchedVariant) {
                                                            if (variantAddInProgressRef.current) return;
                                                            variantAddInProgressRef.current = true;
                                                            setIsVariantAddProcessing(true);
                                                            const existingItem = cart.find((item) => item.code === matchedVariant.code);
                                                            variantAddPendingRef.current = {
                                                                code: matchedVariant.code,
                                                                expectedQuantity: Number(existingItem?.qty || 0) + selectedQuantity,
                                                            };
                                                            const added = addToCart(matchedVariant, true, {
                                                                quantity: selectedQuantity,
                                                                fromVariantModal: true,
                                                            });
                                                            if (!added) {
                                                                variantAddPendingRef.current = null;
                                                                variantAddInProgressRef.current = false;
                                                                setIsVariantAddProcessing(false);
                                                            }
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
                                                    className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold uppercase tracking-widest transition-colors ${isPrimaryDisabled || isVariantAddProcessing ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                                                >
                                                    {!matchedVariant ? "Select Options Required" : (canAddSelectedVariant ? "Add to Cart" : canOpenAlternatives ? "View Recommendations" : "Unavailable")}
                                                </button>
                                                {canAddSelectedVariant && matchedVariant && selectedRecommendationAction && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            openAvailableRecommendations(matchedVariant, selectedRecommendationAvailability, { requestedQuantity: selectedQuantity });
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
            <div className="app-modal-backdrop fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="quick-add-credit-customer-title">
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
                                name="customerName"
                                data-validation-key="customerName"
                                type="text"
                                required
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

        {/* Regular Customer Quotation Selector */}
        {showQuotationCustomerSelector && (
            <div className="app-modal-backdrop fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quotation-customer-title">
                <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Regular Customer</p>
                            <h2 id="quotation-customer-title" className="mt-0.5 text-base font-semibold text-slate-900 dark:text-white">Select customer</h2>
                        </div>
                        <button type="button" onClick={() => setShowQuotationCustomerSelector(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-700 dark:hover:text-white" aria-label="Close regular customer selector">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" /></svg>
                        </button>
                    </header>
                    <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                        <label className="sr-only" htmlFor="quotation-customer-search">Search regular customers</label>
                        <div className="relative">
                            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
                            <input id="quotation-customer-search" type="search" value={quotationCustomerQuery} onChange={(event) => setQuotationCustomerQuery(event.target.value)} placeholder="Search name, email, contact, or address" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white" autoFocus />
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {filteredQuotationCustomers.length === 0 ? (
                            <div className="flex flex-col items-center px-4 py-10 text-center">
                                <svg className="h-8 w-8 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m-2-7.96a4 4 0 0 1 0 7.75" /></svg>
                                <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">No regular customers found</p>
                                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Only active regular customer records appear here.</p>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {filteredQuotationCustomers.map((customer) => (
                                    <button key={customer._id || customer.id} type="button" onClick={() => openQuotationDetails(customer)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500 dark:hover:bg-slate-700">
                                        <span className="block truncate text-xs font-semibold text-slate-900 dark:text-white">{customer.name}</span>
                                        <span className="mt-1 block truncate text-[10px] text-slate-500 dark:text-slate-400">{[customer.address, customer.contact, customer.email].filter(Boolean).join(' · ') || 'No contact details provided'}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <footer className="flex justify-between border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                        <button type="button" onClick={() => setShowQuotationCustomerSelector(false)} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Back</button>
                    </footer>
                </div>
            </div>
        )}

        {/* Regular Customer Quotation Details */}
        {showQuotationDetails && selectedQuotationCustomer && (
            <div className="app-modal-backdrop fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quotation-details-title">
                <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Regular Customer</p>
                            <h2 id="quotation-details-title" className="mt-0.5 text-base font-semibold text-slate-900 dark:text-white">Quotation Details</h2>
                        </div>
                        <button
                            type="button"
                            onClick={returnToQuotationCustomerSelector}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                            aria-label="Close quotation details"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" /></svg>
                        </button>
                    </header>

                    <form onSubmit={previewFormalQuotation} className="flex min-h-0 flex-1 flex-col">
                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                            <section>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Customer</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{selectedQuotationCustomer.name}</p>
                                {selectedQuotationCustomer.address && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{selectedQuotationCustomer.address}</p>}
                            </section>

                            <section className="space-y-2.5 border-t border-slate-200 pt-4 dark:border-slate-700">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">ATTN.</p>
                                <div>
                                    <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300" htmlFor="quotation-attention-name">Name</label>
                                    <input
                                        id="quotation-attention-name"
                                        type="text"
                                        value={quotationDetails.attentionName}
                                        onChange={(event) => setQuotationDetails((previous) => ({ ...previous, attentionName: event.target.value }))}
                                        placeholder="Optional"
                                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:ring-slate-600"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300" htmlFor="quotation-attention-position">Position / Department</label>
                                    <input
                                        id="quotation-attention-position"
                                        type="text"
                                        value={quotationDetails.attentionPosition}
                                        onChange={(event) => setQuotationDetails((previous) => ({ ...previous, attentionPosition: event.target.value }))}
                                        placeholder="Optional"
                                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:ring-slate-600"
                                    />
                                </div>
                            </section>

                            <section className="border-t border-slate-200 pt-4 dark:border-slate-700">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Authorized Signatory</p>
                                <label className="mb-1 mt-2 block text-[11px] font-medium text-slate-600 dark:text-slate-300" htmlFor="quotation-signatory-name">Name</label>
                                <input
                                    id="quotation-signatory-name"
                                    type="text"
                                    value={quotationDetails.authorizedSignatoryName}
                                    onChange={(event) => setQuotationDetails((previous) => ({ ...previous, authorizedSignatoryName: event.target.value }))}
                                    placeholder="Enter signatory name"
                                    required
                                    aria-invalid={!hasQuotationSignatoryName}
                                    aria-describedby={!hasQuotationSignatoryName ? 'quotation-signatory-name-error' : undefined}
                                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-300 aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus:border-rose-500 aria-[invalid=true]:focus:ring-rose-200 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:aria-[invalid=true]:border-rose-500 dark:aria-[invalid=true]:focus:ring-rose-950"
                                />
                                {!hasQuotationSignatoryName && (
                                    <p id="quotation-signatory-name-error" role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">Authorized Signatory Name is required to preview this quotation.</p>
                                )}
                            </section>
                        </div>

                        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
                            <button
                                type="button"
                                onClick={returnToQuotationCustomerSelector}
                                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                                Back to Customers
                            </button>
                            <button type="submit" disabled={!hasQuotationSignatoryName} className="h-10 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">
                                Preview Quotation
                            </button>
                        </footer>
                    </form>
                </div>
            </div>
        )}

        {/* Quotation Preview Modal */}
        {showQuotationPreview && quotationData && (
            <div className="app-modal-backdrop fixed inset-0 z-70 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
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
                                                {buildQuotationThermalHeaderLines(quotationReceipt).map((line, index) => (
                                                    <p key={`${line}-${index}`} className={index === 0
                                                        ? 'mb-1 text-lg font-semibold leading-tight text-gray-900'
                                                        : 'mt-1.5 text-[11px] leading-relaxed text-gray-400 sm:text-xs'}>{line}</p>
                                                ))}
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
                                                    <p className="break-words font-semibold leading-tight text-gray-800">{getProductDisplayName(item, categoryDefinitions)}</p>
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
                        <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={handleDownloadQuotationPdf}
                            disabled={quotationPdfStatus === 'downloading'}
                            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-white shadow-sm transition-all duration-300 ${quotationPdfStatus === 'downloading' ? 'cursor-wait opacity-80' : 'hover:-translate-y-0.5 hover:opacity-90'}`}
                            style={{ backgroundColor: quotationPdfStatus === 'success' ? '#10B981' : '#374151', border: quotationPdfStatus === 'success' ? '2px solid #10B981' : '2px solid #374151' }}
                        >
                            {quotationPdfStatus === 'downloading' ? 'Downloading' : quotationPdfStatus === 'success' ? 'Downloaded' : 'Download PDF'}
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

        {quotationType === 'regular_customer' && formalQuotationData && (
            <FormalPriceQuotationModal
                quotation={formalQuotationData}
                onClose={() => {
                    setFormalQuotationData(null);
                    setShowQuotationDetails(true);
                }}
            />
        )}
        {pendingCartRemoval && (() => {
            const item = pendingCartRemoval.item;
            const itemName = String(item?.name || 'this product').trim();
            const brand = String(item?.brand || '').trim();
            const productName = brand && !item?.displayNameIsFallback && !itemName.toLowerCase().startsWith(brand.toLowerCase())
                ? `${brand} ${itemName}`
                : itemName;
            const variantDetails = getOrderListVariationDetails(item, categoryDefinitions);
            const confirmation = (
                <CartRemovalConfirmation
                    title="Remove this item?"
                    items={[{
                        key: item?.code || 'cart-item',
                        name: productName,
                        sku: item?.code,
                        variantDetails,
                        quantity: item?.qty,
                        unit: item?.sellingUnit || item?.unit,
                    }]}
                    cancelButtonRef={singleCartRemovalCancelButtonRef}
                    onCancel={closeSingleCartRemoval}
                    onConfirm={confirmSingleCartRemoval}
                    onKeyDown={handleSingleCartRemovalDialogKeyDown}
                    closeOnBackdrop
                    layerClassName={isCartDrawerOpen && isMobilePosLayout ? 'z-[100]' : 'z-[70]'}
                />
            );

            return isCartDrawerOpen && isMobilePosLayout && typeof document !== 'undefined'
                ? createPortal(confirmation, document.body)
                : confirmation;
        })()}
        {isBulkRemoveConfirmationOpen && (() => {
            const items = selectedCartItems.map((item, index) => {
                const itemName = String(item?.name || 'Unnamed product').trim();
                const brand = String(item?.brand || '').trim();
                return {
                    key: `${item.code || 'cart-item'}-${index}`,
                    name: brand && !item.displayNameIsFallback && !itemName.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${itemName}` : itemName,
                    sku: item?.code,
                    variantDetails: getOrderListVariationDetails(item, categoryDefinitions),
                    quantity: item?.qty,
                    unit: item?.sellingUnit || item?.unit,
                };
            });
            const confirmation = (
                <CartRemovalConfirmation
                    title={`Remove ${selectedCartItemCount} ${selectedCartItemCount === 1 ? 'item' : 'items'}?`}
                    items={items}
                    cancelButtonRef={bulkRemoveCancelButtonRef}
                    onCancel={() => setIsBulkRemoveConfirmationOpen(false)}
                    onConfirm={removeSelectedCartLines}
                    confirmDisabled={selectedCartItemCount === 0}
                    layerClassName={isCartDrawerOpen && isMobilePosLayout ? 'z-[90]' : 'z-70'}
                />
            );

            return isCartDrawerOpen && isMobilePosLayout && typeof document !== 'undefined'
                ? createPortal(confirmation, document.body)
                : confirmation;
        })()}
        <button
            ref={floatingCartButtonRef}
            type="button"
            onClick={openCartDrawer}
            aria-haspopup="dialog"
            aria-expanded={isCartDrawerOpen}
            aria-controls="pos-current-order-panel"
            aria-label={`Open cart, ${cartItemCount} item${cartItemCount === 1 ? '' : 's'}`}
            aria-hidden={!isFloatingCartVisible}
            tabIndex={isFloatingCartVisible ? 0 : -1}
            disabled={!isFloatingCartVisible}
            style={{
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
                right: 'calc(env(safe-area-inset-right, 0px) + 1rem)',
            }}
            className={`fixed z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition-[opacity,transform] duration-200 ease-out hover:bg-slate-800 active:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 motion-reduce:transition-none md:hidden ${isFloatingCartVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}
        >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 3h2l2.2 11.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6m4 12h.01M17 20h.01" />
            </svg>
            <span aria-live="polite" className={`absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-white px-1 text-[10px] font-bold text-white transition-colors duration-200 motion-reduce:transition-none ${cartCountFeedback ? 'bg-slate-600' : 'bg-slate-900'}`}>
                {cartItemCount}
            </span>
        </button>
        </div>
    );
};

export default PointOfSale;
