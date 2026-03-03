const Product = require('../models/Product');
const Sale = require('../models/Sale');

const listSales = async (req, res, next) => {
  try {
    const sales = await Sale.find()
      .populate('cashier', 'name username role')
      .sort({ createdAt: -1 });

    return res.json(sales);
  } catch (error) {
    return next(error);
  }
};

const createSale = async (req, res, next) => {
  try {
    const { items = [], paymentMethod = 'cash', notes = '' } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items are required.' });
    }

    const preparedItems = [];
    let totalAmount = 0;

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) {
        return res.status(400).json({ message: `Invalid product: ${item.productId}` });
      }

      const quantity = Number(item.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ message: `Invalid quantity for ${product.name}` });
      }

      if (product.stock < quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
      }

      const subtotal = quantity * product.price;
      preparedItems.push({
        product: product._id,
        name: product.name,
        quantity,
        unitPrice: product.price,
        subtotal,
      });

      totalAmount += subtotal;
      product.stock -= quantity;
      await product.save();
    }

    const sale = await Sale.create({
      items: preparedItems,
      totalAmount,
      paymentMethod,
      notes,
      cashier: req.user._id,
    });

    return res.status(201).json(sale);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listSales,
  createSale,
};
