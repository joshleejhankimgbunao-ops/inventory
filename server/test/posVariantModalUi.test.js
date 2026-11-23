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
  assert.match(modalSource, /getPosAttributeSelectionModel\(/);
  assert.match(modalSource, /selectionModel.groups.map\(\(group\)/);
  assert.match(modalSource, /group.options.map\(\(option\)/);
  assert.match(modalSource, /disabled=\{!option.exists\}/);
  assert.match(modalSource, /selectionModel.codeOptions.map\(\(variant\)/);
  assert.match(modalSource, /aria-pressed=\{isSelected\}/);
  assert.match(modalSource, /Item Code: \$\{variantModalSelectedVariant.code\}/);
  assert.doesNotMatch(modalSource, />Select SKU</);
  assert.match(modalSource, /remainingAddable/);
  assert.match(modalSource, /addToCart\(matchedVariant, true, \{[\s\S]*?quantity: selectedQuantity,[\s\S]*?fromVariantModal: true,[\s\S]*?\}\)/);
  assert.match(modalSource, /variantAddInProgressRef\.current = true/);
  assert.match(modalSource, /expectedQuantity: Number\(existingItem\?\.qty \|\| 0\) \+ selectedQuantity/);
  assert.match(modalSource, /openAvailableRecommendations\(matchedVariant, selectedRecommendationAvailability, \{ requestedQuantity: selectedQuantity \}\)/);
});

test('successful variation adds preserve the selector and reset quantity only after cart confirmation', () => {
  const addActionStart = modalSource.indexOf('if (canAddSelectedVariant && matchedVariant) {');
  const addActionEnd = modalSource.indexOf('if (canOpenAlternatives && matchedVariant)', addActionStart);
  const addAction = modalSource.slice(addActionStart, addActionEnd);

  assert.ok(addActionStart >= 0);
  assert.ok(addActionEnd > addActionStart);
  assert.doesNotMatch(addAction, /setVariantModal\(createClosedVariantModalState\)/);
  assert.match(addAction, /if \(!added\)[\s\S]*?setIsVariantAddProcessing\(false\)/);
  assert.match(source, /setVariantModal\(\(previous\) => previous\.isOpen \? \{ \.\.\.previous, quantity: 1 \} : previous\)/);
  assert.match(source, /Number\(addedItem\?\.qty \|\| 0\) !== pendingAdd\.expectedQuantity/);
  assert.match(source, /currentQtyInCart \+ requestedQty > product\.stock/);
  assert.match(source, /Only \$\{product\.stock\} units available!/);
  assert.match(source, /showToast\("Item Added", "Item added to cart\."/);
  assert.match(modalSource, /disabled=\{isPrimaryDisabled \|\| isVariantAddProcessing\}/);
});

test('variant details open only for the exact matched SKU and return to the preserved selector', () => {
  assert.match(modalSource, /disabled=\{!matchedVariant\}/);
  assert.match(modalSource, /if \(!matchedVariant\) return;[\s\S]*?setProductDetailsItem\(matchedVariant\)/);
  assert.match(modalSource, /returnFocusToProductDetailsTriggerRef\.current = true/);
  assert.match(modalSource, /!productDetailsItem/);
  assert.match(source, /setProductDetailsItem\(matchedVariant\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => productDetailsTriggerRef\.current\?\.focus\(\)\)/);
  assert.match(source, /if \(event\.key === 'Escape'\)[\s\S]*?setProductDetailsItem\(null\)/);
});

test('reused POS Product Details displays the selected variant identity and configured specifications', () => {
  assert.match(source, /aria-labelledby="pos-product-details-title"/);
  assert.match(source, /getProductDetailsSpecifications\(productDetailsItem, categoryDefinitions\)/);
  assert.match(source, /productDetailsSpecifications\.map\(\(\{ name, value \}\)/);
  assert.match(source, /grid-cols-1 gap-x-5 gap-y-3 text-xs min-\[380px\]:grid-cols-2/);
  assert.match(source, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(source, /productDetailsSpecifications\.map\(\(\{ name, value \}\) => `\$\{name\}: \$\{value\}`\)\.join/);
  assert.doesNotMatch(source, />Product Type</);
  assert.match(source, /productDetailsItem\.code/);
  assert.match(source, /productDetailsItem\.price/);
  assert.match(source, /productDetailsItem\.stock/);
  assert.match(source, /getSellingUnit\(productDetailsItem\)/);
});
