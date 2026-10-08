const assert = require('node:assert/strict');
const test = require('node:test');

test('export defaults mirror the view range without sharing mutable state', async () => {
  const { getDefaultReportExportRange } = await import('../../src/utils/reportExportRange.js');
  const now = new Date(2026, 9, 8, 12);
  assert.deepEqual(getDefaultReportExportRange({ dateRange: 'week', now }), { from: '2026-10-01', to: '2026-10-08' });
  assert.deepEqual(getDefaultReportExportRange({ dateRange: 'month', now }), { from: '2026-10-01', to: '2026-10-08' });
  assert.deepEqual(getDefaultReportExportRange({ dateRange: 'year', now }), { from: '2026-01-01', to: '2026-10-08' });
  assert.deepEqual(getDefaultReportExportRange({ dateRange: 'custom', customStartDate: '2026-09-01', customEndDate: '2026-09-30', now }), { from: '2026-09-01', to: '2026-09-30' });
});

test('all-time export defaults use the earliest available record through today', async () => {
  const { getDefaultReportExportRange } = await import('../../src/utils/reportExportRange.js');
  assert.deepEqual(getDefaultReportExportRange({
    dateRange: 'all',
    availableDates: ['2026-04-10T04:00:00Z', '2025-12-25T12:00:00Z'],
    now: new Date(2026, 9, 8, 12),
  }), { from: '2025-12-25', to: '2026-10-08' });
});

test('custom export filtering is inclusive and independent from the screen range', async () => {
  const { isDateWithinReportExportRange } = await import('../../src/utils/reportExportRange.js');
  const exportRange = { from: '2026-10-01', to: '2026-10-31' };
  assert.equal(isDateWithinReportExportRange('2026-10-01T00:00:00', exportRange), true);
  assert.equal(isDateWithinReportExportRange('2026-10-31T23:59:59', exportRange), true);
  assert.equal(isDateWithinReportExportRange('2026-09-30T23:59:59', exportRange), false);
  assert.equal(isDateWithinReportExportRange('2026-11-01T00:00:00', exportRange), false);
});

test('export range validation blocks missing, reversed, invalid, and future dates', async () => {
  const { validateReportExportRange } = await import('../../src/utils/reportExportRange.js');
  const now = new Date(2026, 9, 8, 12);
  assert.match(validateReportExportRange({ from: '', to: '2026-10-08', now }), /From date/);
  assert.match(validateReportExportRange({ from: '2026-10-01', to: '', now }), /To date/);
  assert.match(validateReportExportRange({ from: '2026-10-09', to: '2026-10-08', now }), /must not be after/);
  assert.match(validateReportExportRange({ from: '2026-02-30', to: '2026-10-08', now }), /valid export date/);
  assert.match(validateReportExportRange({ from: '2026-10-08', to: '2026-10-09', now }), /future/);
  assert.equal(validateReportExportRange({ from: '2026-10-01', to: '2026-10-08', now }), '');
});

test('export labels and filenames reflect the independently selected range', async () => {
  const { formatReportExportRangeLabel, getReportExportFilenameRange } = await import('../../src/utils/reportExportRange.js');
  const range = { from: '2026-10-01', to: '2026-10-31' };
  assert.equal(formatReportExportRangeLabel(range), 'Oct 1, 2026 to Oct 31, 2026');
  assert.equal(getReportExportFilenameRange(range), '2026-10-01_to_2026-10-31');
});
