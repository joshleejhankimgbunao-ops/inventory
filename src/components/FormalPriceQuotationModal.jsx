import React, { useState } from 'react';
import { downloadFormalQuotationPdf } from '../utils/formalQuotation';
import { showToast } from '../utils/toastHelper';

const formatMoney = (value) => `PHP ${new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(Number(value) || 0)}`;

const FormalPriceQuotationDocument = ({ quotation }) => {
    const attention = [quotation.customer.attentionName, quotation.customer.attentionPosition].filter(Boolean).join(' – ');

    return (
        <article id="formal-price-quotation-paper" className="formal-price-quotation-paper mx-auto min-h-[277mm] w-full max-w-[210mm] bg-white px-[14mm] py-[13mm] text-[11px] leading-relaxed text-slate-800 shadow-sm sm:px-[18mm] sm:py-[16mm]">
            <header className="text-center">
                <h2 className="text-lg font-bold tracking-wide text-slate-950">{quotation.company.name}</h2>
                {quotation.company.subtitle && <p className="mt-1 text-xs font-medium text-slate-600">{quotation.company.subtitle}</p>}
                {quotation.company.address && <p className="mt-0.5 text-[11px] text-slate-500">{quotation.company.address}</p>}
                {quotation.company.contacts.length > 0 && <p className="mt-0.5 text-[10px] text-slate-500">{quotation.company.contacts.join(' | ')}</p>}
                {quotation.company.emails.length > 0 && <p className="text-[10px] text-slate-500">{quotation.company.emails.join(' | ')}</p>}
                <h1 className="mt-8 text-base font-bold tracking-[0.18em] text-slate-950">{quotation.title}</h1>
            </header>

            <section className="mt-8 grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
                <span className="font-semibold text-slate-700">DATE:</span>
                <span>{quotation.dateDisplay}</span>
                <span className="font-semibold text-slate-700">TO:</span>
                <div>
                    <p className="font-semibold text-slate-900">{quotation.customer.name}</p>
                    {quotation.customer.address && <p className="mt-0.5 text-slate-600">{quotation.customer.address}</p>}
                </div>
                {attention && (
                    <>
                        <span className="font-semibold text-slate-700">ATTN.:</span>
                        <span>{attention}</span>
                    </>
                )}
            </section>

            <p className="mt-7 text-[11px] text-slate-700">{quotation.introduction}</p>

            <table className="mt-5 w-full border-collapse text-left text-[11px]">
                <thead className="formal-quotation-table-head">
                    <tr className="border-y border-slate-800 text-[10px] font-semibold uppercase tracking-wide text-slate-800">
                        <th className="px-2 py-2">Description</th>
                        <th className="w-[34%] px-2 py-2 text-right">Unit Price</th>
                    </tr>
                </thead>
                <tbody>
                    {quotation.items.map((item, index) => (
                        <tr key={`${item.code || item.productName}-${index}`} className="break-inside-avoid border-b border-slate-200 align-top">
                            <td className="px-2 py-3 font-medium text-slate-800">{item.description}</td>
                            <td className="whitespace-nowrap px-2 py-3 text-right font-semibold tabular-nums text-slate-900">
                                {formatMoney(item.unitPrice)}{item.sellingUnit ? ` / ${item.sellingUnit}` : ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <p className="mt-4 text-center text-[10px] italic text-slate-500">{quotation.nothingFollows}</p>

            <section className="formal-quotation-closing mt-7 break-inside-avoid">
                {quotation.taxLabel && <p className="text-[11px] font-bold tracking-wide text-slate-900">{quotation.taxLabel}</p>}
                <p className={`${quotation.taxLabel ? 'mt-3' : ''} text-[10px] text-slate-500`}>{quotation.disclaimer}</p>

                <div className="mt-8 text-[11px]">
                    <p>Very truly yours,</p>
                    <p className="mt-3 font-bold text-slate-950">{quotation.signatory.companyName}</p>
                    <div className="mt-8">
                        <p className="font-semibold text-slate-900">{quotation.signatory.name}</p>
                    </div>
                </div>
            </section>
        </article>
    );
};

const FormalPriceQuotationModal = ({ quotation, onClose }) => {
    const [actionStatus, setActionStatus] = useState('idle');

    const handlePrint = () => {
        if (actionStatus !== 'idle') return;
        setActionStatus('printing');
        const cleanup = () => {
            document.body.classList.remove('printing-formal-quotation');
            setActionStatus('idle');
        };
        document.body.classList.add('printing-formal-quotation');
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
        window.setTimeout(cleanup, 1500);
    };

    const handleDownload = () => {
        if (actionStatus !== 'idle') return;
        setActionStatus('downloading');
        try {
            const filename = downloadFormalQuotationPdf(quotation);
            showToast('PDF Downloaded', filename, 'success', 'formal-quotation-pdf');
        } catch (error) {
            showToast('Download Failed', error?.message || 'Unable to download the price quotation.', 'error', 'formal-quotation-pdf');
        } finally {
            setActionStatus('idle');
        }
    };

    return (
        <div className="app-modal-backdrop fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="formal-quotation-preview-title">
            <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-5 dark:border-slate-700 dark:bg-slate-800">
                    <div>
                        <h2 id="formal-quotation-preview-title" className="text-base font-semibold text-slate-900 dark:text-white">Price Quotation Preview</h2>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">A4 quotation for {quotation.customer.name}</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={actionStatus !== 'idle'} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-100" aria-label="Close price quotation preview">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" /></svg>
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-200/70 p-3 sm:p-5 dark:bg-slate-950/60">
                    <FormalPriceQuotationDocument quotation={quotation} />
                </div>

                <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                    <button type="button" onClick={onClose} disabled={actionStatus !== 'idle'} className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Close</button>
                    <button type="button" onClick={handlePrint} disabled={actionStatus !== 'idle'} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 8V4h12v4m-1 10H7v-6h10v6Zm2-10H5a2 2 0 0 0-2 2v5h3m12 0h3v-5a2 2 0 0 0-2-2Z" /></svg>
                        {actionStatus === 'printing' ? 'Opening Print…' : 'Print'}
                    </button>
                    <button type="button" onClick={handleDownload} disabled={actionStatus !== 'idle'} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
                        {actionStatus === 'downloading' ? 'Downloading…' : 'Download PDF'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export { FormalPriceQuotationDocument };
export default FormalPriceQuotationModal;
