const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyExpiryBatch, getManilaBusinessDate } = require('../src/utils/productExpiry');

test('expiry classification uses Manila calendar dates and the documented priority', () => {
  const asOfDate = '2026-10-28';
  const classify = (expiryDate, remainingQuantity = 1, balanceConfirmed = true) => classifyExpiryBatch({
    expiryDate, remainingQuantity, balanceConfirmed, asOfDate,
  });

  assert.deepEqual(classify('2026-10-27'), { status: 'Expired', daysUntilExpiry: -1 });
  assert.deepEqual(classify(asOfDate), { status: 'Expired', daysUntilExpiry: 0 });
  assert.deepEqual(classify('2026-10-29'), { status: 'Expiring Soon', daysUntilExpiry: 1 });
  assert.deepEqual(classify('2026-11-27'), { status: 'Expiring Soon', daysUntilExpiry: 30 });
  assert.deepEqual(classify('2026-11-28'), { status: 'Valid', daysUntilExpiry: 31 });
  assert.deepEqual(classify('2026-10-27', 0), { status: 'Depleted', daysUntilExpiry: -1 });
  assert.deepEqual(classify('2026-12-01', 0, false), { status: 'Valid', daysUntilExpiry: 34 }, 'unreconciled quantities cannot classify a provisional batch as depleted');
});

test('Manila business date changes at midnight in Asia/Manila, not UTC midnight', () => {
  assert.equal(getManilaBusinessDate(new Date('2026-10-28T15:59:59.000Z')), '2026-10-28');
  assert.equal(getManilaBusinessDate(new Date('2026-10-28T16:00:00.000Z')), '2026-10-29');
});
