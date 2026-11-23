const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const Sale = require('../src/models/Sale');
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true, exports: new Proxy({}, { get: () => () => {} }) };
const { mapSaleToTransactionContract } = require('../src/controllers/saleController');
const { __test: { buildSalePayload } } = require('../src/controllers/specialOrderController');

const makePayload = (taxTreatment) => buildSalePayload({
  _id: new mongoose.Types.ObjectId(),
  orderNumber: 'SO-VAT-STATE',
  workflowVersion: 2,
  taxTreatment,
  customerName: 'Customer',
}, { user: { _id: new mongoose.Types.ObjectId(), name: 'Staff' } }, {
  quotation: {
    _id: new mongoose.Types.ObjectId(), version: 1, customerName: 'Customer',
    customerDetails: { taxTreatment },
    items: [{ itemName: 'Agreed Item', itemType: 'custom', quantity: 2, unitPrice: 50, lineAmount: 100 }],
    total: 100,
  },
});

test('both negotiated VAT classifications retain the agreed total without calculating a VAT liability', async () => {
  for (const treatment of ['standard', 'vat_zero_rated']) {
    const payload = makePayload(treatment);
    assert.equal(payload.totalAmount, 100);
    assert.equal(payload.grossAmount, 100);
    assert.equal(payload.netAmount, null);
    assert.equal(payload.vatAmount, null);
    assert.equal(payload.taxTreatment, treatment);
    assert.equal(payload.vatCalculationStatus, 'not_calculated');
    assert.equal(payload.collectionSource, 'special_order_ledger');
    assert.equal(payload.specialOrderFulfillmentStatus, 'Awaiting Items');
    const sale = new Sale(payload);
    await sale.validate();
    const transaction = mapSaleToTransactionContract(sale);
    assert.equal(transaction.netAmount, null);
    assert.equal(transaction.vatAmount, null);
    assert.equal(transaction.vatCalculationStatus, 'not_calculated');
    assert.equal(transaction.taxTreatment, treatment);
    assert.equal(transaction.cashImpactAmount, 0);
    assert.equal(transaction.specialOrderFulfillmentStatus, 'Awaiting Items');
  }
});

test('uncalculated VAT cannot be saved as numeric zero or as an ordinary POS sale', async () => {
  const valid = makePayload('standard');
  await assert.rejects(new Sale({ ...valid, vatAmount: 0 }).validate(), /Uncalculated VAT/);
  await assert.rejects(new Sale({ ...valid, saleType: 'regular' }).validate(), /Uncalculated VAT/);
  await assert.rejects(new Sale({ ...valid, collectionSource: 'sale' }).validate(), /Uncalculated VAT/);
});

test('historical and POS sales retain numeric VAT and sale-date collection semantics', async () => {
  const legacy = new Sale({
    items: [{ name: 'Item', quantity: 1, unitPrice: 112, subtotal: 112 }],
    totalAmount: 112, netAmount: 100, vatAmount: 12, grossAmount: 112,
    cashier: new mongoose.Types.ObjectId(), paymentMethod: 'cash',
  });
  await legacy.validate();
  const transaction = mapSaleToTransactionContract(legacy);
  assert.equal(transaction.vatCalculationStatus, 'calculated');
  assert.equal(transaction.vatAmount, 12);
  assert.equal(transaction.netAmount, 100);
  assert.equal(transaction.cashImpactAmount, 112);
  const { isImmediateSaleCollectionForReporting } = await import('../../shared/saleLifecycle.mjs');
  assert.equal(isImmediateSaleCollectionForReporting(transaction), true);
  assert.equal(isImmediateSaleCollectionForReporting({ ...transaction, collectionSource: 'special_order_ledger' }), false);
});

test('pending Phase 1 transaction preview never fabricates a zero VAT amount', async () => {
  const { acceptedQuotationTransaction } = await import('../../src/utils/specialOrderQuotation.js');
  const quotation = { total: 100, items: [], customerDetails: { taxTreatment: 'standard' } };
  const preview = acceptedQuotationTransaction({ orderNumber: 'SO-VAT', workflowVersion: 2 }, quotation, 'Staff');
  assert.equal(preview.netAmount, null);
  assert.equal(preview.vatAmount, null);
  assert.equal(preview.vatCalculationStatus, 'not_calculated');
  assert.equal(preview.paymentStatus, 'Pending');
  const legacy = acceptedQuotationTransaction({ orderNumber: 'SO-LEGACY' }, quotation, 'Staff');
  assert.equal(legacy.vatAmount, 0);
});

test('Special Order confirmation and receipt previews show classification separately from uncalculated VAT', () => {
  const loadComponent = (name) => {
    const filename = path.resolve(__dirname, `../../src/components/${name}.jsx`);
    const compiled = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], write: false });
    const componentModule = new Module(filename, module);
    componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
    componentModule._compile(compiled.outputFiles[0].text, filename);
    return componentModule.exports.default;
  };
  const transaction = {
    id: 'TRX-SO', date: '2026-10-18T00:00:00.000Z', total: 100,
    netAmount: null, vatAmount: null, vatCalculationStatus: 'not_calculated',
    taxTreatment: 'vat_zero_rated', specialOrderNumber: 'SO-VAT',
    paymentMethod: 'other', collectionSource: 'special_order_ledger', paymentStatus: 'Paid', items: [],
  };
  const Confirmation = loadComponent('OrderConfirmationModal');
  const Receipt = loadComponent('ReceiptPreviewModal');
  for (const Component of [Confirmation, Receipt]) {
    const html = renderToStaticMarkup(React.createElement(Component, { order: { orderNumber: 'SO-VAT' }, transaction, settings: {}, isOrderConfirmation: true, onContinue() {}, onBack() {}, onClose() {} }));
    assert.match(html, /VAT Zero-Rated/);
    assert.match(html, /Not calculated/);
    assert.match(html, /Recorded Special Order payments/);
    assert.doesNotMatch(html, /VAT<\/span><span>₱0\.00/);
  }
});

test('collection trends use payment dates and do not repost a ledger-funded final Sale', async () => {
  const { getPreviousSalesReportMetrics } = await import('../../src/utils/dashboardTrend.js');
  const period = { previousStart: new Date('2026-09-01T00:00:00.000Z'), previousEnd: new Date('2026-10-01T00:00:00.000Z') };
  const sale = { date: '2026-09-20T00:00:00.000Z', total: 100, paymentMethod: 'Other', collectionSource: 'special_order_ledger', items: [], status: 'completed' };
  const payments = [
    { recordedAt: '2026-09-15T00:00:00.000Z', amountCentavos: 2500 },
    { recordedAt: '2026-10-15T00:00:00.000Z', amountCentavos: 7500 },
  ];
  assert.deepEqual(getPreviousSalesReportMetrics([sale], [], period, payments), { collectedRevenue: 25, orders: 1, items: 0 });
  assert.deepEqual(getPreviousSalesReportMetrics([{ ...sale, collectionSource: 'sale' }], [], period, []), { collectedRevenue: 100, orders: 1, items: 0 });
});

test('item reporting separates financially recorded Special Orders from physically issued quantities', async () => {
  const { getPreviousSalesReportMetrics } = await import('../../src/utils/dashboardTrend.js');
  const period = { previousStart: new Date('2026-09-01T00:00:00.000Z'), previousEnd: new Date('2026-10-01T00:00:00.000Z') };
  const base = { date: '2026-09-20T00:00:00.000Z', total: 100, paymentMethod: 'Other', collectionSource: 'special_order_ledger', saleType: 'special-order', items: [{ qty: 3 }] };
  assert.deepEqual(getPreviousSalesReportMetrics([{ ...base, specialOrderFulfillmentStatus: 'Awaiting Items' }], [], period), { collectedRevenue: 0, orders: 1, items: 0 });
  assert.deepEqual(getPreviousSalesReportMetrics([{ ...base, specialOrderFulfillmentStatus: 'Ready for Pickup' }], [], period), { collectedRevenue: 0, orders: 1, items: 0 });
  assert.deepEqual(getPreviousSalesReportMetrics([{ ...base, specialOrderFulfillmentStatus: 'Picked Up' }], [], period), { collectedRevenue: 0, orders: 1, items: 3 });
  assert.deepEqual(getPreviousSalesReportMetrics([{ ...base, saleType: 'regular', collectionSource: 'sale' }], [], period), { collectedRevenue: 100, orders: 1, items: 3 });
  // Legacy rows have no fulfillment state and retain their historical reporting behavior.
  assert.deepEqual(getPreviousSalesReportMetrics([{ ...base, specialOrderFulfillmentStatus: undefined }], [], period), { collectedRevenue: 0, orders: 1, items: 3 });
});
