const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const SpecialOrder = require('../models/SpecialOrder');
const Partner = require('../models/Partner');
const { writeActivityLog } = require('../services/logService');
const {
  publishSaleCreated,
  publishActivityLogged,
  publishSpecialOrderUpdated,
} = require('../services/realtimeService');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoney } = require('../utils/moneyValidation');
const { mapSaleToTransactionContract } = require('./saleController');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');

const normalizeString = (value) => String(value || '').trim();

const createValidationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const parseExpectedArrivalDate = (value) => {
  const source = normalizeString(value);
  if (!source) return { error: 'Each special order item requires an expected date.' };

  const matchedDate = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) return { error: 'Each special order item requires a valid expected date.' };

  const [, year, month, day] = matchedDate;
  const expectedArrivalDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    expectedArrivalDate.getUTCFullYear() !== Number(year)
    || expectedArrivalDate.getUTCMonth() !== Number(month) - 1
    || expectedArrivalDate.getUTCDate() !== Number(day)
  ) return { error: 'Each special order item requires a valid expected date.' };

  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (expectedArrivalDate.getTime() < today) {
    return { error: 'Each special order item expected date cannot be earlier than today.' };
  }

  return { expectedArrivalDate };
};

const ensureCashierOwnsSpecialOrder = ({ order, user }) => {
  if (user?.role !== 'cashier') return;

  if (!order?.createdBy || String(order.createdBy) !== String(user._id)) {
    const error = new Error('You can only modify your own special orders.');
    error.status = 403;
    throw error;
  }
};

const publishSpecialOrderChange = (order) => {
  publishSpecialOrderUpdated({
    orderId: order?._id,
    orderNumber: order?.orderNumber,
    status: order?.status,
  });
};

const normalizeOrderItem = (item) => {
  const itemName = normalizeHumanReadable(item?.itemName);
  const quantity = parseStrictWholeNumber(item?.quantity, { min: 1 });
  const purchaseCostRaw = item?.purchaseCost;
  const sellingPriceRaw = item?.sellingPrice;
  const purchaseCost = parseSafeMoney(purchaseCostRaw);
  const sellingPrice = parseSafeMoney(sellingPriceRaw);

  if (!itemName) {
    throw createValidationError('Each special order item requires an item name.');
  }

  if (quantity === null) {
    throw createValidationError(`Quantity for ${itemName} must be a whole number greater than 0.`);
  }
  if (!hasValue(purchaseCostRaw) || purchaseCost === null || purchaseCost <= 0) {
    throw createValidationError(isMoneyInputTooLarge(purchaseCostRaw) ? 'Amount is too large. Please enter a smaller value.' : `Purchase cost for ${itemName} is required and must be greater than 0.`);
  }
  if (!hasValue(sellingPriceRaw) || sellingPrice === null || sellingPrice <= 0) {
    throw createValidationError(isMoneyInputTooLarge(sellingPriceRaw) ? 'Amount is too large. Please enter a smaller value.' : `Selling price for ${itemName} is required and must be greater than 0.`);
  }

  const { expectedArrivalDate, error: expectedArrivalDateError } = parseExpectedArrivalDate(item?.expectedArrivalDate);
  if (expectedArrivalDateError) throw createValidationError(expectedArrivalDateError);

  return {
    itemName,
    description: normalizeHumanReadable(item?.description),
    quantity,
    supplier: normalizeString(item?.supplierId) || item?.supplier || null,
    supplierName: normalizeHumanReadable(item?.supplierName),
    purchaseCost,
    sellingPrice,
    expectedArrivalDate,
    remarks: normalizeString(item?.remarks),
  };
};

const normalizeOrderItems = (body) => {
  if (Array.isArray(body?.items)) return body.items.map(normalizeOrderItem);

  const hasLegacyItem = ['itemName', 'description', 'quantity', 'supplierName', 'purchaseCost', 'sellingPrice', 'expectedArrivalDate', 'remarks']
    .some((field) => body?.[field] !== undefined);
  if (!hasLegacyItem) return [];

  const fallbackItem = normalizeOrderItem({
    itemName: body?.itemName,
    description: body?.description,
    quantity: body?.quantity,
    supplierName: body?.supplierName,
    purchaseCost: body?.purchaseCost,
    sellingPrice: body?.sellingPrice,
    expectedArrivalDate: body?.expectedArrivalDate,
    remarks: body?.remarks,
  });

  return [fallbackItem];
};

const generateOrderNumber = () => {
  const stamp = Date.now().toString().slice(-8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SO-${stamp}-${suffix}`;
};

const getSpecialOrderClientRequestId = (order) => `special-order:${String(order?._id || '')}`;

const isDuplicateClientRequestIdError = (error) => {
  return error?.code === 11000 && Boolean(error?.keyPattern?.clientRequestId);
};

const enrichOrder = (order) => {
  const raw = typeof order?.toObject === 'function' ? order.toObject() : order;
  if (!raw) return null;

  return {
    ...raw,
    statusHistory: Array.isArray(raw.statusHistory) ? raw.statusHistory : [],
  };
};

const buildQuery = (req) => {
  const query = {};
  const status = normalizeString(req.query?.status);
  const search = normalizeString(req.query?.search);

  if (status && status.toLowerCase() !== 'all') {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { itemName: { $regex: search, $options: 'i' } },
      { supplierName: { $regex: search, $options: 'i' } },
      { remarks: { $regex: search, $options: 'i' } },
      { 'items.itemName': { $regex: search, $options: 'i' } },
      { 'items.supplierName': { $regex: search, $options: 'i' } },
    ];
  }

  if (req.user?.role === 'cashier') {
    query.createdBy = req.user._id;
  }

  return query;
};

const buildSalePayload = (order, req) => {
  const sourceItems = Array.isArray(order.items) && order.items.length > 0
    ? order.items
    : [{ itemName: order.itemName, quantity: order.quantity, sellingPrice: order.sellingPrice }];

  const lineTotal = sourceItems.reduce((sum, item) => sum + (Number(item.sellingPrice || 0) * Number(item.quantity || 0)), 0);

  return {
    items: sourceItems.map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.sellingPrice || 0);
      return {
        product: null,
        name: item.itemName || order.itemName,
        code: `${order.orderNumber}-${index + 1}`,
        quantity,
        unitPrice,
        subtotal: unitPrice * quantity,
      };
    }),
    totalAmount: lineTotal,
    netAmount: lineTotal,
    vatAmount: 0,
    grossAmount: lineTotal,
    pricingMode: 'inclusive',
    vatMode: 'vatable',
    customerIsVatExempt: false,
    hasVatApplicableItems: false,
    hasVatableItems: true,
    hasZeroRatedItems: false,
    vatRatesUsed: [],
    paymentMethod: 'cash',
    paymentStatus: 'Paid',
    customer: order.customer || null,
    customerName: order.customerName,
    cashier: req.user._id,
    cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown',
    notes: `Special Order ${order.orderNumber}. ${order.remarks || ''}`.trim(),
    isArchived: false,
    specialOrderId: order._id,
    specialOrderNumber: order.orderNumber,
    clientRequestId: getSpecialOrderClientRequestId(order),
  };
};

const buildSpecialOrderReceiptResult = (order, sale) => ({
  order: enrichOrder(order),
  sale,
  receiptTransaction: sale ? mapSaleToTransactionContract(sale) : null,
});

const findSpecialOrderSale = async (order, session = null) => {
  const selectors = [
    { clientRequestId: getSpecialOrderClientRequestId(order) },
    { specialOrderId: order._id },
  ];
  if (order.linkedSaleId) selectors.unshift({ _id: order.linkedSaleId });

  const query = Sale.findOne({ $or: selectors })
    .populate('cashier', 'name displayName username role');
  return session ? query.session(session) : query;
};

const markSpecialOrderCompleted = async ({ order, sale, req, session = null }) => {
  order.status = 'Completed';
  order.completedAt = new Date();
  order.completedBy = req.user?._id || null;
  order.updatedBy = req.user?._id || null;
  order.linkedSaleId = sale._id;
  order.statusHistory.push({ status: 'Completed', changedBy: req.user?._id || null, note: 'Order completed and converted to sale.' });
  await order.save(session ? { session } : undefined);

  await writeActivityLog({
    user: req.user,
    action: 'Completed Special Order',
    details: `Special order ${order.orderNumber} completed as sale ${sale._id}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    ...(session ? { session } : {}),
  });

  return order;
};

const recoverSpecialOrderCompletion = async ({ orderId, req }) => {
  const order = await SpecialOrder.findById(orderId);
  if (!order) return null;

  ensureCashierOwnsSpecialOrder({ order, user: req.user });
  const sale = await findSpecialOrderSale(order);
  if (!sale) return null;

  if (order.status === 'Completed') return { order, sale };
  if (order.status !== 'In Progress') return null;

  const completedOrder = await markSpecialOrderCompleted({ order, sale, req });
  return { order: completedOrder, sale };
};

const listSpecialOrders = async (req, res, next) => {
  try {
    const orders = await SpecialOrder.find(buildQuery(req)).sort({ createdAt: -1 });
    return res.json(orders.map(enrichOrder));
  } catch (error) {
    return next(error);
  }
};

const createSpecialOrder = async (req, res, next) => {
  try {
    const clientRequestId = normalizeString(req.body?.clientRequestId);
    if (clientRequestId) {
      const existing = await SpecialOrder.findOne({ clientRequestId });
      if (existing) return res.status(200).json(enrichOrder(existing));
    }

    const customerId = normalizeString(req.body?.customerId);
    const supplierId = normalizeString(req.body?.supplierId);
    const customerNameInput = normalizeHumanReadable(req.body?.customerName);
    const supplierNameInput = normalizeHumanReadable(req.body?.supplierName);
    const items = normalizeOrderItems(req.body);

    if (!customerNameInput) {
      return res.status(400).json({ message: 'customerName is required.' });
    }
    if (items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required.' });
    }

    let customer = null;
    let supplier = null;
    if (customerId) {
      customer = await Partner.findOne({ _id: customerId, type: 'customer' });
    }
    if (supplierId) {
      supplier = await Partner.findOne({ _id: supplierId, type: 'supplier' });
    }

    const [created] = await SpecialOrder.create([{
      orderNumber: generateOrderNumber(),
      customer: customer?._id || null,
      customerName: customer?.name || customerNameInput,
      items: items.map((item) => ({
        ...item,
        supplier: item.supplier || supplier?._id || null,
        supplierName: item.supplierName || supplier?.name || supplierNameInput,
      })),
      itemName: items[0].itemName,
      description: items[0].description,
      quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      supplier: supplier?._id || null,
      supplierName: items[0].supplierName || supplier?.name || supplierNameInput,
      purchaseCost: items.reduce((sum, item) => sum + Number(item.purchaseCost || 0) * Number(item.quantity || 0), 0),
      sellingPrice: items.reduce((sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 0), 0),
      expectedArrivalDate: items.find((item) => item.expectedArrivalDate)?.expectedArrivalDate || null,
      status: 'In Progress',
      ...(clientRequestId ? { clientRequestId } : {}),
      remarks: normalizeString(req.body?.remarks),
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
      statusHistory: [{ status: 'In Progress', changedBy: req.user?._id || null, note: 'Order created and started.' }],
    }]);

    await writeActivityLog({
      user: req.user,
      action: 'Created Special Order',
      details: `Special order ${created.orderNumber} created for ${created.customerName} (${created.itemName}).`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishSpecialOrderChange(created);

    return res.status(201).json(enrichOrder(created));
  } catch (error) {
    if (isDuplicateClientRequestIdError(error)) {
      const existing = await SpecialOrder.findOne({ clientRequestId: normalizeString(req.body?.clientRequestId) });
      if (existing) return res.status(200).json(enrichOrder(existing));
    }
    return next(error);
  }
};

const getSpecialOrderReceipt = async (req, res, next) => {
  try {
    const order = await SpecialOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Special order not found.' });
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });
    if (order.status !== 'Completed') {
      return res.status(400).json({ message: 'Only completed special orders have a receipt.' });
    }

    const sale = await findSpecialOrderSale(order);
    if (!sale) {
      return res.status(404).json({ message: 'Finalized sale for this special order was not found.' });
    }

    const result = buildSpecialOrderReceiptResult(order, sale);
    return res.json({ order: result.order, receiptTransaction: result.receiptTransaction });
  } catch (error) {
    return next(error);
  }
};

const updateSpecialOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await SpecialOrder.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Special order not found.' });
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });

    if (order.status !== 'In Progress') {
      return res.status(400).json({ message: 'Only In Progress special orders can be edited.' });
    }

    const payload = {};
    if (req.body?.customerName !== undefined) {
      payload.customerName = normalizeHumanReadable(req.body.customerName);
      if (!payload.customerName) {
        return res.status(400).json({ message: 'customerName is required.' });
      }
    }
    if (req.body?.items !== undefined || req.body?.itemName !== undefined) {
      const items = normalizeOrderItems(req.body);
      if (items.length === 0) {
        return res.status(400).json({ message: 'At least one item is required.' });
      }

      payload.items = items;
      payload.itemName = items[0].itemName;
      payload.description = items[0].description;
      payload.quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      payload.supplierName = items[0].supplierName || normalizeString(req.body.supplierName);
      payload.purchaseCost = items.reduce((sum, item) => sum + Number(item.purchaseCost || 0) * Number(item.quantity || 0), 0);
      payload.sellingPrice = items.reduce((sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 0), 0);
      payload.expectedArrivalDate = items.find((item) => item.expectedArrivalDate)?.expectedArrivalDate || null;
    }
    if (req.body?.remarks !== undefined) payload.remarks = normalizeString(req.body.remarks);
    if (req.body?.status !== undefined) {
      return res.status(400).json({ message: 'Use the status endpoint to change a special order status.' });
    }
    if (req.body?.customerId !== undefined) {
      const customer = req.body.customerId ? await Partner.findOne({ _id: req.body.customerId, type: 'customer' }) : null;
      payload.customer = customer?._id || null;
      if (customer?.name) payload.customerName = customer.name;
    }
    if (req.body?.supplierId !== undefined) {
      const supplier = req.body.supplierId ? await Partner.findOne({ _id: req.body.supplierId, type: 'supplier' }) : null;
      payload.supplier = supplier?._id || null;
      if (supplier?.name) payload.supplierName = supplier.name;
    }

    if (payload.quantity !== undefined && (!Number.isFinite(payload.quantity) || payload.quantity < 1)) {
      return res.status(400).json({ message: 'quantity must be at least 1.' });
    }

    order.set({ ...payload, updatedBy: req.user?._id || null });
    await order.save();

    await writeActivityLog({
      user: req.user,
      action: 'Updated Special Order',
      details: `Special order ${order.orderNumber} updated.`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishSpecialOrderChange(order);

    return res.json(enrichOrder(order));
  } catch (error) {
    return next(error);
  }
};

const updateSpecialOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await SpecialOrder.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Special order not found.' });
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });

    return res.status(400).json({
      message: 'Manual status changes are not available. Use the complete endpoint for In Progress orders.',
    });
  } catch (error) {
    return next(error);
  }
};

const completeSpecialOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  const completeWithSession = async (orderId) => {
    const order = await SpecialOrder.findById(orderId).session(session);
    if (!order) {
      const error = new Error('Special order not found.');
      error.status = 404;
      throw error;
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });

    if (order.status === 'Cancelled') {
      const error = new Error('Cancelled special orders cannot be completed.');
      error.status = 400;
      throw error;
    }

    if (order.status === 'Completed') {
      const sale = await findSpecialOrderSale(order, session);
      return { order, sale, saleCreated: false };
    }

    if (order.status !== 'In Progress') {
      const error = new Error('Only In Progress special orders can be completed.');
      error.status = 400;
      throw error;
    }

    const existingSale = await findSpecialOrderSale(order, session);
    if (existingSale) {
      const completedOrder = await markSpecialOrderCompleted({ order, sale: existingSale, req, session });
      return { order: completedOrder, sale: existingSale, saleCreated: false };
    }

    const [sale] = await Sale.create([buildSalePayload(order, req)], { session });
    const completedOrder = await markSpecialOrderCompleted({ order, sale, req, session });

    return { order: completedOrder, sale, saleCreated: true };
  };

  try {
    const { id } = req.params;
    const result = await session.withTransaction(async () => completeWithSession(id));

    if (result.saleCreated && result.sale?._id) {
      publishSaleCreated({
        saleId: result.sale._id,
        cashierId: req.user?._id,
        cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown',
      });
      publishActivityLogged({
        action: 'Completed Special Order',
        userId: req.user?._id,
      });
    }

    publishSpecialOrderChange(result.order);

    return res.json(buildSpecialOrderReceiptResult(result.order, result.sale));
  } catch (error) {
    if (isDuplicateClientRequestIdError(error)) {
      try {
        const recovered = await recoverSpecialOrderCompletion({ orderId: req.params.id, req });
        if (recovered) {
          publishSpecialOrderChange(recovered.order);
          return res.json(buildSpecialOrderReceiptResult(recovered.order, recovered.sale));
        }
      } catch (recoveryError) {
        if (recoveryError?.status) {
          return res.status(recoveryError.status).json({ message: recoveryError.message });
        }
        return next(recoveryError);
      }
    }

    const message = String(error?.message || '').toLowerCase();
    const transactionUnsupported = message.includes('transaction numbers are only allowed on a replica set member or mongos');

    if (!transactionUnsupported) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      return next(error);
    }

    try {
      const order = await SpecialOrder.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ message: 'Special order not found.' });
      }

      ensureCashierOwnsSpecialOrder({ order, user: req.user });

      if (order.status === 'Cancelled') {
        return res.status(400).json({ message: 'Cancelled special orders cannot be completed.' });
      }

      if (order.status === 'Completed') {
        const sale = await findSpecialOrderSale(order);
        return res.json(buildSpecialOrderReceiptResult(order, sale));
      }

      if (order.status !== 'In Progress') {
        return res.status(400).json({ message: 'Only In Progress special orders can be completed.' });
      }

      const existingSale = await findSpecialOrderSale(order);
      if (existingSale) {
        const completedOrder = await markSpecialOrderCompleted({ order, sale: existingSale, req });
        publishSpecialOrderChange(completedOrder);
        return res.json(buildSpecialOrderReceiptResult(completedOrder, existingSale));
      }

      const [sale] = await Sale.create([buildSalePayload(order, req)]);
      const completedOrder = await markSpecialOrderCompleted({ order, sale, req });

      publishSaleCreated({
        saleId: sale._id,
        cashierId: req.user?._id,
        cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown',
      });
      publishActivityLogged({
        action: 'Completed Special Order',
        userId: req.user?._id,
      });
      publishSpecialOrderChange(completedOrder);

      return res.json(buildSpecialOrderReceiptResult(completedOrder, sale));
    } catch (fallbackError) {
      if (isDuplicateClientRequestIdError(fallbackError)) {
        try {
          const recovered = await recoverSpecialOrderCompletion({ orderId: req.params.id, req });
          if (recovered) {
            publishSpecialOrderChange(recovered.order);
            return res.json(buildSpecialOrderReceiptResult(recovered.order, recovered.sale));
          }
        } catch (recoveryError) {
          if (recoveryError?.status) {
            return res.status(recoveryError.status).json({ message: recoveryError.message });
          }
          return next(recoveryError);
        }
      }

      if (fallbackError?.status) {
        return res.status(fallbackError.status).json({ message: fallbackError.message });
      }
      return next(fallbackError);
    } finally {
      await session.endSession();
    }
  } finally {
    await session.endSession();
  }
};

module.exports = {
  listSpecialOrders,
  getSpecialOrderReceipt,
  createSpecialOrder,
  updateSpecialOrder,
  updateSpecialOrderStatus,
  completeSpecialOrder,
  __test: {
    buildSalePayload,
    buildSpecialOrderReceiptResult,
    getSpecialOrderClientRequestId,
  },
};
