import React, { useEffect, useState } from 'react';
import { addQuotationItem, editQuotationItem, removeQuotationItem, quotationDraftSummary } from '../utils/specialOrderQuotation';
import { sanitizeMoneyInput, sanitizeWholeNumberInput } from '../utils/numericInput';
import { formatCurrency } from '../utils/numberFormat';
import { FulfillmentFields, InventorySkuPicker } from './SpecialOrderPhaseOneFields';
import ProductPhotoUploadArea from './ProductPhotoUploadArea';
import { inventoryItemFromProduct } from '../utils/specialOrderPhaseOne';
import { validateLagunaDeliveryLocation } from '../utils/lagunaLocation';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-60';
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors enabled:hover:border-slate-400 enabled:hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = 'rounded-lg border-2 border-gray-900 bg-gray-900 px-3 py-2 text-xs font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';
const destructiveButtonClass = 'rounded-lg border border-rose-700 bg-rose-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const subtleSecondaryButtonClass = 'rounded-md px-1.5 py-1 text-[10px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50';

const ItemPhoto = ({ image, itemId, onGetImage }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (image.sourceUrl) return undefined;
    let active = true; let url = '';
    Promise.resolve(onGetImage?.(itemId, image.key)).then((blob) => { if (active && blob) { url = URL.createObjectURL(blob); setSrc(url); } }).catch(() => { if (active) setSrc(''); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [image.key, image.sourceUrl, itemId, onGetImage]);
  const imageSrc = image.sourceUrl || src;
  return imageSrc ? <img src={imageSrc} alt={image.originalName || 'Product photo'} className="h-14 w-14 rounded-md border border-slate-200 bg-slate-50 object-contain" /> : <div className="flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-[9px] text-slate-400">Photo</div>;
};

const SpecialOrderQuotationEditor = ({ quotation, draft, onChange, onClose, onSave, onUploadImages, onReplaceImage, onRemoveImage, onGetImage, inventory = [], userRole, phaseOne = false, busy, error }) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('overflow-hidden');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('overflow-hidden');
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const summary = quotationDraftSummary(draft);
  const missingPhoto = draft.items.find((item) => !(item.images || []).length);
  const fulfillmentLocationError = draft.fulfillment?.method === 'Free Delivery' ? validateLagunaDeliveryLocation(draft.fulfillment) : '';
  const phaseOneValid = !phaseOne || (['Store Pickup', 'Free Delivery'].includes(draft.fulfillment?.method)
    && ['standard', 'vat_zero_rated'].includes(draft.taxTreatment)
    && !fulfillmentLocationError
    && draft.items.every((item) => item.itemType !== 'inventory'
      || Boolean(item.inventoryProduct && item.sku && (Number(item.unitPrice) === Number(item.originalUnitPrice ?? item.inventorySnapshot?.originalUnitPrice) || (String(item.priceOverrideReason || '').trim() && (['admin', 'superadmin'].includes(userRole) || item.priceOverrideBy))))));
  const canGenerate = summary.valid && phaseOneValid && Boolean(draft.quotationDetails.authorizedSignatoryName.trim()) && !missingPhoto;
  const replaceItem = (index, value) => onChange({ ...draft, items: draft.items.map((item, current) => current === index ? value : item) });
  return (
    <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quotation-editor-title">
      <form onSubmit={(event) => { event.preventDefault(); onSave(false); }} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div><h2 id="quotation-editor-title" className="text-base font-semibold text-slate-900">Prepare Quotation</h2><p className="mt-1 text-xs text-slate-600">{quotation.quotationNumber} · {quotation.customerName} · Draft</p></div>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass} aria-label="Close quotation editor">Close</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100/70">
        <fieldset disabled={busy} className="space-y-3 p-4 sm:space-y-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[['attentionName', 'ATTN', 'Recipient name (optional)'], ['attentionPosition', 'Position', 'Recipient position (optional)'], ['authorizedSignatoryName', 'Authorized Signatory Name', 'Enter authorized signatory name']].map(([field, label, placeholder]) => (
              <label key={field} className="text-sm font-medium text-slate-700">{label}<input value={draft.quotationDetails[field]} maxLength={150} onChange={(event) => onChange({ ...draft, quotationDetails: { ...draft.quotationDetails, [field]: event.target.value } })} className={`${inputClass} mt-1`} placeholder={placeholder} /></label>
            ))}
          </div>
          {phaseOne && <label className="block max-w-xs text-sm font-medium text-slate-700">VAT Classification
            <select value={draft.taxTreatment || ''} onChange={(event) => onChange({ ...draft, taxTreatment: event.target.value })} className={`${inputClass} mt-1`} required>
              <option value="">Select classification</option><option value="standard">VAT-Rated</option><option value="vat_zero_rated">VAT Zero-Rated</option>
            </select><span className="mt-1 block text-xs font-normal text-slate-600">Agreed prices stay unchanged. VAT amount is not calculated.</span>
          </label>}
          {phaseOne && <div className="rounded-xl border border-slate-300 bg-white p-3 sm:p-4"><h3 className="mb-2 text-sm font-semibold text-slate-800">Pickup or Delivery</h3><FulfillmentFields value={draft.fulfillment} onChange={(fulfillment) => onChange({ ...draft, fulfillment })} /></div>}
          {draft.items.map((item, index) => (
            <section key={index} className="space-y-3 rounded-xl border border-slate-300 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">Item {index + 1}</span><button type="button" onClick={() => onChange(removeQuotationItem(draft, index))} className={destructiveButtonClass} aria-label={`Remove quotation item ${index + 1}`}>Remove Item</button></div>
              {phaseOne && <><div className="flex gap-2" role="group" aria-label={`Item ${index + 1} source`}>{[['custom', 'Custom Product'], ['inventory', 'Existing Product']].map(([type, label]) => <button key={type} type="button" onClick={() => { if (item.itemType !== type) replaceItem(index, { itemId: item.itemId, itemType: type, itemName: '', description: '', quantity: item.quantity, sellingUnit: '', unitPrice: '', images: [], imageKeys: [] }); }} aria-pressed={item.itemType === type} className={`${buttonClass} ${item.itemType === type ? 'border-slate-900 bg-slate-900 text-white' : ''}`}>{label}</button>)}</div>
                {item.itemType === 'inventory' && <InventorySkuPicker products={inventory} selectedSku={item.sku || item.inventorySnapshot?.sku || ''} onSelect={(product) => replaceItem(index, { ...item, ...inventoryItemFromProduct(product), images: product.id === String(item.inventoryProduct || '') ? item.images : [], imageKeys: product.id === String(item.inventoryProduct || '') ? item.imageKeys : [] })} />}</>}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-slate-700">Product / Item Name<input value={item.itemName} required readOnly={phaseOne && item.itemType === 'inventory'} onChange={(event) => onChange(editQuotationItem(draft, index, 'itemName', event.target.value))} className={`${inputClass} mt-1`} /></label>
                <label className="text-sm text-slate-700">Specifications / Description<input value={item.description || ''} onChange={(event) => onChange(editQuotationItem(draft, index, 'description', event.target.value))} className={`${inputClass} mt-1`} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="text-sm text-slate-700">Quantity<input value={item.quantity} required inputMode="numeric" onChange={(event) => onChange(editQuotationItem(draft, index, 'quantity', sanitizeWholeNumberInput(event.target.value)))} className={`${inputClass} mt-1`} /></label>
                <label className="text-sm text-slate-700">Selling Unit <span className="text-rose-700">*</span><input value={item.sellingUnit || ''} required readOnly={phaseOne && item.itemType === 'inventory'} onChange={(event) => onChange(editQuotationItem(draft, index, 'sellingUnit', event.target.value))} className={`${inputClass} mt-1`} placeholder={phaseOne && item.itemType === 'custom' ? 'e.g. box or roll' : 'Selling unit'} /></label>
                {phaseOne && item.itemType === 'custom' && <label className="text-sm text-slate-700">Expiry Date (Optional)<input type="date" value={item.expiryDate || ''} onChange={(event) => onChange(editQuotationItem(draft, index, 'expiryDate', event.target.value))} className={`${inputClass} mt-1`} /></label>}
                <label className="text-sm text-slate-700">Unit Price (₱)<input value={item.unitPrice} required inputMode="decimal" readOnly={phaseOne && item.itemType === 'inventory' && !['admin', 'superadmin'].includes(userRole)} onChange={(event) => onChange(editQuotationItem(draft, index, 'unitPrice', sanitizeMoneyInput(event.target.value)))} className={`${inputClass} mt-1`} />{phaseOne && item.itemType === 'inventory' && item.sku && <span className="mt-1 block text-xs text-slate-600">Inventory price: {formatCurrency(item.originalUnitPrice ?? item.inventorySnapshot?.originalUnitPrice)}</span>}</label>
                <div className="text-sm text-slate-700">Line Amount<p className="mt-2 font-semibold tabular-nums text-slate-900">{summary.lines[index] === null ? 'Enter valid values' : formatCurrency(summary.lines[index])}</p></div>
              </div>
              {phaseOne && item.itemType === 'inventory' && item.sku && Number(item.unitPrice) !== Number(item.originalUnitPrice ?? item.inventorySnapshot?.originalUnitPrice) && <label className="block text-sm text-slate-700">Price adjustment reason<input value={item.priceOverrideReason || ''} readOnly={!['admin', 'superadmin'].includes(userRole)} onChange={(event) => onChange(editQuotationItem(draft, index, 'priceOverrideReason', event.target.value))} className={`${inputClass} mt-1`} placeholder="Required for an adjusted inventory price" /></label>}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-sm font-medium text-slate-700">Product photos ({(item.images || []).length} of 3)</span>
                  {(item.images || []).map((image, imageIndex) => <div key={image.key} className="flex min-w-0 items-start gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5">
                  <div className="relative shrink-0">
                    <ItemPhoto image={image} itemId={item.itemId} onGetImage={onGetImage} />
                    <button type="button" disabled={busy} onClick={() => onRemoveImage(item.itemId, image.key)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remove ${image.originalName || `product photo ${imageIndex + 1}`}`} title="Remove photo">
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3 w-3"><path d="m5 5 10 10M15 5 5 15" /></svg>
                    </button>
                  </div>
                  <div className="flex flex-col items-start gap-0.5"><button type="button" disabled={busy || imageIndex === 0} onClick={() => onChange({ ...draft, items: draft.items.map((entry, entryIndex) => entryIndex === index ? { ...entry, images: [image, ...(item.images || []).filter((photo) => photo.key !== image.key)], imageKeys: [image.key, ...(item.images || []).filter((photo) => photo.key !== image.key).map((photo) => photo.key)] } : entry) })} className={`${subtleSecondaryButtonClass} disabled:no-underline`}>Primary</button>
                    {imageIndex > 1 && <button type="button" disabled={busy} onClick={() => onChange({ ...draft, items: draft.items.map((entry, entryIndex) => {
                      if (entryIndex !== index) return entry;
                      const images = [...entry.images];
                      [images[imageIndex - 1], images[imageIndex]] = [images[imageIndex], images[imageIndex - 1]];
                      return { ...entry, images, imageKeys: images.map((photo) => photo.key) };
                    }) })} className={subtleSecondaryButtonClass}>Earlier</button>}
                    <label className={`${subtleSecondaryButtonClass} cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-slate-400`}>Replace<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onReplaceImage(item.itemId, image.key, file); event.target.value = ''; }} /></label></div>
                  </div>)}
                </div>
                {(item.images || []).length < 3 && <ProductPhotoUploadArea disabled={busy} onFilesSelected={(files) => onUploadImages(item.itemId, files)} />}
                {missingPhoto?.itemId === item.itemId && <span className="block text-xs text-rose-600">At least one photo is required before generating.</span>}
              </div>
            </section>
          ))}
          <button type="button" onClick={() => onChange(addQuotationItem(draft))} disabled={busy} className={primaryButtonClass}>Add Product / Custom Item</button>
          <p className="text-right text-base font-semibold text-slate-900">Total: {formatCurrency(summary.total)}</p>
          {!draft.items.length && <p className="text-sm text-rose-700">Add at least one item to save this draft.</p>}
          {!canGenerate && missingPhoto && <p className="text-sm text-rose-700">Add at least one product photo to every item before generating the quotation.</p>}
          {phaseOne && !phaseOneValid && <p role="alert" className="text-sm text-rose-700">{fulfillmentLocationError || 'Select pickup or delivery and complete the required quotation details.'}</p>}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </fieldset>
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass}>Cancel</button>
          <button type="submit" disabled={busy || !summary.valid} className={primaryButtonClass}>Save Draft</button>
          <button type="button" onClick={() => onSave(true)} disabled={busy || !canGenerate} className={primaryButtonClass}>{busy ? 'Saving…' : 'Generate Quotation'}</button>
        </footer>
      </form>
    </div>
  );
};
export default SpecialOrderQuotationEditor;
