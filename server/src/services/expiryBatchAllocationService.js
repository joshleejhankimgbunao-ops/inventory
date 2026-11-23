const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const ExpiryBatch = require('../models/ExpiryBatch');
const ExpiryBatchReceipt = require('../models/ExpiryBatchReceipt');
const ExpiryBatchMovement = require('../models/ExpiryBatchMovement');
const ExpiryBatchReconciliation = require('../models/ExpiryBatchReconciliation');
const Reservation = require('../models/SpecialOrderStockReservation');
const InventoryLog = require('../models/InventoryLog');
const ActivityLog = require('../models/ActivityLog');
const { isValidExpiryDate, getManilaBusinessDate } = require('../utils/productExpiry');
const { ensureCounterExists, nextExpiryBatchReference } = require('./expiryBatchReferenceService');
const { activeBatchFilter, batchesToCloseFilter, createExpiryTrackingPeriodId } = require('./expiryBatchLifecycle');

const fail = (status, message) => Object.assign(new Error(message), { status });
const conflict = (message) => fail(409, message);
const invalid = (message) => fail(400, message);
const asId = (value) => String(value?._id || value || '');
const normalizeLot = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const lotIdentity = (value) => normalizeLot(value).toLocaleUpperCase('en-US');
const makeBatchId = () => `EB-${new mongoose.Types.ObjectId().toString().toUpperCase()}`;

const batchRows = async (product, session) => {
  const query = ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 });
  return session ? query.session(session) : query;
};

const inspectBatchState = async (product, session) => {
  const batches = await batchRows(product, session);
  const remaining = batches.reduce((sum, batch) => sum + Number(batch.remainingQuantity || 0), 0);
  const reserved = batches.reduce((sum, batch) => sum + Number(batch.reservedQuantity || 0), 0);
  const productStock = Number(product.stock || 0);
  const productReserved = Number(product.reservedStock || 0);
  const validNumbers = batches.every((batch) => Number.isSafeInteger(batch.remainingQuantity)
    && batch.remainingQuantity >= 0 && Number.isSafeInteger(batch.reservedQuantity)
    && batch.reservedQuantity >= 0 && batch.reservedQuantity <= batch.remainingQuantity);
  return {
    batches,
    remaining,
    reserved,
    valid: validNumbers && Number.isSafeInteger(productStock) && Number.isSafeInteger(productReserved)
      && remaining === productStock && reserved === productReserved,
  };
};

const getExpiryBatchAvailability = async (product, session = null, now = new Date()) => {
  if (!product?.expiryTrackingEnabled) return { tracked: false, reconciled: false, valid: true, availableToSell: null };
  if (!product.expiryTrackingPeriodId) return { tracked: true, reconciled: false, valid: false, availableToSell: 0, legacyPeriodReviewRequired: true };
  if (!product.expiryBatchReconciled) return { tracked: true, reconciled: false, valid: false, availableToSell: 0 };
  const state = await inspectBatchState(product, session);
  if (!state.valid) return { tracked: true, reconciled: true, valid: false, availableToSell: 0 };
  const today = getManilaBusinessDate(now);
  const availableToSell = state.batches.reduce((sum, batch) => batch.expiryDate > today
    ? sum + batch.remainingQuantity - batch.reservedQuantity : sum, 0);
  return { tracked: true, reconciled: true, valid: true, availableToSell, ...state };
};

const createMovement = async ({ product, batch, type, quantity, remainingDelta, reservedDelta, sourceType, sourceId, requestId, operationKey, actor, unit, reason, session }) => {
  const operation = String(operationKey || '');
  const safeOperationKey = operation.length <= 220
    ? operation
    : `expiry:${crypto.createHash('sha256').update(operation).digest('hex')}`;
  const [movement] = await ExpiryBatchMovement.create([{
    operationKey: safeOperationKey,
    requestId: String(requestId || '').slice(0, 160),
    product: product._id,
    sku: product.sku,
    batch: batch._id,
    batchId: batch.batchId,
    expiryDate: batch.expiryDate,
    type,
    quantity: Math.abs(quantity),
    remainingDelta,
    reservedDelta,
    sourceType,
    sourceId: sourceId || null,
    unit: unit || product.sellingUnit || '',
    reason: reason || '',
    actor: actor?._id || actor || null,
  }], { session });
  return movement;
};

const selectAllocations = (batches, quantity, { allowExpired = false, now = new Date(), reservedOnly = false } = {}) => {
  let remaining = quantity;
  const today = getManilaBusinessDate(now);
  const allocations = [];
  for (const batch of batches) {
    if (!allowExpired && batch.expiryDate <= today) continue;
    const quantityAvailable = reservedOnly
      ? Math.min(batch.remainingQuantity, batch.reservedQuantity)
      : batch.remainingQuantity - batch.reservedQuantity;
    if (quantityAvailable <= 0) continue;
    const assigned = Math.min(quantityAvailable, remaining);
    if (assigned > 0) allocations.push({ batch, quantity: assigned });
    remaining -= assigned;
    if (remaining === 0) break;
  }
  return remaining === 0 ? allocations : null;
};

const normalizeBatchAllocations = (allocations) => {
  if (!Array.isArray(allocations)) return null;
  const normalized = [];
  const seen = new Set();
  for (const allocation of allocations) {
    const batch = String(allocation?.batch || allocation?._id || '').trim();
    const quantity = Number(allocation?.quantity);
    if (!mongoose.isValidObjectId(batch) || !Number.isSafeInteger(quantity) || quantity < 1 || seen.has(batch)) return null;
    seen.add(batch);
    normalized.push({
      batch,
      ...(allocation?.batchId ? { batchId: String(allocation.batchId) } : {}),
      ...(allocation?.expiryDate ? { expiryDate: String(allocation.expiryDate) } : {}),
      quantity,
    });
  }
  return normalized;
};

const normalizeSelectedStockOutAllocations = (allocations) => {
  if (!Array.isArray(allocations) || allocations.length === 0) return null;
  const seen = new Set();
  const normalized = [];
  for (const allocation of allocations) {
    const batch = String(allocation?.batch || '').trim();
    const quantity = Number(allocation?.quantity);
    const batchId = String(allocation?.batchId || '').trim();
    const expiryDate = String(allocation?.expiryDate || '').trim();
    const updatedAt = new Date(allocation?.updatedAt);
    if (!mongoose.isValidObjectId(batch) || seen.has(batch)
      || !Number.isSafeInteger(quantity) || quantity < 1
      || !batchId || !isValidExpiryDate(expiryDate)
      || !Number.isFinite(updatedAt.getTime())) return null;
    seen.add(batch);
    normalized.push({ batch, batchId, expiryDate, updatedAt, quantity });
  }
  return normalized;
};

const batchAllocationSignature = (allocations) => (allocations || [])
  .map((allocation) => `${String(allocation.batch)}:${Number(allocation.quantity)}`)
  .sort()
  .join('|');

const validateBatchVerification = ({ quantity, proposedAllocations, verifiedAllocations, reason = '' }) => {
  const proposed = normalizeBatchAllocations(proposedAllocations);
  const verified = normalizeBatchAllocations(verifiedAllocations);
  if (!proposed || !verified || proposed.reduce((sum, row) => sum + row.quantity, 0) !== quantity
    || verified.reduce((sum, row) => sum + row.quantity, 0) !== quantity) {
    throw invalid('Confirm batch quantities that add up to the order quantity.');
  }
  const overridden = batchAllocationSignature(proposed) !== batchAllocationSignature(verified);
  const overrideReason = String(reason || '').trim();
  if (overridden && !overrideReason) throw invalid('Enter a reason when choosing a different physical batch.');
  if (overrideReason.length > 500) throw invalid('Batch verification reason must be 500 characters or fewer.');
  return { proposed, verified, overridden, overrideReason };
};

const allocateVerifiedBatches = async ({ product, quantity, proposedAllocations, verifiedAllocations, reason = '', session, type = 'SALE', sourceType = 'Sale', sourceId, requestId, operationKeyPrefix, actor, now = new Date() }) => {
  if (!product?.expiryTrackingEnabled || !product.expiryBatchReconciled) {
    throw conflict(`Batch verification is needed for ${product?.sku || 'this product'}. Verify batches in Inventory before continuing.`);
  }
  const verification = validateBatchVerification({ quantity, proposedAllocations, verifiedAllocations, reason });
  const state = await inspectBatchState(product, session);
  if (!state.valid) throw conflict(`Expiry batches for ${product.sku} changed. Refresh and confirm the batch picks again.`);
  const currentProposal = selectAllocations(state.batches, quantity, { allowExpired: false, now });
  const currentProposalRows = (currentProposal || []).map(({ batch, quantity: assigned }) => ({ batch: batch._id, quantity: assigned }));
  if (!currentProposal || batchAllocationSignature(currentProposalRows) !== batchAllocationSignature(verification.proposed)) {
    throw conflict('Batch availability changed. Return to the Order List, refresh, and confirm the batch picks again.');
  }
  const today = getManilaBusinessDate(now);
  const batchById = new Map(state.batches.map((batch) => [String(batch._id), batch]));
  const movements = [];
  const verified = [];
  for (const allocation of verification.verified) {
    const batch = batchById.get(allocation.batch);
    if (!batch || (allocation.batchId && allocation.batchId !== batch.batchId)
      || (allocation.expiryDate && allocation.expiryDate !== batch.expiryDate)
      || batch.expiryDate <= today) {
      throw conflict('A selected batch is unavailable or expired. Refresh and confirm the batch picks again.');
    }
    const updated = await ExpiryBatch.findOneAndUpdate({
      _id: batch._id,
      product: product._id,
      expiryDate: { $gt: today },
      remainingQuantity: { $gte: allocation.quantity },
      $expr: { $gte: [{ $subtract: ['$remainingQuantity', '$reservedQuantity'] }, allocation.quantity] },
    }, { $inc: { remainingQuantity: -allocation.quantity } }, { session, returnDocument: 'after' });
    if (!updated) throw conflict('A selected batch changed. Return to the Order List, refresh, and confirm the batch picks again.');
    movements.push(await createMovement({
      product, batch: updated, type, quantity: allocation.quantity,
      remainingDelta: -allocation.quantity, reservedDelta: 0, sourceType, sourceId, requestId,
      operationKey: `${operationKeyPrefix}:${batch._id}`, actor,
      reason: verification.overridden
        ? `Physical batch override: ${verification.overrideReason}`
        : 'Physical batch verified before sale', session,
    }));
    verified.push({ batch: updated._id, batchId: updated.batchId, expiryDate: updated.expiryDate, quantity: allocation.quantity });
  }
  return {
    allocations: verified,
    movements,
    audit: {
      proposedAllocations: currentProposal.map(({ batch, quantity: assigned }) => ({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: assigned })),
      verifiedAllocations: verified,
      overridden: verification.overridden,
      overrideReason: verification.overrideReason,
      verifiedAt: now,
      verifiedBy: actor?._id || actor || null,
    },
  };
};

const replaceReservedBatchesWithVerified = async ({ product, currentAllocations, quantity, proposedAllocations, verifiedAllocations, reason = '', session, orderId, requestId, operationKeyPrefix, actor, now = new Date() }) => {
  if (!product?.expiryTrackingEnabled || !product.expiryBatchReconciled) {
    throw conflict(`Batch verification is needed for ${product?.sku || 'this product'}. Verify batches in Inventory before continuing.`);
  }
  const verification = validateBatchVerification({ quantity, proposedAllocations, verifiedAllocations, reason });
  const current = normalizeBatchAllocations(currentAllocations);
  if (!current || current.reduce((sum, row) => sum + row.quantity, 0) !== quantity) {
    throw conflict(`Exact reserved batches for ${product.sku} need review before completion.`);
  }
  const state = await inspectBatchState(product, session);
  if (!state.valid) throw conflict(`Expiry batches for ${product.sku} changed. Refresh and confirm the batch picks again.`);
  const today = getManilaBusinessDate(now);
  const batchById = new Map(state.batches.map((batch) => [String(batch._id), batch]));
  const capacityById = new Map();
  for (const batch of state.batches) {
    const heldByOrder = current.find((row) => row.batch === String(batch._id))?.quantity || 0;
    capacityById.set(String(batch._id), Math.max(0, batch.remainingQuantity - batch.reservedQuantity + heldByOrder));
  }
  const desiredById = new Map(verification.verified.map((row) => [row.batch, row.quantity]));
  for (const allocation of verification.verified) {
    const batch = batchById.get(allocation.batch);
    if (!batch || batch.expiryDate <= today || (allocation.batchId && allocation.batchId !== batch.batchId)
      || (allocation.expiryDate && allocation.expiryDate !== batch.expiryDate)
      || allocation.quantity > (capacityById.get(allocation.batch) || 0)) {
      throw conflict('A selected batch is unavailable or expired. Refresh stock and confirm the batch picks again.');
    }
  }
  const currentById = new Map(current.map((row) => [row.batch, row.quantity]));
  const batchIds = new Set([...currentById.keys(), ...desiredById.keys()]);
  const actualAllocations = [];
  for (const batchId of batchIds) {
    const batch = batchById.get(batchId);
    if (!batch) throw conflict(`A reserved batch for ${product.sku} is missing. Refresh and review the order.`);
    const delta = (desiredById.get(batchId) || 0) - (currentById.get(batchId) || 0);
    if (!delta) {
      const row = verification.verified.find((allocation) => allocation.batch === batchId);
      if (row) actualAllocations.push({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: row.quantity });
      continue;
    }
    const query = { _id: batch._id, product: product._id };
    if (delta > 0) {
      query.expiryDate = { $gt: today };
      query.$expr = { $gte: [{ $subtract: ['$remainingQuantity', '$reservedQuantity'] }, delta] };
    } else query.reservedQuantity = { $gte: -delta };
    const updated = await ExpiryBatch.findOneAndUpdate(query, { $inc: { reservedQuantity: delta } }, { session, returnDocument: 'after' });
    if (!updated || updated.reservedQuantity > updated.remainingQuantity) {
      throw conflict('A selected batch changed. Refresh stock and confirm the batch picks again.');
    }
    await createMovement({
      product, batch: updated,
      type: delta > 0 ? 'SPECIAL_ORDER_RESERVE' : 'SPECIAL_ORDER_RELEASE',
      quantity: Math.abs(delta), remainingDelta: 0, reservedDelta: delta,
      sourceType: 'SpecialOrder', sourceId: orderId, requestId,
      operationKey: `${operationKeyPrefix}:${delta > 0 ? 'reserve' : 'release'}:${batch._id}`,
      actor, reason: `Physical batch verification${verification.overridden ? ` override: ${verification.overrideReason}` : ''}`, session,
    });
    const row = verification.verified.find((allocation) => allocation.batch === batchId);
    if (row) actualAllocations.push({ batch: updated._id, batchId: updated.batchId, expiryDate: updated.expiryDate, quantity: row.quantity });
  }
  return {
    allocations: actualAllocations,
    audit: {
      proposedAllocations: verification.proposed.map((row) => ({ ...row, batchId: batchById.get(row.batch)?.batchId || row.batchId || '', expiryDate: batchById.get(row.batch)?.expiryDate || row.expiryDate || '' })),
      verifiedAllocations: actualAllocations,
      overridden: verification.overridden,
      overrideReason: verification.overrideReason,
      verifiedAt: now,
      verifiedBy: actor?._id || actor || null,
    },
  };
};

const allocateUnreservedBatches = async ({ product, quantity, session, type, sourceType, sourceId, requestId, operationKeyPrefix, actor, reason = '', allowExpired = false, now = new Date() }) => {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw invalid('Batch movement quantity must be a positive whole number.');
  if (!product.expiryTrackingEnabled || !product.expiryBatchReconciled) return null;
  const state = await inspectBatchState(product, session);
  if (!state.valid) throw conflict(`Batch verification is needed for ${product.sku}. Verify batches in Inventory before moving stock.`);
  const allocations = selectAllocations(state.batches, quantity, { allowExpired, now });
  if (!allocations) throw conflict(`Insufficient unexpired, unreserved batch stock for ${product.sku}.`);
  const movements = [];
  for (const allocation of allocations) {
    const { batch, quantity: assigned } = allocation;
    const updated = await ExpiryBatch.findOneAndUpdate({
      _id: batch._id,
      remainingQuantity: { $gte: assigned },
      $expr: { $gte: [{ $subtract: ['$remainingQuantity', '$reservedQuantity'] }, assigned] },
    }, { $inc: { remainingQuantity: -assigned } }, { session, returnDocument: 'after' });
    if (!updated) throw conflict(`Batch ${batch.batchReference || 'availability'} changed. Refresh and retry the stock movement.`);
    movements.push(await createMovement({
      product, batch: updated, type, quantity: assigned, remainingDelta: -assigned, reservedDelta: 0,
      sourceType, sourceId, requestId, operationKey: `${operationKeyPrefix}:${batch._id}`,
      actor, reason, session,
    }));
  }
  return { allocations: allocations.map(({ batch, quantity: assigned }) => ({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: assigned })), movements };
};

const allocateSelectedUnreservedBatches = async ({ product, quantity, allocations, session, type = 'STOCK_OUT', sourceType = 'StockOut', sourceId, requestId, operationKeyPrefix, actor, reason = '' }) => {
  if (!product?.expiryTrackingEnabled || !product.expiryBatchReconciled || !product.expiryTrackingPeriodId) {
    throw conflict(`Batch verification is needed for ${product?.sku || 'this product'}. Verify batches in Inventory first.`);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Array.isArray(allocations) || allocations.length === 0) {
    throw invalid('Select one or more batches and enter a valid removal quantity.');
  }
  const normalized = normalizeSelectedStockOutAllocations(allocations);
  if (!normalized) throw invalid('Select valid batch quantities from the current batch list.');
  if (normalized.reduce((sum, allocation) => sum + allocation.quantity, 0) !== quantity) {
    throw invalid('Selected batch quantities must equal the removal quantity.');
  }

  const state = await inspectBatchState(product, session);
  if (!state.valid) throw conflict(`Batch verification is needed for ${product.sku}. Verify batches in Inventory first.`);
  const activeBatchesById = new Map(state.batches.map((batch) => [String(batch._id), batch]));
  const movements = [];
  const confirmedAllocations = [];
  for (const allocation of normalized) {
    const batch = activeBatchesById.get(allocation.batch);
    if (!batch || batch.trackingPeriodClosedAt
      || String(batch.trackingPeriodId || '') !== String(product.expiryTrackingPeriodId)
      || batch.batchId !== allocation.batchId
      || batch.expiryDate !== allocation.expiryDate
      || batch.updatedAt?.getTime() !== allocation.updatedAt.getTime()) {
      throw conflict('A selected batch changed. Refresh and review the batch list before removing stock.');
    }
    const available = Math.max(0, Number(batch.remainingQuantity || 0) - Number(batch.reservedQuantity || 0));
    if (allocation.quantity > available) {
      throw conflict(`Only ${available} unreserved ${product.sellingUnit || 'unit'} are available in ${batch.batchReference || batch.batchId}.`);
    }
    const updated = await ExpiryBatch.findOneAndUpdate({
      _id: batch._id,
      product: product._id,
      trackingPeriodId: product.expiryTrackingPeriodId,
      trackingPeriodClosedAt: null,
      batchId: allocation.batchId,
      expiryDate: allocation.expiryDate,
      updatedAt: allocation.updatedAt,
      remainingQuantity: { $gte: allocation.quantity },
      $expr: { $gte: [{ $subtract: ['$remainingQuantity', '$reservedQuantity'] }, allocation.quantity] },
    }, { $inc: { remainingQuantity: -allocation.quantity } }, { session, returnDocument: 'after' });
    if (!updated) throw conflict('A selected batch changed or became reserved. Refresh and review the batch list before removing stock.');
    movements.push(await createMovement({
      product, batch: updated, type, quantity: allocation.quantity,
      remainingDelta: -allocation.quantity, reservedDelta: 0, sourceType, sourceId, requestId,
      operationKey: `${operationKeyPrefix}:${batch._id}`, actor, reason, session,
    }));
    confirmedAllocations.push({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: allocation.quantity });
  }
  return { allocations: confirmedAllocations, movements };
};

const reserveExpiryBatches = async ({ product, quantity, session, orderId, requestId, operationKeyPrefix, actor }) => {
  if (!product.expiryTrackingEnabled || !product.expiryBatchReconciled) return null;
  const state = await inspectBatchState(product, session);
  if (!state.valid) throw conflict(`Batch verification is needed for ${product.sku}. Verify batches in Inventory before reserving stock.`);
  const allocations = selectAllocations(state.batches, quantity, { allowExpired: false });
  if (!allocations) throw conflict(`Insufficient unexpired batch stock to reserve ${product.sku}.`);
  const movements = [];
  for (const { batch, quantity: assigned } of allocations) {
    const updated = await ExpiryBatch.findOneAndUpdate({
      _id: batch._id,
      $expr: { $gte: [{ $subtract: ['$remainingQuantity', '$reservedQuantity'] }, assigned] },
    }, { $inc: { reservedQuantity: assigned } }, { session, returnDocument: 'after' });
    if (!updated) throw conflict(`Batch ${batch.batchReference || 'availability'} changed. Refresh and retry the reservation.`);
    movements.push(await createMovement({
      product, batch: updated, type: 'SPECIAL_ORDER_RESERVE', quantity: assigned,
      remainingDelta: 0, reservedDelta: assigned, sourceType: 'SpecialOrder', sourceId: orderId,
      requestId, operationKey: `${operationKeyPrefix}:${batch._id}`, actor, session,
    }));
  }
  return { allocations: allocations.map(({ batch, quantity: assigned }) => ({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity: assigned })), movements };
};

const changeReservedBatches = async ({ product, allocations, session, orderId, requestId, operationKeyPrefix, actor, action }) => {
  if (!product.expiryTrackingEnabled || !product.expiryBatchReconciled) return null;
  if (!Array.isArray(allocations) || allocations.reduce((sum, item) => sum + Number(item.quantity || 0), 0) < 1) {
    throw conflict(`Batch reservation details for ${product.sku} are missing. Verify stock in Inventory before continuing.`);
  }
  const movements = [];
  const result = [];
  for (const allocation of allocations) {
    const quantity = Number(allocation.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw conflict('A reserved batch allocation is invalid.');
    const query = { _id: allocation.batch, product: product._id };
    if (action === 'release') query.reservedQuantity = { $gte: quantity };
    const updated = await ExpiryBatch.findOneAndUpdate(query, {
      $inc: { reservedQuantity: action === 'release' ? -quantity : quantity },
    }, { session, returnDocument: 'after' });
    if (!updated || updated.reservedQuantity > updated.remainingQuantity) throw conflict(`Batch reservation for ${product.sku} changed. Refresh and retry.`);
    const reservedDelta = action === 'release' ? -quantity : quantity;
    movements.push(await createMovement({
      product, batch: updated,
      type: action === 'release' ? 'SPECIAL_ORDER_RELEASE' : 'SPECIAL_ORDER_RESERVE',
      quantity, remainingDelta: 0, reservedDelta, sourceType: 'SpecialOrder', sourceId: orderId,
      requestId, operationKey: `${operationKeyPrefix}:${updated._id}`, actor, session,
    }));
    result.push({ ...allocation.toObject?.() || allocation, quantity });
  }
  return { allocations: result, movements };
};

const consumeReservedExpiryBatches = async ({ product, allocations, quantity, session, saleId, orderId, requestId, operationKeyPrefix, actor, now = new Date() }) => {
  if (!product.expiryTrackingEnabled || !product.expiryBatchReconciled) return null;
  if (!Array.isArray(allocations) || allocations.reduce((sum, item) => sum + Number(item.quantity || 0), 0) !== quantity) {
    throw conflict(`Exact reserved batches for ${product.sku} do not match the order quantity.`);
  }
  const state = await inspectBatchState(product, session);
  if (!state.valid) throw conflict(`Batch verification is needed for ${product.sku}. Verify batches in Inventory before completing this order.`);
  const today = getManilaBusinessDate(now);
  const movements = [];
  for (const allocation of allocations) {
    if (String(allocation.expiryDate || '') <= today) {
      throw conflict(`Reserved batch ${allocation.batchReference || 'availability'} has expired and cannot be sold. Release the reservation and review the order.`);
    }
    const assigned = Number(allocation.quantity);
    const updated = await ExpiryBatch.findOneAndUpdate({
      _id: allocation.batch, product: product._id,
      remainingQuantity: { $gte: assigned }, reservedQuantity: { $gte: assigned },
    }, { $inc: { remainingQuantity: -assigned, reservedQuantity: -assigned } }, { session, returnDocument: 'after' });
    if (!updated) throw conflict(`Reserved batch ${allocation.batchReference || 'availability'} changed. Refresh and retry completion.`);
    movements.push(await createMovement({
      product, batch: updated, type: 'SPECIAL_ORDER_CONSUME', quantity: assigned,
      remainingDelta: -assigned, reservedDelta: -assigned, sourceType: 'Sale', sourceId: saleId,
      requestId, operationKey: `${operationKeyPrefix}:${allocation.batch}`, actor,
      reason: `Special Order ${asId(orderId)}`, session,
    }));
  }
  return { movements };
};

const restoreSaleBatches = async ({ product, allocations, saleId, requestId, operationKeyPrefix, actor, session }) => {
  const movements = [];
  for (const allocation of allocations) {
    const quantity = Number(allocation.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw conflict('Recorded batch allocation is invalid; sale cannot be voided safely.');
    const batch = await ExpiryBatch.findOneAndUpdate({ _id: allocation.batch, product: product._id }, {
      $inc: { remainingQuantity: quantity },
    }, { session, returnDocument: 'after' });
    if (!batch) throw conflict(`Original expiry batch for ${product.sku} is missing; sale cannot be voided safely.`);
    movements.push(await createMovement({
      product, batch, type: 'SALE_VOID', quantity, remainingDelta: quantity, reservedDelta: 0,
      sourceType: 'SaleVoid', sourceId: saleId, requestId,
      operationKey: `${operationKeyPrefix}:${batch._id}`, actor, session,
      reason: 'Restored to the original sale batch',
    }));
  }
  return movements;
};

const reconciliationPayloadHash = (batches) => crypto.createHash('sha256').update(JSON.stringify(batches)).digest('hex');

const reconcileExpiryBatches = async ({ productId, expectedStock, expectedUnassignedStock, expectedUpdatedAt, recordedBatchVersions: inputRecordedBatchVersions, requestId, batches: inputBatches, user, ipAddress = '', userAgent = '', session: existingSession = null, skipExpectedUpdatedAtCheck = false, idempotencyContext }) => {
  if (!mongoose.isValidObjectId(productId)) throw invalid('Choose a valid expiry-tracked product.');
  if (!Number.isSafeInteger(expectedStock) || expectedStock < 0) throw invalid('The current stock quantity is invalid. Refresh and retry.');
  if (!Number.isSafeInteger(expectedUnassignedStock) || expectedUnassignedStock < 0 || expectedUnassignedStock > expectedStock) {
    throw invalid('The existing stock quantity to verify is invalid. Refresh and retry.');
  }
  const expectedVersion = new Date(expectedUpdatedAt).getTime();
  if (!expectedUpdatedAt || !Number.isFinite(expectedVersion)) throw invalid('Refresh the product before verifying batch quantities.');
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 160) throw invalid('Refresh and try verifying the batches again.');
  if (!Array.isArray(inputBatches) || inputBatches.length > 100) throw invalid('Enter the existing stock batches before confirming.');
  if (!Array.isArray(inputRecordedBatchVersions) || inputRecordedBatchVersions.length > 1000) {
    throw invalid('Refresh the recorded batches before confirming.');
  }
  const recordedBatchVersions = inputRecordedBatchVersions.map((entry) => {
    const batchRecordId = String(entry?.batchRecordId || '').trim();
    const updatedAt = new Date(entry?.updatedAt).getTime();
    if (!mongoose.isValidObjectId(batchRecordId) || !Number.isFinite(updatedAt)) {
      throw invalid('Refresh the recorded batches before confirming.');
    }
    return { batchRecordId, updatedAt };
  }).sort((left, right) => left.batchRecordId.localeCompare(right.batchRecordId));
  if (new Set(recordedBatchVersions.map((entry) => entry.batchRecordId)).size !== recordedBatchVersions.length) {
    throw invalid('Refresh the recorded batches before confirming.');
  }
  const rows = inputBatches.map((row) => {
    const expiryDate = String(row?.expiryDate || '').trim();
    const lotNumber = normalizeLot(row?.lotNumber);
    const quantity = Number(row?.quantity);
    if (!isValidExpiryDate(expiryDate) || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw invalid('Each verified batch needs a valid expiry date and a non-negative whole quantity.');
    }
    if (row?.batchRecordId) throw invalid('Recorded batches are read-only. Refresh and verify only the existing stock.');
    if (lotNumber.length > 100) throw invalid('Batch/Lot Number cannot exceed 100 characters.');
    return { expiryDate, lotNumber, quantity };
  }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)
    || lotIdentity(a.lotNumber).localeCompare(lotIdentity(b.lotNumber))
    || a.quantity - b.quantity);
  const uniqueKeys = new Set();
  for (const row of rows) {
    if (!row.lotNumber) continue;
    const key = `${row.expiryDate}|${lotIdentity(row.lotNumber)}|OPENING`;
    if (uniqueKeys.has(key)) throw invalid('Combine duplicate rows that have the same expiry date and Batch/Lot number.');
    uniqueKeys.add(key);
  }
  if (rows.reduce((sum, row) => sum + row.quantity, 0) !== expectedUnassignedStock) {
      throw invalid(`Opening batch quantities must total exactly ${expectedUnassignedStock} units to match existing stock to verify.`);
  }
  const reconciliationPayload = { expectedStock, expectedUnassignedStock, recordedBatchVersions, rows };
  if (idempotencyContext !== undefined) reconciliationPayload.idempotencyContext = idempotencyContext;
  const payloadHash = reconciliationPayloadHash(reconciliationPayload);
  const batchCreatedAt = new Date();
  if (rows.some((row) => row.quantity > 0)) {
    await ensureCounterExists(getManilaBusinessDate(batchCreatedAt));
  }
  const session = existingSession || await mongoose.startSession();
  let result;
  const applyReconciliation = async () => {
    const replay = await ExpiryBatchReconciliation.findOne({ requestId: requestId.trim() }).session(session);
    if (replay) {
      if (String(replay.product) !== String(productId) || replay.payloadHash !== payloadHash) {
        throw conflict('This verification was already submitted with different quantities. Refresh and try again.');
      }
      result = { product: await Product.findById(productId).session(session), replayed: true };
      return;
    }
    const product = await Product.findOne({ _id: productId, expiryTrackingEnabled: true, isActive: { $ne: false } }).session(session);
    if (!product) throw conflict('Expiry tracking is unavailable for this active product.');
    if (Number(product.stock || 0) !== expectedStock
      || (!skipExpectedUpdatedAtCheck && product.updatedAt?.getTime() !== expectedVersion)) {
      throw conflict('Product stock changed. Refresh and verify the physical batch quantities again.');
    }
    const reservationsQuery = Reservation.find({ product: product._id, status: 'Active' }).sort({ createdAt: 1, _id: 1 });
    const reservations = await reservationsQuery.session(session);
    const reservationTotal = reservations.reduce((sum, reservation) => {
      if (!Number.isSafeInteger(reservation.reservedQuantity) || reservation.reservedQuantity < 1
        || reservation.sku !== product.sku) throw conflict('Active Special Order reservations need review before batch quantities can be verified.');
      return sum + reservation.reservedQuantity;
    }, 0);
    if (!Number.isSafeInteger(reservationTotal) || reservationTotal !== Number(product.reservedStock || 0) || reservationTotal > expectedStock) {
      throw conflict('Active Special Order reservations do not match current reserved stock. Resolve them before verifying batches.');
    }

    if (!product.expiryTrackingPeriodId) {
      // Legacy batches have no reliable lifecycle boundary. Preserve their
      // recorded balances and close them as history; only the operator's
      // exact physical count is copied into the newly identified period.
      const legacyBatches = await ExpiryBatch.find(batchesToCloseFilter(product)).session(session);
      const legacyPeriodId = createExpiryTrackingPeriodId();
      const closedAt = new Date();
      for (const legacyBatch of legacyBatches) {
        legacyBatch.trackingPeriodId ||= legacyPeriodId;
        legacyBatch.trackingPeriodClosedAt = closedAt;
        await legacyBatch.save({ session });
      }
      product.expiryTrackingPeriodId = createExpiryTrackingPeriodId();
      product.expiryTrackingPeriodStartedAt = closedAt;
      product.expiryUnassignedStock = expectedStock;
    }
    if (Number(product.expiryUnassignedStock || 0) !== expectedUnassignedStock) {
      throw conflict('Existing stock changed. Refresh and verify the current unassigned quantity.');
    }

    const existing = await ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).session(session);
    const currentVersions = existing.map((batch) => ({
      batchRecordId: asId(batch._id),
      updatedAt: batch.updatedAt?.getTime(),
    })).sort((left, right) => left.batchRecordId.localeCompare(right.batchRecordId));
    if (currentVersions.length !== recordedBatchVersions.length
      || currentVersions.some((version, index) => version.batchRecordId !== recordedBatchVersions[index].batchRecordId
        || version.updatedAt !== recordedBatchVersions[index].updatedAt)) {
      throw conflict('Recorded batches changed. Refresh and verify again.');
    }

    const recordedIds = existing.map((batch) => batch._id);
    const receipts = recordedIds.length
      ? await ExpiryBatchReceipt.find({ product: product._id, batch: { $in: recordedIds } }).select('batch quantity').session(session).lean()
      : [];
    const receiptQuantities = new Map();
    for (const receipt of receipts) {
      const key = asId(receipt.batch);
      receiptQuantities.set(key, (receiptQuantities.get(key) || 0) + Number(receipt.quantity || 0));
    }
    const receiptLedgerValid = existing.every((batch) => Number.isSafeInteger(batch.quantityReceived)
      && batch.quantityReceived >= 0
      && batch.quantityReceived === (receiptQuantities.get(asId(batch._id)) || 0));
    if (!receiptLedgerValid) throw conflict('Recorded receipt details need review. No batch quantities were changed.');
    const recordedRemainingTotal = existing.reduce((sum, batch) => sum + Number(batch.remainingQuantity || 0), 0);
    if (!existing.every((batch) => Number.isSafeInteger(batch.remainingQuantity) && batch.remainingQuantity >= 0
      && Number.isSafeInteger(batch.reservedQuantity) && batch.reservedQuantity >= 0
      && batch.reservedQuantity <= batch.remainingQuantity)
      || recordedRemainingTotal + expectedUnassignedStock !== expectedStock) {
      throw conflict('Recorded batches and existing stock do not match current stock. Refresh and request a review.');
    }

    const movementRecords = [];
    for (const row of rows) {
      if (row.quantity === 0) continue;
      const lotKey = `OPENING:${new mongoose.Types.ObjectId()}`;
      const [batch] = await ExpiryBatch.create([{
        product: product._id, sku: product.sku, batchId: makeBatchId(),
        batchReference: await nextExpiryBatchReference({ createdAt: batchCreatedAt, session }),
        lotNumber: row.lotNumber,
        lotKey, expiryDate: row.expiryDate, quantityReceived: 0,
        remainingQuantity: row.quantity, reservedQuantity: 0, openingBalanceQuantity: row.quantity,
        trackingPeriodId: product.expiryTrackingPeriodId || null,
        receivedAt: batchCreatedAt, receivedBy: user?._id || null,
      }], { session });
      movementRecords.push(await createMovement({
        product, batch, type: 'RECONCILIATION', quantity: row.quantity,
        remainingDelta: row.quantity, reservedDelta: 0, sourceType: 'Reconciliation', sourceId: null,
        requestId, operationKey: `reconcile:${requestId}:${batch._id}`, actor: user,
        reason: 'Verified physical opening balance; not a receipt', session,
      }));
    }

    // Keep existing reservation allocations intact. Only assign a legacy
    // active hold when no batch allocation was recorded for that portion.
    const currentBatches = await ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).session(session);
    const currentBatchById = new Map(currentBatches.map((batch) => [asId(batch._id), batch]));
    const allocatedByBatch = new Map();
    const savedAllocationsByReservation = new Map();
    for (const reservation of reservations) {
      const saved = [];
      const seenReservationBatches = new Set();
      let alreadyAllocated = 0;
      for (const allocation of reservation.batchAllocations || []) {
        const batchId = asId(allocation.batch);
        const batch = currentBatchById.get(batchId);
        const quantity = Number(allocation.quantity);
        if (!batch || seenReservationBatches.has(batchId) || !Number.isSafeInteger(quantity) || quantity < 1
          || allocation.batchId !== batch.batchId || allocation.expiryDate !== batch.expiryDate) {
          throw conflict('An active reservation references changed batch details. Resolve them before verifying batches.');
        }
        if (batch.expiryDate <= getManilaBusinessDate()) {
          throw conflict('An active reservation references expired stock. Resolve them before verifying batches.');
        }
        seenReservationBatches.add(batchId);
        alreadyAllocated += quantity;
        allocatedByBatch.set(batchId, (allocatedByBatch.get(batchId) || 0) + quantity);
        saved.push({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity });
      }
      if (alreadyAllocated > reservation.reservedQuantity) {
        throw conflict('Active reservation quantities need review before batch verification.');
      }
      savedAllocationsByReservation.set(String(reservation._id), saved);
    }
    for (const batch of currentBatches) {
      if (Number(batch.reservedQuantity || 0) !== (allocatedByBatch.get(asId(batch._id)) || 0)) {
        throw conflict('Recorded batch reservations do not match active Special Orders. Resolve them before verifying batches.');
      }
    }
    for (const reservation of reservations) {
      const saved = savedAllocationsByReservation.get(String(reservation._id)) || [];
      const alreadyAllocated = saved.reduce((sum, allocation) => sum + allocation.quantity, 0);
      const missingQuantity = reservation.reservedQuantity - alreadyAllocated;
      const allocations = missingQuantity > 0 ? selectAllocations(currentBatches, missingQuantity, { allowExpired: false }) : [];
      if (!allocations) throw conflict(`Eligible batches do not cover the ${reservation.reservedQuantity} ${product.sellingUnit || 'unit'} held for a Special Order. Release or resolve the reservation before verifying batches.`);
      for (const { batch, quantity } of allocations) {
        batch.reservedQuantity += quantity;
        if (batch.reservedQuantity > batch.remainingQuantity) throw conflict('Verified batch stock is insufficient for active reservations.');
        const updatedBatch = await batch.save({ session });
        saved.push({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity });
        movementRecords.push(await createMovement({
          product, batch: updatedBatch, type: 'RESERVATION_RECONCILE', quantity,
          remainingDelta: 0, reservedDelta: quantity, sourceType: 'SpecialOrder', sourceId: reservation.specialOrder,
          requestId, operationKey: `reconcile-reservation:${requestId}:${reservation._id}:${batch._id}`,
          actor: user, reason: 'Current active reservation assigned to verified batch', session,
        }));
      }
      if (missingQuantity > 0) {
        reservation.batchAllocations = saved;
        reservation.history.push({ action: 'Reconcile', quantity: reservation.reservedQuantity, requestId, actor: user._id, batchAllocations: saved });
        reservation.updatedBy = user._id;
        await reservation.save({ session });
      }
    }

    const finalBatches = await ExpiryBatch.find(activeBatchFilter(product)).session(session);
    if (finalBatches.reduce((sum, batch) => sum + batch.remainingQuantity, 0) !== expectedStock
      || finalBatches.reduce((sum, batch) => sum + batch.reservedQuantity, 0) !== reservationTotal) {
      throw conflict('Batch quantities do not match current stock and reservations. No changes were saved.');
    }
    product.expiryBatchReconciled = true;
    product.expiryBatchReconciledAt = new Date();
    product.expiryBatchReconciledBy = user?._id || null;
    product.expiryUnassignedStock = 0;
    await product.save({ session });
    await ExpiryBatchReconciliation.create([{
      requestId: requestId.trim(), product: product._id, payloadHash,
      trackingPeriodId: product.expiryTrackingPeriodId,
      stockAtReconciliation: expectedStock, batchCount: finalBatches.length, reconciledBy: user?._id || null,
    }], { session });
    const userLabel = user?.displayName || user?.name || user?.username || 'System';
    const [inventoryLog] = await InventoryLog.create([{
      action: 'UPDATE', code: product.sku, productRef: product._id, userRef: user?._id || null,
      user: userLabel, quantity: 0, stockBefore: expectedStock, stockAfter: expectedStock,
      batchMovementRefs: movementRecords.map((movement) => movement._id),
      details: `Expiry batch quantities verified against physical stock (${expectedStock} ${product.sellingUnit || 'unit'}); Product.stock was not changed.`,
    }], { session });
    const [activityLog] = await ActivityLog.create([{
      userRef: user?._id || null, user: userLabel,
      action: idempotencyContext?.enableTracking ? 'Enabled Expiry Tracking and Verified Batches' : 'Verified Expiry Batches',
      details: `${idempotencyContext?.enableTracking ? 'Enabled expiry tracking and v' : 'V'}erified ${rows.length} existing-stock batch allocation(s) for ${product.name} (${product.sku}); recorded receipt batches were preserved against ${expectedStock} ${product.sellingUnit || 'unit'} of stock.`,
      ipAddress, userAgent,
    }], { session });
    result = { product, batches: finalBatches, movements: movementRecords, inventoryLog, activityLog, replayed: false };
  };
  try {
    if (existingSession) {
      await applyReconciliation();
    } else {
    const transaction = async () => {
      const replay = await ExpiryBatchReconciliation.findOne({ requestId: requestId.trim() }).session(session);
      if (replay) {
        if (String(replay.product) !== String(productId) || replay.payloadHash !== payloadHash) {
          throw conflict('This verification was already submitted with different quantities. Refresh and try again.');
        }
        result = { product: await Product.findById(productId).session(session), replayed: true };
        return;
      }
      const product = await Product.findOne({ _id: productId, expiryTrackingEnabled: true, isActive: { $ne: false } }).session(session);
      if (!product) throw conflict('Expiry tracking is unavailable for this active product.');
      if (Number(product.stock || 0) !== expectedStock || product.updatedAt?.getTime() !== expectedVersion) {
        throw conflict('Product stock changed. Refresh and verify the physical batch quantities again.');
      }
      const reservationsQuery = Reservation.find({ product: product._id, status: 'Active' }).sort({ createdAt: 1, _id: 1 });
      const reservations = await reservationsQuery.session(session);
      const reservationTotal = reservations.reduce((sum, reservation) => {
        if (!Number.isSafeInteger(reservation.reservedQuantity) || reservation.reservedQuantity < 1
          || reservation.sku !== product.sku) throw conflict('Active Special Order reservations need review before batch quantities can be verified.');
        return sum + reservation.reservedQuantity;
      }, 0);
      if (!Number.isSafeInteger(reservationTotal) || reservationTotal !== Number(product.reservedStock || 0) || reservationTotal > expectedStock) {
        throw conflict('Active Special Order reservations do not match current reserved stock. Resolve them before verifying batches.');
      }

      if (!product.expiryTrackingPeriodId) {
        // Legacy batches have no reliable lifecycle boundary. Preserve their
        // recorded balances and close them as history; only the operator's
        // exact physical count is copied into the newly identified period.
        const legacyBatches = await ExpiryBatch.find(batchesToCloseFilter(product)).session(session);
        const legacyPeriodId = createExpiryTrackingPeriodId();
        const closedAt = new Date();
        for (const legacyBatch of legacyBatches) {
          legacyBatch.trackingPeriodId ||= legacyPeriodId;
          legacyBatch.trackingPeriodClosedAt = closedAt;
          await legacyBatch.save({ session });
        }
        product.expiryTrackingPeriodId = createExpiryTrackingPeriodId();
        product.expiryTrackingPeriodStartedAt = closedAt;
        product.expiryUnassignedStock = expectedStock;
      }
      if (Number(product.expiryUnassignedStock || 0) !== expectedUnassignedStock) {
        throw conflict('Existing stock changed. Refresh and verify the current unassigned quantity.');
      }

      const existing = await ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).session(session);
      const currentVersions = existing.map((batch) => ({
        batchRecordId: asId(batch._id),
        updatedAt: batch.updatedAt?.getTime(),
      })).sort((left, right) => left.batchRecordId.localeCompare(right.batchRecordId));
      if (currentVersions.length !== recordedBatchVersions.length
        || currentVersions.some((version, index) => version.batchRecordId !== recordedBatchVersions[index].batchRecordId
          || version.updatedAt !== recordedBatchVersions[index].updatedAt)) {
        throw conflict('Recorded batches changed. Refresh and verify again.');
      }

      const recordedIds = existing.map((batch) => batch._id);
      const receipts = recordedIds.length
        ? await ExpiryBatchReceipt.find({ product: product._id, batch: { $in: recordedIds } }).select('batch quantity').session(session).lean()
        : [];
      const receiptQuantities = new Map();
      for (const receipt of receipts) {
        const key = asId(receipt.batch);
        receiptQuantities.set(key, (receiptQuantities.get(key) || 0) + Number(receipt.quantity || 0));
      }
      const receiptLedgerValid = existing.every((batch) => Number.isSafeInteger(batch.quantityReceived)
        && batch.quantityReceived >= 0
        && batch.quantityReceived === (receiptQuantities.get(asId(batch._id)) || 0));
      if (!receiptLedgerValid) throw conflict('Recorded receipt details need review. No batch quantities were changed.');
      const recordedRemainingTotal = existing.reduce((sum, batch) => sum + Number(batch.remainingQuantity || 0), 0);
      if (!existing.every((batch) => Number.isSafeInteger(batch.remainingQuantity) && batch.remainingQuantity >= 0
        && Number.isSafeInteger(batch.reservedQuantity) && batch.reservedQuantity >= 0
        && batch.reservedQuantity <= batch.remainingQuantity)
        || recordedRemainingTotal + expectedUnassignedStock !== expectedStock) {
        throw conflict('Recorded batches and existing stock do not match current stock. Refresh and request a review.');
      }

      const movementRecords = [];
      for (const row of rows) {
        if (row.quantity === 0) continue;
        const lotKey = `OPENING:${new mongoose.Types.ObjectId()}`;
        const [batch] = await ExpiryBatch.create([{
          product: product._id, sku: product.sku, batchId: makeBatchId(),
          batchReference: await nextExpiryBatchReference({ createdAt: batchCreatedAt, session }),
          lotNumber: row.lotNumber,
          lotKey, expiryDate: row.expiryDate, quantityReceived: 0,
          remainingQuantity: row.quantity, reservedQuantity: 0, openingBalanceQuantity: row.quantity,
          trackingPeriodId: product.expiryTrackingPeriodId || null,
          receivedAt: batchCreatedAt, receivedBy: user?._id || null,
        }], { session });
        movementRecords.push(await createMovement({
          product, batch, type: 'RECONCILIATION', quantity: row.quantity,
          remainingDelta: row.quantity, reservedDelta: 0, sourceType: 'Reconciliation', sourceId: null,
          requestId, operationKey: `reconcile:${requestId}:${batch._id}`, actor: user,
          reason: 'Verified physical opening balance; not a receipt', session,
        }));
      }

      // Keep existing reservation allocations intact. Only assign a legacy
      // active hold when no batch allocation was recorded for that portion.
      const currentBatches = await ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).session(session);
      const currentBatchById = new Map(currentBatches.map((batch) => [asId(batch._id), batch]));
      const allocatedByBatch = new Map();
      const savedAllocationsByReservation = new Map();
      for (const reservation of reservations) {
        const saved = [];
        const seenReservationBatches = new Set();
        let alreadyAllocated = 0;
        for (const allocation of reservation.batchAllocations || []) {
          const batchId = asId(allocation.batch);
          const batch = currentBatchById.get(batchId);
          const quantity = Number(allocation.quantity);
          if (!batch || seenReservationBatches.has(batchId) || !Number.isSafeInteger(quantity) || quantity < 1
            || allocation.batchId !== batch.batchId || allocation.expiryDate !== batch.expiryDate) {
            throw conflict('An active reservation references changed batch details. Resolve it before verifying batches.');
          }
          if (batch.expiryDate <= getManilaBusinessDate()) {
            throw conflict('An active reservation references expired stock. Resolve it before verifying batches.');
          }
          seenReservationBatches.add(batchId);
          alreadyAllocated += quantity;
          allocatedByBatch.set(batchId, (allocatedByBatch.get(batchId) || 0) + quantity);
          saved.push({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity });
        }
        if (alreadyAllocated > reservation.reservedQuantity) {
          throw conflict('Active reservation quantities need review before batch verification.');
        }
        savedAllocationsByReservation.set(String(reservation._id), saved);
      }
      for (const batch of currentBatches) {
        if (Number(batch.reservedQuantity || 0) !== (allocatedByBatch.get(asId(batch._id)) || 0)) {
          throw conflict('Recorded batch reservations do not match active Special Orders. Resolve them before verifying batches.');
        }
      }
      for (const reservation of reservations) {
        const saved = savedAllocationsByReservation.get(String(reservation._id)) || [];
        const alreadyAllocated = saved.reduce((sum, allocation) => sum + allocation.quantity, 0);
        const missingQuantity = reservation.reservedQuantity - alreadyAllocated;
        const allocations = missingQuantity > 0 ? selectAllocations(currentBatches, missingQuantity, { allowExpired: false }) : [];
        if (!allocations) throw conflict(`Eligible batches do not cover the ${reservation.reservedQuantity} ${product.sellingUnit || 'unit'} held for a Special Order. Release or resolve the reservation before verifying batches.`);
        for (const { batch, quantity } of allocations) {
          batch.reservedQuantity += quantity;
          if (batch.reservedQuantity > batch.remainingQuantity) throw conflict('Verified batch stock is insufficient for active reservations.');
          const updatedBatch = await batch.save({ session });
          saved.push({ batch: batch._id, batchId: batch.batchId, expiryDate: batch.expiryDate, quantity });
          movementRecords.push(await createMovement({
            product, batch: updatedBatch, type: 'RESERVATION_RECONCILE', quantity,
            remainingDelta: 0, reservedDelta: quantity, sourceType: 'SpecialOrder', sourceId: reservation.specialOrder,
            requestId, operationKey: `reconcile-reservation:${requestId}:${reservation._id}:${batch._id}`,
            actor: user, reason: 'Current active reservation assigned to verified batch', session,
          }));
        }
        if (missingQuantity > 0) {
          reservation.batchAllocations = saved;
          reservation.history.push({ action: 'Reconcile', quantity: reservation.reservedQuantity, requestId, actor: user._id, batchAllocations: saved });
          reservation.updatedBy = user._id;
          await reservation.save({ session });
        }
      }

      const finalBatches = await ExpiryBatch.find(activeBatchFilter(product)).session(session);
      if (finalBatches.reduce((sum, batch) => sum + batch.remainingQuantity, 0) !== expectedStock
        || finalBatches.reduce((sum, batch) => sum + batch.reservedQuantity, 0) !== reservationTotal) {
        throw conflict('Batch quantities do not match current stock and reservations. No changes were saved.');
      }
      product.expiryBatchReconciled = true;
      product.expiryBatchReconciledAt = new Date();
      product.expiryBatchReconciledBy = user?._id || null;
      product.expiryUnassignedStock = 0;
      await product.save({ session });
      await ExpiryBatchReconciliation.create([{
        requestId: requestId.trim(), product: product._id, payloadHash,
        trackingPeriodId: product.expiryTrackingPeriodId,
        stockAtReconciliation: expectedStock, batchCount: finalBatches.length, reconciledBy: user?._id || null,
      }], { session });
      const userLabel = user?.displayName || user?.name || user?.username || 'System';
      await InventoryLog.create([{
        action: 'UPDATE', code: product.sku, productRef: product._id, userRef: user?._id || null,
        user: userLabel, quantity: 0, stockBefore: expectedStock, stockAfter: expectedStock,
        batchMovementRefs: movementRecords.map((movement) => movement._id),
        details: `Expiry batch quantities verified against physical stock (${expectedStock} ${product.sellingUnit || 'unit'}); Product.stock was not changed.`,
      }], { session });
      await ActivityLog.create([{
        userRef: user?._id || null, user: userLabel,
        action: idempotencyContext?.enableTracking ? 'Enabled Expiry Tracking and Verified Batches' : 'Verified Expiry Batches',
        details: `${idempotencyContext?.enableTracking ? 'Enabled expiry tracking and v' : 'V'}erified ${rows.length} existing-stock batch allocation(s) for ${product.name} (${product.sku}); recorded receipt batches were preserved against ${expectedStock} ${product.sellingUnit || 'unit'} of stock.`,
        ipAddress, userAgent,
      }], { session });
      result = { product, batches: finalBatches, movements: movementRecords, replayed: false };
    };
    await session.withTransaction(transaction);
    }
  } finally {
    if (!existingSession) await session.endSession();
  }
  return result;
};

module.exports = {
  createMovement,
  inspectBatchState,
  getExpiryBatchAvailability,
  selectAllocations,
  normalizeBatchAllocations,
  normalizeSelectedStockOutAllocations,
  batchAllocationSignature,
  validateBatchVerification,
  allocateUnreservedBatches,
  allocateSelectedUnreservedBatches,
  allocateVerifiedBatches,
  reserveExpiryBatches,
  changeReservedBatches,
  replaceReservedBatchesWithVerified,
  consumeReservedExpiryBatches,
  restoreSaleBatches,
  reconcileExpiryBatches,
};
