/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pointOfSaleSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
const transactionReferenceModalSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/TransactionReferenceModal.jsx'), 'utf8');
const orderConfirmationSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/OrderConfirmationModal.jsx'), 'utf8');
const correctionModalSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/TransactionReferenceCorrectionModal.jsx'), 'utf8');
const historySource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/History.jsx'), 'utf8');
const receiptPreviewSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ReceiptPreviewModal.jsx'), 'utf8');

const getSection = (startMarker, endMarker) => {
  const start = pointOfSaleSource.indexOf(startMarker);
  const end = pointOfSaleSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return pointOfSaleSource.slice(start, end);
};

test('Payment prepares a draft and does not call a sale endpoint', () => {
  const payment = getSection('const handleCheckout = async () => {', 'const finalizeCheckoutDraft = async');

  assert.match(payment, /setCheckoutDraft\(\{/);
  assert.match(payment, /setCheckoutPhase\('confirmation'\)/);
  assert.doesNotMatch(payment, /createSaleApi|finalizeSaleWithReferenceApi|setTransactions|setInventory|logAction/);
});

test('pending Order Confirmation has safe back navigation and no fabricated transaction identifier', () => {
  const confirmation = getSection("{checkoutPhase === 'confirmation' && checkoutDraft && (", "{checkoutPhase === 'reference' && checkoutDraft && (");

  assert.match(confirmation, /pending/);
  assert.match(confirmation, /onBack=\{\(\) => setCheckoutPhase\('payment'\)\}/);
  assert.match(confirmation, /onContinue=\{\(\) => setCheckoutPhase\('reference'\)\}/);
  assert.match(orderConfirmationSource, /Pending final save/);
  assert.match(orderConfirmationSource, /pending \? 'Pending final save' : transaction\?\.id/);
  assert.match(orderConfirmationSource, /ORDER_CONFIRMATION_PREVIEW_SIZE\.modal/);
  assert.match(orderConfirmationSource, /ORDER_CONFIRMATION_PREVIEW_SIZE\.content/);
  assert.match(orderConfirmationSource, /<table className="mb-4 w-full table-fixed">/);
  assert.match(orderConfirmationSource, /\{isSpecialOrder && <>[\s\S]*?Customer:[\s\S]*?Payment Method:[\s\S]*?Payment Status:/);
});

test('Transaction Reference preserves a draft and allows a safe return to confirmation', () => {
  const reference = getSection("{checkoutPhase === 'reference' && checkoutDraft && (", "{checkoutPhase === 'order-list' && (");

  assert.match(reference, /initialDraft=\{checkoutReferenceDraft\}/);
  assert.match(reference, /onDraftChange=\{setCheckoutReferenceDraft\}/);
  assert.match(reference, /onBack=\{\(\) => setCheckoutPhase\('confirmation'\)\}/);
  assert.match(reference, /saveLabel="Save Transaction"/);
  assert.match(reference, /onSave=\{finalizeCheckoutDraft\}/);
  assert.match(transactionReferenceModalSource, /const canGoBack = typeof onBack === 'function'/);
  assert.match(transactionReferenceModalSource, /Back to Confirmation/);
  assert.match(transactionReferenceModalSource, /initialDraft\?\.documentFile/);
});

test('only final Save Transaction calls the finalization endpoint and then clears checkout state', () => {
  const finalizer = getSection('const finalizeCheckoutDraft = async', 'const completeFinalizedCheckout =');
  const completion = getSection('const completeFinalizedCheckout =', 'const [printStatus, setPrintStatus]');

  assert.match(finalizer, /finalizeSaleWithReferenceApi/);
  assert.match(finalizer, /clientRequestId: transactionData\.clientRequestId/);
  assert.match(finalizer, /referenceNumber/);
  assert.match(finalizer, /documentFile/);
  assert.match(completion, /setCart\(\[\]\)/);
  assert.match(completion, /setCheckoutDraft\(null\)/);
  assert.match(completion, /showTransactionCompletionToast\(transaction\)/);
});

test('offline cash remains reference-number-only while online flows accept the existing image validation', () => {
  assert.match(pointOfSaleSource, /referenceNumberOnly=\{!checkoutDraft\.canSyncOnline\}/);
  assert.match(transactionReferenceModalSource, /Invoice No\./);
  assert.match(transactionReferenceModalSource, /Enter an invoice number or upload a supporting document\./);
  assert.match(transactionReferenceModalSource, /JPG or PNG up to 5 MB/);
  assert.match(transactionReferenceModalSource, /disabled=\{saving \|\| !hasReference \|\| Boolean\(referenceNumberError\)\}/);
});

test('sale reference interfaces display Invoice No. without changing internal reference keys', () => {
  assert.match(transactionReferenceModalSource, />Invoice No\. /);
  assert.match(correctionModalSource, /Current Invoice No\.|New Invoice No\./);
  assert.match(historySource, />Invoice No\.</);
  assert.match(historySource, /Previous Invoice No\.|Corrected Invoice No\./);
  assert.match(receiptPreviewSource, />Invoice No\.:/);
  for (const source of [transactionReferenceModalSource, correctionModalSource, historySource, receiptPreviewSource]) {
    assert.match(source, /referenceNumber/);
  }
});
