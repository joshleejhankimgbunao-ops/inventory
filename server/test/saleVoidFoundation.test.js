const assert = require('node:assert/strict');
const test = require('node:test');

const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: {
    publishSaleCreated: () => {},
    publishInventoryUpdated: () => {},
    publishCreditTransactionsUpdated: () => {},
  },
};

const Sale = require('../src/models/Sale');
const Product = require('../src/models/Product');
const {
  listSales,
  listSalesHistoryView,
  mapSaleToTransactionContract,
} = require('../src/controllers/saleController');
const { getSaleVoidEligibility, checkSaleVoidEligibility } = require('../src/services/saleVoidEligibility');

const PRODUCT_ID = '68a01234567890abcdef9999';
const SALE_ID = '68a01234567890abcdef1234';

const regularCashSale = (overrides = {}) => ({
  _id: SALE_ID,
  status: 'completed',
  saleType: 'regular',
  paymentMethod: 'cash',
  paymentStatus: 'Paid',
  items: [{ product: PRODUCT_ID, quantity: 1 }],
  ...overrides,
});

test('Sale lifecycle defaults new records to completed while legacy records remain reportable', async () => {
  const { getSaleStatus, isValidSaleForReporting } = await import('../../shared/saleLifecycle.mjs');
  const newSale = new Sale({
    totalAmount: 100,
    items: [{ product: PRODUCT_ID, name: 'Test Product', quantity: 1, unitPrice: 100, subtotal: 100 }],
  });

  assert.equal(newSale.status, 'completed');
  assert.equal(getSaleStatus({}), 'completed');
  assert.equal(isValidSaleForReporting({}), true);
  assert.equal(isValidSaleForReporting({ status: 'completed' }), true);
  assert.equal(isValidSaleForReporting({ status: 'voided' }), false);
});

test('shared reporting filters exclude voided Sales from Dashboard and Reports metrics', async () => {
  const { getValidSales } = await import('../../shared/saleLifecycle.mjs');
  const transactions = [
    { id: 'legacy', date: '2026-01-10T00:00:00.000Z', total: 100, paymentMethod: 'cash', items: [{ qty: 2 }] },
    { id: 'completed', status: 'completed', date: '2026-01-11T00:00:00.000Z', total: 200, paymentMethod: 'cash', items: [{ qty: 3 }] },
    { id: 'voided', status: 'voided', date: '2026-01-12T00:00:00.000Z', total: 900, paymentMethod: 'cash', items: [{ qty: 9 }] },
  ];

  const valid = getValidSales(transactions);
  assert.deepEqual(valid.map((sale) => sale.id), ['legacy', 'completed']);
  assert.equal(valid.reduce((sum, sale) => sum + sale.total, 0), 300);
  assert.equal(valid.length, 2);
  assert.equal(valid.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.qty, 0), 0), 5);
});

test('History retains a voided Sale and exposes public void metadata', () => {
  const transaction = mapSaleToTransactionContract({
    ...regularCashSale({
      status: 'voided',
      createdAt: new Date('2026-01-12T00:00:00.000Z'),
      totalAmount: 100,
      voidInfo: {
        reason: 'Duplicate transaction',
        voidedAt: new Date('2026-01-12T01:00:00.000Z'),
        voidedBy: '68a01234567890abcdef2222',
        voidedByName: 'Admin User',
        authorizationMethod: 'admin-session',
        requestId: 'void:req-1',
      },
      items: [{ product: PRODUCT_ID, name: 'Test Product', code: 'TEST-1', quantity: 1, unitPrice: 100, subtotal: 100 }],
    }),
  });

  assert.equal(transaction.status, 'voided');
  assert.equal(transaction.voidInfo.reason, 'Duplicate transaction');
});

test('valid-sales API excludes voided records while History does not filter them out', async (context) => {
  const originalFind = Sale.find;
  const capturedQueries = [];
  context.after(() => { Sale.find = originalFind; });
  Sale.find = (query) => {
    capturedQueries.push(query);
    return {
      populate() { return this; },
      sort: async () => [],
    };
  };
  const response = { json: (body) => body };

  await listSales({ query: {}, user: { role: 'admin' } }, response, assert.fail);
  await listSalesHistoryView({ query: {}, user: { role: 'admin' } }, response, assert.fail);

  assert.deepEqual(capturedQueries[0].status, { $ne: 'voided' });
  assert.equal(Object.hasOwn(capturedQueries[1], 'status'), false);
});

test('phase-1 eligibility accepts only persisted regular Cash Sales with valid product linkage', () => {
  assert.equal(getSaleVoidEligibility(regularCashSale()).eligible, true);
  assert.equal(getSaleVoidEligibility(regularCashSale({ status: undefined })).eligible, true);
  assert.equal(getSaleVoidEligibility(regularCashSale({ status: 'voided' })).eligible, false);
  assert.equal(getSaleVoidEligibility(regularCashSale({ paymentMethod: 'credit', creditTransactionId: 'CR-1' })).eligible, false);
  assert.equal(getSaleVoidEligibility(regularCashSale({ saleType: 'special-order', specialOrderNumber: 'SO-1' })).eligible, false);
  assert.equal(getSaleVoidEligibility(regularCashSale({ _id: undefined })).eligible, false);
  assert.equal(getSaleVoidEligibility(regularCashSale({ items: [{ product: null, quantity: 1 }] })).eligible, false);
});

test('phase-1 eligibility verifies that referenced Products still exist', async (context) => {
  const originalFindById = Sale.findById;
  const originalCountDocuments = Product.countDocuments;
  context.after(() => {
    Sale.findById = originalFindById;
    Product.countDocuments = originalCountDocuments;
  });

  Sale.findById = async () => regularCashSale();
  Product.countDocuments = async () => 1;
  assert.equal((await checkSaleVoidEligibility(regularCashSale())).eligible, true);

  Product.countDocuments = async () => 0;
  const missingProduct = await checkSaleVoidEligibility(regularCashSale());
  assert.equal(missingProduct.eligible, false);
  assert.match(missingProduct.reason, /product no longer exists/i);

  Sale.findById = async () => null;
  const missingSale = await checkSaleVoidEligibility(SALE_ID);
  assert.equal(missingSale.eligible, false);
  assert.match(missingSale.reason, /persisted on the server/i);
});
