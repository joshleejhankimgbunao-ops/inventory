import React, { useMemo, useState } from 'react';
import { formatNumber } from '../utils/numberFormat';

const emptyDeliveryRow = () => ({ expiryDate: '', quantity: '', lotNumber: '' });
const hasDeliveryValue = (row) => Boolean(
  String(row.expiryDate || '').trim()
  || String(row.quantity ?? '').trim()
  || String(row.lotNumber || '').trim(),
);

const ExpiryBatchVerificationForm = ({
  product,
  rows,
  onRowsChange,
  onTouched,
  onSubmit,
  onCancel,
  onRefresh,
  isLoading = false,
  isSubmitting = false,
  needsRefresh = false,
  confirmLabel = 'Confirm Batches',
  inlineStockFlow = false,
}) => {
  const [deliveryRows, setDeliveryRows] = useState(() => [emptyDeliveryRow()]);
  const [deliveryReason, setDeliveryReason] = useState('Delivery');
  const [otherReason, setOtherReason] = useState('');
  const target = Number(product?.existingStockToVerify ?? product?.productStock ?? 0);
  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), [rows]);
  const datesValid = rows.every((row) => Boolean(String(row.expiryDate || '').trim()));
  const quantitiesValid = rows.every((row) => Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0);
  const verificationValid = target > 0 && rows.length > 0 && datesValid && quantitiesValid && total === target;
  const activeDeliveryRows = inlineStockFlow ? deliveryRows.filter(hasDeliveryValue) : [];
  const deliveryTotal = activeDeliveryRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const deliveryRowsValid = activeDeliveryRows.length === 0 || activeDeliveryRows.every((row) => (
    String(row.expiryDate || '').trim()
    && Number.isSafeInteger(Number(row.quantity))
    && Number(row.quantity) > 0
    && String(row.lotNumber || '').trim().length <= 100
  ));
  const reasonValue = deliveryReason === 'Other' ? otherReason.trim() : deliveryReason;
  const deliveryValid = deliveryRowsValid
    && (!activeDeliveryRows.length || (Number.isSafeInteger(deliveryTotal) && deliveryTotal > 0 && Boolean(reasonValue)));
  const valid = verificationValid && deliveryValid;
  const currentStock = Number(product?.productStock || 0);
  const stockAfterDelivery = currentStock + (deliveryValid ? deliveryTotal : 0);

  const updateDeliveryRow = (index, field, value) => {
    onTouched(true);
    setDeliveryRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  };

  const submitForm = (event) => {
    if (!inlineStockFlow) {
      onSubmit(event);
      return;
    }
    onSubmit(event, {
      deliveryBatches: activeDeliveryRows.map((row) => ({
        expiryDate: String(row.expiryDate || '').trim(),
        quantity: Number(row.quantity),
        lotNumber: String(row.lotNumber || '').trim(),
      })),
      reason: activeDeliveryRows.length ? reasonValue : '',
      enableTracking: product?.activationPreview === true,
    });
  };

  return (
    <form onSubmit={submitForm} className="space-y-4 p-4 sm:p-4">
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
        <p>Current Stock: <strong>{formatNumber(currentStock)} {product?.sellingUnit || 'units'}</strong></p>
        <p>Existing Stock to Verify: <strong>{formatNumber(target)} {product?.sellingUnit || 'units'}</strong></p>
      </div>
      {(product?.batches || []).length > 0 && <section className="space-y-2" aria-labelledby="recorded-expiry-batches-heading">
        <h3 id="recorded-expiry-batches-heading" className="text-sm font-semibold text-slate-900">Recorded Batches</h3>
        <div className="max-h-36 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {(product?.batches || []).map((batch) => (
            <div key={batch._id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-slate-100 px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <p className="truncate text-xs font-semibold text-slate-800" title={batch.batchReference || batch.batchId || ''}>{batch.batchReference || batch.batchId || 'Batch reference pending'}{batch.lotNumber ? ` · Lot ${batch.lotNumber}` : ''}</p>
              <p className="text-xs text-slate-600">{batch.expiryDate || 'Date not recorded'}</p>
              <p className="col-span-2 text-[10px] text-slate-500 sm:col-span-1 sm:text-right">Received {formatNumber(batch.quantityReceived || 0)} · Remaining {formatNumber(batch.remainingQuantity || 0)} {product?.sellingUnit || 'units'}</p>
            </div>
          ))}
        </div>
      </section>}
      {target > 0 && <section className="space-y-3 rounded-lg border border-slate-200 p-4" aria-labelledby="expiry-batches-heading">
        <div>
          <h3 id="expiry-batches-heading" className="text-sm font-semibold text-slate-900">Existing Stock Batches</h3>
          <p className="mt-0.5 text-xs text-slate-500">Assign the current unverified stock to its physical expiry batches.</p>
        </div>
        {rows.map((row, index) => (
          <div key={row._id || `expiry-row-${index}`} className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(9rem,1fr)_minmax(6rem,0.55fr)_minmax(11rem,1.3fr)_auto] md:items-end">
              <label className="block min-w-0 text-xs font-medium text-slate-700">
                <span className="block min-h-4 leading-4">Expiry Date</span>
                <input type="date" required value={row.expiryDate || ''} onChange={(event) => { onTouched(true); onRowsChange((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expiryDate: event.target.value } : item)); }} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" />
              </label>
              <label className="block min-w-0 text-xs font-medium text-slate-700">
                <span className="block min-h-4 leading-4">Quantity</span>
                <input type="number" min="1" required value={row.quantity || ''} onChange={(event) => { onTouched(true); onRowsChange((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item)); }} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="Enter quantity" />
              </label>
              <label className="block min-w-0 text-xs font-medium text-slate-700">
                <span className="block min-h-4 leading-4">Batch / Lot No. (optional)</span>
                <input type="text" maxLength={100} value={row.lotNumber || ''} onChange={(event) => onRowsChange((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, lotNumber: event.target.value } : item))} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. LOT-2026-001" />
              </label>
              <button type="button" onClick={() => onRowsChange((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="h-9 rounded-md border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">Remove</button>
            </div>
            <p className="text-[10px] leading-4 text-slate-500">Optional. A batch reference is generated when stock is verified.</p>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={() => onRowsChange((current) => [...current, { expiryDate: '', quantity: '', lotNumber: '' }])} className="h-8 rounded-md bg-slate-900 px-2 text-xs font-semibold text-white hover:bg-slate-800">Add Batch</button>
          <span className={`text-xs font-semibold ${total === target ? 'text-emerald-700' : 'text-slate-700'}`}>{formatNumber(total)} of {formatNumber(target)} {product?.sellingUnit || 'units'} assigned</span>
        </div>
      </section>}
      {inlineStockFlow && <section className="space-y-3 rounded-lg border border-slate-200 p-4" aria-labelledby="new-stock-delivery-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="new-stock-delivery-heading" className="text-sm font-semibold text-slate-900">New Stock Delivery <span className="font-normal text-slate-500">(optional)</span></h3>
            <p className="mt-0.5 text-xs text-slate-500">Only delivery quantities are added to current stock.</p>
          </div>
          <button type="button" onClick={() => { onTouched(true); setDeliveryRows((current) => [...current, emptyDeliveryRow()]); }} className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Add Batch</button>
        </div>
        <div className="space-y-2">
          {deliveryRows.map((row, index) => (
            <div key={`delivery-row-${index}`} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 md:grid-cols-[minmax(8rem,0.9fr)_minmax(5rem,0.55fr)_minmax(9rem,1.1fr)_auto] md:items-end">
              <label className="block min-w-0 text-xs font-medium text-slate-700"><span className="block min-h-4 leading-4">Expiry Date</span><input type="date" value={row.expiryDate || ''} onChange={(event) => updateDeliveryRow(index, 'expiryDate', event.target.value)} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" /></label>
              <label className="block min-w-0 text-xs font-medium text-slate-700"><span className="block min-h-4 leading-4">Quantity</span><input type="number" min="1" value={row.quantity || ''} onChange={(event) => updateDeliveryRow(index, 'quantity', event.target.value)} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="0" /></label>
              <label className="block min-w-0 text-xs font-medium text-slate-700"><span className="block min-h-4 leading-4">Batch / Lot No. (optional)</span><input type="text" maxLength={100} value={row.lotNumber || ''} onChange={(event) => updateDeliveryRow(index, 'lotNumber', event.target.value)} className="mt-1 block h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="e.g. LOT-2026-001" /></label>
              <button type="button" onClick={() => { onTouched(true); setDeliveryRows((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : [emptyDeliveryRow()]); }} className="h-9 rounded-md border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">Remove</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-700">Reason
            <select value={deliveryReason} onChange={(event) => { onTouched(true); setDeliveryReason(event.target.value); if (event.target.value !== 'Other') setOtherReason(''); }} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
              <option>Delivery</option><option>Return</option><option>Adjustment (Found)</option><option>Other</option>
            </select>
          </label>
          {deliveryReason === 'Other' && <label className="block text-xs font-medium text-slate-700">Other Reason
            <input type="text" value={otherReason} onChange={(event) => { onTouched(true); setOtherReason(event.target.value); }} className="mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" placeholder="Enter reason" />
          </label>}
        </div>
        {activeDeliveryRows.length > 0 && !deliveryRowsValid && <p className="text-xs text-rose-700" role="alert">Complete each delivery batch with a valid expiry date and whole quantity.</p>}
        {deliveryReason === 'Other' && activeDeliveryRows.length > 0 && !reasonValue && <p className="text-xs text-rose-700" role="alert">Enter a reason for this delivery.</p>}
        <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-slate-200 pt-3 text-xs">
          <p className="text-slate-600">Delivery Total: <strong className="text-slate-900">{formatNumber(deliveryValid ? deliveryTotal : 0)} {product?.sellingUnit || 'units'}</strong></p>
          <p className="text-slate-600">Stock After Delivery: <strong className="text-slate-900">{formatNumber(stockAfterDelivery)} {product?.sellingUnit || 'units'}</strong></p>
        </div>
      </section>}
      {needsRefresh && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
        <span>Inventory changed. Refresh batch details before confirming.</span>
        <button type="button" onClick={onRefresh} disabled={isLoading || isSubmitting} className="font-semibold underline disabled:opacity-60">{isLoading ? 'Refreshing…' : 'Refresh details'}</button>
      </div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={!valid || isSubmitting || isLoading || needsRefresh} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? 'Saving…' : (inlineStockFlow ? (activeDeliveryRows.length ? 'Confirm & Add Stock' : 'Confirm Verification') : confirmLabel)}</button>
      </div>
    </form>
  );
};

export default ExpiryBatchVerificationForm;
