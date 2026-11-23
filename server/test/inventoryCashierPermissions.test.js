const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Product = require('../src/models/Product');
const Setting = require('../src/models/Setting');
const User = require('../src/models/User');
const InventoryLog = require('../src/models/InventoryLog');
const ActivityLog = require('../src/models/ActivityLog');
const rolesSource = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/constants/roles.js'), 'utf8');
const historySource = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/pages/History.jsx'), 'utf8');
const inventoryApiSource = require('node:fs').readFileSync(path.resolve(__dirname, '../../src/services/inventoryApi.js'), 'utf8');

let temporaryDirectory;
let mongo;
let server;
let baseUrl;
let product;
let originalSecret;
const users = {};

const waitForMongo = async (predicate) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (mongo?.exitCode !== null) throw new Error('Disposable MongoDB exited during startup.');
    try {
      if (await predicate()) return;
    } catch {
      // MongoDB is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Disposable MongoDB did not start.');
};

test.before(async () => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'inventory-cashier-permissions-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const binary = process.env.INVENTORY_PERMISSION_TEST_MONGOD || (process.platform === 'win32' ? 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' : 'mongod');
  mongo = spawn(binary, ['--dbpath', temporaryDirectory, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let startupError;
  mongo.on('error', (error) => { startupError = error; });
  await waitForMongo(async () => {
    if (startupError) throw startupError;
    await mongoose.connect(`mongodb://127.0.0.1:${port}/inventory_cashier_permissions`, { serverSelectionTimeoutMS: 500 });
    return true;
  });
  await Promise.all([Product.init(), Setting.init(), User.init(), InventoryLog.init(), ActivityLog.init()]);
  for (const role of ['cashier', 'admin', 'superadmin']) {
    users[role] = await User.create({ username: `inventory-${role}`, name: `Inventory ${role}`, password: randomBytes(24).toString('hex'), role });
  }
  await Setting.create({ singletonKey: 'default', maxStockLimit: 15 });
  product = await Product.create({ sku: 'INV-CASHIER-001', name: 'Cashier Stock Product', category: 'General', sellingUnit: 'pcs', stock: 10, price: 25 });
  const app = express();
  app.use(express.json());
  app.use('/api/products', require('../src/routes/productRoutes'));
  app.use('/api/logs', require('../src/routes/logRoutes'));
  app.use((error, _req, res, next) => {
    void next;
    return res.status(error.status || 500).json({ message: error.message });
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null && mongo.signalCode === null) {
    const stopped = once(mongo, 'exit');
    mongo.kill();
    await stopped;
  }
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('inventory-cashier-permissions-')) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const request = async (route, { role, method = 'GET', body } = {}) => {
  const token = role ? jwt.sign({ id: String(users[role]._id) }, process.env.JWT_SECRET, { expiresIn: '10m' }) : '';
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};

const stockAdjustment = (stock, savedProduct, requestId, reason = 'Delivery') => {
  const delta = stock - savedProduct.stock;
  return {
    stock,
    expectedStock: savedProduct.stock,
    expectedUpdatedAt: new Date(savedProduct.updatedAt).toISOString(),
    adjustmentRequestId: requestId,
    inventoryAdjustmentReason: reason,
    adjustmentType: delta > 0 ? 'IN' : 'OUT',
    adjustmentQuantity: Math.abs(delta),
  };
};

test('Cashier inventory access is exposed through the page, stock API, and read-only movement history', () => {
  assert.match(rolesSource, /Inventory:\s*\[ROLES\.SUPER_ADMIN, ROLES\.ADMIN, ROLES\.CASHIER\]/);
  assert.match(inventoryApiSource, /\/api\/products\/\$\{productId\}\/stock/);
  assert.match(historySource, /value: 'inventory', label: 'Inventory Logs'/);
  assert.match(historySource, /userRole === ROLES\.SUPER_ADMIN \|\| userRole === ROLES\.ADMIN \|\| userRole === ROLES\.CASHIER/);
});

test('Cashier, Admin, and Super Admin can view inventory and Cashier stock adjustments remain audited', async () => {
  for (const role of ['cashier', 'admin', 'superadmin']) {
    const listed = await request('/products', { role });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((item) => item.sku === product.sku));
  }

  const first = await request(`/products/${product._id}/stock`, {
    role: 'cashier', method: 'PATCH', body: stockAdjustment(14, product, 'cashier-stock-in'),
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.stock, 14);
  assert.equal((await InventoryLog.findOne({ productRef: product._id, action: 'ADD' }).populate('userRef')).userRef.username, users.cashier.username);

  const admin = await request(`/products/${product._id}/stock`, {
    role: 'admin', method: 'PATCH', body: stockAdjustment(12, first.body, 'admin-stock-out', 'Damage'),
  });
  assert.equal(admin.status, 200);
  const superAdmin = await request(`/products/${product._id}/stock`, {
    role: 'superadmin', method: 'PATCH', body: stockAdjustment(13, admin.body, 'superadmin-stock-in'),
  });
  assert.equal(superAdmin.status, 200);

  const logs = await request('/logs/inventory?limit=20', { role: 'cashier' });
  assert.equal(logs.status, 200);
  assert.ok(logs.body.some((log) => log.code === product.sku && log.userRef?.username === users.cashier.username));
});

test('Cashier stock authority cannot change catalog fields and keeps reservation and concurrency protections', async () => {
  const before = await Product.findById(product._id).lean();
  const genericPatch = await request(`/products/${product._id}`, { role: 'cashier', method: 'PATCH', body: { price: 1 } });
  assert.equal(genericPatch.status, 403);
  const mixedPayload = await request(`/products/${product._id}/stock`, {
    role: 'cashier', method: 'PATCH', body: { ...stockAdjustment(before.stock + 1, before, 'cashier-forbidden-field'), price: 1 },
  });
  assert.equal(mixedPayload.status, 400);
  assert.equal((await Product.findById(product._id)).price, before.price);

  const overMaximum = await request(`/products/${product._id}/stock`, {
    role: 'cashier', method: 'PATCH', body: stockAdjustment(16, before, 'cashier-over-maximum'),
  });
  assert.equal(overMaximum.status, 400);
  assert.match(overMaximum.body.message, /configured maximum/i);

  await Product.updateOne({ _id: product._id }, { $set: { reservedStock: before.stock } });
  const reserved = await Product.findById(product._id).lean();
  const reservationConflict = await request(`/products/${product._id}/stock`, {
    role: 'cashier', method: 'PATCH', body: stockAdjustment(reserved.stock - 1, reserved, 'cashier-reservation-conflict', 'Damaged'),
  });
  assert.equal(reservationConflict.status, 409);
  assert.match(reservationConflict.body.message, /reserved for Special Orders/i);

  await Product.updateOne({ _id: product._id }, { $set: { reservedStock: 0 } });
  const concurrentBase = await Product.findById(product._id).lean();
  const attempts = await Promise.all([
    request(`/products/${product._id}/stock`, { role: 'cashier', method: 'PATCH', body: stockAdjustment(concurrentBase.stock + 1, concurrentBase, 'cashier-concurrent-a') }),
    request(`/products/${product._id}/stock`, { role: 'admin', method: 'PATCH', body: stockAdjustment(concurrentBase.stock + 2, concurrentBase, 'admin-concurrent-b') }),
  ]);
  assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 409]);
  const saved = await Product.findById(product._id).lean();
  assert.ok([concurrentBase.stock + 1, concurrentBase.stock + 2].includes(saved.stock));
});
