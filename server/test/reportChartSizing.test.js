/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportsSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Reports.jsx'), 'utf8');

test('Reports Top Selling Products uses a responsive horizontal chart sized for ten rows', () => {
  assert.match(reportsSource, /reportType === 'inventory' \? 'reports-inventory-analytics-card min-h-\[400px\] lg:col-span-10'/);
  assert.match(reportsSource, /const chartHeight = Math\.max\(240, Math\.min\(400, products\.length \* 36 \+ 40\)\)/);
  assert.match(reportsSource, /ReportsTopSellingProductsChart products=\{topProductsBarData\}/);
  assert.match(reportsSource, /<BarChart data=\{products\} layout="vertical"/);
  assert.match(reportsSource, /ResponsiveContainer width="100%" height="100%" onResize=\{handleResize\}/);
  assert.match(reportsSource, /reportType === 'sales' \? 'min-h-\[400px\] lg:col-span-5'/);
  assert.match(reportsSource, /className="h-\[320px\] min-w-0 w-full overflow-x-auto overflow-y-hidden overscroll-x-contain"/);
});

test('Reports Sales by Category uses a responsive vertical bar chart for every category', () => {
  assert.match(reportsSource, /buildAllSalesCategoryChartData\(salesByCategory\)/);
  assert.match(reportsSource, /ReportsSalesByCategoryChart categories=\{salesByCategoryChartData\}/);
  assert.match(reportsSource, /<BarChart data=\{categories\}/);
  assert.match(reportsSource, /style=\{\{ minWidth: `max\(100%, \$\{chartMinWidth\}px\)` \}\}/);
  assert.match(reportsSource, /const REPORTS_CATEGORY_MIN_ITEM_WIDTH = 104/);
  assert.match(reportsSource, /animationDuration=\{380\}/);
  assert.match(reportsSource, /prefers-reduced-motion: reduce/);
  assert.match(reportsSource, /type="vertical-bar"/);
  assert.match(reportsSource, /cursor=\{false\}/);
});
