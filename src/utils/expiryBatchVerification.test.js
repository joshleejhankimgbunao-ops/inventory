import test from 'node:test';
import assert from 'node:assert/strict';
import { isExpiryBatchVerificationConfirmed } from './expiryBatchVerification.js';

const item = {
  quantity: 3,
  proposedAllocations: [{ batch: 'earliest', batchId: 'EB-1', expiryDate: '2027-01-31', quantity: 2 }, { batch: 'later', batchId: 'EB-2', expiryDate: '2027-05-31', quantity: 1 }],
  batchOptions: [{ batch: 'earliest', availableQuantity: 2 }, { batch: 'later', availableQuantity: 4 }],
};

test('physical verification accepts the available FEFO proposal without requiring an override reason', () => {
  assert.equal(isExpiryBatchVerificationConfirmed(item, { confirmed: true, allocations: item.proposedAllocations }), true);
});

test('a different available physical batch requires a reason and must cover the complete pick quantity', () => {
  const override = { confirmed: true, allocations: [{ batch: 'later', batchId: 'EB-2', expiryDate: '2027-05-31', quantity: 3 }] };
  assert.equal(isExpiryBatchVerificationConfirmed(item, override), false);
  assert.equal(isExpiryBatchVerificationConfirmed(item, { ...override, reason: 'The earlier lot was damaged.' }), true);
  assert.equal(isExpiryBatchVerificationConfirmed(item, { ...override, reason: 'The earlier lot was damaged.', allocations: [{ ...override.allocations[0], quantity: 5 }] }), false);
});

test('unavailable or expired batches cannot be confirmed as a physical override', () => {
  const expired = { confirmed: true, reason: 'It is physically present.', allocations: [{ batch: 'expired', quantity: 3 }] };
  assert.equal(isExpiryBatchVerificationConfirmed(item, expired), false);
});
