const test = require('node:test');
const assert = require('node:assert/strict');

const logPath = require.resolve('../src/services/logService');
const realtimePath = require.resolve('../src/services/realtimeService');
const logged = [];
require.cache[logPath] = { id: logPath, filename: logPath, loaded: true, exports: {
  writeActivityLog: async (entry) => logged.push({ kind: 'activity', ...entry }),
  writeInventoryLog: async (entry) => logged.push({ kind: 'inventory', ...entry }),
} };
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true, exports: {
  publishSaleCreated: () => {}, publishSaleUpdated: () => {}, publishInventoryUpdated: () => {}, publishCreditTransactionsUpdated: () => {},
} };

const Product = require('../src/models/Product');
const Partner = require('../src/models/Partner');
const Sale = require('../src/models/Sale');
const CreditTransaction = require('../src/models/CreditTransaction');
const { __test: { executeSaleCreation } } = require('../src/controllers/saleController');

test('credit sale and initial payment persist 1–3 proof metadata in the same session without changing amounts or stock logic', async () => {
  const originals = { product: Product.findById, deduction: Product.findOneAndUpdate, partner: Partner.findOne, sale: Sale.create, credit: CreditTransaction.create };
  const session = { id: 'transaction-session' };
  const product = { _id: '68a01234567890abcdef0001', sku: 'SKU-1', name: 'Product', sellingUnit: 'pcs', stock: 5, price: 100, isActive: true,
    async save(options) { assert.equal(options.session, session); } };
  const sale = { _id: '68a01234567890abcdef0002', async save(options) { assert.equal(options.session, session); } };
  let capturedSale;
  let capturedCredit;
  const savedProofs = [
    { storageKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', fileName: 'one.jpg', mimeType: 'image/jpeg' },
    { storageKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png', fileName: 'two.png', mimeType: 'image/png' },
  ];
  Product.findById = async () => product;
  Product.findOneAndUpdate = async (filter, update, options) => {
    assert.equal(String(filter._id), product._id);
    assert.ok(filter.$expr, 'checkout must guard available-to-sell stock in the write');
    assert.equal(options.session, session);
    assert.equal(options.returnDocument, 'before');
    const before = { stock: product.stock };
    product.stock += update.$inc.stock;
    return before;
  };
  Partner.findOne = async () => ({ _id: '68a01234567890abcdef0003', name: 'Customer' });
  Sale.create = async ([payload], options) => { assert.equal(options.session, session); assert.equal(payload.paymentStatus, 'Partially Paid'); capturedSale = payload; return [sale]; };
  CreditTransaction.create = async ([payload], options) => { assert.equal(options.session, session); capturedCredit = payload; return [{ _id: 'credit-1', creditTransactionId: 'CR-1' }]; };
  try {
    const result = await executeSaleCreation({
      req: { body: { items: [{ productId: product._id, quantity: 1 }], paymentMethod: 'credit', customerId: '68a01234567890abcdef0003', termDays: 30, creditPaymentMode: 'cash', downPaymentAmount: '20.00' }, user: { _id: '68a01234567890abcdef0004', name: 'Cashier' }, get: () => '' },
      session, downPaymentProofs: savedProofs,
    });
    assert.equal(result.sale, sale);
    assert.equal(capturedSale.items[0].sellingUnit, 'pcs');
    assert.equal(product.stock, 4);
    assert.equal(capturedCredit.totalAmount, 100);
    assert.equal(capturedCredit.downPaymentAmount, 20);
    assert.equal(capturedCredit.remainingBalance, 80);
    assert.equal(capturedCredit.paymentHistory.length, 1);
    assert.equal(capturedCredit.paymentHistory[0].type, 'down_payment');
    assert.ok(capturedCredit.paymentHistory[0].recordedAt instanceof Date);
    assert.equal(capturedCredit.paymentHistory[0].recordedAt, capturedCredit.paymentHistory[0].paymentDate);
    assert.equal(capturedCredit.paymentHistory[0].clientRequestId, `initial-down-payment:${sale._id}`);
    assert.deepEqual(capturedCredit.paymentHistory[0].proofs, savedProofs);
    assert.equal(capturedCredit.paymentHistory[0].proof, savedProofs[0]);
    assert.equal(logged.filter((entry) => entry.kind === 'inventory').length, 1);
  } finally {
    Product.findById = originals.product;
    Product.findOneAndUpdate = originals.deduction;
    Partner.findOne = originals.partner;
    Sale.create = originals.sale;
    CreditTransaction.create = originals.credit;
  }
});
