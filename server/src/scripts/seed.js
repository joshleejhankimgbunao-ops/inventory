require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Product = require('../models/Product');
const Sale = require('../models/Sale');

const usersSeed = [
  {
    name: 'Owner Account',
    username: 'owner',
    email: 'owner@example.com',
    password: 'Owner123!',
    pin: '123456',
    role: 'superadmin',
    isActive: true,
  },
  {
    name: 'Admin Account',
    username: 'admin1',
    email: 'admin1@example.com',
    password: 'Admin123!',
    pin: '123456',
    role: 'admin',
    isActive: true,
  },
  {
    name: 'Cashier Account',
    username: 'cashier1',
    email: 'cashier1@example.com',
    password: 'Cashier123!',
    pin: '123456',
    role: 'cashier',
    isActive: true,
  },
];

const productsSeed = [
  { name: 'Coco Lumber 2x4x8 ft', sku: 'LBR-001', category: 'Lumbers', stock: 150, price: 180 },
  { name: 'Deformed Bar 10mm x 6m', sku: 'STL-001', category: 'Steel Bars', stock: 40, price: 220 },
  { name: 'GI Corrugated Sheet Gauge 26 x 10 ft', sku: 'GS-002', category: 'Galvanized Sheets', stock: 35, price: 450 },
  { name: 'Portland Cement 40 kg', sku: 'CMT-001', category: 'Cement, Sand & Gravel', stock: 120, price: 240 },
  { name: 'THHN Wire 3.5mm² x 150m', sku: 'ELC-001', category: 'Electrical & Lighting', stock: 12, price: 4500 },
];

const shouldReset = process.argv.includes('--reset');

const hashPassword = async (plainText) => bcrypt.hash(plainText, 10);
const hashPin = async (plainText) => bcrypt.hash(plainText, 10);

const seedUsers = async () => {
  if (shouldReset) {
    await User.deleteMany({});
  }

  const createdUsers = [];

  for (const userData of usersSeed) {
    const existing = await User.findOne({ username: userData.username.toLowerCase() }).select('+password +pinHash');

    if (existing) {
      if (!existing.email && userData.email) {
        existing.email = userData.email.toLowerCase();
      }

      if (!existing.pinHash && userData.pin) {
        existing.pinHash = await hashPin(userData.pin);
      }

      await existing.save({ validateBeforeSave: false });
      createdUsers.push(existing);
      continue;
    }

    const hashedPassword = await hashPassword(userData.password);
    const hashedPin = userData.pin ? await hashPin(userData.pin) : undefined;
    const created = await User.create({
      ...userData,
      email: userData.email ? userData.email.toLowerCase() : undefined,
      password: hashedPassword,
      pinHash: hashedPin,
    });

    createdUsers.push(created);
  }

  return createdUsers;
};

const seedProducts = async () => {
  if (shouldReset) {
    await Product.deleteMany({});
  }

  const createdProducts = [];

  for (const productData of productsSeed) {
    const existing = await Product.findOne({ sku: productData.sku.toUpperCase() });

    if (existing) {
      createdProducts.push(existing);
      continue;
    }

    const created = await Product.create(productData);
    createdProducts.push(created);
  }

  return createdProducts;
};

const seedSampleSale = async (products, users) => {
  const cashier = users.find((user) => user.role === 'cashier');
  if (!cashier || products.length < 2) {
    return null;
  }

  if (shouldReset) {
    await Sale.deleteMany({});
  } else {
    const existingSale = await Sale.findOne();
    if (existingSale) {
      return existingSale;
    }
  }

  const p1 = products[0];
  const p2 = products[1];

  const qty1 = 2;
  const qty2 = 1;
  const subtotal1 = qty1 * p1.price;
  const subtotal2 = qty2 * p2.price;

  const sale = await Sale.create({
    items: [
      {
        product: p1._id,
        name: p1.name,
        quantity: qty1,
        unitPrice: p1.price,
        subtotal: subtotal1,
      },
      {
        product: p2._id,
        name: p2.name,
        quantity: qty2,
        unitPrice: p2.price,
        subtotal: subtotal2,
      },
    ],
    totalAmount: subtotal1 + subtotal2,
    paymentMethod: 'cash',
    cashier: cashier._id,
    notes: 'Sample seeded sale',
  });

  return sale;
};

const runSeed = async () => {
  try {
    await connectDB();

    const users = await seedUsers();
    const products = await seedProducts();
    const sale = await seedSampleSale(products, users);

    console.log('Seeding complete.');
    console.log(`Users: ${users.length}`);
    console.log(`Products: ${products.length}`);
    console.log(`Sample sale: ${sale ? 'created/present' : 'not created'}`);
    console.log('Sample credentials:');
    console.log(' - superadmin: owner / Owner123! / PIN 123456 / owner@example.com');
    console.log(' - admin: admin1 / Admin123! / PIN 123456 / admin1@example.com');
    console.log(' - cashier: cashier1 / Cashier123! / PIN 123456 / cashier1@example.com');
  } catch (error) {
    console.error('Seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

runSeed();
