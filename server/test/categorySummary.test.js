/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadHelpers = () => import('../../src/utils/categorySummary.js');

const category = (name, overrides = {}) => ({ name, isActive: true, ...overrides });

test('configured category count includes active categories without products', async () => {
  const { getActiveConfiguredCategories, getConfiguredCategoryCount } = await loadHelpers();
  const configuredCategories = Array.from({ length: 13 }, (_, index) => category(`Category ${index + 1}`));

  // Only nine of these categories may be represented by products; the master list remains authoritative.
  assert.equal(getConfiguredCategoryCount(configuredCategories), 13);
  assert.equal(getActiveConfiguredCategories(configuredCategories).length, 13);
});

test('archived or deleted categories are excluded from the active master count', async () => {
  const { getConfiguredCategoryCount } = await loadHelpers();

  assert.equal(getConfiguredCategoryCount([
    category('Paints'),
    category('Pipes'),
    category('Old Category', { isActive: false }),
  ]), 2);
});

test('Product Master List uses the shared category master count rather than product-derived filter options', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');

  assert.match(source, /getConfiguredCategoryCount\(customCategories\)/);
  assert.match(source, /getActiveConfiguredCategories\(customCategories\)/);
  assert.doesNotMatch(source, /categoryFilterOptions\.length - 1/);
});
