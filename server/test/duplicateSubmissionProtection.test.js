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
const Category = require('../src/models/Category');
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
  const originalCategoryFindOne = Category.findOne;
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
  Category.findOne = async () => null;
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
    Category.findOne = originalCategoryFindOne;
  }
});

test('product archive and restore persist through the existing product update endpoint', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalCategoryFindOne = Category.findOne;
  let product = {
    _id: 'product-archive-1',
    sku: 'PNT-ARCHIVE-1',
    name: 'Archive Test Paint',
    stock: 0,
    reservedStock: 0,
    isActive: true,
    updatedAt: null,
  };

  Product.findById = async () => ({ ...product });
  Category.findOne = async () => null;
  Product.findOneAndUpdate = async (filter, payload) => {
    assert.equal(filter._id, 'product-archive-1');
    if (payload.isActive === false) {
      assert.deepEqual(filter.isActive, { $ne: false });
      assert.equal(filter.stock, 0);
      assert.equal(filter.reservedStock, 0);
    }
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
    Category.findOne = originalCategoryFindOne;
  }
});

test('product archive rejects stock and reservations and cannot smuggle stock into an archive update', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalCategoryFindOne = Category.findOne;
  const response = createResponse();
  Product.findOneAndUpdate = async () => {
    throw new Error('Archive write should not be attempted for blocked stock.');
  };

  try {
    Product.findById = async () => ({ _id: 'blocked-stock', stock: 3, reservedStock: 0, sellingUnit: 'pcs', isActive: true });
    await updateProduct({ params: { id: 'blocked-stock' }, body: { isActive: false }, user: {} }, response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, 'This item still has 3 pcs in stock. Stock must be zero before archiving.');

    response.statusCode = 200;
    response.body = undefined;
    Product.findById = async () => ({ _id: 'blocked-reservation', stock: 0, reservedStock: 2, sellingUnit: 'box', isActive: true });
    await updateProduct({ params: { id: 'blocked-reservation' }, body: { isActive: false }, user: {} }, response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /2 box remain reserved or allocated/);

    response.statusCode = 200;
    response.body = undefined;
    Product.findById = async () => ({ _id: 'stock-smuggle', stock: 0, reservedStock: 0, sellingUnit: 'pcs', isActive: true });
    await updateProduct({ params: { id: 'stock-smuggle' }, body: { isActive: false, stock: 7 }, user: {} }, response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, 'This item still has 0 pcs in stock. Stock must be zero before archiving.');
  } finally {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Category.findOne = originalCategoryFindOne;
  }
});

test('concurrent stock changes prevent a stale zero-stock archive write', async () => {
  const originalFindById = Product.findById;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  const originalCategoryFindOne = Category.findOne;
  let readCount = 0;
  Product.findById = async () => {
    readCount += 1;
    return readCount === 1
      ? { _id: 'racing-product', stock: 0, reservedStock: 0, sellingUnit: 'pcs', isActive: true }
      : { _id: 'racing-product', stock: 4, reservedStock: 0, sellingUnit: 'pcs', isActive: true };
  };
  Product.findOneAndUpdate = async (filter) => {
    assert.equal(filter.stock, 0);
    assert.equal(filter.reservedStock, 0);
    return null;
  };

  const response = createResponse();
  try {
    await updateProduct({ params: { id: 'racing-product' }, body: { isActive: false }, user: {} }, response, assert.fail);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.message, 'This item still has 4 pcs in stock. Stock must be zero before archiving.');
  } finally {
    Product.findById = originalFindById;
    Product.findOneAndUpdate = originalFindOneAndUpdate;
    Category.findOne = originalCategoryFindOne;
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

test('Special Order sale totals and customer come from the accepted quotation snapshot', () => {
  const order = {
    _id: '64b7fef00123456789abcdef',
    orderNumber: 'SO-SNAPSHOT',
    customer: 'changed-customer',
    customerName: 'Changed Customer',
    items: [{ itemName: 'Changed Item', quantity: 20, sellingPrice: 999 }],
  };
  const quotation = {
    _id: 'accepted-quotation',
    version: 2,
    customer: 'approved-customer',
    customerName: 'Approved Customer',
    items: [
      { itemName: 'Approved Item', quantity: 3, unitPrice: 125.5, lineAmount: 376.5 },
      { itemName: 'Another Approved Item', quantity: 2, unitPrice: 80, lineAmount: 160 },
    ],
    total: 536.5,
  };
  const request = { user: { _id: 'cashier', name: 'Cashier' } };
  const payload = specialOrderProtection.buildSalePayload(order, request, { quotation });

  assert.equal(payload.totalAmount, 536.5);
  assert.equal(payload.netAmount, 536.5);
  assert.equal(payload.grossAmount, 536.5);
  assert.equal(payload.vatAmount, 0);
  assert.equal(payload.totalAmount, payload.items.reduce((sum, item) => sum + item.subtotal, 0));
  assert.equal(payload.customer, 'approved-customer');
  assert.equal(payload.customerName, 'Approved Customer');
  assert.deepEqual(payload.items.map(({ name, quantity, unitPrice }) => ({ name, quantity, unitPrice })), [
    { name: 'Approved Item', quantity: 3, unitPrice: 125.5 },
    { name: 'Another Approved Item', quantity: 2, unitPrice: 80 },
  ]);
  assert.ok(payload.items.every((item) => item.product === null));
  assert.equal(payload.specialOrderQuotationId, quotation._id);
  assert.equal(payload.specialOrderQuotationVersion, 2);
  assert.equal(payload.clientRequestId, 'special-order:64b7fef00123456789abcdef');
});

test('zero-price quotation lines and an unlinked approved customer do not fall back to changed order data', () => {
  const order = {
    _id: 'order', orderNumber: 'SO-ZERO', customer: 'changed-customer', customerName: 'Changed Customer',
    items: [{ itemName: 'Changed Item', quantity: 1, sellingPrice: 900 }],
  };
  const quotation = {
    _id: 'quote', version: 1, customer: null, customerName: 'Approved Legacy Customer',
    items: [{ itemName: 'Approved Item', quantity: 2, unitPrice: 0, lineAmount: 0 }], total: 0,
  };
  const payload = specialOrderProtection.buildSalePayload(order, { user: { _id: 'cashier' } }, { quotation });
  assert.equal(payload.totalAmount, 0);
  assert.equal(payload.items[0].unitPrice, 0);
  assert.equal(payload.customer, null);
  assert.equal(payload.customerName, 'Approved Legacy Customer');
});

test('legacy Special Order sale payloads retain sellingPrice totals without a quotation', () => {
  const request = { user: { _id: 'cashier' } };
  const payload = specialOrderProtection.buildSalePayload({
    _id: 'legacy-order', orderNumber: 'SO-LEGACY', customer: null, customerName: 'Legacy Customer',
    items: [{ itemName: 'Legacy Item', quantity: 4, sellingPrice: 75 }],
  }, request);
  assert.equal(payload.totalAmount, 300);
  assert.equal(payload.customerName, 'Legacy Customer');
  assert.equal(payload.specialOrderQuotationId, undefined);

  const singleItemPayload = specialOrderProtection.buildSalePayload({
    _id: 'legacy-single', orderNumber: 'SO-SINGLE', customerName: 'Legacy Customer',
    itemName: 'Single Item', quantity: 2, sellingPrice: 100,
  }, request);
  assert.equal(singleItemPayload.totalAmount, 200);
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
