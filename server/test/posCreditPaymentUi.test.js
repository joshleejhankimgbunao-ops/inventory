/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pointOfSaleSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'),
  'utf8',
);
const saleControllerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/controllers/saleController.js'),
  'utf8',
);

const getSection = (startMarker, endMarker) => {
  const start = pointOfSaleSource.indexOf(startMarker);
  const end = pointOfSaleSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return pointOfSaleSource.slice(start, end);
};

test('Current Order sidebar has no duplicate payment controls and keeps its actions', () => {
  const checkoutPanel = getSection('className="pos-checkout-panel', 'Review Order');
  const paymentModal = getSection("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen", '{/* Legacy post-sale preview kept inactive');

  assert.doesNotMatch(checkoutPanel, /Show Details|Hide Details|isOrderSummaryDetailsCollapsed|pos-summary-collapse/);
  assert.doesNotMatch(checkoutPanel, /pos-checkout-form|pos-totals|Cash Received|Cash\/Credit|VAT Mode|Down Payment Method/);
  assert.match(checkoutPanel, /onClick=\{\(\) => runCartAction\(handleGenerateQuotation\)\}/);
  assert.match(checkoutPanel, /onClick=\{\(\) => runCartAction\(openOrderList\)\}/);
  assert.match(pointOfSaleSource, /onClick=\{\(\) => runCartAction\(openOrderList\)\}[\s\S]*?Review Order/);
  assert.match(paymentModal, /Payment Method/);
  assert.match(paymentModal, /Cash Tendered/);
  assert.match(paymentModal, /Down Payment Method/);
  assert.match(paymentModal, /VAT Mode/);
});

test('Credit Payment restores the eligible-customer searchable combobox', () => {
  const paymentModal = getSection("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /id="credit-customer-search"/);
  assert.match(paymentModal, /role="combobox"/);
  assert.match(paymentModal, /filteredCreditCustomers\.map/);
  assert.match(paymentModal, /onKeyDown=\{handleCreditCustomerKeyDown\}/);
  assert.match(paymentModal, /No matching customers found\./);
  assert.doesNotMatch(paymentModal, /Regular Customer<select/);
  assert.match(pointOfSaleSource, /activeRegularCustomers\.filter\(isEligibleCreditCustomer\)/);
});

test('Credit Payment exposes the existing guarded quick-add customer workflow without stacking modals', () => {
  const paymentModal = getSection("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen", '{/* Legacy post-sale preview kept inactive');
  const quickAddHandler = getSection('const handleQuickAddCreditCustomer = async', 'const handleCreditTermInputChange');

  assert.match(paymentModal, /canQuickAddCreditCustomer/);
  assert.match(paymentModal, /onClick=\{openQuickAddCreditCustomer\}/);
  assert.match(paymentModal, /<div className="flex items-start gap-2">[\s\S]*?id="credit-customer-search"[\s\S]*?<ViewportTooltip content="Add Regular Customer"[\s\S]*?aria-label="Add Regular Customer"/);
  assert.doesNotMatch(paymentModal, /<button[\s\S]{0,300}>\s*<svg[\s\S]*?Add Regular Customer/);
  assert.match(pointOfSaleSource, /&& !isQuickAddCreditCustomerOpen && \(/);
  assert.match(quickAddHandler, /createPartnerApi/);
  assert.match(quickAddHandler, /listPartnersApi/);
  assert.match(quickAddHandler, /selectCreditCustomer\(eligibleCreatedCustomer\)/);
  assert.match(quickAddHandler, /quickAddCreditCustomerInFlightRef/);
});

test('Credit Term supports direct editing and bounded one-day step controls', () => {
  const paymentModal = getSection("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /aria-label="Decrease credit term by one day"/);
  assert.match(paymentModal, /aria-label="Increase credit term by one day"/);
  assert.match(paymentModal, /onChange=\{\(event\) => handleCreditTermInputChange\(event\.target\.value\)\}/);
  assert.match(paymentModal, /onClick=\{incrementCreditTerm\}[\s\S]*?bg-slate-900[\s\S]*?text-white/);
  assert.match(paymentModal, /text-center/);
  assert.match(paymentModal, /className="mt-1\.5 grid w-full grid-cols-\[2\.5rem_minmax\(0,1fr\)_2\.5rem\] gap-2"/);
  assert.doesNotMatch(paymentModal, /credit-term-days[\s\S]{0,400}sm:max-w-xs/);
  assert.equal((paymentModal.match(/className="flex h-10 w-full items-center justify-center rounded-lg border/g) || []).length, 2);
  assert.match(pointOfSaleSource, /Math\.min\(MAX_CREDIT_TERM_DAYS, Number\(previousValue\) \+ 1\)/);
  assert.match(pointOfSaleSource, /Math\.max\(MIN_CREDIT_TERM_DAYS, Number\(previousValue\) - 1\)/);
});

test('invalid Credit Terms stay editable but block submission and suppress a misleading due date', () => {
  assert.match(pointOfSaleSource, /setSelectedCreditTermDays\(sanitizeWholeNumberInput\(value\)\)/);
  assert.match(pointOfSaleSource, /parsedCreditTermDays === null/);
  assert.match(pointOfSaleSource, /creditDueDateLabel = computedCreditDueDate[\s\S]*?: '\u2014'/);
  assert.match(pointOfSaleSource, /Enter a whole-number credit term from \$\{MIN_CREDIT_TERM_DAYS\} to \$\{MAX_CREDIT_TERM_DAYS\} days\./);
  assert.match(pointOfSaleSource, /\|\| parsedCreditTermDays === null/);
});

test('Invoice and Due Date preview follows the backend calendar-day formula', () => {
  const paymentModal = getSection("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /Invoice Date/);
  assert.match(paymentModal, /Due Date/);
  assert.match(pointOfSaleSource, /base\.setHours\(0, 0, 0, 0\)/);
  assert.match(pointOfSaleSource, /base\.setDate\(base\.getDate\(\) \+ parsedCreditTermDays\)/);
  assert.match(saleControllerSource, /dueDate\.setHours\(0, 0, 0, 0\)/);
  assert.match(saleControllerSource, /dueDate\.setDate\(dueDate\.getDate\(\) \+ Number\(termDays \|\| 0\)\)/);
  assert.match(pointOfSaleSource, /termDays: isCreditCheckout \? parsedCreditTermDays : null/);
});

test('Credit checkout requires a down payment and shows the resulting balance before confirmation', () => {
  const paymentModal = getSection("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /Down Payment \(₱\)/);
  assert.match(paymentModal, /Down Payment Method/);
  assert.match(paymentModal, /Remaining Balance/);
  assert.match(pointOfSaleSource, /downPaymentCentavos < 1/);
  assert.match(pointOfSaleSource, /downPaymentCentavos >= totalCentavos/);
  assert.match(pointOfSaleSource, /downPaymentAmount: normalizedDownPaymentAmount/);
  assert.match(saleControllerSource, /Down payment must be less than the final transaction total\./);
});
