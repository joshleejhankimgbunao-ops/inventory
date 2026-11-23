/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pointOfSaleSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'),
  'utf8',
);
const globalStylesSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/index.css'),
  'utf8',
);

const getOrderListSection = () => {
  const start = pointOfSaleSource.indexOf("{checkoutPhase === 'order-list' && (");
  const end = pointOfSaleSource.indexOf("{checkoutPhase === 'payment'", start);
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

test('Order List uses its close control for cart navigation and keeps only print and payment actions', () => {
  const orderList = getOrderListSection();
  const footer = orderList.match(/<footer[^>]*>([\s\S]*?)<\/footer>/)?.[0] || '';

  assert.match(orderList, /onClick=\{\(\) => setCheckoutPhase\(null\)\}[\s\S]*?aria-label="Back to POS cart"/);
  assert.match(footer, /grid grid-cols-2/);
  assert.doesNotMatch(footer, /Back to Cart/);
  assert.match(footer, /Print Order List/);
  assert.match(footer, /Proceed to Payment/);
  assert.match(orderList, /disabled=\{printStatus === 'printing' \|\| cart\.length === 0 \|\| posBatchPickLoading\}/);
  assert.match(orderList, /disabled=\{cart\.length === 0 \|\| posBatchPickLoading\}[\s\S]*?Proceed to Payment/);
});

test('Payment uses its close control to return to Order List and keeps only the payment action', () => {
  const payment = pointOfSaleSource.slice(
    pointOfSaleSource.indexOf("{checkoutPhase === 'payment' && !isQuickAddCreditCustomerOpen"),
    pointOfSaleSource.indexOf('{/* Legacy post-sale preview kept inactive'),
  );
  assert.match(payment, /onClick=\{\(\) => setCheckoutPhase\('order-list'\)\}[^>]*aria-label="Back to order list"/);
  const footer = payment.match(/<footer[^>]*>([\s\S]*?)<\/footer>/)?.[0] || '';
  assert.match(footer, /flex justify-end/);
  assert.doesNotMatch(footer, /Back to Order List/);
  assert.match(footer, /Confirm & Process Payment/);
  assert.match(payment, /onClick=\{\(\) => handlePaymentTypeChange\('cash'\)\}[\s\S]*?Cash[\s\S]*?onClick=\{\(\) => handlePaymentTypeChange\('credit'\)\}[\s\S]*?Credit/);
  assert.match(pointOfSaleSource, /const proceedToPayment = \(\) => \{[\s\S]*?setCheckoutPhase\('payment'\);/);
});

test('non-empty Order Lists retain their existing item controls', () => {
  const orderList = getOrderListSection();

  assert.match(orderList, /: cart\.map\(\(item\) => \(/);
  assert.match(orderList, /<ProductThumbnail item=\{item\} className="row-span-2 h-12 w-12 self-start rounded-lg sm:row-span-1 sm:self-auto" onPreview=\{handleProductImagePreviewClick\} fit="contain" \/>/);
  assert.match(orderList, /SKU: \{item\.code\}/);
  assert.match(orderList, /getOrderListVariationDetails\(item, categoryDefinitions\)/);
  assert.match(pointOfSaleSource, /const getOrderListVariationDetails =/);
  assert.match(pointOfSaleSource, /\['Color', item\?\.color\]/);
  assert.match(orderList, /updateQuantity\(item\.code, item\.qty - 1\)/);
  assert.match(orderList, /updateQuantity\(item\.code, item\.qty \+ 1\)/);
  assert.match(orderList, /removeFromCart\(item\.code\)/);
});

test('Order List thumbnails reuse the existing image fallback and remain separate from the print handler', () => {
  const printHandlerStart = pointOfSaleSource.indexOf('const handlePrintOrderList =');
  const printHandlerEnd = pointOfSaleSource.indexOf('\n    };', printHandlerStart);
  const printHandler = pointOfSaleSource.slice(printHandlerStart, printHandlerEnd);

  assert.match(pointOfSaleSource, /const ProductThumbnail =/);
  assert.match(pointOfSaleSource, /if \(imageUrl && !imageFailed\)/);
  assert.match(pointOfSaleSource, /className="h-7 w-7 text-slate-300"/);
  assert.ok(printHandlerStart >= 0);
  assert.doesNotMatch(printHandler, /ProductThumbnail/);
  assert.match(printHandler, /documentType: 'order-list-draft'/);
});

test('Order List uses a slate scroll area, spaced white item cards, and hover-capable-only card emphasis', () => {
  const orderList = getOrderListSection();

  assert.match(orderList, /pos-order-list-scroll-area min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5/);
  assert.match(orderList, /pos-order-list-item-card grid[\s\S]*?border border-slate-200 bg-white[\s\S]*?shadow-sm/);
  assert.match(orderList, /pos-order-list-item-controls col-start-2 flex/);
  assert.match(globalStylesSource, /\.pos-order-list-scroll-area\s*\{\s*background-color:\s*#F1F5F9;\s*\}/);
  assert.match(globalStylesSource, /\.pos-order-list-item-card\s*\{\s*transition:\s*all 300ms cubic-bezier\(0\.4, 0, 0\.2, 1\);\s*\}/);
  assert.match(globalStylesSource, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{\s*\.pos-order-list-item-card:not\(:has\(\.pos-order-list-item-controls:hover, \.pos-order-list-item-controls:focus-within\)\):hover\s*\{/);
  assert.match(globalStylesSource, /border-color:\s*#111827;\s*box-shadow:\s*0 10px 15px -3px rgb\(0 0 0 \/ 0\.1\), 0 4px 6px -4px rgb\(0 0 0 \/ 0\.1\);\s*transform:\s*translateY\(-0\.25rem\);/);
  assert.match(globalStylesSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.pos-order-list-item-card\s*\{\s*transition:\s*none;/);
});
