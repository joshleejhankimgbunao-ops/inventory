const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (filename) => fs.readFileSync(path.resolve(__dirname, '../..', filename), 'utf8');
const pos = source('src/pages/PointOfSale.jsx');
const specialOrders = source('src/pages/SpecialOrders.jsx');
const formal = source('src/components/FormalPriceQuotationModal.jsx');

test('POS quotation opens the existing Walk-in entry directly without sale or inventory writes', () => {
  const entry = pos.slice(pos.indexOf('const openWalkInQuotation ='), pos.indexOf('const handlePrintQuotationDoc ='));
  assert.match(entry, /const handleGenerateQuotation = \(\) => \{\s*openWalkInQuotation\(\)/);
  assert.match(pos, /onClick=\{handleGenerateQuotation\}/);
  assert.match(entry, /quotationType: 'walk_in'/);
  assert.match(entry, /items:\s*\[\.\.\.cart\]/);
  assert.match(entry, /total:\s*calculateTotal\(\)/);
  assert.match(entry, /setQuotationData\(quoteData\)/);
  assert.match(entry, /setShowQuotationPreview\(true\)/);
  assert.doesNotMatch(entry, /setCart|handleCheckout|updateInventory|createSaleApi|buildFormalQuotationModel/);
  assert.doesNotMatch(pos, /showQuotationTypeChooser|Choose customer type|quotationCustomerName/);
});

test('POS regular-customer selector and details remain unreachable; Special Orders owns formal quotations', () => {
  assert.match(pos, /const showQuotationCustomerSelector = false/);
  assert.match(pos, /const showQuotationDetails = false/);
  assert.match(pos, /const formalQuotationData = null/);
  assert.match(specialOrders, /getSpecialOrderQuotationDocumentApi/);
  assert.match(specialOrders, /<FormalPriceQuotationModal[^\n]*allowPrint=\{false\}/);
});

test('Walk-in preview continues to omit customer/date and use the thermal quotation model', () => {
  const preview = pos.slice(pos.indexOf('{/* Quotation Preview Modal */}'), pos.indexOf("{quotationType === 'regular_customer'", pos.indexOf('{/* Quotation Preview Modal */}')));
  assert.match(preview, /quotationReceipt/);
  assert.doesNotMatch(preview, /quotationReceipt\.customerName|quotationReceipt\.date|>Customer:<|>Date:</);
  const print = pos.slice(pos.indexOf('const handlePrintQuotationDoc ='), pos.indexOf('const completeOrderConfirmationPreview ='));
  assert.match(print, /buildQuotationReceiptModel/);
  assert.match(print, /buildQuotationPrintLayout/);
  assert.match(print, /printDocument/);
  assert.doesNotMatch(print, /createSaleApi|handleCheckout|updateInventory/);
});

test('shared formal A4 renderer retains download/optional print without the thermal printer', () => {
  assert.match(formal, /window\.print\(\)/);
  assert.match(formal, /downloadFormalQuotationPdf\(quotation\)/);
  assert.match(formal, /allowPrint &&/);
  assert.doesNotMatch(formal, /printDocument|printReceipt|receiptPrinter|XP-58H/);
});

test('formal print CSS remains A4 with repeated table headings', () => {
  const css = source('src/App.css');
  assert.match(css, /body\.printing-formal-quotation/);
  assert.match(css, /@page formal-quotation\s*\{[\s\S]*?size:\s*A4 portrait/);
  assert.match(css, /#formal-price-quotation-paper\s*\{[\s\S]*?page:\s*formal-quotation/);
  assert.match(css, /#formal-price-quotation-paper header\s*\{[\s\S]*?display:\s*block !important/);
  assert.match(css, /\.formal-quotation-table-head\s*\{[\s\S]*?display:\s*table-header-group/);
});

test('formal preview and PDF use saved attention/signatory but no invented signatory position', () => {
  const model = source('src/utils/formalQuotation.js');
  assert.match(formal, /quotation\.customer\.attentionName/);
  assert.match(formal, /quotation\.signatory\.name/);
  assert.doesNotMatch(formal, /signatory\.position|authorizedSignatoryPosition/);
  assert.doesNotMatch(model, /settings\.authorizedSignatoryPosition|signatory\.position/);
  assert.match(model, /document\.quotationDetails\?\.authorizedSignatoryName/);
  assert.match(model, /document\.quotationDate/);
});
