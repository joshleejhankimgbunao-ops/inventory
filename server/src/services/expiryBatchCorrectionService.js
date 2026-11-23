/* global require, module */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const ExpiryBatch = require('../models/ExpiryBatch');
const ExpiryBatchMovement = require('../models/ExpiryBatchMovement');
const ExpiryBatchCorrection = require('../models/ExpiryBatchCorrection');
const SpecialOrderStockReservation = require('../models/SpecialOrderStockReservation');
const ActivityLog = require('../models/ActivityLog');
const { isValidExpiryDate } = require('../utils/productExpiry');
const { activeBatchFilter } = require('./expiryBatchLifecycle');
const { publishActivityLogged, publishInventoryUpdated } = require('./realtimeService');

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const conflict = (message) => failure(message, 409);
const actorName = (user) => user?.displayName || user?.name || user?.username || 'Authorized user';

const validateCorrectionInput = ({ productId, batchId, newExpiryDate, reason, requestId, expectedUpdatedAt }) => {
  if (!mongoose.isValidObjectId(productId)) throw failure('Select a valid product.');
  if (!mongoose.isValidObjectId(batchId)) throw failure('Select a valid batch.');
  if (typeof newExpiryDate !== 'string' || !isValidExpiryDate(newExpiryDate)) {
    throw failure('Enter a valid expiry date.');
  }
  if (typeof reason !== 'string' || !reason.trim()) throw failure('Enter a reason for the correction.');
  if (reason.trim().length > 500) throw failure('The correction reason cannot exceed 500 characters.');
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.trim().length > 160) {
    throw failure('Refresh and retry the correction.');
  }
  const expectedDate = expectedUpdatedAt instanceof Date ? expectedUpdatedAt : new Date(expectedUpdatedAt);
  if (!expectedUpdatedAt || !Number.isFinite(expectedDate.getTime())) {
    throw failure('Batch details are out of date. Refresh and try again.');
  }
  return {
    productId,
    batchId,
    newExpiryDate,
    reason: reason.trim(),
    requestId: requestId.trim(),
    expectedUpdatedAt: expectedDate,
  };
};

const correctionMatchesRequest = (correction, { productId, batchId, newExpiryDate, reason }, user) =>
  String(correction.product) === String(productId)
  && String(correction.batch) === String(batchId)
  && correction.newExpiryDate === newExpiryDate
  && correction.reason === reason
  && String(correction.actor) === String(user?._id || '');

const correctExpiryBatchDate = async (input, user) => {
  const values = validateCorrectionInput(input);
  if (!user?._id) throw failure('Sign in again to correct this batch.', 401);
  if (!['admin', 'superadmin'].includes(user.role)) throw failure('You do not have permission to correct expiry dates.', 403);

  const session = await mongoose.startSession();
  let result;
  let activityLog;
  try {
    await session.withTransaction(async () => {
      const priorCorrection = await ExpiryBatchCorrection.findOne({ requestId: values.requestId }).session(session);
      if (priorCorrection) {
        if (!correctionMatchesRequest(priorCorrection, values, user)) {
          throw conflict('This correction request was already used. Refresh and try again.');
        }
        const currentBatch = await ExpiryBatch.findOne({ _id: values.batchId, product: values.productId }).session(session);
        if (!currentBatch) throw failure('This expiry batch could not be found.', 404);
        result = { batch: currentBatch, correction: priorCorrection, replayed: true };
        return;
      }

      const product = await Product.findOne({ _id: values.productId, expiryTrackingEnabled: true })
        .select('sku expiryTrackingEnabled expiryTrackingPeriodId updatedAt')
        .session(session);
      if (!product) throw conflict('Expiry tracking is not enabled for this product.');
      if (!product.expiryTrackingPeriodId) throw conflict('Verify the current batches before correcting an expiry date.');

      const batch = await ExpiryBatch.findOne({ ...activeBatchFilter(product), _id: values.batchId }).session(session);
      if (!batch) throw failure('This expiry batch could not be found for the selected product.', 404);
      if (!isValidExpiryDate(batch.expiryDate)) throw conflict('This batch needs manual review before its expiry date can be corrected.');
      if (batch.expiryDate === values.newExpiryDate) throw failure('Choose a different expiry date.');
      if (batch.updatedAt?.getTime() !== values.expectedUpdatedAt.getTime()) {
        throw conflict('This batch changed. Refresh and try again.');
      }
      if (!Number.isSafeInteger(batch.remainingQuantity) || batch.remainingQuantity < 0
        || !Number.isSafeInteger(batch.reservedQuantity) || batch.reservedQuantity < 0
        || batch.reservedQuantity > batch.remainingQuantity) {
        throw conflict('This batch needs manual review before its expiry date can be corrected.');
      }

      const activeReservations = await SpecialOrderStockReservation.find({
        product: product._id,
        status: 'Active',
        reservedQuantity: { $gt: 0 },
        'batchAllocations.batch': batch._id,
      }).select('_id reservedQuantity batchAllocations').session(session).lean();
      const reservedByOrders = activeReservations.reduce((sum, reservation) => sum + reservation.batchAllocations
        .filter((allocation) => String(allocation.batch) === String(batch._id))
        .reduce((allocationSum, allocation) => allocationSum + Number(allocation.quantity || 0), 0), 0);
      if (activeReservations.length > 0 || batch.reservedQuantity > 0) {
        if (reservedByOrders !== batch.reservedQuantity) {
          throw conflict('Reservation records need manual review before this expiry date can be corrected.');
        }
        throw conflict('This batch has an active reservation. Resolve it before correcting the expiry date.');
      }

      const matchingBatch = await ExpiryBatch.findOne({
        ...activeBatchFilter(product),
        expiryDate: values.newExpiryDate,
        lotKey: batch.lotKey,
        _id: { $ne: batch._id },
      }).select('_id').session(session).lean();
      if (matchingBatch) {
        throw conflict('This correction needs manual review: another batch already uses this lot number and expiry date.');
      }

      const movements = await ExpiryBatchMovement.find({ batch: batch._id }).select('type expiryDate').session(session).lean();
      const allocationTypes = new Set(['SALE', 'SPECIAL_ORDER_CONSUME', 'SALE_VOID']);
      // Serialize a date correction with product-level inventory/tracking
      // changes. Disabling tracking uses the same product version guard.
      const productVersion = product.updatedAt;
      if (!(productVersion instanceof Date) || !Number.isFinite(productVersion.getTime())) {
        throw conflict('This product needs review. Refresh and try again.');
      }
      const productTouched = await Product.findOneAndUpdate({
        _id: product._id,
        expiryTrackingEnabled: true,
        updatedAt: productVersion,
      }, { $set: { updatedAt: new Date(Math.max(Date.now(), productVersion.getTime() + 1)) } }, {
        session,
        returnDocument: 'after',
        timestamps: false,
      });
      if (!productTouched) throw conflict('This product changed. Refresh and try again.');

      const updatedBatch = await ExpiryBatch.findOneAndUpdate({
        _id: batch._id,
        product: product._id,
        expiryDate: batch.expiryDate,
        updatedAt: values.expectedUpdatedAt,
        reservedQuantity: 0,
      }, { $set: { expiryDate: values.newExpiryDate } }, { session, returnDocument: 'after', runValidators: true });
      if (!updatedBatch) throw conflict('This batch changed. Refresh and try again.');

      const [correction] = await ExpiryBatchCorrection.create([{
        requestId: values.requestId,
        product: product._id,
        sku: product.sku,
        batch: batch._id,
        batchId: batch.batchId,
        batchReference: batch.batchReference || '',
        previousExpiryDate: batch.expiryDate,
        newExpiryDate: values.newExpiryDate,
        reason: values.reason,
        actor: user._id,
        actorName: actorName(user),
        historicalMovementCount: movements.length,
        historicalAllocationCount: movements.filter((movement) => allocationTypes.has(movement.type)).length,
      }], { session });

      [activityLog] = await ActivityLog.create([{
        userRef: user._id,
        user: actorName(user),
        action: 'Corrected Expiry Batch Date',
        details: `${product.sku} batch ${batch.batchReference || batch.batchId}: ${batch.expiryDate} → ${values.newExpiryDate}. Reason: ${values.reason}`,
      }], { session });
      result = { batch: updatedBatch, correction, replayed: false, sku: product.sku };
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.product) {
      throw conflict('This correction needs manual review: another batch already uses this lot number and expiry date.');
    }
    throw error;
  } finally {
    await session.endSession();
  }

  if (!result.replayed) {
    try { publishInventoryUpdated({ reason: 'product.expiry-batch.corrected', productCodes: [result.sku] }); } catch { /* Correction is already committed. */ }
    try { publishActivityLogged({ id: activityLog?._id, action: activityLog?.action, user: activityLog?.user, occurredAt: activityLog?.createdAt }); } catch { /* Correction is already committed. */ }
  }
  return result;
};

module.exports = { correctExpiryBatchDate, validateCorrectionInput };
