const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadHelpers = () => import('../../src/utils/productFamilies.js');

const schemaV1Category = {
  name: 'Tools & Abrasives',
  attributeSchemaVersion: 1,
  productAttributes: [
    { name: 'Grit', key: 'grit', type: 'number', required: true, order: 0 },
  ],
};

const product = (overrides = {}) => ({
  id: overrides.id || overrides.code || 'product-1',
  code: overrides.code || 'SND-060',
  name: overrides.name || 'Sandpaper',
  category: overrides.category || 'Tools & Abrasives',
  price: overrides.price ?? 15,
  stock: overrides.stock ?? 10,
  attributes: overrides.attributes || { grit: 60 },
  brand: overrides.brand || '',
  color: overrides.color || '',
  size: overrides.size || '',
  supplier: overrides.supplier || 'Local Supplier',
  imageUrl: overrides.imageUrl || '',
  isArchived: overrides.isArchived || false,
});

test('same normalized category and product name group into one family', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const families = groupProductsIntoFamilies([
    product({ code: 'SND-060', name: ' Sandpaper ', attributes: { grit: 60 } }),
    product({ code: 'SND-080', name: 'sandpaper', attributes: { grit: 80 } }),
    product({ code: 'SND-100', name: 'SANDPAPER', attributes: { grit: 100 } }),
  ], [schemaV1Category]);

  assert.equal(families.length, 1);
  assert.equal(families[0].variants.length, 3);
});

test('different product names do not group', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const families = groupProductsIntoFamilies([
    product({ code: 'SND-060' }),
    product({ code: 'DISC-060', name: 'Sanding Disc' }),
  ], [schemaV1Category]);
  assert.equal(families.length, 2);
});

test('same product name in different categories does not group', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const families = groupProductsIntoFamilies([
    product({ code: 'SND-060' }),
    product({ code: 'SND-WET-060', category: 'Wet & Dry' }),
  ], [schemaV1Category, { ...schemaV1Category, name: 'Wet & Dry' }]);
  assert.equal(families.length, 2);
});

test('price and stock remain variant-specific while family aggregates are accurate', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const [family] = groupProductsIntoFamilies([
    product({ code: 'SND-060', price: 15, stock: 20, attributes: { grit: 60 } }),
    product({ code: 'SND-080', price: 18, stock: 30, attributes: { grit: 80 } }),
    product({ code: 'SND-100', price: 20, stock: 40, attributes: { grit: 100 } }),
  ], [schemaV1Category]);

  assert.deepEqual(family.variants.map(({ code, price }) => [code, price]), [
    ['SND-060', 15],
    ['SND-080', 18],
    ['SND-100', 20],
  ]);
  assert.equal(family.minPrice, 15);
  assert.equal(family.maxPrice, 20);
  assert.equal(family.totalStock, 90);
});

test('child SKU search surfaces the complete family', async () => {
  const { groupProductsIntoFamilies, matchesProductFamilySearch, getMatchingFamilyVariants } = await loadHelpers();
  const [family] = groupProductsIntoFamilies([
    product({ code: 'SND-060', attributes: { grit: 60 } }),
    product({ code: 'SND-080', attributes: { grit: 80 } }),
  ], [schemaV1Category]);

  assert.equal(matchesProductFamilySearch(family, 'snd-080'), true);
  assert.deepEqual(getMatchingFamilyVariants(family, 'snd-080').map(({ code }) => code), ['SND-080']);
  assert.equal(family.variants.length, 2);
});

test('child configured attribute search surfaces the family', async () => {
  const { groupProductsIntoFamilies, matchesProductFamilySearch } = await loadHelpers();
  const [family] = groupProductsIntoFamilies([
    product({ code: 'SND-060', attributes: { grit: 60 } }),
    product({ code: 'SND-150', attributes: { grit: 150 } }),
  ], [schemaV1Category]);
  assert.equal(matchesProductFamilySearch(family, '150'), true);
});

test('dynamic columns follow configured category productAttributes order', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const electrical = {
    name: 'Electrical',
    attributeSchemaVersion: 1,
    productAttributes: [
      { name: 'Color', key: 'color', type: 'text', order: 1 },
      { name: 'Wire Size', key: 'wire_size', type: 'number_unit', unit: 'mm²', order: 0 },
      { name: 'Length', key: 'length', type: 'number_unit', unit: 'm', order: 2 },
    ],
  };
  const [family] = groupProductsIntoFamilies([
    product({ name: 'THHN Wire', category: 'Electrical', attributes: { wire_size: 3.5, color: 'Black', length: 150 } }),
  ], [electrical]);

  assert.deepEqual(family.attributeDefinitions.map(({ key }) => key), ['wire_size', 'color', 'length']);
});

test('schema v1 excludes stale legacy dimensions that are not configured', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const [family] = groupProductsIntoFamilies([
    product({ brand: 'Legacy Brand', color: 'Red', size: 'Old Size', attributes: { grit: 60 } }),
  ], [schemaV1Category]);

  assert.deepEqual(family.attributeDefinitions.map(({ key }) => key), ['grit']);
  assert.deepEqual(family.attributeValues[0], { grit: 60 });
});

test('legacy category definitions retain configured Brand Color and Size behavior', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const legacyCategory = { name: 'Legacy', showBrand: true, showColor: true, showSize: true };
  const [family] = groupProductsIntoFamilies([
    product({ category: 'Legacy', brand: 'Acme', color: 'Blue', size: 'Large', attributes: {} }),
  ], [legacyCategory]);

  assert.deepEqual(family.attributeDefinitions.map(({ key }) => key), ['brand', 'color', 'size']);
  assert.deepEqual(family.attributeValues[0], { brand: 'Acme', color: 'Blue', size: 'Large' });
});

test('single-variant family retains its SKU price and stock', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const [family] = groupProductsIntoFamilies([
    product({ code: 'ONLY-001', price: 99, stock: 7 }),
  ], [schemaV1Category]);
  assert.equal(family.variants.length, 1);
  assert.equal(family.variants[0].code, 'ONLY-001');
  assert.equal(family.minPrice, 99);
  assert.equal(family.maxPrice, 99);
  assert.equal(family.totalStock, 7);
});

test('grouped pagination counts and slices families rather than raw variants', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const products = [
    product({ code: 'SND-060', attributes: { grit: 60 } }),
    product({ code: 'SND-080', attributes: { grit: 80 } }),
    product({ code: 'DISC-060', name: 'Sanding Disc', attributes: { grit: 60 } }),
  ];
  const families = groupProductsIntoFamilies(products, [schemaV1Category]);
  const pageSize = 1;

  assert.equal(products.length, 3);
  assert.equal(families.length, 2);
  assert.equal(Math.ceil(families.length / pageSize), 2);
  assert.equal(families.slice(0, pageSize).length, 1);
});

test('family manager keeps stock read-only and routes variant creation through the existing product form', () => {
  const modalSource = fs.readFileSync(path.join(__dirname, '../../src/components/ProductFamilyModal.jsx'), 'utf8');
  const productListSource = fs.readFileSync(path.join(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');

  assert.match(modalSource, /Stock changes in Inventory only\./);
  assert.match(modalSource, /\{family\.name\}/);
  assert.doesNotMatch(modalSource, /Product family name|Rename Family|onRenameFamily/);
  assert.doesNotMatch(modalSource, /aria-label="(?:Variant )?stock"/i);
  assert.match(productListSource, /const handleOpenAddVariant = \(family\) =>/);
  assert.match(productListSource, /productToInsert = await createProductApi\(newProduct\)/);
  assert.match(productListSource, /stock: '0'/);
});

test('family totals remain aggregate-only while child variants retain their own stock states', async () => {
  const { groupProductsIntoFamilies } = await loadHelpers();
  const { getStockStatus } = await import('../../src/utils/recommendationLogic.js');
  const [family] = groupProductsIntoFamilies([
    product({ code: 'SND-001', stock: 50, attributes: { grit: 60 } }),
    product({ code: 'SND-002', stock: 1, attributes: { grit: 80 } }),
    product({ code: 'SND-003', stock: 0, attributes: { grit: 100 } }),
  ], [schemaV1Category]);

  assert.equal(family.totalStock, 51);
  assert.deepEqual(family.variants.map((variant) => getStockStatus(variant, {})), [
    'In Stock',
    'Low Stock',
    'Out of Stock',
  ]);
});

test('outer Product Master keeps aggregate stock neutral and moves stock states into Manage Variants', () => {
  const modalSource = fs.readFileSync(path.join(__dirname, '../../src/components/ProductFamilyModal.jsx'), 'utf8');
  const productListSource = fs.readFileSync(path.join(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');
  const outerFilterPanel = productListSource.slice(
    productListSource.indexOf('{/* Combined Filter & Sort Panel */}'),
    productListSource.indexOf('{/* Backdrop for closing panel */}'),
  );

  assert.match(productListSource, /border-slate-200 bg-slate-50[\s\S]*?\{family\.totalStock\} total/);
  assert.doesNotMatch(productListSource, /getStockBadgeClass/);
  assert.doesNotMatch(outerFilterPanel, /In Stock|Low Stock|Out of Stock/);
  assert.match(outerFilterPanel, /\['All', 'Archived'\]/);

  assert.match(modalSource, /VARIANT_STOCK_FILTERS = \['All', 'In Stock', 'Low Stock', 'Out of Stock'\]/);
  assert.match(modalSource, /getStockStatus\(variant, settings\)/);
  assert.match(modalSource, /stockFilter === 'All' \|\| stockStatus === stockFilter/);
  assert.match(modalSource, />Stock Status</);
  assert.match(modalSource, />Record Status</);
});

test('Manage Variants renders a filter-aware table empty state', () => {
  const modalSource = fs.readFileSync(path.join(__dirname, '../../src/components/ProductFamilyModal.jsx'), 'utf8');

  assert.match(modalSource, /EMPTY_VARIANT_FILTER_COPY/);
  assert.match(modalSource, /No variants found/);
  assert.match(modalSource, /No in-stock variants/);
  assert.match(modalSource, /No low-stock variants/);
  assert.match(modalSource, /No out-of-stock variants/);
  assert.match(modalSource, /visibleVariants\.length === 0/);
  assert.match(modalSource, /colSpan=\{tableColumnCount\}/);
  assert.match(modalSource, /stockFilter === 'All' && !hasVariants && canAddVariant/);
});

test('outer Product Master gives the family variant count its own column', () => {
  const productListSource = fs.readFileSync(path.join(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');
  const tableHeader = productListSource.slice(
    productListSource.indexOf('<thead className="sticky top-0 z-10 shadow-sm">'),
    productListSource.indexOf('</thead>'),
  );
  const productCell = productListSource.slice(
    productListSource.indexOf('{/* Product family */}'),
    productListSource.indexOf('{/* Variant count */}'),
  );
  const variantCell = productListSource.slice(
    productListSource.indexOf('{/* Variant count */}'),
    productListSource.indexOf('{/* Category */}'),
  );

  assert.match(tableHeader, />Product<[\s\S]*?>Variants<[\s\S]*?>Category</);
  assert.doesNotMatch(productCell, /\{family\.variants\.length\} \{family\.variants\.length === 1 \? 'variant' : 'variants'\}/);
  assert.doesNotMatch(productCell, /getProductFamilyAttributeSummary|getMatchingFamilyVariants|Images vary|Suppliers vary|Matched \{/);
  assert.match(productCell, /\{family\.name\}/);
  assert.match(variantCell, /\{family\.variants\.length\} \{family\.variants\.length === 1 \? 'variant' : 'variants'\}/);
  assert.match(variantCell, /'variant' : 'variants'/);
});
