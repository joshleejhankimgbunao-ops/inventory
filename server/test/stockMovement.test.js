/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyStockMovement, POLICY, getStockMovementPeriod, getObservedDays } = require('../src/services/stockMovement');

const now = new Date('2026-10-15T06:00:00Z'); // 14:00 in Manila
const period = getStockMovementPeriod(now);
const categories = [{ _id: 'hardware', name: 'Hardware', sizeUnits: ['pcs', 'rolls'], isActive: true }, { _id: 'paint', name: 'Paint', sizeUnits: ['pcs', 'can'], isActive: true }];
const product = (n, extra = {}) => ({ _id: `p${n}`, sku: `SKU-${n}`, name: `Product ${n}`, categoryRef: 'hardware', category: 'Hardware', stock: 20, sellingUnit: 'pcs', isActive: true, createdAt: new Date('2026-09-01T00:00:00Z'), ...extra });
const sale = (n, quantity, extra = {}) => ({ _id: { product: `p${n}`, code: `SKU-${n}`, unit: 'pcs' }, unitsSold: quantity, lines: 1, invalidQuantityLines: 0, source: 'regular', ...extra });
const classify = (extra = {}) => classifyStockMovement({ categories, products: [], sales: [], opening: [], history: [], period, now, ...extra });
const fullStockHistory = (n, quantity = 20) => ({ _id: `p${n}`, stockAfter: quantity, invalid: false });

test('rolling window is the last 30 inclusive Manila dates with an exclusive next-midnight boundary', () => {
  assert.deepEqual(period, {
    label: 'Last 30 Days', days: 30, start: '2026-09-15T16:00:00.000Z', end: '2026-10-15T16:00:00.000Z', timeZone: 'Asia/Manila', endExclusive: true,
  });
  const beforeMidnight = getStockMovementPeriod(new Date('2026-10-14T15:59:59.999Z'));
  const afterMidnight = getStockMovementPeriod(new Date('2026-10-14T16:00:00.000Z'));
  assert.equal(beforeMidnight.end, '2026-10-14T16:00:00.000Z');
  assert.equal(afterMidnight.end, '2026-10-15T16:00:00.000Z');
  assert.equal(Date.parse(period.end) - Date.parse(period.start), 30 * 86400000);
  assert.equal(getObservedDays(new Date('2026-10-02T00:00:00Z'), period, now, 30), 14);
  assert.equal(getObservedDays(new Date('2026-10-03T00:00:00Z'), period, now, 30), 13);
});

test('velocity thresholds classify all mature positive SKUs without category peer minimums', () => {
  const quantities = [30, 15, 7, 3, 1];
  const products = quantities.map((_, index) => product(index));
  const sales = quantities.map((quantity, index) => sale(index, quantity));
  const countsAt = (threshold) => {
    const result = classify({ products, sales, policy: { ...POLICY, fastVelocityUnitsPerDay: threshold } });
    return { fast: result.fast.count, slow: result.slow.count, insufficient: result.insufficientHistory.count };
  };
  assert.deepEqual(countsAt(0.1), { fast: 4, slow: 1, insufficient: 0 });
  assert.deepEqual(countsAt(0.2), { fast: 3, slow: 2, insufficient: 0 });
  assert.deepEqual(countsAt(0.25), { fast: 2, slow: 3, insufficient: 0 });
  assert.deepEqual(countsAt(0.6), { fast: 1, slow: 4, insufficient: 0 });
  const result = classify({ products: products.slice(0, 1), sales: sales.slice(0, 1) });
  assert.equal(result.fast.count, 1, 'a single SKU can be classified without five sold peers');
  assert.equal(result.fast.entries[0].salesVelocity, 1);
  assert.equal(result.metric.key, 'unitsPerDay');
  assert.equal(result.fast.entries[0].regularUnitsSold, 30);
  assert.equal(result.comparisonGroups, undefined);
});

test('repeated POS and completed Special Order SKU lines add once by source', () => {
  const result = classify({
    products: [product(1)],
    sales: [sale(1, 2), sale(1, 3), sale(1, 4, { source: 'special-order' })],
  });
  const [entry] = result.fast.entries;
  assert.equal(entry.unitsSold, 9);
  assert.equal(entry.regularUnitsSold, 5);
  assert.equal(entry.specialOrderUnitsSold, 4);
  assert.equal(result.qualifyingUnitsRecorded, 9);
});

test('sales before a SKU creation date are excluded from its observed-day velocity', () => {
  const result = classify({
    products: [product(0, { createdAt: new Date('2026-09-20T00:00:00Z') })],
    sales: [
      sale(0, 30, { _id: { product: 'p0', code: 'SKU-0', unit: 'pcs', businessDate: '2026-09-19' } }),
      sale(0, 2, { _id: { product: 'p0', code: 'SKU-0', unit: 'pcs', businessDate: '2026-09-20' } }),
    ],
  });
  assert.equal(result.slow.entries[0].unitsSold, 2);
  assert.equal(result.slow.entries[0].observedDays, 26);
  assert.equal(result.slow.entries[0].salesVelocity, 2 / 26);
});

test('new products and short observation windows remain insufficient, even if they have sales', () => {
  const result = classify({ products: [product(0, { createdAt: new Date('2026-10-03T00:00:00Z') })], sales: [sale(0, 20)] });
  assert.equal(result.fast.count + result.slow.count, 0);
  assert.equal(result.insufficientHistory.entries[0].observedDays, 13);
  assert.match(result.insufficientHistory.entries[0].reason, /observation history/);
});

test('zero sales is Non-Moving only with 30 observed days, on-hand stock and consistent dated evidence', () => {
  const good = fullStockHistory(0);
  const result = classify({ products: [product(0)], opening: [good] });
  assert.equal(result.nonMoving.count, 1);
  for (const extra of [
    { opening: [] },
    { opening: [{ ...good, stockAfter: 0 }] },
    { products: [product(0, { stock: 0 })], opening: [good] },
    { products: [product(0, { createdAt: new Date('2026-09-17T00:00:00Z') })], opening: [good] },
    { products: [product(0, { createdAt: null })], opening: [good] },
    { opening: [{ ...good, invalid: true }] },
    { history: [{ _id: 'p0', firstStock: 20, lastStock: 20, stockout: true, continuous: true }] },
    { history: [{ _id: 'p0', firstStock: 5, lastStock: 20, continuous: true }] },
    { history: [{ _id: 'p0', firstStock: 20, lastStock: 20, continuous: false }] },
    { history: [{ _id: 'p0', firstStock: 20, lastStock: 19, continuous: true }] },
  ]) {
    const candidate = classify({ products: [product(0)], opening: [good], ...extra });
    assert.equal(candidate.nonMoving.count, 0);
    assert.equal(candidate.insufficientHistory.count, 1);
  }
});

test('inactive SKUs, missing units, invalid stock and unresolved identities are not misclassified', () => {
  const products = [product(0, { isActive: false }), product(1, { sellingUnit: '' }), product(2, { sellingUnit: 'unknown' }), product(3, { stock: -1 }), product(4)];
  const result = classify({ products, sales: [sale(4, 9, { _id: { product: 'deleted', code: 'SKU-4' } })] });
  assert.equal(result.dataQuality.inactiveSkus, 1);
  assert.equal(result.insufficientHistory.count, 4);
  assert.equal(result.fast.count + result.slow.count + result.nonMoving.count, 0);
  assert.match(result.insufficientHistory.entries.find((row) => row.id === 'p1').reason, /selling unit/);
  assert.match(result.insufficientHistory.entries.find((row) => row.id === 'p2').reason, /configured/);
  assert.match(result.insufficientHistory.entries.find((row) => row.id === 'p3').reason, /stock quantity/);
  assert.match(result.insufficientHistory.entries.find((row) => row.id === 'p4').reason, /sales identity/);
});

test('exact product identity and configured selling units are preserved without conversions', () => {
  const products = [product(0, { sellingUnit: 'rolls' }), product(1, { sellingUnit: 'pcs' })];
  const result = classify({ products, sales: [sale(0, 5, { _id: { product: 'p0', code: 'OLD-SKU', unit: 'ROLLS' } }), sale(1, 4)] });
  assert.equal(result.slow.count, 2);
  assert.equal(result.slow.entries.find((row) => row.id === 'p0').sku, 'SKU-0');
  const mismatch = classify({ products: [product(0)], sales: [sale(0, 3, { _id: { product: 'p0', code: 'SKU-0', unit: 'gallons' } })] });
  assert.equal(mismatch.insufficientHistory.count, 1);
  assert.equal(mismatch.dataQuality.unitMismatchLines, 1);
});

test('category filters affect displayed active SKUs without imposing comparison groups', () => {
  const products = [product(0), product(1, { categoryRef: 'paint', category: 'Paint', sellingUnit: 'can' })];
  const result = classify({ products, sales: [sale(0, 8), sale(1, 8, { _id: { product: 'p1', code: 'SKU-1', unit: 'can' } })], categoryId: 'paint' });
  assert.equal(result.fast.count, 1);
  assert.equal(result.fast.entries[0].categoryId, 'paint');
  assert.equal(result.comparisonGroups, undefined);
  assert.throws(() => classify({ categoryId: 'missing' }), /active product category/);
});
