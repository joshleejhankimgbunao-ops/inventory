import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pagePath = new URL('../../src/pages/SpecialOrders.jsx', import.meta.url);
const page = readFileSync(fileURLToPath(pagePath), 'utf8');
const order = {
  _id: 'order-1', createdBy: 'owner-1', status: 'In Progress', workflowVersion: 2,
  currentQuotation: 'quote-1', transactionQuotation: 'quote-1', taxTreatment: 'standard',
};
const quotation = {
  _id: 'quote-1', isCurrent: true, status: 'Accepted',
  customerDetails: { taxTreatment: 'standard' }, documentSnapshot: { taxTreatment: 'standard' },
};

const actionFor = async (state = {}) => {
  const { getPhaseFiveTableNextAction } = await import('../../src/utils/specialOrderTableActions.js');
  return getPhaseFiveTableNextAction({ order, quotation, role: 'admin', userId: 'admin-1', ...state });
};

test('unpaid and partially paid in-progress orders expose Record Payment', async () => {
  assert.equal((await actionFor()).type, 'record-payment');
  const partialPayment = { status: 'Partially Paid', remainingBalanceCentavos: 5000 };
  assert.equal((await actionFor({ paymentLedger: partialPayment })).type, 'record-payment');
  assert.equal((await actionFor({ paymentLedger: partialPayment, stockLoading: true })).type, 'record-payment');
});

test('table eligibility uses the full authoritative quotation instead of the list projection', async () => {
  const partialPayment = { status: 'Partially Paid', remainingBalanceCentavos: 5000 };
  const listProjection = { ...quotation, documentSnapshot: undefined };
  const projectedResult = await actionFor({ quotation: listProjection, paymentLedger: partialPayment });
  assert.equal(projectedResult.type, 'payment-blocked');
  assert.match(projectedResult.reason, /quotation needs review/i);
  assert.equal((await actionFor({ quotation, paymentLedger: partialPayment })).type, 'record-payment');
});

test('fully paid orders expose Complete Order only when stock and fulfillment are ready', async () => {
  const paymentLedger = { status: 'Fully Paid', remainingBalanceCentavos: 0 };
  assert.equal((await actionFor({ paymentLedger, stockAvailability: { items: [], fulfillment: { canComplete: true } } })).type, 'complete-order');
  const blocked = await actionFor({ paymentLedger, stockAvailability: { items: [{ itemType: 'inventory', shortage: 2 }], fulfillment: { canComplete: false } } });
  assert.equal(blocked.type, 'complete-blocked');
  assert.match(blocked.reason, /Insufficient stock/);
});

test('completion remains blocked while availability is missing or a reservation needs review', async () => {
  const paymentLedger = { status: 'Fully Paid', remainingBalanceCentavos: 0 };
  assert.equal((await actionFor({ paymentLedger })).type, 'complete-blocked');
  const review = await actionFor({ paymentLedger, stockAvailability: { items: [{ itemType: 'inventory', reservationNeedsReview: true }], fulfillment: { canComplete: false } } });
  assert.match(review.reason, /reservation needs review/i);
});

test('workflow actions respect owner permissions and do not appear for completed or cancelled orders', async () => {
  const { getPhaseFiveTableNextAction } = await import('../../src/utils/specialOrderTableActions.js');
  assert.equal(getPhaseFiveTableNextAction({ order, quotation, role: 'cashier', userId: 'another-cashier' }), null);
  assert.equal(getPhaseFiveTableNextAction({ order: { ...order, status: 'Cancelled' }, quotation, role: 'admin' }), null);
  assert.equal(getPhaseFiveTableNextAction({ order: { ...order, status: 'Completed' }, quotation, role: 'admin' }), null);
});

test('payment and completion table clicks recheck server state and reuse guarded workflows', () => {
  assert.match(page, /openOrderDetails\(order, \{ action: 'payment' \}\)/);
  assert.match(page, /openOrderDetails\(order, \{ action: 'complete-order' \}\)/);
  assert.match(page, /listSpecialOrderQuotationsApi\(order\._id\)/);
  assert.match(page, /quotation: currentQuotation/);
  assert.match(page, /getPhaseFiveTableNextAction\(/);
  assert.match(page, /setCompletionConfirmOpen\(true\)/);
  assert.match(page, /const confirmCompletion = \(\) => \{/);
  assert.match(page, /void loadOrders\(\);/);
});

test('View Transaction requires Completed status, a linked sale, and permission', async () => {
  const { canViewSpecialOrderTransaction } = await import('../../src/utils/specialOrderTableActions.js');
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'In Progress', linkedSaleId: 'sale-1' }, true), false);
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'In Progress', linkedSaleId: 'sale-1', paymentStatus: 'Fully Paid' }, true), false);
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'In Progress', linkedSaleId: 'sale-1', saleStatus: 'Sale Recorded' }, true), false);
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'Completed', linkedSaleId: 'sale-1' }, true), true);
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'Completed', linkedSaleId: '' }, true), false);
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'Completed', linkedSaleId: 'sale-1' }, false), false);
  assert.equal(canViewSpecialOrderTransaction({ ...order, status: 'Cancelled', linkedSaleId: 'sale-1' }, true), false);
  assert.match(page, /canViewSpecialOrderTransaction\(order, capabilities\.allowed\)/);
});
