/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pointOfSaleSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'),
  'utf8',
);

const getOrderListSection = () => {
  const start = pointOfSaleSource.indexOf("{checkoutPhase === 'order-list' && (");
  const end = pointOfSaleSource.indexOf("{(checkoutPhase === 'payment'", start);
  assert.notEqual(start, -1, 'Order List modal should exist');
  assert.notEqual(end, -1, 'Payment modal should follow the Order List modal');
  return pointOfSaleSource.slice(start, end);
};

test('Order List renders a concise empty state when its cart is empty', () => {
  const orderList = getOrderListSection();

  assert.match(orderList, /cart\.length === 0 \? \(/);
  assert.match(orderList, /No products in this order yet\./);
  assert.match(orderList, /Add items from the product list to continue\./);
  assert.match(orderList, /aria-hidden="true"/);
});

test('Order List keeps navigation available and guards empty-order actions', () => {
  const orderList = getOrderListSection();

  assert.match(orderList, /Back to Cart/);
  assert.match(orderList, /disabled=\{printStatus === 'printing' \|\| cart\.length === 0\}/);
  assert.match(orderList, /disabled=\{cart\.length === 0\}[\s\S]*?Proceed to Payment/);
  assert.match(orderList, /aria-label="Back to POS cart"/);
});

test('non-empty Order Lists retain their existing item controls', () => {
  const orderList = getOrderListSection();

  assert.match(orderList, /: cart\.map\(\(item\) => \(/);
  assert.match(orderList, /updateQuantity\(item\.code, item\.qty - 1\)/);
  assert.match(orderList, /updateQuantity\(item\.code, item\.qty \+ 1\)/);
  assert.match(orderList, /removeFromCart\(item\.code\)/);
});
