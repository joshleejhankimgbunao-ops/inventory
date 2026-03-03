const Product = require('../models/Product');

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
    const { name, sku, category, stock, price } = req.body;
    if (!name || !sku || price === undefined) {
      return res.status(400).json({ message: 'name, sku, and price are required.' });
    }

    const existing = await Product.findOne({ sku: sku.toUpperCase() });
    if (existing) {
      return res.status(409).json({ message: 'SKU already exists.' });
    }

    const product = await Product.create({ name, sku, category, stock, price });
    return res.status(201).json(product);
  } catch (error) {
    return next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

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
