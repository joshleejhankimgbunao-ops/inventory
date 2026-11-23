import { useEffect } from 'react';
import { ORDER_CONFIRMATION_PREVIEW_SIZE } from '../constants/orderConfirmationPreview';
import { formatCurrency } from '../utils/numberFormat';

const formatDateTime = (value) => {
  if (!value) return '—';
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

const formatPaymentMethod = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '—';
  if (normalized === 'gcash') return 'GCash';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatInvoiceDate = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
};

const invoiceMoney = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? '—'
  : formatCurrency(Number(value));

const InvoiceLine = ({ label, value, emphasis = false }) => (
  <div className={`flex min-h-7 items-center justify-between gap-3 border-b border-slate-300 px-1.5 py-1 ${emphasis ? 'font-semibold text-slate-950' : 'text-slate-800'}`}>
    <span className="min-w-0">{label}</span>
    <span className={`min-w-0 text-right tabular-nums ${emphasis ? 'font-semibold' : ''}`}>{value}</span>
  </div>
);

const CreditInvoiceField = ({ label, value, blankLine = false }) => {
  const displayValue = String(value || '').trim();
  return (
    <div className="flex min-h-8 min-w-0 items-end gap-2 py-1">
      <span className="shrink-0 text-slate-800">{label}</span>
      {blankLine ? (
        <span aria-hidden="true" className="min-w-0 flex-1 border-b border-slate-500 pb-0.5" />
      ) : (
        <span className={`min-w-0 flex-1 break-words border-b border-slate-400 pb-0.5 ${displayValue ? 'text-slate-900' : 'text-slate-400'}`}>{displayValue || '\u2014'}</span>
      )}
    </div>
  );
};

const PosOrderConfirmation = ({ transaction, customer, settings, pending, onContinue, onBack, readOnly }) => {
  const items = Array.isArray(transaction?.items) ? transaction.items : [];
  const isCash = String(transaction?.paymentMethod || '').trim().toLowerCase() === 'cash';
  const isCredit = String(transaction?.paymentMethod || '').trim().toLowerCase() === 'credit';
  const vatMode = String(transaction?.vatMode || '').trim().toLowerCase();
  const vatNotCalculated = transaction?.vatCalculationStatus === 'not_calculated';
  const total = transaction?.total;
  const vatAmount = transaction?.vatAmount;
  const netAmount = transaction?.netAmount;
  const customerName = String(transaction?.customerName || customer?.name || '').trim();
  const customerAddress = String(transaction?.customerDetails?.address || customer?.address || '').trim();
  const companyName = String(settings?.storeName || 'Tableria La Confianza Co., Inc.').trim();
  const companyAddress = String(settings?.storeAddress || '').trim();
  const companySubtitle = String(settings?.storeBusinessSubtitle || '').trim();
  const contactNumbers = [settings?.contactPhone, settings?.contactPhoneSecondary].map((value) => String(value || '').trim()).filter(Boolean);
  const paymentStatus = String(transaction?.paymentStatus || (isCash ? 'Paid' : 'Partially Paid')).trim();
  const creditTotal = total;
  const downPayment = transaction?.downPaymentAmount ?? transaction?.amountPaid;
  const remainingBalance = transaction?.remainingBalance;

  const specificationParts = (item) => [
    item?.brand,
    item?.size,
    item?.color,
    item?.volume,
    item?.finish,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="order-confirmation-title" className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <div>
            <h2 id="order-confirmation-title" className="text-lg font-semibold text-slate-900">Order Confirmation</h2>
            <p className="mt-0.5 text-xs text-slate-500">For reference only — Not an official invoice</p>
          </div>
          <span className="hidden text-xs text-slate-500 sm:block">{readOnly ? 'Saved transaction · View only' : 'Review before saving the transaction'}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2 sm:p-5">
          <article className="mx-auto min-w-[650px] max-w-[900px] border border-slate-300 bg-white px-4 py-5 text-[12px] leading-snug text-slate-900 shadow-sm sm:px-8 sm:py-7">
            <header className="border-b-2 border-slate-900 pb-3 text-center">
              <h1 className="text-lg font-bold uppercase tracking-wide text-slate-950 sm:text-xl">{companyName}</h1>
              {companySubtitle && <p className="mt-0.5 text-[11px] text-slate-700">{companySubtitle}</p>}
              {companyAddress && <p className="mt-0.5 text-[11px] text-slate-700">{companyAddress}</p>}
              {contactNumbers.length > 0 && <p className="mt-0.5 text-[11px] text-slate-700">Tel. {contactNumbers.join(' / ')}</p>}
            </header>

            <div className="flex items-end justify-between gap-4 border-b border-slate-700 py-2.5">
              <h2 className="text-base font-bold uppercase tracking-wide underline decoration-1 underline-offset-2 sm:text-lg">Cash Sales Invoice</h2>
              <div className="flex min-w-[42%] items-end gap-2"><span className="shrink-0">Date:</span><span className="min-w-0 flex-1 border-b border-slate-600 pb-0.5 text-right">{formatInvoiceDate(transaction?.date)}</span></div>
            </div>

            <section aria-label="Customer details" className="grid grid-cols-12 gap-x-4 border-b-2 border-slate-900 py-2.5 text-[11px] sm:text-xs">
              <div className="col-span-12 flex min-h-7 items-end gap-2 border-b border-slate-400 py-1"><span className="shrink-0">Sold To:</span><span className="min-w-0 flex-1 truncate">{customerName}</span></div>
              <div className="col-span-12 flex min-h-7 items-end gap-2 border-b border-slate-400 py-1"><span className="shrink-0">Address:</span><span className="min-w-0 flex-1 truncate">{customerAddress}</span></div>
              <div className="col-span-12 flex min-h-7 items-end gap-2 border-b border-slate-400 py-1 sm:col-span-6"><span className="shrink-0">Business Style:</span><span className="min-w-0 flex-1">{String(customer?.businessStyle || customer?.businessName || '').trim()}</span></div>
              <div className="col-span-12 flex min-h-7 items-end gap-2 border-b border-slate-400 py-1 sm:col-span-6"><span className="shrink-0">TIN:</span><span className="min-w-0 flex-1">{String(customer?.tin || customer?.taxIdentificationNumber || '').trim()}</span></div>
              <div className="col-span-12 flex min-h-7 items-end gap-2 py-1 sm:col-span-6"><span className="shrink-0">OSCA/PWD ID No.:</span><span className="min-w-0 flex-1 border-b border-slate-400" /></div>
              <div className="col-span-12 flex min-h-7 items-end gap-2 py-1 sm:col-span-6"><span className="shrink-0">Cardholder&apos;s Signature:</span><span className="min-w-0 flex-1 border-b border-slate-400" /></div>
            </section>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] table-fixed border-collapse text-[11px] sm:text-xs">
                <colgroup><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[45%]" /><col className="w-[15%]" /><col className="w-[21%]" /></colgroup>
                <thead><tr className="border-b-2 border-slate-900 text-slate-950">
                  <th className="border-r border-slate-700 px-1 py-2 text-center font-bold">QTY.</th>
                  <th className="border-r border-slate-700 px-1 py-2 text-center font-bold">UNIT</th>
                  <th className="border-r border-slate-700 px-2 py-2 text-left font-bold">DESCRIPTION</th>
                  <th className="border-r border-slate-700 px-1 py-2 text-right font-bold">U/P</th>
                  <th className="px-1 py-2 text-right font-bold">AMOUNT</th>
                </tr></thead>
                <tbody>
                  {items.map((item, index) => {
                    const quantity = Number(item?.qty ?? item?.quantity ?? 0) || 0;
                    const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
                    const lineAmount = Number(item?.subtotal ?? unitPrice * quantity) || 0;
                    const unit = String(item?.sellingUnit || item?.unit || '').trim();
                    const specifications = specificationParts(item).filter((part) => part !== item?.brand);
                    return <tr key={`${item?.id || item?.code || 'invoice-item'}-${index}`} className="border-b border-slate-500 align-top">
                      <td className="border-r border-slate-400 px-1 py-2 text-center tabular-nums">{quantity}</td>
                      <td className="border-r border-slate-400 px-1 py-2 text-center">{unit}</td>
                      <td className="border-r border-slate-400 px-2 py-2"><div className="break-words font-medium">{[item?.brand, item?.name].filter(Boolean).join(' ') || 'Item'}{item?.color && !specifications.includes(String(item.color).trim()) ? ` · ${item.color}` : ''}</div>{(item?.code || specifications.length > 0) && <p className="mt-0.5 break-words text-[10px] text-slate-600">{[item?.code ? `SKU: ${item.code}` : '', ...specifications].filter(Boolean).join(' · ')}</p>}</td>
                      <td className="border-r border-slate-400 px-1 py-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(unitPrice)}</td>
                      <td className="px-1 py-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(lineAmount)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <section aria-label="Tax and totals" className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-[0.9fr_1.1fr]">
              <div className="border-y border-slate-800">
                <InvoiceLine label="VATABLE" value={vatMode === 'vatable' ? invoiceMoney(netAmount) : '—'} />
                <InvoiceLine label="VAT EXEMPT" value="—" />
                <InvoiceLine label="VAT ZERO RATED" value={vatMode === 'zero-rated' ? invoiceMoney(total) : '—'} />
                <InvoiceLine label="VAT AMOUNT" value={vatNotCalculated ? 'Not calculated' : invoiceMoney(vatAmount)} />
              </div>
              <div className="border-y border-slate-800">
                <InvoiceLine label="TOTAL SALES (VAT Inclusive)" value={vatMode === 'vatable' ? invoiceMoney(transaction?.grossAmount ?? total) : '—'} />
                <InvoiceLine label="LESS: VAT" value={vatNotCalculated ? 'Not calculated' : invoiceMoney(vatAmount)} />
                <InvoiceLine label="AMOUNT NET OF VAT" value={vatNotCalculated ? 'Not calculated' : invoiceMoney(vatMode === 'zero-rated' ? total : netAmount)} />
                <InvoiceLine label="LESS: PWD Discount" value="—" />
                <InvoiceLine label="AMOUNT DUE" value={invoiceMoney(vatMode === 'vatable' ? netAmount : total)} />
                <InvoiceLine label="ADD: VAT" value={vatNotCalculated ? 'Not calculated' : invoiceMoney(vatAmount)} />
                <InvoiceLine label="TOTAL AMOUNT DUE" value={invoiceMoney(total)} emphasis />
              </div>
            </section>

            <section aria-label="Payment details" className="mt-3 border-y border-slate-500 py-2 text-[11px] sm:text-xs">
              <h3 className="mb-1 font-bold uppercase tracking-wide">Payment Details</h3>
              {isCash && <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-3"><InvoiceLine label="Total Amount" value={invoiceMoney(total)} /><InvoiceLine label="Cash Received" value={invoiceMoney(transaction?.cash ?? transaction?.cashTendered)} /><InvoiceLine label="Change" value={invoiceMoney(transaction?.change)} /></div>}
              {isCredit && <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2"><InvoiceLine label="Approved Total" value={invoiceMoney(creditTotal)} /><InvoiceLine label="Down Payment" value={invoiceMoney(downPayment)} /><InvoiceLine label="Down Payment Method" value={formatPaymentMethod(transaction?.creditPaymentMode)} /><InvoiceLine label="Remaining Balance" value={invoiceMoney(remainingBalance)} /><InvoiceLine label="Payment Status" value={paymentStatus} /><InvoiceLine label="Credit Terms" value={transaction?.termDays ? `${transaction.termDays} days` : '—'} /><InvoiceLine label="Due Date" value={transaction?.dueDate ? formatInvoiceDate(transaction.dueDate) : '—'} /></div>}
            </section>

            <section aria-label="Reference signatures" className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 px-2 text-center text-[10px] text-slate-700 sm:text-[11px]">
              <div className="pt-4"><div className="border-t border-slate-600 pt-1">Received By</div></div>
              <div className="pt-4"><div className="border-t border-slate-600 pt-1">Customer Signature Over Printed Name</div></div>
              <div className="col-span-2 mx-auto w-2/3 pt-3"><div className="border-t border-slate-600 pt-1">Cashier / Authorized Representative</div></div>
            </section>

            <section aria-label="System reference" className="mt-5 border-t border-dashed border-slate-400 pt-2 text-[10px] text-slate-600 sm:text-[11px]">
              <div className="mb-1 font-semibold uppercase tracking-wide">System Reference</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <p><span className="text-slate-500">Transaction ID:</span> {pending ? 'Pending final save' : transaction?.id || '—'}</p>
                <p><span className="text-slate-500">Cashier:</span> {transaction?.cashier || '—'}</p>
                <p><span className="text-slate-500">Payment Method:</span> {formatPaymentMethod(transaction?.paymentMethod)}</p>
                <p><span className="text-slate-500">Payment Status:</span> {paymentStatus}</p>
                {transaction?.transactionReference?.referenceNumber && <p className="col-span-2 sm:col-span-4"><span className="text-slate-500">Invoice / Reference No.:</span> {transaction.transactionReference.referenceNumber}</p>}
              </div>
            </section>
          </article>
        </div>

        <footer className={`flex shrink-0 gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:p-4 ${readOnly ? 'justify-end' : 'justify-between'}`}>
          {readOnly ? (
            <button type="button" onClick={onContinue || onBack} className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Close</button>
          ) : <>
            <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Back to Payment</button>
            <button type="button" onClick={onContinue} className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Continue to Reference</button>
          </>}
        </footer>
      </section>
    </div>
  );
};

const CreditOrderConfirmation = ({ transaction, customer, settings, pending, onContinue, onBack, readOnly }) => {
  const items = Array.isArray(transaction?.items) ? transaction.items : [];
  const vatMode = String(transaction?.vatMode || '').trim().toLowerCase();
  const vatNotCalculated = transaction?.vatCalculationStatus === 'not_calculated';
  const hasNetAmount = transaction?.netAmount !== null
    && transaction?.netAmount !== undefined
    && String(transaction.netAmount).trim() !== ''
    && Number.isFinite(Number(transaction.netAmount));
  const hasVatAmount = transaction?.vatAmount !== null
    && transaction?.vatAmount !== undefined
    && String(transaction.vatAmount).trim() !== ''
    && Number.isFinite(Number(transaction.vatAmount));
  const hasGrossAmount = transaction?.grossAmount !== null
    && transaction?.grossAmount !== undefined
    && String(transaction.grossAmount).trim() !== ''
    && Number.isFinite(Number(transaction.grossAmount));
  const customerName = String(transaction?.customerName || customer?.name || '').trim();
  const customerAddress = String(transaction?.customerDetails?.address || customer?.address || '').trim();
  const businessStyle = String(
    transaction?.customerDetails?.businessStyle
    || customer?.businessStyle
    || customer?.businessName
    || '',
  ).trim();
  const customerTin = String(
    transaction?.customerDetails?.tin
    || transaction?.customerDetails?.taxIdentificationNumber
    || customer?.tin
    || customer?.taxIdentificationNumber
    || '',
  ).trim();
  const companyName = String(settings?.storeName || 'Tableria La Confianza Co., Inc.').trim();
  const companyAddress = String(settings?.storeAddress || '').trim();
  const companySubtitle = String(settings?.storeBusinessSubtitle || '').trim();
  const contactNumbers = [settings?.contactPhone, settings?.contactPhoneSecondary]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const downPayment = transaction?.downPaymentAmount;
  const totalPaid = transaction?.amountPaid ?? downPayment;
  const remainingBalance = transaction?.remainingBalance;
  const additionalPayments = Array.isArray(transaction?.additionalPayments)
    ? transaction.additionalPayments
    : [];
  const recordedAdditionalPayments = additionalPayments.reduce((sum, payment) => (
    Number.isFinite(Number(payment?.amount)) ? sum + Number(payment.amount) : sum
  ), 0);
  const placeholder = '\u2014';
  const unavailableTaxValue = vatNotCalculated ? 'Not calculated' : placeholder;
  const netAmountValue = hasNetAmount ? invoiceMoney(transaction.netAmount) : unavailableTaxValue;
  const vatAmountValue = hasVatAmount ? invoiceMoney(transaction.vatAmount) : unavailableTaxValue;
  const taxBreakdownAvailable = !vatNotCalculated && hasNetAmount && hasVatAmount;
  const amountDueValue = vatMode === 'vatable'
    ? netAmountValue
    : vatMode === 'zero-rated'
      ? invoiceMoney(transaction?.total)
      : placeholder;

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="order-confirmation-title" className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <div>
            <h2 id="order-confirmation-title" className="text-lg font-semibold text-slate-900">Order Confirmation</h2>
            <p className="mt-0.5 text-xs text-slate-500">For reference only {'\u2014'} Not an official invoice</p>
          </div>
          <span className="hidden text-xs text-slate-500 sm:block">{readOnly ? 'Saved transaction \u00b7 View only' : 'Review before saving the transaction'}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2 sm:p-5">
          <article className="mx-auto w-full max-w-[900px] border border-slate-300 bg-white px-4 py-5 text-[12px] leading-snug text-slate-900 shadow-sm sm:px-8 sm:py-7">
            <header className="border-b-2 border-slate-900 pb-3 text-center">
              <h1 className="text-lg font-bold uppercase tracking-wide text-slate-950 sm:text-xl">{companyName}</h1>
              {companySubtitle && <p className="mt-0.5 text-[11px] text-slate-700">{companySubtitle}</p>}
              {companyAddress && <p className="mt-0.5 break-words text-[11px] text-slate-700">{companyAddress}</p>}
              {contactNumbers.length > 0 && <p className="mt-0.5 text-[11px] text-slate-700">Tel. {contactNumbers.join(' / ')}</p>}
            </header>

            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-700 py-2.5">
              <div>
                <h2 className="text-base font-bold uppercase tracking-wide underline decoration-1 underline-offset-2 sm:text-lg">Charge Sales Invoice</h2>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">Credit order confirmation</p>
              </div>
              <div className="min-w-0 text-right text-[10px] leading-snug text-slate-600">
                <p className="font-semibold uppercase tracking-wide">System Reference {'\u00b7'} Not an Invoice Number</p>
                <p className="break-all">{pending ? 'Pending final save' : transaction?.id || placeholder}</p>
                {transaction?.creditTransactionId && <p className="break-all">Credit ID: {transaction.creditTransactionId}</p>}
                {transaction?.transactionReference?.referenceNumber && <p className="break-all">Invoice / Reference No.: {transaction.transactionReference.referenceNumber}</p>}
              </div>
            </div>

            <section aria-label="Credit customer and terms" className="space-y-0 border-b-2 border-slate-900 py-2.5 text-[11px] sm:text-xs">
              <div className="grid gap-x-5 sm:grid-cols-[1.55fr_1fr]">
                <CreditInvoiceField label="Sold To:" value={customerName} />
                <CreditInvoiceField label="Date:" value={transaction?.date ? formatInvoiceDate(transaction.date) : ''} />
              </div>
              <div className="grid gap-x-5 sm:grid-cols-[1.55fr_1fr]">
                <CreditInvoiceField label="Address:" value={customerAddress} />
                <CreditInvoiceField label="P.O. No.:" value={transaction?.purchaseOrderNumber || customer?.purchaseOrderNumber} />
              </div>
              <div className="grid gap-x-5 sm:grid-cols-2">
                <CreditInvoiceField label="Business Style:" value={businessStyle} />
                <CreditInvoiceField label="TIN:" value={customerTin} />
              </div>
              <div className="grid gap-x-5 sm:grid-cols-2">
                <CreditInvoiceField label="OSCA/PWD ID No.:" value={transaction?.oscaPwdId || customer?.oscaPwdId} />
                <CreditInvoiceField label="Terms:" value={transaction?.termDays ? `${transaction.termDays} days` : ''} />
              </div>
              <div className="grid gap-x-5 sm:grid-cols-2">
                <CreditInvoiceField label="Cardholder's Signature:" blankLine />
                <CreditInvoiceField label="Effective Due Date:" value={transaction?.dueDate ? formatInvoiceDate(transaction.dueDate) : ''} />
              </div>
            </section>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] table-fixed border border-slate-600 border-collapse text-[11px] sm:text-xs">
                <colgroup><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[45%]" /><col className="w-[15%]" /><col className="w-[21%]" /></colgroup>
                <thead><tr className="border-b-2 border-slate-900 bg-slate-50 text-slate-950">
                  <th className="border-r border-slate-600 px-1 py-2 text-center font-bold">QTY.</th>
                  <th className="border-r border-slate-600 px-1 py-2 text-center font-bold">UNIT</th>
                  <th className="border-r border-slate-600 px-2 py-2 text-center font-bold tracking-[0.16em]">DESCRIPTION</th>
                  <th className="border-r border-slate-600 px-1 py-2 text-right font-bold">UNIT PRICE</th>
                  <th className="px-1 py-2 text-right font-bold">AMOUNT</th>
                </tr></thead>
                <tbody>
                  {items.map((item, index) => {
                    const quantity = Number(item?.qty ?? item?.quantity ?? 0) || 0;
                    const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
                    const lineAmount = Number(item?.subtotal ?? unitPrice * quantity) || 0;
                    const unit = String(item?.sellingUnit || item?.unit || '').trim();
                    const name = [item?.brand, item?.name].filter(Boolean).join(' ').trim();
                    const sku = String(item?.code || item?.sku || '').trim();
                    const details = [item?.description, item?.color, item?.size, item?.volume, item?.finish, item?.type]
                      .map((value) => String(value || '').trim())
                      .filter(Boolean);
                    return <tr key={`${item?.id || sku || 'credit-invoice-item'}-${index}`} className="border-b border-slate-500 align-top">
                      <td className="border-r border-slate-400 px-1 py-2 text-center align-middle tabular-nums">{quantity}</td>
                      <td className="border-r border-slate-400 px-1 py-2 text-center align-middle">{unit}</td>
                      <td className="border-r border-slate-400 px-2 py-2"><div className="break-words font-medium">{name || placeholder}</div>{(sku || details.length > 0) && <p className="mt-0.5 break-words text-[10px] text-slate-600">{[sku ? `SKU: ${sku}` : '', ...details].filter(Boolean).join(' \u00b7 ')}</p>}</td>
                      <td className="whitespace-nowrap border-r border-slate-400 px-1 py-2 text-right align-middle tabular-nums">{formatCurrency(unitPrice)}</td>
                      <td className="whitespace-nowrap px-1 py-2 text-right align-middle tabular-nums">{formatCurrency(lineAmount)}</td>
                    </tr>;
                  })}
                  {Array.from({ length: Math.max(0, 6 - items.length) }, (_, index) => (
                    <tr key={`credit-invoice-blank-row-${index}`} aria-hidden="true" className="h-7 border-b border-slate-400">
                      <td className="border-r border-slate-400 px-1" /><td className="border-r border-slate-400 px-1" />
                      <td className="border-r border-slate-400 px-2" /><td className="border-r border-slate-400 px-1" /><td className="px-1" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section aria-label="Supported tax and invoice totals" className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-[0.9fr_1.1fr]">
              <div className="border-y border-slate-800 sm:border-r sm:border-slate-300 sm:pr-3">
                <InvoiceLine label="VATABLE" value={vatMode === 'vatable' ? netAmountValue : placeholder} />
                <InvoiceLine label="VAT EXEMPT" value={placeholder} />
                <InvoiceLine label="VAT ZERO RATED" value={vatMode === 'zero-rated' ? invoiceMoney(transaction?.total) : placeholder} />
                <InvoiceLine label="VAT AMOUNT" value={vatAmountValue} />
              </div>
              <div className="border-y border-slate-800 sm:pl-3">
                <InvoiceLine label="TOTAL SALES (VAT Inclusive)" value={vatMode === 'vatable' && taxBreakdownAvailable ? invoiceMoney(hasGrossAmount ? transaction.grossAmount : transaction.total) : (vatNotCalculated ? 'Not calculated' : placeholder)} />
                <InvoiceLine label="LESS: VAT" value={vatAmountValue} />
                <InvoiceLine label="AMOUNT NET OF VAT" value={vatMode === 'zero-rated' ? invoiceMoney(transaction?.total) : (vatMode === 'vatable' ? netAmountValue : placeholder)} />
                <InvoiceLine label="LESS: SC/PWD DISCOUNT" value={placeholder} />
                <InvoiceLine label="AMOUNT DUE" value={amountDueValue} />
                <InvoiceLine label="ADD: VAT" value={vatAmountValue} />
                <InvoiceLine label="TOTAL AMOUNT DUE" value={invoiceMoney(transaction?.total)} emphasis />
              </div>
            </section>

            <section aria-label="Credit payment details" className="mt-3 border-y border-slate-500 py-2 text-[11px] sm:text-xs">
              <h3 className="mb-1 font-bold uppercase tracking-wide">Credit Payment Details</h3>
              <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
                <InvoiceLine label="Total Invoice Amount" value={invoiceMoney(transaction?.total)} />
                <InvoiceLine label="Original Down Payment" value={invoiceMoney(downPayment)} />
                <InvoiceLine label="Additional Payments (Recorded)" value={additionalPayments.length > 0 ? invoiceMoney(recordedAdditionalPayments) : placeholder} />
                <InvoiceLine label="Total Paid" value={invoiceMoney(totalPaid)} />
                <InvoiceLine label="Remaining Balance" value={invoiceMoney(remainingBalance)} />
                <InvoiceLine label="Down Payment Method" value={formatPaymentMethod(transaction?.creditPaymentMode)} />
                <InvoiceLine label="Current Credit Status" value={transaction?.paymentStatus || placeholder} />
                <InvoiceLine label="Credit Terms" value={transaction?.termDays ? `${transaction.termDays} days` : placeholder} />
                <InvoiceLine label="Effective Due Date" value={transaction?.dueDate ? formatInvoiceDate(transaction.dueDate) : placeholder} />
              </div>
              {additionalPayments.length > 0 && (
                <div className="mt-3 border-t border-slate-300 pt-2">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Subsequent Payments</h4>
                  <div className="mt-1.5 space-y-1.5">
                    {additionalPayments.map((payment, index) => (
                      <div key={`${payment.paymentDate || 'payment'}-${payment.reference || index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-200 pb-1.5 last:border-b-0 last:pb-0">
                        <span className="min-w-0 text-slate-700">
                          Payment {index + 1}
                          {payment.paymentDate ? ` · ${formatInvoiceDate(payment.paymentDate)}` : ''}
                          {payment.method ? ` · ${payment.method}` : ''}
                          {payment.reference ? ` · Ref: ${payment.reference}` : ''}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums text-slate-900">{invoiceMoney(payment.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section aria-label="Reference signatures" className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 px-2 text-center text-[10px] text-slate-700 sm:text-[11px]">
              <div className="pt-4"><div className="border-t border-slate-600 pt-1">Received By</div></div>
              <div className="pt-4"><div className="border-t border-slate-600 pt-1">Customer Signature Over Printed Name</div></div>
            </section>

            <section aria-label="Transaction details" className="mt-5 border-t border-dashed border-slate-400 pt-2 text-[10px] text-slate-600 sm:text-[11px]">
              <div className="mb-1 font-semibold uppercase tracking-wide">Transaction Details</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <p><span className="text-slate-500">Cashier:</span> {transaction?.cashier || placeholder}</p>
                <p><span className="text-slate-500">Payment Method:</span> {formatPaymentMethod(transaction?.paymentMethod)}</p>
                <p><span className="text-slate-500">Payment Status:</span> {transaction?.paymentStatus || placeholder}</p>
              </div>
            </section>
          </article>
        </div>

        <footer className={`flex shrink-0 gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:p-4 ${readOnly ? 'justify-end' : 'justify-between'}`}>
          {readOnly ? (
            <button type="button" onClick={onContinue || onBack} className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Close</button>
          ) : <>
            <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Back to Payment</button>
            <button type="button" onClick={onContinue} className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Continue to Reference</button>
          </>}
        </footer>
      </section>
    </div>
  );
};

const OrderConfirmationModal = ({ order, transaction, customer, settings, onContinue, onBack, backLabel = 'Back to Payment', pending = false, completed = false, onViewSupportingImage, imageLoading = false, imageError = '', readOnly = false }) => {
  const items = Array.isArray(transaction?.items) ? transaction.items : [];
  const total = Number(transaction?.total || 0);
  const isCash = String(transaction?.paymentMethod || '').trim().toLowerCase() === 'cash';
  const isCredit = String(transaction?.paymentMethod || '').trim().toLowerCase() === 'credit';
  const isSpecialOrder = Boolean(transaction?.specialOrderNumber || order?.orderNumber);
  const vatNotCalculated = transaction?.vatCalculationStatus === 'not_calculated';
  const cashReceived = Number(transaction?.cash ?? transaction?.cashTendered ?? total);
  const change = Number(transaction?.change ?? Math.max(0, cashReceived - total));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('overflow-hidden');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('overflow-hidden');
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!isSpecialOrder && isCredit) {
    return <CreditOrderConfirmation transaction={transaction} customer={customer} settings={settings} pending={pending} onContinue={onContinue} onBack={onBack} readOnly={readOnly} />;
  }

  if (!isSpecialOrder) {
    return <PosOrderConfirmation transaction={transaction} customer={customer} settings={settings} pending={pending} onContinue={onContinue} onBack={onBack} readOnly={readOnly} />;
  }

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="order-confirmation-title" className={`flex ${ORDER_CONFIRMATION_PREVIEW_SIZE.modal} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <header className="shrink-0 border-b border-gray-100 bg-gray-50 px-4 py-3.5 sm:px-5 sm:py-4">
          <h2 id="order-confirmation-title" className="text-xl font-semibold text-gray-800 sm:text-2xl">{completed ? 'Transaction Details' : 'Order Confirmation'}</h2>
          <p className="mt-1 text-xs text-gray-500">{completed ? 'Saved transaction information.' : 'Review this pending transaction before adding its reference. Nothing has been saved yet.'}</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className={`${ORDER_CONFIRMATION_PREVIEW_SIZE.content} px-1 text-xs leading-relaxed text-gray-600 sm:text-[13px]`}>
            <div className="mb-4 border-y border-dashed border-gray-200 py-3">
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">Transaction:</span>
                <span className="break-words text-right font-semibold text-gray-800">{pending ? 'Pending final save' : transaction?.id || '—'}</span>
              </div>
              {isSpecialOrder && (
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Special Order:</span>
                  <span className="break-all text-right font-semibold text-amber-700">{transaction?.specialOrderNumber || order?.orderNumber}</span>
                </div>
              )}
              {isSpecialOrder && transaction?.specialOrderQuotationVersion && <p className="mb-1 text-xs text-gray-600">Accepted Quotation Version: {transaction.specialOrderQuotationVersion}</p>}
              {isSpecialOrder && completed && transaction?.sourceId && <p className="mb-1 break-all text-xs text-gray-600">Sale ID: {transaction.sourceId}</p>}
              {isSpecialOrder && completed && <p className="mb-1 text-xs text-gray-600">Financial Sale: Recorded{transaction?.specialOrderFulfillmentStatus ? ` · ${transaction.specialOrderFulfillmentStatus === 'Administrative Closure' ? 'Order closure' : 'Fulfillment'}: ${transaction.specialOrderFulfillmentStatus}` : ''}</p>}
              <div className="mb-1 flex justify-between gap-2">
                <span className="shrink-0 text-gray-500">Date &amp; Time:</span>
                <span className="text-right text-gray-800">{formatDateTime(transaction?.date)}</span>
              </div>
              <div className={`${isSpecialOrder ? 'mb-1' : ''} flex justify-between gap-2`}>
                <span className="shrink-0 text-gray-500">Cashier:</span>
                <span className="break-words text-right text-gray-800">{transaction?.cashier || '—'}</span>
              </div>
              {isSpecialOrder && <>
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Customer:</span>
                  <span className="break-words text-right text-gray-800">{transaction?.customerName || order?.customerName || '—'}</span>
                </div>
                {transaction?.customerDetails?.address && <p className="mb-1 text-right text-xs text-gray-500">{transaction.customerDetails.address}</p>}
                {completed && <p className="mb-1 text-xs text-gray-600">Invoice No.: {transaction?.transactionReference?.referenceNumber || '—'}</p>}
                {completed && transaction?.transactionReference?.supportingDocument && <div className="mb-2 space-y-1 text-xs text-gray-600"><p className="break-words">Supporting Image: {transaction.transactionReference.supportingDocument.originalName}</p>{onViewSupportingImage && <button type="button" onClick={onViewSupportingImage} disabled={imageLoading} className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50">{imageLoading ? 'Loading Image...' : 'View Image'}</button>}</div>}
                {completed && !transaction?.transactionReference?.referenceNumber && !transaction?.transactionReference?.supportingDocument && <p className="mb-2 text-xs text-gray-500">No invoice number or supporting image was recorded.</p>}
                {completed && imageError && <p role="alert" className="mb-2 text-xs text-rose-600">{imageError}</p>}
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Payment Method:</span>
                  <span className="text-right text-gray-800">{transaction?.collectionSource === 'special_order_ledger' ? 'Recorded Special Order payments' : formatPaymentMethod(transaction?.paymentMethod)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Payment Status:</span>
                  <span className="text-right font-semibold uppercase text-gray-800">{transaction?.paymentStatus || '—'}</span>
                </div>
              </>}
              {isCredit && <>
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Down Payment Method:</span>
                  <span className="text-right text-gray-800">{formatPaymentMethod(transaction?.creditPaymentMode)}</span>
                </div>
                <div className="mb-1 flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Down Payment:</span>
                  <span className="text-right font-semibold text-gray-800">{formatCurrency(Number(transaction?.downPaymentAmount ?? transaction?.amountPaid ?? 0))}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="shrink-0 text-gray-500">Remaining Balance:</span>
                  <span className="text-right font-semibold text-gray-800">{formatCurrency(Number(transaction?.remainingBalance ?? total))}</span>
                </div>
              </>}
            </div>

            <table className="mb-4 w-full table-fixed">
              <colgroup>
                <col className="w-[43%]" />
                <col className="w-[12%]" />
                <col className="w-[20%]" />
                <col className="w-[25%]" />
              </colgroup>
              <thead>
                <tr className="border-b-2 border-gray-100">
                  <th className="py-1.5 pr-2 text-left text-xs font-semibold text-gray-700">Item</th>
                  <th className="py-1.5 text-center text-xs font-semibold text-gray-700">Qty</th>
                  <th className="whitespace-nowrap py-1.5 text-right text-xs font-semibold text-gray-700">Unit Price</th>
                  <th className="py-1.5 text-right text-xs font-semibold text-gray-700">Amount</th>
                </tr>
              </thead>
              <tbody className="text-xs leading-relaxed text-gray-600 sm:text-[13px]">
                {items.map((item, index) => {
                  const quantity = Number(item?.qty ?? item?.quantity ?? 0) || 0;
                  const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
                  const lineAmount = Number(item?.subtotal ?? (unitPrice * quantity)) || 0;
                  const sellingUnit = String(item?.sellingUnit || item?.unit || '').trim();
                  return (
                    <tr key={`${item?.id || item?.code || 'confirmation-item'}-${index}`} className="border-b border-gray-50">
                      <td className="py-2 pr-2 align-top">
                        <div className="break-words font-semibold leading-tight text-gray-800">{item?.brand ? `${item.brand} ` : ''}{item?.name || 'Item'}{item?.color ? ` — ${item.color}` : ''}</div>
                        {item?.code && <div className="break-all text-[11px] leading-tight text-gray-500">{item.code}</div>}
                        {isSpecialOrder && item?.description && <div className="break-words text-[11px] leading-tight text-gray-500">{item.description}</div>}
                      </td>
                      <td className="py-2 text-center align-top">{quantity}{sellingUnit ? <span className="block text-[10px] leading-tight text-gray-400">{sellingUnit}</span> : null}</td>
                      <td className="whitespace-nowrap py-2 text-right align-top font-medium">{formatCurrency(unitPrice)}</td>
                      <td className="whitespace-nowrap py-2 text-right align-top font-medium">{formatCurrency(lineAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="space-y-1.5 border-t border-gray-200 pt-3 text-xs leading-relaxed text-right sm:text-[13px]">
              {vatNotCalculated && <div className="flex justify-between text-gray-600"><span>VAT Classification</span><span>{transaction?.taxTreatment === 'vat_zero_rated' ? 'VAT Zero-Rated' : 'VAT-Rated'}</span></div>}
              <div className="flex justify-between text-gray-600"><span>Net Amount</span><span>{vatNotCalculated ? 'Not calculated' : formatCurrency(Number(transaction?.netAmount ?? total))}</span></div>
              <div className="flex justify-between text-gray-600"><span>VAT</span><span>{vatNotCalculated ? 'Not calculated' : formatCurrency(Number(transaction?.vatAmount || 0))}</span></div>
              <div className="mt-2 flex justify-between border-t border-gray-900 pt-2 text-lg font-semibold text-gray-900"><span>TOTAL</span><span>{formatCurrency(total)}</span></div>
              {isCash && <>
                <div className="flex justify-between pt-1 text-gray-600"><span>Cash Received</span><span>{formatCurrency(cashReceived)}</span></div>
                <div className="flex justify-between text-gray-500"><span>Change</span><span>{formatCurrency(change)}</span></div>
              </>}
              {isCredit && <div className="flex justify-between pt-1 text-gray-600"><span>Credit Status</span><span className="font-semibold">{transaction?.paymentStatus || 'Partially Paid'}</span></div>}
            </div>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400 sm:text-xs">For transaction reference only.</p>
          </div>
        </div>

        <footer className={`shrink-0 gap-2 border-t border-gray-100 bg-gray-50 p-3 sm:p-4 ${completed ? 'flex justify-end' : 'grid grid-cols-2'}`}>
          {completed ? (
            <button type="button" onClick={onContinue || onBack} className="flex items-center justify-center rounded-xl border-2 border-gray-900 bg-gray-900 px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">Close</button>
          ) : <>
            <button type="button" onClick={onBack} className="flex min-w-0 items-center justify-center rounded-xl bg-white px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-gray-600 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300">{backLabel}</button>
            <button type="button" onClick={onContinue} className="flex min-w-0 items-center justify-center rounded-xl border-2 border-gray-900 bg-gray-900 px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">Continue to Reference</button>
          </>}
        </footer>
      </section>
    </div>
  );
};

export default OrderConfirmationModal;
