/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'src/App.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'src/utils/toastHelper.jsx'), 'utf8');
const mobileBreakpoint = '@media (max-width: 767px) {';
const [baseCss, mobileCss = ''] = css.split(mobileBreakpoint);

test('desktop toast container keeps React Hot Toast default insets', () => {
  assert.match(app, /containerClassName="app-toaster"/);
  assert.doesNotMatch(baseCss, /\.app-toaster\s*\{/);
  assert.match(mobileCss, /\.app-toaster\s*\{[\s\S]*?left:\s*max\(12px, env\(safe-area-inset-left\)\)/);
});

test('glass contrast and mobile toast placement are scoped below 768px', () => {
  assert.doesNotMatch(baseCss, /\.app-toast-(?:bar|icon|glass|title|message|close)\s*\{/);
  assert.match(mobileCss, /\.app-toast-glass\s*\{[\s\S]*?background-color:\s*rgb\(15 23 42 \/ 0\.9\)/);
  assert.match(mobileCss, /\.app-toast-bar\s*\{\s*color:\s*#CBD5E1\s*;/);
  assert.match(mobileCss, /\.app-toast-title\s*\{\s*color:\s*#E2E8F0\s*;/);
  assert.match(mobileCss, /\.app-toast-message\s*\{\s*color:\s*#CBD5E1\s*;/);
  assert.match(mobileCss, /\.app-toast-close\s*\{\s*color:\s*#CBD5E1\s*;/);
  assert.match(mobileCss, /\.app-toast-bar button\[aria-label="Dismiss notification"\]\s*\{\s*color:\s*#CBD5E1\s*;/);
});

test('desktop standard toast colors and custom-toast text classes remain unchanged', () => {
  assert.match(app, /success:\s*\{\s*iconTheme:\s*\{\s*primary:\s*'#fff',\s*secondary:\s*'#000'/);
  assert.match(app, /error:\s*\{\s*iconTheme:\s*\{\s*primary:\s*'#fff',\s*secondary:\s*'#000'/);
  assert.match(app, /className="[^"]*text-white\/65[^"]*"[\s\S]*?aria-label="Dismiss notification"/);
  assert.match(helper, /app-toast-title text-sm font-semibold text-slate-100/);
  assert.match(helper, /app-toast-message mt-0\.5 text-xs text-slate-300\/90/);
  assert.match(helper, /app-toast-close inline-flex[^\n]*text-slate-300\/80/);
});
