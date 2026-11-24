const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const SpecialOrder = require('../src/models/SpecialOrder');
const Quotation = require('../src/models/SpecialOrderQuotation');
const Sale = require('../src/models/Sale');
const ActivityLog = require('../src/models/ActivityLog');
const Product = require('../src/models/Product');
const Partner = require('../src/models/Partner');
const Setting = require('../src/models/Setting');
const CreditTransaction = require('../src/models/CreditTransaction');
const InventoryLog = require('../src/models/InventoryLog');
const StockReservation = require('../src/models/SpecialOrderStockReservation');
const StockOperation = require('../src/models/SpecialOrderStockOperation');
const PaymentLedger = require('../src/models/SpecialOrderPaymentLedger');
const SpecialOrderCounter = require('../src/models/SpecialOrderCounter');
const { getReferenceDate, ensureReferenceCounter, allocateSpecialOrderReference } = require('../src/services/specialOrderReference');
const { addManilaCalendarDays, startOfManilaCalendarDay } = require('../src/utils/manilaCalendar');
// Keep application SSE heartbeat timers out of this isolated API test process.
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true, exports: new Proxy({}, { get: () => () => {} }) };
const documentPath = require.resolve('../src/services/transactionSupportingDocument');
const documents = require(documentPath);
const storedImages = new Map();
const memoryStorage = {
  isConfigured: () => true,
  putObject: async ({ key, body }) => { storedImages.set(key, body); },
  deleteObject: async (key) => { storedImages.delete(key); },
  getObject: async (key) => storedImages.has(key) ? { Body: Readable.from(storedImages.get(key)) } : null,
};
require.cache[documentPath] = {
  id: documentPath, filename: documentPath, loaded: true,
  exports: {
    ...documents,
    uploadDocument: (file) => documents.uploadDocument(file, { storage: memoryStorage, allowLocal: false }),
    removeDocument: (key) => documents.removeDocument(key, { storage: memoryStorage, allowLocal: false }),
    getDocument: (key) => documents.getDocument(key, { storage: memoryStorage, allowLocal: false }),
  },
};
const quotationImagePath = require.resolve('../src/services/specialOrderQuotationImage');
const quotationImages = require(quotationImagePath);
require.cache[quotationImagePath] = {
  id: quotationImagePath, filename: quotationImagePath, loaded: true,
  exports: {
    ...quotationImages,
    uploadQuotationImage: (file) => quotationImages.uploadQuotationImage(file, { storage: memoryStorage, allowLocal: false }),
    snapshotProductMasterImage: (product, imageIndex) => quotationImages.snapshotProductMasterImage(product, imageIndex, { storage: memoryStorage, allowLocal: false }),
    removeQuotationImage: (key) => quotationImages.removeQuotationImage(key, { storage: memoryStorage, allowLocal: false }),
    getQuotationImage: (key) => quotationImages.getQuotationImage(key, { storage: memoryStorage, allowLocal: false }),
  },
};
const creditProofPath = require.resolve('../src/controllers/creditTransactionController');
const creditProofController = require(creditProofPath);
require.cache[creditProofPath] = {
  id: creditProofPath, filename: creditProofPath, loaded: true,
  exports: {
    ...creditProofController,
    persistProofOfPayment: (value) => creditProofController.persistProofOfPayment(value, { storage: memoryStorage, allowLocalStorage: false }),
    markCreditTransactionFullyPaid: (req, res, next) => creditProofController.markCreditTransactionFullyPaid(req, res, next, {
      persistProof: (value) => creditProofController.persistProofOfPayment(value, { storage: memoryStorage, allowLocalStorage: false }),
      removeProof: (key) => creditProofController.removeStoredProof(key, { storage: memoryStorage, allowLocalStorage: false }),
    }),
    removeStoredProof: (key) => creditProofController.removeStoredProof(key, { storage: memoryStorage, allowLocalStorage: false }),
    getStoredProof: (key) => creditProofController.getStoredProof(key, { storage: memoryStorage, allowLocalStorage: false }),
  },
};
const controller = require('../src/controllers/specialOrderController');

// Always start a fresh local database. Never use application connection settings.
const binary = process.env.SPECIAL_ORDER_TEST_MONGOD || (process.platform === 'win32'
  ? 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' : 'mongod');
let mongoProcess;
let temporaryDirectory;
let httpServer;
let baseUrl;
let owner;
let other;
let admin;
let superadmin;
const originalSecret = process.env.JWT_SECRET;

const waitUntil = async (predicate) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (mongoProcess.exitCode !== null) throw new Error('Isolated mongod exited before startup completed.');
    try { if (await predicate()) return; } catch { /* Retry local startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated MongoDB startup timed out.');
};

test.before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'special-order-phase2-'));
  const portProbe = net.createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  mongoProcess = spawn(binary, ['--dbpath', temporaryDirectory, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'special-order-test', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let startupError;
  mongoProcess.on('error', (error) => { startupError = error; });
  await waitUntil(async () => {
    if (startupError) throw startupError;
    const probe = net.createConnection({ host: '127.0.0.1', port });
    try { await once(probe, 'connect'); return true; } finally { probe.destroy(); }
  });
  const client = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
  await client.connect();
  try {
    await client.db('admin').command({ replSetInitiate: { _id: 'special-order-test', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    await waitUntil(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary);
  } finally { await client.close(); }
  await mongoose.connect(`mongodb://127.0.0.1:${port}/special_order_phase2?replicaSet=special-order-test`);
  await Promise.all([User.init(), SpecialOrder.init(), Quotation.init(), Sale.init(), ActivityLog.init(), Product.init(), Partner.init(), Setting.init(), CreditTransaction.init(), InventoryLog.init(), StockReservation.init(), StockOperation.init(), PaymentLedger.init()]);
  await Setting.create({ storeName: 'Original Test Company', storeAddress: 'Original Company Address', authorizedSignatoryName: 'Settings Must Not Override Saved Signatory' });
  [owner, other, admin, superadmin] = await User.create(['cashier', 'cashier', 'admin', 'superadmin'].map((role, index) => ({ name: `Staff ${index}`, username: `phase2-${index}`, password: 'test-password', role })));
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  const app = express();
  app.use(express.json());
  app.use('/api/special-orders', require('../src/routes/specialOrderRoutes'));
  app.use('/api/sales', require('../src/routes/saleRoutes'));
  app.use('/api/credit-transactions', require('../src/routes/creditTransactionRoutes'));
  app.use('/api/products', require('../src/routes/productRoutes'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error.status || 500).json({ message: error.message });
  });
  httpServer = app.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

test.after(async () => {
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await mongoose.disconnect();
  if (mongoProcess?.pid && mongoProcess.exitCode === null && mongoProcess.signalCode === null) {
    const exited = once(mongoProcess, 'exit');
    mongoProcess.kill();
    await exited;
  }
  // Delete only the fresh, verified temporary database directory from this test.
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('special-order-phase2-')) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

const api = async (route, { user = owner, method = 'GET', body, form } = {}) => {
  const headers = { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET)}` };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api${route}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  return { status: response.status, body: await response.json() };
};

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MT8AAAAASUVORK5CYII=', 'base64');
const photoBlob = () => new Blob([tinyPng], { type: 'image/png' });
const saleFinalizationForm = (payload) => {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  if (payload.paymentMethod === 'credit') form.append('downPaymentProofs', photoBlob(), 'down-payment.png');
  return form;
};
const directQuotationForm = (body, photoCounts = {}) => {
  const form = new FormData();
  form.append('payload', JSON.stringify(body));
  for (const item of body.items) {
    for (let index = 0; index < (photoCounts[item.itemId] ?? 1); index += 1) form.append(`itemImages:${item.itemId}`, photoBlob(), `product-${index + 1}.png`);
  }
  return form;
};
const quotationTotalCentavos = (order) => Math.round(Number(order?.quotation?.total || 0) * 100);
const halfOfQuotationTotal = (order) => (Math.round(quotationTotalCentavos(order) / 2) / 100).toFixed(2);
const finalPaymentAmount = (order) => ((quotationTotalCentavos(order) - Math.round(quotationTotalCentavos(order) / 2)) / 100).toFixed(2);

const orderFixture = async () => SpecialOrder.create({
  orderNumber: `SO-${new mongoose.Types.ObjectId()}`, customerName: 'Legacy Customer',
  itemName: 'Custom item', quantity: 3, sellingPrice: 0.1, purchaseCost: 0.05,
  items: [{ itemName: 'Custom item', description: 'Agreed specification', sellingUnit: 'piece', quantity: 3, sellingPrice: 0.1, purchaseCost: 0.05 }],
  status: 'In Progress', createdBy: owner._id,
});
const prepare = async (order) => {
  const result = await api(`/special-orders/${order._id}/quotations`, { method: 'POST' });
  assert.ok([200, 201].includes(result.status), JSON.stringify(result));
  // Supply explicit saved metadata for existing lifecycle fixtures; production
  // must never manufacture a signatory just to satisfy document generation.
  await Quotation.updateOne({ _id: result.body._id }, { $set: { 'quotationDetails.authorizedSignatoryName': 'Test Signatory' } });
  let quotation = result.body;
  for (const item of quotation.items) {
    const form = new FormData();
    form.append('images', photoBlob(), 'product.png');
    const uploaded = await api(`/special-orders/${order._id}/quotations/${quotation._id}/items/${item.itemId}/images`, { method: 'POST', form });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
    quotation = uploaded.body;
  }
  return { ...quotation, quotationDetails: { ...quotation.quotationDetails, authorizedSignatoryName: 'Test Signatory' } };
};
const issue = async (order, quote) => {
  const result = await api(`/special-orders/${order._id}/quotations/${quote._id}/issue`, { method: 'POST' });
  assert.equal(result.status, 200, JSON.stringify(result));
};
const accept = async (order, quote) => {
  await issue(order, quote);
  const result = await api(`/special-orders/${order._id}/quotations/${quote._id}/decision`, { method: 'POST', body: { decision: 'Accepted' } });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.order.status, 'In Progress');
  assert.equal(result.body.order.transactionQuotation, quote._id);
};
const finalForm = (quote, { reference = BigInt(`0x${String(quote._id)}`).toString(), image = false } = {}) => {
  const form = new FormData();
  form.append('payload', JSON.stringify({ quotationId: quote._id, referenceNumber: reference }));
  if (image) form.append('document', new Blob([Buffer.from([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }), 'invoice.jpg');
  return form;
};
const completeForm = (quote, requestId, { reference = '', image = false } = {}) => {
  const form = new FormData();
  form.append('payload', JSON.stringify({ requestId, quotationId: quote._id, referenceNumber: reference }));
  if (image) form.append('document', new Blob([Buffer.from([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' }), 'invoice.jpg');
  return form;
};

test('simultaneous conflicting customer decisions commit exactly one decision and no sale', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await issue(order, quote);
  const results = await Promise.all(['Accepted', 'Declined'].map((decision) => api(`/special-orders/${order._id}/quotations/${quote._id}/decision`, { method: 'POST', body: { decision } })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const stored = await Quotation.findById(quote._id);
  assert.equal(stored.status, results.find((result) => result.status === 200).body.status);
  assert.equal(stored.decision, stored.status);
  assert.equal(String(stored.decidedBy), String(owner._id));
  assert.ok(stored.decidedAt);
  assert.equal(await ActivityLog.countDocuments({ action: 'Recorded Special Order Quotation Decision', details: { $regex: quote.quotationNumber } }), 1);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('issue versus edit cannot silently alter the issued version after the issue commits', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  const [issued, edited] = await Promise.all([
    api(`/special-orders/${order._id}/quotations/${quote._id}/issue`, { method: 'POST' }),
    api(`/special-orders/${order._id}/quotations/${quote._id}`, { method: 'PATCH', body: { items: [{ itemId: quote.items[0].itemId, itemName: 'Changed draft', quantity: 2, unitPrice: 15, imageKeys: quote.items[0].images.map((image) => image.key) }] } }),
  ]);
  assert.equal(issued.status, 200, JSON.stringify(issued));
  assert.ok([200, 409].includes(edited.status));
  const stored = await Quotation.findById(quote._id);
  assert.equal(stored.status, 'Awaiting Decision');
  assert.equal(stored.items[0].itemName, edited.status === 200 ? 'Changed Draft' : 'Custom Item');
  const rejected = await api(`/special-orders/${order._id}/quotations/${quote._id}`, { method: 'PATCH', body: { items: [{ itemName: 'Too late', quantity: 1, unitPrice: 1 }] } });
  assert.equal(rejected.status, 409);
});

test('concurrent Prepare retries create one quotation and one coherent order pointer', async () => {
  const order = await orderFixture();
  const results = await Promise.all(Array.from({ length: 3 }, () => api(`/special-orders/${order._id}/quotations`, { method: 'POST' })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 201]);
  assert.equal(new Set(results.map((result) => result.body._id)).size, 1);
  assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 1);
  assert.equal(String((await SpecialOrder.findById(order._id)).currentQuotation), results[0].body._id);
  assert.equal(await ActivityLog.countDocuments({ action: 'Created Special Order Quotation', details: { $regex: order.orderNumber } }), 1);
});

test('concurrent awaiting-decision revision retains one generated historic version and one unaccepted current draft', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await issue(order, quote);
  const results = await Promise.all(Array.from({ length: 2 }, () => api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' })));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const versions = await Quotation.find({ specialOrder: order._id }).sort({ version: 1 });
  assert.equal(versions.length, 2);
  assert.equal(versions[0].status, 'Superseded');
  assert.equal(versions[0].decision, '');
  assert.equal(versions[0].decidedAt, null);
  assert.ok(versions[0].documentSnapshot);
  assert.equal(versions[1].status, 'Draft');
  assert.equal(versions[1].decision, '');
  assert.equal(versions[1].issuedAt, null);
  assert.equal(versions[1].decidedAt, null);
  assert.equal(String((await SpecialOrder.findById(order._id)).currentQuotation), String(versions[1]._id));
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/decision`, { method: 'POST', body: { decision: 'Accepted' } })).status, 409);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) })).status, 400);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('failed revision rolls back supersession, pointer, and audit records', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await issue(order, quote);
  const originalCreate = Quotation.create;
  Quotation.create = async () => { throw new Error('Injected revision failure'); };
  try {
    const result = await api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' });
    assert.equal(result.status, 500);
  } finally { Quotation.create = originalCreate; }
  const stored = await Quotation.findById(quote._id);
  assert.equal(stored.status, 'Awaiting Decision');
  assert.equal(stored.isCurrent, true);
  assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 1);
  assert.equal(String((await SpecialOrder.findById(order._id)).currentQuotation), quote._id);
  assert.equal(await ActivityLog.countDocuments({ action: 'Revised Special Order Quotation', details: { $regex: quote.quotationNumber } }), 0);
});

test('cashiers cannot access another order through direct quotation or finalization APIs', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  const prefix = `/special-orders/${order._id}`;
  for (const options of [
    { route: `${prefix}/quotations` },
    { route: `${prefix}/receipt` },
    { route: `${prefix}/quotations`, method: 'POST' },
    { route: `${prefix}`, method: 'PATCH', body: { remarks: 'Denied' } },
    { route: `${prefix}/quotations/${quote._id}`, method: 'PATCH', body: { items: [] } },
    ...['issue', 'decision', 'revise'].map((action) => ({ route: `${prefix}/quotations/${quote._id}/${action}`, method: 'POST', body: { decision: 'Accepted' } })),
    { route: `${prefix}/finalize`, method: 'POST', form: finalForm(quote) },
  ]) {
    const { route, ...requestOptions } = options;
    assert.equal((await api(route, { ...requestOptions, user: other })).status, 403, route);
  }
  for (const user of [admin, superadmin]) assert.equal((await api(`${prefix}/quotations`, { user })).status, 200);
  const unauthenticated = await fetch(`${baseUrl}/api${prefix}/quotations`);
  assert.equal(unauthenticated.status, 401);
  const list = await api('/special-orders', { user: other });
  assert.equal(list.status, 200);
  assert.ok(!list.body.some((row) => row._id === String(order._id)));
});

test('Special Order create request-token replay is restricted to its owner or administrators', async () => {
  const order = await orderFixture();
  order.clientRequestId = `create:${order._id}`;
  await order.save();
  const body = { clientRequestId: order.clientRequestId };
  assert.equal((await api('/special-orders', { method: 'POST', user: other, body })).status, 403);
  assert.equal((await api('/special-orders', { method: 'POST', body })).status, 200);
  assert.equal((await api('/special-orders', { method: 'POST', user: admin, body })).status, 200);
});

test('concurrent creation with a shared request token cannot return another cashier\'s order', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Customer' });
  const body = {
    clientRequestId: `shared-create:${new mongoose.Types.ObjectId()}`, customerName: 'Customer', customerId: String(customer._id),
    items: [{ itemName: 'Custom item', quantity: 1, purchaseCost: 1, sellingPrice: 2, expectedArrivalDate: '2099-01-01' }],
  };
  const results = await Promise.all([owner, other].map((user) => api('/special-orders', { user, method: 'POST', body })));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 403]);
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: body.clientRequestId }), 1);
});

test('Special Order references use Manila dates and transactional daily sequences', async () => {
  assert.equal(getReferenceDate(new Date('2026-10-26T15:59:59.999Z')), '20261026');
  assert.equal(getReferenceDate(new Date('2026-10-26T16:00:00.000Z')), '20261027');

  const createNumbered = async (date, fail = false) => {
    await ensureReferenceCounter(date);
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const orderNumber = await allocateSpecialOrderReference(date, session);
        await SpecialOrder.create([{ orderNumber, customerName: 'Sequence test', itemName: 'Item', quantity: 1 }], { session });
        if (fail) throw new Error('Injected rollback');
        return orderNumber;
      });
    } finally { await session.endSession(); }
  };

  assert.equal(await createNumbered('20800101'), 'SO-20800101-0001');
  assert.equal(await createNumbered('20800101'), 'SO-20800101-0002');
  assert.equal(await createNumbered('20800102'), 'SO-20800102-0001');
  await assert.rejects(createNumbered('20800103', true), /Injected rollback/);
  assert.equal(await createNumbered('20800103'), 'SO-20800103-0001');
  const firstDayRace = await Promise.all(Array.from({ length: 8 }, () => createNumbered('20800105')));
  assert.deepEqual(firstDayRace.sort(), Array.from({ length: 8 }, (_, index) => `SO-20800105-${String(index + 1).padStart(4, '0')}`));
  await SpecialOrderCounter.updateOne({ _id: '20800101' }, { $set: { sequence: 9999 } });
  assert.equal(await createNumbered('20800101'), 'SO-20800101-10000');

  const legacy = await SpecialOrder.create({ orderNumber: 'SO-20800104-0001', customerName: 'Legacy', itemName: 'Item', quantity: 1 });
  assert.equal(await createNumbered('20800104'), 'SO-20800104-0002');
  assert.equal((await SpecialOrder.findById(legacy._id)).orderNumber, 'SO-20800104-0001');
  const oldReference = 'SO-12345678-ABCD';
  await SpecialOrder.create({ orderNumber: oldReference, customerName: 'Legacy Search', itemName: 'Item', quantity: 1, createdBy: owner._id });
  const oldSearch = await api(`/special-orders?search=${encodeURIComponent(oldReference)}`);
  assert.ok(oldSearch.body.some((order) => order.orderNumber === oldReference));
});

test('concurrent Special Order creations allocate unique sequential references and replay one request', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Sequence Customer' });
  const payload = {
    customerName: customer.name, customerId: String(customer._id),
    items: [{ itemName: 'Custom item', quantity: 1, purchaseCost: 1, sellingPrice: 2, expectedArrivalDate: '2099-01-01' }],
  };
  assert.equal((await api('/special-orders', { method: 'POST', body: payload })).status, 400);
  const requestId = `sequence-replay:${randomUUID()}`;
  const results = await Promise.all([
    ...Array.from({ length: 5 }, () => api('/special-orders', { method: 'POST', body: { ...payload, clientRequestId: `sequence:${randomUUID()}` } })),
    ...Array.from({ length: 2 }, () => api('/special-orders', { method: 'POST', body: { ...payload, clientRequestId: requestId } })),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201, 201, 201, 201, 201, 201]);
  const orders = [...new Map(results.map((result) => [result.body._id, result.body])).values()];
  assert.equal(orders.length, 6);
  const prefix = `SO-${getReferenceDate()}-`;
  assert.ok(orders.every((order) => order.orderNumber.startsWith(prefix)));
  const sequences = orders.map((order) => Number(order.orderNumber.slice(prefix.length))).sort((a, b) => a - b);
  assert.deepEqual(sequences, sequences.map((_, index) => sequences[0] + index));
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: requestId }), 1);
  const newSearch = await api(`/special-orders?search=${encodeURIComponent(orders[0].orderNumber)}`);
  assert.ok(newSearch.body.some((order) => order.orderNumber === orders[0].orderNumber));
});

test('generic POS sale endpoints reject Special Order payloads before sales, uploads or stock changes', async () => {
  const saleCount = await Sale.countDocuments();
  for (const fields of [{ saleType: 'special-order' }, { specialOrderId: String(new mongoose.Types.ObjectId()) }, { quotationId: String(new mongoose.Types.ObjectId()) }, { clientRequestId: 'special-order:reserved' }]) {
    const body = { items: [], paymentMethod: 'cash', referenceNumber: '001234', ...fields };
    assert.equal((await api('/sales', { method: 'POST', body })).status, 400);
    const form = new FormData();
    form.append('payload', JSON.stringify(body));
    assert.equal((await api('/sales/finalize', { method: 'POST', form })).status, 400);
  }
  assert.equal(await Sale.countDocuments(), saleCount);
});

test('final save permits invoice-only, image-only and both; rejects empty evidence', async () => {
  for (const evidence of [{ reference: '001234' }, { reference: '', image: true }, { reference: '004567', image: true }]) {
    const order = await orderFixture();
    const quote = await prepare(order);
    assert.equal(quote.total, 0.3);
    await accept(order, quote);
    assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
    assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
    const result = await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote, evidence) });
    assert.equal(result.status, 201, JSON.stringify(result));
    const sale = await Sale.findOne({ specialOrderId: order._id });
    assert.equal(sale.totalAmount, 0.3);
    assert.equal(sale.items[0].subtotal, 0.3);
    assert.equal(sale.items[0].product, null);
    assert.equal(sale.saleType, 'special-order');
    assert.equal(String(sale.specialOrderQuotationId), quote._id);
    assert.equal((await SpecialOrder.findById(order._id)).status, 'Completed');
  }
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote, { reference: '' }) })).status, 400);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('concurrent final saves create one sale, one completion, and clean the unused supporting image', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  const beforeImages = storedImages.size;
  const results = await Promise.all(Array.from({ length: 2 }, () => api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote, { reference: '', image: true }) })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal(storedImages.size, beforeImages + 1);
  const stored = await SpecialOrder.findById(order._id);
  assert.equal(stored.statusHistory.filter((entry) => entry.status === 'Completed').length, 1);
  assert.equal(results[0].body.sale._id, results[1].body.sale._id);
});

test('finalize racing with revision cannot sell an obsolete quotation or revise a completed order', async () => {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const order = await orderFixture();
    const quote = await prepare(order);
    await accept(order, quote);
    const [saved, revised] = await Promise.all([
      api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) }),
      api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' }),
    ]);
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.ok([400, 409].includes(revised.status), JSON.stringify(revised));
    assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 1);
    assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  }
});

test('unsafe money and inconsistent accepted totals are rejected without creating a sale', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  const huge = await api(`/special-orders/${order._id}/quotations/${quote._id}`, {
    method: 'PATCH', body: { items: [{ itemName: 'Overflow', quantity: Number.MAX_SAFE_INTEGER, unitPrice: 100 }] },
  });
  assert.equal(huge.status, 400);
  const imprecise = await api(`/special-orders/${order._id}/quotations/${quote._id}`, {
    method: 'PATCH', body: { items: [{ itemName: 'Imprecise', quantity: 1, unitPrice: '90071992547409.91' }] },
  });
  assert.equal(imprecise.status, 400);
  await accept(order, quote);
  await Quotation.updateOne({ _id: quote._id }, { $set: { total: 100 } });
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('ambiguous current versions fail closed and completed legacy receipts remain readable', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await Quotation.create({ ...(await Quotation.findById(quote._id)).toObject(), _id: new mongoose.Types.ObjectId(), version: 2, quotationNumber: `${quote.quotationNumber}-OTHER` });
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/issue`, { method: 'POST' })).status, 409);
  const legacy = await orderFixture();
  const sale = await Sale.create(controller.__test.buildSalePayload(legacy, { user: owner }));
  legacy.status = 'Completed';
  legacy.linkedSaleId = sale._id;
  await legacy.save();
  const receipt = await api(`/special-orders/${legacy._id}/receipt`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.receiptTransaction.sourceId, String(sale._id));
});

test('failed Prepare rolls back both quotation creation and order pointer', async () => {
  const order = await orderFixture();
  const originalSave = SpecialOrder.prototype.save;
  SpecialOrder.prototype.save = function (...args) {
    if (String(this._id) === String(order._id) && this.currentQuotation) throw new Error('Injected pointer save failure');
    return originalSave.apply(this, args);
  };
  try {
    assert.equal((await api(`/special-orders/${order._id}/quotations`, { method: 'POST' })).status, 500);
  } finally { SpecialOrder.prototype.save = originalSave; }
  assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 0);
  assert.equal((await SpecialOrder.findById(order._id)).currentQuotation, null);
  assert.ok(await prepare(order));
});

test('failure after Sale creation rolls back sale and completion and removes the uploaded image', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  const beforeImages = storedImages.size;
  const originalSave = SpecialOrder.prototype.save;
  SpecialOrder.prototype.save = function (...args) {
    if (String(this._id) === String(order._id) && this.status === 'Completed') throw new Error('Injected completion failure');
    return originalSave.apply(this, args);
  };
  try {
    assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote, { reference: '', image: true }) })).status, 500);
  } finally { SpecialOrder.prototype.save = originalSave; }
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal(storedImages.size, beforeImages);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) })).status, 201);
});

test('accepted revision is rejected even while a valid final save is paused after preflight', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  const originalLock = SpecialOrder.findOneAndUpdate;
  let release;
  let reached;
  const barrier = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { reached = resolve; });
  let paused = false;
  SpecialOrder.findOneAndUpdate = async function (...args) {
    if (!paused && String(args[0]._id) === String(order._id)) {
      paused = true;
      reached();
      await barrier;
    }
    return originalLock.apply(this, args);
  };
  const pendingSave = api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) });
  let timeout;
  try {
    await Promise.race([entered, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Final save did not acquire the shared order lock.')), 5000); })]);
    assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' })).status, 409);
  } finally {
    clearTimeout(timeout);
    release();
    SpecialOrder.findOneAndUpdate = originalLock;
  }
  assert.equal((await pendingSave).status, 201);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
});

test('quoted order material edits are rejected and stale pointers cannot authorize a transaction', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  assert.equal((await api(`/special-orders/${order._id}`, { method: 'PATCH', body: { customerName: 'Changed Customer' } })).status, 409);
  assert.equal((await api(`/special-orders/${order._id}`, { method: 'PATCH', body: { remarks: 'Operational note' } })).status, 200);
  await SpecialOrder.updateOne({ _id: order._id }, { $set: { currentQuotation: new mongoose.Types.ObjectId() } });
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('ordinary POS cash and credit checkout retains stock deductions, credit obligations, and safe replay', async () => {
  const product = await Product.create({ sku: 'PHASE2-POS', name: 'Standard Product', category: 'General', price: 100, stock: 10 });
  const customer = await Partner.create({ name: 'Regular Customer', type: 'customer' });
  for (const paymentMethod of ['cash', 'credit']) {
    const payload = {
      items: [{ productId: String(product._id), quantity: 2 }], paymentMethod, clientRequestId: `pos:${paymentMethod}`, referenceNumber: paymentMethod === 'cash' ? '008811' : '008822',
      ...(paymentMethod === 'cash' ? { cashTendered: '200' } : { customerId: String(customer._id), termDays: 30, creditPaymentMode: 'cash', downPaymentAmount: '50.00' }),
    };
    const result = await api('/sales/finalize', { method: 'POST', form: saleFinalizationForm(payload) });
    assert.equal(result.status, 201, JSON.stringify(result));
    const replay = await api('/sales', { method: 'POST', body: payload });
    assert.equal(replay.status, 200);
    assert.equal((await api('/sales', { user: other, method: 'POST', body: payload })).status, 403);
  }
  assert.equal((await Product.findById(product._id)).stock, 6);
  assert.equal(await CreditTransaction.countDocuments({ customerId: customer._id }), 1);
  const credit = await CreditTransaction.findOne({ customerId: customer._id });
  assert.equal(credit.totalAmount, 200);
  assert.equal(credit.downPaymentAmount, 50);
  assert.equal(credit.amountPaid, 50);
  assert.equal(credit.remainingBalance, 150);
  assert.equal(credit.status, 'Partially Paid');
  assert.equal(credit.paymentHistory.length, 1);
  assert.equal(credit.paymentHistory[0].type, 'down_payment');
  assert.equal(credit.paymentHistory[0].method, 'cash');
  const beforeStockLogs = await InventoryLog.countDocuments();
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) })).status, 201);
  assert.equal((await Product.findById(product._id)).stock, 6);
  assert.equal(await InventoryLog.countDocuments(), beforeStockLogs);
  assert.equal(await CreditTransaction.countDocuments({ customerId: customer._id }), 1);
});

test('credit checkout requires a centavo-precise down payment below the authoritative total', async () => {
  const product = await Product.create({ sku: `DOWN-${new mongoose.Types.ObjectId()}`, name: 'Down Payment Test Product', category: 'General', price: 100, stock: 5 });
  const customer = await Partner.create({ name: `Down Payment Customer ${product._id}`, type: 'customer' });
  const basePayload = {
    items: [{ productId: String(product._id), quantity: 1 }],
    paymentMethod: 'credit',
    customerId: String(customer._id),
    termDays: 30,
    creditPaymentMode: 'gcash',
    referenceNumber: String(Date.now()),
  };

  for (const [index, amount] of ['', '0', '-1', '0.001', '100', '101', 'not-money'].entries()) {
    const result = await api('/sales/finalize', { method: 'POST', form: saleFinalizationForm({ ...basePayload, downPaymentAmount: amount, clientRequestId: `down-payment-invalid:${product._id}:${index}` }) });
    assert.equal(result.status, 400, JSON.stringify(result));
  }

  assert.equal((await Product.findById(product._id)).stock, 5);
  assert.equal(await Sale.countDocuments({ customer: customer._id }), 0);
  assert.equal(await CreditTransaction.countDocuments({ customerId: customer._id }), 0);

  const accepted = await api('/sales/finalize', {
    method: 'POST',
    form: saleFinalizationForm({
      ...basePayload,
      totalAmount: 0.01,
      downPaymentAmount: '0.01',
      clientRequestId: `down-payment-valid:${product._id}`,
    }),
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted));
  const sale = await Sale.findById(accepted.body._id);
  const credit = await CreditTransaction.findOne({ orderId: sale._id });
  assert.equal(sale.totalAmount, 100);
  assert.equal(credit.totalAmount, 100);
  assert.equal(credit.amountPaid, 0.01);
  assert.equal(credit.remainingBalance, 99.99);
  assert.equal(credit.paymentHistory[0].amount, 0.01);
});

test('quotation-first preserves metadata, revises before decision, activates acceptance and completes its snapshot', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Version Customer', address: 'Agreed Address', attentionName: 'Customer Contact', attentionPosition: 'Purchasing' });
  const created = await api('/special-orders', { method: 'POST', body: {
    quotationFirst: true, clientRequestId: `version-customer:${randomUUID()}`, customerId: String(customer._id), customerName: customer.name,
    items: [{ itemName: 'Requested item', description: 'Requested specification', sellingUnit: 'roll', quantity: 2, purchaseCost: 5, sellingPrice: 10, expectedArrivalDate: '2099-01-01' }],
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'Pending');
  const order = created.body;
  const quote = await prepare(order);
  assert.equal(quote.items[0].sellingUnit, 'roll');
  assert.equal(quote.customerDetails.attentionName, 'Customer Contact');
  const metadata = { attentionName: 'Agreed Contact', attentionPosition: 'Confirmed Position', authorizedSignatoryName: 'Confirmed Signatory' };
  const saved = await api(`/special-orders/${order._id}/quotations/${quote._id}`, { method: 'PATCH', body: {
    quotationDetails: metadata, items: [{ itemId: quote.items[0].itemId, imageKeys: quote.items[0].images.map((image) => image.key), itemName: 'Agreed custom item', description: 'Approved specification', sellingUnit: 'box', quantity: 3, unitPrice: 20 }],
  } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.quotationDetails, metadata);
  await issue(order, quote);
  const revised = await api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' });
  assert.equal(revised.status, 201);
  assert.deepEqual(revised.body.quotationDetails, metadata);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'Pending');
  assert.equal((await SpecialOrder.findById(order._id)).transactionQuotation, null);
  const history = await api(`/special-orders/${order._id}/quotations`);
  assert.equal(history.body[1].decision, '');
  assert.equal(history.body[1].isCurrent, false);
  assert.equal(history.body[1].decidedBy, null);
  await Partner.updateOne({ _id: customer._id }, { $set: { name: 'Changed Directory Customer', address: 'Changed Address' } });
  await accept(order, revised.body);
  assert.equal((await api(`/special-orders/${order._id}/quotations/${revised.body._id}/revise`, { method: 'POST' })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  const processing = await api('/special-orders');
  assert.equal(processing.body.find((row) => row._id === order._id).quotation.total, 60);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(revised.body) })).status, 201);
  const receipt = await api(`/special-orders/${order._id}/receipt`);
  assert.equal(receipt.body.receiptTransaction.customerName, 'Version Customer');
  assert.equal(receipt.body.receiptTransaction.customerDetails.address, 'Agreed Address');
  assert.equal(receipt.body.receiptTransaction.items[0].description, 'Approved Specification');
  assert.equal(receipt.body.receiptTransaction.items[0].sellingUnit, 'box');
  assert.equal(receipt.body.receiptTransaction.total, 60);
  assert.equal(receipt.body.receiptTransaction.specialOrderQuotationVersion, 2);
  assert.equal(receipt.body.receiptTransaction.specialOrderQuotationId, revised.body._id);
  assert.equal(receipt.body.receiptTransaction.specialOrderNumber, order.orderNumber);
});

test('new Special Orders reject missing or non-regular customer associations', async () => {
  const walkIn = await Partner.create({ type: 'customer', name: 'Walk In', customerType: 'walk-in' });
  const body = { customerName: 'Customer', items: [{ itemName: 'Item', quantity: 1, purchaseCost: 1, sellingPrice: 2, expectedArrivalDate: '2099-01-01' }] };
  assert.equal((await api('/special-orders', { method: 'POST', body })).status, 400);
  assert.equal((await api('/special-orders', { method: 'POST', body: { ...body, customerId: String(walkIn._id) } })).status, 400);
});

test('Phase 4 generation validates saved metadata and freezes the company/version document atomically', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  const base = `/special-orders/${order._id}/quotations/${quote._id}`;
  await Quotation.updateOne({ _id: quote._id }, { $set: { 'quotationDetails.authorizedSignatoryName': '' } });
  const blank = await api(`${base}/issue`, { method: 'POST' });
  assert.equal(blank.status, 400);
  assert.match(blank.body.message, /Authorized Signatory Name.*Generate Quotation/i);
  assert.equal((await Quotation.findById(quote._id)).status, 'Draft');
  const metadata = { attentionName: 'Version Contact', attentionPosition: 'Version Position', authorizedSignatoryName: 'Version Signatory' };
  assert.equal((await api(base, { method: 'PATCH', body: { items: quote.items, quotationDetails: metadata, documentSnapshot: { settings: { storeName: 'Injected Company' } } } })).status, 200);
  await issue(order, quote);
  const stored = await Quotation.findById(quote._id).lean();
  assert.equal(stored.documentSnapshot.settings.storeName, 'Original Test Company');
  assert.equal(stored.documentSnapshot.settings.authorizedSignatoryName, undefined);
  assert.deepEqual(stored.documentSnapshot.quotationDetails, metadata);
  assert.equal(stored.documentSnapshot.quotationDate, stored.issuedAt.toISOString());
  assert.equal(stored.documentSnapshot.specialOrderNumber, order.orderNumber);
  assert.equal(stored.documentSnapshot.quotationNumber, quote.quotationNumber);
  assert.equal(stored.documentSnapshot.version, 1);
  assert.equal(stored.documentSnapshot.total, 0.3);
  assert.equal((await api(`${base}/issue`, { method: 'POST' })).status, 409);
});

test('Phase 4 repeated current/historical document reads preserve decisions, records, sales and inventory', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await issue(order, quote);
  const old = await Quotation.findById(quote._id).lean();
  await Setting.updateOne({ singletonKey: 'default' }, { $set: { storeName: 'New Test Company', storeAddress: 'New Address', authorizedSignatoryName: 'New Person' } });
  try {
    const revised = await api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' });
    assert.equal(revised.status, 201);
    assert.equal(revised.body.documentSnapshot, null);
    await issue(order, revised.body);
    const historyBefore = await Quotation.find({ specialOrder: order._id }).sort({ version: 1 }).lean();
    const orderBefore = await SpecialOrder.findById(order._id).lean();
    const logCount = await ActivityLog.countDocuments();
    const inventoryCount = await InventoryLog.countDocuments();
    const saleCount = await Sale.countDocuments();
    const stockBefore = await Product.find().lean();
    const route = `/special-orders/${order._id}/quotations/${quote._id}/document`;
    for (const user of [owner, admin, superadmin, owner]) {
      const result = await api(route, { user });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.deepEqual(result.body, JSON.parse(JSON.stringify(old.documentSnapshot)));
      const { buildSpecialOrderFormalQuotationModel, createFormalQuotationPdf } = await import('../../src/utils/formalQuotation.js');
      const model = buildSpecialOrderFormalQuotationModel(result.body);
      const photoSrc = `data:image/png;base64,${(await fs.readFile(path.resolve(__dirname, '../../src/assets/logo.png'))).toString('base64')}`;
      model.items.forEach((item) => item.images.forEach((image) => { image.src = photoSrc; }));
      const generated = createFormalQuotationPdf(model);
      assert.match(generated.pdf.output(), /Original Test Company/);
      assert.ok(generated.filename.includes(quote.quotationNumber));
    }
    const current = await api(`/special-orders/${order._id}/quotations/${revised.body._id}/document`);
    assert.equal(current.status, 200);
    assert.equal(current.body.settings.storeName, 'New Test Company');
    assert.equal(current.body.version, 2);
    assert.equal((await api(route, { user: other })).status, 403);
    assert.equal((await api(`/special-orders/${order._id}/quotations/${new mongoose.Types.ObjectId()}/document`)).status, 404);
    const another = await orderFixture();
    assert.equal((await api(`/special-orders/${another._id}/quotations/${quote._id}/document`)).status, 404);
    const unauthenticated = await fetch(`${baseUrl}/api${route}`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await Quotation.find({ specialOrder: order._id }).sort({ version: 1 }).lean(), historyBefore);
    assert.deepEqual(await SpecialOrder.findById(order._id).lean(), orderBefore);
    assert.equal(await ActivityLog.countDocuments(), logCount);
    assert.equal(await InventoryLog.countDocuments(), inventoryCount);
    assert.equal(await Sale.countDocuments(), saleCount);
    assert.deepEqual(await Product.find().lean(), stockBefore);
  } finally {
    await Setting.updateOne({ singletonKey: 'default' }, { $set: { storeName: 'Original Test Company', storeAddress: 'Original Company Address', authorizedSignatoryName: 'Settings Must Not Override Saved Signatory' } });
  }
});

test('Phase 4 missing historical snapshots fail visibly without backfilling or changing records', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await Quotation.updateOne({ _id: quote._id }, { $set: { status: 'Accepted', issuedAt: new Date('2026-01-01'), decision: 'Accepted' } });
  const before = await Quotation.findById(quote._id).lean();
  const result = await api(`/special-orders/${order._id}/quotations/${quote._id}/document`);
  assert.equal(result.status, 409);
  assert.match(result.body.message, /snapshot.*unavailable.*administrative review/i);
  assert.deepEqual(await Quotation.findById(quote._id).lean(), before);
});

test('Phase 4 failed generation rolls back the document snapshot/status and leaves no issue audit', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  const originalUpdate = Quotation.findOneAndUpdate;
  Quotation.findOneAndUpdate = async function(filter, update, options) {
    const result = await originalUpdate.call(this, filter, update, options);
    if (String(filter._id) === quote._id && update?.$set?.documentSnapshot) throw new Error('Injected failure after document snapshot write');
    return result;
  };
  try {
    assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/issue`, { method: 'POST' })).status, 500);
  } finally { Quotation.findOneAndUpdate = originalUpdate; }
  const stored = await Quotation.findById(quote._id);
  assert.equal(stored.status, 'Draft');
  assert.equal(stored.documentSnapshot, null);
  assert.equal(stored.issuedAt, null);
  assert.equal(stored.issuedBy, null);
  assert.equal(await ActivityLog.countDocuments({ action: 'Issued Special Order Quotation', details: { $regex: quote.quotationNumber } }), 0);
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/document`)).status, 409);
  await issue(order, quote);
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/document`)).status, 200);
});

test('quotation-first creation atomically persists a pending parent and draft, with optional sourcing and safe retries', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Quotation First Customer' });
  const body = {
    quotationFirst: true, clientRequestId: `quotation-first:${new mongoose.Types.ObjectId()}`,
    customerId: String(customer._id), customerName: customer.name,
    quotationDetails: { attentionName: 'Saved ATTN', attentionPosition: 'Purchasing', authorizedSignatoryName: 'Saved Signatory' },
    items: [{ itemName: 'Custom request', description: 'Requested specification', sellingUnit: 'box', quantity: 2, sellingPrice: 1.25 }],
  };
  const [first, retry] = await Promise.all([api('/special-orders', { method: 'POST', body }), api('/special-orders', { method: 'POST', body })]);
  assert.deepEqual([first.status, retry.status].sort(), [200, 201]);
  assert.equal(first.body._id, retry.body._id);
  const order = await SpecialOrder.findById(first.body._id);
  const quotes = await Quotation.find({ specialOrder: order._id });
  assert.equal(order.status, 'Pending');
  assert.equal(order.transactionQuotation, null);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].status, 'Draft');
  assert.equal(quotes[0].total, 2.5);
  assert.equal(quotes[0].quotationDetails.authorizedSignatoryName, 'Saved Signatory');
  assert.equal(String(order.currentQuotation), String(quotes[0]._id));
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await api('/special-orders', { method: 'POST', body, user: other })).status, 403);
  const originalCreate = Quotation.create;
  Quotation.create = async () => { throw new Error('Injected initial quotation failure'); };
  const failingBody = { ...body, clientRequestId: `failed-create:${new mongoose.Types.ObjectId()}` };
  try { assert.equal((await api('/special-orders', { method: 'POST', body: failingBody })).status, 500); }
  finally { Quotation.create = originalCreate; }
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: failingBody.clientRequestId }), 0);
  assert.equal((await api('/special-orders', { method: 'POST', body: failingBody })).status, 201);
});

test('direct generation atomically creates one awaiting quotation and snapshot under concurrent request-token retries', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Direct Generation Customer' });
  const body = {
    quotationFirst: true, generateQuotation: true, clientRequestId: `direct-generate:${new mongoose.Types.ObjectId()}`,
    customerId: String(customer._id), customerName: customer.name,
    quotationDetails: { attentionName: '', attentionPosition: '', authorizedSignatoryName: 'Direct Signatory' },
    items: [{ itemId: randomUUID(), itemName: 'Direct custom item', sellingUnit: 'piece', quantity: 100, sellingPrice: 1.25 }, { itemId: randomUUID(), itemName: 'Another line', sellingUnit: 'box', quantity: 10, sellingPrice: 2 }],
  };
  const photoCounts = { [body.items[0].itemId]: 3, [body.items[1].itemId]: 1 };
  const results = await Promise.all(Array.from({ length: 3 }, () => api('/special-orders', { method: 'POST', form: directQuotationForm(body, photoCounts) })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 201]);
  assert.equal(new Set(results.map((result) => result.body._id)).size, 1);
  assert.equal(new Set(results.map((result) => result.body.quotation._id)).size, 1);
  assert.equal(new Set(results.map((result) => result.body.quotation.issuedAt)).size, 1);
  const order = await SpecialOrder.findById(results[0].body._id);
  const quotation = await Quotation.findOne({ specialOrder: order._id });
  assert.equal(quotation.quotationNumber, `${order.orderNumber}-Q1`);
  assert.equal(quotation.documentSnapshot.specialOrderNumber, order.orderNumber);
  assert.equal(order.status, 'Pending');
  assert.equal(order.transactionQuotation, null);
  assert.equal(String(order.currentQuotation), String(quotation._id));
  assert.equal(quotation.status, 'Awaiting Decision');
  assert.equal(quotation.total, 145);
  assert.deepEqual(quotation.items.map((item) => item.itemId), body.items.map((item) => item.itemId));
  assert.deepEqual(quotation.items.map((item) => item.images.length), [3, 1]);
  assert.deepEqual(quotation.documentSnapshot.items.map((item) => item.images.length), [3, 1]);
  assert.equal(new Set(quotation.items.flatMap((item) => item.images.map((image) => image.key))).size, 4);
  const imageRoute = `/special-orders/${order._id}/quotations/${quotation._id}/items/${body.items[0].itemId}/images/${quotation.items[0].images[0].key}`;
  const imageResponse = await fetch(`${baseUrl}/api${imageRoute}`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET)}` } });
  assert.equal(imageResponse.status, 200);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), tinyPng);
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quotation._id}/items/${body.items[1].itemId}/images/${quotation.items[0].images[0].key}`)).status, 404);
  assert.equal(quotation.documentSnapshot.quotationDetails.attentionName, '');
  assert.equal(quotation.documentSnapshot.quotationDetails.attentionPosition, '');
  assert.equal(quotation.documentSnapshot.quotationDetails.authorizedSignatoryName, 'Direct Signatory');
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: body.clientRequestId }), 1);
  assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 1);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal(await ActivityLog.countDocuments({ action: 'Issued Special Order Quotation', details: { $regex: quotation.quotationNumber } }), 1);
  assert.equal((await api('/special-orders', { method: 'POST', body, user: other })).status, 403);
  const before = quotation.toObject();
  assert.equal((await api('/special-orders', { method: 'POST', form: directQuotationForm(body) })).status, 200);
  assert.deepEqual((await Quotation.findById(quotation._id)).toObject(), before);
});

test('invalid or failed direct generation rolls back parent, quotation and logs, and legacy drafts remain recoverable', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Direct Rollback Customer' });
  const body = {
    quotationFirst: true, generateQuotation: true, clientRequestId: `direct-rollback:${new mongoose.Types.ObjectId()}`,
    customerId: String(customer._id), customerName: customer.name,
    quotationDetails: { authorizedSignatoryName: '' }, items: [{ itemId: randomUUID(), itemName: 'Rollback item', sellingUnit: 'piece', quantity: 1, sellingPrice: 1 }],
  };
  const before = { orders: await SpecialOrder.countDocuments(), quotes: await Quotation.countDocuments(), logs: await ActivityLog.countDocuments(), sales: await Sale.countDocuments() };
  const beforeImages = storedImages.size;
  assert.equal((await api('/special-orders', { method: 'POST', form: directQuotationForm(body) })).status, 400);
  body.quotationDetails.authorizedSignatoryName = 'Retry Signatory';
  const originalUpdate = Quotation.findOneAndUpdate;
  Quotation.findOneAndUpdate = () => { throw new Error('Injected direct issuance failure'); };
  try { assert.equal((await api('/special-orders', { method: 'POST', form: directQuotationForm(body) })).status, 500); }
  finally { Quotation.findOneAndUpdate = originalUpdate; }
  assert.deepEqual({ orders: await SpecialOrder.countDocuments(), quotes: await Quotation.countDocuments(), logs: await ActivityLog.countDocuments(), sales: await Sale.countDocuments() }, before);
  assert.equal(storedImages.size, beforeImages);
  const company = await Setting.findOne({ singletonKey: 'default' }).lean();
  await Setting.updateOne({ _id: company._id }, { $set: { storeName: '' } });
  try { assert.equal((await api('/special-orders', { method: 'POST', form: directQuotationForm(body) })).status, 400); }
  finally { await Setting.updateOne({ _id: company._id }, { $set: { storeName: company.storeName } }); }
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: body.clientRequestId }), 0);
  assert.equal((await api('/special-orders', { method: 'POST', form: directQuotationForm(body) })).status, 201);
  const legacyBody = { ...body, generateQuotation: false, clientRequestId: `legacy-draft:${new mongoose.Types.ObjectId()}` };
  const legacy = await api('/special-orders', { method: 'POST', body: legacyBody });
  const draft = await Quotation.findOne({ specialOrder: legacy.body._id }).lean();
  assert.equal(draft.status, 'Draft');
  assert.equal((await api('/special-orders', { method: 'POST', body: { ...legacyBody, generateQuotation: true } })).status, 409);
  assert.deepEqual(await Quotation.findById(draft._id).lean(), draft);
  const legacyPhoto = new FormData();
  legacyPhoto.append('images', photoBlob(), 'product.png');
  assert.equal((await api(`/special-orders/${legacy.body._id}/quotations/${draft._id}/items/${draft.items[0].itemId}/images`, { method: 'POST', form: legacyPhoto })).status, 201);
  await issue(legacy.body, draft);
  assert.equal((await Quotation.findById(draft._id)).status, 'Awaiting Decision');
});

test('direct quotation creation allows optional photos and rejects excess, corrupt, and unassociated uploads', async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Image Validation Customer' });
  const body = { quotationFirst: true, generateQuotation: true, clientRequestId: `optional-photo:${new mongoose.Types.ObjectId()}`, customerId: String(customer._id), customerName: customer.name,
    quotationDetails: { authorizedSignatoryName: 'Signer' }, items: [{ itemId: randomUUID(), itemName: 'Product', sellingUnit: 'piece', quantity: 1, sellingPrice: 10 }] };
  const itemId = body.items[0].itemId;
  const beforeImages = storedImages.size;
  const withoutPhotos = await api('/special-orders', { method: 'POST', form: directQuotationForm(body, { [itemId]: 0 }) });
  assert.equal(withoutPhotos.status, 201, JSON.stringify(withoutPhotos));
  assert.deepEqual(withoutPhotos.body.quotation.items[0].images, []);
  assert.ok(withoutPhotos.body.quotation.documentSnapshot, 'quotation generation succeeds without product photos');

  const withRequestId = (suffix) => ({ ...body, clientRequestId: `optional-photo:${suffix}:${new mongoose.Types.ObjectId()}` });
  const requests = [directQuotationForm(withRequestId('excess'), { [itemId]: 4 })];
  const corrupt = directQuotationForm(withRequestId('corrupt'), { [itemId]: 0 });
  corrupt.append(`itemImages:${itemId}`, new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  requests.push(corrupt);
  const unassociated = directQuotationForm(withRequestId('unassociated'), { [itemId]: 0 });
  unassociated.append(`itemImages:${randomUUID()}`, photoBlob(), 'unassociated.png');
  requests.push(unassociated);
  for (const form of requests) assert.equal((await api('/special-orders', { method: 'POST', form })).status, 400);
  assert.equal(await SpecialOrder.countDocuments({ customer: customer._id }), 1, 'invalid uploads do not create additional orders');
  assert.equal(storedImages.size, beforeImages);
});

test('quotation creation snapshots selected Product Master images into independent immutable assets', async () => {
  const { product, body } = await phaseOneFixture();
  const productImage = `data:image/png;base64,${tinyPng.toString('base64')}`;
  await Product.updateOne({ _id: product._id }, { $set: { imageUrl: productImage } });
  const itemId = randomUUID();
  const item = { ...body.items[0], itemId, photoSelections: [{ type: 'product', imageIndex: 0 }] };
  const requestBody = { ...body, clientRequestId: `product-image-reference:${new mongoose.Types.ObjectId()}`, items: [item] };
  const beforeStoredImages = storedImages.size;
  const result = await api('/special-orders', { method: 'POST', form: directQuotationForm(requestBody, { [itemId]: 0 }) });

  assert.equal(result.status, 201, JSON.stringify(result));
  const savedImage = result.body.quotation.items[0].images[0];
  assert.ok(savedImage.key);
  assert.equal(savedImage.sourceProductId, null, 'the saved quotation uses its independent image snapshot, not a live product reference');
  assert.equal(savedImage.sourceImageIndex, null);
  assert.equal(result.body.quotation.documentSnapshot.items[0].images[0].key, savedImage.key);
  assert.equal(storedImages.size, beforeStoredImages + 1, 'the quotation stores an independent image snapshot');
  assert.equal((await Product.findById(product._id)).imageUrl, productImage, 'quotation image handling leaves the Product Master image unchanged');
  assert.deepEqual(storedImages.get(`special-order-quotation-images/${savedImage.key}`), tinyPng);

  const imageRoute = `/special-orders/${result.body._id}/quotations/${result.body.quotation._id}/items/${itemId}/images/${encodeURIComponent(savedImage.key)}`;
  const response = await fetch(`${baseUrl}/api${imageRoute}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET)}` },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/png/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), tinyPng);
  await Product.updateOne({ _id: product._id }, { $set: { imageUrl: '' } });
  const afterProductImageRemoval = await fetch(`${baseUrl}/api${imageRoute}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET)}` },
  });
  assert.equal(afterProductImageRemoval.status, 200);
  assert.deepEqual(Buffer.from(await afterProductImageRemoval.arrayBuffer()), tinyPng, 'a later Product Master image change does not affect the saved quotation snapshot');

  const multipleImageData = `data:image/png;base64,${tinyPng.toString('base64')}`;
  await Product.collection.updateOne({ _id: product._id }, { $set: { images: [multipleImageData, multipleImageData] } });
  const multipleItemId = randomUUID();
  const multipleRequest = { ...body, clientRequestId: `multiple-product-image-references:${new mongoose.Types.ObjectId()}`, items: [{
    ...body.items[0], itemId: multipleItemId, photoSelections: [{ type: 'product', imageIndex: 0 }, { type: 'product', imageIndex: 1 }],
  }] };
  const beforeMultipleSnapshots = storedImages.size;
  const multiple = await api('/special-orders', { method: 'POST', form: directQuotationForm(multipleRequest, { [multipleItemId]: 0 }) });
  assert.equal(multiple.status, 201, JSON.stringify(multiple));
  assert.equal(storedImages.size, beforeMultipleSnapshots + 2);
  assert.equal(new Set(multiple.body.quotation.items[0].images.map((image) => image.key)).size, 2);
  assert.ok(multiple.body.quotation.items[0].images.every((image) => image.sourceProductId === null && image.sourceImageIndex === null));

  await Product.updateOne({ _id: product._id }, { $set: { imageUrl: productImage } });
  const removedItemId = randomUUID();
  const removedRequest = { ...body, clientRequestId: `product-image-removed:${new mongoose.Types.ObjectId()}`, items: [{ ...body.items[0], itemId: removedItemId, photoSelections: [] }] };
  const removed = await api('/special-orders', { method: 'POST', form: directQuotationForm(removedRequest, { [removedItemId]: 0 }) });
  assert.equal(removed.status, 201, JSON.stringify(removed));
  assert.deepEqual(removed.body.quotation.items[0].images, [], 'an omitted reference is not forced back into the quotation');
  assert.equal((await Product.findById(product._id)).imageUrl, productImage, 'removing the selected quotation image does not remove the Product Master image');
});

test('quotation creation rejects missing Product Master image references without creating an order', async () => {
  const { product, body } = await phaseOneFixture();
  const itemId = randomUUID();
  const invalidSelection = { ...body.items[0], itemId, photoSelections: [{ type: 'product', imageIndex: 0 }] };
  const requestBody = { ...body, clientRequestId: `missing-product-image:${new mongoose.Types.ObjectId()}`, items: [invalidSelection] };
  const result = await api('/special-orders', { method: 'POST', form: directQuotationForm(requestBody, { [itemId]: 0 }) });
  assert.equal(result.status, 409);
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: requestBody.clientRequestId }), 0);
  assert.equal((await Product.findById(product._id)).imageUrl, '');
});

test('removing a draft photo never deletes an older issued version that shares it', async () => {
  const order = await orderFixture();
  const original = await prepare(order);
  await issue(order, original);
  const revised = await api(`/special-orders/${order._id}/quotations/${original._id}/revise`, { method: 'POST' });
  assert.equal(revised.status, 201);
  const itemId = revised.body.items[0].itemId;
  const key = revised.body.items[0].images[0].key;
  const removed = await api(`/special-orders/${order._id}/quotations/${revised.body._id}/items/${itemId}/images/${key}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.items[0].images.length, 0);
  assert.ok(storedImages.has(`special-order-quotation-images/${key}`));
  const historic = await fetch(`${baseUrl}/api/special-orders/${order._id}/quotations/${original._id}/items/${itemId}/images/${key}`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET)}` } });
  assert.equal(historic.status, 200);
  assert.deepEqual(Buffer.from(await historic.arrayBuffer()), tinyPng);
  assert.equal((await api(`/special-orders/${order._id}/quotations/${revised.body._id}/issue`, { method: 'POST' })).status, 400);
});

test('replacing one draft photo preserves its position and does not exceed the three-photo limit', async () => {
  const order = await orderFixture();
  const quotation = await prepare(order);
  const itemId = quotation.items[0].itemId;
  const oldKey = quotation.items[0].images[0].key;
  const form = new FormData();
  form.append('replaceKey', oldKey);
  form.append('images', photoBlob(), 'replacement.png');
  const result = await api(`/special-orders/${order._id}/quotations/${quotation._id}/items/${itemId}/images`, { method: 'POST', form });
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.body.items[0].images.length, 1);
  assert.notEqual(result.body.items[0].images[0].key, oldKey);
  assert.equal(storedImages.has(`special-order-quotation-images/${oldKey}`), false);
  const missing = new FormData();
  missing.append('replaceKey', oldKey);
  missing.append('images', photoBlob(), 'retry.png');
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quotation._id}/items/${itemId}/images`, { method: 'POST', form: missing })).status, 400);
  assert.equal((await Quotation.findById(quotation._id)).items[0].images.length, 1);
});

test('discarding an unissued draft item cleans up only its unreferenced photos', async () => {
  const order = await orderFixture();
  const quotation = await prepare(order);
  const key = quotation.items[0].images[0].key;
  const revised = await api(`/special-orders/${order._id}/quotations/${quotation._id}`, { method: 'PATCH', body: {
    quotationDetails: quotation.quotationDetails,
    items: [{ itemId: randomUUID(), itemName: 'New item', sellingUnit: 'piece', quantity: 1, unitPrice: 1 }],
  } });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.items[0].images.length, 0);
  assert.equal(storedImages.has(`special-order-quotation-images/${key}`), false);
});

test('identical final decision retries preserve the original actor/time and produce one atomic transition', async () => {
  for (const decision of ['Accepted', 'Declined']) {
    const order = await orderFixture();
    const quote = await prepare(order);
    await issue(order, quote);
    const route = `/special-orders/${order._id}/quotations/${quote._id}/decision`;
    const results = await Promise.all(Array.from({ length: 3 }, () => api(route, { method: 'POST', body: { decision, reason: 'Confirmed customer reason' } })));
    assert.deepEqual(results.map((result) => result.status), [200, 200, 200]);
    assert.equal(new Set(results.map((result) => result.body.decidedAt)).size, 1);
    const stored = await SpecialOrder.findById(order._id).lean();
    const before = await Quotation.findById(quote._id).lean();
    const replay = await api(route, { user: admin, method: 'POST', body: { decision, reason: 'Do not overwrite original reason' } });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.decidedBy, String(owner._id));
    assert.equal(stored.status, decision === 'Accepted' ? 'In Progress' : 'Cancelled');
    assert.equal(stored.statusHistory.filter((entry) => entry.status === stored.status).length, 1);
    if (decision === 'Declined') assert.equal(stored.cancelledReason, 'Confirmed customer reason');
    assert.equal(await ActivityLog.countDocuments({ action: 'Recorded Special Order Quotation Decision', details: { $regex: quote.quotationNumber } }), 1);
    assert.equal((await api(route, { method: 'POST', body: { decision: decision === 'Accepted' ? 'Declined' : 'Accepted' } })).status, 409);
    for (const [action, method, body] of [['', 'PATCH', { items: quote.items }], ['/revise', 'POST'], ['/issue', 'POST']]) {
      assert.ok([400, 409].includes((await api(`/special-orders/${order._id}/quotations/${quote._id}${action}`, { method, body })).status));
    }
    assert.deepEqual(await Quotation.findById(quote._id).lean(), before);
    // Serialized retry locks may update __v/updatedAt, never historical audit or evidence.
    const after = await SpecialOrder.findById(order._id).lean();
    assert.deepEqual(after.statusHistory, stored.statusHistory);
    assert.equal(after.cancelledReason, stored.cancelledReason);
    assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
    if (decision === 'Declined') assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote) })).status, 400);
  }
});

test('decision versus awaiting-decision revision serializes to one eligible current version', async () => {
  for (let index = 0; index < 3; index += 1) {
    const order = await orderFixture();
    const quote = await prepare(order);
    await issue(order, quote);
    const [decided, revised] = await Promise.all([
      api(`/special-orders/${order._id}/quotations/${quote._id}/decision`, { method: 'POST', body: { decision: 'Accepted' } }),
      api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' }),
    ]);
    if (decided.status === 200) {
      assert.equal(revised.status, 409);
      assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
      assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 1);
    } else {
      assert.equal(decided.status, 409);
      assert.equal(revised.status, 201);
      assert.equal((await SpecialOrder.findById(order._id)).status, 'Pending');
      assert.equal(revised.body.decision, '');
    }
    assert.equal(await Quotation.countDocuments({ specialOrder: order._id, isCurrent: true }), 1);
    assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  }
});

test('decision failure rolls back quote, parent activation/cancellation and decision audit', async () => {
  for (const decision of ['Accepted', 'Declined']) {
    const order = await orderFixture();
    const quote = await prepare(order);
    await issue(order, quote);
    const originalSave = SpecialOrder.prototype.save;
    SpecialOrder.prototype.save = function (...args) {
      if (String(this._id) === String(order._id)) throw new Error('Injected decision transition failure');
      return originalSave.apply(this, args);
    };
    try { assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/decision`, { method: 'POST', body: { decision } })).status, 500); }
    finally { SpecialOrder.prototype.save = originalSave; }
    const stored = await Quotation.findById(quote._id);
    assert.equal(stored.status, 'Awaiting Decision');
    assert.equal(stored.decidedAt, null);
    assert.equal((await SpecialOrder.findById(order._id)).transactionQuotation, null);
    assert.equal(await ActivityLog.countDocuments({ action: 'Recorded Special Order Quotation Decision', details: { $regex: quote.quotationNumber } }), 0);
  }
});

test('linked completed image access permits the owning cashier after admin finalization, denies others and handles missing files', async () => {
  const order = await orderFixture();
  const quote = await prepare(order);
  await accept(order, quote);
  const result = await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(quote, { reference: '', image: true }) });
  assert.equal(result.status, 201);
  const sale = await Sale.findOne({ specialOrderId: order._id }).lean();
  const route = `${baseUrl}/api/sales/${sale._id}/supporting-document`;
  const before = await SpecialOrder.findById(order._id).lean();
  for (const user of [owner, admin, superadmin]) {
    const response = await fetch(route, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET)}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), storedImages.get(`${documents.PREFIX}${sale.transactionReference.supportingDocument.key}`));
  }
  assert.equal((await fetch(route, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(other._id) }, process.env.JWT_SECRET)}` } })).status, 403);
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await api(`/special-orders/${order._id}/receipt`, { user: other })).status, 403);
  storedImages.delete(`${documents.PREFIX}${sale.transactionReference.supportingDocument.key}`);
  assert.equal((await fetch(route, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET)}` } })).status, 404);
  assert.deepEqual(await SpecialOrder.findById(order._id).lean(), before);
  assert.deepEqual(await Sale.findById(sale._id).lean(), sale);
});

test('legacy declined requests remain historical and locked without automatic cancellation or a Start route', async () => {
  const order = await orderFixture();
  order.status = 'Pending'; await order.save();
  const quote = await prepare(order);
  await Quotation.updateOne({ _id: quote._id }, { $set: { status: 'Declined', decision: 'Declined', decidedAt: new Date('2026-01-01'), decidedBy: owner._id } });
  const quotationBefore = await Quotation.findById(quote._id).lean();
  const historyBefore = (await SpecialOrder.findById(order._id)).statusHistory.toObject();
  assert.equal((await api('/special-orders')).status, 200);
  assert.equal((await api(`/special-orders/${order._id}/quotations`)).status, 200);
  const replay = await api(`/special-orders/${order._id}/quotations/${quote._id}/decision`, { method: 'POST', body: { decision: 'Declined' } });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.order.status, 'Pending');
  assert.equal((await api(`/special-orders/${order._id}/quotations/${quote._id}/revise`, { method: 'POST' })).status, 409);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'Pending');
  assert.deepEqual((await SpecialOrder.findById(order._id)).statusHistory.toObject(), historyBefore);
  assert.deepEqual(await Quotation.findById(quote._id).lean(), quotationBefore);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await fetch(`${baseUrl}/api/special-orders/${order._id}/start-transaction`, { method: 'POST', headers: { Authorization: `Bearer ${jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET)}` } })).status, 404);
});

const phaseOneFixture = async () => {
  const customer = await Partner.create({ type: 'customer', name: 'Mixed Order Customer', taxTreatment: 'vat_zero_rated' });
  const product = await Product.create({ sku: `SO-P1-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`, name: 'Exact Inventory SKU', category: 'Hardware', brand: 'Recorded Brand', size: '1 L', sellingUnit: 'can', price: 125.25, stock: 12 });
  const body = {
    quotationFirst: true, generateQuotation: true, workflowVersion: 2, clientRequestId: `phase-one:${new mongoose.Types.ObjectId()}`,
    customerId: String(customer._id), customerName: customer.name, taxTreatment: 'vat_zero_rated',
    quotationDetails: { authorizedSignatoryName: 'Phase One Signatory' },
    fulfillment: { method: 'Store Pickup', preferredDate: '2026-12-01' },
    items: [
      { itemId: randomUUID(), itemType: 'inventory', inventoryProduct: String(product._id), sku: product.sku, itemName: 'Untrusted client name', sellingUnit: 'wrong unit', quantity: 2, sellingPrice: 125.25 },
      { itemId: randomUUID(), itemType: 'custom', itemName: 'Requested Custom Item', description: 'Custom specification', sellingUnit: 'piece', quantity: 3, sellingPrice: 10.1 },
    ],
  };
  return { customer, product, body };
};

test('Phase 1 mixed quotation requires and preserves the custom selling unit, SKU units, snapshots, photos and pickup', async () => {
  const { product, body } = await phaseOneFixture();
  const results = await Promise.all([1, 2].map(() => api('/special-orders', { method: 'POST', form: directQuotationForm(body) })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal((await api('/special-orders', { method: 'POST', form: directQuotationForm({ ...body, taxTreatment: 'standard' }) })).status, 409);
  const order = await SpecialOrder.findById(results[0].body._id);
  const quotation = await Quotation.findById(results[0].body.quotation._id);
  assert.equal(order.workflowVersion, 2);
  assert.equal(order.taxTreatment, 'vat_zero_rated');
  assert.equal(order.sellingPrice, 280.8);
  assert.equal(order.fulfillment.method, 'Store Pickup');
  assert.equal(quotation.status, 'Awaiting Decision');
  assert.equal(quotation.customerDetails.taxTreatment, 'vat_zero_rated');
  assert.equal(quotation.documentSnapshot.taxTreatment, 'vat_zero_rated');
  assert.equal(quotation.items[0].itemType, 'inventory');
  assert.equal(String(quotation.items[0].inventoryProduct), String(product._id));
  assert.equal(quotation.items[0].inventorySnapshot.sku, product.sku);
  assert.equal(quotation.items[0].itemName, product.name);
  assert.equal(quotation.items[0].sellingUnit, 'can');
  assert.equal(quotation.items[0].originalUnitPrice, 125.25);
  assert.equal(quotation.items[0].unitPrice, 125.25);
  assert.equal(quotation.items[1].itemType, 'custom');
  assert.equal(quotation.items[1].inventoryProduct, null);
  assert.equal(quotation.items[1].sellingUnit, 'piece');
  assert.equal(quotation.documentSnapshot.items[1].sellingUnit, 'piece');
  assert.deepEqual(quotation.items.map((item) => item.images.length), [1, 1]);
  assert.equal(quotation.total, 280.8);
  assert.equal(quotation.documentSnapshot.fulfillment.method, 'Store Pickup');
  assert.equal(quotation.documentSnapshot.items[0].originalUnitPrice, 125.25);
  assert.equal(Object.hasOwn(quotation.documentSnapshot, 'shippingFee'), false);
  assert.equal(quotation.documentSnapshot.items[0].inventorySnapshot.sku, product.sku);
  assert.equal((await Product.findById(product._id)).price, 125.25);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal(await Quotation.countDocuments({ specialOrder: order._id }), 1);

  const withSellingUnit = await api('/special-orders', {
    method: 'POST',
    form: directQuotationForm({
      ...body,
      clientRequestId: `phase-one-custom-unit:${new mongoose.Types.ObjectId()}`,
      items: body.items.map((item) => ({ ...item, itemId: randomUUID(), ...(item.itemType === 'custom' ? { sellingUnit: 'piece' } : {}) })),
    }),
  });
  assert.equal(withSellingUnit.status, 201, JSON.stringify(withSellingUnit));
  assert.equal(withSellingUnit.body.quotation.items[1].sellingUnit, 'piece');
  assert.equal(withSellingUnit.body.quotation.documentSnapshot.items[1].sellingUnit, 'piece');
});

test('Phase 1 rejects SKU mismatch, inactive product, unauthorized override, missing reason and invalid Laguna delivery before creation', async () => {
  const { product, body } = await phaseOneFixture();
  const request = (changes, user = owner) => api('/special-orders', { user, method: 'POST', form: directQuotationForm({ ...body, ...changes, clientRequestId: `phase-one-invalid:${new mongoose.Types.ObjectId()}` }) });
  assert.equal((await request({ taxTreatment: '' })).status, 400);
  assert.equal((await request({ taxTreatment: 'exempt' })).status, 400);
  const exemptCustomer = await Partner.create({ type: 'customer', name: 'Exempt Customer', taxTreatment: 'exempt', isVatExempt: true });
  assert.equal((await request({ customerId: String(exemptCustomer._id), customerName: exemptCustomer.name, taxTreatment: 'standard' })).status, 400);
  assert.equal((await request({ items: [{ ...body.items[0], sku: 'OTHER-SKU' }, body.items[1]] })).status, 400);
  assert.equal((await request({ items: [body.items[0], { ...body.items[1], sellingUnit: '' }] })).status, 400,
    'new custom quotation items must include a selling unit');
  assert.equal((await request({ items: [{ ...body.items[0], sellingPrice: 120 }, body.items[1]] })).status, 403);
  assert.equal((await request({ items: [{ ...body.items[0], sellingPrice: 120 }, body.items[1]] }, admin)).status, 400);
  assert.equal((await request({ fulfillment: { method: 'Free Delivery', addressLine: '123 Main St', barangay: 'Biñan', cityMunicipality: 'Cabuyao', province: 'Cavite' } })).status, 400);
  const partialAddress = await api('/special-orders', { user: owner, method: 'POST', form: directQuotationForm({
    ...body,
    clientRequestId: `phase-one-partial-address:${new mongoose.Types.ObjectId()}`,
    fulfillment: { method: 'Free Delivery', cityMunicipality: 'Cabuyao' },
  }) });
  assert.equal(partialAddress.status, 201, JSON.stringify(partialAddress));
  assert.equal(partialAddress.body.fulfillment.cityMunicipality, 'City of Cabuyao');
  assert.equal(partialAddress.body.fulfillment.province, 'Laguna');
  assert.equal(partialAddress.body.fulfillment.addressLine, '');
  assert.equal(partialAddress.body.fulfillment.barangay, '');
  const blankAddress = await api('/special-orders', { user: owner, method: 'POST', form: directQuotationForm({
    ...body,
    clientRequestId: `phase-one-blank-address:${new mongoose.Types.ObjectId()}`,
    fulfillment: { method: 'Free Delivery' },
  }) });
  assert.equal(blankAddress.status, 201, JSON.stringify(blankAddress));
  assert.deepEqual(blankAddress.body.fulfillment, {
    method: 'Free Delivery', preferredDate: '', addressLine: '', barangay: '', cityMunicipality: '', province: 'Laguna',
  });
  const superOverride = await api('/special-orders', { user: superadmin, method: 'POST', form: directQuotationForm({ ...body, clientRequestId: `phase-one-superadmin:${new mongoose.Types.ObjectId()}`, items: [{ ...body.items[0], sellingPrice: 120, priceOverrideReason: 'Approved quote' }, body.items[1]] }) });
  assert.equal(superOverride.status, 201, JSON.stringify(superOverride));
  assert.equal(superOverride.body.quotation.items[0].priceOverrideBy, String(superadmin._id));
  await Product.updateOne({ _id: product._id }, { $set: { isActive: false } });
  assert.equal((await request({})).status, 400);
  assert.equal(await SpecialOrder.countDocuments({ clientRequestId: { $regex: /^phase-one-invalid:/ } }), 0);
  assert.equal((await Product.findById(product._id)).stock, 12);
});

test('Phase 1 admin override and Laguna delivery remain versioned; all new completion paths fail closed', async () => {
  const { product, body } = await phaseOneFixture();
  body.taxTreatment = 'standard';
  body.items[0].sellingPrice = 120;
  body.items[0].priceOverrideReason = 'Agreed special quote';
  body.fulfillment = { method: 'Free Delivery', addressLine: '123 Main St', barangay: 'Baclaran', cityMunicipality: 'Cabuyao', province: 'laguna' };
  const created = await api('/special-orders', { user: admin, method: 'POST', form: directQuotationForm(body) });
  assert.equal(created.status, 201, JSON.stringify(created));
  const order = created.body;
  const initial = created.body.quotation;
  assert.equal(initial.total, 270.3);
  assert.equal(initial.customerDetails.taxTreatment, 'standard');
  assert.equal(initial.documentSnapshot.taxTreatment, 'standard');
  assert.equal(initial.fulfillment.province, 'Laguna');
  const savedAddress = structuredClone(initial.fulfillment);
  assert.equal(initial.items[0].priceOverrideReason, 'Agreed special quote');
  assert.equal(initial.items[0].priceOverrideBy, String(admin._id));
  const revision = await api(`/special-orders/${order._id}/quotations/${initial._id}/revise`, { user: admin, method: 'POST' });
  assert.equal(revision.status, 201, JSON.stringify(revision));
  const unchangedAddress = await api(`/special-orders/${order._id}/quotations/${revision.body._id}`, { user: admin, method: 'PATCH', body: {
    items: revision.body.items.map((item) => ({ ...item, sku: item.inventorySnapshot?.sku || '', priceOverrideReason: item.itemType === 'inventory' ? 'Agreed special quote' : '' })),
    quotationDetails: revision.body.quotationDetails,
    fulfillment: revision.body.fulfillment,
    taxTreatment: revision.body.customerDetails.taxTreatment,
  } });
  assert.equal(unchangedAddress.status, 200, JSON.stringify(unchangedAddress));
  assert.deepEqual(unchangedAddress.body.fulfillment, savedAddress);
  await Product.updateOne({ _id: product._id }, { $set: { isActive: false, price: 150 } });
  const revisedItems = revision.body.items.map((item) => ({ ...item, sku: item.inventorySnapshot?.sku || '', priceOverrideReason: item.itemType === 'inventory' ? 'Unapproved rewrite' : '' }));
  const changed = await api(`/special-orders/${order._id}/quotations/${revision.body._id}`, { user: admin, method: 'PATCH', body: { items: revisedItems, quotationDetails: revision.body.quotationDetails, fulfillment: { method: 'Store Pickup' }, taxTreatment: 'vat_zero_rated' } });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.equal(changed.body.fulfillment.method, 'Store Pickup');
  assert.equal(changed.body.customerDetails.taxTreatment, 'vat_zero_rated');
  assert.equal(changed.body.items[0].inventorySnapshot.sku, product.sku);
  assert.equal(changed.body.items[0].originalUnitPrice, 125.25);
  assert.equal(changed.body.items[0].priceOverrideReason, 'Agreed special quote');
  const issued = await api(`/special-orders/${order._id}/quotations/${revision.body._id}/issue`, { user: admin, method: 'POST' });
  assert.equal(issued.status, 200, JSON.stringify(issued));
  assert.equal(issued.body.documentSnapshot.fulfillment.method, 'Store Pickup');
  assert.equal(issued.body.documentSnapshot.taxTreatment, 'vat_zero_rated');
  assert.equal((await SpecialOrder.findById(order._id)).taxTreatment, 'vat_zero_rated');
  assert.equal((await Quotation.findById(initial._id)).documentSnapshot.taxTreatment, 'standard');
  assert.equal((await Quotation.findById(initial._id)).documentSnapshot.fulfillment.method, 'Free Delivery');
  const accepted = await api(`/special-orders/${order._id}/quotations/${revision.body._id}/decision`, { user: admin, method: 'POST', body: { decision: 'Accepted' } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.order.status, 'In Progress');
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(revision.body) })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).price, 150);
});

const acceptedStockOrder = async (body) => {
  const created = await api('/special-orders', { method: 'POST', form: directQuotationForm(body) });
  assert.equal(created.status, 201, JSON.stringify(created));
  const decision = await api(`/special-orders/${created.body._id}/quotations/${created.body.quotation._id}/decision`, { method: 'POST', body: { decision: 'Accepted' } });
  assert.equal(decision.status, 200, JSON.stringify(decision));
  return created.body;
};
const stockRequest = (order, action, requestId, user = admin, reason = 'Customer cancelled the request') => api(
  `/special-orders/${order._id}/${action === 'Reserve' ? 'reservations' : action === 'Release' ? 'reservations/release' : 'cancel'}`,
  { user, method: 'POST', body: { requestId, reason } }
);

const downPaymentForm = ({ requestId = `phase4-payment:${randomUUID()}`, amount = '1.00', downPaymentPercentage = '50', paymentPlan = 'cash', termDays = '30', method = 'cash', otherMethod = '', reference = 'PAY-TEST', notes = '', chequeCleared = true, invoiceNumber = '', saleDocument = false, invalidSaleDocument = false, proofCount = 1, invalidProof = false } = {}) => {
  const form = new FormData();
  form.append('requestId', requestId);
  form.append('amount', amount);
  form.append('downPaymentPercentage', downPaymentPercentage);
  form.append('paymentPlan', paymentPlan);
  form.append('termDays', termDays);
  form.append('method', method);
  form.append('otherMethod', otherMethod);
  form.append('reference', reference);
  form.append('notes', notes);
  if (String(method).toLowerCase() === 'cheque' && chequeCleared) form.append('chequeCleared', 'true');
  if (invoiceNumber) form.append('invoiceNumber', invoiceNumber);
  for (let index = 0; index < proofCount; index += 1) form.append('proofs', invalidProof ? new Blob(['not an image'], { type: 'image/png' }) : photoBlob(), `payment-${index + 1}.png`);
  if (saleDocument) form.append('document', invalidSaleDocument ? new Blob(['not an image'], { type: 'image/png' }) : photoBlob(), 'sale-document.png');
  return form;
};
const downPayment = (order, values = {}, user = admin) => api(`/special-orders/${order._id}/payments/down-payment`, {
  user, method: 'POST', form: downPaymentForm({ ...values, amount: Object.hasOwn(values, 'amount') ? values.amount : halfOfQuotationTotal(order) }),
});
const additionalPayment = (order, values = {}, user = admin) => api(`/special-orders/${order._id}/payments`, { user, method: 'POST', form: downPaymentForm(values) });
const creditFinalPaymentForm = ({ amount, requestId = `special-order-credit-final:${randomUUID()}`, proofCount = 1 } = {}) => {
  const form = new FormData();
  form.append('amount', amount);
  form.append('method', 'cash');
  form.append('paymentDate', new Date().toISOString().slice(0, 10));
  form.append('extensionDays', '0');
  form.append('clientRequestId', requestId);
  for (let index = 0; index < proofCount; index += 1) form.append('proofs', photoBlob(), `credit-final-${index + 1}.png`);
  return form;
};
const sourceCustom = (order, itemId, quantity, requestId = `phase5a-source:${randomUUID()}`, user = admin) => api(
  `/special-orders/${order._id}/fulfillment/custom-sourcing`, { user, method: 'POST', body: { requestId, itemId, quantity } }
);
const availabilityFor = (order) => api(`/special-orders/${order._id}/stock-availability`);

const verifySpecialOrderPercentage = async (percentage) => {
    const expectedPaid = Math.round(28080 * percentage / 100);
    const expectedRemaining = 28080 - expectedPaid;
    const cashFixture = await phaseOneFixture();
    cashFixture.body.items[1].sellingUnit = 'piece';
    const cashOrder = await acceptedStockOrder(cashFixture.body);
    const cashRequestId = `special-order-cash-down:${percentage}:${randomUUID()}`;
    const cashDown = await downPayment(cashOrder, {
      requestId: cashRequestId, amount: (expectedPaid / 100).toFixed(2), downPaymentPercentage: String(percentage), paymentPlan: 'cash', proofCount: 0,
    });
    assert.equal(cashDown.status, 201, JSON.stringify(cashDown));
    assert.equal(cashDown.body.ledger.paymentPlan, 'cash');
    assert.equal(cashDown.body.ledger.downPaymentPercentage, percentage);
    assert.equal(cashDown.body.ledger.amountPaidCentavos, expectedPaid);
    assert.equal(cashDown.body.ledger.remainingBalanceCentavos, expectedRemaining);
    assert.equal(cashDown.body.ledger.status, expectedRemaining ? 'Partially Paid' : 'Fully Paid');
    assert.equal(await Sale.countDocuments({ specialOrderId: cashOrder._id }), 0);
    if (expectedRemaining) {
      assert.equal((await additionalPayment(cashOrder, { amount: (Math.round(expectedRemaining / 2) / 100).toFixed(2), proofCount: 0 })).status, 400,
        'Cash cannot be split into additional partial payments');
      const cashFinal = await additionalPayment(cashOrder, { amount: (expectedRemaining / 100).toFixed(2), proofCount: 0 });
      assert.equal(cashFinal.status, 201, JSON.stringify(cashFinal));
      assert.equal(cashFinal.body.ledger.status, 'Fully Paid');
      assert.equal(cashFinal.body.ledger.payments.length, 2);
    }
    assert.equal(await Sale.countDocuments({ specialOrderId: cashOrder._id }), 0);

    const creditFixture = await phaseOneFixture();
    creditFixture.body.items[1].sellingUnit = 'piece';
    const creditOrder = await acceptedStockOrder(creditFixture.body);
    const creditRequestId = `special-order-credit-down:${percentage}:${randomUUID()}`;
    const creditDown = await downPayment(creditOrder, {
      requestId: creditRequestId, amount: (expectedPaid / 100).toFixed(2), downPaymentPercentage: String(percentage),
      paymentPlan: 'credit', termDays: '30', proofCount: 1,
    });
    assert.equal(creditDown.status, 201, JSON.stringify(creditDown));
    assert.equal(creditDown.body.ledger.paymentPlan, 'credit');
    assert.equal(creditDown.body.ledger.downPaymentPercentage, percentage);
    assert.ok(creditDown.body.ledger.creditTransactionId);

    const sale = await Sale.findOne({ specialOrderId: creditOrder._id });
    const credit = await CreditTransaction.findOne({ orderId: sale._id });
    const creditLedger = await PaymentLedger.findOne({ specialOrder: creditOrder._id });
    assert.ok(sale);
    assert.ok(credit);
    assert.equal(sale.collectionSource, 'special_order_ledger');
    assert.equal(sale.paymentStatus, expectedRemaining ? 'Partially Paid' : 'Paid');
    assert.equal(credit.amountPaid, expectedPaid / 100);
    assert.equal(credit.remainingBalance, expectedRemaining / 100);
    assert.equal(credit.termDays, 30);
    assert.equal(credit.dueDate.toISOString(), addManilaCalendarDays(startOfManilaCalendarDay(credit.paymentHistory[0].recordedAt), 30).toISOString());
    assert.equal(credit.status, expectedRemaining ? 'Partially Paid' : 'Paid');
    assert.equal(credit.paymentHistory.length, 1);
    assert.equal(String(credit._id), String(creditLedger.creditTransaction));
    assert.equal(credit.creditTransactionId, creditDown.body.ledger.creditTransactionId);
    assert.equal(await CreditTransaction.countDocuments({ orderId: sale._id }), 1);

    const replay = await downPayment(creditOrder, {
      requestId: creditRequestId, amount: (expectedPaid / 100).toFixed(2), downPaymentPercentage: String(percentage),
      paymentPlan: 'credit', termDays: '30', proofCount: 0,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(await CreditTransaction.countDocuments({ orderId: sale._id }), 1, 'retry does not duplicate the linked Credit Transaction');

    if (expectedRemaining) {
      assert.equal((await additionalPayment(creditOrder, { amount: (expectedRemaining / 100).toFixed(2), proofCount: 0 })).status, 409,
        'Credit balance cannot be settled from Special Orders');
      const partialForm = new FormData();
      partialForm.append('amount', '1.00');
      partialForm.append('method', 'cash');
      partialForm.append('paymentDate', new Date().toISOString().slice(0, 10));
      partialForm.append('clientRequestId', `special-order-credit-partial:${randomUUID()}`);
      partialForm.append('proofs', photoBlob(), 'partial.png');
      assert.equal((await api(`/credit-transactions/${credit._id}/payments`, { user: admin, method: 'POST', form: partialForm })).status, 409,
        'the linked CreditTransaction cannot accept installment payments');

      const finalRequestId = `special-order-credit-final:${randomUUID()}`;
      const finalPayment = await api(`/credit-transactions/${credit._id}/mark-paid`, {
        user: admin, method: 'PATCH', form: creditFinalPaymentForm({ amount: (expectedRemaining / 100).toFixed(2), requestId: finalRequestId }),
      });
      assert.equal(finalPayment.status, 200, JSON.stringify(finalPayment));
      const settledCredit = await CreditTransaction.findById(credit._id);
      const settledSale = await Sale.findById(sale._id);
      const settledLedger = await PaymentLedger.findOne({ specialOrder: creditOrder._id });
      assert.equal(settledCredit.status, 'Paid');
      assert.equal(settledCredit.remainingBalance, 0);
      assert.equal(settledSale.paymentStatus, 'Paid');
      assert.equal(settledLedger.status, 'Fully Paid');
      assert.equal(settledLedger.remainingBalanceCentavos, 0);
      assert.equal(settledLedger.payments.length, 2);
      assert.equal(settledLedger.payments[1].type, 'final_payment');
      await api(`/credit-transactions/${credit._id}/mark-paid`, {
        user: admin, method: 'PATCH', form: creditFinalPaymentForm({ amount: (expectedRemaining / 100).toFixed(2), requestId: finalRequestId }),
      });
      assert.equal((await PaymentLedger.findOne({ specialOrder: creditOrder._id })).payments.length, 2,
        'retry of the final settlement does not duplicate the Special Order payment event');
    }
};

for (const percentage of [30, 50, 70, 100]) {
  test(`Cash and Credit Special Orders support an agreed ${percentage}% down payment and two-stage settlement`, async () => {
    await verifySpecialOrderPercentage(percentage);
  });
}

test('Special Order down-payment percentage rejects invalid ranges, precision, and mismatched amounts', async () => {
  const invalidFixture = await phaseOneFixture();
  const invalidOrder = await acceptedStockOrder(invalidFixture.body);
  for (const downPaymentPercentage of ['', '0', '-1', '100.01', '1.001']) {
    assert.equal((await downPayment(invalidOrder, { amount: '140.40', downPaymentPercentage, proofCount: 0 })).status, 400,
      `reject invalid down-payment percentage ${downPaymentPercentage}`);
  }
  assert.equal((await downPayment(invalidOrder, { amount: '140.40', downPaymentPercentage: '30', proofCount: 0 })).status, 400,
    'amount must match the selected percentage');
  assert.equal(await PaymentLedger.countDocuments({ specialOrder: invalidOrder._id }), 0);
});

test('Phase 4 requires current acceptance, valid amount and reference, and rejects another cashier', async () => {
  const { product, body } = await phaseOneFixture();
  const created = await api('/special-orders', { method: 'POST', form: directQuotationForm(body) });
  assert.equal(created.status, 201);
  const order = created.body;
  assert.equal((await downPayment(order)).status, 409);
  assert.equal((await api(`/special-orders/${order._id}/quotations/${order.quotation._id}/decision`, { method: 'POST', body: { decision: 'Accepted' } })).status, 200);
  for (const amount of ['0', '0.00', '-1', '1.001', 'abc', '280.80', '280.81', '999999999999999999']) {
    assert.equal((await downPayment(order, { amount })).status, 400, amount);
  }
  for (const reference of ['', '   ']) {
    const missing = await downPayment(order, { method: 'gcash', reference, proofCount: 0 });
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /payment reference/i);
  }
  assert.equal((await downPayment(order, { proofCount: 3, invalidProof: true })).status, 400);
  assert.equal((await downPayment(order, { method: 'crypto' })).status, 400);
  assert.equal((await downPayment(order, { method: 'Other' })).status, 400);
  assert.equal((await downPayment(order, {}, other)).status, 403);
  assert.equal(await PaymentLedger.countDocuments({ specialOrder: order._id }), 0);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
});

test('Phase 4 rejects declined, superseded, cancelled and extra-proof submissions without a ledger', async () => {
  const { body } = await phaseOneFixture();
  const declined = await api('/special-orders', { method: 'POST', form: directQuotationForm(body) });
  assert.equal(declined.status, 201);
  assert.equal((await api(`/special-orders/${declined.body._id}/quotations/${declined.body.quotation._id}/decision`, { method: 'POST', body: { decision: 'Declined' } })).status, 200);
  assert.equal((await downPayment(declined.body)).status, 409);
  const revisedBody = { ...body, clientRequestId: `phase4-revision:${randomUUID()}`, items: body.items.map((item) => ({ ...item, itemId: randomUUID() })) };
  const revised = await api('/special-orders', { method: 'POST', form: directQuotationForm(revisedBody) });
  assert.equal(revised.status, 201);
  assert.equal((await api(`/special-orders/${revised.body._id}/quotations/${revised.body.quotation._id}/revise`, { method: 'POST' })).status, 201);
  assert.equal((await downPayment(revised.body)).status, 409);
  const acceptedBody = { ...body, clientRequestId: `phase4-many-proofs:${randomUUID()}`, items: body.items.map((item) => ({ ...item, itemId: randomUUID() })) };
  const accepted = await acceptedStockOrder(acceptedBody);
  assert.equal((await downPayment(accepted, { proofCount: 4 })).status, 400);
  assert.equal(await PaymentLedger.countDocuments({ specialOrder: { $in: [declined.body._id, revised.body._id, accepted._id] } }), 0);
});

test('Phase 4 payment records immutable approved total, proofs, balances and automatic full reservation exactly once', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const requestId = `phase4-full:${randomUUID()}`;
  const paid = await downPayment(order, { requestId, method: 'GCash', reference: 'GC-123', proofCount: 3 });
  assert.equal(paid.status, 201, JSON.stringify(paid));
  assert.equal(paid.body.ledger.approvedTotalCentavos, 28080);
  assert.equal(paid.body.ledger.downPaymentPercentage, 50);
  assert.equal(paid.body.ledger.amountPaidCentavos, 14040);
  assert.equal(paid.body.ledger.remainingBalanceCentavos, 14040);
  assert.equal(paid.body.ledger.status, 'Partially Paid');
  assert.equal(paid.body.ledger.payments[0].type, 'down_payment');
  assert.equal(paid.body.ledger.payments[0].method, 'gcash');
  assert.equal(paid.body.ledger.payments[0].reference, 'GC-123');
  assert.equal(paid.body.ledger.payments[0].proofs.length, 3);
  assert.equal(paid.body.ledger.reservationAtPayment[0].reservedQuantity, 2);
  assert.equal(paid.body.ledger.reservationAtPayment[0].shortageQuantity, 0);
  assert.equal(paid.body.availability.items[0].allocatedToOrder, 2);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);
  assert.equal((await downPayment(order, { requestId, proofCount: 0 })).body.replayed, true);
  assert.equal((await downPayment(order, { requestId: `phase4-other:${randomUUID()}` })).status, 409);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, 1);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id })).history.length, 1);
  assert.equal((await stockRequest(order, 'Release', `phase4-release:${randomUUID()}`)).status, 409);
  assert.equal((await stockRequest(order, 'Cancel', `phase4-cancel:${randomUUID()}`)).status, 409);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })).status, 409);
});

test('Special Order reference-only down payment and later payments retain balances, replay protection, and optional proof viewing', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const initialId = `reference-only-down:${randomUUID()}`;
  const initial = await downPayment(order, { requestId: initialId, method: 'gcash', reference: '  GC-001  ', proofCount: 0 });
  assert.equal(initial.status, 201, JSON.stringify(initial));
  assert.equal(initial.body.ledger.payments[0].reference, 'GC-001');
  assert.deepEqual(initial.body.ledger.payments[0].proofs, []);
  assert.equal((await downPayment(order, { requestId: initialId, proofCount: 0 })).body.replayed, true);
  for (const reference of ['', '   ']) {
    const missing = await additionalPayment(order, { amount: '140.40', method: 'gcash', reference, proofCount: 0 });
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /payment reference/i);
  }
  const finalRequest = { requestId: `reference-only-final:${randomUUID()}`, amount: '140.40', method: 'cheque', reference: 'CH-003', proofCount: 0 };
  const final = await additionalPayment(order, finalRequest);
  assert.equal(final.status, 201, JSON.stringify(final));
  assert.equal(final.body.ledger.status, 'Fully Paid');
  assert.equal(final.body.ledger.amountPaidCentavos, 28080);
  assert.equal(final.body.ledger.remainingBalanceCentavos, 0);
  assert.deepEqual(final.body.ledger.payments.map((payment) => payment.proofs.length), [0, 0]);
  const history = await api(`/special-orders/${order._id}/payments`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.ledger.payments.map((payment) => payment.reference), ['GC-001', 'CH-003']);
  assert.equal((await api(`/special-orders/${order._id}/payments/${initialId}/proofs/0`)).status, 404);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('cash payment references and notes survive retries without consuming numbers on rollback', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const initialId = `cash-down:${randomUUID()}`;
  const initialRequest = { requestId: initialId, reference: '', notes: 'Paid at the counter', proofCount: 0 };
  const initial = await downPayment(order, initialRequest);
  assert.equal(initial.status, 201, JSON.stringify(initial));
  const first = initial.body.ledger.payments[0];
  assert.match(first.internalReference, /^PAY-\d{8}-\d{4,}$/);
  assert.equal(first.reference, first.internalReference);
  assert.equal(first.notes, 'Paid at the counter');
  assert.equal(first.internalReference.split('-')[1], getReferenceDate(new Date(first.recordedAt)));
  assert.equal((await downPayment(order, initialRequest)).body.ledger.payments[0].internalReference, first.internalReference);

  const [, day, sequence] = first.internalReference.split('-');
  const counterKey = `PAY-${day}`;
  const originalSave = PaymentLedger.prototype.save;
  const retryRequest = { requestId: `cash-retry:${randomUUID()}`, amount: '140.40', reference: '', notes: 'Final payment', proofCount: 1 };
  PaymentLedger.prototype.save = async function (...args) {
    if (String(this.specialOrder) === String(order._id)) throw new Error('Injected ledger failure');
    return originalSave.apply(this, args);
  };
  try { assert.equal((await additionalPayment(order, retryRequest)).status, 500); }
  finally { PaymentLedger.prototype.save = originalSave; }
  assert.equal((await SpecialOrderCounter.findById(counterKey)).sequence, Number(sequence));
  const retried = await Promise.all([additionalPayment(order, retryRequest), additionalPayment(order, retryRequest)]);
  assert.deepEqual(retried.map((result) => result.status).sort(), [200, 201]);
  const references = retried.map((result) => result.body.ledger.payments.find((payment) => payment.requestId === retryRequest.requestId).internalReference);
  assert.equal(references[0], references[1]);
  assert.equal(references[0], `PAY-${day}-${String(Number(sequence) + 1).padStart(4, '0')}`);
  const history = await api(`/special-orders/${order._id}/payments`);
  assert.equal(history.body.ledger.payments.length, 2);
  assert.equal(history.body.ledger.payments[1].notes, 'Final payment');
  assert.equal(history.body.ledger.payments[1].proofs.length, 1);
  const { body: otherBody } = await phaseOneFixture();
  const otherOrder = await acceptedStockOrder(otherBody);
  assert.equal((await downPayment(otherOrder, { reference: '', proofCount: 0 })).status, 201);
  const { body: thirdBody } = await phaseOneFixture();
  const thirdOrder = await acceptedStockOrder(thirdBody);
  assert.equal((await downPayment(thirdOrder, { reference: '', proofCount: 0 })).status, 201);
  const sequenceBeforeParallelPayments = (await SpecialOrderCounter.findById(counterKey)).sequence;
  const parallel = await Promise.all([
    additionalPayment(otherOrder, { amount: finalPaymentAmount(otherOrder), reference: '', proofCount: 0 }),
    additionalPayment(thirdOrder, { amount: finalPaymentAmount(thirdOrder), reference: '', proofCount: 0 }),
  ]);
  assert.ok(parallel.every((result) => result.status === 201));
  const concurrentRefs = parallel.map((result) => result.body.ledger.payments.at(-1).internalReference);
  assert.equal(new Set(concurrentRefs).size, 2);
  assert.deepEqual(concurrentRefs.sort(), [1, 2].map((offset) => `PAY-${day}-${String(sequenceBeforeParallelPayments + offset).padStart(4, '0')}`));
});

test('non-cash evidence and explicit cheque clearance are required independently of notes', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const noEvidence = { method: 'gcash', reference: '', notes: 'Notes are not evidence', proofCount: 0 };
  assert.equal((await downPayment(order, noEvidence)).status, 400);
  assert.equal((await downPayment(order, { method: 'cheque', reference: 'CH-1', proofCount: 0, chequeCleared: false })).status, 400);
  const initial = await downPayment(order, { method: 'cheque', reference: '', proofCount: 1, chequeCleared: true, notes: 'Cleared by bank' });
  assert.equal(initial.status, 201, JSON.stringify(initial));
  assert.equal(initial.body.ledger.payments[0].reference, '');
  assert.equal(initial.body.ledger.payments[0].internalReference, '');
  assert.equal(initial.body.ledger.payments[0].chequeCleared, true);
  assert.equal(initial.body.ledger.payments[0].notes, 'Cleared by bank');
  assert.equal((await additionalPayment(order, { amount: '140.40', method: 'bank transfer', reference: '', proofCount: 0, notes: 'Not evidence' })).status, 400);
  assert.equal((await additionalPayment(order, { amount: '140.40', method: 'cheque', reference: 'CH-2', proofCount: 0, chequeCleared: false })).status, 400);
  for (const payment of [
    { method: 'gcash', reference: '', proofCount: 1 },
    { method: 'bank transfer', reference: 'BANK-1', proofCount: 0 },
    { method: 'other', otherMethod: 'Voucher', reference: '', proofCount: 1 },
  ]) {
    const { body: nextBody } = await phaseOneFixture();
    const nextOrder = await acceptedStockOrder(nextBody);
    assert.equal((await downPayment(nextOrder, { proofCount: 0 })).status, 201);
    const result = await additionalPayment(nextOrder, { ...payment, amount: halfOfQuotationTotal(nextOrder) });
    assert.equal(result.status, 201, JSON.stringify(result));
    assert.equal(result.body.ledger.payments.at(-1).internalReference, '');
    assert.equal(result.body.ledger.payments.at(-1).notes, '');
  }
  assert.equal((await additionalPayment(order, { amount: '140.40', method: 'gcash', reference: 'GC-2', proofCount: 0, notes: 'x'.repeat(501) })).status, 400);
  const history = await api(`/special-orders/${order._id}/payments`);
  assert.equal(history.body.ledger.payments.length, 1);
  assert.equal(history.body.ledger.payments[0].notes, 'Cleared by bank');
});

test('shared external payment references remain separate from payment identities and invoice numbers', async () => {
  const createCustomOrder = async () => {
    const { body } = await phaseOneFixture();
    body.items = [body.items[1]];
    return acceptedStockOrder(body);
  };
  const [firstOrder, secondOrder, cashOrder] = await Promise.all([createCustomOrder(), createCustomOrder(), createCustomOrder()]);
  const externalReference = `BANK-SHARED-${randomUUID()}`;
  const sharedRequestId = `shared-payment:${randomUUID()}`;
  const down = { requestId: sharedRequestId, amount: '15.15', method: 'bank transfer', reference: externalReference, proofCount: 0 };
  const downResults = await Promise.all([downPayment(firstOrder, down), downPayment(secondOrder, down)]);
  assert.ok(downResults.every((result) => result.status === 201), JSON.stringify(downResults));
  const firstPayment = downResults[0].body.ledger.payments[0];
  const secondPayment = downResults[1].body.ledger.payments[0];
  assert.equal(firstPayment.reference, externalReference);
  assert.equal(secondPayment.reference, externalReference);
  assert.notEqual(firstPayment.id, secondPayment.id);
  assert.equal((await downPayment(firstOrder, down)).body.replayed, true);

  const cash = await downPayment(cashOrder, { reference: '', proofCount: 0 });
  assert.equal(cash.status, 201, JSON.stringify(cash));
  assert.match(cash.body.ledger.payments[0].internalReference, /^PAY-\d{8}-\d{4,}$/);

  const final = { amount: '15.15', method: 'bank transfer', reference: externalReference, proofCount: 0 };
  const firstRequest = { ...final, requestId: `final-first:${randomUUID()}`, invoiceNumber: '951001' };
  const firstFinal = await additionalPayment(firstOrder, firstRequest);
  const secondFinal = await additionalPayment(secondOrder, { ...final, requestId: `final-second:${randomUUID()}`, invoiceNumber: '951002' });
  assert.equal(firstFinal.status, 201, JSON.stringify(firstFinal));
  assert.equal(secondFinal.status, 201, JSON.stringify(secondFinal));
  const replay = await additionalPayment(firstOrder, firstRequest);
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(replay.body.replayed, true);
  for (const [order, invoice] of [[firstOrder, '951001'], [secondOrder, '951002']]) {
    const ledger = await PaymentLedger.findOne({ specialOrder: order._id }).lean();
    const sale = await Sale.findOne({ specialOrderId: order._id }).lean();
    assert.equal(ledger.payments.length, 2);
    assert.ok(ledger.payments.every((payment) => payment.reference === externalReference));
    assert.equal(sale.transactionReference.referenceNumber, invoice);
    const history = await api(`/special-orders/${order._id}/payments`);
    assert.ok(history.body.ledger.payments.every((payment) => payment.reference === externalReference));
  }
  const duplicateInvoice = await additionalPayment(cashOrder, { ...final, requestId: `duplicate-invoice:${randomUUID()}`, invoiceNumber: '951001' });
  assert.equal(duplicateInvoice.status, 409, JSON.stringify(duplicateInvoice));
  assert.equal((await PaymentLedger.findOne({ specialOrder: cashOrder._id })).payments.length, 1);

  const racers = await Promise.all([createCustomOrder(), createCustomOrder()]);
  const racerDownPayments = await Promise.all(racers.map((order) => downPayment(order, {
    ...down, requestId: `racer-down:${randomUUID()}`,
  })));
  assert.ok(racerDownPayments.every((result) => result.status === 201));
  const concurrentInvoices = await Promise.all(racers.map((order) => additionalPayment(order, {
    ...final, requestId: `racer-final:${randomUUID()}`, invoiceNumber: '951003',
  })));
  assert.deepEqual(concurrentInvoices.map((result) => result.status).sort(), [201, 409]);
  assert.equal(await Sale.countDocuments({ 'transactionReference.referenceNumber': '951003' }), 1);
  const racerLedgers = await PaymentLedger.find({ specialOrder: { $in: racers.map((order) => order._id) } }).lean();
  assert.deepEqual(racerLedgers.map((ledger) => ledger.payments.length).sort(), [1, 2]);
});

test('POS and Special Order invoice writes serialize without duplicating sales or stock deductions', async () => {
  const { body, product } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  const stockBefore = (await Product.findById(product._id)).stock;
  const invoiceNumber = '951990';
  const pos = (requestId, referenceNumber = invoiceNumber) => api('/sales', { method: 'POST', body: {
    items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '200',
    referenceNumber, clientRequestId: requestId,
  } });
  const [posResult, specialResult] = await Promise.all([
    pos(`invoice-pos:${randomUUID()}`),
    additionalPayment(order, { amount: '15.15', method: 'cash', proofCount: 0, invoiceNumber, requestId: `invoice-special:${randomUUID()}` }),
  ]);
  assert.deepEqual([posResult.status, specialResult.status].sort(), [201, 409], JSON.stringify([posResult, specialResult]));
  assert.equal(await Sale.countDocuments({ 'transactionReference.referenceNumber': invoiceNumber }), 1);
  assert.equal((await Product.findById(product._id)).stock, stockBefore - (posResult.status === 201 ? 1 : 0));
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, specialResult.status === 201 ? 2 : 1);

  const sameId = `invoice-retry:${randomUUID()}`;
  const retries = await Promise.all([pos(sameId, '951991'), pos(sameId, '951991')]);
  assert.deepEqual(retries.map((result) => result.status).sort(), [200, 201], JSON.stringify(retries));
  assert.equal(await Sale.countDocuments({ 'transactionReference.referenceNumber': '951991' }), 1);
  const twoPos = await Promise.all([pos(`first:${randomUUID()}`, '951992'), pos(`second:${randomUUID()}`, '951992')]);
  assert.deepEqual(twoPos.map((result) => result.status).sort(), [201, 409], JSON.stringify(twoPos));
  assert.equal(await Sale.countDocuments({ 'transactionReference.referenceNumber': '951992' }), 1);

  const unreferenced = await api('/sales', { method: 'POST', body: {
    items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '200',
    clientRequestId: `unreferenced:${randomUUID()}`,
  } });
  assert.equal(unreferenced.status, 201, JSON.stringify(unreferenced));
  const metadataRace = await Promise.all([
    api(`/sales/${unreferenced.body._id}/transaction-reference`, { method: 'PATCH', body: { referenceNumber: '951993' } }),
    pos(`reference-race:${randomUUID()}`, '951993'),
  ]);
  assert.deepEqual(metadataRace.map((result) => result.status).sort(), [metadataRace[0].status === 200 ? 200 : 201, 409], JSON.stringify(metadataRace));
  assert.equal(await Sale.countDocuments({ 'transactionReference.referenceNumber': '951993' }), 1);
});

test('Special Order payment history preserves legacy blank references and rejects invalid optional photos', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const requestId = `legacy-payment:${randomUUID()}`;
  assert.equal((await downPayment(order, { requestId, proofCount: 1 })).status, 201);
  await PaymentLedger.updateOne({ specialOrder: order._id }, { $set: { 'payments.0.reference': '', 'payments.0.internalReference': '' } });
  const history = await api(`/special-orders/${order._id}/payments`);
  assert.equal(history.status, 200);
  assert.equal(history.body.ledger.payments[0].reference, '');
  assert.equal((await downPayment(order, { requestId, reference: '', proofCount: 0 })).body.replayed, true);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), invalidProof: true })).status, 400);
  const partialId = `legacy-partial:${randomUUID()}`;
  assert.equal((await additionalPayment(order, { requestId: partialId, amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  await PaymentLedger.updateOne({ specialOrder: order._id }, { $set: { 'payments.1.reference': '', 'payments.1.internalReference': '' } });
  assert.equal((await additionalPayment(order, { requestId: partialId, amount: finalPaymentAmount(order), reference: '', proofCount: 0 })).body.replayed, true);
  const invalidType = downPaymentForm({ amount: '1.00', reference: 'VALID' });
  invalidType.delete('proofs');
  invalidType.append('proofs', new Blob(['plain text'], { type: 'text/plain' }), 'proof.txt');
  assert.equal((await api(`/special-orders/${order._id}/payments`, { user: admin, method: 'POST', form: invalidType })).status, 400);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, 2);
});

test('Special Order collections use each ledger payment date and fail closed on inconsistent events', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const firstId = `collection-down:${randomUUID()}`;
  const finalId = `collection-final:${randomUUID()}`;
  assert.equal((await downPayment(order, { requestId: firstId, proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { requestId: finalId, amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  const firstDate = new Date('2026-09-01T03:00:00.000Z');
  const finalDate = new Date('2026-10-15T03:00:00.000Z');
  await PaymentLedger.updateOne({ specialOrder: order._id }, { $set: { 'payments.0.recordedAt': firstDate, 'payments.1.recordedAt': finalDate } });
  assert.equal((await api('/special-orders/collections', { user: admin })).status, 403);
  assert.equal((await api('/special-orders/collections', { user: owner })).status, 403);
  const result = await api('/special-orders/collections', { user: superadmin });
  assert.equal(result.status, 200, JSON.stringify(result));
  const events = result.body.events.filter((event) => event.specialOrderId === String(order._id));
  assert.deepEqual(events.map((event) => event.amountCentavos), [14040, 14040]);
  assert.deepEqual(events.map((event) => event.recordedAt), [firstDate.toISOString(), finalDate.toISOString()]);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  await PaymentLedger.updateOne({ specialOrder: order._id }, { $set: { 'payments.1.requestId': firstId } });
  assert.equal((await api('/special-orders/collections', { user: superadmin })).status, 409);
  await PaymentLedger.updateOne({ specialOrder: order._id }, { $set: { 'payments.1.requestId': finalId } });
  assert.equal((await api('/special-orders/collections', { user: superadmin })).status, 200);
});

test('Phase 4 partial stock, duplicate SKUs, and earlier optional holds retain their allocation', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 3 } });
  body.items.push({ ...body.items[0], itemId: randomUUID(), quantity: 4 });
  const order = await acceptedStockOrder(body);
  const early = await stockRequest(order, 'Reserve', `phase4-optional:${randomUUID()}`);
  assert.equal(early.status, 200);
  assert.equal(early.body.items[0].allocatedToOrder, 3);
  const paid = await downPayment(order, { method: 'Cheque' });
  assert.equal(paid.status, 201, JSON.stringify(paid));
  assert.equal(paid.body.availability.items[0].orderedQuantity, 6);
  assert.equal(paid.body.availability.items[0].allocatedToOrder, 3);
  assert.equal(paid.body.availability.items[0].shortage, 3);
  assert.equal(paid.body.ledger.reservationAtPayment[0].shortageQuantity, 3);
  assert.equal((await Product.findById(product._id)).reservedStock, 3);
  await Product.updateOne({ _id: product._id }, { $set: { stock: 7 } });
  assert.equal((await api(`/special-orders/${order._id}/stock-availability`)).body.items[0].allocatedToOrder, 3);
  assert.equal((await api(`/special-orders/${order._id}/payments`)).body.ledger.reservationAtPayment[0].shortageQuantity, 3);
  assert.equal((await stockRequest(order, 'Reserve', `phase4-topup:${randomUUID()}`)).body.items[0].allocatedToOrder, 6);
});

test('Phase 4 records a confirmed payment with zero available stock and a visible sourcing shortage', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 0 } });
  const order = await acceptedStockOrder(body);
  const paid = await downPayment(order);
  assert.equal(paid.status, 201, JSON.stringify(paid));
  assert.equal(paid.body.ledger.reservationAtPayment[0].reservedQuantity, 0);
  assert.equal(paid.body.ledger.reservationAtPayment[0].shortageQuantity, 2);
  assert.equal(paid.body.availability.items[0].status, 'For Sourcing');
  assert.equal(await StockReservation.countDocuments({ specialOrder: order._id }), 0);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('Phase 4 proofs are payment-specific, authenticated, and unavailable across orders', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const requestId = `phase4-proof:${randomUUID()}`;
  assert.equal((await downPayment(order, { requestId, method: 'Bank Transfer', proofCount: 2 })).status, 201);
  const proofUrl = `${baseUrl}/api/special-orders/${order._id}/payments/${requestId}/proofs/1`;
  const tokenFor = (user) => ({ Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET)}` });
  const proof = await fetch(proofUrl, { headers: tokenFor(owner) });
  assert.equal(proof.status, 200);
  assert.equal(proof.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await proof.arrayBuffer()), tinyPng);
  assert.equal((await fetch(proofUrl, { headers: tokenFor(other) })).status, 403);
  assert.equal((await fetch(proofUrl)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/special-orders/${order._id}/payments/${requestId}/proofs/2`, { headers: tokenFor(admin) })).status, 404);
  assert.equal((await api(`/special-orders/${order._id}/payments`, { user: other })).status, 403);
});

test('Phase 4 failed ledger write rolls back reservation, audit and payment and cleans uploaded proofs', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const beforeProofKeys = [...storedImages.keys()].filter((key) => key.startsWith('payment-proofs/')).length;
  const originalCreate = PaymentLedger.create;
  PaymentLedger.create = async () => { throw new Error('Injected payment ledger failure'); };
  try {
    assert.equal((await downPayment(order)).status, 500);
  } finally { PaymentLedger.create = originalCreate; }
  assert.equal(await PaymentLedger.countDocuments({ specialOrder: order._id }), 0);
  assert.equal(await StockReservation.countDocuments({ specialOrder: order._id }), 0);
  assert.equal(await StockOperation.countDocuments({ specialOrder: order._id, action: 'Reserve' }), 0);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal([...storedImages.keys()].filter((key) => key.startsWith('payment-proofs/')).length, beforeProofKeys);
  assert.equal(await ActivityLog.countDocuments({ action: 'Recorded Special Order Down Payment', details: { $regex: order.orderNumber } }), 0);
});

test('Phase 4 supports all five methods, rejects oversized proof, and leaves legacy orders unchanged', async () => {
  const methods = ['Cash', 'GCash', 'Cheque', 'Bank Transfer', 'Other'];
  for (const method of methods) {
    const { body } = await phaseOneFixture();
    const order = await acceptedStockOrder(body);
    const result = await downPayment(order, { method, otherMethod: method === 'Other' ? 'Cash Deposit Slip' : '' }, superadmin);
    assert.equal(result.status, 201, `${method}: ${JSON.stringify(result)}`);
    assert.equal(result.body.ledger.payments[0].method.toLowerCase(), method.toLowerCase());
    if (method === 'Other') assert.equal(result.body.ledger.payments[0].otherMethod, 'Cash Deposit Slip');
    assert.equal(result.body.ledger.remainingBalanceCentavos, result.body.ledger.approvedTotalCentavos - Math.round(result.body.ledger.approvedTotalCentavos / 2));
  }
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const oversized = new FormData();
  oversized.append('requestId', `phase4-large:${randomUUID()}`);
  oversized.append('amount', '1.00');
  oversized.append('method', 'cash');
  oversized.append('proofs', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'oversized.png');
  assert.equal((await api(`/special-orders/${order._id}/payments/down-payment`, { user: admin, method: 'POST', form: oversized })).status, 400);
  const legacy = await orderFixture();
  assert.equal((await downPayment(legacy, { amount: '1.00' })).status, 409);
  assert.equal((await api(`/special-orders/${legacy._id}/payments`)).body.ledger, null);
});

test('Phase 4 concurrent duplicate payments commit once; competing stock sale cannot consume held quantity', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  body.items[0].quantity = 1;
  const order = await acceptedStockOrder(body);
  const requestId = `phase4-concurrent:${randomUUID()}`;
  const [first, second] = await Promise.all([
    downPayment(order, { requestId }),
    downPayment(order, { requestId }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(await PaymentLedger.countDocuments({ specialOrder: order._id }), 1);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, 1);
  assert.equal((await Product.findById(product._id)).reservedStock, 1);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id })).reservedQuantity, 1);
  const sale = await api('/sales', { method: 'POST', body: { items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '125.25', referenceNumber: String(Date.now()), clientRequestId: `phase4-sale:${randomUUID()}` } });
  assert.equal(sale.status, 409);
  assert.equal((await Product.findById(product._id)).stock, 1);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('Phase 4 payment racing with normal POS checkout preserves physical-versus-reserved stock invariants', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  body.items[0].quantity = 1;
  const order = await acceptedStockOrder(body);
  const [payment, sale] = await Promise.all([
    downPayment(order),
    api('/sales', { method: 'POST', body: { items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '125.25', referenceNumber: String(Date.now()), clientRequestId: `phase4-race-sale:${randomUUID()}` } }),
  ]);
  assert.equal(payment.status, 201, JSON.stringify(payment));
  assert.ok([201, 409].includes(sale.status), JSON.stringify(sale));
  const saved = await Product.findById(product._id);
  assert.ok(saved.stock >= saved.reservedStock);
  assert.equal(1 - saved.stock + saved.reservedStock, 1);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, 1);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('Phase 3 full reservation, retry, release, documented custom items, immutable quotation and role guards', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const quoteBefore = await Quotation.findById(order.quotation._id).lean();
  const initial = await api(`/special-orders/${order._id}/stock-availability`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.items[0].orderedQuantity, 2);
  assert.equal(initial.body.items[0].availableToSell, 12);
  assert.equal(initial.body.items[1].status, 'Documented');
  assert.equal(initial.body.items[1].readinessRequired, false);
  assert.equal((await stockRequest(order, 'Reserve', 'phase3-denied-cashier', other)).status, 403);
  const reserved = await stockRequest(order, 'Reserve', 'phase3-full-reserve');
  assert.equal(reserved.status, 200, JSON.stringify(reserved));
  assert.equal(reserved.body.items[0].allocatedToOrder, 2);
  assert.equal(reserved.body.items[0].availableToSell, 10);
  assert.equal((await stockRequest(order, 'Reserve', 'phase3-full-reserve')).body.replayed, true);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id })).history.length, 1);
  assert.deepEqual(await Quotation.findById(order.quotation._id).lean(), quoteBefore);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await stockRequest(order, 'Release', 'phase3-denied-release', owner)).status, 403);
  const released = await stockRequest(order, 'Release', 'phase3-full-release');
  assert.equal(released.status, 200, JSON.stringify(released));
  assert.equal(released.body.items[0].allocatedToOrder, 0);
  assert.equal((await stockRequest(order, 'Release', 'phase3-full-release')).body.replayed, true);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id })).history.length, 2);
});

test('Phase 3 aggregates duplicate SKU lines, tracks partial shortage and only allocates replenishment on request', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 3 } });
  body.items.push({ ...body.items[0], itemId: randomUUID(), quantity: 4 });
  const order = await acceptedStockOrder(body);
  const reserved = await stockRequest(order, 'Reserve', 'phase3-partial-reserve');
  assert.equal(reserved.status, 200, JSON.stringify(reserved));
  assert.equal(reserved.body.items.filter((item) => item.itemType === 'inventory').length, 1);
  assert.equal(reserved.body.items[0].orderedQuantity, 6);
  assert.equal(reserved.body.items[0].allocatedToOrder, 3);
  assert.equal(reserved.body.items[0].shortage, 3);
  assert.equal(reserved.body.items[0].status, 'Partially Available');
  assert.equal((await Product.findById(product._id)).stock, 3);
  const noStock = await stockRequest(order, 'Reserve', 'phase3-zero-stock');
  assert.equal(noStock.status, 200);
  assert.equal(noStock.body.items[0].allocatedToOrder, 3);
  await Product.updateOne({ _id: product._id }, { $set: { stock: 7 } });
  const refreshed = await api(`/special-orders/${order._id}/stock-availability`);
  assert.equal(refreshed.body.items[0].allocatedToOrder, 3);
  assert.equal(refreshed.body.items[0].shortage, 0);
  const toppedUp = await stockRequest(order, 'Reserve', 'phase3-after-replenishment');
  assert.equal(toppedUp.body.items[0].allocatedToOrder, 6);
  assert.equal((await Product.findById(product._id)).reservedStock, 6);
});

test('Phase 3 zero-stock items remain for sourcing, legacy orders cannot reserve, and cashiers cannot cancel', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 0 } });
  const order = await acceptedStockOrder(body);
  const unavailable = await api(`/special-orders/${order._id}/stock-availability`);
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.items[0].status, 'For Sourcing');
  assert.equal(unavailable.body.items[0].shortage, 2);
  const attempt = await stockRequest(order, 'Reserve', 'phase3-zero-attempt');
  assert.equal(attempt.status, 200);
  assert.equal(attempt.body.items[0].allocatedToOrder, 0);
  assert.equal((await stockRequest(order, 'Reserve', 'phase3-zero-attempt')).body.replayed, true);
  assert.equal(await StockReservation.countDocuments({ specialOrder: order._id }), 0);
  assert.equal((await stockRequest(order, 'Cancel', 'phase3-cashier-cancel', owner)).status, 403);
  const legacy = await orderFixture();
  assert.equal((await stockRequest(legacy, 'Reserve', 'phase3-legacy-denied')).status, 409);
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('Phase 3 concurrent orders and POS checkout cannot consume the same SKU; stock-out respects holds', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 2 } });
  const first = await acceptedStockOrder(body);
  const second = await acceptedStockOrder({ ...body, clientRequestId: `phase3-second:${randomUUID()}`, items: body.items.map((item) => ({ ...item, itemId: randomUUID() })) });
  const concurrent = await Promise.all([
    stockRequest(first, 'Reserve', 'phase3-competing-first'),
    stockRequest(second, 'Reserve', 'phase3-competing-second'),
  ]);
  assert.ok(concurrent.every((result) => [200, 409].includes(result.status)), JSON.stringify(concurrent));
  const after = await Product.findById(product._id);
  assert.equal(after.stock, 2);
  assert.ok(after.reservedStock <= 2);
  assert.equal(after.reservedStock, (await StockReservation.find({ product: product._id })).reduce((sum, row) => sum + row.reservedQuantity, 0));
  const sale = await api('/sales', { method: 'POST', body: { items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '125.25', referenceNumber: String(Date.now()), clientRequestId: `phase3-sale:${randomUUID()}` } });
  assert.equal(sale.status, 409, JSON.stringify(sale));
  const customer = await Partner.create({ name: `Reserved Credit Customer ${randomUUID()}`, type: 'customer' });
  const credit = await api('/sales/finalize', { method: 'POST', form: saleFinalizationForm({
    items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'credit',
    customerId: String(customer._id), termDays: 30, creditPaymentMode: 'cash', downPaymentAmount: '1.00',
    referenceNumber: String(Date.now() + 2), clientRequestId: `phase3-credit:${randomUUID()}`,
  }) });
  assert.equal(credit.status, 409, JSON.stringify(credit));
  assert.equal(await CreditTransaction.countDocuments({ customerId: customer._id }), 0);
  assert.equal((await api(`/products/${product._id}`, { user: admin, method: 'PATCH', body: { stock: 1, expectedStock: 2 } })).status, 409);
  assert.equal((await Product.findById(product._id)).stock, 2);
  const winner = (await StockReservation.findOne({ product: product._id, reservedQuantity: { $gt: 0 } })).specialOrder;
  const cancelled = await stockRequest({ _id: winner }, 'Cancel', 'phase3-cancel-held');
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
  assert.equal(cancelled.body.order.status, 'Cancelled');
  assert.equal((await stockRequest({ _id: winner }, 'Cancel', 'phase3-cancel-held')).body.replayed, true);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal((await StockOperation.find({ specialOrder: winner, action: 'Cancel' })).length, 1);
});

test('Phase 3 simultaneous POS checkout and reserve have one stock winner, and archived SKUs cannot acquire new holds', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  body.items[0].quantity = 1;
  const order = await acceptedStockOrder(body);
  const [reservation, sale] = await Promise.all([
    stockRequest(order, 'Reserve', 'phase3-racing-reserve'),
    api('/sales', { method: 'POST', body: { items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '125.25', referenceNumber: String(Date.now() + 1), clientRequestId: `phase3-racing-sale:${randomUUID()}` } }),
  ]);
  assert.ok([200, 409].includes(reservation.status), JSON.stringify(reservation));
  assert.ok([201, 409].includes(sale.status), JSON.stringify(sale));
  const after = await Product.findById(product._id);
  assert.ok(after.stock >= after.reservedStock);
  assert.equal(1 - after.stock + after.reservedStock, 1);
  await Product.updateOne({ _id: product._id }, { $set: { isActive: false } });
  const archived = await stockRequest(order, 'Reserve', 'phase3-archived-reserve');
  assert.equal(archived.status, 200);
  // The concurrent winner determines whether an active hold remains: unresolved
  // holds need review; after a POS win with no hold, the archived SKU is sourcing-only.
  assert.equal(archived.body.items[0].status, after.reservedStock > 0 ? 'Needs Review' : 'For Sourcing');
  assert.equal(archived.body.items[0].reservable, false);
  assert.equal((await Product.findById(product._id)).reservedStock, after.reservedStock);
});

test('Phase 5A records one down payment and one final settlement without creating a sale', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const creditsBefore = await CreditTransaction.countDocuments();
  const initial = await downPayment(order, { method: 'cash', requestId: `phase5a-down:${randomUUID()}` });
  assert.equal(initial.status, 201, JSON.stringify(initial));
  assert.equal((await additionalPayment(order, { amount: '1.00' }, other)).status, 403);
  const finalId = `phase5a-final:${randomUUID()}`;
  assert.equal((await additionalPayment(order, { amount: '20.00', method: 'GCash', reference: 'GC-5A', proofCount: 2 })).status, 400,
    'an extra partial payment is rejected before final settlement');
  const final = await additionalPayment(order, { requestId: finalId, amount: '140.40', method: 'cheque', reference: 'CH-5A', proofCount: 3 });
  assert.equal(final.status, 201, JSON.stringify(final));
  assert.equal(final.body.ledger.status, 'Fully Paid');
  assert.equal(final.body.ledger.amountPaidCentavos, 28080);
  assert.equal(final.body.ledger.remainingBalanceCentavos, 0);
  assert.deepEqual(final.body.ledger.payments.map((payment) => payment.type), ['down_payment', 'final_payment']);
  assert.deepEqual(final.body.ledger.payments.map((payment) => payment.method), ['cash', 'cheque']);
  assert.deepEqual(final.body.ledger.payments.map((payment) => payment.proofs.length), [1, 3]);
  const tokenFor = (user) => ({ Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET)}` });
  for (const requestId of [finalId]) {
    const proof = await fetch(`${baseUrl}/api/special-orders/${order._id}/payments/${requestId}/proofs/0`, { headers: tokenFor(owner) });
    assert.equal(proof.status, 200);
    assert.deepEqual(Buffer.from(await proof.arrayBuffer()), tinyPng);
    assert.equal((await fetch(`${baseUrl}/api/special-orders/${order._id}/payments/${requestId}/proofs/0`, { headers: tokenFor(other) })).status, 403);
  }
  assert.equal((await additionalPayment(order, { amount: '0.01' })).status, 409);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal(await CreditTransaction.countDocuments(), creditsBefore);
  assert.equal((await Product.findById(product._id)).stock, 12);
});

test('Phase 5A payment retries and competing collectors cannot duplicate events or overpay', async () => {
  const { body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order)).status, 201);
  const requestId = `phase5a-same:${randomUUID()}`;
  const finalAmount = halfOfQuotationTotal(order);
  const [first, replay] = await Promise.all([1, 2].map(() => additionalPayment(order, { requestId, amount: finalAmount, proofCount: 2 })));
  assert.deepEqual([first.status, replay.status].sort(), [200, 201], JSON.stringify([first, replay]));
  assert.equal((await additionalPayment(order, { requestId, amount: finalAmount })).status, 200, 'idempotent retry returns the committed final payment');
  const [racingA, racingB] = await Promise.all([1, 2].map(() => additionalPayment(order, { requestId: `phase5a-race:${randomUUID()}`, amount: finalAmount })));
  assert.ok(racingA.status === 409 && racingB.status === 409, JSON.stringify([racingA, racingB]));
  const ledger = await PaymentLedger.findOne({ specialOrder: order._id });
  assert.equal(ledger.payments.length, 2);
  assert.equal(ledger.amountPaidCentavos, 28080);
  assert.equal(ledger.remainingBalanceCentavos, 0);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('Phase 5A stock availability and existing reservation workflow remain usable', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  const order = await acceptedStockOrder(body);
  const itemId = body.items[1].itemId;
  assert.equal((await sourceCustom(order, itemId, 1)).status, 409);
  assert.equal((await downPayment(order)).status, 201);
  let availability = (await api(`/special-orders/${order._id}/stock-availability`)).body;
  assert.equal(availability.items[0].allocatedToOrder, 1);
  assert.equal(availability.items[0].remainingToAllocate, 1);
  assert.equal(availability.items[0].shortage, 1);
  assert.equal(availability.fulfillment.status, 'Partially Available');
  assert.equal(availability.fulfillment.allItemsReady, false);
  assert.equal((await sourceCustom(order, itemId, 1, undefined, other)).status, 403);
  const sourceId = `phase5a-source:${randomUUID()}`;
  const sourced = await sourceCustom(order, itemId, 2, sourceId);
  assert.equal(sourced.status, 200, JSON.stringify(sourced));
  assert.equal(sourced.body.availability.items[1].sourcedQuantity, 2);
  assert.equal((await sourceCustom(order, itemId, 2, sourceId)).body.replayed, true);
  assert.equal((await sourceCustom(order, itemId, 2)).status, 400);
  const restocked = await api(`/products/${product._id}`, { user: admin, method: 'PATCH', body: {
    stock: 2, expectedStock: 1, inventoryAdjustmentReason: 'Restock for accepted order', adjustmentRequestId: `phase5a-stock:${randomUUID()}`,
  } });
  assert.equal(restocked.status, 200, JSON.stringify(restocked));
  availability = (await api(`/special-orders/${order._id}/stock-availability`)).body;
  assert.equal(availability.items[0].allocatedToOrder, 1, 'replenishment does not auto-allocate');
  assert.equal(availability.fulfillment.status, 'Stock Available', 'stock-in makes the exact SKU available without requiring another stock-in');
  const allocated = await stockRequest(order, 'Reserve', `phase5a-allocate:${randomUUID()}`);
  assert.equal(allocated.status, 200, JSON.stringify(allocated));
  assert.equal(allocated.body.items[0].allocatedToOrder, 2);
  assert.equal(allocated.body.items[0].remainingToAllocate, 0);
  const prepared = await sourceCustom(order, itemId, 1);
  assert.equal(prepared.body.availability.fulfillment.status, 'Stock Available');
  assert.equal(prepared.body.availability.fulfillment.allItemsReady, true);
  assert.equal(prepared.body.availability.fulfillment.readyConfirmedAt, null);
  assert.equal((await fetch(`${baseUrl}/api/special-orders/${order._id}/fulfillment/ready`, { method: 'POST', headers: { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET)}` } })).status, 404);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);
  assert.equal((await api('/sales', { method: 'POST', body: { items: [{ productId: String(product._id), quantity: 1 }], paymentMethod: 'cash', cashTendered: '125.25', referenceNumber: String(Date.now()), clientRequestId: `phase5a-pos:${randomUUID()}` } })).status, 409);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('Phase 5A distinguishes delivery readiness and keeps legacy orders outside the new workflow', async () => {
  const { body } = await phaseOneFixture();
  body.fulfillment = { method: 'Free Delivery', addressLine: '123 Main St', barangay: 'Baclaran', cityMunicipality: 'Cabuyao', province: 'Laguna', preferredDate: '2026-12-02' };
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order)).status, 201);
  assert.equal((await sourceCustom(order, body.items[1].itemId, 3)).status, 200);
  const before = (await api(`/special-orders/${order._id}/stock-availability`)).body;
  assert.equal(before.fulfillment.status, 'Stock Available');
  assert.equal(before.fulfillment.readyConfirmedAt, null);
  assert.equal(before.fulfillment.preferredDate, '2026-12-02');
  assert.equal(before.fulfillment.address.province, 'Laguna');
  assert.equal((await fetch(`${baseUrl}/api/special-orders/${order._id}/fulfillment/delivered`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET)}` },
  })).status, 404);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  const legacy = await orderFixture();
  assert.equal((await additionalPayment(legacy, { amount: '1.00' })).status, 409);
  assert.equal((await sourceCustom(legacy, body.items[1].itemId, 1)).status, 409);
  assert.equal((await fetch(`${baseUrl}/api/special-orders/${legacy._id}/fulfillment/ready`, { method: 'POST', headers: { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET)}` } })).status, 404);
});

test('Phase 5B records Sale once then completes and consumes reserved exact-SKU stock once', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const completeUrl = `/special-orders/${order._id}/complete`;
  assert.equal((await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `complete:${randomUUID()}` } })).status, 409);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await sourceCustom(order, body.items[1].itemId, 3)).status, 200);
  assert.equal((await availabilityFor(order)).body.fulfillment.status, 'Stock Available');
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })).status, 409);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), method: 'cheque', reference: 'FINAL-5B', proofCount: 0 })).status, 201);
  const creditsBefore = await CreditTransaction.countDocuments();
  const [first, retry] = await Promise.all([1, 2].map(() => api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })));
  assert.deepEqual([first.status, retry.status].sort(), [200, 201], JSON.stringify([first, retry]));
  const sale = await Sale.findOne({ specialOrderId: order._id });
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal(sale.vatCalculationStatus, 'not_calculated');
  assert.equal(sale.taxTreatment, 'vat_zero_rated');
  assert.equal(sale.vatAmount, null);
  assert.equal(sale.netAmount, null);
  assert.equal(sale.collectionSource, 'special_order_ledger');
  assert.equal(sale.totalAmount, 280.8);
  const receipt = await api(`/special-orders/${order._id}/receipt`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.receiptTransaction.vatAmount, null);
  assert.equal(receipt.body.receiptTransaction.netAmount, null);
  assert.equal(receipt.body.receiptTransaction.taxTreatment, 'vat_zero_rated');
  assert.equal(receipt.body.receiptTransaction.cashImpactAmount, 0);
  assert.equal(receipt.body.receiptTransaction.collectionSource, 'special_order_ledger');
  assert.equal(receipt.body.receiptTransaction.specialOrderFulfillmentStatus, 'Stock Available');
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.ok((await SpecialOrder.findById(order._id)).financialRecordedAt);
  assert.equal(String(sale.items[0].product), String(product._id));
  assert.equal(sale.items[0].code, product.sku);
  assert.equal(sale.items[1].product, null);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);
  const hold = await StockReservation.findOne({ specialOrder: order._id, product: product._id });
  assert.equal(hold.status, 'Active');
  assert.equal(hold.consumedSale, null);
  assert.equal(hold.history.filter((event) => event.action === 'Consume').length, 0);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: order._id }), 0);
  assert.equal(await CreditTransaction.countDocuments(), creditsBefore);
  const paid = await PaymentLedger.findOne({ specialOrder: order._id });
  assert.equal(paid.payments.length, 2);
  assert.equal(paid.amountPaidCentavos, 28080);
  assert.equal(paid.payments.reduce((sum, event) => sum + event.amountCentavos, 0), 28080);
  assert.equal((await api(completeUrl, { user: other, method: 'POST', body: { requestId: `complete:${randomUUID()}` } })).status, 403);
  const requestId = `complete:${randomUUID()}`;
  const completions = await Promise.all([1, 2].map(() => api(completeUrl, { user: admin, method: 'POST', body: { requestId } })));
  assert.deepEqual(completions.map((response) => response.status), [200, 200], JSON.stringify(completions));
  assert.equal(completions.filter((response) => response.body.replayed).length, 1);
  assert.equal(completions[0].body.order.status, 'Completed');
  assert.equal(completions[0].body.order.fulfillmentOperations.some((event) => event.action === 'Complete Order' && String(event.actor) === String(admin._id)), true);
  assert.match(completions[0].body.order.statusHistory.at(-1).note, /Fully paid order completed/);
  assert.equal(completions[0].body.availability.fulfillment.status, 'Stock Consumed');
  assert.equal(completions[0].body.availability.items[0].consumedQuantity, 2);
  assert.equal(completions[0].body.availability.items[0].physicalStock, 10);
  assert.equal((await Product.findById(product._id)).stock, 10);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  const consumed = await StockReservation.findOne({ specialOrder: order._id, product: product._id });
  assert.equal(consumed.status, 'Consumed');
  assert.equal(String(consumed.consumedSale), String(sale._id));
  assert.equal(consumed.history.filter((event) => event.action === 'Consume').length, 1);
  const logs = await InventoryLog.find({ specialOrderRef: order._id });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].quantity, 2);
  assert.equal(String(logs[0].saleRef), String(sale._id));
  assert.equal((await Sale.findById(sale._id)).specialOrderFulfillmentStatus, 'Administrative Closure');
  const repeatedCompletion = await api(completeUrl, { user: admin, method: 'POST', body: { requestId } });
  assert.equal(repeatedCompletion.status, 200, JSON.stringify(repeatedCompletion));
  assert.equal(repeatedCompletion.body.order.status, 'Completed');
  const repeatedWithNewRequestId = await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `complete:${randomUUID()}` } });
  assert.equal(repeatedWithNewRequestId.status, 200, JSON.stringify(repeatedWithNewRequestId));
  assert.equal(repeatedWithNewRequestId.body.order.status, 'Completed');
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'Completed');
});

test('Complete Order records the missing Sale and consumes exact-SKU stock atomically after collecting an Invoice No.', async () => {
  const { product, body } = await phaseOneFixture();
  body.items = [body.items[0]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  const finalAmount = finalPaymentAmount(order);
  assert.equal((await additionalPayment(order, { amount: finalAmount, proofCount: 0 })).status, 201);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  const stockBefore = await Product.findById(product._id);
  assert.equal(stockBefore.stock, 12);
  assert.equal(stockBefore.reservedStock, 2);

  const missingReference = await api(`/special-orders/${order._id}/complete`, {
    user: admin, method: 'POST', body: { requestId: `missing-document:${randomUUID()}` },
  });
  assert.equal(missingReference.status, 400);
  assert.match(missingReference.body.message, /Invoice No\. or Supporting Document/i);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');

  const completeUrl = `/special-orders/${order._id}/complete`;
  const requestId = `direct-complete:${randomUUID()}`;
  const requests = await Promise.all([1, 2].map(() => api(completeUrl, {
    user: admin, method: 'POST', form: completeForm(order.quotation, requestId, { reference: '700123' }),
  })));
  assert.deepEqual(requests.map((response) => response.status), [200, 200], JSON.stringify(requests));
  assert.equal(requests.filter((response) => response.body.replayed).length, 1);
  assert.equal(requests[0].body.order.status, 'Completed');
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  const sale = await Sale.findOne({ specialOrderId: order._id });
  assert.equal(sale.transactionReference.referenceNumber, '700123');
  assert.equal(sale.collectionSource, 'special_order_ledger');
  assert.equal(sale.totalAmount, order.quotation.total);
  const ledger = await PaymentLedger.findOne({ specialOrder: order._id });
  assert.equal(ledger.payments.length, 2);
  assert.equal(ledger.payments.reduce((sum, payment) => sum + payment.amountCentavos, 0), ledger.approvedTotalCentavos);
  assert.equal((await Product.findById(product._id)).stock, 10);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: order._id, saleRef: sale._id }), 1);
});

test('Complete Order accepts a supporting document and rolls back the Sale and stock change on failure', async () => {
  const { product, body } = await phaseOneFixture();
  body.items = [body.items[0]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  const beforeImages = storedImages.size;
  const originalSave = SpecialOrder.prototype.save;
  SpecialOrder.prototype.save = function (...args) {
    if (String(this._id) === String(order._id) && this.status === 'Completed') throw new Error('Injected completion failure');
    return originalSave.apply(this, args);
  };
  try {
    const failed = await api(`/special-orders/${order._id}/complete`, {
      user: admin, method: 'POST', form: completeForm(order.quotation, `document-failure:${randomUUID()}`, { image: true }),
    });
    assert.equal(failed.status, 500, JSON.stringify(failed));
  } finally { SpecialOrder.prototype.save = originalSave; }
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal(storedImages.size, beforeImages);

  const completed = await api(`/special-orders/${order._id}/complete`, {
    user: admin, method: 'POST', form: completeForm(order.quotation, `document-retry:${randomUUID()}`, { image: true }),
  });
  assert.equal(completed.status, 200, JSON.stringify(completed));
  assert.equal(completed.body.order.status, 'Completed');
  assert.ok(completed.body.sale.transactionReference.supportingDocument.key);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await Product.findById(product._id)).stock, 10);
});

test('Phase 5B blocks completion for insufficient stock, then completes after stock is available', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 0, reservedStock: 0 } });
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  assert.equal((await api(`/special-orders/${order._id}/stock-availability`)).body.fulfillment.allItemsReady, false);
  const blockedCompletion = await api(`/special-orders/${order._id}/complete`, {
    user: admin, method: 'POST', form: completeForm(order.quotation, `blocked-complete:${randomUUID()}`, { reference: '700125' }),
  });
  assert.equal(blockedCompletion.status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0, 'insufficient stock must roll back the not-yet-recorded Sale');
  assert.equal((await Product.findById(product._id)).stock, 0);
  const form = finalForm(order.quotation);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: other, method: 'POST', form })).status, 403);
  const recorded = await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form });
  assert.equal(recorded.status, 201, JSON.stringify(recorded));
  assert.equal(recorded.body.order.status, 'In Progress');
  assert.equal(recorded.body.order.linkedSaleId, recorded.body.sale._id);
  assert.equal(recorded.body.sale.specialOrderFulfillmentStatus, 'Insufficient Stock');
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal(await StockReservation.countDocuments({ specialOrder: order._id }), 0);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: order._id }), 0);
  assert.equal((await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `premature:${randomUUID()}` } })).status, 409);

  await Product.updateOne({ _id: product._id }, { $set: { stock: 2 } });
  const afterStockIn = (await availabilityFor(order)).body;
  assert.equal(afterStockIn.fulfillment.allItemsReady, false, 'stock-in is not a reservation');
  assert.equal(afterStockIn.items[0].remainingToAllocate, 2);
  assert.equal((await availabilityFor(order)).body.fulfillment.status, 'Stock Available');
  assert.equal(afterStockIn.fulfillment.canComplete, true, 'available exact-SKU stock can be reserved atomically at completion');
  const completed = await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `after-sale-complete:${randomUUID()}` } });
  assert.equal(completed.status, 200, JSON.stringify(completed));
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal((await Sale.findById(recorded.body.sale._id)).specialOrderFulfillmentStatus, 'Administrative Closure');
});

test('an owning Cashier can complete a Phase 5B Special Order without exception-only permissions', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  const customItemId = body.items[1].itemId;

  const reservation = await stockRequest(order, 'Reserve', `cashier-reserve:${randomUUID()}`, owner);
  assert.equal(reservation.status, 200, JSON.stringify(reservation));
  assert.equal(reservation.body.items[0].allocatedToOrder, 2);
  assert.equal((await stockRequest(order, 'Release', `cashier-release:${randomUUID()}`, owner)).status, 403);
  assert.equal((await stockRequest(order, 'Cancel', `cashier-cancel:${randomUUID()}`, owner)).status, 403);

  const downPaymentResult = await downPayment(order, {
    requestId: `cashier-down:${randomUUID()}`,
    method: 'Cash', reference: 'CASHIER-DOWN', proofCount: 1,
  }, owner);
  assert.equal(downPaymentResult.status, 201, JSON.stringify(downPaymentResult));
  assert.equal(downPaymentResult.body.ledger.amountPaidCentavos, 14040);

  const finalPayment = await additionalPayment(order, {
    requestId: `cashier-final:${randomUUID()}`,
    amount: finalPaymentAmount(order), method: 'Cheque', reference: 'CASHIER-FINAL', proofCount: 0,
  }, owner);
  assert.equal(finalPayment.status, 201, JSON.stringify(finalPayment));
  assert.equal(finalPayment.body.ledger.status, 'Fully Paid');
  assert.equal(finalPayment.body.ledger.remainingBalanceCentavos, 0);
  assert.equal((await additionalPayment(order, { amount: '0.01' }, other)).status, 403);

  const recorded = await api(`/special-orders/${order._id}/finalize`, {
    user: owner,
    method: 'POST',
    form: finalForm(order.quotation, { reference: String(Date.now()) }),
  });
  assert.equal(recorded.status, 201, JSON.stringify(recorded));
  assert.equal(recorded.body.order.status, 'In Progress');
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);

  const prepared = await sourceCustom(order, customItemId, 3, `cashier-source:${randomUUID()}`, owner);
  assert.equal(prepared.status, 200, JSON.stringify(prepared));
  assert.equal(prepared.body.availability.fulfillment.allItemsReady, true);

  const completeUrl = `/special-orders/${order._id}/complete`;
  assert.equal((await api(completeUrl, { user: other, method: 'POST', body: { requestId: `cashier-foreign-complete:${randomUUID()}` } })).status, 403);
  const completed = await api(completeUrl, { user: owner, method: 'POST', body: { requestId: `cashier-complete:${randomUUID()}` } });
  assert.equal(completed.status, 200, JSON.stringify(completed));
  assert.equal(completed.body.order.status, 'Completed');
  assert.equal(completed.body.order.completedBy, String(owner._id));
  assert.match(completed.body.order.statusHistory.at(-1).note, /Fully paid order completed/);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await Product.findById(product._id)).stock, 10);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: order._id }), 1);
});

test('historical readiness cannot bypass current inventory availability, and old custom sourcing records stay nonblocking', async () => {
  const { product, body } = await phaseOneFixture();
  await Product.updateOne({ _id: product._id }, { $set: { stock: 0, reservedStock: 0 } });
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })).status, 201);
  const historicalDate = new Date('2026-09-01T10:00:00.000Z');
  await SpecialOrder.updateOne({ _id: order._id }, { $set: { readyConfirmation: {
    method: 'Store Pickup', confirmedAt: historicalDate, confirmedBy: admin._id, requestId: 'historical-ready',
  } } });
  const completeUrl = `/special-orders/${order._id}/complete`;
  const incomplete = (await availabilityFor(order)).body;
  assert.equal(incomplete.fulfillment.status, 'Insufficient Stock');
  assert.equal(incomplete.fulfillment.allItemsReady, false);
  assert.equal(incomplete.fulfillment.readyConfirmedAt, historicalDate.toISOString());
  assert.equal((await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `old-ready:${randomUUID()}` } })).status, 409);
  await Product.updateOne({ _id: product._id }, { $set: { stock: 2 } });
  assert.equal((await stockRequest(order, 'Reserve', `legacy-reserve:${randomUUID()}`)).status, 200);
  assert.equal((await availabilityFor(order)).body.fulfillment.status, 'Stock Available');
  assert.equal((await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `old-ready-complete:${randomUUID()}` } })).status, 200);
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal((await SpecialOrder.findById(order._id)).readyConfirmation.confirmedAt.toISOString(), historicalDate.toISOString());
});

test('automatic readiness rejects conflicting allocations and stock below active holds', async () => {
  const { product, body } = await phaseOneFixture();
  body.items = [body.items[0]];
  const first = await acceptedStockOrder(body);
  const second = await acceptedStockOrder({ ...body, clientRequestId: `competing-order:${randomUUID()}` });
  assert.equal((await downPayment(first, { proofCount: 0 })).status, 201);
  assert.equal((await downPayment(second, { proofCount: 0 })).status, 201);
  assert.equal((await Product.findById(product._id)).reservedStock, 4);
  assert.equal((await availabilityFor(first)).body.fulfillment.status, 'Stock Available');
  assert.equal((await additionalPayment(first, { amount: finalPaymentAmount(first), proofCount: 0 })).status, 201);
  const recorded = await api(`/special-orders/${first._id}/finalize`, { user: admin, method: 'POST', form: finalForm(first.quotation) });
  assert.equal(recorded.status, 201, JSON.stringify(recorded));

  await Product.updateOne({ _id: product._id }, { $set: { reservedStock: 2 } });
  const inconsistent = (await availabilityFor(first)).body;
  assert.equal(inconsistent.fulfillment.allItemsReady, false);
  assert.equal(inconsistent.items[0].reservationNeedsReview, true);
  assert.equal(inconsistent.items[0].allocatedToOrder, 0);
  const completeUrl = `/special-orders/${first._id}/complete`;
  assert.equal((await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `conflict:${randomUUID()}` } })).status, 409);
  await Product.updateOne({ _id: product._id }, { $set: { stock: 3, reservedStock: 4 } });
  assert.equal((await availabilityFor(first)).body.fulfillment.allItemsReady, false);
  assert.equal((await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `low-stock:${randomUUID()}` } })).status, 409);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: first._id }), 0);

  await Product.updateOne({ _id: product._id }, { $set: { stock: 12 } });
  assert.equal((await availabilityFor(first)).body.fulfillment.status, 'Stock Available');
  assert.equal((await api(completeUrl, { user: admin, method: 'POST', body: { requestId: `repaired:${randomUUID()}` } })).status, 200);
  assert.equal((await Product.findById(product._id)).stock, 10);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);
  assert.equal((await availabilityFor(second)).body.fulfillment.status, 'Stock Available');
});

test('a paid and ready older quotation cannot finalize from a customer tax default without explicit approved classification', async () => {
  const { product, body } = await phaseOneFixture();
  body.taxTreatment = 'standard';
  body.items = [{ ...body.items[0], quantity: 1 }];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  assert.equal((await availabilityFor(order)).body.fulfillment.status, 'Stock Available');

  await Quotation.collection.updateOne({ _id: new mongoose.Types.ObjectId(order.quotation._id) }, { $unset: { 'documentSnapshot.taxTreatment': '' } });
  const olderQuotation = await Quotation.findById(order.quotation._id).lean();
  assert.equal(olderQuotation.customerDetails.taxTreatment, 'standard');
  assert.equal(olderQuotation.documentSnapshot.customer.taxTreatment, 'standard');
  assert.equal(olderQuotation.documentSnapshot.taxTreatment, undefined);
  const missingSnapshotApproval = await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) });
  assert.equal(missingSnapshotApproval.status, 409);
  assert.match(missingSnapshotApproval.body.message, /approved tax classification needs review/i);

  await SpecialOrder.collection.updateOne({ _id: new mongoose.Types.ObjectId(order._id) }, { $unset: { taxTreatment: '' } });
  const olderOrder = await SpecialOrder.findById(order._id).lean();
  assert.equal(olderOrder.taxTreatment, undefined);
  const missingOrderApproval = await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) });
  assert.equal(missingOrderApproval.status, 409);
  assert.match(missingOrderApproval.body.message, /approved tax classification needs review/i);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 1);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id, product: product._id })).status, 'Active');
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).amountPaidCentavos, 12525);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
});

test('completion rolls back stock deduction and closure on inventory-log failure while retaining the recorded Sale', async () => {
  const { product, body } = await phaseOneFixture();
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  assert.equal((await sourceCustom(order, body.items[1].itemId, 3)).status, 200);
  assert.equal((await availabilityFor(order)).body.fulfillment.status, 'Stock Available');
  const original = InventoryLog.create;
  InventoryLog.create = async function failFinalLog(rows, options) {
    if (rows?.[0]?.specialOrderRef && String(rows[0].specialOrderRef) === String(order._id)) throw new Error('Injected inventory audit failure');
    return original.call(this, rows, options);
  };
  try {
    assert.equal((await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) })).status, 201);
    assert.equal((await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `complete-fail:${randomUUID()}` } })).status, 500);
  } finally { InventoryLog.create = original; }
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 2);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id, product: product._id })).status, 'Active');
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: order._id }), 0);
  assert.equal((await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `complete-retry:${randomUUID()}` } })).status, 200);
  assert.equal((await Product.findById(product._id)).stock, 10);
});

test('completion preserves VAT-Rated agreed prices and consumes grouped exact-SKU holds', async () => {
  const { product, body } = await phaseOneFixture();
  body.taxTreatment = 'standard';
  body.fulfillment = { method: 'Free Delivery', addressLine: '123 Main St', barangay: 'Baclaran', cityMunicipality: 'Cabuyao', province: 'Laguna' };
  body.items.push({ ...body.items[0], itemId: randomUUID(), quantity: 1 });
  const order = await acceptedStockOrder(body);
  assert.equal(order.quotation.total, 406.05);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), proofCount: 0 })).status, 201);
  assert.equal((await sourceCustom(order, body.items[1].itemId, 3)).status, 200);
  assert.equal((await availabilityFor(order)).body.fulfillment.status, 'Stock Available');
  const done = await api(`/special-orders/${order._id}/finalize`, { user: admin, method: 'POST', form: finalForm(order.quotation) });
  assert.equal(done.status, 201, JSON.stringify(done));
  const sale = await Sale.findOne({ specialOrderId: order._id });
  assert.equal(sale.taxTreatment, 'standard');
  assert.equal(sale.totalAmount, 406.05);
  assert.equal(sale.vatAmount, null);
  assert.deepEqual(sale.items.filter((item) => String(item.product || '') === String(product._id)).map((item) => item.quantity), [2, 1]);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await Product.findById(product._id)).reservedStock, 3);
  assert.equal((await InventoryLog.find({ specialOrderRef: order._id })).length, 0);
  assert.equal((await StockReservation.findOne({ specialOrder: order._id })).reservedQuantity, 3);
  const availability = await api(`/special-orders/${order._id}/stock-availability`);
  assert.equal(availability.status, 200);
  assert.equal(availability.body.items[0].allocatedToOrder, 3);
  assert.equal(availability.body.items[0].consumedQuantity, 0);
  assert.equal(availability.body.items[0].remainingToAllocate, 0);
  assert.equal(availability.body.fulfillment.status, 'Stock Available');
  const completed = await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `complete:${randomUUID()}` } });
  assert.equal(completed.status, 200, JSON.stringify(completed));
  assert.equal(completed.body.order.status, 'Completed');
  const completedAt = completed.body.order.completedAt;
  const statusHistory = completed.body.order.statusHistory;
  assert.equal((await Product.findById(product._id)).stock, 9);
  assert.equal((await Product.findById(product._id)).reservedStock, 0);
  assert.equal((await InventoryLog.find({ specialOrderRef: order._id })).length, 1);
  const repeated = await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `complete-retry:${randomUUID()}` } });
  assert.equal(repeated.status, 200, JSON.stringify(repeated));
  assert.equal(repeated.body.replayed, true);
  assert.equal(repeated.body.order.completedAt, completedAt);
  assert.deepEqual(repeated.body.order.statusHistory, statusHistory);
  assert.equal((await Product.findById(product._id)).stock, 9);
  assert.equal((await InventoryLog.find({ specialOrderRef: order._id })).length, 1);
  assert.equal((await api(`/special-orders/${order._id}/stock-availability`)).body.fulfillment.status, 'Stock Consumed');
});

test('custom-only down payment and final settlement record one Sale without reposting collections or issuing stock', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  const before = await downPayment(order, { proofCount: 0 });
  assert.equal(before.status, 201, JSON.stringify(before));
  const partial = await additionalPayment(order, { amount: '10.00', proofCount: 0 });
  assert.equal(partial.status, 400, JSON.stringify(partial));
  assert.equal(partial.body.message, 'The remaining Cash Special Order balance must be settled in one final payment.');
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).remainingBalanceCentavos, 1515);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);

  const requestId = `custom-final:${randomUUID()}`;
  const missingInvoice = await additionalPayment(order, { amount: finalPaymentAmount(order), requestId, proofCount: 0 });
  assert.equal(missingInvoice.status, 400, JSON.stringify(missingInvoice));
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).amountPaidCentavos, 1515);

  const payment = { amount: finalPaymentAmount(order), requestId, invoiceNumber: '780003', proofCount: 0 };
  const final = await additionalPayment(order, payment);
  assert.equal(final.status, 201, JSON.stringify(final));
  assert.equal(final.body.ledger.status, 'Fully Paid');
  assert.equal(final.body.ledger.remainingBalanceCentavos, 0);
  assert.equal(final.body.order.status, 'In Progress');
  assert.ok(final.body.order.linkedSaleId);
  assert.equal(final.body.availability.fulfillment.status, 'No Inventory Required');
  const sale = await Sale.findOne({ specialOrderId: order._id });
  assert.equal(String(sale._id), final.body.order.linkedSaleId);
  assert.equal(sale.totalAmount, 30.3);
  assert.equal(sale.taxTreatment, 'vat_zero_rated');
  assert.equal(sale.vatAmount, null);
  assert.equal(sale.collectionSource, 'special_order_ledger');
  assert.equal(sale.transactionReference.referenceNumber, '780003');
  assert.equal(sale.specialOrderFulfillmentStatus, 'No Inventory Required');
  assert.equal(sale.items[0].product, null);
  assert.equal(await StockReservation.countDocuments({ specialOrder: order._id }), 0);
  assert.equal(await StockOperation.countDocuments({ specialOrder: order._id, action: 'Reserve' }), 0);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: order._id }), 0);

  const collections = await api('/special-orders/collections', { user: superadmin });
  assert.equal(collections.status, 200, JSON.stringify(collections));
  const events = collections.body.events.filter((event) => event.specialOrderId === order._id);
  assert.deepEqual(events.map((event) => event.amountCentavos), [1515, 1515]);
  assert.deepEqual(events.map((event) => event.type), ['down_payment', 'final_payment']);
  assert.equal(events.every((event) => !Number.isNaN(new Date(event.recordedAt).getTime())), true);

  const replay = await additionalPayment(order, payment);
  assert.equal(replay.status, 200, JSON.stringify(replay));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.order.linkedSaleId, final.body.order.linkedSaleId);
  assert.equal((await additionalPayment(order, { ...payment, invoiceNumber: '780004' })).status, 409);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, 2);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
});

test('custom-only final payment accepts a separate Sale document without an invoice number', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  const invalid = await additionalPayment(order, { amount: finalPaymentAmount(order), saleDocument: true, invalidSaleDocument: true, proofCount: 0 });
  assert.equal(invalid.status, 400, JSON.stringify(invalid));
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).amountPaidCentavos, 1515);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);

  const recorded = await additionalPayment(order, { amount: finalPaymentAmount(order), saleDocument: true, proofCount: 1 });
  assert.equal(recorded.status, 201, JSON.stringify(recorded));
  const sale = await Sale.findOne({ specialOrderId: order._id });
  assert.equal(sale.transactionReference.referenceNumber, '');
  assert.ok(sale.transactionReference.supportingDocument.key);
  assert.ok(storedImages.has(`${documents.PREFIX}${sale.transactionReference.supportingDocument.key}`));
  const ledger = await PaymentLedger.findOne({ specialOrder: order._id });
  assert.equal(ledger.payments.at(-1).proofs.length, 1);
  assert.notEqual(ledger.payments.at(-1).proofs[0].storageKey, sale.transactionReference.supportingDocument.key);
  const documentResponse = await fetch(`${baseUrl}/api/sales/${sale._id}/supporting-document`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET)}` } });
  assert.equal(documentResponse.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/sales/${sale._id}/supporting-document`, { headers: { Authorization: `Bearer ${jwt.sign({ id: String(other._id) }, process.env.JWT_SECRET)}` } })).status, 403);
});

test('custom-only final payment rolls back when Sale creation fails, then retries with the same request', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  const request = { amount: finalPaymentAmount(order), requestId: `custom-retry:${randomUUID()}`, invoiceNumber: '780005', proofCount: 0 };
  const originalCreate = Sale.create;
  Sale.create = async function failSale(rows, options) {
    if (rows?.[0]?.specialOrderId && String(rows[0].specialOrderId) === String(order._id)) throw new Error('Injected Sale failure');
    return originalCreate.call(this, rows, options);
  };
  try {
    assert.equal((await additionalPayment(order, request)).status, 500);
  } finally { Sale.create = originalCreate; }
  const ledger = await PaymentLedger.findOne({ specialOrder: order._id });
  assert.equal(ledger.amountPaidCentavos, 1515);
  assert.equal(ledger.remainingBalanceCentavos, 1515);
  assert.equal(ledger.payments.length, 1);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
  assert.equal((await SpecialOrder.findById(order._id)).linkedSaleId, null);
  const retry = await additionalPayment(order, request);
  assert.equal(retry.status, 201, JSON.stringify(retry));
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
});

test('custom-only final payment does not collect or create a Sale when approved tax classification needs review', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  await SpecialOrder.updateOne({ _id: order._id }, { $set: { taxTreatment: 'standard' } });
  const blocked = await additionalPayment(order, { amount: finalPaymentAmount(order), invoiceNumber: '780007', proofCount: 0 });
  assert.equal(blocked.status, 409, JSON.stringify(blocked));
  assert.match(blocked.body.message, /approved tax classification needs review/i);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).amountPaidCentavos, 1515);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 0);
});

test('concurrent custom-only final payments create exactly one Sale and collection before completion', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  const request = { amount: finalPaymentAmount(order), requestId: `custom-concurrent:${randomUUID()}`, invoiceNumber: '780006', proofCount: 0 };
  const outcomes = await Promise.all([additionalPayment(order, request), additionalPayment(order, request)]);
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 201]);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).payments.length, 2);
  const complete = await api(`/special-orders/${order._id}/complete`, { user: admin, method: 'POST', body: { requestId: `custom-complete:${randomUUID()}` } });
  assert.equal(complete.status, 200, JSON.stringify(complete));
  assert.equal((await SpecialOrder.findById(order._id)).status, 'Completed');
});

test('custom-only completion needs no inventory operations; mixed orders still require available stock', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const custom = await acceptedStockOrder(body);
  assert.equal((await stockRequest(custom, 'Reserve', `custom-only-reserve:${randomUUID()}`)).status, 409);
  assert.equal(await StockOperation.countDocuments({ specialOrder: custom._id, action: 'Reserve' }), 0);
  assert.equal((await downPayment(custom, { proofCount: 0 })).status, 201);
  assert.equal((await api(`/special-orders/${custom._id}/complete`, { user: admin, method: 'POST', body: { requestId: `unpaid-custom-complete:${randomUUID()}` } })).status, 409);
  const finalPayment = await additionalPayment(custom, { amount: finalPaymentAmount(custom), invoiceNumber: '780001', proofCount: 0 });
  assert.equal(finalPayment.status, 201, JSON.stringify(finalPayment));
  assert.ok(finalPayment.body.order.linkedSaleId);
  const customAvailability = (await availabilityFor(custom)).body;
  assert.equal(customAvailability.fulfillment.status, 'No Inventory Required');
  assert.equal(customAvailability.fulfillment.canComplete, true);
  assert.equal(customAvailability.fulfillment.allItemsReady, true);
  assert.equal(customAvailability.items[0].remainingToAllocate, 0);
  assert.equal(customAvailability.items[0].readinessRequired, false);
  assert.equal(customAvailability.items[0].sourcedQuantity, 0);
  const customLedger = await PaymentLedger.findOne({ specialOrder: custom._id });
  assert.equal(customLedger.reservationAtPayment[0].reservedQuantity, 0);
  assert.equal(customLedger.reservationAtPayment[0].shortageQuantity, 0);
  assert.equal(await StockOperation.countDocuments({ specialOrder: custom._id, action: 'Reserve' }), 0);
  await SpecialOrder.updateOne({ _id: custom._id }, { $set: { customSourcing: [{ itemId: body.items[0].itemId, sourcedQuantity: 3, updatedAt: new Date(), updatedBy: admin._id }] } });
  const legacyCustomAvailability = (await availabilityFor(custom)).body;
  assert.equal(legacyCustomAvailability.items[0].sourcedQuantity, 3);
  assert.equal(legacyCustomAvailability.fulfillment.allItemsReady, true);
  assert.equal((await api(`/special-orders/${custom._id}/finalize`, { user: admin, method: 'POST', form: finalForm(custom.quotation) })).status, 200);
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: custom._id }), 0);
  assert.equal(await StockReservation.countDocuments({ specialOrder: custom._id }), 0);
  assert.equal((await Sale.findOne({ specialOrderId: custom._id })).items[0].product, null);
  const customCompletion = await api(`/special-orders/${custom._id}/complete`, { user: admin, method: 'POST', body: { requestId: `custom-complete:${randomUUID()}` } });
  assert.equal(customCompletion.status, 200, JSON.stringify(customCompletion));
  assert.equal(customCompletion.body.order.fulfillmentHandover.confirmedAt, null);
  assert.equal(customCompletion.body.order.status, 'Completed');
  assert.equal((await Sale.findOne({ specialOrderId: custom._id })).specialOrderFulfillmentStatus, 'Administrative Closure');
  assert.equal(customCompletion.body.availability.fulfillment.status, 'No Inventory Required');
  assert.equal(await InventoryLog.countDocuments({ specialOrderRef: custom._id }), 0);

  const { product, body: mixedBody } = await phaseOneFixture();
  const mixed = await acceptedStockOrder(mixedBody);
  assert.equal((await downPayment(mixed, { proofCount: 0 })).status, 201);
  assert.equal((await additionalPayment(mixed, { amount: finalPaymentAmount(mixed), proofCount: 0 })).status, 201);
  const mixedAvailability = (await availabilityFor(mixed)).body;
  assert.equal(mixedAvailability.fulfillment.status, 'Stock Available');
  assert.equal(mixedAvailability.fulfillment.allItemsReady, true);
  assert.equal(mixedAvailability.items.find((item) => item.itemType === 'custom').readinessRequired, false);
  await Product.updateOne({ _id: product._id }, { $set: { reservedStock: 0 } });
  assert.equal((await api(`/special-orders/${mixed._id}/finalize`, { user: admin, method: 'POST', form: finalForm(mixed.quotation) })).status, 201);
  assert.equal(await Sale.countDocuments({ specialOrderId: mixed._id }), 1);
  assert.equal((await api(`/special-orders/${mixed._id}/complete`, { user: admin, method: 'POST', body: { requestId: `mixed-complete:${randomUUID()}` } })).status, 409);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal((await StockReservation.findOne({ specialOrder: mixed._id })).status, 'Active');
});

test('custom-only final payment refuses an unexpected pre-existing Sale and rolls back collection', async () => {
  const { body } = await phaseOneFixture();
  body.items = [body.items[1]];
  const order = await acceptedStockOrder(body);
  assert.equal((await downPayment(order, { proofCount: 0 })).status, 201);
  await Sale.create({ ...controller.__test.buildSalePayload(await SpecialOrder.findById(order._id), { user: admin }, { quotation: await Quotation.findById(order.quotation._id) }),
    clientRequestId: `unexpected:${randomUUID()}` });
  assert.equal((await additionalPayment(order, { amount: finalPaymentAmount(order), invoiceNumber: '780002', proofCount: 0 })).status, 409);
  assert.equal((await SpecialOrder.findById(order._id)).status, 'In Progress');
  assert.equal((await PaymentLedger.findOne({ specialOrder: order._id })).amountPaidCentavos, 1515);
  assert.equal(await Sale.countDocuments({ specialOrderId: order._id }), 1);
});
