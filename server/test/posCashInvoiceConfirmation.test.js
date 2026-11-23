/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const confirmationSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/OrderConfirmationModal.jsx'), 'utf8');
const posSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');

const invoiceSection = confirmationSource.slice(
  confirmationSource.indexOf('const PosOrderConfirmation ='),
  confirmationSource.indexOf('const CreditOrderConfirmation ='),
);
const creditInvoiceSection = confirmationSource.slice(
  confirmationSource.indexOf('const CreditOrderConfirmation ='),
  confirmationSource.indexOf('const OrderConfirmationModal ='),
);

test('POS confirmation uses the provided company settings and remains a non-official reference', () => {
  assert.match(invoiceSection, /settings\?\.storeName/);
  assert.match(invoiceSection, /settings\?\.storeAddress/);
  assert.match(invoiceSection, /settings\?\.contactPhone/);
  assert.match(invoiceSection, /For reference only — Not an official invoice/);
  assert.doesNotMatch(invoiceSection, /VAT REG|BIR|No\.\s*018413|accreditation/i);
  assert.match(posSource, /customer=\{checkoutDraft\.isCreditCheckout \? selectedCreditCustomer : null\}/);
  assert.match(posSource, /settings=\{settings\}/);
});

test('POS confirmation preserves the paper invoice customer-field and five-column order', () => {
  assert.match(invoiceSection, /<h2 className="text-base font-bold uppercase tracking-wide underline decoration-1 underline-offset-2 sm:text-lg">Cash Sales Invoice<\/h2>/);
  assert.match(invoiceSection, /id="order-confirmation-title"[^>]*>Order Confirmation<\/h2>/);
  assert.match(creditInvoiceSection, /Charge Sales Invoice/);
  for (const label of ['Sold To:', 'Address:', 'Business Style:', 'TIN:', 'OSCA/PWD ID No.:', "Cardholder&apos;s Signature:"]) {
    assert.ok(invoiceSection.includes(label), `expected invoice field ${label}`);
  }
  const columnLabels = ['QTY.', 'UNIT', 'DESCRIPTION', 'U/P', 'AMOUNT'];
  const positions = columnLabels.map((label) => invoiceSection.indexOf(`>${label}</th>`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(invoiceSection, /min-w-\[620px\].*table-fixed/s);
});

test('POS confirmation shows only supported tax values and preserves cash/credit payment details', () => {
  assert.match(invoiceSection, /vatNotCalculated \? 'Not calculated' : invoiceMoney\(vatAmount\)/);
  assert.match(invoiceSection, /vatMode === 'zero-rated' \? invoiceMoney\(total\) : '—'/);
  assert.match(invoiceSection, /label="AMOUNT DUE" value=\{invoiceMoney\(vatMode === 'vatable' \? netAmount : total\)\}/);
  assert.match(invoiceSection, /Cash Received/);
  assert.match(invoiceSection, /label="Change" value=\{invoiceMoney\(transaction\?\.change\)\}/);
  assert.match(invoiceSection, /Down Payment/);
  assert.match(invoiceSection, /Remaining Balance/);
  assert.match(invoiceSection, /Credit Terms/);
  assert.match(invoiceSection, /Payment Status/);
  assert.match(invoiceSection, /Transaction ID:/);
  assert.match(invoiceSection, /Cashier:/);
  assert.match(invoiceSection, /Payment Method:/);
  assert.match(invoiceSection, /pending \? 'Pending final save' : transaction\?\.id/);
  assert.match(confirmationSource, /if \(!isSpecialOrder\)[\s\S]*?return <PosOrderConfirmation/);
});

test('Credit orders use a separate Charge Sales Invoice-inspired view while Cash and Special Order routing remain intact', () => {
  assert.match(confirmationSource, /if \(!isSpecialOrder && isCredit\)[\s\S]*?return <CreditOrderConfirmation/);
  assert.match(confirmationSource, /if \(!isSpecialOrder\)[\s\S]*?return <PosOrderConfirmation/);
  assert.match(confirmationSource, /const isSpecialOrder = Boolean\(transaction\?\.specialOrderNumber \|\| order\?\.orderNumber\)/);
  assert.match(creditInvoiceSection, /Charge Sales Invoice/);
  assert.match(creditInvoiceSection, /For reference only .*Not an official invoice/);
  for (const label of ['Sold To:', 'Address:', 'Business Style:', 'TIN:', 'P.O. No.:', 'Terms:', 'OSCA/PWD ID No.:', 'Due Date:']) {
    assert.ok(creditInvoiceSection.includes(label), `expected credit invoice field ${label}`);
  }
  for (const label of ['QTY.', 'UNIT', 'DESCRIPTION', 'UNIT PRICE', 'AMOUNT', 'Total Invoice Amount', 'Down Payment', 'Total Paid', 'Remaining Balance']) {
    assert.ok(creditInvoiceSection.includes(label), `expected credit confirmation content ${label}`);
  }
  assert.match(creditInvoiceSection, /System Reference .*Not an Invoice Number/);
  assert.doesNotMatch(creditInvoiceSection, /onPrint|Print Confirmation|Official Invoice/);
});

test('Credit invoice details align with the paper form and keep only real item rows populated', () => {
  assert.match(creditInvoiceSection, /Sold To:[\s\S]*?Date:[\s\S]*?Address:[\s\S]*?P\.O\. No\.:/);
  assert.match(creditInvoiceSection, /Business Style:[\s\S]*?TIN:[\s\S]*?OSCA\/PWD ID No\.:/);
  const creditColumns = ['QTY.', 'UNIT', 'DESCRIPTION', 'UNIT PRICE', 'AMOUNT'];
  const columnPositions = creditColumns.map((label) => creditInvoiceSection.indexOf(`>${label}</th>`));
  assert.ok(columnPositions.every((position) => position >= 0));
  assert.deepEqual([...columnPositions].sort((left, right) => left - right), columnPositions);
  assert.match(creditInvoiceSection, /6 - items\.length/);
  assert.match(creditInvoiceSection, /aria-hidden="true" className="h-7 border-b/);
  assert.match(creditInvoiceSection, /AMOUNT DUE" value=\{amountDueValue\}/);
  assert.match(creditInvoiceSection, /TOTAL AMOUNT DUE" value=\{invoiceMoney\(transaction\?\.total\)\}/);
});
