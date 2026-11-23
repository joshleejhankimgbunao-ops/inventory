/* global require, module */
const Product = require('../models/Product');
const Category = require('../models/Category');
const Sale = require('../models/Sale');
const SpecialOrder = require('../models/SpecialOrder');
const InventoryLog = require('../models/InventoryLog');
const { getDashboardBusinessDate } = require('../../../shared/dashboardReportingPeriod.mjs');
const configuredPolicy = require('../../../shared/stockMovementPolicy.json');
const { normalizeCategoryKey } = require('../utils/categoryResolution');

const DAY = 86400000;
const POLICY = Object.freeze({
  ...configuredPolicy,
  formula: 'Eligible completed-sale units for an exact product SKU divided by its observed Manila calendar days in the 30-day window',
  specialOrders: 'Count inventory-linked lines only from completed, fully-paid Special Orders whose Sale and order link to each other; custom lines are excluded',
  zeroSales: 'Require the full 30-day observation window, positive opening stock and consistent dated stock history without a stockout',
});
const METRIC = Object.freeze({ key: 'unitsPerDay', label: 'SKU selling units sold per observed day', formula: 'unitsSold / observedDays', timeZone: 'Asia/Manila' });
const id = (value) => String(value || '');
const keySort = (a, b) => a.sku.localeCompare(b.sku, 'en') || a.id.localeCompare(b.id, 'en');
const unitKey = (value) => String(value || '').trim().toLowerCase();
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const parseBusinessDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY;
};

const getStockMovementPeriod = (now = new Date(), policy = POLICY) => {
  const todayText = getDashboardBusinessDate(now);
  const todayStart = new Date(`${todayText}T00:00:00+08:00`);
  const end = new Date(+todayStart + DAY);
  const start = new Date(+end - policy.windowDays * DAY);
  return {
    label: 'Last 30 Days',
    days: policy.windowDays,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: 'Asia/Manila',
    endExclusive: true,
  };
};

const getObservedDays = (createdAt, period, now, windowDays) => {
  const created = new Date(createdAt);
  if (!createdAt || !Number.isFinite(+created) || +created > +now) return 0;
  const todayNumber = parseBusinessDate(getDashboardBusinessDate(now));
  const startNumber = parseBusinessDate(getDashboardBusinessDate(new Date(period.start)));
  const createdNumber = parseBusinessDate(getDashboardBusinessDate(created));
  return Math.max(0, Math.min(windowDays, todayNumber - Math.max(startNumber, createdNumber) + 1));
};

const buildSalesPipeline = ({ start, end, type, specialOrderCollection }) => {
  const match = type === 'regular'
    ? { createdAt: { $gte: start, $lt: end }, status: { $in: ['completed', '', null] }, saleType: { $in: ['regular', '', null] }, specialOrderId: null }
    : { createdAt: { $gte: start, $lt: end }, status: 'completed', saleType: 'special-order', paymentStatus: 'Paid', specialOrderId: { $type: 'objectId' } };
  const pipeline = [{ $match: match }];
  if (type === 'special-order') {
    pipeline.push(
      { $lookup: { from: specialOrderCollection, localField: 'specialOrderId', foreignField: '_id', as: 'linkedOrder' } },
      { $match: { $expr: { $and: [
        { $eq: [{ $arrayElemAt: ['$linkedOrder.status', 0] }, 'Completed'] },
        { $eq: [{ $arrayElemAt: ['$linkedOrder.linkedSaleId', 0] }, '$_id'] },
      ] } } },
    );
  }
  pipeline.push(
    { $unwind: '$items' },
    // Custom Special Order lines intentionally have no product ID and are not inventory sales.
    ...(type === 'special-order' ? [{ $match: { 'items.product': { $type: 'objectId' } } }] : []),
    { $set: {
      businessDate: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Manila' } },
      validQuantity: { $and: [{ $isNumber: '$items.quantity' }, { $gt: ['$items.quantity', 0] }, { $lt: ['$items.quantity', Number.MAX_SAFE_INTEGER] }, { $eq: ['$items.quantity', { $trunc: { $convert: { input: '$items.quantity', to: 'double', onError: 0, onNull: 0 } } }] }] },
    } },
    { $group: { _id: { product: '$items.product', code: '$items.code', unit: '$items.sellingUnit', businessDate: '$businessDate' }, unitsSold: { $sum: { $cond: ['$validQuantity', '$items.quantity', 0] } }, invalidQuantityLines: { $sum: { $cond: ['$validQuantity', 0, 1] } }, lines: { $sum: 1 } } },
  );
  return pipeline;
};

// Pure classification over server-aggregated facts. Never mutates inventory.
const classifyStockMovement = ({ products, categories = [], categoryId = '', sales, opening, history, period, now = new Date(), policy = POLICY }) => {
  const totals = new Map();
  const unsafe = new Set();
  const ambiguousCodes = new Set();
  const productsById = new Map(products.map((product) => [id(product._id), product]));
  const activeCategories = categories.filter((category) => category.isActive !== false);
  const categoriesById = new Map(activeCategories.map((category) => [id(category._id), category]));
  const categoriesByName = new Map();
  for (const category of categories) {
    const key = normalizeCategoryKey(category.name);
    categoriesByName.set(key, [...(categoriesByName.get(key) || []), category]);
  }
  const productCategory = (product) => {
    const reference = id(product.categoryRef?._id || product.categoryRef);
    if (reference) return categoriesById.get(reference);
    const matches = categoriesByName.get(normalizeCategoryKey(product.category));
    return matches?.length === 1 && matches[0].isActive !== false ? matches[0] : undefined;
  };
  const selectedCategory = id(categoryId);
  if (selectedCategory && !categoriesById.has(selectedCategory)) throw Object.assign(new Error('Select an active product category.'), { status: 400 });
  const quality = { unresolvedSalesLines: 0, invalidQuantityLines: 0, unitMismatchLines: 0, inactiveSkus: 0, unstockedSkus: 0, regularUnitsSold: 0, specialOrderUnitsSold: 0 };
  let unassignedSales = false;
  for (const row of sales) {
    const product = productsById.get(id(row._id.product));
    const source = row.source === 'special-order' ? 'specialOrderUnitsSold' : 'regularUnitsSold';
    if (!product) {
      quality.invalidQuantityLines += row.invalidQuantityLines;
      quality.unresolvedSalesLines += row.lines;
      if (row._id.code) ambiguousCodes.add(row._id.code);
      else unassignedSales = true;
      continue;
    }
    const createdAt = new Date(product.createdAt);
    if (row._id.businessDate && Number.isFinite(+createdAt) && row._id.businessDate < getDashboardBusinessDate(createdAt)) continue;
    quality.invalidQuantityLines += row.invalidQuantityLines;
    if (row.invalidQuantityLines) unsafe.add(id(product._id));
    if (row._id.unit && unitKey(row._id.unit) !== unitKey(product.sellingUnit)) {
      quality.unitMismatchLines += row.lines;
      unsafe.add(id(product._id));
    }
    const productId = id(product._id);
    const total = totals.get(productId) || { regularUnitsSold: 0, specialOrderUnitsSold: 0 };
    total[source] += row.unitsSold;
    totals.set(productId, total);
    if (product.isActive !== false) quality[source] += row.unitsSold;
  }
  const openingById = new Map(opening.map((row) => [id(row._id), row]));
  const historyById = new Map(history.map((row) => [id(row._id), row]));
  const groups = { fast: [], slow: [], nonMoving: [], insufficientHistory: [] };
  let selectedUnits = 0;
  for (const product of productsById.values()) {
    const category = productCategory(product);
    if (selectedCategory && id(category?._id) !== selectedCategory) continue;
    if (product.isActive === false) { quality.inactiveSkus += 1; continue; }
    const productId = id(product._id);
    const totalsForProduct = totals.get(productId) || { regularUnitsSold: 0, specialOrderUnitsSold: 0 };
    const regularUnitsSold = totalsForProduct.regularUnitsSold;
    const specialOrderUnitsSold = totalsForProduct.specialOrderUnitsSold;
    const unitsSold = regularUnitsSold + specialOrderUnitsSold;
    selectedUnits += unitsSold;
    const observedDays = getObservedDays(product.createdAt, period, now, policy.windowDays);
    const salesVelocity = observedDays ? unitsSold / observedDays : null;
    const configuredUnits = [...new Set((category?.sizeUnits || []).map(unitKey).filter(Boolean))];
    const comparableUnit = unitKey(product.sellingUnit);
    const entry = {
      id: productId, name: product.name, sku: product.sku, brand: product.brand || '', color: product.color || '', size: product.size || '',
      sellingUnit: product.sellingUnit || '', unitsSold, regularUnitsSold, specialOrderUnitsSold, observedDays, salesVelocity,
      currentStock: validNumber(product.stock) ? product.stock : null, categoryId: category ? id(category._id) : null, categoryName: category?.name || '',
    };
    const insufficient = (reason) => groups.insufficientHistory.push({ ...entry, reason });
    if (!category) { insufficient('Missing, inactive or ambiguous category identity.'); continue; }
    if (!validNumber(product.stock)) { insufficient('Missing or invalid current stock quantity.'); continue; }
    if (typeof product.sellingUnit !== 'string' || !comparableUnit || unsafe.has(productId)) {
      insufficient('Missing or inconsistent selling unit / sales quantity data.'); continue;
    }
    if (!configuredUnits.includes(comparableUnit)) { insufficient('Selling unit is not configured for this category.'); continue; }
    if (ambiguousCodes.has(product.sku) || unassignedSales) { insufficient('Historical sales identity cannot be resolved safely.'); continue; }
    if (observedDays < policy.minimumObservationDays) { insufficient(`Insufficient observation history (${observedDays} of ${policy.minimumObservationDays} required days).`); continue; }
    if (unitsSold > 0) {
      if (salesVelocity >= policy.fastVelocityUnitsPerDay) groups.fast.push(entry);
      else groups.slow.push(entry);
      continue;
    }
    if (product.stock <= 0) { quality.unstockedSkus += 1; insufficient('No current stock available to confirm non-moving status.'); continue; }
    if (observedDays < policy.minimumNonMovingObservationDays) {
      insufficient(`Insufficient observation history for non-moving status (${observedDays} of ${policy.minimumNonMovingObservationDays} required days).`); continue;
    }
    const before = openingById.get(productId);
    const during = historyById.get(productId);
    const stockAtEnd = during?.lastStock ?? before?.stockAfter;
    if (!before || !(before.stockAfter > 0) || before.invalid
      || during?.invalid || during?.stockout
      || (during && (during.firstStock !== before.stockAfter || !during.continuous))
      || stockAtEnd !== product.stock) {
      insufficient('Insufficient stock availability history to confirm non-moving status.'); continue;
    }
    groups.nonMoving.push(entry);
  }
  const byVelocity = (a, b) => b.salesVelocity - a.salesVelocity || keySort(a, b);
  groups.fast.sort(byVelocity);
  groups.slow.sort((a, b) => a.salesVelocity - b.salesVelocity || keySort(a, b));
  groups.nonMoving.sort((a, b) => a.name.localeCompare(b.name, 'en') || keySort(a, b));
  groups.insufficientHistory.sort(keySort);
  const limitations = [
    `Fast Moving means at least ${policy.fastVelocityUnitsPerDay} units per observed day; Slow Moving means a positive velocity below that threshold.`,
    'Only fully completed, linked Special Order sales contribute inventory-linked lines; custom lines do not represent inventory SKU sales.',
    'Non-Moving requires 30 observed days plus consistent dated on-hand stock history; missing evidence is classified as insufficient history.',
    'No unit conversions are inferred. Archived product categories/units and inactive products are excluded.',
  ];
  if (quality.unresolvedSalesLines) limitations.push(`${quality.unresolvedSalesLines} completed sale line(s) have missing/deleted product identity; no SKU-string reassignment was made.`);
  if (quality.invalidQuantityLines || quality.unitMismatchLines) limitations.push('Some sale lines have invalid quantities or inconsistent units; affected SKUs require review.');
  return {
    period, asOf: now.toISOString(), policy, metric: METRIC, selection: { categoryId: selectedCategory },
    categories: activeCategories.map((category) => ({ id: id(category._id), name: category.name })).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en')),
    ...Object.fromEntries(Object.entries(groups).map(([key, entries]) => [key, { count: entries.length, entries }])),
    qualifyingUnitsRecorded: selectedUnits,
    dataQuality: quality, limitations,
  };
};

const getStockMovement = async (query = {}, { now = new Date(), policy = POLICY } = {}) => {
  const period = getStockMovementPeriod(now, policy);
  let categoryId = query.category || '';
  if (typeof categoryId !== 'string' || (categoryId && !/^[a-f\d]{24}$/i.test(categoryId))) throw Object.assign(new Error('Select an active product category.'), { status: 400 });
  categoryId = categoryId.toLowerCase();
  const start = new Date(period.start);
  const end = new Date(Math.min(+new Date(period.end), +now));
  const [products, regularSales, specialOrderSales, opening, history, categories] = await Promise.all([
    Product.find({}, '_id name sku brand color size stock sellingUnit categoryRef category isActive createdAt').lean(),
    Sale.aggregate(buildSalesPipeline({ start, end, type: 'regular', specialOrderCollection: SpecialOrder.collection.name })).allowDiskUse(true),
    Sale.aggregate(buildSalesPipeline({ start, end, type: 'special-order', specialOrderCollection: SpecialOrder.collection.name })).allowDiskUse(true),
    InventoryLog.aggregate([
      { $match: { productRef: { $type: 'objectId' }, createdAt: { $lt: start } } },
      { $sort: { productRef: 1, createdAt: -1, _id: -1 } },
      { $group: { _id: '$productRef', stockAfter: { $first: '$stockAfter' }, invalid: { $first: { $not: [{ $and: [{ $isNumber: '$stockAfter' }, { $gte: ['$stockAfter', 0] }] }] } } } },
    ]).allowDiskUse(true),
    InventoryLog.aggregate([
      { $match: { productRef: { $type: 'objectId' }, createdAt: { $gte: start, $lt: end } } },
      { $setWindowFields: { partitionBy: '$productRef', sortBy: { createdAt: 1, _id: 1 }, output: { previousStock: { $shift: { output: '$stockAfter', by: -1 } } } } },
      { $sort: { productRef: 1, createdAt: 1, _id: 1 } },
      { $group: { _id: '$productRef', firstStock: { $first: '$stockBefore' }, lastStock: { $last: '$stockAfter' },
        stockout: { $max: { $or: [{ $lte: ['$stockBefore', 0] }, { $lte: ['$stockAfter', 0] }] } },
        invalid: { $max: { $not: [{ $and: [{ $isNumber: '$stockBefore' }, { $isNumber: '$stockAfter' }, { $gte: ['$stockBefore', 0] }, { $gte: ['$stockAfter', 0] }] }] } },
        continuous: { $min: { $or: [{ $eq: ['$previousStock', null] }, { $eq: ['$previousStock', '$stockBefore'] }] } },
      } },
    ]).allowDiskUse(true),
    Category.find({}, '_id name sizeUnits isActive').lean(),
  ]);
  const sales = [
    ...regularSales.map((row) => ({ ...row, source: 'regular' })),
    ...specialOrderSales.map((row) => ({ ...row, source: 'special-order' })),
  ];
  return classifyStockMovement({ products, categories, categoryId, sales, opening, history, period, now, policy });
};

module.exports = { POLICY, classifyStockMovement, getStockMovement, getStockMovementPeriod, getObservedDays };
