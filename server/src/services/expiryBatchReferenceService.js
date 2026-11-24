const mongoose = require('mongoose');
const ExpiryBatch = require('../models/ExpiryBatch');
const ExpiryBatchReferenceCounter = require('../models/ExpiryBatchReferenceCounter');
const { getManilaBusinessDate, isValidExpiryDate } = require('../utils/productExpiry');

const missingReferenceFilter = {
  $or: [
    { batchReference: { $exists: false } },
    { batchReference: null },
    { batchReference: '' },
  ],
};

const formatExpiryBatchReference = (businessDate, sequence) => {
  if (!isValidExpiryDate(businessDate) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('A valid Manila batch date and sequence are required to generate a batch reference.');
  }
  return `BT-${businessDate.replace(/-/g, '')}-${String(sequence).padStart(3, '0')}`;
};

const getBatchCreationDate = (batch) => {
  const candidates = [batch?.createdAt, batch?.receivedAt, batch?._id?.getTimestamp?.()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    if (Number.isFinite(date.getTime())) return date;
  }
  throw new Error(`Expiry batch ${String(batch?._id || 'unknown')} has no usable creation date for its Batch Reference.`);
};

const isDuplicateKeyError = (error) => error?.code === 11000 || error?.codeName === 'DuplicateKey';

const ensureCounterExists = async (businessDate) => {
  try {
    await ExpiryBatchReferenceCounter.updateOne(
      { _id: businessDate },
      { $setOnInsert: { sequence: 0 } },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await ExpiryBatchReferenceCounter.updateOne({ _id: businessDate }, { $setOnInsert: { sequence: 0 } });
  }
};

const ensureCounterAtLeast = async (businessDate, sequence) => {
  try {
    await ExpiryBatchReferenceCounter.updateOne(
      { _id: businessDate },
      { $max: { sequence } },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await ExpiryBatchReferenceCounter.updateOne({ _id: businessDate }, { $max: { sequence } });
  }
};

const nextExpiryBatchReference = async ({ createdAt = new Date(), session } = {}) => {
  if (!session) throw new Error('Expiry Batch References must be allocated inside the batch transaction.');
  const businessDate = getManilaBusinessDate(getBatchCreationDate({ createdAt }));
  const counter = await ExpiryBatchReferenceCounter.findOneAndUpdate(
    { _id: businessDate },
    { $inc: { sequence: 1 } },
    { new: true, session, runValidators: true },
  );
  if (!counter || !Number.isSafeInteger(counter.sequence) || counter.sequence < 1) {
    throw new Error(`Unable to allocate a Batch Reference for ${businessDate}.`);
  }
  return formatExpiryBatchReference(businessDate, counter.sequence);
};

const parseReferenceSequence = (reference) => {
  const match = String(reference || '').match(/^BT-(\d{4})(\d{2})(\d{2})-(\d{3,})$/);
  if (!match) throw new Error(`Invalid existing Expiry Batch Reference: ${reference}.`);
  const businessDate = `${match[1]}-${match[2]}-${match[3]}`;
  const sequence = Number(match[4]);
  if (!isValidExpiryDate(businessDate) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid existing Expiry Batch Reference: ${reference}.`);
  }
  return { businessDate, sequence };
};

const backfillMissingExpiryBatchReferences = async () => {
  await Promise.all([ExpiryBatchReferenceCounter.init(), ExpiryBatch.init()]);

  // Normal restarts have no migration work. Check that first so we avoid
  // reading and parsing every existing reference on each server startup.
  const missing = await ExpiryBatch.find(missingReferenceFilter)
    .select('_id createdAt receivedAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  if (missing.length === 0) return { assigned: 0 };

  const existing = await ExpiryBatch.find({ batchReference: { $type: 'string', $ne: '' } })
    .select('_id batchReference')
    .lean();
  const maximumByDate = new Map();
  for (const batch of existing) {
    const { businessDate, sequence } = parseReferenceSequence(batch.batchReference);
    maximumByDate.set(businessDate, Math.max(maximumByDate.get(businessDate) || 0, sequence));
  }

  const byDate = new Map();
  for (const batch of missing) {
    const businessDate = getManilaBusinessDate(getBatchCreationDate(batch));
    const rows = byDate.get(businessDate) || [];
    rows.push(batch);
    byDate.set(businessDate, rows);
  }

  for (const [businessDate, rows] of byDate) {
    await ensureCounterAtLeast(businessDate, maximumByDate.get(businessDate) || 0);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const row of rows) {
          const current = await ExpiryBatch.findOne({ _id: row._id, ...missingReferenceFilter }).session(session).lean();
          if (!current) continue;
          const reference = await nextExpiryBatchReference({ createdAt: getBatchCreationDate(current), session });
          const update = await ExpiryBatch.collection.updateOne(
            { _id: row._id, ...missingReferenceFilter },
            { $set: { batchReference: reference } },
            { session },
          );
          if (update.modifiedCount !== 1) {
            throw new Error(`Could not assign an immutable Batch Reference to expiry batch ${String(row._id)}.`);
          }
        }
      });
    } finally {
      await session.endSession();
    }
  }
  return { assigned: missing.length };
};

module.exports = {
  formatExpiryBatchReference,
  getBatchCreationDate,
  ensureCounterExists,
  nextExpiryBatchReference,
  backfillMissingExpiryBatchReferences,
};
