/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
const productList = fs.readFileSync(path.resolve(__dirname, '../../src/pages/ProductList.jsx'), 'utf8');
const creditTransactions = fs.readFileSync(path.resolve(__dirname, '../../src/pages/CreditTransactions.jsx'), 'utf8');
const inventory = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Inventory.jsx'), 'utf8');
const specialOrders = fs.readFileSync(path.resolve(__dirname, '../../src/pages/SpecialOrders.jsx'), 'utf8');
const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Dashboard.jsx'), 'utf8');
const partners = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Partners.jsx'), 'utf8');
const settings = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Settings.jsx'), 'utf8');
const pos = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
const profile = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Profile.jsx'), 'utf8');

test('shared navy primary feedback matches the Add Product hover treatment', () => {
  assert.match(productList, /transition-all hover:opacity-90 transform hover:-translate-y-0\.5/);
  assert.match(productList, /product-list-add-action[^"]*text-white/);
  assert.match(productList, /style=\{\{ backgroundColor: '#111827'/);
  assert.match(css, /product-list-add-action[\s\S]*color: var\(--color-white\)/);
  assert.match(css, /transition-duration: 150ms;\s*transition-timing-function: cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*opacity: 0\.9;\s*translate: 0 -0\.125rem/);
});

test('solid navy actions share the Add Product foreground without altering disabled, loading, selected, or inverse dark controls', () => {
  assert.match(css, /product-list-manage-variants-action"\], \[class~="credit-record-payment-action"\], \[class~="history-labeled-action--primary"\]/);
  assert.match(css, /\[class~="bg-gray-900"\], \[class~="bg-slate-900"\], \[class~="bg-\[#111827\]"\]/);
  assert.match(css, /:not\(:disabled\):not\(\[aria-disabled="true"\]\):not\(\[aria-busy="true"\]\)/);
  assert.match(css, /:not\(\[role="tab"\]\):not\(\[aria-pressed="true"\]\):not\(\[aria-selected="true"\]\)/);
  assert.match(css, /:not\(\[class~="dark:bg-slate-100"\]\):not\(\[class~="dark:bg-gray-100"\]\):not\(\[class~="dark:bg-white"\]\)/);
  assert.match(css, /:where\(svg, span\)\s*\{\s*color: inherit;/);
});

test('shared button feedback skips disabled, loading, and selected control states', () => {
  assert.match(css, /not\(:disabled\):not\(\[aria-disabled="true"\]\):not\(\[aria-busy="true"\]\)/);
  assert.match(css, /not\(\[class~="cursor-wait"\]\):not\(\[class~="cursor-not-allowed"\]\)/);
  assert.match(css, /not\(\[role="tab"\]\):not\(\[aria-pressed="true"\]\):not\(\[aria-selected="true"\]\)/);
});

test('outlined secondary buttons use neutral hover feedback and destructive colors are excluded', () => {
  assert.match(css, /\[class~="bg-white"\]\[class\*="border"\][\s\S]*not\(\[class\*="rose-"\]\)/);
  assert.match(css, /not\(\[class\*="rose-"\]\):not\(\[class\*="red-"\]\)/);
  assert.match(css, /not\(\[class\*="blue-"\]\):not\(\[class\*="sky-"\]\)/);
  assert.match(css, /border-color: #94a3b8;\s*background-color: #f8fafc/);
});

test('reduced-motion preferences suppress button transitions and hover movement', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important[\s\S]*button:is\(\.table-action-button[\s\S]*translate: none !important/);
});

test('shared action transitions are scoped to buttons with action or existing hover styling', () => {
  assert.match(css, /button:is\(\.table-action-button, \.archive-toggle-button, \[class\*="-action"\], \[type="submit"\], \[class\*="transition-"\], \[class\*="hover:"\]\)/);
  assert.doesNotMatch(css, /^button:not\(:disabled\)/m);
  assert.match(css, /transition: all 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\) !important/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*main-data-table \.table-action-button\.history-labeled-action--primary:hover:not\(:disabled\)/);
  assert.doesNotMatch(css, /history-labeled-action--primary:hover:not\(:disabled\)[\s\S]*background: #334155/);
});

test('inline navy actions reuse the shared effect and loading/disabled buttons are not made interactive', () => {
  assert.match(dashboard, /app-primary-action w-full py-2 rounded-xl/);
  assert.match(inventory, /app-primary-action w-full py-3 rounded-xl/);
  assert.match(partners, /app-primary-action px-5 py-2\.5 rounded-xl/);
  assert.match(settings, /app-primary-action w-full px-4 py-2 rounded-xl/);
  assert.doesNotMatch(settings, /hover:scale-105/);
  assert.match(css, /app-primary-action[\s\S]*not\(:disabled\):not\(\[aria-disabled="true"\]\):not\(\[aria-busy="true"\]\)/);
});

test('image preview and profile-photo buttons use the same restrained action hover instead of scaling', () => {
  assert.match(inventory, /group\/photo[^"]*transition-all hover:opacity-90 hover:-translate-y-0\.5/);
  assert.match(productList, /group\/photo[^"]*transition-all hover:opacity-90 hover:-translate-y-0\.5/);
  assert.match(pos, /cursor-zoom-in transition-all hover:opacity-90 hover:-translate-y-0\.5/);
  assert.match(profile, /absolute -bottom-1 -right-1[\s\S]*transition-all hover:opacity-90 hover:-translate-y-0\.5[\s\S]*aria-label="Change profile photo"/);
});

test('Special Order rows keep View Details visible and place other actions in the shared secondary menu', () => {
  assert.match(specialOrders, /action\.primary \|\| action\.label === 'View Details'[\s\S]*border-slate-900 bg-slate-900 text-white/);
  assert.match(specialOrders, /secondaryActions\.length > 0 && \([\s\S]*<SpecialOrderActionMenu/);
  assert.match(specialOrders, /label: 'View Transaction', icon: 'file-text'/);

  assert.match(creditTransactions, /credit-record-payment-action/);
  assert.match(creditTransactions, /disabled=\{!canRecordPayment\}[\s\S]*canRecordPayment \? 'border-slate-900 bg-slate-900 text-white/);
  assert.match(creditTransactions, /label="Extend Day Term"[\s\S]*label="Record Payment"/);
  assert.match(css, /\.table-action-button\.credit-record-payment-action:not\(:disabled\)[\s\S]*background: #111827 !important;[\s\S]*color: var\(--color-white\) !important;/);

  assert.match(productList, /product-list-manage-variants-action reference-table-action[\s\S]*label="Manage Variants"[\s\S]*Manage Variants/);
  assert.match(productList, /w-\[13%\]/);
  assert.match(css, /\.table-action-button\.product-list-manage-variants-action[\s\S]*background: #111827 !important;/);

  assert.match(inventory, /handleOpenStockModal\(item, 'IN'\)[\s\S]*bg-gray-900[\s\S]*Add Stock/);
  assert.match(inventory, /handleOpenStockModal\(item, 'OUT'\)[\s\S]*border-slate-300 bg-white text-slate-800[\s\S]*Remove Stock/);
});

test('History and Product Master desktop table actions reuse Special Orders reference proportions', () => {
  assert.match(css, /@media \(min-width: 768px\)[\s\S]*\.table-action-button\.reference-table-action[\s\S]*height: 1\.875rem !important;[\s\S]*gap: 0\.25rem !important;[\s\S]*padding: 0 0\.5rem !important;[\s\S]*font-family: inherit !important;[\s\S]*font-size: 0\.625rem !important;[\s\S]*font-weight: 600 !important;[\s\S]*line-height: 1 !important;[\s\S]*white-space: nowrap !important/);
  assert.match(css, /reference-table-action svg[\s\S]*width: 0\.875rem !important;[\s\S]*height: 0\.875rem !important;[\s\S]*stroke-width: 1\.75px !important/);
});
