/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const productListSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/ProductList.jsx'),
  'utf8',
);
const inventoryApiSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/services/inventoryApi.js'),
  'utf8',
);
const familyModalSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/ProductFamilyModal.jsx'),
  'utf8',
);

test('products without a supplier no longer receive the fabricated Local Supplier value', () => {
  assert.match(inventoryApiSource, /supplier: product\.supplierName \|\| product\.supplier \|\| ''/);
  assert.match(inventoryApiSource, /supplierName: product\.supplier \|\| ''/);
  assert.doesNotMatch(inventoryApiSource, /Local Supplier/);
  assert.match(productListSource, /supplier: product\.supplier \|\| ''/);
  assert.match(familyModalSource, /No supplier assigned/);
});

test('only active Supplier Partners remain selectable while archived records can be identified', () => {
  assert.match(productListSource, /listPartnersApi\(\{ type: 'supplier', includeArchived: true \}\)/);
  assert.match(productListSource, /\.filter\(\(row\) => row\?\.isArchived !== true\)/);
  assert.match(productListSource, /Existing supplier is archived and cannot be selected for a new assignment\./);
});

test('an unchanged legacy supplier survives unrelated edits but invalid new assignments remain rejected', () => {
  assert.match(productListSource, /const isUnchangedLegacySupplier = modalMode === 'edit'/);
  assert.match(productListSource, /normalizedSupplier\.toLowerCase\(\) === existingSupplier\.toLowerCase\(\)/);
  assert.match(productListSource, /normalizedSupplier && !supplierExists && !isUnchangedLegacySupplier/);
  assert.match(productListSource, /Supplier must be selected from Supplier Partners\./);
  assert.match(productListSource, /supplier: normalizedSupplier/);
  assert.doesNotMatch(productListSource, /normalizedSupplier \|\| 'Local Supplier'/);
});

test('supplier search text remains separate from the selected saved supplier', () => {
  assert.match(productListSource, /query=\{supplierSearchQuery\}/);
  assert.match(productListSource, /onQueryChange=\{setSupplierSearchQuery\}/);
  assert.match(productListSource, /setFormData\(\(previous\) => \(\{ \.\.\.previous, supplier \}\)\);\s*setSupplierSearchQuery\(supplier\)/);
  assert.match(productListSource, /Legacy supplier value\. Select a registered Supplier Partner to replace it\./);
});
