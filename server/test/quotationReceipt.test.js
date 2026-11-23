const test = require('node:test');
const assert = require('node:assert/strict');

const loadQuotationThermalLayout = () => import('../../src/utils/quotationThermalLayout.js');
const loadNumberFormat = () => import('../../src/utils/numberFormat.js');

test('quotation receipt preserves saved item values and centers its normalized thermal header', async () => {
  const { buildQuotationPrintLayout } = await loadQuotationThermalLayout();
  const { formatCurrency } = await loadNumberFormat();
  const receipt = {
    storeName: 'Tableria La Confianza',
    storeAddress: 'Calamba, Laguna',
    contactPhone: '(049) 545-2166',
    title: 'QUOTATION',
    items: [{ name: 'Long Product Name That Wraps On Thermal Paper', code: 'SKU-001', quantity: 12, unitPrice: 204.1666667, amount: 2450 }],
    total: 2450,
    footer: 'This quotation is for estimation purposes only. Prices are subject to change without prior notice.',
  };
  const layout = buildQuotationPrintLayout(receipt);

  assert.deepEqual(layout.lines.slice(0, 6), [
    'Tableria La Confianza',
    'Calamba, Laguna',
    '0495452166',
    '-'.repeat(30),
    'QUOTATION',
    '-'.repeat(30),
  ]);
  assert.deepEqual(layout.centeredHeaderLineCount, 3);
  assert.deepEqual(layout.centeredLineIndexes, [4]);
  assert.deepEqual(layout.lines.slice(6, 8), ['Long Product Name That Wraps', 'On Thermal Paper']);
  assert.deepEqual(layout.alignedTextLines, [
    { lineIndex: 8, leftText: `12 ${String.fromCodePoint(0x00d7)} ${formatCurrency(receipt.items[0].unitPrice)}`, rightText: formatCurrency(receipt.items[0].amount) },
    { lineIndex: 10, leftText: 'TOTAL:', rightText: formatCurrency(receipt.total) },
  ]);
  assert.deepEqual(layout.fullWidthSeparatorLineIndexes, [3, 5, 9]);
  assert.equal(receipt.items[0].code, 'SKU-001');
  assert.equal(receipt.items[0].quantity, 12);
  assert.equal(receipt.items[0].amount, 2450);
  assert.equal(layout.lines[11], '');
  assert.equal(layout.lines.slice(12).join(' '), receipt.footer);
  assert.ok(!layout.lines.some((line) => line.startsWith('Contact:')));
  assert.ok(!layout.lines.includes('ITEM'));
});

test('quotation layout omits unavailable store lines and keeps the heading centered', async () => {
  const { buildQuotationPrintLayout } = await loadQuotationThermalLayout();
  const receipt = { storeName: 'Store', title: 'QUOTATION', items: [{ name: 'Item', quantity: 1, unitPrice: 100, amount: 100 }], total: 100 };
  const layout = buildQuotationPrintLayout(receipt);

  assert.deepEqual(layout.lines.slice(0, 4), ['Store', '-'.repeat(30), 'QUOTATION', '-'.repeat(30)]);
  assert.equal(layout.centeredHeaderLineCount, 1);
  assert.deepEqual(layout.centeredLineIndexes, [2]);
  assert.ok(!layout.lines.some((line) => line.startsWith('Contact:')));
});

test('multiple quotations keep long names wrapped and price pairs aligned independently', async () => {
  const { buildQuotationPrintLayout } = await loadQuotationThermalLayout();
  const { formatCurrency } = await loadNumberFormat();
  const multiply = String.fromCodePoint(0x00d7);
  const layout = buildQuotationPrintLayout({
    storeName: 'Store',
    title: 'QUOTATION',
    items: [
      { name: 'First Item', quantity: 2, unitPrice: 25, amount: 50 },
      { name: 'A Very Long Product Description That Needs Several Lines', quantity: 12, unitPrice: 9999.99, amount: 119999.88 },
      { name: 'Third Item', quantity: 1, unitPrice: 3456.9, amount: 3456.9 },
    ],
    total: 123506.78,
    footer: 'Prices are subject to change without prior notice.',
  });

  assert.deepEqual(layout.lines.slice(4, 7), [
    'First Item',
    `2 ${multiply} ${formatCurrency(25)} ${formatCurrency(50)}`,
    '',
  ]);
  assert.deepEqual(layout.lines.slice(7, 11), [
    'A Very Long Product',
    'Description That Needs Several',
    'Lines',
    `12 ${multiply} ${formatCurrency(9999.99)} ${formatCurrency(119999.88)}`,
  ]);
  assert.deepEqual(layout.alignedTextLines, [
    { lineIndex: 5, leftText: `2 ${multiply} ${formatCurrency(25)}`, rightText: formatCurrency(50) },
    { lineIndex: 10, leftText: `12 ${multiply} ${formatCurrency(9999.99)}`, rightText: formatCurrency(119999.88) },
    { lineIndex: 13, leftText: `1 ${multiply} ${formatCurrency(3456.9)}`, rightText: formatCurrency(3456.9) },
    { lineIndex: 15, leftText: 'TOTAL:', rightText: formatCurrency(123506.78) },
  ]);
  assert.ok(layout.lines.filter((_, index) => !layout.alignedTextLines.some((line) => line.lineIndex === index)).every((line) => line.length <= 30));
  assert.ok(!layout.lines.includes('QTY  UNIT PRICE  AMOUNT'));
});
