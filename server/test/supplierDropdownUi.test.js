/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSource = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

test('all Product Master product forms reuse the viewport-aware Supplier selector', () => {
  const productListSource = readSource('../../src/pages/ProductList.jsx');

  assert.match(productListSource, /import SupplierSelector from '\.\.\/components\/SupplierSelector'/);
  assert.match(productListSource, /<SupplierSelector/);
  assert.match(productListSource, /variantFamilyKey \? \(modalMode === 'add' \? 'Add Variant' : 'Edit Variant'\)/);
  assert.doesNotMatch(productListSource, /max-h-36 overflow-y-auto/);
});

test('Supplier selector portals its scrollable list and selects placement from viewport space', () => {
  const source = readSource('../../src/components/SupplierSelector.jsx');

  assert.match(source, /createPortal/);
  assert.match(source, /spaceBelow < MINIMUM_USEFUL_SPACE && spaceAbove > spaceBelow/);
  assert.match(source, /window\.addEventListener\('scroll', updatePosition, true\)/);
  assert.match(source, /window\.addEventListener\('resize', updatePosition\)/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /overflow-y-auto overscroll-contain/);
  assert.match(source, /maxHeight: position\.maxHeight/);
});

test('Supplier selector preserves controlled search, keyboard navigation, and exact selection', () => {
  const source = readSource('../../src/components/SupplierSelector.jsx');

  assert.match(source, /value=\{query\}/);
  assert.match(source, /onQueryChange\(event\.target\.value\)/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /event\.key === 'ArrowUp'/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /onSelect\(option\)/);
});
