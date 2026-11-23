/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
const desktopSkeletons = read('../../src/components/DesktopSkeletons.jsx');
const pageSkeleton = read('../../src/components/PageSkeleton.jsx');
const dashboard = read('../../src/pages/Dashboard.jsx');
const pos = read('../../src/pages/PointOfSale.jsx');
const recommendation = read('../../src/pages/Recommendation.jsx');
const reports = read('../../src/pages/Reports.jsx');
const reportTable = read('../../src/components/ReportRecordTable.jsx');
const inventoryContext = read('../../src/context/InventoryContext.jsx');

test('route fallback keeps the existing sub-desktop skeleton and selects a desktop page-matched layout', () => {
  assert.match(pageSkeleton, /animate-in fade-in lg:hidden/);
  assert.match(pageSkeleton, /<DesktopPageSkeleton page=\{page\} showProductActions=\{showProductActions\} \/>/);
  assert.match(desktopSkeletons, /hidden w-full max-w-\[1600px\].*lg:block/);
  assert.match(dashboard, /<PageSkeleton page=\{activeMenu\} showProductActions=\{isAdminOrAbove\(\)\} \/>/);
  assert.match(dashboard, /<Suspense fallback=\{<PageSkeleton page=\{activeMenu\} showProductActions=\{isAdminOrAbove\(\)\} \/>\}>/);
  for (const page of ['Point of Sale', 'Recommendation', 'Partners', 'Reports', 'Dashboard']) {
    assert.ok(desktopSkeletons.includes(page), `Expected desktop skeleton variant for ${page}`);
  }
});

test('desktop route table fallbacks keep known navy headers and skeletonize only their body rows', () => {
  assert.match(desktopSkeletons, /const DESKTOP_TABLE_COLUMNS = \{/);
  for (const label of [
    'Reference', 'Credit ID', 'Current Stock', 'Variants', 'Transaction ID',
    'Transaction Date', 'Remaining Balance (₱)', 'Account Status',
  ]) {
    assert.ok(desktopSkeletons.includes(label), `Expected actual table header ${label}`);
  }
  assert.match(desktopSkeletons, /<th key=\{column\.label\} scope="col"/);
  assert.match(desktopSkeletons, /<tbody aria-hidden="true">[\s\S]*?columns\.map\(\(column, cell\)/);
  assert.doesNotMatch(desktopSkeletons, /table-head-skeleton/);
  assert.match(desktopSkeletons, /<TablePageSkeleton page=\{page\} showProductActions=\{showProductActions\} \/>/);
  assert.match(desktopSkeletons, /normalizedPage\.includes\('product master list'\)[\s\S]*?showProductActions[\s\S]*?label: 'Actions'/);
  assert.match(dashboard, /<PageSkeleton page=\{activeMenu\} showProductActions=\{isAdminOrAbove\(\)\} \/>/);
});

test('POS and Recommendation show desktop content skeletons only while their initial inventory is pending', () => {
  assert.match(pos, /isInitialInventoryPending = isInventoryLoading && sourceInventory\.length === 0/);
  assert.match(pos, /isInitialInventoryPending && <DesktopProductGridSkeleton \/>/);
  assert.match(pos, /isInitialInventoryPending \? 'lg:hidden' : ''/);
  assert.match(recommendation, /isInitialRecommendationDataPending = inventory\.length === 0 && \(isInventoryLoading \|\| isCategoriesLoading\)/);
  assert.match(recommendation, /isInitialRecommendationDataPending && <DesktopRecommendationSkeleton \/>/);
  assert.match(recommendation, /isInitialRecommendationDataPending \? 'lg:hidden' : ''/);
  assert.match(desktopSkeletons, /grid-cols-4 gap-4 pb-4 2xl:grid-cols-5/);
  assert.match(desktopSkeletons, /grid-cols-\[minmax\(220px,34%\)_minmax\(0,1fr\)\]/);
});

test('Reports charts and detail tables use desktop skeletons while preserving sub-desktop loading UI', () => {
  assert.match(reports, /reportTransactionsPending && <DesktopAnalyticsChartSkeleton type="donut" \/>/);
  assert.match(reports, /reportTransactionsError && <DesktopErrorNotice/);
  assert.match(reports, /desktopError=\{reportTransactionsError\}/);
  assert.match(reports, /collectionsAnalyticsState === 'loading' \? <CollectionsAnalyticsSkeleton \/>/);
  assert.match(reportTable, /<tr className="lg:hidden"><td colSpan=\{columns\.length\}[^>]*>.*?Loading records/);
  assert.match(reportTable, /hidden motion-safe:animate-pulse motion-reduce:animate-none lg:table-row/);
  assert.match(reportTable, /shouldShowDesktopSkeleton = desktopLoading \?\? loading/);
  assert.match(reportTable, /!shouldShowDesktopSkeleton && pageRows\.map/);
  assert.match(reportTable, /className="flex flex-col gap-3 bg-slate-100\/70 p-2 md:hidden"/);
});

test('Reports distinguishes a failed sales-history request from an empty result and retries through the existing request', () => {
  assert.match(inventoryContext, /transactionsError: ''/);
  assert.match(inventoryContext, /retryTransactions = \(\) => \{/);
  assert.match(inventoryContext, /transactionsRetryVersion\]\)/);
  assert.match(inventoryContext, /Sales transaction records could not be loaded\./);
  assert.match(reports, /const reportTransactionsError = !isTransactionsLoading && transactions\.length === 0 \? transactionsError : ''/);
  assert.match(reports, /const retryCollectionsAnalytics = \(\) => \{\s*if \(reportTransactionsError\) retryTransactions\(\)/);
});

test('other audited record pages retain their existing data-shaped skeleton branches', () => {
  const specialOrders = read('../../src/pages/SpecialOrders.jsx');
  const creditTransactions = read('../../src/pages/CreditTransactions.jsx');
  const inventory = read('../../src/pages/Inventory.jsx');
  const productList = read('../../src/pages/ProductList.jsx');
  const history = read('../../src/pages/History.jsx');
  const partners = read('../../src/pages/Partners.jsx');
  const users = read('../../src/pages/UserList.jsx');

  assert.match(specialOrders, /initialLoading[\s\S]*?TableSkeletonRows/);
  assert.match(creditTransactions, /isLoading \?[\s\S]*?credit-skeleton/);
  assert.match(inventory, /isInventoryLoading \?[\s\S]*?TableSkeletonRows/);
  assert.match(productList, /isInventoryLoading \?[\s\S]*?TableSkeletonRows/);
  assert.match(history, /isCurrentTabLoading \?[\s\S]*?TableSkeletonRows/);
  assert.match(partners, /isLoadingPartners \?[\s\S]*?partner-card-skeleton/);
  assert.match(users, /isUsersLoading \?[\s\S]*?users-skeleton/);
});
