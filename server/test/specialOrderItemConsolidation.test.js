const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../src/utils/quotationItemConsolidation.js');

const existingItem = (overrides = {}) => ({
  itemId: 'item-existing',
  __rowId: 'row-existing',
  itemType: 'inventory',
  inventoryProduct: 'product-123',
  sku: 'ELC-004',
  itemName: 'Electrical Wire — 2.0mm',
  variant: '2.0mm',
  attributes: { Size: '2.0mm', Color: 'Black' },
  description: 'Size: 2.0mm · Color: Black',
  quantity: '5',
  sellingUnit: 'roll',
  sellingPrice: '25.00',
  originalUnitPrice: 25,
  supplierId: 'supplier-1',
  supplierName: 'Wire Supplier',
  purchaseCost: '12.50',
  expectedArrivalDate: '2026-12-01',
  priceOverrideReason: '',
  remarks: 'For site A',
  photos: [],
  ...overrides,
});

test('identical existing product variants merge quantity using Product ID, SKU and variant identity', async () => {
  const { consolidateQuotationItems } = await load();
  const originalPhoto = { source: 'product', productId: 'product-123', imageIndex: 0, src: '/wire.png' };
  const samePhoto = { ...originalPhoto };
  const first = existingItem({ photos: [originalPhoto] });
  const duplicate = existingItem({
    itemId: 'item-new', __rowId: 'row-new', quantity: '3', itemName: ' electrical   wire — 2.0MM ',
    variant: ' 2.0MM ', attributes: { Color: 'black', Size: '2.0mm' }, description: 'size: 2.0mm · color: BLACK',
    sellingPrice: '25', purchaseCost: '12.5', supplierName: 'WIRE SUPPLIER', photos: [samePhoto],
  });

  const result = consolidateQuotationItems([first, duplicate], { candidateItemId: duplicate.itemId });
  assert.equal(result.error, null);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].itemId, first.itemId, 'the original item record remains the survivor');
  assert.equal(result.items[0].quantity, '8');
  assert.equal(result.items[0].photos.length, 1, 'the same catalog photo is not duplicated or lost');
  assert.deepEqual(result.mergedGroups[0].removedItemIds, [duplicate.itemId]);
});

test('custom products merge case and whitespace variants only when specifications match', async () => {
  const { consolidateQuotationItems } = await load();
  const custom = (itemId, overrides = {}) => ({
    itemId, itemType: 'custom', itemName: 'Concrete Nails', description: 'Size: 6', attributes: { Size: '6' },
    quantity: '2', sellingUnit: 'kg', sellingPrice: '10.00', purchaseCost: '', supplierId: '', supplierName: '',
    expectedArrivalDate: '', remarks: '', photos: [],
    ...overrides,
  });
  const first = custom('custom-first');
  const same = custom('custom-second', { itemName: ' concrete   nails ', description: ' size: 6 ', attributes: { Size: ' 6 ' }, quantity: '3', sellingPrice: '10' });
  const merged = consolidateQuotationItems([first, same]);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].quantity, '5');

  const otherVariant = custom('custom-third', { attributes: { Size: '5' }, description: 'Size: 5' });
  assert.equal(consolidateQuotationItems([first, otherVariant]).items.length, 2);
});

test('different units, prices, suppliers, costs, dates, descriptions or notes stay separate', async () => {
  const { consolidateQuotationItems } = await load();
  const baseline = existingItem();
  const variations = [
    { sellingUnit: 'box' },
    { sellingPrice: '26.00' },
    { supplierId: 'supplier-2' },
    { supplierName: 'Another Supplier' },
    { purchaseCost: '13.00' },
    { expectedArrivalDate: '2026-12-02' },
    { description: 'Size: 2.0mm · Color: Blue' },
    { remarks: 'For site B' },
    { priceOverrideReason: 'Special customer rate' },
  ];
  for (const [index, variation] of variations.entries()) {
    const duplicate = existingItem({ itemId: `different-${index}`, __rowId: `row-${index}`, ...variation });
    assert.equal(consolidateQuotationItems([baseline, duplicate]).items.length, 2, JSON.stringify(variation));
  }
});

test('different inventory product IDs or variant attributes never merge based on display name alone', async () => {
  const { consolidateQuotationItems } = await load();
  const baseline = existingItem();
  const differentProduct = existingItem({ itemId: 'different-product', inventoryProduct: 'product-456' });
  const differentSku = existingItem({ itemId: 'different-sku', sku: 'ELC-005' });
  const differentVariant = existingItem({ itemId: 'different-variant', attributes: { Size: '3.0mm', Color: 'Black' }, variant: '3.0mm' });
  for (const duplicate of [differentProduct, differentSku, differentVariant]) {
    assert.equal(consolidateQuotationItems([baseline, duplicate]).items.length, 2);
  }
});

test('multiple duplicate groups consolidate once, preserve first IDs, and remain idempotent', async () => {
  const { consolidateQuotationItems } = await load();
  const items = [
    existingItem({ quantity: '2' }),
    existingItem({ itemId: 'existing-duplicate', quantity: '3' }),
    existingItem({ itemId: 'other-product', inventoryProduct: 'product-other', sku: 'ELC-900', quantity: '4' }),
    existingItem({ itemId: 'other-duplicate', inventoryProduct: 'product-other', sku: 'ELC-900', quantity: '1' }),
  ];
  const result = consolidateQuotationItems(items);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.itemId), ['item-existing', 'other-product']);
  assert.deepEqual(result.items.map((item) => item.quantity), ['5', '5']);
  assert.equal(result.mergedGroups.length, 2);
  const repeated = consolidateQuotationItems(result.items);
  assert.equal(repeated.mergedGroups.length, 0);
  assert.deepEqual(repeated.items, result.items);
});

test('only valid quantities merge and photos are preserved without exceeding per-item limits', async () => {
  const { consolidateQuotationItems } = await load();
  const baseline = existingItem({ quantity: '2', photos: [{ name: 'one.jpg', size: 10, type: 'image/jpeg' }] });
  const invalidQuantity = existingItem({ itemId: 'invalid-quantity', quantity: '0' });
  assert.equal(consolidateQuotationItems([baseline, invalidQuantity]).items.length, 2);

  const two = { name: 'two.jpg', size: 10, type: 'image/jpeg' };
  const three = { name: 'three.jpg', size: 10, type: 'image/jpeg' };
  const validDuplicate = existingItem({ itemId: 'valid-duplicate', quantity: '1', photos: [two, three] });
  const merged = consolidateQuotationItems([baseline, validDuplicate]);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].photos.length, 3);

  const fourth = { name: 'four.jpg', size: 10, type: 'image/jpeg' };
  const tooManyPhotos = existingItem({ itemId: 'too-many-photos', photos: [two, three, fourth] });
  const blocked = consolidateQuotationItems([baseline, tooManyPhotos]);
  assert.match(blocked.error.message, /more than 3 different photos/);
  assert.equal(blocked.items.length, 2, 'no partial merge drops photos');
});

test('combined quantity and line amount must remain within safe limits', async () => {
  const { consolidateQuotationItems } = await load();
  const first = existingItem({ quantity: '9007199254740990', sellingPrice: '1' });
  const second = existingItem({ itemId: 'second', quantity: '2', sellingPrice: '1' });
  const blocked = consolidateQuotationItems([first, second]);
  assert.match(blocked.error.message, /Combined quantity exceeds/);
  assert.equal(blocked.items.length, 2);

  const expensiveFirst = existingItem({ quantity: '1', sellingPrice: '90071992547409.91' });
  const expensiveSecond = existingItem({ itemId: 'expensive-second', quantity: '1', sellingPrice: '90071992547409.91' });
  const amountBlocked = consolidateQuotationItems([expensiveFirst, expensiveSecond]);
  assert.match(amountBlocked.error.message, /Combined line amount exceeds/);
  assert.equal(amountBlocked.items.length, 2);
});
