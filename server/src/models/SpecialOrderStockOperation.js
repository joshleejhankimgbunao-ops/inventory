const mongoose = require('mongoose');

const operationSchema = new mongoose.Schema({
  specialOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SpecialOrder', required: true },
  requestId: { type: String, required: true, trim: true },
  action: { type: String, enum: ['Reserve', 'Release', 'Cancel'], required: true },
  changes: [{ product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }, quantity: { type: Number, required: true } }],
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

operationSchema.index({ specialOrder: 1, requestId: 1 }, { unique: true });

module.exports = mongoose.model('SpecialOrderStockOperation', operationSchema);
