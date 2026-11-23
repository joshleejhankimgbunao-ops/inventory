import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolbarDropdown from './ToolbarDropdown';
import ViewportTooltip from './ViewportTooltip';
import { getExpiryBatchMonitoringApi } from '../services/inventoryApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { formatNumber } from '../utils/numberFormat';
import { formatExpiryDateLabel } from '../utils/productExpiryDate';
import { getProductDisplayName } from '../utils/productDisplayName';

const statusOptions = [
  { value: 'Current Stock', label: 'Current Stock' },
  { value: 'All Statuses', label: 'All Statuses' },
  { value: 'Expiring Soon', label: 'Expiring Soon' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Valid', label: 'Valid' },
  { value: 'Depleted', label: 'Depleted' },
  { value: 'Historical', label: 'Historical' },
];

const millisecondsUntilManilaMidnight = () => {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const elapsedToday = Number(parts.hour) * 3600000 + Number(parts.minute) * 60000
    + Number(parts.second) * 1000 + now.getMilliseconds();
  return Math.max(1000, 86400000 - elapsedToday + 500);
};

const statusStyle = {
  Expired: 'border-rose-200 bg-rose-50 text-rose-800',
  'Expiring Soon': 'border-amber-200 bg-amber-50 text-amber-800',
  Valid: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Depleted: 'border-slate-200 bg-slate-100 text-slate-600',
  Historical: 'border-slate-200 bg-slate-50 text-slate-500',
};

const daysLabel = (days) => {
  if (days === 0) return 'Today';
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

const ExpiryStatus = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusStyle[status] || statusStyle.Valid}`}>
    {status}
  </span>
);

const BalanceStatus = ({ confirmed, historical = false }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${confirmed
    ? 'border-slate-200 bg-white text-slate-600'
    : historical ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
    {confirmed ? 'Verified' : historical ? 'Closed Period' : 'Not Yet Verified'}
  </span>
);

const SummaryIcon = ({ kind }) => {
  const paths = {
    soon: <><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 1.5" /><circle cx="12" cy="12" r="9" /></>,
    expired: <><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5m0 3h.01" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86 2.82 17.2A1.5 1.5 0 0 0 4.12 19h15.76a1.5 1.5 0 0 0 1.3-1.8L13.71 3.86a1.5 1.5 0 0 0-2.42 0z" /></>,
    stock: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="M4.5 7.8 12 12l7.5-4.2M12 12v9" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 sm:h-5 sm:w-5">{paths[kind]}</svg>;
};

const MetricCard = ({ title, icon, children, tone = 'text-slate-800' }) => (
  <article className="app-dashboard-card-hover flex h-full min-h-[4.5rem] min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm sm:px-4 dark:border-slate-700 dark:bg-slate-900">
    <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-slate-600 dark:text-slate-300">{title}</p>
        <div className={`mt-1.5 text-[22px] font-semibold leading-tight text-gray-900 sm:text-2xl dark:text-slate-100 ${tone}`}>{children}</div>
      </div>
      <span className="shrink-0 rounded-lg bg-gray-900 p-1.5 text-white sm:p-2 dark:bg-gray-700"><SummaryIcon kind={icon} /></span>
  </article>
);

const ExpiryMonitoring = ({ products = [], categories = [], refreshKey = 0, canCorrectExpiryDate = false, onCorrectExpiryDate,
  canVerifyBatches = false, onVerifyBatches, verificationRequest = null, onProductDetails }) => {
  const [data, setData] = useState({ asOfDate: '', batches: [], unassignedProducts: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Current Stock');
  const [reloadKey, setReloadKey] = useState(0);
  const hasLoadedOnceRef = useRef(false);
  const scheduleRefreshRef = useRef(null);
  const previousRefreshKeysRef = useRef({ reloadKey, refreshKey });
  const getBatchProductDisplayName = useCallback((batch) => {
    const productId = String(batch?.productId || '').trim();
    const sku = String(batch?.sku || batch?.code || '').trim().toLocaleUpperCase();
    const linkedProduct = products.find((product) => productId
      && String(product?.id || product?._id || '').trim() === productId)
      || products.find((product) => sku
        && String(product?.code || product?.sku || '').trim().toLocaleUpperCase() === sku);
    const recordedName = String(batch?.productName || '').trim();
    return recordedName || getProductDisplayName(linkedProduct || batch, categories);
  }, [categories, products]);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    let refreshQueued = false;
    let refreshTimer;
    let midnightTimer;
    const load = async () => {
      if (!active) return;
      if (requestInFlight) {
        refreshQueued = true;
        return;
      }
      requestInFlight = true;
      const showInitialLoading = !hasLoadedOnceRef.current;
      if (showInitialLoading) setLoading(true);
      setError('');
      try {
        const result = await getExpiryBatchMonitoringApi();
        if (!active) return;
        hasLoadedOnceRef.current = true;
        setData({
          asOfDate: result?.asOfDate || '',
          batches: Array.isArray(result?.batches) ? result.batches : [],
          unassignedProducts: Array.isArray(result?.unassignedProducts) ? result.unassignedProducts : [],
          summary: result?.summary || null,
        });
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Unable to load expiry monitoring.');
      } finally {
        requestInFlight = false;
        if (active && showInitialLoading) setLoading(false);
        if (active && refreshQueued) {
          refreshQueued = false;
          scheduleRefresh();
        }
      }
    };
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => load(), 100);
    };
    const refreshAtMidnight = () => {
      midnightTimer = window.setTimeout(() => {
        load();
        refreshAtMidnight();
      }, millisecondsUntilManilaMidnight());
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const unsubscribeInventoryUpdated = subscribeRealtimeEvent('inventory.updated', scheduleRefresh);
    const unsubscribeRealtimeResync = subscribeRealtimeEvent('realtime.resync', scheduleRefresh);
    scheduleRefreshRef.current = scheduleRefresh;
    load();
    refreshAtMidnight();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      refreshQueued = false;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(midnightTimer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      scheduleRefreshRef.current = null;
      unsubscribeInventoryUpdated();
      unsubscribeRealtimeResync();
    };
  }, []);

  useEffect(() => {
    const previous = previousRefreshKeysRef.current;
    if (previous.reloadKey !== reloadKey || previous.refreshKey !== refreshKey) {
      scheduleRefreshRef.current?.();
      previousRefreshKeysRef.current = { reloadKey, refreshKey };
    }
  }, [reloadKey, refreshKey]);

  const visibleBatches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return data.batches
      .filter((batch) => {
        if (statusFilter === 'Historical') return batch.isHistoricalPeriod;
        if (batch.isHistoricalPeriod) return false;
        if (statusFilter === 'Current Stock') return batch.hasRemainingStock;
        return statusFilter === 'All Statuses' || batch.status === statusFilter;
      })
      .filter((batch) => !query || [getBatchProductDisplayName(batch), batch.sku, batch.lotNumber, batch.batchReference, batch.batchId]
        .some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      .sort((left, right) => left.expiryDate.localeCompare(right.expiryDate)
        || getBatchProductDisplayName(left).localeCompare(getBatchProductDisplayName(right))
        || String(left.sku).localeCompare(String(right.sku)));
  }, [data.batches, getBatchProductDisplayName, search, statusFilter]);

  const verificationProducts = useMemo(() => {
    const byId = new Map();
    data.unassignedProducts.forEach((product) => byId.set(String(product.productId), {
      ...product,
      productName: getBatchProductDisplayName(product),
    }));
    data.batches.filter((batch) => !batch.isHistoricalPeriod && !batch.balanceConfirmed).forEach((batch) => {
      const productId = String(batch.productId || '');
      if (!productId || byId.has(productId)) return;
      byId.set(productId, {
        productId,
        productName: getBatchProductDisplayName(batch),
        sku: batch.sku,
        productStock: Number(batch.productStock || 0),
        sellingUnit: batch.sellingUnit || '',
      });
    });
    return [...byId.values()].sort((left, right) => getBatchProductDisplayName(left).localeCompare(getBatchProductDisplayName(right))
      || String(left.sku || '').localeCompare(String(right.sku || '')));
  }, [data.batches, data.unassignedProducts, getBatchProductDisplayName]);

  const renderRemaining = (batch) => batch.isHistoricalPeriod
    ? <>{formatNumber(batch.historicalRemainingQuantity || 0)}{batch.sellingUnit ? ` ${batch.sellingUnit}` : ''} <span className="text-slate-500">(last recorded)</span></>
    : batch.balanceConfirmed
      ? <>{formatNumber(batch.remainingQuantity)}{batch.sellingUnit ? ` ${batch.sellingUnit}` : ''}</>
      : <span className="text-amber-800">Not Yet Verified</span>;

  const renderDays = (batch) => {
    const isActiveOverdueBatch = !batch.isHistoricalPeriod
      && batch.status === 'Expired'
      && batch.hasRemainingStock
      && Number(batch.remainingQuantity) > 0;
    return (
      <span className={isActiveOverdueBatch ? 'font-medium text-rose-700' : 'text-slate-500'}>
        {isActiveOverdueBatch ? daysLabel(batch.daysUntilExpiry) : `${Math.abs(batch.daysUntilExpiry)} ${Math.abs(batch.daysUntilExpiry) === 1 ? 'day' : 'days'}${batch.daysUntilExpiry <= 0 ? ' since expiry' : ''}`}
      </span>
    );
  };
  const openBatchProductDetails = (event, batch) => {
    if (!onProductDetails || event.target?.closest?.('button, a, input, select, textarea, [data-row-action]')) return;
    onProductDetails(batch.productId, batch, event);
  };
  const openBatchProductDetailsFromControl = (event, batch) => {
    event.stopPropagation();
    onProductDetails?.(batch.productId, batch, event);
  };

  return (
    <section aria-labelledby="expiry-monitoring-heading" className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="expiry-monitoring-heading" className="text-sm font-semibold text-slate-900">Expiry Monitoring</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Track products nearing or past their expiry dates.</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricCard title="Expiring Soon" icon="soon">{loading ? '—' : formatNumber(data.summary?.expiringSoonBatches || 0)}</MetricCard>
        <MetricCard title="Expired Batches" icon="expired">{loading ? '—' : formatNumber(data.summary?.expiredBatches || 0)}</MetricCard>
        <MetricCard title="Products With Expired Stock" icon="stock">{loading ? '—' : formatNumber(data.summary?.productsWithExpiredStock || 0)}</MetricCard>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start">
        <label className="main-toolbar-search group w-full sm:max-w-[27.5rem]">
          <span className="sr-only">Search expiry batches by product, SKU, or batch number</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU, or batch/lot..." className="main-toolbar-search-input" />
          <span className="main-toolbar-search-icon">
            <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </label>
        <ToolbarDropdown
          value={statusFilter}
          onChange={setStatusFilter}
          options={statusOptions}
          ariaLabel="Filter expiry batches by status"
          className="w-fit max-w-full"
          menuClassName="w-max min-w-[min(13rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-[min(50vh,20rem)] overflow-y-auto pr-3 [scrollbar-gutter:stable]"
          compact portalMenu fitSelectedValue softForeground focusVisibleRing
        />
      </div>

      {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><span>{error}</span><button type="button" onClick={() => setReloadKey((current) => current + 1)} className="rounded-md border border-rose-300 bg-white px-2.5 py-1 font-semibold text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">Retry</button></div>}

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
        {loading ? <div className="space-y-2 bg-slate-50 p-3" aria-label="Loading expiry batches" aria-busy="true">{Array.from({ length: 3 }).map((_, index) => <div key={`expiry-skeleton-${index}`} className="h-9 animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none" />)}</div>
          : error && data.batches.length === 0 ? <div role="status" className="bg-slate-50 px-4 py-7 text-center text-xs text-slate-500">Expiry monitoring could not be loaded.</div>
          : data.batches.length === 0 ? <div role="status" className="bg-slate-50 px-4 py-7 text-center text-xs text-slate-500">No expiry-tracked batches to monitor.</div>
            : visibleBatches.length === 0 ? <div role="status" className="bg-slate-50 px-4 py-7 text-center text-xs text-slate-500">No batches match this search or status.</div>
              : <>
                <div className="hidden overflow-x-auto md:block">
                  <table className={`w-full ${canCorrectExpiryDate ? 'min-w-[1160px]' : 'min-w-[1060px]'} text-left text-xs`}>
                    <thead className="bg-gray-900 text-[10px] uppercase tracking-wide text-white"><tr>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">Product / SKU</th><th className="whitespace-nowrap px-2 py-2 font-semibold">Batch Reference / Lot No.</th><th className="whitespace-nowrap px-2 py-2 font-semibold">Expiry Date</th><th className="whitespace-nowrap px-2 py-2 text-right font-semibold">Qty Received</th><th className="whitespace-nowrap px-2 py-2 text-right font-semibold">{statusFilter === 'Historical' ? 'Last Recorded Qty' : 'Remaining Qty'}</th><th className="whitespace-nowrap px-2 py-2 font-semibold">Unit</th><th className="whitespace-nowrap px-2 py-2 font-semibold">Days Until Expiry</th><th className="whitespace-nowrap px-2 py-2 font-semibold">Expiry Status</th>{canCorrectExpiryDate && <th className="w-36 whitespace-nowrap px-2 py-2 text-center font-semibold">Action</th>}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {visibleBatches.map((batch) => <tr key={batch.id} onClick={(event) => openBatchProductDetails(event, batch)} className={`text-slate-700 ${onProductDetails ? 'cursor-pointer transition-colors hover:bg-slate-50' : ''}`}>
                        <td className="px-2 py-2"><button type="button" data-product-details-trigger onClick={(event) => openBatchProductDetailsFromControl(event, batch)} className="block max-w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700"><span className="block break-words font-medium text-slate-900">{getBatchProductDisplayName(batch)}</span><span className="mt-0.5 block whitespace-nowrap text-[10px] text-slate-500">{batch.sku}</span><span className="sr-only">View product details</span></button></td>
                        <td className="px-2 py-2"><div className="whitespace-nowrap font-semibold text-slate-900">{batch.batchReference || 'Reference pending'}</div>{batch.lotNumber && <div className="mt-0.5 whitespace-nowrap text-[10px] text-slate-500">Manufacturer Lot No.: {batch.lotNumber}</div>}</td><td className="whitespace-nowrap px-2 py-2">{formatExpiryDateLabel(batch.expiryDate)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatNumber(batch.quantityReceived)}{batch.sellingUnit ? ` ${batch.sellingUnit}` : ''}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{renderRemaining(batch)}</td><td className="whitespace-nowrap px-2 py-2">{batch.sellingUnit || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2">{renderDays(batch)}</td><td className="px-2 py-2"><div className="flex flex-col items-start gap-1"><ExpiryStatus status={batch.status} /><BalanceStatus confirmed={batch.balanceConfirmed} historical={batch.isHistoricalPeriod} /></div></td>
                        {canCorrectExpiryDate && !batch.isHistoricalPeriod && <td className="whitespace-nowrap px-2 py-2 text-center align-middle">{batch.updatedAt && <ViewportTooltip content="Correct Expiry Date" maxWidth={180}><button type="button" aria-label={`Correct Expiry Date for ${batch.batchReference || batch.batchId}`} title="Correct Expiry Date" onClick={(event) => { event.stopPropagation(); onCorrectExpiryDate?.(batch); }} className="inline-flex h-[29px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-gray-900 bg-gray-900 px-1.5 text-[11px] font-semibold leading-none text-white shadow-sm transition-colors hover:border-gray-800 hover:bg-gray-800 active:border-gray-950 active:bg-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-gray-500 dark:bg-gray-700 dark:hover:border-gray-400 dark:hover:bg-gray-600 dark:active:border-gray-400 dark:active:bg-gray-600 dark:focus-visible:ring-gray-400/50 dark:focus-visible:ring-offset-slate-900"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 2.651 2.651M7.5 20.25H3.75V16.5L16.94 3.31a1.875 1.875 0 0 1 2.652 0l1.098 1.098a1.875 1.875 0 0 1 0 2.652L7.5 20.25Z" /></svg><span>Correct Expiry Date</span></button></ViewportTooltip>}</td>}
                      </tr>)}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 bg-slate-50 p-2 md:hidden">
                  {visibleBatches.map((batch) => <article key={batch.id} onClick={(event) => openBatchProductDetails(event, batch)} className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${onProductDetails ? 'cursor-pointer transition-colors hover:border-slate-300 hover:bg-slate-50' : ''}`}>
                    <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><button type="button" data-product-details-trigger onClick={(event) => openBatchProductDetailsFromControl(event, batch)} className="block max-w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700"><span className="block break-words text-xs font-semibold text-slate-900">{getBatchProductDisplayName(batch)}</span><span className="mt-0.5 block break-all text-[10px] text-slate-500">{batch.sku}</span><span className="sr-only">View product details</span></button></div><div className="flex shrink-0 flex-col items-end gap-1"><ExpiryStatus status={batch.status} /><BalanceStatus confirmed={batch.balanceConfirmed} historical={batch.isHistoricalPeriod} /></div></div>
                    <div className="mt-2 min-w-0 overflow-x-auto text-[11px] text-slate-700"><p className="whitespace-nowrap">Batch Reference: <span className="font-semibold">{batch.batchReference || 'Reference pending'}</span></p>{batch.lotNumber && <p className="mt-0.5 whitespace-nowrap text-[10px] text-slate-500">Manufacturer Lot No.: {batch.lotNumber}</p>}</div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2 text-[10px]">
                      <div><dt className="text-slate-500">Expiry Date</dt><dd className="font-medium text-slate-800">{formatExpiryDateLabel(batch.expiryDate)}</dd></div><div><dt className="text-slate-500">Days Until Expiry</dt><dd>{renderDays(batch)}</dd></div>
                      <div><dt className="text-slate-500">Qty Received</dt><dd className="font-medium text-slate-800">{formatNumber(batch.quantityReceived)}{batch.sellingUnit ? ` ${batch.sellingUnit}` : ''}</dd></div><div><dt className="text-slate-500">{statusFilter === 'Historical' ? 'Last Recorded Qty' : 'Remaining Quantity'}</dt><dd className="font-medium text-slate-800">{renderRemaining(batch)}</dd></div>
                    </dl>
                    {canCorrectExpiryDate && !batch.isHistoricalPeriod && batch.updatedAt && <button type="button" title="Correct Expiry Date" aria-label={`Correct Expiry Date for ${batch.batchReference || batch.batchId}`} onClick={(event) => { event.stopPropagation(); onCorrectExpiryDate?.(batch); }} className="inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-900 bg-gray-900 px-2 text-center text-xs font-semibold text-white shadow-sm transition-colors hover:border-gray-800 hover:bg-gray-800 active:border-gray-950 active:bg-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-gray-500 dark:bg-gray-700 dark:hover:border-gray-400 dark:hover:bg-gray-600 dark:active:border-gray-400 dark:active:bg-gray-600 dark:focus-visible:ring-gray-400/50 dark:focus-visible:ring-offset-slate-900"><span className="inline-flex h-4 w-4 shrink-0 items-center justify-center"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 2.651 2.651M7.5 20.25H3.75V16.5L16.94 3.31a1.875 1.875 0 0 1 2.652 0l1.098 1.098a1.875 1.875 0 0 1 0 2.652L7.5 20.25Z" /></svg></span><span>Correct Expiry Date</span></button>}
                  </article>)}
                </div>
              </>}
      </div>
      {verificationProducts.length > 0 && !loading && <section aria-labelledby="batch-verification-needed-heading" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <h3 id="batch-verification-needed-heading" className="text-xs font-semibold text-slate-900">Batch Verification Needed</h3>
          {!canVerifyBatches && <p className="text-[11px] text-slate-600">Ask an administrator to verify these batches.</p>}
        </div>
        <ul className="mt-1 divide-y divide-slate-200">
          {verificationProducts.map((product) => {
            const request = verificationRequest?.productId === String(product.productId) ? verificationRequest : null;
            const busy = request?.status === 'loading';
            return <li key={product.productId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-slate-900">{product.productName}</p>
                <p className="mt-0.5 text-[11px] text-slate-600">{product.sku} <span className="mx-1 text-slate-400">·</span> Current stock: {formatNumber(product.productStock)}{product.sellingUnit ? ` ${product.sellingUnit}` : ''}</p>
                {request?.status === 'error' && <p role="alert" className="mt-1 text-[11px] text-rose-700">{request.error}</p>}
              </div>
              {canVerifyBatches && <button type="button" onClick={() => onVerifyBatches?.(product)} disabled={busy} aria-busy={busy} className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-md border border-gray-900 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:border-gray-800 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none">
                {busy ? 'Loading…' : 'Verify Batches'}
              </button>}
            </li>;
          })}
        </ul>
      </section>}
    </section>
  );
};

export default ExpiryMonitoring;
