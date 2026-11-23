const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../../src/utils/reportPdfFormatting.js');
const reportsSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Reports.jsx'), 'utf8');
const reportTableSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ReportRecordTable.jsx'), 'utf8');

test('sales transaction monetary columns show peso units in shared screen and export headers', () => {
  for (const label of ['Total Amount (₱)', 'Amount Paid (₱)', 'Remaining Balance (₱)']) {
    assert.ok(reportsSource.includes(`label: '${label}'`), `${label} should be a shared table header`);
  }
  assert.match(reportsSource, /column\.sensitive \? formatPdfMoneyAmount\(row\[column\.key\]\)/, 'PDF body cells should use plain monetary text');
  assert.match(reportsSource, /cell\.z = '#,##0\.00'/, 'Excel monetary cells should use a plain numeric format');
  assert.match(reportsSource, /heading\.map\(formatPdfHeaderText\)/, 'PDF headers should convert peso to the supported marker glyph');
  assert.match(reportsSource, /cellData\.section !== 'head'/, 'peso vector marks should only be drawn in headers');
  assert.match(reportTableSource, /column\.sensitive && !showFinancials \? '••••••'/, 'masked values should not repeat the currency symbol');
});

test('PDF monetary amounts use readable grouped decimal text and preserve unknown values', async () => {
  const { formatPdfCellText, formatPdfMoneyAmount } = await load();
  assert.equal(formatPdfMoneyAmount(25), '25.00');
  assert.equal(formatPdfMoneyAmount(9727), '9,727.00');
  assert.equal(formatPdfMoneyAmount(0), '0.00');
  assert.equal(formatPdfMoneyAmount(null), '-');
  assert.equal(formatPdfMoneyAmount(undefined), '-');
  assert.equal(formatPdfMoneyAmount('   '), '-');
  assert.equal(formatPdfMoneyAmount('invalid'), '-');
  assert.equal(formatPdfCellText('—'), '-');
  assert.equal(formatPdfCellText('pcs'), 'pcs');
});

test('peso mark uses supported text and vector rules while summary text resets character spacing', async () => {
  const { drawPdfPesoAmount, drawPdfPesoHeaderSymbol, drawPdfPesoSymbol } = await load();
  const calls = [];
  const doc = {
    getFontSize: () => 8,
    setFont: (...args) => calls.push(['font', ...args]),
    setFontSize: (...args) => calls.push(['fontSize', ...args]),
    setTextColor: (...args) => calls.push(['textColor', ...args]),
    setCharSpace: (...args) => calls.push(['charSpace', ...args]),
    text: (...args) => calls.push(['text', ...args]),
    getTextWidth: (text) => text.length * 1.5,
    setDrawColor: (...args) => calls.push(['drawColor', ...args]),
    setLineWidth: (...args) => calls.push(['lineWidth', ...args]),
    line: (...args) => calls.push(['line', ...args]),
  };

  drawPdfPesoSymbol(doc, 2, 8, 8);
  assert.equal(calls.filter(([name]) => name === 'text').length, 1);
  assert.deepEqual(calls.find(([name]) => name === 'text').slice(1), ['P', 2, 8]);
  assert.equal(calls.filter(([name]) => name === 'line').length, 2);

  calls.length = 0;
  drawPdfPesoAmount(doc, 'Sales amount:', 9727, 12, 20, 8);
  assert.ok(calls.some(([name, value]) => name === 'charSpace' && value === 0));
  assert.ok(calls.some(([name, value]) => name === 'text' && value === '9,727.00'));

  calls.length = 0;
  drawPdfPesoHeaderSymbol({ ...doc, getTextWidth: (text) => text.length, setFont: (...args) => calls.push(['font', ...args]) }, {
    cell: {
      text: ['Amount Paid (P)'],
      styles: { halign: 'right', fontSize: 8, textColor: 255, fontStyle: 'bold' },
      getTextPos: () => ({ x: 100, y: 20 }),
    },
  });
  const pesoGlyphCall = calls.find(([name, value]) => name === 'text' && value === 'P');
  assert.equal(pesoGlyphCall[2], 98, 'peso mark overlays the final P unit marker, not the P in Paid');
  assert.ok(calls.some(([name, ...args]) => name === 'font' && args[1] === 'bold'));
  assert.equal(calls.filter(([name]) => name === 'line').length, 2, 'header peso mark is formed from vector strokes');
});

test('multi-page table export repeats its header and retains right-aligned peso amounts', async () => {
  const [{ drawPdfPesoHeaderSymbol, formatPdfCellText, formatPdfHeaderText, formatPdfMoneyAmount }, { jsPDF }, autoTableModule] = await Promise.all([
    load(), import('jspdf'), import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;
  const pdf = new jsPDF('l', 'mm', 'a4');
  pdf.setCharSpace(0);
  const rows = Array.from({ length: 100 }, (_, index) => [
    `TRX-${String(index + 1).padStart(3, '0')}`,
    formatPdfCellText(index === 0 ? '—' : `Customer ${index + 1}`),
    formatPdfMoneyAmount(index === 0 ? 1585 : index === 1 ? null : 50),
  ]);

  autoTable(pdf, {
    startY: 14,
    head: [['Transaction ID', 'Customer', formatPdfHeaderText('Total Amount (₱)')]],
    body: rows,
    showHead: 'everyPage',
    columnStyles: { 2: { halign: 'right' } },
    didDrawCell: ({ section, column, cell, doc }) => {
      if (section === 'head' && column.index === 2) {
        drawPdfPesoHeaderSymbol(doc, { cell });
        return;
      }
      if (section !== 'body' || column.index !== 2) return;
      assert.equal(cell.styles.halign, 'right', 'monetary values should remain right-aligned');
      const amount = cell.text.join('');
      assert.match(amount, /^(?:\d[\d,]*\.\d{2}|-)$/);
    },
  });

  assert.ok(pdf.getNumberOfPages() > 1, 'fixture should span multiple pages');
  const output = pdf.output();
  assert.ok((output.match(/Transaction ID/g) || []).length > 1, 'table heading should repeat on later pages');
  assert.match(output, /1,585\.00/);
  assert.match(output, /50\.00/);
  assert.match(output, /\(-\) Tj/);
  assert.ok(output.includes('Total Amount \\(P\\)'), 'PDF header should contain the plain-text peso marker');
  assert.ok(!output.includes('₱'), 'PDF text uses the supported P glyph while the vector strokes form the peso mark');
});
