const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const partnersSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/Partners.jsx'),
  'utf8',
);
const partnersStyles = fs.readFileSync(
  path.resolve(__dirname, '../../src/index.css'),
  'utf8',
);
const statCardSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/StatCard.jsx'),
  'utf8',
);
const userListSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/UserList.jsx'),
  'utf8',
);
const directoryStart = partnersSource.indexOf('<div className="mx-2 mb-5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:mx-5">');
const directoryEnd = partnersSource.indexOf('{/* Add Modal */}', directoryStart);
const directoryMarkup = partnersSource.slice(directoryStart, directoryEnd);

test('Partners directory renders responsive supplier and customer cards', () => {
  assert.notEqual(directoryStart, -1);
  assert.notEqual(directoryEnd, -1);
  assert.match(directoryMarkup, /grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(directoryMarkup, /rounded-xl border p-3 shadow-sm[\s\S]*md:p-4/);
  assert.match(directoryMarkup, /paginatedData\.map\(\(item\) => \{/);
  assert.match(directoryMarkup, /<article[\s\S]*?key=\{item\.id\}/);
  assert.doesNotMatch(directoryMarkup, /<table\b/);
  assert.match(directoryMarkup, /activeTab === 'suppliers' \? item\.products : item\.type/);
  assert.match(directoryMarkup, /\{ label: 'Contact', value: item\.contact \}/);
  assert.match(directoryMarkup, /\{ label: 'Email', value: item\.email, isEmail: true \}/);
  assert.match(directoryMarkup, /\{ label: 'Location', value: item\.address \}/);
  assert.match(partnersSource, /const getDirectoryDisplayValue = \(value\) => \{[\s\S]*?return text \|\| '—';/);
});

test('Partners directory preserves filtering, pagination, loading, empty states, and action permissions', () => {
  assert.match(partnersSource, /const filteredDataBase = \(activeTab === 'suppliers' \? suppliers : customers\)\.filter/);
  assert.match(partnersSource, /const paginatedData = filteredData\.slice\(indexOfFirstPartner, indexOfFirstPartner \+ itemsPerPage\)/);
  assert.match(directoryMarkup, /isLoadingPartners \?/);
  assert.match(directoryMarkup, /filteredData\.length === 0 \?/);
  assert.match(directoryMarkup, /<Pagination currentPage=\{activePage\}/);
  assert.match(partnersSource, /const showActionsColumn = !isViewOnly \|\| activeTab === 'suppliers';/);
  assert.match(directoryMarkup, /handleOpenRecommendations\(item\)/);
  assert.match(directoryMarkup, /handleRestore\(item\.id\)/);
  assert.match(directoryMarkup, /handleEdit\(item\)/);
  assert.match(directoryMarkup, /handleArchive\(item\.id\)/);
});

test('directory tabs fit, archive action stays readable, and cards reuse Dashboard hover treatment', () => {
  assert.match(partnersSource, /order-2 inline-flex w-max max-w-full justify-self-start rounded-lg bg-gray-100 p-1/);
  assert.equal((partnersSource.match(/className=\{`flex-none px-4 py-2 rounded-md text-xs font-semibold transition-all/g) || []).length, 2);
  assert.match(partnersSource, /partners-archive-toggle group\/btn/);
  assert.match(partnersSource, /showArchived \? 'Back to Active' : `View Archive/);
  assert.doesNotMatch(partnersSource, /max-w-0 overflow-hidden whitespace-nowrap opacity-0/);
  assert.match(partnersStyles, /\.archive-toggle-button\.partners-archive-toggle \{[\s\S]*?height: 2\.25rem;[\s\S]*?padding-inline: 0\.625rem;/);
  assert.match(partnersSource, /border-gray-200 bg-white hover:border-slate-400/);
  assert.match(directoryMarkup, /shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none/);
  assert.match(statCardSource, /shadow-sm transition-all duration-300[\s\S]*cursor-default hover:shadow-lg/);
  assert.match(statCardSource, /cursor-pointer transform hover:-translate-y-1 hover:shadow-lg/);
  assert.doesNotMatch(directoryMarkup, /hover:scale-/);
});

test('User Management archive button reuses Partners sizing with a permanently visible label', () => {
  assert.match(userListSource, /archive-toggle-button partners-archive-toggle text-xs font-semibold/);
  assert.match(userListSource, /w-3\.5 h-3\.5 shrink-0/);
  assert.match(userListSource, /shrink-0 text-xs font-semibold whitespace-nowrap[\s\S]*View Archive/);
  assert.doesNotMatch(userListSource, /group-hover:max-w-(?:28|40)|group-hover:opacity-100/);
  assert.match(userListSource, /setShowArchived\(prev => !prev\)/);
});
