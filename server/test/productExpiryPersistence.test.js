const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const publishedRealtimeEvents = [];

// Exercise real product, embedded batch and audit persistence in a disposable DB.
// Never load .env or connect to application data; avoid realtime heartbeat timers.
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: new Proxy({}, {
    get: (_target, eventName) => (...args) => publishedRealtimeEvents.push({ eventName: String(eventName), args }),
  }),
};
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const Category = require('../src/models/Category');
const InventoryLog = require('../src/models/InventoryLog');
const ActivityLog = require('../src/models/ActivityLog');
const ExpiryBatch = require('../src/models/ExpiryBatch');
const ExpiryBatchCorrection = require('../src/models/ExpiryBatchCorrection');
const ExpiryBatchReferenceCounter = require('../src/models/ExpiryBatchReferenceCounter');
const ExpiryBatchReceipt = require('../src/models/ExpiryBatchReceipt');
const ExpiryBatchMovement = require('../src/models/ExpiryBatchMovement');
const ExpiryBatchReconciliation = require('../src/models/ExpiryBatchReconciliation');
const SpecialOrderStockReservation = require('../src/models/SpecialOrderStockReservation');
const SpecialOrderStockOperation = require('../src/models/SpecialOrderStockOperation');
const SpecialOrder = require('../src/models/SpecialOrder');
const SpecialOrderQuotation = require('../src/models/SpecialOrderQuotation');
const { writeActivityLog: writeBestEffortActivityLog, writeInventoryLog: writeBestEffortInventoryLog } = require('../src/services/logService');
const { correctExpiryBatchDate, createProduct, listProducts, listProductImages, listExpiryBatches, listExpiryBatchMonitoring, reconcileProductExpiryBatches, verifyExpiryBatchesAndAddStock, updateProduct, updateProductStock } = require('../src/controllers/productController');
const { allocateUnreservedBatches, consumeReservedExpiryBatches, getExpiryBatchAvailability, restoreSaleBatches, selectAllocations } = require('../src/services/expiryBatchAllocationService');
const { applyStockOperation, getStockAvailability } = require('../src/services/specialOrderStockService');
const { __test: { consumePhaseFiveStock, validateSpecialOrderBatchVerifications } } = require('../src/controllers/specialOrderController');
const productRoutes = require('../src/routes/productRoutes');
const { __test: { executeSaleCreation } } = require('../src/controllers/saleController');
const { executeSaleVoid } = require('../src/services/saleVoidService');
const Sale = require('../src/models/Sale');
const { getManilaBusinessDate } = require('../src/utils/productExpiry');
const { createExpiryTrackingPeriodId } = require('../src/services/expiryBatchLifecycle');
const {
  backfillMissingExpiryBatchReferences,
  ensureCounterExists,
  nextExpiryBatchReference,
} = require('../src/services/expiryBatchReferenceService');
const actor = { _id: new mongoose.Types.ObjectId(), name: 'Expiry Tester', role: 'admin' };
let temporaryDirectory;
let mongo;

test.before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'product-expiry-test-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const replicaSetName = 'product-expiry-test';
  const binary = process.env.PRODUCT_TEST_MONGOD || (process.platform === 'win32' ? 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' : 'mongod');
  mongo = spawn(binary, ['--dbpath', temporaryDirectory, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', replicaSetName, '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let startupError;
  mongo.on('error', (error) => { startupError = error; });
  const directUri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  const client = new mongoose.mongo.MongoClient(directUri, { serverSelectionTimeoutMS: 500 });
  const deadline = Date.now() + 30000;
  for (;;) {
    if (startupError) throw startupError;
    if (mongo.exitCode !== null) throw new Error('Disposable MongoDB exited during startup.');
    if (Date.now() > deadline) throw new Error('Disposable MongoDB startup timed out.');
    try {
      await client.connect();
      break;
    } catch { /* Retry only this fresh local database. */ }
  }
  try {
    await client.db('admin').command({ replSetInitiate: { _id: replicaSetName, members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  } catch (error) {
    if (error.codeName !== 'AlreadyInitialized') throw error;
  }
  let isPrimary = false;
  while (!isPrimary && Date.now() <= deadline) {
    try {
      const hello = await client.db('admin').command({ hello: 1 });
      isPrimary = hello.isWritablePrimary === true;
    } catch { /* Replica set is still electing its single node. */ }
    if (!isPrimary) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await client.close();
  if (!isPrimary) throw new Error('Disposable MongoDB replica set did not elect a primary.');
  await mongoose.connect(`mongodb://127.0.0.1:${port}/product_expiry_test?replicaSet=${replicaSetName}`, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([Product.init(), User.init(), Sale.init(), Category.init(), InventoryLog.init(), ActivityLog.init(), ExpiryBatch.init(), ExpiryBatchCorrection.init(), ExpiryBatchReferenceCounter.init(), ExpiryBatchReceipt.init(), ExpiryBatchMovement.init(), ExpiryBatchReconciliation.init(), SpecialOrderStockReservation.init(), SpecialOrderStockOperation.init(), SpecialOrderQuotation.init(), SpecialOrder.init()]);
  await Category.create({ name: 'Paints', sizeUnits: ['can', 'liter (L)'], attributeSchemaVersion: 1, productAttributes: [{ name: 'Color', key: 'color', type: 'text' }] });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null && mongo.signalCode === null) {
    const exited = once(mongo, 'exit');
    mongo.kill();
    await exited;
  }
  // Remove only the newly created, resolved test directory under the OS temp dir.
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('product-expiry-test-')) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('best-effort logging helpers keep returning null for unrelated callers when log persistence fails', async () => {
  const eventStart = publishedRealtimeEvents.length;
  const originalActivityCreate = ActivityLog.create;
  const originalInventoryCreate = InventoryLog.create;
  const originalWarn = console.warn;
  ActivityLog.create = async () => { throw new Error('Simulated best-effort activity log failure'); };
  InventoryLog.create = async () => { throw new Error('Simulated best-effort inventory log failure'); };
  console.warn = () => {};
  try {
    assert.equal(await writeBestEffortActivityLog({ action: 'Best effort compatibility check' }), null);
    assert.equal(await writeBestEffortInventoryLog({ action: 'ADD', code: 'BEST-EFFORT-COMPAT' }), null);
  } finally {
    ActivityLog.create = originalActivityCreate;
    InventoryLog.create = originalInventoryCreate;
    console.warn = originalWarn;
  }
  assert.equal(publishedRealtimeEvents.length, eventStart);
});

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const payload = (key, overrides = {}) => ({
  name: `Expiry ${key}`, category: 'Paints', attributes: { color: key }, price: 123.45, purchaseCost: 45.67,
  stock: 37, sellingUnit: 'can', expiryTrackingEnabled: true, clientRequestId: `expiry:${key}`,
  initialStockBatch: { expiryDate: '2028-02-29', lotNumber: ' LOT-42 ', quantityReceived: 999, sellingUnit: 'wrong' },
  ...overrides,
});
const invoke = async (body, id) => {
  const res = response();
  const requestBody = body.expiryTrackingEnabled === false
    && !Object.prototype.hasOwnProperty.call(body, 'expiryTrackingDisableReason')
    ? { ...body, expiryTrackingDisableReason: 'Correct accidental expiry classification' }
    : body;
  const req = { body: requestBody, params: { id }, user: actor, ip: '127.0.0.1', get: () => '' };
  await (id ? updateProduct : createProduct)(req, res, (error) => { throw error; });
  return res;
};
const invokeStock = async (id, body, user = actor) => {
  const res = response();
  const req = { body, params: { id }, user, ip: '127.0.0.1', get: () => '' };
  await updateProductStock(req, res, (error) => { throw error; });
  return res;
};
const invokeProductsList = async (user = actor, query = {}) => {
  const res = response();
  await listProducts({ user, query }, res, (error) => { throw error; });
  return res;
};
const invokeProductImagesList = async (ids, user = actor) => {
  const res = response();
  const query = ids === undefined ? {} : { ids: Array.isArray(ids) ? ids.join(',') : ids };
  await listProductImages({ user, query }, res, (error) => { throw error; });
  return res;
};
const invokeBatchList = async (id, query = {}, user = actor) => {
  const res = response();
  await listExpiryBatches({ params: { id }, query, user }, res, (error) => { throw error; });
  return res;
};
const invokeExpiryCorrection = async (id, batchId, body, user = actor) => {
  const res = response();
  await correctExpiryBatchDate({
    body, params: { id, batchId }, user, ip: '127.0.0.1', get: () => '',
  }, res, (error) => { throw error; });
  return res;
};
const invokeExpiryMonitoring = async () => {
  const res = response();
  await listExpiryBatchMonitoring({}, res, (error) => { throw error; });
  return res;
};
const invokeReconciliation = async (id, body) => {
  const product = await Product.findById(id).lean();
  const activeBatches = product?.expiryTrackingPeriodId
    ? await ExpiryBatch.find({ product: product._id, trackingPeriodId: product.expiryTrackingPeriodId, trackingPeriodClosedAt: null }).lean()
    : [];
  const requestBody = {
    expectedUnassignedStock: product?.expiryTrackingPeriodId
      ? Number(product.expiryUnassignedStock || 0)
      : Number(product?.stock || 0),
    recordedBatchVersions: activeBatches.map((batch) => ({ batchRecordId: String(batch._id), updatedAt: batch.updatedAt })),
    ...body,
  };
  const res = response();
  await reconcileProductExpiryBatches({ body: requestBody, params: { id }, user: actor, ip: '127.0.0.1', get: () => '' }, res, (error) => { throw error; });
  return res;
};
const invokeVerifyAndStockIn = async (id, body) => {
  const res = response();
  await verifyExpiryBatchesAndAddStock({ body, params: { id }, user: actor, ip: '127.0.0.1', get: () => '' }, res, (error) => { throw error; });
  return res;
};
const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
};
const manilaDateOffset = (offset) => new Date(Date.parse(`${getManilaBusinessDate()}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const createTrackedProduct = async (key, { stock, reservedStock = 0 } = {}) => Product.create({
  name: `Batch ${key}`, sku: `BATCH-${key}`.toUpperCase(), sellingUnit: 'pcs', category: 'General',
  price: 10, stock, reservedStock, expiryTrackingEnabled: true, expiryTrackingPeriodId: createExpiryTrackingPeriodId(), expiryBatchReconciled: true,
});
const createToggleProduct = async (key, { stock = 0, reservedStock = 0 } = {}) => Product.create({
  name: `Toggle ${key}`, sku: `TOGGLE-${key}`.toUpperCase(), sellingUnit: 'pcs', category: 'General',
  price: 10, stock, reservedStock, expiryTrackingEnabled: true, expiryTrackingPeriodId: createExpiryTrackingPeriodId(), expiryBatchReconciled: false,
});
const createBatch = async (product, key, expiryDate, remainingQuantity, reservedQuantity = 0) => {
  const receivedAt = new Date();
  await ensureCounterExists(getManilaBusinessDate(receivedAt));
  let batch;
  await runInTransaction(async (session) => {
    const batchReference = await nextExpiryBatchReference({ createdAt: receivedAt, session });
    [batch] = await ExpiryBatch.create([{
      product: product._id, sku: product.sku, trackingPeriodId: product.expiryTrackingPeriodId || null,
      batchId: `EB-${key}-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
      batchReference, lotNumber: key, lotKey: key, expiryDate, quantityReceived: remainingQuantity,
      remainingQuantity, reservedQuantity, receivedAt, receivedBy: actor._id,
    }], { session });
  });
  return batch;
};
const stockOutBatchAllocation = (batch, quantity) => ({
  batch: String(batch._id),
  batchId: batch.batchId,
  expiryDate: batch.expiryDate,
  updatedAt: batch.updatedAt.toISOString(),
  quantity,
});
const makeBatchVerification = async (product, quantity, { verifiedAllocations = null, reason = '' } = {}) => {
  const availability = await getExpiryBatchAvailability(product);
  const proposedAllocations = selectAllocations(availability.batches, quantity).map(({ batch, quantity: assigned }) => ({
    batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: assigned,
  }));
  const verified = verifiedAllocations || proposedAllocations;
  return [{
    productId: String(product._id), proposedAllocations, verifiedAllocations: verified, reason,
    productStock: Number(product.stock || 0),
    productReserved: Number(product.reservedStock || 0),
  }];
};
const trackedStockIn = async (productId, requestId, { quantity = 1, expiryDate = '2028-05-01', lotNumber = 'RESTOCK-1', enableTracking = false, ...extra } = {}, user = actor) => {
  const current = await Product.findById(productId);
  return invokeStock(String(productId), {
    stock: current.stock + quantity,
    expectedStock: current.stock,
    expectedUpdatedAt: current.updatedAt.toISOString(),
    adjustmentRequestId: requestId,
    adjustmentType: 'IN',
    adjustmentQuantity: quantity,
    inventoryAdjustmentReason: 'Delivery',
    expiryBatch: { expiryDate, lotNumber, ...(enableTracking ? { enableTracking: true } : {}) },
    ...extra,
  }, user);
};

test('tracked initial receipt stores exact SKU quantity/unit and retains CREATE audit behavior', async () => {
  const res = await invoke(payload('initial'));
  assert.equal(res.statusCode, 201);
  const saved = await Product.findById(res.body._id).lean();
  assert.equal(saved.stock, 37);
  assert.equal(saved.sellingUnit, 'can');
  assert.equal(saved.expiryTrackingEnabled, true);
  assert.equal(saved.expiryBatchReconciled, true);
  assert.ok(saved.initialStockBatch._id);
  assert.equal(saved.initialStockBatch.quantityReceived, 37);
  assert.equal(saved.initialStockBatch.sellingUnit, 'can');
  assert.equal(saved.initialStockBatch.expiryDate, '2028-02-29');
  assert.equal(saved.initialStockBatch.lotNumber, 'LOT-42');
  assert.equal(String(saved.initialStockBatch.receivedBy), String(actor._id));
  const [batch] = await ExpiryBatch.find({ product: saved._id }).lean();
  assert.equal(batch.sku, saved.sku);
  assert.equal(batch.expiryDate, '2028-02-29');
  assert.equal(batch.lotNumber, 'LOT-42');
  assert.equal(batch.quantityReceived, 37);
  assert.equal(batch.remainingQuantity, 37);
  assert.match(batch.batchId, /^EB-[A-F0-9]{24}$/);
  assert.match(batch.batchReference, /^BT-\d{8}-\d{3,}$/);
  const openingReceipt = await ExpiryBatchReceipt.findOne({ product: saved._id }).lean();
  assert.equal(openingReceipt.quantity, 37);
  assert.equal(openingReceipt.stockBefore, 0);
  assert.equal(openingReceipt.stockAfter, 37);
  const log = await InventoryLog.findOne({ productRef: saved._id });
  assert.equal(log.action, 'CREATE');
  assert.equal(log.quantity, 37);
  assert.equal(log.stockBefore, 0);
  assert.equal(log.stockAfter, 37);
  assert.equal(await InventoryLog.countDocuments({ productRef: saved._id, action: 'CREATE' }), 1);
  assert.equal(await ActivityLog.countDocuments({ details: `Created ${saved.name} (${saved.sku})` }), 1);
});

test('opening expiry product creation rolls back product, batch, and audit records when either required audit write fails', async () => {
  for (const [key, model] of [
    ['inventory-log', InventoryLog],
    ['activity-log', ActivityLog],
  ]) {
    const requestBody = payload(`opening-audit-rollback-${key}`);
    const eventStart = publishedRealtimeEvents.length;
    const [productCount, batchCount, receiptCount, movementCount, inventoryLogCount, activityLogCount] = await Promise.all([
      Product.countDocuments(), ExpiryBatch.countDocuments(), ExpiryBatchReceipt.countDocuments(),
      ExpiryBatchMovement.countDocuments(), InventoryLog.countDocuments(), ActivityLog.countDocuments(),
    ]);
    const originalCreate = model.create;
    model.create = async () => { throw new Error(`Simulated ${key} write failure`); };
    try {
      await assert.rejects(invoke(requestBody), new RegExp(`Simulated ${key} write failure`));
    } finally {
      model.create = originalCreate;
    }

    assert.equal(await Product.countDocuments(), productCount);
    assert.equal(await ExpiryBatch.countDocuments(), batchCount);
    assert.equal(await ExpiryBatchReceipt.countDocuments(), receiptCount);
    assert.equal(await ExpiryBatchMovement.countDocuments(), movementCount);
    assert.equal(await InventoryLog.countDocuments(), inventoryLogCount);
    assert.equal(await ActivityLog.countDocuments(), activityLogCount);
    assert.equal(publishedRealtimeEvents.length, eventStart, 'failed creation emits no realtime success events');
  }
});

test('untracked and zero-stock creation keep their quantities and create no initial batch', async () => {
  for (const [key, overrides] of [
    ['untracked', { expiryTrackingEnabled: false, initialStockBatch: undefined }],
    ['zero', { stock: 0, initialStockBatch: undefined }],
  ]) {
    const body = payload(key, overrides);
    const res = await invoke(body);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.stock, body.stock);
    if (key === 'zero') {
      assert.equal(res.body.initialStockBatch, null);
      assert.equal(await ExpiryBatch.countDocuments({ product: res.body._id }), 0);
    } else {
      assert.equal(res.body.initialStockBatch, null);
    }
    assert.equal(res.body.expiryTrackingEnabled, body.expiryTrackingEnabled);
  }
});

test('invalid initial expiry rejects creation before any product or stock receipt is saved', async () => {
  for (const [index, overrides] of [
    { initialStockBatch: undefined },
    { initialStockBatch: { expiryDate: '2027-02-29' } },
    { initialStockBatch: { expiryDate: '2028-02-29T00:00:00Z' } },
    { initialStockBatch: { expiryDate: '2028-02-29', lotNumber: 'X'.repeat(101) } },
    { expiryTrackingEnabled: 'true' },
    { clientRequestId: '' },
    { clientRequestId: {} },
  ].entries()) {
    const body = payload(`invalid-${index}`, overrides);
    const res = await invoke(body);
    assert.equal(res.statusCode, 400);
    assert.equal(await Product.countDocuments({ name: body.name }), 0);
  }
});

test('manual API submissions reject yesterday and today and accept tomorrow in Manila', async () => {
  const today = getManilaBusinessDate();
  const dateFromToday = (offset) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  for (const [key, date] of [['yesterday', dateFromToday(-1)], ['today', today]]) {
    const body = payload(`api-${key}`, { initialStockBatch: { expiryDate: date } });
    const res = await invoke(body);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Expiry date must be later than today.');
    assert.equal(await Product.countDocuments({ clientRequestId: body.clientRequestId }), 0);
  }
  const tomorrow = dateFromToday(1);
  const accepted = await invoke(payload('api-tomorrow', { initialStockBatch: { expiryDate: tomorrow } }));
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.initialStockBatch.expiryDate, tomorrow);
});

test('concurrent retries create one product, one initial batch and one CREATE log', async () => {
  for (const sku of ['', 'MANUAL-EXPIRY-001']) {
    const key = sku ? 'manual-retry' : 'generated-retry';
    const body = payload(key, { sku });
    const results = await Promise.all(Array.from({ length: 8 }, () => invoke(body)));
    assert.ok(results.every((res) => [200, 201].includes(res.statusCode)), results.map((res) => res.statusCode).join(','));
    assert.equal(results.filter((res) => res.statusCode === 201).length, 1);
    assert.equal(new Set(results.map((res) => String(res.body._id))).size, 1);
    assert.equal(new Set(results.map((res) => String(res.body.initialStockBatch._id))).size, 1);
    assert.equal(await Product.countDocuments({ clientRequestId: body.clientRequestId }), 1);
    assert.equal(await InventoryLog.countDocuments({ productRef: results[0].body._id }), 1);
    assert.equal(await ExpiryBatch.countDocuments({ product: results[0].body._id }), 1);
    assert.equal(await ExpiryBatchReceipt.countDocuments({ product: results[0].body._id }), 1);
    const replay = await invoke({ ...body, stock: 88 });
    assert.equal(replay.body.stock, 37);
    assert.equal(replay.body.initialStockBatch.quantityReceived, 37);
  }
});

test('failed insert leaves no partial SKU or batch and the same token can retry safely', async () => {
  const body = payload('failed-insert');
  const original = Product.collection.insertOne;
  Product.collection.insertOne = async () => { throw new Error('Simulated insert failure'); };
  try {
    await assert.rejects(invoke(body), /Simulated insert failure/);
    assert.equal(await Product.countDocuments({ clientRequestId: body.clientRequestId }), 0);
  } finally {
    Product.collection.insertOne = original;
  }
  const retry = await invoke(body);
  assert.equal(retry.statusCode, 201);
  assert.equal(retry.body.initialStockBatch.quantityReceived, 37);
});

test('tracked Stock-In records distinct expiry batches and merges matching labelled lots', async () => {
  const created = await invoke(payload('stock-in-batches', { stock: 10 }));
  const productId = String(created.body._id);
  const first = await trackedStockIn(productId, 'expiry-stock-in:1', { quantity: 4, expiryDate: '2028-05-01', lotNumber: 'LOT-A' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.stock, 14);
  const firstBatchReference = (await ExpiryBatch.findOne({ product: productId, expiryDate: '2028-05-01' }).lean()).batchReference;
  const replay = await trackedStockIn(productId, 'expiry-stock-in:1', { quantity: 4, expiryDate: '2028-05-01', lotNumber: 'LOT-A' });
  assert.equal(replay.body.stock, 14);
  assert.equal((await ExpiryBatch.findOne({ product: productId, expiryDate: '2028-05-01' }).lean()).batchReference, firstBatchReference, 'idempotent retry preserves the original display reference');
  const mismatchedReplay = await trackedStockIn(productId, 'expiry-stock-in:1', { quantity: 6, expiryDate: '2028-05-01', lotNumber: 'LOT-A' });
  assert.equal(mismatchedReplay.statusCode, 409);
  assert.equal((await Product.findById(productId)).stock, 14);
  const sameBatch = await trackedStockIn(productId, 'expiry-stock-in:2', { quantity: 3, expiryDate: '2028-05-01', lotNumber: ' lot-a ' });
  assert.equal(sameBatch.body.stock, 17);
  await trackedStockIn(productId, 'expiry-stock-in:3', { quantity: 5, expiryDate: '2028-06-01', lotNumber: 'LOT-B' });
  await trackedStockIn(productId, 'expiry-stock-in:4', { quantity: 2, expiryDate: '2028-08-01', lotNumber: '' });

  const batches = await ExpiryBatch.find({ product: productId }).sort({ expiryDate: 1 }).lean();
  assert.equal(batches.length, 4);
  assert.deepEqual(batches.map(({ expiryDate, lotNumber, quantityReceived, remainingQuantity }) => ({ expiryDate, lotNumber, quantityReceived, remainingQuantity })), [
    { expiryDate: '2028-02-29', lotNumber: 'LOT-42', quantityReceived: 10, remainingQuantity: 10 },
    { expiryDate: '2028-05-01', lotNumber: 'LOT-A', quantityReceived: 7, remainingQuantity: 7 },
    { expiryDate: '2028-06-01', lotNumber: 'LOT-B', quantityReceived: 5, remainingQuantity: 5 },
    { expiryDate: '2028-08-01', lotNumber: '', quantityReceived: 2, remainingQuantity: 2 },
  ]);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 5);
  assert.equal(await InventoryLog.countDocuments({ productRef: productId, action: 'ADD' }), 4);
  const listed = await invokeBatchList(productId);
  assert.equal(listed.body.provisional, false);
  assert.equal(listed.body.reconciled, true);
  assert.equal(listed.body.productStock, 24);
  assert.equal(listed.body.batchRemainingTotal, 24);
  assert.equal(listed.body.provisionalDifferenceFromProductStock, 0);
  assert.ok(listed.body.batches.every((batch) => /^BT-\d{8}-\d{3,}$/.test(batch.batchReference)));
  const monitored = (await invokeExpiryMonitoring()).body.batches.filter((batch) => batch.productId === productId);
  assert.ok(monitored.every((batch) => /^BT-\d{8}-\d{3,}$/.test(batch.batchReference)));
});

test('product listing can omit image payloads and retrieves legacy image references separately', async () => {
  const imageDataUrl = 'data:image/png;base64,AAECAwQFBgc=';
  const product = await Product.create({
    name: 'Image Payload Check', sku: 'IMAGE-PAYLOAD-CHECK', category: 'General',
    price: 10, stock: 2, sellingUnit: 'pcs', imageUrl: imageDataUrl,
  });

  const compact = (await invokeProductsList(actor, { includeImages: 'false' })).body
    .find((row) => String(row._id) === String(product._id));
  assert.equal(Object.prototype.hasOwnProperty.call(compact, 'imageUrl'), false);

  const full = (await invokeProductsList()).body
    .find((row) => String(row._id) === String(product._id));
  assert.equal(full.imageUrl, imageDataUrl);

  const imageReferences = await invokeProductImagesList([String(product._id)]);
  assert.deepEqual(imageReferences.body.find((row) => row.id === String(product._id)), {
    id: String(product._id), code: product.sku, imageUrl: imageDataUrl,
  });
  assert.equal(imageReferences.body.length, 1, 'image endpoint returns only requested records');
  const tooManyIds = await invokeProductImagesList(Array.from({ length: 51 }, () => String(new mongoose.Types.ObjectId())));
  assert.equal(tooManyIds.statusCode, 400);
  const invalidIds = await invokeProductImagesList(['not-an-object-id']);
  assert.equal(invalidIds.statusCode, 400);
  const unscoped = await invokeProductImagesList();
  assert.equal(unscoped.statusCode, 400, 'the image endpoint rejects unbounded full-catalog reads');
});

test('tracked Stock-In responses fail closed for missing-period and unreconciled products while untracked availability stays aggregate-based', async () => {
  const missingPeriod = await Product.create({
    name: 'Stock-In Availability Missing Period', sku: 'STOCK-IN-AVAIL-MISSING-PERIOD', category: 'General',
    price: 10, stock: 5, reservedStock: 1, sellingUnit: 'pcs', expiryTrackingEnabled: true,
    expiryTrackingPeriodId: null, expiryBatchReconciled: true, expiryUnassignedStock: 5,
  });
  const missingPeriodReceipt = await trackedStockIn(String(missingPeriod._id), 'availability:stock-in:missing-period', {
    quantity: 2, expiryDate: '2028-05-01', lotNumber: 'MISSING-PERIOD-RECEIPT',
  });
  assert.equal(missingPeriodReceipt.statusCode, 200, missingPeriodReceipt.body?.message);
  assert.equal(missingPeriodReceipt.body.stock, 7);
  assert.equal(missingPeriodReceipt.body.availableToSell, 0, 'unassigned stock is not saleable while a new period requires verification');
  let listed = (await invokeProductsList()).body.find((product) => String(product._id) === String(missingPeriod._id));
  assert.equal(listed.availableToSell, missingPeriodReceipt.body.availableToSell);

  const unreconciled = await createToggleProduct('stock-in-availability-unreconciled', { stock: 5, reservedStock: 1 });
  unreconciled.expiryUnassignedStock = 5;
  await unreconciled.save();
  const unreconciledReceipt = await trackedStockIn(String(unreconciled._id), 'availability:stock-in:unreconciled', {
    quantity: 2, expiryDate: '2028-06-01', lotNumber: 'UNRECONCILED-RECEIPT',
  });
  assert.equal(unreconciledReceipt.statusCode, 409);
  assert.equal(unreconciledReceipt.body.availableToSell, undefined, 'a rejected receipt does not report aggregate stock as saleable');
  assert.equal((await Product.findById(unreconciled._id)).stock, 5, 'unreconciled stock remains unchanged until verification');
  listed = (await invokeProductsList()).body.find((product) => String(product._id) === String(unreconciled._id));
  assert.equal(listed.availableToSell, 0);

  const untracked = await Product.create({
    name: 'Stock-In Availability Untracked', sku: 'STOCK-IN-AVAIL-UNTRACKED', category: 'General',
    price: 10, stock: 5, reservedStock: 1, sellingUnit: 'pcs', expiryTrackingEnabled: false,
  });
  const untrackedReceipt = await invokeStock(String(untracked._id), {
    stock: 7, expectedStock: 5, expectedUpdatedAt: untracked.updatedAt.toISOString(),
    adjustmentRequestId: 'availability:stock-in:untracked', adjustmentType: 'IN',
    adjustmentQuantity: 2, inventoryAdjustmentReason: 'Delivery',
  });
  assert.equal(untrackedReceipt.statusCode, 200, untrackedReceipt.body?.message);
  listed = (await invokeProductsList()).body.find((product) => String(product._id) === String(untracked._id));
  assert.equal(listed.availableToSell, 6, 'untracked stock continues to use aggregate stock less reservations');
});

test('expiry-tracked Stock-In accepts actual past and current dates but rejects invalid dates', async () => {
  const created = await invoke(payload('stock-in-invalid', { stock: 8 }));
  const productId = String(created.body._id);
  const invalidDate = await trackedStockIn(productId, 'expiry-stock-in:invalid-date', { expiryDate: '2020-02-30' });
  assert.equal(invalidDate.statusCode, 400);
  assert.equal((await Product.findById(productId)).stock, 8);

  const currentDate = getManilaBusinessDate();
  const yesterday = manilaDateOffset(-1);
  const past = await trackedStockIn(productId, 'expiry-stock-in:past-date', { expiryDate: yesterday, lotNumber: 'EXPIRED-LOT' });
  assert.equal(past.statusCode, 200);
  const today = await trackedStockIn(productId, 'expiry-stock-in:today-date', { expiryDate: currentDate, lotNumber: 'TODAY-LOT' });
  assert.equal(today.statusCode, 200);
  const updated = await Product.findById(productId);
  assert.equal(updated.stock, 10);
  const availability = await getExpiryBatchAvailability(updated);
  assert.equal(availability.availableToSell, 8, 'expired and today-expiring batches are not saleable');
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 3);
});

test('Add Stock atomically enables tracking and records the first batch for zero-stock products', async () => {
  const created = await invoke(payload('activate-expiry-zero', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const saved = await Product.findById(productId).lean();
  const eventStart = publishedRealtimeEvents.length;
  const received = await trackedStockIn(productId, 'expiry-enable-zero:1', {
    quantity: 3, expiryDate: manilaDateOffset(-1), lotNumber: 'FIRST-LOT', enableTracking: true,
  });
  assert.equal(received.statusCode, 200);
  assert.equal(received.body.stock, 3);
  assert.equal(received.body.expiryTrackingEnabled, true);
  assert.equal(received.body.expiryBatchReconciled, true);
  assert.equal((await Product.findById(productId)).stock, 3);
  const batch = await ExpiryBatch.findOne({ product: productId }).lean();
  assert.equal(batch.expiryDate, manilaDateOffset(-1));
  assert.equal(batch.remainingQuantity, 3);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 1);
  const receipt = await ExpiryBatchReceipt.findOne({ product: productId }).lean();
  assert.equal(receipt.enabledExpiryTracking, true);
  assert.ok(receipt.batchMovementRef);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: productId, type: 'STOCK_IN' }), 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: productId, action: 'ADD' }), 1);
  assert.ok(await ActivityLog.exists({ userRef: actor._id, action: 'Enabled Expiry Tracking and Added Stock' }));
  assert.ok(publishedRealtimeEvents.slice(eventStart).some((event) => event.eventName === 'publishInventoryUpdated'));
  assert.equal(saved.stock, 0);
});

test('Add Stock verifies pre-existing stock before recording a new expiry-tracked delivery', async () => {
  const created = await invoke(payload('activate-expiry-positive', {
    stock: 6, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const prematureEnableAndReceipt = await trackedStockIn(productId, 'expiry-enable-positive:premature', {
    quantity: 2, expiryDate: '2028-09-01', lotNumber: 'INCOMING-LOT', enableTracking: true,
  });
  assert.equal(prematureEnableAndReceipt.statusCode, 409);
  assert.equal((await Product.findById(productId)).stock, 6);
  assert.equal((await Product.findById(productId)).expiryTrackingEnabled, false);

  const enabled = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: created.body.updatedAt.toISOString(),
  }, productId);
  assert.equal(enabled.statusCode, 200, enabled.body?.message);
  assert.equal(enabled.body.stock, 6, 'tracking activation does not add stock');
  assert.equal(enabled.body.expiryTrackingEnabled, true);
  assert.equal(enabled.body.expiryBatchReconciled, false);
  assert.equal(enabled.body.expiryUnassignedStock, 6);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: productId }), 0);
  const listed = await invokeBatchList(productId);
  assert.equal(listed.body.reconciled, false);
  assert.equal(listed.body.productStock, 6);
  assert.equal(listed.body.batchRemainingTotal, 0);
  assert.equal(listed.body.provisionalDifferenceFromProductStock, 6, 'existing aggregate stock stays unassigned');
  assert.equal(listed.body.existingStockToVerify, 6);
  assert.equal(listed.body.newStockRecorded, 0);
  assert.equal(listed.body.receiptLedgerValid, true);
  assert.equal(listed.body.stockPartitionValid, true);

  const blockedReceipt = await trackedStockIn(productId, 'expiry-enable-positive:blocked-delivery', {
    quantity: 2, expiryDate: '2028-09-01', lotNumber: 'INCOMING-LOT',
  });
  assert.equal(blockedReceipt.statusCode, 409);
  assert.equal((await Product.findById(productId)).stock, 6);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 0);

  const verified = await invokeReconciliation(productId, {
    requestId: 'expiry-enable-positive:verify',
    expectedStock: 6,
    expectedUnassignedStock: 6,
    expectedUpdatedAt: listed.body.productUpdatedAt,
    batches: [
      { expiryDate: '2028-08-01', lotNumber: 'PHYSICAL-OLD-LOT', quantity: 6 },
    ],
  });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.body.reconciled, true);
  assert.equal((await Product.findById(productId)).stock, 6, 'verification does not change aggregate stock');
  const received = await trackedStockIn(productId, 'expiry-enable-positive:receipt', {
    quantity: 2, expiryDate: '2028-09-01', lotNumber: 'INCOMING-LOT',
  });
  assert.equal(received.statusCode, 200, received.body?.message);
  assert.equal(received.body.stock, 8);
  assert.equal(received.body.expiryBatchReconciled, true);
  const afterVerification = await invokeBatchList(productId);
  assert.equal(afterVerification.body.batchRemainingTotal, 8);
  assert.equal(afterVerification.body.batches.length, 2);
  const incomingBatch = afterVerification.body.batches.find((batch) => batch.lotNumber === 'INCOMING-LOT');
  assert.equal(incomingBatch.remainingQuantity, 2);
  assert.equal(incomingBatch.quantityReceived, 2);
});

test('tracking activation is administrator-only, idempotent, and rolls back with failed audit writes', async () => {
  const cashierProduct = await invoke(payload('activate-expiry-cashier', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const cashierAttempt = await trackedStockIn(String(cashierProduct.body._id), 'expiry-enable-cashier:1', {
    quantity: 1, expiryDate: '2028-10-01', enableTracking: true,
  }, { role: 'cashier', _id: new mongoose.Types.ObjectId(), name: 'Cashier' });
  assert.equal(cashierAttempt.statusCode, 403);
  assert.equal((await Product.findById(cashierProduct.body._id)).expiryTrackingEnabled, false);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: cashierProduct.body._id }), 0);

  const invalidProduct = await invoke(payload('activate-expiry-invalid', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const missingDate = await trackedStockIn(String(invalidProduct.body._id), 'expiry-enable-missing-date:1', {
    quantity: 1, expiryDate: '', enableTracking: true,
  });
  assert.equal(missingDate.statusCode, 400);
  assert.equal((await Product.findById(invalidProduct.body._id)).expiryTrackingEnabled, false);
  assert.equal((await Product.findById(invalidProduct.body._id)).stock, 0);
  const invalidDate = await trackedStockIn(String(invalidProduct.body._id), 'expiry-enable-invalid:1', {
    quantity: 1, expiryDate: '2028-02-30', enableTracking: true,
  });
  assert.equal(invalidDate.statusCode, 400);
  assert.equal((await Product.findById(invalidProduct.body._id)).expiryTrackingEnabled, false);
  assert.equal((await Product.findById(invalidProduct.body._id)).stock, 0);

  const duplicateProduct = await invoke(payload('activate-expiry-retry', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const duplicateResults = await Promise.all(Array.from({ length: 4 }, () => trackedStockIn(String(duplicateProduct.body._id), 'expiry-enable-retry:1', {
    quantity: 2, expiryDate: '2028-10-01', lotNumber: 'RETRY-LOT', enableTracking: true,
  })));
  assert.ok(duplicateResults.every((result) => [200, 409].includes(result.statusCode)));
  assert.equal((await Product.findById(duplicateProduct.body._id)).stock, 2);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: duplicateProduct.body._id }), 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: duplicateProduct.body._id, action: 'ADD' }), 1);

  const rollbackProduct = await invoke(payload('activate-expiry-rollback', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const eventStart = publishedRealtimeEvents.length;
  const originalCreate = InventoryLog.create;
  InventoryLog.create = async () => { throw new Error('Simulated audit write failure'); };
  try {
    await assert.rejects(trackedStockIn(String(rollbackProduct.body._id), 'expiry-enable-rollback:1', {
      quantity: 4, expiryDate: '2028-11-01', enableTracking: true,
    }), /Simulated audit write failure/);
  } finally {
    InventoryLog.create = originalCreate;
  }
  const unchanged = await Product.findById(rollbackProduct.body._id);
  assert.equal(unchanged.stock, 0);
  assert.equal(unchanged.expiryTrackingEnabled, false);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: rollbackProduct.body._id }), 0);
  assert.equal(await ExpiryBatch.countDocuments({ product: rollbackProduct.body._id }), 0);
  assert.equal(publishedRealtimeEvents.length, eventStart, 'aborted activation and receipt emit no success events');
});

test('Add Stock atomically verifies existing physical stock and records a separate new receipt', async () => {
  const created = await invoke(payload('atomic-stock-verify', {
    stock: 5, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const originalProduct = await Product.findById(productId).lean();
  const preview = await invokeBatchList(productId, { activationPreview: 'true' });
  assert.equal(preview.statusCode, 200, preview.body?.message);
  assert.equal(preview.body.activationPreview, true);
  assert.equal(preview.body.existingStockToVerify, 5);
  assert.deepEqual(preview.body.batches, [], 'previous tracking-period batches are not offered for a new activation');
  const cashierPreview = await invokeBatchList(productId, { activationPreview: 'true' }, { ...actor, role: 'cashier' });
  assert.equal(cashierPreview.statusCode, 403);
  assert.equal((await Product.findById(productId)).expiryTrackingEnabled, false, 'opening the verification view does not persist tracking');
  assert.equal((await Product.findById(productId)).updatedAt.getTime(), originalProduct.updatedAt.getTime());

  const stockRequestId = 'atomic-stock-verify:delivery';
  const verification = {
    expectedStock: preview.body.productStock,
    expectedUnassignedStock: preview.body.existingStockToVerify,
    expectedUpdatedAt: preview.body.productUpdatedAt,
    recordedBatchVersions: [],
    batches: [
      { expiryDate: '2029-03-01', lotNumber: 'PHYSICAL-A', quantity: 2 },
      { expiryDate: '2029-04-01', lotNumber: 'PHYSICAL-B', quantity: 3 },
    ],
  };
  const received = await trackedStockIn(productId, stockRequestId, {
    quantity: 3,
    expiryDate: '2029-05-01',
    lotNumber: 'NEW-DELIVERY',
    enableTracking: true,
    expiryVerification: verification,
  });
  assert.equal(received.statusCode, 200, received.body?.message);
  assert.equal(received.body.stock, 8);
  assert.equal(received.body.expiryTrackingEnabled, true);
  assert.equal(received.body.expiryBatchReconciled, true);
  const saved = await Product.findById(productId).lean();
  const batches = await ExpiryBatch.find({ product: productId, trackingPeriodId: saved.expiryTrackingPeriodId }).lean();
  assert.equal(saved.expiryUnassignedStock, 0);
  assert.equal(batches.length, 3);
  assert.equal(batches.filter((batch) => batch.quantityReceived === 0).reduce((sum, batch) => sum + batch.remainingQuantity, 0), 5);
  const incoming = batches.find((batch) => batch.lotNumber === 'NEW-DELIVERY');
  assert.equal(incoming.quantityReceived, 3);
  assert.equal(incoming.remainingQuantity, 3);
  assert.equal(batches.reduce((sum, batch) => sum + batch.remainingQuantity, 0), saved.stock);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 1);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: productId }), 1);
  assert.equal(await ActivityLog.countDocuments({ action: 'Verified Expiry Batches', details: { $regex: saved.sku } }), 1,
    'verification audit commits with the receipt without exposing request IDs');

  const replay = await trackedStockIn(productId, stockRequestId, {
    quantity: 3,
    expiryDate: '2029-05-01',
    lotNumber: 'NEW-DELIVERY',
    enableTracking: true,
    expiryVerification: verification,
  });
  assert.equal(replay.statusCode, 200, replay.body?.message);
  assert.equal((await Product.findById(productId)).stock, 8);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 1);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: productId }), 1);
});

test('failed verification or receipt audit rolls back temporary tracking and opening allocations', async () => {
  const created = await invoke(payload('atomic-stock-verify-rollback', {
    stock: 4, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const preview = await invokeBatchList(productId, { activationPreview: 'true' });
  const verification = {
    expectedStock: preview.body.productStock,
    expectedUnassignedStock: preview.body.existingStockToVerify,
    expectedUpdatedAt: preview.body.productUpdatedAt,
    recordedBatchVersions: [],
    batches: [{ expiryDate: '2029-06-01', lotNumber: 'PHYSICAL-ROLLBACK', quantity: 4 }],
  };
  const originalActivityCreate = ActivityLog.create;
  ActivityLog.create = async () => { throw new Error('Simulated verification audit write failure'); };
  try {
    await assert.rejects(trackedStockIn(productId, 'atomic-stock-verify-rollback:delivery', {
      quantity: 2,
      expiryDate: '2029-07-01',
      lotNumber: 'ROLLBACK-DELIVERY',
      enableTracking: true,
      expiryVerification: verification,
    }), /Simulated verification audit write failure/);
  } finally {
    ActivityLog.create = originalActivityCreate;
  }
  const unchanged = await Product.findById(productId).lean();
  assert.equal(unchanged.stock, 4);
  assert.equal(unchanged.expiryTrackingEnabled, false);
  assert.equal(await ExpiryBatch.countDocuments({ product: productId }), 0);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 0);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: productId }), 0);
});

test('concurrent enable-and-stock requests from one product version cannot both commit', async () => {
  const created = await invoke(payload('activate-expiry-race', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const snapshot = await Product.findById(productId).lean();
  const submit = (requestId, expiryDate) => invokeStock(productId, {
    stock: 2,
    expectedStock: 0,
    expectedUpdatedAt: snapshot.updatedAt.toISOString(),
    adjustmentRequestId: requestId,
    adjustmentType: 'IN',
    adjustmentQuantity: 2,
    inventoryAdjustmentReason: 'Delivery',
    expiryBatch: { expiryDate, lotNumber: requestId, enableTracking: true },
  });
  const results = await Promise.all([
    submit('expiry-enable-race:a', '2028-12-01'),
    submit('expiry-enable-race:b', '2029-01-01'),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  const saved = await Product.findById(productId);
  assert.equal(saved.stock, 2);
  assert.equal(saved.expiryTrackingEnabled, true);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: productId, action: 'ADD' }), 1);
});

test('same Stock-In request submitted concurrently adds stock, receipt and history once', async () => {
  const created = await invoke(payload('stock-in-concurrent', { stock: 10 }));
  const productId = String(created.body._id);
  const results = await Promise.all(Array.from({ length: 6 }, () => trackedStockIn(productId, 'expiry-stock-in:concurrent', {
    quantity: 4, expiryDate: '2028-07-01', lotNumber: 'CONCURRENT-LOT',
  })));
  assert.ok(results.every((res) => [200, 409].includes(res.statusCode)), results.map((res) => res.statusCode).join(','));
  const saved = await Product.findById(productId);
  assert.equal(saved.stock, 14);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 2);
  assert.equal(await InventoryLog.countDocuments({ productRef: productId, action: 'ADD' }), 1);
  const batch = await ExpiryBatch.findOne({ product: productId, expiryDate: '2028-07-01' });
  assert.equal(batch.quantityReceived, 4);
  assert.equal(batch.remainingQuantity, 4);
});

test('concurrent distinct Stock-In requests using one stock snapshot cannot overstate aggregate stock', async () => {
  const created = await invoke(payload('stock-in-distinct-concurrent', { stock: 10 }));
  const productId = String(created.body._id);
  const snapshot = await Product.findById(productId).lean();
  const submit = (requestId, expiryDate) => invokeStock(productId, {
    stock: snapshot.stock + 3,
    expectedStock: snapshot.stock,
    expectedUpdatedAt: snapshot.updatedAt.toISOString(),
    adjustmentRequestId: requestId,
    adjustmentType: 'IN',
    adjustmentQuantity: 3,
    inventoryAdjustmentReason: 'Delivery',
    expiryBatch: { expiryDate, lotNumber: requestId },
  });
  const results = await Promise.all([
    submit('expiry-stock-in:concurrent-a', '2028-09-01'),
    submit('expiry-stock-in:concurrent-b', '2028-10-01'),
  ]);
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal((await Product.findById(productId)).stock, 13);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 2);
  assert.equal(await InventoryLog.countDocuments({ productRef: productId, action: 'ADD' }), 1);
});

test('legacy aggregate stock remains unassigned; non-expiry Stock-In keeps its normal path', async () => {
  const legacy = await invoke(payload('legacy-stock', { expiryTrackingEnabled: false, initialStockBatch: undefined, stock: 47 }));
  await Product.updateOne({ _id: legacy.body._id }, { $set: { expiryTrackingEnabled: true } });
  const noHistory = await invokeBatchList(String(legacy.body._id));
  assert.equal(noHistory.body.productStock, 47);
  assert.equal(noHistory.body.batchRemainingTotal, 0);
  assert.equal(noHistory.body.provisionalDifferenceFromProductStock, 47);
  assert.equal(noHistory.body.batches.length, 0);

  const nonTracked = await invoke(payload('non-expiry-stock', { expiryTrackingEnabled: false, initialStockBatch: undefined, stock: 5 }));
  const updated = await invokeStock(String(nonTracked.body._id), {
    stock: 7, expectedStock: 5, expectedUpdatedAt: nonTracked.body.updatedAt.toISOString(),
    adjustmentRequestId: 'ordinary-stock-in:1', adjustmentType: 'IN', adjustmentQuantity: 2,
    inventoryAdjustmentReason: 'Delivery',
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.stock, 7);
  assert.equal(await ExpiryBatch.countDocuments({ product: nonTracked.body._id }), 0);
});

test('re-enabling tracking verifies only old unassigned stock and preserves new receipt batches', async () => {
  const product = await createTrackedProduct('period-restart', { stock: 6 });
  const priorExpiry = manilaDateOffset(45);
  const historicalBatch = await createBatch(product, 'PERIOD-REUSED-LOT', priorExpiry, 6);
  const depletedHistory = await createBatch(product, 'PERIOD-DEPLETED-LOT', manilaDateOffset(60), 0);
  const oldPeriod = product.expiryTrackingPeriodId || null;

  const disabled = await invoke({
    expiryTrackingEnabled: false,
    expectedUpdatedAt: product.updatedAt.toISOString(),
  }, String(product._id));
  assert.equal(disabled.statusCode, 200, disabled.body?.message);
  assert.equal((await ExpiryBatch.findById(historicalBatch._id)).remainingQuantity, 6);
  const closedHistoricalBatch = await ExpiryBatch.findById(historicalBatch._id).lean();
  assert.ok(closedHistoricalBatch.trackingPeriodClosedAt);
  assert.ok(closedHistoricalBatch.trackingPeriodId);
  const whileDisabled = (await invokeExpiryMonitoring()).body.batches.filter((batch) => batch.productId === String(product._id));
  assert.equal(whileDisabled.length, 2);
  assert.ok(whileDisabled.every((batch) => batch.isHistoricalPeriod && batch.status === 'Historical'));

  const enabled = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: disabled.body.updatedAt,
  }, String(product._id));
  assert.equal(enabled.statusCode, 200, enabled.body?.message);
  assert.equal(enabled.body.stock, 6, 're-enabling tracking does not add a delivery');
  assert.equal(enabled.body.expiryBatchReconciled, false);
  const currentProduct = await Product.findById(product._id);
  assert.ok(currentProduct.expiryTrackingPeriodId);
  assert.notEqual(currentProduct.expiryTrackingPeriodId, oldPeriod);
  assert.equal(currentProduct.expiryUnassignedStock, 6);

  const activeList = await invokeBatchList(String(product._id));
  assert.equal(activeList.body.batches.length, 0, 'closed-period history is absent from current-period verification');
  assert.equal(activeList.body.batchRemainingTotal, 0);
  assert.equal(activeList.body.existingStockToVerify, 6);
  assert.equal(activeList.body.historicalBatchCount, 2);
  assert.equal((await ExpiryBatch.findById(depletedHistory._id)).remainingQuantity, 0);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0);

  const verificationRequest = {
    requestId: 'period-restart:verify',
    expectedStock: 6,
    expectedUnassignedStock: 6,
    expectedUpdatedAt: currentProduct.updatedAt.toISOString(),
    recordedBatchVersions: [],
    batches: [{ expiryDate: priorExpiry, lotNumber: 'PHYSICAL-EXISTING', quantity: 6 }],
  };
  const verified = await invokeReconciliation(String(product._id), verificationRequest);
  assert.equal(verified.statusCode, 200, verified.body?.message);
  assert.equal(verified.body.reconciled, true);
  assert.equal(verified.body.productStock, 6, 'verification never changes the aggregate stock');
  assert.equal(verified.body.existingStockToVerify, 0);
  assert.equal(verified.body.batches.length, 1, 'verification creates only the physically confirmed opening allocation');
  publishedRealtimeEvents.length = 0;
  const replay = await invokeReconciliation(String(product._id), verificationRequest);
  assert.equal(replay.statusCode, 200, replay.body?.message);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.batches.length, 1, 'retry returns the existing reconciliation without duplicating opening stock');
  assert.equal(publishedRealtimeEvents.some(({ eventName }) => eventName === 'publishInventoryUpdated'), false,
    'an idempotent replay does not publish a duplicate refresh event');

  const beforeReceipt = await Product.findById(product._id);
  const received = await trackedStockIn(String(product._id), 'period-restart:receipt', {
    quantity: 2, expiryDate: priorExpiry, lotNumber: 'PERIOD-REUSED-LOT',
    expectedUpdatedAt: beforeReceipt.updatedAt.toISOString(),
  });
  assert.equal(received.statusCode, 200, received.body?.message);
  assert.equal(received.body.stock, 8);
  assert.equal(received.body.expiryBatchReconciled, true);
  const receiptList = await invokeBatchList(String(product._id));
  assert.equal(receiptList.body.batches.length, 2, 'the new receipt remains distinct from the verified opening allocation');
  assert.equal(receiptList.body.batchRemainingTotal, 8);
  assert.equal(receiptList.body.existingStockToVerify, 0);
  assert.equal(receiptList.body.batches.filter((batch) => batch.quantityReceived === 0).length, 1);
  assert.equal(receiptList.body.batches.filter((batch) => batch.quantityReceived === 2).length, 1);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 1);
  assert.equal((await ExpiryBatch.findById(historicalBatch._id)).remainingQuantity, 6, 'closed history is never altered by current-period verification');
  assert.equal((await ExpiryBatch.findById(depletedHistory._id)).remainingQuantity, 0);

  const monitoring = (await invokeExpiryMonitoring()).body.batches.filter((batch) => batch.productId === String(product._id));
  assert.equal(monitoring.filter((batch) => batch.isHistoricalPeriod).length, 2);
  assert.equal(monitoring.filter((batch) => !batch.isHistoricalPeriod).length, 2);
  assert.ok(monitoring.filter((batch) => batch.isHistoricalPeriod).every((batch) => batch.status === 'Historical'));
  assert.ok(monitoring.filter((batch) => !batch.isHistoricalPeriod).every((batch) => batch.balanceConfirmed));
  const availability = await getExpiryBatchAvailability(await Product.findById(product._id));
  assert.equal(availability.valid, true);
  assert.equal(availability.batches.length, 2);
  assert.ok(availability.batches.every((batch) => ![String(historicalBatch._id), String(depletedHistory._id)].includes(String(batch._id))),
    'FEFO and normal stock selection never include closed-period batches');
});

test('existing stock is verified before multiple new receipt batches are recorded', async () => {
  const created = await invoke(payload('multiple-receipts-unassigned', {
    stock: 4, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const enabled = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: created.body.updatedAt.toISOString(),
  }, productId);
  assert.equal(enabled.statusCode, 200, enabled.body?.message);
  const beforeVerification = await invokeBatchList(productId);
  assert.equal(beforeVerification.body.existingStockToVerify, 4);
  const verified = await invokeReconciliation(productId, {
    requestId: 'multiple-receipts:verify',
    expectedStock: 4,
    expectedUnassignedStock: 4,
    expectedUpdatedAt: beforeVerification.body.productUpdatedAt,
    recordedBatchVersions: [],
    batches: [{ expiryDate: '2029-01-01', lotNumber: 'PHYSICAL-OPENING', quantity: 4 }],
  });
  assert.equal(verified.statusCode, 200, verified.body?.message);
  await trackedStockIn(productId, 'multiple-receipts:one', {
    quantity: 2, expiryDate: '2028-11-01', lotNumber: 'INCOMING-A',
  });
  await trackedStockIn(productId, 'multiple-receipts:two', {
    quantity: 3, expiryDate: '2028-12-01', lotNumber: 'INCOMING-B',
  });

  const before = await invokeBatchList(productId);
  assert.equal(before.body.productStock, 9);
  assert.equal(before.body.existingStockToVerify, 0);
  assert.equal(before.body.newStockRecorded, 5);
  assert.equal(before.body.receiptLedgerValid, true);
  assert.equal(before.body.stockPartitionValid, true);
  const recordedBefore = before.body.batches.filter((batch) => batch.quantityReceived > 0).map(({ _id, batchReference, expiryDate, quantityReceived, remainingQuantity }) => ({
    _id: String(_id), batchReference, expiryDate, quantityReceived, remainingQuantity,
  }));

  assert.equal((await Product.findById(productId)).stock, 9);
  assert.deepEqual(before.body.batches.filter((batch) => batch.quantityReceived > 0).map(({ _id, batchReference, expiryDate, quantityReceived, remainingQuantity }) => ({
    _id: String(_id), batchReference, expiryDate, quantityReceived, remainingQuantity,
  })), recordedBefore);
  assert.equal(before.body.batches.filter((batch) => batch.quantityReceived === 0 && batch.remainingQuantity > 0).length, 1,
    'the existing stock remains a separate opening allocation');
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 2);
});

test('concurrent Stock-In and verification cannot consume the same unassigned-stock snapshot', async () => {
  const created = await invoke(payload('verify-stock-in-concurrency', {
    stock: 4, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const enabled = await invoke({ expiryTrackingEnabled: true, expectedUpdatedAt: created.body.updatedAt.toISOString() }, productId);
  assert.equal(enabled.statusCode, 200, enabled.body?.message);
  const before = await invokeBatchList(productId);
  const verifyRequest = {
    requestId: 'verify-stock-in-concurrency:verify',
    expectedStock: before.body.productStock,
    expectedUnassignedStock: before.body.existingStockToVerify,
    expectedUpdatedAt: before.body.productUpdatedAt,
    recordedBatchVersions: [],
    batches: [{ expiryDate: '2029-01-01', lotNumber: 'BASE-STOCK', quantity: 4 }],
  };
  const stockInRequest = {
    stock: before.body.productStock + 1,
    expectedStock: before.body.productStock,
    expectedUpdatedAt: before.body.productUpdatedAt,
    adjustmentRequestId: 'verify-stock-in-concurrency:second',
    adjustmentType: 'IN',
    adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Delivery',
    expiryBatch: { expiryDate: '2028-12-01', lotNumber: 'RACE-RECEIPT' },
  };
  const [verification, stockIn] = await Promise.all([
    invokeReconciliation(productId, verifyRequest),
    invokeStock(productId, stockInRequest),
  ]);
  assert.equal([verification, stockIn].filter((result) => result.statusCode === 200).length, 1,
    'only one mutation may commit from the shared product version');
  const latestProduct = await Product.findById(productId);
  const latest = await invokeBatchList(productId);
  assert.equal(latest.body.stockPartitionValid, true);
  assert.equal(latest.body.productStock, latestProduct.stock);
  assert.equal(stockIn.statusCode, 409, 'stale Stock-In is rejected whether it races before or after reconciliation');
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 0);
  if (latestProduct.expiryBatchReconciled) {
    assert.equal(latest.body.batchRemainingTotal, latestProduct.stock);
    assert.equal(latest.body.existingStockToVerify, 0);
  } else {
    assert.equal(latest.body.batchRemainingTotal + latest.body.existingStockToVerify, latestProduct.stock);
  }
});

test('zero unassigned stock can be confirmed without adding or changing receipt-backed batches', async () => {
  const product = await createTrackedProduct('zero-unassigned-receipt', { stock: 0 });
  const received = await trackedStockIn(String(product._id), 'zero-unassigned:receipt', {
    quantity: 3, expiryDate: '2028-11-01', lotNumber: 'ZERO-BASE-RECEIPT',
  });
  assert.equal(received.statusCode, 200);
  await Product.updateOne({ _id: product._id }, { $set: { expiryBatchReconciled: false, expiryUnassignedStock: 0 } });
  const before = await invokeBatchList(String(product._id));
  assert.equal(before.body.productStock, 3);
  assert.equal(before.body.existingStockToVerify, 0);
  assert.equal(before.body.newStockRecorded, 3);
  assert.equal(before.body.stockPartitionValid, true);
  const batchBefore = before.body.batches[0];

  const verified = await invokeReconciliation(String(product._id), {
    requestId: 'zero-unassigned:verify', expectedStock: 3, expectedUnassignedStock: 0,
    expectedUpdatedAt: before.body.productUpdatedAt, batches: [],
  });
  assert.equal(verified.statusCode, 200, verified.body?.message);
  assert.equal(verified.body.batches.length, 1);
  assert.equal(String(verified.body.batches[0]._id), String(batchBefore._id));
  assert.equal(verified.body.batches[0].remainingQuantity, 3);
  assert.equal(verified.body.batches[0].quantityReceived, 3);
  assert.equal(await ExpiryBatch.countDocuments({ product: product._id }), 1);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 1);
});

test('receipt ledger mismatches block verification without changing recorded batches or stock', async () => {
  const created = await invoke(payload('receipt-ledger-mismatch', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = String(created.body._id);
  const received = await trackedStockIn(productId, 'receipt-ledger-mismatch:receipt', {
    quantity: 2, expiryDate: '2028-11-01', lotNumber: 'RECORDED-LOT', enableTracking: true,
  });
  assert.equal(received.statusCode, 200);
  await Product.updateOne({ _id: productId }, { $set: { expiryBatchReconciled: false, expiryUnassignedStock: 0 } });
  const batch = await ExpiryBatch.findOne({ product: productId, trackingPeriodClosedAt: null });
  await ExpiryBatch.updateOne({ _id: batch._id }, { $set: { quantityReceived: 3 } });
  const before = await invokeBatchList(productId);
  assert.equal(before.body.receiptLedgerValid, false);
  assert.equal(before.body.stockPartitionValid, true);
  const attempted = await invokeReconciliation(productId, {
    requestId: 'receipt-ledger-mismatch:verify', expectedStock: 2,
    expectedUnassignedStock: 0, expectedUpdatedAt: before.body.productUpdatedAt,
    batches: [],
  });
  assert.equal(attempted.statusCode, 409);
  assert.match(attempted.body.message, /Recorded receipt details need review/);
  assert.equal((await Product.findById(productId)).stock, 2);
  assert.equal((await Product.findById(productId)).expiryBatchReconciled, false);
  assert.equal((await ExpiryBatch.findById(batch._id)).remainingQuantity, 2);
  assert.equal(await ExpiryBatch.countDocuments({ product: productId }), 1);
});

test('a recorded batch changed after the verification form opened requires refresh', async () => {
  const product = await createTrackedProduct('recorded-batch-version', { stock: 2 });
  product.expiryBatchReconciled = false;
  product.expiryUnassignedStock = 1;
  await product.save();
  const batch = await createBatch(product, 'RECORDED-VERSION', '2028-11-01', 1);
  await ExpiryBatchReceipt.create({
    requestId: 'recorded-batch-version:receipt', product: product._id, batch: batch._id,
    quantity: 1, expiryDate: batch.expiryDate, lotNumber: batch.lotNumber,
    stockBefore: 1, stockAfter: 2, receivedAt: batch.receivedAt, receivedBy: actor._id,
  });
  const before = await invokeBatchList(String(product._id));
  const snapshot = before.body.batches.map((row) => ({ batchRecordId: String(row._id), updatedAt: row.updatedAt }));
  await ExpiryBatch.updateOne({ _id: batch._id }, { $set: { expiryDate: '2028-12-01' } });
  const result = await invokeReconciliation(String(product._id), {
    requestId: 'recorded-batch-version:verify', expectedStock: 2, expectedUnassignedStock: 1,
    expectedUpdatedAt: before.body.productUpdatedAt, recordedBatchVersions: snapshot,
    batches: [{ expiryDate: '2029-01-01', lotNumber: 'PHYSICAL', quantity: 1 }],
  });
  assert.equal(result.statusCode, 409);
  assert.match(result.body.message, /Recorded batches changed/);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await Product.findById(product._id)).expiryBatchReconciled, false);
  assert.equal((await ExpiryBatch.findById(batch._id)).remainingQuantity, 1);
});

test('receipt-backed batches and active reservation allocations remain unchanged during opening verification', async () => {
  const product = await createTrackedProduct('receipt-reservation', { stock: 5, reservedStock: 1 });
  product.expiryBatchReconciled = false;
  product.expiryUnassignedStock = 2;
  await product.save();
  const expiryDate = '2028-11-01';
  const batch = await createBatch(product, 'RESERVED-RECEIPT', expiryDate, 3, 1);
  await ExpiryBatchReceipt.create({
    requestId: 'receipt-reservation:receipt', product: product._id, batch: batch._id,
    quantity: 3, expiryDate, lotNumber: batch.lotNumber, stockBefore: 2, stockAfter: 5,
    receivedAt: batch.receivedAt, receivedBy: actor._id,
  });
  const specialOrder = new mongoose.Types.ObjectId();
  const reservation = await SpecialOrderStockReservation.create({
    specialOrder, product: product._id, sku: product.sku, orderedQuantity: 1, reservedQuantity: 1,
    batchAllocations: [{ batch: batch._id, batchId: batch.batchId, expiryDate, quantity: 1 }],
    status: 'Active', createdBy: actor._id, updatedBy: actor._id,
    history: [{ action: 'Reserve', quantity: 1, requestId: 'receipt-reservation:hold', actor: actor._id,
      batchAllocations: [{ batch: batch._id, batchId: batch.batchId, expiryDate, quantity: 1 }] }],
  });
  const reservationBefore = await SpecialOrderStockReservation.findById(reservation._id).lean();

  const before = await invokeBatchList(String(product._id));
  assert.equal(before.body.receiptLedgerValid, true);
  assert.equal(before.body.stockPartitionValid, true);
  const verified = await invokeReconciliation(String(product._id), {
    requestId: 'receipt-reservation:verify', expectedStock: 5, expectedUnassignedStock: 2,
    expectedUpdatedAt: before.body.productUpdatedAt,
    batches: [{ expiryDate: '2028-12-01', lotNumber: 'EXISTING-PHYSICAL', quantity: 2 }],
  });
  assert.equal(verified.statusCode, 200, verified.body?.message);
  const savedReceiptBatch = await ExpiryBatch.findById(batch._id).lean();
  assert.equal(savedReceiptBatch.remainingQuantity, 3);
  assert.equal(savedReceiptBatch.reservedQuantity, 1);
  assert.equal(savedReceiptBatch.quantityReceived, 3);
  const savedReservation = await SpecialOrderStockReservation.findById(reservation._id).lean();
  assert.deepEqual(savedReservation.batchAllocations, reservationBefore.batchAllocations);
  assert.deepEqual(savedReservation.history, reservationBefore.history);
  assert.equal((await Product.findById(product._id)).reservedStock, 1);
});

test('legacy tracked SKUs are reconciled into a named period before using old batches or FEFO', async () => {
  const legacy = await Product.create({
    name: 'Legacy period paint', sku: 'LEGACY-PERIOD-PAINT', sellingUnit: 'can', price: 20,
    stock: 6, reservedStock: 0, expiryTrackingEnabled: true, expiryBatchReconciled: true,
  });
  const oldExpiry = manilaDateOffset(40);
  const oldBatch = await createBatch(legacy, 'LEGACY-SAME-LOT', oldExpiry, 6);
  assert.equal((await getExpiryBatchAvailability(await Product.findById(legacy._id))).valid, false,
    'periodless legacy stock cannot be allocated through FEFO before physical review');

  const received = await trackedStockIn(String(legacy._id), 'legacy-period:stock-in', {
    quantity: 2, expiryDate: oldExpiry, lotNumber: 'LEGACY-SAME-LOT',
  });
  assert.equal(received.statusCode, 200, received.body?.message);
  assert.equal(received.body.stock, 8);
  assert.equal(received.body.expiryBatchReconciled, false);
  const current = await Product.findById(legacy._id);
  assert.ok(current.expiryTrackingPeriodId);
  assert.equal(current.expiryUnassignedStock, 6);
  const closedOld = await ExpiryBatch.findById(oldBatch._id).lean();
  assert.ok(closedOld.trackingPeriodClosedAt);
  assert.notEqual(closedOld.trackingPeriodId, current.expiryTrackingPeriodId);
  assert.equal(closedOld.remainingQuantity, 6);
  const list = await invokeBatchList(String(legacy._id));
  assert.equal(list.body.batches.length, 1);
  assert.equal(list.body.batchRemainingTotal, 2);
  assert.equal(list.body.existingStockToVerify, 6);
  assert.notEqual(list.body.batches[0]._id, String(oldBatch._id));
});

test('variant edits preserve expiry configuration and the immutable initial receipt snapshot', async () => {
  const created = await invoke(payload('edit'));
  const before = created.body.toObject();
  const updated = await invoke({
    price: 222,
    imageUrl: 'https://images.example.test/variant-only.jpg',
    expiryTrackingEnabled: true,
    initialStockBatch: { expiryDate: '2030-01-01', lotNumber: 'UNSAFE-EDIT' },
    expectedUpdatedAt: before.updatedAt,
  }, String(before._id));
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.price, 222);
  assert.equal(updated.body.imageUrl, 'https://images.example.test/variant-only.jpg');
  assert.equal(updated.body.stock, 37);
  assert.equal(updated.body.sellingUnit, 'can');
  assert.equal(updated.body.expiryTrackingEnabled, true);
  assert.deepEqual(updated.body.initialStockBatch.toObject(), before.initialStockBatch);
  const unchangedBatch = await ExpiryBatch.findOne({ product: before._id }).lean();
  assert.equal(unchangedBatch.expiryDate, '2028-02-29');
  assert.equal(unchangedBatch.lotNumber, 'LOT-42');
});

test('edit can enable tracking for a zero-stock SKU without inventing an opening batch', async () => {
  const created = await invoke(payload('edit-enable-zero', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const updated = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: created.body.updatedAt.toISOString(),
  }, String(created.body._id));

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.expiryTrackingEnabled, true);
  assert.equal(updated.body.expiryBatchReconciled, true);
  assert.equal(updated.body.stock, 0);
  assert.equal(updated.body.reservedStock, 0);
  assert.equal(updated.body.initialStockBatch, null);
  assert.equal(await ExpiryBatch.countDocuments({ product: created.body._id }), 0);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: created.body._id }), 0);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: created.body._id }), 0);
  const audit = await ActivityLog.findOne({ action: 'Expiry Tracking Enabled', details: new RegExp(`${created.body.sku}.*empty stock ledger; no opening batch was created`) }).lean();
  assert.ok(audit, 'tracking change is included in the existing activity audit');

  const disabled = await invoke({
    expiryTrackingEnabled: false,
    expectedUpdatedAt: updated.body.updatedAt.toISOString(),
  }, String(created.body._id));
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.body.expiryTrackingEnabled, false);
  assert.equal(disabled.body.expiryBatchReconciledAt.toISOString(), updated.body.expiryBatchReconciledAt.toISOString());
  assert.equal(String(disabled.body.expiryBatchReconciledBy), String(actor._id));
  assert.equal(disabled.body.stock, 0);
});

test('edit enables positive or reserved legacy stock only as unreconciled and preserves quantities', async () => {
  const created = await invoke(payload('edit-enable-existing-stock', {
    stock: 12, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = created.body._id;
  await Product.collection.updateOne({ _id: productId }, { $unset: { expiryTrackingEnabled: '', expiryBatchReconciled: '' } });
  const updatedProduct = await Product.findByIdAndUpdate(productId, { $set: { reservedStock: 3 } }, { new: true });
  const reservation = await SpecialOrderStockReservation.create({
    specialOrder: new mongoose.Types.ObjectId(), product: productId, sku: updatedProduct.sku,
    orderedQuantity: 3, reservedQuantity: 3, status: 'Active', createdBy: actor._id, updatedBy: actor._id,
    history: [{ action: 'Reserve', quantity: 3, requestId: 'legacy-edit-reservation', actor: actor._id }],
  });
  const updated = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: (await Product.findById(productId)).updatedAt.toISOString(),
  }, String(productId));

  assert.equal(updated.statusCode, 200, updated.body?.message);
  assert.equal(updated.body.expiryTrackingEnabled, true);
  assert.equal(updated.body.expiryBatchReconciled, false);
  assert.equal(updated.body.stock, 12);
  assert.equal(updated.body.reservedStock, 3);
  assert.equal(await ExpiryBatch.countDocuments({ product: productId }), 0);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: productId }), 0);
  assert.equal((await SpecialOrderStockReservation.findById(reservation._id)).status, 'Active');
  const list = await invokeBatchList(String(productId));
  assert.equal(list.body.provisional, true);
  assert.equal(list.body.batches.length, 0);
  assert.equal(list.body.productStock, 12);
});

test('edit enables expiry tracking for legacy stock when reservedStock is absent', async () => {
  const created = await invoke(payload('edit-enable-legacy-reservation-counter', {
    stock: 92, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = created.body._id;
  await Product.collection.updateOne({ _id: productId }, {
    $unset: { reservedStock: '', expiryTrackingEnabled: '', expiryBatchReconciled: '' },
  });
  const legacy = await Product.findById(productId);
  assert.equal(legacy.reservedStock, 0, 'Mongoose applies the schema default to the hydrated legacy document');
  assert.equal(await Product.collection.countDocuments({ _id: productId, reservedStock: { $exists: false } }), 1);

  // Match the actual ProductList edit payload: it sends the current physical
  // stock along with the expiry toggle and the timestamp from the loaded row.
  const updated = await invoke({
    name: legacy.name,
    sku: legacy.sku,
    category: legacy.category,
    stock: legacy.stock,
    price: legacy.price,
    brand: legacy.brand,
    color: legacy.color,
    size: legacy.size,
    attributes: Object.fromEntries(legacy.attributes || []),
    supplierName: legacy.supplierName,
    imageUrl: legacy.imageUrl,
    sellingUnit: legacy.sellingUnit,
    isActive: true,
    expiryTrackingEnabled: true,
    expectedUpdatedAt: legacy.updatedAt.toISOString(),
  }, String(productId));

  assert.equal(updated.statusCode, 200, updated.body?.message);
  assert.equal(updated.body.expiryTrackingEnabled, true);
  assert.equal(updated.body.expiryBatchReconciled, false);
  assert.equal(updated.body.stock, 92);
  assert.equal(updated.body.reservedStock, 0);
  assert.equal(await ExpiryBatch.countDocuments({ product: productId }), 0);
  assert.equal(await Product.collection.countDocuments({ _id: productId, reservedStock: { $exists: false } }), 1,
    'enabling expiry tracking must not invent a reservation counter or alter legacy stock');
});

test('authenticated Product PATCH accepts expiry enablement for legacy OTH-style records', async (context) => {
  await Category.create({
    name: 'Paint',
    sizeUnits: ['can'],
    attributeSchemaVersion: 1,
    productAttributes: [{ name: 'Color', key: 'color', type: 'text' }],
  });
  const created = await invoke(payload('edit-enable-legacy-http', {
    name: 'Latex Paint', sku: 'OTH-001', category: 'Paint', sellingUnit: 'can',
    price: 190, stock: 92, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = created.body._id;
  await Product.collection.updateOne({ _id: productId }, {
    $unset: { reservedStock: '', expiryTrackingEnabled: '', expiryBatchReconciled: '' },
  });
  const legacy = await Product.findById(productId);
  const user = await User.create({
    name: 'Expiry Route Test',
    username: `expiry-route-${new mongoose.Types.ObjectId().toString()}`,
    password: 'safe-test-password',
    role: 'admin',
  });
  const previousJwtSecret = process.env.JWT_SECRET;
  const testJwtSecret = require('node:crypto').randomBytes(48).toString('hex');
  process.env.JWT_SECRET = testJwtSecret;
  context.after(() => {
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  const httpServer = app.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  context.after(() => new Promise((resolve) => httpServer.close(resolve)));

  const responseResult = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/products/${productId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, testJwtSecret, { algorithm: 'HS256' })}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: legacy.name,
      sku: legacy.sku,
      category: legacy.category,
      stock: legacy.stock,
      price: legacy.price,
      brand: legacy.brand,
      color: legacy.color,
      size: legacy.size,
      attributes: Object.fromEntries(legacy.attributes || []),
      supplierName: legacy.supplierName,
      imageUrl: legacy.imageUrl,
      sellingUnit: legacy.sellingUnit,
      isActive: true,
      expiryTrackingEnabled: true,
      expectedUpdatedAt: legacy.updatedAt.toISOString(),
    }),
  });
  const body = await responseResult.json();

  assert.equal(responseResult.status, 200, JSON.stringify(body));
  assert.equal(body.sku, legacy.sku);
  assert.equal(body.expiryTrackingEnabled, true);
  assert.equal(body.expiryBatchReconciled, false);
  assert.equal(body.stock, 92);
  assert.equal(body.reservedStock, 0);
  assert.equal(await ExpiryBatch.countDocuments({ product: productId }), 0);
});

test('edit reports a stale product version without changing expiry or stock data', async () => {
  const created = await invoke(payload('edit-stale-version', {
    stock: 6, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const staleVersion = new Date(created.body.updatedAt.getTime() - 1000).toISOString();
  const responseResult = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: staleVersion,
  }, String(created.body._id));

  assert.equal(responseResult.statusCode, 409);
  assert.match(responseResult.body.message, /changed after you opened it/i);
  const unchanged = await Product.findById(created.body._id);
  assert.equal(unchanged.expiryTrackingEnabled, false);
  assert.equal(unchanged.stock, 6);
  assert.equal(unchanged.reservedStock, 0);
});

test('edit rejects a reservation change between read and atomic expiry update', async (context) => {
  const created = await invoke(payload('edit-reservation-race', {
    stock: 6, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const productId = created.body._id;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  let simulatedConcurrentReservation = false;
  Product.findOneAndUpdate = async (...args) => {
    const [filter] = args;
    if (!simulatedConcurrentReservation && filter?.expiryTrackingEnabled !== undefined) {
      simulatedConcurrentReservation = true;
      // Simulate a reservation write that races after the controller read;
      // raw collection write keeps updatedAt fixed to isolate the reservedStock CAS.
      await Product.collection.updateOne({ _id: productId }, { $set: { reservedStock: 1 } });
    }
    return originalFindOneAndUpdate.apply(Product, args);
  };
  context.after(() => { Product.findOneAndUpdate = originalFindOneAndUpdate; });

  const responseResult = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: created.body.updatedAt.toISOString(),
  }, String(productId));

  Product.findOneAndUpdate = originalFindOneAndUpdate;
  assert.equal(simulatedConcurrentReservation, true);
  assert.equal(responseResult.statusCode, 409);
  const unchanged = await Product.findById(productId);
  assert.equal(unchanged.expiryTrackingEnabled, false);
  assert.equal(unchanged.stock, 6);
  assert.equal(unchanged.reservedStock, 1);
  assert.equal(await ExpiryBatch.countDocuments({ product: productId }), 0);
});

test('edit safely disables tracking with positive stock and preserves unused batch and receipt records', async () => {
  const zeroStock = await createToggleProduct('disable-zero-stock');
  const zeroResult = await invoke({
    expiryTrackingEnabled: false,
    expectedUpdatedAt: zeroStock.updatedAt.toISOString(),
  }, String(zeroStock._id));
  assert.equal(zeroResult.statusCode, 200);
  assert.equal(zeroResult.body.expiryTrackingEnabled, false);
  assert.equal(zeroResult.body.stock, 0);

  const positiveStock = await createToggleProduct('disable-positive-stock', { stock: 9 });
  const positiveResult = await invoke({
    expiryTrackingEnabled: false,
    expectedUpdatedAt: positiveStock.updatedAt.toISOString(),
  }, String(positiveStock._id));
  assert.equal(positiveResult.statusCode, 200);
  assert.equal(positiveResult.body.expiryTrackingEnabled, false);
  assert.equal(positiveResult.body.stock, 9, 'aggregate stock is preserved');
  assert.equal(positiveResult.body.reservedStock, 0);

  const withUnusedBatch = await createToggleProduct('disable-unused-batch', { stock: 5 });
  const batch = await createBatch(withUnusedBatch, 'DISABLE-UNUSED', '2028-04-30', 5);
  const [receipt] = await ExpiryBatchReceipt.create([{
    requestId: 'toggle-unused-batch-receipt', product: withUnusedBatch._id, batch: batch._id,
    quantity: 5, expiryDate: batch.expiryDate, lotNumber: batch.lotNumber,
    stockBefore: 0, stockAfter: 5, receivedBy: actor._id,
  }]);
  const beforeBatch = await ExpiryBatch.findById(batch._id).lean();
  const batchResult = await invoke({
    expiryTrackingEnabled: false,
    expectedUpdatedAt: withUnusedBatch.updatedAt.toISOString(),
  }, String(withUnusedBatch._id));
  assert.equal(batchResult.statusCode, 200);
  assert.equal(batchResult.body.stock, 5);
  assert.equal(await ExpiryBatch.countDocuments({ _id: batch._id }), 1);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ _id: receipt._id }), 1);
  assert.equal((await ExpiryBatch.findById(batch._id)).remainingQuantity, beforeBatch.remainingQuantity);

  const reenabled = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: batchResult.body.updatedAt.toISOString(),
  }, String(withUnusedBatch._id));
  assert.equal(reenabled.statusCode, 200);
  assert.equal(reenabled.body.expiryTrackingEnabled, true);
  assert.equal(reenabled.body.expiryBatchReconciled, false, 'retained batch records require verification again');
  assert.equal(reenabled.body.stock, 5);
});

test('edit allows historical batch-allocated sales while blocking active reservations and preserving void safety', async () => {
  const reserved = await createToggleProduct('disable-reserved-stock', { stock: 4, reservedStock: 1 });
  const reservedResult = await invoke({ expiryTrackingEnabled: false }, String(reserved._id));
  assert.equal(reservedResult.statusCode, 409);
  assert.match(reservedResult.body.message, /stock is reserved/i);
  assert.equal((await Product.findById(reserved._id)).stock, 4);

  const movementProduct = await createToggleProduct('disable-movement', { stock: 3 });
  const movementBatch = await createBatch(movementProduct, 'DISABLE-MOVEMENT', '2028-05-01', 3);
  const [stockOutMovement] = await ExpiryBatchMovement.create([{
    operationKey: 'toggle-disable-movement', product: movementProduct._id, sku: movementProduct.sku,
    batch: movementBatch._id, batchId: movementBatch.batchId, expiryDate: movementBatch.expiryDate,
    type: 'STOCK_OUT', quantity: 1, remainingDelta: -1, reservedDelta: 0,
    sourceType: 'StockOut', reason: 'Audit fixture',
  }]);
  const [reconciliation] = await ExpiryBatchReconciliation.create([{
    requestId: 'toggle-disable-movement-reconciliation', product: movementProduct._id,
    payloadHash: 'verified-fixture', stockAtReconciliation: 3, batchCount: 1, reconciledBy: actor._id,
  }]);
  const movementResult = await invoke({ expiryTrackingEnabled: false }, String(movementProduct._id));
  assert.equal(movementResult.statusCode, 200);
  assert.equal(movementResult.body.expiryTrackingEnabled, false);
  assert.equal(movementResult.body.expiryBatchReconciled, false);
  assert.equal(movementResult.body.stock, 3, 'aggregate physical stock is unchanged');
  assert.equal(await ExpiryBatchMovement.countDocuments({ _id: stockOutMovement._id }), 1, 'movement history is preserved');
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ _id: reconciliation._id }), 1, 'verification history is preserved');
  assert.equal((await ExpiryBatch.findById(movementBatch._id)).remainingQuantity, 3, 'batch balance is preserved');
  const reenabledMovementProduct = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: movementResult.body.updatedAt.toISOString(),
  }, String(movementProduct._id));
  assert.equal(reenabledMovementProduct.statusCode, 200);
  assert.equal(reenabledMovementProduct.body.expiryBatchReconciled, false, 'retained batch history must be verified before tracking resumes');

  const legacySaleProduct = await createToggleProduct('disable-legacy-sale');
  const [legacySale] = await Sale.create([{
    status: 'voided',
    items: [{ product: legacySaleProduct._id, name: legacySaleProduct.name, code: legacySaleProduct.sku, quantity: 1, unitPrice: 10, subtotal: 10 }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  }]);
  const legacySaleResult = await invoke({ expiryTrackingEnabled: false }, String(legacySaleProduct._id));
  assert.equal(legacySaleResult.statusCode, 200, 'historical sales without batch allocations are not batch dependencies');
  assert.equal(await Sale.countDocuments({ _id: legacySale._id }), 1, 'historical sale is preserved');

  const saleProduct = await createToggleProduct('disable-batch-allocated-sale');
  const saleBatch = await createBatch(saleProduct, 'DISABLE-ALLOCATED-SALE', '2028-05-02', 2);
  const allocation = { batch: saleBatch._id, batchId: saleBatch.batchId, expiryDate: saleBatch.expiryDate, quantity: 1 };
  const [sale] = await Sale.create([{
    status: 'voided',
    items: [{
      product: saleProduct._id, name: saleProduct.name, code: saleProduct.sku,
      quantity: 1, unitPrice: 10, subtotal: 10,
      batchVerification: {
        proposedAllocations: [allocation], verifiedAllocations: [allocation],
        overridden: false, overrideReason: '', verifiedAt: new Date(), verifiedBy: actor._id,
      },
    }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  }]);
  const saleResult = await invoke({ expiryTrackingEnabled: false }, String(saleProduct._id));
  assert.equal(saleResult.statusCode, 200, 'a fully voided batch-allocated sale is historical, not an active dependency');
  assert.equal(await Sale.countDocuments({ _id: sale._id }), 1, 'historical sale and its batch allocations are preserved');
  assert.equal((await Product.findById(saleProduct._id)).expiryBatchReconciled, false);

  const consumedHistoryProduct = await createToggleProduct('disable-consumed-reservation-history');
  const [consumedSale] = await Sale.create([{
    status: 'completed', saleType: 'special-order',
    items: [{ product: consumedHistoryProduct._id, name: consumedHistoryProduct.name, code: consumedHistoryProduct.sku, quantity: 1, unitPrice: 10, subtotal: 10 }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  }]);
  await SpecialOrderStockReservation.create({
    specialOrder: new mongoose.Types.ObjectId(), product: consumedHistoryProduct._id, sku: consumedHistoryProduct.sku,
    orderedQuantity: 1, reservedQuantity: 0, status: 'Consumed', consumedAt: new Date(), consumedSale: consumedSale._id,
    createdBy: actor._id, updatedBy: actor._id,
  });
  const consumedHistoryResult = await invoke({ expiryTrackingEnabled: false }, String(consumedHistoryProduct._id));
  assert.equal(consumedHistoryResult.statusCode, 200, 'a completed reservation with its sale link is retained as history');

  const futureVoidProduct = await createToggleProduct('disable-future-void');
  const futureVoidBatch = await createBatch(futureVoidProduct, 'DISABLE-FUTURE-VOID', '2028-05-03', 1);
  await ExpiryBatch.updateOne({ _id: futureVoidBatch._id }, { $set: { remainingQuantity: 0 } });
  const futureAllocation = { batch: futureVoidBatch._id, batchId: futureVoidBatch.batchId, expiryDate: futureVoidBatch.expiryDate, quantity: 1 };
  const [futureVoidSale] = await Sale.create([{
    status: 'completed',
    saleType: 'regular',
    items: [{
      product: futureVoidProduct._id, name: futureVoidProduct.name, code: futureVoidProduct.sku,
      quantity: 1, unitPrice: 10, subtotal: 10,
      batchVerification: {
        proposedAllocations: [futureAllocation], verifiedAllocations: [futureAllocation],
        overridden: false, overrideReason: '', verifiedAt: new Date(), verifiedBy: actor._id,
      },
    }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  }]);
  const [saleMovement] = await ExpiryBatchMovement.create([{
    operationKey: 'toggle-disable-future-void-sale', product: futureVoidProduct._id, sku: futureVoidProduct.sku,
    batch: futureVoidBatch._id, batchId: futureVoidBatch.batchId, expiryDate: futureVoidBatch.expiryDate,
    type: 'SALE', quantity: 1, remainingDelta: -1, reservedDelta: 0,
    sourceType: 'Sale', sourceId: futureVoidSale._id,
  }]);
  publishedRealtimeEvents.length = 0;
  const disableResult = await invoke({ expiryTrackingEnabled: false }, String(futureVoidProduct._id));
  assert.equal(disableResult.statusCode, 200, disableResult.body?.message || 'a completed allocation may be retained as history when no active dependency remains');
  assert.ok(publishedRealtimeEvents.some(({ eventName }) => eventName === 'publishActivityLogged'));
  assert.ok(publishedRealtimeEvents.some(({ eventName }) => eventName === 'publishInventoryUpdated'));
  assert.equal((await ExpiryBatchMovement.findById(saleMovement._id)).quantity, 1, 'sale allocation movement is preserved');
  assert.equal((await Sale.findById(futureVoidSale._id)).items[0].batchVerification.verifiedAllocations[0].quantity, 1);
  const disableAudit = await ActivityLog.findOne({ action: 'Expiry Tracking Disabled', details: new RegExp(futureVoidProduct.sku) }).lean();
  assert.match(disableAudit.details, /Closed expiry tracking period/i);
  assert.match(disableAudit.details, /Reason: Correct accidental expiry classification/i);
  assert.ok(disableAudit.userRef);
  assert.ok(disableAudit.createdAt);

  const voidResult = await executeSaleVoid({
    saleId: futureVoidSale._id,
    reason: 'Correction verified in isolated test',
    requestId: 'toggle-disable-future-sale-void',
    user: actor,
  });
  assert.equal(voidResult.sale.status, 'voided');
  assert.equal(voidResult.restorations[0].batchReconciliationRequired, true);
  assert.equal((await Product.findById(futureVoidProduct._id)).stock, 1, 'void restores authoritative aggregate stock once');
  assert.equal((await ExpiryBatch.findById(futureVoidBatch._id)).remainingQuantity, 0, 'dormant historical batch is not guessed or modified');
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceType: 'SaleVoid', sourceId: futureVoidSale._id }), 0, 'no false original-batch restoration is recorded');
  const voidLog = await InventoryLog.findOne({ saleRef: futureVoidSale._id, action: 'ADD' }).lean();
  assert.match(voidLog.details, /verify batches before expiry tracking resumes/i);

  let current = await Product.findById(futureVoidProduct._id);
  const stockInAfterDisable = await invokeStock(String(futureVoidProduct._id), {
    stock: 3, expectedStock: 1, expectedUpdatedAt: current.updatedAt.toISOString(),
    adjustmentRequestId: 'toggle-disabled-future-stock-in', adjustmentType: 'IN', adjustmentQuantity: 2,
    inventoryAdjustmentReason: 'Delivery',
  });
  assert.equal(stockInAfterDisable.statusCode, 200);
  assert.equal(stockInAfterDisable.body.stock, 3);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: futureVoidProduct._id }), 0, 'non-expiry Stock-In does not fabricate batch receipts');
  current = await Product.findById(futureVoidProduct._id);
  const stockOutAfterDisable = await invokeStock(String(futureVoidProduct._id), {
    stock: 2, expectedStock: 3, expectedUpdatedAt: current.updatedAt.toISOString(),
    adjustmentRequestId: 'toggle-disabled-future-stock-out', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Damage',
  });
  assert.equal(stockOutAfterDisable.statusCode, 200);
  assert.equal(stockOutAfterDisable.body.stock, 2);
  assert.equal((await ExpiryBatch.findById(futureVoidBatch._id)).remainingQuantity, 0, 'non-expiry Stock-Out does not alter dormant batch history');
  current = await Product.findById(futureVoidProduct._id);
  const reenabledAfterVoid = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: current.updatedAt.toISOString(),
  }, String(futureVoidProduct._id));
  assert.equal(reenabledAfterVoid.statusCode, 200);
  assert.equal(reenabledAfterVoid.body.expiryBatchReconciled, false, 'aggregate stock and retained batches require fresh verification after re-enable');
  assert.equal(reenabledAfterVoid.body.stock, 2);
  assert.equal((await ExpiryBatch.findById(futureVoidBatch._id)).remainingQuantity, 0);

  const reservationProduct = await createToggleProduct('disable-reservation-history');
  await SpecialOrderStockReservation.create({
    specialOrder: new mongoose.Types.ObjectId(), product: reservationProduct._id, sku: reservationProduct.sku,
    orderedQuantity: 2, reservedQuantity: 0, status: 'Active', createdBy: actor._id, updatedBy: actor._id,
  });
  const reservationResult = await invoke({ expiryTrackingEnabled: false }, String(reservationProduct._id));
  assert.equal(reservationResult.statusCode, 409);
  assert.match(reservationResult.body.message, /active Special Order reservation/i);

  const openOrderProduct = await createToggleProduct('disable-open-order');
  await SpecialOrder.create({
    orderNumber: 'SO-DISABLE-OPEN-001', customerName: 'Expiry Test',
    itemName: openOrderProduct.name, quantity: 1, status: 'Pending',
    items: [{ itemName: openOrderProduct.name, quantity: 1, itemType: 'inventory', inventoryProduct: openOrderProduct._id }],
  });
  const openOrderResult = await invoke({ expiryTrackingEnabled: false }, String(openOrderProduct._id));
  assert.equal(openOrderResult.statusCode, 409);
  assert.match(openOrderResult.body.message, /open Special Order uses this SKU/i);

  const unresolvedReservationProduct = await createToggleProduct('disable-unresolved-reservation');
  await SpecialOrderStockReservation.create({
    specialOrder: new mongoose.Types.ObjectId(), product: unresolvedReservationProduct._id, sku: unresolvedReservationProduct.sku,
    orderedQuantity: 1, reservedQuantity: 0, status: 'Consumed', createdBy: actor._id, updatedBy: actor._id,
  });
  const unresolvedReservationResult = await invoke({ expiryTrackingEnabled: false }, String(unresolvedReservationProduct._id));
  assert.equal(unresolvedReservationResult.statusCode, 409);
  assert.match(unresolvedReservationResult.body.message, /completed Special Order batch record needs manual review/i);

  const pendingVoidProduct = await createToggleProduct('disable-pending-void');
  const pendingAllocation = { batch: new mongoose.Types.ObjectId(), batchId: 'EB-PENDING-VOID', expiryDate: '2028-05-10', quantity: 1 };
  await Sale.create({
    status: 'completed', saleType: 'regular',
    items: [{
      product: pendingVoidProduct._id, name: pendingVoidProduct.name, code: pendingVoidProduct.sku,
      quantity: 1, unitPrice: 10, subtotal: 10,
      batchVerification: { proposedAllocations: [pendingAllocation], verifiedAllocations: [pendingAllocation], verifiedAt: new Date(), verifiedBy: actor._id },
    }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
    voidRequest: { status: 'pending', reason: 'Review request', requestedBy: actor._id, requestedByName: actor.name, requestedAt: new Date() },
  });
  const pendingVoidResult = await invoke({ expiryTrackingEnabled: false }, String(pendingVoidProduct._id));
  assert.equal(pendingVoidResult.statusCode, 409);
  assert.match(pendingVoidResult.body.message, /Sale Void request is pending/i);
});

test('missing disable reason is rejected without changing the product or creating an audit event', async () => {
  const product = await createToggleProduct('disable-reason-required');
  const result = await invoke({ expiryTrackingEnabled: false, expiryTrackingDisableReason: '' }, String(product._id));
  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /reason before turning off/i);
  assert.equal((await Product.findById(product._id)).expiryTrackingEnabled, true);
  assert.equal(await ActivityLog.countDocuments({ action: 'Expiry Tracking Disabled', details: /TOGGLE-DISABLE-REASON-REQUIRED/i }), 0);
});

test('only administrators may change expiry tracking', async () => {
  const product = await createToggleProduct('disable-permission', { stock: 7 });
  const priorRole = actor.role;
  actor.role = 'cashier';
  const unauthorized = await invoke({ expiryTrackingEnabled: false }, String(product._id));
  actor.role = priorRole;
  assert.equal(unauthorized.statusCode, 403);
  assert.equal((await Product.findById(product._id)).expiryTrackingEnabled, true);
  assert.equal((await Product.findById(product._id)).stock, 7);

  const superAdminProduct = await createToggleProduct('disable-superadmin', { stock: 2 });
  actor.role = 'superadmin';
  const superAdminResult = await invoke({ expiryTrackingEnabled: false }, String(superAdminProduct._id));
  actor.role = priorRole;
  assert.equal(superAdminResult.statusCode, 200);
  assert.equal(superAdminResult.body.expiryTrackingEnabled, false);
});

test('concurrent Stock-In and Expiry Tracking disable cannot both commit from one version', async () => {
  const product = await createToggleProduct('disable-stock-in-race', { stock: 3 });
  const version = product.updatedAt.toISOString();
  const [toggle, stockIn] = await Promise.all([
    invoke({ expiryTrackingEnabled: false, expectedUpdatedAt: version }, String(product._id)),
    invokeStock(String(product._id), {
      stock: 5, expectedStock: 3, expectedUpdatedAt: version,
      adjustmentRequestId: 'expiry-disable-stock-in-race', adjustmentType: 'IN', adjustmentQuantity: 2,
      inventoryAdjustmentReason: 'Delivery', expiryBatch: { expiryDate: manilaDateOffset(60), lotNumber: 'RACE-TOGGLE' },
    }),
  ]);
  assert.equal([toggle, stockIn].filter((result) => result.statusCode === 200).length, 1);
  const finalProduct = await Product.findById(product._id);
  if (!finalProduct.expiryTrackingEnabled) {
    assert.equal(finalProduct.stock, 3);
    assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0);
  } else {
    assert.equal(finalProduct.stock, 5);
    assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 1);
  }
});

test('concurrent Sale Void and tracking disable preserve either exact-batch or aggregate-only restoration safely', async () => {
  const product = await createToggleProduct('disable-sale-void-race');
  await Product.updateOne({ _id: product._id }, { $set: { expiryBatchReconciled: true } });
  const batch = await createBatch(product, 'DISABLE-SALE-VOID-RACE', '2028-05-20', 1);
  await ExpiryBatch.updateOne({ _id: batch._id }, { $set: { remainingQuantity: 0 } });
  const allocation = { batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: 1 };
  const [sale] = await Sale.create([{
    status: 'completed', saleType: 'regular',
    items: [{
      product: product._id, name: product.name, code: product.sku, quantity: 1, unitPrice: 10, subtotal: 10,
      batchVerification: { proposedAllocations: [allocation], verifiedAllocations: [allocation], verifiedAt: new Date(), verifiedBy: actor._id },
    }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  }]);
  await ExpiryBatchMovement.create([{
    operationKey: 'toggle-disable-sale-void-race-sale', product: product._id, sku: product.sku,
    batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate,
    type: 'SALE', quantity: 1, remainingDelta: -1, reservedDelta: 0,
    sourceType: 'Sale', sourceId: sale._id,
  }]);

  const [disable, voided] = await Promise.all([
    invoke({ expiryTrackingEnabled: false }, String(product._id)),
    executeSaleVoid({ saleId: sale._id, reason: 'Concurrent safety test', requestId: 'disable-sale-void-race', user: actor }),
  ]);
  assert.equal(voided.sale.status, 'voided');
  const finalProduct = await Product.findById(product._id);
  const finalBatch = await ExpiryBatch.findById(batch._id);
  assert.equal(finalProduct.stock, 1);
  assert.ok([200, 409].includes(disable.statusCode));
  if (finalProduct.expiryTrackingEnabled) {
    assert.equal(disable.statusCode, 409);
    assert.equal(finalBatch.remainingQuantity, 1);
    assert.equal(voided.restorations[0].batchReconciliationRequired, false);
    assert.equal(await ExpiryBatchMovement.countDocuments({ sourceType: 'SaleVoid', sourceId: sale._id }), 1);
  } else {
    assert.equal(disable.statusCode, 200);
    assert.equal(finalBatch.remainingQuantity, 0, 'aggregate-only restoration does not invent a batch return');
    assert.equal(finalProduct.expiryBatchReconciled, false);
    assert.equal(voided.restorations[0].batchReconciliationRequired, true);
    assert.equal(await ExpiryBatchMovement.countDocuments({ sourceType: 'SaleVoid', sourceId: sale._id }), 0);
  }
});

test('concurrent batch date correction and Expiry Tracking disable serialize safely', async () => {
  const product = await createToggleProduct('disable-correction-race', { stock: 2 });
  const oldExpiry = manilaDateOffset(40);
  const batch = await createBatch(product, 'DISABLE-CORRECTION-RACE', oldExpiry, 2);
  const [toggle, correction] = await Promise.all([
    invoke({ expiryTrackingEnabled: false, expectedUpdatedAt: product.updatedAt.toISOString() }, String(product._id)),
    invokeExpiryCorrection(String(product._id), String(batch._id), {
      newExpiryDate: manilaDateOffset(70), reason: 'Concurrent correction check', requestId: 'disable-correction-race',
      expectedUpdatedAt: batch.updatedAt.toISOString(),
    }),
  ]);

  assert.equal([toggle, correction].filter((result) => result.statusCode === 200).length, 1);
  const savedProduct = await Product.findById(product._id);
  const savedBatch = await ExpiryBatch.findById(batch._id);
  const correctionRecord = await ExpiryBatchCorrection.findOne({ requestId: 'disable-correction-race' });
  if (savedProduct.expiryTrackingEnabled) {
    assert.equal(toggle.statusCode, 409);
    assert.equal(correction.statusCode, 200);
    assert.equal(savedBatch.expiryDate, manilaDateOffset(70));
    assert.ok(correctionRecord);
  } else {
    assert.equal(toggle.statusCode, 200);
    assert.equal(correction.statusCode, 409);
    assert.equal(savedBatch.expiryDate, oldExpiry);
    assert.equal(correctionRecord, null);
  }
  assert.equal(savedProduct.stock, 2);
});

test('edit rejects unauthorized tracking changes and concurrent stock changes cannot be marked reconciled', async () => {
  const created = await invoke(payload('edit-enable-unauthorized', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const priorRole = actor.role;
  actor.role = 'cashier';
  const unauthorized = await invoke({ expiryTrackingEnabled: true }, String(created.body._id));
  actor.role = priorRole;
  assert.equal(unauthorized.statusCode, 403);
  assert.equal((await Product.findById(created.body._id)).expiryTrackingEnabled, false);

  const concurrent = await invoke(payload('edit-enable-stock-race', {
    stock: 0, expiryTrackingEnabled: false, initialStockBatch: undefined,
  }));
  const version = concurrent.body.updatedAt.toISOString();
  const [toggle, receipt] = await Promise.all([
    invoke({ expiryTrackingEnabled: true, expectedUpdatedAt: version }, String(concurrent.body._id)),
    invokeStock(String(concurrent.body._id), {
      stock: 4, expectedStock: 0, expectedUpdatedAt: version,
      adjustmentRequestId: 'expiry-edit-race-stock-in', adjustmentType: 'IN', adjustmentQuantity: 4,
      inventoryAdjustmentReason: 'Delivery',
    }),
  ]);
  assert.equal([toggle, receipt].filter((result) => result.statusCode === 200).length, 1);
  const finalProduct = await Product.findById(concurrent.body._id);
  if (finalProduct.expiryTrackingEnabled) {
    assert.equal(finalProduct.expiryBatchReconciled, true);
    assert.equal(finalProduct.stock, 0);
  } else {
    assert.equal(finalProduct.stock, 4);
  }
});

test('sibling variants own independent expiry settings and initial receipts', async () => {
  const first = await invoke(payload('sibling-a', { name: 'Sibling Product', sellingUnit: 'liter (L)' }));
  const second = await invoke(payload('sibling-b', { name: 'Sibling Product', expiryTrackingEnabled: false }));
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.notEqual(first.body.sku, second.body.sku);
  assert.equal(first.body.initialStockBatch.sellingUnit, 'liter (L)');
  assert.equal(second.body.initialStockBatch, null);
  assert.equal(second.body.expiryTrackingEnabled, false);
});

test('opening-balance reconciliation requires a physical match and assigns current reservations FEFO', async () => {
  const product = await Product.create({
    name: 'Legacy reconciled paint', sku: 'RECONCILE-LEGACY-1', sellingUnit: 'can', price: 20,
    stock: 12, reservedStock: 3, expiryTrackingEnabled: true, expiryBatchReconciled: false,
  });
  const specialOrderId = new mongoose.Types.ObjectId();
  const reservation = await SpecialOrderStockReservation.create({
    specialOrder: specialOrderId, product: product._id, sku: product.sku,
    orderedQuantity: 3, reservedQuantity: 3, status: 'Active', createdBy: actor._id, updatedBy: actor._id,
    history: [{ action: 'Reserve', quantity: 3, requestId: 'legacy-hold', actor: actor._id }],
  });
  const expectedUpdatedAt = product.updatedAt.toISOString();
  const missingVersion = await invokeReconciliation(String(product._id), {
    requestId: 'reconcile:missing-version', expectedStock: 12,
    batches: [{ expiryDate: '2028-05-01', lotNumber: 'A', quantity: 12 }],
  });
  assert.equal(missingVersion.statusCode, 400, 'reconciliation requires the current product version');
  publishedRealtimeEvents.length = 0;
  const bad = await invokeReconciliation(String(product._id), {
    requestId: 'reconcile:bad-total', expectedStock: 12, expectedUpdatedAt,
    batches: [{ expiryDate: '2028-05-01', lotNumber: 'A', quantity: 11 }],
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(publishedRealtimeEvents.some(({ eventName }) => eventName === 'publishInventoryUpdated'), false, 'invalid reconciliation does not publish a refresh event');
  assert.equal((await Product.findById(product._id)).expiryBatchReconciled, false);

  const result = await invokeReconciliation(String(product._id), {
    requestId: 'r'.repeat(160), expectedStock: 12, expectedUpdatedAt,
    batches: [
      { expiryDate: manilaDateOffset(20), lotNumber: 'LOT-A', quantity: 2 },
      { expiryDate: manilaDateOffset(40), lotNumber: 'LOT-B', quantity: 10 },
    ],
  });
  assert.equal(result.statusCode, 200);
  assert.ok(publishedRealtimeEvents.some(({ eventName, args }) => eventName === 'publishInventoryUpdated'
    && args[0]?.reason === 'product.expiry-batches.reconciled'), 'successful reconciliation publishes inventory.updated for other sessions');
  assert.equal(result.body.reconciled, true);
  assert.equal(result.body.productStock, 12);
  assert.equal((await Product.findById(product._id)).stock, 12, 'reconciliation never changes Product.stock');
  const batches = await ExpiryBatch.find({ product: product._id }).sort({ expiryDate: 1 }).lean();
  assert.deepEqual(batches.map((batch) => [batch.remainingQuantity, batch.reservedQuantity]), [[2, 2], [10, 1]]);
  const savedReservation = await SpecialOrderStockReservation.findById(reservation._id).lean();
  assert.deepEqual(savedReservation.batchAllocations.map((allocation) => allocation.quantity), [2, 1]);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0, 'reconciliation does not invent a receipt');
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: product._id }), 1);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id, type: 'RESERVATION_RECONCILE' }), 2);
  assert.equal(await InventoryLog.countDocuments({ productRef: product._id, action: 'UPDATE' }), 1);
});

test('reconciliation accepts distinct unlabeled physical lots with the same expiry date', async () => {
  const product = await Product.create({
    name: 'Unlabeled physical lots', sku: 'RECONCILE-UNLABELED-1', sellingUnit: 'pcs', price: 10,
    stock: 3, reservedStock: 0, expiryTrackingEnabled: true, expiryBatchReconciled: false,
  });
  const result = await invokeReconciliation(String(product._id), {
    requestId: 'reconcile:unlabeled-lots', expectedStock: 3, expectedUpdatedAt: product.updatedAt.toISOString(),
    batches: [
      { expiryDate: '2028-08-01', lotNumber: '', quantity: 1 },
      { expiryDate: '2028-08-01', lotNumber: '', quantity: 2 },
    ],
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.reconciled, true);
  assert.equal(result.body.batches.length, 2);
  assert.equal(new Set(result.body.batches.map((batch) => batch.batchId)).size, 2);
  assert.deepEqual(result.body.batches.map((batch) => batch.remainingQuantity).sort((a, b) => a - b), [1, 2]);
});

test('FEFO splits consumption across earliest unexpired batches and restores the exact batches', async () => {
  const product = await createTrackedProduct('fefo-split', { stock: 10 });
  const expired = await createBatch(product, 'EXPIRED', manilaDateOffset(-1), 2);
  const first = await createBatch(product, 'FIRST', manilaDateOffset(5), 4);
  const second = await createBatch(product, 'SECOND', manilaDateOffset(35), 4);
  const saleId = new mongoose.Types.ObjectId();
  let allocation;
  await runInTransaction(async (session) => {
    const current = await Product.findById(product._id).session(session);
    allocation = await allocateUnreservedBatches({
      product: current, quantity: 6, session, type: 'SALE', sourceType: 'Sale', sourceId: saleId,
      requestId: 'fefo-sale-1', operationKeyPrefix: `fefo-sale:${saleId}`, actor, reason: 'POS sale',
    });
    await Product.updateOne({ _id: product._id, stock: 10 }, { $inc: { stock: -6 } }, { session });
  });
  assert.deepEqual(allocation.allocations.map(({ batchId, quantity }) => [batchId, quantity]), [[first.batchId, 4], [second.batchId, 2]]);
  let afterSale = await Product.findById(product._id);
  let availability = await getExpiryBatchAvailability(afterSale);
  assert.equal(afterSale.stock, 4);
  assert.equal(availability.valid, true);
  assert.equal(availability.availableToSell, 2, 'expired stock remains physical but is not saleable');
  assert.equal((await ExpiryBatch.findById(expired._id)).remainingQuantity, 2);
  assert.equal((await ExpiryBatch.findById(first._id)).remainingQuantity, 0);
  assert.equal((await ExpiryBatch.findById(second._id)).remainingQuantity, 2);

  await runInTransaction(async (session) => {
    const current = await Product.findById(product._id).session(session);
    await restoreSaleBatches({
      product: current, allocations: allocation.allocations, saleId, requestId: 'void:fefo-sale-1',
      operationKeyPrefix: `fefo-void:${saleId}`, actor, session,
    });
    await Product.updateOne({ _id: product._id, stock: 4 }, { $inc: { stock: 6 } }, { session });
  });
  afterSale = await Product.findById(product._id);
  availability = await getExpiryBatchAvailability(afterSale);
  assert.equal(availability.valid, true);
  assert.equal(afterSale.stock, 10);
  assert.equal(availability.availableToSell, 8);
  assert.deepEqual(await ExpiryBatchMovement.find({ sourceId: saleId, type: 'SALE' }).sort({ createdAt: 1 }).then((rows) => rows.map((row) => row.quantity)), [4, 2]);
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: saleId, type: 'SALE_VOID' }), 2);
});

test('expiry monitoring reports confirmed metrics only and never exposes provisional remaining quantities as verified', async () => {
  const today = manilaDateOffset(0);
  const beforeMonitoring = await invokeExpiryMonitoring();
  const beforeExpiredProductIds = new Set(beforeMonitoring.body.batches
    .filter((batch) => batch.balanceConfirmed && batch.status === 'Expired' && batch.remainingQuantity > 0)
    .map((batch) => batch.productId));
  const expiredPcs = await createTrackedProduct('monitor-expired-pcs', { stock: 5 });
  const expiredKg = await Product.create({ name: 'Monitor Expired KG', sku: 'BATCH-MONITOR-EXPIRED-KG', sellingUnit: 'kg', price: 10, stock: 4, reservedStock: 0, expiryTrackingEnabled: true, expiryTrackingPeriodId: createExpiryTrackingPeriodId(), expiryBatchReconciled: true });
  const expiringSoon = await createTrackedProduct('monitor-expiring-soon', { stock: 2 });
  const depleted = await createTrackedProduct('monitor-depleted', { stock: 0 });
  const provisional = await Product.create({ name: 'Monitor Provisional', sku: 'BATCH-MONITOR-PROVISIONAL', sellingUnit: 'pcs', price: 10, stock: 9, reservedStock: 0, expiryTrackingEnabled: true, expiryTrackingPeriodId: createExpiryTrackingPeriodId(), expiryUnassignedStock: 2, expiryBatchReconciled: false });
  const unassigned = await Product.create({ name: 'Monitor Unassigned', sku: 'BATCH-MONITOR-UNASSIGNED', sellingUnit: 'pcs', price: 10, stock: 8, reservedStock: 0, expiryTrackingEnabled: true, expiryBatchReconciled: false });
  const expiredPcsBatch = await createBatch(expiredPcs, 'MONITOR-EXPIRED-PCS', today, 3);
  const secondExpiredPcsBatch = await createBatch(expiredPcs, 'MONITOR-EXPIRED-PCS-SECOND', manilaDateOffset(-2), 2);
  const expiredKgBatch = await createBatch(expiredKg, 'MONITOR-EXPIRED-KG', manilaDateOffset(-1), 4);
  const expiringBatch = await createBatch(expiringSoon, 'MONITOR-30-DAY', manilaDateOffset(30), 2);
  const depletedBatch = await createBatch(depleted, 'MONITOR-DEPLETED', today, 0);
  const provisionalBatch = await createBatch(provisional, 'MONITOR-PROVISIONAL', today, 7);

  const responseBody = (await invokeExpiryMonitoring()).body;
  const rows = new Map(responseBody.batches.map((batch) => [batch.id, batch]));
  assert.equal(responseBody.asOfDate, today);
  assert.equal(rows.get(String(expiredPcsBatch._id)).status, 'Expired');
  assert.equal(rows.get(String(expiredKgBatch._id)).status, 'Expired');
  assert.equal(rows.get(String(expiringBatch._id)).status, 'Expiring Soon');
  assert.equal(rows.get(String(depletedBatch._id)).status, 'Depleted');
  assert.equal(rows.get(String(provisionalBatch._id)).balanceConfirmed, false);
  assert.equal(rows.get(String(provisionalBatch._id)).remainingQuantity, null);
  assert.equal(rows.get(String(provisionalBatch._id)).productStock, 9, 'unverified batch rows carry the current product stock for the verification list');
  assert.equal(rows.get(String(provisionalBatch._id)).status, 'Expired', 'date status remains visible while its balance is explicitly provisional');
  assert.deepEqual(responseBody.unassignedProducts.find((product) => product.productId === String(unassigned._id)), {
    productId: String(unassigned._id), productName: unassigned.name, sku: unassigned.sku,
    productStock: 8, existingStockToVerify: 8, sellingUnit: 'pcs',
  });
  assert.equal(responseBody.unassignedProducts.length >= 1, true);
  assert.equal(await ExpiryBatch.countDocuments({ product: unassigned._id }), 0, 'monitoring must not fabricate a batch for unassigned stock');
  const confirmedRows = responseBody.batches.filter((batch) => batch.balanceConfirmed);
  const expiredRows = confirmedRows.filter((batch) => batch.status === 'Expired');
  const expiredByUnit = new Map();
  expiredRows.forEach((batch) => expiredByUnit.set(batch.sellingUnit || 'unit', (expiredByUnit.get(batch.sellingUnit || 'unit') || 0) + batch.remainingQuantity));
  assert.equal(responseBody.summary.expiringSoonBatches, confirmedRows.filter((batch) => batch.status === 'Expiring Soon').length);
  assert.equal(responseBody.summary.expiringSoonBatches >= 1, true);
  assert.equal(responseBody.summary.expiredBatches, expiredRows.length);
  assert.equal(responseBody.summary.expiredBatches >= 2, true);
  assert.equal(responseBody.summary.productsWithExpiredStock - beforeExpiredProductIds.size, 2, 'multiple expired batches for one SKU count once, while a second SKU adds one');
  assert.deepEqual(responseBody.summary.expiredRemainingByUnit, [...expiredByUnit.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([unit, quantity]) => ({ unit, quantity })));
  assert.equal(expiredRows.find((batch) => batch.id === String(expiredKgBatch._id)).remainingQuantity, 4);
  assert.equal(expiredRows.find((batch) => batch.id === String(expiredPcsBatch._id)).remainingQuantity, 3);
  assert.equal(expiredRows.find((batch) => batch.id === String(secondExpiredPcsBatch._id)).remainingQuantity, 2);
  assert.equal(expiredRows.some((batch) => batch.id === String(depletedBatch._id)), false, 'depleted expired batches are excluded from expired stock products');
  assert.equal(expiredRows.some((batch) => batch.id === String(provisionalBatch._id)), false, 'provisional expired batches are excluded from expired stock products');
});

test('expiry date correction preserves historical batch allocations and refreshes Manila expiry status', async () => {
  const product = await createTrackedProduct('expiry-date-correction-history', { stock: 5 });
  const originalExpiryDate = '2030-05-01';
  const batch = await createBatch(product, 'DATE-CORRECTION-HISTORY', originalExpiryDate, 5);
  const saleId = new mongoose.Types.ObjectId();
  await runInTransaction(async (session) => {
    const current = await Product.findById(product._id).session(session);
    const allocation = await allocateUnreservedBatches({
      product: current, quantity: 1, session, type: 'SALE', sourceType: 'Sale', sourceId: saleId,
      requestId: 'expiry-date-correction-historical-sale', operationKeyPrefix: 'expiry-date-correction-historical-sale', actor,
    });
    assert.equal(allocation.allocations.length, 1);
    await Product.updateOne({ _id: product._id, stock: 5 }, { $inc: { stock: -1 } }, { session });
  });
  const beforeCorrection = await ExpiryBatch.findById(batch._id);
  const unchangedQuantities = { stock: (await Product.findById(product._id)).stock, remaining: beforeCorrection.remainingQuantity, reserved: beforeCorrection.reservedQuantity };
  const request = {
    newExpiryDate: manilaDateOffset(-1),
    reason: 'Corrected from the package date.',
    requestId: 'expiry-date-correction-history-request',
    expectedUpdatedAt: beforeCorrection.updatedAt.toISOString(),
  };

  const corrected = await invokeExpiryCorrection(product._id, batch._id, request);
  assert.equal(corrected.statusCode, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.batch.expiryDate, request.newExpiryDate);
  assert.equal(corrected.body.correction.previousExpiryDate, originalExpiryDate);
  assert.equal(corrected.body.correction.newExpiryDate, request.newExpiryDate);
  assert.equal(corrected.body.correction.reason, request.reason);
  assert.equal(corrected.body.correction.actorName, actor.name);
  assert.ok(corrected.body.correction.correctedAt);

  const [savedProduct, savedBatch, historicalMovement, audit] = await Promise.all([
    Product.findById(product._id), ExpiryBatch.findById(batch._id),
    ExpiryBatchMovement.findOne({ sourceId: saleId, type: 'SALE' }),
    ExpiryBatchCorrection.findOne({ requestId: request.requestId }),
  ]);
  assert.deepEqual({ stock: savedProduct.stock, remaining: savedBatch.remainingQuantity, reserved: savedBatch.reservedQuantity }, unchangedQuantities);
  assert.equal(historicalMovement.expiryDate, originalExpiryDate, 'recorded sale allocation retains its original date snapshot');
  assert.equal(audit.historicalMovementCount, 1);
  assert.equal(audit.historicalAllocationCount, 1);
  assert.equal(await ExpiryBatchCorrection.countDocuments({ batch: batch._id }), 1);
  const monitoring = await invokeExpiryMonitoring();
  const monitoredBatch = monitoring.body.batches.find((row) => row.id === String(batch._id));
  assert.equal(monitoredBatch.status, 'Expired');
  assert.ok(monitoredBatch.updatedAt, 'monitoring exposes the batch version required by the correction modal');

  const replay = await invokeExpiryCorrection(product._id, batch._id, request);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(await ExpiryBatchCorrection.countDocuments({ batch: batch._id }), 1, 'retry does not append a duplicate audit entry');
});

test('expiry date correction accepts a corrected future date and blocks invalid, unauthorized, duplicate, and reserved changes', async () => {
  const expiredProduct = await createTrackedProduct('expiry-date-correction-future', { stock: 1 });
  const expiredBatch = await createBatch(expiredProduct, 'DATE-CORRECTION-FUTURE', manilaDateOffset(-2), 1);
  const expiredVersion = (await ExpiryBatch.findById(expiredBatch._id)).updatedAt.toISOString();
  const futureDate = manilaDateOffset(90);
  const futureCorrection = await invokeExpiryCorrection(expiredProduct._id, expiredBatch._id, {
    newExpiryDate: futureDate, reason: 'Verified package label.', requestId: 'expiry-correction-to-future', expectedUpdatedAt: expiredVersion,
  });
  assert.equal(futureCorrection.statusCode, 200, JSON.stringify(futureCorrection.body));
  assert.equal((await ExpiryBatch.findById(expiredBatch._id)).expiryDate, futureDate);
  const futureStatus = (await invokeExpiryMonitoring()).body.batches.find((row) => row.id === String(expiredBatch._id));
  assert.equal(futureStatus.status, 'Valid');
  assert.ok(futureStatus.updatedAt, 'monitoring returns the updated batch concurrency token');

  const reservedProduct = await createTrackedProduct('expiry-date-correction-reserved', { stock: 2, reservedStock: 1 });
  const reservedBatch = await createBatch(reservedProduct, 'DATE-CORRECTION-RESERVED', manilaDateOffset(30), 2, 1);
  const specialOrderId = new mongoose.Types.ObjectId();
  await SpecialOrderStockReservation.create({
    specialOrder: specialOrderId, product: reservedProduct._id, sku: reservedProduct.sku,
    orderedQuantity: 1, reservedQuantity: 1,
    batchAllocations: [{ batch: reservedBatch._id, batchId: reservedBatch.batchId, expiryDate: reservedBatch.expiryDate, quantity: 1 }],
    status: 'Active', createdBy: actor._id, updatedBy: actor._id,
  });
  const reservedVersion = (await ExpiryBatch.findById(reservedBatch._id)).updatedAt.toISOString();
  const blocked = await invokeExpiryCorrection(reservedProduct._id, reservedBatch._id, {
    newExpiryDate: manilaDateOffset(60), reason: 'Package was rechecked.', requestId: 'expiry-correction-reserved', expectedUpdatedAt: reservedVersion,
  });
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body.message, /active reservation/i);
  assert.equal((await ExpiryBatch.findById(reservedBatch._id)).expiryDate, reservedBatch.expiryDate);

  const missingReason = await invokeExpiryCorrection(expiredProduct._id, expiredBatch._id, {
    newExpiryDate: manilaDateOffset(120), reason: '  ', requestId: 'expiry-correction-no-reason', expectedUpdatedAt: (await ExpiryBatch.findById(expiredBatch._id)).updatedAt,
  });
  assert.equal(missingReason.statusCode, 400);
  assert.match(missingReason.body.message, /reason/i);
  const invalidDate = await invokeExpiryCorrection(expiredProduct._id, expiredBatch._id, {
    newExpiryDate: '2026-02-30', reason: 'Invalid date check.', requestId: 'expiry-correction-invalid-date', expectedUpdatedAt: (await ExpiryBatch.findById(expiredBatch._id)).updatedAt,
  });
  assert.equal(invalidDate.statusCode, 400);
  const unauthorized = await invokeExpiryCorrection(expiredProduct._id, expiredBatch._id, {
    newExpiryDate: manilaDateOffset(120), reason: 'Permission check.', requestId: 'expiry-correction-unauthorized', expectedUpdatedAt: (await ExpiryBatch.findById(expiredBatch._id)).updatedAt,
  }, { _id: new mongoose.Types.ObjectId(), role: 'cashier', name: 'Cashier' });
  assert.equal(unauthorized.statusCode, 403);

  const unchanged = await invokeExpiryCorrection(expiredProduct._id, expiredBatch._id, {
    newExpiryDate: futureDate, reason: 'Unchanged date check.', requestId: 'expiry-correction-unchanged', expectedUpdatedAt: (await ExpiryBatch.findById(expiredBatch._id)).updatedAt,
  });
  assert.equal(unchanged.statusCode, 400);
  assert.match(unchanged.body.message, /different expiry date/i);

  const collisionProduct = await createTrackedProduct('expiry-date-correction-collision', { stock: 2 });
  const collisionTarget = manilaDateOffset(75);
  const correctable = await createBatch(collisionProduct, 'CORRECTION-SAME-LOT', manilaDateOffset(45), 1);
  await createBatch(collisionProduct, 'CORRECTION-SAME-LOT', collisionTarget, 1);
  const collisionVersion = (await ExpiryBatch.findById(correctable._id)).updatedAt.toISOString();
  const collision = await invokeExpiryCorrection(collisionProduct._id, correctable._id, {
    newExpiryDate: collisionTarget, reason: 'Resolve duplicate lot identity.', requestId: 'expiry-correction-collision', expectedUpdatedAt: collisionVersion,
  });
  assert.equal(collision.statusCode, 409);
  assert.match(collision.body.message, /manual review/i);
});

test('concurrent expiry date corrections use batch versions and idempotency to commit one change', async () => {
  const product = await createTrackedProduct('expiry-date-correction-race', { stock: 4 });
  const batch = await createBatch(product, 'DATE-CORRECTION-RACE', '2030-10-01', 4);
  const expectedUpdatedAt = (await ExpiryBatch.findById(batch._id)).updatedAt.toISOString();
  const base = { reason: 'Label verification.', expectedUpdatedAt };
  const outcomes = await Promise.all([
    invokeExpiryCorrection(product._id, batch._id, { ...base, newExpiryDate: '2030-11-01', requestId: 'expiry-date-correction-race-a' }),
    invokeExpiryCorrection(product._id, batch._id, { ...base, newExpiryDate: '2030-12-01', requestId: 'expiry-date-correction-race-b' }),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.statusCode).sort(), [200, 409]);
  const [savedProduct, savedBatch] = await Promise.all([Product.findById(product._id), ExpiryBatch.findById(batch._id)]);
  assert.equal(savedProduct.stock, 4);
  assert.equal(savedProduct.reservedStock, 0);
  assert.equal(savedBatch.remainingQuantity, 4);
  assert.equal(savedBatch.reservedQuantity, 0);
  assert.equal(await ExpiryBatchCorrection.countDocuments({ batch: batch._id }), 1);

  const retryProduct = await createTrackedProduct('expiry-date-correction-concurrent-retry', { stock: 1 });
  const retryBatch = await createBatch(retryProduct, 'DATE-CORRECTION-RETRY', '2031-01-01', 1);
  const retryVersion = (await ExpiryBatch.findById(retryBatch._id)).updatedAt.toISOString();
  const retryPayload = { newExpiryDate: '2031-02-01', reason: 'Duplicate click protection.', requestId: 'expiry-date-correction-same-request', expectedUpdatedAt: retryVersion };
  const duplicateRequests = await Promise.all([
    invokeExpiryCorrection(retryProduct._id, retryBatch._id, retryPayload),
    invokeExpiryCorrection(retryProduct._id, retryBatch._id, retryPayload),
  ]);
  assert.ok(duplicateRequests.every((outcome) => outcome.statusCode === 200), JSON.stringify(duplicateRequests));
  assert.equal(duplicateRequests.filter((outcome) => outcome.body.replayed).length, 1);
  assert.equal(await ExpiryBatchCorrection.countDocuments({ batch: retryBatch._id }), 1);

  const stockRaceProduct = await createTrackedProduct('expiry-date-correction-stock-race', { stock: 2 });
  const stockRaceBatch = await createBatch(stockRaceProduct, 'DATE-CORRECTION-STOCK-RACE', manilaDateOffset(20), 2);
  const stockRaceVersion = (await ExpiryBatch.findById(stockRaceBatch._id)).updatedAt.toISOString();
  const saleId = new mongoose.Types.ObjectId();
  const [correctionOutcome, saleOutcome] = await Promise.allSettled([
    invokeExpiryCorrection(stockRaceProduct._id, stockRaceBatch._id, {
      newExpiryDate: manilaDateOffset(-1), reason: 'Correct against verified label.',
      requestId: 'expiry-date-correction-vs-sale', expectedUpdatedAt: stockRaceVersion,
    }),
    runInTransaction(async (session) => {
      const current = await Product.findById(stockRaceProduct._id).session(session);
      const allocation = await allocateUnreservedBatches({
        product: current, quantity: 1, session, type: 'SALE', sourceType: 'Sale', sourceId: saleId,
        requestId: 'expiry-date-correction-race-sale', operationKeyPrefix: 'expiry-date-correction-race-sale', actor,
      });
      await Product.updateOne({ _id: stockRaceProduct._id, stock: 2 }, { $inc: { stock: -1 } }, { session });
      return allocation;
    }),
  ]);
  const finalRaceProduct = await Product.findById(stockRaceProduct._id);
  const finalRaceBatch = await ExpiryBatch.findById(stockRaceBatch._id);
  assert.equal(finalRaceProduct.stock, finalRaceBatch.remainingQuantity, 'competing correction and sale keep aggregate and batch stock aligned');
  assert.ok(finalRaceProduct.stock === 1 || finalRaceProduct.stock === 2);
  if (finalRaceProduct.stock === 1) {
    assert.equal(correctionOutcome.status, 'fulfilled');
    assert.equal(correctionOutcome.value.statusCode, 409);
    assert.equal(saleOutcome.status, 'fulfilled');
    assert.equal(finalRaceBatch.expiryDate, manilaDateOffset(20));
  } else {
    assert.equal(correctionOutcome.status, 'fulfilled');
    assert.equal(correctionOutcome.value.statusCode, 200);
    assert.equal(saleOutcome.status, 'rejected');
    assert.equal(finalRaceBatch.expiryDate, manilaDateOffset(-1));
  }
});

test('batches expiring today are unavailable, and an aged Special Order hold remains intact when completion is rejected', async () => {
  const today = manilaDateOffset(0);
  const expiredTodayProduct = await createTrackedProduct('expiry-today-pos', { stock: 2 });
  const todayBatch = await createBatch(expiredTodayProduct, 'EXPIRY-TODAY', today, 2);
  assert.equal((await getExpiryBatchAvailability(await Product.findById(expiredTodayProduct._id))).availableToSell, 0);
  await assert.rejects(runInTransaction(async (session) => {
    const current = await Product.findById(expiredTodayProduct._id).session(session);
    return allocateUnreservedBatches({ product: current, quantity: 1, session, type: 'SALE', sourceType: 'Sale', requestId: 'expiry-today-sale', operationKeyPrefix: 'expiry-today-sale', actor });
  }), /Insufficient unexpired/i);
  assert.equal((await ExpiryBatch.findById(todayBatch._id)).remainingQuantity, 2);
  assert.equal((await Product.findById(expiredTodayProduct._id)).stock, 2);

  const reservedProduct = await createTrackedProduct('expiry-reservation-ages', { stock: 1 });
  const expiringBatch = await createBatch(reservedProduct, 'EXPIRY-RESERVED-TOMORROW', manilaDateOffset(1), 1);
  const specialOrderId = new mongoose.Types.ObjectId();
  const quotation = await SpecialOrderQuotation.create({
    specialOrder: specialOrderId, quotationNumber: 'Q-EXPIRY-AGES-1', version: 1,
    status: 'Accepted', customerName: 'Expiry Test', subtotal: 10, total: 10,
    items: [{ itemId: 'expiry-reservation-item', itemName: reservedProduct.name, itemType: 'inventory',
      inventoryProduct: reservedProduct._id, inventorySnapshot: { sku: reservedProduct.sku }, quantity: 1, unitPrice: 10, lineAmount: 10 }],
  });
  const order = { _id: specialOrderId, currentQuotation: quotation._id, items: [], status: 'In Progress', workflowVersion: 1, fulfillment: {} };
  await runInTransaction((session) => applyStockOperation({ order, session, actor: actor._id, requestId: 'expiry-reservation-aging-hold', action: 'Reserve' }));
  const reservation = await SpecialOrderStockReservation.findOne({ specialOrder: specialOrderId, product: reservedProduct._id });
  const movementCountBefore = await ExpiryBatchMovement.countDocuments({ batch: expiringBatch._id });
  const expiryDayEveningUtc = new Date(`${expiringBatch.expiryDate}T12:00:00.000Z`);
  await assert.rejects(runInTransaction(async (session) => {
    const currentProduct = await Product.findById(reservedProduct._id).session(session);
    return consumeReservedExpiryBatches({
      product: currentProduct,
      allocations: reservation.batchAllocations,
      quantity: 1, session, saleId: new mongoose.Types.ObjectId(), orderId: specialOrderId,
      requestId: 'expiry-reservation-aging-consume', operationKeyPrefix: 'expiry-reservation-aging-consume', actor,
      now: expiryDayEveningUtc,
    });
  }), /has expired and cannot be sold/i);
  const [latestProduct, latestBatch, latestReservation] = await Promise.all([
    Product.findById(reservedProduct._id), ExpiryBatch.findById(expiringBatch._id),
    SpecialOrderStockReservation.findById(reservation._id),
  ]);
  assert.equal(latestProduct.stock, 1);
  assert.equal(latestProduct.reservedStock, 1);
  assert.equal(latestBatch.remainingQuantity, 1);
  assert.equal(latestBatch.reservedQuantity, 1);
  assert.equal(latestReservation.status, 'Active');
  assert.equal(latestReservation.history.some((entry) => entry.action === 'Consume'), false);
  assert.equal(await ExpiryBatchMovement.countDocuments({ batch: expiringBatch._id }), movementCountBefore);
});

test('Special Order release clears only its exact expiry-batch holds without changing physical stock', async () => {
  const product = await createTrackedProduct('special-order-release', { stock: 4 });
  const first = await createBatch(product, 'SO-RELEASE-FIRST', manilaDateOffset(10), 2);
  const second = await createBatch(product, 'SO-RELEASE-SECOND', manilaDateOffset(25), 2);
  const specialOrderId = new mongoose.Types.ObjectId();
  const quotation = await SpecialOrderQuotation.create({
    specialOrder: specialOrderId, quotationNumber: 'Q-EXPIRY-RELEASE-1', version: 1,
    status: 'Accepted', customerName: 'Expiry Test', subtotal: 30, total: 30,
    items: [{ itemId: 'release-item', itemName: product.name, itemType: 'inventory',
      inventoryProduct: product._id, inventorySnapshot: { sku: product.sku }, quantity: 3, unitPrice: 10, lineAmount: 30 }],
  });
  const order = { _id: specialOrderId, currentQuotation: quotation._id, items: [], status: 'In Progress', workflowVersion: 1, fulfillment: {} };
  await runInTransaction((session) => applyStockOperation({
    order, session, actor: actor._id, requestId: 'expiry-release:reserve', action: 'Reserve',
  }));

  const released = await runInTransaction((session) => applyStockOperation({
    order, session, actor: actor._id, requestId: 'expiry-release:release', action: 'Release',
  }));
  assert.equal(released.replayed, false);
  const [savedProduct, firstBatch, secondBatch, reservation] = await Promise.all([
    Product.findById(product._id), ExpiryBatch.findById(first._id), ExpiryBatch.findById(second._id),
    SpecialOrderStockReservation.findOne({ specialOrder: specialOrderId, product: product._id }),
  ]);
  assert.equal(savedProduct.stock, 4);
  assert.equal(savedProduct.reservedStock, 0);
  assert.equal(firstBatch.remainingQuantity + secondBatch.remainingQuantity, 4);
  assert.equal(firstBatch.reservedQuantity + secondBatch.reservedQuantity, 0);
  assert.equal(reservation.status, 'Released');
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: specialOrderId, type: 'SPECIAL_ORDER_RELEASE' }), 2);
  const availability = await getExpiryBatchAvailability(savedProduct);
  assert.equal(availability.valid, true);
  assert.equal(availability.availableToSell, 4);
});

test('legacy Sale Void restores aggregate stock without inventing batch history', async () => {
  const product = await createTrackedProduct('legacy-sale-void', { stock: 3 });
  const batch = await createBatch(product, 'LEGACY-SALE-VOID', manilaDateOffset(45), 3);
  const sale = await Sale.create({
    items: [{ product: product._id, name: product.name, code: product.sku, quantity: 1, unitPrice: 10, subtotal: 10 }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  });

  const result = await executeSaleVoid({
    saleId: sale._id, reason: 'Legacy transaction reversal', requestId: 'expiry-legacy-sale-void', user: actor,
  }, { checkEligibility: async () => ({ eligible: true }) });

  const [savedProduct, unchangedBatch] = await Promise.all([
    Product.findById(product._id), ExpiryBatch.findById(batch._id),
  ]);
  assert.equal(result.replayed, false);
  assert.equal(result.restorations[0].batchReconciliationRequired, true);
  assert.equal(savedProduct.stock, 4, 'the historical sale quantity is restored to aggregate stock');
  assert.equal(savedProduct.expiryBatchReconciled, false, 'unknown original batch is never guessed');
  assert.equal(unchangedBatch.remainingQuantity, 3, 'the provisional batches remain untouched');
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: sale._id, type: 'SALE_VOID' }), 0);
  assert.equal((await Sale.findById(sale._id)).status, 'voided');
});

test('concurrent expiry-tracked Stock-In and Stock-Out cannot apply against the same product snapshot', async () => {
  const product = await createTrackedProduct('concurrent-stock-in-out', { stock: 5 });
  const batch = await createBatch(product, 'CONCURRENT-STOCK-IN-OUT', manilaDateOffset(40), 5);
  const snapshot = await Product.findById(product._id);
  const shared = { expectedStock: snapshot.stock, expectedUpdatedAt: snapshot.updatedAt.toISOString() };
  const [stockIn, stockOut] = await Promise.all([
    invokeStock(String(product._id), {
      stock: snapshot.stock + 2, ...shared, adjustmentRequestId: 'expiry-in-out:in',
      adjustmentType: 'IN', adjustmentQuantity: 2, inventoryAdjustmentReason: 'Delivery',
      expiryBatch: { expiryDate: manilaDateOffset(80), lotNumber: 'RACE-IN' },
    }),
    invokeStock(String(product._id), {
      stock: snapshot.stock - 4, ...shared, adjustmentRequestId: 'expiry-in-out:out',
      adjustmentType: 'OUT', adjustmentQuantity: 4, inventoryAdjustmentReason: 'Damage',
      batchAllocations: [stockOutBatchAllocation(batch, 4)],
    }),
  ]);

  assert.deepEqual([stockIn.statusCode, stockOut.statusCode].sort(), [200, 409]);
  const savedProduct = await Product.findById(product._id);
  const availability = await getExpiryBatchAvailability(savedProduct);
  assert.equal(availability.valid, true);
  assert.ok(savedProduct.stock === 7 || savedProduct.stock === 1);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), savedProduct.stock === 7 ? 1 : 0);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id, type: 'STOCK_OUT' }), savedProduct.stock === 1 ? 1 : 0);
});

test('Sale Void after re-enabling leaves an old allocation in history and assigns the restored unit for fresh verification', async () => {
  const product = await createTrackedProduct('closed-period-void', { stock: 0 });
  const oldBatch = await createBatch(product, 'CLOSED-PERIOD-SOLD-LOT', manilaDateOffset(20), 1);
  await ExpiryBatch.updateOne({ _id: oldBatch._id }, { $set: { remainingQuantity: 0 } });
  const allocation = { batch: oldBatch._id, batchId: oldBatch.batchId, expiryDate: oldBatch.expiryDate, quantity: 1 };
  const [sale] = await Sale.create([{
    status: 'completed', saleType: 'regular',
    items: [{
      product: product._id, name: product.name, code: product.sku, quantity: 1,
      unitPrice: 10, subtotal: 10,
      batchVerification: { proposedAllocations: [allocation], verifiedAllocations: [allocation], overridden: false, verifiedAt: new Date(), verifiedBy: actor._id },
    }],
    totalAmount: 10, grossAmount: 10, netAmount: 10, vatAmount: 0,
    paymentMethod: 'cash', paymentStatus: 'Paid', cashier: actor._id,
  }]);
  await ExpiryBatchMovement.create([{
    operationKey: 'closed-period-void-sale', product: product._id, sku: product.sku,
    batch: oldBatch._id, batchId: oldBatch.batchId, expiryDate: oldBatch.expiryDate,
    type: 'SALE', quantity: 1, remainingDelta: -1, reservedDelta: 0,
    sourceType: 'Sale', sourceId: sale._id,
  }]);

  const disabled = await invoke({ expiryTrackingEnabled: false }, String(product._id));
  assert.equal(disabled.statusCode, 200, disabled.body?.message);
  const enabled = await invoke({
    expiryTrackingEnabled: true,
    expectedUpdatedAt: disabled.body.updatedAt.toISOString(),
  }, String(product._id));
  assert.equal(enabled.statusCode, 200, enabled.body?.message);
  assert.equal(enabled.body.expiryBatchReconciled, true, 'zero current stock has no opening balance to infer');

  const voided = await executeSaleVoid({
    saleId: sale._id, reason: 'Historical sale correction', requestId: 'closed-period-void-request', user: actor,
  }, { checkEligibility: async () => ({ eligible: true }) });
  assert.equal(voided.restorations[0].batchReconciliationRequired, true);
  const afterVoid = await Product.findById(product._id);
  assert.equal(afterVoid.stock, 1);
  assert.equal(afterVoid.expiryBatchReconciled, false);
  assert.equal(afterVoid.expiryUnassignedStock, 1);
  assert.equal((await ExpiryBatch.findById(oldBatch._id)).remainingQuantity, 0, 'the historical source batch is not changed');
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceType: 'SaleVoid', sourceId: sale._id }), 0);
  const monitoring = (await invokeExpiryMonitoring()).body;
  assert.ok(monitoring.batches.some((batch) => batch.id === String(oldBatch._id) && batch.isHistoricalPeriod));
  assert.ok(monitoring.unassignedProducts.some((entry) => entry.productId === String(product._id) && entry.existingStockToVerify === 1));
});

test('POS sale and Sale Void move reconciled stock through the sale batches exactly once', async () => {
  const product = await createTrackedProduct('pos-sale-void', { stock: 5 });
  const firstBatch = await createBatch(product, 'POS-SALE-FIRST', manilaDateOffset(10), 2);
  const secondBatch = await createBatch(product, 'POS-SALE-SECOND', manilaDateOffset(25), 3);
  const batchVerifications = await makeBatchVerification(product, 3);
  let created;
  await runInTransaction(async (session) => {
    created = await executeSaleCreation({
      req: {
        body: { items: [{ productId: String(product._id), quantity: 3 }], paymentMethod: 'cash', cashTendered: '30.00', vatMode: 'zero-rated', batchVerifications },
        user: actor, ip: '127.0.0.1', get: () => 'phase2-test',
      },
      session,
      clientRequestId: 'expiry-pos-sale:one',
    });
  });
  assert.ok(created.sale._id);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await ExpiryBatch.findById(firstBatch._id)).remainingQuantity, 0);
  assert.equal((await ExpiryBatch.findById(secondBatch._id)).remainingQuantity, 2);
  const saleMovements = await ExpiryBatchMovement.find({ sourceId: created.sale._id, type: 'SALE' }).sort({ expiryDate: 1 }).lean();
  assert.deepEqual(saleMovements.map((movement) => movement.quantity), [2, 1]);
  const deductionLog = await InventoryLog.findOne({ saleRef: created.sale._id, action: 'DEDUCT' }).lean();
  assert.equal(deductionLog.batchMovementRefs.length, 2);
  const monitorAfterSale = (await invokeExpiryMonitoring()).body.batches.filter((batch) => batch.productId === String(product._id));
  assert.ok(monitorAfterSale.every((batch) => batch.balanceConfirmed));
  assert.deepEqual(new Map(monitorAfterSale.map((batch) => [batch.id, batch.remainingQuantity])), new Map([
    [String(firstBatch._id), 0], [String(secondBatch._id), 2],
  ]));

  const voided = await executeSaleVoid({
    saleId: created.sale._id,
    reason: 'Test sale reversal',
    requestId: 'expiry-sale-void:one',
    user: actor,
    ipAddress: '127.0.0.1',
    userAgent: 'phase2-test',
  }, { checkEligibility: async () => ({ eligible: true }) });
  assert.equal(voided.replayed, false);
  assert.equal((await Product.findById(product._id)).stock, 5);
  assert.equal((await ExpiryBatch.findById(firstBatch._id)).remainingQuantity, 2);
  assert.equal((await ExpiryBatch.findById(secondBatch._id)).remainingQuantity, 3);
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: created.sale._id, type: 'SALE_VOID' }), 2);
  const restoredState = await getExpiryBatchAvailability(await Product.findById(product._id));
  assert.equal(restoredState.valid, true);
  const monitorAfterVoid = (await invokeExpiryMonitoring()).body.batches.filter((batch) => batch.productId === String(product._id));
  assert.ok(monitorAfterVoid.every((batch) => batch.balanceConfirmed));
  assert.deepEqual(new Map(monitorAfterVoid.map((batch) => [batch.id, batch.remainingQuantity])), new Map([
    [String(firstBatch._id), 2], [String(secondBatch._id), 3],
  ]));
  const replay = await executeSaleVoid({
    saleId: created.sale._id, reason: 'Test sale reversal', requestId: 'expiry-sale-void:retry', user: actor,
  }, { checkEligibility: async () => ({ eligible: true }) });
  assert.equal(replay.replayed, true);
  assert.equal((await Product.findById(product._id)).stock, 5);
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: created.sale._id, type: 'SALE_VOID' }), 2);
});

test('POS records a physically selected alternate batch and rejects a stale stock snapshot', async () => {
  const product = await createTrackedProduct('physical-pick', { stock: 5 });
  const firstBatch = await createBatch(product, 'PHYSICAL-PICK-FIRST', manilaDateOffset(10), 2);
  const secondBatch = await createBatch(product, 'PHYSICAL-PICK-SECOND', manilaDateOffset(25), 3);
  const [verification] = await makeBatchVerification(product, 2, {
    verifiedAllocations: [{ batch: secondBatch._id, batchId: secondBatch.batchId, expiryDate: secondBatch.expiryDate, quantity: 2 }],
    reason: 'The first physical lot was damaged in the rack.',
  });
  const body = { items: [{ productId: String(product._id), quantity: 2 }], paymentMethod: 'cash', cashTendered: '20.00', vatMode: 'zero-rated', batchVerifications: [verification] };
  let created;
  await runInTransaction(async (session) => {
    created = await executeSaleCreation({ req: { body, user: actor, ip: '127.0.0.1', get: () => 'physical-pick-test' }, session, clientRequestId: 'expiry-physical-pick:alternate' });
  });
  assert.equal((await ExpiryBatch.findById(firstBatch._id)).remainingQuantity, 2, 'the proposed FEFO batch was not silently deducted');
  assert.equal((await ExpiryBatch.findById(secondBatch._id)).remainingQuantity, 1, 'the confirmed physical batch was deducted');
  assert.equal(created.sale.items[0].batchVerification.overridden, true);
  assert.equal(created.sale.items[0].batchVerification.overrideReason, 'The first physical lot was damaged in the rack.');
  assert.equal(created.sale.items[0].batchVerification.verifiedAllocations[0].batchId, secondBatch.batchId);

  const staleProduct = await createTrackedProduct('physical-pick-stale', { stock: 4 });
  await createBatch(staleProduct, 'PHYSICAL-PICK-STALE', manilaDateOffset(30), 4);
  const [staleVerification] = await makeBatchVerification(staleProduct, 2);
  const oldStock = staleProduct.stock;
  const oldUpdatedAt = staleProduct.updatedAt;
  await Product.findByIdAndUpdate(staleProduct._id, { $set: { stock: oldStock + 1 } });
  const current = await Product.findById(staleProduct._id);
  await assert.rejects(runInTransaction((session) => executeSaleCreation({
    req: {
      body: { items: [{ productId: String(staleProduct._id), quantity: 2 }], paymentMethod: 'cash', cashTendered: '20.00', vatMode: 'zero-rated', batchVerifications: [staleVerification] },
      user: actor, ip: '127.0.0.1', get: () => 'physical-pick-stale-test',
    }, session, clientRequestId: 'expiry-physical-pick:stale',
  })), /Stock for .* changed/);
  assert.equal(current.stock, oldStock + 1);
  assert.equal(await Sale.countDocuments({ clientRequestId: 'expiry-physical-pick:stale' }), 0);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: staleProduct._id, type: 'SALE' }), 0);
  assert.ok(current.updatedAt > oldUpdatedAt);
});

test('concurrent POS sales cannot consume the same reconciled expiry batch balance', async () => {
  const product = await createTrackedProduct('concurrent-pos', { stock: 5 });
  const batch = await createBatch(product, 'CONCURRENT-POS', manilaDateOffset(30), 5);
  const batchVerifications = await makeBatchVerification(product, 4);
  const submit = (clientRequestId) => runInTransaction((session) => executeSaleCreation({
    req: {
      body: { items: [{ productId: String(product._id), quantity: 4 }], paymentMethod: 'cash', cashTendered: '40.00', vatMode: 'zero-rated', batchVerifications },
      user: actor, ip: '127.0.0.1', get: () => 'phase2-concurrency-test',
    },
    session,
    clientRequestId,
  }));
  const results = await Promise.allSettled([submit('expiry-concurrent-sale:a'), submit('expiry-concurrent-sale:b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const updatedProduct = await Product.findById(product._id);
  const updatedBatch = await ExpiryBatch.findById(batch._id);
  assert.equal(updatedProduct.stock, 1);
  assert.equal(updatedBatch.remainingQuantity, 1);
  assert.equal((await getExpiryBatchAvailability(updatedProduct)).valid, true);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id, type: 'SALE' }), 1);
});

test('concurrent POS sale and Special Order reservation preserve batch stock and holds', async () => {
  const product = await createTrackedProduct('concurrent-reserve-sale', { stock: 5 });
  const batch = await createBatch(product, 'CONCURRENT-RESERVE-SALE', manilaDateOffset(35), 5);
  const batchVerifications = await makeBatchVerification(product, 4);
  const specialOrderId = new mongoose.Types.ObjectId();
  const quotation = await SpecialOrderQuotation.create({
    specialOrder: specialOrderId, quotationNumber: 'Q-EXPIRY-CONCURRENT-1', version: 1,
    status: 'Accepted', customerName: 'Expiry Test', subtotal: 40, total: 40,
    items: [{ itemId: 'concurrent-item', itemName: product.name, itemType: 'inventory',
      inventoryProduct: product._id, inventorySnapshot: { sku: product.sku }, quantity: 4, unitPrice: 10, lineAmount: 40 }],
  });
  const order = { _id: specialOrderId, currentQuotation: quotation._id, items: [], status: 'In Progress', workflowVersion: 2, fulfillment: {} };
  const posSale = runInTransaction((session) => executeSaleCreation({
    req: {
        body: { items: [{ productId: String(product._id), quantity: 4 }], paymentMethod: 'cash', cashTendered: '40.00', vatMode: 'zero-rated', batchVerifications },
      user: actor, ip: '127.0.0.1', get: () => 'phase2-race-test',
    },
    session,
    clientRequestId: 'expiry-race-sale',
  }));
  const specialOrderHold = runInTransaction((session) => applyStockOperation({
    order, session, actor: actor._id, requestId: 'expiry-race-reserve', action: 'Reserve',
  }));
  await Promise.allSettled([posSale, specialOrderHold]);
  const latestProduct = await Product.findById(product._id);
  const latestBatch = await ExpiryBatch.findById(batch._id);
  const reservation = await SpecialOrderStockReservation.findOne({ specialOrder: specialOrderId, product: product._id, status: 'Active' }).lean();
  const reserved = Number(reservation?.reservedQuantity || 0);
  const sold = (await ExpiryBatchMovement.find({ product: product._id, type: 'SALE' }).lean())
    .reduce((sum, movement) => sum + movement.quantity, 0);
  assert.ok(sold > 0 || reserved > 0, 'at least one competing transaction should commit');
  assert.ok(sold + reserved <= 5, 'sale consumption and active holds cannot exceed the physical batch');
  assert.equal(latestProduct.stock, 5 - sold);
  assert.equal(latestProduct.reservedStock, reserved);
  assert.equal(latestBatch.remainingQuantity, latestProduct.stock);
  assert.equal(latestBatch.reservedQuantity, reserved);
  const availability = await getExpiryBatchAvailability(latestProduct);
  assert.equal(availability.valid, true);
  assert.equal(availability.availableToSell, latestProduct.stock - reserved);
});

test('Special Order reserves exact FEFO batches and consumes only those reserved quantities', async () => {
  const product = await createTrackedProduct('special-order', { stock: 5 });
  const first = await createBatch(product, 'SO-FIRST', manilaDateOffset(10), 2);
  const second = await createBatch(product, 'SO-SECOND', manilaDateOffset(50), 3);
  const specialOrderId = new mongoose.Types.ObjectId();
  const quotation = await SpecialOrderQuotation.create({
    specialOrder: specialOrderId, quotationNumber: 'Q-EXPIRY-SO-1', version: 1,
    status: 'Accepted', customerName: 'Expiry Test', subtotal: 40, total: 40,
    items: [{ itemId: 'inventory-item-1', itemName: product.name, itemType: 'inventory',
      inventoryProduct: product._id, inventorySnapshot: { sku: product.sku }, quantity: 4, unitPrice: 10, lineAmount: 40 }],
  });
  const order = { _id: specialOrderId, currentQuotation: quotation._id, items: [], status: 'In Progress', workflowVersion: 2, fulfillment: {} };
  const operationId = 'reserve:expiry-order-1';
  await runInTransaction((session) => applyStockOperation({ order, session, actor: actor._id, requestId: operationId, action: 'Reserve' }));
  let reservation = await SpecialOrderStockReservation.findOne({ specialOrder: specialOrderId, product: product._id });
  assert.deepEqual(reservation.batchAllocations.map((allocation) => [String(allocation.batch), allocation.quantity]), [[String(first._id), 2], [String(second._id), 2]]);
  const replay = await runInTransaction((session) => applyStockOperation({ order, session, actor: actor._id, requestId: operationId, action: 'Reserve' }));
  assert.equal(replay.replayed, true);
  reservation = await SpecialOrderStockReservation.findOne({ specialOrder: specialOrderId, product: product._id });
  assert.equal(reservation.reservedQuantity, 4, 'a reservation retry cannot hold the same batch quantity twice');
  let currentProduct = await Product.findById(product._id);
  assert.equal(currentProduct.reservedStock, 4);
  const availability = await getStockAvailability(order);
  assert.equal(availability.items[0].allocatedToOrder, 4);
  assert.equal(availability.items[0].availableToSell, 1);
  assert.equal(availability.items[0].reservedBatchAllocations.find((allocation) => String(allocation.batch) === String(first._id)).batchReference, first.batchReference);
  assert.equal(availability.items[0].batchOptions.find((option) => String(option.batch) === String(second._id)).batchReference, second.batchReference);
  await assert.rejects(runInTransaction((session) => executeSaleCreation({
    req: {
      body: { items: [{ productId: String(product._id), quantity: 2 }], paymentMethod: 'cash', cashTendered: '20.00', vatMode: 'zero-rated' },
      user: actor, ip: '127.0.0.1', get: () => 'phase2-reservation-test',
    },
    session,
    clientRequestId: 'expiry-sale-cannot-spend-reserved-stock',
  })), /Insufficient stock|Available stock|unreserved/i);
  currentProduct = await Product.findById(product._id);
  assert.equal(currentProduct.stock, 5);
  assert.equal(currentProduct.reservedStock, 4);
  assert.equal((await getExpiryBatchAvailability(currentProduct)).valid, true);

  const saleId = new mongoose.Types.ObjectId();
  const orderAvailability = await getStockAvailability(order);
  const proposedBatchAllocations = orderAvailability.items[0].proposedBatchAllocations;
  assert.deepEqual(proposedBatchAllocations.map((allocation) => allocation.batchReference), [first.batchReference, second.batchReference]);
  const verifiedBatchAllocations = [
    { batch: first._id, batchId: first.batchId, expiryDate: first.expiryDate, quantity: 1 },
    { batch: second._id, batchId: second.batchId, expiryDate: second.expiryDate, quantity: 3 },
  ];
  const verificationRows = [{
    productId: String(product._id),
    proposedAllocations: proposedBatchAllocations,
    verifiedAllocations: verifiedBatchAllocations,
    reason: 'The picked carton was short; the later lot supplied the balance.',
    productStock: orderAvailability.items[0].productStock,
    productReserved: orderAvailability.items[0].productReserved,
  }];
  const batchVerifications = validateSpecialOrderBatchVerifications(orderAvailability.items, verificationRows);
  await assert.rejects(Promise.resolve().then(() => validateSpecialOrderBatchVerifications(orderAvailability.items, [
    { ...verificationRows[0], productReserved: verificationRows[0].productReserved + 1 },
  ])), /Stock for .* changed/);
  const consumedLogs = await runInTransaction((session) => consumePhaseFiveStock({
    order: { ...order, orderNumber: 'SO-EXPIRY-1' },
    quotation,
    sale: { _id: saleId },
    req: { user: actor },
    session,
    requestId: 'complete:expiry-order-1',
    batchVerifications,
  }));
  assert.equal(consumedLogs.length, 1);
  const completionLog = await InventoryLog.findById(consumedLogs[0].id).lean();
  assert.equal(completionLog.batchMovementRefs.length, 2);
  currentProduct = await Product.findById(product._id);
  assert.equal(currentProduct.stock, 1);
  assert.equal(currentProduct.reservedStock, 0);
  assert.equal((await ExpiryBatch.findById(first._id)).remainingQuantity, 1);
  const consumedSecond = await ExpiryBatch.findById(second._id);
  assert.equal(consumedSecond.remainingQuantity, 0);
  assert.equal(consumedSecond.reservedQuantity, 0);
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: specialOrderId, requestId: 'complete:expiry-order-1', type: 'SPECIAL_ORDER_RELEASE' }), 1);
  assert.equal(await ExpiryBatchMovement.countDocuments({ sourceId: specialOrderId, requestId: 'complete:expiry-order-1', type: 'SPECIAL_ORDER_RESERVE' }), 1);
  assert.equal((await SpecialOrderStockReservation.findOne({ specialOrder: specialOrderId, product: product._id })).history.some((entry) => entry.action === 'Physical Verify' && entry.reason.includes('picked carton was short')), true);
  assert.equal((await getExpiryBatchAvailability(currentProduct)).valid, true);
});

test('expiry-tracked Stock-Out removes only explicitly selected physical batches, including expired stock, and respects reservations', async () => {
  const product = await createTrackedProduct('stock-out', { stock: 5, reservedStock: 1 });
  const expired = await createBatch(product, 'OUT-EXPIRED', manilaDateOffset(-2), 2);
  const fresh = await createBatch(product, 'OUT-FRESH', manilaDateOffset(20), 3, 1);
  const requestId = 'expiry-stock-out:exact';
  const inventoryAuditCountBefore = await InventoryLog.countDocuments({ productRef: product._id, action: 'DEDUCT' });
  const activityAuditCountBefore = await ActivityLog.countDocuments({ action: 'Removed Stock', details: new RegExp(product.sku, 'i') });
  const responseResult = await invokeStock(String(product._id), {
    stock: 3, expectedStock: 5, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: requestId, adjustmentType: 'OUT', adjustmentQuantity: 2,
    inventoryAdjustmentReason: 'Expired',
    batchAllocations: [stockOutBatchAllocation(expired, 2)],
  });
  assert.equal(responseResult.statusCode, 200);
  assert.equal(responseResult.body.stock, 3);
  assert.equal(responseResult.body.availableToSell, 2);
  const listedAfterRemoval = (await invokeProductsList()).body.find((row) => String(row._id) === String(product._id));
  assert.equal(responseResult.body.availableToSell, listedAfterRemoval.availableToSell,
    'tracked Stock-Out response agrees with the fail-closed product-list calculation');
  assert.equal((await ExpiryBatch.findById(expired._id)).remainingQuantity, 0);
  assert.equal((await ExpiryBatch.findById(fresh._id)).remainingQuantity, 3);
  assert.equal((await ExpiryBatch.findById(fresh._id)).reservedQuantity, 1);
  const log = await InventoryLog.findOne({ productRef: product._id, action: 'DEDUCT' }).sort({ createdAt: -1 }).lean();
  assert.equal(log.batchMovementRefs.length, 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: product._id, action: 'DEDUCT' }), inventoryAuditCountBefore + 1);
  assert.equal(await ActivityLog.countDocuments({ action: 'Removed Stock', details: new RegExp(product.sku, 'i') }), activityAuditCountBefore + 1);
  assert.equal(await ExpiryBatchMovement.countDocuments({ requestId, type: 'STOCK_OUT' }), 1);
  const removalMovement = await ExpiryBatchMovement.findOne({ requestId, type: 'STOCK_OUT' }).lean();
  assert.equal(String(removalMovement.batch), String(expired._id), 'the selected expired physical batch is recorded, not a reason-based FEFO choice');
  assert.equal(removalMovement.quantity, 2);
  assert.equal(removalMovement.remainingDelta, -2);
  assert.equal(removalMovement.reason, 'Expired');
  assert.equal(String(removalMovement.actor), String(actor._id));
  assert.equal(removalMovement.unit, 'pcs');
  const retry = await invokeStock(String(product._id), {
    stock: 3, expectedStock: 5, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: requestId, adjustmentType: 'OUT', adjustmentQuantity: 2,
    inventoryAdjustmentReason: 'Expired',
    batchAllocations: [stockOutBatchAllocation(expired, 2)],
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.stock, 3);
  assert.equal(await ExpiryBatchMovement.countDocuments({ requestId, type: 'STOCK_OUT' }), 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: product._id, action: 'DEDUCT' }), inventoryAuditCountBefore + 1);
  assert.equal(await ActivityLog.countDocuments({ action: 'Removed Stock', details: new RegExp(product.sku, 'i') }), activityAuditCountBefore + 1);
  const mismatchedRetry = await invokeStock(String(product._id), {
    stock: 4, expectedStock: 5, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: requestId, adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Expired',
    batchAllocations: [stockOutBatchAllocation(expired, 1)],
  });
  assert.equal(mismatchedRetry.statusCode, 409, 'a request ID cannot be replayed with a different quantity');
  const restock = await trackedStockIn(String(product._id), 'expiry-stock-in-after-out', { quantity: 2, lotNumber: 'RESTOCK-AFTER-OUT' });
  assert.equal(restock.statusCode, 200);
  const currentProduct = await Product.findById(product._id);
  const laterStockOut = await invokeStock(String(product._id), {
    stock: currentProduct.stock - 1, expectedStock: currentProduct.stock, expectedUpdatedAt: currentProduct.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:later', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Damage',
    batchAllocations: [stockOutBatchAllocation(fresh, 1)],
  });
  assert.equal(laterStockOut.statusCode, 200);
  const oldRetry = await invokeStock(String(product._id), {
    stock: 3, expectedStock: 5, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: requestId, adjustmentType: 'OUT', adjustmentQuantity: 2,
    inventoryAdjustmentReason: 'Expired',
    batchAllocations: [stockOutBatchAllocation(expired, 2)],
  });
  assert.equal(oldRetry.statusCode, 200);
  assert.equal(oldRetry.body.stock, 4, 'an older retry cannot repeat its movement after later stock changes');
  assert.equal(await ExpiryBatchMovement.countDocuments({ requestId, type: 'STOCK_OUT' }), 1);
  const state = await getExpiryBatchAvailability(await Product.findById(product._id));
  assert.equal(state.valid, true);
  assert.equal(state.availableToSell, 3);
  const monitored = (await invokeExpiryMonitoring()).body.batches.filter((row) => row.productId === String(product._id));
  assert.ok(monitored.every((row) => row.balanceConfirmed));
  assert.equal(monitored.reduce((sum, row) => sum + row.remainingQuantity, 0), 4);
  assert.equal(monitored.find((row) => row.id === String(expired._id)).status, 'Depleted');
  assert.equal(monitored.find((row) => row.id === String(fresh._id)).remainingQuantity, 2);
  assert.equal(monitored.find((row) => row.lotNumber === 'RESTOCK-AFTER-OUT').remainingQuantity, 2);
});

test('expiry-tracked Stock-Out rolls back stock, batch movements, and both audit records when a required audit write fails', async () => {
  for (const [key, model] of [
    ['inventory-log', InventoryLog],
    ['activity-log', ActivityLog],
  ]) {
    const product = await createTrackedProduct(`audit-failure-${key}`, { stock: 2 });
    const batch = await createBatch(product, `AUDIT-FAIL-${key}`, manilaDateOffset(15), 2);
    const requestId = `expiry-stock-out-audit-failure:${key}`;
    const eventStart = publishedRealtimeEvents.length;
    const originalCreate = model.create;
    model.create = async () => { throw new Error(`Simulated ${key} write failure`); };
    try {
      await assert.rejects(invokeStock(String(product._id), {
        stock: 1,
        expectedStock: 2,
        expectedUpdatedAt: product.updatedAt.toISOString(),
        adjustmentRequestId: requestId,
        adjustmentType: 'OUT',
        adjustmentQuantity: 1,
        inventoryAdjustmentReason: 'Damage',
        batchAllocations: [stockOutBatchAllocation(batch, 1)],
      }), new RegExp(`Simulated ${key} write failure`));
    } finally {
      model.create = originalCreate;
    }

    assert.equal((await Product.findById(product._id)).stock, 2);
    assert.equal((await ExpiryBatch.findById(batch._id)).remainingQuantity, 2);
    assert.equal(await ExpiryBatchMovement.countDocuments({ requestId, type: 'STOCK_OUT' }), 0);
    assert.equal(await InventoryLog.countDocuments({ productRef: product._id, action: 'DEDUCT' }), 0);
    assert.equal(await ActivityLog.countDocuments({ action: 'Removed Stock', details: new RegExp(product.sku) }), 0);
    assert.equal(publishedRealtimeEvents.length, eventStart, 'aborted Stock-Out emits no success notification');
  }
});

test('invalid tracked Stock-Out states are rejected without reporting aggregate stock as saleable', async () => {
  const missingPeriod = await Product.create({
    name: 'Stock-Out Availability Missing Period', sku: 'STOCK-OUT-AVAIL-MISSING-PERIOD', category: 'General',
    price: 10, stock: 3, reservedStock: 0, sellingUnit: 'pcs', expiryTrackingEnabled: true,
    expiryTrackingPeriodId: null, expiryBatchReconciled: true,
  });
  const missingPeriodResponse = await invokeStock(String(missingPeriod._id), {
    stock: 2, expectedStock: 3, expectedUpdatedAt: missingPeriod.updatedAt.toISOString(),
    adjustmentRequestId: 'availability:stock-out:missing-period', adjustmentType: 'OUT',
    adjustmentQuantity: 1, inventoryAdjustmentReason: 'Damage',
    batchAllocations: [{
      batch: new mongoose.Types.ObjectId().toString(), batchId: 'NO-ACTIVE-PERIOD',
      expiryDate: manilaDateOffset(10), updatedAt: new Date().toISOString(), quantity: 1,
    }],
  });
  assert.equal(missingPeriodResponse.statusCode, 409);
  assert.equal(missingPeriodResponse.body.availableToSell, undefined);
  assert.equal((await Product.findById(missingPeriod._id)).stock, 3);

  const unreconciled = await createToggleProduct('stock-out-availability-unreconciled', { stock: 3 });
  const unreconciledResponse = await invokeStock(String(unreconciled._id), {
    stock: 2, expectedStock: 3, expectedUpdatedAt: unreconciled.updatedAt.toISOString(),
    adjustmentRequestId: 'availability:stock-out:unreconciled', adjustmentType: 'OUT',
    adjustmentQuantity: 1, inventoryAdjustmentReason: 'Damage',
  });
  assert.equal(unreconciledResponse.statusCode, 409);
  assert.equal(unreconciledResponse.body.availableToSell, undefined);
  assert.equal((await Product.findById(unreconciled._id)).stock, 3);

  const untracked = await Product.create({
    name: 'Stock-Out Availability Untracked', sku: 'STOCK-OUT-AVAIL-UNTRACKED', category: 'General',
    price: 10, stock: 4, reservedStock: 1, sellingUnit: 'pcs', expiryTrackingEnabled: false,
  });
  const untrackedResponse = await invokeStock(String(untracked._id), {
    stock: 3, expectedStock: 4, expectedUpdatedAt: untracked.updatedAt.toISOString(),
    adjustmentRequestId: 'availability:stock-out:untracked', adjustmentType: 'OUT',
    adjustmentQuantity: 1, inventoryAdjustmentReason: 'Damage',
  });
  assert.equal(untrackedResponse.statusCode, 200, untrackedResponse.body?.message);
  const listedUntracked = (await invokeProductsList()).body.find((row) => String(row._id) === String(untracked._id));
  assert.equal(listedUntracked.availableToSell, 2, 'untracked Stock-Out keeps aggregate stock minus reservations');
});

test('concurrent expiry-tracked Stock-Out requests cannot remove the same physical batch balance twice', async () => {
  const product = await createTrackedProduct('concurrent-stock-out', { stock: 5 });
  const batch = await createBatch(product, 'CONCURRENT-STOCK-OUT', manilaDateOffset(40), 5);
  const submit = async (requestId) => {
    const current = await Product.findById(product._id);
    return invokeStock(String(product._id), {
      stock: current.stock - 4,
      expectedStock: current.stock,
      expectedUpdatedAt: current.updatedAt.toISOString(),
      adjustmentRequestId: requestId,
      adjustmentType: 'OUT',
      adjustmentQuantity: 4,
      inventoryAdjustmentReason: 'Damage',
      batchAllocations: [stockOutBatchAllocation(batch, 4)],
    });
  };
  const responses = await Promise.all([
    submit('expiry-concurrent-stock-out:a'),
    submit('expiry-concurrent-stock-out:b'),
  ]);
  assert.equal(responses.filter((result) => result.statusCode === 200).length, 1);
  assert.equal(responses.filter((result) => result.statusCode === 409).length, 1);
  const latestProduct = await Product.findById(product._id);
  const latestBatch = await ExpiryBatch.findById(batch._id);
  assert.equal(latestProduct.stock, 1);
  assert.equal(latestBatch.remainingQuantity, 1);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id, type: 'STOCK_OUT' }), 1);
  assert.equal((await getExpiryBatchAvailability(latestProduct)).valid, true);
});

test('expiry-tracked Stock-Out rejects missing allocations and cannot spend reserved batch quantity', async () => {
  const product = await createTrackedProduct('stock-out-selection-guards', { stock: 6, reservedStock: 2 });
  const batch = await createBatch(product, 'OUT-SELECTION-GUARDS', manilaDateOffset(10), 4, 2);
  await createBatch(product, 'OUT-SELECTION-OTHER', manilaDateOffset(20), 2);
  const missingSelection = await invokeStock(String(product._id), {
    stock: 5, expectedStock: 6, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:missing-selection', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Expired',
  });
  assert.equal(missingSelection.statusCode, 400);
  assert.match(missingSelection.body.message, /select one or more verified batches/i);
  const reservedQuantity = await invokeStock(String(product._id), {
    stock: 3, expectedStock: 6, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:reserved-quantity', adjustmentType: 'OUT', adjustmentQuantity: 3,
    inventoryAdjustmentReason: 'Store Use', batchAllocations: [stockOutBatchAllocation(batch, 3)],
  });
  assert.equal(reservedQuantity.statusCode, 409);
  assert.match(reservedQuantity.body.message, /only 2 unreserved/i);
  assert.equal((await Product.findById(product._id)).stock, 6);
  assert.equal((await ExpiryBatch.findById(batch._id)).remainingQuantity, 4);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id, type: 'STOCK_OUT' }), 0);
});

test('expiry-tracked Stock-Out supports explicit allocations across multiple batches', async () => {
  const product = await createTrackedProduct('stock-out-multi-batch', { stock: 7 });
  const first = await createBatch(product, 'OUT-MULTI-A', manilaDateOffset(5), 3);
  const second = await createBatch(product, 'OUT-MULTI-B', manilaDateOffset(20), 4);
  const result = await invokeStock(String(product._id), {
    stock: 2, expectedStock: 7, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:multi-batch', adjustmentType: 'OUT', adjustmentQuantity: 5,
    inventoryAdjustmentReason: 'Store Use', batchAllocations: [stockOutBatchAllocation(first, 2), stockOutBatchAllocation(second, 3)],
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.stock, 2);
  assert.equal((await ExpiryBatch.findById(first._id)).remainingQuantity, 1);
  assert.equal((await ExpiryBatch.findById(second._id)).remainingQuantity, 1);
  const movements = await ExpiryBatchMovement.find({ requestId: 'expiry-stock-out:multi-batch' }).sort({ batchId: 1 }).lean();
  assert.deepEqual(movements.map((movement) => [String(movement.batch), movement.quantity]).sort(), [
    [String(first._id), 2], [String(second._id), 3],
  ].sort());
  assert.equal((await getExpiryBatchAvailability(await Product.findById(product._id))).valid, true);
});

test('expiry-tracked Stock-Out rejects stale batch snapshots and batches from closed periods', async () => {
  const product = await createTrackedProduct('stock-out-stale-closed', { stock: 2 });
  const activeBatch = await createBatch(product, 'OUT-STALE-ACTIVE', manilaDateOffset(15), 2);
  const staleAllocation = stockOutBatchAllocation(activeBatch, 1);
  await ExpiryBatch.updateOne({ _id: activeBatch._id }, { $set: { lotNumber: 'UPDATED AFTER OPEN' } });
  const staleResult = await invokeStock(String(product._id), {
    stock: 1, expectedStock: 2, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:stale-batch', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Damage', batchAllocations: [staleAllocation],
  });
  assert.equal(staleResult.statusCode, 409);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await ExpiryBatch.findById(activeBatch._id)).remainingQuantity, 2);

  const closedBatch = await ExpiryBatch.create({
    product: product._id, sku: product.sku, trackingPeriodId: 'closed-period-not-active', trackingPeriodClosedAt: new Date(),
    batchId: `EB-CLOSED-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    lotNumber: 'CLOSED-PERIOD', lotKey: 'closed-period',
    expiryDate: manilaDateOffset(-1), quantityReceived: 4, remainingQuantity: 4, reservedQuantity: 0,
    openingBalanceQuantity: 0, receivedAt: new Date(), receivedBy: actor._id,
  });
  const closedResult = await invokeStock(String(product._id), {
    stock: 1, expectedStock: 2, expectedUpdatedAt: product.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:closed-period', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Expired', batchAllocations: [stockOutBatchAllocation(closedBatch, 1)],
  });
  assert.equal(closedResult.statusCode, 409);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await ExpiryBatch.findById(closedBatch._id)).remainingQuantity, 4);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id, type: 'STOCK_OUT' }), 0);
});

test('unverified expiry stock remains blocked while non-expiry Stock-Out keeps its simple quantity flow', async () => {
  const unverified = await createToggleProduct('stock-out-needs-verification', { stock: 3 });
  const blocked = await invokeStock(String(unverified._id), {
    stock: 2, expectedStock: 3, expectedUpdatedAt: unverified.updatedAt.toISOString(),
    adjustmentRequestId: 'expiry-stock-out:unverified', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Damage',
  });
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body.message, /batch verification is needed/i);
  assert.equal((await Product.findById(unverified._id)).stock, 3);

  const untracked = await Product.create({ name: 'Untracked removal', sku: 'STOCK-OUT-UNTRACKED', category: 'General', price: 10, stock: 3, sellingUnit: 'pcs', expiryTrackingEnabled: false });
  const simple = await invokeStock(String(untracked._id), {
    stock: 2, expectedStock: 3, expectedUpdatedAt: untracked.updatedAt.toISOString(),
    adjustmentRequestId: 'ordinary-stock-out:untracked', adjustmentType: 'OUT', adjustmentQuantity: 1,
    inventoryAdjustmentReason: 'Damage',
  });
  assert.equal(simple.statusCode, 200);
  assert.equal(simple.body.stock, 2);
});

test('expiry Batch References are Manila-daily, concurrent-safe, expandable, and idempotently backfilled', async () => {
  const product = await createTrackedProduct('batch-reference-generation', { stock: 0 });
  const createReferencedBatch = async (createdAt, key) => {
    const businessDate = getManilaBusinessDate(createdAt);
    await ensureCounterExists(businessDate);
    let created;
    await runInTransaction(async (session) => {
      const batchReference = await nextExpiryBatchReference({ createdAt, session });
      [created] = await ExpiryBatch.create([{
        product: product._id,
        sku: product.sku,
        batchId: `EB-REF-${key}-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
        batchReference,
        lotNumber: key,
        lotKey: key,
        expiryDate: '2099-01-01',
        quantityReceived: 0,
        remainingQuantity: 0,
        reservedQuantity: 0,
        receivedAt: createdAt,
      }], { session });
    });
    return created;
  };

  const firstDay = new Date('2034-06-01T02:00:00.000Z');
  const first = await createReferencedBatch(firstDay, 'REF-DAY-1');
  const second = await createReferencedBatch(new Date('2034-06-01T12:00:00.000Z'), 'REF-DAY-2');
  const nextDay = await createReferencedBatch(new Date('2034-06-01T16:00:00.000Z'), 'REF-NEXT-DAY');
  assert.equal(first.batchReference, 'BT-20340601-001');
  assert.equal(second.batchReference, 'BT-20340601-002');
  assert.equal(nextDay.batchReference, 'BT-20340602-001', 'sequence follows the Asia/Manila date boundary');

  await ensureCounterExists('2034-06-03');
  await ExpiryBatchReferenceCounter.updateOne({ _id: '2034-06-03' }, { $set: { sequence: 999 } });
  const beyond999 = await createReferencedBatch(new Date('2034-06-02T16:00:00.000Z'), 'REF-BEYOND-999');
  assert.equal(beyond999.batchReference, 'BT-20340603-1000');

  const concurrentDate = new Date('2034-06-03T16:00:00.000Z');
  const concurrent = await Promise.all(Array.from({ length: 16 }, (_, index) =>
    createReferencedBatch(concurrentDate, `REF-CONCURRENT-${index}`)));
  assert.equal(new Set(concurrent.map((batch) => batch.batchReference)).size, 16);
  assert.deepEqual(concurrent.map((batch) => Number(batch.batchReference.split('-').at(-1))).sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, index) => index + 1));

  const legacyProduct = await createTrackedProduct('batch-reference-backfill', { stock: 0 });
  const legacyRows = [
    { batchId: 'EB-LEGACY-REF-1', lotNumber: 'LEGACY-A', lotKey: 'LEGACY-A', expiryDate: '2027-01-01', createdAt: new Date('2021-02-02T02:00:00.000Z'), receivedAt: new Date('2021-02-02T02:00:00.000Z') },
    { batchId: 'EB-LEGACY-REF-2', batchReference: null, lotNumber: 'LEGACY-B', lotKey: 'LEGACY-B', expiryDate: '2027-02-01', createdAt: new Date('2021-02-02T05:00:00.000Z'), receivedAt: new Date('2021-02-02T05:00:00.000Z') },
    { batchId: 'EB-LEGACY-REF-3', batchReference: '', lotNumber: 'LEGACY-C', lotKey: 'LEGACY-C', expiryDate: '2027-03-01', receivedAt: new Date('2021-02-02T16:00:00.000Z') },
  ];
  await ExpiryBatch.collection.insertMany(legacyRows.map((row) => ({
    product: legacyProduct._id,
    sku: legacyProduct.sku,
    ...row,
    quantityReceived: 0,
    remainingQuantity: 0,
    reservedQuantity: 0,
    openingBalanceQuantity: 0,
    receivedBy: null,
    updatedAt: row.createdAt || row.receivedAt,
  })));

  const migration = await backfillMissingExpiryBatchReferences();
  assert.ok(migration.assigned >= legacyRows.length);
  const migrated = await ExpiryBatch.find({ product: legacyProduct._id }).sort({ receivedAt: 1 }).lean();
  assert.deepEqual(migrated.map((batch) => batch.batchReference), [
    'BT-20210202-001', 'BT-20210202-002', 'BT-20210203-001',
  ]);
  const rerun = await backfillMissingExpiryBatchReferences();
  assert.equal(rerun.assigned, 0);
  assert.deepEqual((await ExpiryBatch.find({ product: legacyProduct._id }).sort({ receivedAt: 1 }).lean())
    .map((batch) => batch.batchReference), migrated.map((batch) => batch.batchReference));
});

test('Verify Batches can finish without a delivery and leaves existing stock unchanged', async () => {
  const product = await Product.create({
    name: 'Verify without delivery', sku: 'VERIFY-ONLY-EXPIRY', sellingUnit: 'pcs', price: 10,
    stock: 7, reservedStock: 0, expiryTrackingEnabled: false,
  });
  const result = await invokeVerifyAndStockIn(String(product._id), {
    expectedStock: 7, expectedUnassignedStock: 7, expectedUpdatedAt: product.updatedAt.toISOString(),
    recordedBatchVersions: [], requestId: 'verify-only-activation', enableTracking: true,
    batches: [
      { expiryDate: manilaDateOffset(60), quantity: 4, lotNumber: 'OPEN-A' },
      { expiryDate: manilaDateOffset(90), quantity: 3, lotNumber: 'OPEN-B' },
    ], deliveryBatches: [], reason: '',
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deliveryTotal, 0);
  assert.equal(result.body.product.stock, 7);
  assert.equal(result.body.product.expiryTrackingEnabled, true);
  assert.equal(result.body.product.expiryBatchReconciled, true);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: product._id }), 1);
  const batches = await ExpiryBatch.find({ product: product._id }).lean();
  assert.deepEqual(batches.map((batch) => batch.remainingQuantity).sort((a, b) => a - b), [3, 4]);
  assert.ok(batches.every((batch) => batch.quantityReceived === 0), 'physical verification is not recorded as a receipt');
  assert.equal((await Product.findById(product._id)).stock, 7);
});

test('Verify Batches adds only multiple delivery quantities and retries idempotently', async () => {
  const product = await Product.create({
    name: 'Verify and receive delivery', sku: 'VERIFY-DELIVERY-EXPIRY', sellingUnit: 'pcs', price: 10,
    stock: 7, reservedStock: 0, expiryTrackingEnabled: false,
  });
  const body = {
    expectedStock: 7, expectedUnassignedStock: 7, expectedUpdatedAt: product.updatedAt.toISOString(),
    recordedBatchVersions: [], requestId: 'verify-with-delivery', enableTracking: true,
    batches: [
      { expiryDate: manilaDateOffset(60), quantity: 4, lotNumber: 'OPEN-C' },
      { expiryDate: manilaDateOffset(90), quantity: 3, lotNumber: 'OPEN-D' },
    ],
    deliveryBatches: [
      { expiryDate: manilaDateOffset(120), quantity: 2, lotNumber: 'DELIVERY-A' },
      { expiryDate: manilaDateOffset(150), quantity: 3, lotNumber: 'DELIVERY-B' },
    ],
    reason: 'Delivery',
  };
  const result = await invokeVerifyAndStockIn(String(product._id), body);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deliveryTotal, 5);
  assert.equal(result.body.product.stock, 12);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: product._id }), 1);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 2);
  const receipts = await ExpiryBatchReceipt.find({ product: product._id }).lean();
  assert.equal(receipts.reduce((sum, receipt) => sum + receipt.quantity, 0), 5);
  assert.equal(await InventoryLog.countDocuments({ productRef: product._id, action: 'UPDATE' }), 1);
  assert.equal(await InventoryLog.countDocuments({ productRef: product._id, action: 'ADD', quantity: 5, stockBefore: 7, stockAfter: 12 }), 1);
  const activeBatches = await ExpiryBatch.find({ product: product._id, trackingPeriodClosedAt: null }).lean();
  assert.equal(activeBatches.reduce((sum, batch) => sum + batch.remainingQuantity, 0), 12);
  assert.equal(activeBatches.reduce((sum, batch) => sum + batch.quantityReceived, 0), 5);

  const replay = await invokeVerifyAndStockIn(String(product._id), body);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal((await Product.findById(product._id)).stock, 12);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 2);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: product._id }), 1);
});

test('Verify Batches rejects incomplete existing-stock assignments without saving anything', async () => {
  const product = await Product.create({
    name: 'Reject incomplete verification', sku: 'VERIFY-INCOMPLETE-EXPIRY', sellingUnit: 'pcs', price: 10,
    stock: 7, reservedStock: 0, expiryTrackingEnabled: false,
  });
  const result = await invokeVerifyAndStockIn(String(product._id), {
    expectedStock: 7, expectedUnassignedStock: 7, expectedUpdatedAt: product.updatedAt.toISOString(),
    recordedBatchVersions: [], requestId: 'verify-incomplete-existing-stock', enableTracking: true,
    batches: [{ expiryDate: manilaDateOffset(60), quantity: 6, lotNumber: 'OPEN-E' }],
    deliveryBatches: [{ expiryDate: manilaDateOffset(120), quantity: 2, lotNumber: 'DELIVERY-C' }],
    reason: 'Delivery',
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /total exactly 7/i);
  const savedProduct = await Product.findById(product._id).lean();
  assert.equal(savedProduct.stock, 7);
  assert.equal(savedProduct.expiryTrackingEnabled, false);
  assert.equal(await ExpiryBatch.countDocuments({ product: product._id }), 0);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: product._id }), 0);
});

test('delivery audit failure rolls back batch verification, stock, receipts and logs atomically', async () => {
  const product = await Product.create({
    name: 'Rollback verify delivery', sku: 'VERIFY-ROLLBACK-EXPIRY', sellingUnit: 'pcs', price: 10,
    stock: 5, reservedStock: 0, expiryTrackingEnabled: false,
  });
  const originalActivityCreate = ActivityLog.create;
  ActivityLog.create = async function createWithAuditFailure(documents, ...args) {
    const entries = Array.isArray(documents) ? documents : [documents];
    if (entries.some((entry) => entry.action === 'Enabled Expiry Tracking and Added Stock')) {
      throw new Error('Simulated delivery audit failure');
    }
    return originalActivityCreate.call(this, documents, ...args);
  };
  try {
    await assert.rejects(invokeVerifyAndStockIn(String(product._id), {
      expectedStock: 5, expectedUnassignedStock: 5, expectedUpdatedAt: product.updatedAt.toISOString(),
      recordedBatchVersions: [], requestId: 'verify-delivery-audit-rollback', enableTracking: true,
      batches: [{ expiryDate: manilaDateOffset(60), quantity: 5, lotNumber: 'OPEN-F' }],
      deliveryBatches: [{ expiryDate: manilaDateOffset(120), quantity: 2, lotNumber: 'DELIVERY-D' }],
      reason: 'Delivery',
    }), /Simulated delivery audit failure/);
  } finally {
    ActivityLog.create = originalActivityCreate;
  }
  const savedProduct = await Product.findById(product._id).lean();
  assert.equal(savedProduct.stock, 5);
  assert.equal(savedProduct.expiryTrackingEnabled, false);
  assert.equal(await ExpiryBatch.countDocuments({ product: product._id }), 0);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0);
  assert.equal(await ExpiryBatchMovement.countDocuments({ product: product._id }), 0);
  assert.equal(await ExpiryBatchReconciliation.countDocuments({ product: product._id }), 0);
  assert.equal(await InventoryLog.countDocuments({ productRef: product._id }), 0);
  assert.equal(await ActivityLog.countDocuments({ details: /Rollback verify delivery/ }), 0);
});

test('tracked unverified existing stock can be verified without an optional delivery', async () => {
  const product = await Product.create({
    name: 'Tracked unverified without delivery', sku: 'VERIFY-TRACKED-ONLY-EXPIRY', sellingUnit: 'pcs', price: 10,
    stock: 4, reservedStock: 0, expiryTrackingEnabled: true,
    expiryTrackingPeriodId: createExpiryTrackingPeriodId(), expiryUnassignedStock: 4, expiryBatchReconciled: false,
  });
  const result = await invokeVerifyAndStockIn(String(product._id), {
    expectedStock: 4, expectedUnassignedStock: 4, expectedUpdatedAt: product.updatedAt.toISOString(),
    recordedBatchVersions: [], requestId: 'verify-tracked-only-no-delivery', enableTracking: false,
    batches: [{ expiryDate: manilaDateOffset(60), quantity: 4, lotNumber: 'TRACKED-OPEN' }],
    deliveryBatches: [], reason: '',
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.product.stock, 4);
  assert.equal(result.body.product.expiryBatchReconciled, true);
  assert.equal(await ExpiryBatchReceipt.countDocuments({ product: product._id }), 0);
});
