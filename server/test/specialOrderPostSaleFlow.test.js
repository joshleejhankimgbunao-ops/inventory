/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const specialOrdersSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/SpecialOrders.jsx'),
  'utf8',
);
const orderConfirmationSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/OrderConfirmationModal.jsx'),
  'utf8',
);
const transactionDetailsSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/SpecialOrderTransactionDetailsModal.jsx'),
  'utf8',
);

const getSection = (startMarker, endMarker) => {
  const start = specialOrdersSource.indexOf(startMarker);
  const end = specialOrdersSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return specialOrdersSource.slice(start, end);
};

test('Phase 5 completion opens the reference step only when required and keeps legacy confirmation flow', () => {
  const completion = getSection('const beginCompletion = (order, acceptedQuotation) => {', 'const closeDetails = () => {');

  assert.match(completion, /completionFlow: true/);
  assert.match(completion, /phase: batchItems\.length \? 'batch-verification' : 'reference'/);
  assert.match(completion, /phase: batchItems\.length \? 'batch-verification' : 'reference'/);
  assert.match(completion, /phase: 'confirmation'/);
  assert.match(completion, /referenceDraft/);
  assert.doesNotMatch(completion, /completeSpecialOrderApi|finalizeSpecialOrderWithReferenceApi/);
  assert.match(completion, /acceptedQuotationTransaction\(order, acceptedQuotation/);
});

test('Order Confirmation uses the History receipt proportions, table, and full-width summary', () => {
  for (const label of [
    'Pending final save',
    'Special Order:',
    'Cashier',
    'Date &amp; Time',
    'Customer',
    'Payment Method',
    'Item',
    'Qty',
    'Unit Price',
    'Amount',
    'Net Amount',
    'TOTAL',
    'Payment Status',
    'Cash Received',
    'Change',
  ]) assert.match(orderConfirmationSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.match(orderConfirmationSource, /Continue to Reference/);
  assert.match(orderConfirmationSource, /ORDER_CONFIRMATION_PREVIEW_SIZE\.modal/);
  assert.match(orderConfirmationSource, /ORDER_CONFIRMATION_PREVIEW_SIZE\.content/);
  assert.match(orderConfirmationSource, /<table className="mb-4 w-full table-fixed">/);
  assert.match(orderConfirmationSource, /border-t border-gray-200 pt-3/);
  assert.doesNotMatch(orderConfirmationSource, /<input|<select|<textarea|Print Receipt/);
  assert.doesNotMatch(orderConfirmationSource, /onClose|aria-label="Close/);
});

test('Special Order confirmation keeps its modal until Details loads without opening a payment step', () => {
  const confirmation = getSection("{postSaleFlow?.phase === 'confirmation'", "{postSaleFlow?.phase === 'reference'");
  const details = getSection('const openOrderDetails = async (order,', 'const addItemRow = () => {');

  assert.match(confirmation, /backLabel="Back to Special Orders"/);
  assert.match(confirmation, /openOrderDetails\(postSaleFlow\.order, \{ fromConfirmation: true \}\)/);
  assert.doesNotMatch(confirmation, /phase: 'paused'/);
  assert.match(details, /if \(fromConfirmation\) setPostSaleFlow\(\(previous\) => previous\?\.order\?\._id === order\._id \? \{ \.\.\.previous, phase: 'paused' \} : previous\)/);
  assert.doesNotMatch(specialOrdersSource, /phase === 'payment'|Continue to Payment|Review Order|Cash Received/);
});

test('confirmation and reference steps preserve their drafts until final save', () => {
  const continueFlow = getSection('const continueToTransactionReference = () => {', 'const viewCompletedTransaction = async (order) => {');
  const referenceModal = getSection("{postSaleFlow?.phase === 'reference'", 'export default SpecialOrders;');

  assert.match(continueFlow, /phase: 'reference'/);
  assert.match(continueFlow, /if \(detailLoadRef\.current\) \{\s*quotationGateRef\.current\.invalidate\(\)/);
  assert.match(referenceModal, /initialDraft=\{postSaleFlow\.referenceDraft\}/);
  assert.match(referenceModal, /onBack=\{\(\) => \{/);
  assert.match(referenceModal, /backLabel=\{postSaleFlow\.completionFlow \? 'Back to Details'/);
  assert.match(referenceModal, /requiredFlow/);
  assert.match(referenceModal, /saveLabel=\{postSaleFlow\.completionFlow \? 'Complete Order' : 'Save Transaction'/);
  assert.match(referenceModal, /onSave=\{finalizePostSaleFlow\}/);
  assert.match(referenceModal, /onSaved=\{finishPostSaleFlow\}/);
});

test('Sale recording feedback waits for reference persistence and updates the Sales view', () => {
  const finish = getSection('const finishPostSaleFlow = (updatedSale) => {', 'const downloadSpecialOrderPdf = async (order) => {');

  assert.match(finish, /updatedSale\?\.transactionReference/);
  assert.match(finish, /setTransactions/);
  assert.match(finish, /setPostSaleFlow\(null\)/);
  assert.match(finish, /'Sale Recorded'/);
  assert.match(finish, /void loadOrders\(\)/);
});

test('every completed Special Order including legacy missing evidence opens read-only receipt lookup', () => {
  const recovery = getSection('const viewCompletedTransaction = async (order) => {', 'const finishPostSaleFlow = (updatedSale) => {');

  assert.match(recovery, /loadFinalizedSpecialOrderReceipt\(order\)/);
  assert.match(recovery, /setCompletedTransactionPreview\(finalized\)/);
  assert.doesNotMatch(recovery, /setPostSaleFlow|hasUsableTransactionReference|phase: 'confirmation'/);
  assert.doesNotMatch(specialOrdersSource, /updateSaleTransactionReferenceApi/);
});

test('completed invoice-only and image-only receipts open read-only details instead of reference checkout', async () => {
  const { hasUsableTransactionReference } = await import('../../src/utils/transactionReference.js');
  for (const reference of [{ referenceNumber: '001234' }, { supportingDocument: { originalName: 'invoice.png' } }, { referenceNumber: '001234', supportingDocument: { originalName: 'invoice.png' } }]) {
    assert.equal(hasUsableTransactionReference({ referenceNumber: reference.referenceNumber, existingReference: reference }), true);
  }
  assert.equal(hasUsableTransactionReference({ referenceNumber: '', existingReference: null }), false);
  const recovery = getSection('const viewCompletedTransaction = async (order) => {', 'const finishPostSaleFlow = (updatedSale) => {');
  assert.match(recovery, /setCompletedTransactionPreview\(finalized\)/);
  assert.match(specialOrdersSource, /<SpecialOrderTransactionDetailsModal/);
});

test('completed supporting image preview uses authenticated blob access with cleanup and unavailable feedback', () => {
  assert.match(specialOrdersSource, /getSaleSupportingDocumentApi\(completedTransactionPreview\.receiptTransaction\.sourceId\)/);
  assert.match(specialOrdersSource, /URL\.revokeObjectURL\(supportingImage\.url\)/);
  assert.match(specialOrdersSource, /request !== imageRequestRef\.current/);
  assert.match(transactionDetailsSource, /View Image/);
  assert.match(transactionDetailsSource, /supportingDocument && <div/);
  assert.match(transactionDetailsSource, /imageError &&/);
});

test('Special Order Transaction Details uses a structured isolated modal and preserves close and supporting-image actions', () => {
  const completedView = specialOrdersSource.match(/\{completedTransactionPreview && !supportingImage && <SpecialOrderTransactionDetailsModal[\s\S]*?\/>\}/)?.[0];
  assert.ok(completedView, 'Special Orders uses its dedicated transaction details modal');
  assert.match(completedView, /onClose=\{closeCompletedPreview\}/);
  assert.match(completedView, /onViewSupportingImage=\{previewSupportingImage\}/);
  assert.match(completedView, /statusBadgeClass=\{getStatusBadgeClass\}/);
  assert.match(transactionDetailsSource, /aria-labelledby="special-order-transaction-title"/);
  assert.match(transactionDetailsSource, />Transaction Details<\/h2>/);
  assert.match(transactionDetailsSource, /Special Order Reference/);
  assert.match(transactionDetailsSource, /Date & Time/);
  assert.match(transactionDetailsSource, /Recorded By/);
  assert.match(transactionDetailsSource, /Payment Status/);
  assert.match(transactionDetailsSource, /getPaymentBadgeStatus\(paymentStatus\)/);
  assert.match(transactionDetailsSource, /<th scope="col"[^>]*>Item<\/th>[\s\S]*?<th scope="col"[^>]*>Quantity<\/th>[\s\S]*?<th scope="col"[^>]*>Unit Price<\/th>[\s\S]*?<th scope="col"[^>]*>Amount<\/th>/);
  assert.match(transactionDetailsSource, /text-right[^\"]*tabular-nums/);
  assert.match(transactionDetailsSource, /<summary[^>]*>Additional Information<\/summary>/);
  assert.match(transactionDetailsSource, /sm:grid-cols-2/);
  assert.match(transactionDetailsSource, /const hasAdditionalInformation = Boolean\(invoiceReference \|\| supportingDocument\)/);
  assert.match(transactionDetailsSource, /hasAdditionalInformation && <details/);
  assert.doesNotMatch(transactionDetailsSource, /Quotation Version|Order Completed/);
  assert.match(transactionDetailsSource, /Invoice Reference/);
  assert.match(transactionDetailsSource, /Supporting Document/);
  for (const hiddenField of ['Internal Sale ID', 'Financial Sale', 'Fulfillment / Closure', 'Transaction Record Status', 'Request ID', 'Special Order Date', 'Reference Saved', 'Accepted Quotation Version']) {
    assert.doesNotMatch(transactionDetailsSource, new RegExp(hiddenField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(transactionDetailsSource, /onClick=\{onClose\} aria-label="Close transaction details"/);
  assert.match(transactionDetailsSource, /onClick=\{onViewSupportingImage\}/);
  assert.match(specialOrdersSource, /downloadSpecialOrderPdf\(selectedOrder\)/);

  const detailsView = specialOrdersSource.slice(
    specialOrdersSource.indexOf('{selectedOrder && selectedSummary && !quotationEditorOpen'),
    specialOrdersSource.indexOf('{paymentOpen && selectedOrder && quotation &&')
  );
  assert.ok(detailsView.includes('Quotation History'));
  assert.ok(detailsView.includes('version.version'), 'quotation versions remain available in Quotation History');
  assert.match(detailsView, /nextAction\.title/);
  assert.match(specialOrdersSource, /title: 'Order Completed', detail: `Completed\$\{selectedOrder\.completedAt/);
  assert.doesNotMatch(detailsView, /Invoice Reference|supportingDocument/, 'invoice reference and sale supporting document are not exposed in View Details');

  const close = getSection('const closeCompletedPreview = () => {', 'useEffect(() => () => { if (supportingImage?.url)');
  const open = getSection('const viewCompletedTransaction = async (order) => {', 'const finishPostSaleFlow = (updatedSale) => {');
  assert.match(close, /setCompletedTransactionPreview\(null\)/);
  assert.match(close, /setSupportingImage\(null\)/);
  assert.match(open, /setSelectedOrder\(null\)[\s\S]*?setCompletedTransactionPreview\(finalized\)/);

  const pendingConfirmation = getSection("{postSaleFlow?.phase === 'confirmation'", "{postSaleFlow?.phase === 'reference'");
  assert.match(pendingConfirmation, /backLabel="Back to Special Orders"/);
  assert.match(pendingConfirmation, /openOrderDetails\(postSaleFlow\.order, \{ fromConfirmation: true \}\)/);
});

test('Complete Order keeps its single action label on one line and aligns to the right on mobile', () => {
  assert.doesNotMatch(specialOrdersSource, /record-sale|Record Sale/);
  assert.match(specialOrdersSource, /\['complete-order', 'legacy-complete'\]\.includes\(nextAction\.action\) \? 'Complete Order'/);
  assert.match(specialOrdersSource, /\['complete-order', 'legacy-complete'\]\.includes\(nextAction\.action\) \? 'shrink-0 whitespace-nowrap self-end sm:self-auto'/);
});
