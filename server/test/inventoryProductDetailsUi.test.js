/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');
const shell = read('src/components/ProductDetailsModalShell.jsx');
const inventoryDetails = read('src/components/InventoryProductDetails.jsx');
const inventory = read('src/pages/Inventory.jsx');
const monitoring = read('src/components/ExpiryMonitoring.jsx');
const pos = read('src/pages/PointOfSale.jsx');
const inventoryApi = read('src/services/inventoryApi.js');

test('Inventory and POS share the exact compact Product Details modal frame', () => {
  assert.match(shell, /widthClassName = 'max-w-md'/);
  assert.match(shell, /w-full \$\{widthClassName\} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl/);
  assert.match(shell, /border-b border-slate-100 px-4 py-3/);
  assert.match(shell, /h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white/);
  assert.match(shell, /max-h-\[calc\(100vh-4rem\)\] min-h-0 overflow-y-auto p-3/);
  assert.match(pos, /<ProductDetailsModalShell[\s\S]*aria-labelledby="pos-product-details-title"/);
  assert.match(inventory, /<ProductDetailsModalShell[\s\S]*aria-labelledby="inventory-product-details-title"/);
  assert.match(inventory, /widthClassName="max-w-xl"/);
});

test('Inventory details resolve by Product ID and include dynamic specifications and unit-aware stock/price', () => {
  assert.match(inventory, /inventory\.find\(\(item\) => String\(item\.id \|\| ''\) === id\)/);
  assert.match(inventory, /products\.find\(\(item\) => String\(item\.id \|\| ''\) === id\)/);
  assert.match(inventoryApi, /id: product\._id/);
  assert.match(inventoryApi, /attributes: product\.attributes \|\| \{\}/);
  assert.match(inventoryDetails, /getProductDetailsSpecifications\(product, categories\)/);
  assert.match(inventoryDetails, /Object\.entries\(attributes\)/);
  assert.match(inventoryDetails, /Price per \{sellingUnit \|\| 'unit'\}/);
  assert.match(inventoryDetails, /Current Stock/);
  assert.match(inventoryDetails, /Available to Sell/);
  assert.match(inventoryDetails, /Low Stock Threshold/);
  assert.match(inventoryDetails, /Supplier/);
});

test('Stock Availability reuses live stock status logic and renders compact state-specific badges', async () => {
  const { getStockStatus } = await import('../../src/utils/recommendationLogic.js');
  const settings = { maxStockLimit: 100, lowStockAlert: 10 };
  assert.equal(getStockStatus({ stock: 0 }, settings), 'Out of Stock');
  assert.equal(getStockStatus({ stock: 5 }, settings), 'Low Stock');
  assert.equal(getStockStatus({ stock: 50 }, settings), 'In Stock');

  assert.match(inventoryDetails, /product\.isActive === false \? 'Unavailable' : getStockStatus\(product, appSettings\)/);
  assert.match(inventoryDetails, /'In Stock': 'border-emerald-200 bg-emerald-50 text-emerald-700/);
  assert.match(inventoryDetails, /'Low Stock': 'border-amber-200 bg-amber-50 text-amber-700/);
  assert.match(inventoryDetails, /'Out of Stock': 'border-rose-200 bg-rose-50 text-rose-700/);
  assert.match(inventoryDetails, /<DetailValue label="Stock Availability"><span className=\{`inline-flex items-center rounded-full border px-2 py-0\.5 text-\[10px\] font-semibold leading-4 \$\{availabilityClass\}`\}>\{availability\}<\/span><\/DetailValue>/);
});

test('Expiry details are shown only for tracked products and never infer received or unverified balances', () => {
  assert.match(inventoryDetails, /const expiryTracking = product\.expiryTrackingEnabled === true/);
  assert.match(inventoryDetails, /const overallBatchVerification = expiryData\?\.reconciled === true/);
  assert.match(inventoryDetails, /balanceConfirmed && hasValue\(remaining\)/);
  assert.match(inventory, /listProductExpiryBatchesApi\(productDetailsId\)/);
  assert.match(inventoryDetails, /historicalSelectedBatch/);
  assert.match(inventoryDetails, /historicalRemainingQuantity/);
  assert.match(inventoryDetails, /Existing stock to verify/);
});

test('Expiry batches render in a readable four-column table with one overall verification status', () => {
  assert.match(inventoryDetails, /Batch Reference \/ Lot No\./);
  assert.match(inventoryDetails, /Expiry Date/);
  assert.match(inventoryDetails, /Remaining Stock/);
  assert.match(inventoryDetails, /<th className="px-2\.5 py-2 font-semibold">Status<\/th>/);
  assert.match(inventoryDetails, /w-\[35%\][\s\S]*w-\[25%\][\s\S]*w-\[20%\][\s\S]*w-\[20%\]/);
  assert.match(inventoryDetails, /overflow-x-auto[\s\S]*min-w-\[520px\]/);
  assert.match(inventoryDetails, /overallBatchVerification \? <BatchStatusBadge status="Verified" \/> : <BatchStatusBadge status="Not Yet Verified" \/>/);
  assert.match(inventoryDetails, /verificationException && <BatchStatusBadge status=\{verificationException\} \/>/);
  assert.match(inventoryDetails, /truncate whitespace-nowrap font-semibold text-slate-900/);
  assert.match(inventoryDetails, /whitespace-nowrap px-2\.5 py-2 align-middle text-slate-700/);
  assert.match(inventoryDetails, /Expired:[\s\S]*'Expiring Soon':[\s\S]*Valid:[\s\S]*Historical:/);
  assert.match(inventoryDetails, /'Not Yet Verified'/);
  assert.match(inventoryDetails, /getManilaBusinessDate/);
});

test('per-batch verification appears only when it differs from the overall state', async () => {
  const { getBatchVerificationException } = await import('../../src/utils/productExpiryPresentation.js');
  assert.equal(getBatchVerificationException({ balanceConfirmed: true }, true), null);
  assert.equal(getBatchVerificationException({ balanceConfirmed: false }, false), null);
  assert.equal(getBatchVerificationException({ balanceConfirmed: false }, true), 'Not Yet Verified');
  assert.equal(getBatchVerificationException({ balanceConfirmed: true }, false), 'Verified');
  assert.equal(getBatchVerificationException({}, true), null);
  assert.match(inventoryDetails, /getBatchVerificationException\(batch, overallBatchVerification\)/);
});

test('Stock Operations and Expiry Monitoring rows open details while nested actions remain isolated', () => {
  assert.match(inventory, /handleInventoryRowClick = \(event, item\) => \{\s*if \(event\.target\?\.closest\?\.\('button, a, input, select, textarea, \[data-row-action\]'\)\) return;/);
  assert.match(inventory, /openProductDetails\(item\.id, null, event\)/);
  assert.match(monitoring, /onProductDetails\(batch\.productId, batch, event\)/);
  assert.match(monitoring, /event\.stopPropagation\(\);\s*onCorrectExpiryDate\?\.\(batch\)/);
  assert.match(inventory, /onProductDetails=\{openProductDetails\}/);
  assert.match(monitoring, /data-product-details-trigger/);
});
