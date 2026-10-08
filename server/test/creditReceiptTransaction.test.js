const test = require('node:test');
const assert = require('node:assert/strict');

const loadCreditReceipt = () => import('../../src/utils/creditReceipt.js');

test('paid Credit receipt uses the latest persisted payment and linked Sale snapshot', async () => {
  const { buildCreditReceiptTransaction, isFullyPaidCreditTransaction } = await loadCreditReceipt();
  const record = {
    creditTransactionId: 'CR-20260827-PAID01',
    orderReference: 'TRX-ABCDEF12',
    customerName: 'Saved Credit Customer',
    status: 'Paid',
    totalAmount: 1000,
    amountPaid: 1000,
    remainingBalance: 0,
    netAmount: 892.86,
    vatAmount: 107.14,
    grossAmount: 1000,
    termDays: 30,
    dueDate: '2026-09-26T00:00:00.000Z',
    paymentHistory: [
      { paymentDate: '2026-08-20T02:00:00.000Z', amount: 250, method: 'gcash', recordedBy: 'First Recorder' },
      {
        paymentDate: '2026-08-27T03:15:00.000Z',
        amount: 750,
        method: 'cheque',
        reference: 'CHK-001',
        recordedBy: 'Saved Recorder',
        recordedByUser: { name: 'Final Recorder Full Name', displayName: 'Final Recorder' },
      },
    ],
    orderId: {
      items: [{ name: 'Saved Sale Item', code: 'SALE-ITEM-1', quantity: 2, unitPrice: 500, subtotal: 1000 }],
    },
  };

  const transaction = buildCreditReceiptTransaction(record);

  assert.equal(isFullyPaidCreditTransaction(record), true);
  assert.equal(transaction.id, record.creditTransactionId);
  assert.equal(transaction.orderReference, record.orderReference);
  assert.equal(transaction.date, '2026-08-27T03:15:00.000Z');
  assert.equal(transaction.cashier, 'Final Recorder Full Name');
  assert.equal(transaction.creditPaymentMode, 'Cheque');
  assert.equal(transaction.paymentReference, 'CHK-001');
  assert.equal(transaction.amountPaid, 1000);
  assert.equal(transaction.remainingBalance, 0);
  assert.deepEqual(transaction.items[0], {
    id: 'CR-20260827-PAID01-0',
    code: 'SALE-ITEM-1',
    name: 'Saved Sale Item',
    qty: 2,
    price: 500,
    subtotal: 1000,
  });
});

test('unpaid and partially paid Credit transactions are not receipt eligible', async () => {
  const { isFullyPaidCreditTransaction } = await loadCreditReceipt();

  assert.equal(isFullyPaidCreditTransaction({ status: 'Unpaid', remainingBalance: 100 }), false);
  assert.equal(isFullyPaidCreditTransaction({ status: 'Partially Paid', remainingBalance: 50 }), false);
  assert.equal(isFullyPaidCreditTransaction({ status: 'Overdue', remainingBalance: 100 }), false);
});

test('a finalized Cash credit payment is displayed as Cash on the receipt', async () => {
  const { buildCreditReceiptTransaction } = await loadCreditReceipt();
  const transaction = buildCreditReceiptTransaction({
    creditTransactionId: 'CR-20260828-CASH01',
    status: 'Paid',
    remainingBalance: 0,
    paymentHistory: [{ method: 'cash', paymentDate: '2026-08-28T04:00:00.000Z' }],
  });

  assert.equal(transaction.creditPaymentMode, 'Cash');
});

test('paid Credit receipt keeps safe legacy actor fallbacks', async () => {
  const { buildCreditReceiptTransaction } = await loadCreditReceipt();

  const displayNameFallback = buildCreditReceiptTransaction({
    creditTransactionId: 'CR-LEGACY-DISPLAY',
    status: 'Paid',
    remainingBalance: 0,
    paymentHistory: [{ recordedByUser: { displayName: 'Legacy Display Name' } }],
  });
  const storedNameFallback = buildCreditReceiptTransaction({
    creditTransactionId: 'CR-LEGACY-SNAPSHOT',
    status: 'Paid',
    remainingBalance: 0,
    paymentHistory: [{ recordedBy: 'Saved Historical Actor' }],
  });

  assert.equal(displayNameFallback.cashier, 'Legacy Display Name');
  assert.equal(storedNameFallback.cashier, 'Saved Historical Actor');
});
