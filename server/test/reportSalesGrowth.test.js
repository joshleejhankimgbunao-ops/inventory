import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getDashboardComparisonPeriod,
  getMetricTrend,
  getPreviousPeriodMetrics,
  getPreviousSalesReportMetrics,
} from '../../src/utils/dashboardTrend.js';
import { isCreditPaymentCollectionForReporting } from '../../shared/saleLifecycle.mjs';

const localDate = (year, month, day) => new Date(year, month - 1, day);

test('Reports comparison periods follow Today, This Week, This Month, and custom range boundaries', () => {
  const now = new Date(2026, 8, 15, 14, 30);
  const today = getDashboardComparisonPeriod({ dateRange: 'today', now });
  const week = getDashboardComparisonPeriod({ dateRange: 'week', now });
  const month = getDashboardComparisonPeriod({ dateRange: 'month', now });
  const custom = getDashboardComparisonPeriod({
    dateRange: 'custom',
    now,
    customStartDate: '2026-03-10',
    customEndDate: '2026-03-12',
  });

  assert.equal(today.label, 'yesterday');
  assert.equal(today.previousStart.getTime(), localDate(2026, 9, 14).getTime());
  assert.equal(today.previousEnd.getTime(), localDate(2026, 9, 15).getTime());
  assert.equal(week.label, 'last week');
  assert.equal(week.previousStart.getTime(), localDate(2026, 8, 31).getTime());
  assert.equal(week.previousEnd.getTime(), localDate(2026, 9, 8).getTime());
  assert.equal(month.label, 'last month');
  assert.equal(month.previousStart.getTime(), localDate(2026, 8, 1).getTime());
  assert.equal(month.previousEnd.getTime(), localDate(2026, 9, 1).getTime());
  assert.equal(custom.label, 'previous period');
  assert.equal(custom.previousStart.getTime(), localDate(2026, 3, 7).getTime());
  assert.equal(custom.previousEnd.getTime(), localDate(2026, 3, 10).getTime());
});

test('Dashboard weekly comparison follows the shared seven-day Manila reporting window', () => {
  const reportingPeriod = {
    start: '2026-10-08T16:00:00.000Z',
    end: '2026-10-15T16:00:00.000Z',
  };
  const comparison = getDashboardComparisonPeriod({
    dateRange: 'week',
    now: new Date('2026-10-15T06:00:00.000Z'),
    reportingPeriod,
  });

  assert.equal(comparison.previousStart.toISOString(), '2026-10-01T16:00:00.000Z');
  assert.equal(comparison.previousEnd.toISOString(), reportingPeriod.start);
  assert.equal(comparison.previousEnd - comparison.previousStart, 7 * 86400000);
});

test('previous Sales Amount uses the same finalized-sale total and excludes voided records', () => {
  const period = getDashboardComparisonPeriod({
    dateRange: 'week',
    now: new Date(2026, 6, 15, 12),
  });
  const transactions = [
    { id: 'at-start', date: localDate(2026, 6, 30).toISOString(), total: 100 },
    { id: 'inside', date: new Date(2026, 6, 7, 23, 59).toISOString(), total: 200, status: 'completed' },
    { id: 'at-end', date: localDate(2026, 7, 8).toISOString(), total: 500 },
    { id: 'voided', date: new Date(2026, 7, 3).toISOString(), total: 900, status: 'voided' },
  ];

  assert.deepEqual(getPreviousPeriodMetrics(transactions, period), { sales: 300, orders: 2 });
});

test('Sales Amount trend handles positive, negative, unchanged, and zero-baseline comparisons safely', () => {
  assert.deepEqual(getMetricTrend(30_280, 17_479), {
    direction: 'up',
    delta: 12_801,
    percentage: (12_801 / 17_479) * 100,
  });
  assert.deepEqual(getMetricTrend(17_479, 30_280), {
    direction: 'down',
    delta: -12_801,
    percentage: (12_801 / 30_280) * 100,
  });
  assert.deepEqual(getMetricTrend(0, 0), { direction: 'neutral', delta: 0, percentage: null });
  assert.deepEqual(getMetricTrend(50, 0), { direction: 'up', delta: 50, percentage: null });
  assert.deepEqual(getMetricTrend(0, 50), { direction: 'down', delta: -50, percentage: 100 });
});

test('Total Sales uses finalized recognized revenue, includes unpaid credit sales, excludes recorded VAT, and counts a Special Order once', async () => {
  const { sumRecognizedSalesRevenue } = await import('../../src/utils/reportsSalesKpis.js');
  const sales = [
    { id: 'cash', status: 'completed', paymentMethod: 'cash', total: 112, netAmount: 100, vatAmount: 12 },
    { id: 'partial-credit', status: 'completed', paymentMethod: 'credit', paymentStatus: 'Partially Paid', total: 224, netAmount: 200, vatAmount: 24 },
    { id: 'unpaid-credit', status: 'completed', paymentMethod: 'credit', paymentStatus: 'Pending', total: 56, netAmount: 50, vatAmount: 6 },
    { id: 'special-sale', status: 'completed', saleType: 'special-order', specialOrderId: 'order-1', collectionSource: 'special_order_ledger', total: 300, netAmount: null, vatAmount: null, vatCalculationStatus: 'not_calculated' },
    { id: 'duplicate-special-sale', status: 'completed', saleType: 'regular', specialOrderId: 'order-1', total: 300, netAmount: 300, vatAmount: 0 },
    { id: 'discounted', status: 'completed', total: 90, netAmount: 90, vatAmount: 0, items: [{ subtotal: 100 }] },
    { id: 'legacy-with-vat', status: 'completed', total: 112, vatAmount: 12 },
    { id: 'voided', status: 'voided', total: 900, netAmount: 900 },
    { id: 'cancelled', status: 'cancelled', total: 800, netAmount: 800 },
    { id: 'draft', status: 'draft', total: 700, netAmount: 700 },
    { id: 'inconsistent-vat', status: 'completed', total: 10, vatAmount: 11 },
  ];

  assert.equal(sumRecognizedSalesRevenue(sales), 840);
});

test('Total Sales previous-period comparison uses the same net-revenue formula and excludes the end boundary', async () => {
  const { sumRecognizedSalesRevenueInPeriod } = await import('../../src/utils/reportsSalesKpis.js');
  const period = {
    previousStart: new Date('2026-10-01T00:00:00.000Z'),
    previousEnd: new Date('2026-10-08T00:00:00.000Z'),
  };
  const sales = [
    { id: 'inside', date: '2026-10-01T00:00:00.000Z', total: 112, netAmount: 100, vatAmount: 12 },
    { id: 'at-end', date: '2026-10-08T00:00:00.000Z', total: 56, netAmount: 50, vatAmount: 6 },
    { id: 'voided', date: '2026-10-02T00:00:00.000Z', status: 'voided', total: 90, netAmount: 90 },
  ];

  assert.equal(sumRecognizedSalesRevenueInPeriod(sales, period), 100);
  assert.equal(sumRecognizedSalesRevenueInPeriod(sales, { previousStart: null, previousEnd: null }), 0);
});

test('Special Order CreditTransaction payment history is excluded when the Special Order ledger reports the same collections', () => {
  const regularCredit = { collectionSource: 'sale', saleStatus: 'completed', paymentHistory: [{ amount: 50 }] };
  const specialOrderCredit = { collectionSource: 'special_order_ledger', saleStatus: 'completed', paymentHistory: [{ amount: 50 }] };
  const voidedCredit = { collectionSource: 'sale', saleStatus: 'voided', paymentHistory: [{ amount: 50 }] };

  assert.equal(isCreditPaymentCollectionForReporting(regularCredit), true);
  assert.equal(isCreditPaymentCollectionForReporting(specialOrderCredit), false);
  assert.equal(isCreditPaymentCollectionForReporting(voidedCredit), false);
  const period = { previousStart: new Date('2026-11-01T00:00:00.000Z'), previousEnd: new Date('2026-11-08T00:00:00.000Z') };
  const previous = getPreviousSalesReportMetrics([], [
    { ...specialOrderCredit, paymentHistory: [{ paymentDate: '2026-11-02T00:00:00.000Z', amount: 50 }] },
    { ...regularCredit, paymentHistory: [{ paymentDate: '2026-11-03T00:00:00.000Z', amount: 25 }] },
  ], period, [{ recordedAt: '2026-11-02T00:00:00.000Z', amountCentavos: 5000 }]);
  assert.equal(previous.collectedRevenue, 75, 'the Special Order ledger event is counted once while regular credit collections remain included');
});
