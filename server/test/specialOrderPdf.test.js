const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const loadSpecialOrderPdf = () => import('../../src/utils/specialOrderPdf.js');

test('Special Order PDF uses the finalized receipt contract and creates a valid PDF', async () => {
  const { createSpecialOrderTransactionPdf } = await loadSpecialOrderPdf();
  const transaction = {
    id: 'TRX-FINAL-001',
    date: '2026-08-28T03:15:00.000Z',
    specialOrderNumber: 'SO-2026-001',
    customerName: 'Saved Customer',
    cashier: 'Saved Cashier',
    paymentMethod: 'cash',
    paymentStatus: 'Paid',
    total: 500,
    items: [{ name: 'Finalized Sale Item', qty: 2, price: 250, subtotal: 500 }],
  };

  const { pdf, filename } = createSpecialOrderTransactionPdf({
    order: {
      orderNumber: 'SO-2026-001',
      status: 'Completed',
      customerName: 'Saved Customer',
      createdAt: '2026-08-20T00:00:00.000Z',
      completedAt: '2026-08-28T03:15:00.000Z',
    },
    transaction,
    settings: { storeName: 'Test Store' },
    logo: {
      dataUrl: `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../src/assets/logo.png')).toString('base64')}`,
      width: 254,
      height: 254,
    },
  });

  const bytes = Buffer.from(pdf.output('arraybuffer'));
  const documentText = pdf.output();
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 1000);
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < 0.1);
  assert.match(documentText, /TRX-FINAL-001/);
  assert.match(documentText, /Saved Customer/);
  assert.match(documentText, /Finalized Sale Item/);
  assert.match(documentText, /\/Subtype \/Image/);
  assert.doesNotMatch(documentText, /Customer Copy/);
  assert.equal(filename, 'Special-Order-Transaction-SO-2026-001.pdf');
  assert.equal(transaction.items[0].subtotal, 500);
  assert.equal(transaction.total, 500);
});

test('Special Order PDF filenames safely remove filesystem-unsafe characters', async () => {
  const { buildSpecialOrderPdfFilename } = await loadSpecialOrderPdf();
  assert.equal(
    buildSpecialOrderPdfFilename(' SO/2026:001? '),
    'Special-Order-Transaction-SO-2026-001.pdf'
  );
});
