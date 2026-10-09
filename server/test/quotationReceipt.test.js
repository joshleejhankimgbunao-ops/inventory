const test = require('node:test');
const assert = require('node:assert/strict');

const loadQuotationReceipt = () => import('../../src/utils/quotationReceipt.js');

test('quotation preview data and print lines share one normalized quotation model', async () => {
  const { buildQuotationPrintLines, buildQuotationReceiptModel } = await loadQuotationReceipt();
  const receipt = buildQuotationReceiptModel({
    customerName: 'Long Customer Name',
    date: '9/5/2026, 10:30:00 AM',
    total: 2450,
    items: [{
      name: 'Long Product Name That Wraps On Thermal Paper',
      code: 'SKU-001',
      qty: 12,
      price: 204.1666667,
    }],
  }, {
    storeName: 'Tableria La Confianza',
    storeAddress: 'Calamba, Laguna',
    contactPhone: '(049) 545-2166',
  });

  assert.deepEqual(buildQuotationPrintLines(receipt).slice(0, 8), [
    'Tableria La Confianza',
    'Calamba, Laguna',
    'Contact: (049) 545-2166',
    '--------------------------------',
    'QUOTATION',
    'Customer: Long Customer Name',
    'Date: 9/5/2026, 10:30:00 AM',
    '--------------------------------',
  ]);
  assert.equal(receipt.items[0].name, 'Long Product Name That Wraps On Thermal Paper');
  assert.equal(receipt.items[0].code, 'SKU-001');
  assert.equal(receipt.items[0].quantity, 12);
  assert.equal(receipt.items[0].amount.toFixed(2), '2450.00');
  assert.deepEqual(buildQuotationPrintLines(receipt).slice(8, 10), ['ITEM', 'QTY  UNIT PRICE  AMOUNT']);
  assert.ok(!buildQuotationPrintLines(receipt).some((line) => line.includes('Code: SKU-001')));
  assert.ok(buildQuotationPrintLines(receipt).includes('TOTAL: ₱2,450.00'));
  assert.equal(buildQuotationPrintLines(receipt).at(-1), 'This quotation is for estimation purposes only. Prices are subject to change without prior notice.');
});

test('quotation model omits unavailable optional store lines without changing receipt order', async () => {
  const { buildQuotationPrintLines, buildQuotationReceiptModel } = await loadQuotationReceipt();
  const receipt = buildQuotationReceiptModel({
    customerName: 'Customer',
    date: 'Date',
    total: 100,
    items: [{ name: 'Item', qty: 1, price: 100 }],
  }, { storeName: 'Store' });

  const printLines = buildQuotationPrintLines(receipt);
  assert.deepEqual(printLines.slice(0, 6), [
    'Store',
    '--------------------------------',
    'QUOTATION',
    'Customer: Customer',
    'Date: Date',
    '--------------------------------',
  ]);
  assert.ok(!printLines.some((line) => line.startsWith('Contact:')));
});

test('quotation model keeps multiple items, two-digit quantities, and high amounts in print order', async () => {
  const { buildQuotationPrintLines, buildQuotationReceiptModel } = await loadQuotationReceipt();
  const receipt = buildQuotationReceiptModel({
    customerName: 'Customer',
    date: 'Date',
    total: 123456.78,
    items: [
      { name: 'First Item', code: 'FIRST-01', qty: 12, price: 9999.99 },
      { name: 'Second Item', code: 'SECOND-02', qty: 1, price: 3456.9 },
    ],
  }, { storeName: 'Store' });

  assert.deepEqual(receipt.items.map(({ name, code, quantity, unitPrice, amount }) => ({ name, code, quantity, unitPrice, amount })), [
    { name: 'First Item', code: 'FIRST-01', quantity: 12, unitPrice: 9999.99, amount: 119999.88 },
    { name: 'Second Item', code: 'SECOND-02', quantity: 1, unitPrice: 3456.9, amount: 3456.9 },
  ]);
  const printLines = buildQuotationPrintLines(receipt);
  assert.deepEqual(printLines.slice(6, 12), [
    'ITEM',
    'QTY  UNIT PRICE  AMOUNT',
    'First Item',
    ' 12   ₱9,999.99  ₱119,999.88',
    'Second Item',
    '  1   ₱3,456.90   ₱3,456.90',
  ]);
  assert.ok(buildQuotationPrintLines(receipt).includes('TOTAL: ₱123,456.78'));
});
