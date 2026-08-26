const test = require('node:test');
const assert = require('node:assert/strict');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: {
    publishInventoryUpdated: () => {},
  },
};

const { buildInventoryLogDetails } = require('../src/controllers/productController');

test('manual Stock In stores its selected reason in Inventory Log details', () => {
  assert.equal(
    buildInventoryLogDetails({ productName: 'Latex Paint', stockDelta: 10, adjustmentReason: 'Delivery' }),
    'Added 10 of Latex Paint — Reason: Delivery',
  );
});

test('manual Stock Out stores its selected reason in Inventory Log details', () => {
  assert.equal(
    buildInventoryLogDetails({ productName: 'Latex Paint', stockDelta: -5, adjustmentReason: 'Damaged' }),
    'Deducted 5 of Latex Paint — Reason: Damaged',
  );
});

test('automatic and legacy logs keep the existing generic details without a saved reason', () => {
  assert.equal(
    buildInventoryLogDetails({ productName: 'Latex Paint', stockDelta: -1, adjustmentReason: '' }),
    'Updated product Latex Paint',
  );
  assert.equal(
    buildInventoryLogDetails({ productName: 'Latex Paint', stockDelta: 0, adjustmentReason: 'Delivery' }),
    'Updated product Latex Paint',
  );
});
