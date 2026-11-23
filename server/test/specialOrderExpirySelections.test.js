const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuotationExpirySelections } = require('../src/utils/specialOrderExpirySelections');

const PRODUCT_ID = '65a100000000000000000001';
const BATCH_ID = '65a100000000000000000002';
const today = '2026-11-23';
const makeAvailability = ({ expiryDate = '2027-01-15', remainingQuantity = 8, reservedQuantity = 2 } = {}) => ({
  tracked: true,
  reconciled: true,
  valid: true,
  batches: [{
    _id: BATCH_ID, batchId: 'BATCH-001', batchReference: 'LOT-001', lotNumber: 'MFG-1',
    expiryDate, remainingQuantity, reservedQuantity,
  }],
});

test('quotation expiry selection stores a validated batch snapshot without allocating inventory', () => {
  const availability = makeAvailability();
  const result = normalizeQuotationExpirySelections({
    product: { _id: PRODUCT_ID, expiryTrackingEnabled: true },
    selections: [{ batch: BATCH_ID, batchId: 'BATCH-001', expiryDate: '2027-01-15', quantity: 4 }],
    quantity: 5,
    availability,
    now: new Date(`${today}T12:00:00.000Z`),
  });
  assert.deepEqual(result, [{
    batch: BATCH_ID, batchId: 'BATCH-001', batchReference: 'LOT-001', lotNumber: 'MFG-1', expiryDate: '2027-01-15', quantity: 4,
  }]);
  assert.equal(availability.batches[0].remainingQuantity, 8);
  assert.equal(availability.batches[0].reservedQuantity, 2);
});

test('quotation selections reject expired, unavailable, stale, unreconciled, and excessive batches', () => {
  const product = { _id: PRODUCT_ID, expiryTrackingEnabled: true };
  const selection = [{ batch: BATCH_ID, batchId: 'BATCH-001', expiryDate: '2027-01-15', quantity: 1 }];
  const base = { product, selections: selection, quantity: 2, now: new Date(`${today}T12:00:00.000Z`) };
  assert.throws(() => normalizeQuotationExpirySelections({ ...base, availability: makeAvailability({ expiryDate: today }) }), /expired or no longer available/i);
  assert.throws(() => normalizeQuotationExpirySelections({ ...base, availability: makeAvailability({ remainingQuantity: 2, reservedQuantity: 2 }) }), /availability changed/i);
  assert.throws(() => normalizeQuotationExpirySelections({ ...base, selections: [{ ...selection[0], expiryDate: '2028-01-15' }], availability: makeAvailability() }), /availability changed/i);
  assert.throws(() => normalizeQuotationExpirySelections({ ...base, availability: { ...makeAvailability(), reconciled: false } }), /availability changed/i);
  assert.throws(() => normalizeQuotationExpirySelections({ ...base, selections: [{ ...selection[0], quantity: 3 }], quantity: 2, availability: makeAvailability() }), /cannot exceed/i);
  assert.throws(() => normalizeQuotationExpirySelections({ ...base, product: { ...product, expiryTrackingEnabled: false }, availability: makeAvailability() }), /only valid for expiry-tracked/i);
});
