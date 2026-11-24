/* global require, __dirname, module */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const loadImage = () => {
  const filename = path.join(root, 'src/components/RemoteProductImage.jsx');
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  const nativeRequire = compiled.require.bind(compiled);
  compiled.require = (id) => id === '../context/InventoryContext'
    ? { useInventory: () => ({ ensureInventoryImages: async () => new Map(), productImageRevisions: {} }) }
    : nativeRequire(id);
  compiled._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code, filename);
  return compiled.exports.default;
};

test('remote product image keeps a fixed placeholder and decodes loaded images asynchronously', () => {
  const RemoteProductImage = loadImage();
  const placeholder = renderToStaticMarkup(React.createElement(RemoteProductImage, {
    product: { id: '665000000000000000000001', name: 'Tape' },
    className: 'h-12 w-12',
    onPreview: () => {},
  }));
  assert.match(placeholder, /disabled=""/);
  assert.match(placeholder, /aria-label="No image for Tape"/);
  assert.match(placeholder, /h-12 w-12/);

  const loaded = renderToStaticMarkup(React.createElement(RemoteProductImage, {
    product: { id: '665000000000000000000001', name: 'Tape', imageUrl: 'https://images.example.test/tape.jpg' },
    className: 'h-12 w-12',
    onPreview: () => {},
  }));
  assert.match(loaded, /src="https:\/\/images\.example\.test\/tape\.jpg"/);
  assert.match(loaded, /loading="eager"/);
  assert.match(loaded, /decoding="async"/);
  assert.match(loaded, /Enlarge image for Tape/);
  const decorative = renderToStaticMarkup(React.createElement(RemoteProductImage, {
    product: { id: '665000000000000000000001', imageUrl: 'https://images.example.test/tape.jpg' },
    decorative: true,
  }));
  assert.match(decorative, /<div[^>]+aria-hidden="true"/);
  assert.doesNotMatch(decorative, /<button/);
});

test('image loading is wired to visible Product Master, POS and Inventory images, and selected Special Order products', () => {
  const component = read('src/components/RemoteProductImage.jsx');
  const productList = read('src/pages/ProductList.jsx');
  const pos = read('src/pages/PointOfSale.jsx');
  const inventory = read('src/pages/Inventory.jsx');
  const specialOrders = read('src/pages/SpecialOrders.jsx');
  const productFamily = read('src/components/ProductFamilyModal.jsx');
  const recommendation = read('src/pages/Recommendation.jsx');
  const dashboard = read('src/pages/Dashboard.jsx');
  const recommendationController = read('server/src/controllers/recommendationController.js');
  const productController = read('server/src/controllers/productController.js');
  const realtime = read('server/src/services/realtimeService.js');

  assert.match(component, /new IntersectionObserver/);
  assert.match(component, /rootMargin: '240px 0px'/);
  assert.match(component, /ensureInventoryImages\(\{ productIds: requestIds \}\)/);
  assert.match(productList, /<RemoteProductImage[\s\S]*?products=\{family\.variants\}/);
  assert.match(productList, /ensureInventoryImages\(\{ productIds: \[productId\] \}\)/);
  assert.match(productList, /else delete localUpdatedProduct\.imageUrl/);
  assert.match(pos, /const ProductThumbnail = [\s\S]*?<RemoteProductImage/);
  assert.match(pos, /<CatalogProductImageButton item=\{item\}/);
  assert.match(inventory, /<RemoteProductImage[\s\S]*?product=\{item\}/);
  assert.match(specialOrders, /ensureInventoryImages\(\{ productIds: \[id\] \}\)/);
  assert.match(productFamily, /<RemoteProductImage[\s\S]*?products=\{getFamilyImageCandidates\(family\.variants\)\}/);
  assert.match(productFamily, /const VariantPhoto = \(\{ variant, onPreview \}\) => \([\s\S]*?<RemoteProductImage/);
  assert.match(recommendation, /const RecommendationThumbnail = \(\{ item,[\s\S]*?<RemoteProductImage/);
  assert.match(recommendationController, /Product\.find\(\{ isActive: \{ \$ne: false \} \}\)[\s\S]*?\.select\('-imageUrl'\)/);
  assert.match(read('src/services/inventoryApi.js'), /Object\.prototype\.hasOwnProperty\.call\(product \|\| \{\}, 'imageUrl'\)/);
  assert.match(realtime, /typeof imageChanged === 'boolean' \? \{ imageChanged \}/);
  assert.match(productController, /reason: 'product\.updated',[\s\S]*?productIds: \[product\._id\],[\s\S]*?imageChanged: String\(existing\.imageUrl \|\| ''\) !== String\(product\.imageUrl \|\| ''\)/);
  assert.match(read('src/context/InventoryContext.jsx'), /payload\.reason === 'product\.updated' && payload\.imageChanged === true/);
  assert.doesNotMatch(dashboard, /ensureInventoryImages/);
});
