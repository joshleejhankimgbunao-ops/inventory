/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');

const details = import('../../src/utils/productDetailDisplay.js');

test('product details retain populated fields and reflow around missing values', async () => {
  const { getRecordedProductDetails } = await details;
  const attributes = [{ key: 'material', name: 'Material' }, { key: 'volume', name: 'Volume', type: 'number_unit', unit: 'L' }];
  const full = getRecordedProductDetails({ category: 'Paint', brand: 'Acme', stock: 5, price: 40, size: '1L', color: 'Blue', reorderPoint: 2, supplier: 'Supply Co.' }, attributes, { material: 'Latex', volume: 1 });
  assert.deepEqual(full.map(({ label }) => label), ['Category', 'Brand', 'Stock', 'Price', 'Size', 'Color', 'Reorder Point', 'Supplier', 'Material', 'Volume']);
  assert.equal(full.at(-1).unit, 'L');

  const sparse = getRecordedProductDetails({ category: 'Paint', brand: ' N/A ', stock: 0, price: 0, size: '—', color: '  ', reorderPoint: 0, supplier: 'Not specified' }, attributes, { material: 'N/A', volume: 0 });
  assert.deepEqual(sparse.map(({ label }) => label), ['Category', 'Stock', 'Price', 'Reorder Point', 'Volume']);
  assert.deepEqual(sparse.filter(({ value }) => value === 0).map(({ label }) => label), ['Stock', 'Price', 'Reorder Point', 'Volume']);

  assert.deepEqual(getRecordedProductDetails({ stock: 0, price: 0, category: null, supplier: undefined }), [
    { key: 'Stock', label: 'Stock', value: 0 }, { key: 'Price', label: 'Price', value: 0 },
  ]);
});

test('placeholder filtering matches only entire field values', async () => {
  const { hasRecordedDetail } = await details;
  for (const value of [null, undefined, '', '  ', 'N/A', ' n/a ', 'Not specified', '—', Number.NaN]) assert.equal(hasRecordedDetail(value), false);
  for (const value of [0, false, 'N/A Paint', 'Not specified finish', '— series', '0']) assert.equal(hasRecordedDetail(value), true);
});

test('stock display uses the saved selling unit and preserves zero without a default', async () => {
  const { formatStockWithSellingUnit } = await details;
  assert.equal(formatStockWithSellingUnit(47, 'piece'), '47 piece');
  assert.equal(formatStockWithSellingUnit(47, ' pack '), '47 pack');
  assert.equal(formatStockWithSellingUnit(0, 'can'), '0 can');
  assert.equal(formatStockWithSellingUnit(0, ''), '0');
  assert.equal(formatStockWithSellingUnit(47, 'N/A'), '47');
  assert.equal(formatStockWithSellingUnit(null, 'piece'), '');
});
