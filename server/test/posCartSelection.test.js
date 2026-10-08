const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadCartSelection = () => import('../../src/utils/cartSelection.js');

const cart = [
  { code: 'SKU-001', qty: 2, price: 125 },
  { code: 'SKU-002', qty: 1, price: 85 },
  { code: 'SKU-003', qty: 4, price: 50 },
];

test('cart selection toggles one line without affecting cart quantities', async () => {
  const { toggleCartItemSelection } = await loadCartSelection();

  assert.deepEqual(toggleCartItemSelection([], 'SKU-001'), ['SKU-001']);
  assert.deepEqual(toggleCartItemSelection(['SKU-001'], 'SKU-001'), []);
  assert.deepEqual(toggleCartItemSelection(['SKU-001'], 'SKU-002'), ['SKU-001', 'SKU-002']);
  assert.equal(cart[0].qty, 2);
});

test('Select All selects current cart lines and toggles back to none', async () => {
  const { toggleAllCartItemSelections } = await loadCartSelection();

  const allSelected = toggleAllCartItemSelections(['SKU-001'], cart);
  assert.deepEqual(allSelected, ['SKU-001', 'SKU-002', 'SKU-003']);
  assert.deepEqual(toggleAllCartItemSelections(allSelected, cart), []);
});

test('bulk removal filters only selected current cart lines', async () => {
  const { removeSelectedCartItems } = await loadCartSelection();

  assert.deepEqual(
    removeSelectedCartItems(cart, ['SKU-001', 'SKU-003']).map((item) => item.code),
    ['SKU-002'],
  );
  assert.deepEqual(removeSelectedCartItems(cart, cart.map((item) => item.code)), []);
});

test('POS keeps selection controls opt-in and preserves the existing cart controls', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
  const cartPanel = source.slice(source.indexOf('/* Right Side: Cart / Order Summary */'), source.indexOf('/* Quotation Input Modal */'));
  const orderHeader = source.slice(source.indexOf('/* Current Order Header */'), source.indexOf('/* Cart List Management */'));
  const listManagement = source.slice(source.indexOf('/* Cart List Management */'), source.indexOf('/* Cart Item List */'));

  assert.doesNotMatch(orderHeader, />Select</);
  assert.match(orderHeader, /Credit Mode/);
  assert.match(orderHeader, /Cash Mode/);
  assert.match(orderHeader, /\{cart\.reduce\(\(acc, item\) => acc \+ item\.qty, 0\)\} items/);
  assert.match(listManagement, /\{cart\.length > 0 && \(/);
  assert.match(cartPanel, /onClick=\{\(\) => setIsCartSelectionMode\(true\)\}/);
  assert.match(cartPanel, /\{isCartSelectionMode && \(/);
  assert.match(cartPanel, /type="checkbox"/);
  assert.match(cartPanel, /if \(isCartSelectionMode\) toggleCartSelection\(item\.code\)/);
  assert.match(cartPanel, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(cartPanel, /\{!isCartSelectionMode && <button onClick=\{\(\) => removeFromCart\(item\.code\)\}/);
  assert.match(cartPanel, /onClick=\{\(\) => updateQuantity\(item\.code, item\.qty - 1\)\}/);
  assert.match(cartPanel, /onClick=\{\(\) => updateQuantity\(item\.code, item\.qty \+ 1\)\}/);
  assert.match(source, /Remove \{selectedCartItemCount\} items\?/);
});
