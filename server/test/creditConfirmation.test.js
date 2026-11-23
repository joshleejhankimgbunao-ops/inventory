/* global require */

const test = require('node:test');
const assert = require('node:assert/strict');

const loadCreditConfirmation = () => import('../../src/utils/creditConfirmation.js');

test('Credit confirmation uses the linked Sale snapshot and saved credit payment details', async () => {
  const { buildCreditConfirmation } = await loadCreditConfirmation();
  const record = {
    orderReference: 'TRX-ABCDEF12',
    status: 'Paid',
    customerName: 'Saved Customer',
    totalAmount: 999,
    downPaymentAmount: 300,
    amountPaid: 1000,
    remainingBalance: 0,
    termDays: 30,
    dueDate: '2026-10-30T00:00:00.000Z',
    paymentHistory: [{ type: 'down_payment', amount: 300, method: 'cash' }, { type: 'payment', amount: 700, method: 'cheque' }],
    orderId: {
      _id: '0123456789abcdefABCDEF12',
      createdAt: '2026-10-01T02:00:00.000Z',
      cashierName: 'Original Cashier',
      paymentMethod: 'credit',
      paymentStatus: 'Paid',
      totalAmount: 1000,
      netAmount: 892.86,
      vatAmount: 107.14,
      grossAmount: 1000,
      vatCalculationStatus: 'calculated',
      vatMode: 'vatable',
      items: [{ product: 'sku-1', name: 'Saved Item', code: 'SKU-1', sellingUnit: 'pcs', quantity: 2, unitPrice: 500, subtotal: 1000 }],
      customerName: 'Sale Customer',
      customerDetails: { address: 'Laguna' },
      creditTermDays: 30,
      dueDate: '2026-10-30T00:00:00.000Z',
    },
  };

  const confirmation = buildCreditConfirmation(record);

  assert.equal(confirmation.transaction.id, 'TRX-ABCDEF12');
  assert.equal(confirmation.transaction.creditTransactionId, '');
  assert.equal(confirmation.transaction.date, record.orderId.createdAt);
  assert.equal(confirmation.transaction.cashier, 'Original Cashier');
  assert.equal(confirmation.transaction.total, 1000);
  assert.equal(confirmation.transaction.paymentMethod, 'credit');
  assert.equal(confirmation.transaction.creditPaymentMode, 'Cash');
  assert.equal(confirmation.transaction.downPaymentAmount, 300);
  assert.deepEqual(confirmation.transaction.additionalPayments, [{
    amount: 700,
    paymentDate: null,
    method: 'Cheque',
    reference: '',
  }]);
  assert.equal(confirmation.transaction.amountPaid, 1000);
  assert.equal(confirmation.transaction.remainingBalance, 0);
  assert.equal(confirmation.transaction.netAmount, 892.86);
  assert.equal(confirmation.transaction.vatAmount, 107.14);
  assert.equal(confirmation.transaction.items[0].qty, 2);
  assert.equal(confirmation.transaction.items[0].price, 500);
  assert.equal(confirmation.transaction.items[0].sellingUnit, 'pcs');
  assert.equal(confirmation.transaction.customerName, 'Sale Customer');
  assert.equal(confirmation.customer.address, 'Laguna');
});

test('Credit confirmation keeps legacy down payments separate from later recorded payments', async () => {
  const { buildCreditConfirmation } = await loadCreditConfirmation();
  const confirmation = buildCreditConfirmation({
    downPaymentAmount: 300,
    paymentHistory: [
      { amount: 300, method: 'cash' },
      { amount: 200, method: 'gcash', paymentDate: '2026-10-02T00:00:00.000Z', reference: 'GC-123' },
    ],
    orderId: {
      _id: 'legacy-credit-sale',
      totalAmount: 1000,
      items: [{ name: 'Legacy Item', quantity: 1, unitPrice: 1000 }],
    },
  });

  assert.equal(confirmation.transaction.downPaymentAmount, 300);
  assert.deepEqual(confirmation.transaction.additionalPayments, [{
    amount: 200,
    paymentDate: '2026-10-02T00:00:00.000Z',
    method: 'GCash',
    reference: 'GC-123',
  }]);
});

test('Credit confirmation preserves an explicit not-calculated VAT state', async () => {
  const { buildCreditConfirmation } = await loadCreditConfirmation();
  const confirmation = buildCreditConfirmation({
    orderId: {
      _id: 'sale-not-calculated',
      totalAmount: 100,
      vatCalculationStatus: 'not_calculated',
      taxTreatment: 'vat_zero_rated',
      items: [{ name: 'Agreed-price item', quantity: 1, unitPrice: 100, subtotal: 100 }],
    },
    paymentHistory: [],
  });

  assert.equal(confirmation.transaction.vatCalculationStatus, 'not_calculated');
  assert.equal(confirmation.transaction.netAmount, null);
  assert.equal(confirmation.transaction.vatAmount, null);
});

test('Credit confirmation does not invent a net amount when legacy records lack VAT values', async () => {
  const { buildCreditConfirmation } = await loadCreditConfirmation();
  const confirmation = buildCreditConfirmation({
    creditTransactionId: 'CR-2026-0007',
    orderId: {
      _id: 'sale-without-vat-snapshot',
      totalAmount: 100,
      items: [{ name: 'Agreed-price item', quantity: 1, unitPrice: 100 }],
    },
  });

  assert.equal(confirmation.transaction.creditTransactionId, 'CR-2026-0007');
  assert.equal(confirmation.transaction.vatCalculationStatus, 'not_calculated');
  assert.equal(confirmation.transaction.netAmount, null);
  assert.equal(confirmation.transaction.vatAmount, null);
});

test('missing or incomplete linked Sales do not produce a fabricated confirmation', async () => {
  const { buildCreditConfirmation } = await loadCreditConfirmation();

  assert.equal(buildCreditConfirmation({ orderId: null, totalAmount: 500 }), null);
  assert.equal(buildCreditConfirmation({ orderId: { _id: 'sale-1', totalAmount: 500, items: [] } }), null);
  assert.equal(buildCreditConfirmation({ orderId: { _id: 'sale-1', totalAmount: 'invalid', items: [{ name: 'Item' }] } }), null);
});
