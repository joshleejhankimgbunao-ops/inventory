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

const CreditTransaction = require('../src/models/CreditTransaction');
const Sale = require('../src/models/Sale');
const User = require('../src/models/User');

let temporaryDirectory;
let mongo;
let server;
let baseUrl;
let originalSecret;
const users = {};
const sales = {};
const credits = {};

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

const createCreditFixture = async (key, cashier, { legacy = false } = {}) => {
  const sale = await Sale.create({
    cashier: cashier._id,
    cashierName: `${key} display label`,
    paymentMethod: 'credit',
    paymentStatus: 'Partially Paid',
    totalAmount: 100,
    grossAmount: 100,
    customerName: `${key} customer`,
  });
  if (legacy) {
    // Simulate a historical row whose canonical creator reference was never
    // recorded. The display label must not be treated as proof of ownership.
    await Sale.collection.updateOne({ _id: sale._id }, { $unset: { cashier: '' } });
  }
  const credit = await CreditTransaction.create({
    creditTransactionId: `CR-${key.toUpperCase()}`,
    orderId: sale._id,
    customerName: `${key} customer`,
    totalAmount: 100,
    netAmount: 100,
    grossAmount: 100,
    amountPaid: 25,
    downPaymentAmount: 25,
    remainingBalance: 75,
    termDays: 30,
    dueDate: new Date('2099-01-01T00:00:00.000Z'),
    status: 'Partially Paid',
  });
  sales[key] = sale;
  credits[key] = credit;
};

test.before(async () => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'credit-transaction-ownership-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const binary = process.env.CREDIT_OWNERSHIP_TEST_MONGOD || (process.platform === 'win32' ? 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' : 'mongod');
  mongo = spawn(binary, ['--dbpath', temporaryDirectory, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let startupError;
  mongo.on('error', (error) => { startupError = error; });
  await waitForMongo(async () => {
    if (startupError) throw startupError;
    await mongoose.connect(`mongodb://127.0.0.1:${port}/credit_transaction_ownership`, { serverSelectionTimeoutMS: 500 });
    return true;
  });
  await Promise.all([CreditTransaction.init(), Sale.init(), User.init()]);
  for (const [key, role] of [['owner', 'cashier'], ['otherCashier', 'cashier'], ['admin', 'admin'], ['superadmin', 'superadmin']]) {
    users[key] = await User.create({ username: `credit-${key}`, name: `Credit ${key}`, password: randomBytes(24).toString('hex'), role });
  }
  await createCreditFixture('owner', users.owner);
  await createCreditFixture('other', users.otherCashier);
  await createCreditFixture('legacy', users.owner, { legacy: true });

  const app = express();
  app.use(express.json());
  app.use('/api/credit-transactions', require('../src/routes/creditTransactionRoutes'));
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
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('credit-transaction-ownership-')) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const request = async (route, key) => {
  const token = jwt.sign({ id: String(users[key]._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const response = await fetch(`${baseUrl}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
};

test('Cashier list and details use the linked Sale cashier ObjectId as the same ownership rule', async () => {
  const listed = await request('/credit-transactions', 'owner');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.map((entry) => entry._id), [String(credits.owner._id)]);

  const detail = await request(`/credit-transactions/${credits.owner._id}`, 'owner');
  assert.equal(detail.status, 200);
  assert.equal(detail.body._id, String(credits.owner._id));
  assert.equal(detail.body.cashierId, String(users.owner._id));
});

test('Cashier cannot use a direct detail request for another Cashier or a legacy row without creator identity', async () => {
  const other = await request(`/credit-transactions/${credits.other._id}`, 'owner');
  assert.equal(other.status, 403);
  assert.equal(other.body.message, 'You can only access your own credit transactions.');

  const legacy = await request(`/credit-transactions/${credits.legacy._id}`, 'owner');
  assert.equal(legacy.status, 403);
  assert.equal(legacy.body.message, 'You can only access your own credit transactions.');
});

test('Admin and Super Admin retain access to other and legacy Credit Transactions', async () => {
  for (const role of ['admin', 'superadmin']) {
    assert.equal((await request(`/credit-transactions/${credits.other._id}`, role)).status, 200);
    assert.equal((await request(`/credit-transactions/${credits.legacy._id}`, role)).status, 200);
  }
});
