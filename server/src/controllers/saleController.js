const mongoose = require('mongoose');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const { writeActivityLog, writeInventoryLog } = require('../services/logService');

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const normalizeClientRequestId = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const mapSaleToTransactionContract = (sale) => {
  const saleObj = typeof sale.toObject === 'function' ? sale.toObject() : sale;
  const cashierLabel = saleObj?.cashier?.name || saleObj?.cashier?.username || 'Unknown';

  return {
    id: String(saleObj._id),
    date: saleObj.createdAt,
    cashier: cashierLabel,
    total: Number(saleObj.totalAmount || 0),
    paymentMethod: saleObj.paymentMethod || 'cash',
    notes: saleObj.notes || '',
    isArchived: Boolean(saleObj.isArchived),
    items: (saleObj.items || []).map((item, index) => ({
      id: item.product ? String(item.product) : `${saleObj._id}-${index}`,
      code: item.code || '',
      name: item.name,
      qty: Number(item.quantity || 0),
      price: Number(item.unitPrice || 0),
      subtotal: Number(item.subtotal || 0),
    })),
  };
};

const listSales = async (req, res, next) => {
  try {
    const includeArchived = parseBool(req.query?.includeArchived, true);
    const query = includeArchived ? {} : { isArchived: false };

    const sales = await Sale.find(query)
      .populate('cashier', 'name username role')
      .sort({ createdAt: -1 });

    return res.json(sales);
  } catch (error) {
    return next(error);
  }
};

const listSalesHistoryView = async (req, res, next) => {
  try {
    const includeArchived = parseBool(req.query?.includeArchived, true);
    const query = includeArchived ? {} : { isArchived: false };

    const sales = await Sale.find(query)
      .populate('cashier', 'name username role')
      .sort({ createdAt: -1 });

    const transactions = sales.map(mapSaleToTransactionContract);
    return res.json(transactions);
  } catch (error) {
    return next(error);
  }
};

const executeSaleCreation = async ({ req, session = null, clientRequestId = '' }) => {
  const { items = [], paymentMethod = 'cash', notes = '' } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    const validationError = new Error('items are required.');
    validationError.status = 400;
    throw validationError;
  }

  const preparedItems = [];
  const inventoryAdjustments = [];
  let totalAmount = 0;

  for (const item of items) {
    const product = await Product.findById(item.productId, null, session ? { session } : undefined);
    if (!product || !product.isActive) {
      const productError = new Error(`Invalid product: ${item.productId}`);
      productError.status = 400;
      throw productError;
    }

    const quantity = Number(item.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const quantityError = new Error(`Invalid quantity for ${product.name}`);
      quantityError.status = 400;
      throw quantityError;
    }

    if (product.stock < quantity) {
      const stockError = new Error(`Insufficient stock for ${product.name}`);
      stockError.status = 400;
      throw stockError;
    }

    const subtotal = quantity * product.price;
    preparedItems.push({
      product: product._id,
      name: product.name,
      code: product.sku,
      quantity,
      unitPrice: product.price,
      subtotal,
    });

    totalAmount += subtotal;
    const stockBefore = Number(product.stock || 0);
    product.stock -= quantity;
    await product.save(session ? { session } : undefined);

    inventoryAdjustments.push({
      code: product.sku,
      productRef: product._id,
      name: product.name,
      quantity,
      stockBefore,
      stockAfter: Number(product.stock || 0),
    });
  }

  const [sale] = await Sale.create([{
    items: preparedItems,
    totalAmount,
    paymentMethod,
    notes,
    cashier: req.user._id,
    ...(clientRequestId ? { clientRequestId } : {}),
  }], session ? { session } : undefined);

  for (const adjustment of inventoryAdjustments) {
    await writeInventoryLog({
      action: 'DEDUCT',
      code: adjustment.code,
      productRef: adjustment.productRef,
      user: req.user,
      details: `Sold ${adjustment.quantity} of ${adjustment.name}`,
      quantity: adjustment.quantity,
      stockBefore: adjustment.stockBefore,
      stockAfter: adjustment.stockAfter,
      session,
    });
  }

  await writeActivityLog({
    user: req.user,
    action: 'Created Sale',
    details: `Sale ${sale._id} created with ${preparedItems.length} item(s), total ${totalAmount}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    session,
  });

  return sale;
};

const createSale = async (req, res, next) => {
  let session;
  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);

  try {
    if (clientRequestId) {
      const existingSale = await Sale.findOne({ clientRequestId });
      if (existingSale) {
        return res.status(200).json(existingSale);
      }
    }

    session = await mongoose.startSession();
    let createdSale = null;

    await session.withTransaction(async () => {
      createdSale = await executeSaleCreation({ req, session, clientRequestId });
    });

    return res.status(201).json(createdSale);
  } catch (error) {
    const duplicateRequest = error?.code === 11000 && error?.keyPattern?.clientRequestId;
    if (duplicateRequest && clientRequestId) {
      const existingSale = await Sale.findOne({ clientRequestId });
      if (existingSale) {
        return res.status(200).json(existingSale);
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
      // Fallback for standalone MongoDB deployments where transactions are unavailable.
      const sale = await executeSaleCreation({ req, session: null, clientRequestId });
      return res.status(201).json(sale);
    } catch (fallbackError) {
      const duplicateFallbackRequest = fallbackError?.code === 11000 && fallbackError?.keyPattern?.clientRequestId;
      if (duplicateFallbackRequest && clientRequestId) {
        const existingSale = await Sale.findOne({ clientRequestId });
        if (existingSale) {
          return res.status(200).json(existingSale);
        }
      }

      if (fallbackError?.status) {
        return res.status(fallbackError.status).json({ message: fallbackError.message });
      }
      return next(fallbackError);
    }
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

const archiveSale = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found.' });
    }

    sale.isArchived = true;
    sale.archivedAt = new Date();
    sale.archivedBy = req.user?._id || null;
    await sale.save();

    await writeActivityLog({
      user: req.user,
      action: 'Archived Sale',
      details: `Archived sale ${sale._id}.`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    return res.json({ message: 'Sale archived.', sale });
  } catch (error) {
    return next(error);
  }
};

const restoreSale = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found.' });
    }

    sale.isArchived = false;
    sale.archivedAt = null;
    sale.archivedBy = null;
    await sale.save();

    await writeActivityLog({
      user: req.user,
      action: 'Restored Sale',
      details: `Restored sale ${sale._id}.`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    return res.json({ message: 'Sale restored.', sale });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listSales,
  listSalesHistoryView,
  createSale,
  archiveSale,
  restoreSale,
};
