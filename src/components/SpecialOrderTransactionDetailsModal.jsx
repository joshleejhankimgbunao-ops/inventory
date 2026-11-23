import React, { useEffect } from 'react';
import { formatCurrency } from '../utils/numberFormat';
import { getTransactionProductDisplayName, hasStoredProductName } from '../utils/productDisplayName';

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const formatPaymentMethod = (transaction) => {
  if (transaction?.collectionSource === 'special_order_ledger') return 'Recorded Special Order payments';
  const method = String(transaction?.paymentMethod || '').trim();
  if (!method) return '—';
  return method.toLowerCase() === 'gcash' ? 'GCash' : method.charAt(0).toUpperCase() + method.slice(1);
};

const Detail = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-slate-900">{children || '—'}</dd>
  </div>
);

const getPaymentBadgeStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['paid', 'fully paid'].includes(normalized)) return 'Completed';
  if (['partially paid', 'pending', 'unpaid'].includes(normalized)) return 'In Progress';
  return status;
};

const SpecialOrderTransactionDetailsModal = ({
  order,
  transaction,
  inventory = [],
  categories = [],
  onClose,
  onViewSupportingImage,
  imageLoading = false,
  imageError = '',
  statusBadgeClass,
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
  const items = Array.isArray(transaction?.items) ? transaction.items : [];
  const total = Number(transaction?.total || 0);
  const paymentStatus = String(transaction?.paymentStatus || '—');
  const badgeClass = statusBadgeClass?.(getPaymentBadgeStatus(paymentStatus)) || 'border-slate-200 bg-slate-100 text-slate-700';
  const transactionReference = transaction?.transactionReference || {};
  const supportingDocument = transactionReference.supportingDocument;
  const invoiceReference = String(transactionReference.referenceNumber || '').trim();
  const hasAdditionalInformation = Boolean(invoiceReference || supportingDocument);
  const vatNotCalculated = transaction?.vatCalculationStatus === 'not_calculated';
  const isCash = String(transaction?.paymentMethod || '').trim().toLowerCase() === 'cash';
  const isCredit = String(transaction?.paymentMethod || '').trim().toLowerCase() === 'credit';
  const cashReceived = Number(transaction?.cash ?? transaction?.cashTendered ?? total);
  const change = Number(transaction?.change ?? Math.max(0, cashReceived - total));
  const vatClassification = transaction?.taxTreatment === 'vat_zero_rated' ? 'VAT Zero-Rated' : 'VAT-Rated';

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="special-order-transaction-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 id="special-order-transaction-title" className="text-lg font-semibold tracking-tight text-slate-950">Transaction Details</h2>
            <p className="mt-0.5 break-all text-xs text-slate-500">Transaction ID: <span className="font-medium text-slate-700">{transaction?.id || '—'}</span></p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">Payment Status</span>
              <span className={`mt-0.5 inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>{paymentStatus}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close transaction details" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2">
              <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:space-y-4 sm:px-5 sm:py-4">
          <section aria-label="Transaction information" className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
            <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Special Order Reference">{order?.orderNumber || transaction?.specialOrderNumber}</Detail>
              <Detail label="Date & Time">{formatDateTime(transaction?.date)}</Detail>
              <Detail label="Customer">
                <span>{transaction?.customerName || order?.customerName || '—'}</span>
                {transaction?.customerDetails?.address && <span className="mt-0.5 block text-xs font-normal leading-5 text-slate-600">{transaction.customerDetails.address}</span>}
              </Detail>
              <Detail label="Recorded By">{transaction?.cashier}</Detail>
            </dl>
          </section>

          <section aria-label="Ordered items" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3.5 py-2.5 sm:px-4">
              <h3 className="text-sm font-semibold text-slate-900">Ordered Items</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] table-fixed border-collapse">
                <colgroup><col className="w-[52%]" /><col className="w-[14%]" /><col className="w-[17%]" /><col className="w-[17%]" /></colgroup>
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 text-left text-xs font-semibold sm:px-4">Item</th>
                    <th scope="col" className="px-2 py-2.5 text-center text-xs font-semibold">Quantity</th>
                    <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold">Unit Price</th>
                    <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold sm:px-4">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                  {items.length > 0 ? items.map((item, index) => {
                    const quantity = Number(item?.qty ?? item?.quantity ?? 0) || 0;
                    const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
                    const amount = item?.subtotal === null || item?.subtotal === undefined ? null : Number(item.subtotal);
                    const name = `${item?.brand && hasStoredProductName(item) ? `${item.brand} ` : ''}${getTransactionProductDisplayName(item, inventory, categories)}${item?.color && hasStoredProductName(item) ? ` · ${item.color}` : ''}`;
                    return (
                      <tr key={`${item?.id || item?.code || 'special-order-item'}-${index}`}>
                        <td className="px-3 py-3 align-top sm:px-4">
                          <p className="break-words font-semibold leading-5 text-slate-950">{name}</p>
                          {item?.code && <p className="mt-0.5 break-all text-xs text-slate-500">{item.code}</p>}
                          {item?.description && <p className="mt-1 break-words text-xs leading-5 text-slate-600">{item.description}</p>}
                        </td>
                        <td className="px-2 py-3 text-center align-top tabular-nums">{quantity}{(item?.sellingUnit || item?.unit) && <span className="ml-1 text-xs text-slate-500">{item.sellingUnit || item.unit}</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right align-top tabular-nums">{formatCurrency(unitPrice)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right align-top font-medium tabular-nums sm:px-4">{amount === null || !Number.isFinite(amount) ? '—' : formatCurrency(amount)}</td>
                      </tr>
                    );
                  }) : <tr><td colSpan="4" className="px-4 py-8 text-center text-sm text-slate-500">No item details recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Payment and totals" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.75fr)] md:gap-5">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Payment &amp; Totals</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">Payment Method</dt><dd className="mt-0.5 break-words font-medium text-slate-800">{formatPaymentMethod(transaction)}</dd></div>
                {vatNotCalculated && <div><dt className="text-xs text-slate-500">VAT Classification</dt><dd className="mt-0.5 font-medium text-slate-800">{vatClassification}</dd></div>}
                <div><dt className="text-xs text-slate-500">Net Amount</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{vatNotCalculated ? 'Not calculated' : formatCurrency(Number(transaction?.netAmount ?? total))}</dd></div>
                <div><dt className="text-xs text-slate-500">VAT</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{vatNotCalculated ? 'Not calculated' : formatCurrency(Number(transaction?.vatAmount || 0))}</dd></div>
                {isCash && <>
                  <div><dt className="text-xs text-slate-500">Cash Received</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(cashReceived)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Change</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(change)}</dd></div>
                </>}
                {isCredit && <>
                  <div><dt className="text-xs text-slate-500">Down Payment Method</dt><dd className="mt-0.5 font-medium text-slate-800">{transaction?.creditPaymentMode || '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Down Payment</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(Number(transaction?.downPaymentAmount ?? transaction?.amountPaid ?? 0))}</dd></div>
                  <div><dt className="text-xs text-slate-500">Remaining Balance</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(Number(transaction?.remainingBalance ?? total))}</dd></div>
                </>}
              </dl>
            </div>
            <div className="flex flex-col justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 md:items-end md:text-right">
              <span className="text-xs font-medium text-slate-500">Recorded Transaction Total</span>
              <span className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{formatCurrency(total)}</span>
            </div>
          </section>

          {hasAdditionalInformation && <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer select-none px-3.5 py-3 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-600 sm:px-4">Additional Information</summary>
            <div className="border-t border-slate-200 px-3.5 py-3 sm:px-4">
              {invoiceReference && <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2"><Detail label="Invoice Reference">{invoiceReference}</Detail></dl>}
              {supportingDocument && <div className={`${invoiceReference ? 'mt-3 border-t border-slate-200 pt-3' : ''} flex flex-wrap items-center gap-2 text-sm text-slate-700`}>
                <span className="shrink-0 text-xs font-semibold text-slate-700">Supporting Document</span>
                <span className="min-w-0 break-all">{supportingDocument.originalName || 'Uploaded document'}</span>
                {onViewSupportingImage && <button type="button" onClick={onViewSupportingImage} disabled={imageLoading} className="inline-flex min-h-8 shrink-0 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 disabled:cursor-not-allowed disabled:opacity-50">{imageLoading ? 'Loading…' : 'View Image'}</button>}
                {imageError && <p role="alert" className="basis-full text-xs text-rose-700">{imageError}</p>}
              </div>}
            </div>
          </details>}
        </div>

      </section>
    </div>
  );
};

export default SpecialOrderTransactionDetailsModal;
