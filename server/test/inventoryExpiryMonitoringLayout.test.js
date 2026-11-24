/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const inventorySource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Inventory.jsx'), 'utf8');
const partnersSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Partners.jsx'), 'utf8');
const monitoringSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ExpiryMonitoring.jsx'), 'utf8');
const verificationFormSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ExpiryBatchVerificationForm.jsx'), 'utf8');
const productRoutesSource = fs.readFileSync(path.resolve(__dirname, '../src/routes/productRoutes.js'), 'utf8');
const correctionServiceSource = fs.readFileSync(path.resolve(__dirname, '../src/services/expiryBatchCorrectionService.js'), 'utf8');
const correctionModelSource = fs.readFileSync(path.resolve(__dirname, '../src/models/ExpiryBatchCorrection.js'), 'utf8');
const productControllerSource = fs.readFileSync(path.resolve(__dirname, '../src/controllers/productController.js'), 'utf8');
const indexCssSource = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');

test('Inventory separates Stock Operations and Expiry Monitoring into persistent accessible tabs', () => {
  assert.match(inventorySource, /const \[activeInventoryTab, setActiveInventoryTab\] = useState\('stock'\)/);
  assert.match(inventorySource, /role="tablist" aria-label="Inventory sections"/);
  assert.match(inventorySource, /\{ id: 'stock', label: 'Stock Operations' \}/);
  assert.match(inventorySource, /\{ id: 'expiry', label: 'Expiry Monitoring' \}/);
  assert.match(inventorySource, /role="tab"[\s\S]*?aria-selected=\{isActive\}[\s\S]*?tabIndex=\{isActive \? 0 : -1\}/);
  assert.match(inventorySource, /onKeyDown=\{\(event\) => handleInventoryTabKeyDown\(event, index\)\}/);
  assert.match(inventorySource, /event\.key === 'ArrowRight'[\s\S]*?event\.key === 'ArrowLeft'[\s\S]*?event\.key === 'Home'[\s\S]*?event\.key === 'End'/);

  const stockPanelStart = inventorySource.indexOf('id="inventory-panel-stock"');
  const expiryPanelStart = inventorySource.indexOf('id="inventory-panel-expiry"');
  const stockPanel = inventorySource.slice(stockPanelStart, expiryPanelStart);
  const tableEnd = stockPanel.indexOf('</table>');
  const pagination = stockPanel.indexOf('{/* Pagination Controls */}');
  const tabSelectionStart = inventorySource.indexOf('const selectInventoryTab');
  const tabSelectionEnd = inventorySource.indexOf('const handleInventoryTabKeyDown', tabSelectionStart);
  const tabSelection = inventorySource.slice(tabSelectionStart, tabSelectionEnd);

  assert.ok(stockPanelStart >= 0);
  assert.ok(expiryPanelStart > stockPanelStart);
  assert.match(stockPanel, /hidden=\{activeInventoryTab !== 'stock'\}/);
  assert.ok(tableEnd >= 0);
  assert.ok(pagination > tableEnd, 'pagination remains with the Stock Operations table');
  assert.match(stockPanel, /value=\{searchQuery\}/);
  assert.match(stockPanel, /onClick=\{\(\) => handleOpenStockModal\(item, 'IN'\)\}/);
  assert.match(stockPanel, /onClick=\{\(\) => item\.stock > 0 && handleOpenStockModal\(item, 'OUT'\)\}/);
  assert.match(stockPanel, /<Pagination currentPage=\{currentPage\}/);
  assert.match(tabSelection, /setActiveInventoryTab\(tab\)/);
  assert.doesNotMatch(tabSelection, /setSearchQuery|setCurrentPage|setItemsPerPage/);
  assert.match(inventorySource.slice(expiryPanelStart), /hidden=\{activeInventoryTab !== 'expiry'\}[\s\S]*?<ExpiryMonitoring/);
  assert.equal((inventorySource.match(/<ExpiryMonitoring\b/g) || []).length, 1);
});

test('Inventory section tabs reuse the Suppliers and Regular Customers segmented-tab styling', () => {
  const inventoryTabList = inventorySource.match(/<div role="tablist" aria-label="Inventory sections" className="([^"]+)"/);
  const partnerTabList = partnersSource.match(/<div className="order-2 inline-flex w-max max-w-full justify-self-start rounded-lg bg-gray-100 p-1 md:order-none md:col-start-1 md:row-start-2">/);
  assert.ok(inventoryTabList, 'Inventory tabs use the compact segmented container');
  assert.ok(partnerTabList, 'the Partners segmented-tab reference is present');
  assert.match(inventoryTabList[1], /inline-flex w-max max-w-full (?:shrink-0 )?rounded-lg bg-gray-100 p-1/);
  assert.match(inventorySource, /flex-none px-4 py-2 rounded-md text-xs font-semibold transition-all/);
  assert.match(inventorySource, /isActive\s*\?\s*'text-white shadow-sm'\s*:\s*'text-gray-500 hover:text-gray-900'/);
  assert.match(inventorySource, /style=\{isActive \? \{ backgroundColor: '#111827', color: '#ffffff' \} : \{\}\}/);
});

test('Inventory section tabs share the page header row on desktop and wrap below it on small screens', () => {
  const headerStart = inventorySource.indexOf('{/* Header Area */}');
  const stockPanelStart = inventorySource.indexOf('id="inventory-panel-stock"');
  const header = inventorySource.slice(headerStart, stockPanelStart);
  assert.match(header, /mb-3 flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:justify-between/);
  const titlePosition = header.indexOf('>Stock Operations</p>');
  const descriptionPosition = header.indexOf('>Manage stock in/out flow and adjustments</p>');
  const tabsPosition = header.indexOf('role="tablist" aria-label="Inventory sections"');
  assert.ok(titlePosition >= 0 && descriptionPosition > titlePosition && tabsPosition > descriptionPosition);
  assert.ok(stockPanelStart > 0, 'the Stock Operations content remains below the header');
});

test('Stock Operations toolbar omits the expiry shortcut and Product Master List hint', () => {
  assert.doesNotMatch(inventorySource, /View Expiry Monitoring|scrollToExpiryMonitoring/);
  assert.doesNotMatch(inventorySource, /Use\s*<span[^>]*>Product Master List<\/span>\s*to add new items/);
  assert.doesNotMatch(monitoringSource, /id="inventory-expiry-monitoring"|scroll-mt-3/);
  assert.match(inventorySource, /placeholder="Search items\.\.\."/);
  assert.match(inventorySource, /Filter & Sort/);
  assert.match(inventorySource, /ariaLabel="Filter inventory by category"/);
  assert.match(inventorySource, /label: category === 'All' \? 'All Categories' : category/);
});

test('Expiry Monitoring uses concise copy and Credit Transactions KPI card styling', () => {
  assert.match(monitoringSource, /Expiry Monitoring/);
  assert.match(monitoringSource, /Track products nearing or past their expiry dates\./);
  assert.doesNotMatch(monitoringSource, /Expiry status as of the Asia\/Manila date/);
  assert.match(monitoringSource, /title="Expiring Soon"/);
  assert.match(monitoringSource, /title="Expired Batches"/);
  assert.match(monitoringSource, /title="Products With Expired Stock"/);
  assert.match(monitoringSource, /data\.summary\?\.productsWithExpiredStock/);
  assert.doesNotMatch(monitoringSource, /expiredStockSummary/);
  assert.match(monitoringSource, /app-dashboard-card-hover flex h-full min-h-\[4\.5rem\] min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm sm:px-4 dark:border-slate-700 dark:bg-slate-900/);
  assert.match(monitoringSource, /text-\[11px\] font-semibold uppercase leading-tight tracking-wider text-slate-600/);
  assert.match(monitoringSource, /mt-1\.5 text-\[22px\] font-semibold leading-tight text-gray-900 sm:text-2xl/);
  assert.match(monitoringSource, /rounded-lg bg-gray-900 p-1\.5 text-white sm:p-2 dark:bg-gray-700/);
});

test('Expiry Monitoring reuses Stock Operations search styling with independent controls', () => {
  assert.match(monitoringSource, /const \[search, setSearch\] = useState\(''\)/);
  assert.match(monitoringSource, /main-toolbar-search group w-full sm:max-w-\[27\.5rem\]/);
  assert.match(monitoringSource, /className="main-toolbar-search-input"/);
  assert.match(monitoringSource, /placeholder="Search product, SKU, or batch\/lot\.\.\."/);
  assert.match(monitoringSource, /<ToolbarDropdown[\s\S]*?compact portalMenu fitSelectedValue softForeground focusVisibleRing/);
  assert.match(monitoringSource, /flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-start/);
});

test('Expiry Monitoring refreshes authoritative rows and KPIs from SSE without resetting filters', () => {
  assert.match(monitoringSource, /subscribeRealtimeEvent\('inventory\.updated', scheduleRefresh\)/);
  assert.match(monitoringSource, /subscribeRealtimeEvent\('realtime\.resync', scheduleRefresh\)/);
  assert.match(monitoringSource, /unsubscribeInventoryUpdated\(\)[\s\S]*unsubscribeRealtimeResync\(\)/);
  assert.match(monitoringSource, /const \[search, setSearch\] = useState\(''\)/);
  assert.match(monitoringSource, /const \[statusFilter, setStatusFilter\] = useState\('Current Stock'\)/);
  assert.match(monitoringSource, /if \(requestInFlight\) \{\s*refreshQueued = true;/);
  assert.match(monitoringSource, /refreshTimer = window\.setTimeout\(\(\) => load\(\), 100\)/);
  assert.match(monitoringSource, /setData\(\{\s*asOfDate: result\?\.asOfDate/);
  assert.match(monitoringSource, /setError\(loadError\?\.message \|\| 'Unable to load expiry monitoring\.'/);
});

test('Historical expiry rows label stored balances as last-recorded snapshots', () => {
  assert.match(monitoringSource, /statusFilter === 'Historical' \? 'Last Recorded Qty' : 'Remaining Qty'/);
  assert.match(monitoringSource, /statusFilter === 'Historical' \? 'Last Recorded Qty' : 'Remaining Quantity'/);
  assert.match(monitoringSource, /historicalRemainingQuantity \|\| 0\)[\s\S]*?\(last recorded\)/);
  assert.match(monitoringSource, /if \(statusFilter === 'Historical'\) return batch\.isHistoricalPeriod/);
});

test('Expiry Monitoring offers authorized direct verification for unassigned and provisional batch products', () => {
  assert.match(monitoringSource, /canVerifyBatches = false, onVerifyBatches,\s*verificationRequest = null/);
  assert.match(monitoringSource, /data\.batches\.filter\(\(batch\) => !batch\.isHistoricalPeriod && !batch\.balanceConfirmed\)/);
  assert.match(monitoringSource, /data\.unassignedProducts\.forEach/);
  assert.match(monitoringSource, /Batch Verification Needed/);
  assert.match(monitoringSource, /Current stock:/);
  assert.match(monitoringSource, /onVerifyBatches\?\.\(product\)/);
  assert.match(monitoringSource, /disabled=\{busy\} aria-busy=\{busy\}/);
  assert.match(inventorySource, /canVerifyBatches=\{canReconcileExpiryBatches\}/);
  assert.match(inventorySource, /const canReconcileExpiryBatches = \['superadmin', 'admin'\]\.includes\(normalizedUserRole\)/);
  assert.match(productRoutesSource, /router\.post\('\/:id\/expiry-batches\/reconcile', requireAuth, authorizeRoles\('superadmin', 'admin'\), reconcileProductExpiryBatches\)/);
  assert.match(inventorySource, /onVerifyBatches=\{handleOpenExpiryVerification\}/);
  assert.match(inventorySource, /expiryBatchRequestSequenceRef\.current/);
  assert.match(inventorySource, /setExpiryReconcileRows\(verificationRows\)/);
  assert.match(inventorySource, /const verificationRows = existingStockToVerify > 0\s*\? \[\{ quantity: '', expiryDate: '', lotNumber: '' \}\]\s*: \[\];[\s\S]*?setExpiryReconcileRows\(verificationRows\)/);
  assert.match(inventorySource, /const verificationRows = existingStockToVerify > 0/);
  assert.doesNotMatch(inventorySource, /prior-period batch[\s\S]*?kept in History and excluded here/);
  assert.match(inventorySource, /setIsExpiryVerificationModalOpen\(true\)/);
  assert.match(inventorySource, /\{isExpiryVerificationModalOpen && expiryVerificationProduct && !isStockModalOpen &&/);
  assert.match(inventorySource, /<ExpiryBatchVerificationForm[\s\S]*?onSubmit=\{handleExpiryReconciliation\}/);
  assert.match(inventorySource, /<ExpiryBatchVerificationForm[\s\S]*?onSubmit=\{handleExpiryReconciliation\}/);
  assert.match(inventorySource, /\{isStockModalOpen && \(/);
  assert.match(inventorySource, /const handleExpiryReconciliation = async/);
  assert.match(inventorySource, /await reconcileProductExpiryBatchesApi\(expiryVerificationProduct\.productId/);
  assert.match(inventorySource, /if \(error\?\.status === 409\)[\s\S]*?retryOpenExpiryBatchRefreshRef\.current\?\.\(\)/);
  assert.match(inventorySource, /setExpiryMonitoringRefreshKey\(\(current\) => current \+ 1\)/);
  assert.match(inventorySource, /verificationRows = existingStockToVerify > 0/);
});

test('shared batch verification UI uses concise copy and defers validation hints until interaction', () => {
  assert.match(inventorySource, /Confirm the expiry dates and quantities of your current stock\./);
  assert.match(inventorySource, /<h3 id="expiry-batches-heading"[^>]*>Batch Details<\/h3>/);
  assert.match(verificationFormSource, /<h3 id="expiry-batches-heading"[^>]*>Existing Stock Batches<\/h3>/);
  assert.doesNotMatch(inventorySource, /Expiry Tracking On/);
  assert.match(inventorySource, /Add a batch for each expiry date\./);
  assert.match(inventorySource, /Current Stock: <strong>\{formatNumber\(expiryVerificationProduct\.productStock \|\| 0\)\}/);
  assert.match(inventorySource, /Existing Stock to Verify: <strong>\{formatNumber\(expiryVerificationProduct\.existingStockToVerify \|\| 0\)\}/);
  assert.match(inventorySource, /New Stock Recorded: <strong>\{formatNumber\(expiryVerificationProduct\.newStockRecorded \|\| 0\)\}/);
  assert.match(inventorySource, /Recorded batch quantities need review before verification\./);
  assert.match(inventorySource, /selectedStockDetailsLoaded && expiryBatchView\.batches\.length > 0 \? expiryBatchView\.batches\.map/);
  assert.doesNotMatch(inventorySource, /New opening allocation/);
  assert.match(inventorySource, /formatNumber\(expiryReconcileTotal\)\} of \{formatNumber\(expiryReconcileTarget\)\}/);
  assert.match(inventorySource, /expiryReconcileTotal === expiryReconcileTarget/);
  assert.match(inventorySource, /expectedUnassignedStock: expiryVerificationProduct\.existingStockToVerify/);
  assert.match(inventorySource, /recordedBatchVersions: \(expiryVerificationProduct\.batches \|\| \[\]\)\.map/);
  assert.doesNotMatch(inventorySource, /expiryReconcileRows\.map\(\(row\) => \(\{\s*batchRecordId:/);
  assert.match(inventorySource, /expiryReconcileTouched && !expiryReconcileDatesValid/);
  assert.match(inventorySource, /expiryReconcileTouched && !expiryReconcileQuantitiesValid/);
  assert.match(verificationFormSource, /disabled=\{!valid \|\| isSubmitting \|\| isLoading \|\| needsRefresh\}/);
  assert.match(inventorySource, /<button type="button" onClick=\{handleCancelExpiryReconciliation\}[^>]*>Cancel<\/button>/);
  assert.match(inventorySource, /<h2 className="text-sm font-semibold text-slate-900">Verify Batches<\/h2>/);
  assert.match(inventorySource, /placeholder="Select expiry date"/);
  assert.match(inventorySource, /placeholder="Enter quantity"/);
  assert.match(inventorySource, /placeholder="e\.g\. LOT-2026-001"/);
  assert.match(verificationFormSource, /className="h-8 rounded-md bg-slate-900[^>]*>Add Batch<\/button>/);
  assert.match(verificationFormSource, /className="h-9 rounded-md border border-rose-200 bg-white[^>]*>Remove<\/button>/);
});

test('Verify Batches inputs share an aligned desktop row and the lot-reference helper stays with its input', () => {
  assert.match(verificationFormSource, /grid grid-cols-1 gap-2 md:grid-cols-\[minmax\(9rem,1fr\)_minmax\(6rem,0\.55fr\)_minmax\(11rem,1\.3fr\)_auto\] md:items-end/);
  assert.match(verificationFormSource, /className="mt-1 block h-9 w-full min-w-0 rounded-md border/);
  assert.match(verificationFormSource, /className="h-9 rounded-md border border-rose-200[^>]*>Remove<\/button>/);
  assert.match(verificationFormSource, /Batch \/ Lot No\. \(optional\)[\s\S]*?placeholder="e\.g\. LOT-2026-001"[\s\S]*?Optional\. A batch reference is generated when stock is verified\./);
});

test('Inventory refreshes an open expiry batch view automatically for Add Stock and requires review for Remove Stock', () => {
  assert.match(inventorySource, /subscribeRealtimeEvent\('inventory\.updated', onInventoryUpdated\)/);
  assert.match(monitoringSource, /subscribeRealtimeEvent\('realtime\.resync', scheduleRefresh\)/);
  assert.match(inventorySource, /changedCodes\.includes\(sku\)/);
  assert.match(inventorySource, /applyExpiryBatchSnapshot\(batchResult, productId\)/);
  assert.match(inventorySource, /if \(modalAction === 'OUT'\) setStockDetailsNeedReview\(true\)/);
  assert.match(inventorySource, /if \(modalAction === 'OUT'\) setStockDetailsNeedReview\(true\)/);
  assert.match(inventorySource, /I’ve reviewed the update/);
  assert.match(inventorySource, /Inventory changed while this form was open/);
  assert.match(inventorySource, /disabled=\{[^}]*modalAction === 'OUT' && stockDetailsNeedReview[^}]*stockDetailsSyncStatus === 'error'\}/);
  assert.match(inventorySource, /const isInitialTrackedStockInError = modalAction === 'IN'[\s\S]*?stockDetailsSyncStatus === 'error'/);
  assert.match(inventorySource, /stockDetailsSyncStatus === 'loading' \|\| stockDetailsSyncStatus === 'error'/);
  assert.match(inventorySource, /error\?\.status === 409\) \{\s*if \(selectedItem\?\.expiryTrackingEnabled && retryOpenExpiryBatchRefreshRef\.current\) \{\s*retryOpenExpiryBatchRefreshRef\.current\?\.\(\);\s*\} else \{\s*void refreshStockDetailsAfterConflict\(selectedItem\?\.id\)/);
  assert.match(inventorySource, /error\.message \|\| 'Stock change was not saved\.'/);
  assert.match(inventorySource, /requestSequence !== expiryBatchRequestSequenceRef\.current/);
  assert.match(inventorySource, /onClick=\{retryStockDetailsRefresh\}/);
  assert.match(inventorySource, /expectedUpdatedAt: inventory\.find/);
  assert.match(inventorySource, /adjustmentRequestId: stockAdjustmentRequestIdRef\.current/);
  const snapshotHelper = inventorySource.slice(inventorySource.indexOf('const applyExpiryBatchSnapshot'), inventorySource.indexOf('const Inventory ='));
  assert.doesNotMatch(snapshotHelper, /setStockForm/);
  const conflictRefresh = inventorySource.slice(inventorySource.indexOf('const refreshStockDetailsAfterConflict'), inventorySource.indexOf('const retryStockDetailsRefresh'));
  assert.doesNotMatch(conflictRefresh, /setStockForm/);
  assert.match(conflictRefresh, /await listProductsApi\(\{ includeImages: false \}\);\s*if \(requestSequence !== expiryBatchRequestSequenceRef\.current\)/);
  assert.ok(conflictRefresh.indexOf('await listProductExpiryBatchesApi(productId)') < conflictRefresh.indexOf('applyExpiryBatchSnapshot(batchResult, productId)'));
  const reconcileHandler = inventorySource.slice(inventorySource.indexOf('const handleExpiryReconciliation'), inventorySource.indexOf('const handleStockSubmit'));
  assert.match(reconcileHandler, /else \{\s*await reconcileProductExpiryBatchesApi\(expiryVerificationProduct\.productId, verificationPayload\);[\s\S]*?setExpiryMonitoringRefreshKey/);
  assert.match(inventorySource, /retryOpenExpiryBatchRefreshRef\.current\?\.\(\)/);
});

test('expiry-tracked Add Stock opens its shell immediately and refreshes batch data in place', () => {
  const addStockHandler = inventorySource.slice(inventorySource.indexOf('const handleOpenStockModal = async'), inventorySource.indexOf('const handleStockSubmit'));
  assert.match(addStockHandler, /setIsStockModalOpen\(true\)/);
  assert.ok(addStockHandler.indexOf('setIsStockModalOpen(true)') < addStockHandler.indexOf('await listProductExpiryBatchesApi(item.id)'), 'the modal shell opens before the initial batch request completes');
  assert.match(addStockHandler, /setStockDetailsSyncStatus\(item\.expiryTrackingEnabled \? 'loading' : 'success'\)/);
  assert.match(addStockHandler, /await listProductExpiryBatchesApi\(item\.id\)/);
  assert.match(addStockHandler, /requestSequence !== expiryBatchRequestSequenceRef\.current/);
  assert.match(addStockHandler, /setExpiryBatchView\(\{[\s\S]*loadedProductId: String\(item\.id \|\| ''\)/);
  assert.match(addStockHandler, /setStockDetailsSyncStatus\('error'\)/);
  assert.match(inventorySource, /key="stock-initial-loading-view"[\s\S]*?Refreshing current inventory details/);
  assert.match(inventorySource, /key="stock-initial-error-view"[\s\S]*?Unable to load current inventory details\.[\s\S]*?onClick=\{retryStockDetailsRefresh\}[\s\S]*?>Retry</);
  assert.match(inventorySource, /stockInTracksExpiry && <>[\s\S]*?aria-labelledby="stock-in-batch-details-heading"/);
});

test('expiry date correction is admin-only, transactional, audited, and refreshes Inventory monitoring', () => {
  assert.match(productRoutesSource, /router\.patch\('\/:id\/expiry-batches\/:batchId\/correct-expiry', requireAuth, authorizeRoles\('superadmin', 'admin'\), correctExpiryBatchDate\)/);
  assert.match(correctionServiceSource, /session\.withTransaction/);
  assert.match(correctionServiceSource, /updatedAt: values\.expectedUpdatedAt/);
  assert.match(correctionServiceSource, /SpecialOrderStockReservation\.find\([\s\S]*?'batchAllocations\.batch': batch\._id/);
  assert.match(correctionServiceSource, /ExpiryBatchCorrection\.create/);
  assert.match(correctionServiceSource, /historicalAllocationCount/);
  assert.match(correctionModelSource, /previousExpiryDate:[\s\S]*newExpiryDate:[\s\S]*reason:[\s\S]*actor:[\s\S]*createdAt:/);
  assert.match(correctionModelSource, /immutable: true/);
  assert.match(inventorySource, /Correct Expiry Date/);
  assert.match(inventorySource, /Reason for Correction <span className="text-rose-600">\*<\/span>/);
  assert.match(inventorySource, /correctExpiryBatchDateApi\(\s*expiryCorrectionBatch\.productId,\s*expiryCorrectionBatch\._id \|\| expiryCorrectionBatch\.id/);
  assert.match(inventorySource, /setExpiryMonitoringRefreshKey\(\(current\) => current \+ 1\)/);
  assert.match(monitoringSource, /\}, \[reloadKey, refreshKey\]\)/);
  assert.match(inventorySource, /app-primary-action expiry-correction-primary/);
  assert.match(indexCssSource, /button\.expiry-correction-primary:not\(:disabled\)\s*\{\s*background-color:\s*#111827/);
  assert.match(indexCssSource, /button\.expiry-correction-primary:not\(:disabled\):hover\s*\{\s*background-color:\s*#1f2937/);
  assert.match(indexCssSource, /button\.expiry-correction-primary:disabled\s*\{\s*background-color:\s*#cbd5e1/);
  assert.match(productControllerSource, /expiryDate: batch\.expiryDate,\s*updatedAt: batch\.updatedAt,/);
  assert.match(monitoringSource, /canCorrectExpiryDate && !batch\.isHistoricalPeriod/);
  assert.match(monitoringSource, /<ViewportTooltip content="Correct Expiry Date"/);
  assert.match(monitoringSource, /onCorrectExpiryDate\?\.\(batch\)/);
  assert.match(monitoringSource, /Correct Expiry Date<\/span><\/button>/);
  assert.match(inventorySource, /<button\s+onClick=\{\(\) => handleOpenStockModal\(item, 'IN'\)\}[^>]*className="inline-flex h-8/);
  assert.match(monitoringSource, /min-w-\[1160px\]/);
  assert.match(monitoringSource, /w-36 whitespace-nowrap[\s\S]*?Action/);
  assert.match(monitoringSource, /<td className="whitespace-nowrap px-2 py-2 text-center align-middle">\{batch\.updatedAt/);
  assert.match(monitoringSource, /inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-1\.5 whitespace-nowrap rounded-lg border border-gray-900 bg-gray-900 px-2 text-center text-xs font-semibold text-white shadow-sm transition-colors/);
  assert.match(monitoringSource, /<th className="whitespace-nowrap px-2 py-2 font-semibold">Batch Reference \/ Lot No\.<\/th>/);
  assert.match(monitoringSource, /<td className="whitespace-nowrap px-2 py-2 text-center align-middle">\{batch\.updatedAt/);
});
