/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/CreditTransactions.jsx'), 'utf8');

const getSection = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
};

test('Credit Transaction details uses a compact dialog header and keeps confirmation and payment evidence access', () => {
  const details = getSection('{isDetailsOpen && selectedRecord', '{creditConfirmationView && (');

  assert.doesNotMatch(details, /Print Receipt/);
  assert.match(details, /aria-label="Close credit transaction details"/);
  assert.match(details, /<h2 id="credit-transaction-details-title"[^>]*>Credit Transaction Details<\/h2>/);
  assert.match(details, /Payment Status/);
  assert.doesNotMatch(details, />Credit ID</);
  assert.doesNotMatch(details, /Paid Payment Details/);
  assert.doesNotMatch(details, />Close<\/button>/);
  assert.match(details, /View Confirmation/);
  assert.match(source, /<OrderConfirmationModal[\s\S]*?readOnly/);
  assert.match(source, /setCreditConfirmationView\(null\)/);
  assert.match(details, /selectedCreditConfirmation && <footer[\s\S]*?View Confirmation/);
  assert.match(details, /Payment History/);
  assert.match(details, /handleViewPaymentProof/);
  assert.match(details, /handleViewCancellationProof/);
  assert.match(details, /selectedLegacyProofIsInHistory/);
  assert.match(details, /handleViewProof/);
});

test('saved Credit confirmation has no transaction editing or printing actions', () => {
  const standardConfirmation = fs.readFileSync(path.resolve(__dirname, '../../src/components/OrderConfirmationModal.jsx'), 'utf8')
    .split('const OrderConfirmationModal =')[0];

  assert.match(standardConfirmation, /Saved transaction · View only/);
  assert.match(standardConfirmation, /readOnly \? \([\s\S]*?onClick=\{onContinue \|\| onBack\}[\s\S]*?>Close<\/button>/);
  assert.doesNotMatch(standardConfirmation, /Print Receipt|Print Confirmation/);
});

test('recorded Credit payments reopen the saved Charge Sales Invoice confirmation without print actions', () => {
  assert.match(source, /const finalizedRecord = await getCreditTransactionByIdApi\(paidTransactionId\);[\s\S]*?const confirmation = buildCreditConfirmation\(finalizedRecord\);[\s\S]*?setCreditConfirmationView\(confirmation\);/);
  assert.match(source, /<OrderConfirmationModal[\s\S]*?readOnly/);
  assert.doesNotMatch(source, /ReceiptPreviewModal|Print Confirmation|Print Again|printCreditReceipt/);
});

test('Record Payment summary separates current and projected balances without counting the input as paid', () => {
  const paymentSummary = getSection('id="credit-payment-balance-after"', 'label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Transaction Date');

  assert.match(paymentSummary, /grid grid-cols-2/);
  assert.match(paymentSummary, />Invoice Total</);
  assert.match(paymentSummary, /formatMoney\(markPaidTarget\.totalAmount\)/);
  assert.match(paymentSummary, />Total Paid</);
  assert.match(paymentSummary, /formatMoney\(markPaidTarget\.amountPaid\)/);
  assert.match(paymentSummary, />Remaining Balance</);
  assert.match(paymentSummary, /formatMoney\(markPaidTarget\.remainingBalance\)/);
  assert.match(paymentSummary, />Balance After Payment</);
  assert.match(paymentSummary, /balanceAfterPayment === null \? '—' : formatMoney\(balanceAfterPayment\)/);
  assert.match(source, /const outstandingBalance = Number\(markPaidTarget\?\.remainingBalance \|\| 0\)/);
  assert.match(source, /paymentAmount > outstandingBalance/);
  assert.match(source, /Math\.max\(0, outstandingBalance - paymentAmount\)/);
  assert.match(source, /paymentAmountError \|\| !Number\.isFinite\(paymentAmount\)[\s\S]*?\? null/);
});

test('Credit Transaction rows trust the server ownership filter instead of comparing display names', () => {
  assert.doesNotMatch(source, /currentCashier/);
  assert.doesNotMatch(source, /cashierName && cashierName !== currentCashier/);
  assert.match(source, /const detail = await getCreditTransactionByIdApi\(row\._id\)/);
});

test('Customer Overdue History separates payment lateness from overdue periods before extensions', () => {
  const history = fs.readFileSync(path.resolve(__dirname, '../../src/components/CustomerOverdueHistoryModal.jsx'), 'utf8');
  assert.match(history, /Payment Days Late/);
  assert.match(history, /Overdue Before Extension/);
  assert.match(history, /Paid on Time/);
  assert.match(history, /Needs Review/);
  assert.doesNotMatch(history, />Days late</);
  assert.doesNotMatch(history, />Unverified</);
  assert.match(history, /timeZone: 'Asia\/Manila'/);
});

test('Paid desktop rows use the existing navy View Details action while other statuses keep the outlined style', () => {
  const viewDetails = source.match(/<TableActionButton[\s\S]*?onClick=\{\(\) => handleOpenDetails\(row\)\}[\s\S]*?label="View Details"[\s\S]*?<\/TableActionButton>/)?.[0];
  assert.ok(viewDetails, 'desktop table retains its icon-only View Details action');
  assert.match(viewDetails, /className=\{displayStatus === 'Paid' \? 'credit-record-payment-action' : ''\}/);
  assert.match(viewDetails, /label="View Details"/);
  assert.match(viewDetails, /handleOpenDetails\(row\)/);
  assert.match(source, /<div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 min-\[380px\]:grid-cols-2">[\s\S]*?<button type="button" onClick=\{\(\) => handleOpenDetails\(row\)\} className="inline-flex min-h-10 min-w-0 items-center justify-center gap-1\.5 rounded-lg border border-slate-300 bg-white/);
});
