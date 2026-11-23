const mongoose = require('mongoose');

const expiryBatchReferenceCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
}, { versionKey: false });

module.exports = mongoose.model('ExpiryBatchReferenceCounter', expiryBatchReferenceCounterSchema);
