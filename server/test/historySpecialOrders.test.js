/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/History.jsx'), 'utf8');

test('History Logs separates authoritative Special Order sales without changing the shared feed', () => {
  assert.match(source, /const isSpecialOrderSale = \(transaction\).*saleType.*special-order[\s\S]*specialOrderId/);
  assert.match(source, /if \(isSpecialOrderSale\(trx\)\) return false;/);
  assert.match(source, /const filteredSpecialOrders = useMemo/);
  assert.match(source, /if \(!isSpecialOrderSale\(trx\)\) return false;/);
  assert.match(source, /\{ value: 'special-orders', label: 'Special Orders' \}/);
  assert.match(source, /activeTab === 'special-orders' \? filteredSpecialOrders/);
});

test('Special Order History details are read-only and keep recorded references', () => {
  assert.match(source, /Special Order Transaction Details/);
  assert.match(source, /Special Order Reference/);
  assert.match(source, /Linked Sales Transaction/);
  assert.match(source, /!isSpecialOrderSale\(selectedSaleDetails\).*setIsEditingSaleReference/);
  assert.match(source, /!isSpecialOrderSale\(selectedSaleDetails\) && \(canVoidSale/);
  assert.match(source, /item\.sellingUnit/);
});

test('History Logs renders mobile cards from the shared paginated records and keeps desktop tables separate', () => {
  assert.match(source, /className="flex flex-col gap-3 px-2 py-2 md:hidden"/);
  assert.match(source, /className="hidden md:block"/);
  assert.match(source, /currentItems\.map\(\(trx\)/);
  assert.match(source, /currentItems\.map\(\(credit\)/);
  assert.match(source, /currentItems\.map\(\(log, index\)/);
  assert.match(source, /onClick=\{\(\) => handleViewCreditDetails\(credit\)\}/);
  assert.match(source, /onClick=\{\(\) => setSelectedSaleDetails\(trx\)\}/);
});

test('History actions keep descriptive mobile labels and compact one-line desktop table actions', () => {
  const mobileCards = source.slice(
    source.indexOf('<div className="flex flex-col gap-3 px-2 py-2 md:hidden"'),
    source.indexOf('<div className="hidden md:block">'),
  );
  const inventoryCards = mobileCards.slice(mobileCards.indexOf('currentItems.map((log, index)'));

  assert.match(mobileCards, /mobileHistoryActionClass\.primary/);
  assert.match(mobileCards, /mobileHistoryActionClass\.secondary/);
  assert.match(mobileCards, /View Order Confirmation/);
  assert.match(mobileCards, /Sale Details/);
  assert.doesNotMatch(mobileCards, /toggleArchive|archive-restore|>Archive</);
  assert.match(mobileCards, /onClick=\{\(\) => handleViewCreditDetails\(credit\)\}[\s\S]*View Details/);
  assert.match(mobileCards, /activeTab === 'special-orders' \? 'View Transaction' : 'Sale Details'/);
  assert.match(mobileCards, /isRegularSale\(trx\) \? 'View Order Confirmation' : 'View Receipt'/);
  assert.match(source, /label=\{activeTab === 'special-orders' \? 'View Transaction' : 'Sale Details'\}/);
  assert.match(source, /label="View Credit Details"[\s\S]*aria-label=\{`View credit transaction details for[\s\S]*<span className="history-action-label">View Details<\/span>/);
  assert.match(source, /<span className="history-action-label">Confirmation<\/span>/);
  assert.match(source, /<span className="history-action-label">\{activeTab === 'special-orders' \? 'View Transaction' : 'Details'\}<\/span>/);
  assert.doesNotMatch(source, /onArchiveTransaction|toggleArchive|confirmArchive|Archive Confirmation Modal|value="ARCHIVED"/);
  assert.match(source, /const matchesRecordView = salesRecordView === 'VOIDED'[\s\S]*?\? isVoided[\s\S]*?: true/);
  assert.match(source, /trx\.isArchived && <span[^>]*>Archived<\/span>/);
  assert.match(source, /history-labeled-action--primary/);
  assert.match(source, /history-action-group mx-auto grid w-fit max-w-full gap-1\.5[\s\S]*history-sales-action-group grid-cols-\[max-content_max-content\]/);
  assert.match(source, /activeTab === 'sales' \? 'w-\[18%\]' : 'w-\[16%\]'/);
  assert.match(source, /activeTab === 'special-orders' \? 'w-\[15%\]' : 'w-\[14%\]'/);
  assert.match(source, /activeTab === 'special-orders' \? 'w-\[11%\]' : 'w-\[12%\]'/);
  assert.doesNotMatch(source.slice(source.indexOf('history-sales-action-group'), source.indexOf('</div>}', source.indexOf('history-sales-action-group'))), /col-span-2/);
  assert.match(source, /py-3 px-2 w-\[13%\] text-center text-\[11px\] font-semibold border border-gray-700">Status/);
  assert.match(source, /inline-flex whitespace-nowrap px-1\.5 py-0\.5 rounded text-\[10px\]/);
  assert.match(source, /<div className="hidden md:block">[\s\S]*<TableActionButton/);
  const styles = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
  assert.match(styles, /\.table-action-button\.history-labeled-action[\s\S]*width: auto !important/);
  assert.match(styles, /history-labeled-action--primary[\s\S]*background: #111827 !important[\s\S]*color: var\(--color-white\) !important/);
  assert.match(styles, /@media \(min-width: 768px\)[\s\S]*reference-table-action[\s\S]*white-space: nowrap !important/);
  assert.match(styles, /history-action-label[\s\S]*white-space: nowrap/);
  assert.match(styles, /history-action-group\.history-sales-action-group[\s\S]*grid-template-columns: repeat\(2, max-content\)/);
  assert.match(styles, /height: 1\.875rem !important;[\s\S]*padding: 0 0\.5rem !important;[\s\S]*font-size: 0\.625rem !important;[\s\S]*font-weight: 600 !important;[\s\S]*line-height: 1 !important/);
  assert.match(styles, /table-action-button\.reference-table-action svg[\s\S]*width: 0\.875rem !important[\s\S]*height: 0\.875rem !important[\s\S]*stroke-width: 1\.75px !important/);
  assert.match(source, /history-labeled-action reference-table-action history-sales-action history-labeled-action--primary/);
  assert.match(source, /history-labeled-action reference-table-action history-labeled-action--primary/);
  assert.match(source, /activeTab === 'sales' \? 'min-w-\[1200px\]' : 'min-w-\[920px\]'/);
  assert.doesNotMatch(inventoryCards, /<button/);
});
