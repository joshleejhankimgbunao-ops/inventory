/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');

const loadHelper = () => import('../../src/utils/productDetailsSpecifications.js');

const category = {
  name: 'Paint',
  attributeSchemaVersion: 1,
  productAttributes: [
    { name: 'Color', key: 'color', type: 'text', order: 0 },
    { name: 'Brand', key: 'brand', type: 'text', order: 1 },
    { name: 'Volume', key: 'volume', type: 'number_unit', unit: 'L', order: 2 },
    { name: 'Finish', key: 'finish', type: 'text', order: 3 },
    { name: 'Type', key: 'type', type: 'text', order: 4 },
  ],
};

test('product details return configured recorded attributes as separate label/value pairs', async () => {
  const { getProductDetailsSpecifications } = await loadHelper();
  const specifications = getProductDetailsSpecifications({
    category: 'Paint',
    attributes: {
      color: 'Black',
      brand: 'Boysen',
      volume: 2,
      finish: 'Gloss',
      type: 'Interior Latex Paint',
    },
  }, [category]);

  assert.deepEqual(specifications, [
    { name: 'Color', value: 'Black' },
    { name: 'Brand', value: 'Boysen' },
    { name: 'Volume', value: '2 L' },
    { name: 'Finish', value: 'Gloss' },
    { name: 'Type', value: 'Interior Latex Paint' },
  ]);
});

test('missing and whitespace-only attributes are omitted while recorded zero values remain visible', async () => {
  const { getProductDetailsSpecifications } = await loadHelper();
  const specifications = getProductDetailsSpecifications({
    category: 'Paint',
    attributes: { color: '  ', brand: null, volume: 0, finish: '', type: undefined },
  }, [category]);

  assert.deepEqual(specifications, [{ name: 'Volume', value: '0 L' }]);
});

test('long recorded specification values are preserved without truncation', async () => {
  const { getProductDetailsSpecifications } = await loadHelper();
  const longType = 'Interior and Exterior Low-Odor Premium Acrylic Latex Paint';
  const specifications = getProductDetailsSpecifications({
    category: 'Paint',
    attributes: { type: longType },
  }, [category]);

  assert.deepEqual(specifications, [{ name: 'Type', value: longType }]);
});

test('grouped products aggregate distinct recorded values without synthetic group labels', async () => {
  const { getProductDetailsSpecifications } = await loadHelper();
  const specifications = getProductDetailsSpecifications({
    isGroup: true,
    category: 'Paint',
    attributeDefinitions: category.productAttributes,
    variants: [
      { attributes: { color: 'Black', brand: 'Boysen', volume: 2, finish: 'Gloss', type: '' } },
      { attributes: { color: 'White', brand: 'Boysen', volume: 4, finish: 'Matte', type: 'Interior Latex' } },
    ],
  }, [category]);

  assert.deepEqual(specifications, [
    { name: 'Color', value: 'Black, White' },
    { name: 'Brand', value: 'Boysen' },
    { name: 'Volume', value: '2 L, 4 L' },
    { name: 'Finish', value: 'Gloss, Matte' },
    { name: 'Type', value: 'Interior Latex' },
  ]);
  assert.doesNotMatch(JSON.stringify(specifications), /Multiple Brands|Not specified/);
});

test('products with few available attributes produce only their recorded fields', async () => {
  const { getProductDetailsSpecifications } = await loadHelper();
  const specifications = getProductDetailsSpecifications({
    category: 'Paint',
    attributes: { color: 'Blue' },
  }, [category]);

  assert.deepEqual(specifications, [{ name: 'Color', value: 'Blue' }]);
});
