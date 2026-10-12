/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
const modalSource = source.slice(
  source.indexOf('{/* Variant Picker Modal */}'),
  source.indexOf('{isQuickAddCreditCustomerOpen &&')
);

test('grouped-product modal uses one compact product header with live image and SKU', () => {
  assert.match(modalSource, /ProductThumbnail item=\{variantModalImageItem\} className="h-12 w-12"/);
  assert.match(modalSource, /variantModalSelectedVariant\?\.code/);
  assert.doesNotMatch(modalSource, />Product Group</);
  assert.doesNotMatch(modalSource, />Selected Variant</);
});

test('selected summary consolidates unit-aware price, distinguishing attributes, and stock', () => {
  assert.match(modalSource, /selectedSellingUnit \? `Price per \$\{selectedSellingUnit\}` : 'Price'/);
  assert.match(modalSource, /distinctValueCount > 1/);
  assert.match(modalSource, />Available Stock</);
  assert.match(modalSource, /selectedSellingUnit \? `Quantity \(\$\{selectedSellingUnit\}\)` : 'Quantity'/);
  assert.doesNotMatch(modalSource, /Line total:/);
  assert.doesNotMatch(modalSource, />Sold By</);
  assert.doesNotMatch(modalSource, /Max \{maxSelectableQty\}/);
});

test('variant selection and purchasing actions remain available', () => {
  assert.match(modalSource, />Select Size\/Variant</);
  assert.match(modalSource, />Select Color</);
  assert.match(modalSource, />Select SKU</);
  assert.match(modalSource, /addToCart\(matchedVariant, true, \{ quantity: selectedQuantity \}\)/);
  assert.match(modalSource, /openAvailableRecommendations\(matchedVariant, selectedRecommendationAvailability\)/);
});
