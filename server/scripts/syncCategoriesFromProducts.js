require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');

const run = async () => {
  try {
    await connectDB();

    const categoriesFromProducts = await Product.distinct('category', {
      category: { $exists: true, $ne: '' },
    });

    const normalizedNames = [...new Set(
      categoriesFromProducts
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )];

    let created = 0;
    let existing = 0;

    for (const categoryName of normalizedNames) {
      const found = await Category.findOne({ name: categoryName });
      if (found) {
        existing += 1;
        continue;
      }

      await Category.create({
        name: categoryName,
        showBrand: false,
        requireBrand: false,
        showColor: false,
        requireColor: false,
        showSize: true,
        requireSize: true,
        showSupplier: true,
        sizeUnits: ['pcs'],
      });
      created += 1;
    }

    console.log('Category sync complete.');
    console.log(`Found from products: ${normalizedNames.length}`);
    console.log(`Created: ${created}`);
    console.log(`Already existing: ${existing}`);
  } catch (error) {
    console.error('Failed to sync categories from products:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

run();
