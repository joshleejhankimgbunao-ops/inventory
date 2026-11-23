const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const load = () => import('../../src/utils/specialOrderQuotation.js');
const loadItemRemoval = () => import('../../src/utils/quotationItemRemoval.js');
const loadItemValidation = () => import('../../src/utils/specialOrderItemValidation.js');
const page = fs.readFileSync(path.resolve(__dirname, '../../src/pages/SpecialOrders.jsx'), 'utf8');
const apiClient = fs.readFileSync(path.resolve(__dirname, '../../src/services/inventoryApi.js'), 'utf8');

test('custom-only final payment requests Sale evidence separately from optional payment proofs', () => {
  assert.match(page, /quotation\.items\.every\(\(item\) => item\.itemType === 'custom' && !item\.inventoryProduct && !item\.inventorySnapshot\)/);
  assert.match(page, /parseMoneyToCentavos\(paymentForm\.amount\) === paymentLedger\.remainingBalanceCentavos/);
  assert.match(page, /Provide an Invoice No\. or Supporting Document to record the Sale\./);
  assert.match(page, /finalCustomPayment && <div[^\n]*Invoice No\.[^\n]*label="Supporting Document"[^\n]*maxFiles=\{1\}/);
  assert.match(page, /label="Payment Proof Photos"[^\n]*maxFiles=\{3\}/);
  assert.match(page, /result\.order\?\.linkedSaleId \? 'Payment and Sale Recorded'/);
  assert.match(apiClient, /if \(invoiceNumber\) body\.append\('invoiceNumber', invoiceNumber\)/);
  assert.match(apiClient, /if \(saleDocuments\?\.\[0\]\) body\.append\('document', saleDocuments\[0\]\)/);
  assert.match(apiClient, /for \(const file of proofs \|\| \[\]\) body\.append\('proofs', file\)/);
});

test('accepting a current Phase 1 quotation opens the existing down-payment modal; dismissal preserves Details', () => {
  const handler = page.match(/const recordQuotationDecision = \(decision\) => runQuotationAction\('quotation-decision',[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(handler, 'quotation decision handler exists');
  assert.match(handler, /const updated = await decideSpecialOrderQuotationApi/);
  assert.match(handler, /setSelectedOrder\(view\)/);
  assert.match(handler, /setDecisionOpen\(false\)/);
  assert.match(handler, /if \(decision === 'Accepted' && Number\(view\.workflowVersion\) >= 2 && !paymentLedger\)/);
  assert.match(handler, /setPaymentForm\(\{ amount: getSpecialOrderDownPaymentInput\(decidedQuotation\.total, '50'\), downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash'/);
  assert.match(handler, /setPaymentOpen\(true\)/);
  assert.ok(handler.indexOf('await decideSpecialOrderQuotationApi') < handler.indexOf("if (!isCurrent()) return;")
    && handler.indexOf("if (!isCurrent()) return;") < handler.indexOf('setPaymentOpen(true)'), 'only a successful current acceptance can open payment');
  assert.match(page, /if \(!selectedOrder \|\| quotationLoading \|\| \(quotationError && !quotationEditorOpen && !decisionOpen\) \|\| quotationActionRef\.current\) return/);
  assert.match(page, /if \(!selectedOrder \|\| !quotation \|\| !canProcessSpecialOrder \|\| paymentInFlightRef\.current\) return/);
  assert.match(page, /if \(!paymentLedger \|\| paymentLedger\.status !== 'Fully Paid'[\s\S]*action: 'record-payment'/);
  assert.match(page, /isCreditSpecialOrder \? 'Open Credit Transaction' : paymentLedger \? 'Record Final Payment' : 'Record Down Payment'/);
  assert.match(page, /onClick=\{\(\) => \{ setPaymentOpen\(false\); setPaymentError\(''\); \}\}/);
  assert.ok(page.indexOf('await (additional ? recordSpecialOrderPaymentApi') < page.indexOf('setPaymentOpen(false);', page.indexOf('const recordPayment = async')),
    'successful payment submission closes the modal after the API succeeds');
  assert.match(page, /setPaymentOpen\(false\);\s*setPaymentForm\(\{ amount: '', downPaymentPercentage: '50', paymentPlan: 'cash', termDays: '30', method: 'cash'/);
});

test('Special Order Credit down payment uses the full-width bounded POS-style credit term stepper', () => {
  const creditTermStart = page.indexOf("{!paymentLedger && paymentForm.paymentPlan === 'credit'");
  const creditTermEnd = page.indexOf("{paymentForm.method === 'other'", creditTermStart);
  const creditTermField = page.slice(creditTermStart, creditTermEnd);
  assert.ok(creditTermField, 'Credit Term is rendered only for an unpaid Credit payment plan');
  assert.match(creditTermField, /grid w-full grid-cols-\[2\.5rem_minmax\(0,1fr\)_2\.5rem\] gap-2/);
  assert.match(creditTermField, /aria-label="Decrease credit term by one day"/);
  assert.match(creditTermField, /aria-label="Increase credit term by one day"/);
  assert.match(creditTermField, /onClick=\{decrementSpecialOrderCreditTerm\}/);
  assert.match(creditTermField, /onClick=\{incrementSpecialOrderCreditTerm\}/);
  assert.match(creditTermField, /bg-slate-900[\s\S]*?text-white/);
  assert.match(creditTermField, /value=\{paymentForm\.termDays\}[\s\S]*?onChange=\{\(event\) => handleSpecialOrderCreditTermChange\(event\.target\.value\)\}/);
  assert.match(creditTermField, /onKeyDown=\{preventInvalidWholeNumberKeyDown\}[\s\S]*?onPaste=\{preventInvalidWholeNumberPaste\}/);
  assert.match(creditTermField, /disabled=\{Boolean\(orderAction\) \|\| !isWholeNumberInput\(paymentForm\.termDays, \{ min: SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS, max: SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS \}\) \|\| Number\(paymentForm\.termDays\) <= SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS\}/);
  assert.match(creditTermField, /Number\(paymentForm\.termDays\) >= SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS/);
  assert.match(page, /const SPECIAL_ORDER_MIN_CREDIT_TERM_DAYS = 1;/);
  assert.match(page, /const SPECIAL_ORDER_MAX_CREDIT_TERM_DAYS = 60;/);
  assert.match(page, /if \(!additional && paymentForm\.paymentPlan === 'credit' && \(!isWholeNumberInput\(paymentForm\.termDays\) \|\| Number\(paymentForm\.termDays\) < 1 \|\| Number\(paymentForm\.termDays\) > 60\)\)/);
  assert.match(page, /recordSpecialOrderDownPaymentApi\)\(orderId, \{ \.\.\.paymentForm, requestId: paymentRequestRef\.current \}\)/);
});

test('Cash and Credit Special Orders default to an editable percentage and link Credit settlement to Credit Transactions', () => {
  const backend = fs.readFileSync(path.resolve(__dirname, '../src/controllers/specialOrderController.js'), 'utf8');
  const creditController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/creditTransactionController.js'), 'utf8');
  const creditPage = fs.readFileSync(path.resolve(__dirname, '../../src/pages/CreditTransactions.jsx'), 'utf8');

  assert.match(page, /paymentPlan: 'cash', termDays: '30'/);
  assert.match(page, /role="group" aria-label="Payment Plan"/);
  assert.match(page, /paymentLedger\?\.paymentPlan \|\| paymentForm\.paymentPlan/);
  assert.match(page, /!paymentLedger && <label className="block text-xs font-medium text-slate-600">Down Payment Percentage/);
  assert.match(page, /paymentLedger \? 'Final Payment Amount' : 'Required Down Payment'/);
  assert.match(page, /flex max-h-\[92vh\] w-full max-w-\[30rem\] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl/);
  assert.match(page, /min-h-0 flex-1 overflow-y-auto p-4 sm:p-5/);
  assert.match(page, /grid shrink-0 grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/);
  assert.match(page, /aria-label="Close payment dialog"/);
  assert.match(page, /Order Total/);
  assert.match(page, /Down Payment/);
  assert.match(page, /Remaining Balance/);
  assert.match(page, /downPaymentPercentage: '50'/);
  assert.match(page, /type="number" inputMode="decimal" min="0\.01" max="100" step="0\.01" value=\{paymentForm\.downPaymentPercentage\}/);
  assert.match(page, /getSpecialOrderDownPaymentInput\(quotation\.total, downPaymentPercentage\)/);
  assert.match(page, /getSpecialOrderRemainingBalanceCentavos\(quotation\?\.total, paymentForm\.downPaymentPercentage\)/);
  assert.match(page, /paymentSummaryRemainingCentavos = paymentLedger[\s\S]*getSpecialOrderRemainingBalanceCentavos\(quotation\?\.total, paymentForm\.downPaymentPercentage\)/);
  assert.match(backend, /parseDownPaymentPercentageBasisPoints\(req\.body\?\.downPaymentPercentage\)/);
  assert.match(backend, /calculateDownPaymentCentavos\(approvedTotalCentavos, downPaymentPercentageBasisPoints\)/);
  assert.match(backend, /amountCentavos !== expectedDownPaymentCentavos/);
  assert.match(backend, /downPaymentPercentage: downPaymentPercentageBasisPoints \/ 100/);
  assert.match(backend, /if \(paymentPlan === 'credit'\) \{[\s\S]*?recordCreditSpecialOrderSale\(/);
  assert.match(backend, /paymentPlan,\s*\.\.\.\(creditRecords \? \{ creditTransaction: creditRecords\.creditTransaction\._id/);
  assert.match(backend, /if \(ledger\.paymentPlan === 'credit'\) throw[\s\S]*linked Credit Transaction/);
  assert.match(page, /paymentLedger\?\.paymentPlan === 'credit'[\s\S]*navigate\(`\/credit-transactions\?search=/);
  assert.match(creditPage, /useSearchParams\(\)/);
  assert.match(creditPage, /markPaidTarget\.collectionSource === 'special_order_ledger'[\s\S]*markCreditTransactionPaidApi/);
  assert.match(creditController, /Credit Special Order balances must be settled in one final payment/);
  assert.match(creditController, /specialOrderLedger\.remainingBalanceCentavos = 0/);
  assert.match(creditController, /specialOrderLedger\.status = 'Fully Paid'/);
});

test('Phase 4 details use the accepted quotation for a guarded down-payment action and payment-specific evidence', () => {
  assert.match(page, /getSpecialOrderPaymentsApi\(order\._id\)/);
  assert.match(page, /value=\{paymentForm\.amount\} placeholder="0\.00" readOnly/);
  assert.match(page, /value=\{paymentForm\.reference\} placeholder="Enter payment reference"/);
  assert.match(page, /quotation\?\.status === 'Accepted'/);
  assert.match(page, /Record Down Payment/);
  assert.match(page, /Payment Reference \(or upload proof\)/);
  assert.match(page, /Payment reference will be generated automatically\./);
  assert.match(page, /Payment Notes \(Optional\)/);
  assert.match(page, /placeholder="Add payment details or remarks\.\.\."/);
  assert.match(page, /payment\.internalReference \|\| payment\.reference/);
  assert.match(page, /payment\.notes/);
  assert.match(page, /I confirm this cheque has cleared\./);
  assert.match(page, /const showPaymentSection = Number\(selectedOrder\?\.workflowVersion\) >= 2[\s\S]*Boolean\(paymentLedger\)/);
  assert.match(page, /<EvidenceUploadField[^\n]*label="Payment Proof Photos"[^\n]*maxFiles=\{3\}/);
  assert.doesNotMatch(page, /<EvidenceUploadField[^\n]*label="Payment Proof Photos"[^\n]*minFiles=\{1\}/);
  assert.match(page, /getSpecialOrderPaymentProofApi\(selectedOrder\._id, payment\.requestId, index\)/);
  assert.match(page, /canManageOrderExceptions && !paymentLedger && <button[^\n]*Release Reservation/);
  assert.match(page, /canManageOrderExceptions && Number\(selectedOrder\.workflowVersion\) >= 2[\s\S]*Cancel Order/);
});

test('Special Order down-payment and final payment amounts remain read-only calculations', () => {
  const input = page.match(/<input type="text" inputMode="decimal" value=\{paymentForm\.amount\}[\s\S]*?aria-label=\{paymentLedger \? 'Final Payment Amount' : 'Required Down Payment'\} \/>/)?.[0];
  assert.ok(input, 'calculated payment amount field exists');
  assert.match(input, /readOnly/);
  assert.match(page, /amount: getSpecialOrderDownPaymentInput\(quotation\.total, downPaymentPercentage\)/);
  assert.match(page, /additional \? amount > paymentLedger\.remainingBalanceCentavos : amount > total/);
});

test('Special Order Details keeps payment and availability facts while using concise summaries', () => {
  for (const label of ['Approved Total', 'Down Payment', 'Total Paid', 'Remaining Balance']) assert.match(page, new RegExp(label));
  assert.match(page, /Stock at payment/);
  assert.match(page, /title: 'Payment Required'/);
  assert.match(page, /title: 'Stock Required', detail: 'Insufficient stock to complete this order\.'/);
  assert.match(page, /title: 'Ready to Complete', detail: inventoryPreparationItems\.length \? 'Fully paid\. Stock available\.' : 'Fully paid\.'/);
  assert.match(page, /title: 'Payment Required', detail: 'Settle the remaining balance to continue\.'/);
  assert.doesNotMatch(page, /record-sale|Record Sale/);
  assert.match(page, /\['complete-order', 'legacy-complete'\]\.includes\(nextAction\.action\) \? 'Complete Order'/);
  assert.match(page, /Paid-order cancellation is temporarily unavailable\./);
  for (const label of ['Ordered:', 'Reserved:', 'Physical Stock:', 'Available to Sell:', 'Reserved Overall:', 'Shortage:']) assert.match(page, new RegExp(label));
  assert.match(page, /const inventoryPreparationItems = useMemo\(\(\) => \(stockAvailability\?\.items \|\| \[\]\)\.filter\(\(item\) => item\.itemType === 'inventory'\)/);
  assert.match(page, /<summary className="w-fit cursor-pointer select-none font-medium">View Stock Details<\/summary>/);
  assert.match(page, /Refresh Stock/);
  assert.match(page, /Reserve Available Stock/);
  assert.doesNotMatch(page, /Refresh Availability|>Allocate Stock</);
  assert.match(page, /Record Payment/);
  assert.match(page, /Payment History/);
  assert.match(page, /metric\.label === 'Payment Status' && metric\.value === 'Fully Paid'[\s\S]*?getStatusBadgeClass\('Completed'\)/);
  assert.match(page, /if \(status === 'Completed'\) return 'border-emerald-200 bg-emerald-50 text-emerald-700'/);
  assert.match(page, /<details className="mt-3 border-t border-slate-200 pt-3">[\s\S]*<summary className="cursor-pointer text-sm font-semibold text-slate-800">Payment History/);
  assert.match(page, /<details className="border-t border-slate-200 py-3" aria-busy=\{quotationLoading\}>[\s\S]*Quotation History/);
  assert.doesNotMatch(page, /Record Prepared Quantity|Prepared quantity for|sourceSpecialOrderCustomItemApi|customSourcingInputs|performFulfillmentAction/);
  assert.doesNotMatch(page, /handoverConfirmationOpen|beginHandoverConfirmation|confirmSpecialOrderHandoverApi|Confirm Pickup|Confirm Delivery/);
  assert.match(page, /completeSpecialOrderProcessingApi/);
  assert.match(page, /unreservedQuantity > 0 && item\.availableToSell > 0/);
  assert.doesNotMatch(page, /Mark as Ready|confirmSpecialOrderReadyApi|mark-ready/);
  assert.match(page, /stockAvailability\.fulfillment\?\.canComplete/);
  assert.match(page, /aria-label="Next action"/);
  assert.match(page, /if \(quotationError \|\| paymentError \|\| stockError\)/);
  assert.match(page, /!approvedTaxTreatment\) \{/);
  assert.match(page, /Number\(selectedOrder\.workflowVersion\) >= 2 && selectedOrder\.status === 'In Progress'/);
  assert.doesNotMatch(page, /Sale recorded\.|Stock status: \{stockAvailability/);
  assert.match(page, /Stock Required/);
  assert.doesNotMatch(page, /quotationActions\.decide && <button/);
  assert.doesNotMatch(page, /paymentLedger\.remainingBalanceCentavos > 0 && !paymentError && canManageStock && <button/);
  assert.match(page, /Inventory Availability<\/h3>\{inventoryPreparationItems\.length > 0 && <p className="mt-0\.5 text-xs text-slate-700">/);
  assert.match(page, /No stock handling required\./);
  assert.match(page, /<h3 className="text-sm font-semibold text-slate-900">Payment<\/h3>/);
  assert.match(page, /nextAction\?\.action === 'record-payment'[\s\S]*?Record Payment/);
  assert.match(page, /Initial Down Payment/);
  assert.match(page, /Ordered Items &amp; Specifications/);
  assert.match(page, /min-h-10/);
  assert.doesNotMatch(page, /Finalization is paused until tax and Phase 5 fulfillment rules are approved\./);
  assert.doesNotMatch(page, /Final sale remains blocked by the VAT\/Phase 5 guard\./);
  assert.doesNotMatch(page, /inventory unit\(s\) reserved; .* unit\(s\) still to source/);
  assert.match(page, /canViewSpecialOrderTransaction\(order, capabilities\.allowed\)[\s\S]*?label: 'View Transaction', icon: 'file-text'/, 'transaction action is gated by completed status, linked sale, and permission');
  assert.match(page, /action\.primary \|\| action\.label === 'View Details'/, 'View Details remains the consistently visible primary row action');
  assert.equal((page.match(/onClick=\{\(\) => downloadSpecialOrderPdf\(selectedOrder\)\} disabled=\{quotationBusy\} className=\{DETAIL_SECONDARY_BUTTON_CLASS\}>Download Transaction PDF<\/button>/g) || []).length, 2, 'completed and linked-order PDF actions remain outlined');
});

test('Special Order transaction details renders recorded data in a structured layout with status tones', () => {
  const filename = path.resolve(__dirname, '../../src/components/SpecialOrderTransactionDetailsModal.jsx');
  const compiled = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', external: ['react'], write: false });
  const componentModule = new Module(filename, module);
  componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
  componentModule._compile(compiled.outputFiles[0].text, filename);
  const Modal = componentModule.exports.default;
  const transaction = {
    id: 'TRX-1234ABCD', sourceId: 'sale-internal-id', specialOrderNumber: 'SO-20261103-0001',
    specialOrderQuotationVersion: 2, date: '2026-11-03T10:00:00.000Z', cashier: 'Recorded Staff',
    customerName: 'JJ Bunao', customerDetails: { address: 'Laguna' }, paymentStatus: 'Paid',
    paymentMethod: 'other', collectionSource: 'special_order_ledger', total: 250,
    vatCalculationStatus: 'not_calculated', taxTreatment: 'standard', netAmount: null, vatAmount: null,
    specialOrderFulfillmentStatus: 'Administrative Closure', status: 'active',
    transactionReference: { referenceNumber: 'INV-1001', supportingDocument: { originalName: 'invoice.png' }, correctionHistory: [] },
    items: [
      { id: 'sku-1', code: 'SKU-1', name: 'Latex Paint', description: 'Long saved product description', qty: 2, sellingUnit: 'cans', price: 100, subtotal: 200 },
      { id: 'sku-2', code: 'SKU-2', name: 'Cement, Sand & Gravel', description: 'Second recorded line', qty: 1, sellingUnit: 'bag', price: 50, subtotal: 50 },
    ],
  };
  const order = { orderNumber: transaction.specialOrderNumber, customerName: transaction.customerName, createdAt: transaction.date, completedAt: '2026-11-03T10:30:00.000Z' };
  const badgeStatuses = [];
  const props = { order, transaction, onClose() {}, onViewSupportingImage() {}, statusBadgeClass: (status) => { badgeStatuses.push(status); return status === 'Completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-800'; } };
  const html = renderToStaticMarkup(React.createElement(Modal, props));
  for (const value of ['Transaction Details', 'TRX-1234ABCD', 'SO-20261103-0001', 'JJ Bunao', 'Recorded Staff', 'SKU-1', 'Long saved product description', 'SKU-2', 'Cement, Sand &amp; Gravel', 'Second recorded line', 'INV-1001', 'Not calculated', 'Recorded Transaction Total', 'Additional Information', 'Invoice Reference', 'Supporting Document', 'invoice.png', 'View Image']) assert.ok(html.includes(value), value);
  for (const redundantField of ['Quotation Version', 'Version 2', 'Order Completed']) assert.ok(!html.includes(redundantField), `removed redundant field: ${redundantField}`);
  for (const hiddenField of ['Internal Sale ID', 'Financial Sale', 'Fulfillment / Closure', 'Transaction Record Status', 'Request ID', 'Special Order Date', 'Reference Saved', 'Accepted Quotation Version']) assert.ok(!html.includes(hiddenField), `hidden field: ${hiddenField}`);
  assert.ok(!html.includes('open=""'), 'Additional Information is collapsed by default');
  for (const column of ['Item', 'Quantity', 'Unit Price', 'Amount']) assert.ok(html.includes(`>${column}</th>`), column);
  assert.ok(html.includes('border-emerald-200 bg-emerald-50 text-emerald-700'));
  assert.deepEqual(badgeStatuses, ['Completed']);

  badgeStatuses.length = 0;
  const partialHtml = renderToStaticMarkup(React.createElement(Modal, { ...props, transaction: { ...transaction, paymentStatus: 'Partially Paid' } }));
  assert.ok(partialHtml.includes('Partially Paid'));
  assert.ok(partialHtml.includes('border-amber-300 bg-amber-50 text-amber-800'));
  assert.ok(!partialHtml.includes('border-emerald-200 bg-emerald-50 text-emerald-700'));
  assert.deepEqual(badgeStatuses, ['In Progress']);

  const noAdditionalHtml = renderToStaticMarkup(React.createElement(Modal, {
    ...props,
    order: { ...order, completedAt: null },
    transaction: {
      ...transaction,
      specialOrderQuotationVersion: null,
      transactionReference: { referenceNumber: '', supportingDocument: null },
    },
  }));
  assert.ok(!noAdditionalHtml.includes('Additional Information'), 'empty optional metadata hides the accordion');

  const uniqueMetadataHtml = renderToStaticMarkup(React.createElement(Modal, {
    ...props,
    transaction: { ...transaction, specialOrderQuotationVersion: 2, transactionReference: { referenceNumber: '', supportingDocument: null } },
  }));
  assert.ok(!uniqueMetadataHtml.includes('Additional Information'), 'quotation version and completion date alone do not create a redundant accordion');

  const invoiceOnlyHtml = renderToStaticMarkup(React.createElement(Modal, {
    ...props,
    transaction: { ...transaction, transactionReference: { referenceNumber: 'INV-ONLY', supportingDocument: null } },
  }));
  assert.ok(invoiceOnlyHtml.includes('INV-ONLY'));
  assert.ok(!invoiceOnlyHtml.includes('Supporting Document'));

  const attachmentOnlyHtml = renderToStaticMarkup(React.createElement(Modal, {
    ...props,
    transaction: { ...transaction, transactionReference: { referenceNumber: '', supportingDocument: { originalName: 'support-only.png' } } },
  }));
  assert.ok(attachmentOnlyHtml.includes('support-only.png'));
  assert.ok(attachmentOnlyHtml.includes('View Image'));
  assert.ok(!attachmentOnlyHtml.includes('Invoice Reference'));

  const cashHtml = renderToStaticMarkup(React.createElement(Modal, { ...props, transaction: { ...transaction, paymentMethod: 'cash', collectionSource: 'sale', cash: 300, change: 50 } }));
  assert.ok(cashHtml.includes('Cash Received'));
  assert.ok(cashHtml.includes('Change'));
  const creditHtml = renderToStaticMarkup(React.createElement(Modal, { ...props, transaction: { ...transaction, paymentMethod: 'credit', collectionSource: 'sale', paymentStatus: 'Partially Paid', creditPaymentMode: 'GCash', downPaymentAmount: 50, remainingBalance: 200 } }));
  assert.ok(creditHtml.includes('Down Payment Method'));
  assert.ok(creditHtml.includes('Down Payment'));
  assert.ok(creditHtml.includes('Remaining Balance'));
});

test('eligible completion confirms first, then verifies tracked batches before the final transaction', () => {
  const nextAction = page.match(/const runNextAction = \(\) => \{[\s\S]*?\n  \};/)?.[0];
  const completion = page.match(/const confirmCompletion = \(\) => \{[\s\S]*?\n  \};/)?.[0];
  const closeConfirmation = page.match(/const closeCompletionConfirmation = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[orderAction\]\);/)?.[0];
  const modalStart = page.indexOf('{completionConfirmOpen && selectedOrder &&');
  const modalEnd = page.indexOf('{cancelOrderOpen && selectedOrder &&', modalStart);
  const modal = page.slice(modalStart, modalEnd);

  assert.ok(nextAction && completion && closeConfirmation && modalStart >= 0 && modalEnd > modalStart);
  assert.match(nextAction, /nextAction\.action === 'complete-order'[\s\S]*?setCompletionConfirmOpen\(true\)/);
  assert.doesNotMatch(nextAction, /completeSpecialOrderProcessingApi/);
  assert.match(closeConfirmation, /if \(orderAction\) return/);
  assert.match(closeConfirmation, /setCompletionConfirmOpen\(false\)/);
  assert.doesNotMatch(closeConfirmation, /completeSpecialOrderProcessingApi|confirmCompletion/);
  assert.match(modal, /Complete Special Order\?/);
  assert.match(modal, /This will record the sale if needed, update applicable inventory, and mark the order as Completed\./);
  assert.match(modal, /onClick=\{closeCompletionConfirmation\} disabled=\{Boolean\(orderAction\)\}[^>]*>Cancel/);
  assert.match(modal, /onClick=\{\(\) => \{ void confirmCompletion\(\); \}\} disabled=\{Boolean\(orderAction\)\}/);
  assert.match(modal, /orderAction === 'complete-order' \? 'Completing…' : 'Confirm Completion'/);
  assert.match(completion, /completionActionRef\.current\?\.inFlight/);
  assert.doesNotMatch(completion, /completeSpecialOrderProcessingApi/);
  assert.match(completion, /setCompletionConfirmOpen\(false\)[\s\S]*?beginCompletion\(selectedOrder, quotation\)/);
  assert.match(page, /<ExpiryBatchVerificationModal[\s\S]*?title="Verify Special Order Batches"/);
  assert.match(page, /batchVerifications: postSaleFlow\.batchVerifications \|\| \[\]/);
  assert.match(page, /if \(order\.linkedSaleId && batchItems\.length === 0\)[\s\S]*?completeSpecialOrderWithoutNewReference/);
  assert.match(page, /if \(postSaleFlow\.existingSale\)[\s\S]*?completeSpecialOrderWithoutNewReference/);
});

test('Refresh Stock is shown only for inventory-linked items, including mixed and historical orders', async () => {
  const { hasInventoryLinkedItems } = await import('../../src/utils/specialOrderPhaseOne.js');
  const custom = { itemType: 'custom', itemName: 'Custom cabinet' };
  const inventoryOrderItem = { itemType: 'inventory', inventoryProduct: 'sku-a' };
  const inventoryAvailabilityItem = { itemType: 'inventory', productId: 'sku-a', remainingToAllocate: 0 };

  assert.equal(hasInventoryLinkedItems([custom]), false);
  assert.equal(hasInventoryLinkedItems([inventoryAvailabilityItem]), true);
  assert.equal(hasInventoryLinkedItems([custom, inventoryAvailabilityItem]), true);
  assert.equal(hasInventoryLinkedItems([inventoryOrderItem]), true, 'saved inventory items remain refreshable when availability fails to load');
  assert.equal(hasInventoryLinkedItems([{ itemName: 'Legacy custom item' }]), false);
  assert.equal(hasInventoryLinkedItems(null), false);
  assert.match(page, /hasInventoryLinkedItems\(stockAvailability\?\.items \?\? selectedSummary\?\.items\)/);
  assert.match(page, /\{showStockRefresh && <button[^\n]*refreshStockAvailability\(\)[^\n]*>Refresh Stock<\/button>\}/);
  assert.match(page, /No stock handling required\./);
  assert.match(page, /stockAvailability\.fulfillment\.status/);
});

test('Cashier details UI exposes standard processing while keeping exception-only actions restricted', () => {
  assert.match(page, /const canProcessSpecialOrder = \['cashier', 'admin', 'superadmin'\]\.includes\(userRole\);/);
  assert.match(page, /const canManageOrderExceptions = userRole === 'admin' \|\| userRole === 'superadmin';/);
  assert.match(page, /&& canProcessSpecialOrder && selectedOrder\?\.status === 'In Progress'/);
  assert.match(page, /action === 'Reserve' \? canProcessSpecialOrder : canManageOrderExceptions/);
  assert.match(page, /\{canProcessSpecialOrder && selectedOrder\.status === 'In Progress' && quotation\?\.status === 'Accepted'/);
  assert.match(page, /return canProcessSpecialOrder\s*\? \{ title: 'Ready to Complete'/);
  assert.match(page, /: \{ title: 'Ready to Complete', detail: 'You do not have permission to complete this order\.'/);
  assert.doesNotMatch(page, /canProcessSpecialOrder && !paymentLedger && <button[^\n]*Release Reservation/);
});

test('Special Order completion does not present a customer default as approved VAT classification', async () => {
  const { approvedSpecialOrderTaxTreatment } = await load();
  const quotation = { customerDetails: { taxTreatment: 'standard' }, documentSnapshot: { customer: { taxTreatment: 'standard' } } };
  assert.equal(approvedSpecialOrderTaxTreatment({ taxTreatment: null }, quotation), null);
  assert.equal(approvedSpecialOrderTaxTreatment({ taxTreatment: 'standard' }, quotation), null);
  assert.equal(approvedSpecialOrderTaxTreatment({ taxTreatment: 'standard' }, { ...quotation, documentSnapshot: { ...quotation.documentSnapshot, taxTreatment: 'standard' } }), 'standard');
  assert.match(page, /!approvedTaxTreatment/);
  assert.match(page, /approvedTaxTreatment \? \(\{ standard: 'VAT-Rated'/);
});
const quotation = () => ({
  _id: 'quote-a', isCurrent: true, status: 'Draft', customer: 'customer-a', customerName: 'Agreed Customer',
  customerDetails: { address: 'Agreed Address' },
  quotationDetails: { attentionName: 'Confirmed Contact', attentionPosition: 'Purchasing', authorizedSignatoryName: 'Confirmed Signatory' },
  items: [{ itemName: 'Original Item', description: 'Original specification', quantity: 3, unitPrice: 0.1, lineAmount: 0.3, sellingUnit: 'pcs' }], total: 0.3,
});

test('editable quotation items and metadata are isolated; Cancel/reopen restores saved values', async () => {
  const { createQuotationDraft, editQuotationItem } = await load();
  const saved = quotation();
  const draft = editQuotationItem(createQuotationDraft(saved), 0, 'itemName', 'Unsaved Item');
  draft.quotationDetails.attentionName = 'Unsaved Contact';
  assert.equal(saved.items[0].itemName, 'Original Item');
  assert.equal(saved.quotationDetails.attentionName, 'Confirmed Contact');
  const reopened = createQuotationDraft(saved);
  assert.equal(reopened.items[0].itemName, 'Original Item');
  assert.equal(reopened.quotationDetails.attentionName, 'Confirmed Contact');
  saved.quotationDetails.attentionName = '';
  saved.customerDetails.attentionName = 'Older Directory Contact';
  assert.equal(createQuotationDraft(saved).quotationDetails.attentionName, '');
});

test('adding, removing and editing items recalculates valid centavo totals without changing saved history', async () => {
  const { createQuotationDraft, addQuotationItem, editQuotationItem, removeQuotationItem, quotationDraftSummary } = await load();
  const saved = quotation();
  let draft = addQuotationItem(createQuotationDraft(saved));
  assert.equal(quotationDraftSummary(draft).valid, false);
  for (const [field, value] of Object.entries({ itemName: 'Custom Item', quantity: '2', unitPrice: '10.25', sellingUnit: 'roll' })) draft = editQuotationItem(draft, 1, field, value);
  assert.equal(quotationDraftSummary(draft).total, 20.8);
  assert.equal(quotationDraftSummary(draft).valid, true);
  draft = removeQuotationItem(draft, 0);
  assert.equal(quotationDraftSummary(draft).total, 20.5);
  assert.equal(saved.items.length, 1);
  assert.equal(quotationDraftSummary(removeQuotationItem(draft, 0)).valid, false);
});

test('out-of-order responses cannot replace the selected order or its customer; closing invalidates pending loads', async () => {
  const { createQuotationRequestGate } = await load();
  const gate = createQuotationRequestGate();
  let releaseOld;
  const oldResponse = new Promise((resolve) => { releaseOld = resolve; });
  const first = gate.begin('order-a');
  let displayed;
  const older = oldResponse.then((value) => { if (gate.isCurrent(first)) displayed = value; });
  const second = gate.begin('order-b');
  if (gate.isCurrent(second)) displayed = { order: 'order-b', customer: 'Customer B' };
  releaseOld({ order: 'order-a', customer: 'Customer A' });
  await older;
  assert.deepEqual(displayed, { order: 'order-b', customer: 'Customer B' });
  const reloaded = gate.begin('order-b');
  assert.equal(gate.isCurrent(second), false);
  gate.invalidate();
  assert.equal(gate.isCurrent(reloaded), false);
});

test('role and current-version rules allow completion only after atomic acceptance and lock final revisions', async () => {
  const { quotationCapabilities } = await load();
  const quote = { ...quotation(), status: 'Accepted' };
  const order = { status: 'Pending', createdBy: 'cashier-a' };
  assert.equal(quotationCapabilities(order, quote, 'cashier', 'cashier-a').revise, false);
  assert.equal(quotationCapabilities(order, quote, 'cashier', 'cashier-a').complete, false);
  assert.equal(quotationCapabilities(order, quote, 'cashier', 'cashier-b').allowed, false);
  assert.equal('start' in quotationCapabilities(order, quote, 'admin', 'admin-a'), false);
  const started = { ...order, status: 'In Progress', transactionQuotation: quote._id };
  assert.equal(quotationCapabilities(started, { ...quote, status: 'Declined' }, 'cashier', 'cashier-a').revise, false);
  assert.equal(quotationCapabilities(order, { ...quote, status: 'Awaiting Decision' }, 'cashier', 'cashier-a').revise, true);
  assert.equal(quotationCapabilities(started, quote, 'cashier', 'cashier-a').complete, true);
  assert.equal(quotationCapabilities({ ...started, workflowVersion: 2 }, quote, 'admin', 'admin-a').complete, false);
  assert.equal(quotationCapabilities(started, { ...quote, isCurrent: false }, 'admin', 'admin-a').complete, false);
  assert.equal(quotationCapabilities({ ...started, currentQuotation: 'different-quote' }, quote, 'admin', 'admin-a').complete, false);
  assert.equal(quotationCapabilities(started, { ...quote, _id: 'new-quote', status: 'Draft' }, 'admin', 'admin-a').complete, false);
  assert.equal(quotationCapabilities({ ...started, status: 'Completed' }, quote, 'superadmin', 'owner').complete, false);
});

test('Phase 1 SKU selection keeps exact product identity, saved unit and price; draft retains fulfillment snapshot', async () => {
  const { inventoryItemFromProduct, fulfillmentDescription } = await import('../../src/utils/specialOrderPhaseOne.js');
  const { createQuotationDraft } = await load();
  const item = inventoryItemFromProduct({ id: 'product-variant-b', code: 'SKU-VARIANT-B', name: 'Variant B', brand: 'Brand A', size: '2 L', sellingUnit: 'can', price: 12.35, attributes: { finish: 'Glossy' } });
  assert.equal(item.inventoryProduct, 'product-variant-b');
  assert.equal(item.sku, 'SKU-VARIANT-B');
  assert.equal(item.sellingUnit, 'can');
  assert.equal(item.unitPrice, '12.35');
  assert.equal(item.originalUnitPrice, 12.35);
  assert.match(item.description, /Glossy/);
  const saved = { ...quotation(), customerDetails: { ...quotation().customerDetails, taxTreatment: 'vat_zero_rated' }, fulfillment: { method: 'Store Pickup', preferredDate: '2026-12-01' }, items: [{ ...quotation().items[0], itemType: 'inventory', inventorySnapshot: { sku: 'SKU-VARIANT-B' } }] };
  const draft = createQuotationDraft(saved);
  assert.equal(draft.items[0].sku, 'SKU-VARIANT-B');
  assert.deepEqual(draft.fulfillment, saved.fulfillment);
  assert.equal(draft.taxTreatment, 'vat_zero_rated');
  assert.match(page, /VAT Classification/);
  assert.match(fulfillmentDescription(saved.fulfillment), /Store Pickup/);
  assert.match(page, /FulfillmentFields/);
  assert.match(page, /InventorySkuPicker/);
});

test('inventory SKU picker shows the selected product in its searchable input', () => {
  const fields = fs.readFileSync(path.resolve(__dirname, '../../src/components/SpecialOrderPhaseOneFields.jsx'), 'utf8');
  assert.match(fields, /const selectedProduct = products\.find\(\(product\) => String\(product\.code \|\| ''\) === String\(selectedSku \|\| ''\)\)/);
  assert.ok(fields.includes("const selectedProductName = selectedProduct ? getProductDisplayName(selectedProduct, categories) : ''"));
  assert.ok(fields.includes('selectedProductName}` : selectedSku || query'));
  assert.match(fields, /onClick=\{\(\) => \{ if \(!open\) \{ setQuery\(''\); setOpen\(true\); \} \}\}/);
  assert.match(fields, /onSelect\(product\); setQuery\(''\); setOpen\(false\);/);
  assert.doesNotMatch(fields, /Selected SKU:/);
  assert.match(page, /inventoryProductPhotosForSelection\(item\.photos, item\.inventoryProduct, product\)/);
});

test('delivery address UI uses optional searchable PSGC fields and canonical Laguna province', () => {
  const fields = fs.readFileSync(path.resolve(__dirname, '../../src/components/SpecialOrderPhaseOneFields.jsx'), 'utf8');
  assert.match(fields, /<option value="">Select an option<\/option>/);
  assert.match(fields, /<option value="Free Delivery">Free Delivery within Laguna<\/option>/);
  assert.match(fields, /value="Laguna" readOnly/);
  assert.match(fields, /placeholder="Select city or municipality"/);
  assert.match(fields, /placeholder="Select barangay"/);
  assert.match(fields, /placeholder="Enter house no\., street, or building"/);
  assert.match(fields, /Delivery details can be provided later\./);
  assert.match(fields, /cityMunicipality, barangay: '', province: 'Laguna'/);
  assert.match(fields, /role="combobox"/);
  assert.match(fields, /ArrowDown/);
  assert.match(fields, /ArrowUp/);
  assert.match(fields, /createPortal\(/);
  assert.doesNotMatch(fields, /City \/ Municipality\*|Barangay\*|Street \/ Building \/ House No\.\*/);
});

test('completion uses accepted customer/items/prices rather than edited order values', async () => {
  const { acceptedQuotationTransaction } = await load();
  const saved = quotation();
  const transaction = acceptedQuotationTransaction({ orderNumber: 'SO-A', customerName: 'Changed Customer', items: [{ itemName: 'Wrong Item', sellingPrice: 999 }] }, saved, 'Staff');
  assert.equal(transaction.customerName, 'Agreed Customer');
  assert.equal(transaction.customerDetails.address, 'Agreed Address');
  assert.equal(transaction.items[0].name, 'Original Item');
  assert.equal(transaction.items[0].description, 'Original specification');
  assert.equal(transaction.items[0].sellingUnit, 'pcs');
  assert.equal(transaction.total, 0.3);
});

test('quotation editor renders metadata, complete item fields, add/remove controls, totals and failure feedback', () => {
  const filename = path.resolve(__dirname, '../../src/components/SpecialOrderQuotationEditor.jsx');
  const compiled = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', external: ['react'], write: false });
  const componentModule = new Module(filename, module);
  componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
  componentModule._compile(compiled.outputFiles[0].text, filename);
  const Editor = componentModule.exports.default;
  const saved = quotation();
  const html = renderToStaticMarkup(React.createElement(Editor, { quotation: saved, draft: { items: [{ ...saved.items[0], itemType: 'custom', sellingUnit: '' }], quotationDetails: saved.quotationDetails, fulfillment: { method: 'Store Pickup' }, taxTreatment: 'standard' }, onChange() {}, onClose() {}, onSave() {}, busy: false, error: 'Save failed; retry', phaseOne: true, userRole: 'admin' }));
  for (const label of ['ATTN', 'Position', 'Authorized Signatory Name', 'Product / Item Name', 'Specifications / Description', 'Selling Unit', 'Line Amount', 'Add Product / Custom Item', 'Remove Item', 'Generate Quotation', 'Save failed; retry']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Selling Unit \(Optional\)/);
  assert.match(html, /Selling Unit <span class="text-rose-700">\*<\/span>/);
  assert.match(html, /placeholder="e\.g\. box or roll"/);
  assert.match(html, /class="[^"]*bg-gray-900[^"]*text-white[^"]*">Add Product \/ Custom Item<\/button>/);
  assert.match(html, /class="[^"]*bg-gray-900[^"]*text-white[^"]*">Save Draft<\/button>/);
  assert.match(html, /class="[^"]*bg-rose-700[^"]*text-white[^"]*" aria-label="Remove quotation item 1">Remove Item<\/button>/);
  assert.ok(!html.includes('Mark as Issued'));
  assert.match(html, /class="min-h-0 flex-1 overflow-y-auto bg-slate-100\/70"><fieldset/);
  assert.match(html, /bg-white p-3 shadow-sm sm:p-4/);
  assert.match(html, /border border-slate-300 bg-white px-3 py-2 text-sm/);
  assert.match(page, /overflow-y-auto bg-slate-50[^"]*\[&_input\]:border-slate-300/);
  assert.match(page, /rounded-xl border border-slate-200 bg-white p-3 sm:p-4/);
  assert.match(html, /<header class="flex shrink-0/);
  assert.match(html, /<footer class="flex shrink-0/);
});

test('quotation editor photo upload area supports browse, desktop drop, and accessible per-photo removal', () => {
  const uploadArea = fs.readFileSync(path.resolve(__dirname, '../../src/components/ProductPhotoUploadArea.jsx'), 'utf8');
  const editor = fs.readFileSync(path.resolve(__dirname, '../../src/components/SpecialOrderQuotationEditor.jsx'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, '../../src/pages/SpecialOrders.jsx'), 'utf8');
  assert.match(uploadArea, /Add Product Photos/);
  assert.match(uploadArea, /JPG, PNG, or WebP · Up to 3 photos, 5 MB each/);
  assert.match(uploadArea, /accept=\{accept\} multiple disabled=\{disabled\}/);
  assert.match(uploadArea, /onDrop=\{\(event\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\); setDragging\(false\); uploadFiles\(event\.dataTransfer\.files\); \}\}/);
  assert.match(editor, /aria-label=\{`Remove \$\{image\.originalName \|\| `product photo \$\{imageIndex \+ 1\}`\}`\}/);
  assert.match(editor, /ProductPhotoUploadArea disabled=\{busy\} onFilesSelected=\{\(files\) => onUploadImages\(item\.itemId, files\)\}/);
  assert.match(page, /ProductPhotoUploadArea disabled=\{disabled\} inputProps=\{inputProps\('photos'\)\} onFilesSelected=\{\(files\) => onChange\(itemId, 'photos', \[\.\.\.\(item\.photos \|\| \[\]\), \.\.\.files\]\)\}/);
  assert.match(editor, /missingPhoto\?\.itemId === item\.itemId && <span className="block text-xs text-rose-600">At least one photo is required before generating\./);
});

test('page wires quotation-first creation, guarded loading and contextual row shortcuts without a start step', () => {
  assert.doesNotMatch(page, /startSpecialOrderTransactionApi|Start Transaction|New Special Order|Edit Special Order/);
  assert.match(page, /quotationFirst: true/);
  assert.doesNotMatch(page, /Save Draft & Continue|requestedRowAction|rowActionHandlersRef/);
  assert.match(page, /generateQuotation: true/);
  assert.match(page, /onClick=\{addItemRow\} disabled=\{isSubmitting\} aria-disabled=\{!canAddAnotherItem \|\| isSubmitting\}[^>]*>Add Item<\/button>/);
  assert.match(page, /ref=\{formScrollContainerRef\} className="min-h-0 space-y-4 overflow-y-auto/);
  assert.match(page, /min-h-0 space-y-4 overflow-y-auto bg-slate-50/);
  assert.match(page, /rounded-xl border border-slate-200 bg-white p-3 sm:p-4/);
  assert.match(page, /grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-12/);
  assert.match(page, /inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1/);
  assert.match(page, /flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white/);
  assert.match(page, /createQuotationDraft\(value, appSettings\)/);
  assert.match(page, /updateSpecialOrderQuotationApi\(selectedOrder\._id, quotation\._id, quotationDraft\)/);
  assert.match(page, /quotationGateRef\.current\.isCurrent\(ticket\)/);
  assert.match(page, /buildSpecialOrderFormalQuotationModel\(saved\.quotation\.documentSnapshot\)/);
  assert.match(page, /phase: 'paused'/);
  assert.doesNotMatch(page, /Mark as Issued/);
});

test('direct quotation form keeps per-item photo controls and submits files by stable item ID', () => {
  const validation = fs.readFileSync(path.resolve(__dirname, '../../src/utils/specialOrderItemValidation.js'), 'utf8');
  for (const label of ['Product Images', 'ProductPhotoUploadArea', 'Replace', 'Remove']) assert.match(page, new RegExp(label));
  assert.match(page, /itemId: globalThis\.crypto\?\.randomUUID/);
  assert.match(page, /createSpecialOrderApi\(payload, quotationItems\.map\(\(item\) => \[item\.itemId, item\.photos\.filter\(\(photo\) => !isProductImageReference\(photo\)\)\]\)\)/);
  assert.match(page, /itemId: item\.itemId/);
  assert.match(validation, /photos\.length > 3/);
});

test('quotation item validation keys errors by stable item ID and validates required values before adding', async () => {
  const { validateSpecialOrderItemRows } = await loadItemValidation();
  const incomplete = {
    itemId: 'newest-item', __rowId: 'newest-row', itemType: 'custom', itemName: '', quantity: '0',
    sellingUnit: '', purchaseCost: '', sellingPrice: '', expectedArrivalDate: '', photos: [],
  };
  const invalid = validateSpecialOrderItemRows([incomplete], { userRole: 'cashier', isDateValid: () => true });
  assert.equal(invalid.firstInvalidField, 'items.newest-item.itemName');
  assert.deepEqual(invalid.errors['newest-item'], {
    itemName: 'Item name is required.',
    sellingUnit: 'Selling Unit is required.',
    quantity: 'Quantity must be a whole number of at least 1.',
    sellingPrice: 'Enter a valid proposed unit price.',
  });

  const validCustom = {
    ...incomplete, itemName: 'Custom Item', sellingUnit: 'box', quantity: '2', sellingPrice: '15.00',
    // Supplier, cost, expected date, description, notes, and images are optional.
  };
  assert.deepEqual(validateSpecialOrderItemRows([validCustom], { isDateValid: () => true }), {
    errors: {}, firstInvalidField: '',
  });

  const validExisting = {
    ...validCustom, itemId: 'existing-item', itemType: 'inventory', sku: 'ELC-004',
    inventoryProduct: 'product-4', originalUnitPrice: 15,
  };
  assert.deepEqual(validateSpecialOrderItemRows([validExisting], { isDateValid: () => true }), {
    errors: {}, firstInvalidField: '',
  });
  const missingInventorySelection = validateSpecialOrderItemRows([{
    ...validExisting, sku: '', inventoryProduct: '',
  }], { isDateValid: () => true });
  assert.equal(missingInventorySelection.firstInvalidField, 'items.existing-item.sku');
  assert.equal(missingInventorySelection.errors['existing-item'].sku, 'Select an exact inventory SKU.');

  const missingUnit = validateSpecialOrderItemRows([{ ...validCustom, sellingUnit: '' }], { isDateValid: () => true });
  assert.equal(missingUnit.firstInvalidField, 'items.newest-item.sellingUnit');
  assert.equal(missingUnit.errors['newest-item'].sellingUnit, 'Selling Unit is required.');
});

test('custom expiry is optional but must be a real calendar date, and selected inventory expiry remains quotation-only', async () => {
  const { validateSpecialOrderItemRows } = await loadItemValidation();
  const custom = { itemId: 'custom-expiry', itemType: 'custom', itemName: 'Custom', sellingUnit: 'box', quantity: '2', purchaseCost: '', sellingPrice: '10', expiryDate: '', photos: [] };
  assert.equal(validateSpecialOrderItemRows([custom]).firstInvalidField, '');
  const invalidCustomDate = validateSpecialOrderItemRows([{ ...custom, expiryDate: '2026-02-30' }]);
  assert.equal(invalidCustomDate.errors['custom-expiry'].expiryDate, 'Enter a valid expiry date.');

  const tracked = {
    itemId: 'tracked', itemType: 'inventory', inventoryProduct: 'product-id', sku: 'SKU-1', itemName: 'Tracked',
    sellingUnit: 'pcs', expiryTrackingEnabled: true, quantity: '3', originalUnitPrice: 10, purchaseCost: '', sellingPrice: '10', photos: [],
    quotationExpirySelections: [{ batch: 'batch-1', batchId: 'B-1', expiryDate: '2027-01-15', quantity: 2 }],
  };
  const info = { tracked: true, reconciled: true, batchOptions: [{ batch: 'batch-1', expiryDate: '2027-01-15', availableQuantity: 2 }] };
  const valid = validateSpecialOrderItemRows([tracked], { expiryBatchInfoByItemId: { tracked: { data: info } } });
  assert.equal(valid.firstInvalidField, '');
  const unavailable = validateSpecialOrderItemRows([tracked], { expiryBatchInfoByItemId: { tracked: { data: { ...info, batchOptions: [{ ...info.batchOptions[0], availableQuantity: 0 }] } } } });
  assert.equal(unavailable.errors.tracked.quotationExpirySelections, 'A selected batch is expired or no longer has enough available stock. Refresh and adjust the selection.');
  const excessive = validateSpecialOrderItemRows([{ ...tracked, quantity: '1' }], { expiryBatchInfoByItemId: { tracked: { data: info } } });
  assert.equal(excessive.errors.tracked.quotationExpirySelections, 'Selected batch quantities cannot exceed the item quantity.');
});

test('quotation item validation reports the first invalid displayed row and keeps optional-value checks', async () => {
  const { validateSpecialOrderItemRows } = await loadItemValidation();
  const row = (itemId, itemName) => ({
    itemId, itemType: 'custom', itemName, sellingUnit: 'pcs', quantity: '1', purchaseCost: '', sellingPrice: '0',
    expectedArrivalDate: '', photos: [],
  });
  const first = validateSpecialOrderItemRows([row('newest', ''), row('older', '')], { isDateValid: () => true });
  assert.equal(first.firstInvalidField, 'items.newest.itemName', 'display order determines which invalid row receives focus');

  const optionalFieldsInvalid = validateSpecialOrderItemRows([{
    ...row('optional-check', 'Item'), purchaseCost: 'not money', expectedArrivalDate: '2020-01-01',
  }], { isDateValid: () => false });
  assert.equal(optionalFieldsInvalid.firstInvalidField, 'items.optional-check.purchaseCost');
  assert.equal(optionalFieldsInvalid.errors['optional-check'].purchaseCost, 'Enter a valid purchase cost if known.');
  assert.equal(optionalFieldsInvalid.errors['optional-check'].expectedArrivalDate, 'Expected date cannot be earlier than today.');
});

test('Prepare Quotation displays newest validated rows first and preserves stable item records and submitted order', () => {
  assert.match(page, /items: \[createFormItem\(\)\]/, 'quotation creation begins with exactly one blank item');
  assert.match(page, /const createFormItem = \(item = \{\}\) => \(\{[\s\S]*?itemId: globalThis\.crypto\?\.randomUUID/);
  const addItem = page.match(/const addItemRow = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
  assert.match(addItem, /const currentItem = currentItems\[currentItems\.length - 1\]/);
  assert.match(addItem, /validateItemRows\(\[currentItem\]\)/);
  assert.match(addItem, /if \(validation\.firstInvalidField\)[\s\S]*?focusQuotationFormField\(validation\.firstInvalidField\);\s*return;/);
  assert.match(addItem, /items: \[\.\.\.\(previous\.items \|\| \[\]\), newItem\]/);
  assert.match(addItem, /focusQuotationFormField\(`items\.\$\{newItem\.itemId\}\.itemName`\)/);
  assert.match(page, /<ItemEditor key=\{item\.itemId \|\| item\.__rowId\} item=\{item\} index=\{index\}/);
  assert.match(page, /\[\.\.\.\(form\.items \|\| \[\]\)\]\.reverse\(\)\.map\(\(item, index\)/);
  assert.match(page, /errors=\{formErrors\.items\?\.\[String\(item\.itemId \|\| item\.__rowId\)\]\}/);
  assert.match(page, /const itemFieldPrefix = `items\.\$\{itemId\}`/);
  assert.match(page, /validateItemRows\(\[updatedItem\]\)\.errors\[targetId\]/, 'existing item errors remain visible until the edited values are valid');
  assert.match(page, /focusQuotationFormField\(firstInvalidField\)/);
  assert.match(page, /const itemValidation = validateItemRows\(items\);[\s\S]*?itemValidation\.firstInvalidField/);
  assert.match(page, /const \{ errors, firstInvalidField \} = validateForm\(\[\.\.\.normalizedItems\]\.reverse\(\)\)/, 'quotation generation validates every displayed row before creating the request');
  assert.match(page, /items: quotationItems\.map\(\(item\) => \(\{/,'quotation submission uses consolidated items in the established underlying order');
});

test('Prepare Quotation consolidates a completed duplicate on Add Item and before saving a quotation', () => {
  const addItem = page.match(/const addItemRow = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
  assert.match(addItem, /consolidateQuotationItems\(currentItems, \{ candidateItemId: currentItem\.itemId \}\)/);
  assert.match(addItem, /if \(applyQuotationItemConsolidation\(consolidation\)\) return;/);
  assert.match(addItem, /focusQuotationFormField\(`items\.\$\{itemId\}\.\$\{field\}`\)/);
  assert.match(page, /const consolidation = consolidateQuotationItems\(normalizedItems\)/, 'Generate Quotation checks every valid form item for older duplicates');
  assert.match(page, /items: quotationItems\.map\(\(item\) => \(\{/);
  assert.match(page, /createSpecialOrderApi\(payload, quotationItems\.map\(\(item\) => \[item\.itemId, item\.photos\.filter/);
  assert.match(page, /Quantity updated for existing item\./);
});

test('Prepare Quotation prepopulates existing SKU images as removable references and submits selected image order', () => {
  const imageHelper = fs.readFileSync(path.resolve(__dirname, '../../src/utils/specialOrderProductImages.mjs'), 'utf8');
  assert.match(page, /photos: inventoryProductPhotosForSelection\(item\.photos, item\.inventoryProduct, product\)/);
  assert.match(page, /isProductImageReference\(photo\)/);
  assert.match(page, /photoSelections: quotationPhotoSelections\(item\.photos\)/);
  assert.match(page, /item\.photos\.filter\(\(photo\) => !isProductImageReference\(photo\)\)/);
  assert.match(page, /item\.photos\.filter\(\(_, current\) => current !== photoIndex\)/);
  assert.match(imageHelper, /Array\.isArray\(product\?\.images\)/);
  assert.match(imageHelper, /source: 'product'/);
});

test('Prepare Quotation confirms individual item removal by stable ID before changing the draft', () => {
  assert.match(page, /onClick=\{\(event\) => onRemove\(item\.itemId, event\.currentTarget\)\}/);
  const requestRemoval = page.match(/const requestRemoveItemRow = \(itemId, trigger\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
  assert.match(requestRemoval, /if \(!hasMeaningfulQuotationItemInput\(targetItem\)\)\s*\{\s*removeItemRowById\(targetId\);\s*closeItemRemovalConfirmation\(\);\s*return;/);
  assert.match(requestRemoval, /setItemRemovalTargetId\(String\(itemId\)\)/);
  assert.doesNotMatch(requestRemoval, /setForm\(/, 'requesting removal never mutates entered item details directly');

  const confirmRemoval = page.match(/const confirmRemoveItemRow = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || '';
  assert.match(confirmRemoval, /removeItemRowById\(targetId\)/);
  assert.match(page, /removeQuotationFormItemById\(currentItems, targetId, createFormItem\)/);
  assert.match(page, /useMemo\(\(\) => \{[\s\S]*?\(form\.items \|\| \[\]\)\.reduce\([\s\S]*?\}, \[form\.items\]\)/, 'the existing summary recalculates from the remaining form items');

  const dismissRemoval = page.match(/const closeItemRemovalConfirmation = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\)/)?.[1] || '';
  assert.match(dismissRemoval, /setItemRemovalTargetId\(null\)/);
  assert.doesNotMatch(dismissRemoval, /setForm\(/, 'Cancel and dismissal preserve the draft');
  assert.match(page, /if \(event\.key === 'Escape'\)[\s\S]*?closeItemRemovalConfirmation\(\)/);
  assert.match(page, /if \(event\.target === event\.currentTarget\) closeItemRemovalConfirmation\(\)/);
  assert.match(page, /<h2 id="remove-quotation-item-title"[^>]*>Remove Item\?<\/h2>/);
  assert.match(page, /Are you sure you want to remove this item from the quotation\?<\/p>/);
  assert.match(page, /itemRemovalSummary\.map\(\(\{ label, value \}\)/);
  assert.match(page, /ref=\{itemRemovalCancelRef\} type="button" onClick=\{closeItemRemovalConfirmation\}[^>]*>Cancel<\/button>/);
  assert.match(page, /onClick=\{confirmRemoveItemRow\} disabled=\{isSubmitting\}[^>]*>Remove<\/button>/);
});

test('quotation removal confirmation distinguishes blank defaults from any entered item value', async () => {
  const { hasMeaningfulQuotationItemInput } = await loadItemRemoval();
  const blank = {
    __rowId: 'row-1', itemId: 'item-1', itemType: 'custom', quantity: 1,
    photos: [], originalUnitPrice: null, itemName: '', description: '  ', sellingUnit: '',
    sku: '', supplierId: '', supplierName: '', purchaseCost: '', sellingPrice: '',
    expectedArrivalDate: '', remarks: '', priceOverrideReason: '',
  };

  assert.equal(hasMeaningfulQuotationItemInput(blank), false, 'generated IDs, default type, default quantity and empty fields are ignored');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, itemName: 'x' }), true, 'a single letter requires confirmation');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, description: '7' }), true, 'a single number requires confirmation');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, sellingPrice: '0' }), true, 'a manually entered zero remains meaningful');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, quantity: '1' }), true, 'an edited quantity matching the default is distinguishable from the untouched numeric default');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, supplierId: 'supplier-1' }), true, 'a selected dropdown value requires confirmation');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, itemType: 'inventory' }), true, 'choosing existing product mode requires confirmation');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, inventoryProduct: 'product-1', sku: 'ELC-004' }), true, 'a selected product requires confirmation');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, photos: [{ name: 'proof.png' }] }), true, 'a manual image requires confirmation');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, attributes: { Variant: '  ' } }), false, 'empty dynamic attributes are ignored');
  assert.equal(hasMeaningfulQuotationItemInput({ ...blank, attributes: { Variant: 'small' } }), true, 'populated dynamic attributes require confirmation');
});

test('quotation item removal summary includes populated identifying details and stable-ID removal preserves other rows', async () => {
  const { getQuotationItemRemovalSummary, removeQuotationFormItemById } = await loadItemRemoval();
  const item = {
    itemType: 'inventory', itemName: 'Electrical Wire', sku: 'ELC-004', description: '2.0mm; Phelps Dodge',
    attributes: { Size: '2.0mm', Brand: 'Phelps Dodge', Color: '' }, supplierName: 'Wire Supplier',
    quantity: '2', sellingUnit: 'roll', sellingPrice: '25.00', expectedArrivalDate: '', remarks: '  ', photos: [],
  };
  assert.deepEqual(getQuotationItemRemovalSummary(item), [
    { label: 'Product', value: 'Electrical Wire' },
    { label: 'SKU', value: 'ELC-004' },
    { label: 'Details', value: '2.0mm; Phelps Dodge' },
    { label: 'Supplier', value: 'Wire Supplier' },
    { label: 'Quantity', value: '2 roll' },
    { label: 'Unit Price', value: '25.00' },
  ]);
  assert.deepEqual(getQuotationItemRemovalSummary({ itemType: 'custom', itemName: '  ', sku: '', remarks: '' }), []);

  const first = { itemId: 'item-a', __rowId: 'row-a', itemName: 'Keep this', quantity: '3', sellingPrice: '10', photos: [{ name: 'keep.png' }] };
  const target = { __rowId: 'row-b', itemName: 'Remove this', quantity: '2', sellingPrice: '5' };
  const remaining = removeQuotationFormItemById([first, target], 'row-b', () => ({ __rowId: 'fallback' }));
  assert.deepEqual(remaining, [first], 'only the requested stable row is removed and remaining data is preserved');
  assert.equal(remaining[0], first);
  assert.deepEqual(remaining[0].photos, [{ name: 'keep.png' }], 'the remaining row retains its uploaded photos');
  const identifiedTarget = { ...target, itemId: 'item-b' };
  assert.deepEqual(removeQuotationFormItemById([first, identifiedTarget], 'item-b', () => ({ itemId: 'fallback' })), [first], 'the stable item ID removes the exact row even when the legacy row ID differs');
  const summary = remaining.reduce((result, row) => ({ count: result.count + 1, quantity: result.quantity + Number(row.quantity), total: result.total + Number(row.quantity) * Number(row.sellingPrice) }), { count: 0, quantity: 0, total: 0 });
  assert.deepEqual(summary, { count: 1, quantity: 3, total: 30 });
  assert.deepEqual(removeQuotationFormItemById([target], 'row-b', () => ({ __rowId: 'fallback' })), [{ __rowId: 'fallback' }], 'the existing minimum-item fallback remains');
});

test('Selling Unit is required for custom and inventory items in the direct Special Order editor', () => {
  assert.match(page, /Selling Unit <span className="text-rose-700">\*<\/span>/);
  assert.match(page, /inputProps\('sellingUnit'\)[\s\S]*?required/);
  assert.match(page, /item\.itemType === 'custom' \? 'e\.g\. box or roll' : 'Saved unit'/);
  assert.match(page, /readOnly=\{item\.itemType === 'inventory'\}/);
  assert.match(page, /Expiry Date \(Optional\)/);
  assert.match(page, /listProductExpiryBatchesApi\(productKey, 1\)/);
  assert.match(page, /quotationExpirySelections/);
  assert.match(page, /This does not reserve or allocate stock/);
});

test('processing and table totals use current accepted quotation data without changing original requests', async () => {
  const { quotationOrderView } = await load();
  const quote = { ...quotation(), status: 'Accepted' };
  const order = { status: 'In Progress', currentQuotation: quote._id, customerName: 'Outdated Customer', items: [{ itemName: 'Outdated Item', sellingPrice: 999 }] };
  const view = quotationOrderView(order, quote);
  assert.equal(view.customerName, 'Agreed Customer');
  assert.equal(view.items[0].sellingPrice, 0.1);
  assert.equal(view.items[0].lineAmount, 0.3);
  assert.equal(order.items[0].sellingPrice, 999);
  assert.equal(quotationOrderView(order, { ...quote, _id: 'obsolete' }), order);
  assert.equal(quotationOrderView(order, { ...quote, status: 'Draft' }), order);
});

test('table action builder keeps quotation decisions guarded and draft editing inside details', () => {
  const rowActions = page.match(/const buildRowActions = \(order\) => \{([\s\S]*?)\n  \};/);
  assert.ok(rowActions);
  assert.match(rowActions[1], /View Details/);
  assert.match(rowActions[1], /label: 'View Details', icon: 'eye'/);
  assert.match(rowActions[1], /capabilities\.complete && Number\(order\.workflowVersion\) < 2/);
  assert.match(rowActions[1], /canViewSpecialOrderTransaction\(order, capabilities\.allowed\)/);
  assert.match(rowActions[1], /View Transaction/);
  assert.match(page, /strokeWidth="1\.75"[^>]*className="h-3\.5 w-3\.5 shrink-0"/);
  assert.doesNotMatch(rowActions[1], /Edit Draft|Revise Quotation/);
  assert.match(rowActions[1], /capabilities\.decide/);
  assert.match(page, /if \(action === 'decide'\) setDecisionOpen\(true\)/);
  assert.match(page, /action === 'decide' && !quotationCapabilities/);
  assert.match(page, /quotationActions\.edit && <button[^\n]*>Edit Draft<\/button>/);
  assert.match(page, /quotationActions\.revise && <button[^\n]*>Edit Quotation<\/button>/);
  assert.match(page, /if \(quotationActions\.decide\) return \{ title: 'Customer decision needed'/);
  assert.match(page, /summary\.itemCount} item{summary\.itemCount === 1 \? '' : 's'}/);
  assert.doesNotMatch(page, /summary\.itemNames\.slice/);
});

test('Special Order rows show View Details and portal only the available secondary actions', () => {
  const rowActions = page.match(/const buildRowActions = \(order\) => \{([\s\S]*?)\n  \};/)?.[1];
  const rowControls = page.match(/const renderOrderRowActions = \(order, rowActions, \{ mobile = false \} = \{\}\) => \{([\s\S]*?)\n  \};/)?.[1];
  const menuStart = page.indexOf('const SpecialOrderActionMenu =');
  const menuEnd = page.indexOf('\n};', menuStart);
  const menu = menuStart >= 0 && menuEnd > menuStart ? page.slice(menuStart, menuEnd) : '';
  assert.ok(rowActions, 'existing status and permission-aware action builder remains in use');
  assert.ok(rowControls, 'desktop rows and mobile cards share the same action controls');
  assert.ok(menu, 'the compact action menu is implemented');
  assert.match(rowActions, /label: 'View Details', icon: 'eye'/);
  assert.match(rowActions, /capabilities\.decide/);
  assert.match(rowActions, /canViewSpecialOrderTransaction\(order, capabilities\.allowed\)/);
  assert.match(rowActions, /paymentPlan === 'credit'\s*\? 'Open Credit Transaction'\s*: nextAction\.label/);
  assert.match(rowControls, /detailsAction = rowActions\.find\(\(action\) => action\.label === 'View Details'\)/);
  assert.match(rowControls, /secondaryActions = rowActions\.filter\(\(action\) => action\.label !== 'View Details'\)/);
  assert.match(rowControls, /secondaryActions\.length > 0/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /event\.key === 'Escape'/);
  assert.match(menu, /event\.key === 'ArrowDown'/);
  assert.match(menu, /document\.addEventListener\('pointerdown'/);
  assert.match(menu, /createPortal\(menu, document\.body\)/);
  assert.doesNotMatch(page, /rowActions\.length > 1 && <details/, 'the old clipped disclosure is removed');
});

test('detail requests keep loading feedback in the active row, not the page toolbar', () => {
  assert.match(page, /setDetailLoading\(\{ orderId: String\(order\._id\), orderNumber: order\.orderNumber, action: action \|\| 'details' \}\)/);
  assert.match(page, /const loadingAction = detailLoading\?\.orderId === String\(order\._id\)/);
  assert.match(page, /data-loading=\{loadingAction !== null\}/);
  assert.match(page, /<span role="status" className="sr-only">\{detailLoading \?/);
  assert.doesNotMatch(page, /Loading \{detailLoadingOrder\}|detailLoadingOrder/);
});

test('revised and accepted quotation item counts do not use original quantities or legacy placeholders', async () => {
  const { quotationOrderView } = await load();
  const original = { _id: 'order-a', status: 'Pending', currentQuotation: 'quote-b', items: [{ itemName: 'Original', quantity: 110 }] };
  const revised = { ...quotation(), _id: 'quote-b', status: 'Awaiting Decision', items: [{ itemName: 'Paints', quantity: 100 }, { itemName: 'Paint Brush', quantity: 10 }] };
  assert.equal(quotationOrderView({ ...original, quotation: revised }).items.length, 2);
  assert.equal(quotationOrderView({ ...original, status: 'In Progress', transactionQuotation: 'quote-b', quotation: { ...revised, status: 'Accepted' } }).items.length, 2);
  assert.equal(quotationOrderView({ ...original, status: 'Completed', quotation: { ...revised, status: 'Accepted' } }).items.length, 2);
  assert.equal(quotationOrderView({ ...original, status: 'Completed', quotation: null }).items.length, 1);
});
