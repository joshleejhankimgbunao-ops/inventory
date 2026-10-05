const assert = require('node:assert/strict');
const test = require('node:test');

const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: {
    publishSaleUpdated: () => {},
    publishInventoryUpdated: () => {},
    publishActivityLogged: () => {},
    publishInventoryLogged: () => {},
  },
};

const { executeSaleVoid } = require('../src/services/saleVoidService');
const { voidSale } = require('../src/controllers/saleController');

const SALE_ID = '68a01234567890abcdef1234';
const USER_ID = '68a01234567890abcdef2222';
const PRODUCT_A = '68a01234567890abcdef9991';
const PRODUCT_B = '68a01234567890abcdef9992';

const saleFixture = (overrides = {}) => ({
  _id: SALE_ID,
  status: 'completed',
  saleType: 'regular',
  paymentMethod: 'cash',
  paymentStatus: 'Paid',
  cashier: '68a01234567890abcdef3333',
  totalAmount: 350,
  notes: 'Preserve this Sale metadata',
  items: [
    { product: PRODUCT_A, code: 'SKU-A', name: 'Variant A', quantity: 2 },
    { product: PRODUCT_A, code: 'SKU-A', name: 'Variant A', quantity: 3 },
    { product: PRODUCT_B, code: 'SKU-B', name: 'Variant B', quantity: 1 },
  ],
  ...overrides,
});

const createHarness = ({ sale = saleFixture(), failRestore = '', failActivity = false } = {}) => {
  const state = {
    sale: structuredClone(sale),
    products: {
      [PRODUCT_A]: { _id: PRODUCT_A, sku: 'SKU-A', stock: 10 },
      [PRODUCT_B]: { _id: PRODUCT_B, sku: 'SKU-B', stock: 4 },
    },
    inventoryLogs: [],
    activityLogs: [],
    events: [],
  };
  let working = state;
  const runTransaction = async (work) => {
    const snapshot = structuredClone(state);
    const after = [];
    working = snapshot;
    try {
      const result = await work({
        session: { id: 'session' },
        writeInventoryLog: async (entry) => { snapshot.inventoryLogs.push(entry); },
        writeActivityLog: async (entry) => {
          if (failActivity) throw new Error('activity audit unavailable');
          snapshot.activityLogs.push(entry);
        },
        afterCommit: (notify) => after.push(notify),
      });
      Object.assign(state, snapshot);
      working = state;
      for (const notify of after) await notify();
      return result;
    } catch (error) {
      working = state;
      throw error;
    }
  };
  const dependencies = {
    runTransaction,
    findSale: async () => working.sale,
    checkEligibility: async () => ({ eligible: true, reason: '' }),
    claimSale: async (_id, voidInfo) => {
      if (working.sale.status === 'voided') return null;
      const updated = { ...working.sale, status: 'voided', voidInfo };
      working.sale = updated;
      return updated;
    },
    restoreProduct: async (id, quantity) => {
      if (id === failRestore) throw new Error('restore failed');
      const product = working.products[id];
      if (!product) return null;
      product.stock += quantity;
      return product;
    },
    publishSale: (payload) => { state.events.push(['sale.updated', payload]); },
    publishInventory: (payload) => { state.events.push(['inventory.updated', payload]); },
  };
  return { state, dependencies };
};

const command = (overrides = {}) => ({
  saleId: SALE_ID,
  reason: 'Duplicate checkout',
  requestId: 'sale-void:req-1',
  user: { _id: USER_ID, role: 'admin', name: 'Admin User' },
  ipAddress: '127.0.0.1',
  userAgent: 'test',
  ...overrides,
});

test('atomic void aggregates exact product variants, audits restoration, and preserves Sale metadata', async () => {
  const { state, dependencies } = createHarness();
  const result = await executeSaleVoid(command(), dependencies);

  assert.equal(result.replayed, false);
  assert.equal(result.sale.status, 'voided');
  assert.equal(result.sale.voidInfo.reason, 'Duplicate checkout');
  assert.equal(result.sale.voidInfo.voidedBy, USER_ID);
  assert.equal(result.sale.voidInfo.voidedByName, 'Admin User');
  assert.equal(result.sale.voidInfo.authorizationMethod, 'role_authorized');
  assert.equal(result.sale.voidInfo.requestId, 'sale-void:req-1');
  assert.equal(result.sale.notes, 'Preserve this Sale metadata');
  assert.equal(state.products[PRODUCT_A].stock, 15);
  assert.equal(state.products[PRODUCT_B].stock, 5);
  assert.deepEqual(result.restorations.map(({ code, quantity }) => ({ code, quantity })), [
    { code: 'SKU-A', quantity: 5 },
    { code: 'SKU-B', quantity: 1 },
  ]);
  assert.equal(state.inventoryLogs.length, 2);
  assert.equal(state.inventoryLogs[0].action, 'ADD');
  assert.deepEqual([state.inventoryLogs[0].stockBefore, state.inventoryLogs[0].stockAfter], [10, 15]);
  assert.match(state.inventoryLogs[0].details, /SALE VOID RESTORE — TRX-ABCDEF1234|SALE VOID RESTORE — TRX-CDEF1234/);
  assert.match(state.inventoryLogs[0].details, /Duplicate checkout/);
  assert.equal(state.activityLogs.length, 1);
  assert.equal(state.activityLogs[0].action, 'SALE_VOIDED');
  assert.match(state.activityLogs[0].details, /SKU-A \+5/);
  assert.deepEqual(state.events.map(([name]) => name), ['sale.updated', 'inventory.updated']);
});

test('same-request and different-request retries of an already-voided Sale never restore or audit twice', async () => {
  for (const retryRequestId of ['sale-void:req-1', 'sale-void:req-2']) {
    const existing = saleFixture({
      status: 'voided',
      voidInfo: { reason: 'Original', requestId: 'sale-void:req-1' },
    });
    const { state, dependencies } = createHarness({ sale: existing });
    const result = await executeSaleVoid(command({ requestId: retryRequestId }), dependencies);
    assert.equal(result.replayed, true);
    assert.equal(result.sale.voidInfo.reason, 'Original');
    assert.equal(state.products[PRODUCT_A].stock, 10);
    assert.equal(state.inventoryLogs.length, 0);
    assert.equal(state.activityLogs.length, 0);
    assert.equal(state.events.length, 0);
  }
});

test('restoration or required audit failure rolls the lifecycle and all stock changes back', async () => {
  const restoreFailure = createHarness({ failRestore: PRODUCT_B });
  await assert.rejects(executeSaleVoid(command(), restoreFailure.dependencies), /restore failed/);
  assert.equal(restoreFailure.state.sale.status, 'completed');
  assert.equal(restoreFailure.state.products[PRODUCT_A].stock, 10);
  assert.equal(restoreFailure.state.products[PRODUCT_B].stock, 4);
  assert.equal(restoreFailure.state.inventoryLogs.length, 0);
  assert.equal(restoreFailure.state.events.length, 0);

  const auditFailure = createHarness({ failActivity: true });
  await assert.rejects(executeSaleVoid(command(), auditFailure.dependencies), /audit unavailable/);
  assert.equal(auditFailure.state.sale.status, 'completed');
  assert.equal(auditFailure.state.products[PRODUCT_A].stock, 10);
  assert.equal(auditFailure.state.inventoryLogs.length, 0);
  assert.equal(auditFailure.state.events.length, 0);
});

test('failed eligibility is rejected before lifecycle, inventory, audit, or realtime changes', async () => {
  for (const reason of [
    'Only regular Cash Sales are eligible.',
    'Special Order sales are not eligible.',
    'A referenced product no longer exists.',
    'Sale has missing or invalid product linkage or quantities.',
  ]) {
    const { state, dependencies } = createHarness();
    dependencies.checkEligibility = async () => ({ eligible: false, reason });
    await assert.rejects(executeSaleVoid(command(), dependencies), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(state.sale.status, 'completed');
    assert.equal(state.products[PRODUCT_A].stock, 10);
    assert.equal(state.inventoryLogs.length, 0);
    assert.equal(state.events.length, 0);
  }
});

const responseCapture = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
});

test('void endpoint enforces role, persistent ID, reason, and request ID before execution', async () => {
  let executions = 0;
  const execute = async () => { executions += 1; return { sale: saleFixture(), restorations: [] }; };
  const cases = [
    [{ role: 'cashier' }, SALE_ID, { reason: 'Reason', requestId: 'req' }, 403],
    [{ role: 'admin' }, 'local-only', { reason: 'Reason', requestId: 'req' }, 400],
    [{ role: 'admin' }, SALE_ID, { reason: '   ', requestId: 'req' }, 400],
    [{ role: 'admin' }, SALE_ID, { reason: 'Reason', requestId: '' }, 400],
  ];
  for (const [user, id, body, status] of cases) {
    const res = responseCapture();
    await voidSale({ user, params: { id }, body, get: () => '', ip: '' }, res, assert.fail, { executeSaleVoid: execute });
    assert.equal(res.statusCode, status);
  }
  assert.equal(executions, 0);
});

test('void endpoint trims input and returns a current History contract on success', async () => {
  const res = responseCapture();
  let received;
  await voidSale({
    user: { _id: USER_ID, role: 'superadmin', name: 'Super Admin' },
    params: { id: SALE_ID },
    body: { reason: '  Customer duplicate  ', requestId: ' sale-void:req-3 ' },
    get: () => 'agent',
    ip: '127.0.0.1',
  }, res, assert.fail, {
    executeSaleVoid: async (payload) => {
      received = payload;
      return { sale: saleFixture({ status: 'voided', voidInfo: {
        reason: payload.reason, voidedAt: new Date(), voidedBy: USER_ID,
        voidedByName: 'Super Admin', authorizationMethod: 'role_authorized', requestId: payload.requestId,
      } }), replayed: false, restorations: [] };
    },
  });
  assert.equal(received.reason, 'Customer duplicate');
  assert.equal(received.requestId, 'sale-void:req-3');
  assert.equal(res.body.sale.status, 'voided');
  assert.equal(res.body.sale.voidEligible, false);
});

test('frontend candidate and voided Order Confirmation helpers enforce role, online, persisted, and document boundaries', async () => {
  const { canOfferSaleVoid, isVoidedOrderConfirmation } = await import('../../src/utils/saleVoid.js');
  const transaction = { sourceId: SALE_ID, status: 'completed', voidEligible: true };
  assert.equal(canOfferSaleVoid(transaction, { isAdmin: true, isOnline: true }), true);
  assert.equal(canOfferSaleVoid(transaction, { isAdmin: false, isOnline: true }), false);
  assert.equal(canOfferSaleVoid(transaction, { isAdmin: true, isOnline: false }), false);
  assert.equal(canOfferSaleVoid({ ...transaction, sourceId: 'offline-local' }, { isAdmin: true, isOnline: true }), false);
  assert.equal(canOfferSaleVoid({ ...transaction, status: 'voided' }, { isAdmin: true, isOnline: true }), false);
  assert.equal(isVoidedOrderConfirmation({ status: 'voided' }, true), true);
  assert.equal(isVoidedOrderConfirmation({ status: 'voided' }, false), false);
  assert.equal(isVoidedOrderConfirmation({ status: 'completed' }, true), false);
});
