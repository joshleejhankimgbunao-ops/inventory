const test = require('node:test');
const assert = require('node:assert/strict');

const loadHeaderBuilder = () => import('../../src/utils/quotationThermalHeader.js');

test('thermal quotation header contains three centered-ready lines without a Contact label', async () => {
  const { buildQuotationThermalHeaderLines } = await loadHeaderBuilder();

  const lines = buildQuotationThermalHeaderLines({
    storeName: 'Tableria La Confianza Co., Inc.',
    storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
    contactPhone: '0917-545-2166',
  });

  assert.deepEqual(lines, [
    'Tableria La Confianza Co., Inc.',
    'Manila S Rd, Calamba, 4027 Laguna',
    '09175452166',
  ]);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.length <= 33));
  assert.ok(!lines.some((line) => /contact/i.test(line)));
});

test('thermal quotation header omits unavailable values instead of printing placeholders', async () => {
  const { buildQuotationThermalHeaderLines } = await loadHeaderBuilder();

  assert.deepEqual(buildQuotationThermalHeaderLines({
    storeName: 'Store',
    storeAddress: '',
    contactPhone: '   ',
  }), ['Store']);
});

test('quotation print request forwards the count of centered header lines to the local printer', async () => {
  const originalFetch = globalThis.fetch;
  let printRequest;
  globalThis.fetch = async (url, options) => {
    printRequest = { url, options };
    return { ok: true, json: async () => ({ ok: true }) };
  };

  try {
    const { printDocument } = await import('../../src/services/receiptPrinter.js');
    const { buildQuotationPrintLayout } = await import('../../src/utils/quotationThermalLayout.js');
    const layout = buildQuotationPrintLayout({
      storeName: 'Tableria La Confianza Co., Inc.',
      storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
      contactPhone: '0917-545-2166',
      title: 'QUOTATION',
      items: [{ name: 'Galvanized Sheet', quantity: 2, unitPrice: 100, amount: 200 }],
      total: 200,
    });

    await printDocument(layout);

    assert.equal(printRequest.options.method, 'POST');
    assert.deepEqual(JSON.parse(printRequest.options.body), layout);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
