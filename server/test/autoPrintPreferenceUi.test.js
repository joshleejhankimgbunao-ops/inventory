/* global require, __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readSource = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

test('Notifications exposes the persisted Auto-Print Order List preference without changing desktop notifications', () => {
  const settings = readSource('src/pages/Settings.jsx');
  const profile = readSource('src/pages/Profile.jsx');

  assert.match(settings, /Auto-Print Order List/);
  assert.match(settings, /Automatically print the Order List when an order is generated\./);
  assert.match(settings, /userPreferences\.autoPrintReceipts/);
  assert.match(settings, /updateUserPreferences\(\{ autoPrintReceipts:/);
  assert.match(settings, /aria-pressed=\{Boolean\(userPreferences\.autoPrintReceipts\)\}/);
  assert.doesNotMatch(settings, /Auto-Print Receipts|Automatically print receipt after transaction/);
  assert.match(settings, /Desktop Push Notifications \(Browser\)/);
  assert.match(settings, /Notification\.requestPermission/);
  assert.doesNotMatch(profile, /Automatic Printing|Automatically print the Order Confirmation|autoPrintReceipts/);
});

test('Auto-Print runs once from explicit Order List generation and uses the draft printer output', () => {
  const pointOfSale = readSource('src/pages/PointOfSale.jsx');
  const openStart = pointOfSale.indexOf('const openOrderList =');
  const openEnd = pointOfSale.indexOf('\n    const openWalkInQuotation', openStart);
  const printStart = pointOfSale.indexOf('const handlePrintOrderList = async');
  const printEnd = pointOfSale.indexOf('\n    const ', printStart + 1);
  const completionStart = pointOfSale.indexOf('const completeFinalizedCheckout =');
  const completionEnd = pointOfSale.indexOf('\n    const [printStatus, setPrintStatus]', completionStart);

  assert.notEqual(openStart, -1);
  assert.notEqual(openEnd, -1);
  assert.notEqual(printStart, -1);
  assert.notEqual(printEnd, -1);
  assert.notEqual(completionStart, -1);
  assert.notEqual(completionEnd, -1);

  const openHandler = pointOfSale.slice(openStart, openEnd);
  const printHandler = pointOfSale.slice(printStart, printEnd);
  const completionHandler = pointOfSale.slice(completionStart, completionEnd);

  assert.match(openHandler, /orderListGenerationInFlightRef\.current/);
  assert.match(openHandler, /if \(userPreferences\.autoPrintReceipts\)/);
  assert.match(openHandler, /void handlePrintOrderList\(\{ date: openedAt \}\)/);
  assert.equal((openHandler.match(/handlePrintOrderList\(/g) || []).length, 1);
  assert.match(printHandler, /printReceipt\(/);
  assert.match(printHandler, /documentType: 'order-list-draft'/);
  assert.match(printHandler, /options\?\.date \|\| checkoutOpenedAt/);
  assert.match(pointOfSale, /onClick=\{handlePrintOrderList\}/);
  assert.doesNotMatch(completionHandler, /printReceipt\(|printDocument\(/);
});
