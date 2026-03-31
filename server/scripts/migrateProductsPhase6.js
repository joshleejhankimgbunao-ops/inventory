require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Product = require('../src/models/Product');

const run = async () => {
  try {
    await connectDB();

    const result = await Product.updateMany(
      {
        $or: [
          { brand: { $exists: false } },
          { color: { $exists: false } },
          { size: { $exists: false } },
          { supplierName: { $exists: false } },
        ],
      },
      {
        $set: {
          brand: '',
          color: '',
          size: '',
          supplierName: '',
        },
      }
    );

    console.log('Phase 6 product migration completed.');
    console.log(`matched: ${result.matchedCount || 0}`);
    console.log(`modified: ${result.modifiedCount || 0}`);
    process.exit(0);
  } catch (error) {
    console.error('Phase 6 product migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
};

run();
