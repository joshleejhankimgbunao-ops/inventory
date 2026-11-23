/* global require, __dirname */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportsSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Reports.jsx'), 'utf8');
const tableSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/ReportRecordTable.jsx'), 'utf8');

test('sales KPI cards show Total Sales, Collections, Total Orders, and Items Issued in order', () => {
  const salesKpiTitles = [...reportsSource.matchAll(/title="(Total Sales|Collections|Total Orders|Items Issued)"/g)].map((match) => match[1]);
  assert.deepEqual(salesKpiTitles.slice(0, 4), ['Total Sales', 'Collections', 'Total Orders', 'Items Issued']);
  assert.match(reportsSource, /title="Total Sales"\s+value=\{formatCurrency\(totalSalesRevenue\)\}/);
  assert.match(reportsSource, /title="Collections"\s+value=\{collectionsReady \? formatCurrency\(totalCollectedRevenue\) : 'Unavailable'\}/);
  assert.doesNotMatch(reportsSource, /title="Gross Profit"|Historical unit costs and unit conversions are not stored on sale lines\./);
  assert.match(reportsSource, /const totalCollectedRevenue = useMemo\(\s*\(\) => trendData\.reduce\(\(sum, bucket\) => sum \+ Number\(bucket\.sales \|\| 0\), 0\),\s*\[trendData\]\s*\)/);
  assert.ok(reportsSource.indexOf('const totalCollectedRevenue') < reportsSource.indexOf('const collectedRevenueTrend'));
  assert.match(reportsSource, /filteredTransactions\s*\.filter\(isImmediateSaleCollectionForReporting\)/);
  assert.match(reportsSource, /filteredCreditPaymentEvents\.forEach\(\(payment\) => \{/);
  assert.match(reportsSource, /filteredSpecialOrderPaymentEvents\.forEach\(\(payment\) => \{/);
  assert.match(reportsSource, /const collectedRevenueTrend = useMemo\(\(\) => getMetricTrend\(totalCollectedRevenue, previousSalesMetrics\.collectedRevenue\)/);
  assert.match(reportsSource, /icon=\{\(?\s*<svg/);
  assert.match(reportsSource, /\{icon\}/);
  assert.match(reportsSource, /collectionsAnalyticsState === 'loading' \? <CollectionsAnalyticsSkeleton \/>/);
  assert.match(reportsSource, /CollectionsMetricSkeleton/);
  assert.match(reportsSource, /CollectionsAnalyticsSkeleton/);
  assert.match(reportsSource, /h-\[320px\] min-w-0 w-full/);
  assert.match(reportsSource, /motion-reduce:animate-none/);
});

test('collections state distinguishes loading, initial error, success, and empty results', () => {
  assert.match(reportsSource, /const transactionsSnapshotPending = isTransactionsLoading && transactions\.length === 0/);
  assert.match(reportsSource, /const collectionsIdentityReady = collectionsOwnerKey === collectionsCacheKey/);
  assert.match(reportsSource, /const collectionsReady = collectionsIdentityReady && creditCollectionsState === 'ready' && specialCollectionsState === 'ready' && !transactionsSnapshotPending && !reportTransactionsError/);
  assert.match(reportsSource, /const collectionsLoading = !collectionsHasInitialError && \(!collectionsIdentityReady \|\| transactionsSnapshotPending \|\| !collectionsReady\)/);
  assert.match(reportsSource, /const collectionsAnalyticsState = collectionsLoading[\s\S]*?collectionsHasInitialError[\s\S]*?trendData\.length > 0 \? 'success' : 'empty'/);
  assert.match(reportsSource, /Collections could not be loaded\./);
  assert.match(reportsSource, /No collection data yet/);
});

test('overlapping collection requests cannot replace newer results and retry is available', () => {
  assert.match(reportsSource, /const creditCollectionsRequestRef = useRef\(0\)/);
  assert.match(reportsSource, /const specialCollectionsRequestRef = useRef\(0\)/);
  assert.match(reportsSource, /requestId === creditCollectionsRequestRef\.current/);
  assert.match(reportsSource, /requestId === specialCollectionsRequestRef\.current/);
  assert.match(reportsSource, /const retryCollections = \(\) => \{\s*creditCollectionsRequestRef\.current \+= 1;\s*specialCollectionsRequestRef\.current \+= 1;/);
  assert.match(reportsSource, /hasLoadedCreditCollectionsRef\.current/);
  assert.match(reportsSource, /hasLoadedSpecialCollectionsRef\.current/);
  assert.doesNotMatch(reportsSource, /setCreditTransactions\(\[\]\)/);
  assert.doesNotMatch(reportsSource, /setSpecialOrderCollections\(\[\]\)/);
  assert.match(reportsSource, /<CollectionsAnalyticsError onRetry=\{retryCollectionsAnalytics\}/);
  assert.match(reportsSource, /onRetry=\{retryCollectionsAnalytics\}/);
  assert.match(reportsSource, /onRetry=\{retryTransactions\}/);
  assert.match(tableSource, /onRetry && <button type="button" onClick=\{onRetry\}/);
});

test('fresh collection snapshots are reused only for the matching authenticated user', () => {
  assert.match(reportsSource, /const COLLECTIONS_CACHE_MAX_AGE_MS = 5 \* 60 \* 1000/);
  assert.match(reportsSource, /reportsCollectionsMemoryCache\?\.userId !== userId/);
  assert.match(reportsSource, /reportsCollectionsMemoryCache = \{ \.\.\.existing, \.\.\.updates, userId \}/);
  assert.match(reportsSource, /getFreshReportsCollectionsCache\(collectionsCacheKey\)/);
  assert.match(reportsSource, /saveReportsCollectionsCache\(collectionsCacheKey, \{ creditTransactions: nextRows, creditFetchedAt: Date\.now\(\) \}\)/);
  assert.match(reportsSource, /saveReportsCollectionsCache\(collectionsCacheKey, \{ specialOrderCollections: result\.events, specialFetchedAt: Date\.now\(\) \}\)/);
});

test('collection requests stay independent from report date and tab selections', () => {
  assert.match(reportsSource, /loadCreditTransactions\(\);\s*loadSpecialOrderCollections\(\);[\s\S]*?\}, \[collectionRetryVersion, collectionsCacheKey\]\)/);
  assert.doesNotMatch(reportsSource, /listCreditTransactionsApi\(\{\s*status:\s*'All',[^}]*dateRange/);
  assert.doesNotMatch(reportsSource, /listSpecialOrderCollectionsApi\([^)]*dateRange/);
});
