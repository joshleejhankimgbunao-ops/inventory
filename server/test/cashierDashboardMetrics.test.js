/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');

const loadMetrics = () => import('../../src/utils/cashierDashboardMetrics.js');

const sale = (overrides = {}) => ({
  id: 'sale-1',
  status: 'completed',
  cashierId: 'cashier-1',
  cashier: 'Cashier One',
  total: 100,
  items: [{ code: 'A-1', name: 'Product A', qty: 1, price: 100 }],
  ...overrides,
});

test('cashier dashboard metrics use the authenticated cashier ID and exclude invalid sales', async () => {
  const { getCashierDashboardSales, getCashierSalesTotal } = await loadMetrics();
  const selectedDateTransactions = [
    sale({ id: 'current-valid', cashierId: '', cashierUser: { id: 'cashier-1' }, total: 1250 }),
    sale({ id: 'other-cashier', cashierId: 'cashier-2', cashier: 'Cashier Two', total: 900 }),
    sale({ id: 'voided', status: 'voided', total: 600 }),
  ];

  const cashierSales = getCashierDashboardSales(selectedDateTransactions, {
    cashierId: 'cashier-1',
    cashierName: 'Cashier One',
  });

  assert.deepEqual(cashierSales.map((entry) => entry.id), ['current-valid']);
  assert.equal(getCashierSalesTotal(cashierSales), 1250);
});

test('cashier dashboard keeps legacy name matching only for sales without a stored cashier reference', async () => {
  const { getCashierDashboardSales } = await loadMetrics();
  const cashierSales = getCashierDashboardSales([
    sale({ id: 'legacy-own', cashierId: '', cashierUser: null }),
    sale({ id: 'legacy-other', cashierId: '', cashierUser: null, cashier: 'Other Cashier' }),
    sale({ id: 'referenced-other', cashierId: 'cashier-2', cashier: 'Cashier One' }),
  ], { cashierId: 'cashier-1', cashierName: 'Cashier One' });

  assert.deepEqual(cashierSales.map((entry) => entry.id), ['legacy-own']);
});

test('DashboardHome shares the date-resolved cashier dataset across cashier metrics and ranking', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');

  assert.match(source, /title="My Sales"/);
  assert.match(source, /title="My Transactions"/);
  assert.match(source, /getCashierDashboardSales\(\s*selectedDateTransactions,/);
  assert.match(source, /getCashierSalesTotal\(cashierSelectedDateTransactions\)/);
  assert.match(source, /transactionsForTopProducts\.forEach/);
  assert.match(source, /My Top-Selling Products/);
  assert.match(source, /Units Sold/);
  assert.match(source, /Number\(product\.sales\) === 1 \? 'unit' : 'units'/);
  assert.match(source, /View all/);
  assert.doesNotMatch(source, />Vol</);
  assert.match(source, /No products sold yet/);
  assert.match(source, /No item sales were recorded in your transactions for the selected date range\./);
});
