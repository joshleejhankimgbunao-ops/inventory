/* global require, __dirname */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const chartDataModule = import(pathToFileURL(path.resolve(__dirname, '../../src/utils/reportChartData.js')).href);

test('category chart keeps fewer than or exactly ten categories without adding Others', async () => {
  const { buildSalesCategoryChartData } = await chartDataModule;

  for (const count of [4, 10]) {
    const input = Array.from({ length: count }, (_, index) => ({ name: `Category ${index + 1}`, value: count - index }));
    const result = buildSalesCategoryChartData(input);

    assert.equal(result.length, count);
    assert.equal(result.some((entry) => entry.isAggregate), false);
    assert.deepEqual(result.map((entry) => entry.value), [...input].map((entry) => entry.value).sort((a, b) => b - a));
  }
});

test('category chart ranks the top ten and Others exactly sums the remaining categories', async () => {
  const { buildSalesCategoryChartData } = await chartDataModule;
  const categories = Array.from({ length: 13 }, (_, index) => ({
    name: index === 12 ? 'Uncategorized' : `Category ${index + 1}`,
    value: 130 - index * 7,
  }));
  const result = buildSalesCategoryChartData(categories);
  const sourceTotal = categories.reduce((sum, category) => sum + category.value, 0);
  const others = result.find((entry) => entry.isAggregate);

  assert.equal(result.length, 11);
  assert.equal(result.filter((entry) => !entry.isAggregate).length, 10);
  assert.equal(others.name, 'Others');
  assert.equal(others.value, categories.slice(10).reduce((sum, category) => sum + category.value, 0));
  assert.equal(result.reduce((sum, category) => sum + category.value, 0), sourceTotal);
  assert.ok(Math.abs(result.reduce((sum, category) => sum + category.percentage, 0) - 100) < 1e-9);
  assert.equal(result.some((entry) => entry.name === 'Uncategorized') || others.value >= categories[12].value, true);
});

test('Reports category bars include every sales category with revenue-ranked totals and contribution percentages', async () => {
  const { buildAllSalesCategoryChartData } = await chartDataModule;
  const categories = Array.from({ length: 14 }, (_, index) => ({
    name: index === 13 ? 'Uncategorized' : `Category ${index + 1}`,
    value: 300 - index * 13,
  }));
  const result = buildAllSalesCategoryChartData(categories);
  const sourceTotal = categories.reduce((sum, category) => sum + category.value, 0);

  assert.equal(result.length, categories.length);
  assert.equal(result.some((entry) => entry.isAggregate), false);
  assert.deepEqual(result.map((category) => category.value), [...categories].map(({ value }) => value).sort((a, b) => b - a));
  assert.ok(result.some((category) => category.name === 'Uncategorized'));
  assert.equal(result.reduce((sum, category) => sum + category.value, 0), sourceTotal);
  assert.ok(Math.abs(result.reduce((sum, category) => sum + category.percentage, 0) - 100) < 1e-9);
  assert.equal(result[0].percentage, (categories[0].value / sourceTotal) * 100);
  assert.deepEqual(buildAllSalesCategoryChartData([]), []);
});

test('Top Selling Products ranks by units, preserves SKU identity, and keeps the full unit total', async () => {
  const { buildTopSellingProductsChartData } = await chartDataModule;
  const products = Array.from({ length: 12 }, (_, index) => ({
    code: `SKU-${index + 1}`,
    name: 'Duplicate Product Name',
    chartLabel: `Duplicate Product Name · SKU SKU-${index + 1}`,
    qty: index === 0 ? 100 : 20 - index,
    revenue: index === 0 ? 1 : 500 - index,
  }));
  const result = buildTopSellingProductsChartData(products);
  const others = result.find((entry) => entry.isAggregate);

  assert.equal(result.filter((entry) => !entry.isAggregate).length, 10);
  assert.equal(result[0].code, 'SKU-1');
  assert.notEqual(result[1].code, result[2].code);
  assert.notEqual(result[1].name, result[2].name);
  assert.equal(result.reduce((sum, product) => sum + product.value, 0), products.reduce((sum, product) => sum + product.qty, 0));
  assert.equal(others.value, products.slice().sort((a, b) => b.qty - a.qty).slice(10).reduce((sum, product) => sum + product.qty, 0));
  assert.ok(Math.abs(result.reduce((sum, product) => sum + product.percentage, 0) - 100) < 1e-9);
});

test('product report aggregation keeps matching names with different SKUs and variants distinct', async () => {
  const { buildTopProductsReportStats } = await chartDataModule;
  const inventory = [
    { code: 'WOOD-01', name: 'Board', brand: 'North Mill', size: '1x4', attributes: { material: 'Pine' } },
    { code: 'WOOD-02', name: 'Board', brand: 'North Mill', size: '1x6', attributes: { material: 'Pine' } },
  ];
  const transactions = [{ items: [
    { code: 'WOOD-01', name: 'Board', qty: 8, price: 20 },
    { code: 'WOOD-02', name: 'Board', qty: 7, price: 20 },
  ] }];
  const result = buildTopProductsReportStats(transactions, inventory);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((product) => product.code).sort(), ['WOOD-01', 'WOOD-02']);
  assert.ok(result.every((product) => product.chartLabel.includes('North Mill') && product.chartLabel.includes('SKU ')));
  assert.ok(result.some((product) => product.chartLabel.includes('1x4')));
  assert.ok(result.some((product) => product.chartLabel.includes('1x6')));
});

test('product chart legend uses the shortest recorded attribute that distinguishes matching names', async () => {
  const { buildTopSellingProductsChartData } = await chartDataModule;
  const products = [
    { code: 'PAINT-001', name: 'Latex Paint', brand: 'Boysen', color: 'White', qty: 12, revenue: 1200 },
    { code: 'PAINT-002', name: 'Latex Paint', brand: 'Davies', color: 'Black', qty: 10, revenue: 1000 },
    { code: 'TAPE-001', name: 'Electrical Tape', brand: 'Generic', color: 'Black', qty: 8, revenue: 400 },
    { code: 'TAPE-002', name: 'Electrical Tape', brand: 'Generic', color: 'White', qty: 6, revenue: 300 },
    { code: 'WOOD-001', name: 'Board', brand: 'North Mill', size: '1x4', qty: 4, revenue: 400 },
    { code: 'WOOD-002', name: 'Board', brand: 'North Mill', size: '1x6', qty: 3, revenue: 300 },
  ];

  const result = buildTopSellingProductsChartData(products, 10);
  const labels = result.map((product) => product.name);

  assert.ok(labels.includes('Latex Paint (Boysen)'));
  assert.ok(labels.includes('Latex Paint (Davies)'));
  assert.ok(labels.includes('Electrical Tape (Black)'));
  assert.ok(labels.includes('Electrical Tape (White)'));
  assert.ok(labels.includes('Board (1x4)'));
  assert.ok(labels.includes('Board (1x6)'));
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => !label.includes('PAINT-001') && !label.includes('TAPE-001')));
});

test('product chart legend uses short SKU identifiers only when recorded attributes cannot distinguish products', async () => {
  const { buildTopSellingProductsChartData } = await chartDataModule;
  const result = buildTopSellingProductsChartData([
    { code: 'TAPE-XL-0001', name: 'Electrical Tape', qty: 9, revenue: 500 },
    { code: 'TAPE-XL-0002', name: 'Electrical Tape', qty: 7, revenue: 400 },
    { code: 'VERY-LONG-PRODUCT-NAME-THAT-SHOULD-STAY-COMPLETE', name: 'A Very Long Product Name That Should Stay Complete', qty: 2, revenue: 100 },
  ]);

  assert.deepEqual(result.slice(0, 2).map((product) => product.name), [
    'Electrical Tape (SKU ...001)',
    'Electrical Tape (SKU ...002)',
  ]);
  assert.equal(result[2].name, 'A Very Long Product Name That Should Stay Complete');
  assert.equal(new Set(result.map((product) => product.name)).size, result.length);
});

test('product chart does not expose a full SKU as the default legend label when the name is unavailable', async () => {
  const { buildTopSellingProductsChartData } = await chartDataModule;
  const result = buildTopSellingProductsChartData([
    { code: 'UNKNOWN-PRODUCT-0001', name: 'SKU UNKNOWN-PRODUCT-0001', qty: 2, revenue: 100 },
    { code: 'UNKNOWN-PRODUCT-0002', name: 'SKU UNKNOWN-PRODUCT-0002', qty: 1, revenue: 50 },
  ]);

  assert.deepEqual(result.map((product) => product.name), [
    'Unknown product (SKU ...001)',
    'Unknown product (SKU ...002)',
  ]);
});

test('product legend resolves collisions between a full product name and another product attribute label', async () => {
  const { buildTopSellingProductLegendLabels } = await chartDataModule;
  const labels = buildTopSellingProductLegendLabels([
    { code: 'TEFLON-001', name: 'Teflon (3/4 in)' },
    { code: 'TEFLON-002', name: 'Teflon', size: '3/4 in' },
  ]);

  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => label.startsWith('Teflon (3/4 in) (SKU ...')));
  assert.ok(labels.every((label) => !label.includes('TEFLON-001') && !label.includes('TEFLON-002')));
});

test('Other Products keeps its aggregate legend identity when an individual product has that name', async () => {
  const { buildTopSellingProductsChartData } = await chartDataModule;
  const result = buildTopSellingProductsChartData([
    { code: 'OTHER-001', name: 'Other Products', qty: 100, revenue: 1000 },
    ...Array.from({ length: 10 }, (_, index) => ({
      code: `SKU-${index + 1}`,
      name: `Product ${index + 1}`,
      qty: 20 - index,
      revenue: 200 - index,
    })),
  ]);

  assert.equal(result.at(-1).name, 'Other Products');
  assert.notEqual(result[0].name, 'Other Products');
  assert.equal(new Set(result.map((product) => product.name)).size, result.length);
  assert.equal(result.at(-1).isAggregate, true);
});

test('product chart tooltip details retain full SKU and available specifications without adding aggregate details', async () => {
  const { getTopSellingProductSpecificationDetails } = await chartDataModule;
  const details = getTopSellingProductSpecificationDetails({
    brand: 'Boysen',
    color: 'White',
    size: '1 L',
    attributes: { finish: 'Matte', color: 'White', empty: '  ' },
  });

  assert.deepEqual(details, [
    { label: 'Brand', value: 'Boysen' },
    { label: 'Color', value: 'White' },
    { label: 'Size', value: '1 L' },
    { label: 'Finish', value: 'Matte' },
  ]);
  assert.deepEqual(getTopSellingProductSpecificationDetails({ isAggregate: true, attributes: { size: '1 L' } }), []);
});

test('percentage formatting distinguishes positive sub-one shares from zero', async () => {
  const { formatReportChartPercentage } = await chartDataModule;

  assert.equal(formatReportChartPercentage(0.3), '<1%');
  assert.equal(formatReportChartPercentage(0), '0%');
  assert.equal(formatReportChartPercentage(null), '0%');
  assert.equal(formatReportChartPercentage(12.345), '12.3%');
});

test('zero-value chart entries retain a true zero share rather than a sub-one label', async () => {
  const { buildSalesCategoryChartData, buildTopSellingProductsChartData, formatReportChartPercentage } = await chartDataModule;
  const categories = buildSalesCategoryChartData([
    { name: 'No sales', value: 0 },
    { name: 'Also no sales', value: 0 },
  ]);
  const products = buildTopSellingProductsChartData([
    { name: 'No units', code: 'ZERO-1', qty: 0, revenue: 0 },
  ]);

  assert.ok(categories.every((category) => category.percentage === 0));
  assert.ok(products.every((product) => product.percentage === 0));
  assert.equal(formatReportChartPercentage(categories[0].percentage), '0%');
  assert.equal(formatReportChartPercentage(products[0].percentage), '0%');
});

test('Reports top products chart ranks by recorded revenue and keeps unit quantities visible', () => {
  const fs = require('node:fs');
  const reportsSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Reports.jsx'), 'utf8');

  assert.match(reportsSource, /filteredTransactions\.filter\(isSalePhysicallyFulfilledForItemReporting\)/);
  assert.match(reportsSource, /buildDashboardTopSellingProducts\([\s\S]*?inventory,[\s\S]*?10/);
  assert.match(reportsSource, /return \{ \.\.\.product, displayName, value: product\.revenue \}/);
  assert.match(reportsSource, /buildTopSellingProductLegendLabels\(rankedProducts\)/);
  assert.match(reportsSource, /ReportsTopSellingProductsChart products=\{topProductsBarData\}/);
  assert.match(reportsSource, /ReportsTopSellingProductsChart = \(\{ products \}\)/);
  assert.match(reportsSource, /dataKey="value"[\s\S]*?animationDuration=\{380\}/);
  assert.match(reportsSource, /SKU: \{product\.code\}/);
  assert.match(reportsSource, /Units Sold: \{unitsSold\}/);
  assert.match(reportsSource, /Sales Revenue: \{formatCurrency\(revenue\)\}/);
  assert.match(reportsSource, /'Top Products by Revenue'/);
  assert.match(reportsSource, /buildAllSalesCategoryChartData\(salesByCategory\)/);
  assert.match(reportsSource, /\}, \[filteredTransactions, inventory\]\);/);
  assert.match(reportsSource, /ReportsSalesByCategoryChart categories=\{salesByCategoryChartData\}/);
  assert.match(reportsSource, /ReportsSalesByCategoryChart = \(\{ categories, showFinancials \}\)/);
  assert.match(reportsSource, /Contribution: \{formatReportChartPercentage\(percentage\)\}/);
  assert.match(reportsSource, /Revenue: \{salesLabel\}/);
  assert.match(reportsSource, /<BarChart data=\{categories\}/);
  assert.match(reportsSource, /<LabelList dataKey="value" position="top"/);
  assert.equal((reportsSource.match(/hideBelowPercentage=\{4\}/g) || []).length, 0);
  assert.doesNotMatch(reportsSource, /PieChart|<Pie|ANALYTICS_PIE_COLORS|ColoredPiePercentageLabel/);
  assert.doesNotMatch(reportsSource, /topProductsPieData|buildTopSellingProductsChartData\(topProducts/);
  assert.match(reportsSource, /fill=\{DASHBOARD_BAR_COLOR\}/);
  assert.match(reportsSource, /activeBar=\{\{ fill: DASHBOARD_BAR_ACTIVE_COLOR \}\}/);
});
