/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const inventorySource = fs.readFileSync(
  path.resolve(__dirname, '../../src/pages/Inventory.jsx'),
  'utf8',
);
const batchRemovalSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/ExpiryBatchRemovalSelector.jsx'),
  'utf8',
);
const batchRemovalUtilitySource = fs.readFileSync(
  path.resolve(__dirname, '../../src/utils/expiryBatchRemoval.mjs'),
  'utf8',
);
const expiryBatchServiceSource = fs.readFileSync(
  path.resolve(__dirname, '../src/services/expiryBatchService.js'),
  'utf8',
);
const productRoutesSource = fs.readFileSync(
  path.resolve(__dirname, '../src/routes/productRoutes.js'),
  'utf8',
);
const expiryBatchVerificationFormSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/ExpiryBatchVerificationForm.jsx'),
  'utf8',
);

test('Stock Operations uses clear Add Stock and Remove Stock actions without changing handlers', () => {
  assert.match(inventorySource, /onClick=\{\(\) => handleOpenStockModal\(item, 'IN'\)\}/);
  assert.match(inventorySource, /<\/span>Add Stock/);
  assert.match(inventorySource, /onClick=\{\(\) => item\.stock > 0 && handleOpenStockModal\(item, 'OUT'\)\}/);
  assert.match(inventorySource, /<span>Remove Stock<\/span>/);
});

test('Remove Stock keeps its zero-stock disabled guard and both actions use compact outline icons', () => {
  assert.match(inventorySource, /disabled=\{item\.stock <= 0\}/);
  assert.match(inventorySource, /title=\{item\.stock <= 0 \? 'No stock available' : 'Remove Stock'\}/);
  assert.match(inventorySource, /strokeWidth="1\.8" d="M12 5v14M5 12h14"/);
  assert.match(inventorySource, /strokeWidth="1\.8" d="M5 12h14"/);
  assert.match(inventorySource, /gap-1\.5 whitespace-nowrap/);
  assert.match(inventorySource, /inline-flex h-8 shrink-0 items-center justify-center gap-1\.5/);
  assert.match(inventorySource, /px-1\.5 text-\[11px\]/);
  assert.match(inventorySource, /w-\[21%\].*Actions/);
  assert.match(inventorySource, /h-3 w-3 shrink-0/);
});

test('stock operation modal uses the same user-friendly terminology', () => {
  assert.match(inventorySource, /modalAction === 'IN' \? 'Add Stock' : 'Remove Stock'/);
  assert.match(inventorySource, /modalAction === 'IN' \? 'add stock' : 'remove stock'/);
});

test('expiry-tracked Add Stock waits for the first batch snapshot and offers retry on failure', () => {
  assert.match(inventorySource, /const selectedStockDetailsLoaded = String\(expiryBatchView\.loadedProductId \|\| ''\) === String\(selectedItem\?\.id \|\| ''\)/);
  assert.match(inventorySource, /const isInitialTrackedStockInLoading = modalAction === 'IN'[\s\S]*?stockDetailsSyncStatus === 'loading'/);
  assert.match(inventorySource, /const isInitialTrackedStockInError = modalAction === 'IN'[\s\S]*?stockDetailsSyncStatus === 'error'/);
  const loadingStart = inventorySource.indexOf('key="stock-initial-loading-view"');
  const loadingEnd = inventorySource.indexOf(': isInitialTrackedStockInError ?', loadingStart);
  assert.ok(loadingStart >= 0 && loadingEnd > loadingStart);
  const loadingView = inventorySource.slice(loadingStart, loadingEnd);
  assert.match(loadingView, /role="status"[\s\S]*?Refreshing current inventory details/);
  assert.doesNotMatch(loadingView, /Batch Details|New Stock Expiry Date|stock-operation-quantity|<select|type="submit"/);
  assert.match(inventorySource, /key="stock-initial-error-view"[\s\S]*?Unable to load current inventory details\.[\s\S]*?onClick=\{retryStockDetailsRefresh\}[\s\S]*?>Retry</);
  assert.match(inventorySource, /loadedProductId: String\(item\.id \|\| ''\)/);
  assert.match(inventorySource, /if \(requestSequence !== expiryBatchRequestSequenceRef\.current\) return;[\s\S]*?setExpiryBatchView\([\s\S]*?loadedProductId/);
});

test('Add Stock expiry activation enters Verify Batches before rendering inline expiry fields', () => {
  const toggleHandler = inventorySource.slice(
    inventorySource.indexOf('const handleExpiryTrackingToggle'),
    inventorySource.indexOf('const handleOpenExpiryVerification'),
  );
  const openVerificationHandler = inventorySource.slice(
    inventorySource.indexOf('const handleOpenExpiryVerification'),
    inventorySource.indexOf('const refreshExpiryVerification'),
  );
  assert.match(inventorySource, /checked=\{enableExpiryTrackingOnStockIn\}[\s\S]*?onChange=\{\(event\) => \{ void handleExpiryTrackingToggle\(event\.target\.checked\); \}\}/);
  assert.match(toggleHandler, /const existingStock = Number\(selectedItem\.stock \|\| 0\);[\s\S]*?if \(existingStock <= 0\) return;[\s\S]*?await handleOpenExpiryVerification[\s\S]*?enterInlineViewBeforeFetch: true/);
  assert.match(openVerificationHandler, /if \(options\.inlineStock && options\.enterInlineViewBeforeFetch\)[\s\S]*?inlineActivationLoadPending: true[\s\S]*?setExpiryVerificationProduct\(pendingProduct\)[\s\S]*?transitionStockVerificationView\(true\)[\s\S]*?const result = await listProductExpiryBatchesApi/);
  assert.match(inventorySource, /expiryVerificationProduct\.inlineActivationLoadPending && isLoadingExpiryVerification \? <div className="space-y-4 p-4">[\s\S]*?Loading batch details\.\.\.[\s\S]*?expiryVerificationLoadError \? <div[\s\S]*?Retry[\s\S]*?<ExpiryBatchVerificationForm/);
  assert.match(inventorySource, /<ExpiryBatchVerificationForm[\s\S]*?isLoading=\{isLoadingExpiryVerification\}/);
  assert.match(inventorySource, /Loading batch details\.\.\.[\s\S]*?onClick=\{handleCloseStockModal\}/);
  assert.match(inventorySource, /onSubmit=\{handleExpiryReconciliation\}[\s\S]*?onCancel=\{handleCloseStockModal\}/);
  assert.doesNotMatch(inventorySource, /handleInlineStockVerificationBack|onBack=/);
  assert.match(inventorySource, /stockInTracksExpiry && <>[\s\S]*?Batch Details[\s\S]*?Verify Batches[\s\S]*?New Stock Expiry Date/);
  assert.match(inventorySource, /inlineStockFlow=\{expiryVerificationProduct\.inlineStockFlow === true\}/);
  assert.match(inventorySource, /if \(action === 'IN' && !result\?\.reconciled && existingStockToVerify > 0\)[\s\S]*?inlineStockFlow: true[\s\S]*?transitionStockVerificationView\(true\)/);
});

test('stock table emphasizes quantity and modal shows the saved unit only in its summary', () => {
  assert.match(inventorySource, /const getStockUnit = \(item\) => String\(item\?\.sellingUnit \|\| ''\)\.trim\(\)/);
  assert.match(inventorySource, /w-\[12%\] border border-gray-700 py-2 pl-6 pr-3 text-left text-\[11px\] font-semibold">Current Stock/);
  assert.match(inventorySource, /py-1\.5 pl-6 pr-3 text-left border border-gray-200 dark:border-gray-700">\s*<span className="inline-flex max-w-full flex-wrap items-baseline justify-start gap-x-1">/);
  assert.match(inventorySource, /text-sm font-semibold text-gray-900 dark:text-white">\{formatNumber\(item\.stock\)\}/);
  assert.match(inventorySource, /getStockUnit\(item\) && <span className="min-w-0 break-words text-xs font-normal text-gray-500 dark:text-gray-400">\{getStockUnit\(item\)\}<\/span>/);
  assert.match(inventorySource, /formatStockWithUnit\(selectedItem\)/);
  assert.match(inventorySource, /htmlFor="stock-operation-quantity"[^>]*>Quantity<\/label>/);
  assert.match(inventorySource, /flex w-full min-w-0 items-center justify-center gap-2/);
  assert.match(inventorySource, /id="stock-operation-quantity"/);
  assert.match(inventorySource, /getStockUnit\(selectedItem\) \|\| 'Not specified'/);
  assert.doesNotMatch(inventorySource, /Quantity to \{modalAction === 'IN'/);
  assert.doesNotMatch(inventorySource, /getStockUnit\(selectedItem\) && <span/);
  const stockTableMarkup = inventorySource.slice(inventorySource.indexOf('<table'), inventorySource.indexOf('<ExpiryMonitoring'));
  assert.doesNotMatch(stockTableMarkup, /expiryDate|expiresAt|hasExpiry/);
});

test('expiry-tracked Stock-In restores Batch Details, Verify Batches, and delivery fields', () => {
  assert.match(inventorySource, /stockInTracksExpiry && <>[\s\S]*?Batch Details[\s\S]*?Verify Batches[\s\S]*?New Stock Expiry Date/);
  assert.match(inventorySource, /New Stock Expiry Date[\s\S]*?type="date" name="expiryDate" data-validation-key="expiryDate" required/);
  assert.match(inventorySource, /Batch \/ Lot No\./);
  assert.match(inventorySource, /maxLength=\{100\}/);
  assert.match(inventorySource, /<ExpiryBatchVerificationForm/);
  assert.match(expiryBatchVerificationFormSource, /Current Stock:/);
  assert.match(expiryBatchVerificationFormSource, /Existing Stock to Verify:/);
  assert.match(expiryBatchVerificationFormSource, /Existing Stock Batches/);
  assert.match(expiryBatchVerificationFormSource, /New Stock Delivery[\s\S]*optional/);
  assert.match(expiryBatchVerificationFormSource, /Delivery Total:[\s\S]*Stock After Delivery/);
  assert.match(expiryBatchVerificationFormSource, /Confirm & Add Stock[\s\S]*Confirm Verification/);
  assert.doesNotMatch(expiryBatchVerificationFormSource, />Back</);
  assert.doesNotMatch(inventorySource, /stockExpiryVerificationDraft/);
  const batchDetailsStart = inventorySource.indexOf('aria-labelledby="stock-in-batch-details-heading"');
  const batchDetailsEnd = inventorySource.indexOf('</section>', batchDetailsStart);
  const addStockBatchDetails = inventorySource.slice(batchDetailsStart, batchDetailsEnd);
  assert.match(addStockBatchDetails, /Verify the current stock before recording a new delivery/);
  assert.match(addStockBatchDetails, /expiryBatchView\.reconciled \? 'Current expiry batches are verified\.'/);
  const batchColumns = ['Batch No.', 'Expiry Date', 'Received', 'Remaining', 'Reserved', 'Action']
    .map((label) => addStockBatchDetails.indexOf(`>${label}</th>`));
  assert.ok(batchColumns.every((column, index) => column >= 0 && (index === 0 || column > batchColumns[index - 1])), 'Add Stock table keeps the six required columns in order');
  assert.match(addStockBatchDetails, /selectedStockDetailsLoaded && expiryBatchView\.batches\.length > 0 \? expiryBatchView\.batches\.map/);
  assert.match(addStockBatchDetails, /batch\.quantityReceived[\s\S]*?batch\.remainingQuantity[\s\S]*?batch\.reservedQuantity/);
  assert.doesNotMatch(addStockBatchDetails, /batches\.filter\(/);
  assert.match(addStockBatchDetails, /canReconcileExpiryBatches && batch\.updatedAt[\s\S]*?handleStartExpiryCorrection/);
  assert.match(inventorySource, /Number\(selectedItem\?\.stock \|\| 0\) > 0 && \(!expiryBatchView\.reconciled \|\| enableExpiryTrackingOnStockIn\)/);
  assert.match(inventorySource, /verifyExpiryBatchesAndAddStockApi/);
});

test('Verify Batches saves existing allocation and optional new deliveries in one guarded request', () => {
  const submitHandlerStart = inventorySource.indexOf('const handleExpiryReconciliation');
  const stockSubmitStart = inventorySource.indexOf('const handleStockSubmit');
  const reconciliationHandler = inventorySource.slice(submitHandlerStart, stockSubmitStart);
  assert.match(reconciliationHandler, /verifyExpiryBatchesAndAddStockApi\(expiryVerificationProduct\.productId/);
  assert.match(reconciliationHandler, /deliveryBatches: stockInDetails\?\.deliveryBatches \|\| \[\]/);
  assert.match(reconciliationHandler, /expiryReconcileSubmitRef\.current = true/);
  assert.match(expiryBatchVerificationFormSource, /deliveryBatches: activeDeliveryRows\.map/);
  assert.doesNotMatch(expiryBatchVerificationFormSource, /onBack|>Back</);
  assert.match(inventorySource, /checked=\{enableExpiryTrackingOnStockIn\}[\s\S]*?onChange=\{\(event\) => \{ void handleExpiryTrackingToggle\(event\.target\.checked\); \}\}/);
});

test('enabling expiry tracking for existing stock opens shared verification before Stock-In', () => {
  const toggleHandler = inventorySource.slice(
    inventorySource.indexOf('const handleExpiryTrackingToggle'),
    inventorySource.indexOf('const handleOpenExpiryVerification'),
  );
  assert.match(toggleHandler, /setEnableExpiryTrackingOnStockIn\(true\)/);
  assert.match(toggleHandler, /await handleOpenExpiryVerification[\s\S]*inlineStock: true, activationPreview: true/);
  assert.doesNotMatch(toggleHandler, /apiRequest|updateProductApi|enableProductExpiryTrackingApi/);
  assert.match(inventorySource, /isStockVerificationView && expiryVerificationProduct/);
  assert.doesNotMatch(inventorySource, /stockExpiryVerificationDraft|expiryVerification: stockExpiryVerificationDraft|handleInlineStockVerificationBack|onBack=/);
  assert.match(inventorySource, /key="verify-batches-view"[\s\S]*?onCancel=\{handleCloseStockModal\}/);
  assert.doesNotMatch(inventorySource.slice(inventorySource.indexOf('key="verify-batches-view"'), inventorySource.indexOf('key="stock-initial-loading-view"')), /This product has expiry tracking/);
  assert.match(inventorySource, /selectedItem\?\.expiryTrackingEnabled && !expiryBatchView\.reconciled/);
  assert.match(expiryBatchServiceSource, /const verifyExpiryBatchesAndReceiveStock = async/);
  assert.match(expiryBatchServiceSource, /await session\.withTransaction\(async \(\) => \{[\s\S]*?reconcileExpiryBatches\(verification\)[\s\S]*?createBatchReceipt/);
  assert.match(productRoutesSource, /expiry-batches\/verify-stock-in/);
});

test('Add Stock to Verify Batches keeps the existing centered modal expansion and reverse view motion', () => {
  assert.match(inventorySource, /import \{ AnimatePresence, motion, useIsPresent, useReducedMotion \} from 'framer-motion'/);
  assert.match(inventorySource, /const stockViewTransitionDuration = prefersReducedMotion \? 0 : 0\.2/);
  assert.match(inventorySource, /<AnimatePresence[\s\S]*?initial=\{false\}[\s\S]*?mode="wait"[\s\S]*?onExitComplete=\{\(\) => \{/);
  assert.match(inventorySource, /key="verify-batches-view"[\s\S]*?direction=\{1\}[\s\S]*?duration=\{stockViewTransitionDuration\}/);
  assert.match(inventorySource, /key="stock-operation-view"[\s\S]*?direction=\{-1\}[\s\S]*?duration=\{stockViewTransitionDuration\}/);
  assert.match(inventorySource, /const initial = duration === 0 \|\| \(centerExpansion && direction > 0\) \? false : \{ opacity: 0, x: direction \* 12 \}/);
  assert.match(inventorySource, /initial=\{initial\}[\s\S]*?animate=\{\{ opacity: 1, x: 0 \}\}[\s\S]*?exit=\{undefined\}/);
  assert.match(inventorySource, /const isInteractive = true;/);
  assert.match(inventorySource, /aria-hidden=\{!isInteractive\}[\s\S]*?inert=\{!isInteractive\}/);
  assert.match(inventorySource, /const transitionStockVerificationView = \(nextView\) => \{[\s\S]*?if \(stockViewTransitionLockRef\.current\) return false/);
  const expiryTrackingCheckboxes = [...inventorySource.matchAll(/checked=\{enableExpiryTrackingOnStockIn\}[\s\S]*?disabled=\{([^}]+)\}/g)];
  assert.equal(expiryTrackingCheckboxes.length, 1);
  assert.ok(expiryTrackingCheckboxes.every(([, disabledCondition]) => disabledCondition === '!canReconcileExpiryBatches || isExpiryReconciling'));
  const trackingToggleHandler = inventorySource.slice(
    inventorySource.indexOf('const handleExpiryTrackingToggle'),
    inventorySource.indexOf('const handleOpenExpiryVerification'),
  );
  assert.match(trackingToggleHandler, /if \(stockViewTransitionLockRef\.current\) finishStockViewTransition\(\)/);
  assert.doesNotMatch(trackingToggleHandler, /if \(stockViewTransitionLockRef\.current\) return/);
  assert.match(trackingToggleHandler, /expiryBatchRequestSequenceRef\.current \+= 1;[\s\S]*?setEnableExpiryTrackingOnStockIn\(false\)[\s\S]*?setExpiryReconcileRows\(\[\]\)/);
  assert.match(inventorySource, /onEntered=\{finishStockViewTransition\}/);
  assert.match(inventorySource, /<MotionDiv[\s\S]*?ref=\{stockModalRef\}[\s\S]*?layout=\{false\}[\s\S]*?onTransitionEnd=\{\(event\) => \{[\s\S]*?event\.propertyName === 'max-width'[\s\S]*?finishStockViewTransition\(\)/);
  assert.match(inventorySource, /max-w-\[46rem\].*max-w-\[31rem\].*overflow-x-hidden overflow-y-auto.*prefersReducedMotion \? 'transition-none' : 'transition-all'/);
  assert.match(inventorySource, /if \(!isStockVerificationView && !enableExpiryTrackingOnStockIn\) \{\s*setHasExpandedInlineStockModal\(false\)/);
  assert.match(inventorySource, /layout=\{isCenteredStockExpansionTransition \? false : 'size'\}/);
  assert.match(inventorySource, /const inlineActivationNeedsVerification = !selectedItem\?\.expiryTrackingEnabled && Number\(selectedItem\?\.stock \|\| 0\) > 0/);
  assert.match(inventorySource, /event\.propertyName === 'max-width'/);
  assert.match(inventorySource, /On narrow viewports both max-widths resolve to the same available/);
  assert.match(inventorySource, /transitionStockVerificationView\(true\)/);
  assert.match(inventorySource, /transitionStockVerificationView\(false\)/);
  assert.match(inventorySource, /const useCenteredExpansion = nextView && stockModalExpansionIntentRef\.current/);
  assert.match(inventorySource, /stockModalExpansionIntentRef\.current = existingStock > 0/);
});

test('expiry-tracked Remove Stock uses five focused columns and a compact derived total', () => {
  assert.match(inventorySource, /modalAction === 'OUT' && expiryBatchView\.reconciled\s*\? <ExpiryBatchRemovalSelector/);
  assert.match(inventorySource, /batchAllocations: stockOutBatchAllocationRows/);
  assert.match(inventorySource, /const usesBatchRemovalQuantity = isTrackedStockOut && expiryBatchReady && expiryBatchView\.reconciled/);
  assert.match(inventorySource, /batch: String\(batch\),[\s\S]*?batchId: String\(batchDetails\?\.batchId \|\| ''\)/);
  assert.match(inventorySource, /const qty = usesBatchRemovalQuantity\s*\? stockOutBatchAllocationTotal/);
  assert.match(inventorySource, /adjustmentQuantity: qty/);
  assert.match(inventorySource, /!usesBatchRemovalQuantity && <div>\s*<label htmlFor="stock-operation-quantity"/);
  assert.match(inventorySource, /Number\.isSafeInteger\(stockOutBatchAllocationTotal\)/);
  assert.match(inventorySource, /stockOutBatchAllocationInvalid/);
  assert.match(inventorySource, /stockOutBatchAllocationSnapshots/);
  assert.match(inventorySource, /stockOutBatchAllocationReviewRows\.length === 0/);
  assert.match(inventorySource, /Review Batch Availability/);
  assert.match(inventorySource, /Total to Remove: \{formatNumber\(stockOutBatchAllocationTotal\)\}/);
  assert.match(inventorySource, /usesWideStockModal \? 'max-w-\[46rem\]' : 'max-w-\[31rem\]'/);
  assert.doesNotMatch(inventorySource, /Removal Summary|Total Quantity to Remove|Expected Stock After Removal/);
  assert.doesNotMatch(inventorySource, /Batch Quantity Mismatch/);
  assert.doesNotMatch(inventorySource, /Batch quantities must match the Quantity field/);
  assert.match(batchRemovalSource, /<th className="px-2 py-2 font-semibold">Batch Reference<\/th>[\s\S]*<th className="px-2 py-2 font-semibold">Expiry Date<\/th>[\s\S]*<th className="px-2 py-2 font-semibold">Status<\/th>[\s\S]*<th className="px-2 py-2 text-right font-semibold">Available<\/th>[\s\S]*<th className="px-2 py-2 text-right font-semibold">Remove Qty<\/th>/);
  assert.match(batchRemovalSource, /Remove Qty/);
  assert.equal((batchRemovalSource.match(/<th className=/g) || []).length, 5);
  assert.doesNotMatch(batchRemovalSource, /Current Balance|Batch ID:|>Reserved</);
  assert.doesNotMatch(batchRemovalSource, /Correct Expiry Date|Batch Reference \/ Lot No\.|Expiry \/ Status/);
  assert.match(batchRemovalSource, /max-h-64 overflow-y-auto/);
  assert.match(batchRemovalSource, /<div className="hidden sm:block">/);
  assert.match(batchRemovalSource, /w-full table-fixed/);
  assert.match(batchRemovalSource, /w-16 rounded-md/);
  assert.match(batchRemovalSource, /getEligibleBatchRemovalBatches\(batches\)/);
  assert.match(batchRemovalSource, /No batches available for stock removal\./);
  assert.match(batchRemovalSource, /Batch availability changed or a quantity exceeds/);
  assert.match(batchRemovalSource, /Confirm current availability/);
  assert.match(batchRemovalSource, /Clear allocation/);
  assert.match(batchRemovalUtilitySource, /remainingQuantity.*reservedQuantity/);
  assert.match(batchRemovalSource, /table-fixed/);
  assert.match(batchRemovalSource, /available <= 0/);
  assert.match(batchRemovalSource, /formatExpiryDateLabel\(batch\.expiryDate\)/);
});

test('non-expiry and unverified products do not use editable batch totals', () => {
  assert.match(inventorySource, /!usesBatchRemovalQuantity && <div>\s*<label htmlFor="stock-operation-quantity"/);
  assert.match(inventorySource, /usesBatchRemovalQuantity && \(stockOutBatchAllocationInvalid \|\| !stockOutBatchSelectionComplete\)/);
  assert.match(inventorySource, /if \(modalAction === 'OUT' && selectedItem\?\.expiryTrackingEnabled === true && !expiryBatchView\.reconciled\)\s*\{[\s\S]*Batch Verification Needed/);
  assert.match(inventorySource, /selectedItem\?\.expiryTrackingEnabled === true/);
});
