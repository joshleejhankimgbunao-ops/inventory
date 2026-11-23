const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const { createSpecialOrderQuotationDocument } = require('../src/services/specialOrderQuotationDocument');

const documentFixture = () => ({
  schemaVersion: 1, quotationNumber: 'Q-SO-123-V1', specialOrderNumber: 'SO-123', version: 1,
  quotationDate: '2026-10-14T16:30:00.000Z',
  settings: { storeName: 'Saved Company', storeAddress: 'Saved Company Address', contactPhone: '123', storePrimaryEmail: 'company@example.test' },
  customer: { _id: 'saved-customer', name: 'Saved Customer', address: 'Saved Address', taxTreatment: 'vat_zero_rated' },
  quotationDetails: { attentionName: 'Saved Contact', attentionPosition: 'Saved Position', authorizedSignatoryName: 'Saved Signatory' },
  items: [
    { itemName: 'First item', description: 'Agreed specification', quantity: 3, sellingUnit: 'box', unitPrice: 0.1, lineAmount: 0.3 },
    { itemName: 'Second item', description: '', quantity: 2, sellingUnit: '', unitPrice: 0.2, lineAmount: 0.4 },
  ], subtotal: 0.7, total: 0.7,
});
const load = () => import('../../src/utils/formalQuotation.js');

test('saved Special Order quotation document snapshots Selling Unit and explicit expiry details only', () => {
  const selection = { batch: '65a100000000000000000002', batchId: 'B-1', batchReference: 'LOT-1', lotNumber: 'MFG-1', expiryDate: '2027-05-10', quantity: 2 };
  const document = createSpecialOrderQuotationDocument({
    order: { orderNumber: 'SO-1', workflowVersion: 2 },
    quotation: {
      quotationNumber: 'Q-SO-1-V1', version: 1, customerName: 'Customer', customer: null,
      quotationDetails: { authorizedSignatoryName: 'Signer' }, customerDetails: { taxTreatment: 'standard' },
      items: [
        { itemId: 'tracked', itemName: 'Tracked', description: '', sellingUnit: 'box', itemType: 'inventory', inventorySnapshot: { expiryTrackingEnabled: true }, expiryDate: '', quotationExpirySelections: [selection], quantity: 3, unitPrice: 2, lineAmount: 6, images: [] },
        { itemId: 'custom', itemName: 'Custom', description: '', sellingUnit: 'can', itemType: 'custom', expiryDate: '2027-02-03', quotationExpirySelections: [], quantity: 1, unitPrice: 4, lineAmount: 4, images: [] },
      ],
      subtotal: 10, total: 10,
    },
    settings: { storeName: 'Company' }, issuedAt: new Date('2026-11-23T00:00:00.000Z'),
  });
  assert.equal(document.items[0].sellingUnit, 'box');
  assert.deepEqual(document.items[0].quotationExpirySelections, [{ batchId: 'B-1', batchReference: 'LOT-1', lotNumber: 'MFG-1', expiryDate: '2027-05-10', quantity: 2 }]);
  assert.equal(document.items[0].expiryDate, '');
  assert.equal(document.items[1].expiryDate, '2027-02-03');
  assert.deepEqual(document.items[1].quotationExpirySelections, []);
});

test('version-aware filename keeps the existing two-argument filename compatible', async () => {
  const { buildFormalQuotationFilename } = await load();
  assert.equal(buildFormalQuotationFilename('Saved Customer', '2026-10-15'), 'Price-Quotation-SAVED-CUSTOMER-2026-10-15.pdf');
  assert.equal(buildFormalQuotationFilename('Saved Customer', '2026-10-15', { quotationNumber: 'Q-SO-123-V1', version: 1 }), 'Price-Quotation-SAVED-CUSTOMER-Q-SO-123-V1-v1-2026-10-15.pdf');
});

test('saved document has exact centavo line/aggregate totals, metadata, identifiers and Manila issue date', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const snapshot = documentFixture();
  const before = structuredClone(snapshot);
  const model = buildSpecialOrderFormalQuotationModel(snapshot);
  assert.deepEqual(model.items.map((item) => item.lineAmount), [0.3, 0.4]);
  assert.equal(model.total, 0.7);
  assert.equal(model.customer.name, 'Saved Customer');
  assert.equal(model.customer.address, 'Saved Address');
  assert.equal(model.customer.attentionName, 'Saved Contact');
  assert.equal(model.customer.attentionPosition, 'Saved Position');
  assert.equal(model.signatory.name, 'Saved Signatory');
  assert.equal(model.company.name, 'Saved Company');
  assert.equal(model.quotationNumber, 'Q-SO-123-V1');
  assert.equal(model.specialOrderNumber, 'SO-123');
  assert.equal(model.version, 1);
  assert.equal(model.dateIso, '2026-10-15');
  assert.equal(model.dateDisplay, 'October 15, 2026');
  assert.equal(model.taxLabel, 'VAT ZERO RATED');
  assert.equal(model.items[1].sellingUnit, '');
  assert.equal(model.items[0].description.match(/Agreed specification/g).length, 1);
  const { pdf, filename } = createFormalQuotationPdf(model);
  const source = pdf.output();
  for (const value of ['Grand Total', 'PHP 0.70', 'Saved Contact', 'Saved Position', 'Saved Signatory', 'October 15, 2026']) assert.ok(source.includes(value), value);
  assert.match(source, /\(ORDER:\)/);
  assert.match(source, /\(SO-123\)/);
  assert.doesNotMatch(source, /\(QUOTE:\)|\(Q-SO-123-V1\)/);
  assert.equal(filename, 'Price-Quotation-SAVED-CUSTOMER-Q-SO-123-V1-v1-2026-10-15.pdf');
  assert.deepEqual(snapshot, before);
});

test('formal preview and printable PDF distinguish manual, selected, and unassigned expiry information', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const document = documentFixture();
  document.items = [
    { itemId: 'manual', itemType: 'custom', itemName: 'Custom Paint', description: '', quantity: 2, sellingUnit: 'can', expiryDate: '2027-02-03', unitPrice: 0.1, lineAmount: 0.2 },
    { itemId: 'selected', itemType: 'inventory', itemName: 'Tracked Product', description: '', quantity: 3, sellingUnit: 'box', inventorySnapshot: { expiryTrackingEnabled: true }, quotationExpirySelections: [{ batchId: 'B-1', batchReference: 'LOT-1', expiryDate: '2027-05-10', quantity: 2 }], unitPrice: 0.2, lineAmount: 0.6 },
    { itemId: 'unassigned', itemType: 'inventory', itemName: 'Unassigned Product', description: '', quantity: 1, sellingUnit: 'pcs', inventorySnapshot: { expiryTrackingEnabled: true }, quotationExpirySelections: [], unitPrice: 0.1, lineAmount: 0.1 },
    { itemId: 'untracked', itemType: 'inventory', itemName: 'Ordinary Product', description: '', quantity: 1, sellingUnit: 'pcs', inventorySnapshot: { expiryTrackingEnabled: false }, unitPrice: 0.5, lineAmount: 0.5 },
  ];
  document.subtotal = document.total = 1.4;
  const model = buildSpecialOrderFormalQuotationModel(document);
  assert.deepEqual(model.items.map((item) => item.expiryLines), [
    ['Expiry: 2027-02-03 (provided for quotation; not batch-verified)'],
    ['Expiry: 2027-05-10 · 2 box (selected for quotation only; batch not reserved or guaranteed)', 'Expiry: To be confirmed (1 box)'],
    ['Expiry: To be confirmed (1 pcs)'],
    [],
  ]);

  const previewSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/FormalPriceQuotationModal.jsx'), 'utf8');
  assert.match(previewSource, /item\.expiryLines\?\.length > 0/);
  assert.match(previewSource, /className="block">\{line\}<\/span>/);
  const pdf = createFormalQuotationPdf(model).pdf.output();
  assert.match(pdf, /provided for quotation/);
  assert.match(pdf, /selected for quotation only/);
  assert.match(pdf, /reserved/);
  assert.match(pdf, /guaranteed/);
  assert.match(pdf, /To be confirmed/);
});

test('Phase 1 fulfillment appears identically in saved preview and PDF without changing old documents', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const historical = documentFixture();
  const updated = structuredClone(historical);
  updated.fulfillment = { method: 'Free Delivery', addressLine: '123 Main St', barangay: 'Baclaran', cityMunicipality: 'City of Cabuyao', province: 'Laguna' };
  const oldModel = buildSpecialOrderFormalQuotationModel(historical);
  const model = buildSpecialOrderFormalQuotationModel(updated);
  assert.equal(oldModel.fulfillmentText, '');
  assert.match(model.fulfillmentText, /Free Delivery within Laguna.*123 Main St, Baclaran, City of Cabuyao/);
  const source = createFormalQuotationPdf(model).pdf.output();
  assert.match(source, /PICKUP OR DELIVERY:/);
  assert.match(source, /Free Delivery within Laguna/);
  assert.doesNotMatch(model.fulfillmentText, /City of Cabuyao.*Laguna/);
  const noAddress = buildSpecialOrderFormalQuotationModel({ ...historical, fulfillment: { method: 'Free Delivery', addressLine: '', barangay: '', cityMunicipality: '', province: 'Laguna' } });
  assert.equal(noAddress.fulfillmentText, 'Free Delivery within Laguna');
  const pickup = structuredClone(historical);
  pickup.fulfillment = { method: 'Store Pickup', preferredDate: '2026-10-20' };
  const pickupModel = buildSpecialOrderFormalQuotationModel(pickup);
  assert.match(pickupModel.fulfillmentText, /Store Pickup.*2026-10-20/);
  assert.match(createFormalQuotationPdf(pickupModel).pdf.output(), /Store Pickup/);
  assert.deepEqual(historical, documentFixture());
});

test('new Special Order VAT-Rated label is explicit without a fabricated VAT amount or changing old PDFs', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const historical = documentFixture();
  const oldModel = buildSpecialOrderFormalQuotationModel(historical);
  const next = structuredClone(historical);
  next.taxTreatment = 'standard';
  next.customer.taxTreatment = 'standard';
  const model = buildSpecialOrderFormalQuotationModel(next);
  assert.equal(model.taxLabel, 'VAT-RATED');
  assert.equal(model.total, oldModel.total);
  assert.equal(Object.hasOwn(next, 'vatAmount'), false);
  assert.match(createFormalQuotationPdf(model).pdf.output(), /VAT-RATED/);
  assert.notEqual(oldModel.taxLabel, 'VAT-RATED');
});

test('Special Order PDF embeds the selected product photo instead of a text placeholder', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const snapshot = documentFixture();
  snapshot.items[0].itemId = 'photo-item';
  snapshot.items[0].images = [{ key: 'product.png', mimeType: 'image/png', size: 68 }];
  const model = buildSpecialOrderFormalQuotationModel(snapshot);
  assert.throws(() => createFormalQuotationPdf(model), /saved product photo could not be loaded/i);
  model.items[0].images[0].src = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../src/assets/logo.png')).toString('base64')}`;
  const source = createFormalQuotationPdf(model).pdf.output();
  assert.match(source, /\/Subtype \/Image/);
  assert.doesNotMatch(source, /\[object Object\]/);
});

test('one- and two-product quotations with photos keep the items and grand total on one A4 page when they fit', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const photo = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../src/assets/logo.png')).toString('base64')}`;
  const snapshot = documentFixture();
  snapshot.items = snapshot.items.map((item, index) => ({
    ...item,
    itemName: `Product ${index + 1}`,
    images: [{ key: `product-${index + 1}.png`, src: photo }],
  }));
  const allItems = snapshot.items;
  snapshot.total = snapshot.subtotal = 0.7;

  for (const count of [1, 2]) {
    snapshot.items = allItems.slice(0, count);
    snapshot.total = snapshot.subtotal = snapshot.items.reduce((sum, item) => sum + item.lineAmount, 0);
    const { pdf } = createFormalQuotationPdf(buildSpecialOrderFormalQuotationModel(snapshot));
    assert.equal(pdf.getNumberOfPages(), 1, `${count} product(s) with photos should fit on one A4 page`);
    const page = pdf.internal.pages[1].join('\n');
    for (let index = 0; index < count; index += 1) assert.ok(page.includes(`Product ${index + 1}`));
    for (const value of ['Grand Total', 'VAT ZERO RATED', 'Saved Signatory']) assert.ok(page.includes(value), value);
  }
});

test('long multi-product quotations paginate naturally while keeping each photo with its item row', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const photo = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../src/assets/logo.png')).toString('base64')}`;
  const snapshot = documentFixture();
  snapshot.items = Array.from({ length: 7 }, (_, index) => ({
    itemName: `Long product ${index + 1}`,
    description: 'Detailed saved specifications and finish requirements. '.repeat(5),
    quantity: 2,
    sellingUnit: 'pcs',
    unitPrice: 12.5,
    lineAmount: 25,
    images: [{ key: `product-${index + 1}-a.png`, src: photo }, { key: `product-${index + 1}-b.png`, src: photo }],
  }));
  snapshot.subtotal = snapshot.total = 175;

  const { pdf } = createFormalQuotationPdf(buildSpecialOrderFormalQuotationModel(snapshot));
  assert.ok(pdf.getNumberOfPages() > 1, 'long quotations should use natural pagination');
  const pages = pdf.internal.pages.slice(1).map((page) => page.join('\n'));
  for (let index = 0; index < snapshot.items.length; index += 1) {
    const page = pages.find((value) => value.includes(`Long product ${index + 1}`));
    assert.ok(page, `missing product ${index + 1}`);
    assert.match(page, /\/I\d+ Do/, `product ${index + 1} should stay with its photo`);
  }
  const finalPage = pages.at(-1);
  for (const value of ['Grand Total', 'PHP 175.00', 'Saved Signatory']) assert.ok(finalPage.includes(value), value);
});

test('Special Order photos follow their own item details in preview and PDF for one, two and three photos', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const filename = path.resolve(__dirname, '../../src/components/FormalPriceQuotationModal.jsx');
  const compiled = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', external: ['react'], write: false });
  const component = new Module(filename, module);
  component.paths = Module._nodeModulePaths(path.dirname(filename));
  component._compile(compiled.outputFiles[0].text, filename);
  const photo = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../src/assets/logo.png')).toString('base64')}`;
  const document = documentFixture();
  document.items = [1, 2, 3].map((count, index) => ({
    itemId: `item-${index}`, itemType: index === 1 ? 'inventory' : 'custom', itemName: `Product ${index + 1}`,
    description: 'Detailed specification '.repeat(index + 1), quantity: 1, sellingUnit: 'pcs', unitPrice: 1, lineAmount: 1,
    images: Array.from({ length: count }, (_, imageIndex) => ({ key: `item-${index}-photo-${imageIndex}`, src: photo })),
  }));
  document.subtotal = document.total = 3;
  const model = buildSpecialOrderFormalQuotationModel(document);
  const html = renderToStaticMarkup(React.createElement(component.exports.FormalPriceQuotationDocument, { quotation: model }));
  assert.doesNotMatch(html, /<th[^>]*>Photos<\/th>/);
  assert.match(html, /border-x border-t border-slate-300/, 'product details retain clean column borders above their photos');
  assert.match(html, /<td colSpan="4" class="border-b border-slate-300 px-2 pb-3 pt-0">/, 'photo rows have no side or top grid while retaining a separator below');
  assert.equal((html.match(/alt="Product \d product photo \d"/g) || []).length, 6);
  assert.equal((html.match(/class="h-\[36mm\] min-w-0"/g) || []).length, 6);
  assert.equal((html.match(/class="grid grid-cols-3 gap-2"/g) || []).length, 3);
  for (let index = 0; index < 3; index += 1) {
    const start = html.indexOf(`Product ${index + 1}`);
    const end = index === 2 ? html.indexOf('Grand Total') : html.indexOf(`Product ${index + 2}`);
    assert.ok(start >= 0 && end > start);
    assert.equal((html.slice(start, end).match(/alt="Product \d product photo \d"/g) || []).length, index + 1);
  }
  const pdf = createFormalQuotationPdf(model).pdf;
  const source = pdf.output();
  assert.equal((source.match(/\/I\d+ Do/g) || []).length, 6);
  const photoMatrices = [...source.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\n\/I\d+ Do/g)];
  assert.equal(photoMatrices.length, 6);
  assert.ok(photoMatrices.every((match) => Number(match[1]) >= 102 && Number(match[2]) >= 102), 'square photos use the larger 36 mm photo cells without distortion');
  assert.doesNotMatch(source, /\(Photos\)/);
  assert.ok(source.indexOf('Product 1') < source.indexOf('/I0 Do'));
  assert.ok(source.lastIndexOf('/I0 Do') < source.indexOf('Grand Total'));
  const pages = pdf.internal.pages.slice(1).map((page) => page.join('\n'));
  const finalPage = pages.find((page) => page.includes('Product 3'));
  assert.match(finalPage, /Grand Total/);
  assert.deepEqual(model.items.map((item) => item.images.map((image) => image.key)), document.items.map((item) => item.images.map((image) => image.key)));
});

test('historical and revised documents stay independent; repeated PDF creation is read-only', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const historical = documentFixture();
  const revised = structuredClone(historical);
  revised.version = 2;
  revised.quotationNumber = 'Q-SO-123-V2';
  revised.quotationDate = '2026-10-16T03:00:00Z';
  revised.settings.storeName = 'New Company';
  revised.customer.name = 'Revision Customer';
  revised.quotationDetails.authorizedSignatoryName = 'New Signatory';
  revised.items = [{ itemName: 'Replacement', description: 'New spec', quantity: 1, unitPrice: 12.34, lineAmount: 12.34 }];
  revised.subtotal = revised.total = 12.34;
  const oldModel = buildSpecialOrderFormalQuotationModel(historical);
  const newModel = buildSpecialOrderFormalQuotationModel(revised);
  const before = structuredClone(oldModel);
  const downloads = Array.from({ length: 3 }, () => createFormalQuotationPdf(oldModel));
  assert.equal(new Set(downloads.map((result) => result.filename)).size, 1);
  assert.notEqual(downloads[0].filename, createFormalQuotationPdf(newModel).filename);
  assert.equal(oldModel.company.name, 'Saved Company');
  assert.equal(oldModel.customer.name, 'Saved Customer');
  assert.equal(oldModel.signatory.name, 'Saved Signatory');
  assert.equal(oldModel.items.length, 2);
  assert.equal(newModel.items.length, 1);
  assert.equal(newModel.total, 12.34);
  assert.deepEqual(oldModel, before);
});

test('optional recipient metadata renders only saved values while signatory remains required', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const empty = documentFixture();
  empty.quotationDetails.attentionName = '';
  empty.quotationDetails.attentionPosition = '';
  const emptyModel = buildSpecialOrderFormalQuotationModel(empty);
  assert.equal(emptyModel.customer.attentionName, '');
  assert.equal(emptyModel.customer.attentionPosition, '');
  assert.doesNotMatch(createFormalQuotationPdf(emptyModel).pdf.output(), /ATTN\.:/);

  const positionOnly = structuredClone(empty);
  positionOnly.quotationDetails.attentionPosition = 'Purchasing Officer';
  const positionModel = buildSpecialOrderFormalQuotationModel(positionOnly);
  assert.equal(positionModel.customer.attentionName, '');
  assert.equal(positionModel.customer.attentionPosition, 'Purchasing Officer');
  assert.match(createFormalQuotationPdf(positionModel).pdf.output(), /Purchasing Officer/);
  assert.equal(positionModel.signatory.name, 'Saved Signatory');
});

test('document validation rejects missing signatory/date/snapshot and inconsistent or invented amounts', async () => {
  const { buildSpecialOrderFormalQuotationModel } = await load();
  assert.throws(() => buildSpecialOrderFormalQuotationModel(null), /snapshot.*unavailable/i);
  for (const [modify, expected] of [
    [(doc) => { doc.quotationDetails.authorizedSignatoryName = ''; doc.settings.authorizedSignatoryName = 'Current Person'; }, /Authorized Signatory Name/],
    [(doc) => { doc.quotationDate = 'invalid'; }, /quotation date/i],
    [(doc) => { delete doc.quotationDate; }, /quotation date/i],
    [(doc) => { doc.total = 0.8; }, /amounts.*match/i],
    [(doc) => { doc.items[0].lineAmount = 0.4; }, /amounts.*match/i],
    [(doc) => { doc.items[0].unitPrice = 0.101; }, /amount/i],
    [(doc) => { delete doc.items[0].unitPrice; }, /amount/i],
    [(doc) => { doc.items[0].itemName = ''; }, /item name/i],
  ]) {
    const doc = documentFixture(); modify(doc);
    assert.throws(() => buildSpecialOrderFormalQuotationModel(doc), expected);
  }
});

test('long specifications and multi-page documents retain totals and signatory without mutation', async () => {
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const doc = documentFixture();
  doc.items = Array.from({ length: 65 }, (_, index) => ({ itemName: `Long product ${index + 1} ${'name '.repeat(8)}`, description: 'Specification '.repeat(16), quantity: 3, sellingUnit: 'pcs', unitPrice: 0.1, lineAmount: 0.3 }));
  doc.subtotal = doc.total = 19.5;
  const { pdf } = createFormalQuotationPdf(buildSpecialOrderFormalQuotationModel(doc));
  assert.ok(pdf.getNumberOfPages() > 1);
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < 0.1);
  assert.match(pdf.output(), /Grand Total/);
  assert.match(pdf.output(), /PHP 19.50/);
  assert.match(pdf.output(), /Saved Signatory/);
});

test('Special Orders fetches version documents for preview and keeps Print unavailable', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../src/pages/SpecialOrders.jsx'), 'utf8');
  assert.match(page, /getSpecialOrderQuotationDocumentApi\(selectedOrder\._id, value\._id\)/);
  assert.match(page, /buildSpecialOrderFormalQuotationModel/);
  assert.match(page, /quotationGateRef\.current\.isCurrent\(ticket\)/);
  assert.match(page, /allowPrint=\{false\}/);
  assert.doesNotMatch(page, /date:\s*value\.createdAt/);
});

test('formal preview keeps the complete financial table keyboard-scrollable on narrow viewports', async () => {
  const filename = path.resolve(__dirname, '../../src/components/FormalPriceQuotationModal.jsx');
  const compiled = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', external: ['react'], write: false });
  const component = new Module(filename, module);
  component.paths = Module._nodeModulePaths(path.dirname(filename));
  component._compile(compiled.outputFiles[0].text, filename);
  const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await load();
  const document = documentFixture();
  document.specialOrderNumber = 'SO-20261027-0001';
  document.quotationNumber = 'SO-20261027-0001-Q1';
  const model = buildSpecialOrderFormalQuotationModel(document);
  const html = renderToStaticMarkup(React.createElement(component.exports.FormalPriceQuotationDocument, { quotation: model }));
  assert.match(html, /<thead class="formal-quotation-table-head bg-white">/);
  assert.match(html, /<tr class="text-\[10px\] font-semibold uppercase tracking-wide text-slate-800"><th class="border border-slate-300 px-2 py-2">Description/);
  assert.match(html, /<td class="border border-slate-300 px-2 py-3 font-medium text-slate-800">/);
  assert.match(html, /role="region" aria-label="Quotation items" tabindex="0"/);
  assert.match(html, /max-w-full overflow-x-auto/);
  assert.match(html, /min-w-\[420px\]/);
  assert.match(html, /Grand Total/);
  assert.match(html, /PHP 0.70/);
  assert.match(html, /DATE:/);
  assert.match(html, /TO:/);
  assert.match(html, /ATTN\.:/);
  assert.match(html, /ORDER:/);
  assert.match(html, /SO-20261027-0001/);
  assert.doesNotMatch(html, /QUOTE:|SO-20261027-0001-Q1/);
  const pdfSource = createFormalQuotationPdf(model).pdf.output();
  assert.match(pdfSource, /\(SO-20261027-0001\)/);
  const headerLabelIndex = pdfSource.indexOf('(Description) Tj');
  assert.ok(headerLabelIndex >= 0);
  const headerCell = pdfSource.slice(headerLabelIndex - 450, headerLabelIndex);
  assert.match(headerCell, /1\. g/, 'PDF header cell fill remains white');
  assert.match(headerCell, /0\.8 0\.84 0\.88 RG/, 'PDF header and product borders use a subtle slate stroke');
  assert.match(headerCell, /0\.122 0\.161 0\.216 rg/, 'PDF header label uses dark navy text');
  const walkIn = { ...model, documentScope: undefined };
  const walkInHtml = renderToStaticMarkup(React.createElement(component.exports.FormalPriceQuotationDocument, { quotation: walkIn }));
  assert.match(walkInHtml, /QUOTE:|ORDER:/);
  assert.match(createFormalQuotationPdf(walkIn).pdf.output(), /\(QUOTE:\)|\(ORDER:\)/);
});
