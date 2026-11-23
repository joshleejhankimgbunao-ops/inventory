import React from 'react';

const CartRemovalConfirmation = ({
    title,
    items = [],
    cancelButtonRef,
    onCancel,
    onConfirm,
    onKeyDown,
    closeOnBackdrop = false,
    confirmDisabled = false,
    layerClassName = 'z-[70]',
}) => (
    <div
        className={`app-modal-backdrop fixed inset-0 ${layerClassName} flex items-center justify-center p-4`}
        onClick={(event) => {
            if (closeOnBackdrop && event.target === event.currentTarget) onCancel();
        }}
    >
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="pos-cart-removal-title"
            aria-describedby="pos-cart-removal-description"
            className="animate-in fade-in zoom-in duration-200 motion-reduce:animate-none max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={onKeyDown}
        >
            <div className="p-4">
                <h2 id="pos-cart-removal-title" className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
                <p id="pos-cart-removal-description" className="mt-1.5 text-xs leading-5 text-slate-500">
                    Review the products and quantities before removing them.
                </p>
                <ul aria-label="Products selected for removal" className="mt-3 divide-y divide-slate-200/70 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60" style={{ maxHeight: 'min(40vh, calc(100dvh - 12rem))' }}>
                    {items.map((item, index) => (
                        <li key={item.key || `${item.sku || 'cart-item'}-${index}`} className="flex min-w-0 items-start justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                                <p className="break-words text-xs font-semibold leading-4 text-slate-800">{item.name || 'Unnamed product'}</p>
                                {item.sku && <p className="mt-0.5 break-all text-[10px] leading-4 text-slate-500">SKU: {item.sku}</p>}
                                {item.variantDetails && <p className="mt-0.5 break-words text-[10px] leading-4 text-slate-500">{item.variantDetails}</p>}
                            </div>
                            <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                                Qty {item.quantity}{item.unit ? ` ${item.unit}` : ''}
                            </span>
                        </li>
                    ))}
                </ul>
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        ref={cancelButtonRef}
                        type="button"
                        onClick={onCancel}
                        className="inline-flex h-9 min-w-20 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        data-confirm-cart-removal
                        onClick={onConfirm}
                        disabled={confirmDisabled}
                        className="inline-flex h-9 min-w-20 items-center justify-center rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white transition-colors hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Remove
                    </button>
                </div>
            </div>
        </div>
    </div>
);

export default CartRemovalConfirmation;
