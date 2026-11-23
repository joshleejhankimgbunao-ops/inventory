const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../src/utils/reportDetailTables.js');

test('one Sale row reconciles cash, partial/settled credit, and ledger-funded Special Orders without duplicating payments', async () => {
  const { buildSalesReportRows } = await load();
  const sales = [
    { sourceId: 'cash-1', id: 'TRX-CASH', date: '2026-10-01', total: 100, paymentStatus: 'Paid', paymentMethod: 'cash' },
    { sourceId: 'credit-1', id: 'TRX-CREDIT', date: '2026-10-02', total: 1000, paymentMethod: 'credit' },
    { sourceId: 'credit-2', id: 'TRX-SETTLED', date: '2026-10-03', total: 500, paymentMethod: 'credit' },
    { sourceId: 'special-1', id: 'TRX-SPECIAL', date: '2026-10-04', total: 300, saleType: 'special-order', specialOrderId: 'order-1', collectionSource: 'special_order_ledger', specialOrderFulfillmentStatus: 'Awaiting Items' },
    { sourceId: 'void-1', id: 'TRX-VOID', status: 'voided', total: 100 },
  ];
  const credits = [
    { orderId: 'credit-1', amountPaid: 250, remainingBalance: 750, status: 'Partially Paid' },
    { orderId: 'credit-2', amountPaid: 500, remainingBalance: 0, status: 'Paid' },
  ];
  const payments = [
    { specialOrderId: 'order-1', amountCentavos: 10000, recordedAt: '2026-09-30' },
    { specialOrderId: 'order-1', amountCentavos: 20000, recordedAt: '2026-10-02' },
  ];
  const rows = buildSalesReportRows(sales, credits, payments);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => [row.saleType, row.total, row.paid, row.remaining]), [
    ['Cash', 100, 100, 0], ['Credit', 1000, 250, 750], ['Credit', 500, 500, 0], ['Special Order', 300, 300, 0],
  ]);
  assert.equal(rows[3].fulfillment, 'Awaiting Items');
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 1900);
});

test('missing linked payment records remain unknown instead of fabricated zeroes', async () => {
  const { buildSalesReportRows } = await load();
  const rows = buildSalesReportRows([
    { sourceId: 'credit-1', id: 'TRX-CREDIT', total: 100, paymentMethod: 'credit' },
    { sourceId: 'special-1', id: 'TRX-SPECIAL', total: 200, saleType: 'special-order', specialOrderId: 'order-1', collectionSource: 'special_order_ledger' },
  ], [], []);
  assert.deepEqual(rows.map((row) => [row.paid, row.remaining, row.paymentStatus]), [
    [null, null, 'Needs Review'], [null, null, 'Needs Review'],
  ]);
});

test('inconsistent linked balances are flagged for review', async () => {
  const { buildSalesReportRows } = await load();
  const rows = buildSalesReportRows([
    { sourceId: 'credit-1', total: 100, paymentMethod: 'credit' },
    { sourceId: 'special-1', total: 50, saleType: 'special-order', specialOrderId: 'order-1', collectionSource: 'special_order_ledger' },
  ], [{ orderId: 'credit-1', amountPaid: 40, remainingBalance: 50, status: 'Partially Paid' }], [{ specialOrderId: 'order-1', amountCentavos: 6000 }]);
  assert.equal(rows[0].paymentStatus, 'Needs Review');
  assert.equal(rows[1].remaining, null);
  assert.equal(rows[1].paymentStatus, 'Needs Review');
});

test('inventory rows retain physical, reserved, available-to-sell and saved selling unit without deduction', async () => {
  const { buildInventoryReportRows, filterAndSortReportRows, paginateReportRows } = await load();
  const products = [
    { id: 'one', code: 'A-1', name: 'Paint', category: 'Paint', sellingUnit: 'can', stock: 15, reservedStock: 10, availableToSell: 5, status: 'In Stock' },
    { id: 'two', code: 'B-1', name: 'Nails', category: 'Fasteners', stock: 0, reservedStock: 0, availableToSell: 0, status: 'Out of Stock' },
  ];
  const rows = buildInventoryReportRows(products);
  assert.deepEqual([rows[0].physical, rows[0].reserved, rows[0].available, rows[0].sellingUnit], [15, 10, 5, 'can']);
  assert.equal(rows[1].sellingUnit, '—');
  assert.deepEqual(filterAndSortReportRows(rows, { search: 'paint', filters: { category: 'Paint' }, sortKey: 'available', sortDirection: 'desc' }).map((row) => row.sku), ['A-1']);
  assert.deepEqual(filterAndSortReportRows(rows, { sortKey: 'physical', sortDirection: 'asc' }).map((row) => row.sku), ['B-1', 'A-1']);
  assert.deepEqual(paginateReportRows(rows, 2, 1).rows.map((row) => row.sku), ['B-1']);
  assert.equal(paginateReportRows(rows, 99, 1).currentPage, 2);
});
