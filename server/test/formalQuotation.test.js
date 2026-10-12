const test = require('node:test');
const assert = require('node:assert/strict');

const loadFormalQuotation = () => import('../../src/utils/formalQuotation.js');

const settings = {
  storeName: 'Tableria La Confianza Co., Inc.',
  storeBusinessSubtitle: 'Lumber, Hardware & Electrical Supplies',
  storeAddress: 'National Highway, Brgy. Parian, Calamba, Laguna',
  contactPhone: '09171234567',
  authorizedSignatoryName: 'Authorized Person',
  // Legacy/unrelated data must never appear in the formal quotation.
  authorizedSignatoryPosition: 'Sales Manager',
};

const customer = {
  _id: 'customer-1',
  name: 'Citizen Machinery Philippines',
  address: 'Calamba, Laguna',
  contact: '09170000000',
  email: 'purchasing@example.test',
  attentionName: 'Beverly Ramos',
  attentionPosition: 'Purchasing Staff',
  taxTreatment: 'vat_zero_rated',
};

const categories = [{
  name: 'Adhesives & Tapes',
  attributeSchemaVersion: 1,
  sizeUnits: ['roll'],
  productAttributes: [{ name: 'Size', key: 'size', type: 'text', order: 0 }],
}];

test('formal quotation normalizes customer, business, item, tax, and signatory data once', async () => {
  const { buildFormalQuotationModel } = await loadFormalQuotation();
  const quotation = buildFormalQuotationModel({
    customer,
    settings,
    categories,
    date: new Date(2026, 9, 11, 10, 30),
    items: [{ name: 'Armak Masking Tape', category: 'Adhesives & Tapes', attributes: { size: '2 in' }, qty: 72, price: 75 }],
  });

  assert.equal(quotation.quotationType, 'regular_customer');
  assert.equal(quotation.customer.name, 'Citizen Machinery Philippines');
  assert.equal(quotation.customer.address, 'Calamba, Laguna');
  assert.equal(quotation.customer.attentionName, 'Beverly Ramos');
  assert.equal(quotation.customer.attentionPosition, 'Purchasing Staff');
  assert.equal(quotation.items[0].description, '72 roll Armak Masking Tape 2 in');
  assert.equal(quotation.items[0].unitPrice, 75);
  assert.equal(quotation.taxLabel, 'VAT ZERO RATED');
  assert.equal(quotation.introduction, 'We are pleased to submit to you our quotation for your consideration.');
  assert.equal(quotation.nothingFollows, '--nothing follows--');
  assert.equal(quotation.disclaimer, 'Prices are subject to change without prior notice.');
  assert.equal(quotation.signatory.name, 'Authorized Person');
  assert.equal(Object.prototype.hasOwnProperty.call(quotation.signatory, 'position'), false);
});

test('quotation-specific details override defaults without mutating customer or settings', async () => {
  const { buildFormalQuotationModel, createFormalQuotationPdf } = await loadFormalQuotation();
  const customerSnapshot = structuredClone(customer);
  const settingsSnapshot = structuredClone(settings);
  const quotation = buildFormalQuotationModel({
    customer,
    settings,
    quotationDetails: {
      attentionName: 'Maria Santos',
      attentionPosition: 'Procurement Lead',
      authorizedSignatoryName: 'Jhon Michael Lu',
    },
    items: [{ name: 'Plain Item', qty: 1, price: 20 }],
  });

  assert.equal(quotation.customer.attentionName, 'Maria Santos');
  assert.equal(quotation.customer.attentionPosition, 'Procurement Lead');
  assert.equal(quotation.signatory.name, 'Jhon Michael Lu');
  assert.equal(Object.prototype.hasOwnProperty.call(quotation.signatory, 'position'), false);
  const pdfSource = createFormalQuotationPdf(quotation).pdf.output();
  assert.match(pdfSource, /Maria Santos/);
  assert.match(pdfSource, /Procurement Lead/);
  assert.match(pdfSource, /Jhon Michael Lu/);
  assert.doesNotMatch(pdfSource, /Sales Manager/);
  assert.deepEqual(customer, customerSnapshot);
  assert.deepEqual(settings, settingsSnapshot);
});

test('formal quotation requires a signatory name while allowing a quotation-only override', async () => {
  const { buildFormalQuotationModel } = await loadFormalQuotation();
  const settingsWithoutSignatory = { ...settings, authorizedSignatoryName: '   ' };

  assert.throws(() => buildFormalQuotationModel({
    customer,
    settings: settingsWithoutSignatory,
    items: [{ name: 'Plain Item', qty: 1, price: 20 }],
  }), /Authorized Signatory Name is required for a formal quotation/);

  const quotation = buildFormalQuotationModel({
    customer,
    settings: settingsWithoutSignatory,
    quotationDetails: { authorizedSignatoryName: '  Quotation Signatory  ' },
    items: [{ name: 'Plain Item', qty: 1, price: 20 }],
  });

  assert.equal(quotation.signatory.name, 'Quotation Signatory');
  assert.equal(settingsWithoutSignatory.authorizedSignatoryName, '   ');
});

test('position-only attention is omitted while name-only attention remains valid', async () => {
  const { buildFormalQuotationModel } = await loadFormalQuotation();
  const positionOnly = buildFormalQuotationModel({
    customer,
    settings,
    quotationDetails: { attentionName: '', attentionPosition: 'Purchasing Staff' },
    items: [{ name: 'Item', qty: 1, price: 20 }],
  });
  const nameOnly = buildFormalQuotationModel({
    customer,
    settings,
    quotationDetails: { attentionName: 'Beverly Ramos', attentionPosition: '' },
    items: [{ name: 'Item', qty: 1, price: 20 }],
  });

  assert.equal(positionOnly.customer.attentionName, '');
  assert.equal(positionOnly.customer.attentionPosition, '');
  assert.equal(nameOnly.customer.attentionName, 'Beverly Ramos');
  assert.equal(nameOnly.customer.attentionPosition, '');
});

test('formal quotation cleanly omits optional attention and standard tax labels', async () => {
  const { buildFormalQuotationModel } = await loadFormalQuotation();
  const quotation = buildFormalQuotationModel({
    customer: { name: 'Regular Customer', taxTreatment: 'standard' },
    settings,
    items: [{ name: 'Plain Item', qty: 1, price: 20 }],
  });

  assert.equal(quotation.customer.attentionName, '');
  assert.equal(quotation.customer.attentionPosition, '');
  assert.equal(quotation.taxLabel, '');
  assert.equal(quotation.items[0].description, '1 Plain Item');
});

test('formal quotation does not guess a selling unit when a category has multiple choices', async () => {
  const { buildFormalQuotationModel } = await loadFormalQuotation();
  const quotation = buildFormalQuotationModel({
    customer,
    settings,
    categories: [{ name: 'Bulk Goods', attributeSchemaVersion: 1, sizeUnits: ['bag', 'kg'], productAttributes: [] }],
    items: [{ name: 'Construction Sand', category: 'Bulk Goods', qty: 2, price: 120 }],
  });

  assert.equal(quotation.items[0].sellingUnit, '');
  assert.equal(quotation.items[0].description, '2 Construction Sand');
});

test('legacy VAT-exempt customer metadata remains compatible', async () => {
  const { buildFormalQuotationModel } = await loadFormalQuotation();
  const quotation = buildFormalQuotationModel({
    customer: { name: 'Legacy Customer', isVatExempt: true },
    settings,
    items: [{ name: 'Item', qty: 1, price: 20 }],
  });

  assert.equal(quotation.taxTreatment, 'exempt');
  assert.equal(quotation.taxLabel, 'VAT EXEMPT');
});

test('formal quotation filename is deterministic and filesystem safe', async () => {
  const { buildFormalQuotationFilename } = await loadFormalQuotation();
  assert.equal(
    buildFormalQuotationFilename(' Citizen / Machinery: Philippines? ', new Date(2026, 9, 11)),
    'Price-Quotation-CITIZEN-MACHINERY-PHILIPPINES-2026-10-11.pdf',
  );
  assert.equal(buildFormalQuotationFilename('', new Date(2026, 9, 11)), 'Price-Quotation-2026-10-11.pdf');
});

test('formal quotation PDF is A4, uses normalized data, and supports multiple pages', async () => {
  const { buildFormalQuotationModel, createFormalQuotationPdf } = await loadFormalQuotation();
  const quotation = buildFormalQuotationModel({
    customer,
    settings,
    categories,
    date: new Date(2026, 9, 11),
    items: Array.from({ length: 80 }, (_, index) => ({
      name: `Armak Masking Tape Item ${index + 1}`,
      category: 'Adhesives & Tapes',
      attributes: { size: `${index + 1} in` },
      qty: index + 1,
      price: 40 + index,
    })),
  });
  const { pdf, filename } = createFormalQuotationPdf(quotation);
  const bytes = Buffer.from(pdf.output('arraybuffer'));

  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < 0.1);
  assert.ok(pdf.getNumberOfPages() > 1);
  assert.equal(filename, 'Price-Quotation-CITIZEN-MACHINERY-PHILIPPINES-2026-10-11.pdf');
  assert.equal(quotation.items.length, 80);
});
