const Product = require('../models/Product');
const { writeActivityLog, writeInventoryLog } = require('../services/logService');

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const toNumberOrUndefined = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const listProducts = async (req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    return res.json(products);
  } catch (error) {
    return next(error);
  }
};

const createProduct = async (req, res, next) => {
  try {
    const name = normalizeString(req.body?.name);
    const sku = normalizeString(req.body?.sku).toUpperCase();
    const category = normalizeString(req.body?.category);
    const brand = normalizeString(req.body?.brand);
    const color = normalizeString(req.body?.color);
    const size = normalizeString(req.body?.size);
    const supplierName = normalizeString(req.body?.supplierName);
    const stock = toNumberOrUndefined(req.body?.stock);
    const price = toNumberOrUndefined(req.body?.price);

    if (!name || !sku || price === undefined) {
      return res.status(400).json({ message: 'name, sku, and price are required.' });
    }

    const existing = await Product.findOne({ sku });
    if (existing) {
      return res.status(409).json({ message: 'SKU already exists.' });
    }

    const product = await Product.create({
      name,
      sku,
      category,
      brand,
      color,
      size,
      supplierName,
      ...(stock !== undefined ? { stock } : {}),
      price,
    });

    await writeInventoryLog({
      action: 'CREATE',
      code: product.sku,
      productRef: product._id,
      user: req.user,
      details: `Created product ${product.name}`,
      quantity: Number(product.stock || 0),
      stockBefore: 0,
      stockAfter: Number(product.stock || 0),
    });

    await writeActivityLog({
      user: req.user,
      action: 'Created Product',
      details: `Created ${product.name} (${product.sku})`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    return res.status(201).json(product);
  } catch (error) {
    return next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await Product.findById(id);

    if (!existing) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const stockBefore = Number(existing.stock || 0);

    const payload = {};

    if (req.body?.name !== undefined) payload.name = normalizeString(req.body.name);
    if (req.body?.sku !== undefined) payload.sku = normalizeString(req.body.sku).toUpperCase();
    if (req.body?.category !== undefined) payload.category = normalizeString(req.body.category);
    if (req.body?.brand !== undefined) payload.brand = normalizeString(req.body.brand);
    if (req.body?.color !== undefined) payload.color = normalizeString(req.body.color);
    if (req.body?.size !== undefined) payload.size = normalizeString(req.body.size);
    if (req.body?.supplierName !== undefined) payload.supplierName = normalizeString(req.body.supplierName);

    const stockValue = toNumberOrUndefined(req.body?.stock);
    if (stockValue !== undefined) payload.stock = stockValue;

    const priceValue = toNumberOrUndefined(req.body?.price);
    if (priceValue !== undefined) payload.price = priceValue;

    const product = await Product.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    const stockAfter = Number(product.stock || 0);
    const stockDelta = stockAfter - stockBefore;

    let inventoryAction = 'UPDATE';
    if (stockDelta > 0) {
      inventoryAction = 'ADD';
    } else if (stockDelta < 0) {
      inventoryAction = 'DEDUCT';
    }

    await writeInventoryLog({
      action: inventoryAction,
      code: product.sku,
      productRef: product._id,
      user: req.user,
      details: `Updated product ${product.name}`,
      quantity: Math.abs(stockDelta),
      stockBefore,
      stockAfter,
    });

    await writeActivityLog({
      user: req.user,
      action: 'Updated Product',
      details: `Updated ${product.name} (${product.sku})`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    return res.json(product);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
};
