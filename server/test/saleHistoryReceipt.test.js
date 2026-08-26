const test = require('node:test');
const assert = require('node:assert/strict');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: {
    publishSaleCreated: () => {},
    publishInventoryUpdated: () => {},
    publishCreditTransactionsUpdated: () => {},
  },
};

const { mapSaleToTransactionContract } = require('../src/controllers/saleController');

test('sale history contract preserves item snapshots and Credit plus Cheque hierarchy', () => {
  const createdAt = new Date('2026-08-03T09:30:00.000Z');
  const transaction = mapSaleToTransactionContract({
    _id: '68a01234567890abcdef1234',
    createdAt,
    cashierName: 'Saved Cashier',
    paymentMethod: 'credit',
    paymentStatus: 'Pending',
    totalAmount: 750,
    netAmount: 669.64,
    vatAmount: 80.36,
    grossAmount: 750,
    customerName: 'Saved Customer',
    creditTermDays: 30,
    dueDate: new Date('2026-09-02T09:30:00.000Z'),
    notes: 'Preferred mode of payment: Cheque',
    items: [{
      product: '68a01234567890abcdef9999',
      name: 'Historical Product Snapshot',
      code: 'HIST-001',
      quantity: 3,
      unitPrice: 250,
      subtotal: 750,
    }],
  });

  assert.equal(transaction.paymentMethod, 'credit');
  assert.equal(transaction.creditPaymentMode, 'Cheque');
  assert.equal(transaction.date, createdAt);
  assert.deepEqual(transaction.items[0], {
    id: '68a01234567890abcdef9999',
    code: 'HIST-001',
    name: 'Historical Product Snapshot',
    qty: 3,
    price: 250,
    subtotal: 750,
  });
});

test('special-order-linked history sale remains a printable transaction without lifecycle changes', () => {
  const transaction = mapSaleToTransactionContract({
    _id: '68a01234567890abcdef5678',
    createdAt: new Date('2026-08-04T09:30:00.000Z'),
    cashierName: 'Saved Cashier',
    paymentMethod: 'cash',
    totalAmount: 200,
    specialOrderId: '68a01234567890abcdef7777',
    specialOrderNumber: 'SO-001',
    items: [{ name: 'Special Order Snapshot', code: 'SO-I-1', quantity: 1, unitPrice: 200, subtotal: 200 }],
  });

  assert.equal(transaction.saleType, 'special-order');
  assert.equal(transaction.specialOrderNumber, 'SO-001');
  assert.equal(transaction.items[0].name, 'Special Order Snapshot');
  assert.equal(transaction.total, 200);
});
