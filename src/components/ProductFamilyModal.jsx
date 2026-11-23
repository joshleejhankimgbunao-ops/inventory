import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ArchiveIcon from './ArchiveIcon';
import EditIcon from './EditIcon';
import IdentifierChip from './IdentifierChip';
import TableActionButton from './TableActionButton';
import ViewportTooltip from './ViewportTooltip';
import Pagination from './Pagination';
import ColorSwatch from './ColorSwatch';
import { formatMoney } from '../utils/numberFormat';
import { formatProductAttributeValue, getFamilyGeneralImageUrl } from '../utils/productFamilies';
import { getStockStatus } from '../utils/recommendationLogic';

const VARIANT_STOCK_FILTERS = ['All', 'In Stock', 'Low Stock', 'Out of Stock'];
const VARIANT_CHECKBOX_CLASS = 'variant-selection-checkbox';
const EMPTY_VARIANT_FILTER_COPY = {
    All: {
        title: 'No variants found',
        helper: 'No variants have been added to this product yet.',
    },
    'In Stock': {
        title: 'No in-stock variants',
        helper: 'No variants currently match this stock status.',
    },
    'Low Stock': {
        title: 'No low-stock variants',
        helper: 'No variants currently match this stock status.',
    },
    'Out of Stock': {
        title: 'No out-of-stock variants',
        helper: 'No variants currently match this stock status.',
    },
};

const stockStatusClass = (status) => {
    if (status === 'Out of Stock') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300';
    if (status === 'Low Stock') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300';
};

const variantSelectionKey = (variant) => String(variant?.id || variant?.code || '');

const getVariantArchiveDisabledReason = (variant) => {
    if (variant?.isArchived || variant?.isActive === false) return 'This variant is already archived.';
    if (!variant?.id) return 'This variant cannot be identified for archiving. Refresh the product list.';

    const stock = Number(variant?.stock);
    const reservedStock = Number(variant?.reservedStock ?? 0);
    const unit = String(variant?.sellingUnit || 'unit');
    const reasons = [];

    if (!Number.isFinite(stock) || stock !== 0) {
        reasons.push(`${Number.isFinite(stock) ? stock : 'Unknown quantity'} ${unit} in stock`);
    }
    if (!Number.isFinite(reservedStock) || reservedStock !== 0) {
        reasons.push(`${Number.isFinite(reservedStock) ? reservedStock : 'Unknown quantity'} ${unit} reserved or allocated`);
    }

    return reasons.length ? `Cannot select: ${reasons.join(' and ')}. Both quantities must be zero.` : '';
};

const getVariantArchiveTooltipReason = (variant) => {
    if (variant?.isArchived || variant?.isActive === false) return 'Cannot archive — this variant is already archived.';
    if (!variant?.id) return 'Cannot archive — refresh the variant data.';

    const stock = Number(variant?.stock);
    const reservedStock = Number(variant?.reservedStock ?? 0);
    const hasStock = !Number.isFinite(stock) || stock !== 0;
    const hasReservedStock = !Number.isFinite(reservedStock) || reservedStock !== 0;

    if (hasStock && hasReservedStock) return 'Cannot archive — stock and reservations must be 0.';
    if (hasStock) return 'Cannot archive — stock must be 0.';
    if (hasReservedStock) return 'Cannot archive — reserved stock must be cleared.';
    return '';
};

const VariantArchiveCheckbox = ({ variant, checked, onChange, className = '' }) => {
    const disabled = Boolean(getVariantArchiveDisabledReason(variant));
    const tooltipReason = disabled ? getVariantArchiveTooltipReason(variant) : '';

    return (
        <ViewportTooltip content={tooltipReason} maxWidth={260} tooltipClassName="!text-slate-100">
            <span
                role={tooltipReason ? 'group' : undefined}
                tabIndex={tooltipReason ? 0 : undefined}
                aria-label={tooltipReason ? `Variant ${variant.code}: ${tooltipReason}` : undefined}
                aria-disabled={tooltipReason ? 'true' : undefined}
                className={`inline-flex h-4 w-4 items-center justify-center ${tooltipReason ? 'cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1' : ''} ${className}`.trim()}
            >
                <input
                    type="checkbox"
                    checked={checked && !disabled}
                    onChange={onChange}
                    disabled={disabled}
                    aria-label={`Select variant ${variant.code} for archiving${tooltipReason ? `: ${tooltipReason}` : ''}`}
                    className={VARIANT_CHECKBOX_CLASS}
                />
            </span>
        </ViewportTooltip>
    );
};

const VariantPhoto = ({ variant, imageUrl, onPreview }) => {
    const [failedUrl, setFailedUrl] = useState('');
    const hasImage = imageUrl && failedUrl !== imageUrl;

    return hasImage ? (
        <button
            type="button"
            onClick={(event) => onPreview(variant, event.currentTarget)}
            className="mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-700"
            aria-label={`View photo for variant ${variant.code}`}
        >
            <img src={imageUrl} alt="" className="h-full w-full object-contain" onError={() => setFailedUrl(imageUrl)} />
        </button>
    ) : (
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[9px] font-medium text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-500" aria-label={`No photo for variant ${variant.code}`}>
            No photo
        </span>
    );
};

const ProductFamilyModal = ({
    family,
    canManage,
    canAddVariant = canManage,
    onClose,
    onAddVariant,
    onEditVariant,
    onToggleArchive,
    onArchiveSelected,
    onPreviewVariantImage,
    getProductImageUrl,
    settings,
}) => {
    const [stockFilter, setStockFilter] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [failedGeneralImageUrl, setFailedGeneralImageUrl] = useState('');
    const [selectedVariantIds, setSelectedVariantIds] = useState(() => new Set());
    const [isArchiveConfirmationOpen, setIsArchiveConfirmationOpen] = useState(false);
    const [isArchivingSelected, setIsArchivingSelected] = useState(false);
    const [variantTableScrollMetrics, setVariantTableScrollMetrics] = useState({ scrollWidth: 0, hasOverflow: false });
    const archiveSelectionInFlightRef = useRef(false);
    const desktopSelectAllRef = useRef(null);
    const mobileSelectAllRef = useRef(null);
    const variantTableFooterScrollRef = useRef(null);
    const variantTableScrollRef = useRef(null);
    const modalContentScrollRef = useRef(null);
    const mobileVariantListRef = useRef(null);
    const archiveSelectedTriggerRef = useRef(null);
    const archiveConfirmationCancelRef = useRef(null);
    const archiveConfirmationDialogRef = useRef(null);
    const isModalOpen = Boolean(family);
    const familyIdentity = family?.key || family?.representative?.id || '';
    const visibleVariants = useMemo(() => (family?.variants || [])
        .map((variant, index) => ({
            variant,
            index,
            stockStatus: getStockStatus(variant, settings),
        }))
        .filter(({ stockStatus }) => stockFilter === 'All' || stockStatus === stockFilter), [family?.variants, settings, stockFilter]);
    const totalPages = Math.ceil(visibleVariants.length / itemsPerPage);
    const safeCurrentPage = Math.min(currentPage, Math.max(totalPages, 1));
    const pageStartIndex = (safeCurrentPage - 1) * itemsPerPage;
    const paginatedVariants = visibleVariants.slice(pageStartIndex, pageStartIndex + itemsPerPage);
    const visibleArchivableVariantIds = useMemo(() => paginatedVariants
        .map(({ variant }) => variant)
        .filter((variant) => !getVariantArchiveDisabledReason(variant))
        .map(variantSelectionKey), [paginatedVariants]);
    const selectedVariants = useMemo(() => (family?.variants || [])
        .filter((variant) => selectedVariantIds.has(variantSelectionKey(variant)) && !getVariantArchiveDisabledReason(variant)),
    [family?.variants, selectedVariantIds]);
    const allVisibleArchivableSelected = visibleArchivableVariantIds.length > 0
        && visibleArchivableVariantIds.every((id) => selectedVariantIds.has(id));
    const someVisibleArchivableSelected = visibleArchivableVariantIds.some((id) => selectedVariantIds.has(id));

    useLayoutEffect(() => {
        const scrollContainer = variantTableScrollRef.current;
        const footerScrollbar = variantTableFooterScrollRef.current;
        const table = scrollContainer?.querySelector('table');
        if (!scrollContainer || !table) return undefined;

        let frameId = 0;
        const updateScrollWidth = () => {
            const scrollWidth = Math.ceil(Math.max(table.scrollWidth, scrollContainer.scrollWidth));
            const hasOverflow = scrollWidth > scrollContainer.clientWidth + 1;
            setVariantTableScrollMetrics((previous) => (
                previous.scrollWidth === scrollWidth && previous.hasOverflow === hasOverflow
                    ? previous
                    : { scrollWidth, hasOverflow }
            ));
            if (footerScrollbar && Math.abs(footerScrollbar.scrollLeft - scrollContainer.scrollLeft) > 1) {
                footerScrollbar.scrollLeft = scrollContainer.scrollLeft;
            }
        };
        const measureScrollWidth = () => {
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(updateScrollWidth);
        };

        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureScrollWidth);
        resizeObserver?.observe(scrollContainer);
        resizeObserver?.observe(table);
        window.addEventListener('resize', measureScrollWidth);
        updateScrollWidth();

        return () => {
            cancelAnimationFrame(frameId);
            resizeObserver?.disconnect();
            window.removeEventListener('resize', measureScrollWidth);
        };
    }, [canManage, familyIdentity, family?.attributeDefinitions, variantTableScrollMetrics.hasOverflow, visibleVariants.length]);

    const syncVariantTableScroll = (sourceRef, targetRef) => {
        const source = sourceRef.current;
        const target = targetRef.current;
        if (source && target && Math.abs(source.scrollLeft - target.scrollLeft) > 1) {
            target.scrollLeft = source.scrollLeft;
        }
    };

    const scrollVariantsToTop = () => {
        const scrollContainer = modalContentScrollRef.current;
        const variantsStart = window.innerWidth >= 768 ? variantTableScrollRef.current : mobileVariantListRef.current;
        if (!scrollContainer || !variantsStart) return;
        const scrollContainerTop = scrollContainer.getBoundingClientRect().top;
        const targetTop = variantsStart.getBoundingClientRect().top;
        scrollContainer.scrollTo({
            top: Math.max(0, scrollContainer.scrollTop + targetTop - scrollContainerTop - 8),
            behavior: 'smooth',
        });
    };

    const changePage = (page) => {
        setCurrentPage(page);
        scrollVariantsToTop();
    };

    useEffect(() => {
        setSelectedVariantIds(new Set());
        setIsArchiveConfirmationOpen(false);
        setCurrentPage(1);
    }, [familyIdentity]);

    useEffect(() => {
        setCurrentPage((page) => Math.min(page, Math.max(totalPages, 1)));
    }, [totalPages]);

    useEffect(() => {
        const eligibleIds = new Set((family?.variants || [])
            .filter((variant) => !getVariantArchiveDisabledReason(variant))
            .map(variantSelectionKey));
        setSelectedVariantIds((previous) => {
            const next = new Set([...previous].filter((id) => eligibleIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
    }, [family?.variants]);

    useEffect(() => {
        const indeterminate = someVisibleArchivableSelected && !allVisibleArchivableSelected;
        if (desktopSelectAllRef.current) desktopSelectAllRef.current.indeterminate = indeterminate;
        if (mobileSelectAllRef.current) mobileSelectAllRef.current.indeterminate = indeterminate;
    }, [allVisibleArchivableSelected, someVisibleArchivableSelected]);

    useEffect(() => {
        if (!isArchiveConfirmationOpen) return undefined;
        const previousFocus = document.activeElement;
        const fallbackTrigger = archiveSelectedTriggerRef.current;
        archiveConfirmationCancelRef.current?.focus();
        const handleConfirmationKeyDown = (event) => {
            if (event.key === 'Escape' && !isArchivingSelected) {
                event.preventDefault();
                setIsArchiveConfirmationOpen(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...(archiveConfirmationDialogRef.current?.querySelectorAll('button:not([disabled])') || [])];
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleConfirmationKeyDown);
        return () => {
            document.removeEventListener('keydown', handleConfirmationKeyDown);
            if (previousFocus?.isConnected) previousFocus.focus();
            else fallbackTrigger?.focus();
        };
    }, [isArchiveConfirmationOpen, isArchivingSelected]);

    useEffect(() => {
        if (!isModalOpen) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.classList.add('overflow-hidden');
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.classList.remove('overflow-hidden');
            document.body.style.overflow = previousOverflow;
        };
    }, [isModalOpen]);

    const toggleVisibleSelection = () => {
        if (!visibleArchivableVariantIds.length) return;
        setSelectedVariantIds((previous) => {
            const next = new Set(previous);
            if (visibleArchivableVariantIds.every((id) => next.has(id))) {
                visibleArchivableVariantIds.forEach((id) => next.delete(id));
            } else {
                visibleArchivableVariantIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const toggleVariantSelection = (variant) => {
        const id = variantSelectionKey(variant);
        if (!id || getVariantArchiveDisabledReason(variant)) return;
        setSelectedVariantIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const confirmArchiveSelected = async () => {
        if (archiveSelectionInFlightRef.current || selectedVariants.length === 0 || !onArchiveSelected) return;
        archiveSelectionInFlightRef.current = true;
        setIsArchivingSelected(true);
        try {
            const succeeded = await onArchiveSelected(family, selectedVariants);
            if (succeeded) {
                setSelectedVariantIds(new Set());
                setIsArchiveConfirmationOpen(false);
            }
        } finally {
            archiveSelectionInFlightRef.current = false;
            setIsArchivingSelected(false);
        }
    };

    if (!family) return null;

    const hasVariants = family.variants.length > 0;
    const emptyState = EMPTY_VARIANT_FILTER_COPY[stockFilter];
    const tableColumnCount = family.attributeDefinitions.length + 7 + (canManage ? 2 : 0);
    const generalImageUrl = getFamilyGeneralImageUrl(family.variants);
    const archiveConfirmationMessage = `You are about to archive ${selectedVariants.length} selected variant${selectedVariants.length === 1 ? '' : 's'} of ${family.name}.`;

    return (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
            <div onClick={(event) => event.stopPropagation()} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900 xl:max-w-6xl">
                <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Product Details</p>
                        <h2 className="truncate text-lg font-semibold text-slate-950 dark:text-white">Manage Variants</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                        aria-label="Close product family"
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <div ref={modalContentScrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-5">
                    <section>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">General</p>
                        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[64px_minmax(0,1fr)_minmax(180px,0.7fr)] dark:border-slate-700 dark:bg-slate-800">
                            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-slate-700">
                                {generalImageUrl && failedGeneralImageUrl !== generalImageUrl ? (
                                    <img src={generalImageUrl} alt="" className="h-full w-full object-contain" onError={() => setFailedGeneralImageUrl(generalImageUrl)} />
                                ) : (
                                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">NO IMG</span>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Product Name</p>
                                <p className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-white">{family.name}</p>
                                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Category</p>
                                <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-200">{family.categoryName}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Family Summary</p>
                                <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                                    {family.variants.length} {family.variants.length === 1 ? 'variant' : 'variants'} · {family.totalStock} total stock
                                </p>
                                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    {family.activeCount} active{family.archivedCount > 0 ? ` · ${family.archivedCount} archived` : ''}
                                </p>
                                <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Supplier</p>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                    {family.hasMixedSuppliers ? 'Varies by variant' : (family.sharedSupplier || 'No supplier assigned')}
                                </p>
                                {family.hasMixedImages && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Images are managed per variant.</p>}
                            </div>
                        </div>
                    </section>

                    <section>
                        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Variants</p>
                                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Stock is read-only here. Stock changes in Inventory only.</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {canManage && selectedVariants.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setIsArchiveConfirmationOpen(true)}
                                        ref={archiveSelectedTriggerRef}
                                        disabled={isArchivingSelected}
                                        className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white dark:border-rose-900/60 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-950/30 dark:disabled:hover:bg-slate-800 motion-reduce:transition-none"
                                        aria-label={`Archive selected variants (${selectedVariants.length})`}
                                    >
                                        <ArchiveIcon />
                                        Archive Selected ({selectedVariants.length})
                                    </button>
                                )}
                                {canAddVariant && (
                                    <button
                                        type="button"
                                        onClick={() => onAddVariant(family)}
                                        className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                                    >
                                        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" />
                                        </svg>
                                        Add Variant
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Filter variants by stock status">
                            {VARIANT_STOCK_FILTERS.map((status) => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => {
                                        setStockFilter(status);
                                        setCurrentPage(1);
                                    }}
                                    aria-pressed={stockFilter === status}
                                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                                        stockFilter === status
                                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>

                        {canManage && (
                            <div className="mb-3 flex items-center justify-between gap-3 md:hidden">
                                <label className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
                                    <input
                                        ref={mobileSelectAllRef}
                                        type="checkbox"
                                        checked={allVisibleArchivableSelected}
                                        onChange={toggleVisibleSelection}
                                        disabled={visibleArchivableVariantIds.length === 0}
                                        aria-label="Select all eligible visible variants"
                                        className={VARIANT_CHECKBOX_CLASS}
                                    />
                                    Select eligible visible variants
                                </label>
                                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400" aria-live="polite">
                                    {selectedVariants.length} selected
                                </span>
                            </div>
                        )}

                        <div ref={mobileVariantListRef} className="flex flex-col gap-3 md:hidden" role="list" aria-label="Product variants">
                            {visibleVariants.length === 0 ? (
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-800">
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{emptyState.title}</p>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{emptyState.helper}</p>
                                    {stockFilter === 'All' && !hasVariants && canAddVariant && (
                                        <button
                                            type="button"
                                            onClick={() => onAddVariant(family)}
                                            className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                        >
                                            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" />
                                            </svg>
                                            Add Variant
                                        </button>
                                    )}
                                </div>
                            ) : paginatedVariants.map(({ variant, index: variantIndex, stockStatus }) => (
                                <article key={`mobile-${variant.id || variant.code}`} role="listitem" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                                    <div className="flex min-w-0 items-start gap-3">
                                        {canManage && (() => {
                                            const variantId = variantSelectionKey(variant);
                                            return (
                                                <VariantArchiveCheckbox
                                                    variant={variant}
                                                    checked={selectedVariantIds.has(variantId)}
                                                    onChange={() => toggleVariantSelection(variant)}
                                                    className="shrink-0"
                                                />
                                            );
                                        })()}
                                        <VariantPhoto variant={variant} imageUrl={getProductImageUrl(variant)} onPreview={onPreviewVariantImage} />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">SKU</p>
                                            <span className="mt-1 block max-w-full overflow-x-auto whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200" title={variant.code}>
                                                {variant.code}
                                            </span>
                                        </div>
                                    </div>

                                    <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 min-[360px]:grid-cols-2 dark:border-slate-700">
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Price</dt>
                                            <dd className="mt-0.5 break-words text-sm font-semibold tabular-nums text-slate-950 dark:text-white">₱{formatMoney(variant.price)}</dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Stock</dt>
                                            <dd className="mt-0.5 break-words text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{variant.stock} Qty</dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Stock Status</dt>
                                            <dd className="mt-1">
                                                <span className={`inline-flex max-w-full whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold ${stockStatusClass(stockStatus)}`}>{stockStatus}</span>
                                            </dd>
                                        </div>
                                        <div className="min-w-0">
                                            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Record Status</dt>
                                            <dd className="mt-1">
                                                <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${variant.isArchived ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                                                    {variant.isArchived ? 'Archived' : 'Active'}
                                                </span>
                                            </dd>
                                        </div>
                                        {family.attributeDefinitions.map((definition) => {
                                            const rawValue = family.attributeValues[variantIndex]?.[definition.key];
                                            if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return null;
                                            const value = formatProductAttributeValue(definition, rawValue);
                                            return value ? (
                                                <div key={definition.key} className="min-w-0">
                                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{definition.name}</dt>
                                            <dd className="mt-0.5 break-words text-xs font-normal text-slate-700 dark:text-slate-200">{value}</dd>
                                                </div>
                                            ) : null;
                                        })}
                                    </dl>

                                    {canManage && (
                                        <div className="mt-3 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-3 dark:border-slate-700">
                                            <TableActionButton onClick={() => onEditVariant(variant, family)} dismissTooltipOnClick className="inline-flex min-h-9 w-fit items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 motion-reduce:transition-none" label="Edit variant" aria-label={`Edit variant ${variant.code}`}>
                                                <EditIcon /><span>Edit Variant</span>
                                            </TableActionButton>
                                            <TableActionButton
                                                onClick={() => onToggleArchive(variant)}
                                                dismissTooltipOnClick
                                                variant={variant.isArchived ? 'positive' : 'destructive'}
                                                className={`inline-flex min-h-9 w-fit items-center justify-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none ${variant.isArchived ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-500' : 'border-rose-200 text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-500'}`}
                                                label={variant.isArchived ? 'Restore variant' : 'Archive variant'}
                                                aria-label={`${variant.isArchived ? 'Restore' : 'Archive'} variant ${variant.code}`}
                                            >
                                                {variant.isArchived ? (
                                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9M4 4l5 5m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2M20 20l-5-5" />
                                                    </svg>
                                                ) : <ArchiveIcon />}<span>{variant.isArchived ? 'Restore' : 'Archive'}</span>
                                            </TableActionButton>
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>

                        <div
                            ref={variantTableScrollRef}
                            className="no-scrollbar hidden min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200 bg-white md:block dark:border-slate-700 dark:bg-slate-800"
                            onScroll={() => syncVariantTableScroll(variantTableScrollRef, variantTableFooterScrollRef)}
                            role="region"
                            aria-label="Product variants table"
                            tabIndex={0}
                        >
                            <table className="w-max min-w-full table-auto text-left">
                                <thead>
                                    <tr className="bg-gray-900 text-white uppercase tracking-wider dark:bg-gray-700">
                                        {canManage && (
                                            <th className="w-10 min-w-10 whitespace-nowrap border border-gray-700 px-2 py-2 text-center text-[11px] font-semibold">
                                                <input
                                                    ref={desktopSelectAllRef}
                                                    type="checkbox"
                                                    checked={allVisibleArchivableSelected}
                                                    onChange={toggleVisibleSelection}
                                                    disabled={visibleArchivableVariantIds.length === 0}
                                                    aria-label="Select all eligible visible variants"
                                                    className={VARIANT_CHECKBOX_CLASS}
                                                />
                                            </th>
                                        )}
                                        <th className="w-16 min-w-16 whitespace-nowrap border border-gray-700 px-3 py-2 text-center text-[11px] font-semibold">Photo</th>
                                        {family.attributeDefinitions.map((definition) => (
                                            <th key={definition.key} className="min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-[11px] font-semibold">{definition.name}</th>
                                        ))}
                                        <th className="min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-[11px] font-semibold">Shade</th>
                                        <th className="min-w-40 whitespace-nowrap border border-gray-700 px-3 py-2 text-[11px] font-semibold">SKU</th>
                                        <th className="min-w-24 whitespace-nowrap border border-gray-700 px-3 py-2 text-right text-[11px] font-semibold">Price</th>
                                        <th className="min-w-24 whitespace-nowrap border border-gray-700 px-3 py-2 text-center text-[11px] font-semibold">Stock</th>
                                        <th className="min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-center text-[11px] font-semibold">Stock Status</th>
                                        <th className="min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-center text-[11px] font-semibold">Record Status</th>
                                        {canManage && <th className="min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-center text-[11px] font-semibold">Actions</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {visibleVariants.length === 0 ? (
                                        <tr>
                                            <td colSpan={tableColumnCount} className="px-4 py-8 text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
                                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M20 13V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7m14 0v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5m16 0h-2.6a1 1 0 0 0-.7.3l-2.4 2.4a1 1 0 0 1-.7.3H9.4a1 1 0 0 1-.7-.3L6.3 13.3a1 1 0 0 0-.7-.3H4" />
                                                        </svg>
                                                    </span>
                                                    <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">{emptyState.title}</p>
                                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{emptyState.helper}</p>
                                                    {stockFilter === 'All' && !hasVariants && canAddVariant && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onAddVariant(family)}
                                                            className="mt-3 inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                                        >
                                                            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" />
                                                            </svg>
                                                            Add Variant
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ) : paginatedVariants.map(({ variant, index: variantIndex, stockStatus }) => (
                                        <tr key={variant.id || variant.code} className="text-xs text-slate-700 dark:text-slate-200">
                                            {canManage && (() => {
                                                const variantId = variantSelectionKey(variant);
                                                return (
                                                    <td className="w-10 min-w-10 px-2 py-2.5 text-center">
                                                        <VariantArchiveCheckbox
                                                            variant={variant}
                                                            checked={selectedVariantIds.has(variantId)}
                                                            onChange={() => toggleVariantSelection(variant)}
                                                            className="mx-auto"
                                                        />
                                                    </td>
                                                );
                                            })()}
                                            <td className="w-16 min-w-16 px-2 py-1.5 text-center">
                                                <VariantPhoto variant={variant} imageUrl={getProductImageUrl(variant)} onPreview={onPreviewVariantImage} />
                                            </td>
                                            {family.attributeDefinitions.map((definition) => (
                                                <td key={definition.key} className="min-w-32 whitespace-nowrap px-3 py-2.5">
                                                    <span className="block whitespace-nowrap" title={formatProductAttributeValue(definition, family.attributeValues[variantIndex]?.[definition.key])}>
                                                        {formatProductAttributeValue(definition, family.attributeValues[variantIndex]?.[definition.key])}
                                                    </span>
                                                </td>
                                            ))}
                                            <td className="min-w-32 whitespace-nowrap px-4 py-3 align-middle">
                                                <div className="flex h-full items-center justify-start">
                                                    <ColorSwatch
                                                        value={family.attributeValues[variantIndex]?.color || variant.color}
                                                        className="flex h-full items-center justify-start"
                                                    />
                                                </div>
                                            </td>
                                            <td className="min-w-40 whitespace-nowrap px-3 py-2.5"><IdentifierChip className="max-w-none whitespace-nowrap break-normal">{variant.code}</IdentifierChip></td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-950 dark:text-white">₱{formatMoney(variant.price)}</td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">{variant.stock} Qty</td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-center">
                                                <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold ${stockStatusClass(stockStatus)}`}>
                                                    {stockStatus}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-center">
                                                <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${variant.isArchived ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                                                    {variant.isArchived ? 'Archived' : 'Active'}
                                                </span>
                                            </td>
                                            {canManage && (
                                                <td className="min-w-32 whitespace-nowrap px-3 py-2.5">
                                                    <div className="flex flex-nowrap items-center justify-center gap-2">
                                                        <TableActionButton onClick={() => onEditVariant(variant, family)} className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700" label="Edit variant" aria-label={`Edit variant ${variant.code}`}>
                                                            <EditIcon />
                                                            <span>Edit</span>
                                                        </TableActionButton>
                                                        <TableActionButton
                                                            onClick={() => onToggleArchive(variant)}
                                                            variant={variant.isArchived ? 'positive' : 'destructive'}
                                                            className={`inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-white px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 dark:bg-slate-800 ${variant.isArchived ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-500 dark:border-emerald-900/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30' : 'border-rose-200 text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-500 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30'}`}
                                                            label={variant.isArchived ? 'Restore variant' : 'Archive variant'}
                                                            aria-label={`${variant.isArchived ? 'Restore' : 'Archive'} variant ${variant.code}`}
                                                        >
                                                            {variant.isArchived ? (
                                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9M4 4l5 5m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2M20 20l-5-5" />
                                                                </svg>
                                                            ) : <ArchiveIcon />}
                                                            <span>{variant.isArchived ? 'Restore' : 'Archive'}</span>
                                                        </TableActionButton>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>

                {visibleVariants.length > 0 && (
                    <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2 sm:px-5 dark:border-slate-700 dark:bg-slate-900">
                        {variantTableScrollMetrics.hasOverflow && (
                            <div
                                ref={variantTableFooterScrollRef}
                                className="mb-2 hidden h-4 min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-md border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 md:block dark:border-slate-700 dark:bg-slate-800"
                                onScroll={() => syncVariantTableScroll(variantTableFooterScrollRef, variantTableScrollRef)}
                                role="region"
                                aria-label="Scroll variants table horizontally"
                                tabIndex={0}
                            >
                                <div aria-hidden="true" className="h-px min-w-full" style={{ width: `${variantTableScrollMetrics.scrollWidth}px` }} />
                            </div>
                        )}
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                            <p className="text-xs text-slate-600 dark:text-slate-300" aria-live="polite">
                                Showing {pageStartIndex + 1}–{Math.min(pageStartIndex + itemsPerPage, visibleVariants.length)} of {visibleVariants.length} variants
                            </p>
                            {visibleVariants.length > 5 && (
                                <Pagination
                                    currentPage={safeCurrentPage}
                                    totalPages={totalPages}
                                    onPageChange={changePage}
                                    pageSize={itemsPerPage}
                                    pageSizeOptions={[5, 10, 20]}
                                    onPageSizeChange={(pageSize) => {
                                        setItemsPerPage(pageSize);
                                        setCurrentPage(1);
                                        scrollVariantsToTop();
                                    }}
                                />
                            )}
                        </div>
                    </footer>
                )}
            </div>

            {canManage && isArchiveConfirmationOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                    <section
                        ref={archiveConfirmationDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="archive-selected-variants-title"
                        aria-describedby="archive-selected-variants-description"
                        onClick={(event) => event.stopPropagation()}
                        className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
                    >
                        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                            <h3 id="archive-selected-variants-title" className="text-base font-semibold text-slate-950 dark:text-white">Archive Selected Variants?</h3>
                            <p id="archive-selected-variants-description" className="mt-1 text-sm text-slate-600 dark:text-slate-300">{archiveConfirmationMessage}</p>
                        </div>
                        <div className="max-h-[40vh] overflow-y-auto px-5 py-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Selected SKUs</p>
                            <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
                                {selectedVariants.map((variant) => (
                                    <li key={variantSelectionKey(variant)} className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono dark:bg-slate-700/60">{variant.code}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
                            <button
                                type="button"
                                ref={archiveConfirmationCancelRef}
                                onClick={() => setIsArchiveConfirmationOpen(false)}
                                disabled={isArchivingSelected}
                                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmArchiveSelected}
                                disabled={isArchivingSelected || selectedVariants.length === 0}
                                className="h-9 rounded-lg border border-rose-200 bg-white px-4 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white dark:border-rose-900/60 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-950/30"
                            >
                                {isArchivingSelected ? 'Archiving…' : 'Archive Selected'}
                            </button>
                        </div>
                    </section>
                </div>
            )}

        </div>
    );
};

export default ProductFamilyModal;
