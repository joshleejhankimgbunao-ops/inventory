const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeProductCategoryBackfill,
  planProductCategoryBackfill,
} = require('../src/services/productCategoryBackfill');

const categories = [
  { _id: 'category-1', name: 'Electrical & Lighting' },
  { _id: 'category-2', name: 'Paints' },
];

test('dry-run reports exact matches and performs no writes', async () => {
  let writes = 0;
  const report = await executeProductCategoryBackfill({
    products: [
      { _id: 'p1', sku: 'ELC-1', category: '  electrical   & LIGHTING ' },
      { _id: 'p2', sku: 'PNT-1', category: 'Paints', categoryRef: 'category-2' },
      { _id: 'p3', sku: 'UNK-1', category: 'Unknown' },
    ],
    categories,
    ProductModel: { updateOne: async () => { writes += 1; } },
  });

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.totalProductsScanned, 3);
  assert.equal(report.alreadyLinked, 1);
  assert.equal(report.successfullyMatchable, 1);
  assert.equal(report.productsRequiringManualReview, 1);
  assert.equal(report.unmatchedCategoryNames[0].categoryName, 'Unknown');
  assert.equal(writes, 0);
});

test('apply mode writes categoryRef and canonicalizes only exact normalized matches', async () => {
  const product = { _id: 'p1', sku: 'ELC-1', category: ' electrical & lighting ' };
  let update;
  const ProductModel = {
    updateOne: async (filter, changes) => {
      update = { filter, changes };
      product.categoryRef = changes.$set.categoryRef;
      product.category = changes.$set.category;
      return { modifiedCount: 1 };
    },
  };
  const report = await executeProductCategoryBackfill({ products: [product], categories, apply: true, ProductModel });

  assert.equal(report.updated, 1);
  assert.equal(update.changes.$set.categoryRef, 'category-1');
  assert.equal(update.changes.$set.category, 'Electrical & Lighting');

  const rerun = await executeProductCategoryBackfill({ products: [product], categories, apply: true, ProductModel });
  assert.equal(rerun.alreadyLinked, 1);
  assert.equal(rerun.successfullyMatchable, 0);
  assert.equal(rerun.updated, 0);
});

test('unmatched and ambiguous names are reported for manual review and never planned for writes', () => {
  const duplicateNames = [
    ...categories,
    { _id: 'category-3', name: ' electrical & lighting ' },
  ];
  const { actions, report } = planProductCategoryBackfill({
    products: [
      { _id: 'p1', sku: 'ELC-1', category: 'Electrical & Lighting' },
      { _id: 'p2', sku: 'UNK-1', category: 'No Such Category' },
    ],
    categories: duplicateNames,
  });

  assert.equal(actions.length, 0);
  assert.equal(report.ambiguousMatches.length, 1);
  assert.equal(report.ambiguousMatches[0].matches.length, 2);
  assert.equal(report.unmatchedCategoryNames.length, 1);
  assert.equal(report.productsRequiringManualReview, 2);
});
