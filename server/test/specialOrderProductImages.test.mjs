import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryProductPhotosForSelection, isProductImageReference, productImageEntries, quotationPhotoSelections } from '../../src/utils/specialOrderProductImages.mjs';

test('existing Product Master image entries become removable quotation references without copying the source URL', () => {
  const selected = productImageEntries({ id: 'product-1', name: 'Paint', imageUrl: 'data:image/png;base64,AA==' });
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0], {
    source: 'product', productId: 'product-1', imageIndex: 0,
    src: 'data:image/png;base64,AA==', name: 'Paint image 1', mimeType: '',
  });
  assert.equal(isProductImageReference(selected[0]), true);
  assert.deepEqual(quotationPhotoSelections(selected), [{ type: 'product', imageIndex: 0 }]);
});

test('multiple saved product images preserve their original indexes and selection order', () => {
  const selected = productImageEntries({
    _id: 'product-2',
    images: [{ url: 'https://cdn.example.test/a.png' }, { src: 'https://cdn.example.test/b.webp', name: 'Second' }],
  });
  assert.deepEqual(selected.map(({ imageIndex, src }) => [imageIndex, src]), [
    [0, 'https://cdn.example.test/a.png'], [1, 'https://cdn.example.test/b.webp'],
  ]);
  assert.deepEqual(quotationPhotoSelections([selected[1], selected[0]]), [
    { type: 'product', imageIndex: 1 }, { type: 'product', imageIndex: 0 },
  ]);
});

test('products without an image and intentionally removed references remain empty', () => {
  const selected = productImageEntries({ id: 'product-3', imageUrl: '' });
  assert.deepEqual(selected, []);
  assert.deepEqual(quotationPhotoSelections([]), []);
});

test('switching SKUs replaces old automatic images and refreshing the same SKU updates selected refs without restoring removed images', () => {
  const firstProduct = { id: 'product-1', imageUrl: 'data:image/png;base64,AA==' };
  const secondProduct = { id: 'product-2', imageUrl: 'data:image/png;base64,BB==' };
  const firstSelection = inventoryProductPhotosForSelection([], '', firstProduct);
  const secondSelection = inventoryProductPhotosForSelection(firstSelection, 'product-1', secondProduct);
  assert.deepEqual(secondSelection.map((photo) => [photo.productId, photo.src]), [['product-2', 'data:image/png;base64,BB==']]);
  const refreshedProduct = { id: 'product-2', imageUrl: 'data:image/png;base64,CC==' };
  const refreshed = inventoryProductPhotosForSelection(secondSelection, 'product-2', refreshedProduct);
  assert.deepEqual(refreshed.map((photo) => photo.src), ['data:image/png;base64,CC==']);
  assert.deepEqual(inventoryProductPhotosForSelection([], 'product-2', refreshedProduct), [], 'previously removed image refs are not repopulated');
  assert.deepEqual(inventoryProductPhotosForSelection(refreshed, 'product-2', { id: 'product-2', imageUrl: '' }), [], 'deleted source images are removed from the selection');
});
