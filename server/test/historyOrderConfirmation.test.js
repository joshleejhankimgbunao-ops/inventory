/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const history = fs.readFileSync(path.resolve(__dirname, '../../src/pages/History.jsx'), 'utf8');
const confirmation = fs.readFileSync(path.resolve(__dirname, '../../src/components/OrderConfirmationModal.jsx'), 'utf8');

test('History shows saved regular sales in the existing read-only Order Confirmation layouts', () => {
  assert.match(history, /import OrderConfirmationModal from '\.\.\/components\/OrderConfirmationModal';/);
  assert.match(history, /const isOrderConfirmation = !isAutoReceipt && isRegularSale\(selectedTransaction\);/);

  const confirmationBranch = history.slice(
    history.indexOf('{showReceipt && selectedTransaction && ('),
  );
  const readOnlyBranch = confirmationBranch.slice(
    confirmationBranch.indexOf('<OrderConfirmationModal'),
    confirmationBranch.indexOf('/>', confirmationBranch.indexOf('<OrderConfirmationModal')),
  );
  const receiptBranch = confirmationBranch.slice(confirmationBranch.indexOf('<ReceiptPreviewModal'));

  assert.match(readOnlyBranch, /transaction=\{selectedTransaction\}/);
  assert.match(readOnlyBranch, /readOnly/);
  assert.match(readOnlyBranch, /onContinue=\{\(\) =>/);
  assert.doesNotMatch(readOnlyBranch, /onPrint|Print Again|Back to Payment|Continue to Reference/);
  assert.match(receiptBranch, /onPrint=\{handlePrint\}/);
  assert.match(receiptBranch, /printLabel="Reprint"/);
});

test('saved payment type selects the existing Cash or Credit invoice, and saved invoice references are conditional', () => {
  assert.match(confirmation, /if \(!isSpecialOrder && isCredit\)[\s\S]*?return <CreditOrderConfirmation/);
  assert.match(confirmation, /if \(!isSpecialOrder\)[\s\S]*?return <PosOrderConfirmation/);
  assert.match(confirmation, /id="order-confirmation-title"[^>]*>Order Confirmation<\/h2>/);
  assert.match(confirmation, /transaction\?\.transactionReference\?\.referenceNumber && <p className="col-span-2 sm:col-span-4"/);
  assert.match(confirmation, /transaction\?\.transactionReference\?\.referenceNumber && <p className="break-all">Invoice \/ Reference No\.:/);

  const cashFooter = confirmation.slice(confirmation.indexOf('const PosOrderConfirmation ='), confirmation.indexOf('const CreditOrderConfirmation ='));
  const creditFooter = confirmation.slice(confirmation.indexOf('const CreditOrderConfirmation ='), confirmation.indexOf('const OrderConfirmationModal ='));
  for (const invoice of [cashFooter, creditFooter]) {
    assert.match(invoice, /readOnly \? \([\s\S]*?>Close<\/button>/);
    assert.match(invoice, /For reference only .*Not an official invoice/);
  }
});
