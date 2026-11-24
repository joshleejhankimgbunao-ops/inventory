import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import Pagination from '../components/Pagination';
import TableSkeletonRows from '../components/TableSkeletonRows';
import IdentifierChip from '../components/IdentifierChip';
import { showToast } from '../utils/toastHelper';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { getAuthToken, isApiConnectionFailure } from '../services/apiClient';
import { updateProductStockApi } from '../services/inventoryApi';
import { listProductsApi, listProductExpiryBatchesApi, correctExpiryBatchDateApi, reconcileProductExpiryBatchesApi, verifyExpiryBatchesAndAddStockApi } from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import ToolbarDropdown from '../components/ToolbarDropdown';
import ExpiryMonitoring from '../components/ExpiryMonitoring';
import ExpiryBatchRemovalSelector from '../components/ExpiryBatchRemovalSelector';
import ExpiryBatchVerificationForm from '../components/ExpiryBatchVerificationForm';
import InventoryProductDetails from '../components/InventoryProductDetails';
import RemoteProductImage from '../components/RemoteProductImage';
import ProductDetailsModalShell from '../components/ProductDetailsModalShell';
import { getStockStatus } from '../utils/recommendationLogic';
import { formatNumber } from '../utils/numberFormat';
import { formatExpiryDateLabel } from '../utils/productExpiryDate';
import { setFormValidationErrors } from '../utils/formValidationNavigation';
import { createClientRequestId } from '../utils/clientRequestId';
import {
    getInventoryProductSpecificationGroupKey,
    getInventoryProductNameParts,
    getInventoryProductSpecifications,
} from '../utils/inventoryProductSpecifications';
import { getProductDisplayName, hasStoredProductName } from '../utils/productDisplayName';
import {
    isWholeNumberInput,
    preventInvalidWholeNumberKeyDown,
    preventInvalidWholeNumberPaste,
    sanitizeWholeNumberInput,
} from '../utils/numericInput';

const MotionDiv = motion.div;

const includesNormalizedPhrase = (text, phrase) => {
    const normalizedText = String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedPhrase = String(phrase || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalizedText || !normalizedPhrase) return false;
    return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
};

const StockModalAnimatedView = ({ children, direction, duration, centerExpansion, onEntered }) => {
    const isPresent = useIsPresent();
    // The forward Add Stock -> Verify Batches transition is provided by the
    // stock modal shell's size-layout animation. Keep the reverse
    // Verify Batches -> Add Stock motion unchanged.
    const initial = duration === 0 || (centerExpansion && direction > 0) ? false : { opacity: 0, x: direction * 12 };
    // Keep the currently visible view usable during its transition. In
    // particular, the expiry-tracking checkbox must be able to reverse a
    // staged transition instead of being trapped behind an inert panel.
    // AnimatePresence is in wait mode, so this is the only rendered view
    // during either phase of the transition. Keep its tracking checkbox live
    // while the view exits so the user can still reverse a staged change.
    const isInteractive = true;

    return (
        <MotionDiv
            className="col-start-1 row-start-1 min-w-0"
            aria-hidden={!isInteractive}
            inert={!isInteractive}
            style={{ pointerEvents: isInteractive ? 'auto' : 'none' }}
            initial={initial}
            animate={{ opacity: 1, x: 0 }}
            // The modal uses AnimatePresence wait mode, so unmount the outgoing
            // form immediately and let only the incoming view animate. This
            // avoids showing the old form behind the new one without changing
            // the incoming view's duration or easing.
            exit={undefined}
            transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => { if (isPresent && !centerExpansion) onEntered?.(); }}
        >
            {children}
        </MotionDiv>
    );
};

const Inventory = () => {
    const listContainerRef = useRef(null);
    const inventoryTabRefs = useRef([]);
    const [activeInventoryTab, setActiveInventoryTab] = useState('stock');
    const stockSubmitInFlightRef = useRef(false);
    const stockAdjustmentRequestIdRef = useRef('');
    const { inventory, setInventory, isInventoryLoading, categories: categoryConfigurations = [] } = useInventory();
    const { appSettings, userRole } = useAuth();
    const prefersReducedMotion = useReducedMotion();

    const stripTrailingSizeFromName = useCallback((nameValue, sizeValue) => {
        const name = String(nameValue || '').trim();
        const size = String(sizeValue || '').trim();
        if (!name || !size) return name;

        const escapedSize = size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`\\s*\\(${escapedSize}\\)\\s*$`, 'i'),
            new RegExp(`\\s*[-–—,:|/]\\s*${escapedSize}\\s*$`, 'i'),
            new RegExp(`\\s+${escapedSize}\\s*$`, 'i')
        ];

        let cleaned = name;
        patterns.forEach((pattern) => {
            cleaned = cleaned.replace(pattern, '').trim();
        });

        return cleaned || name;
    }, []);

    const isPackagingVolume = useCallback((sizeValue) => /^\d+(?:\.\d+)?\s*(?:gallon|gallons|liter|liters|can|pcs)$/i.test(String(sizeValue || '').trim()), []);

    const getProductTableDisplayTitle = useCallback((item) => {
        const baseName = item?.name || item?._displayName || '';
        const cleanBase = String(baseName)
            .replace(/\s*\(\d+[^)]*(?:gallon|gallons|liter|liters|can|pcs)[^)]*\)/gi, '')
            .trim();
        const color = String(item?.color || '').trim();
        const size = String(item?.size || '').trim();
        const baseWithoutSize = size ? stripTrailingSizeFromName(cleanBase, size) : cleanBase;
        const attributeSuffix = color && !includesNormalizedPhrase(cleanBase, color)
            ? ` - ${color}`
            : size && !isPackagingVolume(size)
                ? ` (${size})`
                : '';

        return `${baseWithoutSize}${attributeSuffix}`;
    }, [isPackagingVolume, stripTrailingSizeFromName]);

    const getInventoryProductDisplayName = useCallback((item) => {
        if (!String(item?.name || '').trim()) return getProductDisplayName(item, categoryConfigurations);
        const title = getProductTableDisplayTitle(item);
        const brand = String(item?.brand || '').trim();
        return brand && !includesNormalizedPhrase(title, brand) ? `${brand} ${title}` : title;
    }, [categoryConfigurations, getProductTableDisplayTitle]);

    const getInventoryAttributeValue = (item, keys) => {
        const attributes = item?.attributes instanceof Map
            ? Object.fromEntries(item.attributes)
            : (item?.attributes || {});
        const attributeEntries = Object.entries(attributes);
        return keys
            .map((key) => {
                const normalizedKey = String(key).toLowerCase();
                const entry = attributeEntries.find(([attributeKey]) => String(attributeKey).toLowerCase() === normalizedKey);
                return entry?.[1];
            })
            .map((value) => String(value || '').trim())
            .find(Boolean) || '';
    };

    // Helper to log actions
    const [isStockModalOpen, setIsStockModalOpen] = useState(false);
    const [hasExpandedInlineStockModal, setHasExpandedInlineStockModal] = useState(false);
    const [isStockSubmitting, setIsStockSubmitting] = useState(false);
    const [modalAction, setModalAction] = useState('IN'); // 'IN' (Add Stock) or 'OUT' (Remove/Adjust)
    const [selectedItem, setSelectedItem] = useState(null);
    const [stockForm, setStockForm] = useState({ quantity: '', reason: '', notes: '', otherReason: '', expiryDate: '', lotNumber: '' });
    const [enableExpiryTrackingOnStockIn, setEnableExpiryTrackingOnStockIn] = useState(false);
    const [expiryBatchView, setExpiryBatchView] = useState({ batches: [], reconciled: false });
    const [stockOutAllocations, setStockOutAllocations] = useState({});
    const [expiryMonitoringRefreshKey, setExpiryMonitoringRefreshKey] = useState(0);
    const [productDetailsId, setProductDetailsId] = useState(null);
    const [productDetailsBatch, setProductDetailsBatch] = useState(null);
    const [productDetailsExpiry, setProductDetailsExpiry] = useState(null);
    const [isExpiryVerificationModalOpen, setIsExpiryVerificationModalOpen] = useState(false);
    const [isStockVerificationView, setIsStockVerificationView] = useState(false);
    const [isStockViewTransitioning, setIsStockViewTransitioning] = useState(false);
    const [isCenteredStockExpansionTransition, setIsCenteredStockExpansionTransition] = useState(false);
    const [expiryVerificationProduct, setExpiryVerificationProduct] = useState(null);
    const [expiryVerificationLoadError, setExpiryVerificationLoadError] = useState('');
    const [expiryReconcileRows, setExpiryReconcileRows] = useState([]);
    const expiryReconcileSubmitRef = useRef(false);
    const [expiryReconcileTouched, setExpiryReconcileTouched] = useState(false);
    const [isExpiryReconciling, setIsExpiryReconciling] = useState(false);
    const [isLoadingExpiryVerification, setIsLoadingExpiryVerification] = useState(false);
    const [expiryVerificationNeedsRefresh, setExpiryVerificationNeedsRefresh] = useState(false);
    const [expiryCorrectionBatch, setExpiryCorrectionBatch] = useState(null);
    const [expiryCorrectionReason, setExpiryCorrectionReason] = useState('');
    const [stockDetailsNeedReview, setStockDetailsNeedReview] = useState(false);
    const [stockDetailsSyncStatus, setStockDetailsSyncStatus] = useState('idle');
    const expiryBatchRequestSequenceRef = useRef(0);
    const retryOpenExpiryBatchRefreshRef = useRef(null);
    const expiryVerificationLoadRef = useRef(false);
    const stockViewTransitionLockRef = useRef(false);
    const stockModalExpansionIntentRef = useRef(false);
    const stockModalRef = useRef(null);
    const stockModalExpansionStartWidthRef = useRef(null);
    const stockViewTransitionDuration = prefersReducedMotion ? 0 : 0.2;

    const resetStockViewTransition = () => {
        stockViewTransitionLockRef.current = false;
        stockModalExpansionIntentRef.current = false;
        setIsCenteredStockExpansionTransition(false);
        setIsStockViewTransitioning(false);
    };

    const transitionStockVerificationView = (nextView) => {
        if (nextView === isStockVerificationView) return true;
        if (stockViewTransitionLockRef.current) return false;
        const useCenteredExpansion = nextView && stockModalExpansionIntentRef.current && stockViewTransitionDuration > 0;
        stockModalExpansionIntentRef.current = false;
        setIsCenteredStockExpansionTransition(Boolean(useCenteredExpansion));
        if (nextView) {
            stockModalExpansionStartWidthRef.current = stockModalRef.current?.getBoundingClientRect().width ?? null;
            setHasExpandedInlineStockModal(true);
        }
        if (stockViewTransitionDuration > 0) {
            stockViewTransitionLockRef.current = true;
            setIsStockViewTransitioning(true);
        }
        setIsStockVerificationView(nextView);
        return true;
    };

    const finishStockViewTransition = () => {
        if (!stockViewTransitionLockRef.current) return;
        stockViewTransitionLockRef.current = false;
        setIsStockViewTransitioning(false);
        setIsCenteredStockExpansionTransition(false);
        stockModalExpansionStartWidthRef.current = null;
    };

    useLayoutEffect(() => {
        if (!isStockVerificationView || !isCenteredStockExpansionTransition || !stockViewTransitionLockRef.current) return;
        const modal = stockModalRef.current;
        const startWidth = stockModalExpansionStartWidthRef.current;
        if (!modal || !Number.isFinite(startWidth)) return;

        const parent = modal.parentElement;
        const parentStyle = parent ? window.getComputedStyle(parent) : null;
        const availableWidth = parent
            ? parent.clientWidth - Number.parseFloat(parentStyle?.paddingLeft || '0') - Number.parseFloat(parentStyle?.paddingRight || '0')
            : 0;
        const targetMaxWidth = Number.parseFloat(window.getComputedStyle(modal).maxWidth);
        const targetWidth = Math.min(availableWidth, targetMaxWidth);

        // On narrow viewports both max-widths resolve to the same available
        // width, so there is no CSS transitionend event to wait for.
        if (Number.isFinite(targetWidth) && targetWidth <= startWidth + 1) finishStockViewTransition();
    }, [isStockVerificationView, isCenteredStockExpansionTransition]);

    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [sortBy, setSortBy] = useState('off'); 
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [enlargedProductImage, setEnlargedProductImage] = useState(null);
    const normalizedUserRole = String(userRole || '').toLowerCase().replace(/[\s_-]+/g, '');
    const products = inventory;
    const productSpecificationGroups = useMemo(() => {
        const groups = new Map();
        products.forEach((product) => {
            const displayName = getInventoryProductDisplayName(product);
            const { name: baseName } = getInventoryProductNameParts(product, categoryConfigurations, displayName);
            const productWithDisplayName = {
                ...product,
                _inventoryTableDisplayName: displayName,
                _inventoryTableProductName: baseName,
                _inventoryTableProductBaseName: baseName,
            };
            const key = getInventoryProductSpecificationGroupKey(productWithDisplayName, baseName, categoryConfigurations);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(productWithDisplayName);
        });
        return groups;
    }, [products, categoryConfigurations, getInventoryProductDisplayName]);

    const closeProductDetails = () => {
        setProductDetailsId(null);
        setProductDetailsBatch(null);
        setProductDetailsExpiry(null);
    };

    const openProductDetails = async (productId, batch = null, event) => {
        if (event?.target?.closest?.('button, a, input, select, textarea, [data-row-action]')) return;
        const id = String(productId || '');
        if (!id) return;
        setProductDetailsId(id);
        setProductDetailsBatch(batch);
        setProductDetailsExpiry(null);
    };

    const handleInventoryRowClick = (event, item) => {
        if (event.target?.closest?.('button, a, input, select, textarea, [data-row-action]')) return;
        openProductDetails(item.id, null, event);
    };

    const canReconcileExpiryBatches = ['superadmin', 'admin'].includes(normalizedUserRole);
    const handleExpiryTrackingToggle = async (enabled) => {
        if (isExpiryReconciling || expiryReconcileSubmitRef.current) return;
        // A fresh checkbox choice supersedes an in-flight panel animation.
        // This also releases the transition lock before starting the
        // corresponding forward or reverse transition.
        if (stockViewTransitionLockRef.current) finishStockViewTransition();
        if (!enabled) {
            expiryBatchRequestSequenceRef.current += 1;
            expiryVerificationLoadRef.current = false;
            setIsLoadingExpiryVerification(false);
            setEnableExpiryTrackingOnStockIn(false);
            setExpiryVerificationLoadError('');
            if (!isStockVerificationView) setHasExpandedInlineStockModal(false);
            transitionStockVerificationView(false);
            setExpiryReconcileRows([]);
            setExpiryReconcileTouched(false);
            if (expiryVerificationProduct?.inlineStockFlow) {
                setExpiryVerificationProduct(null);
                setExpiryVerificationNeedsRefresh(false);
            }
            setStockForm((previous) => ({ ...previous, expiryDate: '', lotNumber: '' }));
            return;
        }
        if (!canReconcileExpiryBatches || !selectedItem || selectedItem.expiryTrackingEnabled) return;
        setEnableExpiryTrackingOnStockIn(true);
        const existingStock = Number(selectedItem.stock || 0);
        stockModalExpansionIntentRef.current = existingStock > 0;
        if (existingStock <= 0) return;
        await handleOpenExpiryVerification({
            ...selectedItem,
            productId: selectedItem.id,
            productName: getInventoryProductDisplayName(selectedItem),
            sku: selectedItem.code || selectedItem.sku,
        }, { inlineStock: true, activationPreview: true, enterInlineViewBeforeFetch: true });
    };
    const handleOpenExpiryVerification = async (product, options = {}) => {
        if (!canReconcileExpiryBatches || isExpiryReconciling
            || (expiryVerificationLoadRef.current && !options.inlineStock)) return;
        expiryVerificationLoadRef.current = true;
        setIsLoadingExpiryVerification(true);
        setExpiryVerificationLoadError('');
        const requestSequence = ++expiryBatchRequestSequenceRef.current;
        try {
            const productId = String(product?.productId || product?.id || '');
            if (!productId) throw new Error('Choose a product to verify.');
            const activationPreview = options.activationPreview === true;
            if (options.inlineStock && options.enterInlineViewBeforeFetch) {
                const pendingProduct = {
                    ...product,
                    productId,
                    productName: product?.productName || product?.name || 'Inventory product',
                    sku: product?.sku || product?.code || '',
                    sellingUnit: product?.sellingUnit || '',
                    inlineStockFlow: true,
                    activationPreview,
                    inlineActivationLoadPending: true,
                };
                setExpiryVerificationProduct(pendingProduct);
                setExpiryReconcileRows([]);
                setExpiryReconcileTouched(false);
                setExpiryVerificationNeedsRefresh(false);
                transitionStockVerificationView(true);
                setIsExpiryVerificationModalOpen(false);
            }
            const result = await listProductExpiryBatchesApi(productId, null, { activationPreview });
            if (requestSequence !== expiryBatchRequestSequenceRef.current) return;
            if (result?.receiptLedgerValid === false || result?.stockPartitionValid === false) {
                throw new Error('Recorded batch quantities need review before verification.');
            }
            const existingStockToVerify = Number(result?.existingStockToVerify ?? result?.productStock ?? 0);
            const batches = Array.isArray(result?.batches) ? result.batches : [];
            if (!canReconcileExpiryBatches && (!result?.reconciled || existingStockToVerify > 0)) {
                throw new Error('Only an administrator can verify existing expiry batches.');
            }
            if (batches.some((batch) => !batch?._id || !batch?.updatedAt)) {
                throw new Error('Recorded batches changed. Refresh and try again.');
            }
            if (result?.productStock !== undefined) {
                setSelectedItem((current) => String(current?.id || '') === productId ? {
                    ...current,
                    stock: Number(result.productStock || 0),
                    reservedStock: Number(result.productReserved || 0),
                    updatedAt: result.productUpdatedAt || current.updatedAt,
                } : current);
                setInventory((current) => current.map((item) => String(item.id || '') === productId ? {
                    ...item,
                    stock: Number(result.productStock || 0),
                    reservedStock: Number(result.productReserved || 0),
                    updatedAt: result.productUpdatedAt || item.updatedAt,
                } : item));
            }
            const verificationRows = existingStockToVerify > 0
                ? [{ quantity: '', expiryDate: '', lotNumber: '' }]
                : [];
            setExpiryVerificationProduct({
                ...product,
                ...result,
                productId,
                productName: product?.productName || product?.name || result?.productName || 'Inventory product',
                sku: product?.sku || product?.code || result?.sku || '',
                sellingUnit: product?.sellingUnit || result?.sellingUnit || '',
                inlineStockFlow: options.inlineStock === true,
                activationPreview,
                inlineActivationLoadPending: false,
            });
            setExpiryReconcileRows(verificationRows);
            setExpiryReconcileTouched(false);
            setExpiryVerificationNeedsRefresh(false);
            setExpiryVerificationLoadError('');
            if (options.inlineStock) {
                setStockDetailsSyncStatus('success');
                transitionStockVerificationView(true);
                setIsExpiryVerificationModalOpen(false);
            } else {
                setIsExpiryVerificationModalOpen(true);
            }
        } catch (error) {
            if (requestSequence === expiryBatchRequestSequenceRef.current) {
                if (options.inlineStock && options.enterInlineViewBeforeFetch) setExpiryVerificationLoadError(error?.message || 'Unable to load batch details.');
                showToast('Unable to load batches', error?.message || 'Refresh and try again.', 'error', 'expiry-verification');
            }
        } finally {
            if (requestSequence === expiryBatchRequestSequenceRef.current) {
                expiryVerificationLoadRef.current = false;
                setIsLoadingExpiryVerification(false);
            }
        }
    };

    const handleEnterInlineStockVerification = () => {
        if (expiryVerificationProduct?.inlineStockFlow
            && String(expiryVerificationProduct.productId || '') === String(selectedItem?.id || '')
            && !expiryVerificationNeedsRefresh) {
            transitionStockVerificationView(true);
            return;
        }
        void handleOpenExpiryVerification({
            ...selectedItem,
            productId: selectedItem?.id,
            productName: getInventoryProductDisplayName(selectedItem),
            sku: selectedItem?.code || selectedItem?.sku,
        }, {
            inlineStock: true,
            activationPreview: enableExpiryTrackingOnStockIn && !selectedItem?.expiryTrackingEnabled,
            enterInlineViewBeforeFetch: true,
        });
    };

    const refreshExpiryVerification = async () => {
        if (!expiryVerificationProduct?.productId || isLoadingExpiryVerification || isExpiryReconciling) return;
        setIsLoadingExpiryVerification(true);
        try {
            const result = await listProductExpiryBatchesApi(expiryVerificationProduct.productId, null, {
                activationPreview: expiryVerificationProduct.activationPreview === true,
            });
            if (result?.receiptLedgerValid === false || result?.stockPartitionValid === false) {
                throw new Error('Recorded batch quantities need review before verification.');
            }
            const batches = Array.isArray(result?.batches) ? result.batches : [];
            if (batches.some((batch) => !batch?._id || !batch?.updatedAt)) {
                throw new Error('Recorded batches changed. Refresh and try again.');
            }
            setExpiryVerificationProduct((current) => ({ ...current, ...result }));
            if (expiryVerificationProduct.inlineStockFlow) {
                if (expiryVerificationProduct.activationPreview) {
                    const freshProducts = await listProductsApi({ includeImages: false });
                    const freshItem = freshProducts.find((item) => String(item.id) === String(expiryVerificationProduct.productId));
                    if (freshItem) {
                        setInventory((previous) => previous.map((item) => String(item.id) === String(freshItem.id) ? freshItem : item));
                        setSelectedItem(freshItem);
                    }
                } else if (String(selectedItem?.id || '') === String(expiryVerificationProduct.productId)) {
                    await refreshStockDetailsAfterConflict(expiryVerificationProduct.productId);
                }
            }
            setExpiryVerificationNeedsRefresh(false);
        } catch (error) {
            showToast('Unable to refresh batches', error?.message || 'Refresh and try again.', 'error', 'expiry-verification');
        } finally {
            setIsLoadingExpiryVerification(false);
        }
    };

    const handleStartExpiryCorrection = (batch) => {
        setIsStockModalOpen(false);
        setIsExpiryVerificationModalOpen(false);
        setProductDetailsId(null);
        setExpiryCorrectionBatch(batch);
        setExpiryCorrectionReason('');
    };

    const handleSubmitExpiryCorrection = async (event) => {
        event.preventDefault();
        const reason = expiryCorrectionReason.trim();
        if (!expiryCorrectionBatch || !reason) {
            showToast('Correction reason required', 'Explain why the expiry date is being corrected.', 'error', 'expiry-correction');
            return;
        }
        try {
            await correctExpiryBatchDateApi(
                expiryCorrectionBatch.productId,
                expiryCorrectionBatch._id || expiryCorrectionBatch.id,
                {
                    newExpiryDate: expiryCorrectionBatch.newExpiryDate,
                    reason,
                    requestId: createClientRequestId('expiry-correction'),
                    expectedUpdatedAt: expiryCorrectionBatch.updatedAt,
                },
            );
            setExpiryCorrectionBatch(null);
            setExpiryMonitoringRefreshKey((current) => current + 1);
            showToast('Updated', 'Expiry date corrected successfully.', 'success', 'expiry-correction');
        } catch (error) {
            showToast('Unable to correct expiry date', error?.message || 'Try again.', 'error', 'expiry-correction');
        }
    };

    const applyExpiryBatchSnapshot = (result, productId) => {
        if (String(selectedItem?.id || '') !== String(productId || '')) return;
        setExpiryBatchView({
            ...result,
            loadedProductId: String(productId || ''),
            batches: Array.isArray(result?.batches) ? result.batches : [],
            reconciled: Boolean(result?.reconciled),
        });
    };

    const refreshStockDetailsAfterConflict = async (productId) => {
        const requestSequence = ++expiryBatchRequestSequenceRef.current;
        setStockDetailsSyncStatus('loading');
        try {
            const productsResult = await listProductsApi({ includeImages: false });
            if (requestSequence !== expiryBatchRequestSequenceRef.current) return;
            const freshItem = (Array.isArray(productsResult) ? productsResult : []).find((item) => String(item.id || item._id || '') === String(productId));
            if (!freshItem) throw new Error('Product details are unavailable. Refresh and try again.');
            setSelectedItem(freshItem);
            if (freshItem?.expiryTrackingEnabled) {
                const batchResult = await listProductExpiryBatchesApi(productId);
                if (requestSequence !== expiryBatchRequestSequenceRef.current) return;
                applyExpiryBatchSnapshot(batchResult, productId);
            } else {
                setExpiryBatchView({ batches: [], reconciled: false, existingStockToVerify: Number(freshItem?.stock || 0), loadedProductId: String(productId || '') });
            }
            setStockDetailsSyncStatus('success');
        } catch (error) {
            if (requestSequence !== expiryBatchRequestSequenceRef.current) return;
            setStockDetailsSyncStatus('error');
            showToast('Unable to refresh inventory', error?.message || 'Try again.', 'error', 'inventory-refresh');
        }
    };

    const retryStockDetailsRefresh = () => refreshStockDetailsAfterConflict(selectedItem?.id);
    const handleCancelExpiryReconciliation = () => {
        setIsExpiryVerificationModalOpen(false);
        setIsStockVerificationView(false);
        setExpiryReconcileTouched(false);
        setExpiryVerificationNeedsRefresh(false);
    };

    const expiryReconcileTarget = Number(expiryVerificationProduct?.existingStockToVerify ?? expiryVerificationProduct?.productStock ?? 0);
    const expiryReconcileTotal = expiryReconcileRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const expiryReconcileDatesValid = expiryReconcileRows.every((row) => Boolean(String(row.expiryDate || '').trim()));
    const expiryReconcileQuantitiesValid = expiryReconcileRows.every((row) => Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0);
    const expiryReconcileValid = expiryReconcileDatesValid && expiryReconcileQuantitiesValid && expiryReconcileTotal === expiryReconcileTarget;

    const handleExpiryReconciliation = async (event, stockInDetails = null) => {
        event.preventDefault();
        if (!expiryVerificationProduct || isExpiryReconciling || expiryReconcileSubmitRef.current || expiryVerificationNeedsRefresh) return;
        const batches = expiryReconcileRows.map((row) => ({
            expiryDate: String(row.expiryDate || '').trim(),
            lotNumber: String(row.lotNumber || '').trim(),
            quantity: Number(row.quantity),
        }));
        const total = batches.reduce((sum, row) => sum + row.quantity, 0);
        if (batches.some((row) => !row.expiryDate || !Number.isSafeInteger(row.quantity) || row.quantity <= 0)
            || total !== Number(expiryVerificationProduct.existingStockToVerify ?? expiryVerificationProduct.productStock ?? 0)) {
            showToast('Review batch details', 'Confirm the expiry dates and quantities of your current stock.', 'error', 'expiry-verification');
            return;
        }
        expiryReconcileSubmitRef.current = true;
        setIsExpiryReconciling(true);
        try {
            const verificationPayload = {
                expectedStock: expiryVerificationProduct.productStock,
                expectedUnassignedStock: expiryVerificationProduct.existingStockToVerify,
                expectedUpdatedAt: expiryVerificationProduct.productUpdatedAt,
                recordedBatchVersions: (expiryVerificationProduct.batches || []).map((batch) => ({
                    batchRecordId: String(batch._id),
                    updatedAt: batch.updatedAt,
                })),
                requestId: expiryVerificationProduct.inlineStockFlow
                    ? stockAdjustmentRequestIdRef.current
                    : createClientRequestId('expiry-reconciliation'),
                batches,
            };
            if (expiryVerificationProduct.inlineStockFlow) {
                const result = await verifyExpiryBatchesAndAddStockApi(expiryVerificationProduct.productId, {
                    ...verificationPayload,
                    enableTracking: expiryVerificationProduct.activationPreview === true,
                    deliveryBatches: stockInDetails?.deliveryBatches || [],
                    reason: stockInDetails?.reason || '',
                });
                const persistedProduct = result?.product || {};
                const confirmedStock = Number(persistedProduct.stock ?? expiryVerificationProduct.productStock ?? 0);
                setInventory((previous) => previous.map((item) => {
                    if (String(item.id || '') !== String(expiryVerificationProduct.productId)) return item;
                    const confirmedItem = {
                        ...item,
                        stock: confirmedStock,
                        updatedAt: persistedProduct.updatedAt || item.updatedAt,
                        expiryTrackingEnabled: persistedProduct.expiryTrackingEnabled === true,
                        expiryBatchReconciled: persistedProduct.expiryBatchReconciled === true,
                        expiryTrackingPeriodId: persistedProduct.expiryTrackingPeriodId || null,
                        expiryUnassignedStock: Number(persistedProduct.expiryUnassignedStock || 0),
                    };
                    return { ...confirmedItem, status: deriveStatus(confirmedItem) };
                }));
                setSelectedItem((current) => {
                    if (String(current?.id || '') !== String(expiryVerificationProduct.productId)) return current;
                    const confirmedItem = {
                        ...current,
                        stock: confirmedStock,
                        updatedAt: persistedProduct.updatedAt || current.updatedAt,
                        expiryTrackingEnabled: persistedProduct.expiryTrackingEnabled === true,
                        expiryBatchReconciled: persistedProduct.expiryBatchReconciled === true,
                        expiryTrackingPeriodId: persistedProduct.expiryTrackingPeriodId || null,
                        expiryUnassignedStock: Number(persistedProduct.expiryUnassignedStock || 0),
                    };
                    return { ...confirmedItem, status: deriveStatus(confirmedItem) };
                });
                expiryBatchRequestSequenceRef.current += 1;
                expiryVerificationLoadRef.current = false;
                setIsLoadingExpiryVerification(false);
                setIsStockModalOpen(false);
                setIsStockVerificationView(false);
                setHasExpandedInlineStockModal(false);
                setEnableExpiryTrackingOnStockIn(false);
                setExpiryVerificationProduct(null);
                setExpiryVerificationLoadError('');
                setExpiryVerificationNeedsRefresh(false);
                setExpiryReconcileRows([]);
                setExpiryReconcileTouched(false);
                stockAdjustmentRequestIdRef.current = '';
                setExpiryMonitoringRefreshKey((current) => current + 1);
                showToast('Verified', stockInDetails?.deliveryBatches?.length
                    ? 'Existing batches were verified and the new delivery was added.'
                    : 'Existing stock batches were verified successfully.', 'success', 'expiry-verification');
            } else {
                await reconcileProductExpiryBatchesApi(expiryVerificationProduct.productId, verificationPayload);
                setIsExpiryVerificationModalOpen(false);
                setExpiryVerificationNeedsRefresh(false);
                setExpiryMonitoringRefreshKey((current) => current + 1);
                if (String(selectedItem?.id || '') === String(expiryVerificationProduct.productId)) {
                    await refreshStockDetailsAfterConflict(expiryVerificationProduct.productId);
                }
                showToast('Verified', 'Expiry batches verified successfully.', 'success', 'expiry-verification');
            }
        } catch (error) {
            if (error?.status === 409) {
                setExpiryVerificationNeedsRefresh(true);
                if (String(selectedItem?.id || '') === String(expiryVerificationProduct.productId)) {
                    void refreshStockDetailsAfterConflict(expiryVerificationProduct.productId);
                }
            }
            showToast('Unable to verify batches', error?.message || 'Refresh and try again.', 'error', 'expiry-verification');
        } finally {
            expiryReconcileSubmitRef.current = false;
            setIsExpiryReconciling(false);
        }
    };

    useEffect(() => {
        if (!productDetailsId) return undefined;
        let active = true;
        const load = async () => {
            try {
                const result = await listProductExpiryBatchesApi(productDetailsId);
                if (!active) return;
                setProductDetailsExpiry({
                    batches: Array.isArray(result?.batches) ? result.batches : [],
                    reconciled: Boolean(result?.reconciled),
                });
            } catch (error) {
                if (!active) return;
                if (error?.status === 409) {
                    setProductDetailsExpiry({ batches: [], reconciled: false, unavailable: true });
                    return;
                }
                setProductDetailsExpiry({ batches: [], reconciled: false, error: error?.message || 'Unable to load expiry details.' });
            }
        };
        load();
        return () => { active = false; };
    }, [productDetailsId]);
    
    // UI State for Filter Panel
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

    const selectInventoryTab = (tab) => {
        setActiveInventoryTab(tab);
        setIsFilterPanelOpen(false);
    };

    const handleInventoryTabKeyDown = (event, currentIndex) => {
        const tabCount = 2;
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabCount;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + tabCount - 1) % tabCount;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabCount - 1;
        else return;

        event.preventDefault();
        const nextTab = nextIndex === 0 ? 'stock' : 'expiry';
        selectInventoryTab(nextTab);
        inventoryTabRefs.current[nextIndex]?.focus();
    };

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchQuery]);

    useEffect(() => {
        const scheduleRefresh = () => setExpiryMonitoringRefreshKey((current) => current + 1);
        const markOpenVerificationStale = (changedCodes = []) => {
            if ((!isExpiryVerificationModalOpen && !expiryVerificationProduct?.inlineStockFlow)
                || !expiryVerificationProduct) return;
            const sku = String(expiryVerificationProduct.sku || '').trim();
            if (!changedCodes.length || !sku || changedCodes.includes(sku)) setExpiryVerificationNeedsRefresh(true);
        };
        const onInventoryUpdated = (event) => {
            const changedCodes = Array.isArray(event?.changedCodes) ? event.changedCodes : [];
            const sku = selectedItem?.code || selectedItem?.sku;
            if (sku && changedCodes.includes(sku)) {
                if (modalAction === 'OUT') setStockDetailsNeedReview(true);
                void refreshStockDetailsAfterConflict(selectedItem.id);
            }
            markOpenVerificationStale(changedCodes);
            scheduleRefresh();
        };
        const onRealtimeResync = () => {
            markOpenVerificationStale();
            scheduleRefresh();
        };
        const unsubscribeInventoryUpdated = subscribeRealtimeEvent('inventory.updated', onInventoryUpdated);
        const unsubscribeRealtimeResync = subscribeRealtimeEvent('realtime.resync', onRealtimeResync);
        return () => {
            unsubscribeInventoryUpdated();
            unsubscribeRealtimeResync();
        };
    }, [modalAction, selectedItem, expiryVerificationProduct, isExpiryVerificationModalOpen]);

    const deriveStatus = (item) => getStockStatus(item, appSettings);
    const getStockUnit = (item) => String(item?.sellingUnit || '').trim();
    const formatStockWithUnit = (item) => `${formatNumber(item?.stock || 0)}${getStockUnit(item) ? ` ${getStockUnit(item)}` : ''}`;
    const isTrackedStockOut = modalAction === 'OUT' && selectedItem?.expiryTrackingEnabled === true;
    const expiryBatchReady = expiryBatchView.reconciled;
    const usesBatchRemovalQuantity = isTrackedStockOut && expiryBatchReady && expiryBatchView.reconciled;
    const selectedStockDetailsLoaded = String(expiryBatchView.loadedProductId || '') === String(selectedItem?.id || '');
    const stockInTracksExpiry = modalAction === 'IN'
        && (selectedItem?.expiryTrackingEnabled === true || enableExpiryTrackingOnStockIn);
    const isInitialTrackedStockInLoading = modalAction === 'IN'
        && selectedItem?.expiryTrackingEnabled === true
        && !selectedStockDetailsLoaded
        && stockDetailsSyncStatus === 'loading';
    const isInitialTrackedStockInError = modalAction === 'IN'
        && selectedItem?.expiryTrackingEnabled === true
        && !selectedStockDetailsLoaded
        && stockDetailsSyncStatus === 'error';
    const inlineActivationNeedsVerification = !selectedItem?.expiryTrackingEnabled && Number(selectedItem?.stock || 0) > 0;
    const usesWideStockModal = (modalAction === 'IN' && (selectedItem?.expiryTrackingEnabled
        || (enableExpiryTrackingOnStockIn && (!inlineActivationNeedsVerification || hasExpandedInlineStockModal))))
        || (modalAction === 'OUT' && usesBatchRemovalQuantity);
    const stockOutAllocationQuantities = Object.fromEntries(
        Object.entries(stockOutAllocations).map(([batch, allocation]) => [batch, allocation?.quantity ?? ''])
    );
    const stockOutBatchAllocationRows = Object.entries(stockOutAllocations)
        .filter(([, allocation]) => Number(allocation?.quantity) > 0)
        .map(([batch, allocation]) => {
            const batchDetails = allocation?.batchDetails || expiryBatchView.batches.find((candidate) => String(candidate?._id) === String(batch));
            return {
                batch: String(batch),
                batchId: String(batchDetails?.batchId || ''),
                quantity: Number(allocation.quantity),
                expiryDate: String(batchDetails?.expiryDate || ''),
                updatedAt: batchDetails?.updatedAt || '',
            };
        });
    const stockOutBatchAllocationTotal = stockOutBatchAllocationRows.reduce((sum, row) => sum + row.quantity, 0);
    const stockOutBatchAllocationInvalid = stockOutBatchAllocationRows.some((row) => !Number.isSafeInteger(row.quantity) || row.quantity <= 0);
    const stockOutBatchAllocationSnapshots = stockOutBatchAllocationRows;
    const stockOutBatchAllocationReviewRows = [];
    const stockOutBatchSelectionComplete = stockOutBatchAllocationTotal > 0;

    const normalizedInventory = useMemo(() => {
        const normalizedItems = inventory.map((item) => {
            const nameWithoutVolume = getInventoryProductDisplayName(item)
                .replace(/\s*\(\d+(\.\d+)?\s*(gallon|gallons|liter|liters|L|can|pcs)\)/gi, '')
                .trim();
            const color = String(item?.color || getInventoryAttributeValue(item, ['color', 'shade']) || '').trim();
            const sizeValue = String(
                item?.size
                || getInventoryAttributeValue(item, ['size', 'spec', 'variant_name', 'variantName', 'dimension', 'dimensions', 'length', 'thickness', 'grade', 'type'])
                || ''
            ).trim();
            const explicitSize = sizeValue;
            const fallbackSpec = getInventoryAttributeValue(item, ['spec', 'variant_name', 'variantName', 'dimension', 'dimensions', 'length', 'thickness', 'grade', 'type']);
            const variantValue = color
                ? { suffix: color, suffixType: 'color' }
                : !isPackagingVolume(explicitSize)
                    ? { suffix: explicitSize, suffixType: 'size' }
                    : !isPackagingVolume(fallbackSpec)
                        ? { suffix: fallbackSpec, suffixType: 'size' }
                        : { suffix: '', suffixType: '' };
            if (sizeValue) {
                const cleanedName = stripTrailingSizeFromName(nameWithoutVolume, sizeValue);
                return { ...item, _displayName: cleanedName, _displaySize: sizeValue, _displayColor: color, _displayVariant: variantValue };
            }

            return { ...item, _displayName: nameWithoutVolume, _displaySize: explicitSize, _displayColor: color, _displayVariant: variantValue };
        });
        return normalizedItems;
    }, [getInventoryProductDisplayName, inventory, isPackagingVolume, stripTrailingSizeFromName]);

    const selectedProductDetails = useMemo(() => {
        const id = String(productDetailsId || '');
        const inventoryProduct = inventory.find((item) => String(item.id || '') === id);
        const product = products.find((item) => String(item.id || '') === id);
        return normalizedInventory.find((item) => String(item.id || '') === id)
            || inventoryProduct
            || product
            || null;
    }, [inventory, normalizedInventory, productDetailsId, products]);

    // Derived Categories
    const categories = ['All', ...Array.from(new Set(normalizedInventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

    const inventorySearchSuggestions = useMemo(() => {
        const terms = new Set();

        normalizedInventory.forEach((item) => {
            [
                item?._displayName,
                item?.code,
                item?.brand,
                item?.color,
                item?._displaySize,
                item?.category,
            ].forEach((value) => {
                const text = String(value || '').trim();
                if (text) {
                    terms.add(text);
                }
            });
        });

        return Array.from(terms)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .slice(0, 120);
    }, [normalizedInventory]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Active filter count for Clear All visibility
    const activeFilterCount = (statusFilter !== 'All' ? 1 : 0) + (categoryFilter !== 'All' ? 1 : 0) + (sortBy !== 'off' ? 1 : 0);

    // Filtered & Sorted Logic
    const filteredInventory = useMemo(() => {
        return normalizedInventory
            .filter(item => {
                // Hide archived
                if (item.isArchived) return false;

                // Status filter
                const derivedStatus = deriveStatus(item);
                if (statusFilter !== 'All' && derivedStatus !== statusFilter) return false;

                // Category filter
                if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;

                // Search
                const q = debouncedSearchQuery.toLowerCase();
                const matchesSearch = !q || item._displayName.toLowerCase().includes(q) || 
                                    item.code.toLowerCase().includes(q) ||
                                    (item.brand || '').toLowerCase().includes(q) ||
                                    (item.color || '').toLowerCase().includes(q) ||
                                    (item._displaySize && item._displaySize.toLowerCase().includes(q));
                
                return matchesSearch;
            })
            .sort((a, b) => {
                switch(sortBy) {
                    case 'name-asc': return a._displayName.localeCompare(b._displayName);
                    case 'name-desc': return b._displayName.localeCompare(a._displayName);
                    case 'stock-asc': return a.stock - b.stock;
                    case 'stock-desc': return b.stock - a.stock;
                    default: return 0;
                }
            });
    }, [normalizedInventory, statusFilter, categoryFilter, debouncedSearchQuery, sortBy, appSettings]);

    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, categoryFilter, debouncedSearchQuery, sortBy]);

    useEffect(() => {
        if (!listContainerRef.current) return;
        listContainerRef.current.scrollTop = 0;
    }, [currentPage]);

    // Pagination Logic
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredInventory.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredInventory.length / itemsPerPage);
    useEffect(() => {
        setCurrentPage((previous) => Math.min(previous, Math.max(totalPages, 1)));
    }, [totalPages]);
    const getProductImageUrl = (item) => String(item?.imageUrl || '').trim();
    const previewableInventoryItems = useMemo(() => {
        return filteredInventory.filter((item) => getProductImageUrl(item));
    }, [filteredInventory]);

    const getStatusColor = (status) => {
        switch(status) {
            case 'Out of Stock': return 'bg-red-50 text-red-600 border border-red-200 font-semibold';
            case 'Low Stock': return 'bg-yellow-50 text-yellow-600 border border-yellow-200 font-semibold'; 
            default: return 'bg-emerald-50 text-emerald-600 border border-emerald-200 font-semibold'; 
        }
    };

    const openProductImagePreview = (item) => {
        const imageUrl = getProductImageUrl(item);
        if (!imageUrl) return;

        setEnlargedProductImage({
            src: imageUrl,
            alt: item?._displayName || item?.name || item?.code || 'Product image',
            code: item?.code || imageUrl,
        });
    };

    const navigateProductImagePreview = (direction) => {
        if (!enlargedProductImage || previewableInventoryItems.length <= 1) return;

        const currentIndex = previewableInventoryItems.findIndex((item) => {
            const itemImageUrl = getProductImageUrl(item);
            return item.code === enlargedProductImage.code || itemImageUrl === enlargedProductImage.src;
        });

        if (currentIndex < 0) return;

        const nextIndex = (currentIndex + direction + previewableInventoryItems.length) % previewableInventoryItems.length;
        const nextItem = previewableInventoryItems[nextIndex];

        setEnlargedProductImage({
            src: getProductImageUrl(nextItem),
            alt: nextItem?._displayName || nextItem?.name || nextItem?.code || 'Product image',
            code: nextItem?.code || getProductImageUrl(nextItem),
        });
    };

    const closeProductImagePreview = () => {
        setEnlargedProductImage(null);
    };

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
    }, [enlargedProductImage, previewableInventoryItems]);

    // --- STOCK MANAGEMENT LOGIC ---

    const handleCloseStockModal = () => {
        if (stockSubmitInFlightRef.current || expiryReconcileSubmitRef.current || isExpiryReconciling) return;
        resetStockViewTransition();
        expiryBatchRequestSequenceRef.current += 1;
        expiryVerificationLoadRef.current = false;
        setIsLoadingExpiryVerification(false);
        setIsStockModalOpen(false);
        setIsStockVerificationView(false);
        setHasExpandedInlineStockModal(false);
        setEnableExpiryTrackingOnStockIn(false);
        setExpiryVerificationLoadError('');
        setExpiryVerificationProduct(null);
        setExpiryVerificationNeedsRefresh(false);
        setExpiryReconcileRows([]);
        setExpiryReconcileTouched(false);
    };

    const handleOpenStockModal = async (item, action) => {
        resetStockViewTransition();
        stockAdjustmentRequestIdRef.current = createClientRequestId('stock-adjustment');
        expiryBatchRequestSequenceRef.current += 1;
        expiryVerificationLoadRef.current = false;
        setIsLoadingExpiryVerification(false);
        setStockDetailsNeedReview(false);
        setStockDetailsSyncStatus(item.expiryTrackingEnabled ? 'loading' : 'success');
        setSelectedItem(item);
        setModalAction(action);
        setHasExpandedInlineStockModal(false);
        setEnableExpiryTrackingOnStockIn(false);
        setIsStockVerificationView(false);
        setIsExpiryVerificationModalOpen(false);
        setExpiryVerificationProduct(null);
        setExpiryVerificationLoadError('');
        setExpiryVerificationNeedsRefresh(false);
        setExpiryReconcileRows([]);
        setExpiryReconcileTouched(false);
        setStockForm({ quantity: '', reason: action === 'IN' ? 'Delivery' : 'Damage', notes: '', otherReason: '', expiryDate: '', lotNumber: '' });
        setStockOutAllocations({});
        setExpiryBatchView({ batches: [], reconciled: false, loadedProductId: null });
        setIsStockModalOpen(true);
        retryOpenExpiryBatchRefreshRef.current = () => void refreshStockDetailsAfterConflict(item.id);
        if (item.expiryTrackingEnabled) {
            const requestSequence = expiryBatchRequestSequenceRef.current;
            try {
                const result = await listProductExpiryBatchesApi(item.id);
                if (requestSequence !== expiryBatchRequestSequenceRef.current) return;
                if (result?.receiptLedgerValid === false || result?.stockPartitionValid === false) {
                    throw new Error('Recorded batch quantities need review before stock can be changed.');
                }
                setExpiryBatchView({
                    ...result,
                    loadedProductId: String(item.id || ''),
                    batches: Array.isArray(result?.batches) ? result.batches : [],
                    reconciled: Boolean(result?.reconciled),
                });
                setStockDetailsSyncStatus('success');
                const existingStockToVerify = Number(result?.existingStockToVerify ?? result?.productStock ?? 0);
                if (action === 'IN' && !result?.reconciled && existingStockToVerify > 0) {
                    setExpiryVerificationProduct({
                        ...item,
                        ...result,
                        productId: String(item.id || ''),
                        productName: getInventoryProductDisplayName(item),
                        sku: item.code || item.sku || result?.sku || '',
                        inlineStockFlow: true,
                        activationPreview: false,
                        inlineActivationLoadPending: false,
                    });
                    setExpiryReconcileRows([{ expiryDate: '', quantity: '', lotNumber: '' }]);
                    setExpiryReconcileTouched(false);
                    setExpiryVerificationNeedsRefresh(false);
                    transitionStockVerificationView(true);
                }
            } catch (error) {
                if (requestSequence !== expiryBatchRequestSequenceRef.current) return;
                if (error?.status === 409) {
                    retryOpenExpiryBatchRefreshRef.current?.();
                    return;
                }
                setStockDetailsSyncStatus('error');
            }
        }
    };

    const handleStockSubmit = async (e) => {
        e.preventDefault();
        if (stockSubmitInFlightRef.current) return;
        if (!navigator.onLine) {
            showToast("You're Offline", 'Stock adjustments require an internet connection.', 'warning', 'stock-offline');
            return;
        }
        const hasValidQuantity = usesBatchRemovalQuantity
            ? Number.isSafeInteger(stockOutBatchAllocationTotal) && stockOutBatchAllocationTotal > 0
            : isWholeNumberInput(stockForm.quantity, { min: 1 });
        const qty = usesBatchRemovalQuantity ? stockOutBatchAllocationTotal : (hasValidQuantity ? Number(stockForm.quantity) : 0);
        const reasonValue = stockForm.reason === 'Other'
            ? String(stockForm.otherReason || '').trim()
            : String(stockForm.reason || '').trim();
        if (!selectedItem || !hasValidQuantity) {
            if (selectedItem) {
                setFormValidationErrors(e.currentTarget, {
                    [usesBatchRemovalQuantity ? 'batchAllocationQuantity' : 'quantity']: 'Enter a valid removal quantity greater than zero.',
                });
            }
            showToast('Invalid Quantity', 'Please enter a valid quantity (whole number).', 'error', 'stock-qty');
            return;
        }
        if (!reasonValue) {
            setFormValidationErrors(e.currentTarget, { otherReason: 'Enter a reason for this stock adjustment.' });
            showToast('Missing Reason', 'Please select or enter a reason.', 'error', 'stock-reason');
            return;
        }
        const shouldTrackExpiry = modalAction === 'IN'
            && (selectedItem?.expiryTrackingEnabled === true || enableExpiryTrackingOnStockIn);
        if (modalAction === 'IN' && enableExpiryTrackingOnStockIn && Number(selectedItem?.stock || 0) > 0) {
            showToast('Verify Existing Stock', 'Assign the current stock to batches before adding a new delivery.', 'warning', 'expiry-verification');
            handleEnterInlineStockVerification();
            return;
        }
        if (modalAction === 'OUT' && selectedItem?.expiryTrackingEnabled === true && !expiryBatchView.reconciled) {
            showToast('Batch Verification Needed', 'Verify Batches before removing tracked stock.', 'error', 'expiry-verification');
            return;
        }
        if (usesBatchRemovalQuantity && (stockOutBatchAllocationInvalid || !stockOutBatchSelectionComplete)) {
            setFormValidationErrors(e.currentTarget, { batchAllocationQuantity: 'Adjust the batch quantities so each removal is valid and available.' });
            showToast('Invalid Batch Quantity', 'Select a valid quantity from the available batches.', 'error', 'expiry-allocation');
            return;
        }

        const currentStock = selectedItem.stock || 0;
        if (modalAction === 'OUT') {
            if (currentStock <= 0) {
                showToast('Cannot remove stock', 'Current stock is 0. Cannot perform Stock Out.', 'error', 'stock-zero');
                return;
            }
            if (qty > currentStock) {
                showToast('Insufficient stock', `Requested ${qty} but only ${currentStock} available.`, 'error', 'stock-insufficient');
                return;
            }
        }

        stockSubmitInFlightRef.current = true;
        setIsStockSubmitting(true);

        try {
        const maxStockLimit = (appSettings && appSettings.maxStockLimit) ? parseInt(appSettings.maxStockLimit) : 100;
        const updatedInventory = inventory.map(item => {
            if (item.code === selectedItem.code) {
                let newStock = item.stock;
                if (modalAction === 'IN') {
                    newStock += qty;
                    if (newStock > maxStockLimit) {
                        const capped = maxStockLimit;
                        showToast('Max Stock Reached', `Stock for ${item.code} capped to ${capped}.`, 'warning', 'stock-cap');
                        newStock = capped;
                    }
                } else {
                    newStock = Math.max(0, item.stock - qty);
                }
                const statusCarrier = { ...item, stock: newStock };
                return { 
                    ...item, 
                    stock: newStock,
                    status: deriveStatus(statusCarrier)
                };
            }
            return item;
        });

        const selectedUpdatedItem = updatedInventory.find(item => item.code === selectedItem.code);
        const token = getAuthToken();
        if (!token || !selectedItem.id || !selectedUpdatedItem) {
            showToast('Stock Adjustment Failed', 'Unable to identify the product for this stock adjustment.', 'error', 'stock-sync');
            return;
        }

        let persistedProduct;
        try {
            persistedProduct = await updateProductStockApi(selectedItem.id, selectedUpdatedItem.stock, {
                adjustmentReason: reasonValue,
                adjustmentRequestId: stockAdjustmentRequestIdRef.current,
                adjustmentType: modalAction,
                adjustmentQuantity: qty,
                expectedStock: inventory.find((item) => item.code === selectedItem.code)?.stock,
                expectedUpdatedAt: inventory.find((item) => item.code === selectedItem.code)?.updatedAt,
                ...(modalAction === 'OUT' && stockOutBatchAllocationRows.length > 0 ? { batchAllocations: stockOutBatchAllocationRows } : {}),
                ...(shouldTrackExpiry ? {
                    expiryBatch: { expiryDate: stockForm.expiryDate, lotNumber: stockForm.lotNumber },
                    enableExpiryTracking: enableExpiryTrackingOnStockIn,
                } : {}),
            });
        } catch (error) {
            if (error?.status === 409) {
                if (selectedItem?.expiryTrackingEnabled && retryOpenExpiryBatchRefreshRef.current) {
                    retryOpenExpiryBatchRefreshRef.current?.();
                } else {
                    void refreshStockDetailsAfterConflict(selectedItem?.id);
                }
            }
            showToast(
                isApiConnectionFailure(error) ? 'Cannot reach API server.' : 'Stock Adjustment Failed',
                error.message || 'Stock change was not saved.',
                'error',
                'stock-sync'
            );
            return;
        }

        const confirmedStock = Number(persistedProduct?.stock ?? selectedUpdatedItem.stock);
        setInventory((previous) => previous.map((item) => {
            if (item.id !== selectedItem.id) return item;
            const confirmedItem = {
                ...item,
                stock: confirmedStock,
                updatedAt: persistedProduct?.updatedAt || item.updatedAt,
                ...(persistedProduct?.expiryTrackingEnabled !== undefined
                    ? { expiryTrackingEnabled: persistedProduct.expiryTrackingEnabled }
                    : {}),
                ...(persistedProduct?.expiryBatchReconciled !== undefined
                    ? { expiryBatchReconciled: persistedProduct.expiryBatchReconciled }
                    : {}),
                ...(persistedProduct?.expiryTrackingPeriodId !== undefined
                    ? { expiryTrackingPeriodId: persistedProduct.expiryTrackingPeriodId }
                    : {}),
                ...(persistedProduct?.expiryUnassignedStock !== undefined
                    ? { expiryUnassignedStock: persistedProduct.expiryUnassignedStock }
                    : {}),
            };
            return { ...confirmedItem, status: deriveStatus(confirmedItem) };
        }));
        setEnableExpiryTrackingOnStockIn(false);
        setIsStockVerificationView(false);
        setIsStockModalOpen(false);
        stockAdjustmentRequestIdRef.current = '';
        setExpiryMonitoringRefreshKey((current) => current + 1);
        if (modalAction === 'IN') {
            showToast(
                'Success',
                'Stock received successfully',
                'success',
                'stock-update',
            );
        } else {
            showToast('Updated', 'Stock adjusted successfully', 'save', 'stock-update');
        }
        } finally {
            stockSubmitInFlightRef.current = false;
            setIsStockSubmitting(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-80px)] flex flex-col gap-2">
            <div className="bg-slate-200/50 rounded-2xl border border-slate-300 shadow-inner flex flex-col md:min-h-full relative transition-colors">

            {/* Header Area */}
            <div className="p-3 pb-0 md:shrink-0">
                <div className="mb-3 flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                        <p className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">Stock Operations</p>
                        <p className="text-gray-500 dark:text-gray-400 text-[11px] md:text-xs font-medium mt-1">Manage stock in/out flow and adjustments</p>
                    </div>

                    <div role="tablist" aria-label="Inventory sections" className="inline-flex w-max max-w-full shrink-0 rounded-lg bg-gray-100 p-1">
                        {[
                            { id: 'stock', label: 'Stock Operations' },
                            { id: 'expiry', label: 'Expiry Monitoring' },
                        ].map((tab, index) => {
                            const isActive = activeInventoryTab === tab.id;
                            return <button
                                key={tab.id}
                                ref={(element) => { inventoryTabRefs.current[index] = element; }}
                                id={`inventory-tab-${tab.id}`}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                aria-controls={`inventory-panel-${tab.id}`}
                                tabIndex={isActive ? 0 : -1}
                                onClick={() => selectInventoryTab(tab.id)}
                                onKeyDown={(event) => handleInventoryTabKeyDown(event, index)}
                                className={`flex-none px-4 py-2 rounded-md text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 ${isActive
                                    ? 'text-white shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'}`}
                                style={isActive ? { backgroundColor: '#111827', color: '#ffffff' } : {}}
                            >
                                {tab.label}
                            </button>;
                        })}
                    </div>
                </div>
            </div>

            <div id="inventory-panel-stock" role="tabpanel" aria-labelledby="inventory-tab-stock" tabIndex={0} hidden={activeInventoryTab !== 'stock'} className="min-w-0">
            <div className="p-3 pb-0 md:shrink-0">
                {/* Toolbar */}
                <div className="flex items-center gap-2 mb-3">
                     {/* Search */}
                     <div className="main-toolbar-search group">
                        <input
                            type="text"
                            placeholder="Search items..."
                            value={searchQuery}
                            list="inventory-search-suggestions"
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="main-toolbar-search-input"
                        />
                        <datalist id="inventory-search-suggestions">
                            {inventorySearchSuggestions.map((term) => (
                                <option key={term} value={term} />
                            ))}
                        </datalist>
                         <div className="main-toolbar-search-icon">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                     </div>

                     {/* Single Filter & Sort Button */}
                     <div className="relative z-30 inline-flex items-center gap-3">
                        <button 
                            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                            className="shrink-0 whitespace-nowrap px-3 py-2 rounded-xl font-semibold text-xs shadow-sm flex items-center gap-1.5 transition-all border-2 bg-gray-900 dark:bg-gray-600 text-white border-gray-900 dark:border-gray-500 hover:opacity-90"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                            <span>Filter & Sort</span>
                            <svg className={`w-3 h-3 transition-transform ${isFilterPanelOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>

                            {/* Category select (adjacent to Filter & Sort) */}
                            <div className="hidden sm:inline-flex items-center">
                                <ToolbarDropdown
                                    value={categoryFilter}
                                    onChange={setCategoryFilter}
                                    options={categories.map((category) => ({
                                        value: category,
                                        label: category === 'All' ? 'All Categories' : category,
                                    }))}
                                    ariaLabel="Filter inventory by category"
                                    className="w-fit max-w-full"
                                    menuClassName="w-max min-w-[min(16rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-[min(50vh,20rem)] overflow-y-auto pr-3 [scrollbar-gutter:stable]"
                                    compact
                                    portalMenu
                                    fitSelectedValue
                                    softForeground
                                    focusVisibleRing
                                />
                            </div>


                        {/* Combined Filter & Sort Panel */}
                        {isFilterPanelOpen && (
                            <div className="absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 py-2 z-50 right-0 md:left-0 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[70vh] overflow-y-auto">
                                
                                {/* Status Section */}
                                <div className="px-3 pt-2 pb-1">
                                    <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Status</div>
                                </div>
                                <div className="px-2 pb-2 flex flex-wrap gap-1">
                                    {['All', 'In Stock', 'Low Stock', 'Out of Stock'].map(status => (
                                        <button key={status} onClick={() => setStatusFilter(status)}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                                                statusFilter === status
                                                ? 'bg-gray-900 dark:bg-gray-600 text-white shadow-sm'
                                                : status === 'Low Stock' ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400'
                                                : status === 'Out of Stock' ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'
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
                                    {[{key: 'off', label: 'Default'}, {key: 'stock-asc', label: 'Stock ↑ Lowest'}, {key: 'stock-desc', label: 'Stock ↓ Highest'}, {key: 'name-asc', label: 'Name A→Z'}, {key: 'name-desc', label: 'Name Z→A'}].map(opt => (
                                        <button key={opt.key} onClick={() => setSortBy(opt.key)}
                                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
                                                sortBy === opt.key
                                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                            }`}>
                                            <span>{opt.label}</span>
                                            {sortBy === opt.key && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>}
                                        </button>
                                    ))}
                                </div>

                                {/* Clear All + Close */}
                                {activeFilterCount > 0 && (
                                    <>
                                        <div className="border-t border-gray-100 dark:border-gray-700 mx-3"></div>
                                        <div className="px-2 pt-2 pb-1">
                                            <button onClick={() => { setStatusFilter('All'); setCategoryFilter('All'); setSortBy('off'); }}
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
            
                {/* Backdrop for closing panel */}
                {isFilterPanelOpen && (
                    <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsFilterPanelOpen(false)} />
                )}
            </div>

            {/* Inventory Table */}
            <div ref={listContainerRef} className="overflow-x-auto overscroll-x-contain px-4 pb-4">
                <table className="main-data-table w-full text-left border-separate border-spacing-0 table-fixed min-w-[980px] md:min-w-205">
                    <thead className="sticky top-0 z-10 shadow-sm">
                        <tr className="bg-gray-900 dark:bg-gray-700 text-white uppercase tracking-wider">
                            <th className="py-2 px-3 w-[15%] text-center text-[11px] font-semibold border border-gray-700">SKU</th>
                            <th className="py-2 px-3 w-[10%] text-center text-[11px] font-semibold border border-gray-700">Photo</th>
                            <th className="py-2 px-3 w-[21%] md:w-[25%] text-center text-[11px] font-semibold border border-gray-700">Product</th>
                            <th className="py-2 px-3 w-[13%] md:w-[15%] text-center text-[11px] font-semibold border border-gray-700">Category</th>
                            <th className="w-[12%] border border-gray-700 py-2 pl-6 pr-3 text-left text-[11px] font-semibold">Current Stock</th>
                            <th className="py-2 px-3 w-[12%] md:w-[10%] text-center text-[11px] font-semibold border border-gray-700">Status</th>
                            <th className="py-2 pl-3 pr-5 w-[21%] text-center text-[11px] font-semibold border border-gray-700">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-gray-100 dark:divide-gray-700">
                        {isInventoryLoading ? (
                            <TableSkeletonRows rowKeyPrefix="inventory-skeleton" columnTypes={['text', 'text', 'text', 'text', 'text', 'pill', 'actions']} />
                        ) : filteredInventory.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="p-12 text-center text-gray-400 dark:text-gray-500">
                                    <div className="flex flex-col items-center">
                                        <svg className="w-12 h-12 mb-3 text-gray-200 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                                        <p className="font-medium">No inventory items found matching your filters.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            currentItems.map((item) => (
                                <tr key={item.code} onClick={(event) => handleInventoryRowClick(event, item)} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                                    <td className="px-3 py-1.5 text-center border border-gray-200 dark:border-gray-700">
                                        <IdentifierChip>{item.code}</IdentifierChip>
                                    </td>
                                    <td className="px-3 py-1.5 text-center border border-gray-200 dark:border-gray-700">
                                            <RemoteProductImage
                                                fit="cover"
                                                product={item}
                                                onPreview={(event, loadedProduct) => openProductImagePreview(loadedProduct)}
                                                alt={item._displayName || item.name || item.code || 'Product'}
                                                className="group/photo mx-auto h-10 w-10 rounded-lg border border-gray-200 bg-gray-100 transition-transform duration-150 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:focus:ring-gray-300"
                                                imageClassName="transition-all duration-200 group-hover/photo:scale-110 group-hover/photo:opacity-35 group-hover/photo:blur-[1.5px]"
                                            />
                                    </td>
                                    <td className="px-3 py-1.5 text-center border border-gray-200 dark:border-gray-700">
                                        {(() => {
                                            const productName = getInventoryProductDisplayName(item);
                                            const { name: baseName } = getInventoryProductNameParts(item, categoryConfigurations, productName);
                                            const groupKey = getInventoryProductSpecificationGroupKey(item, productName, categoryConfigurations);
                                            const sameNameProducts = productSpecificationGroups.get(groupKey) || [{
                                                ...item,
                                                _inventoryTableDisplayName: productName,
                                                _inventoryTableProductName: baseName,
                                                _inventoryTableProductBaseName: baseName,
                                            }];
                                            const specifications = hasStoredProductName(item)
                                                ? getInventoryProductSpecifications(item, categoryConfigurations, productName, sameNameProducts)
                                                : [];
                                            return <div className="min-w-0">
                                                <span className="block truncate whitespace-nowrap text-[13px] font-semibold leading-tight text-gray-900 dark:text-white" title={productName}>
                                                    {baseName}
                                                </span>
                                                {specifications.length > 0 && <span
                                                    className="mt-0.5 block truncate whitespace-nowrap text-[10px] font-normal leading-tight text-gray-500 dark:text-gray-400"
                                                    title={specifications.map(({ name, value }) => `${name}: ${value}`).join(' · ')}
                                                >
                                                    {specifications.map(({ name, value }) => `${name}: ${value}`).join(' · ')}
                                                </span>}
                                            </div>;
                                        })()}
                                    </td>
                                    <td className="px-3 py-1.5 text-center border border-gray-200 dark:border-gray-700">
                                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">{item.category}</span>
                                    </td>
                                    <td className="py-1.5 pl-6 pr-3 text-left border border-gray-200 dark:border-gray-700">
                                        <span className="inline-flex max-w-full flex-wrap items-baseline justify-start gap-x-1">
                                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(item.stock)}</span>
                                            {getStockUnit(item) && <span className="min-w-0 break-words text-xs font-normal text-gray-500 dark:text-gray-400">{getStockUnit(item)}</span>}
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-center border border-gray-200 dark:border-gray-700">
                                        <span className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusColor(deriveStatus(item))}`}>
                                            {deriveStatus(item)}
                                        </span>
                                    </td>
                                    <td className="py-1.5 pl-3 pr-5 text-center border border-gray-200 dark:border-gray-700">
                                        <div className="flex flex-nowrap items-center justify-center gap-2 whitespace-nowrap">
                                            <button 
                                                onClick={() => handleOpenStockModal(item, 'IN')}
                                                data-row-action
                                                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-900 bg-gray-900 px-2.5 text-[11px] font-semibold tracking-normal text-white shadow-sm transition-colors hover:border-gray-800 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/25 dark:border-gray-500 dark:bg-gray-700 dark:text-white dark:hover:border-gray-400 dark:hover:bg-gray-600"
                                                title="Add Stock"
                                            >
                                                <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14M5 12h14"></path></svg>
                                                <span aria-hidden="true"></span>Add Stock
                                            </button>
                                            <button
                                                onClick={() => item.stock > 0 && handleOpenStockModal(item, 'OUT')}
                                                data-row-action
                                                disabled={item.stock <= 0}
                                                title={item.stock <= 0 ? 'No stock available' : 'Remove Stock'}
                                                className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[11px] font-semibold tracking-normal shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/25 ${
                                                    item.stock <= 0
                                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-[#24262a] dark:text-slate-500'
                                                    : 'border-slate-300 bg-white text-slate-700 hover:border-gray-500 hover:bg-slate-50 hover:text-gray-900 active:bg-slate-100 focus-visible:border-gray-500 focus-visible:bg-slate-50 focus-visible:text-gray-900 dark:border-slate-600 dark:bg-[#282b30] dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-slate-700 dark:hover:text-white dark:active:bg-slate-700 dark:focus-visible:border-slate-400 dark:focus-visible:bg-slate-700 dark:focus-visible:text-white'
                                                }`}
                                            >
                                                <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 12h14"></path></svg>
                                                <span>Remove Stock</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex shrink-0 flex-col items-start gap-3 border-t border-gray-100 bg-slate-200/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-gray-500 dark:text-gray-400 text-xs font-medium">
                        Showing <span className="font-semibold text-gray-900 dark:text-white">{filteredInventory.length === 0 ? 0 : indexOfFirstItem + 1}</span> to <span className="font-semibold text-gray-900 dark:text-white">{Math.min(indexOfLastItem, filteredInventory.length)}</span> of <span className="font-semibold text-gray-900 dark:text-white">{filteredInventory.length}</span> results
                    </div>
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} pageSize={itemsPerPage} onPageSizeChange={(pageSize) => { setItemsPerPage(pageSize); setCurrentPage(1); }} />
            </div>
            </div>

            <div id="inventory-panel-expiry" role="tabpanel" aria-labelledby="inventory-tab-expiry" tabIndex={0} hidden={activeInventoryTab !== 'expiry'} className="min-w-0">
            <ExpiryMonitoring
                products={inventory}
                categories={categoryConfigurations}
                refreshKey={expiryMonitoringRefreshKey}
                canCorrectExpiryDate={canReconcileExpiryBatches}
                canVerifyBatches={canReconcileExpiryBatches}
                onVerifyBatches={handleOpenExpiryVerification}
                onCorrectExpiryDate={handleStartExpiryCorrection}
                onProductDetails={openProductDetails}
            />
            </div>

            {expiryCorrectionBatch && (
                <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
                    <form onSubmit={handleSubmitExpiryCorrection} className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h2 className="text-sm font-semibold text-slate-900">Correct Expiry Date</h2>
                                <p className="mt-0.5 text-[10px] text-slate-500">Update the date for this batch only.</p>
                            </div>
                            <button type="button" onClick={() => setExpiryCorrectionBatch(null)} className="text-sm text-slate-400 hover:text-slate-600" aria-label="Close correction dialog">×</button>
                        </div>
                        <div className="space-y-3 p-4">
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
                                <p className="text-[10px] text-slate-500">Batch Reference</p>
                                <p className="mt-0.5 text-xs font-semibold text-slate-800">{expiryCorrectionBatch.batchReference || expiryCorrectionBatch.batchId || 'Reference pending'}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block text-[11px] font-medium text-slate-700">Current Expiry Date
                                    <input type="date" readOnly value={expiryCorrectionBatch.expiryDate || ''} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-slate-50 px-2 text-xs text-slate-700" />
                                </label>
                                <label className="block text-[11px] font-medium text-slate-700">New Expiry Date <span className="text-rose-600">*</span>
                                    <input type="date" required value={expiryCorrectionBatch.newExpiryDate || expiryCorrectionBatch.expiryDate || ''} onChange={(event) => setExpiryCorrectionBatch((current) => ({ ...current, newExpiryDate: event.target.value }))} className="mt-1 block h-9 w-full rounded-md border border-slate-300 px-2 text-xs" />
                                </label>
                            </div>
                            <label className="block text-[11px] font-medium text-slate-700">Reason for Correction <span className="text-rose-600">*</span>
                                <textarea required value={expiryCorrectionReason} onChange={(event) => setExpiryCorrectionReason(event.target.value)} className="mt-1 block min-h-16 w-full resize-y rounded-md border border-slate-300 p-2 text-xs" />
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={() => setExpiryCorrectionBatch(null)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                            <button type="submit" disabled={!expiryCorrectionReason.trim() || !(expiryCorrectionBatch.newExpiryDate || expiryCorrectionBatch.expiryDate)} className="app-primary-action expiry-correction-primary rounded-md px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Save Correction</button>
                        </div>
                    </form>
                </div>
            )}

            {isExpiryVerificationModalOpen && expiryVerificationProduct && !isStockModalOpen && (
                <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h2 className="text-sm font-semibold text-slate-900">Verify Batches</h2>
                                <p className="text-xs text-slate-500">
                                    {expiryVerificationProduct.productName || getInventoryProductDisplayName(expiryVerificationProduct)} · {expiryVerificationProduct.sku || expiryVerificationProduct.code || '—'}
                                </p>
                            </div>
                            <button type="button" onClick={handleCancelExpiryReconciliation} className="rounded-md p-1.5 text-lg leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Close Verify Batches modal">×</button>
                        </div>
                        <form onSubmit={handleExpiryReconciliation} className="space-y-4 p-4">
                            <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-3">
                                <p>Current Stock: <strong>{formatNumber(expiryVerificationProduct.productStock || 0)} {expiryVerificationProduct.sellingUnit || 'units'}</strong></p>
                                <p>Existing Stock to Verify: <strong>{formatNumber(expiryVerificationProduct.existingStockToVerify || 0)} {expiryVerificationProduct.sellingUnit || 'units'}</strong></p>
                                <p>New Stock Recorded: <strong>{formatNumber(expiryVerificationProduct.newStockRecorded || 0)} {expiryVerificationProduct.sellingUnit || 'units'}</strong></p>
                            </div>
                            {(expiryVerificationProduct.batches || []).length > 0 && <section className="space-y-2" aria-labelledby="recorded-expiry-batches-heading">
                                <h3 id="recorded-expiry-batches-heading" className="text-sm font-semibold text-slate-900">Recorded Batches</h3>
                                <div className="max-h-36 overflow-y-auto rounded-md border border-slate-200 bg-white">
                                    {(expiryVerificationProduct.batches || []).map((batch) => (
                                        <div key={batch._id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-slate-100 px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                                            <p className="truncate text-xs font-semibold text-slate-800" title={batch.batchReference || batch.batchId || ''}>{batch.batchReference || batch.batchId || 'Batch reference pending'}{batch.lotNumber ? ` · Lot ${batch.lotNumber}` : ''}</p>
                                            <p className="text-xs text-slate-600">{batch.expiryDate || 'Date not recorded'}</p>
                                            <p className="col-span-2 text-[10px] text-slate-500 sm:col-span-1 sm:text-right">Received {formatNumber(batch.quantityReceived || 0)} · Remaining {formatNumber(batch.remainingQuantity || 0)} {expiryVerificationProduct.sellingUnit || 'units'}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>}
                            <section className="space-y-3 rounded-lg border border-slate-200 p-4" aria-labelledby="expiry-batches-heading">
                                <div>
                                    <h3 id="expiry-batches-heading" className="text-sm font-semibold text-slate-900">Batch Details</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">Add a batch for each expiry date.</p>
                                </div>
                                {expiryReconcileRows.length === 0 && <p className="text-xs text-slate-500">No existing stock requires allocation.</p>}
                                {expiryReconcileRows.map((row, index) => (
                                    <div key={row._id || `expiry-row-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(9rem,1fr)_minmax(6rem,0.55fr)_minmax(12rem,1.3fr)_auto] md:items-end">
                                            <label className="text-xs font-medium text-slate-700">Expiry Date
                                                <input type="date" required placeholder="Select expiry date" value={row.expiryDate || ''} onChange={(event) => { setExpiryReconcileTouched(true); setExpiryReconcileRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expiryDate: event.target.value } : item)); }} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" />
                                            </label>
                                            <label className="text-xs font-medium text-slate-700">Quantity
                                                <input type="number" min="1" required value={row.quantity || ''} onChange={(event) => { setExpiryReconcileTouched(true); setExpiryReconcileRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item)); }} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="Enter quantity" />
                                            </label>
                                            <label className="text-xs font-medium text-slate-700">Batch / Lot No. (optional)
                                                <input type="text" maxLength={100} value={row.lotNumber || ''} onChange={(event) => setExpiryReconcileRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, lotNumber: event.target.value } : item))} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. LOT-2026-001" />
                                            </label>
                                            <button type="button" onClick={() => setExpiryReconcileRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-9 rounded-md border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">Remove</button>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                                    <button type="button" onClick={() => setExpiryReconcileRows((current) => [...current, { expiryDate: '', quantity: '', lotNumber: '' }])} className="h-8 rounded-md bg-slate-900 px-2 text-xs font-semibold text-white hover:bg-slate-800">Add Batch</button>
                                    <span className="text-xs font-semibold text-slate-700">{formatNumber(expiryReconcileTotal)} of {formatNumber(expiryReconcileTarget)} {expiryVerificationProduct.sellingUnit || 'units'} assigned</span>
                                </div>
                            </section>
                            {expiryReconcileTouched && !expiryReconcileDatesValid && <p className="text-xs text-rose-600">Select an expiry date for every batch.</p>}
                            {expiryReconcileTouched && !expiryReconcileQuantitiesValid && <p className="text-xs text-rose-600">Enter a positive whole quantity for every batch.</p>}
                            {expiryVerificationNeedsRefresh && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                                <span>Inventory changed. Refresh batch details before confirming.</span>
                                <button type="button" onClick={refreshExpiryVerification} disabled={isLoadingExpiryVerification || isExpiryReconciling} className="font-semibold underline disabled:opacity-60">{isLoadingExpiryVerification ? 'Refreshing…' : 'Refresh details'}</button>
                            </div>}
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={handleCancelExpiryReconciliation} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold">Cancel</button>
                                <button type="submit" disabled={!expiryReconcileValid || isExpiryReconciling || isLoadingExpiryVerification || expiryVerificationNeedsRefresh} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{isExpiryReconciling ? 'Saving...' : 'Confirm Batches'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isStockModalOpen && (
                <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <MotionDiv
                        ref={stockModalRef}
                        layout={false}
                        onLayoutAnimationComplete={finishStockViewTransition}
                        onTransitionEnd={(event) => {
                            if (isCenteredStockExpansionTransition && event.target === event.currentTarget && event.propertyName === 'max-width') {
                                finishStockViewTransition();
                            }
                        }}
                        className={`max-h-[calc(100vh-2rem)] w-full ${usesWideStockModal ? 'max-w-[46rem]' : 'max-w-[31rem]'} overflow-x-hidden overflow-y-auto rounded-2xl bg-white shadow-2xl ${prefersReducedMotion ? 'transition-none' : 'transition-all'} dark:bg-gray-800`}
                    >
                        <div className="flex items-center justify-between border-b-2 border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6">
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {isStockVerificationView ? 'Verify Batches' : (modalAction === 'IN' ? 'Add Stock' : 'Remove Stock')}
                                </h2>
                                <p className="mt-0.5 truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                                    {selectedItem ? getInventoryProductDisplayName(selectedItem) : 'Inventory item'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleCloseStockModal}
                                disabled={isStockSubmitting || isExpiryReconciling || (modalAction === 'OUT' && (stockDetailsNeedReview || stockDetailsSyncStatus === 'loading' || stockDetailsSyncStatus === 'error'))}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                aria-label={`Close ${modalAction === 'IN' ? 'add stock' : 'remove stock'} modal`}
                            >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <MotionDiv
                            className="grid min-w-0"
                            layout={isCenteredStockExpansionTransition ? false : 'size'}
                            transition={{ layout: { duration: stockViewTransitionDuration, ease: [0.22, 1, 0.36, 1] } }}
                        >
                            <AnimatePresence
                                initial={false}
                                mode="wait"
                                onExitComplete={() => {
                                    if (!isStockVerificationView && !enableExpiryTrackingOnStockIn) {
                                        setHasExpandedInlineStockModal(false);
                                    }
                                }}
                            >
                        {isStockVerificationView && expiryVerificationProduct ? <StockModalAnimatedView
                            key="verify-batches-view"
                            direction={1}
                            duration={stockViewTransitionDuration}
                            centerExpansion={isCenteredStockExpansionTransition}
                            onEntered={finishStockViewTransition}
                        ><div>
                            {expiryVerificationProduct.inlineActivationLoadPending && isLoadingExpiryVerification ? <div className="space-y-4 p-4">
                                <p className="text-center text-sm text-slate-600" role="status" aria-live="polite">Loading batch details...</p>
                                <div className="flex justify-end"><button type="button" onClick={handleCloseStockModal} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button></div>
                            </div> : expiryVerificationLoadError ? <div className="space-y-4 p-4">
                                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700" role="alert">{expiryVerificationLoadError}</div>
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={handleCloseStockModal} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                                    {!expiryVerificationLoadError.includes('Only an administrator can verify existing expiry batches.') && <button type="button" onClick={() => void handleOpenExpiryVerification(expiryVerificationProduct, { inlineStock: true, activationPreview: expiryVerificationProduct.activationPreview === true, enterInlineViewBeforeFetch: true })} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Retry</button>}
                                </div>
                            </div> : <ExpiryBatchVerificationForm
                                product={expiryVerificationProduct}
                                rows={expiryReconcileRows}
                                onRowsChange={setExpiryReconcileRows}
                                onTouched={setExpiryReconcileTouched}
                                onSubmit={handleExpiryReconciliation}
                                onCancel={handleCloseStockModal}
                                onRefresh={refreshExpiryVerification}
                                isLoading={isLoadingExpiryVerification}
                                isSubmitting={isExpiryReconciling}
                                needsRefresh={expiryVerificationNeedsRefresh}
                                inlineStockFlow={expiryVerificationProduct.inlineStockFlow === true}
                            />}
                        </div></StockModalAnimatedView> : isInitialTrackedStockInLoading ? <MotionDiv
                            key="stock-initial-loading-view"
                            initial={false}
                            animate={{ opacity: 1 }}
                            className="px-5 py-7"
                            role="status"
                            aria-live="polite"
                        ><p className="text-center text-sm text-slate-600">Refreshing current inventory details...</p></MotionDiv> : isInitialTrackedStockInError ? <div
                            key="stock-initial-error-view"
                            className="p-4"
                            role="alert"
                        ><div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                            <span>Unable to load current inventory details.</span>
                            <button type="button" onClick={retryStockDetailsRefresh} className="font-semibold underline">Retry</button>
                        </div></div> : <StockModalAnimatedView
                            key="stock-operation-view"
                            direction={-1}
                            duration={stockViewTransitionDuration}
                            centerExpansion={isCenteredStockExpansionTransition}
                            onEntered={finishStockViewTransition}
                        ><form onSubmit={handleStockSubmit} className="space-y-3 p-4 sm:p-4">
                            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                                <div><p className="text-gray-500">Unit</p><p className="font-semibold text-gray-900 dark:text-white">{getStockUnit(selectedItem) || 'Not specified'}</p></div>
                                <div><p className="text-gray-500">Current stock</p><p className="font-semibold text-gray-900 dark:text-white">{formatStockWithUnit(selectedItem)}</p></div>
                            </div>
                            {stockDetailsSyncStatus === 'loading' && <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">Refreshing current inventory details...</p>}
                            {stockDetailsSyncStatus === 'error' && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">Unable to refresh inventory details. <button type="button" onClick={retryStockDetailsRefresh} className="font-semibold underline">Retry</button></div>}
                            {stockDetailsNeedReview && <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">Inventory changed while this form was open. Review the refreshed details before continuing.<button type="button" onClick={() => setStockDetailsNeedReview(false)} className="ml-2 font-semibold underline">I’ve reviewed the update</button></div>}
                            {modalAction === 'IN' && selectedItem && !selectedItem.expiryTrackingEnabled && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Expiry Tracking</p>
                                <label className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={enableExpiryTrackingOnStockIn}
                                        onChange={(event) => { void handleExpiryTrackingToggle(event.target.checked); }}
                                        disabled={!canReconcileExpiryBatches || isExpiryReconciling}
                                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                                    />
                                    <span>This product has expiry tracking</span>
                                </label>
                                {isLoadingExpiryVerification && <p className="mt-1 pl-6 text-[10px] text-slate-500">Loading existing stock for verification...</p>}
                                {!canReconcileExpiryBatches && <p className="mt-1 pl-6 text-[10px] text-slate-500">Administrator access is required to enable expiry tracking.</p>}
                            </div>}
                            {stockInTracksExpiry && <>
                                <section className="rounded-xl border border-slate-200 bg-slate-50 p-3" aria-labelledby="stock-in-batch-details-heading">
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <h3 id="stock-in-batch-details-heading" className="text-xs font-semibold text-slate-800">Batch Details</h3>
                                            <p className="mt-0.5 text-[10px] text-slate-500">{expiryBatchView.reconciled ? 'Current expiry batches are verified.' : 'Verify the current stock before recording a new delivery.'}</p>
                                        </div>
                                        {(Number(selectedItem?.stock || 0) > 0 && (!expiryBatchView.reconciled || enableExpiryTrackingOnStockIn)) && <button
                                            type="button"
                                            onClick={handleEnterInlineStockVerification}
                                            disabled={!canReconcileExpiryBatches || isLoadingExpiryVerification || isExpiryReconciling}
                                            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                        >Verify Batches</button>}
                                    </div>
                                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                        <table className="w-full min-w-[620px] text-left text-[11px] text-slate-700">
                                            <thead className="bg-gray-900 text-[10px] uppercase tracking-wide text-white">
                                                <tr>
                                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">Batch No.</th>
                                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">Expiry Date</th>
                                                    <th className="whitespace-nowrap px-2 py-2 text-right font-semibold">Received</th>
                                                    <th className="whitespace-nowrap px-2 py-2 text-right font-semibold">Remaining</th>
                                                    <th className="whitespace-nowrap px-2 py-2 text-right font-semibold">Reserved</th>
                                                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {selectedStockDetailsLoaded && expiryBatchView.batches.length > 0 ? expiryBatchView.batches.map((batch) => (
                                                    <tr key={batch._id}>
                                                        <td className="px-2 py-2">
                                                            <span className="block whitespace-nowrap font-semibold text-slate-900">{batch.batchReference || batch.batchId || 'Reference pending'}</span>
                                                            {batch.lotNumber && <span className="mt-0.5 block whitespace-nowrap text-[10px] text-slate-500">Lot No.: {batch.lotNumber}</span>}
                                                        </td>
                                                        <td className="whitespace-nowrap px-2 py-2">{formatExpiryDateLabel(batch.expiryDate)}</td>
                                                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatNumber(batch.quantityReceived)}{getStockUnit(selectedItem) ? ` ${getStockUnit(selectedItem)}` : ''}</td>
                                                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatNumber(batch.remainingQuantity)}{getStockUnit(selectedItem) ? ` ${getStockUnit(selectedItem)}` : ''}</td>
                                                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatNumber(batch.reservedQuantity)}{getStockUnit(selectedItem) ? ` ${getStockUnit(selectedItem)}` : ''}</td>
                                                        <td className="whitespace-nowrap px-2 py-2 text-center">
                                                            {canReconcileExpiryBatches && batch.updatedAt ? <button
                                                                type="button"
                                                                title="Correct Expiry Date"
                                                                aria-label={`Correct Expiry Date for ${batch.batchReference || batch.batchId}`}
                                                                onClick={() => handleStartExpiryCorrection({ ...batch, productId: selectedItem.id })}
                                                                className="inline-flex h-[29px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-gray-900 bg-gray-900 px-1.5 text-[11px] font-semibold leading-none text-white shadow-sm transition-colors hover:border-gray-800 hover:bg-gray-800 active:border-gray-950 active:bg-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-gray-500 dark:bg-gray-700 dark:hover:border-gray-400 dark:hover:bg-gray-600 dark:active:border-gray-400 dark:active:bg-gray-600 dark:focus-visible:ring-gray-400/50 dark:focus-visible:ring-offset-slate-900"
                                                            >Correct Expiry Date</button> : <span className="text-slate-400">—</span>}
                                                        </td>
                                                    </tr>
                                                )) : <tr>
                                                    <td colSpan={6} className="px-3 py-4 text-center text-xs text-slate-500">No recorded expiry batches yet.</td>
                                                </tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <label className="block text-xs font-medium text-slate-700">New Stock Expiry Date
                                        <input type="date" name="expiryDate" data-validation-key="expiryDate" required value={stockForm.expiryDate || ''} onChange={(event) => setStockForm((current) => ({ ...current, expiryDate: event.target.value }))} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
                                    </label>
                                    <label className="block text-xs font-medium text-slate-700">Batch / Lot No. (optional)
                                        <input type="text" name="lotNumber" data-validation-key="lotNumber" maxLength={100} value={stockForm.lotNumber || ''} onChange={(event) => setStockForm((current) => ({ ...current, lotNumber: event.target.value }))} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. LOT-2026-001" />
                                    </label>
                                </div>
                            </>}
                            {modalAction === 'OUT' && expiryBatchView.reconciled ? <ExpiryBatchRemovalSelector
                                batches={expiryBatchView.batches}
                                allocations={stockOutAllocationQuantities}
                                unit={selectedItem?.sellingUnit || ''}
                                onChange={(batchId, value, batch) => setStockOutAllocations((previous) => ({
                                    ...previous,
                                    [batchId]: { quantity: value, batchDetails: batch },
                                }))}
                            /> : null}
                            {selectedItem?.expiryTrackingEnabled && !expiryBatchView.reconciled && <p className="text-xs text-amber-800">Batch verification needed.</p>}
                            {stockOutBatchAllocationReviewRows.length === 0 && stockOutBatchAllocationSnapshots.length > 0 && <p className="sr-only">Review Batch Availability</p>}
                            {!usesBatchRemovalQuantity && <div>
                                <label htmlFor="stock-operation-quantity" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Quantity</label>
                                <div className="flex w-full min-w-0 items-center justify-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const current = Number(stockForm.quantity || 0);
                                            const next = Math.max(1, Math.floor(current || 1) - 1);
                                            setStockForm({ ...stockForm, quantity: String(next) });
                                        }}
                                        className="h-10 w-10 shrink-0 rounded-xl border border-gray-200 bg-white text-lg font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                        aria-label="Decrease quantity"
                                    >
                                        -
                                    </button>
                                    <input 
                                        id="stock-operation-quantity"
                                        name="quantity"
                                        data-validation-key="quantity"
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        min="1"
                                        step="1"
                                        autoFocus
                                        required
                                        value={stockForm.quantity}
                                        onKeyDown={preventInvalidWholeNumberKeyDown}
                                        onPaste={preventInvalidWholeNumberPaste}
                                        onChange={e => setStockForm({ ...stockForm, quantity: sanitizeWholeNumberInput(e.target.value) })}
                                        className="min-w-0 flex-1 rounded-xl border-2 border-gray-200 bg-gray-50 p-2.5 text-center text-xl font-semibold text-gray-900 outline-none transition-colors placeholder-gray-300 focus:border-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-gray-400"
                                        placeholder="0"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const current = Number(stockForm.quantity || 0);
                                            const next = Math.max(1, Math.floor(current || 0) + 1);
                                            setStockForm({ ...stockForm, quantity: String(next) });
                                        }}
                                        className="h-10 w-10 shrink-0 rounded-xl border border-gray-200 bg-white text-lg font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                                        aria-label="Increase quantity"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>}

                            <div>
                                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Reason</label>
                                <select 
                                    className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                    name="reason"
                                    data-validation-key="reason"
                                    value={stockForm.reason}
                                    onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setStockForm((prev) => ({
                                            ...prev,
                                            reason: nextValue,
                                            otherReason: nextValue === 'Other' ? prev.otherReason : '',
                                        }));
                                    }}
                                >
                                    {modalAction === 'IN' ? (
                                        <>
                                            <option>Delivery</option>
                                            <option>Return</option>
                                            <option>Adjustment (Found)</option>
                                            <option>Other</option>
                                        </>
                                    ) : (
                                        <>
                                            <option>Damage</option>
                                            <option>Expired</option>
                                            <option>Loss / Theft</option>
                                            <option>Store Use</option>
                                            <option>Adjustment (Correction)</option>
                                            <option>Other</option>
                                        </>
                                    )}
                                </select>
                            </div>
                            {stockForm.reason === 'Other' && (
                                <div>
                                    <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Other Reason</label>
                                    <input
                                        type="text"
                                        name="otherReason"
                                        data-validation-key="otherReason"
                                        value={stockForm.otherReason}
                                        onChange={(e) => setStockForm((prev) => ({ ...prev, otherReason: e.target.value }))}
                                        className="w-full p-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-medium focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-500 outline-none text-gray-900 dark:text-white"
                                        placeholder="Enter reason"
                                    />
                                </div>
                            )}
                            {usesBatchRemovalQuantity && <p className="text-right text-xs font-semibold text-slate-700">Total to Remove: {formatNumber(stockOutBatchAllocationTotal)} {getStockUnit(selectedItem) || 'units'}</p>}

                            <button 
                                type="submit"
                                disabled={isStockSubmitting || isStockViewTransitioning || isLoadingExpiryVerification || (modalAction === 'IN' && selectedItem?.expiryTrackingEnabled === true && !expiryBatchView.reconciled) || (modalAction === 'IN' && enableExpiryTrackingOnStockIn && Number(selectedItem?.stock || 0) > 0) || (modalAction === 'IN' && stockInTracksExpiry && !String(stockForm.expiryDate || '').trim()) || (modalAction === 'OUT' && stockDetailsNeedReview) || stockDetailsSyncStatus === 'loading' || stockDetailsSyncStatus === 'error'}
                                className="w-full py-3 rounded-xl font-semibold tracking-widest text-white shadow-lg transition-transform transform hover:-translate-y-0.5 mt-2"
                                style={{ backgroundColor: '#111827' }}
                            >
                                {isStockSubmitting ? 'Processing...' : (modalAction === 'IN' ? 'Add Stock' : 'Remove Stock')}
                            </button>
                        </form></StockModalAnimatedView>}
                            </AnimatePresence>
                        </MotionDiv>
                    </MotionDiv>
                </div>
            )}

            {selectedProductDetails && (
                <ProductDetailsModalShell
                    title="Product Details"
                    subtitle="Reference information only"
                    widthClassName="max-w-xl"
                    aria-labelledby="inventory-product-details-title"
                    onClose={closeProductDetails}
                >
                    <InventoryProductDetails
                        product={selectedProductDetails}
                        categories={categories.filter((category) => category !== 'All').map((name) => ({ name }))}
                        appSettings={appSettings}
                        expiryStatus={!productDetailsExpiry ? 'loading' : productDetailsExpiry.error ? 'error' : 'success'}
                        expiryData={productDetailsExpiry}
                        selectedBatch={productDetailsBatch}
                        onRetryExpiry={() => openProductDetails(productDetailsId, productDetailsBatch)}
                        onImagePreview={(_, item) => openProductImagePreview(item)}
                    />
                </ProductDetailsModalShell>
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
                        {previewableInventoryItems.length > 1 && (
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
    </div>
    );
};

export default Inventory;
