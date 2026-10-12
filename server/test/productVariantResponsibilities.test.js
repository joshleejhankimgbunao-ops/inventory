/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadMigration = () => import('../../src/utils/productCategoryChange.js');
const loadFamilies = () => import('../../src/utils/productFamilies.js');
const loadPosFamilies = () => import('../../src/utils/posVariantSelection.js');

const currentCategory = {
  name: 'Masonry',
  attributeSchemaVersion: 1,
  productAttributes: [
    { name: 'Material', key: 'material', type: 'text', required: false, order: 0 },
    { name: 'Size / Thickness', key: 'size', type: 'text', required: true, order: 1 },
    { name: 'Color', key: 'color', type: 'select', options: ['Gray', 'Red'], required: false, order: 2 },
  ],
};
const targetCategory = {
  name: 'Tools & Abrasives',
  attributeSchemaVersion: 1,
  productAttributes: [
    { name: 'Material', key: 'material', type: 'text', required: false, order: 0 },
    { name: 'Grit', key: 'grit', type: 'number', required: true, order: 1 },
    { name: 'Color', key: 'color', type: 'select', options: ['Black'], required: false, order: 2 },
    { name: 'Type', key: 'type', type: 'text', required: false, order: 3 },
  ],
};

test('category migration preserves only compatible authoritative attributes', async () => {
  const { buildCategoryAttributeMigration } = await loadMigration();
  const migration = buildCategoryAttributeMigration({
    product: { attributes: { material: 'Concrete', size: '4 in', color: 'Gray' }, brand: 'Stale Brand' },
    currentCategory,
    targetCategory,
  });

  assert.deepEqual(migration.targetValues, { material: 'Concrete', grit: '', color: '', type: '' });
  assert.deepEqual(migration.compatible.map((row) => row.definition.key), ['material']);
  assert.deepEqual(migration.removed.map((row) => row.definition.key), ['size', 'color']);
  assert.deepEqual(migration.required.map((definition) => definition.key), ['grit']);
  assert.deepEqual(migration.optional.map((definition) => definition.key), ['color', 'type']);
  assert.equal(Object.hasOwn(migration.targetValues, 'brand'), false);
});

test('editing one product name naturally regroups Product Master and POS without changing its sibling', async () => {
  const products = [
    { id: 'one', code: 'OTH-010', name: 'Concrete Hollow Block', category: 'Masonry', stock: 10, price: 20, attributes: { size: '4 in' } },
    { id: 'two', code: 'OTH-011', name: 'Hollow Block', category: 'Masonry', stock: 12, price: 25, attributes: { size: '5 in' } },
  ];
  const categories = [{ name: 'Masonry', attributeSchemaVersion: 1, productAttributes: [{ name: 'Size', key: 'size', type: 'text', order: 0 }] }];
  const [{ groupProductsIntoFamilies }, { groupProductsForPos }] = await Promise.all([loadFamilies(), loadPosFamilies()]);

  assert.deepEqual(groupProductsIntoFamilies(products, categories).map((family) => family.name).sort(), ['Concrete Hollow Block', 'Hollow Block']);
  assert.deepEqual(groupProductsForPos(products, categories).map((family) => family.name).sort(), ['Concrete Hollow Block', 'Hollow Block']);
  assert.equal(products[1].name, 'Hollow Block');
});

test('family summary is read-only and Edit Variant owns name and controlled category changes', () => {
  const familyModal = fs.readFileSync(path.join(__dirname, '../../src/components/ProductFamilyModal.jsx'), 'utf8');
  const productList = fs.readFileSync(path.join(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');
  const categoryModal = fs.readFileSync(path.join(__dirname, '../../src/components/VariantCategoryChangeModal.jsx'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/productController.js'), 'utf8');

  assert.doesNotMatch(familyModal, /Product family name|Rename Family|onRenameFamily/);
  assert.match(familyModal, /\{family\.name\}/);
  assert.match(productList, /disabled=\{Boolean\(variantFamilyKey\) && modalMode === 'add'\}/);
  assert.match(productList, /Changing the product name may move this variant to a different product family\./);
  assert.match(productList, />\s*Change Category\s*</);
  assert.match(categoryModal, /This affects \{product\.code\} only\./);
  assert.match(categoryModal, /SKU, price, stock, supplier, image, and status will remain unchanged\./);
  assert.doesNotMatch(controller, /Sale\.update|updateMany/);
});

test('Edit Variant tracks Sold By changes while supplier typing remains a separate search state', () => {
  const productList = fs.readFileSync(path.join(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');

  assert.match(productList, /String\(formData\.sellingUnit \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== String\(editingProduct\.sellingUnit \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(productList, /const \[supplierSearchQuery, setSupplierSearchQuery\] = useState\(''\)/);
  assert.match(productList, /query=\{supplierSearchQuery\}/);
  assert.match(productList, /onQueryChange=\{setSupplierSearchQuery\}/);
  assert.match(productList, /setFormData\(\(previous\) => \(\{ \.\.\.previous, supplier \}\)\);\s*setSupplierSearchQuery\(supplier\)/);
  assert.doesNotMatch(productList, /if \(!hasMatch\)\s*\{\s*setFormData\(\(prev\) => \(\{ \.\.\.prev, supplier: '' \}\)\)/);
});
