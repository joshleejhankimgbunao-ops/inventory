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

test('POS quotation action opens an explicit Walk-in or Regular Customer chooser', () => {
  const handler = getGenerateQuotationHandler();

  assert.match(pointOfSaleSource, /onClick=\{handleGenerateQuotation\}[\s\S]*?>\s*Quotation\s*<\/button>/);
  assert.match(handler, /setQuotationType\(null\)/);
  assert.match(handler, /setShowQuotationTypeChooser\(true\)/);
  assert.match(handler, /quotationType: 'walk_in'/);
  assert.match(handler, /items:\s*\[\.\.\.cart\]/);
  assert.match(handler, /total:\s*calculateTotal\(\)/);
  assert.match(handler, /setQuotationData\(quoteData\)/);
  assert.match(handler, /setShowQuotationPreview\(true\)/);
  assert.match(handler, /setQuotationType\('regular_customer'\)/);
  assert.match(handler, /buildFormalQuotationModel/);
  assert.doesNotMatch(handler, /quotationCustomerName|setCart|handleCheckout|updateInventory|createSaleApi/);
});

test('quotation chooser does not restore the obsolete typed customer-name flow', () => {
  assert.doesNotMatch(pointOfSaleSource, /showQuotationInput|quotationCustomerName|QUOTATION_NAME_MAX_LENGTH/);
  assert.doesNotMatch(pointOfSaleSource, /Please enter customer name|Enter customer name\.\.\./);
  assert.match(pointOfSaleSource, />Walk-in Customer</);
  assert.match(pointOfSaleSource, />Regular Customer</);
  assert.match(pointOfSaleSource, />Quick quotation</);
  assert.match(pointOfSaleSource, />Formal A4 quotation</);
});

test('walk-in quotation preview omits Customer and Date fields', () => {
  const previewStart = pointOfSaleSource.indexOf('{/* Quotation Preview Modal */}');
  assert.notEqual(previewStart, -1);
  const previewEnd = pointOfSaleSource.indexOf("{quotationType === 'regular_customer'", previewStart);
  const previewSource = pointOfSaleSource.slice(previewStart, previewEnd);

  assert.doesNotMatch(previewSource, /quotationReceipt\.customerName|quotationReceipt\.date/);
  assert.doesNotMatch(previewSource, />Customer:<|>Date:</);
});

test('regular customer quotation uses a separate A4 renderer and never the thermal print service', () => {
  const formalComponentSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/components/FormalPriceQuotationModal.jsx'),
    'utf8',
  );

  assert.match(pointOfSaleSource, /<FormalPriceQuotationModal/);
  assert.match(formalComponentSource, /window\.print\(\)/);
  assert.match(formalComponentSource, /downloadFormalQuotationPdf/);
  assert.doesNotMatch(formalComponentSource, /printDocument|printReceipt|receiptPrinter|XP-58H/);
});

test('formal quotation print CSS uses A4 and preserves the document header', () => {
  const appCss = fs.readFileSync(path.resolve(__dirname, '../../src/App.css'), 'utf8');

  assert.match(appCss, /body\.printing-formal-quotation/);
  assert.match(appCss, /@page formal-quotation\s*\{[\s\S]*?size:\s*A4 portrait/);
  assert.match(appCss, /#formal-price-quotation-paper\s*\{[\s\S]*?page:\s*formal-quotation/);
  assert.match(appCss, /#formal-price-quotation-paper header\s*\{[\s\S]*?display:\s*block !important/);
  assert.match(appCss, /\.formal-quotation-table-head\s*\{[\s\S]*?display:\s*table-header-group/);
});

test('regular customer selector searches active directory records and does not mutate POS state', () => {
  assert.match(pointOfSaleSource, /filter\(isActiveRegularCustomer\)/);
  assert.match(pointOfSaleSource, /customer\?\.name, customer\?\.email, customer\?\.contact, customer\?\.address/);
  assert.match(pointOfSaleSource, /Only active regular customer records appear here\./);
  const formalStart = pointOfSaleSource.indexOf('const openQuotationDetails = (customer) => {');
  const formalEnd = pointOfSaleSource.indexOf('const handlePrintQuotationDoc = () => {', formalStart);
  const formalHandler = pointOfSaleSource.slice(formalStart, formalEnd);
  assert.match(formalHandler, /setShowQuotationDetails\(true\)/);
  assert.match(formalHandler, /attentionName:\s*String\(customer\?\.attentionName/);
  assert.match(formalHandler, /attentionPosition:\s*String\(customer\?\.attentionPosition/);
  assert.match(formalHandler, /authorizedSignatoryName:\s*String\(settings\?\.authorizedSignatoryName/);
  assert.match(formalHandler, /quotationDetails,/);
  assert.doesNotMatch(formalHandler, /setCart|createSaleApi|setInventory|addToSyncQueue|handleCheckout/);
});

test('regular customer selection opens Quotation Details before the formal preview', () => {
  const selectStart = pointOfSaleSource.indexOf('const openQuotationDetails = (customer) => {');
  const previewStart = pointOfSaleSource.indexOf('const previewFormalQuotation = (event) => {', selectStart);
  const selectHandler = pointOfSaleSource.slice(selectStart, previewStart);
  const previewEnd = pointOfSaleSource.indexOf('const handlePrintQuotationDoc = () => {', previewStart);
  const previewHandler = pointOfSaleSource.slice(previewStart, previewEnd);

  assert.match(selectHandler, /setSelectedQuotationCustomer\(customer\)/);
  assert.match(selectHandler, /setShowQuotationCustomerSelector\(false\)/);
  assert.match(selectHandler, /setShowQuotationDetails\(true\)/);
  assert.doesNotMatch(selectHandler, /setFormalQuotationData/);
  assert.match(previewHandler, /buildFormalQuotationModel/);
  assert.match(previewHandler, /setFormalQuotationData\(quotation\)/);
  assert.match(previewHandler, /setShowQuotationDetails\(false\)/);
  assert.match(pointOfSaleSource, />Quotation Details</);
  assert.match(pointOfSaleSource, />\s*Preview Quotation\s*</);
});

test('quotation details expose only temporary attention and signatory-name inputs', () => {
  const detailsStart = pointOfSaleSource.indexOf('{/* Regular Customer Quotation Details */}');
  const detailsEnd = pointOfSaleSource.indexOf('{/* Quotation Preview Modal */}', detailsStart);
  const detailsSource = pointOfSaleSource.slice(detailsStart, detailsEnd);

  assert.match(detailsSource, /quotation-attention-name/);
  assert.match(detailsSource, /quotation-attention-position/);
  assert.match(detailsSource, /quotation-signatory-name/);
  assert.match(detailsSource, /required/);
  assert.match(detailsSource, /disabled=\{!hasQuotationSignatoryName\}/);
  assert.match(detailsSource, /Authorized Signatory Name is required to preview this quotation\./);
  assert.doesNotMatch(detailsSource, /authorizedSignatoryPosition|Signatory Position|Signatory Department/);
  assert.doesNotMatch(detailsSource, /updateSettings|updatePartner|createSaleApi|setInventory/);
});

test('formal quotation preview blocks a blank signatory and passes only the current quotation override', () => {
  const previewStart = pointOfSaleSource.indexOf('const previewFormalQuotation = (event) => {');
  const previewEnd = pointOfSaleSource.indexOf('const handlePrintQuotationDoc = () => {', previewStart);
  const previewHandler = pointOfSaleSource.slice(previewStart, previewEnd);

  assert.match(previewHandler, /normalizeHumanReadable\(quotationDetails\.authorizedSignatoryName\)/);
  assert.match(previewHandler, /Authorized Signatory Name is required\./);
  assert.match(previewHandler, /quotationDetails:\s*quotationSpecificDetails/);
  assert.doesNotMatch(previewHandler, /updateSettings|setSettings|updatePartner/);
});

test('formal preview and PDF consume one model with no signatory position', () => {
  const formalComponentSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/components/FormalPriceQuotationModal.jsx'),
    'utf8',
  );
  const formalModelSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/utils/formalQuotation.js'),
    'utf8',
  );

  assert.match(formalComponentSource, /quotation\.customer\.attentionName/);
  assert.match(formalComponentSource, /quotation\.signatory\.name/);
  assert.match(formalComponentSource, /downloadFormalQuotationPdf\(quotation\)/);
  assert.doesNotMatch(formalComponentSource, /signatory\.position|authorizedSignatoryPosition/);
  assert.doesNotMatch(formalModelSource, /settings\.authorizedSignatoryPosition|signatory\.position/);
});

test('walk-in quotation remains the only quotation path using the thermal printer', () => {
  const printStart = pointOfSaleSource.indexOf('const handlePrintQuotationDoc = () => {');
  const printEnd = pointOfSaleSource.indexOf('const completeOrderConfirmationPreview', printStart);
  const walkInPrintHandler = pointOfSaleSource.slice(printStart, printEnd);

  assert.match(walkInPrintHandler, /buildQuotationReceiptModel/);
  assert.match(walkInPrintHandler, /buildQuotationPrintLines/);
  assert.match(walkInPrintHandler, /printDocument/);
  assert.match(pointOfSaleSource, /quotationType === 'regular_customer'[\s\S]*?<FormalPriceQuotationModal/);
});
