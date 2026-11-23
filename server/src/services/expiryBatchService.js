const mongoose = require('mongoose');
const Product = require('../models/Product');
const ExpiryBatch = require('../models/ExpiryBatch');
const ExpiryBatchReceipt = require('../models/ExpiryBatchReceipt');
const ExpiryBatchReconciliation = require('../models/ExpiryBatchReconciliation');
const { inspectBatchState, createMovement, reconcileExpiryBatches } = require('./expiryBatchAllocationService');
const InventoryLog = require('../models/InventoryLog');
const ActivityLog = require('../models/ActivityLog');
const { isValidExpiryDate, isFutureExpiryDate, getManilaBusinessDate } = require('../utils/productExpiry');
const { ensureCounterExists, nextExpiryBatchReference } = require('./expiryBatchReferenceService');
const { batchesToCloseFilter, createExpiryTrackingPeriodId } = require('./expiryBatchLifecycle');
const { publishInventoryUpdated, publishInventoryLogged, publishActivityLogged } = require('./realtimeService');

const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const userName = (user) => user?.displayName || user?.name || user?.username || 'System';
const normalizedLotNumber = (value = '') => String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
const makeLotKey = (lotNumber, requestId, trackingPeriodId = null) => {
  const lotIdentity = lotNumber ? lotNumber.toUpperCase() : `UNLABELLED:${requestId}`;
  // The database's long-standing unique key is product + expiry + lotKey.
  // Scope this internal key by tracking period so the same manufacturer lot
  // can legitimately be received again after a period is closed, without
  // changing the external lot number or requiring a destructive index migration.
  return trackingPeriodId ? `${trackingPeriodId}:${lotIdentity}` : lotIdentity;
};
const makeBatchId = () => `EB-${new mongoose.Types.ObjectId().toString().toUpperCase()}`;

const createBatchReceipt = async ({ product, quantity, expiryDate, lotNumber, requestId, user, session, stockBefore, receivedAt = new Date(), enabledExpiryTracking = false, trackingPeriodId = product.expiryTrackingPeriodId }) => {
  const lotKey = makeLotKey(lotNumber, requestId, trackingPeriodId);
  let batch = await ExpiryBatch.findOne({
    product: product._id, expiryDate, lotKey,
    trackingPeriodClosedAt: null,
    ...(trackingPeriodId ? { trackingPeriodId } : { trackingPeriodId: null }),
  }).session(session);
  if (batch) {
    if (!Number.isSafeInteger(batch.quantityReceived + quantity)
      || !Number.isSafeInteger(batch.remainingQuantity + quantity)) {
      throw invalid('This expiry batch quantity exceeds the supported limit.');
    }
    batch.quantityReceived += quantity;
    batch.remainingQuantity += quantity;
    await batch.save({ session });
  } else {
    [batch] = await ExpiryBatch.create([{
      product: product._id,
      sku: product.sku,
      trackingPeriodId: trackingPeriodId || null,
      batchId: makeBatchId(),
      batchReference: await nextExpiryBatchReference({ createdAt: receivedAt, session }),
      lotNumber,
      lotKey,
      expiryDate,
      quantityReceived: quantity,
      remainingQuantity: quantity,
      receivedAt,
      receivedBy: user?._id || null,
    }], { session });
  }
  const [receipt] = await ExpiryBatchReceipt.create([{
    requestId,
    product: product._id,
    batch: batch._id,
    quantity,
    expiryDate,
    lotNumber,
    enabledExpiryTracking,
    stockBefore,
    stockAfter: stockBefore + quantity,
    receivedAt,
    receivedBy: user?._id || null,
  }], { session });
  return { batch, receipt };
};

const createOpeningExpiryBatch = async ({ product, user, requestId, session, receivedAt }) => {
  if (!product.expiryTrackingEnabled || Number(product.stock) <= 0) return null;
  const snapshot = product.initialStockBatch;
  if (!snapshot || !isFutureExpiryDate(snapshot.expiryDate)) {
    throw invalid('A valid future expiry date is required for the opening stock batch.');
  }
  const lotNumber = normalizedLotNumber(snapshot.lotNumber);
  const receiptResult = await createBatchReceipt({
    product, quantity: Number(product.stock), expiryDate: snapshot.expiryDate,
    lotNumber, requestId: `product-create:${requestId}`, user, session, stockBefore: 0, receivedAt,
    trackingPeriodId: product.expiryTrackingPeriodId,
  });
  const openingMovement = await createMovement({
    product, batch: receiptResult.batch, type: 'STOCK_IN', quantity: Number(product.stock),
    remainingDelta: Number(product.stock), reservedDelta: 0, sourceType: 'StockIn',
    sourceId: receiptResult.receipt._id, requestId: `product-create:${requestId}`,
    operationKey: `opening-stock:${requestId}:${receiptResult.batch._id}`, actor: user,
    reason: 'Initial product stock', session,
  });
  receiptResult.receipt.batchMovementRef = openingMovement._id;
  await receiptResult.receipt.save({ session });
  return receiptResult;
};

const createProductWithOpeningExpiryBatch = async ({ productPayload, user, requestId, session: providedSession = null }) => {
  const batchCreatedAt = new Date();
  if (productPayload.expiryTrackingEnabled && Number(productPayload.stock) > 0) {
    await ensureCounterExists(getManilaBusinessDate(batchCreatedAt));
  }
  const createWithinSession = async (session) => {
    const productPayloadWithPeriod = {
      ...productPayload,
      expiryTrackingPeriodId: productPayload.expiryTrackingEnabled ? createExpiryTrackingPeriodId() : null,
      expiryTrackingPeriodStartedAt: productPayload.expiryTrackingEnabled ? batchCreatedAt : null,
      expiryUnassignedStock: 0,
      expiryBatchReconciled: Boolean(productPayload.expiryTrackingEnabled),
      expiryBatchReconciledAt: productPayload.expiryTrackingEnabled ? new Date() : null,
      expiryBatchReconciledBy: productPayload.expiryTrackingEnabled ? (user?._id || null) : null,
    };
    const [product] = await Product.create([productPayloadWithPeriod], { session });
    await createOpeningExpiryBatch({ product, user, requestId, session, receivedAt: batchCreatedAt });
    return product;
  };

  if (providedSession) return createWithinSession(providedSession);

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => createWithinSession(session));
  } finally {
    await session.endSession();
  }
};

const receiveExpiryBatch = async ({ productId, quantity, expectedStock, expectedUpdatedAt, requestId, expiryDate, lotNumber: rawLotNumber, reason, enableTracking = false, verification = null, user, ipAddress = '', userAgent = '' }) => {
  if (!mongoose.isValidObjectId(productId)) throw invalid('A valid product is required for this stock receipt.');
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(expectedStock) || expectedStock < 0) {
    throw invalid('Stock receipt quantities must be valid whole numbers.');
  }
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 160) {
    throw invalid('A request ID is required for expiry-tracked Stock-In. Refresh and retry.');
  }
  if (enableTracking && (!expectedUpdatedAt || !Number.isFinite(new Date(expectedUpdatedAt).getTime()))) {
    throw conflict('Refresh the product before enabling Expiry Tracking and recording stock.');
  }
  if (!isValidExpiryDate(expiryDate)) throw invalid('Enter a valid expiry date (YYYY-MM-DD).');
  if (enableTracking && !['admin', 'superadmin'].includes(user?.role)) {
    throw Object.assign(new Error('Only an administrator can enable Expiry Tracking.'), { status: 403 });
  }
  if (verification && (!enableTracking || !verification || typeof verification !== 'object' || Array.isArray(verification))) {
    throw invalid('Existing-stock verification is only accepted when enabling Expiry Tracking.');
  }
  if (rawLotNumber !== undefined && typeof rawLotNumber !== 'string') throw invalid('Batch/Lot Number must be text.');
  const lotNumber = normalizedLotNumber(rawLotNumber);
  if (lotNumber.length > 100) throw invalid('Batch/Lot Number cannot exceed 100 characters.');
  const receivedAt = new Date();
  await ensureCounterExists(getManilaBusinessDate(receivedAt));

  const session = await mongoose.startSession();
  let result;
  let reconciliationResult = null;
  let notifications = [];
  try {
    await session.withTransaction(async () => {
      notifications = [];
      reconciliationResult = null;
      const replay = await ExpiryBatchReceipt.findOne({ requestId }).session(session);
      if (replay) {
        const sameRequest = String(replay.product) === String(productId)
          && replay.quantity === quantity && replay.expiryDate === expiryDate && replay.lotNumber === lotNumber
          && Boolean(replay.enabledExpiryTracking) === Boolean(enableTracking);
        if (!sameRequest) throw conflict('This Stock-In request ID was already used for different receipt details.');
        const existingReconciliation = await ExpiryBatchReconciliation.findOne({ requestId }).session(session);
        if (Boolean(existingReconciliation) !== Boolean(verification)) {
          throw conflict('This Stock-In request ID was already used with different batch verification details. Refresh and retry.');
        }
        if (verification) {
          reconciliationResult = await reconcileExpiryBatches({
            ...verification,
            productId,
            requestId,
            user,
            ipAddress,
            userAgent,
            session,
            skipExpectedUpdatedAtCheck: true,
          });
        }
        const currentProduct = await Product.findById(productId).session(session);
        if (!currentProduct) throw conflict('Product no longer exists. Refresh and retry.');
        result = { product: currentProduct, batch: await ExpiryBatch.findById(replay.batch).session(session), replayed: true };
        return;
      }

      const before = await Product.findOne({
        _id: productId,
        ...(enableTracking ? { expiryTrackingEnabled: { $ne: true } } : { expiryTrackingEnabled: true }),
        isActive: { $ne: false },
      }).session(session);
      if (!before) throw conflict('Expiry tracking is unavailable for this product. Refresh and retry.');
      if (before.stock !== expectedStock || (expectedUpdatedAt && before.updatedAt?.getTime() !== new Date(expectedUpdatedAt).getTime())) {
        throw conflict('Product stock changed. Refresh and retry the Stock-In.');
      }
      if (enableTracking && Number(before.stock || 0) > 0 && !verification) {
        throw conflict('Enable Expiry Tracking and verify existing physical stock before recording a new delivery.');
      }
      if (verification && (!enableTracking || before.expiryTrackingEnabled || Number(before.stock || 0) <= 0)) {
        throw conflict('The product or stock changed. Refresh before confirming existing-stock verification.');
      }
      if (!enableTracking && before.expiryTrackingEnabled && !before.expiryBatchReconciled) {
        throw conflict('Verify existing stock before recording a new expiry-tracked delivery.');
      }
      const startNewPeriod = enableTracking || !before.expiryTrackingPeriodId;
      const nextPeriodId = startNewPeriod ? createExpiryTrackingPeriodId() : before.expiryTrackingPeriodId;
      if (startNewPeriod && (!expectedUpdatedAt || before.updatedAt?.getTime() !== new Date(expectedUpdatedAt).getTime())) {
        throw conflict('Product details changed. Refresh before starting expiry tracking for this stock.');
      }
      const enableWithVerifiedEmptyLedger = startNewPeriod
        && Number(before.stock || 0) === 0
        && Number(before.reservedStock || 0) === 0;
      let willBeReconciled = verification ? false : (startNewPeriod ? enableWithVerifiedEmptyLedger : before.expiryBatchReconciled);
      if (!enableTracking && before.expiryBatchReconciled && before.expiryTrackingPeriodId) {
        const state = await inspectBatchState(before, session);
        if (!state.valid) throw conflict('Batch verification is needed before this Stock-In can be recorded. Verify batches in Inventory first.');
      }
      let after;
      if (verification) {
        const legacyBatches = await ExpiryBatch.find(batchesToCloseFilter(before)).session(session);
        const legacyPeriodId = before.expiryTrackingPeriodId || createExpiryTrackingPeriodId();
        for (const legacyBatch of legacyBatches) {
          legacyBatch.trackingPeriodId ||= legacyPeriodId;
          legacyBatch.trackingPeriodClosedAt = receivedAt;
          await legacyBatch.save({ session });
        }
        before.expiryTrackingEnabled = true;
        before.expiryTrackingPeriodId = nextPeriodId;
        before.expiryTrackingPeriodStartedAt = receivedAt;
        before.expiryUnassignedStock = expectedStock;
        before.expiryBatchReconciled = false;
        before.expiryBatchReconciledAt = null;
        before.expiryBatchReconciledBy = null;
        await before.save({ session });
        reconciliationResult = await reconcileExpiryBatches({
          ...verification,
          productId,
          requestId,
          user,
          ipAddress,
          userAgent,
          session,
          // The opening version was checked above before entering this atomic
          // transaction; the product's updatedAt changes as the staged period
          // is initialized inside this same transaction.
          skipExpectedUpdatedAtCheck: true,
        });
        after = await Product.findOneAndUpdate({
          _id: productId,
          isActive: { $ne: false },
          stock: expectedStock,
          expiryTrackingEnabled: true,
          expiryTrackingPeriodId: nextPeriodId,
          expiryBatchReconciled: true,
        }, { $inc: { stock: quantity } }, { session, returnDocument: 'after', runValidators: true });
        if (!after) throw conflict('Verified stock changed before the delivery could be recorded. No changes were saved.');
        willBeReconciled = true;
      } else {
        after = await Product.findOneAndUpdate({
          _id: productId,
          ...(enableTracking ? { expiryTrackingEnabled: { $ne: true } } : { expiryTrackingEnabled: true }),
          isActive: { $ne: false },
          stock: expectedStock,
          ...(enableTracking ? {
            reservedStock: Number(before.reservedStock || 0) === 0 ? { $in: [0, null] } : Number(before.reservedStock),
          } : {}),
          ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}),
        }, {
          $inc: { stock: quantity },
          ...(startNewPeriod ? {
            $set: {
              expiryTrackingEnabled: true,
              expiryTrackingPeriodId: nextPeriodId,
              expiryTrackingPeriodStartedAt: receivedAt,
              expiryUnassignedStock: expectedStock,
              expiryBatchReconciled: enableWithVerifiedEmptyLedger,
              expiryBatchReconciledAt: enableWithVerifiedEmptyLedger ? new Date() : null,
              expiryBatchReconciledBy: enableWithVerifiedEmptyLedger ? (user?._id || null) : null,
            },
          } : {}),
        }, { session, returnDocument: 'after', runValidators: true });
        if (!after) throw conflict('Product stock changed. Refresh and retry the Stock-In.');
        if (startNewPeriod) {
          const legacyBatches = await ExpiryBatch.find(batchesToCloseFilter(before)).session(session);
          const legacyPeriodId = before.expiryTrackingPeriodId || createExpiryTrackingPeriodId();
          for (const legacyBatch of legacyBatches) {
            legacyBatch.trackingPeriodId ||= legacyPeriodId;
            legacyBatch.trackingPeriodClosedAt = receivedAt;
            await legacyBatch.save({ session });
          }
        }
      }
      const { batch, receipt } = await createBatchReceipt({
        product: before, quantity, expiryDate, lotNumber, requestId, user, session, stockBefore: expectedStock, receivedAt,
        enabledExpiryTracking: enableTracking, trackingPeriodId: nextPeriodId,
      });
      const batchMovements = willBeReconciled ? [await createMovement({
        product: before, batch, type: 'STOCK_IN', quantity, remainingDelta: quantity, reservedDelta: 0,
        sourceType: 'StockIn', sourceId: receipt._id, requestId,
        operationKey: `stock-in:${requestId}:${batch._id}`, actor: user, reason, session,
      })] : [];
      if (batchMovements[0]) {
        receipt.batchMovementRef = batchMovements[0]._id;
        await receipt.save({ session });
      }

      const logDetails = `Added ${quantity}${before.sellingUnit ? ` ${before.sellingUnit}` : ''} of ${before.name} — Reason: ${reason}; batch reference ${batch.batchReference} (${expiryDate}${lotNumber ? `, manufacturer lot ${lotNumber}` : ''}).`;
      const [inventoryLog] = await InventoryLog.create([{
        action: 'ADD', code: before.sku, productRef: before._id, userRef: user?._id || null,
        user: userName(user), details: logDetails, quantity, stockBefore: expectedStock,
        stockAfter: after.stock, batchMovementRefs: batchMovements.map((movement) => movement._id),
    }], { session });
      const [activityLog] = await ActivityLog.create([{
        userRef: user?._id || null, user: userName(user), action: enableTracking
          ? 'Enabled Expiry Tracking and Added Stock'
          : startNewPeriod ? 'Started Expiry Tracking Period and Added Stock' : 'Added Expiry-Tracked Stock',
        details: `${before.name} (${before.sku})${startNewPeriod ? ' started an identified Expiry Tracking period and' : ''} received ${quantity} into batch reference ${batch.batchReference}, expires ${expiryDate}${willBeReconciled ? '.' : '; existing stock and receipt quantities require batch verification.'}`,
        ipAddress, userAgent,
      }], { session });
      result = { product: after, batch, receipt, replayed: false };
      if (reconciliationResult?.inventoryLog) {
        notifications.push(() => publishInventoryLogged({ id: reconciliationResult.inventoryLog._id, action: reconciliationResult.inventoryLog.action, code: reconciliationResult.inventoryLog.code, user: reconciliationResult.inventoryLog.user, occurredAt: reconciliationResult.inventoryLog.createdAt }));
      }
      if (reconciliationResult?.activityLog) {
        notifications.push(() => publishActivityLogged({ id: reconciliationResult.activityLog._id, action: reconciliationResult.activityLog.action, user: reconciliationResult.activityLog.user, occurredAt: reconciliationResult.activityLog.createdAt }));
      }
      notifications.push(() => publishInventoryLogged({ id: inventoryLog._id, action: inventoryLog.action, code: inventoryLog.code, user: inventoryLog.user, occurredAt: inventoryLog.createdAt }));
      notifications.push(() => publishActivityLogged({ id: activityLog._id, action: activityLog.action, user: activityLog.user, occurredAt: activityLog.createdAt }));
      notifications.push(() => publishInventoryUpdated({ reason: 'product.stock-in', productCodes: [after.sku] }));
    });
  } finally {
    await session.endSession();
  }
  for (const notify of notifications) {
    try { notify(); } catch (error) { console.warn('[EXPIRY] Post-commit notification failed:', error.message); }
  }
  return result;
};

const verifyExpiryBatchesAndReceiveStock = async ({
  productId,
  expectedStock,
  expectedUnassignedStock,
  expectedUpdatedAt,
  recordedBatchVersions,
  batches,
  requestId,
  enableTracking = false,
  deliveryBatches = [],
  reason = '',
  maxStockLimit = 100,
  user,
  ipAddress = '',
  userAgent = '',
}) => {
  if (!mongoose.isValidObjectId(productId)) throw invalid('Choose a valid product to verify.');
  if (!Number.isSafeInteger(expectedStock) || expectedStock <= 0
    || !Number.isSafeInteger(expectedUnassignedStock) || expectedUnassignedStock <= 0
    || expectedUnassignedStock > expectedStock) {
    throw invalid('Existing stock must be a positive whole quantity before it can be verified.');
  }
  if (!expectedUpdatedAt || !Number.isFinite(new Date(expectedUpdatedAt).getTime())) {
    throw conflict('Refresh product details before verifying batches.');
  }
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 120) {
    throw invalid('A valid request ID is required. Refresh and retry.');
  }
  if (!Array.isArray(batches) || !Array.isArray(recordedBatchVersions)) {
    throw invalid('Existing stock batch details are incomplete. Refresh and retry.');
  }
  if (!Array.isArray(deliveryBatches) || deliveryBatches.length > 100) {
    throw invalid('Enter no more than 100 new delivery batches.');
  }
  if (enableTracking && !['admin', 'superadmin'].includes(user?.role)) {
    throw Object.assign(new Error('Only an administrator can enable Expiry Tracking.'), { status: 403 });
  }
  const normalizedDeliveries = deliveryBatches.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid('New delivery batch details are invalid.');
    const expiryDate = String(row.expiryDate || '').trim();
    const quantity = Number(row.quantity);
    const lotNumber = normalizedLotNumber(row.lotNumber);
    if (!isValidExpiryDate(expiryDate) || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw invalid('Each new delivery batch needs a valid expiry date and positive whole quantity.');
    }
    if (lotNumber.length > 100) throw invalid('Batch/Lot Number cannot exceed 100 characters.');
    return { expiryDate, quantity, lotNumber };
  });
  const deliveryTotal = normalizedDeliveries.reduce((sum, row) => sum + row.quantity, 0);
  if (!Number.isSafeInteger(deliveryTotal)) throw invalid('New delivery quantity exceeds the supported limit.');
  const deliveryReason = normalizedDeliveries.length ? String(reason || '').trim() : '';
  if (normalizedDeliveries.length && !deliveryReason) throw invalid('A reason is required for the new stock delivery.');
  if (!Number.isSafeInteger(maxStockLimit) || maxStockLimit < 1
    || expectedStock + deliveryTotal > maxStockLimit) {
    throw invalid(`Stock cannot exceed the configured maximum of ${maxStockLimit}.`);
  }

  const receivedAt = new Date();
  const verificationRequestId = `${requestId.trim()}:verify`;
  if (verificationRequestId.length > 160
    || normalizedDeliveries.some((_, index) => `${requestId.trim()}:delivery:${index + 1}`.length > 160)) {
    throw invalid('The request ID is too long. Refresh and retry.');
  }
  // The reconciliation service also allocates references for physical opening
  // batches. Prepare the date counter before starting this transaction so its
  // snapshot can see the row even when the verification has no delivery.
  if (normalizedDeliveries.length || batches.some((row) => Number(row?.quantity) > 0)) {
    await ensureCounterExists(getManilaBusinessDate(receivedAt));
  }

  const idempotencyContext = {
    operation: 'verify-expiry-stock-in',
    enableTracking: Boolean(enableTracking),
    deliveryBatches: normalizedDeliveries,
    reason: deliveryReason,
  };
  const session = await mongoose.startSession();
  let result;
  let notifications = [];
  try {
    await session.withTransaction(async () => {
      notifications = [];
      const existingReconciliation = await ExpiryBatchReconciliation.findOne({ requestId: verificationRequestId }).session(session);
      const verification = {
        productId,
        expectedStock,
        expectedUnassignedStock,
        expectedUpdatedAt,
        recordedBatchVersions,
        requestId: verificationRequestId,
        batches,
        idempotencyContext,
        user,
        ipAddress,
        userAgent,
        session,
      };

      if (!existingReconciliation) {
        const before = await Product.findOne({ _id: productId, isActive: { $ne: false } }).session(session);
        if (!before) throw conflict('Product no longer exists or is inactive. Refresh and retry.');
        if (Number(before.stock || 0) !== expectedStock
          || before.updatedAt?.getTime() !== new Date(expectedUpdatedAt).getTime()) {
          throw conflict('Product stock changed. Refresh and verify the physical quantities again.');
        }
        if (enableTracking) {
          if (before.expiryTrackingEnabled) throw conflict('Expiry Tracking is already enabled. Refresh the product before continuing.');
          const legacyBatches = await ExpiryBatch.find(batchesToCloseFilter(before)).session(session);
          const legacyPeriodId = before.expiryTrackingPeriodId || createExpiryTrackingPeriodId();
          for (const legacyBatch of legacyBatches) {
            legacyBatch.trackingPeriodId ||= legacyPeriodId;
            legacyBatch.trackingPeriodClosedAt = receivedAt;
            await legacyBatch.save({ session });
          }
          before.expiryTrackingEnabled = true;
          before.expiryTrackingPeriodId = createExpiryTrackingPeriodId();
          before.expiryTrackingPeriodStartedAt = receivedAt;
          before.expiryUnassignedStock = expectedStock;
          before.expiryBatchReconciled = false;
          before.expiryBatchReconciledAt = null;
          before.expiryBatchReconciledBy = null;
          await before.save({ session });
          verification.skipExpectedUpdatedAtCheck = true;
        } else if (!before.expiryTrackingEnabled || before.expiryBatchReconciled) {
          throw conflict('This product no longer needs existing-stock verification. Refresh and continue from Add Stock.');
        }
        if (Number(before.expiryUnassignedStock ?? expectedStock) !== expectedUnassignedStock
          && !enableTracking) {
          throw conflict('Existing stock changed. Refresh and verify the current unassigned quantity.');
        }
      }

      const reconciliationResult = await reconcileExpiryBatches(verification);
      if (existingReconciliation || reconciliationResult.replayed) {
        const receipts = normalizedDeliveries.length
          ? await ExpiryBatchReceipt.find({ requestId: { $in: normalizedDeliveries.map((_, index) => `${requestId.trim()}:delivery:${index + 1}`) } }).session(session).lean()
          : [];
        if (receipts.length !== normalizedDeliveries.length) {
          throw conflict('This verification request was already submitted with different delivery details. Refresh and retry.');
        }
        const receiptsByRequest = new Map(receipts.map((receipt) => [receipt.requestId, receipt]));
        normalizedDeliveries.forEach((delivery, index) => {
          const receipt = receiptsByRequest.get(`${requestId.trim()}:delivery:${index + 1}`);
          if (!receipt || String(receipt.product) !== String(productId)
            || receipt.quantity !== delivery.quantity || receipt.expiryDate !== delivery.expiryDate
            || receipt.lotNumber !== delivery.lotNumber || Boolean(receipt.enabledExpiryTracking) !== Boolean(enableTracking)) {
            throw conflict('This verification request was already submitted with different delivery details. Refresh and retry.');
          }
        });
        const currentProduct = await Product.findById(productId).session(session);
        if (!currentProduct) throw conflict('Product no longer exists. Refresh and retry.');
        result = { product: currentProduct, replayed: true, deliveryTotal };
        return;
      }

      let after = await Product.findOne({
        _id: productId,
        isActive: { $ne: false },
        expiryTrackingEnabled: true,
        expiryBatchReconciled: true,
        expiryTrackingPeriodId: reconciliationResult.product.expiryTrackingPeriodId,
        expiryUnassignedStock: 0,
        stock: expectedStock,
      }).session(session);
      if (!after) throw conflict('Verified stock changed before the delivery could be recorded. No changes were saved.');
      if (deliveryTotal > 0) {
        after = await Product.findOneAndUpdate({
          _id: after._id,
          isActive: { $ne: false },
          expiryTrackingEnabled: true,
          expiryBatchReconciled: true,
          expiryTrackingPeriodId: after.expiryTrackingPeriodId,
          expiryUnassignedStock: 0,
          stock: expectedStock,
        }, { $inc: { stock: deliveryTotal } }, { session, returnDocument: 'after', runValidators: true });
        if (!after) throw conflict('Verified stock changed before the delivery could be recorded. No changes were saved.');
      }

      const movements = [];
      let stockBefore = expectedStock;
      for (const [index, delivery] of normalizedDeliveries.entries()) {
        const childRequestId = `${requestId.trim()}:delivery:${index + 1}`;
        const { batch, receipt } = await createBatchReceipt({
          product: after,
          quantity: delivery.quantity,
          expiryDate: delivery.expiryDate,
          lotNumber: delivery.lotNumber,
          requestId: childRequestId,
          user,
          session,
          stockBefore,
          receivedAt,
          enabledExpiryTracking: Boolean(enableTracking),
          trackingPeriodId: after.expiryTrackingPeriodId,
        });
        const movement = await createMovement({
          product: after,
          batch,
          type: 'STOCK_IN',
          quantity: delivery.quantity,
          remainingDelta: delivery.quantity,
          reservedDelta: 0,
          sourceType: 'StockIn',
          sourceId: receipt._id,
          requestId: childRequestId,
          operationKey: `stock-in:${childRequestId}:${batch._id}`,
          actor: user,
          reason: deliveryReason,
          session,
        });
        receipt.batchMovementRef = movement._id;
        await receipt.save({ session });
        movements.push(movement);
        stockBefore += delivery.quantity;
      }

      let inventoryLog = null;
      let activityLog = null;
      if (deliveryTotal > 0) {
        const details = `Added ${deliveryTotal}${after.sellingUnit ? ` ${after.sellingUnit}` : ''} of ${after.name} — Reason: ${deliveryReason}; recorded ${normalizedDeliveries.length} expiry batch(es).`;
        [inventoryLog] = await InventoryLog.create([{
          action: 'ADD', code: after.sku, productRef: after._id, userRef: user?._id || null,
          user: userName(user), details, quantity: deliveryTotal, stockBefore: expectedStock,
          stockAfter: after.stock, batchMovementRefs: movements.map((movement) => movement._id),
        }], { session });
        [activityLog] = await ActivityLog.create([{
          userRef: user?._id || null,
          user: userName(user),
          action: enableTracking ? 'Enabled Expiry Tracking and Added Stock' : 'Verified Expiry Batches and Added Stock',
          details: `${after.name} (${after.sku}) received ${deliveryTotal} ${after.sellingUnit || 'unit'} in ${normalizedDeliveries.length} expiry batch(es); reason: ${deliveryReason}.`,
          ipAddress,
          userAgent,
        }], { session });
      }

      notifications.push(() => publishInventoryLogged({ id: reconciliationResult.inventoryLog?._id, action: reconciliationResult.inventoryLog?.action, code: reconciliationResult.inventoryLog?.code, user: reconciliationResult.inventoryLog?.user, occurredAt: reconciliationResult.inventoryLog?.createdAt }));
      notifications.push(() => publishActivityLogged({ id: reconciliationResult.activityLog?._id, action: reconciliationResult.activityLog?.action, user: reconciliationResult.activityLog?.user, occurredAt: reconciliationResult.activityLog?.createdAt }));
      if (inventoryLog) notifications.push(() => publishInventoryLogged({ id: inventoryLog._id, action: inventoryLog.action, code: inventoryLog.code, user: inventoryLog.user, occurredAt: inventoryLog.createdAt }));
      if (activityLog) notifications.push(() => publishActivityLogged({ id: activityLog._id, action: activityLog.action, user: activityLog.user, occurredAt: activityLog.createdAt }));
      notifications.push(() => publishInventoryUpdated({ reason: 'product.expiry-batches.verified-stock-in', productCodes: [after.sku] }));
      result = { product: after, replayed: false, deliveryTotal };
    });
  } finally {
    await session.endSession();
  }
  for (const notify of notifications) {
    try { notify(); } catch (error) { console.warn('[EXPIRY] Post-commit notification failed:', error.message); }
  }
  return result;
};

module.exports = { createProductWithOpeningExpiryBatch, receiveExpiryBatch, verifyExpiryBatchesAndReceiveStock };
