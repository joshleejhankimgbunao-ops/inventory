import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const sectionBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Expected section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Expected section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('quotation preview keeps the accessible X and primary document actions without a duplicate footer Close', async () => {
  const formalQuotation = await readSource('../../src/components/FormalPriceQuotationModal.jsx');
  const quotationFooter = sectionBetween(formalQuotation, '<footer className="flex flex-wrap justify-end', '</footer>');
  assert.match(formalQuotation, /aria-label="Close price quotation preview"/);
  assert.doesNotMatch(quotationFooter, /onClick=\{onClose\}|>Close</);
  assert.match(quotationFooter, /handlePrint/);
  assert.match(quotationFooter, /handleDownload/);

  const specialOrders = await readSource('../../src/pages/SpecialOrders.jsx');
  const quotationPreview = specialOrders.slice(specialOrders.indexOf('{quotationPreview &&'), specialOrders.indexOf('{completedTransactionPreview &&'));
  assert.match(quotationPreview, /FormalPriceQuotationModal/);
  assert.match(quotationPreview, /allowPrint=\{false\}/);
});

test('read-only preview overlays retain their X and meaningful actions without duplicate footer dismissal', async () => {
  const receiptPreview = await readSource('../../src/components/ReceiptPreviewModal.jsx');
  assert.match(receiptPreview, /aria-label=\{`Close \$\{documentTitle\} preview`\}/);
  assert.doesNotMatch(receiptPreview, />\s*Close\s*<\/button>/);
  assert.match(receiptPreview, /onClick=\{onPrint\}/);

  const specialOrderTransaction = await readSource('../../src/components/SpecialOrderTransactionDetailsModal.jsx');
  assert.match(specialOrderTransaction, /aria-label="Close transaction details"/);
  assert.doesNotMatch(specialOrderTransaction, /<footer[\s\S]*?>\s*<button[^>]*>Close<\/button>[\s\S]*?<\/footer>/);

  const dashboard = await readSource('../../src/pages/Dashboard.jsx');
  const activityLog = sectionBetween(dashboard, '{/* Activity Log Modal */}', '{/* Top Header');
  assert.match(activityLog, /aria-label="Close activity log"/);
  assert.doesNotMatch(activityLog, /app-primary-action[\s\S]*?>\s*Close\s*<\/button>/);

  const partners = await readSource('../../src/pages/Partners.jsx');
  const recommendations = sectionBetween(partners, 'Restock Recommendations', '{/* Archive Confirmation Modal */}');
  assert.match(recommendations, /aria-label="Close restock recommendations"/);
  assert.doesNotMatch(recommendations, />\s*Close\s*<\/button>/);
});

test('navigation and guarded form dismissal remain available', async () => {
  const pointOfSale = await readSource('../../src/pages/PointOfSale.jsx');
  const quotationSelector = sectionBetween(pointOfSale, '{/* Regular Customer Quotation Selector */}', '{/* Regular Customer Quotation Details */}');
  assert.match(quotationSelector, /aria-label="Close regular customer selector"/);
  assert.match(quotationSelector, />Back<\/button>/);
  assert.doesNotMatch(quotationSelector, />Cancel<\/button>/);

  const quotationDetails = sectionBetween(pointOfSale, '{/* Regular Customer Quotation Details */}', '{/* Quotation Preview Modal */}');
  assert.match(quotationDetails, /onClick=\{returnToQuotationCustomerSelector\}/);
  assert.match(quotationDetails, />\s*Back to Customers\s*<\/button>/);
  assert.match(quotationDetails, />\s*Preview Quotation\s*<\/button>/);

  const specialOrders = await readSource('../../src/pages/SpecialOrders.jsx');
  const createQuotation = sectionBetween(specialOrders, '{showForm && !quickAddCustomerOpen && (', '{showForm && itemRemovalTargetId && (');
  assert.match(createQuotation, /aria-label="Close special order form"/);
  assert.match(createQuotation, /Generate Quotation/);
  assert.doesNotMatch(createQuotation, />Cancel<\/button>/);
  assert.match(specialOrders, /Discard quotation changes\?/);

  assert.match(specialOrders, /itemRemovalCancelRef[\s\S]*?>Cancel<\/button>/);
  assert.match(specialOrders, /completionConfirmCancelRef[\s\S]*?>Cancel<\/button>/);
});
