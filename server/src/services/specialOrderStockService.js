const Product = require('../models/Product');
const Reservation = require('../models/SpecialOrderStockReservation');
const Operation = require('../models/SpecialOrderStockOperation');
const Quotation = require('../models/SpecialOrderQuotation');
const { getManilaBusinessDate } = require('../utils/productExpiry');
const { getExpiryBatchAvailability, inspectBatchState, reserveExpiryBatches, changeReservedBatches, selectAllocations } = require('./expiryBatchAllocationService');

const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const safeQuantity = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const id = (value) => String(value || '');

const orderItems = async (order, session) => {
  if (!order.currentQuotation) return order.items || [];
  const query = Quotation.findOne({ _id: order.currentQuotation, specialOrder: order._id });
  const quotation = await (session ? query.session(session) : query);
  return quotation?.items || order.items || [];
};

const groupedItems = (items) => {
  const groups = new Map();
  const custom = [];
  const invalidInventory = [];
  for (const item of items) {
    const quantity = safeQuantity(item.quantity);
    if (item.itemType !== 'inventory') {
      custom.push({ itemId: item.itemId || null, itemName: item.itemName, orderedQuantity: quantity, status: 'Documented', itemType: 'custom' });
      continue;
    }
    if (!item.inventoryProduct || !item.inventorySnapshot?.sku) {
      invalidInventory.push({ itemId: item.itemId || null, itemName: item.itemName, sku: item.inventorySnapshot?.sku || '', orderedQuantity: quantity, itemType: 'inventory' });
      continue;
    }
    const key = id(item.inventoryProduct);
    const current = groups.get(key) || { productId: key, sku: item.inventorySnapshot?.sku || '', itemName: item.itemName, orderedQuantity: 0, itemType: 'inventory' };
    current.orderedQuantity += quantity;
    groups.set(key, current);
  }
  return { groups, custom, invalidInventory };
};

const getStockAvailability = async (order, session = null) => {
  const today = getManilaBusinessDate();
  const { groups, custom, invalidInventory } = groupedItems(await orderItems(order, session));
  const productIds = [...groups.keys()];
  const productQuery = Product.find({ _id: { $in: productIds } }).lean();
  const reservationQuery = Reservation.find({ specialOrder: order._id, product: { $in: productIds } }).lean();
  const activeReservationsQuery = Reservation.find({ product: { $in: productIds }, status: 'Active' }).select('product reservedQuantity').lean();
  // Operations in a MongoDB transaction must not run concurrently on one session.
  const [products, reservations, activeReservations] = session
    ? [await productQuery.session(session), await reservationQuery.session(session), await activeReservationsQuery.session(session)]
    : await Promise.all([productQuery, reservationQuery, activeReservationsQuery]);
  const productById = new Map(products.map((product) => [id(product._id), product]));
  const batchAvailabilityById = new Map();
  for (const product of products) {
    if (product.expiryTrackingEnabled) batchAvailabilityById.set(id(product._id), await getExpiryBatchAvailability(product, session));
  }
  const reservationById = new Map(reservations.map((reservation) => [id(reservation.product), reservation]));
  const activeTotals = new Map();
  for (const reservation of activeReservations) {
    const key = id(reservation.product);
    const quantity = Number(reservation.reservedQuantity);
    const total = (activeTotals.has(key) ? activeTotals.get(key) : 0) + quantity;
    activeTotals.set(key, Number.isSafeInteger(quantity) && quantity > 0 && Number.isSafeInteger(total) ? total : NaN);
  }
  const rows = [...groups.values()].map((group) => {
    const product = productById.get(group.productId);
    const reservation = reservationById.get(group.productId);
    const physicalStock = Math.max(0, Number(product?.stock || 0));
    const reservedTotal = Math.max(0, Number(product?.reservedStock || 0));
    const activeReservation = reservation?.status === 'Active';
    const batchAvailability = batchAvailabilityById.get(group.productId);
    const batchNeedsReview = Boolean(product?.expiryTrackingEnabled
      && (!batchAvailability?.reconciled || !batchAvailability.valid));
    const reservationBatchTotal = (reservation?.batchAllocations || []).reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    const reservationBatchesValid = !activeReservation || !product?.expiryTrackingEnabled
      || reservationBatchTotal === Number(reservation.reservedQuantity || 0);
    const reservationValid = !activeReservation || Boolean(product && product.isActive !== false
      && reservation.sku === group.sku && product.sku === group.sku
      && reservation.orderedQuantity === group.orderedQuantity
      && Number.isSafeInteger(reservation.reservedQuantity) && reservation.reservedQuantity > 0
      && reservation.reservedQuantity <= group.orderedQuantity
      && Number.isSafeInteger(activeTotals.get(group.productId))
      && activeTotals.get(group.productId) === reservedTotal && reservedTotal <= physicalStock
      && reservationBatchesValid)
      && !batchNeedsReview;
    const allocatedToOrder = activeReservation && reservationValid ? reservation.reservedQuantity : 0;
    const consumedQuantity = reservation?.status === 'Consumed' && reservation.consumedSale && order.linkedSaleId
      && String(reservation.consumedSale) === String(order.linkedSaleId)
      ? Math.max(0, Number(reservation.reservedQuantity || 0)) : 0;
    const availableToSell = product?.isActive === false || !reservationValid ? 0
      : product.expiryTrackingEnabled ? Number(batchAvailability?.availableToSell || 0)
        : Math.max(0, physicalStock - reservedTotal);
    const shortage = Math.max(0, group.orderedQuantity - allocatedToOrder - consumedQuantity - availableToSell);
    const batchAvailabilityState = batchAvailability?.valid && batchAvailability?.reconciled ? batchAvailability.batches || [] : [];
    const batchById = new Map(batchAvailabilityState.map((batch) => [String(batch._id), batch]));
    const ownBatchAllocations = activeReservation && reservationValid && product?.expiryTrackingEnabled
      ? reservation.batchAllocations.map((allocation) => {
        const batch = batchById.get(String(allocation.batch));
        return {
          batch: allocation.batch,
          batchId: allocation.batchId,
          batchReference: batch?.batchReference || '',
          lotNumber: batch?.lotNumber || '',
          expiryDate: batch?.expiryDate || allocation.expiryDate,
          quantity: Number(allocation.quantity),
        };
      }) : [];
    const topUpQuantity = Math.max(0, group.orderedQuantity - ownBatchAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0));
    const topUp = topUpQuantity > 0 && batchAvailabilityState.length
      ? selectAllocations(batchAvailabilityState, topUpQuantity)
      : (topUpQuantity === 0 ? [] : null);
    const proposedBatchAllocations = product?.expiryTrackingEnabled && !batchNeedsReview && topUp
      ? [...ownBatchAllocations, ...topUp.map(({ batch, quantity }) => ({
        batch: batch._id, batchId: batch.batchId, batchReference: batch.batchReference || '',
        lotNumber: batch.lotNumber || '', expiryDate: batch.expiryDate, quantity,
      }))]
      : null;
    const ownedByBatch = new Map(ownBatchAllocations.map((allocation) => [String(allocation.batch), allocation.quantity]));
    const batchOptions = product?.expiryTrackingEnabled && !batchNeedsReview
      ? batchAvailabilityState.map((batch) => ({
        batch: batch._id,
        batchId: batch.batchId,
        batchReference: batch.batchReference || '',
        lotNumber: batch.lotNumber || '',
        expiryDate: batch.expiryDate,
        availableQuantity: batch.expiryDate > today
          ? Math.max(0, batch.remainingQuantity - batch.reservedQuantity + (ownedByBatch.get(String(batch._id)) || 0))
          : 0,
      })) : [];
    return {
      ...group, sku: product?.sku || group.sku, sellingUnit: product?.sellingUnit || '',
      physicalStock, reservedTotal, availableToSell, allocatedToOrder, consumedQuantity, shortage,
      productStock: physicalStock,
      productReserved: reservedTotal,
      expiryTrackingEnabled: Boolean(product?.expiryTrackingEnabled),
      expiryBatchReconciled: Boolean(product?.expiryBatchReconciled && batchAvailability?.valid),
      reservedBatchAllocations: ownBatchAllocations,
      proposedBatchAllocations: Array.isArray(proposedBatchAllocations)
        && proposedBatchAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) === group.orderedQuantity
        ? proposedBatchAllocations : null,
      batchOptions,
      reservationNeedsReview: batchNeedsReview || (activeReservation && !reservationValid),
      unreservedQuantity: Math.max(0, group.orderedQuantity - allocatedToOrder - consumedQuantity),
      status: consumedQuantity === group.orderedQuantity ? 'Fulfilled' : batchNeedsReview || (activeReservation && !reservationValid)
        ? 'Needs Review' : !product || product.isActive === false
        ? 'For Sourcing'
        : shortage === 0 ? 'Available' : allocatedToOrder > 0 || availableToSell > 0 ? 'Partially Available' : 'For Sourcing',
      reservable: Boolean(product?.isActive && reservationValid
        && (!product.expiryTrackingEnabled || (batchAvailability?.reconciled && batchAvailability.valid))),
    };
  });
  // Custom items are represented by the accepted quotation and never require
  // an inventory action. Preserve historical sourcing records without gating closure.
  const sourcedById = new Map((order.customSourcing || []).map((entry) => [id(entry.itemId), Number(entry.sourcedQuantity || 0)]));
  const customRows = custom.map((item) => {
    const sourcedQuantity = Math.min(item.orderedQuantity, Math.max(0, sourcedById.get(id(item.itemId)) || 0));
    return { ...item, sourcedQuantity, remainingToAllocate: 0, readinessRequired: false,
      status: 'Documented', fulfillmentStatus: 'Documented' };
  });
  const invalidInventoryRows = invalidInventory.map((item) => ({
    ...item, productId: '', physicalStock: 0, reservedTotal: 0, availableToSell: 0,
    allocatedToOrder: 0, consumedQuantity: 0, shortage: item.orderedQuantity,
    reservationNeedsReview: true, unreservedQuantity: item.orderedQuantity,
    status: 'Needs Review', reservable: false, remainingToAllocate: item.orderedQuantity,
    fulfillmentStatus: 'Needs Review',
  }));
  const inventoryRows = [...rows.map((item) => ({ ...item,
    remainingToAllocate: Math.max(0, item.orderedQuantity - item.allocatedToOrder - item.consumedQuantity),
    fulfillmentStatus: item.consumedQuantity >= item.orderedQuantity ? 'Fulfilled'
      : item.allocatedToOrder >= item.orderedQuantity ? 'Ready' : item.allocatedToOrder > 0 ? 'Partially Ready' : 'Awaiting Items',
  })), ...invalidInventoryRows];
  const items = [...inventoryRows, ...customRows];
  const anyAccountedFor = inventoryRows.some((item) => item.remainingToAllocate < item.orderedQuantity);
  // Custom-only orders require no inventory operation; only inventory-linked SKUs
  // participate in the stock gate for administrative completion.
  const allItemsReady = inventoryRows.every((item) => item.remainingToAllocate === 0);
  const method = order.fulfillment?.method || '';
  const canComplete = inventoryRows.every((item) => !item.reservationNeedsReview && item.shortage === 0 && item.consumedQuantity === 0);
  const status = order.status === 'Completed'
    ? order.fulfillmentHandover?.confirmedAt ? order.fulfillmentHandover.status
      : Number(order.workflowVersion) >= 2 ? inventoryRows.length ? 'Stock Consumed' : 'No Inventory Required' : 'Completed'
    : inventoryRows.length === 0 ? 'No Inventory Required'
      : canComplete ? 'Stock Available'
        : anyAccountedFor ? 'Partially Available' : 'Insufficient Stock';
  return { items, reservable: order.status === 'In Progress' && Number(order.workflowVersion) >= 2,
    fulfillment: { status, allItemsReady, canComplete, remainingQuantity: inventoryRows.reduce((sum, item) => sum + item.remainingToAllocate, 0),
      method, preferredDate: order.fulfillment?.preferredDate || '',
      address: method === 'Free Delivery' ? order.fulfillment : null,
      readyConfirmedAt: order.readyConfirmation?.confirmedAt || null,
      readyConfirmedBy: order.readyConfirmation?.confirmedBy || null },
  };
};

const releaseOrderReservations = async ({ order, session, actor, requestId, action = 'Release' }) => {
  const reservations = await Reservation.find({ specialOrder: order._id, status: 'Active', reservedQuantity: { $gt: 0 } }).session(session);
  const changes = [];
  for (const reservation of reservations) {
    const quantity = reservation.reservedQuantity;
    const productBefore = await Product.findById(reservation.product).session(session);
    if (!productBefore || Number(productBefore.reservedStock || 0) < quantity) throw conflict('Reservation totals changed. Reload before releasing stock.');
    if (productBefore.expiryTrackingEnabled && productBefore.expiryBatchReconciled) {
      const state = await inspectBatchState(productBefore, session);
      if (!state.valid) throw conflict(`Batch verification is needed for ${productBefore.sku} before releasing stock. Verify batches in Inventory first.`);
    }
    const releasedBatches = productBefore.expiryTrackingEnabled && productBefore.expiryBatchReconciled
      ? await changeReservedBatches({
        product: productBefore,
        allocations: reservation.batchAllocations,
        session,
        orderId: order._id,
        requestId,
        operationKeyPrefix: `special-order-release:${order._id}:${requestId}:${reservation.product}`,
        actor,
        action: 'release',
      }) : null;
    if (productBefore.expiryTrackingEnabled && productBefore.expiryBatchReconciled
      && (releasedBatches?.allocations || []).reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0) !== quantity) {
      throw conflict(`Batch reservation details for ${productBefore.sku} are missing. Verify stock in Inventory before releasing it.`);
    }
    const product = await Product.findOneAndUpdate(
      { _id: reservation.product, reservedStock: { $gte: quantity } },
      { $inc: { reservedStock: -quantity } }, { session, returnDocument: 'after' }
    );
    if (!product) throw conflict('Reservation totals changed. Reload before releasing stock.');
    reservation.reservedQuantity = 0;
    reservation.batchAllocations = [];
    reservation.status = 'Released';
    reservation.updatedBy = actor;
    reservation.history.push({ action, quantity, requestId, actor, batchAllocations: releasedBatches?.allocations || [] });
    await reservation.save({ session });
    changes.push({ product: reservation.product, quantity: -quantity });
  }
  return changes;
};

const reserveOrderStock = async ({ order, session, actor, requestId }) => {
  const { groups, invalidInventory } = groupedItems(await orderItems(order, session));
  if (invalidInventory.length) throw conflict('An inventory-linked item is missing its exact SKU. Review the accepted quotation before reserving stock.');
  const changes = [];
  for (const group of groups.values()) {
    const product = await Product.findOne({ _id: group.productId, isActive: { $ne: false } }).session(session);
    if (!product) continue; // Archived/deleted SKUs remain visible as For Sourcing.
    const batchAvailability = product.expiryTrackingEnabled
      ? await getExpiryBatchAvailability(product, session) : null;
    if (product.expiryTrackingEnabled && (!batchAvailability?.reconciled || !batchAvailability.valid)) {
      throw conflict(`Batch verification is needed for ${product.sku} before reserving Special Order stock. Verify batches in Inventory first.`);
    }
    const active = await Reservation.find({ product: product._id, status: 'Active' }).select('reservedQuantity').session(session);
    const activeTotal = active.reduce((total, reservation) => total + reservation.reservedQuantity, 0);
    if (active.some((reservation) => !Number.isSafeInteger(reservation.reservedQuantity) || reservation.reservedQuantity < 1)
      || !Number.isSafeInteger(activeTotal) || activeTotal !== Number(product.reservedStock || 0)
      || activeTotal > Number(product.stock || 0)) {
      throw conflict('Reservation totals changed. Reload before reserving stock.');
    }
    const existing = await Reservation.findOne({ specialOrder: order._id, product: product._id }).session(session);
    const held = existing?.status === 'Active' ? existing.reservedQuantity : 0;
    const remaining = Math.max(0, group.orderedQuantity - held);
    const available = Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0));
    const quantity = Math.min(remaining, available);
    if (!quantity) continue;
    const updated = await Product.findOneAndUpdate({
      _id: product._id, isActive: { $ne: false },
      $expr: { $gte: [{ $subtract: ['$stock', { $ifNull: ['$reservedStock', 0] }] }, quantity] },
    }, { $inc: { reservedStock: quantity } }, { session, returnDocument: 'after' });
    if (!updated) throw conflict('Available stock changed. Reload and retry reservation.');
    const reservation = existing || new Reservation({ specialOrder: order._id, product: product._id, sku: product.sku, createdBy: actor, history: [] });
    const priorBatchAllocations = existing?.status === 'Active' ? (existing.batchAllocations || []) : [];
    if (product.expiryTrackingEnabled && held > 0
      && priorBatchAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0) !== held) {
      throw conflict(`Batch reservation details for ${product.sku} need review before adding more stock. Verify batches in Inventory first.`);
    }
    const newBatchReservation = product.expiryTrackingEnabled
      ? await reserveExpiryBatches({
        product, quantity, session, orderId: order._id, requestId,
        operationKeyPrefix: `special-order-reserve:${order._id}:${requestId}:${product._id}`, actor,
      }) : null;
    reservation.orderedQuantity = group.orderedQuantity;
    reservation.reservedQuantity = held + quantity;
    reservation.batchAllocations = [...priorBatchAllocations, ...(newBatchReservation?.allocations || [])];
    reservation.status = 'Active';
    reservation.updatedBy = actor;
    reservation.history.push({ action: 'Reserve', quantity, requestId, actor, batchAllocations: newBatchReservation?.allocations || [] });
    await reservation.save({ session });
    changes.push({ product: product._id, quantity });
  }
  return changes;
};

const applyStockOperation = async ({ order, session, actor, requestId, action }) => {
  const previous = await Operation.findOne({ specialOrder: order._id, requestId }).session(session);
  if (previous) {
    if (previous.action !== action) throw conflict('This request ID was used for a different stock action.');
    return { replayed: true, changes: previous.changes };
  }
  const changes = action === 'Reserve'
    ? await reserveOrderStock({ order, session, actor, requestId })
    : await releaseOrderReservations({ order, session, actor, requestId, action });
  await Operation.create([{ specialOrder: order._id, requestId, action, changes, actor }], { session });
  return { replayed: false, changes };
};

module.exports = { getStockAvailability, applyStockOperation };
