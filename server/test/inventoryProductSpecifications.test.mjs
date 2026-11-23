import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getInventoryProductSpecificationGroupKey,
  getInventoryProductNameParts,
  getInventoryProductSpecifications,
} from '../../src/utils/inventoryProductSpecifications.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readInventorySource = () => readFile(path.join(root, 'src/pages/Inventory.jsx'), 'utf8');

test('unique product names show no attribute subtext regardless of saved specifications', () => {
  const categories = [
    { name: 'Lumber', attributeSchemaVersion: 1, productAttributes: [
      { name: 'Length', key: 'length', type: 'number_unit', unit: 'ft', order: 1 },
      { name: 'Material', key: 'material', type: 'text', order: 2 },
    ] },
    { name: 'Paint', attributeSchemaVersion: 1, productAttributes: [
      { name: 'Finish', key: 'finish', type: 'select', order: 1 },
      { name: 'Color Family', key: 'color_family', type: 'text', order: 2 },
    ] },
  ];

  assert.deepEqual(getInventoryProductSpecifications({ name: 'Pine Board', category: 'Lumber', attributes: { length: 8, material: 'Pine' } }, categories), []);
  assert.deepEqual(getInventoryProductSpecifications({ name: 'Interior Paint', category: 'Paint', attributes: new Map([['finish', 'Matte'], ['color_family', 'Warm']]) }, categories), []);
});

test('duplicate names resolve legacy and differently keyed saved attributes through configured field mappings', () => {
  const categories = [{ name: 'Fixtures', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Mounting Type', key: 'mounting_type', type: 'text' },
    { name: 'Weight', key: 'weight', type: 'number_unit', unit: 'kg' },
  ] }];

  const products = [{
    name: 'Light Fixture',
    category: 'Fixtures',
    attributes: { 'Mounting Type': 'Wall', Weight: 2.5 },
  }, {
    name: 'Light Fixture',
    category: 'Fixtures',
    attributes: { mounting_type: 'Ceiling', weight: 2.5 },
  }];
  assert.deepEqual(getInventoryProductSpecifications(products[0], categories, 'Light Fixture', products), [
    { name: 'Mounting Type', value: 'Wall' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications(products[1], categories, 'Light Fixture', products), [
    { name: 'Mounting Type', value: 'Ceiling' },
  ]);
});

test('legacy category mappings display saved brand/color/size and omit values already in the product name', () => {
  const categories = [{ name: 'Legacy', showBrand: true, showColor: true, showSize: true }];
  const product = { category: 'Legacy', brand: 'Acme', color: 'Blue', size: '4 in', attributes: new Map([['color', 'Blue'], ['size', '4 in']]) };
  assert.deepEqual(getInventoryProductSpecifications(product, categories, 'Acme Panel - Blue (4 in)'), [
    { name: 'Color', value: 'Blue' },
    { name: 'Size / Variant', value: '4 in' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications({ ...product, name: 'Panel', color: '', size: '', attributes: new Map() }, categories, 'Panel'), []);
});

test('same-name variants show only configured attributes that distinguish them', () => {
  const categories = [{ name: 'Panels', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Thickness', key: 'thickness', type: 'number_unit', unit: 'mm', order: 1 },
    { name: 'Finish', key: 'finish', type: 'select', order: 2 },
    { name: 'Material', key: 'material', type: 'text', order: 3 },
  ] }];
  const variants = [
    { id: 'one', name: 'Wall Panel', category: 'Panels', attributes: { thickness: 8, finish: 'Matte', material: 'PVC' } },
    { id: 'two', name: 'Wall Panel', category: 'Panels', attributes: { thickness: 10, finish: 'Matte', material: 'PVC' } },
  ];

  assert.deepEqual(getInventoryProductSpecifications(variants[0], categories, 'Wall Panel', variants), [
    { name: 'Thickness', value: '8 mm' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications(variants[1], categories, 'Wall Panel', variants), [
    { name: 'Thickness', value: '10 mm' },
  ]);
});

test('only the minimum configured attributes needed to distinguish a duplicate-name group are shown', () => {
  const categories = [{ name: 'Panels', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Thickness', key: 'thickness', type: 'number_unit', unit: 'mm', order: 1 },
    { name: 'Finish', key: 'finish', type: 'text', order: 2 },
    { name: 'Material', key: 'material', type: 'text', order: 3 },
    { name: 'Pattern', key: 'pattern', type: 'text', order: 4 },
  ] }];
  const variants = [
    { name: 'Wall Panel', category: 'Panels', attributes: { thickness: 8, finish: 'Matte', material: 'PVC' } },
    { name: 'Wall Panel', category: 'Panels', attributes: { thickness: 10, finish: 'Gloss', material: 'PVC' } },
  ];

  assert.deepEqual(getInventoryProductSpecifications(variants[0], categories, 'Wall Panel', variants), [
    { name: 'Thickness', value: '8 mm' },
  ]);
});

test('paint variants with different displayed names do not show Volume, Finish, or Type subtext', () => {
  const categories = [{ name: 'Paint', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Color', key: 'color', type: 'text', order: 1 },
    { name: 'Volume', key: 'volume', type: 'number_unit', unit: 'L', order: 2 },
    { name: 'Finish', key: 'finish', type: 'select', order: 3 },
    { name: 'Type', key: 'type', type: 'select', order: 4 },
  ] }];
  const sourceProducts = [
    { name: 'Davies Latex Paint', brand: 'Davies', color: 'yellow and green', category: 'Paint', attributes: { volume: 4, finish: 'Matte', type: 'Interior' } },
    { name: 'Davies Latex Paint', brand: 'Davies', color: 'Burgundy', category: 'Paint', attributes: { volume: 16, finish: 'Gloss', type: 'Exterior' } },
  ];
  const namedProducts = sourceProducts.map((product) => ({
    ...product,
    _inventoryTableDisplayName: `${product.name} - ${product.color}`,
  }));
  const firstName = namedProducts[0]._inventoryTableDisplayName;
  const secondName = namedProducts[1]._inventoryTableDisplayName;

  assert.equal(getInventoryProductSpecificationGroupKey(namedProducts[0], firstName, categories), getInventoryProductSpecificationGroupKey(namedProducts[1], secondName, categories));
  assert.deepEqual(getInventoryProductNameParts(sourceProducts[0], categories, firstName), {
    name: 'Davies Latex Paint',
    fullName: firstName,
    embeddedSpecifications: [{ name: 'Color', value: 'yellow and green' }],
  });
  assert.deepEqual(getInventoryProductSpecifications(sourceProducts[0], categories, firstName, namedProducts), [
    { name: 'Color', value: 'yellow and green' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications(sourceProducts[1], categories, secondName, namedProducts), [
    { name: 'Color', value: 'Burgundy' },
  ]);
});

test('Concrete Nails use only Size and Hollow Blocks use only differing thickness', () => {
  const categories = [
    { name: 'Fasteners', attributeSchemaVersion: 1, productAttributes: [
      { name: 'Size', key: 'size', type: 'text', order: 1 },
      { name: 'Material', key: 'material', type: 'text', order: 2 },
      { name: 'Finish', key: 'finish', type: 'text', order: 3 },
    ] },
    { name: 'Masonry', attributeSchemaVersion: 1, productAttributes: [
      { name: 'Thickness', key: 'thickness', type: 'number_unit', unit: 'in', order: 1 },
      { name: 'Length', key: 'length', type: 'number_unit', unit: 'in', order: 2 },
      { name: 'Material', key: 'material', type: 'text', order: 3 },
    ] },
  ];
  const nails = [
    { name: 'Concrete Nails', category: 'Fasteners', attributes: { size: '6', material: 'Steel', finish: 'Bright' } },
    { name: 'Concrete Nails', category: 'Fasteners', attributes: { size: '5', material: 'Steel', finish: 'Bright' } },
  ];
  const blocks = [
    { name: 'Hollow Blocks', category: 'Masonry', attributes: { thickness: 4, length: 16, material: 'Concrete' } },
    { name: 'Hollow Blocks', category: 'Masonry', attributes: { thickness: 6, length: 16, material: 'Concrete' } },
  ];

  assert.deepEqual(getInventoryProductSpecifications(nails[0], categories, 'Concrete Nails', nails), [{ name: 'Size', value: '6' }]);
  assert.deepEqual(getInventoryProductSpecifications(nails[1], categories, 'Concrete Nails', nails), [{ name: 'Size', value: '5' }]);
  assert.deepEqual(getInventoryProductSpecifications(blocks[0], categories, 'Hollow Blocks', blocks), [{ name: 'Thickness', value: '4 in' }]);
  assert.deepEqual(getInventoryProductSpecifications(blocks[1], categories, 'Hollow Blocks', blocks), [{ name: 'Thickness', value: '6 in' }]);
});

test('configured attributes included in displayed names move to the secondary line for variants', () => {
  const categories = [{ name: 'Panels', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Thickness', key: 'thickness', type: 'number_unit', unit: 'mm', order: 1 },
  ] }];
  const variants = [
    { name: 'Wall Panel', category: 'Panels', attributes: { thickness: 8 } },
    { name: 'Wall Panel', category: 'Panels', attributes: { thickness: 10 } },
  ];
  assert.deepEqual(getInventoryProductNameParts(variants[0], categories, 'Wall Panel 8 mm').name, 'Wall Panel');
  assert.deepEqual(getInventoryProductSpecifications(variants[0], categories, 'Wall Panel 8 mm', variants), [
    { name: 'Thickness', value: '8 mm' },
  ]);
});

test('configured values embedded in legacy names move to the secondary specification line', () => {
  const categories = [{ name: 'Paint', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Color', key: 'color', type: 'text', order: 1 },
  ] }];
  const products = [
    { name: 'Davies Latex Paint - Yellow and green', category: 'Paint', attributes: { color: 'Yellow and green' } },
    { name: 'Davies Latex Paint - Blue', category: 'Paint', attributes: { color: 'Blue' } },
  ];
  assert.equal(getInventoryProductNameParts(products[0], categories, products[0].name).name, 'Davies Latex Paint');
  assert.deepEqual(getInventoryProductSpecifications(products[0], categories, products[0].name, products), [
    { name: 'Color', value: 'Yellow and green' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications(products[1], categories, products[1].name, products), [
    { name: 'Color', value: 'Blue' },
  ]);
});

test('a unique composed product separates only the configured attribute embedded in its name', () => {
  const categories = [{ name: 'Paint', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Color', key: 'color', type: 'text' },
    { name: 'Finish', key: 'finish', type: 'text' },
  ] }];
  const product = {
    name: 'Boysen Latex Paint - Burgundy',
    category: 'Paint',
    attributes: { color: 'Burgundy', finish: 'Gloss' },
  };

  assert.deepEqual(getInventoryProductNameParts(product, categories), {
    name: 'Boysen Latex Paint',
    fullName: product.name,
    embeddedSpecifications: [{ name: 'Color', value: 'Burgundy' }],
  });
  assert.deepEqual(getInventoryProductSpecifications(product, categories), [
    { name: 'Color', value: 'Burgundy' },
  ]);
});

test('configured variant labels and values embedded in names are separated without duplicate attributes', () => {
  const categories = [{ name: 'Fasteners', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Size', key: 'size', type: 'text' },
    { name: 'Finish', key: 'finish', type: 'text' },
  ] }];
  const products = [
    { name: 'Concrete Nails Size 6', category: 'Fasteners', attributes: { size: '6', finish: 'Bright' } },
    { name: 'Concrete Nails Size 5', category: 'Fasteners', attributes: { size: '5', finish: 'Bright' } },
  ];

  assert.equal(getInventoryProductNameParts(products[0], categories).name, 'Concrete Nails');
  assert.deepEqual(getInventoryProductSpecifications(products[0], categories, products[0].name, products), [
    { name: 'Size', value: '6' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications(products[1], categories, products[1].name, products), [
    { name: 'Size', value: '5' },
  ]);
});

test('matching ignores category/name case and punctuation but never compares another category', () => {
  const categories = [
    { name: 'Paint', attributeSchemaVersion: 1, productAttributes: [{ name: 'Color', key: 'color', type: 'text' }] },
    { name: 'Tools', attributeSchemaVersion: 1, productAttributes: [{ name: 'Color', key: 'color', type: 'text' }] },
  ];
  const products = [
    { name: 'Electrical Tape', category: 'Paint', attributes: { color: 'Black' } },
    { name: ' electrical-tape ', category: ' paint ', attributes: { color: 'White' } },
    { name: 'Electrical Tape', category: 'Tools', attributes: { color: 'Red' } },
  ];
  assert.deepEqual(getInventoryProductSpecifications(products[0], categories, 'Electrical Tape', products), [
    { name: 'Color', value: 'Black' },
  ]);
  assert.deepEqual(getInventoryProductSpecifications(products[2], categories, 'Electrical Tape', products), []);
});

test('duplicate names with only common configured values show no specification subtext', () => {
  const categories = [{ name: 'Boards', attributeSchemaVersion: 1, productAttributes: [
    { name: 'Material', key: 'material', type: 'text' },
  ] }];
  const products = [
    { name: 'Plain Board', category: 'Boards', attributes: { material: 'Pine' } },
    { name: 'Plain Board', category: 'Boards', attributes: { material: 'Pine' } },
  ];
  assert.deepEqual(getInventoryProductSpecifications(products[0], categories, 'Plain Board', products), []);
  assert.deepEqual(getInventoryProductSpecifications(products[1], categories, 'Plain Board', products), []);
});

test('products without saved specs remain plain and category-configured attributes render below the existing name', async () => {
  const product = { category: 'General', name: 'Plain Item', attributes: {} };
  assert.deepEqual(getInventoryProductSpecifications(product, [{ name: 'General', attributeSchemaVersion: 1, productAttributes: [{ name: 'Finish', key: 'finish' }] }], 'Plain Item'), []);
  const source = await readInventorySource();
  assert.match(source, /categories: categoryConfigurations = \[\]/);
  assert.match(source, /getInventoryProductSpecifications\(item, categoryConfigurations, productName, sameNameProducts\)/);
  assert.match(source, /getInventoryProductNameParts\(item, categoryConfigurations, productName\)/);
  assert.match(source, /products\.forEach\(\(product\) => \{/);
  assert.doesNotMatch(source.slice(source.indexOf('const productSpecificationGroups'), source.indexOf('const closeProductDetails')), /currentItems|filteredInventory/);
  assert.match(source, /text-\[13px\] font-semibold/);
  assert.match(source, /text-\[10px\] font-normal/);
});
