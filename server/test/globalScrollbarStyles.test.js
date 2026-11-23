/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const appStyles = fs.readFileSync(path.join(root, 'src/App.css'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.jsx'), 'utf8');
const pos = fs.readFileSync(path.join(root, 'src/pages/PointOfSale.jsx'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'src/pages/Profile.jsx'), 'utf8');
const productFamily = fs.readFileSync(path.join(root, 'src/components/ProductFamilyModal.jsx'), 'utf8');

test('global scrollbar styling uses slim neutral tracks and thumbs across themes', () => {
  assert.match(styles, /--app-scrollbar-thumb:\s*#cbd5e1/);
  assert.match(styles, /--app-scrollbar-thumb-hover:\s*#94a3b8/);
  assert.match(styles, /html\.dark\s*\{[\s\S]*?--app-scrollbar-thumb:\s*#94a3b8;[\s\S]*?--app-scrollbar-thumb-hover:\s*#64748b;/);
  assert.match(styles, /scrollbar-width:\s*thin/);
  assert.match(styles, /scrollbar-color:\s*var\(--app-scrollbar-thumb\) transparent/);
  assert.match(styles, /\*::-webkit-scrollbar\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;/s);
  assert.match(styles, /\*::-webkit-scrollbar-track,[\s\S]*?\*::-webkit-scrollbar-corner\s*\{\s*background:\s*transparent/);
  assert.match(styles, /\*::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/s);
  assert.match(styles, /\*::-webkit-scrollbar-thumb:hover\s*\{\s*background-color:\s*var\(--app-scrollbar-thumb-hover\)/);
  assert.doesNotMatch(styles, /scrollbar-color:\s*#4b5563|html\.dark\s*::-webkit-scrollbar/);
});

test('ordinary sidebar, POS, and profile scroll areas use the shared scrollbar treatment', () => {
  assert.match(dashboard, /data-dashboard-scroll-container className=\{`flex-1 overflow-y-auto overflow-x-hidden/);
  assert.doesNotMatch(dashboard, /scrollbar-hide/);
  assert.doesNotMatch(pos, /overflow-y-auto[^\n]*no-scrollbar/);
  assert.doesNotMatch(profile, /overflow-y-auto no-scrollbar/);
  // The hidden source is paired with a separate synchronized visible table rail.
  assert.match(productFamily, /className="no-scrollbar hidden[^\n]*overflow-x-auto/);
  assert.match(productFamily, /aria-label="Scroll variants table horizontally"/);
  assert.match(appStyles, /\.no-scrollbar::-webkit-scrollbar/);
});
