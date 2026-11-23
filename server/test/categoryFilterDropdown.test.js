/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSource = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8');

test('POS category filter labels All Categories without changing its filter value', () => {
  const source = readSource('../../src/pages/PointOfSale.jsx');
  const toolbarStart = source.indexOf('<ToolbarDropdown');
  const dropdown = source.slice(toolbarStart, source.indexOf('/>', toolbarStart));

  assert.match(source, /value: category,\s*label: category === 'All' \? 'All Categories' : category/);
  assert.ok(dropdown.includes('ariaLabel="Filter POS products by category"'));
  assert.ok(dropdown.includes('portalMenu'));
  assert.ok(dropdown.includes('fitSelectedValue'));
});

test('Special Orders status filter labels All Statuses and preserves existing status values', () => {
  const source = readSource('../../src/pages/SpecialOrders.jsx');
  const toolbarStart = source.indexOf('<ToolbarDropdown');
  const dropdown = source.slice(toolbarStart, source.indexOf('/>', toolbarStart));

  assert.match(source, /const statusOptions = \['All', 'Pending', 'In Progress', 'Completed', 'Cancelled'\]/);
  assert.ok(dropdown.includes("value: status"));
  assert.ok(dropdown.includes("label: status === 'All' ? 'All Statuses' : status"));
  assert.ok(dropdown.includes('onChange={setStatusFilter}'));
  for (const prop of ['portalMenu', 'fitSelectedValue', 'softForeground', 'focusVisibleRing']) {
    assert.ok(dropdown.includes(prop), `Special Orders should enable ${prop}`);
  }
});

test('Inventory and Product Master category filters use the shared POS dropdown presentation', () => {
  for (const [file, optionsName, label] of [
    ['../../src/pages/Inventory.jsx', 'categories', 'Filter inventory by category'],
    ['../../src/pages/ProductList.jsx', 'categoryFilterOptions', 'Filter products by category'],
  ]) {
    const source = readSource(file);
    const toolbarStart = source.indexOf('<ToolbarDropdown');
    const dropdown = source.slice(toolbarStart, source.indexOf('/>', toolbarStart));

    assert.match(source, /import ToolbarDropdown from '\.\.\/components\/ToolbarDropdown'/);
    assert.ok(dropdown.includes(`options={${optionsName}.map((category) => ({`));
    assert.ok(dropdown.includes("value: category"));
    assert.ok(dropdown.includes("label: category === 'All' ? 'All Categories' : category"));
    assert.ok(dropdown.includes(`ariaLabel="${label}"`));
    for (const prop of ['portalMenu', 'fitSelectedValue', 'softForeground', 'focusVisibleRing']) {
      assert.ok(dropdown.includes(prop), `${file} should enable ${prop}`);
    }
    assert.ok(dropdown.includes('min-w-[min(16rem,calc(100vw-1rem))]'));
    assert.ok(dropdown.includes('max-h-[min(50vh,20rem)]'));
  }
});

test('fitted dropdown labels remain content-sized on desktop and viewport-capped on small screens', () => {
  const source = readSource('../../src/components/ToolbarDropdown.jsx');

  assert.match(source, /fitSelectedValue = false/);
  assert.match(source, /w-fit max-w-full/);
  assert.match(source, /max-w-\[calc\(100vw-4rem\)\] truncate md:max-w-none md:whitespace-nowrap/);
  assert.match(source, /createPortal\(menu, document\.body\)/);
});
