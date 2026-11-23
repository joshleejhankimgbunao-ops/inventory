/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');
const comparison = import('../../src/utils/recommendationComparison.js');

test('specification comparison labels recorded current and alternative values without inferring compatibility', async () => {
  const { getRecommendationSpecificationComparison } = await comparison;
  const categories = [{ name: 'Paint', attributeSchemaVersion: 1, productAttributes: [
    { key: 'finish', name: 'Finish', type: 'text', order: 1 },
    { key: 'volume', name: 'Volume', type: 'number_unit', unit: 'L', order: 2 },
    { key: 'unused', name: 'Unused', type: 'text', order: 3 },
  ] }];
  const current = { category: 'Paint', sellingUnit: 'can', attributes: { finish: 'Matte', volume: 1 } };
  const alternative = { category: 'Paint', sellingUnit: 'can', attributes: { finish: 'Gloss', volume: 1 } };
  const rows = getRecommendationSpecificationComparison(current, alternative, categories);
  assert.deepEqual(rows.map(({ key }) => key), ['category', 'sellingUnit', 'finish', 'volume']);
  assert.equal(rows.find(({ key }) => key === 'finish').status, 'different');
  assert.equal(rows.find(({ key }) => key === 'volume').currentText, '1 L');
  assert.equal(rows.find(({ key }) => key === 'volume').status, 'match');
  assert.equal(rows.some(({ key }) => key === 'unused'), false);
  assert.equal(getRecommendationSpecificationComparison(current, { ...alternative, sellingUnit: '' }, categories).find(({ key }) => key === 'sellingUnit').status, 'unrecorded');
});
