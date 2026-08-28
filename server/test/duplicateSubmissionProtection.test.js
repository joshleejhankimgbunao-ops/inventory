const assert = require('node:assert/strict');
const test = require('node:test');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: {
    publishPartnersUpdated: () => {},
    publishCreditTransactionsUpdated: () => {},
    publishInventoryUpdated: () => {},
  },
};

let inventoryLogWriteCount = 0;
const logServicePath = require.resolve('../src/services/logService');
require.cache[logServicePath] = {
  id: logServicePath,
  filename: logServicePath,
  loaded: true,
  exports: {
    writeActivityLog: async () => {},
    writeInventoryLog: async () => {
      inventoryLogWriteCount += 1;
    },
  },
};

const Sale = require('../src/models/Sale');
const Partner = require('../src/models/Partner');
const Product = require('../src/models/Product');
const SpecialOrder = require('../src/models/SpecialOrder');
const { createPartner } = require('../src/controllers/partnerController');
const { markCreditTransactionFullyPaid } = require('../src/controllers/creditTransactionController');
const { updateProduct } = require('../src/controllers/productController');
const { __test: specialOrderProtection } = require('../src/controllers/specialOrderController');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const runPartnerCreateTwice = async (type) => {
  const records = new Map();
  let createCount = 0;
  const request = {
    body: {
      type,
      name: type === 'supplier' ? 'Safe Supplier' : 'Safe Customer',
      email: `${type}@example.test`,
      clientRequestId: `${type}:same-submit`,
    },
  };
  const dependencies = {
    findByRequestId: async (requestId) => records.get(requestId) || null,
    createPartnerRecord: async (payload) => {
      createCount += 1;
      const record = { _id: `${type}-${createCount}`, ...payload };
      records.set(payload.clientRequestId, record);
      return record;
    },
  };

  const firstResponse = createResponse();
  const secondResponse = createResponse();
  await createPartner(request, firstResponse, assert.fail, dependencies);
  await createPartner(request, secondResponse, assert.fail, dependencies);

  assert.equal(createCount, 1);
  assert.equal(firstResponse.body._id, secondResponse.body._id);
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(secondResponse.statusCode, 200);
};

test('rapid repeated Add Customer creates one partner record', async () => {
  await runPartnerCreateTwice('customer');
});

test('a minimal regular customer uses the existing Partner defaults for Credit eligibility', async () => {
  let createdPayload;
  const response = createResponse();

  await createPartner({
    body: { type: 'customer', name: 'Quick Add Customer', clientRequestId: 'partner:quick-add' },
  }, response, assert.fail, {
    findByRequestId: async () => null,
    createPartnerRecord: async (payload) => {
      createdPayload = payload;
      return { _id: 'quick-add-customer', ...payload };
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(createdPayload.customerType, 'regular');
  assert.equal(createdPayload.isVerifiedCustomer, true);
});

test('rapid repeated Add Supplier creates one partner record', async () => {
  await runPartnerCreateTwice('supplier');
});

test('separate partner submissions remain legitimate', async () => {
  const records = new Map();
  let createCount = 0;
  const dependencies = {
    findByRequestId: async (requestId) => records.get(requestId) || null,
    createPartnerRecord: async (payload) => {
      createCount += 1;
      const record = { _id: `partner-${createCount}`, ...payload };
      records.set(payload.clientRequestId, record);
      return record;
    },
  };

  for (const clientRequestId of ['partner:first', 'partner:second']) {
    await createPartner({
      body: { type: 'customer', name: 'Same Allowed Name', email: '', clientRequestId },
    }, createResponse(), assert.fail, dependencies);
  }

  assert.equal(createCount, 2);
});

test('persistent create models enforce sparse request-token uniqueness', () => {
  for (const model of [Sale, Partner, Product, SpecialOrder]) {
    const path = model.schema.path('clientRequestId');
    assert.ok(path, `${model.modelName} must define clientRequestId`);
    assert.equal(path.options.unique, true);
    assert.equal(path.options.sparse, true);
  }
});

test('replaying one stock adjustment updates stock and inventory history once', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  let updateCount = 0;
  let product = {
    _id: 'product-1',
    sku: 'PNT-001',
    name: 'Latex Paint',
    stock: 5,
    updatedAt: null,
    lastStockAdjustmentRequestId: '',
  };

  Product.findById = async () => ({ ...product });
  Product.findOneAndUpdate = async (filter, payload) => {
    assert.equal(filter._id, 'product-1');
    assert.deepEqual(filter.lastStockAdjustmentRequestId, { $ne: 'stock:same-submit' });
    updateCount += 1;
    product = { ...product, ...payload };
    return { ...product };
  };
  inventoryLogWriteCount = 0;

  const request = {
    params: { id: 'product-1' },
    body: {
      stock: 10,
      adjustmentRequestId: 'stock:same-submit',
      inventoryAdjustmentReason: 'Delivery',
    },
    user: { _id: 'user-1', name: 'Admin' },
    ip: '127.0.0.1',
    get: () => '',
  };

  try {
    await updateProduct(request, createResponse(), assert.fail);
    await updateProduct(request, createResponse(), assert.fail);

    assert.equal(updateCount, 1);
    assert.equal(inventoryLogWriteCount, 1);
    assert.equal(product.stock, 10);
  } finally {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('product archive and restore persist through the existing product update endpoint', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  let product = {
    _id: 'product-archive-1',
    sku: 'PNT-ARCHIVE-1',
    name: 'Archive Test Paint',
    stock: 5,
    isActive: true,
    updatedAt: null,
  };

  Product.findById = async () => ({ ...product });
  Product.findOneAndUpdate = async (filter, payload) => {
    assert.equal(filter._id, 'product-archive-1');
    assert.equal(typeof payload.isActive, 'boolean');
    product = { ...product, ...payload };
    return { ...product };
  };

  const request = {
    params: { id: 'product-archive-1' },
    body: { isActive: false },
    user: { _id: 'user-1', name: 'Admin' },
    ip: '127.0.0.1',
    get: () => '',
  };

  try {
    await updateProduct(request, createResponse(), assert.fail);
    assert.equal(product.isActive, false);

    request.body = { isActive: true };
    await updateProduct(request, createResponse(), assert.fail);
    assert.equal(product.isActive, true);
  } finally {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('repeated POS submissions and Special Order completion use stable unique sale tokens', () => {
  const saleRequestPath = Sale.schema.path('clientRequestId');
  assert.equal(saleRequestPath.options.unique, true);
  assert.equal(saleRequestPath.options.sparse, true);

  const order = {
    _id: '64b7fef00123456789abcdef',
    orderNumber: 'SO-12345678-ABCD',
    customerName: 'Customer',
    items: [{ itemName: 'Custom Item', quantity: 1, sellingPrice: 100 }],
  };
  const request = { user: { _id: '64b7fef00123456789abcdea', name: 'Admin' } };
  const firstPayload = specialOrderProtection.buildSalePayload(order, request);
  const secondPayload = specialOrderProtection.buildSalePayload(order, request);

  assert.equal(firstPayload.clientRequestId, 'special-order:64b7fef00123456789abcdef');
  assert.equal(secondPayload.clientRequestId, firstPayload.clientRequestId);
});

test('Special Order completion and later receipt lookup share the finalized Sale snapshot', () => {
  const order = {
    _id: '64b7fef00123456789abcdef',
    orderNumber: 'SO-12345678-ABCD',
    status: 'Completed',
    statusHistory: [],
  };
  const sale = {
    _id: '68a01234567890abcdef5678',
    createdAt: new Date('2026-08-27T03:15:00.000Z'),
    cashierName: 'Saved Cashier',
    customerName: 'Saved Customer',
    paymentMethod: 'cash',
    paymentStatus: 'Paid',
    totalAmount: 400,
    specialOrderId: order._id,
    specialOrderNumber: order.orderNumber,
    items: [{ name: 'Finalized Item', code: 'SO-ITEM-1', quantity: 2, unitPrice: 200, subtotal: 400 }],
  };

  const completionResult = specialOrderProtection.buildSpecialOrderReceiptResult(order, sale);
  const laterLookupResult = specialOrderProtection.buildSpecialOrderReceiptResult(order, sale);

  assert.deepEqual(laterLookupResult.receiptTransaction, completionResult.receiptTransaction);
  assert.equal(completionResult.receiptTransaction.specialOrderNumber, order.orderNumber);
  assert.equal(completionResult.receiptTransaction.items[0].name, 'Finalized Item');
  assert.equal(completionResult.receiptTransaction.total, 400);
});

test('a concurrent Mark as Paid request is rejected before proof persistence', async () => {
  let proofPersisted = false;
  let paymentApplied = false;
  const response = createResponse();

  await markCreditTransactionFullyPaid({
    params: { id: 'credit-1' },
    body: { clientRequestId: 'credit-payment:same-submit', extensionDays: 0 },
    file: { buffer: Buffer.from([1]), mimetype: 'image/jpeg' },
    user: { _id: 'user-1' },
    get: () => '',
  }, response, assert.fail, {
    findTransaction: async () => ({ _id: 'credit-1', remainingBalance: 100, paymentHistory: [] }),
    ensureOwnership: async () => {},
    claimPayment: async () => null,
    persistProof: async () => {
      proofPersisted = true;
    },
    applyPayment: async () => {
      paymentApplied = true;
    },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.message, 'This payment is already being processed.');
  assert.equal(proofPersisted, false);
  assert.equal(paymentApplied, false);
});
