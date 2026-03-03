const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is not set in environment variables.');
  }

  const connection = await mongoose.connect(mongoUri);
  const host = connection?.connection?.host || 'unknown-host';
  const database = connection?.connection?.name || 'unknown-db';
  console.log(`MongoDB connected: ${host}/${database}`);
};

module.exports = connectDB;
