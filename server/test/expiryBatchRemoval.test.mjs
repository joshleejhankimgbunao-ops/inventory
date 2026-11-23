import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBatchRemovalAllocationReviewRows,
  getEligibleBatchRemovalBatches,
} from '../../src/utils/expiryBatchRemoval.mjs';

test('eligible removal batches exclude depleted and fully reserved batches but allow expired stock', () => {
  const batches = [
    { _id: 'depleted', remainingQuantity: 0, reservedQuantity: 0 },
    { _id: 'available', remainingQuantity: 5, reservedQuantity: 2, expiryDate: '2099-01-01' },
    { _id: 'fully-reserved', remainingQuantity: 4, reservedQuantity: 4 },
    { _id: 'expired-available', remainingQuantity: 3, reservedQuantity: 1, expiryDate: '2000-01-01' },
  ];

  assert.deepEqual(getEligibleBatchRemovalBatches(batches).map((batch) => batch._id), [
    'available',
    'expired-available',
  ]);
});

test('availability changes retain pending quantities and require explicit review', () => {
  const batches = [{ _id: 'batch-a', batchReference: 'BT-20261104-001', remainingQuantity: 3, reservedQuantity: 0 }];
  const allocations = { 'batch-a': '4' };
  const snapshots = { 'batch-a': { batchReference: 'BT-20261104-001', availableQuantity: 5 } };
  const rows = getBatchRemovalAllocationReviewRows(batches, allocations, snapshots);

  assert.deepEqual(allocations, { 'batch-a': '4' });
  assert.deepEqual(rows, [{
    batchId: 'batch-a',
    batchReference: 'BT-20261104-001',
    quantity: 4,
    availableQuantity: 3,
    availabilityChanged: true,
    exceedsAvailable: true,
    canConfirm: false,
  }]);
});

test('availability changes are surfaced even when the entered quantity still fits', () => {
  const batches = [{ _id: 'batch-b', batchReference: 'BT-20261104-002', remainingQuantity: 4, reservedQuantity: 1 }];
  const rows = getBatchRemovalAllocationReviewRows(
    batches,
    { 'batch-b': '2' },
    { 'batch-b': { batchReference: 'BT-20261104-002', availableQuantity: 5 } },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].availabilityChanged, true);
  assert.equal(rows[0].exceedsAvailable, false);
  assert.equal(rows[0].canConfirm, true);
});

test('a batch removed from the active period remains identified until its allocation is cleared', () => {
  const rows = getBatchRemovalAllocationReviewRows(
    [],
    { 'batch-old': '3' },
    { 'batch-old': { batchReference: 'BT-20261103-009', availableQuantity: 3 } },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].batchReference, 'BT-20261103-009');
  assert.equal(rows[0].availableQuantity, 0);
  assert.equal(rows[0].canConfirm, false);
});
