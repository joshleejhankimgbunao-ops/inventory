/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/specialOrderController.js'), 'utf8');
const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/specialOrderRoutes.js'), 'utf8');
const specialOrdersUi = fs.readFileSync(path.resolve(__dirname, '../../src/pages/SpecialOrders.jsx'), 'utf8');
const posUi = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');

test('Special Order quotations have explicit lifecycle endpoints protected by authenticated roles', () => {
  for (const pathPart of [
    "/:id/quotations', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listSpecialOrderQuotations",
    "/:id/quotations', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), prepareSpecialOrderQuotation",
    '/:id/quotations/:quotationId/issue',
    '/:id/quotations/:quotationId/decision',
    '/:id/quotations/:quotationId/revise',
  ]) assert.match(routes, new RegExp(pathPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(routes, /router\.patch\('\/:id\/complete'/);
  assert.doesNotMatch(routes, /start-transaction/);
});

test('final Special Order save requires the exact current accepted quotation and uses its snapshot', () => {
  assert.match(controller, /const acceptedQuotation = await getCurrentQuotation\(orderForValidation\)/);
  assert.match(controller, /acceptedQuotation\.status !== 'Accepted'/);
  assert.match(controller, /String\(acceptedQuotation\._id\) !== quotationId/);
  assert.match(controller, /const quotation = await getCurrentQuotation\(order, session\)/);
  assert.match(controller, /buildSalePayload\(order, req, \{ referenceNumber, supportingDocument: uploadedDocument, quotation \}\)/);
  assert.match(controller, /specialOrderQuotationId: quotation\._id/);
  assert.match(controller, /specialOrderQuotationVersion: quotation\.version/);
});

test('quotation revisions supersede the prior version and do not transfer acceptance', () => {
  assert.match(controller, /\$set: \{ isCurrent: false, status: 'Superseded' \}/);
  assert.match(controller, /status: 'Draft', isCurrent: true/);
  assert.match(controller, /revisionOf: quotation\._id/);
});

test('POS Create Quotation opens the Walk-in quotation directly without a type chooser', () => {
  const walkInStart = posUi.indexOf('const openWalkInQuotation = () => {');
  const printStart = posUi.indexOf('const handlePrintQuotationDoc = () => {', walkInStart);
  const entryFlow = posUi.slice(walkInStart, printStart);
  assert.match(entryFlow, /quotationType: 'walk_in'/);
  assert.match(entryFlow, /items: \[\.\.\.cart\]/);
  assert.match(entryFlow, /setQuotationData\(quoteData\)/);
  assert.match(entryFlow, /setShowQuotationPreview\(true\)/);
  assert.match(entryFlow, /const handleGenerateQuotation = \(\) => \{\s*openWalkInQuotation\(\);\s*\}/);
  assert.doesNotMatch(posUi, /showQuotationTypeChooser|Choose customer type|Quotation Type Chooser/);
});

test('Special Orders use quotation-first actions with final decisions and no separate Start Transaction', () => {
  for (const label of ['Create Quotation', 'Prepare Quotation', 'Generate Quotation', 'Record Accepted', 'Record Declined', 'Edit Quotation', 'Complete Order', 'Download PDF', 'View Transaction']) {
    assert.match(specialOrdersUi, new RegExp(label));
  }
  assert.match(specialOrdersUi, /allowPrint=\{false\}/);
  assert.match(specialOrdersUi, /quotationId: postSaleFlow\.quotation\?\._id/);
  assert.doesNotMatch(specialOrdersUi, /Start Transaction|New Special Order|Edit Special Order/);
});
