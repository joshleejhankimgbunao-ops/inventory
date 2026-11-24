/* global require, __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  areTopSellingProductRowsStable,
  buildDashboardSalesByCategory,
  buildDashboardTopSellingProducts,
  getBoundedChartTooltipPosition,
  wrapDashboardCategoryLabel,
} = require('../../src/utils/dashboardOverviewCharts.mjs');

test('top products rank by recorded line revenue and retain units separately per SKU', () => {
  const products = buildDashboardTopSellingProducts([
    { items: [
      { code: 'SKU-1', name: 'Historic name', sellingUnit: 'pcs', qty: 7, price: 10, subtotal: 70 },
      { code: 'SKU-1', name: 'Historic name', sellingUnit: 'box', qty: 2, price: 80, subtotal: 160 },
      { code: 'SKU-2', name: 'Second product', sellingUnit: 'bag', qty: 5, price: 25, subtotal: 125 },
      { code: 'SKU-3', name: 'No units', sellingUnit: 'can', qty: 0, price: 20, subtotal: 0 },
    ] },
  ], [
    { code: 'SKU-1', name: 'Current product name' },
  ]);

  assert.deepEqual(products.map(({ code, name, sellingUnit, revenue, unitsSoldByUnit }) => ({ code, name, sellingUnit, revenue, unitsSoldByUnit })), [
    { code: 'SKU-1', name: 'Historic name', sellingUnit: '', revenue: 230, unitsSoldByUnit: [{ sellingUnit: 'box', quantity: 2 }, { sellingUnit: 'pcs', quantity: 7 }] },
    { code: 'SKU-2', name: 'Second product', sellingUnit: 'bag', revenue: 125, unitsSoldByUnit: [{ sellingUnit: 'bag', quantity: 5 }] },
  ]);
  assert.deepEqual(buildDashboardTopSellingProducts([], []), []);
});

test('category axis labels keep short names on one line and cap long names at two lines', () => {
  assert.deepEqual(wrapDashboardCategoryLabel('Uncategorized', 14, 2), ['Uncategorized']);
  assert.deepEqual(wrapDashboardCategoryLabel('Cement, Sand & Gravel', 14, 2), ['Cement, Sand &', 'Gravel']);
  const longLabel = wrapDashboardCategoryLabel('Construction Materials and General Hardware Supplies', 14, 2);
  assert.equal(longLabel.length, 2);
  assert.ok(longLabel[1].endsWith('…'));
});

test('top product ranking is revenue-based and capped to the requested number of SKUs', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    code: `SKU-${index}`,
    name: `Product ${index}`,
    sellingUnit: 'pcs',
    qty: 20 - index,
    price: index + 1,
    subtotal: (index + 1) * 10,
  }));

  assert.deepEqual(buildDashboardTopSellingProducts([{ items }], [], 5).map(({ revenue, unitsSoldByUnit }) => [revenue, unitsSoldByUnit[0].quantity]), [
    [70, 14], [60, 15], [50, 16], [40, 17], [30, 18],
  ]);
});

test('top ten aggregation uses recorded sale subtotals rather than current product prices', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    code: `SKU-${String(index + 1).padStart(2, '0')}`,
    name: 'Same Product Name',
    sellingUnit: 'pcs',
    qty: index === 0 ? 100 : 1,
    price: 9999,
    subtotal: (12 - index) * 100,
  }));
  const inventory = items.map(({ code }) => ({ code, name: 'Current Product Name', price: 50000 }));
  const products = buildDashboardTopSellingProducts([{ items }], inventory, 10);

  assert.equal(products.length, 10);
  assert.deepEqual(products.slice(0, 3).map(({ code, revenue, unitsSoldByUnit }) => ({
    code,
    revenue,
    unitsSold: unitsSoldByUnit[0].quantity,
  })), [
    { code: 'SKU-01', revenue: 1200, unitsSold: 100 },
    { code: 'SKU-02', revenue: 1100, unitsSold: 1 },
    { code: 'SKU-03', revenue: 1000, unitsSold: 1 },
  ]);
  assert.equal(products.some(({ code }) => code === 'SKU-12'), false);
  assert.equal(new Set(products.map(({ code }) => code)).size, 10);
  assert.ok(products.every(({ name }) => name === 'Same Product Name'));
});

test('sales API preserves the saved sale-line subtotal and transaction-time unit price for chart aggregation', () => {
  const saleController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/saleController.js'), 'utf8');
  const saleModel = fs.readFileSync(path.resolve(__dirname, '../src/models/Sale.js'), 'utf8');

  assert.match(saleModel, /subtotal:\s*\{\s*type: Number,\s*required: true,\s*min: 0/);
  assert.match(saleController, /price: Number\(item\.unitPrice \|\| 0\)/);
  assert.match(saleController, /subtotal: Number\(item\.subtotal \|\| 0\)/);
});

test('top-selling bar animation is limited to unchanged product rows and order', () => {
  const previousRows = [
    { code: 'SKU-1', name: 'First', sellingUnit: 'pcs', revenue: 70, unitsSoldByUnit: [{ sellingUnit: 'pcs', quantity: 7 }] },
    { code: 'SKU-2', name: 'Second', sellingUnit: 'box', revenue: 40, unitsSoldByUnit: [{ sellingUnit: 'box', quantity: 4 }] },
  ];

  assert.equal(areTopSellingProductRowsStable(previousRows, [
    { ...previousRows[0], revenue: 50, unitsSoldByUnit: [{ sellingUnit: 'pcs', quantity: 5 }] },
    { ...previousRows[1], revenue: 20, unitsSoldByUnit: [{ sellingUnit: 'box', quantity: 2 }] },
  ]), true);
  assert.equal(areTopSellingProductRowsStable(previousRows, [...previousRows].reverse()), false);
  assert.equal(areTopSellingProductRowsStable(previousRows, [...previousRows, { code: 'SKU-3' }]), false);
});

test('top-selling tooltip placement follows pointer anchors and flips or clamps at chart edges', () => {
  const first = getBoundedChartTooltipPosition({ anchorX: 210, anchorY: 28, containerWidth: 600, containerHeight: 320 });
  const middle = getBoundedChartTooltipPosition({ anchorX: 300, anchorY: 145, containerWidth: 600, containerHeight: 320 });
  const last = getBoundedChartTooltipPosition({ anchorX: 590, anchorY: 300, containerWidth: 600, containerHeight: 320 });
  const narrow = getBoundedChartTooltipPosition({ anchorX: 300, anchorY: 150, containerWidth: 360, containerHeight: 280, tooltipWidth: 156, minX: 196 });

  assert.deepEqual(first, { x: 222, y: 40, width: 224 });
  assert.deepEqual(middle, { x: 312, y: 157, width: 224 });
  assert.deepEqual(last, { x: 354, y: 220, width: 224 });
  assert.deepEqual(narrow, { x: 196, y: 162, width: 156 });

  for (const position of [first, middle, last, narrow]) {
    assert.ok(position.x >= 8);
    assert.ok(position.y >= 8);
    assert.ok(position.x + position.width <= (position === narrow ? 352 : 592));
    assert.ok(position.y + 68 <= (position === narrow ? 272 : 312));
  }
});

test('category revenue preserves current product-first mapping and the Uncategorized fallback', () => {
  const categories = buildDashboardSalesByCategory([
    { items: [
      { code: 'SKU-1', category: 'Historical Category', qty: 2, price: 100 },
      { code: 'SKU-2', category: 'Snapshot Category', qty: 1, price: 50 },
      { code: 'SKU-3', qty: 1, price: 20 },
      { code: 'SKU-4', category: 'No revenue', qty: 0, price: 10 },
    ] },
  ], [
    { code: 'SKU-1', category: 'Current Category' },
    { code: 'SKU-2', category: '' },
  ]);

  assert.deepEqual(categories, [
    { name: 'Current Category', value: 200 },
    { name: 'Snapshot Category', value: 50 },
    { name: 'Uncategorized', value: 20 },
  ]);
});

test('Dashboard charts use the existing filtered sales sets and bar charts without percentage legends', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');

  assert.match(dashboard, /transactionsForTopProducts\.filter\(isSalePhysicallyFulfilledForItemReporting\)/);
  assert.match(dashboard, /buildDashboardTopSellingProducts\([\s\S]*?processedInventory,[\s\S]*?10/);
  assert.match(dashboard, /topProducts\.slice\(0, 5\)/);
  assert.match(dashboard, /buildDashboardSalesByCategory\(selectedDateTransactions, processedInventory\)/);
  assert.match(dashboard, /\['products', 'Top Selling Products'\]/);
  assert.match(dashboard, /<BarChart data=\{topSellingBarData\} layout="vertical"/);
  assert.match(dashboard, /dataKey="revenue"/);
  assert.match(dashboard, /<BarChart data=\{salesByCategory\}/);
  assert.match(dashboard, /formatCurrency\} fill="#334155"/);
  assert.doesNotMatch(dashboard, /PieChart|topSellingPieData|ANALYTICS_PIE_COLORS/);
});

test('Top-Selling Products and Sales by Category share the same bar and active colors', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const topSellingChart = dashboard.slice(dashboard.indexOf('<BarChart data={topSellingBarData}'), dashboard.indexOf(': (salesByCategory.length > 0'));
  const salesByCategoryChartStart = dashboard.indexOf('<BarChart data={salesByCategory}');
  const salesByCategoryChart = dashboard.slice(salesByCategoryChartStart, dashboard.indexOf('</BarChart>', salesByCategoryChartStart));

  const chartStyles = fs.readFileSync(path.resolve(__dirname, '../../src/utils/analyticsChart.js'), 'utf8');
  assert.match(chartStyles, /const DASHBOARD_BAR_COLOR = '#334155'/);
  assert.match(chartStyles, /const DASHBOARD_BAR_ACTIVE_COLOR = '#475569'/);
  assert.match(topSellingChart, /fill=\{DASHBOARD_BAR_COLOR\}/);
  assert.match(topSellingChart, /activeBar=\{\{ fill: DASHBOARD_BAR_ACTIVE_COLOR \}\}/);
  assert.match(salesByCategoryChart, /cursor=\{false\}/);
  assert.match(salesByCategoryChart, /<Bar dataKey="value" fill=\{DASHBOARD_BAR_COLOR\} activeBar=\{\{ fill: DASHBOARD_BAR_ACTIVE_COLOR \}\}/);
});

test('top products chart shows revenue labels with compact unit details and a revenue tooltip', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const tooltip = dashboard.slice(dashboard.indexOf('const TopSellingProductsTooltip'), dashboard.indexOf('const SalesByCategoryTooltip'));
  const label = dashboard.slice(dashboard.indexOf('const ProductRevenueBarLabel'), dashboard.indexOf('const formatCompactCurrency'));
  const chartData = dashboard.slice(dashboard.indexOf('const topSellingBarData'), dashboard.indexOf('// Full merchandise value'));

  assert.match(chartData, /displayName: nameCounts\.get[\s\S]*?product\.name/);
  assert.match(chartData, /value: product\.revenue/);
  assert.match(dashboard, /truncateAxisLabel = \(value, maxCharacters = 30\)/);
  assert.match(dashboard, /const TOP_SELLING_LABEL_WIDTH = 164/);
  assert.match(dashboard, /width=\{TOP_SELLING_LABEL_WIDTH\} tickMargin=\{3\}/);
  assert.match(dashboard, /const textX = x - 4/);
  assert.match(label, /\{formatCurrency\(value\)\}/);
  assert.match(tooltip, /Units Sold: \{unitsSold\}/);
  assert.match(tooltip, /Sales Revenue: \{formatCurrency\(revenue\)\}/);
  assert.match(dashboard, /formatTopProductUnits\(product\?\.unitsSoldByUnit\)/);
  assert.doesNotMatch(`${tooltip}${label}${chartData}`, /unit not recorded/);
});

test('dashboard bar charts use compact axes and avoid unnecessary category overflow', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const topChart = dashboard.slice(dashboard.indexOf('<BarChart data={topSellingBarData}'), dashboard.indexOf(': (salesByCategory.length > 0'));
  const categoryTickStart = dashboard.indexOf('const CategoryAxisTick');
  const categoryTick = dashboard.slice(categoryTickStart, dashboard.indexOf('const ProductRevenueBarLabel', categoryTickStart));
  const categoryChartStart = dashboard.indexOf('<BarChart data={salesByCategory}');
  const categoryChart = dashboard.slice(categoryChartStart, dashboard.indexOf('</BarChart>', categoryChartStart));
  const categoryContainerStart = dashboard.lastIndexOf('<div className="h-full w-full overflow-x-auto', categoryChartStart);
  const categoryContainer = dashboard.slice(categoryContainerStart, categoryChartStart);

  assert.match(dashboard, /const CATEGORY_MIN_ITEM_WIDTH = 88/);
  assert.match(dashboard, /const CATEGORY_AXIS_HEIGHT = 38/);
  assert.match(dashboard, /wrapDashboardCategoryLabel\(name, 14, 2\)/);
  assert.match(topChart, /margin=\{\{ top: 8, right: 104, bottom: 4, left: 0 \}\}/);
  assert.match(categoryContainer, /minWidth: `max\(100%, \$\{salesByCategory\.length \* CATEGORY_MIN_ITEM_WIDTH\}px\)`/);
  assert.doesNotMatch(categoryContainer, /Math\.max\(360|\* 108/);
  assert.match(categoryChart, /margin=\{\{ top: 14, right: 8, bottom: 0, left: 0 \}\}/);
  assert.match(categoryChart, /tickMargin=\{2\}/);
  assert.match(categoryChart, /height=\{CATEGORY_AXIS_HEIGHT\}/);
  assert.match(categoryTick, /dy=\{index === 0 \? 0 : 10\}/);
});

test('category chart measures before first paint and reserves clear space for its scrollbar', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const categoryLayoutEffect = dashboard.slice(
    dashboard.indexOf('useLayoutEffect(() => {', dashboard.indexOf('const categoryYAxisWidth')),
    dashboard.indexOf('const handleSalesChartPointerMove')
  );
  const categoryContainerStart = dashboard.indexOf('<div className="h-full w-full overflow-x-auto overflow-y-hidden overscroll-x-contain">');
  const categoryContainer = dashboard.slice(categoryContainerStart, dashboard.indexOf('</BarChart>', categoryContainerStart));

  assert.match(dashboard, /const CATEGORY_SCROLLBAR_CLEARANCE = 16/);
  assert.match(categoryLayoutEffect, /categoryChartContainerRef\.current/);
  assert.match(categoryLayoutEffect, /getBoundingClientRect\(\)/);
  assert.match(categoryLayoutEffect, /height: Math\.round\(height - CATEGORY_SCROLLBAR_CLEARANCE\)/);
  assert.match(categoryContainer, /paddingBottom: CATEGORY_SCROLLBAR_CLEARANCE/);
  assert.match(categoryContainer, /categoryChartInitialDimension &&/);
  assert.match(categoryContainer, /initialDimension=\{categoryChartInitialDimension\}/);
  assert.doesNotMatch(categoryContainer, /ResponsiveContainer[^>]*debounce=/);
});

test('top-selling chart uses row-based axis hover and a single cursor-following tooltip', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const chart = dashboard.slice(dashboard.indexOf('<BarChart data={topSellingBarData}'), dashboard.indexOf(': (salesByCategory.length > 0'));
  const chartPointerHandler = dashboard.slice(dashboard.indexOf('const handleTopSellingChartPointerMove'), dashboard.indexOf('const handleTopSellingChartResize'));

  assert.match(chart, /shared\s+cursor=\{false\}/);
  assert.doesNotMatch(chart, /shared=\{false\}/);
  assert.match(chart, /cursor=\{false\}/);
  assert.match(chart, /isAnimationActive=\{false\}/);
  assert.match(chart, /allowEscapeViewBox=\{\{ x: false, y: false \}\}/);
  assert.match(chart, /wrapperStyle=\{\{ zIndex: 20, pointerEvents: 'none' \}\}/);
  assert.match(chart, /activeBar=\{\{ fill: DASHBOARD_BAR_ACTIVE_COLOR \}\}/);
  assert.doesNotMatch(chart, /position=\{/);
  assert.doesNotMatch(chart, /onMouseEnter=\{positionTopSellingTooltip\}|onMouseLeave=\{clearTopSellingTooltipPosition\}/);
  assert.match(dashboard, /activeAnalyticsView === 'products' \? handleTopSellingChartPointerMove/);
  assert.match(dashboard, /activeAnalyticsView === 'products' \? clearTopSellingTooltipPosition/);
  assert.match(chartPointerHandler, /querySelector\('\.recharts-wrapper'\)/);
  assert.match(chartPointerHandler, /event\.clientX - chartRect\.left/);
  assert.match(chartPointerHandler, /event\.clientY - chartRect\.top/);
  assert.match(chartPointerHandler, /Object\.assign\(topSellingTooltipPositionRef\.current/);
  assert.match(chartPointerHandler, /topSellingTooltipAnchorRef\.current = \{/);
  assert.match(chartPointerHandler, /scheduleTopSellingTooltipPosition\(\)/);
  assert.doesNotMatch(chartPointerHandler, /setTopSellingTooltipPosition|setTopSellingAnimationKey/);
  assert.match(dashboard, /onResize=\{handleTopSellingChartResize\}/);
  assert.match(dashboard, /tooltipWrapper\.style\.transform = `translate\(\$\{x\}px, \$\{y\}px\)`/);
  assert.match(chartPointerHandler, /getBoundedChartTooltipPosition/);
});

test('top-selling resize suppresses active bar animation for the resize burst without replaying on settle', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const resizeHandler = dashboard.slice(dashboard.indexOf('const handleTopSellingChartResize'), dashboard.indexOf('const clearTopSellingTooltipPosition'));
  const dataChangeEffect = dashboard.slice(dashboard.indexOf('const previous = previousTopSellingRowsRef.current'), dashboard.indexOf('const applyTopSellingTooltipPosition'));
  const chart = dashboard.slice(dashboard.indexOf('<BarChart data={topSellingBarData}'), dashboard.indexOf(': (salesByCategory.length > 0'));

  assert.match(resizeHandler, /topSellingTooltipWidthRef\.current = tooltipWidth/);
  assert.match(resizeHandler, /Object\.assign\(topSellingTooltipPositionRef\.current/);
  assert.match(resizeHandler, /scheduleTopSellingTooltipPosition\(\)/);
  assert.match(resizeHandler, /Math\.round\(width\)/);
  assert.match(resizeHandler, /if \(!sizeChanged\) return/);
  assert.match(resizeHandler, /if \(!topSellingIsResizingRef\.current\)/);
  assert.match(resizeHandler, /setIsTopSellingChartResizing\(true\)/);
  assert.match(resizeHandler, /if \(topSellingAnimationKey !== null\) setTopSellingAnimationKey\(null\)/);
  assert.match(resizeHandler, /setTimeout\(\(\) => \{[\s\S]*?setIsTopSellingChartResizing\(false\)/);
  assert.doesNotMatch(resizeHandler, /setTopSellingAnimationKey\([^)]*topSellingChartKey/);
  assert.match(dashboard, /const TOP_SELLING_RESIZE_SETTLE_MS = 140/);
  assert.match(dataChangeEffect, /!isTopSellingChartResizing/);
  assert.match(dataChangeEffect, /!topSellingIsResizingRef\.current/);
  assert.match(chart, /isAnimationActive=\{topSellingAnimationKey === topSellingChartKey && !prefersReducedMotion && !isTopSellingChartResizing\}/);
  assert.match(dashboard, /topSellingTooltipPositionRef = React\.useRef\(\{ x: 0, y: 0 \}\)/);
});

test('top-selling chart animates stable value updates and honors reduced motion', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const chart = dashboard.slice(dashboard.indexOf('<BarChart data={topSellingBarData}'), dashboard.indexOf(': (salesByCategory.length > 0'));
  assert.match(chart, /isAnimationActive=\{topSellingAnimationKey === topSellingChartKey && !prefersReducedMotion && !isTopSellingChartResizing\}/);
  assert.match(chart, /animationDuration=\{380\}/);
  assert.match(chart, /animationEasing="ease-in-out"/);
  assert.match(chart, /onAnimationEnd=\{handleTopSellingAnimationEnd\}/);
  assert.match(chart, /active=\{topSellingAnimationKey === topSellingChartKey \? false : undefined\}/);
  assert.match(dashboard, /areTopSellingProductRowsStable\(previous\.rows, topSellingBarData\)/);
  assert.match(dashboard, /ResponsiveContainer width="100%" height="100%" onResize=\{handleTopSellingChartResize\}/);
  assert.match(chart, /topSellingBarData\.length === 0/);
  assert.match(dashboard, /motionPreference\.addEventListener\('change'/);
  assert.match(dashboard, /motionPreference\.removeEventListener\('change'/);
  assert.match(dashboard, /animationDuration=\{380\}/);
});
