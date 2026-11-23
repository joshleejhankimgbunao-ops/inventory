/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

test('content cards reuse the Dashboard KPI lift without changing the Top-Selling Products panel', () => {
  const dashboard = read('src/pages/DashboardHome.jsx');
  const styles = read('src/index.css');
  const statCard = read('src/components/StatCard.jsx');
  const targetFiles = [
    'src/pages/CreditTransactions.jsx',
    'src/pages/Reports.jsx',
    'src/pages/History.jsx',
    'src/pages/Inventory.jsx',
    'src/pages/ProductList.jsx',
    'src/pages/SpecialOrders.jsx',
    'src/pages/UserList.jsx',
    'src/components/ReportRecordTable.jsx',
    'src/components/StockMovement.jsx',
  ];

  assert.match(dashboard, /My Top-Selling Products/);
  assert.match(dashboard, /rounded-xl border border-gray-100 bg-white p-0 shadow-sm/);
  assert.doesNotMatch(dashboard.slice(dashboard.indexOf('My Top-Selling Products'), dashboard.indexOf('Low / Out of Stock')), /hover:shadow|hover:-translate|transition-all/);
  assert.match(statCard, /transition-all duration-300/);
  assert.match(statCard, /hover:-translate-y-1 hover:shadow-lg/);
  assert.match(styles, /\.app-dashboard-card-hover:hover\s*\{\s*transform:\s*translateY\(-0\.25rem\);/);
  assert.match(styles, /transition:\s*all 300ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
  assert.match(styles, /0 10px 15px -3px rgb\(0 0 0 \/ 0\.1\)/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\)/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: reduce\)/);

  for (const relativePath of targetFiles) {
    const source = read(relativePath);
    assert.match(source, /app-dashboard-card-hover/, `${relativePath} should reuse the Dashboard card lift`);
  }

  const reports = read('src/pages/Reports.jsx');
  const financialCard = reports.slice(reports.indexOf('const FinancialStatCard ='), reports.indexOf('const Reports ='));
  assert.match(financialCard, /app-dashboard-card-hover/);
  assert.match(reports, /liftOnHover/);
  assert.doesNotMatch(reports, /app-dashboard-table-row-hover/);
  assert.doesNotMatch(reports, /hover:-translate-y/);
  assert.match(styles, /app-dashboard-table-row-hover/);
});
