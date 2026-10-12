/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pointOfSaleSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'),
  'utf8',
);
const transactionReferenceModalSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/TransactionReferenceModal.jsx'),
  'utf8',
);
const toastHelperSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/utils/toastHelper.jsx'),
  'utf8',
);

const getSection = (startMarker, endMarker) => {
  const start = pointOfSaleSource.indexOf(startMarker);
  const end = pointOfSaleSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return pointOfSaleSource.slice(start, end);
};

test('successful online checkout keeps the combined confirmation open before Transaction Reference', () => {
  const checkoutSuccess = getSection('const remoteTransaction = {', '// Completion feedback waits until the required Transaction Reference save succeeds.');

  assert.match(checkoutSuccess, /setLastTransaction\(remoteTransaction\);/);
  assert.match(checkoutSuccess, /setPendingReferenceSaleId\(''\);/);
  assert.match(checkoutSuccess, /setCheckoutPhase\('confirmation'\);/);
  assert.doesNotMatch(checkoutSuccess, /setPendingReferenceSaleId\(remoteTransaction\.sourceId\)/);
  assert.doesNotMatch(checkoutSuccess, /showToast\(/);
});

test('Continue to Reference advances the same finalized sale to required reference entry', () => {
  const previewCompletion = getSection('const completeOrderConfirmationPreview = () => {', 'const handlePrintOrderList = async () => {');

  assert.match(previewCompletion, /setShowReceipt\(false\);/);
  assert.match(previewCompletion, /setCheckoutPhase\(null\);/);
  assert.match(previewCompletion, /lastTransaction\?\.sourceId/);
  assert.match(previewCompletion, /hasUsableTransactionReference\(\{ existingReference: lastTransaction\.transactionReference \}\)/);
  assert.match(previewCompletion, /setPendingReferenceSaleId\(lastTransaction\.sourceId\);/);
});

test('draft printing is isolated from payment and confirmation cannot skip Transaction Reference', () => {
  const printHandler = getSection('const handlePrintOrderList = async () => {', 'const receiptTitle =');
  const referenceModal = getSection('{pendingReferenceSaleId && lastTransaction && (', "{checkoutPhase === 'order-list' && (");

  assert.match(printHandler, /documentType: 'order-list-draft'/);
  assert.doesNotMatch(printHandler, /createSaleApi|setCart\(\[\]\)|handleCheckout/);
  assert.match(printHandler, /showErrorDetails\('Unable to print Order List\. Please try again\.'\)/);
  assert.match(pointOfSaleSource, /Confirm & Process Payment/);
  assert.doesNotMatch(referenceModal, /setCheckoutPhase\('order-list'\)/);
});

test('Order List proceeds to the dedicated Payment step and confirmation appears only after finalization', () => {
  assert.match(pointOfSaleSource, /setCheckoutPhase\('payment'\)/);
  assert.match(pointOfSaleSource, /checkoutPhase === 'payment' \|\| \(checkoutPhase === 'confirmation' && lastTransaction\)/);
  assert.match(pointOfSaleSource, /lastTransaction \? 'Order Confirmation' : 'Payment'/);
  assert.match(pointOfSaleSource, /setCheckoutPhase\('confirmation'\);/);
});

test('Payment contains controls and totals only while finalized details stay in Order Confirmation', () => {
  const payment = getSection('{!lastTransaction && (', '{lastTransaction && (<>');
  const confirmation = getSection('{lastTransaction && (<>', '</>)}');

  assert.match(payment, /Payment Method/);
  assert.match(payment, /Cash Tendered/);
  assert.match(payment, /VAT Mode/);
  assert.match(payment, /Total Due/);
  assert.match(payment, /Change/);
  assert.doesNotMatch(payment, /Order Summary|Transaction ID|Date &amp; Time|Cashier|Unit Price/);
  assert.match(confirmation, /Transaction ID|Date &amp; Time|Cashier|Order Summary|Unit Price|Payment Status/);
});

test('finalized Order Confirmation has one explicit reference action and no dismiss control', () => {
  const checkoutModal = getSection("{(checkoutPhase === 'payment'", '{/* Legacy post-sale preview kept inactive');

  assert.match(checkoutModal, /Continue to Reference/);
  assert.doesNotMatch(checkoutModal, /aria-label=\{lastTransaction \? 'Close order confirmation'/);
  assert.match(checkoutModal, /\{!lastTransaction && <button type="button" onClick=\{\(\) => setCheckoutPhase\('order-list'\)\}[\s\S]*?aria-label="Back to order list"/);
});

test('offline checkout retains its required pre-save reference guard', () => {
  const offlineCheckout = getSection('// Offline Cash Sales require a Reference No.', 'const [printStatus, setPrintStatus]');
  const offlineReferenceModal = getSection('{pendingOfflineCheckout && (', '{pendingReferenceSaleId && lastTransaction && (');

  assert.match(offlineCheckout, /setPendingOfflineCheckout\(\{ transactionData, cartSnapshot, canSyncOnline, total \}\);/);
  assert.match(offlineReferenceModal, /requiredFlow/);
  assert.match(offlineReferenceModal, /referenceNumberOnly/);
  assert.match(offlineReferenceModal, /completeOfflineCheckout/);
});

test('transaction completion feedback appears only after the final reference save succeeds', () => {
  const onlineReferenceModal = getSection('{pendingReferenceSaleId && lastTransaction && (', "{checkoutPhase === 'order-list' && (");
  const offlineReferenceModal = getSection('{pendingOfflineCheckout && (', '{pendingReferenceSaleId && lastTransaction && (');

  assert.match(pointOfSaleSource, /const showTransactionCompletionToast = \(transaction\) => \{/);
  assert.match(pointOfSaleSource, /'Transaction Completed'/);
  assert.match(pointOfSaleSource, /The sale has been recorded successfully\./);
  assert.match(pointOfSaleSource, /Transaction \$\{transactionId\} has been completed successfully\./);
  assert.match(pointOfSaleSource, /\{ duration: 4000 \}/);
  assert.match(pointOfSaleSource, /'pos-transaction-reference-complete'/);
  assert.match(onlineReferenceModal, /setPendingReferenceSaleId\(''\);\s*showTransactionCompletionToast\(nextTransaction\);/);
  assert.match(offlineReferenceModal, /setPendingOfflineCheckout\(null\);\s*showTransactionCompletionToast\(completedTransaction\);/);
  assert.match(toastHelperSource, /options\.duration/);
  assert.match(toastHelperSource, /duration: duration/);
});

test('required Transaction Reference keeps one concise instruction and Save Reference action', () => {
  const onlineReferenceModal = getSection('{pendingReferenceSaleId && lastTransaction && (', "{checkoutPhase === 'order-list' && (");

  assert.match(onlineReferenceModal, /saveLabel="Save Reference"/);
  assert.match(transactionReferenceModalSource, /Enter a reference number or upload a document\./);
  assert.match(transactionReferenceModalSource, /placeholder="e\.g\. 123456"/);
  assert.match(transactionReferenceModalSource, /JPG or PNG up to 5 MB/);
  assert.match(transactionReferenceModalSource, /className="sr-only"/);
  assert.match(transactionReferenceModalSource, /Selected: \$\{documentFile\.name\}/);
  assert.match(transactionReferenceModalSource, /disabled=\{saving \|\| !hasReference \|\| Boolean\(referenceNumberError\)\}/);
  assert.doesNotMatch(transactionReferenceModalSource, /Add at least one: Reference No\. or Supporting Document\./);
  assert.match(transactionReferenceModalSource, /requiredFlow = false/);
  assert.match(transactionReferenceModalSource, /const canDismiss = !requiredFlow/);
});
