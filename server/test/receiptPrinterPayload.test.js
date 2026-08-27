const test = require('node:test');
const assert = require('node:assert/strict');

const loadReceiptPrinter = () => import('../../src/services/receiptPrinter.js');

test('historical cash payload uses the saved transaction snapshot and aliases', async () => {
  const { buildReceiptPrintPayload } = await loadReceiptPrinter();
  const transaction = {
    receiptNumber: 'TRX-HISTORY-CASH-001',
    createdAt: '2026-08-01T10:15:00.000Z',
    cashierName: 'Historical Cashier',
    paymentMethod: 'Cash',
    totalAmount: 112,
    netAmount: 100,
    vatAmount: 12,
    grossAmount: 112,
    cashTendered: 150,
    change: 38,
    items: [{
      name: 'Saved Product Name',
      code: 'SAVED-001',
      quantity: 2,
      unitPrice: 56,
      subtotal: 112,
    }],
  };

  const payload = buildReceiptPrintPayload(transaction, { storeName: 'Saved Store' });

  assert.equal(payload.receipt.id, transaction.receiptNumber);
  assert.equal(payload.receipt.date, transaction.createdAt);
  assert.equal(payload.receipt.cashier, transaction.cashierName);
  assert.equal(payload.receipt.cash, 150);
  assert.equal(payload.receipt.change, 38);
  assert.deepEqual(payload.receipt.items, [{
    label: 'Saved Product Name',
    code: 'SAVED-001',
    qty: 2,
    unitPrice: 56,
    subtotal: 112,
  }]);
});

test('historical Credit plus Cheque remains Credit with Cheque mode and saved terms', async () => {
  const { buildReceiptPrintPayload } = await loadReceiptPrinter();
  const payload = buildReceiptPrintPayload({
    id: 'TRX-HISTORY-CREDIT-001',
    date: '2026-08-02T08:00:00.000Z',
    cashier: 'Credit Cashier',
    paymentMethod: 'Credit',
    modeOfPayment: 'Cheque',
    customerName: 'Saved Customer',
    termDays: 30,
    dueDate: '2026-09-01T08:00:00.000Z',
    remainingBalance: 500,
    total: 500,
    items: [{ name: 'Saved Credit Item', qty: 1, price: 500, subtotal: 500 }],
  });

  assert.equal(payload.receipt.paymentMethod, 'Credit');
  assert.equal(payload.receipt.creditPaymentMode, 'Cheque');
  assert.equal(payload.receipt.customerName, 'Saved Customer');
  assert.equal(payload.receipt.termDays, 30);
  assert.equal(payload.receipt.balance, 500);
});

test('missing legacy date and tender values are not replaced with current or invented values', async () => {
  const { buildReceiptPrintPayload } = await loadReceiptPrinter();
  const payload = buildReceiptPrintPayload({
    id: 'TRX-LEGACY-001',
    paymentMethod: 'Cash',
    total: 100,
    items: [{ name: 'Legacy Snapshot', qty: 1, price: 100 }],
  });

  assert.equal(payload.receipt.date, '');
  assert.equal(payload.receipt.cash, null);
  assert.equal(payload.receipt.change, null);
});

test('reprint payloads are explicitly marked without changing the saved transaction snapshot', async () => {
  const { buildReceiptPrintPayload } = await loadReceiptPrinter();
  const transaction = {
    id: 'TRX-REPRINT-001',
    paymentMethod: 'Cash',
    total: 100,
    items: [{ name: 'Saved Item', qty: 1, price: 100 }],
  };

  const originalPayload = buildReceiptPrintPayload(transaction, {});
  const reprintPayload = buildReceiptPrintPayload(transaction, {}, { isReprint: true });

  assert.equal(originalPayload.receipt.isReprint, false);
  assert.equal(reprintPayload.receipt.isReprint, true);
  assert.equal(reprintPayload.receipt.id, transaction.id);
  assert.deepEqual(reprintPayload.receipt.items, originalPayload.receipt.items);
});

test('Special Order receipts preserve the finalized reference and payment status', async () => {
  const { buildReceiptPrintPayload } = await loadReceiptPrinter();
  const payload = buildReceiptPrintPayload({
    id: 'TRX-SPECIAL-001',
    specialOrderNumber: 'SO-001',
    paymentMethod: 'Cash',
    paymentStatus: 'Paid',
    total: 250,
    items: [{ name: 'Finalized Special Item', qty: 1, price: 250, subtotal: 250 }],
  });

  assert.equal(payload.receipt.specialOrderNumber, 'SO-001');
  assert.equal(payload.receipt.paymentStatus, 'Paid');
  assert.equal(payload.receipt.items[0].label, 'Finalized Special Item');
});

test('paid Credit receipt payload preserves saved payment and order references', async () => {
  const { buildReceiptPrintPayload } = await loadReceiptPrinter();
  const transaction = {
    id: 'CR-PAID-001',
    orderReference: 'TRX-ORDER-001',
    paymentReference: 'CHK-001',
    paymentMethod: 'Credit',
    paymentStatus: 'Paid',
    creditPaymentMode: 'Cheque',
    amountPaid: 500,
    remainingBalance: 0,
    total: 500,
    items: [{ name: 'Saved Credit Item', qty: 1, price: 500, subtotal: 500 }],
  };

  const firstPrint = buildReceiptPrintPayload(transaction, {});
  const reprint = buildReceiptPrintPayload(transaction, {}, { isReprint: true });

  assert.equal(firstPrint.receipt.orderReference, 'TRX-ORDER-001');
  assert.equal(firstPrint.receipt.paymentReference, 'CHK-001');
  assert.equal(firstPrint.receipt.amountPaid, 500);
  assert.equal(firstPrint.receipt.balance, 0);
  assert.equal(firstPrint.receipt.isReprint, false);
  assert.deepEqual(reprint.receipt.items, firstPrint.receipt.items);
  assert.equal(reprint.receipt.isReprint, true);
});
