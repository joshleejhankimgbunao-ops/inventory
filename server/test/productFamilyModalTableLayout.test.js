/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modalSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ProductFamilyModal.jsx'), 'utf8');

test('Manage Variants keeps its modal frame fixed and scrolls wide tables inside the table container', () => {
  assert.match(modalSource, /max-h-\[90vh\].*overflow-hidden.*xl:max-w-6xl/);
  assert.match(modalSource, /min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/);
  assert.match(modalSource, /bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800/);
  assert.match(modalSource, /min-w-0 max-w-full overflow-x-auto overscroll-x-contain/);
  assert.match(modalSource, /<table className="w-max min-w-full table-auto text-left">/);
});

test('Manage Variants table header matches the Stock Operations navy header tokens', () => {
  assert.match(modalSource, /<tr className="bg-gray-900 text-white uppercase tracking-wider dark:bg-gray-700">/);
  assert.match(modalSource, /border border-gray-700 px-3 py-2 text-center text-\[11px\] font-semibold">Photo/);
  assert.match(modalSource, /min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-\[11px\] font-semibold/);
  assert.match(modalSource, /min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-center text-\[11px\] font-semibold">Stock Status/);
});

test('Manage Variants keeps data columns and status badges on one line with room for actions', () => {
  assert.match(modalSource, /min-w-32 whitespace-nowrap border border-gray-700 px-3 py-2 text-\[11px\] font-semibold">\{definition\.name\}/);
  assert.match(modalSource, /min-w-40 whitespace-nowrap border border-gray-700 px-3 py-2 text-\[11px\] font-semibold">SKU/);
  assert.match(modalSource, /IdentifierChip className="max-w-none whitespace-nowrap break-normal"/);
  assert.match(modalSource, /inline-flex whitespace-nowrap rounded-full border/);
  assert.match(modalSource, /inline-flex whitespace-nowrap rounded-full px-2 py-1 text-\[10px\] font-semibold/);
  assert.match(modalSource, /min-w-32 whitespace-nowrap border border-gray-700[^>]*>Actions/);
  assert.match(modalSource, /flex flex-nowrap items-center justify-center gap-3/);
  assert.match(modalSource, /inline-flex h-8 w-8 shrink-0 items-center justify-center/);
});

test('Manage Variants keeps one synchronized horizontal scrollbar and pagination in the fixed footer', () => {
  assert.match(modalSource, /variantTableScrollMetrics\.hasOverflow && \(/);
  assert.match(modalSource, /aria-label="Scroll variants table horizontally"/);
  assert.match(modalSource, /style=\{\{ width: `\$\{variantTableScrollMetrics\.scrollWidth\}px` \}\}/);
  assert.match(modalSource, /<footer className="shrink-0 border-t border-slate-200 bg-slate-50/);
  assert.match(modalSource, /h-4 min-w-0 max-w-full overflow-x-auto overflow-y-hidden/);
  assert.match(modalSource, /className="no-scrollbar hidden min-w-0 max-w-full overflow-x-auto/);
  assert.match(modalSource, /onScroll=\{\(\) => syncVariantTableScroll\(variantTableFooterScrollRef, variantTableScrollRef\)\}/);
  assert.match(modalSource, /onScroll=\{\(\) => syncVariantTableScroll\(variantTableScrollRef, variantTableFooterScrollRef\)\}/);
  assert.doesNotMatch(modalSource, /variantTableTopScrollRef|topScrollbar/);
  assert.doesNotMatch(modalSource, /variantTableStickyScrollRef|sticky bottom-0/);
  assert.equal((modalSource.match(/aria-label="Scroll variants table horizontally"/g) || []).length, 1);
  assert.match(modalSource, /Showing \{pageStartIndex \+ 1\}[\s\S]*?<Pagination/);
  assert.doesNotMatch(modalSource, />\s*Close\s*<\/button>/);
  assert.match(modalSource, /new ResizeObserver\(measureScrollWidth\)/);
  assert.match(modalSource, /window\.addEventListener\('resize', measureScrollWidth\)/);
});

test('Manage Variants filters before paginating and preserves page selection rules', () => {
  assert.match(modalSource, /const totalPages = Math\.ceil\(visibleVariants\.length \/ itemsPerPage\)/);
  assert.match(modalSource, /const paginatedVariants = visibleVariants\.slice\(pageStartIndex, pageStartIndex \+ itemsPerPage\)/);
  assert.match(modalSource, /const visibleArchivableVariantIds = useMemo\(\(\) => paginatedVariants/);
  assert.match(modalSource, /setStockFilter\(status\);\s+setCurrentPage\(1\);/);
  assert.match(modalSource, /pageSizeOptions=\{\[5, 10, 20\]\}/);
  assert.match(modalSource, /setCurrentPage\(\(page\) => Math\.min\(page, Math\.max\(totalPages, 1\)\)\)/);
  assert.match(modalSource, /Showing \{pageStartIndex \+ 1\}–\{Math\.min\(pageStartIndex \+ itemsPerPage, visibleVariants\.length\)\} of \{visibleVariants\.length\} variants/);
  assert.match(modalSource, /scrollContainer\.scrollTo\(/);
});
