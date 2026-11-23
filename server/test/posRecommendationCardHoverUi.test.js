/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const posSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/PointOfSale.jsx'), 'utf8');
const recommendationSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Recommendation.jsx'), 'utf8');
const styleSource = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');

test('POS selectable product cards reuse the dashboard lift and shadow treatment', () => {
  assert.match(posSource, /shadow-sm transition-all duration-300 motion-reduce:transition-none[\s\S]*?hover:-translate-y-1[\s\S]*?hover:shadow-lg/);
  assert.match(posSource, /focus-visible:ring-2 focus-visible:ring-slate-500\/40/);
});

test('POS out-of-stock cards retain status feedback without the selectable-card lift', () => {
  assert.match(posSource, /border border-slate-100 bg-white/);
  assert.match(posSource, /isOutOfStock\s*\?\s*'border-slate-100 hover:border-red-400 hover:bg-red-50\/20 hover:shadow-md'/);
  assert.match(posSource, /isOutOfStock\s*\?\s*'border-slate-100 hover:border-red-400 hover:bg-red-50\/20 hover:shadow-md'\s*:\s*isLowStock\s*\?\s*'transform hover:-translate-y-1 hover:border-amber-400/);
});

test('recommendation information cards use shadow-only feedback while selectable alternatives lift', () => {
  assert.match(recommendationSource, /recommendation-current-summary[^\n]*shadow-sm transition-all duration-300 hover:shadow-lg motion-reduce:transition-none/);
  assert.match(recommendationSource, /recommendation-option-card[^\n]*shadow-sm transition-all duration-300 hover:border-slate-500 hover:shadow-xl motion-reduce:transition-none/);
  assert.match(styleSource, /html\.dark \.recommendation-option-card:hover[\s\S]*box-shadow: 0 8px 18px rgb\(2 6 23 \/ 0\.34\) !important/);
  assert.match(recommendationSource, /cursor-pointer hover:-translate-y-1 hover:shadow-lg motion-reduce:hover:translate-y-0/);
});
