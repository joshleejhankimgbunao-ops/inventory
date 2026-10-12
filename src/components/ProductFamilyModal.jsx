import React, { useMemo, useState } from 'react';
import ArchiveIcon from './ArchiveIcon';
import EditIcon from './EditIcon';
import IdentifierChip from './IdentifierChip';
import TableActionButton from './TableActionButton';
import { formatMoney } from '../utils/numberFormat';
import { formatProductAttributeValue } from '../utils/productFamilies';
import { getStockStatus } from '../utils/recommendationLogic';

const VARIANT_STOCK_FILTERS = ['All', 'In Stock', 'Low Stock', 'Out of Stock'];
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

const ProductFamilyModal = ({
    family,
    canManage,
    canAddVariant = canManage,
    onClose,
    onAddVariant,
    onEditVariant,
    onToggleArchive,
    settings,
}) => {
    const [stockFilter, setStockFilter] = useState('All');
    const visibleVariants = useMemo(() => (family?.variants || [])
        .map((variant, index) => ({
            variant,
            index,
            stockStatus: getStockStatus(variant, settings),
        }))
        .filter(({ stockStatus }) => stockFilter === 'All' || stockStatus === stockFilter), [family?.variants, settings, stockFilter]);

    if (!family) return null;

    const hasVariants = family.variants.length > 0;
    const emptyState = EMPTY_VARIANT_FILTER_COPY[stockFilter];
    const tableColumnCount = family.attributeDefinitions.length + 5 + (canManage ? 1 : 0);

    return (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
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

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
                    <section>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">General</p>
                        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[64px_minmax(0,1fr)_minmax(180px,0.7fr)] dark:border-slate-700 dark:bg-slate-800">
                            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-slate-700">
                                {family.sharedImageUrl ? (
                                    <img src={family.sharedImageUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{family.hasMixedImages ? 'VARIES' : 'NO IMG'}</span>
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

                        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Filter variants by stock status">
                            {VARIANT_STOCK_FILTERS.map((status) => (
                                <button
                                    key={status}
                                    type="button"
                                    onClick={() => setStockFilter(status)}
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

                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                            <table className="w-full min-w-180 text-left">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                        {family.attributeDefinitions.map((definition) => (
                                            <th key={definition.key} className="px-3 py-2.5">{definition.name}</th>
                                        ))}
                                        <th className="px-3 py-2.5">SKU</th>
                                        <th className="px-3 py-2.5 text-right">Price</th>
                                        <th className="px-3 py-2.5 text-center">Stock</th>
                                        <th className="px-3 py-2.5 text-center">Stock Status</th>
                                        <th className="px-3 py-2.5 text-center">Record Status</th>
                                        {canManage && <th className="px-3 py-2.5 text-center">Actions</th>}
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
                                    ) : visibleVariants.map(({ variant, index: variantIndex, stockStatus }) => (
                                        <tr key={variant.id || variant.code} className="text-xs text-slate-700 dark:text-slate-200">
                                            {family.attributeDefinitions.map((definition) => (
                                                <td key={definition.key} className="max-w-44 px-3 py-2.5">
                                                    <span className="block truncate" title={formatProductAttributeValue(definition, family.attributeValues[variantIndex]?.[definition.key])}>
                                                        {formatProductAttributeValue(definition, family.attributeValues[variantIndex]?.[definition.key])}
                                                    </span>
                                                </td>
                                            ))}
                                            <td className="px-3 py-2.5"><IdentifierChip>{variant.code}</IdentifierChip></td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-950 dark:text-white">₱{formatMoney(variant.price)}</td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">{variant.stock} Qty</td>
                                            <td className="px-3 py-2.5 text-center">
                                                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${stockStatusClass(stockStatus)}`}>
                                                    {stockStatus}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-center">
                                                <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${variant.isArchived ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                                                    {variant.isArchived ? 'Archived' : 'Active'}
                                                </span>
                                            </td>
                                            {canManage && (
                                                <td className="px-3 py-2.5">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <TableActionButton onClick={() => onEditVariant(variant, family)} label="Edit variant" aria-label={`Edit variant ${variant.code}`}>
                                                            <EditIcon />
                                                        </TableActionButton>
                                                        <TableActionButton
                                                            onClick={() => onToggleArchive(variant)}
                                                            variant={variant.isArchived ? 'positive' : 'destructive'}
                                                            label={variant.isArchived ? 'Restore variant' : 'Archive variant'}
                                                            aria-label={`${variant.isArchived ? 'Restore' : 'Archive'} variant ${variant.code}`}
                                                        >
                                                            {variant.isArchived ? (
                                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9M4 4l5 5m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2M20 20l-5-5" />
                                                                </svg>
                                                            ) : <ArchiveIcon />}
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

                <footer className="flex justify-end border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-800">
                    <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                        Close
                    </button>
                </footer>
            </div>

        </div>
    );
};

export default ProductFamilyModal;
