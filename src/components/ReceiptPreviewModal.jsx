import React from 'react';
import { formatCurrency } from '../utils/numberFormat';

const formatReceiptDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const hasSavedNumber = (value) => value !== null
  && value !== undefined
  && value !== ''
  && Number.isFinite(Number(value));

const ReceiptPreviewModal = ({
  transaction,
  settings = {},
  subtitle = 'Official record copy',
  isReprint = false,
  printStatus = 'idle',
  printLabel = 'Print Receipt',
  printedLabel = 'Printed',
  contentId = 'receipt-preview-content',
  onClose,
  onPrint,
}) => {
  if (!transaction) return null;

  const isCredit = String(transaction.paymentMethod || '').trim().toLowerCase() === 'credit';
  const isSpecialOrder = String(transaction.saleType || '').trim().toLowerCase() === 'special-order'
    || Boolean(transaction.specialOrderNumber);
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  const isPrinting = printStatus === 'printing';
  const isPrinted = printStatus === 'success';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-[58mm] flex-col overflow-hidden rounded-xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Receipt preview">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 p-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">{isCredit ? 'Credit Sales Receipt' : 'Cash Sales Receipt'}</h3>
            <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isPrinting} className="text-gray-400 hover:text-gray-600 disabled:opacity-50" aria-label="Close receipt preview">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white p-2" id={contentId}>
          <div className="mx-auto w-full max-w-[58mm] px-1 text-[9px] leading-tight">
            <div className="mb-3 text-center">
              <p className="mb-1 text-[14px] font-semibold leading-tight text-gray-900">{settings.storeName || 'Tableria La Confianza'}</p>
              <div className="mt-1 space-y-0.5 text-[9px] leading-tight text-gray-400">
                <p>{settings.storeAddress || 'Manila S Rd, Calamba, 4027 Laguna'}</p>
                <p>Contact: {settings.contactPhone || '0917-545-2166'}</p>
                {settings.contactPhoneSecondary && <p>{settings.contactPhoneSecondary}</p>}
              </div>
            </div>

            <div className="mb-2 border-t border-dashed border-gray-200 py-2">
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">Receipt No.:</span>
                <span className="break-all text-right font-mono font-semibold text-gray-800">{transaction.id}</span>
              </div>
              {isSpecialOrder && (
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Special Order:</span>
                  <span className="break-all text-right font-semibold text-amber-700">{transaction.specialOrderNumber || 'Special Order'}</span>
                </div>
              )}
              {transaction.orderReference && (
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Order Reference:</span>
                  <span className="break-all text-right font-mono font-semibold text-gray-800">{transaction.orderReference}</span>
                </div>
              )}
              {transaction.paymentReference && (
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Payment Reference:</span>
                  <span className="break-all text-right font-mono text-gray-800">{transaction.paymentReference}</span>
                </div>
              )}
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">Date:</span>
                <span className="text-right text-gray-800">{formatReceiptDate(transaction.date)}</span>
              </div>
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">Cashier:</span>
                <span className="text-right text-gray-800">{transaction.cashier || '-'}</span>
              </div>
              {transaction.customerName && (
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Customer:</span>
                  <span className="text-right text-gray-800">{transaction.customerName}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">Payment:</span>
                <span className="text-right text-gray-800">{transaction.paymentMethod || 'Cash'}</span>
              </div>
            </div>

            <table className="mb-3 w-full">
              <thead>
                <tr className="border-b-2 border-gray-100">
                  <th className="py-1 text-left text-[9px] font-semibold text-gray-700">Item</th>
                  <th className="py-1 text-center text-[9px] font-semibold text-gray-700">Qty</th>
                  <th className="py-1 text-right text-[9px] font-semibold text-gray-700">Amount</th>
                </tr>
              </thead>
              <tbody className="text-[9px] leading-tight text-gray-600">
                {items.map((item, index) => {
                  const quantity = Number(item.qty ?? item.quantity ?? 0) || 0;
                  const unitPrice = Number(item.price ?? item.unitPrice ?? 0) || 0;
                  const lineSubtotal = Number(item.subtotal ?? (unitPrice * quantity)) || 0;
                  return (
                    <tr key={`${item.id || item.code || 'receipt-item'}-${index}`} className="border-b border-gray-50">
                      <td className="py-1">
                        <div className="font-semibold leading-tight text-gray-800">{item.brand ? `${item.brand} ` : ''}{item.name || 'Item'}{item.color ? ` — ${item.color}` : ''}</div>
                        {item.code && <div className="text-[8px] leading-tight">{item.code}</div>}
                        <div className="text-[8px] leading-tight text-gray-400">{formatCurrency(unitPrice)} each</div>
                      </td>
                      <td className="py-1 text-center">{quantity}</td>
                      <td className="py-1 text-right">{formatCurrency(lineSubtotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="space-y-1 border-t border-gray-200 pt-2 text-right text-[9px] leading-tight">
              <div className="mt-1 flex justify-between border-t border-gray-900 pt-1 text-[13px] font-semibold text-gray-900">
                <span>TOTAL</span>
                <span>{formatCurrency(transaction.total)}</span>
              </div>
              {isCredit ? (
                <>
                  <div className="flex justify-between pt-1 text-[9px] font-semibold uppercase text-gray-600">
                    <span>Credit Status</span>
                    <span>{transaction.paymentStatus || 'Pending'}</span>
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-500">
                    <span>Due Date</span>
                    <span>{transaction.dueDate ? new Date(transaction.dueDate).toLocaleDateString() : '-'}</span>
                  </div>
                  {transaction.creditPaymentMode && (
                    <div className="flex justify-between text-[9px] text-gray-500">
                      <span>Payment Method</span>
                      <span>{transaction.creditPaymentMode}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.amountPaid) && (
                    <div className="flex justify-between text-[9px] text-gray-500">
                      <span>Amount Paid</span>
                      <span>{formatCurrency(transaction.amountPaid)}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.remainingBalance ?? transaction.balance) && (
                    <div className="flex justify-between text-[9px] text-gray-500">
                      <span>Remaining Balance</span>
                      <span>{formatCurrency(transaction.remainingBalance ?? transaction.balance)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {transaction.paymentStatus && (
                    <div className="flex justify-between pt-1 text-[9px] font-semibold uppercase text-gray-600">
                      <span>Payment Status</span>
                      <span>{transaction.paymentStatus}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.cash) && (
                    <div className="flex justify-between text-[9px] text-gray-600">
                      <span>Cash Received</span>
                      <span>{formatCurrency(transaction.cash)}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.change) && (
                    <div className="flex justify-between text-[9px] text-gray-500">
                      <span>Change</span>
                      <span>{formatCurrency(transaction.change)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-3 text-center text-[9px] leading-tight text-gray-400">
              <p>Thank you for your business.</p>
              <p>Please keep this receipt for returns and support.</p>
              {isReprint && <p className="mt-2 font-mono">** REPRINT **</p>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 bg-gray-50 p-2">
          <button type="button" onClick={onClose} disabled={isPrinting} className="flex items-center justify-center rounded-xl bg-white px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gray-600 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100 disabled:opacity-50">
            Close
          </button>
          <button type="button" onClick={onPrint} disabled={isPrinting} className={`flex items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white shadow-sm transition-all duration-300 ${isPrinting ? 'cursor-wait opacity-80' : 'hover:-translate-y-0.5 hover:opacity-90'}`} style={{ backgroundColor: isPrinted ? '#10B981' : '#111827', border: isPrinted ? '2px solid #10B981' : '2px solid #111827' }}>
            {isPrinting ? 'Printing...' : isPrinted ? printedLabel : printLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiptPreviewModal;
