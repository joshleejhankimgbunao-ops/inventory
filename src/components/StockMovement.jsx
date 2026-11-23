import { useEffect, useRef, useState } from 'react';
import { getStockMovementApi } from '../services/dashboardApi';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import { formatNumber } from '../utils/numberFormat';
import { getStockMovementReasonSummary } from '../utils/stockMovementReasonSummary';

const TABS = [
    { key: 'fast', label: 'Fast Moving', description: 'At least 0.25 of the SKU selling unit sold per observed day.', accent: 'bg-green-50 text-green-700', path: 'M3 17l6-6 4 4 8-10m-6 0h6v6' },
    { key: 'slow', label: 'Slow Moving', description: 'Positive velocity below 0.25 of the SKU selling unit per observed day.', accent: 'bg-amber-50 text-amber-700', path: 'M3 12h18m-5-5 5 5-5 5' },
    { key: 'nonMoving', label: 'Non-Moving', description: 'No eligible sales with a full observation window and reliable stock history.', accent: 'bg-red-50 text-red-700', path: 'M3 7l6 6 4-4 8 10m-6 0h6v-6' },
];
const INSUFFICIENT_TAB = { key: 'insufficientHistory', label: 'Insufficient History', description: 'These SKUs need more reliable observation or stock history before classification.' };
const TAB_OPTIONS = [...TABS, INSUFFICIENT_TAB];
const quantity = (value, unit) => <><span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{Number.isFinite(value) ? formatNumber(value, { maximumFractionDigits: 20 }) : '—'}</span>{Number.isFinite(value) && unit && <span className="ml-1 text-[11px] font-normal text-slate-600 dark:text-slate-400">{unit}</span>}</>;
const velocity = (value, unit) => value == null ? '—' : `${formatNumber(value, { maximumFractionDigits: 2 })} ${unit || 'units'} / day`;

const StockMovement = () => {
    const [category, setCategory] = useState('');
    const query = new URLSearchParams(category ? { category } : {}).toString();
    const [state, setState] = useState({ query: '', status: 'loading' });
    const [tab, setTab] = useState('fast');
    const [page, setPage] = useState({ key: '', index: 0 });
    const [retry, setRetry] = useState(0);
    const tabRefs = useRef([]);
    useEffect(() => {
        let active = true;
        let controller;
        let sequence = 0;
        let inFlight = false;
        let refreshPending = false;
        const load = async () => {
            // A committed sale may publish both sale and inventory events.
            // Share the current request and perform at most one trailing refresh.
            if (inFlight) { refreshPending = true; return; }
            inFlight = true;
            const request = ++sequence;
            controller = new AbortController();
            setState((previous) => ({ ...previous, query, status: 'loading' }));
            try {
                const data = await getStockMovementApi(query, controller.signal);
                if (active && request === sequence && !refreshPending) setState({ query, status: 'ready', data });
            } catch {
                if (active && request === sequence && !refreshPending) setState((previous) => ({ ...previous, query, status: 'error' }));
            } finally {
                inFlight = false;
                if (active && refreshPending) { refreshPending = false; load(); }
            }
        };
        load();
        const unsubscribe = ['sale.created', 'sale.updated', 'inventory.updated', 'inventory.logged', 'realtime.resync'].map((event) => subscribeRealtimeEvent(event, load));
        return () => { active = false; controller?.abort(); unsubscribe.forEach((stop) => stop()); };
    }, [query, retry]);
    const status = state.query !== query ? 'loading' : state.status;
    const data = status === 'ready' ? state.data : null;
    const categories = state.data?.categories || [];
    const insufficientReasonSummary = data ? getStockMovementReasonSummary(data.insufficientHistory.entries) : [];
    const entries = data?.[tab].entries || [];
    const pageKey = `${query}:${tab}`;
    const currentPage = page.key === pageKey ? Math.min(page.index, Math.max(0, Math.ceil(entries.length / 5) - 1)) : 0;
    const visible = entries.slice(currentPage * 5, currentPage * 5 + 5);
    const activeTab = TAB_OPTIONS.find((item) => item.key === tab);
    const hasProducts = data && ['fast', 'slow', 'nonMoving', 'insufficientHistory'].some((key) => data[key].count > 0);
    const emptyMessage = !hasProducts
        ? 'No active products are available for Stock Movement.'
        : data?.qualifyingUnitsRecorded === 0 && tab !== 'nonMoving' && tab !== 'insufficientHistory'
            ? 'No eligible sales recorded in the last 30 days.'
            : `No ${activeTab.label.toLowerCase()} SKUs for the last 30 days.`;
    const selectTab = (index) => { setTab(TAB_OPTIONS[index].key); tabRefs.current[index]?.focus(); };
    const keyDown = (event, index) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? TAB_OPTIONS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TAB_OPTIONS.length) % TAB_OPTIONS.length);
    };
    return (
        <section aria-labelledby="stock-movement-heading" className="stock-movement w-full min-w-0 shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-4 px-4 py-3 xl:grid-cols-[minmax(230px,1fr)_minmax(0,1.5fr)] xl:items-center">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 id="stock-movement-heading" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Stock Movement</h3>
                            <p className="mt-0.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">Based on the last 30 days</p>
                        </div>
                        <select aria-label="Stock movement category" value={category} onChange={(event) => { setCategory(event.target.value); setPage({ key: '', index: 0 }); }} className="min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[12px] text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                            <option value="">All Categories</option>
                            {category && !categories.some((item) => item.id === category) && <option value={category}>Selected category unavailable</option>}
                            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </div>
                    <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">{activeTab.description}</p>
                    <div role="tablist" aria-label="Stock movement" className="analytics-tabs mt-3 grid w-full grid-cols-2 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 sm:flex sm:w-fit">
                        {TAB_OPTIONS.map((item, index) => <button ref={(element) => { tabRefs.current[index] = element; }} id={`movement-tab-${item.key}`} key={item.key} type="button" role="tab" aria-selected={tab === item.key} aria-controls="movement-panel" tabIndex={tab === item.key ? 0 : -1} onKeyDown={(event) => keyDown(event, index)} onClick={() => setTab(item.key)} className={`analytics-tab min-w-0 rounded-md border border-transparent px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 ${tab === item.key ? 'analytics-tab-active bg-gray-900 font-semibold text-white' : 'analytics-tab-inactive font-medium text-slate-600 hover:bg-gray-200/70 hover:text-slate-900'}`}>{item.label}</button>)}
                    </div>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3" aria-label="Movement summary">
                    {TABS.map((item) => <div key={item.key} className="app-dashboard-card-hover relative flex min-w-0 items-center justify-between gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-3 shadow-sm sm:px-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="min-w-0"><p className="text-[12px] font-medium leading-tight text-slate-600 sm:text-[13px] dark:text-slate-300">{item.label}</p><p className="mt-1.5 text-[22px] font-semibold leading-tight text-gray-900 sm:text-2xl dark:text-slate-100">{data ? formatNumber(data[item.key].count) : '—'}</p></div>
                        <span className={`absolute bottom-3 right-2 inline-flex rounded-md p-1 sm:static sm:rounded-lg sm:p-2 ${item.accent}`}><svg className="h-3 w-3 sm:h-5 sm:w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d={item.path} /></svg></span>
                    </div>)}
                </div>
            </div>
            <div id="movement-panel" role="tabpanel" aria-labelledby={`movement-tab-${tab}`} aria-busy={status === 'loading'} className="border-t border-slate-100 dark:border-slate-700">
                {status === 'loading' && <p role="status" className="px-4 py-8 text-center text-[13px] text-slate-600">Loading stock movement…</p>}
                {status === 'error' && <div role="alert" className="px-4 py-6 text-center text-[13px] text-slate-700"><p>Stock movement is unavailable right now. Please try again.</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button></div>}
                {data && <>
                    <div className="overflow-x-auto">
                        <table className="w-full table-fixed text-left text-[13px]">
                            <colgroup><col className="w-[50%]" /><col className="w-[25%]" /><col className="w-[25%]" /></colgroup>
                            <thead className="border-b border-slate-700 bg-slate-900 text-[12px] font-semibold text-white"><tr><th scope="col" className="px-3 py-2.5 font-semibold">Product</th><th scope="col" className="px-3 py-2.5 font-semibold">Units Sold / Velocity</th><th scope="col" className="px-3 py-2.5 font-semibold">Current Stock</th></tr></thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {visible.map((item) => <tr key={item.id} className="bg-white text-slate-700 hover:bg-slate-50/80 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60"><td className="px-3 py-2.5 align-middle"><p className="break-words text-[13px] font-semibold text-slate-900 dark:text-slate-100">{item.name || item.sku || item.code || 'Unnamed product'}</p>{[item.brand, item.color, item.size].filter(Boolean).length > 0 && <p className="mt-0.5 break-words text-[12px] text-slate-600 dark:text-slate-400">{[item.brand, item.color, item.size].filter(Boolean).join(' · ')}</p>}<p className="mt-0.5 break-all text-[12px] text-slate-600 dark:text-slate-400">{item.sku}</p>{tab === 'insufficientHistory' && <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">{item.reason}</p>}</td><td className="px-3 py-2.5 align-middle">{quantity(item.unitsSold, item.sellingUnit)}<p className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{velocity(item.salesVelocity, item.sellingUnit)}</p></td><td className="px-3 py-2.5 align-middle">{quantity(item.currentStock, item.sellingUnit)}</td></tr>)}
                                {!visible.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-[13px] text-slate-600">{emptyMessage}</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    {entries.length > 5 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700"><span>{currentPage * 5 + 1}–{Math.min((currentPage + 1) * 5, entries.length)} of {formatNumber(entries.length)} SKUs</span><div className="flex gap-2">{['Previous', 'Next'].map((label, index) => <button key={label} type="button" disabled={index === 0 ? currentPage === 0 : (currentPage + 1) * 5 >= entries.length} onClick={() => setPage({ key: pageKey, index: currentPage + (index === 0 ? -1 : 1) })} className="rounded-md border border-slate-300 px-2 py-1 font-medium hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800">{label}</button>)}</div></div>}
                    {data.insufficientHistory.count > 0 && <div role="status" className="border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[12px] text-slate-700 sm:text-[13px] dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300"><p className="font-medium">{formatNumber(data.insufficientHistory.count)} {data.insufficientHistory.count === 1 ? 'SKU needs' : 'SKUs need'} review:</p><ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{insufficientReasonSummary.map(({ label, count }) => <li key={label}><span className="font-medium">{label}:</span> {formatNumber(count)}</li>)}</ul></div>}
                </>}
            </div>
        </section>
    );
};

export default StockMovement;
