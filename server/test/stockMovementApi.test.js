/* global require, process */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const Sale = require('../src/models/Sale');
const SpecialOrder = require('../src/models/SpecialOrder');
const InventoryLog = require('../src/models/InventoryLog');
const User = require('../src/models/User');
const dashboardRoutes = require('../src/routes/dashboardRoutes');
const { getStockMovement, getStockMovementPeriod } = require('../src/services/stockMovement');
let directory;
let mongo;
let server;
let base;
let hardware;
const users = {};
const tokens = {};
const previousSecret = process.env.JWT_SECRET;
const now = new Date();
const analysisPeriod = getStockMovementPeriod(now);
const saleDate = new Date(+new Date(analysisPeriod.start) + 86400000);

test.before(async () => {
  // Isolated local DB only; never load .env or connect to the application DB.
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stock-movement-test-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  mongo = spawn(process.env.PRODUCT_TEST_MONGOD || (process.platform === 'win32' ? 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' : 'mongod'), ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let startupError; mongo.on('error', (error) => { startupError = error; });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (startupError) throw startupError;
    if (mongo.exitCode !== null || Date.now() > deadline) throw new Error('Disposable MongoDB did not start.');
    try { await mongoose.connect(`mongodb://127.0.0.1:${port}/stock_movement_test`, { serverSelectionTimeoutMS: 500 }); break; } catch { /* Isolated startup only. */ }
  }
  await Promise.all([Product.init(), Category.init(), Sale.init(), SpecialOrder.init(), InventoryLog.init(), User.init()]);
  for (const role of ['admin', 'superadmin', 'cashier']) {
    users[role] = await User.create({ username: `movement-${role}`, name: role, password: randomBytes(24).toString('hex'), role });
    tokens[role] = jwt.sign({ id: users[role]._id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  }
  const app = express(); app.use('/api/dashboard', dashboardRoutes);
  app.use((error, _req, res, next) => { void next; res.status(500).json({ message: error.message }); });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/dashboard/stock-movement`;
});
test.beforeEach(async () => {
  await Promise.all([Sale.deleteMany({}), SpecialOrder.deleteMany({}), Product.deleteMany({}), InventoryLog.deleteMany({}), Category.deleteMany({})]);
  hardware = await Category.create({ name: 'Hardware', sizeUnits: ['pcs', 'rolls'] });
});
test.after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null && mongo.signalCode === null) { const exited = once(mongo, 'exit'); mongo.kill(); await exited; }
  if (directory && path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('stock-movement-test-')) await fs.rm(directory, { recursive: true, force: true });
  if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
});
const createProduct = (sku, extra = {}) => Product.create({ sku, name: `Product ${sku}`, category: hardware.name, categoryRef: hardware._id, sellingUnit: 'pcs', price: 10, stock: 20, createdAt: new Date('2026-09-01T00:00:00Z'), ...extra });
const receipt = (product, before, after, date) => InventoryLog.create({ action: after > before ? 'ADD' : 'UPDATE', code: product.sku, productRef: product._id, user: 'Fixture', stockBefore: before, stockAfter: after, createdAt: new Date(date) });
const createSale = async (product, quantity, extra = {}) => Sale.create({ cashier: users.admin._id, items: [{ product: product._id, code: product.sku, name: product.name, sellingUnit: product.sellingUnit, quantity, unitPrice: 10, subtotal: quantity * 10 }], totalAmount: quantity * 10, createdAt: saleDate, ...extra });
const analyze = (query = {}) => getStockMovement(query, { now });
const request = async (suffix = '') => fetch(`${base}${suffix}`, { headers: { Authorization: `Bearer ${tokens.admin}` } });

test('route remains role-protected, reports a fixed Manila period and ignores dashboard range filters', async () => {
  const p = await createProduct('RANGE');
  await createSale(p, 3, { createdAt: new Date(+new Date(analysisPeriod.start) - 1) });
  await createSale(p, 4, { createdAt: new Date(analysisPeriod.start) });
  for (const [role, expected] of [[null, 401], ['cashier', 403], ['admin', 200], ['superadmin', 200]]) {
    const response = await fetch(`${base}?range=today`, { headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {} });
    assert.equal(response.status, expected);
    if (expected === 200) {
      const data = await response.json();
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(data.qualifyingUnitsRecorded, 4);
      assert.deepEqual(data.period, getStockMovementPeriod(now));
      assert.equal(data.period.days, 30);
    }
  }
  assert.equal((await request('?range=invalid&start=not-a-date')).status, 200);
  assert.equal((await request('?category=x&category=y')).status, 400);
});

test('regular completed POS sales aggregate exact SKU lines once and exclude void, special-order and malformed rows', async () => {
  const p = await createProduct('SALES');
  await createSale(p, 2);
  await createSale(p, 3, { paymentMethod: 'credit', paymentStatus: 'Pending' });
  await createSale(p, 4, { paymentMethod: 'credit', paymentStatus: 'Partially Paid' });
  await createSale(p, 5, { isArchived: true }); // Archiving is audit visibility, not reversal.
  await createSale(p, 100, { status: 'voided' });
  await createSale(p, 100, { saleType: 'special-order' });
  await createSale(p, 100, { specialOrderId: new mongoose.Types.ObjectId() });
  for (const status of ['cancelled', 'refunded', 'pending', 'draft']) await Sale.collection.insertOne({ status, createdAt: saleDate, items: [{ product: p._id, code: p.sku, quantity: 100 }] });
  await Sale.collection.insertOne({ createdAt: saleDate, items: [{ product: p._id, code: p.sku, quantity: 1 }] });
  await receipt(p, 0, 20, '2026-09-01T00:00:00Z');
  const result = await analyze();
  assert.equal(result.qualifyingUnitsRecorded, 15);
  assert.equal(result.fast.entries[0].unitsSold, 15);
  assert.equal(result.fast.entries[0].regularUnitsSold, 15);
  assert.equal(result.fast.entries[0].specialOrderUnitsSold, 0);
  assert.equal((await Product.findById(p._id)).stock, 20);
});

test('only fully paid completed linked Special Orders contribute inventory-linked quantity; custom lines are excluded', async () => {
  const p = await createProduct('MIXED');
  await createSale(p, 3);
  const order = await SpecialOrder.create({
    orderNumber: 'SO-TEST-1', customerName: 'Test Customer', itemName: 'Mixed', quantity: 3, status: 'Completed', workflowVersion: 2,
    items: [{ itemName: 'Inventory', itemType: 'inventory', inventoryProduct: p._id, quantity: 2, sellingUnit: 'pcs' }, { itemName: 'Custom', itemType: 'custom', quantity: 5 }],
  });
  const [specialSale] = await Sale.create([{
    cashier: users.admin._id, saleType: 'special-order', specialOrderId: order._id, status: 'completed', paymentStatus: 'Paid',
    createdAt: saleDate, totalAmount: 70, items: [
      { product: p._id, code: p.sku, name: 'Inventory', sellingUnit: 'pcs', quantity: 2, unitPrice: 10, subtotal: 20 },
      { product: null, code: 'SO-TEST-1-2', name: 'Custom', quantity: 5, unitPrice: 10, subtotal: 50 },
    ],
  }]);
  await SpecialOrder.updateOne({ _id: order._id }, { $set: { linkedSaleId: specialSale._id } });
  const pending = await SpecialOrder.create({ orderNumber: 'SO-TEST-2', customerName: 'Test Customer', itemName: 'Unfinished', quantity: 1, status: 'Pending' });
  await createSale(p, 100, { saleType: 'special-order', specialOrderId: pending._id, paymentStatus: 'Partially Paid' });
  const result = await analyze();
  const row = [...result.fast.entries, ...result.slow.entries].find((entry) => entry.sku === p.sku);
  assert.equal(row.unitsSold, 5);
  assert.equal(row.regularUnitsSold, 3);
  assert.equal(row.specialOrderUnitsSold, 2);
  assert.equal(result.qualifyingUnitsRecorded, 5);
});

test('zero-sales classification requires full observation window, current stock and uninterrupted evidence', async () => {
  const stable = await createProduct('STABLE');
  const gap = await createProduct('GAP');
  const empty = await createProduct('EMPTY');
  const recent = await createProduct('RECENT', { createdAt: new Date(+new Date(analysisPeriod.start) + 5 * 86400000) });
  const missing = await createProduct('MISSING');
  const inactive = await createProduct('INACTIVE', { isActive: false });
  for (const p of [stable, gap, empty, recent, inactive]) await receipt(p, 0, 20, new Date(+new Date(analysisPeriod.start) - 86400000));
  await receipt(stable, 20, 25, new Date(+new Date(analysisPeriod.start) + 86400000));
  await receipt(stable, 25, 20, new Date(+new Date(analysisPeriod.start) + 2 * 86400000));
  await receipt(gap, 5, 20, new Date(+new Date(analysisPeriod.start) + 2 * 86400000));
  await receipt(empty, 20, 0, new Date(+new Date(analysisPeriod.start) + 2 * 86400000));
  await receipt(empty, 0, 20, new Date(+new Date(analysisPeriod.start) + 3 * 86400000));
  const result = await analyze();
  assert.deepEqual(result.nonMoving.entries.map((row) => row.sku), ['STABLE']);
  assert.deepEqual(result.insufficientHistory.entries.map((row) => row.sku), ['EMPTY', 'GAP', 'MISSING', 'RECENT']);
  assert.equal(result.dataQuality.inactiveSkus, 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: missing._id }), 0);
});

test('sales use an inclusive Manila start and stop at the exclusive current-time / day-end boundary', async () => {
  const p = await createProduct('DATES');
  const { start, end } = getStockMovementPeriod(now);
  await createSale(p, 1, { createdAt: new Date(+new Date(start) - 1) });
  await createSale(p, 2, { createdAt: new Date(start) });
  await createSale(p, 4, { createdAt: new Date(+now - 1) });
  await createSale(p, 8, { createdAt: new Date(end) });
  assert.equal((await analyze()).qualifyingUnitsRecorded, 6);
});

test('missing SKU identity and invalid quantities are disclosed without reassignment', async () => {
  const p = await createProduct('REUSED');
  await receipt(p, 0, 20, '2026-09-01T00:00:00Z');
  await Sale.collection.insertOne({ createdAt: saleDate, status: 'completed', items: [{ product: null, code: p.sku, quantity: 7 }, { product: p._id, code: p.sku, quantity: '9' }] });
  const result = await analyze();
  assert.equal(result.dataQuality.unresolvedSalesLines, 1);
  assert.equal(result.dataQuality.invalidQuantityLines, 1);
  assert.equal(result.nonMoving.count, 0);
  assert.equal(result.insufficientHistory.count, 1);
});

test('a database error returns an error response rather than fabricated zero summaries', async () => {
  const original = Product.find;
  Product.find = () => { throw new Error('Simulated analytics database failure.'); };
  try {
    const response = await request();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).fast, undefined);
  } finally { Product.find = original; }
});

test('API reports source breakdown and category filtering without peer comparisons', async () => {
  const paint = await Category.create({ name: 'Paint', sizeUnits: ['pcs', 'can'] });
  const products = [];
  for (let index = 0; index < 5; index++) products.push(await createProduct(`SKU-${index}`, { categoryRef: index === 0 ? paint._id : hardware._id, category: index === 0 ? paint.name : hardware.name, sellingUnit: 'pcs' }));
  for (let index = 0; index < products.length; index++) await createSale(products[index], index + 1);
  const allResponse = await request();
  const all = await allResponse.json();
  assert.equal(allResponse.status, 200);
  assert.equal(all.metric.key, 'unitsPerDay');
  assert.equal(all.policy.fastVelocityUnitsPerDay, 0.25);
  assert.equal(all.comparisonGroups, undefined);
  assert.equal(all.fast.count, 0);
  assert.equal(all.slow.count, 5);
  assert.equal(all.categories.length, 2);
  const filtered = await analyze({ category: String(paint._id) });
  assert.equal(filtered.slow.count, 1);
  assert.equal(filtered.slow.entries[0].categoryId, String(paint._id));
  assert.equal((await request(`?category=${new mongoose.Types.ObjectId()}`)).status, 400);
  assert.equal(await Sale.countDocuments(), 5);
  assert.equal(await Product.countDocuments({ stock: 20 }), 5);
});
