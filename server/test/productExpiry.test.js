const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');
const Product = require('../src/models/Product');
const { buildInitialExpiry, isValidExpiryDate, isFutureExpiryDate, getManilaBusinessDate } = require('../src/utils/productExpiry');

test('date-only expiry validation rejects impossible dates without timezone conversion', () => {
  for (const date of ['2028-02-29', '2027-12-31']) assert.equal(isValidExpiryDate(date), true);
  for (const date of ['', null, '2027-02-29', '2028-02-30', '2027-13-01', '02/28/2027', '2027-01-01T00:00:00Z']) {
    assert.equal(isValidExpiryDate(date), false, String(date));
  }
});

test('frontend and backend use the Manila business date at UTC day boundaries', async () => {
  const frontend = await import('../../src/utils/productExpiryDate.js');
  for (const [now, today, tomorrow] of [
    ['2026-10-15T15:59:59.999Z', '2026-10-15', '2026-10-16'],
    ['2026-10-15T16:00:00.000Z', '2026-10-16', '2026-10-17'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01', '2027-01-02'],
  ]) {
    const instant = new Date(now);
    assert.equal(getManilaBusinessDate(instant), today);
    assert.equal(frontend.getManilaBusinessDate(instant), today);
    assert.equal(frontend.getTomorrowManilaDate(instant), tomorrow);
    for (const validate of [isFutureExpiryDate, frontend.isFutureExpiryDate]) {
      assert.equal(validate(today, instant), false);
      assert.equal(validate(tomorrow, instant), true);
      assert.equal(validate('2026-10-14', instant), false);
      assert.equal(validate('2026-02-30', instant), false);
      assert.equal(validate(`${today}T00:00:00Z`, instant), false);
    }
  }
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-16']) assert.equal(frontend.isValidExpiryDate(date), true);
  for (const date of ['', '2026-02-30', '2026-10-15T00:00:00Z']) assert.equal(frontend.isValidExpiryDate(date), false);
});

test('Add Stock offers authorized expiry activation and keeps incoming dates unrestricted', () => {
  const inventorySource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Inventory.jsx'), 'utf8');
  assert.match(inventorySource, /This product has expiry tracking/);
  assert.match(inventorySource, /New Stock Expiry Date/);
  assert.match(inventorySource, /enableExpiryTracking: enableExpiryTrackingOnStockIn/);
  assert.match(inventorySource, /Verify the current stock before recording a new delivery\./);
  assert.match(inventorySource, /if \(action === 'IN' && !result\?\.reconciled && existingStockToVerify > 0\)[\s\S]*?transitionStockVerificationView\(true\)/);
  assert.doesNotMatch(inventorySource, /stockForm\.expiryDate} min=\{getTomorrowManilaDate\(\)\}/);
});

test('Stock-In and Verify Batches describe optional manufacturer lots without changing the blank-lot payload', () => {
  const inventorySource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Inventory.jsx'), 'utf8');
  const verificationFormSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ExpiryBatchVerificationForm.jsx'), 'utf8');
  assert.match(verificationFormSource, /Batch \/ Lot No\. \(optional\)/);
  assert.match(verificationFormSource, /value=\{row\.lotNumber \|\| ''\} onChange=\{\(event\) => onRowsChange/);
  assert.match(verificationFormSource, /maxLength=\{100\}/);
  assert.match(verificationFormSource, /placeholder="e\.g\. LOT-2026-001"/);
  assert.match(verificationFormSource, /Optional\. A batch reference is generated when stock is verified\./);
  assert.match(inventorySource, /Batch \/ Lot No\. \(optional\)[\s\S]*?value=\{stockForm\.lotNumber \|\| ''\}/);
  assert.match(inventorySource, /maxLength=\{100\}/);
  assert.match(inventorySource, /placeholder="e\.g\. LOT-2026-001"/);
  assert.match(inventorySource, /expiryBatch: \{ expiryDate: stockForm\.expiryDate, lotNumber: stockForm\.lotNumber \}/);
  assert.doesNotMatch(inventorySource, /placeholder="Enter lot number"/);
});

test('expiry dates display as readable, timezone-stable calendar labels', async () => {
  const frontend = await import('../../src/utils/productExpiryDate.js');
  assert.equal(frontend.formatExpiryDateLabel('2026-11-28'), 'Nov 28, 2026');
  assert.equal(frontend.formatExpiryDateLabel('2028-02-29'), 'Feb 29, 2028');
  assert.equal(frontend.formatExpiryDateLabel('2027-02-29'), '2027-02-29', 'invalid historical strings are not silently changed');
});

test('tracked products require a future expiry date only when initial stock is positive', () => {
  const now = new Date('2026-10-15T16:00:00.000Z'); // Already October 16 in Manila.
  const input = (expiryDate, stock = 5) => ({
    body: { expiryTrackingEnabled: true, clientRequestId: 'date-check', initialStockBatch: { expiryDate } },
    stock, sellingUnit: 'pcs', now,
  });
  for (const date of ['2026-10-15', '2026-10-16']) {
    assert.throws(() => buildInitialExpiry(input(date)), /Expiry date must be later than today\./);
  }
  assert.equal(buildInitialExpiry(input('2026-10-17')).initialStockBatch.expiryDate, '2026-10-17');
  const zeroStockWithoutBatch = buildInitialExpiry(input(undefined, 0));
  assert.equal(zeroStockWithoutBatch.expiryTrackingEnabled, true);
  assert.equal(zeroStockWithoutBatch.initialStockBatch, null);
});

test('expiry is optional unless enabled; zero-stock SKUs do not create an opening batch snapshot', () => {
  assert.deepEqual(buildInitialExpiry({ body: {}, stock: 5, sellingUnit: 'pcs' }), {
    expiryTrackingEnabled: false, initialStockBatch: null,
  });
  const zeroStock = buildInitialExpiry({ body: { expiryTrackingEnabled: true, clientRequestId: 'zero' }, stock: 0 });
  assert.equal(zeroStock.expiryTrackingEnabled, true);
  assert.equal(zeroStock.initialStockBatch, null);
  const legacy = new Product({ name: 'Legacy', sku: 'LEGACY', stock: 47, price: 1, sellingUnit: 'pack' });
  assert.equal(legacy.expiryTrackingEnabled, false);
  assert.equal(legacy.initialStockBatch, null);
  assert.equal(legacy.stock, 47);
});

const filename = path.resolve(__dirname, '../../src/components/ProductExpiryFields.jsx');
const componentModule = new Module(filename, module);
componentModule.filename = filename;
componentModule.paths = module.paths;
componentModule._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code, filename);
const ProductExpiryFields = componentModule.exports.default;
const toggleHelperFilename = path.resolve(__dirname, '../../src/utils/expiryTrackingToggle.js');
const toggleHelperModule = new Module(toggleHelperFilename, module);
toggleHelperModule.filename = toggleHelperFilename;
toggleHelperModule.paths = module.paths;
toggleHelperModule._compile(transformSync(fs.readFileSync(toggleHelperFilename, 'utf8'), { loader: 'js', format: 'cjs' }).code, toggleHelperFilename);
const { shouldConfirmExpiryTrackingDisable } = toggleHelperModule.exports;
const batchEditorFilename = path.resolve(__dirname, '../../src/components/ExpiryBatchVerification.jsx');
const batchEditorModule = new Module(batchEditorFilename, module);
batchEditorModule.filename = batchEditorFilename;
batchEditorModule.paths = module.paths;
batchEditorModule.require = (name) => name === '../utils/expiryBatchVerification'
  ? { isExpiryBatchVerificationConfirmed: () => false }
  : module.require(name);
batchEditorModule._compile(transformSync(fs.readFileSync(batchEditorFilename, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code, batchEditorFilename);
const ExpiryBatchPickEditor = batchEditorModule.exports.ExpiryBatchPickEditor;
const baseValue = { stock: '12', expiryTrackingEnabled: false, initialExpiryDate: '', initialBatchLotNumber: '' };
const render = (value, minimumExpiryDate = '2026-10-17', mode = 'add') => renderToStaticMarkup(React.createElement(ProductExpiryFields, { value, onChange: () => {}, minimumExpiryDate, mode }));

test('physical batch picker displays short references and keeps manufacturer lot separate', () => {
  const allocation = {
    batch: '507f1f77bcf86cd799439011', batchId: 'EB-LONG-INTERNAL-ID', batchReference: 'BT-20261028-001',
    lotNumber: 'LOT-MAKER-42', expiryDate: '2027-01-31', quantity: 2,
  };
  const markup = renderToStaticMarkup(React.createElement(ExpiryBatchPickEditor, {
    item: {
      productId: 'product-1', name: 'Tracked Product', sku: 'TRK-001', quantity: 2, unit: 'pcs',
      reconciled: true, proposedAllocations: [allocation],
      batchOptions: [{ ...allocation, availableQuantity: 3 }],
    },
    record: { allocations: [allocation] },
    onChange: () => {},
  }));
  assert.match(markup, /BT-20261028-001/);
  assert.match(markup, /Manufacturer Lot: LOT-MAKER-42/);
  assert.doesNotMatch(markup, /EB-LONG-INTERNAL-ID/);
});

test('expiry fields start disabled and tracked initial stock fields appear only for positive stock', () => {
  const disabled = render(baseValue);
  assert.match(disabled, /This product has expiry tracking/);
  assert.doesNotMatch(disabled, /checked|type="date"|Batch \/ Lot No\.|Expiry dates will be recorded when you add stock\./);
  const zero = render({ ...baseValue, stock: '0', expiryTrackingEnabled: true });
  assert.match(zero, /checked/);
  assert.doesNotMatch(zero, /Initial Stock Expiry Date|type="date"|Batch \/ Lot No\./);
  const positive = render({ ...baseValue, expiryTrackingEnabled: true });
  assert.match(positive, /Initial Stock Expiry Date/);
  assert.match(positive, /type="date"[^>]*required=""/);
  assert.match(positive, /min="2026-10-17"/);
  assert.match(positive, /Batch \/ Lot No\./);
  assert.match(positive, /placeholder="e\.g\. LOT-2026-001"/);
  assert.match(positive, /Optional\. A batch reference is generated when stock is recorded\./);
  assert.match(positive, /Optional/);
  assert.doesNotMatch(positive, /Expiry dates will be recorded when you add stock\./);
});

test('manual past or today values show the clear inline error; tomorrow does not', () => {
  for (const date of ['2026-10-15', '2026-10-16']) {
    const html = render({ ...baseValue, expiryTrackingEnabled: true, initialExpiryDate: date });
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /Expiry date must be later than today\./);
  }
  const tomorrow = render({ ...baseValue, expiryTrackingEnabled: true, initialExpiryDate: '2026-10-17' });
  assert.match(tomorrow, /aria-invalid="false"/);
  assert.doesNotMatch(tomorrow, /Expiry date must be later than today\./);
});

test('existing expiry tracking can be requested for disable only through its confirmation', () => {
  assert.equal(shouldConfirmExpiryTrackingDisable({ mode: 'edit', wasAlreadyTracked: true, enabled: true, requestedEnabled: false }), true);
  assert.equal(shouldConfirmExpiryTrackingDisable({ mode: 'edit', wasAlreadyTracked: true, enabled: true, requestedEnabled: true }), false);
  assert.equal(shouldConfirmExpiryTrackingDisable({ mode: 'edit', wasAlreadyTracked: false, enabled: true, requestedEnabled: false }), false);
  assert.equal(shouldConfirmExpiryTrackingDisable({ mode: 'add', wasAlreadyTracked: false, enabled: true, requestedEnabled: false }), false);

  const edit = render({ ...baseValue, stock: '12', expiryTrackingEnabled: true, originalExpiryTrackingEnabled: true }, '2026-10-17', 'edit');
  assert.match(edit, /This product has expiry tracking/);
  assert.doesNotMatch(edit, /disabled=""/);
  assert.doesNotMatch(edit, /Turn off Expiry Tracking\?/);
  const componentSource = fs.readFileSync(filename, 'utf8');
  assert.match(componentSource, /Turn off Expiry Tracking\?/);
  assert.match(componentSource, /Expiry dates will no longer be required for new stock\./);
  assert.match(componentSource, /A future Sale Void restores product stock only; verify batches before tracking resumes\./);
});

test('product API preserves initial expiry on creation and does not rewrite it on ordinary edits', async () => {
  const apiFilename = path.resolve(__dirname, '../../src/services/inventoryApi.js');
  const apiModule = new Module(apiFilename, module);
  apiModule.filename = apiFilename;
  apiModule.paths = module.paths;
  let request;
  apiModule.require = (name) => {
    if (name === './apiClient') return { apiRequest: async (_url, options) => {
      request = JSON.parse(options.body);
      return { _id: 'sku-1', ...request };
    } };
    if (name === '../utils/recommendationLogic') return { getStockStatus: () => 'In Stock' };
    throw new Error(`Unexpected import ${name}`);
  };
  apiModule._compile(transformSync(fs.readFileSync(apiFilename, 'utf8'), { loader: 'js', format: 'cjs' }).code, apiFilename);
  const { createProductApi, updateProductApi, updateProductStockApi, mapApiProductToUi } = apiModule.exports;
  const product = { name: 'Tracked SKU', code: 'EXP-001', stock: 31, sellingUnit: 'pack', price: 50, clientRequestId: 'create:1', expiryTrackingEnabled: true, initialStockBatch: { expiryDate: '2028-04-30', lotNumber: 'B-31' } };
  const created = await createProductApi(product);
  assert.equal(request.stock, 31);
  assert.equal(request.sellingUnit, 'pack');
  assert.equal(request.clientRequestId, 'create:1');
  assert.deepEqual(request.initialStockBatch, product.initialStockBatch);
  assert.equal(created.expiryTrackingEnabled, true);
  await createProductApi({ ...product, stock: 0 });
  assert.equal(request.expiryTrackingEnabled, true);
  assert.deepEqual(request.initialStockBatch, product.initialStockBatch);
  await createProductApi({ ...product, expiryTrackingEnabled: false });
  assert.equal(request.initialStockBatch, undefined);
  await updateProductApi('sku-1', product);
  assert.equal(request.initialStockBatch, undefined);
  assert.equal(request.expiryTrackingEnabled, true);
  await updateProductApi('sku-1', { ...product, expiryTrackingEnabled: false });
  assert.equal(request.expiryTrackingEnabled, false);
  await updateProductApi('sku-1', { ...product, expiryTrackingEnabled: false }, {
    expiryTrackingDisableReason: 'Expiry tracking was enabled on the wrong SKU.',
  });
  assert.equal(request.expiryTrackingDisableReason, 'Expiry tracking was enabled on the wrong SKU.');
  const { expiryTrackingEnabled: _expiryTrackingEnabled, ...ordinaryEdit } = product;
  await updateProductApi('sku-1', ordinaryEdit);
  assert.equal(request.expiryTrackingEnabled, undefined);
  assert.equal(mapApiProductToUi({ stock: 12 }).expiryTrackingEnabled, false);
  await updateProductStockApi('sku-1', 15, {
    expectedStock: 12, expectedUpdatedAt: '2026-10-29T00:00:00.000Z', adjustmentType: 'IN',
    adjustmentQuantity: 3, adjustmentReason: 'Delivery', adjustmentRequestId: 'stock:enable',
    expiryBatch: { expiryDate: '2026-10-29', lotNumber: 'LOT-1' }, enableExpiryTracking: true,
  });
  assert.deepEqual(request.expiryBatch, { expiryDate: '2026-10-29', lotNumber: 'LOT-1', enableTracking: true });
  const batchAllocations = [{
    batch: '507f1f77bcf86cd799439011', batchId: 'EB-STOCK-OUT', expiryDate: '2026-10-29',
    updatedAt: '2026-10-29T10:00:00.000Z', quantity: 2,
  }];
  await updateProductStockApi('sku-1', 10, {
    expectedStock: 12, expectedUpdatedAt: '2026-10-29T00:00:00.000Z', adjustmentType: 'OUT',
    adjustmentQuantity: 2, adjustmentReason: 'Expired', adjustmentRequestId: 'stock:remove', batchAllocations,
  });
  assert.deepEqual(request.batchAllocations, batchAllocations);
});

test('edit expiry fields show verification guidance without initial batch inputs', () => {
  const value = {
    stock: 20, reservedStock: 2, expiryTrackingEnabled: true,
    originalExpiryTrackingEnabled: false, expiryBatchReconciled: false,
  };
  const html = render(value, undefined, 'edit');
  assert.match(html, /checked/);
  assert.match(html, /Existing stock will not be assigned to batches automatically/);
  assert.doesNotMatch(html, /Initial Stock Expiry Date|Batch \/ Lot No\.|type="date"/);

  assert.equal(shouldConfirmExpiryTrackingDisable({
    mode: 'edit', wasAlreadyTracked: value.originalExpiryTrackingEnabled,
    enabled: true, requestedEnabled: false,
  }), false, 'newly enabling existing stock does not require the disable confirmation');

  const tracked = render({ ...value, expiryTrackingEnabled: true, originalExpiryTrackingEnabled: true, expiryBatchReconciled: true }, undefined, 'edit');
  assert.match(tracked, /Current stock and batch records are preserved/);
  assert.doesNotMatch(tracked, /disabled=""/);
  assert.doesNotMatch(tracked, /Turn off Expiry Tracking\?/);
  assert.doesNotMatch(tracked, /Initial Stock Expiry Date|type="date"/);

  const expiryFieldsSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ProductExpiryFields.jsx'), 'utf8');
  assert.match(expiryFieldsSource, /future Sale Void restores product stock only/i);
  assert.match(expiryFieldsSource, /Reason for correction/);
  assert.match(expiryFieldsSource, /expiryTrackingDisableReason/);

  const expiryMonitoring = fs.readFileSync(path.resolve(__dirname, '../../src/components/ExpiryMonitoring.jsx'), 'utf8');
  assert.match(expiryMonitoring, /confirmed \? 'Verified' : historical \? 'Closed Period' : 'Not Yet Verified'/);
  assert.match(expiryMonitoring, />Batch Verification Needed</);
  assert.match(expiryMonitoring, /busy \? 'Loading[\s\S]*?: 'Verify Batches'/);
  assert.doesNotMatch(expiryMonitoring, />Unverified</);

  const dashboardSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Dashboard.jsx'), 'utf8');
  assert.match(dashboardSource, /Reconciled Expiry Batches\/gi, 'Verified Expiry Batches'/);
  assert.match(dashboardSource, /existing stock requires batch reconciliation\/gi, 'existing stock needs batch verification'/);

  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');
  assert.match(source, /<ProductExpiryFields[\s\S]*?mode=\{modalMode\}/);
  assert.match(source, /const handleOpenVariantEdit = \(product, family\) => \{[\s\S]*?handleOpenEdit\(product\);/);
});
