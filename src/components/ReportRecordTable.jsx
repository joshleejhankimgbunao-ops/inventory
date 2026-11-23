import React, { useMemo, useState } from 'react';
import Pagination from './Pagination';
import { filterAndSortReportRows, paginateReportRows } from '../utils/reportDetailTables';
import { showToast } from '../utils/toastHelper';

const controlClass = 'h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-slate-500 focus:ring-2 focus:ring-slate-400/40';

const ReportRecordTable = ({ title, note, rows, columns, filters, loading, desktopLoading, error, desktopError = '', onRetry, showFinancials = true, onExport, mobileCardTitleKey, mobileCardSubtitleKey, mobileCardStatusKey }) => {
  const idPrefix = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const [search, setSearch] = useState('');
  const [selectedFilters, setSelectedFilters] = useState({});
  const [sortKey, setSortKey] = useState(columns[0].key);
  const [sortDirection, setSortDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exportFormat, setExportFormat] = useState('xlsx');
  const visibleRows = useMemo(() => filterAndSortReportRows(rows, {
    search, filters: selectedFilters, sortKey, sortDirection,
  }), [rows, search, selectedFilters, sortKey, sortDirection]);
  const { totalPages, currentPage, rows: pageRows } = paginateReportRows(visibleRows, page, pageSize);
  const shouldShowDesktopSkeleton = desktopLoading ?? loading;

  const changeSort = (key) => {
    setPage(1);
    if (sortKey === key) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('asc'); }
  };
  const exportRows = () => {
    try {
      onExport(visibleRows, exportFormat, { search, filters: selectedFilters });
      showToast('Export Ready', `${title} table downloaded.`, 'download', `${idPrefix}-export`);
    } catch (error) {
      showToast('Export Failed', error?.message || 'Unable to export the table.', 'error', `${idPrefix}-export`);
    }
  };
  const renderCell = (row, column) => (
    column.sensitive && !showFinancials
      ? '••••••'
      : column.render
        ? column.render(row[column.key], row)
        : row[column.key] ?? '—'
  );
  const getMobileStatusClass = (value) => {
    const normalized = String(value || '').toLowerCase();
    if (/paid|in stock|completed|fulfilled/.test(normalized)) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (/overdue|cancel|out of stock/.test(normalized)) return 'border-rose-200 bg-rose-50 text-rose-800';
    if (/partial|near|due|low|pending|reserved/.test(normalized)) return 'border-amber-200 bg-amber-50 text-amber-900';
    return 'border-slate-200 bg-slate-100 text-slate-700';
  };
  const mobileTitleColumn = columns.find((column) => column.key === mobileCardTitleKey);
  const mobileSubtitleColumn = columns.find((column) => column.key === mobileCardSubtitleKey);
  const mobileStatusColumn = columns.find((column) => column.key === mobileCardStatusKey);
  const mobileDetailColumns = columns.filter((column) => ![
    mobileCardTitleKey,
    mobileCardSubtitleKey,
    mobileCardStatusKey,
  ].includes(column.key));
  const hasMobileValue = (row, key) => {
    const value = row[key];
    return value !== null && value !== undefined
      && !(typeof value === 'string' && (!value.trim() || ['—', '–', '-'].includes(value.trim())));
  };

  return (
    <section className="min-w-0 shrink-0 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm" aria-label={title} aria-busy={loading}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="main-toolbar-search group">
            <label className="sr-only" htmlFor={`${idPrefix}-search`}>Search {title}</label>
            <input id={`${idPrefix}-search`} type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search records..." className="main-toolbar-search-input" />
            <div className="main-toolbar-search-icon" aria-hidden="true"><svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
          </div>
          {filters.map((filter) => <React.Fragment key={filter.key}>
            <label className="sr-only" htmlFor={`${idPrefix}-${filter.key}`}>{filter.label}</label>
            <select id={`${idPrefix}-${filter.key}`} value={selectedFilters[filter.key] || ''} onChange={(event) => { setSelectedFilters((current) => ({ ...current, [filter.key]: event.target.value })); setPage(1); }} className={controlClass}>
              <option value="">All {filter.label}</option>
              {filter.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </React.Fragment>)}
          <label className="sr-only" htmlFor={`${idPrefix}-export-format`}>Table export format</label>
          <select id={`${idPrefix}-export-format`} value={exportFormat} onChange={(event) => setExportFormat(event.target.value)} className={controlClass}>
            <option value="xlsx">Excel</option><option value="pdf">PDF</option>
          </select>
          <button type="button" disabled={loading || Boolean(error) || visibleRows.length === 0} onClick={exportRows} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 disabled:cursor-not-allowed disabled:opacity-50">Export Table</button>
        </div>
      </div>
      <div className="flex flex-col gap-3 bg-slate-100/70 p-2 md:hidden" aria-label={`${title} mobile records`}>
        {loading || error || visibleRows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500" role={error ? 'alert' : 'status'}>
            <p>{error || (loading ? 'Loading records…' : 'No records match the selected filters.')}</p>
            {error && onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button>}
          </div>
        ) : pageRows.map((row) => (
          <article key={`mobile-${row.id}`} className="app-dashboard-card-hover rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold leading-5 text-slate-900">{mobileTitleColumn ? renderCell(row, mobileTitleColumn) : row.id}</h3>
                {mobileSubtitleColumn && <p className="mt-0.5 break-words text-xs text-slate-500">{renderCell(row, mobileSubtitleColumn)}</p>}
              </div>
              {mobileStatusColumn && hasMobileValue(row, mobileStatusColumn.key) && (
                <span className={`max-w-[48%] shrink-0 break-words rounded-full border px-2 py-1 text-[10px] font-semibold leading-tight ${getMobileStatusClass(row[mobileStatusColumn.key])}`}>
                  {renderCell(row, mobileStatusColumn)}
                </span>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
              {mobileDetailColumns.filter((column) => hasMobileValue(row, column.key)).map((column) => (
                <div key={column.key} className={`${column.key === 'customer' || column.key === 'fulfillment' || column.key === 'name' ? 'col-span-2' : ''} min-w-0`}>
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{column.label}</dt>
                  <dd className={`mt-0.5 break-words text-xs text-slate-800 ${column.align === 'right' ? 'font-semibold tabular-nums' : ''}`}>
                    {renderCell(row, column)}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden w-full overflow-x-auto overscroll-x-contain md:block">
        <table className="main-data-table w-full min-w-[1100px] border-separate border-spacing-0 text-left text-xs">
          <thead><tr className="bg-slate-900 text-[11px] uppercase tracking-wide text-white">
            {columns.map((column) => <th key={column.key} scope="col" aria-sort={sortKey === column.key ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className={`border-r border-slate-700 px-3 py-2 font-semibold last:border-r-0 ${column.align === 'right' ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => changeSort(column.key)} className={`inline-flex w-full items-center gap-1 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${column.align === 'right' ? 'justify-end' : 'justify-start'}`}>{column.label}{sortKey === column.key ? <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span> : null}</button></th>)}
          </tr></thead>
          <tbody>
            {(loading || shouldShowDesktopSkeleton) && !error ? (
              <>
                <tr className="lg:hidden"><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500"><div role="status">Loading records…</div></td></tr>
                {shouldShowDesktopSkeleton && Array.from({ length: 7 }, (_, rowIndex) => (
                  <tr key={`desktop-report-skeleton-${rowIndex}`} className="hidden motion-safe:animate-pulse motion-reduce:animate-none lg:table-row" aria-hidden="true">
                    {columns.map((column, columnIndex) => (
                      <td key={`desktop-report-skeleton-${rowIndex}-${column.key}`} className={`border-b border-slate-200 px-3 py-3 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                        <span className={`inline-block h-3.5 rounded bg-slate-200 ${column.align === 'right' ? 'ml-auto' : ''} ${columnIndex % 3 === 0 ? 'w-3/4' : columnIndex % 3 === 1 ? 'w-2/3' : 'w-1/2'}`} />
                      </td>
                    ))}
                  </tr>
                ))}
                {!shouldShowDesktopSkeleton && visibleRows.length === 0 && <tr className="hidden lg:table-row"><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500"><div role="status">No records match the selected filters.</div></td></tr>}
                {!shouldShowDesktopSkeleton && pageRows.map((row) => <tr key={`cached-desktop-${row.id}`} className="hidden lg:table-row border-b border-slate-200 hover:bg-slate-50">{columns.map((column) => <td key={column.key} className={`border-b border-slate-200 px-3 py-2 text-slate-700 ${column.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}>{renderCell(row, column)}</td>)}</tr>)}
              </>
            ) : error ? (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500"><div role="alert"><p>{error}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button>}</div></td></tr>
            ) : desktopError ? (
              <tr className="hidden lg:table-row"><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-600"><div role="alert"><p>{desktopError}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button>}</div></td></tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500"><div role="status">No records match the selected filters.</div></td></tr>
            ) : pageRows.map((row) => <tr key={row.id} className="border-b border-slate-200 hover:bg-slate-50">{columns.map((column) => <td key={column.key} className={`border-b border-slate-200 px-3 py-2 text-slate-700 ${column.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}>{renderCell(row, column)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-600">Showing {visibleRows.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, visibleRows.length)} of {visibleRows.length} records</p>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </div>
    </section>
  );
};

export default ReportRecordTable;
