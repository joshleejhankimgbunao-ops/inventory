import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getProductDisplayName, getTransactionProductDisplayName, hasStoredProductName } from '../../src/utils/productDisplayName.js';
import { groupProductsIntoFamilies } from '../../src/utils/productFamilies.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getProductDisplayName: getServerProductDisplayName } = require('../src/utils/productDisplayName.js');

test('builds a missing display name from configured identifying attributes in configured order', () => {
  const categories = [{
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Type', key: 'type', type: 'text', order: 0 },
      { name: 'Size', key: 'size_variant', type: 'number_unit', unit: 'mm', order: 1 },
      { name: 'Brand', key: 'brand', type: 'text', order: 2 },
    ],
  }];
  const product = {
    name: '',
    sku: 'ELC-004',
    category: 'Electrical',
    attributes: { type: 'Electrical Wire', size_variant: 2, brand: 'Phelps Dodge' },
  };

  assert.equal(getProductDisplayName(product, categories), 'Electrical Wire – 2 mm – Phelps Dodge');
  assert.equal(product.name, '');
});

test('omits empty attributes and removes duplicate configured, legacy, and differently structured values', () => {
  const categories = [{
    name: 'Tools',
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Type', key: 'type', type: 'text', order: 0 },
      { name: 'Brand', key: 'brand', type: 'text', order: 1 },
      { name: 'Color', key: 'color', type: 'text', order: 2 },
    ],
  }];
  const product = {
    name: ' ',
    code: 'CTL-008',
    category: 'Tools',
    brand: 'Stanley',
    attributes: [
      { name: 'Type', value: 'Utility Knife' },
      { name: 'Brand', value: 'Stanley' },
      { name: 'Color', value: '' },
      { name: 'Material', value: 'Steel' },
      { name: 'Duplicate Material', value: ' steel ' },
    ],
  };

  assert.equal(getProductDisplayName(product, categories), 'Utility Knife – Stanley – Steel');
  assert.equal(product.name, ' ');
});

test('matches legacy attribute labels to configured keys and does not duplicate unit-formatted values', () => {
  const categories = [{
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Type', key: 'product_type', type: 'text', order: 0 },
      { name: 'Size / Variant', key: 'size_variant', type: 'number_unit', unit: 'mm', order: 1 },
    ],
  }];
  const product = {
    name: '',
    sku: 'ELC-020',
    category: 'Electrical',
    size: '2mm',
    attributes: [
      { name: 'Size / Variant', value: 2 },
      { name: 'Product Type', value: 'Wire' },
    ],
  };

  assert.equal(getProductDisplayName(product, categories), 'Wire \u2013 2 mm');
});

test('does not append a configured unit when a legacy value already includes it without a space', () => {
  const categories = [{
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Size', key: 'size_variant', type: 'number_unit', unit: 'mm' }],
  }];
  assert.equal(getProductDisplayName({ name: '', category: 'Electrical', attributes: { size_variant: '2mm' } }, categories), '2mm');
});

test('uses SKU as the final fallback when no identifying attributes have a value', () => {
  assert.equal(getProductDisplayName({ name: '', sku: 'OTH-019', attributes: { type: ' ', size: null } }), 'OTH-019');
  assert.equal(getProductDisplayName({ name: ' ', sku: '  ', code: 'OTH-020' }), 'OTH-020');
  assert.equal(getProductDisplayName({ name: '' }), 'Unnamed product');
});

test('keeps an existing Product Name as the primary display label', () => {
  assert.equal(getProductDisplayName({ name: 'Davies Latex Paint - Burgundy', sku: 'PNT-001', attributes: { color: 'Burgundy' } }), 'Davies Latex Paint - Burgundy');
  assert.equal(hasStoredProductName({ name: '  ' }), false);
  assert.equal(hasStoredProductName({ name: '', itemName: 'Historical item name' }), true);
});

test('backend transaction snapshots use configured fallback labels without changing the Product name', () => {
  const category = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Type', key: 'type', type: 'text', order: 0 },
      { name: 'Size', key: 'size_variant', type: 'number_unit', unit: 'mm', order: 1 },
      { name: 'Brand', key: 'brand', type: 'text', order: 2 },
    ],
  };
  const product = { name: '', sku: 'ELC-004', attributes: { type: 'Electrical Wire', size_variant: 2, brand: 'Phelps Dodge' } };

  assert.equal(getServerProductDisplayName(product, category), 'Electrical Wire – 2 mm – Phelps Dodge');
  assert.equal(product.name, '');
  assert.equal(getServerProductDisplayName({ name: '', sku: 'OTH-019' }, category), 'OTH-019');
});

test('Product Master keeps unrelated blank-name products identifiable instead of grouping all blanks together', () => {
  const categories = [{
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Type', key: 'type', type: 'text', order: 0 },
      { name: 'Size', key: 'size_variant', type: 'text', order: 1 },
    ],
  }];
  const families = groupProductsIntoFamilies([
    { name: '', sku: 'ELC-021', category: 'Electrical', attributes: { type: 'Wire', size_variant: '2 mm' } },
    { name: '', sku: 'ELC-022', category: 'Electrical', attributes: { type: 'Wire', size_variant: '4 mm' } },
  ], categories);

  assert.equal(families.length, 2);
  assert.deepEqual(families.map((family) => family.name), ['Wire \u2013 2 mm', 'Wire \u2013 4 mm']);
  assert.ok(families.every((family) => family.storedName === ''));
});

test('Product Master does not merge separate blank-name SKUs even when their attributes match', () => {
  const categories = [{ name: 'Tools', attributeSchemaVersion: 1, productAttributes: [{ name: 'Type', key: 'type', type: 'text' }] }];
  const families = groupProductsIntoFamilies([
    { name: '', sku: 'TLS-101', category: 'Tools', attributes: { type: 'Utility Knife' } },
    { name: '', sku: 'TLS-102', category: 'Tools', attributes: { type: 'Utility Knife' } },
  ], categories);
  assert.equal(families.length, 2);
  assert.deepEqual(families.map((family) => family.variants[0].sku), ['TLS-101', 'TLS-102']);
});

test('transaction display preserves recorded names and falls back to the linked product only when its snapshot is blank', () => {
  const categories = [{ name: 'Electrical', attributeSchemaVersion: 1, productAttributes: [{ name: 'Type', key: 'type', type: 'text' }] }];
  const inventory = [{ id: 'product-1', sku: 'ELC-001', name: '', category: 'Electrical', attributes: { type: 'Wire' } }];
  assert.equal(getTransactionProductDisplayName({ name: 'Historical wire label', product: 'product-1', code: 'ELC-001' }, inventory, categories), 'Historical wire label');
  assert.equal(getTransactionProductDisplayName({ name: '', product: 'product-1', code: 'ELC-001' }, inventory, categories), 'Wire');
});

test('Product Master, Inventory, POS, quotations, history, and reports use the shared display helper', async () => {
  const paths = [
    'src/pages/ProductList.jsx',
    'src/pages/Inventory.jsx',
    'src/components/ExpiryMonitoring.jsx',
    'src/components/InventoryProductDetails.jsx',
    'src/pages/PointOfSale.jsx',
    'src/components/SpecialOrderPhaseOneFields.jsx',
    'src/utils/specialOrderPhaseOne.js',
    'src/pages/History.jsx',
    'src/pages/Reports.jsx',
    'src/pages/DashboardHome.jsx',
    'src/pages/CreditTransactions.jsx',
    'src/components/ReceiptPreviewModal.jsx',
    'src/components/SpecialOrderTransactionDetailsModal.jsx',
  ];
  const sources = await Promise.all(paths.map((path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')));
  const helperByPath = new Map(paths.map((path, index) => [path, sources[index]]));
  assert.ok(helperByPath.get('src/pages/History.jsx').includes('getTransactionProductDisplayName'));
  for (const path of ['src/pages/Reports.jsx', 'src/pages/CreditTransactions.jsx', 'src/components/ReceiptPreviewModal.jsx', 'src/components/SpecialOrderTransactionDetailsModal.jsx']) {
    assert.ok(helperByPath.get(path).includes('getTransactionProductDisplayName'), `${path} should retain recorded names and use linked-product fallback when a snapshot is blank`);
  }
  for (const path of paths.filter((entry) => !['src/pages/History.jsx', 'src/pages/Reports.jsx', 'src/pages/CreditTransactions.jsx', 'src/components/ReceiptPreviewModal.jsx', 'src/components/SpecialOrderTransactionDetailsModal.jsx'].includes(entry))) {
    assert.ok(helperByPath.get(path).includes('getProductDisplayName'), `${path} should use the shared product display helper`);
  }
  const saleController = await readFile(new URL('../src/controllers/saleController.js', import.meta.url), 'utf8');
  const specialOrderController = await readFile(new URL('../src/controllers/specialOrderController.js', import.meta.url), 'utf8');
  assert.match(saleController, /name:\s*displayName/);
  assert.match(specialOrderController, /itemName:\s*displayName/);
});

test('Product Master keeps Product Name visible and optional in the form', async () => {
  const source = await readFile(new URL('../../src/pages/ProductList.jsx', import.meta.url), 'utf8');
  const labelIndex = source.indexOf('>Product Name</label>');
  const inputIndex = source.indexOf('placeholder="Enter product name (optional)"', labelIndex);
  assert.notEqual(labelIndex, -1);
  assert.notEqual(inputIndex, -1);
  const productNameField = source.slice(labelIndex, source.indexOf('<ProductAttributeFields', inputIndex));
  assert.doesNotMatch(productNameField, /Product Name[^\n]*\*/);
  assert.doesNotMatch(productNameField, /\brequired\b/);
  assert.match(productNameField, /Enter product name \(optional\)/);
});
