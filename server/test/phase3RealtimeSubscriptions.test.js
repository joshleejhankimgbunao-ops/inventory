/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../../src', relativePath), 'utf8');

test('POS refreshes current product data through context and partner selectors on partner changes/resync', () => {
  const pos = source('pages/PointOfSale.jsx');
  const context = source('context/InventoryContext.jsx');
  assert.match(pos, /subscribeRealtimeEvent\('partners\.updated'/);
  assert.match(pos, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(pos, /Cart Needs Recheck/);
  assert.match(pos, /subscribeRealtimeEvent\('inventory\.updated', scheduleBatchRefresh\)/);
  assert.match(context, /subscribeRealtimeEvent\('inventory\.updated', onInventoryUpdated\)/);
});

test('sale-created notifications stay within Admin/Super Admin and originating Cashier audiences', () => {
  const realtimeService = fs.readFileSync(path.resolve(__dirname, '../src/services/realtimeService.js'), 'utf8');
  assert.match(realtimeService, /publishEvent\('sale\.created', payload, \{ roles: \['superadmin', 'admin'\] \}\)/);
  assert.match(realtimeService, /publishEvent\('sale\.created', payload, \{ roles: \['cashier'\], userIds: \[cashierId\] \}\)/);
});

test('Special Orders refreshes operational data, selectors, and safe open details on relevant events', () => {
  const specialOrders = source('pages/SpecialOrders.jsx');
  for (const event of ['special-order.updated', 'credit-transactions.updated', 'inventory.updated', 'realtime.resync']) {
    assert.ok(specialOrders.includes(`'${event}'`), `Expected Special Orders subscription to ${event}`);
  }
  assert.match(specialOrders, /subscribeRealtimeEvent\('partners\.updated'/);
  assert.match(specialOrders, /detailRefreshNonce/);
  assert.match(specialOrders, /quotationEditorOpen \|\| quotationPreview \|\| decisionOpen/);
});

test('Credit Transactions and History refresh credit data on committed events and reconnect', () => {
  const credit = source('pages/CreditTransactions.jsx');
  const history = source('pages/History.jsx');
  assert.match(credit, /creditDataRequestRef/);
  assert.match(credit, /'credit-transactions\.updated', 'sale\.created', 'sale\.updated', 'realtime\.resync'/);
  assert.match(history, /subscribeRealtimeEvent\('credit-transactions\.updated'/);
  assert.match(history, /subscribeRealtimeEvent\('realtime\.resync'/);
});

test('Reports and Dashboard refresh only related collections/metrics and resynchronize after reconnect', () => {
  const reports = source('pages/Reports.jsx');
  const dashboard = source('pages/DashboardHome.jsx');
  const stockMovement = source('components/StockMovement.jsx');
  assert.match(reports, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(reports, /scheduleSpecialRefresh/);
  assert.match(dashboard, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(stockMovement, /'sale\.created', 'sale\.updated', 'inventory\.updated', 'inventory\.logged', 'realtime\.resync'/);
});

test('Supplier selectors refresh on partner changes and reconnect without replacing product form values', () => {
  const products = source('pages/ProductList.jsx');
  assert.match(products, /subscribeRealtimeEvent\('partners\.updated', scheduleRefresh\)/);
  assert.match(products, /subscribeRealtimeEvent\('realtime\.resync', scheduleRefresh\)/);
  assert.match(products, /supplierPartnersRequestRef/);
});
