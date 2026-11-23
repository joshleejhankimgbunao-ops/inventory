import React, { useMemo, useState } from 'react';
import { getEffectiveProductAttributes } from '../utils/productAttributes';
import { getProductDetailsSpecifications } from '../utils/productDetailsSpecifications';
import { getLowStockThreshold, getStockStatus } from '../utils/recommendationLogic';
import { formatCurrency, formatNumber } from '../utils/numberFormat';
import { formatExpiryDateLabel, getManilaBusinessDate, isValidExpiryDate } from '../utils/productExpiryDate';
import { getBatchVerificationException } from '../utils/productExpiryPresentation';
import { getProductDisplayName, hasStoredProductName } from '../utils/productDisplayName';
import ColorSwatch from './ColorSwatch';

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

const displayAttributeValue = (value) => {
  if (Array.isArray(value)) return value.map(displayAttributeValue).filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value && typeof value === 'object') return '';
  return hasValue(value) ? String(value).trim() : '';
};

const isPackagingVolumeValue = (value) => String(value || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
  .every((part) => /^\d+(?:\.\d+)?\s*(?:gallon|gallons|liter|liters|L|can|pcs)$/i.test(part));

const labelFromKey = (key) => String(key || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const expiryStatusStyles = {
  Expired: 'border-rose-200 bg-rose-50 text-rose-800',
  'Expiring Soon': 'border-amber-200 bg-amber-50 text-amber-800',
  Valid: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Historical: 'border-slate-200 bg-slate-50 text-slate-600',
  Verified: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Not Yet Verified': 'border-amber-200 bg-amber-50 text-amber-800',
};

const stockAvailabilityStyles = {
  'In Stock': 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  'Low Stock': 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  'Out of Stock': 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300',
  Unavailable: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const getBatchExpiryStatus = (expiryDate, today) => {
  const value = String(expiryDate || '').slice(0, 10);
  if (!isValidExpiryDate(value)) return null;
  const daysUntilExpiry = Math.round((Date.parse(`${value}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86400000);
  if (daysUntilExpiry <= 0) return 'Expired';
  return daysUntilExpiry <= 30 ? 'Expiring Soon' : 'Valid';
};

const BatchStatusBadge = ({ status }) => {
  if (!status || !expiryStatusStyles[status]) return null;
  if (status === 'Verified') return <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300/80 bg-white px-3 py-0.5 text-[10px] font-medium leading-4 text-slate-700">{status}</span>;
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold leading-4 ${expiryStatusStyles[status]}`}>{status}</span>;
};

const ProductImage = ({ product, categories = [], onPreview }) => {
  const imageUrl = String(product?.imageUrl || '').trim();
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const thumbnailClassName = 'h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50';

  if (imageUrl && failedImageUrl !== imageUrl) {
    return (
      <button
        type="button"
        onClick={(event) => onPreview?.(event, product)}
        className={`${thumbnailClassName} cursor-zoom-in transition-all hover:opacity-90 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-slate-900`}
        aria-label={`Enlarge image for ${getProductDisplayName(product, categories)}`}
      >
        <img
          src={imageUrl}
          alt={getProductDisplayName(product, categories)}
          onError={() => setFailedImageUrl(imageUrl)}
          className="h-full w-full object-contain"
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

const DetailValue = ({ label, children, className = '' }) => (
  <div className={`min-w-0 ${className}`}>
    <dt className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">{label}</dt>
    <dd className="mt-1 break-words font-medium leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

const InventoryProductDetails = ({
  product,
  categories = [],
  appSettings = {},
  expiryStatus = 'idle',
  expiryData = null,
  selectedBatch = null,
  onRetryExpiry,
  onImagePreview,
}) => {
  const [isExpiryExpanded, setIsExpiryExpanded] = useState(false);
  const specifications = useMemo(() => {
    if (!product) return [];
    const category = (Array.isArray(categories) ? categories : []).find((entry) => entry?.name === product.category) || {};
    const definitions = getEffectiveProductAttributes(category);
    const knownKeys = new Set(definitions.map((definition) => String(definition.key || '').toLowerCase()));
    const configured = getProductDetailsSpecifications(product, categories);
    const attributes = product.attributes instanceof Map ? Object.fromEntries(product.attributes) : (product.attributes || {});
    const saved = Object.entries(attributes)
      .filter(([key, value]) => hasValue(displayAttributeValue(value)) && !knownKeys.has(String(key).toLowerCase()))
      .map(([key, value]) => ({ name: labelFromKey(key), value: displayAttributeValue(value) }))
      .filter(({ name, value }) => name && value);
    const result = [...configured, ...saved];
    if (product.brand && !result.some(({ name }) => name.toLowerCase() === 'brand')) {
      result.unshift({ name: 'Brand', value: String(product.brand).trim() });
    }
    [
      ['color', 'Color'],
      ['size', 'Size / Variant'],
    ].forEach(([key, label]) => {
      if (!product[key] || knownKeys.has(key) || result.some(({ name }) => name.toLowerCase() === label.toLowerCase())) return;
      result.push({ name: label, value: String(product[key]).trim() });
    });
    return result.filter(({ name, value }) => (
      name.toLowerCase() !== 'size / variant' || !isPackagingVolumeValue(value)
    ));
  }, [categories, product]);

  if (!product) return null;

  const sellingUnit = String(product.sellingUnit || product.unit || '').trim();
  const stock = Number(product.stock || 0);
  const reserved = Number(product.reservedStock || 0);
  const available = Number(product.availableToSell ?? Math.max(0, stock - reserved));
  const availability = product.isActive === false ? 'Unavailable' : getStockStatus(product, appSettings);
  const availabilityClass = stockAvailabilityStyles[availability] || stockAvailabilityStyles.Unavailable;
  const statusClass = product.isActive === false
    ? 'border-slate-200 bg-slate-50 text-slate-600'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  const explicitThreshold = product.reorderLevel ?? product.lowStockThreshold;
  const hasConfiguredThreshold = hasValue(explicitThreshold)
    || hasValue(appSettings?.stockRules?.products?.[product.code])
    || hasValue(appSettings?.stockRules?.categories?.[product.category])
    || hasValue(product.maxStock)
    || hasValue(appSettings?.maxStockLimit);
  const threshold = hasValue(explicitThreshold)
    ? Number(explicitThreshold)
    : getLowStockThreshold(product, appSettings);
  const trackedBatches = Array.isArray(expiryData?.batches) ? expiryData.batches : [];
  const expiryTracking = product.expiryTrackingEnabled === true
    || trackedBatches.length > 0
    || Boolean(selectedBatch)
    || expiryData !== null;
  const today = getManilaBusinessDate();
  const productDisplayName = getProductDisplayName(product, categories);
  const selectedBatchId = String(selectedBatch?.id || selectedBatch?._id || '');
  const selectedBatchIsInCurrentPeriod = selectedBatchId && trackedBatches.some((batch) => String(batch._id || batch.id) === selectedBatchId);
  const historicalSelectedBatch = selectedBatch && !selectedBatchIsInCurrentPeriod ? selectedBatch : null;

  const overallBatchVerification = expiryData?.reconciled === true;
  const renderBatchRow = (batch, { historical = false } = {}) => {
    const hasBatchVerificationState = typeof batch.balanceConfirmed === 'boolean';
    const balanceConfirmed = hasBatchVerificationState
      ? batch.balanceConfirmed
      : historical ? false : overallBatchVerification;
    const remaining = historical ? batch.historicalRemainingQuantity : batch.remainingQuantity;
    const hasConfirmedRemaining = historical ? hasValue(remaining) : balanceConfirmed && hasValue(remaining);
    const expiryBadge = historical ? 'Historical' : getBatchExpiryStatus(batch.expiryDate, today);
    const verificationException = getBatchVerificationException(batch, overallBatchVerification);
    const batchReference = batch.batchReference || batch.batchId || 'Reference pending';
    return (
      <tr key={`${historical ? 'historical-' : ''}${batch.id || batch._id || batch.batchId || batch.batchReference}`} className="border-b border-slate-100 last:border-b-0">
        <td className="min-w-0 px-2.5 py-2 align-middle">
          <p className="truncate whitespace-nowrap font-semibold text-slate-900" title={batchReference}>{batchReference}</p>
          {batch.lotNumber && <p className="mt-0.5 truncate whitespace-nowrap text-[9px] text-slate-500" title={`Lot No. ${batch.lotNumber}`}>Lot No. {batch.lotNumber}</p>}
        </td>
        <td className="whitespace-nowrap px-2.5 py-2 align-middle text-slate-700">{formatExpiryDateLabel(batch.expiryDate)}</td>
        <td className="whitespace-nowrap px-2.5 py-2 text-right align-middle font-medium tabular-nums text-slate-800">
          {hasConfirmedRemaining ? `${formatNumber(remaining)}${sellingUnit ? ` ${sellingUnit}` : ''}` : 'Not verified'}
        </td>
        <td className="min-w-0 px-2.5 py-2 align-middle">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <BatchStatusBadge status={expiryBadge} />
            {verificationException && <BatchStatusBadge status={verificationException} />}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <>
      <div className="flex min-w-0 gap-4">
            <ProductImage product={product} categories={categories} onPreview={onImagePreview} />
        <div className="min-w-0 py-1">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
            {product.category ? `Product Type · ${product.category}` : 'Product'}
          </p>
          <h4 className="mt-1 break-words text-base font-semibold leading-snug text-slate-900">{productDisplayName}</h4>
          {product.brand && hasStoredProductName(product) && <p className="mt-1 break-words text-xs text-slate-500">{product.brand}</p>}
          <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900">{formatCurrency(product.price)}</p>
          <p className="text-[10px] font-medium text-slate-500">Price per {sellingUnit || 'unit'}</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 text-xs">
        <DetailValue label="SKU">{product.code || '—'}</DetailValue>
        <DetailValue label="Product Status"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass}`}>{product.isActive === false ? 'Archived' : 'Active'}</span></DetailValue>
        <DetailValue label="Stock Availability"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 ${availabilityClass}`}>{availability}</span></DetailValue>
        {sellingUnit && <DetailValue label="Sold By">{sellingUnit}</DetailValue>}
        <DetailValue label="Current Stock">{formatNumber(stock)}{sellingUnit ? ` ${sellingUnit}` : ''}</DetailValue>
        {reserved > 0 && <DetailValue label="Reserved Stock">{formatNumber(reserved)}{sellingUnit ? ` ${sellingUnit}` : ''}</DetailValue>}
        <DetailValue label="Available to Sell">{formatNumber(available)}{sellingUnit ? ` ${sellingUnit}` : ''}</DetailValue>
        {hasConfiguredThreshold && Number.isFinite(threshold) && <DetailValue label="Low Stock Threshold">{formatNumber(threshold)}{sellingUnit ? ` ${sellingUnit}` : ''}</DetailValue>}
        {product.supplier && <DetailValue label="Supplier">{product.supplier}</DetailValue>}
      </dl>

      {specifications.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4" aria-label="Product specifications">
          <h5 className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Specifications</h5>
          <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-3 text-xs min-[380px]:grid-cols-2">
            {specifications.map(({ name, value }) => (
              <div key={name} className="min-w-0">
                <dt className="text-[10px] font-medium text-slate-500">{name}</dt>
                <dd className="mt-0.5 break-words font-medium leading-relaxed text-slate-800 [overflow-wrap:anywhere]">
                  {name.toLowerCase() === 'color' ? <ColorSwatch value={value} className="justify-start" /> : value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {expiryTracking && (
        <section className="mt-5" aria-label="Expiry information">
          <button type="button" onClick={() => setIsExpiryExpanded((expanded) => !expanded)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-100/70 px-4 py-3 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" aria-expanded={isExpiryExpanded}>
            <span className="flex min-w-0 items-center gap-2 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
              Expiry Information
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white">{trackedBatches.length + (historicalSelectedBatch ? 1 : 0)} {trackedBatches.length + (historicalSelectedBatch ? 1 : 0) === 1 ? 'batch' : 'batches'}</span>
            </span>
            <span className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
              {expiryStatus === 'loading' ? 'Loading…' : overallBatchVerification ? <BatchStatusBadge status="Verified" /> : <BatchStatusBadge status="Not Yet Verified" />}
              <svg className={`h-3.5 w-3.5 transition-transform ${isExpiryExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
            </span>
          </button>
          {isExpiryExpanded && <>
            {expiryStatus === 'loading' && <p role="status" className="mt-2 text-[11px] text-slate-500">Loading tracked batch information…</p>}
            {expiryStatus === 'error' && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-rose-700"><span>Tracked batch information could not be refreshed.</span><button type="button" onClick={onRetryExpiry} className="font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button></div>}
            {expiryStatus === 'success' && expiryData && (
              <>
              {expiryData.unavailable && <p className="mt-2 text-[11px] text-slate-500">Expiry tracking is not enabled for this product.</p>}
              {Number(expiryData.existingStockToVerify || 0) > 0 && <p className="mt-2 text-[11px] text-slate-600">Existing stock to verify: <span className="font-semibold text-slate-800">{formatNumber(expiryData.existingStockToVerify)}{sellingUnit ? ` ${sellingUnit}` : ''}</span></p>}
              {trackedBatches.length === 0 && !historicalSelectedBatch && <p className="mt-2 text-[11px] text-slate-500">No current-period batches recorded.</p>}
              {(trackedBatches.length > 0 || historicalSelectedBatch) && <div className="mt-2.5 w-full min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[520px] table-fixed text-left text-[11px]">
                  <colgroup>
                    <col className="w-[35%]" />
                    <col className="w-[25%]" />
                    <col className="w-[20%]" />
                    <col className="w-[20%]" />
                  </colgroup>
                  <thead className="bg-slate-900 text-[9px] uppercase tracking-wider text-white">
                    <tr><th className="px-2.5 py-2 font-semibold">Batch Reference / Lot No.</th><th className="whitespace-nowrap px-2.5 py-2 font-semibold">Expiry Date</th><th className="px-2.5 py-2 text-right font-semibold">Remaining Stock</th><th className="px-2.5 py-2 font-semibold">Status</th></tr>
                  </thead>
                  <tbody>
                    {trackedBatches.map((batch) => renderBatchRow(batch))}
                    {historicalSelectedBatch && renderBatchRow(historicalSelectedBatch, { historical: true })}
                  </tbody>
                </table>
              </div>}
            </>
            )}
          </>}
        </section>
      )}
    </>
  );
};

export default InventoryProductDetails;
