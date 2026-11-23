const SpecialOrder = require('../models/SpecialOrder');
const SpecialOrderCounter = require('../models/SpecialOrderCounter');
const { getManilaBusinessDate } = require('../utils/productExpiry');

const getReferenceDate = (now = new Date()) => getManilaBusinessDate(now).replace(/-/g, '');

// The counter document exists before the transaction starts, avoiding a race
// between concurrent first-of-day transactional upserts.
const ensureReferenceCounter = async (date) => {
  try {
    await SpecialOrderCounter.updateOne({ _id: date }, { $setOnInsert: { sequence: 0 } }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
};

const allocateSpecialOrderReference = async (date, session) => {
  if (!session) throw new Error('A transaction is required to allocate a Special Order reference.');
  while (true) {
    const counter = await SpecialOrderCounter.findOneAndUpdate(
      { _id: date }, { $inc: { sequence: 1 } }, { returnDocument: 'after', session }
    ).lean();
    if (!counter || !Number.isSafeInteger(counter.sequence) || counter.sequence < 1) {
      throw new Error('Special Order reference counter is unavailable or exhausted.');
    }
    const reference = `SO-${date}-${String(counter.sequence).padStart(4, '0')}`;
    // Keep any historical reference intact, even if it happens to match this format.
    if (!await SpecialOrder.exists({ orderNumber: reference }).session(session)) return reference;
  }
};

module.exports = { getReferenceDate, ensureReferenceCounter, allocateSpecialOrderReference };
