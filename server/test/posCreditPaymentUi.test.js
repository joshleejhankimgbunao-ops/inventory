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

test('Credit Payment restores the eligible-customer searchable combobox', () => {
  const paymentModal = getSection("{(checkoutPhase === 'payment'", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /id="credit-customer-search"/);
  assert.match(paymentModal, /role="combobox"/);
  assert.match(paymentModal, /filteredCreditCustomers\.map/);
  assert.match(paymentModal, /onKeyDown=\{handleCreditCustomerKeyDown\}/);
  assert.match(paymentModal, /No matching customers found\./);
  assert.doesNotMatch(paymentModal, /Regular Customer<select/);
  assert.match(pointOfSaleSource, /activeRegularCustomers\.filter\(isEligibleCreditCustomer\)/);
});

test('Credit Payment exposes the existing guarded quick-add customer workflow without stacking modals', () => {
  const paymentModal = getSection("{(checkoutPhase === 'payment'", '{/* Legacy post-sale preview kept inactive');
  const quickAddHandler = getSection('const handleQuickAddCreditCustomer = async', 'const handleCreditTermInputChange');

  assert.match(paymentModal, /canQuickAddCreditCustomer/);
  assert.match(paymentModal, /onClick=\{openQuickAddCreditCustomer\}/);
  assert.match(paymentModal, /Add Regular Customer/);
  assert.match(pointOfSaleSource, /&& !isQuickAddCreditCustomerOpen && \(/);
  assert.match(quickAddHandler, /createPartnerApi/);
  assert.match(quickAddHandler, /listPartnersApi/);
  assert.match(quickAddHandler, /selectCreditCustomer\(eligibleCreatedCustomer\)/);
  assert.match(quickAddHandler, /quickAddCreditCustomerInFlightRef/);
});

test('Credit Term supports direct editing and bounded one-day step controls', () => {
  const paymentModal = getSection("{(checkoutPhase === 'payment'", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /aria-label="Decrease credit term by one day"/);
  assert.match(paymentModal, /aria-label="Increase credit term by one day"/);
  assert.match(paymentModal, /onChange=\{\(event\) => handleCreditTermInputChange\(event\.target\.value\)\}/);
  assert.match(paymentModal, /text-center/);
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
  const paymentModal = getSection("{(checkoutPhase === 'payment'", '{/* Legacy post-sale preview kept inactive');

  assert.match(paymentModal, /Invoice Date/);
  assert.match(paymentModal, /Due Date/);
  assert.match(pointOfSaleSource, /base\.setHours\(0, 0, 0, 0\)/);
  assert.match(pointOfSaleSource, /base\.setDate\(base\.getDate\(\) \+ parsedCreditTermDays\)/);
  assert.match(saleControllerSource, /dueDate\.setHours\(0, 0, 0, 0\)/);
  assert.match(saleControllerSource, /dueDate\.setDate\(dueDate\.getDate\(\) \+ Number\(termDays \|\| 0\)\)/);
  assert.match(pointOfSaleSource, /termDays: isCreditCheckout \? parsedCreditTermDays : null/);
});
