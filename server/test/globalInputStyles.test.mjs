import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
const profile = await readFile(new URL('../../src/pages/Profile.jsx', import.meta.url), 'utf8');
const productAttributes = await readFile(new URL('../../src/components/ProductAttributeFields.jsx', import.meta.url), 'utf8');

test('editable controls share light and dark neutral field tokens', () => {
  assert.match(styles, /--app-field-bg:\s*#f5f7fa/);
  assert.match(styles, /--app-field-border:\s*#d7dee8/);
  assert.match(styles, /html\.dark\s*\{[\s\S]*?--app-field-bg:\s*#232428;[\s\S]*?--app-field-border:\s*#3c3f45;/);
  assert.match(styles, /input\.login-input/);
  assert.match(styles, /select:not\(\.recommendation-filter-select\)/);
  assert.match(styles, /textarea:not\(\[class~="border-0"\]\)/);
  assert.match(styles, /not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(styles, /not\(\[class~="bg-transparent"\]\)/);
});

test('shared controls define hover, focus, disabled, read-only, and validation states', () => {
  assert.match(styles, /:hover:not\(:disabled\):not\(\[readonly\]\)/);
  assert.match(styles, /:focus-visible\s*\{\s*box-shadow: 0 0 0 3px var\(--app-field-focus-ring\)/);
  assert.match(styles, /\[readonly\][\s\S]*?--app-field-readonly-bg/);
  assert.match(styles, /\):disabled\s*\{[\s\S]*?--app-field-disabled-bg/);
  assert.match(styles, /\[aria-invalid="true"\][\s\S]*?--app-field-error-bg/);
});

test('borderless composite fields keep one shared field shell', () => {
  assert.match(styles, /\.app-input-group\s*\{[\s\S]*?--app-field-bg[\s\S]*?--app-field-border/);
  assert.match(profile, /app-input-group flex items-center/g);
  assert.match(productAttributes, /app-input-group flex overflow-hidden/);
});
