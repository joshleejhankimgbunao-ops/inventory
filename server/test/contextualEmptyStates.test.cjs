const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readSource = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');
const emptyStateSource = readSource('src/components/ContextualEmptyState.jsx');

test('shared contextual empty state provides a compact accessible action when supplied', () => {
  assert.match(emptyStateSource, /role="status"/);
  assert.match(emptyStateSource, /actionLabel && onAction/);
  assert.match(emptyStateSource, /focus-visible:ring-2/);
  assert.match(emptyStateSource, /motion-reduce:transition-none/);
});

test('creation and inventory pages distinguish filtered-empty from true-empty and load failures', () => {
  const specialOrders = readSource('src/pages/SpecialOrders.jsx');
  const productList = readSource('src/pages/ProductList.jsx');
  const inventory = readSource('src/pages/Inventory.jsx');
  const recommendation = readSource('src/pages/Recommendation.jsx');

  assert.match(specialOrders, /No special orders yet/);
  assert.match(specialOrders, /Create your first quotation to get started\./);
  assert.match(specialOrders, /actionLabel: 'Create Quotation'/);
  assert.match(specialOrders, /ordersLoadError[\s\S]*?actionLabel: 'Retry'/);
  assert.match(specialOrders, /isOrderListLoading = initialLoading \|\| \(refreshing && orders\.length === 0\)/);
  assert.match(productList, /No products yet/);
  assert.match(productList, /actionLabel: isAdminOrAbove\(\) \? 'Add Product' : ''/);
  assert.match(productList, /hasProductFilters[\s\S]*?No matching results/);
  assert.match(inventory, /No products available/);
  assert.match(inventory, /actionLabel: canAccess\(userRole, 'ProductList'\) \? 'Go to Product Master List' : ''/);
  assert.match(recommendation, /No products available/);
  assert.match(recommendation, /recommendationProductsError \|\| \(inventoryLoadError && inventory\.length === 0\)/);
});

test('read-only history sections only offer retry or clearing the current tab filters', () => {
  const history = readSource('src/pages/History.jsx');
  const creditTransactions = readSource('src/pages/CreditTransactions.jsx');

  assert.match(history, /No matching results/);
  assert.match(history, /actionLabel: 'Retry'/);
  assert.match(history, /actionLabel: 'Clear Filters'/);
  assert.match(history, /retryCurrentTab/);
  assert.match(creditTransactions, /No matching results/);
  assert.match(creditTransactions, /actionLabel: 'Clear Filters'/);
  assert.match(creditTransactions, /Credit transactions unavailable/);
});

test('directory and user empty actions reuse existing flows and honor permissions', () => {
  const partners = readSource('src/pages/Partners.jsx');
  const users = readSource('src/pages/UserList.jsx');

  assert.match(partners, /actionLabel: isViewOnly \? '' : `Add \$\{activeTab/);
  assert.match(partners, /onAction: isViewOnly \? null : openAddPartner/);
  assert.match(partners, /actionLabel: 'Retry'/);
  assert.match(users, /userRole === ROLES\.SUPER_ADMIN && isBrowserOnline \? 'Add New User' : ''/);
  assert.match(users, /No matching results/);
  assert.match(users, /actionLabel: 'Reset Search'/);
  assert.match(users, /setShowArchived\(true\)/);
});

test('POS does not show an empty-result message while initial products are loading', () => {
  const pos = readSource('src/pages/PointOfSale.jsx');

  assert.match(pos, /isInitialInventoryPending \? \([\s\S]*?Loading products[\s\S]*?\) : filteredProducts\.length === 0/);
  assert.match(pos, /No matching results/);
  assert.match(pos, /actionLabel: 'Retry'/);
  assert.match(pos, /actionLabel: 'Clear Filters'/);
});

test('dashboard activity logs and overdue-history searches preserve loading, retry, and reset actions', () => {
  const dashboard = readSource('src/pages/Dashboard.jsx');
  const overdueHistory = readSource('src/components/CustomerOverdueHistoryModal.jsx');
  const inventoryContext = readSource('src/context/InventoryContext.jsx');

  assert.match(inventoryContext, /activityLogsError/);
  assert.match(inventoryContext, /retryActivityLogs/);
  assert.match(dashboard, /isActivityLogsLoading && activityLogs\.length === 0/);
  assert.match(dashboard, /actionLabel: 'Retry', onAction: retryActivityLogs/);
  assert.match(dashboard, /actionLabel: 'Clear Filters', onAction: clearActivityLogFilters/);
  assert.match(overdueHistory, /title="No matching results" description="Try a different search\." actionLabel="Reset Search"/);
  assert.match(overdueHistory, /actionLabel=\{search\.trim\(\) \? 'Reset Search' : ''\}/);
});
