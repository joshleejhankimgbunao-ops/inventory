import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findLagunaLocality, normalizeLocationName, validateLagunaDeliveryLocation, LAGUNA_LOCALITIES } from '../utils/lagunaLocation';
import { getProductDisplayName, hasStoredProductName } from '../utils/productDisplayName';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60';

export const InventorySkuPicker = ({ products = [], categories = [], selectedSku = '', onSelect, disabled, inputRef, name, validationKey, error, errorId }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selectedProduct = products.find((product) => String(product.code || '') === String(selectedSku || ''));
  const selectedProductName = selectedProduct ? getProductDisplayName(selectedProduct, categories) : '';
  const choices = useMemo(() => products.filter((product) => product.isActive !== false && [product.code, getProductDisplayName(product, categories), product.brand, product.size, product.color]
    .some((value) => String(value || '').toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))).slice(0, 30), [categories, products, query]);
  return <div className="relative">
    <input ref={inputRef} type="search" name={name} data-validation-key={validationKey} value={open ? query : selectedProduct ? `${selectedProduct.code} — ${selectedProductName}` : selectedSku || query} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => { if (!open) { setQuery(''); setOpen(true); } }} onClick={() => { if (!open) { setQuery(''); setOpen(true); } }} onBlur={() => setOpen(false)} disabled={disabled} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} className={inputClass} placeholder="Search name or exact SKU" aria-label="Search inventory SKU" role="combobox" aria-expanded={open} aria-controls="special-order-inventory-skus" />
    {open && <div id="special-order-inventory-skus" role="listbox" className="absolute z-40 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg">
      {choices.length ? choices.map((product) => <button key={product.id} type="button" role="option" aria-selected={product.code === selectedSku} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(product); setQuery(''); setOpen(false); }} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 focus-visible:bg-slate-100">
        <span className="font-semibold">{product.code}</span> · {getProductDisplayName(product, categories)} {hasStoredProductName(product) ? [product.brand, product.color, product.size].filter(Boolean).join(' · ') : ''} · {product.sellingUnit || 'No saved unit'} · ₱{Number(product.price).toFixed(2)}
      </button>) : <p className="px-3 py-2 text-xs text-slate-500">No active SKU matches.</p>}
    </div>}
  </div>;
};

const SearchableLocationDropdown = ({ id, label, value = '', options = [], placeholder, disabled = false, onChange, clearLabel, error, errorId }) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const filteredOptions = useMemo(() => {
    const search = normalizeLocationName(query);
    return options.filter((option) => !search || normalizeLocationName(option.name).includes(search));
  }, [options, query]);

  const updateMenuPosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect || !window.innerWidth || !window.innerHeight) return;
    const width = Math.min(rect.width, Math.max(0, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const desiredHeight = 240;
    const below = Math.max(0, window.innerHeight - rect.bottom - 8);
    const above = Math.max(0, rect.top - 8);
    const placeAbove = below < Math.min(120, desiredHeight) && above > below;
    const available = Math.max(40, Math.min(240, placeAbove ? above : below));
    const height = Math.min(desiredHeight, available);
    const top = placeAbove
      ? Math.max(8, rect.top - height - 4)
      : Math.min(window.innerHeight - height - 8, rect.bottom + 4);
    setMenuPosition((previous) => {
      if (previous && previous.left === left && previous.top === top && previous.width === width && previous.maxHeight === available) return previous;
      return { left, top, width, maxHeight: available };
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || disabled) return undefined;
    window.addEventListener('resize', updateMenuPosition);
    document.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      document.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [disabled, open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsidePointer = (event) => {
      if (containerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, id, open]);

  const chooseOption = (option) => {
    onChange(option.name);
    setQuery(option.name);
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery(value || '');
        setActiveIndex(filteredOptions.length ? 0 : -1);
        updateMenuPosition();
      } else {
        setActiveIndex((index) => filteredOptions.length ? (index + 1 + filteredOptions.length) % filteredOptions.length : -1);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setQuery(value || '');
        setActiveIndex(filteredOptions.length - 1);
        updateMenuPosition();
      } else {
        setActiveIndex((index) => filteredOptions.length ? (index <= 0 ? filteredOptions.length - 1 : index - 1) : -1);
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (filteredOptions[activeIndex]) chooseOption(filteredOptions[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const optionsMenu = open && menuPosition && typeof document !== 'undefined' ? createPortal(
    <div ref={menuRef} id={`${id}-options`} role="listbox" aria-label={`${label} options`} className="overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 shadow-lg" style={{ position: 'fixed', left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, maxHeight: menuPosition.maxHeight, zIndex: 100 }}>
      {filteredOptions.length ? filteredOptions.map((option, index) => (
        <button key={option.code} id={`${id}-option-${index}`} type="button" role="option" aria-selected={value === option.name} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseOption(option)} className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-800 last:border-b-0 ${activeIndex === index ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
          {option.name}
        </button>
      )) : <p role="status" className="px-3 py-2 text-xs text-slate-500">No matching locations.</p>}
    </div>,
    document.body,
  ) : null;
  const activeOptionIndex = activeIndex >= 0 && activeIndex < filteredOptions.length ? activeIndex : -1;

  return <div ref={containerRef} className="min-w-0">
    <label htmlFor={id} className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</label>
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        name={id}
        data-validation-key={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={open && activeOptionIndex >= 0 ? `${id}-option-${activeOptionIndex}` : undefined}
        aria-label={label}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId : undefined}
        value={open ? query : value || ''}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={(event) => { setQuery(value || ''); setActiveIndex(0); setOpen(true); updateMenuPosition(); event.currentTarget.select(); }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next && (containerRef.current?.contains(next) || menuRef.current?.contains(next))) return;
          setOpen(false);
        }}
        onChange={(event) => { const next = event.target.value; setQuery(next); setActiveIndex(0); onChange(''); setOpen(true); }}
        onKeyDown={handleKeyDown}
        className={`${inputClass} ${value ? 'pr-9' : ''}`}
      />
      {value && <button type="button" disabled={disabled} aria-label={clearLabel} onClick={() => { onChange(''); setQuery(''); setActiveIndex(0); setOpen(false); }} className="absolute inset-y-0 right-1 flex w-7 items-center justify-center rounded-md text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed">×</button>}
    </div>
    {optionsMenu}
  </div>;
};

export const FulfillmentFields = ({ value = {}, onChange, disabled, error }) => {
  const change = (field, next) => onChange({ ...value, [field]: next, ...(value.method === 'Free Delivery' ? { province: 'Laguna' } : {}) });
  const locality = findLagunaLocality(value.cityMunicipality || '');
  const deliveryLocationError = value.method === 'Free Delivery' ? validateLagunaDeliveryLocation(value) : '';
  const displayedError = error || deliveryLocationError;
  const cityError = Boolean(displayedError && /city|municipality/i.test(displayedError));
  const barangayError = Boolean(displayedError && /barangay/i.test(displayedError));
  const methodError = Boolean(error && !deliveryLocationError);
  return <fieldset disabled={disabled} className="space-y-3">
    <select name="fulfillment" data-validation-key="fulfillment" aria-invalid={methodError || undefined} aria-describedby={methodError ? 'fulfillment-error' : undefined} aria-label="Pickup or Delivery" required value={value.method || ''} onChange={(event) => onChange({ ...value, method: event.target.value, ...(event.target.value === 'Store Pickup' ? { addressLine: '', barangay: '', cityMunicipality: '', province: '' } : event.target.value === 'Free Delivery' ? { province: 'Laguna' } : {}) })} className={inputClass}>
      <option value="">Select an option</option><option value="Store Pickup">Store Pickup</option><option value="Free Delivery">Free Delivery within Laguna</option>
    </select>
    {value.method === 'Free Delivery' && <div className="space-y-2.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0"><span className="mb-1 block text-[11px] font-semibold text-slate-600">Province</span><input value="Laguna" readOnly className={`${inputClass} read-only:bg-slate-50 read-only:text-slate-600`} /></label>
        <SearchableLocationDropdown id="delivery-city-municipality" label="City / Municipality" value={value.cityMunicipality || ''} options={LAGUNA_LOCALITIES} placeholder="Select city or municipality" disabled={disabled} error={cityError} errorId="fulfillment-error" clearLabel="Clear city or municipality" onChange={(cityMunicipality) => onChange({ ...value, cityMunicipality, barangay: '', province: 'Laguna' })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchableLocationDropdown id="delivery-barangay" label="Barangay" value={value.barangay || ''} options={locality?.barangays || []} placeholder="Select barangay" disabled={disabled || !locality} error={barangayError} errorId="fulfillment-error" clearLabel="Clear barangay" onChange={(barangay) => change('barangay', barangay)} />
        <label className="min-w-0"><span className="mb-1 block text-[11px] font-semibold text-slate-600">Street / Building / House No.</span><input value={value.addressLine || ''} onChange={(event) => change('addressLine', event.target.value)} className={inputClass} placeholder="Enter house no., street, or building" maxLength={200} /></label>
      </div>
      <p className="text-[11px] leading-4 text-slate-500">Delivery details can be provided later.</p>
    </div>}
    {value.method && <label className="block"><span className="mb-1 block text-[11px] font-semibold text-slate-600">Preferred {value.method === 'Store Pickup' ? 'pickup' : 'delivery'} date</span><input type="date" value={value.preferredDate || ''} onChange={(event) => change('preferredDate', event.target.value)} className={inputClass} /></label>}
    {displayedError && <p id="fulfillment-error" role="alert" className="text-sm text-rose-700">{displayedError}</p>}
  </fieldset>;
};
