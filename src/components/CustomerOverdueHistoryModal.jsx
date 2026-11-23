import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCustomerOverdueHistoryApi } from '../services/inventoryApi';
import { formatCurrency } from '../utils/numberFormat';
import ContextualEmptyState from './ContextualEmptyState';

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '—'
        : new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }).format(date);
};

const formatPaymentStatus = (status) => {
    const value = String(status || '').toLowerCase();
    if (value === 'partially paid') return 'Partially Paid';
    if (value === 'cancelled') return 'Cancelled';
    if (value === 'overdue') return 'Overdue';
    if (value === 'paid') return 'Paid';
    if (value === 'unpaid') return 'Unpaid';
    return status || 'Needs Review';
};

const paymentStatusClass = (status) => {
    const value = String(status || '').toLowerCase();
    if (value === 'paid') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (value === 'overdue') return 'border-rose-200 bg-rose-50 text-rose-800';
    if (value === 'cancelled') return 'border-slate-200 bg-slate-100 text-slate-700';
    if (value === 'partially paid' || value === 'unpaid') return 'border-amber-200 bg-amber-50 text-amber-800';
    return 'border-slate-200 bg-slate-50 text-slate-700';
};

const formatReviewReason = (reason) => {
    const value = String(reason || '').toLowerCase();
    if (value.includes('extension history')) return 'Extension records are missing or do not match the current due date.';
    if (value.includes('duplicate payment')) return 'Duplicate payment entries need checking.';
    if (value.includes('payment entries') || value.includes('payment history')) return 'Recorded payments do not match the order balance.';
    if (value.includes('after the order was settled') || value.includes('after the order was fully paid')) return 'An extension was recorded after the order was fully paid.';
    if (value.includes('due date')) return 'The due date is missing or invalid.';
    if (value.includes('cancellation date')) return 'The cancellation date is unavailable for a past-due order.';
    return reason || 'Some due-date or payment details need checking.';
};

const getFocusableElements = (element) => Array.from(element?.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
) || []).filter((node) => node.getAttribute('aria-hidden') !== 'true');

const CustomerOverdueHistoryModal = ({ onClose }) => {
    const [customers, setCustomers] = useState([]);
    const [search, setSearch] = useState('');
    const [selectedCustomerKey, setSelectedCustomerKey] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const dialogRef = useRef(null);
    const searchRef = useRef(null);
    const previousFocusRef = useRef(null);
    const onCloseRef = useRef(onClose);
    const loadedOnceRef = useRef(false);
    onCloseRef.current = onClose;

    const loadHistory = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const result = await getCustomerOverdueHistoryApi();
            setCustomers(Array.isArray(result?.customers) ? result.customers : []);
        } catch (loadError) {
            setError(loadError?.message || 'Unable to load customer overdue history.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        previousFocusRef.current = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        if (!loadedOnceRef.current) {
            loadedOnceRef.current = true;
            void loadHistory();
        }
        window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = getFocusableElements(dialogRef.current);
            if (!focusable.length) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previousFocusRef.current?.focus?.({ preventScroll: true });
        };
    }, [loadHistory]);

    const selectedCustomer = customers.find((customer) => customer.customerKey === selectedCustomerKey) || null;
    const visibleCustomers = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        if (!query || selectedCustomer) return customers;
        return customers.filter((customer) => (
            customer.customerName.toLocaleLowerCase().includes(query)
            || customer.overdueOrders.some((order) => order.creditTransactionId.toLocaleLowerCase().includes(query))
            || customer.unverifiedOrders.some((order) => order.creditTransactionId.toLocaleLowerCase().includes(query))
        ));
    }, [customers, search, selectedCustomer]);

    const matchingOrders = useMemo(() => {
        if (!selectedCustomer) return [];
        const query = search.trim().toLocaleLowerCase();
        const orders = selectedCustomer.overdueOrders || [];
        return query ? orders.filter((order) => order.creditTransactionId.toLocaleLowerCase().includes(query)) : orders;
    }, [search, selectedCustomer]);
    const matchingUnverifiedOrders = useMemo(() => {
        if (!selectedCustomer) return [];
        const query = search.trim().toLocaleLowerCase();
        const orders = selectedCustomer.unverifiedOrders || [];
        return query ? orders.filter((order) => order.creditTransactionId.toLocaleLowerCase().includes(query)) : orders;
    }, [search, selectedCustomer]);

    const closeOnBackdrop = (event) => {
        if (event.target === event.currentTarget) onClose();
    };

    const renderOrderCard = (order, needsReview = false) => (
        <article key={`${needsReview ? 'review' : 'overdue'}-${order.creditTransactionId}`} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h4 className="break-all text-sm font-semibold text-slate-900">{order.creditTransactionId || 'Credit order'}</h4>
                    <p className="mt-0.5 text-xs text-slate-500">Due {formatDate(order.dueDate)}{order.originalDueDate && formatDate(order.originalDueDate) !== formatDate(order.dueDate) ? ` · Originally due ${formatDate(order.originalDueDate)}` : ''}</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${needsReview ? 'border-amber-200 bg-amber-50 text-amber-800' : paymentStatusClass(order.paymentStatus)}`}>
                    {needsReview ? `Needs Review · ${formatPaymentStatus(order.paymentStatus)}` : formatPaymentStatus(order.paymentStatus)}
                </span>
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs sm:grid-cols-3">
                <div><dt className="text-slate-500">Order total</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(order.totalAmount)}</dd></div>
                {!needsReview && (
                    <div><dt className="text-slate-500">Payment Days Late</dt><dd className="mt-0.5 font-medium text-slate-800">{Number.isFinite(order.paymentDaysLate) ? (order.paymentDaysLate === 0 ? 'Paid on Time' : `${order.paymentDaysLate} ${order.paymentDaysLate === 1 ? 'day' : 'days'}`) : (order.paymentStatus === 'Paid' ? 'Not established' : 'Not yet fully paid')}</dd></div>
                )}
                {!needsReview && Number.isFinite(order.overdueBeforeExtensionDays) && (
                    <div><dt className="text-slate-500">Overdue Before Extension</dt><dd className="mt-0.5 font-medium text-slate-800">{order.overdueBeforeExtensionDays} {order.overdueBeforeExtensionDays === 1 ? 'day' : 'days'}</dd></div>
                )}
                {!needsReview && Number.isFinite(order.overdueAtCancellationDays) && (
                    <div><dt className="text-slate-500">Overdue at Cancellation</dt><dd className="mt-0.5 font-medium text-slate-800">{order.overdueAtCancellationDays} {order.overdueAtCancellationDays === 1 ? 'day' : 'days'}</dd></div>
                )}
                <div><dt className="text-slate-500">Paid</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(order.amountPaid)}</dd></div>
                <div><dt className="text-slate-500">Remaining</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-800">{formatCurrency(order.remainingBalance)}</dd></div>
            </dl>
            {needsReview && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">{formatReviewReason(order.reason)}</p>}
            <div className="mt-2.5 border-t border-slate-100 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recorded payment history</p>
                {order.paymentHistory?.length ? (
                    <ul className="mt-1 space-y-1">
                        {order.paymentHistory.map((payment, index) => (
                            <li key={`${order.creditTransactionId}-payment-${index}`} className="flex flex-wrap justify-between gap-x-3 text-xs text-slate-700">
                                <span>{formatDate(payment.paymentDate)} · {payment.type === 'down_payment' ? 'Down payment' : 'Payment'}</span>
                                <span className="font-medium tabular-nums">{formatCurrency(payment.amount)}</span>
                            </li>
                        ))}
                    </ul>
                ) : <p className="mt-1.5 text-xs text-slate-500">No reliable payment entries recorded.</p>}
            </div>
        </article>
    );

    return createPortal(
        <div className="app-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:p-4" onMouseDown={closeOnBackdrop}>
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="customer-overdue-history-title"
                tabIndex={-1}
                className={`flex h-screen max-h-screen h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] ${selectedCustomer ? 'sm:max-w-[720px]' : 'sm:max-w-[800px]'} sm:rounded-2xl sm:border sm:border-slate-200`}
            >
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 sm:px-5 sm:py-3">
                    <div className="min-w-0">
                        {selectedCustomer && (
                            <button type="button" onClick={() => { setSelectedCustomerKey(''); setSearch(''); }} className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
                                <span aria-hidden="true">←</span> All customers
                            </button>
                        )}
                        <h2 id="customer-overdue-history-title" className="text-base font-semibold text-slate-900 sm:text-lg">{selectedCustomer ? selectedCustomer.customerName : 'Customer Overdue History'}</h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{selectedCustomer ? 'Credit orders with confirmed overdue history and records that need review.' : 'Lifetime overdue counts are based on available due-date, extension, and payment records.'}</p>
                        {selectedCustomer?.customerIdentityUnverified && <p className="mt-1 text-xs text-amber-700">No customer record is linked; same-name orders are grouped and identity may be uncertain.</p>}
                    </div>
                    <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" aria-label="Close Customer Overdue History">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" /></svg>
                    </button>
                </header>

                <div className="shrink-0 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:px-5">
                    <label className="sr-only" htmlFor="customer-overdue-history-search">{selectedCustomer ? 'Search credit orders' : 'Search customers'}</label>
                    <div className="relative">
                        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="11" cy="11" r="7" strokeWidth="2" /><path strokeLinecap="round" strokeWidth="2" d="m16 16 4 4" /></svg>
                        <input
                            ref={searchRef}
                            id="customer-overdue-history-search"
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={selectedCustomer ? 'Search credit order ID...' : 'Search customers or credit order IDs...'}
                            className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-600 focus:ring-2 focus:ring-slate-200"
                        />
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/60 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
                    {isLoading ? (
                        <div className="space-y-3" role="status" aria-label="Loading customer overdue history">
                            {Array.from({ length: 4 }).map((_, index) => <div key={`overdue-history-skeleton-${index}`} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-rose-200 bg-white p-5 text-center">
                            <p className="text-sm font-medium text-rose-800">{error}</p>
                            <button type="button" onClick={loadHistory} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-50 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button>
                        </div>
                    ) : selectedCustomer ? (
                        search.trim() && matchingOrders.length === 0 && matchingUnverifiedOrders.length === 0 ? (
                            <ContextualEmptyState title="No matching results" description="Try a different search." actionLabel="Reset Search" onAction={() => setSearch('')} className="rounded-xl border border-slate-200 bg-white" />
                        ) : <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                <div className="rounded-xl border border-slate-200 bg-white p-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Credit Orders</p><p className="mt-0.5 text-base font-semibold text-slate-900">{selectedCustomer.totalCreditOrders}</p></div>
                                <div className="rounded-xl border border-slate-200 bg-white p-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Confirmed Overdue</p><p className="mt-0.5 text-base font-semibold text-rose-700">{selectedCustomer.lifetimeOverdueCount}</p></div>
                                <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:col-span-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Needs Review</p><p className="mt-0.5 text-base font-semibold text-amber-700">{selectedCustomer.unverifiedCount}</p></div>
                            </div>
                            <section aria-labelledby="confirmed-overdue-heading">
                                <h3 id="confirmed-overdue-heading" className="mb-2 text-sm font-semibold text-slate-900">Confirmed overdue orders ({selectedCustomer.lifetimeOverdueCount})</h3>
                                {matchingOrders.length ? <div className="space-y-2.5">{matchingOrders.map((order) => renderOrderCard(order))}</div> : <p className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-500">No confirmed overdue orders match this search.</p>}
                            </section>
                            {selectedCustomer.unverifiedCount > 0 && (
                                <section aria-labelledby="unverified-overdue-heading">
                                    <h3 id="unverified-overdue-heading" className="mb-2 text-sm font-semibold text-slate-900">Needs Review ({selectedCustomer.unverifiedCount})</h3>
                                    {matchingUnverifiedOrders.length ? <div className="space-y-2.5">{matchingUnverifiedOrders.map((order) => renderOrderCard(order, true))}</div> : <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">No records needing review match this search.</p>}
                                </section>
                            )}
                        </div>
                    ) : visibleCustomers.length ? (
                        <>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                <span>{visibleCustomers.length} customer{visibleCustomers.length === 1 ? '' : 's'}</span>
                                <span>Sorted by lifetime overdue orders</span>
                            </div>
                            <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
                                <table className="w-full table-fixed text-left text-sm">
                                    <thead className="bg-slate-900 text-xs font-semibold text-slate-50">
                                        <tr><th className="w-[31%] px-3 py-2.5">Customer Name</th><th className="w-[18%] px-2 py-2.5 text-center">Total Credit Orders</th><th className="w-[21%] px-2 py-2.5 text-center">Total Times Overdue</th><th className="w-[17%] px-2 py-2.5 text-center">Currently Overdue</th><th className="w-[13%] px-2 py-2.5 text-center">History</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {visibleCustomers.map((customer) => (
                                            <tr key={customer.customerKey} className="hover:bg-slate-50">
                                                <td className="px-3 py-2.5 font-medium text-slate-900">{customer.customerName}<span className="mt-0.5 block text-[10px] font-normal text-amber-700">{customer.unverifiedCount ? `${customer.unverifiedCount} order${customer.unverifiedCount === 1 ? '' : 's'} need review` : ''}</span>{customer.customerIdentityUnverified && <span className="mt-0.5 block text-[10px] font-normal text-slate-500">Customer record not linked</span>}</td>
                                                <td className="px-2 py-2.5 text-center tabular-nums text-slate-700">{customer.totalCreditOrders}</td>
                                                <td className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-900">{customer.lifetimeOverdueCount}</td>
                                                <td className="px-2 py-2.5 text-center tabular-nums text-rose-700">{customer.currentlyOverdueCount}</td>
                                                <td className="px-2 py-2.5 text-center"><button type="button" onClick={() => { setSelectedCustomerKey(customer.customerKey); setSearch(''); }} className="whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-50 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">View History</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="space-y-2.5 lg:hidden">
                                {visibleCustomers.map((customer) => (
                                    <article key={customer.customerKey} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-slate-900">{customer.customerName}</h3>{customer.customerIdentityUnverified && <p className="mt-0.5 text-[10px] text-slate-500">Customer record not linked</p>}</div><span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold tabular-nums text-rose-800">{customer.lifetimeOverdueCount} overdue</span></div>
                                        <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 text-xs">
                                            <div><dt className="text-slate-500">Credit Orders</dt><dd className="mt-0.5 font-semibold text-slate-800">{customer.totalCreditOrders}</dd></div>
                                            <div><dt className="text-slate-500">Currently Late</dt><dd className="mt-0.5 font-semibold text-rose-700">{customer.currentlyOverdueCount}</dd></div>
                                            <div><dt className="text-slate-500">Needs Review</dt><dd className="mt-0.5 font-semibold text-amber-700">{customer.unverifiedCount}</dd></div>
                                        </dl>
                                        <button type="button" onClick={() => { setSelectedCustomerKey(customer.customerKey); setSearch(''); }} className="mt-2.5 inline-flex rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-50 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">View History</button>
                                    </article>
                                ))}
                            </div>
                        </>
                    ) : (
                        <ContextualEmptyState
                            title={search.trim() ? 'No matching results' : 'No credit order history found'}
                            description={search.trim() ? 'Try a different search.' : 'Records needing review stay separate from confirmed overdue counts.'}
                            actionLabel={search.trim() ? 'Reset Search' : ''}
                            onAction={search.trim() ? () => setSearch('') : null}
                            className="rounded-xl border border-slate-200 bg-white"
                        />
                    )}
                </div>
            </section>
        </div>,
        document.body
    );
};

export default CustomerOverdueHistoryModal;
