import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getAlternatives,
    getManualRecommendationCandidates,
    getRawSystemRecommendations,
    getSystemRecommendationSourceCodes,
    getStockStatus,
    isActiveRecommendationProduct,
} from '../utils/recommendationLogic';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import ContextualEmptyState from '../components/ContextualEmptyState';
import { canAccess } from '../constants/roles';
import { showToast } from '../utils/toastHelper';
import Pagination from '../components/Pagination';
import { DesktopRecommendationSkeleton } from '../components/DesktopSkeletons';
import { formatCurrency } from '../utils/numberFormat';
import { addProductRecommendationApi, editProductRecommendationBasisApi, listActiveRecommendationProductsApi, removeProductRecommendationApi, reviewProductRecommendationApi } from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { getProductDisplayName } from '../utils/productDisplayName';
import { getEffectiveProductAttributes, productAttributeValues } from '../utils/productAttributes';
import { formatStockWithSellingUnit, getRecordedProductDetails, hasRecordedDetail } from '../utils/productDetailDisplay';
import RecommendationBasis from '../components/RecommendationBasis';
import { getRecommendationPresentation } from '../utils/recommendationPresentation';
import RecommendationBasisEditor from '../components/RecommendationBasisEditor';
import { getBlockedRecommendationEntries, getManualRecommendationLink, getRecommendationActionSources, getRecommendationReview, mergeRecommendationProduct, RECOMMENDATION_BASIS_LIMITS } from '../utils/recommendationBasis';
import { getInitialAlternativePreview, INITIAL_ALTERNATIVE_LIMIT, MOBILE_ALTERNATIVE_LIMIT } from '../utils/recommendationLayout';
import { ROLES } from '../constants/roles';

const secondaryActionClass = 'inline-flex min-h-7 items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-1';
const primaryActionClass = 'inline-flex min-h-7 items-center justify-center rounded-md border border-[#111827] bg-[#111827] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
const destructiveActionClass = 'inline-flex min-h-7 items-center justify-center rounded-md border border-rose-600 bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
const filterSelectClass = 'recommendation-filter-select h-9 w-full appearance-none rounded-xl border border-[#111827] bg-[#111827] px-3 pr-9 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const countUniqueRecommendationEntries = (entries = []) => new Set(
    entries
        .map((entry) => String(entry?.code || entry?.id || '').trim())
        .filter(Boolean)
).size;

const RecommendationThumbnail = ({ item, className = 'h-12 w-12' }) => {
    const [failedUrl, setFailedUrl] = useState('');
    const hasImage = item?.imageUrl && failedUrl !== item.imageUrl;
    return <div className={`shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${className}`}>
        {hasImage ? (
            <img src={item.imageUrl} alt="" onError={() => setFailedUrl(item.imageUrl)} className="h-full w-full object-contain p-0.5" />
        ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2 2-2a3 3 0 014 0l2 2m-14 4h16" />
                </svg>
            </div>
        )}
    </div>;
};

const Recommendation = () => {
    const navigate = useNavigate();
    const listContainerRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [stockScope, setStockScope] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 16;
    const { appSettings, userRole } = useAuth() || {};
    const canManage = userRole === ROLES.ADMIN || userRole === ROLES.SUPER_ADMIN;
    // Inventory helpers from context
    const { inventory: rawInventory, setInventory, processedInventory, categories: categoryDefinitions = [], isInventoryLoading, isCategoriesLoading, inventoryLoadError, retryInventory } = useInventory();
    const evaluationOptions = useMemo(() => ({ categories: categoryDefinitions, includeUnavailable: true }), [categoryDefinitions]);
    
    const [activeRecommendationProducts, setActiveRecommendationProducts] = useState(null);
    const [isRecommendationProductsLoading, setIsRecommendationProductsLoading] = useState(true);
    const [recommendationProductsError, setRecommendationProductsError] = useState(null);
    const [recommendationRetryVersion, setRecommendationRetryVersion] = useState(0);

    useEffect(() => {
        let disposed = false;
        let inFlight = false;
        let refreshPending = false;
        const refreshActiveProducts = async () => {
            if (disposed) return;
            if (inFlight) { refreshPending = true; return; }
            inFlight = true;
            setRecommendationProductsError(null);
            try {
                const products = await listActiveRecommendationProductsApi();
                if (!disposed && Array.isArray(products)) {
                    setActiveRecommendationProducts(products.filter(isActiveRecommendationProduct));
                    setRecommendationProductsError(null);
                }
            } catch (error) {
                // The shared catalog remains a safe fallback; recommendation logic
                // applies the same active-product check before presenting or using data.
                if (!disposed) setRecommendationProductsError(error);
            } finally {
                inFlight = false;
                if (!disposed) setIsRecommendationProductsLoading(false);
                if (refreshPending && !disposed) { refreshPending = false; void refreshActiveProducts(); }
            }
        };
        const unsubscribeInventory = subscribeRealtimeEvent('inventory.updated', refreshActiveProducts);
        const unsubscribeResync = subscribeRealtimeEvent('realtime.resync', refreshActiveProducts);
        void refreshActiveProducts();
        return () => {
            disposed = true;
            unsubscribeInventory();
            unsubscribeResync();
        };
    }, [recommendationRetryVersion]);

    // The recommendation endpoint is active-only. Keep the shared-catalog
    // fallback filtered too, so archived products never enter this page's UI.
    const inventory = useMemo(() => {
        const sharedProducts = rawInventory ?? processedInventory ?? [];
        const latestByIdentity = new Map(sharedProducts.flatMap((product) => [
            ...(product.id ? [[`id:${product.id}`, product]] : []),
            ...(product.code ? [[`sku:${product.code}`, product]] : []),
        ]));
        const activeCatalog = activeRecommendationProducts ?? sharedProducts;
        return activeCatalog
            .filter((product) => {
                const latest = latestByIdentity.get(product.id ? `id:${product.id}` : `sku:${product.code}`);
                return isActiveRecommendationProduct(product) && (!latest || isActiveRecommendationProduct(latest));
            })
            .map((product) => {
                const latest = latestByIdentity.get(product.id ? `id:${product.id}` : `sku:${product.code}`) || product;
                return { ...latest, name: getProductDisplayName(latest, categoryDefinitions) };
            });
    }, [activeRecommendationProducts, categoryDefinitions, rawInventory, processedInventory]);
    const isInitialRecommendationDataPending = inventory.length === 0 && (isInventoryLoading || isCategoriesLoading || isRecommendationProductsLoading);

    // State for Add Alternative Modal
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [activeTargetItem, setActiveTargetItem] = useState(null); // The item we are adding alternatives TO
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const [debouncedAddSearchTerm, setDebouncedAddSearchTerm] = useState('');
    const [addFilterCategory, setAddFilterCategory] = useState('All'); // New state for category filter in modal
    const [basisEditor, setBasisEditor] = useState(null);
    const [isRemoving, setIsRemoving] = useState(false);
    const removalLock = useRef(false);

    // State for Product Details Modal
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [viewDetailsItem, setViewDetailsItem] = useState(null);
    const [comparisonTarget, setComparisonTarget] = useState(null);
    const [recommendationDrawerTarget, setRecommendationDrawerTarget] = useState(null);
    const detailsDialogRef = useRef(null);
    const recommendationDialogRef = useRef(null);
    useEffect(() => {
        const isStillActive = (product) => product && inventory.some((current) => (
            current.id === product.id && current.code === product.code && isActiveRecommendationProduct(current)
        ));
        if (viewDetailsItem && !isStillActive(viewDetailsItem)) {
            setIsDetailsModalOpen(false);
            setViewDetailsItem(null);
            setComparisonTarget(null);
        }
        if (recommendationDrawerTarget && !isStillActive(recommendationDrawerTarget)) setRecommendationDrawerTarget(null);
        if (activeTargetItem && !isStillActive(activeTargetItem)) {
            setIsAddModalOpen(false);
            setActiveTargetItem(null);
        }
        if (basisEditor && (!isStillActive(basisEditor.target) || !isStillActive(basisEditor.candidate))) setBasisEditor(null);
    }, [inventory, viewDetailsItem, recommendationDrawerTarget, activeTargetItem, basisEditor]);
    const openDetails = (product, target = null) => {
        setViewDetailsItem(product);
        setComparisonTarget(target);
        setIsDetailsModalOpen(true);
    };
    useEffect(() => {
        if (!isDetailsModalOpen) return undefined;
        const previousFocus = document.activeElement;
        detailsDialogRef.current?.querySelector('[aria-label="Close product details"]')?.focus();
        return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
    }, [isDetailsModalOpen]);
    const recommendationDialogOpen = Boolean(recommendationDrawerTarget);
    useEffect(() => {
        if (!recommendationDialogOpen) return undefined;
        const previousFocus = document.activeElement;
        recommendationDialogRef.current?.querySelector('[aria-label="Close recommendations"]')?.focus();
        return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
    }, [recommendationDialogOpen]);
    const handleRecommendationDialogKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setRecommendationDrawerTarget(null);
            return;
        }
        if (event.key !== 'Tab') return;
        const controls = [...(recommendationDialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || [])]
            .filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const handleDetailsKeyDown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); setIsDetailsModalOpen(false); return; }
        if (event.key !== 'Tab') return;
        const controls = [...detailsDialogRef.current.querySelectorAll('button:not(:disabled), summary')];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const detailAttributeDefinitions = useMemo(() => getEffectiveProductAttributes(
        categoryDefinitions.find((category) => category.name === viewDetailsItem?.category) || {}
    ), [categoryDefinitions, viewDetailsItem?.category]);
    const detailAttributeValues = useMemo(
        () => productAttributeValues(viewDetailsItem || {}, detailAttributeDefinitions),
        [detailAttributeDefinitions, viewDetailsItem]
    );
    const detailPresentation = getRecommendationPresentation(viewDetailsItem?.recommendation);
    const detailRecommendation = viewDetailsItem?.recommendation;
    const hasStaffReasons = Boolean(detailRecommendation?.staffReasons?.length);
    const hasAutomaticStaffNote = Boolean(detailRecommendation?.staffReview?.record?.justification?.trim()
        || detailRecommendation?.staffReview?.record?.limitations?.trim()
        || detailRecommendation?.staffReview?.record?.staffReasons?.length);
    const showStaffJustification = hasRecordedDetail(detailRecommendation?.adminJustification?.text)
        && !detailRecommendation.staffReasons?.some((row) => row.text?.trim() === detailRecommendation.adminJustification.text.trim());
    const recordedDetails = getRecordedProductDetails(viewDetailsItem, detailAttributeDefinitions, detailAttributeValues);

    // State for Confirmation Modal
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState(null); // { targetCode, alternativeCode, alternativeName }
    const [showBlockedRecommendations, setShowBlockedRecommendations] = useState(false);
    const [reviewBlockedOnly, setReviewBlockedOnly] = useState(false);

    // Restore hidden items on mount
    useEffect(() => {
        if (!setInventory) return;
        setInventory(prev => (prev || []).map(p => p.hiddenFromRecommendations ? { ...p, hiddenFromRecommendations: false } : p));
    }, [setInventory]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [searchTerm]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedAddSearchTerm(addSearchTerm);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [addSearchTerm]);

    // Unique filter categories
    const categories = useMemo(() => {
        const cats = new Set(inventory.map(i => i.category || 'Uncategorized'));
        return ['All', ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
    }, [inventory]);

    // Logic to find items that need recommendation
    const attentionItems = useMemo(() => {
        return inventory.filter(item => {
            if (!isActiveRecommendationProduct(item)) return false;
            const status = getStockStatus(item, appSettings);

            if (stockScope === 'needs-attention' && status === 'In Stock') return false;
            if (stockScope === 'in-stock' && status !== 'In Stock') return false;
            
            const searchLower = debouncedSearchTerm.toLowerCase();
            const matchesSearch = item.name.toLowerCase().includes(searchLower) || 
                                  item.code.toLowerCase().includes(searchLower) ||
                                  (item.brand || '').toLowerCase().includes(searchLower);

            const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;

            return matchesSearch && matchesCategory;
        }).sort((a, b) => {
            const nameCompare = String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
            if (nameCompare !== 0) return nameCompare;
            return String(a?.code || '').localeCompare(String(b?.code || ''), undefined, { sensitivity: 'base' });
        });
    }, [inventory, debouncedSearchTerm, selectedCategory, appSettings, stockScope]);

    const resetRecommendationFilters = () => {
        setSearchTerm('');
        setSelectedCategory('All');
        setStockScope('all');
    };
    const retryRecommendationData = () => {
        setRecommendationProductsError(null);
        setIsRecommendationProductsLoading(true);
        retryInventory();
        setRecommendationRetryVersion((version) => version + 1);
    };
    const recommendationEmptyState = recommendationProductsError || (inventoryLoadError && inventory.length === 0)
        ? { title: 'Recommendations unavailable', description: 'Product data could not be loaded. Please try again.', actionLabel: 'Retry', onAction: retryRecommendationData }
        : inventory.length === 0
            ? { title: 'No products available', description: 'Add products to start managing recommendations.', actionLabel: canManage && canAccess(userRole, 'ProductList') ? 'Go to Product Master List' : '', onAction: canManage && canAccess(userRole, 'ProductList') ? () => navigate('/product-list') : null }
            : (searchTerm.trim() || selectedCategory !== 'All' || stockScope !== 'all')
                ? { title: 'No matching results', description: 'Try a different search or filter.', actionLabel: 'Clear Filters', onAction: resetRecommendationFilters }
                : { title: 'No recommendations', description: 'No products currently need alternative recommendations.' };

    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, selectedCategory, stockScope]);

    const totalPages = Math.ceil(attentionItems.length / itemsPerPage);
    const hasResults = attentionItems.length > 0;
    const displayStart = hasResults ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const displayEnd = hasResults ? Math.min(currentPage * itemsPerPage, attentionItems.length) : 0;

    useEffect(() => {
        if (totalPages > 0 && currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const paginatedAttentionItems = useMemo(() => {
        if (!hasResults) return [];
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        return attentionItems.slice(startIndex, endIndex);
    }, [attentionItems, currentPage, hasResults]);

    useEffect(() => {
        if (!listContainerRef.current) return;
        listContainerRef.current.scrollTop = 0;
    }, [currentPage]);

    // Remove Alternative Trigger
    const handleRemoveAlternative = (targetItem, alternativeCode, alternativeName, type = 'alternative', mayRemainAutomatic = false) => {
        if (!canManage) return;
        setPendingRemoval({
            targetId: targetItem?.id,
            targetCode: targetItem?.code,
            alternativeCode,
            alternativeName,
            type,
            mayRemainAutomatic,
            expectedRevision: targetItem?.recommendationRevision || 0,
        });
        setIsConfirmModalOpen(true);
    };

    // Confirm Removal Logic
    const confirmRemoval = async () => {
        if (!pendingRemoval || !setInventory || !canManage || removalLock.current) return;

        const { targetId, targetCode, alternativeCode, type } = pendingRemoval;
        const targetItem = inventory.find((item) => item.id === targetId || item.code === targetCode);
        const storedCodes = targetItem?.[type === 'budget' ? 'manualBudgetOptions' : 'manualAlternatives'] || [];
        if (!targetItem?.id || !storedCodes.includes(alternativeCode)) {
            showToast('Unable to Remove', 'This recommendation is no longer available. Refresh and try again.', 'error');
            setIsConfirmModalOpen(false);
            setPendingRemoval(null);
            return;
        }

        removalLock.current = true;
        setIsRemoving(true);
        try {
            const updatedTarget = await removeProductRecommendationApi(targetItem.id, alternativeCode, type, { expectedRevision: pendingRemoval.expectedRevision });
            const manualField = type === 'budget' ? 'manualBudgetOptions' : 'manualAlternatives';
            const wasPersisted = !updatedTarget[manualField].includes(alternativeCode);

            if (!wasPersisted) {
                throw new Error('The recommendation was not removed.');
            }

            setInventory((current) => current.map((item) => (
                item.id === targetItem.id ? mergeRecommendationProduct(item, updatedTarget) : item
            )));
            setActiveRecommendationProducts((current) => current?.map((item) => (
                item.id === targetItem.id ? mergeRecommendationProduct(item, updatedTarget) : item
            )) ?? current);
            setRecommendationDrawerTarget((current) => (
                current?.id === targetItem.id ? mergeRecommendationProduct(current, updatedTarget) : current
            ));

            showToast('Success', `${type === 'budget' ? 'Budget option' : 'Alternative'} removed.`, 'success');
            setIsConfirmModalOpen(false);
            setPendingRemoval(null);
        } catch (error) {
            showToast('Unable to Remove', error?.message || 'The recommendation could not be removed.', 'error');
        } finally {
            removalLock.current = false;
            setIsRemoving(false);
        }
    };

    // Add Alternative Logic
    const openBasisEditor = (target, alternative, type = 'alternative', mode = 'edit') => {
        if (!canManage || !target) return;
        const currentTarget = inventory.find((item) => item.id === target.id) || target;
        const candidate = inventory.find((item) => item.id === alternative.id) || alternative;
        const basisType = mode === 'edit' ? alternative.recommendation?.basisRelationshipType || type : type;
        const link = getManualRecommendationLink(currentTarget, candidate, basisType);
        if (mode !== 'add' && (!link || !['current', 'legacy'].includes(link.status))) {
            showToast('Review Required', 'This SKU relationship changed. Remove the old link and re-add the current SKU after review.', 'error');
            return;
        }
        const suggestedReason = (alternative.recommendation?.reasons || []).filter(Boolean).join(' ').trim().slice(0, RECOMMENDATION_BASIS_LIMITS.systemSuggestion);
        const initialBasis = { ...(link?.record || {}) };
        if (mode === 'add') {
            initialBasis.systemSuggestion = suggestedReason;
            initialBasis.systemSuggestionIsHistorical = true;
            initialBasis.systemGenerated = alternative.isSystemRecommended === true;
        } else {
            initialBasis.systemSuggestionIsHistorical = Boolean(initialBasis.systemSuggestion?.trim());
            if (!initialBasis.systemSuggestion) initialBasis.systemSuggestion = suggestedReason;
        }
        if (initialBasis.systemGenerated === undefined) initialBasis.systemGenerated = false;
        if (!initialBasis.justification && mode !== 'review' && mode !== 'staff') initialBasis.justification = initialBasis.systemSuggestion || '';
        setBasisEditor({ target: currentTarget, candidate, type: basisType, mode, initialBasis, expectedRevision: currentTarget.recommendationRevision || 0 });
        if (mode === 'add') setIsAddModalOpen(false);
    };
    const handleAddAlternative = (alternative) => openBasisEditor(activeTargetItem, alternative, 'alternative', 'add');
    const saveBasis = async (values) => {
        if (!canManage || !basisEditor) throw new Error('Not authorized to edit recommendation basis.');
        const { target, candidate, type, mode, expectedRevision } = basisEditor;
        const payload = { ...values, type, recommendationCode: candidate.code, expectedTargetSku: target.code, expectedRevision };
        const updatedTarget = mode === 'review' || mode === 'staff'
            ? await reviewProductRecommendationApi(target.id, candidate.id, { ...values, recommendationCode: candidate.code, expectedTargetSku: target.code, expectedRevision })
            : mode === 'add'
            ? await addProductRecommendationApi(target.id, { ...payload, recommendationId: candidate.id })
            : await editProductRecommendationBasisApi(target.id, candidate.id, payload);
        const saved = mode === 'review' || mode === 'staff' ? getRecommendationReview(updatedTarget, candidate).record : getManualRecommendationLink(updatedTarget, candidate, type)?.record;
        if (!saved || saved.justification !== values.justification || saved.limitations !== values.limitations || (mode === 'add' && (saved.systemSuggestion !== values.systemSuggestion || saved.systemGenerated !== values.systemGenerated)) || JSON.stringify(saved.staffReasons || []) !== JSON.stringify(values.staffReasons || []) || (mode === 'review' || mode === 'staff' ? saved.decision !== values.decision || saved.reviewReason !== values.reviewReason : updatedTarget.recommendationRevision < expectedRevision)) {
            throw new Error('The saved basis could not be confirmed. Your input is retained; refresh before retrying.');
        }
        setInventory((current) => current.map((item) => item.id === target.id ? mergeRecommendationProduct(item, updatedTarget) : item));
        setActiveRecommendationProducts((current) => current?.map((item) => item.id === target.id ? mergeRecommendationProduct(item, updatedTarget) : item) ?? current);
        setRecommendationDrawerTarget((current) => current?.id === target.id ? mergeRecommendationProduct(current, updatedTarget) : current);
        setBasisEditor(null);
        if (mode === 'add') setAddSearchTerm('');
        showToast('Success', mode === 'review' ? 'Recommendation review saved.' : mode === 'staff' ? 'Staff justification saved.' : mode === 'add' ? 'Recommendation added.' : 'Recommendation basis saved.', 'success');
    };
    const openReviewEditor = (target, alternative, decision, restoreExclusions = false) => {
        if (!canManage) return;
        const current = inventory.find((item) => item.id === target.id) || target;
        const candidate = inventory.find((item) => item.id === alternative.id) || alternative;
        const review = getRecommendationReview(current, candidate);
        setBasisEditor({ target: current, candidate, mode: 'review', initialBasis: review.record || {}, reviewDecision: decision || review.decision, restoreExclusions, expectedRevision: current.recommendationRevision || 0 });
    };
    const openStaffJustificationEditor = (target, alternative) => {
        if (!canManage) return;
        const current = inventory.find((item) => item.id === target.id) || target;
        const candidate = inventory.find((item) => item.id === alternative.id) || alternative;
        const review = getRecommendationReview(current, candidate);
        if (!review.identityCurrent) {
            showToast('Review Required', 'This product identity changed. Review the recommendation before editing its staff note.', 'error');
            return;
        }
        setIsDetailsModalOpen(false);
        setBasisEditor({ target: current, candidate, mode: 'staff', initialBasis: review.record || {}, reviewDecision: review.decision, expectedRevision: current.recommendationRevision || 0 });
    };
    const renderEditBasis = (target, alternative, sources) => {
        if (!canManage || !sources.manual) return null;
        if (sources.overlappingBasis) return <details className="w-full min-w-0 text-xs"><summary className={`${primaryActionClass} cursor-pointer`}>Edit Basis</summary>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button type="button" className={secondaryActionClass} onClick={() => openBasisEditor(target, alternative, 'alternative')}>Edit alternative basis</button>
                <button type="button" className={secondaryActionClass} onClick={() => openBasisEditor(target, alternative, 'budget', 'legacy-edit')}>Edit legacy basis</button>
            </div>
        </details>;
        return <button type="button" onClick={() => openBasisEditor(target, alternative, sources.manualType)} className={primaryActionClass}>Edit Basis</button>;
    };
    const renderReviewActions = (target, alternative, sources, inDrawer = false) => {
        if (!canManage || !sources.automatic) return null;
        const review = alternative.recommendation.staffReview;
        const excluded = alternative.recommendation.excluded;
        if (!review.identityCurrent) {
            return inDrawer ? <button type="button" className={secondaryActionClass} onClick={() => openReviewEditor(target, alternative, 'not_reviewed', excluded)}>{excluded ? 'Restore' : 'Reconsider'}</button> : null;
        }
        if (review.decision === 'rejected') {
            return inDrawer ? <button type="button" className={secondaryActionClass} onClick={() => openReviewEditor(target, alternative, 'not_reviewed', excluded)}>{excluded ? 'Restore' : 'Reconsider'}</button> : null;
        }
        const controls = <>
                {review.decision !== 'approved' && <button type="button" className={primaryActionClass} onClick={() => openReviewEditor(target, alternative, 'approved')}>Approve</button>}
                <button type="button" className={destructiveActionClass} onClick={() => openReviewEditor(target, alternative, 'rejected')}>Reject</button>
                {inDrawer && excluded && <button type="button" className={secondaryActionClass} onClick={() => openReviewEditor(target, alternative, 'not_reviewed', true)}>Restore</button>}
            </>;
        return sources.manual
            ? <details className="w-full min-w-0 text-xs"><summary className={`${primaryActionClass} cursor-pointer`}>Manage System Review</summary><div className="mt-1.5 flex flex-wrap items-center gap-1.5">{controls}</div></details>
            : controls;
    };
    const renderAlternativeCard = (target, alternative, systemCodes, inDrawer = false) => {
        const sources = getRecommendationActionSources(target, alternative, systemCodes);
        return (
            <div key={alternative.code} className="recommendation-option-card group/alt flex min-w-0 self-start flex-col rounded-lg border border-slate-300 bg-white p-3 shadow-sm transition-all duration-300 hover:border-slate-500 hover:shadow-xl motion-reduce:transition-none">
                <div className="flex min-w-0 gap-2">
                    <RecommendationThumbnail item={alternative} />
                    <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900">{alternative.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{[alternative.brand, alternative.size, alternative.color].filter(Boolean).join(' · ') || alternative.code}</p>
                    </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                    <span className="text-sm font-semibold text-slate-900">{formatCurrency(alternative.price)}</span>
                    <span className="text-[11px] font-medium text-slate-600">Stock: {alternative.stock} {alternative.sellingUnit}</span>
                </div>
                <RecommendationBasis item={alternative} />
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => openDetails(alternative, target)} className={primaryActionClass}>View Details</button>
                    {renderEditBasis(target, alternative, sources)}
                    {canManage && sources.manual && <button type="button" onClick={() => handleRemoveAlternative(target, alternative.recommendation?.relationshipCode || alternative.code, alternative.name, sources.manualType, systemCodes.has(alternative.code))} className={destructiveActionClass}>Remove</button>}
                    {renderReviewActions(target, alternative, sources, inDrawer)}
                    {inDrawer && canManage && alternative.recommendation?.excluded && !sources.automatic && <button type="button" className={secondaryActionClass} onClick={() => openReviewEditor(target, alternative, 'not_reviewed', true)}>Restore exclusion</button>}
                </div>
            </div>
        );
    };

    // Filter items for "Add Alternative" modal
    const potentialAlternatives = useMemo(() => {
        if (!activeTargetItem) return [];
        
        // Get raw top recommendations by system (ignoring exclusions) to flag them
        const systemRecs = getRawSystemRecommendations(activeTargetItem, inventory, appSettings, evaluationOptions);
        const systemRecCodes = systemRecs.map(r => r.code);
        const existingCodes = new Set(getAlternatives(activeTargetItem, inventory, appSettings, { ...evaluationOptions, includeBlocked: true, maxSuggestions: inventory.length }).map((entry) => entry.code));
        return getManualRecommendationCandidates(activeTargetItem, inventory, {
            ...evaluationOptions,
            settings: appSettings,
            existingCodes,
            systemCodes: systemRecCodes,
            recommendationType: 'alternative',
            search: debouncedAddSearchTerm,
            category: addFilterCategory,
        });
    }, [inventory, activeTargetItem, debouncedAddSearchTerm, addFilterCategory, appSettings, evaluationOptions]);

    const recommendationSearchSuggestions = useMemo(() => {
        const terms = new Set();

        inventory.forEach((item) => {
            [item?.name, item?.category, item?.code]
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

    const addAlternativeSearchSuggestions = useMemo(() => {
        const terms = new Set();

        potentialAlternatives.forEach((item) => {
            [item?.name, item?.category, item?.code]
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
    }, [potentialAlternatives]);

    const allDrawerRecommendations = recommendationDrawerTarget
        ? getAlternatives(recommendationDrawerTarget, inventory, appSettings, { ...evaluationOptions, includeBlocked: showBlockedRecommendations, maxSuggestions: inventory.length })
        : [];
    const drawerRecommendations = reviewBlockedOnly ? getBlockedRecommendationEntries(allDrawerRecommendations) : allDrawerRecommendations;
    const drawerSystemCodes = new Set(recommendationDrawerTarget
        ? getSystemRecommendationSourceCodes(recommendationDrawerTarget, inventory, appSettings, evaluationOptions)
        : []);

    return (
        <div className="recommendation-page flex h-auto flex-col rounded-2xl border border-slate-300 bg-slate-200/50 p-3 shadow-inner sm:p-4 md:h-full md:overflow-hidden lg:p-5">
            {/* Header Section */}
            <div className="relative z-10 mb-4 flex shrink-0 flex-col gap-3">
                <div className="overflow-hidden">
                    <p className="text-2xl font-semibold tracking-tight leading-tight text-slate-900 md:text-3xl">Product Recommendation</p>
                    <p className="mt-1 text-xs text-slate-600">Manage product alternatives and view system suggestions.</p>
                </div>
                {/* Search / Filter Controls */}
                <div className="flex w-full flex-wrap items-stretch gap-2 sm:items-center">
                    <div className="main-toolbar-search group z-20">
                        <input
                            type="text"
                            placeholder="Search products..."
                            value={searchTerm}
                            list="recommendation-search-suggestions"
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="main-toolbar-search-input"
                        />
                        <datalist id="recommendation-search-suggestions">
                            {recommendationSearchSuggestions.map((term) => (
                                <option key={term} value={term} />
                            ))}
                        </datalist>
                         <div className="main-toolbar-search-icon">
                            <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>
                    <div className="relative min-w-36 flex-1 sm:max-w-48">
                        <select
                            aria-label="Filter recommendations by category"
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className={filterSelectClass}
                        >
                            {categories.map(cat => (
                                <option key={cat} value={cat} className="bg-white text-slate-900">{cat}</option>
                            ))}
                        </select>
                        <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
                    </div>
                    <div className="relative min-w-36 flex-1 sm:max-w-48">
                        <select
                            aria-label="Filter recommendations by stock"
                            value={stockScope}
                            onChange={(e) => setStockScope(e.target.value)}
                            className={filterSelectClass}
                        >
                            <option value="all" className="bg-white text-slate-900">All Products</option>
                            <option value="needs-attention" className="bg-white text-slate-900">Low/Out Stock</option>
                            <option value="in-stock" className="bg-white text-slate-900">In Stock</option>
                        </select>
                        <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div ref={listContainerRef} className="flex-1 overflow-y-auto pr-2 pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-200">
                {attentionItems.length === 0 ? (
                    <>
                    {isInitialRecommendationDataPending && <DesktopRecommendationSkeleton />}
                    {!isInitialRecommendationDataPending && <div className="mx-auto flex min-h-48 max-w-2xl items-center justify-center rounded-xl border border-slate-200 bg-white">
                        <ContextualEmptyState {...recommendationEmptyState} />
                    </div>}
                    </>
                ) : (
                    <>
                    <div className="grid grid-cols-1 items-start gap-5">
                        {paginatedAttentionItems.map((item) => {
                            const stockStatus = getStockStatus(item, appSettings);
                            const alternatives = getAlternatives(item, inventory, appSettings, { ...evaluationOptions, maxSuggestions: inventory.length });
                            const systemCodes = new Set(getSystemRecommendationSourceCodes(item, inventory, appSettings, evaluationOptions));
                            const isOutOfStock = stockStatus === 'Out of Stock';
                            const isLowStock = stockStatus === 'Low Stock';
                            const visibleAlternatives = getInitialAlternativePreview(alternatives);
                            const currentProductDetails = [
                                { label: 'Category', value: item.category },
                                { label: 'Color', value: item.color },
                            ].filter(({ value }) => String(value || '').trim());
                            const alternativeCount = countUniqueRecommendationEntries(alternatives);
                            
                            return (
                                <div key={item.code} className="recommendation-current-card self-start min-w-0 rounded-xl border border-slate-300 bg-white shadow-sm">
                                    <div className="flex flex-col items-start gap-4 p-4 sm:flex-row">
                                        {/* Left Side: Product Details (No Adjust Stock Button) */}
                                        <div className="recommendation-current-summary w-full min-w-0 self-start rounded-lg border border-slate-300 bg-slate-50 p-3 shadow-sm transition-all duration-300 hover:shadow-lg motion-reduce:transition-none sm:sticky sm:top-0 sm:w-[34%] sm:shrink-0">
                                            <div>
                                                <p className="mb-2 text-[11px] font-semibold text-slate-700">Current Product</p>
                                                <div className="flex min-w-0 items-start gap-3">
                                                    <RecommendationThumbnail item={item} className="h-20 w-20" />
                                                    <div className="min-w-0 flex-1">
                                                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{item.name}</h3>
                                                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{item.code}</p>
                                                    <p className="mt-1 text-xs text-slate-600">{[item.brand, item.size].filter(Boolean).join(' · ') || item.category}</p>
                                                    <span className={`mt-1.5 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                                                        isOutOfStock
                                                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                                            : isLowStock
                                                                ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                    }`}>
                                                        {stockStatus}
                                                    </span>
                                                    </div>
                                                </div>
                                                
                                                <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
                                                    <div>
                                                        <span className="block text-[11px] text-slate-500">Current Stock</span>
                                                        <span className={`text-base font-semibold ${item.stock <= 0 ? 'text-rose-600' : 'text-slate-900'}`}>{item.stock}<span className="ml-1 text-xs font-normal text-slate-600">{item.sellingUnit}</span></span>
                                                    </div>
                                                    <div>
                                                        <span className="block text-[11px] text-slate-500">Selling Price</span>
                                                        <span className="text-base font-semibold text-slate-900">{formatCurrency(item.price)}</span>
                                                    </div>
                                                </div>

                                                {currentProductDetails.length > 0 && (
                                                    <section className="mt-3 border-t border-slate-200/80 pt-2.5 dark:border-slate-700" aria-label="Product Details">
                                                        <p className="mb-1.5 text-[11px] font-medium text-slate-600">Product Details</p>
                                                        <dl className="space-y-1.5">
                                                            {currentProductDetails.map(({ label, value }) => (
                                                                <div key={label} className="flex items-center justify-between gap-3 text-xs">
                                                                    <dt className="text-slate-500">{label}</dt>
                                                                    <dd className="truncate font-medium text-slate-700 dark:text-slate-100">{value}</dd>
                                                                </div>
                                                            ))}
                                                        </dl>
                                                    </section>
                                                )}

                                                <section className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-700" aria-label="Recommendation Summary">
                                                    <p className="mb-1.5 text-[11px] font-medium text-slate-600">Recommendations</p>
                                                    <dl className="space-y-1.5">
                                                        <div className="flex items-center justify-between gap-3 text-xs">
                                                            <dt className="text-slate-500">Alternative Products</dt>
                                                            <dd className="font-semibold text-slate-700 dark:text-slate-100">{alternativeCount}</dd>
                                                        </div>
                                                    </dl>
                                                </section>
                                            </div>
                                            {/* Button to view full product details */}
                                            <div className="mt-3">
                                                <button
                                                    onClick={() => openDetails(item)}
                                                    className={`${primaryActionClass} h-8 w-full gap-2 rounded-lg text-xs`}
                                                >
                                                    <svg className="h-3.5 w-3.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    View Details
                                                </button>
                                            </div>
                                        </div>

                                        {/* Right Side: Unified alternatives */}
                                        <div className="flex w-full min-w-0 flex-1 flex-col gap-3 border-t border-slate-100 pt-3 sm:w-auto sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="text-xs font-medium text-slate-700">Recommendations</p>
                                                {canManage && <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveTargetItem(item);
                                                        setAddSearchTerm('');
                                                        setAddFilterCategory('All');
                                                        setIsAddModalOpen(true);
                                                    }}
                                                    className={`${primaryActionClass} h-8 shrink-0 gap-1 rounded-lg`}
                                                    aria-label="Add Recommendation"
                                                >
                                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                                    Add Recommendation
                                                </button>}
                                            </div>
                                            {canManage && <button type="button" onClick={() => { setReviewBlockedOnly(true); setShowBlockedRecommendations(true); setRecommendationDrawerTarget(item); }} className="inline-flex min-h-7 w-fit items-center justify-center rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-200 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50">Review excluded / rejected</button>}

                                            {['alternative', 'budget'].flatMap((type) => (item[type === 'budget' ? 'manualBudgetOptions' : 'manualAlternatives'] || []).filter((code) => !inventory.some((candidate) => getManualRecommendationLink(item, candidate, type)?.code === code)).map((code) => (
                                                <div key={`${type}:${code}`} className="flex items-center justify-between gap-2 border-t border-slate-100 py-2 text-[10px] text-slate-500 dark:border-slate-700">
                                                    <span className="min-w-0 break-words">Unresolved manual {type === 'budget' ? 'budget option' : 'alternative'}: {code}. The saved relationship is retained for review.</span>
                                                    {canManage && <button type="button" onClick={() => handleRemoveAlternative(item, code, code, type)} className={`${destructiveActionClass} shrink-0`}>Remove</button>}
                                                </div>
                                            )))}

                                            {alternatives.length > 0 && (
                                                <section className="recommendation-section recommendation-alternative-section rounded-xl border border-slate-300 bg-slate-100 p-3" aria-label={`Alternative Products for ${item.name}`}>
                                                    <div className="mb-2.5 flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-900">
                                                                <svg className="h-3.5 w-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" /></svg>
                                                                Alternative Products
                                                            </h4>
                                                            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">Review each product before recommending.</p>
                                                        </div>
                                                        {alternativeCount > MOBILE_ALTERNATIVE_LIMIT && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setShowBlockedRecommendations(false);
                                                                    setReviewBlockedOnly(false);
                                                                    setRecommendationDrawerTarget(item);
                                                                }}
                                                                aria-haspopup="dialog"
                                                                className={`recommendation-view-all-mobile ${primaryActionClass} shrink-0`}
                                                            >
                                                                View All ({alternativeCount})
                                                            </button>
                                                        )}
                                                        {alternativeCount > INITIAL_ALTERNATIVE_LIMIT && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setShowBlockedRecommendations(false);
                                                                    setReviewBlockedOnly(false);
                                                                    setRecommendationDrawerTarget(item);
                                                                }}
                                                                aria-haspopup="dialog"
                                                                className={`recommendation-view-all-desktop ${primaryActionClass} shrink-0`}
                                                            >
                                                                View All ({alternativeCount})
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="recommendation-alternative-grid">
                                                        {visibleAlternatives.map((alternative) => renderAlternativeCard(item, alternative, systemCodes))}
                                                    </div>
                                                </section>
                                            )}

                                            {alternatives.length === 0 && (
                                                <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 text-center text-[10px] font-medium text-slate-400">
                                                    No alternatives available.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-4 w-full border border-slate-300 bg-slate-200 px-4 py-2 rounded-xl">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-gray-500 font-medium">
                                Showing <span className="font-semibold text-gray-900">{displayStart}</span> to <span className="font-semibold text-gray-900">{displayEnd}</span> of <span className="font-semibold text-gray-900">{attentionItems.length}</span> results
                            </div>
                            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                        </div>
                    </div>
                    </>
                )}
            </div>

            {recommendationDrawerTarget && (
                <div
                    role="dialog"
                    aria-hidden={Boolean(basisEditor)}
                    aria-modal="true"
                    aria-labelledby="all-recommendations-title"
                    className="fixed inset-0 z-[65] flex justify-end bg-black/25 backdrop-blur-[3px] animate-in fade-in duration-200"
                    onKeyDown={handleRecommendationDialogKeyDown}
                    onClick={() => setRecommendationDrawerTarget(null)}
                >
                    <aside
                        ref={recommendationDialogRef}
                        tabIndex={-1}
                        className="recommendation-modal flex h-full min-h-0 w-full max-w-[26rem] flex-col overflow-hidden border-l border-slate-300 bg-slate-50 shadow-xl animate-in slide-in-from-right duration-200"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
                            <div className="min-w-0 pr-4">
                                {reviewBlockedOnly ? <>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Excluded / Rejected</p>
                                    <h3 id="all-recommendations-title" className="mt-0.5 truncate text-sm font-semibold text-gray-900">{recommendationDrawerTarget.name}</h3>
                                    <p className="mt-1 text-xs leading-snug text-slate-600">Active exclusions and rejected automatic suggestions.</p>
                                </> : <>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Product Recommendation</p>
                                    <h3 id="all-recommendations-title" className="mt-0.5 truncate text-sm font-semibold text-gray-900">All Alternative Products</h3>
                                    <p className="mt-1 break-words text-xs leading-snug text-slate-600">{recommendationDrawerTarget.name}</p>
                                </>}
                                {canManage && !reviewBlockedOnly && <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showBlockedRecommendations} onChange={(event) => setShowBlockedRecommendations(event.target.checked)} />Include excluded / rejected</label>}
                            </div>
                            <button
                                type="button"
                                onClick={() => setRecommendationDrawerTarget(null)}
                                aria-label="Close recommendations"
                                className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                            >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="recommendation-all-alternatives min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300">
                            {reviewBlockedOnly ? <div className="space-y-2.5">
                                {drawerRecommendations.map((alternative) => {

                                    return (
                                        <div key={alternative.code} className="recommendation-review-card rounded-xl border border-slate-300 bg-white p-3 transition-colors hover:border-slate-400">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <RecommendationThumbnail item={alternative} className="h-14 w-14" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{alternative.name}</p>
                                                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{[alternative.brand, alternative.size].filter(Boolean).join(' · ') || alternative.code}</p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            openDetails(alternative, recommendationDrawerTarget);
                                                        }}
                                                        aria-label="View Details"
                                                        title="View Details"
                                                        className={`${primaryActionClass} hidden h-7 w-7 rounded-lg px-0 md:inline-flex`}
                                                    >
                                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                    </button>
                                                    {canManage && getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes).manual && <button
                                                            type="button"
                                                            onClick={() => handleRemoveAlternative(recommendationDrawerTarget, alternative.recommendation?.relationshipCode || alternative.code, alternative.name, getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes).manualType, drawerSystemCodes.has(alternative.code))}
                                                            aria-label="Remove manual recommendation"
                                                            title="Remove manual link"
                                                            className={`${destructiveActionClass} hidden h-7 w-7 rounded-lg px-0 md:inline-flex`}
                                                        >
                                                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                                    </button>}
                                                    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-900">
                                                        {formatCurrency(alternative.price)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5 md:hidden">
                                                <button type="button" onClick={() => openDetails(alternative, recommendationDrawerTarget)} className={primaryActionClass}>
                                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                    View Details
                                                </button>
                                                {canManage && getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes).manual && <button type="button" onClick={() => handleRemoveAlternative(recommendationDrawerTarget, alternative.recommendation?.relationshipCode || alternative.code, alternative.name, getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes).manualType, drawerSystemCodes.has(alternative.code))} className={destructiveActionClass}>
                                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
                                                    Remove
                                                </button>}
                                            </div>
                                            <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px]">
                                                <span className="truncate pr-3 font-medium text-slate-600">{alternative.brand || alternative.code}</span>
                                                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 font-semibold ${alternative.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${alternative.stock > 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                    Stock: {alternative.stock} {alternative.sellingUnit}
                                                </span>
                                            </div>
                                            <RecommendationBasis item={alternative} />
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {renderEditBasis(recommendationDrawerTarget, alternative, getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes))}
                                                {renderReviewActions(recommendationDrawerTarget, alternative, getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes), true)}
                                                {canManage && alternative.recommendation.excluded && !getRecommendationActionSources(recommendationDrawerTarget, alternative, drawerSystemCodes).automatic && <button type="button" className={secondaryActionClass} onClick={() => openReviewEditor(recommendationDrawerTarget, alternative, 'not_reviewed', true)}>Restore exclusion</button>}
                                            </div>
                                        </div>
                                    );
                                })}
                                {drawerRecommendations.length === 0 && <p className="p-3 text-xs text-slate-500">No excluded or rejected recommendations.</p>}
                            </div> : drawerRecommendations.length > 0 ? <div className="recommendation-alternative-grid">
                                {drawerRecommendations.map((alternative) => renderAlternativeCard(recommendationDrawerTarget, alternative, drawerSystemCodes, true))}
                            </div> : <p className="p-3 text-xs text-slate-500">No alternatives available.</p>}
                        </div>
                    </aside>
                </div>
            )}

            {/* Remove Confirmation Modal */}
            {isConfirmModalOpen && (
                <div className="app-modal-backdrop fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="recommendation-modal w-full max-w-sm transform scale-100 overflow-hidden rounded-2xl border border-slate-300 bg-white p-6 text-center shadow-xl transition-all">
                        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Recommendation?</h3>
                        <p className="text-gray-500 text-sm">
                            Remove <span className="font-semibold text-gray-800">{pendingRemoval?.alternativeName}</span> from manually added recommendations?
                        </p>
                        {pendingRemoval?.mayRemainAutomatic && <p className="mt-2 text-xs text-slate-500">It may still appear if recommended automatically.</p>}
                        <div className="mt-6 flex gap-3">
                            <button 
                                disabled={isRemoving}
                                onClick={() => {
                                    setIsConfirmModalOpen(false);
                                    setPendingRemoval(null);
                                }}
                                className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                disabled={isRemoving}
                                onClick={confirmRemoval}
                                className="flex-1 rounded-xl border border-rose-600 bg-rose-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:opacity-50"
                            >
                                {isRemoving ? 'Removing…' : 'Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {basisEditor && <RecommendationBasisEditor
                target={basisEditor.target}
                candidate={basisEditor.candidate}
                initialBasis={basisEditor.initialBasis}
                mode={basisEditor.mode}
                reviewDecision={basisEditor.reviewDecision}
                restoreExclusions={basisEditor.restoreExclusions}
                onSave={saveBasis}
                onClose={() => {
                    if (basisEditor.mode === 'add') setIsAddModalOpen(true);
                    setBasisEditor(null);
                }}
            />}

            {/* Add Recommendation Modal */}
            {isAddModalOpen && (
                <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="recommendation-modal flex h-[min(500px,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-xl animate-in fade-in zoom-in duration-200">
                        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
                            <div>
                                <h3 className="font-semibold text-gray-900">Add Recommendation</h3>
                                <p className="text-xs text-gray-500">For {activeTargetItem?.name}</p>
                            </div>
                            <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-900 transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>
                        
                        <div className="shrink-0 space-y-3 border-b border-slate-200 bg-white p-4">
                            <input 
                                type="text" 
                                placeholder="Search inventory..." 
                                value={addSearchTerm}
                                list="recommendation-add-search-suggestions"
                                onChange={(e) => setAddSearchTerm(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                autoFocus
                            />
                            <datalist id="recommendation-add-search-suggestions">
                                {addAlternativeSearchSuggestions.map((term) => (
                                    <option key={term} value={term} />
                                ))}
                            </datalist>
                            {/* Category Filter Pills */}
                            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-200">
                                {categories.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setAddFilterCategory(cat)}
                                        className={`px-3 py-1 text-xs font-semibold rounded-full border shrink-0 transition-colors ${
                                            addFilterCategory === cat 
                                            ? 'bg-gray-900 text-white border-gray-900' 
                                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                        }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-2">
                            {potentialAlternatives.length > 0 ? (
                                <div className="space-y-2">
                                    {potentialAlternatives.map(item => {
                                        const candidateStatus = getStockStatus(item, appSettings);
                                        const isUnavailable = candidateStatus === 'Out of Stock';
                                        return (
                                        <div 
                                            key={item.code}
                                            onClick={() => { if (!isUnavailable) handleAddAlternative(item); }}
                                            className={`w-full p-3 bg-white border rounded-xl shadow-sm transition-all duration-300 text-left flex justify-between items-center group motion-reduce:transition-none ${isUnavailable ? 'cursor-not-allowed border-slate-200 opacity-65' : 'transform cursor-pointer hover:-translate-y-1 hover:shadow-lg motion-reduce:hover:translate-y-0'} ${
                                                item.isSystemRecommended ? 'border-indigo-100 hover:border-indigo-300 bg-indigo-50/10' : 'border-slate-300 hover:border-slate-400'
                                            }`}
                                        >
                                            <RecommendationThumbnail item={item} className="h-11 w-11" />
                                            <div className="flex-1 min-w-0 mr-3">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-semibold text-gray-900 text-sm leading-tight truncate">{item.name}</span>
                                                    {item.isSystemRecommended && (
                                                        <span className="bg-indigo-100 text-indigo-700 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-indigo-200 flex items-center gap-1 shrink-0 uppercase tracking-wide">
                                                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" /></svg>
                                                            Recommended
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {[item.code, item.brand, item.size].filter(Boolean).join(' • ')} • {formatCurrency(item.price)} • {candidateStatus}
                                                </div>
                                                <RecommendationBasis item={item} />
                                            </div>
                                            
                                            <div className="flex items-center gap-2 shrink-0">
                                                {/* View Details Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openDetails(item, activeTargetItem);
                                                    }}
                                                    className={`${primaryActionClass} h-8 w-auto gap-1.5 px-2 md:w-8 md:px-0`}
                                                    title="View Full Details"
                                                    aria-label="View full details"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                    <span className="md:hidden">Details</span>
                                                </button>

                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isUnavailable ? 'bg-slate-100 text-slate-300' :
                                                    item.isSystemRecommended
                                                        ? 'bg-indigo-100 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white' 
                                                        : 'bg-gray-100 text-gray-400 group-hover:bg-gray-900 group-hover:text-white'
                                                }`}>
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                                    {addSearchTerm ? 'No matching items found' : 'Type to search...'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Product Details Modal */}
            {isDetailsModalOpen && viewDetailsItem && (
                <div role="dialog" aria-modal="true" aria-labelledby="recommendation-details-title" className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div ref={detailsDialogRef} onKeyDown={handleDetailsKeyDown} className="recommendation-modal flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="recommendation-modal-header flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Inventory Item</p>
                                <h3 id="recommendation-details-title" className="mt-0.5 text-base font-semibold text-slate-900 dark:text-slate-100">{comparisonTarget && viewDetailsItem.recommendation ? 'Recommendation Details' : 'Product Details'}</h3>
                            </div>
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                aria-label="Close product details"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                            >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        
                        <div className="recommendation-modal-body overflow-y-auto bg-slate-50/70 p-4 sm:p-5">
                            {comparisonTarget && viewDetailsItem.recommendation ? (
                                <div className="space-y-2.5 text-xs text-slate-700">
                                    <section className="rounded-xl border border-slate-300 bg-slate-50 p-2.5" aria-label="Recommended Product">
                                        <p className="mb-1.5 font-semibold text-slate-600">Recommended Product</p>
                                        <div className="flex min-w-0 items-start gap-3">
                                            <RecommendationThumbnail item={viewDetailsItem} className="h-16 w-16" />
                                            <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-900">{viewDetailsItem.name}</p><p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{viewDetailsItem.code}</p><p className="mt-1 text-slate-600">{[viewDetailsItem.brand, viewDetailsItem.size, viewDetailsItem.color].filter(hasRecordedDetail).join(' · ') || viewDetailsItem.category}</p><p className="mt-1 font-medium">{formatCurrency(viewDetailsItem.price)} {hasRecordedDetail(viewDetailsItem.stock) && <span className="ml-2 font-normal text-slate-600">Stock: {formatStockWithSellingUnit(viewDetailsItem.stock, viewDetailsItem.sellingUnit)}</span>}</p></div>
                                        </div>
                                    </section>
                                    <section className="rounded-xl border border-slate-300 bg-slate-50 p-2.5" aria-label="Compared With">
                                        <p className="mb-1.5 font-semibold text-slate-600">Compared With</p>
                                        <div className="flex min-w-0 items-start gap-3">
                                            <RecommendationThumbnail item={comparisonTarget} className="h-16 w-16" />
                                            <div className="min-w-0 flex-1"><p className="break-words font-semibold text-slate-900">{comparisonTarget.name}</p><p className="break-all font-mono text-[11px] text-slate-500">{comparisonTarget.code}</p><p className="mt-1 text-slate-600">{[comparisonTarget.brand, comparisonTarget.size, comparisonTarget.color].filter(hasRecordedDetail).join(' · ') || comparisonTarget.category}</p><p className="mt-1">{formatCurrency(comparisonTarget.price)} {hasRecordedDetail(comparisonTarget.stock) && <span className="ml-2 text-slate-600">Stock: {formatStockWithSellingUnit(comparisonTarget.stock, comparisonTarget.sellingUnit)}</span>}</p></div>
                                        </div>
                                    </section>
                                    <section className="rounded-xl border border-slate-300 bg-white p-2.5" aria-label="Recommendation Status">
                                        <p className="font-semibold text-slate-600">Recommendation Status</p>
                                        <p className="mt-1 font-medium text-slate-900">{detailPresentation.source} · {detailPresentation.sourceStatus}</p>
                                        <p className="mt-1 text-slate-600">Compatibility: {detailPresentation.status}</p>
                                        {detailRecommendation.sources?.automatic && <p className="mt-1 text-slate-600">System review: {detailRecommendation.staffReview?.decision === 'approved' ? 'Approved' : detailRecommendation.staffReview?.decision === 'rejected' ? 'Rejected' : 'Needs Review'}</p>}
                                        {detailPresentation.status === 'Needs Review' && (hasStaffReasons || detailRecommendation.staffReview?.decision === 'approved') && <p className="mt-1 text-slate-600">Staff input does not verify compatibility.</p>}
                                    </section>
                                    {(detailPresentation.checklist.length > 0 || detailPresentation.staffChecklist.length > 0) && <section className="rounded-xl border border-slate-300 bg-white p-2.5" aria-label="Why Recommended?">
                                        <p className="font-semibold text-slate-600">Why Recommended?</p>
                                        {detailPresentation.checklist.some((reason) => reason.staff) && <p className="mt-1.5 text-[11px] text-slate-500">Staff-provided reasons</p>}
                                        {detailPresentation.checklist.some((reason) => reason.staff) && <ul className="mt-1 space-y-1.5">{detailPresentation.checklist.filter((reason) => reason.staff).map((reason) => <li key={reason.key} data-reason-source="staff" className="flex min-w-0 items-start gap-1.5"><span aria-hidden="true" className={reason.kind === 'match' ? 'text-emerald-700' : reason.kind === 'warning' ? 'text-amber-700' : 'text-slate-500'}>{reason.kind === 'match' ? '✓' : reason.kind === 'warning' ? '⚠' : '='}</span><span className="min-w-0 break-words">{reason.text}</span></li>)}</ul>}
                                        {detailPresentation.checklist.some((reason) => reason.staff) && detailPresentation.checklist.some((reason) => !reason.staff) && <p className="mt-2 text-[11px] text-slate-500">Recorded facts and cautions</p>}
                                        {detailPresentation.checklist.some((reason) => !reason.staff) && <ul className="mt-1.5 space-y-1.5">{detailPresentation.checklist.filter((reason) => !reason.staff).map((reason) => <li key={reason.key} data-reason-source="system" className="flex min-w-0 items-start gap-1.5"><span aria-hidden="true" className={reason.kind === 'match' ? 'text-emerald-700' : reason.kind === 'warning' ? 'text-amber-700' : 'text-slate-500'}>{reason.kind === 'match' ? '✓' : reason.kind === 'warning' ? '⚠' : '='}</span><span className="min-w-0 break-words">{reason.text}</span></li>)}</ul>}
                                        {detailPresentation.staffChecklist.length > 0 && <><p className="mt-2 text-[11px] text-slate-500">Staff-provided reasons</p><ul className="mt-1 space-y-1.5">{detailPresentation.staffChecklist.map((reason) => <li key={reason.key} data-reason-source="staff" className="flex min-w-0 items-start gap-1.5"><span aria-hidden="true" className={reason.kind === 'match' ? 'text-emerald-700' : reason.kind === 'warning' ? 'text-amber-700' : 'text-slate-500'}>{reason.kind === 'match' ? '✓' : reason.kind === 'warning' ? '⚠' : '='}</span><span className="min-w-0 break-words">{reason.text}</span></li>)}</ul></>}
                                        {(detailPresentation.additionalMatches.length > 0 || detailPresentation.additionalDifferences.length > 0 || detailPresentation.additionalMissing.length > 0) && <details className="mt-2"><summary className="w-fit cursor-pointer text-[11px] font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">More details</summary><div className="mt-1.5 space-y-1 text-slate-600">{detailPresentation.additionalMatches.map((reason) => <p key={reason.key}>{reason.text}</p>)}{detailPresentation.additionalDifferences.map((row) => <p key={row.key}>Different {row.label.toLowerCase()}: {row.targetValue} {row.unit || ''} vs {row.candidateValue} {row.candidateUnit ?? row.unit ?? ''}</p>)}{detailPresentation.additionalMissing.length > 0 && <p>Missing product details: {detailPresentation.additionalMissing.map((row) => row.label).join(', ')}.</p>}</div></details>}
                                    </section>}
                                    {(showStaffJustification || detailRecommendation.systemSuggestion || hasRecordedDetail(detailRecommendation.adminJustification?.limitations)) && <section className="rounded-xl border border-slate-300 bg-white p-2.5" aria-label="Staff Recommendation"><p className="font-semibold text-slate-600">Recommendation Explanation</p>{showStaffJustification && <p className="mt-1 whitespace-pre-wrap break-words"><span className="font-medium">Displayed explanation: </span>{detailRecommendation.adminJustification.text}</p>}{detailRecommendation.systemSuggestion && <p className="mt-1 whitespace-pre-wrap break-words"><span className="font-medium">Original system suggestion: </span>{detailRecommendation.systemSuggestion}</p>}{hasRecordedDetail(detailRecommendation.adminJustification?.limitations) && <p className="mt-1 whitespace-pre-wrap break-words text-amber-800">Important limitations: {detailRecommendation.adminJustification.limitations}</p>}</section>}
                                </div>
                            ) : (
                            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                                    <RecommendationThumbnail item={viewDetailsItem} className="h-16 w-16" />
                                    <div className="min-w-0 flex-1">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Product Name</p>
                                        <p className="text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">{viewDetailsItem.name}</p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">SKU</p>
                                        <span className="inline-flex max-w-36 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 select-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{viewDetailsItem.code}</span>
                                    </div>
                                </div>

                                {recordedDetails.length > 0 && <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                                    {recordedDetails.map(({ key, label, value, unit }) => (
                                        <div key={key} className="min-w-0 border-b border-slate-100 py-2.5">
                                            <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
                                            <dd className={`break-words text-sm font-semibold ${key === 'Stock' && Number(value) <= 0 ? 'text-rose-700' : 'text-slate-800 dark:text-slate-100'}`}>
                                                {key === 'Price' ? formatCurrency(value) : key === 'Stock' ? formatStockWithSellingUnit(value, viewDetailsItem.sellingUnit) : value}{unit && hasRecordedDetail(unit) ? ` ${unit}` : ''}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>}

                                {hasRecordedDetail(viewDetailsItem.description) && (
                                    <div className="mt-4 border-t border-slate-100 pt-4">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Description</p>
                                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{viewDetailsItem.description}</p>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                        
                         <div className="recommendation-modal-footer flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3.5">
                            {canManage && comparisonTarget && detailRecommendation?.source === 'automatic' && detailRecommendation.staffReview?.identityCurrent !== false && (
                                <button type="button" onClick={() => openStaffJustificationEditor(comparisonTarget, viewDetailsItem)} className={`${primaryActionClass} min-h-9 px-4 text-sm`}>
                                    {hasAutomaticStaffNote ? 'Edit Staff Justification' : 'Add Staff Justification'}
                                </button>
                            )}
                            <button 
                                onClick={() => setIsDetailsModalOpen(false)}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Recommendation;
