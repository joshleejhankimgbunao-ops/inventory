import React from 'react';

const Skeleton = ({ className = '' }) => (
  <div aria-hidden="true" className={`rounded-md bg-slate-200 motion-safe:animate-pulse motion-reduce:animate-none ${className}`} />
);

const StatusRegion = ({ label, className = '', children }) => (
  <div role="status" aria-label={label} aria-busy="true" className={`hidden lg:block ${className}`}>
    <span className="sr-only">Loading {label.toLowerCase()}</span>
    {children}
  </div>
);

export const DesktopMetricSkeleton = ({ className = '' }) => (
  <div role="status" aria-label="Loading report metric" aria-busy="true" className={`hidden min-w-0 flex-col gap-2 lg:flex ${className}`}>
    <span className="sr-only">Loading metric</span>
    <Skeleton className="h-[21px] w-32 max-w-full" />
    <Skeleton className="h-3 w-28 max-w-full" />
  </div>
);

export const DesktopErrorNotice = ({ message, onRetry, className = '' }) => (
  <div role="alert" className={`hidden min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 lg:flex ${className}`}>
    <span>{message}</span>
    {onRetry && <button type="button" onClick={onRetry} className="font-semibold text-slate-800 underline underline-offset-2 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">Retry</button>}
  </div>
);

export const DesktopProductGridSkeleton = () => (
  <StatusRegion label="Point of Sale products" className="w-full">
    <div aria-hidden="true" className="grid grid-cols-4 gap-4 pb-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={`pos-product-skeleton-${index}`} className="min-h-[300px] rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="mt-4 h-4 w-4/5" />
          <Skeleton className="mt-2 h-3 w-2/3" />
          <div className="mt-4 flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-5 h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  </StatusRegion>
);

export const DesktopRecommendationSkeleton = () => (
  <StatusRegion label="product recommendations" className="w-full">
    <div aria-hidden="true" className="space-y-5">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={`recommendation-skeleton-${index}`} className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[minmax(220px,34%)_minmax(0,1fr)] gap-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Skeleton className="mb-4 h-3 w-28" />
              <div className="flex items-start gap-3">
                <Skeleton className="h-16 w-16 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="mt-4 h-8 w-full rounded-lg" />
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[0, 1].map((card) => (
                  <div key={`recommendation-alternative-skeleton-${index}-${card}`} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-4/5" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                    <Skeleton className="mt-4 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-5/6" />
                    <Skeleton className="mt-4 h-8 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </StatusRegion>
);

export const DesktopAnalyticsChartSkeleton = ({ type = 'donut', className = 'h-[320px]' }) => (
  <StatusRegion label="report chart" className={`${className} min-w-0 w-full`}>
    <div aria-hidden="true" className="relative h-full w-full overflow-hidden rounded-lg bg-white">
      <div className="absolute inset-x-8 top-3 bottom-8 flex flex-col justify-between">
        {[0, 1, 2, 3].map((line) => <Skeleton key={`chart-grid-skeleton-${line}`} className="h-px w-full rounded-none" />)}
      </div>
      {type === 'bar' ? (
        <div className="absolute inset-x-5 top-3 bottom-8 flex flex-col justify-around gap-2">
          {Array.from({ length: 10 }, (_, row) => (
            <div key={`chart-bar-skeleton-${row}`} className="flex min-w-0 items-center gap-3">
              <Skeleton className={`h-2.5 ${row % 2 === 0 ? 'w-24' : 'w-20'}`} />
              <Skeleton className={`h-3.5 ${row % 3 === 0 ? 'w-3/5' : row % 3 === 1 ? 'w-2/5' : 'w-1/2'}`} />
              <Skeleton className="h-2.5 w-7 shrink-0" />
            </div>
          ))}
        </div>
      ) : type === 'vertical-bar' ? (
        <div className="absolute inset-x-8 top-5 bottom-8 flex items-end justify-around gap-3">
          {Array.from({ length: 7 }, (_, column) => (
            <div key={`chart-category-bar-skeleton-${column}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <Skeleton className={`w-5 max-w-full rounded-t-sm ${['h-[38%]', 'h-[62%]', 'h-[48%]', 'h-[78%]', 'h-[54%]', 'h-[88%]', 'h-[68%]'][column]}`} />
              <Skeleton className="h-2 w-10 max-w-full" />
            </div>
          ))}
        </div>
      ) : type === 'line' ? (
        <svg className="absolute inset-x-8 bottom-8 top-3 h-[calc(100%-2.75rem)] w-[calc(100%-4rem)]" viewBox="0 0 600 250" preserveAspectRatio="none">
          <polyline points="0,205 90,177 180,190 270,110 360,143 450,68 540,98 600,32" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-300" />
        </svg>
      ) : (
        <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border-[28px] border-slate-200">
          <div className="absolute inset-[-28px] rounded-full border-[28px] border-transparent border-t-slate-300 border-r-slate-300" />
          <Skeleton className="absolute left-1/2 top-1/2 h-3 w-16 -translate-x-1/2 -translate-y-1/2" />
        </div>
      )}
      <div className="absolute bottom-1 left-9 right-2 flex justify-between">
        {[0, 1, 2, 3, 4].map((tick) => <Skeleton key={`chart-tick-skeleton-${tick}`} className="h-2.5 w-9" />)}
      </div>
    </div>
  </StatusRegion>
);

const DashboardSkeleton = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-2"><Skeleton className="h-6 w-44" /><Skeleton className="h-3 w-32" /></div>
      <Skeleton className="h-9 w-48 rounded-lg" />
    </div>
    <div className="grid grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((card) => (
        <div key={`dashboard-kpi-skeleton-${card}`} className="min-h-28 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-3 w-28" /><Skeleton className="mt-4 h-6 w-36" /><Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
    <div className="grid grid-cols-10 gap-4">
      <div className="col-span-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex justify-between"><Skeleton className="h-4 w-36" /><Skeleton className="h-8 w-28 rounded-lg" /></div>
        <DesktopAnalyticsChartSkeleton type="line" className="h-[260px]" />
      </div>
      <div className="col-span-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <Skeleton className="mb-4 h-4 w-36" /><div className="grid h-[260px] grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((card) => <div key={`dashboard-summary-skeleton-${card}`} className="rounded-lg border border-slate-200 p-3"><Skeleton className="h-3 w-20" /><Skeleton className="mt-4 h-5 w-24" /></div>)}
        </div>
      </div>
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex justify-between"><Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-28 rounded-lg" /></div>
      {[0, 1, 2, 3].map((row) => <div key={`dashboard-table-skeleton-${row}`} className="grid grid-cols-5 gap-4 border-t border-slate-100 py-3">{[0, 1, 2, 3, 4].map((cell) => <Skeleton key={`dashboard-table-cell-${row}-${cell}`} className="h-3 w-4/5" />)}</div>)}
    </div>
  </div>
);

const DESKTOP_TABLE_COLUMNS = {
  'special orders': [
    { label: 'Reference', width: '14%' }, { label: 'Customer', width: '13%' },
    { label: 'Items', width: '14%' }, { label: 'Order Date', width: '10%' },
    { label: 'Expected Date', width: '10%' }, { label: 'Total', width: '9%' },
    { label: 'Status', width: '10%' }, { label: 'Actions', width: '20%' },
  ],
  'credit transactions': [
    { label: 'Credit ID', width: '14%' }, { label: 'Customer', width: '13%' },
    { label: 'Order Ref', width: '11%' }, { label: 'Invoice Date', width: '8%' },
    { label: 'Due Date', width: '8%' }, { label: 'Extension Period', width: '7%' },
    { label: 'Total Amount', width: '10%' }, { label: 'Status', width: '6%' },
    { label: 'Processed By', width: '8%' }, { label: 'Actions', width: '10%' },
  ],
  inventory: [
    { label: 'SKU', width: '14%' }, { label: 'Photo', width: '8%' },
    { label: 'Product', width: '23%' }, { label: 'Category', width: '13%' },
    { label: 'Current Stock', width: '12%', align: 'left' },
    { label: 'Status', width: '9%' }, { label: 'Actions', width: '21%' },
  ],
  'history logs': [
    { label: 'Transaction ID', width: '13%' }, { label: 'Date & Time', width: '17%' },
    { label: 'Processed By', width: '14%' }, { label: 'Items', width: '13%' },
    { label: 'Total Amount', width: '16%' }, { label: 'Payment Method', width: '13%' },
    { label: 'Action', width: '14%' },
  ],
  reports: [
    { label: 'Transaction Date', width: '13%', align: 'left' }, { label: 'Transaction ID', width: '14%', align: 'left' },
    { label: 'Customer', width: '12%', align: 'left' }, { label: 'Sales Type', width: '10%', align: 'left' },
    { label: 'Total Amount (₱)', width: '11%', align: 'right' },
    { label: 'Amount Paid (₱)', width: '11%', align: 'right' },
    { label: 'Remaining Balance (₱)', width: '12%', align: 'right' },
    { label: 'Payment Status', width: '9%', align: 'left' }, { label: 'Fulfillment / Closure', width: '8%', align: 'left' },
  ],
  'user list': [
    { label: 'ID', width: '8%' }, { label: 'Name', width: '19%' },
    { label: 'Contact Info', width: '19%' }, { label: 'Role', width: '14%' },
    { label: 'Account Status', width: '13%' }, { label: 'Last Login', width: '14%' },
    { label: 'Actions', width: '13%' },
  ],
};

const getDesktopTableColumns = (page, showProductActions) => {
  const normalizedPage = String(page || '').toLowerCase();
  if (normalizedPage.includes('product master list')) {
    return showProductActions
      ? [
          { label: 'SKU', width: '9%' }, { label: 'Photo', width: '8%' },
          { label: 'Product', width: '21%' }, { label: 'Variants', width: '11%' },
          { label: 'Category', width: '17%' }, { label: 'Price', width: '17%' },
          { label: 'Stock', width: '10%' }, { label: 'Actions', width: '13%' },
        ]
      : [
          { label: 'SKU', width: '10%' }, { label: 'Photo', width: '9%' },
          { label: 'Product', width: '22%' }, { label: 'Variants', width: '12%' },
          { label: 'Category', width: '18%' }, { label: 'Price', width: '19%' },
          { label: 'Stock', width: '10%' },
        ];
  }
  const match = Object.keys(DESKTOP_TABLE_COLUMNS).find((key) => normalizedPage.includes(key));
  return match ? DESKTOP_TABLE_COLUMNS[match] : null;
};

const getDesktopTableMinWidth = (page) => {
  const normalizedPage = String(page || '').toLowerCase();
  if (normalizedPage.includes('reports') || normalizedPage.includes('user list')) return '1100px';
  if (normalizedPage.includes('product master list')) return '1000px';
  if (normalizedPage.includes('credit transactions')) return '980px';
  if (normalizedPage.includes('inventory')) return '820px';
  if (normalizedPage.includes('history logs') || normalizedPage.includes('special orders')) return undefined;
  return '900px';
};

const TablePageSkeleton = ({ page, showProductActions }) => {
  const knownColumns = getDesktopTableColumns(page, showProductActions);
  const minTableWidth = getDesktopTableMinWidth(page);
  const columns = knownColumns || Array.from({ length: 6 }, (_, index) => ({
    label: '',
    width: `${100 / 6}%`,
    key: `generic-column-${index}`,
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-end justify-between gap-6"><div className="space-y-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-3 w-64" /></div><div className="flex gap-2"><Skeleton className="h-9 w-56 rounded-lg" /><Skeleton className="h-9 w-28 rounded-lg" /><Skeleton className="h-9 w-24 rounded-lg" /></div></div>
      <div className="overflow-x-auto">
        <table style={minTableWidth ? { minWidth: minTableWidth } : undefined} className="w-full table-fixed border-separate border-spacing-0 text-left">
          {knownColumns && <thead>
            <tr className="bg-slate-900 text-[11px] uppercase tracking-wider text-white">
              {columns.map((column) => (
                <th key={column.label} scope="col" style={{ width: column.width }} className={`border border-slate-700 px-2 py-2 font-semibold ${column.align === 'right' ? 'text-right' : column.align === 'left' ? 'text-left' : 'text-center'}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>}
          <tbody aria-hidden="true">
            {Array.from({ length: 7 }, (_, row) => (
              <tr key={`table-row-skeleton-${row}`} className="motion-safe:animate-pulse">
                {columns.map((column, cell) => (
                  <td key={`table-cell-skeleton-${row}-${cell}`} style={{ width: column.width }} className="border-b border-slate-100 px-3 py-2.5">
                    <Skeleton className={`h-3.5 ${column.align === 'right' ? 'ml-auto' : column.align === 'left' ? '' : 'mx-auto'} ${['w-2/3', 'w-4/5', 'w-1/2'][(row + cell) % 3]}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CardGridSkeleton = () => (
  <div className="grid grid-cols-3 items-start gap-4">
    {[0, 1, 2, 3, 4, 5].map((card) => <div key={`directory-card-skeleton-${card}`} className="min-h-44 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-3 h-3 w-1/3" /><div className="mt-6 space-y-3">{[0, 1, 2].map((line) => <Skeleton key={`directory-line-${card}-${line}`} className="h-3 w-full" />)}</div></div>)}
  </div>
);

export const DesktopPageSkeleton = ({ page = 'Dashboard', showProductActions = false }) => {
  const normalizedPage = String(page).toLowerCase();
  const isPointOfSale = normalizedPage.includes('point of sale') || normalizedPage === 'pos';
  const isRecommendation = normalizedPage.includes('recommendation');
  const isPartners = normalizedPage.includes('partner');
  const isReports = normalizedPage.includes('report');
  const isDashboard = normalizedPage.includes('dashboard');

  return (
    <div role="status" aria-busy="true" aria-label={`Loading ${page}`} className="mx-auto hidden w-full max-w-[1600px] space-y-5 p-5 xl:p-6 lg:block">
      <span className="sr-only">Loading {page.toLowerCase()}</span>
      {isPointOfSale ? (
        <>
          <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-6 w-44" /><Skeleton className="h-3 w-64" /></div><Skeleton className="h-10 w-64 rounded-lg" /></div>
          <DesktopProductGridSkeleton />
        </>
      ) : isRecommendation ? (
        <>
          <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-6 w-52" /><Skeleton className="h-3 w-72" /></div><div className="flex gap-3"><Skeleton className="h-9 w-64 rounded-lg" /><Skeleton className="h-9 w-32 rounded-lg" /></div></div>
          <DesktopRecommendationSkeleton />
        </>
      ) : isPartners ? (
        <>
          <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-6 w-52" /><Skeleton className="h-3 w-32" /></div><div className="flex gap-3"><Skeleton className="h-9 w-60 rounded-lg" /><Skeleton className="h-9 w-32 rounded-lg" /></div></div>
          <CardGridSkeleton />
        </>
      ) : isReports ? (
        <>
          <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-6 w-36" /><Skeleton className="h-3 w-64" /></div><Skeleton className="h-9 w-72 rounded-lg" /></div>
          <div className="grid grid-cols-4 gap-4">{[0, 1, 2, 3].map((card) => <div key={`report-kpi-skeleton-${card}`} className="min-h-28 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-6 w-36" /><Skeleton className="mt-2 h-3 w-28" /></div>)}</div>
          <div className="grid grid-cols-2 gap-4">{[0, 1].map((chart) => <div key={`report-chart-card-skeleton-${chart}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><Skeleton className="mb-4 h-4 w-40" /><DesktopAnalyticsChartSkeleton type={chart ? 'donut' : 'line'} /></div>)}</div>
          <TablePageSkeleton page={page} showProductActions={showProductActions} />
        </>
      ) : isDashboard ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-56" /></div><div className="flex gap-3"><Skeleton className="h-9 w-56 rounded-lg" /><Skeleton className="h-9 w-32 rounded-lg" /></div></div>
          <TablePageSkeleton page={page} showProductActions={showProductActions} />
        </>
      )}
    </div>
  );
};
