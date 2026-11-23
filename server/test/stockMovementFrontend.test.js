/* global require, __dirname, module */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');

const loadModule = (relative, dependencies = {}) => {
  const filename = path.resolve(__dirname, '../../', relative);
  const compiled = new Module(filename, module); compiled.filename = filename; compiled.paths = module.paths;
  const nativeRequire = compiled.require.bind(compiled);
  compiled.require = (id) => dependencies[id] || nativeRequire(id);
  compiled._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: relative.endsWith('jsx') ? 'jsx' : 'js', format: 'cjs', jsx: 'automatic' }).code, filename);
  return compiled.exports;
};

test('stock movement shows fixed rolling-window copy, three summaries and four accessible result tabs', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/StockMovement.jsx'), 'utf8');
  const dashboardSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/DashboardHome.jsx'), 'utf8');
  const StockMovement = loadModule('src/components/StockMovement.jsx', {
    '../services/dashboardApi': { getStockMovementApi: () => { throw new Error('SSR must not fetch'); } },
    '../services/realtimeClient': { subscribeRealtimeEvent: () => () => {} },
    '../utils/numberFormat': require('../../src/utils/numberFormat.js'),
  }).default;
  const html = renderToStaticMarkup(React.createElement(StockMovement));
  assert.match(html, /role="tablist" aria-label="Stock movement"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  for (const label of ['Fast Moving', 'Slow Moving', 'Non-Moving', 'Insufficient History']) assert.match(html, new RegExp(label));
  assert.match(html, /Based on the last 30 days/);
  assert.match(dashboardSource, /<StockMovement \/>/);
  assert.doesNotMatch(dashboardSource, /<StockMovement dateRange=/);
  assert.match(html, /aria-label="Stock movement category"/);
  assert.match(html, /All Categories/);
  assert.match(source, /getStockMovementReasonSummary\(data\.insufficientHistory\.entries\)/);
  assert.match(source, /item\.reason/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading stock movement/);
  assert.doesNotMatch(html, />0<|<td/);
  assert.equal((html.match(/app-dashboard-card-hover relative flex min-w-0 items-center justify-between gap-1 rounded-xl border border-gray-200 bg-white px-2\.5 py-3 shadow-sm sm:px-4/g) || []).length, 3, 'existing three movement summary cards remain intact');
  assert.doesNotMatch(source, /regularUnitsSold|specialOrderUnitsSold|POS \{|Special \{/);
  assert.match(source, /quantity\(item\.unitsSold, item\.sellingUnit\)/);
  assert.match(source, /velocity\(item\.salesVelocity, item\.sellingUnit\)/);
  assert.match(source, /Units Sold \/ Velocity/);
  assert.match(source, /Current Stock/);
  assert.doesNotMatch(source, /getDashboardReportingPeriod|dateRange|specificDate|customStartDate/);
});

test('dashboard API validates fixed-period velocity and source quantity fields', async () => {
  let request;
  const group = { count: 0, entries: [] };
  let response = {
    period: { timeZone: 'Asia/Manila', days: 30, endExclusive: true },
    policy: { windowDays: 30, minimumObservationDays: 14, minimumNonMovingObservationDays: 30, fastVelocityUnitsPerDay: 0.25 },
    limitations: [], categories: [{ id: 'hardware', name: 'Hardware' }], selection: { categoryId: '' }, metric: { key: 'unitsPerDay' },
    fast: group, slow: group, nonMoving: group, insufficientHistory: group,
  };
  const { getStockMovementApi } = loadModule('src/services/dashboardApi.js', { './apiClient': { apiRequest: async (...args) => { request = args; return response; } } });
  const controller = new AbortController();
  assert.equal(await getStockMovementApi('category=hardware', controller.signal), response);
  assert.equal(request[0], '/api/dashboard/stock-movement?category=hardware');
  assert.equal(request[1].signal, controller.signal);
  response.metric.key = 'unitsSold';
  await assert.rejects(getStockMovementApi(''), /could not be verified/);
  response.metric.key = 'unitsPerDay';
  response.period.days = 7;
  await assert.rejects(getStockMovementApi(''), /could not be verified/);
  response.period.days = 30;
  response = [];
  await assert.rejects(getStockMovementApi(''), /could not be verified/);
});
