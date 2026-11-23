import React, { useEffect } from 'react';

/**
 * Shared visual frame for read-only product details. The POS version is the
 * reference design; keep its compact header, spacing, image-area proportions,
 * scroll region, and close treatment here so inventory surfaces stay aligned.
 */
const ProductDetailsModalShell = ({
  children,
  dialogRef,
  closeButtonRef,
  onClose,
  title = 'Product Details',
  subtitle = 'Reference information only',
  widthClassName = 'max-w-md',
  backdropZIndexClassName = 'z-50',
  ...dialogAttributes
}) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('overflow-hidden');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('overflow-hidden');
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className={`app-modal-backdrop fixed inset-0 ${backdropZIndexClassName} flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm`}
    >
      <div
        ref={dialogRef}
        className={`w-full ${widthClassName} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        role="dialog"
        aria-modal="true"
        {...dialogAttributes}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 id={dialogAttributes['aria-labelledby']} className="text-sm font-semibold text-slate-900">{title}</h3>
              <p className="text-[10px] text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            aria-label="Close product details"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[calc(100vh-4rem)] min-h-0 overflow-y-auto p-3">
          {children}
        </div>
      </div>
    </div>
  );
};

export default ProductDetailsModalShell;
