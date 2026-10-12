require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Product = require('../src/models/Product');
const Category = require('../src/models/Category');
const { executeProductCategoryBackfill } = require('../src/services/productCategoryBackfill');

const apply = process.argv.includes('--apply');

const run = async () => {
  try {
    await connectDB();
    const [products, categories] = await Promise.all([
      Product.find().select('_id sku category categoryRef').lean(),
      Category.find().select('_id name isActive').lean(),
    ]);
    const report = await executeProductCategoryBackfill({
      products,
      categories,
      apply,
      ProductModel: Product,
    });

    console.log(JSON.stringify(report, null, 2));
    if (!apply) {
      console.log('Dry run only. Re-run with --apply to write exact matches.');
    }
  } catch (error) {
    console.error('Product category reference backfill failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

run();
