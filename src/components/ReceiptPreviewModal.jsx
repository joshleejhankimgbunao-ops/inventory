import React from 'react';
import { formatCurrency } from '../utils/numberFormat';
import { isVoidedOrderConfirmation } from '../utils/saleVoid';
import { ORDER_CONFIRMATION_PREVIEW_SIZE } from '../constants/orderConfirmationPreview';

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
  isOrderConfirmation = false,
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
  const isVoidedConfirmation = isVoidedOrderConfirmation(transaction, isOrderConfirmation);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className={`flex ${isOrderConfirmation ? ORDER_CONFIRMATION_PREVIEW_SIZE.modal : 'max-h-[90vh] w-full max-w-[58mm]'} flex-col overflow-hidden ${isOrderConfirmation ? 'rounded-2xl' : 'rounded-xl'} bg-white shadow-2xl`} role="dialog" aria-modal="true" aria-label={isOrderConfirmation ? 'Order Confirmation preview' : 'Receipt preview'}>
        <div className={`flex items-center justify-between border-b border-gray-100 bg-gray-50 ${isOrderConfirmation ? 'px-4 py-3.5 sm:px-5 sm:py-4' : 'p-3'}`}>
          <div>
            <h3 className={`${isOrderConfirmation ? 'text-xl sm:text-2xl' : 'text-lg'} font-semibold text-gray-800`}>{isOrderConfirmation ? 'Order Confirmation' : isCredit ? 'Credit Sales Receipt' : 'Cash Sales Receipt'}</h3>
            <p className={`${isOrderConfirmation ? 'mt-1 text-xs' : 'mt-0.5 text-[11px]'} text-gray-500`}>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isPrinting} className={`${isOrderConfirmation ? 'rounded-lg p-1 transition-colors hover:bg-gray-100' : ''} text-gray-400 hover:text-gray-600 disabled:opacity-50`} aria-label={isOrderConfirmation ? 'Close Order Confirmation preview' : 'Close receipt preview'}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className={`flex-1 overflow-y-auto bg-white ${isOrderConfirmation ? 'px-4 py-4 sm:px-6 sm:py-5' : 'p-2'}`} id={contentId}>
          <div className={`${isOrderConfirmation ? `${ORDER_CONFIRMATION_PREVIEW_SIZE.content} text-xs leading-relaxed text-gray-600 sm:text-[13px]` : 'mx-auto w-full max-w-[58mm] text-[9px] leading-tight'} px-1`}>
            <div className={`${isOrderConfirmation ? 'mb-5' : 'mb-3'} text-center`}>
              <p className={`mb-1 ${isOrderConfirmation ? 'text-lg' : 'text-[14px]'} font-semibold leading-tight text-gray-900`}>{settings.storeName || 'Tableria La Confianza'}</p>
              <div className={`${isOrderConfirmation ? 'mt-1.5 text-[11px] leading-relaxed sm:text-xs' : 'mt-1 text-[9px] leading-tight'} space-y-0.5 text-gray-400`}>
                <p>{settings.storeAddress || 'Manila S Rd, Calamba, 4027 Laguna'}</p>
                <p>Contact: {settings.contactPhone || '0917-545-2166'}</p>
                {settings.contactPhoneSecondary && <p>{settings.contactPhoneSecondary}</p>}
              </div>
            </div>

            {isVoidedConfirmation && (
              <div className="mb-2 border-y border-rose-200 bg-rose-50 py-1.5 text-center text-[11px] font-bold tracking-[0.18em] text-rose-700">
                VOIDED
              </div>
            )}

            <div className={`${isOrderConfirmation ? 'mb-4 border-y py-3' : 'mb-2 border-t py-2'} border-dashed border-gray-200`}>
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">{isOrderConfirmation ? 'Transaction ID:' : 'Receipt No.:'}</span>
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
              {transaction.transactionReference?.referenceNumber && (
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Transaction Reference:</span>
                  <span className="break-all text-right text-gray-800">{transaction.transactionReference.referenceNumber}</span>
                </div>
              )}
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">{isOrderConfirmation ? 'Date & Time:' : 'Date:'}</span>
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
                <span className="shrink-0 text-gray-500">{isOrderConfirmation ? 'Payment Type:' : 'Payment:'}</span>
                <span className="text-right text-gray-800">{transaction.paymentMethod || 'Cash'}</span>
              </div>
            </div>

            <table className={`${isOrderConfirmation ? 'mb-4' : 'mb-3'} w-full`}>
              <thead>
                <tr className="border-b-2 border-gray-100">
                  <th className={`${isOrderConfirmation ? 'py-1.5 text-xs' : 'py-1 text-[9px]'} text-left font-semibold text-gray-700`}>Item</th>
                  <th className={`${isOrderConfirmation ? 'py-1.5 text-xs' : 'py-1 text-[9px]'} text-center font-semibold text-gray-700`}>Qty</th>
                  <th className={`${isOrderConfirmation ? 'py-1.5 text-xs' : 'py-1 text-[9px]'} text-right font-semibold text-gray-700`}>Amount</th>
                </tr>
              </thead>
              <tbody className={`${isOrderConfirmation ? 'text-xs leading-relaxed sm:text-[13px]' : 'text-[9px] leading-tight'} text-gray-600`}>
                {items.map((item, index) => {
                  const quantity = Number(item.qty ?? item.quantity ?? 0) || 0;
                  const unitPrice = Number(item.price ?? item.unitPrice ?? 0) || 0;
                  const lineSubtotal = Number(item.subtotal ?? (unitPrice * quantity)) || 0;
                  return (
                    <tr key={`${item.id || item.code || 'receipt-item'}-${index}`} className="border-b border-gray-50">
                      <td className={isOrderConfirmation ? 'py-2 pr-2' : 'py-1'}>
                        <div className="font-semibold leading-tight text-gray-800">{item.brand ? `${item.brand} ` : ''}{item.name || 'Item'}{item.color ? ` — ${item.color}` : ''}</div>
                        {item.code && <div className={`${isOrderConfirmation ? 'text-[11px] text-gray-500' : 'text-[8px]'} leading-tight`}>{item.code}</div>}
                        <div className={`${isOrderConfirmation ? 'text-[11px]' : 'text-[8px]'} leading-tight text-gray-400`}>{formatCurrency(unitPrice)} each</div>
                      </td>
                      <td className={`${isOrderConfirmation ? 'py-2' : 'py-1'} text-center`}>{quantity}</td>
                      <td className={`${isOrderConfirmation ? 'py-2 font-medium' : 'py-1'} text-right`}>{formatCurrency(lineSubtotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className={`${isOrderConfirmation ? 'space-y-1.5 pt-3 text-xs leading-relaxed sm:text-[13px]' : 'space-y-1 pt-2 text-[9px] leading-tight'} border-t border-gray-200 text-right`}>
              {isOrderConfirmation && hasSavedNumber(transaction.netAmount) && (
                <div className="flex justify-between text-gray-600"><span>Net Amount</span><span>{formatCurrency(transaction.netAmount)}</span></div>
              )}
              {isOrderConfirmation && hasSavedNumber(transaction.vatAmount) && (
                <div className="flex justify-between text-gray-600"><span>VAT</span><span>{formatCurrency(transaction.vatAmount)}</span></div>
              )}
              <div className={`${isOrderConfirmation ? 'mt-2 pt-2 text-lg' : 'mt-1 pt-1 text-[13px]'} flex justify-between border-t border-gray-900 font-semibold text-gray-900`}>
                <span>TOTAL</span>
                <span>{formatCurrency(transaction.total)}</span>
              </div>
              {isCredit ? (
                <>
                  <div className={`flex justify-between pt-1 ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} font-semibold uppercase text-gray-600`}>
                    <span>Credit Status</span>
                    <span>{transaction.paymentStatus || 'Pending'}</span>
                  </div>
                  <div className={`flex justify-between ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} text-gray-500`}>
                    <span>Due Date</span>
                    <span>{transaction.dueDate ? new Date(transaction.dueDate).toLocaleDateString() : '-'}</span>
                  </div>
                  {transaction.creditPaymentMode && (
                    <div className={`flex justify-between ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} text-gray-500`}>
                      <span>Payment Method</span>
                      <span>{transaction.creditPaymentMode}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.amountPaid) && (
                    <div className={`flex justify-between ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} text-gray-500`}>
                      <span>Amount Paid</span>
                      <span>{formatCurrency(transaction.amountPaid)}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.remainingBalance ?? transaction.balance) && (
                    <div className={`flex justify-between ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} text-gray-500`}>
                      <span>Remaining Balance</span>
                      <span>{formatCurrency(transaction.remainingBalance ?? transaction.balance)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {transaction.paymentStatus && (
                    <div className={`flex justify-between pt-1 ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} font-semibold uppercase text-gray-600`}>
                      <span>Payment Status</span>
                      <span>{transaction.paymentStatus}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.cash) && (
                    <div className={`flex justify-between ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} text-gray-600`}>
                      <span>Cash Received</span>
                      <span>{formatCurrency(transaction.cash)}</span>
                    </div>
                  )}
                  {hasSavedNumber(transaction.change) && (
                    <div className={`flex justify-between ${isOrderConfirmation ? 'text-xs sm:text-[13px]' : 'text-[9px]'} text-gray-500`}>
                      <span>Change</span>
                      <span>{formatCurrency(transaction.change)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {isVoidedConfirmation && (
              <div className={`mt-2 border-t border-dashed border-rose-200 pt-2 ${isOrderConfirmation ? 'text-xs leading-relaxed sm:text-[13px]' : 'text-[9px] leading-tight'} text-gray-600`}>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Voided At:</span>
                  <span className="text-right">{formatReceiptDate(transaction.voidInfo?.voidedAt)}</span>
                </div>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Void Reason:</span>
                  <span className="break-words text-right">{transaction.voidInfo?.reason || '-'}</span>
                </div>
              </div>
            )}

            <div className={`${isOrderConfirmation ? 'mt-5 text-[11px] leading-relaxed sm:text-xs' : 'mt-3 text-[9px] leading-tight'} text-center text-gray-400`}>
              {isOrderConfirmation ? <p>For transaction reference only.</p> : (
                <>
                  <p>Thank you for your business.</p>
                  <p>Please keep this receipt for returns and support.</p>
                  {isReprint && <p className="mt-2 font-mono">** REPRINT **</p>}
                </>
              )}
            </div>
          </div>
        </div>

        <div className={`grid grid-cols-2 gap-2 border-t border-gray-100 bg-gray-50 ${isOrderConfirmation ? 'p-3 sm:p-4' : 'p-2'}`}>
          <button type="button" onClick={onClose} disabled={isPrinting} className={`flex items-center justify-center rounded-xl bg-white px-4 ${isOrderConfirmation ? 'py-2.5' : 'py-2'} text-xs font-semibold uppercase tracking-widest text-gray-600 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100 disabled:opacity-50`}>
            Close
          </button>
          <button type="button" onClick={onPrint} disabled={isPrinting} className={`flex items-center justify-center rounded-xl px-4 ${isOrderConfirmation ? 'py-2.5' : 'py-2'} text-xs font-semibold uppercase tracking-widest text-white shadow-sm transition-all duration-300 ${isPrinting ? 'cursor-wait opacity-80' : 'hover:-translate-y-0.5 hover:opacity-90'}`} style={{ backgroundColor: isPrinted ? '#10B981' : '#111827', border: isPrinted ? '2px solid #10B981' : '2px solid #111827' }}>
            {isPrinting ? 'Printing...' : isPrinted ? printedLabel : printLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiptPreviewModal;
