/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

test('Credit Transactions mobile cards reuse the current paginated rows and existing actions', () => {
  const source = read('../../src/pages/CreditTransactions.jsx');
  assert.match(source, /Credit transaction mobile records[\s\S]*currentRows\.map\(\(row\)/);
  assert.match(source, /min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto px-0 py-2 md:hidden/);
  assert.match(source, /rounded-xl border border-slate-200 bg-white p-3 shadow-sm/);
  assert.match(source, /RecordActionIcon name="eye"/);
  assert.match(source, /RecordActionIcon name="calendar-clock"/);
  assert.match(source, /RecordActionIcon name="wallet"/);
  assert.match(source, /handleOpenDetails\(row\)/);
  assert.match(source, /handleOpenMarkPaidModal\(row, 'extendOnly'\)/);
  assert.match(source, /handleOpenMarkPaidModal\(row, 'markPaid'\)/);
  assert.match(source, /hidden min-h-0 flex-1 overflow-y-auto[\s\S]*md:block/);
});

test('Special Orders mobile cards reuse paginated orders and role-derived actions', () => {
  const source = read('../../src/pages/SpecialOrders.jsx');
  assert.match(source, /Special Orders mobile records[\s\S]*paginatedOrders\.map\(\(order\)/);
  assert.match(source, /rounded-none border-0 bg-transparent p-0 shadow-none md:h-full md:rounded-2xl md:border md:border-slate-300 md:bg-slate-200\/50 md:p-4 md:shadow-inner/);
  assert.match(source, /<header className="flex flex-col items-start gap-1 border-b border-gray-200 px-2 pb-3 md:px-0">/);
  assert.match(source, /flex flex-col gap-2 px-2 py-3 md:flex-row md:items-center md:px-0/);
  assert.match(source, /mt-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none md:rounded-md md:border md:border-gray-100 md:shadow-sm/);
  assert.match(source, /flex flex-col gap-3 p-2 md:hidden/);
  assert.match(source, /p-3 shadow-sm/);
  assert.match(source, /overflow-x-hidden md:overflow-x-auto lg:overflow-x-hidden/);
  assert.match(source, /label: 'Record Decision', icon: 'clipboard-check'/);
  assert.match(source, /nextAction\.type === 'complete-order' \|\| nextAction\.type === 'complete-blocked' \? 'circle-check' : null/);
  assert.match(source, /quotationCapabilities\(order, order\.quotation, userRole, currentAuthUserId\)/);
  assert.match(source, /canViewSpecialOrderTransaction\(order, capabilities\.allowed\)/);
  assert.match(source, /renderOrderRowActions\(order, rowActions, \{ mobile: true \}\)/);
  assert.match(source, /hidden md:block[\s\S]*main-data-table/);
});

test('Inventory and Product Master mobile cards reuse existing filtered page records and gated actions', () => {
  const inventory = read('../../src/pages/Inventory.jsx');
  assert.match(inventory, /Inventory mobile records[\s\S]*currentItems\.map\(\(item\)/);
  assert.match(inventory, /flex flex-col gap-3 md:hidden/);
  assert.match(inventory, /px-2 pb-4 md:overflow-x-auto md:overscroll-x-contain md:px-4/);
  assert.match(inventory, /RecordActionIcon name="package-plus"/);
  assert.match(inventory, /RecordActionIcon name="package-minus"/);
  assert.match(inventory, /handleOpenStockModal\(item, 'IN'\)/);
  assert.match(inventory, /handleOpenStockModal\(item, 'OUT'\)/);
  assert.match(inventory, /hidden md:block[\s\S]*main-data-table/);

  const products = read('../../src/pages/ProductList.jsx');
  assert.match(products, /Product Master List mobile records[\s\S]*paginatedProductFamilies\.map\(\(family\)/);
  assert.match(products, /flex flex-col gap-3 md:hidden/);
  assert.match(products, /px-0 md:px-3 pb-3/);
  assert.match(products, /rounded-xl border border-slate-200 bg-white p-3 shadow-sm/);
  assert.match(products, /<EditIcon \/>/);
  assert.match(products, /isAdminOrAbove\(\) && <div[\s\S]*handleOpenFamily\(family\)/);
  assert.match(products, /hidden md:block[\s\S]*main-data-table/);
});

test('Reports mobile cards use the shared filtered page rows with module-specific record fields', () => {
  const table = read('../../src/components/ReportRecordTable.jsx');
  const reports = read('../../src/pages/Reports.jsx');
  assert.match(table, /pageRows\.map\(\(row\)/);
  assert.match(table, /flex flex-col gap-3 bg-slate-100\/70 p-2 md:hidden/);
  assert.doesNotMatch(table, /space-y-3 p-2 md:hidden/);
  assert.match(table, /rounded-xl border border-slate-200 bg-white p-3 shadow-sm/);
  assert.match(table, /mobileDetailColumns/);
  assert.match(table, /hidden w-full overflow-x-auto[\s\S]*md:block/);
  assert.match(reports, /mobileCardTitleKey="transactionId"[\s\S]*mobileCardStatusKey="paymentStatus"/);
  assert.match(reports, /mobileCardTitleKey="name"[\s\S]*mobileCardSubtitleKey="sku"[\s\S]*mobileCardStatusKey="status"/);
});

test('History mobile content matches Special Orders gutters and keeps desktop tables separate', () => {
  const source = read('../../src/pages/History.jsx');
  const specialOrders = read('../../src/pages/SpecialOrders.jsx');
  assert.match(source, /rounded-none border-0 bg-transparent shadow-none md:flex-1 md:rounded-2xl md:border md:border-slate-300 md:bg-slate-200\/50 md:shadow-inner/);
  assert.match(source, /px-2 py-4 flex flex-col gap-5 md:shrink-0 md:p-4/);
  assert.match(source, /flex flex-col gap-3 px-2 py-2 md:hidden/);
  assert.match(source, /activeTab === 'sales' \|\| activeTab === 'special-orders'[\s\S]*currentItems\.map\(\(trx\)/);
  assert.match(source, /activeTab === 'credit'[\s\S]*currentItems\.map\(\(credit\)/);
  assert.match(source, /currentItems\.map\(\(log, index\)/);
  assert.match(source, /border-t border-gray-200 bg-slate-200\/95 px-2 py-2[\s\S]*md:px-6/);
  assert.match(specialOrders, /header className="flex flex-col items-start gap-1 border-b border-gray-200 px-2 pb-3 md:px-0"/);
  assert.match(specialOrders, /flex flex-col gap-2 px-2 py-3 md:flex-row md:items-center md:px-0/);
  assert.match(specialOrders, /flex flex-col gap-3 p-2 md:hidden/);
  assert.match(source, /rounded-xl border border-slate-200 bg-white p-3 shadow-sm/);
  assert.match(source, /RecordActionIcon name=\{isRegularSale\(trx\) \? 'file-text' : 'receipt-text'\}/);
  assert.match(source, /RecordActionIcon name="eye"/);
  assert.match(source, /activeTab === 'special-orders' \? 'eye' : 'file-search'/);
  assert.doesNotMatch(source, /RecordActionIcon name=\{trx\.isArchived \? 'archive-restore' : 'archive'\}/);
  assert.match(source, /hidden md:block[\s\S]*main-data-table/);
});

test('User Management mobile cards use the shared 12px row gap', () => {
  const source = read('../../src/pages/UserList.jsx');
  assert.match(source, /User Management mobile records[\s\S]*paginatedUsers\.map\(\(user\)/);
  assert.match(source, /flex flex-col gap-3 md:hidden/);
  assert.match(source, /hidden md:block[\s\S]*main-data-table/);
});

test('Shared record action icons remain decorative inline SVGs with compact sizing', () => {
  const source = read('../../src/components/RecordActionIcon.jsx');
  for (const iconName of ['eye', 'file-text', 'file-search', 'receipt-text', 'archive', 'archive-restore', 'calendar-clock', 'wallet', 'package-plus', 'package-minus']) {
    assert.match(source, new RegExp(`(?:['"]${iconName}['"]|${iconName})\\s*:`));
  }
  assert.match(source, /aria-hidden="true" focusable="false"/);
  assert.match(source, /h-3\.5 w-3\.5 shrink-0/);
});

test('POS category options use a compact scrollable mobile picker while desktop keeps the native select', () => {
  const source = read('../../src/pages/PointOfSale.jsx');
  assert.match(source, /flex flex-col md:flex-row gap-4/);
  assert.match(source, /ariaLabel="Filter POS products by category"[\s\S]*className="w-fit max-w-full self-start md:hidden"[\s\S]*bottom-full left-0 right-auto[\s\S]*max-h-\[min\(45vh,16rem\)\][\s\S]*compact/);
  assert.match(source, /className="hidden appearance-none w-full md:inline-flex md:w-48/);
  assert.match(source, /px-3 pb-5 pt-5[\s\S]*md:px-5/);
});

test('Stock Operations, Special Orders, and Product Master use full-width mobile search rows and compact filter rows', () => {
  const inventory = read('../../src/pages/Inventory.jsx');
  assert.match(inventory, /mb-3 flex flex-col items-start gap-2 md:flex-row md:items-center/);
  assert.match(inventory, /main-toolbar-search group w-full max-w-none md:max-w-\[27\.5rem\] md:flex-1/);
  assert.match(inventory, /max-h-\[min\(70vh,28rem\)\] overflow-y-auto/);

  const specialOrders = read('../../src/pages/SpecialOrders.jsx');
  assert.match(specialOrders, /flex flex-col gap-2 px-2 py-3 md:flex-row md:items-center md:px-0/);
  assert.match(specialOrders, /className="w-fit max-w-full self-start md:w-32 md:self-auto[\s\S]*menuClassName="mt-2 left-0 right-auto[\s\S]*max-h-\[min\(50vh,20rem\)\][\s\S]*compact/);

  const products = read('../../src/pages/ProductList.jsx');
  assert.match(products, /flex w-full flex-col items-start gap-2 md:w-auto md:flex-row md:items-center/);
  assert.match(products, /w-fit self-end px-3 py-1\.5[\s\S]*md:self-auto/);
  assert.match(products, /max-w-\[calc\(100vw-1rem\)\]/);
});

test('Partners and User Management use compact mobile actions and User Management cards reuse paginated rows', () => {
  const partners = read('../../src/pages/Partners.jsx');
  assert.match(partners, /mb-6 grid grid-cols-1 items-center gap-y-3 md:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(partners, /order-2 inline-flex w-max max-w-full justify-self-start rounded-lg bg-gray-100 p-1 md:order-none md:col-start-1/);
  assert.match(partners, /order-3 w-fit justify-self-end self-start[\s\S]*md:col-start-2 md:row-start-1/);
  assert.match(partners, /main-toolbar-search group w-full max-w-none md:w-auto/);

  const users = read('../../src/pages/UserList.jsx');
  assert.match(users, /User Management mobile records[\s\S]*paginatedUsers\.map\(\(user\)/);
  assert.match(users, /hidden md:block[\s\S]*main-data-table/);
  assert.match(users, /canEditOrArchive = !user\.isPrimarySuperAdmin[\s\S]*canRestore = !user\.isPrimarySuperAdmin/);
  assert.match(users, /roleNames\[user\.role\] \|\| user\.role/);
  assert.match(users, /user\.email &&[\s\S]*user\.phone &&/);
  assert.match(users, /group\/disabled-add w-fit self-start md:self-auto/);
  assert.match(users, /className="w-fit px-4 py-2 rounded-lg text-white/);
});

test('Stock Rules override controls wrap on mobile and keep compact Add actions', () => {
  const settings = read('../../src/pages/Settings.jsx');
  assert.match(settings, /Category Overrides[\s\S]*p-3 md:p-5[\s\S]*mb-4 flex flex-wrap items-center gap-2/);
  assert.match(settings, /Select Category[\s\S]*flex-\[1_1_100%\][\s\S]*md:flex-1/);
  assert.match(settings, /Product Specific Overrides[\s\S]*flex-\[1_1_100%\][\s\S]*Search SKU\/Name/);
  assert.match(settings, /w-fit shrink-0 whitespace-nowrap px-4 py-2 bg-gray-900/);
});

test('ToolbarDropdown can cap the menu height without changing defaults for existing consumers', () => {
  const source = read('../../src/components/ToolbarDropdown.jsx');
  assert.match(source, /menuClassName = ''/);
  assert.match(source, /compact = false/);
  assert.match(source, /w-fit max-w-full md:w-full/);
  assert.match(source, /overflow-x-hidden overflow-y-auto rounded-xl border border-gray-800[\s\S]*\$\{menuClassName\}/);
});

test('Report KPI values reflow ahead of their icon controls on mobile without changing desktop layouts', () => {
  const reports = read('../../src/pages/Reports.jsx');
  assert.match(reports, /grid grid-cols-\[minmax\(0,1fr\)_auto\] gap-x-2 gap-y-2 md:flex md:items-center md:justify-between/);
  assert.match(reports, /text-\[clamp\(16px,5vw,21px\)\][\s\S]*md:text-\[21px\]/);
  assert.match(reports, /col-span-2 flex items-center justify-end gap-1\.5 md:col-span-1/);
  assert.match(reports, /title="Inventory Value"[\s\S]*showFinancials=\{showFinancials\}[\s\S]*onToggle=\{\(\) => setShowFinancials/);
  assert.equal((reports.match(/mobileMetricStack/g) || []).length, 3);

  const statCard = read('../../src/components/StatCard.jsx');
  assert.match(statCard, /mobileMetricStack = false/);
  assert.match(statCard, /flex flex-col items-stretch gap-2 md:flex-row md:items-center md:justify-between/);
});
