const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pointOfSaleSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'),
  'utf8',
);

const getGenerateQuotationHandler = () => {
  const start = pointOfSaleSource.indexOf('const handleGenerateQuotation = () => {');
  const end = pointOfSaleSource.indexOf('const handlePrintQuotationDoc = () => {', start);

  assert.notEqual(start, -1, 'quotation generator should exist');
  assert.notEqual(end, -1, 'quotation print handler should follow quotation generation');
  return pointOfSaleSource.slice(start, end);
};

test('POS quotation action opens the preview directly without customer metadata', () => {
  const handler = getGenerateQuotationHandler();

  assert.match(pointOfSaleSource, /onClick=\{handleGenerateQuotation\}[\s\S]*?>\s*Quotation\s*<\/button>/);
  assert.match(handler, /items:\s*\[\.\.\.cart\]/);
  assert.match(handler, /total:\s*calculateTotal\(\)/);
  assert.match(handler, /setQuotationData\(quoteData\)/);
  assert.match(handler, /setShowQuotationPreview\(true\)/);
  assert.doesNotMatch(handler, /customerName|date\s*:|setCart|handleCheckout|updateInventory/);
});

test('obsolete Create Quotation customer modal and validation are removed', () => {
  assert.doesNotMatch(pointOfSaleSource, /showQuotationInput|quotationCustomerName|QUOTATION_NAME_MAX_LENGTH/);
  assert.doesNotMatch(pointOfSaleSource, /Create Quotation|Please enter customer name|Enter customer name\.\.\./);
});

test('quotation preview omits Customer and Date fields', () => {
  const previewStart = pointOfSaleSource.indexOf('{/* Quotation Preview Modal */}');
  assert.notEqual(previewStart, -1);
  const previewSource = pointOfSaleSource.slice(previewStart);

  assert.doesNotMatch(previewSource, /quotationReceipt\.customerName|quotationReceipt\.date/);
  assert.doesNotMatch(previewSource, />Customer:<|>Date:</);
});
