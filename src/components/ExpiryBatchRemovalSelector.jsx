import React from 'react';
import { formatNumber } from '../utils/numberFormat';
import { formatExpiryDateLabel, getManilaBusinessDate } from '../utils/productExpiryDate';
import { getAvailableBatchRemovalQuantity, getEligibleBatchRemovalBatches } from '../utils/expiryBatchRemoval.mjs';

const getExpiryStatus = (expiryDate, today) => {
  const daysUntilExpiry = Math.round((Date.parse(`${expiryDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86400000);
  if (!Number.isFinite(daysUntilExpiry) || daysUntilExpiry <= 0) return 'Expired';
  return daysUntilExpiry <= 30 ? 'Expiring Soon' : 'Valid';
};

const statusStyles = {
  Expired: 'border-rose-200 bg-rose-50 text-rose-800',
  'Expiring Soon': 'border-amber-200 bg-amber-50 text-amber-800',
  Valid: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

const ExpiryBatchRemovalSelector = ({ batches = [], allocations = {}, allocationReviewRows = [], allocationTotalInvalid = false, unit = '', disabled = false, onChange, onConfirmAllocation, onClearAllocation }) => {
  const today = getManilaBusinessDate();
  const getAvailable = getAvailableBatchRemovalQuantity;
  const eligibleBatches = getEligibleBatchRemovalBatches(batches);
  const getExpiryStatusStyle = (batch) => {
    const status = getExpiryStatus(batch.expiryDate, today);
    return { status, className: statusStyles[status] };
  };
  const renderStatusBadge = (batch) => {
    const { status, className } = getExpiryStatusStyle(batch);
    return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}>{status}</span>;
  };
  const renderQuantityInput = (batch) => {
    const available = getAvailable(batch);
    return <input
      type="text"
      name={`batchAllocation-${String(batch._id || '')}`}
      data-validation-key="batchAllocationQuantity"
      inputMode="numeric"
      pattern="[0-9]*"
      max={available}
      value={allocations[String(batch._id)] || ''}
      onChange={(event) => onChange?.(String(batch._id), event.target.value, batch)}
      disabled={disabled || available <= 0 || !batch.batchId || !batch.updatedAt}
      aria-label={`Quantity to remove from ${batch.batchReference || 'batch'}`}
      placeholder="0"
      className="h-8 w-16 rounded-md border border-slate-300 bg-white px-1.5 text-right text-xs tabular-nums text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 sm:w-[4.5rem]"
    />;
  };

  const allocationReview = allocationReviewRows.length > 0 && <section role="alert" className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
    <p>Batch availability changed or a quantity exceeds the current available amount. Adjust or confirm each affected allocation before continuing.</p>
    <ul className="space-y-2">
      {allocationReviewRows.map((row) => <li key={row.batchId} className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-2 first:border-0 first:pt-0">
        <span className="min-w-0 flex-1"><strong>{row.batchReference}</strong>: entered {formatNumber(row.quantity)}{unit ? ` ${unit}` : ''}; available now {formatNumber(row.availableQuantity)}{unit ? ` ${unit}` : ''}.</span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {row.canConfirm && <button type="button" onClick={() => onConfirmAllocation?.(row.batchId)} disabled={disabled} className="rounded border border-amber-400 bg-white px-2 py-1 font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50">Confirm current availability</button>}
          <button type="button" onClick={() => onClearAllocation?.(row.batchId)} disabled={disabled} className="rounded border border-amber-400 bg-white px-2 py-1 font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50">Clear allocation</button>
        </span>
      </li>)}
    </ul>
  </section>;

  const emptyState = eligibleBatches.length === 0 && <div role="status" className="rounded-md bg-slate-50 px-3 py-3 text-center text-xs text-slate-600">
    <p>No batches available for stock removal.</p>
    {batches.some((batch) => Number(batch.remainingQuantity || 0) > 0 && Number(batch.reservedQuantity || 0) >= Number(batch.remainingQuantity || 0)) && <p className="mt-1">The remaining stock is reserved.</p>}
  </div>;

  if (eligibleBatches.length === 0) {
    return <div className="space-y-2">{emptyState}{allocationReview}{allocationTotalInvalid && <p role="alert" className="text-xs text-rose-700">Selected quantities exceed current unreserved stock. Adjust the batch quantities.</p>}</div>;
  }

  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div role="region" aria-label="Available expiry batches" tabIndex={0} className="max-h-64 overflow-y-auto overscroll-y-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500">
      <div className="hidden sm:block">
        <table className="w-full table-fixed text-left text-[10px]">
        <colgroup>
          <col className="w-[29%]" />
          <col className="w-[19%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-gray-900 text-white"><tr>
          <th className="px-2 py-2 font-semibold">Batch Reference</th>
          <th className="px-2 py-2 font-semibold">Expiry Date</th>
          <th className="px-2 py-2 font-semibold">Status</th>
          <th className="px-2 py-2 text-right font-semibold">Available</th>
          <th className="px-2 py-2 text-right font-semibold">Remove Qty</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {eligibleBatches.map((batch) => {
              const allocation = Number(allocations[String(batch._id)] || 0);
              const available = getAvailable(batch);
              const batchReference = batch.batchReference || 'Reference pending';
              return <tr key={batch._id} className={allocation > 0 ? 'bg-slate-50' : 'bg-white'}>
                <td className="px-2 py-2 align-middle font-semibold text-slate-900"><span className={`block truncate ${batchReference.length > 24 ? 'break-all' : 'whitespace-nowrap'}`}>{batchReference}</span></td>
                <td className="whitespace-nowrap px-2 py-2 align-middle text-slate-700">{formatExpiryDateLabel(batch.expiryDate)}</td>
                <td className="px-2 py-2 align-middle">{renderStatusBadge(batch)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right align-middle tabular-nums text-slate-800">{formatNumber(available)}{unit ? ` ${unit}` : ''}</td>
                <td className="px-2 py-2 align-middle text-right">{renderQuantityInput(batch)}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 bg-slate-50 p-2 sm:hidden">
        {eligibleBatches.map((batch) => {
          const allocation = Number(allocations[String(batch._id)] || 0);
          const available = getAvailable(batch);
          return <article key={batch._id} className={`rounded-md border p-3 ${allocation > 0 ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white'}`}>
            <div className="flex min-w-0 items-start justify-between gap-2"><span className="min-w-0 break-all font-semibold text-slate-900">{batch.batchReference || 'Reference pending'}</span>{renderStatusBadge(batch)}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 text-[11px]">
              <div className="min-w-0"><dt className="text-slate-500">Expiry Date</dt><dd className="mt-0.5 whitespace-nowrap font-medium text-slate-800">{formatExpiryDateLabel(batch.expiryDate)}</dd></div>
              <div className="min-w-0 text-right"><dt className="text-slate-500">Available</dt><dd className="mt-0.5 whitespace-nowrap font-medium tabular-nums text-slate-800">{formatNumber(available)}{unit ? ` ${unit}` : ''}</dd></div>
              <div className="col-span-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2"><dt className="text-slate-500">Remove Qty</dt>{renderQuantityInput(batch)}</div>
            </dl>
          </article>;
        })}
      </div>
    </div>
    {allocationReview}
    {allocationTotalInvalid && <p role="alert" className="px-2 py-2 text-xs text-rose-700">Selected quantities exceed current unreserved stock. Adjust the batch quantities.</p>}
  </div>;
};

export default ExpiryBatchRemovalSelector;
