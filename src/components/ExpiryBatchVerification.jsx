import React, { useEffect } from 'react';
import { isExpiryBatchVerificationConfirmed } from '../utils/expiryBatchVerification';

const allocationId = (allocation) => String(allocation?.batch || allocation?._id || '');
const signature = (allocations = []) => allocations
  .map((allocation) => `${allocationId(allocation)}:${Number(allocation.quantity || 0)}`)
  .sort()
  .join('|');

const createRecord = (item, record) => ({
  productId: String(item.productId),
  proposedAllocations: item.proposedAllocations || [],
  allocations: record?.allocations || (item.proposedAllocations || []).map((row) => ({ ...row })),
  reason: record?.reason || '',
  confirmed: Boolean(record?.confirmed),
});

const updateRecord = (item, record, onChange, changes) => onChange(item.productId, {
  ...createRecord(item, record),
  ...changes,
  confirmed: false,
});

export const ExpiryBatchPickEditor = ({ item, record, onChange, disabled = false, validationKeyPrefix = '' }) => {
  const proposal = Array.isArray(item?.proposedAllocations) ? item.proposedAllocations : null;
  const selection = record?.allocations || (proposal || []).map((row) => ({ ...row }));
  const quantity = Number(item?.quantity || 0);
  const selectedTotal = selection.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
  const options = item?.batchOptions || [];
  const optionById = new Map(options.map((option) => [String(option.batch || option._id), option]));
  const isOverride = signature(proposal || []) !== signature(selection);
  const availableChoices = options.filter((option) => Number(option.availableQuantity || 0) > 0);
  const selectedByBatch = selection.reduce((map, allocation) => {
      const id = allocationId(allocation);
      map.set(id, (map.get(id) || 0) + Number(allocation.quantity));
      return map;
    }, new Map());
  const valid = proposal?.length > 0 && selectedTotal === quantity
    && selection.every((allocation) => allocationId(allocation) && Number.isSafeInteger(Number(allocation.quantity)) && Number(allocation.quantity) > 0)
    && [...selectedByBatch.entries()].every(([id, amount]) => Number(optionById.get(id)?.availableQuantity || 0) >= amount)
    && (!isOverride || Boolean(String(record?.reason || '').trim()));

  if (item?.loading) {
    return <article className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600" role="status">Checking batch availability for {item.name || item.sku || 'item'}…</article>;
  }

  if (item?.error) {
    return <article className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-800">
      <h4 className="font-semibold">{item.name || item.sku || 'Expiry-tracked item'}{item.sku ? ` · ${item.sku}` : ''}</h4>
      <p className="mt-1">{item.error}</p>
    </article>;
  }

  if (!item?.reconciled || !proposal) {
    return <article className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900">
      <h4 className="font-semibold">{item?.name || item?.sku || 'Expiry-tracked item'}{item?.sku ? ` · ${item.sku}` : ''}</h4>
      <p className="mt-1">{item?.reconciled ? 'Not enough eligible stock for this order.' : 'Batch verification needed. Verify batches in Inventory before picking this item.'}</p>
    </article>;
  }

  const setRows = (allocations) => updateRecord(item, record, onChange, { allocations });
  const setReason = (reason) => updateRecord(item, record, onChange, { reason });
  const verify = () => {
    if (!valid || disabled) return;
    onChange(item.productId, { ...createRecord(item, record), allocations: selection, confirmed: true });
  };

  return <article className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h4 className="break-words text-sm font-semibold text-slate-900">{item.name || 'Product'}{item.sku ? <span className="ml-1.5 text-xs font-medium text-slate-600">{item.sku}</span> : null}</h4><p className="mt-0.5 text-xs text-slate-600">Pick {quantity} {item.unit || 'unit(s)'}</p></div>
      {record?.confirmed && isExpiryBatchVerificationConfirmed(item, record) && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">Batch verified</span>}
    </div>
    <div className="mt-3 space-y-2">
      {selection.map((allocation, index) => {
        const selectedId = allocationId(allocation);
        const selectedOption = optionById.get(selectedId);
        const optionChoices = availableChoices.filter((option) => {
          const id = String(option.batch || option._id);
          return id === selectedId || !selection.some((other, otherIndex) => otherIndex !== index && allocationId(other) === id);
        });
        return <div key={`${item.productId}-pick-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_auto] items-end gap-2">
          <label className="min-w-0 text-xs font-medium text-slate-700">Batch to Pick
            <select name={validationKeyPrefix ? `${validationKeyPrefix}.batch.${index}` : undefined} data-validation-key={validationKeyPrefix ? `${validationKeyPrefix}.batch` : undefined} aria-label={`${item.name || item.sku} batch to pick ${index + 1}`} disabled={disabled} value={selectedId} onChange={(event) => {
              const next = optionById.get(event.target.value);
              if (!next) return;
              setRows(selection.map((row, rowIndex) => rowIndex === index ? { batch: next.batch || next._id, batchId: next.batchId, batchReference: next.batchReference, lotNumber: next.lotNumber || '', expiryDate: next.expiryDate, quantity: row.quantity } : row));
            }} className="mt-1 h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300/50">
              {optionChoices.map((option) => <option key={String(option.batch || option._id)} value={String(option.batch || option._id)}>{option.batchReference || 'Reference pending'} · Exp {option.expiryDate} · {option.availableQuantity} available</option>)}
            </select>
            {selectedOption && <span className="mt-0.5 block text-[11px] text-slate-500">Batch Reference: {selectedOption.batchReference || 'Reference pending'} · Expiry Date: {selectedOption.expiryDate}{selectedOption.lotNumber ? ` · Manufacturer Lot: ${selectedOption.lotNumber}` : ''}</span>}
          </label>
          <label className="text-xs font-medium text-slate-700">Quantity
            <input name={validationKeyPrefix ? `${validationKeyPrefix}.quantity.${index}` : undefined} data-validation-key={validationKeyPrefix ? `${validationKeyPrefix}.quantity` : undefined} aria-label={`${item.name || item.sku} pick quantity ${index + 1}`} disabled={disabled} type="number" min="1" step="1" value={allocation.quantity} onChange={(event) => setRows(selection.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value === '' ? '' : Number(event.target.value) } : row))} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-center text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300/50" />
          </label>
          {selection.length > 1 ? <button type="button" disabled={disabled} onClick={() => setRows(selection.filter((_, rowIndex) => rowIndex !== index))} className="mb-0.5 rounded-md px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50" aria-label={`Remove pick row ${index + 1}`}>Remove</button> : <span />}
        </div>;
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={selectedTotal === quantity ? 'text-slate-600' : 'font-medium text-rose-700'}>{selectedTotal} / {quantity} {item.unit || 'unit(s)'} assigned</span>
        {availableChoices.some((option) => !selection.some((row) => allocationId(row) === String(option.batch || option._id))) && <button type="button" disabled={disabled} onClick={() => {
          const next = availableChoices.find((option) => !selection.some((row) => allocationId(row) === String(option.batch || option._id)));
          if (!next) return;
          setRows([...selection, { batch: next.batch || next._id, batchId: next.batchId, batchReference: next.batchReference, lotNumber: next.lotNumber || '', expiryDate: next.expiryDate, quantity: 1 }]);
        }} className="rounded-md px-2 py-1 font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50">Add Batch</button>}
      </div>
      {isOverride && <label className="block text-xs font-medium text-slate-700">Reason for different batch <span className="text-rose-700">*</span>
        <textarea name={validationKeyPrefix ? `${validationKeyPrefix}.reason` : undefined} data-validation-key={validationKeyPrefix ? `${validationKeyPrefix}.reason` : undefined} disabled={disabled} rows={2} maxLength={500} value={record?.reason || ''} onChange={(event) => setReason(event.target.value)} placeholder="Explain why the physical batch differs..." className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300/50" />
      </label>}
      <button type="button" name={validationKeyPrefix ? `${validationKeyPrefix}.confirm` : undefined} data-validation-key={validationKeyPrefix ? `${validationKeyPrefix}.confirm` : undefined} disabled={disabled || !valid} onClick={verify} className="inline-flex min-h-9 items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{record?.confirmed ? 'Update Batch Confirmation' : 'Confirm Batch'}</button>
    </div>
  </article>;
};

export const ExpiryBatchVerificationModal = ({ items, records, onRecordChange, onBack, onContinue, busy = false, title = 'Verify Physical Batches' }) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('overflow-hidden');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('overflow-hidden');
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const allConfirmed = (items || []).every((item) => isExpiryBatchVerificationConfirmed(item, records?.[item.productId]));
  return <div className="app-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[2px] sm:p-4" role="dialog" aria-modal="true" aria-labelledby="expiry-batch-verification-title">
    <section onClick={(event) => event.stopPropagation()} className="flex max-h-[min(92dvh,52rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
        <h2 id="expiry-batch-verification-title" className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs text-slate-600">Check each physical batch before stock is finalized.</p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {(items || []).map((item) => <ExpiryBatchPickEditor key={item.productId} item={item} record={records?.[item.productId]} onChange={onRecordChange} disabled={busy} />)}
      </div>
      <footer className="flex flex-wrap justify-between gap-2 border-t border-slate-200 bg-white p-3 sm:px-4">
        <button type="button" onClick={onBack} disabled={busy} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50">Back</button>
        <button type="button" onClick={onContinue} disabled={busy || !allConfirmed} className="min-h-9 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Continue'}</button>
      </footer>
    </section>
  </div>;
};

export default ExpiryBatchPickEditor;
