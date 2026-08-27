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
        recordedByUser: { displayName: 'Final Recorder' },
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
  assert.equal(transaction.cashier, 'Final Recorder');
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
