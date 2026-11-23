const Sale = require('../models/Sale');
const Product = require('../models/Product');
const ExpiryBatch = require('../models/ExpiryBatch');
const ExpiryBatchMovement = require('../models/ExpiryBatchMovement');
const { withAuditedTransaction } = require('./auditedTransaction');
const { checkSaleVoidEligibility } = require('./saleVoidEligibility');
const { publishSaleUpdated, publishInventoryUpdated } = require('./realtimeService');
const { inspectBatchState, restoreSaleBatches } = require('./expiryBatchAllocationService');
const { isBatchInActivePeriod } = require('./expiryBatchLifecycle');

const objectIdString = (value) => String(value?._id || value || '');
const displaySaleId = (sale) => `TRX-${objectIdString(sale?._id).slice(-8).toUpperCase()}`;
const actorName = (user) => user?.name || user?.displayName || user?.username || 'Unknown';

const aggregateSaleItems = (items = []) => {
  const byProduct = new Map();
  items.forEach((item) => {
    const productId = objectIdString(item.product);
    const hasBatchAllocation = Boolean(
      item.batchVerification?.verifiedAllocations?.length
      || item.batchVerification?.proposedAllocations?.length
    );
    const existing = byProduct.get(productId);
    if (existing) {
      existing.quantity += Number(item.quantity);
      existing.hasBatchAllocation ||= hasBatchAllocation;
      return;
    }
    byProduct.set(productId, {
      productId,
      quantity: Number(item.quantity),
      code: String(item.code || '').trim().toUpperCase(),
      name: String(item.name || '').trim(),
      hasBatchAllocation,
    });
  });
  return [...byProduct.values()];
};

const executeSaleVoid = async ({
  saleId,
  reason,
  requestId,
  supportingProof = null,
  supportingProofs = [],
  user,
  ipAddress = '',
  userAgent = '',
}, dependencies = {}) => {
  const runTransaction = dependencies.runTransaction || withAuditedTransaction;
  const findSale = dependencies.findSale || (async (id, session) => Sale.findById(id).session(session));
  const checkEligibility = dependencies.checkEligibility || checkSaleVoidEligibility;
  const claimSale = dependencies.claimSale || ((id, voidInfo, session, voidRequestReview) => Sale.findOneAndUpdate(
    { _id: id, status: { $ne: 'voided' } },
    { $set: {
      status: 'voided',
      voidInfo,
      ...(voidRequestReview ? {
        'voidRequest.status': 'approved',
        'voidRequest.reviewedBy': voidRequestReview.reviewedBy,
        'voidRequest.reviewedByName': voidRequestReview.reviewedByName,
        'voidRequest.reviewedAt': voidRequestReview.reviewedAt,
        'voidRequest.declineReason': '',
      } : {}),
    } },
    { new: true, runValidators: true, session }
  ));
  const restoreProduct = dependencies.restoreProduct || ((id, quantity, session) => Product.findOneAndUpdate(
    { _id: id },
    { $inc: { stock: quantity } },
    { new: true, runValidators: true, session }
  ));
  // Keep the established custom-restorer unit-test seam independent from a
  // live database; production reads the authoritative product and batch ledger.
  const findProduct = dependencies.findProduct || (dependencies.restoreProduct
    ? async () => null
    : ((id, session) => Product.findById(id).session(session)));
  const findSaleBatchMovements = dependencies.findSaleBatchMovements || ((saleId, productId, session) => ExpiryBatchMovement.find({
    sourceType: 'Sale', sourceId: saleId, product: productId, type: { $in: ['SALE', 'SPECIAL_ORDER_CONSUME'] },
  }).session(session).lean());
  const publishSale = dependencies.publishSale || publishSaleUpdated;
  const publishInventory = dependencies.publishInventory || publishInventoryUpdated;

  return runTransaction(async ({ session, writeActivityLog, writeInventoryLog, afterCommit }) => {
    const sale = await findSale(saleId, session);
    if (!sale) {
      const error = new Error('Sale not found.');
      error.status = 404;
      throw error;
    }

    if (String(sale.status || 'completed').toLowerCase() === 'voided') {
      return { sale, replayed: true, restorations: [] };
    }

    const eligibility = await checkEligibility(saleId, { session });
    if (!eligibility.eligible) {
      const error = new Error(eligibility.reason || 'This Sale is not eligible to be voided.');
      error.status = 409;
      throw error;
    }

    const now = new Date();
    const requestProofs = sale.voidRequest?.status === 'pending'
      ? (sale.voidRequest.supportingProofs?.length ? sale.voidRequest.supportingProofs : sale.voidRequest.supportingProof ? [sale.voidRequest.supportingProof] : [])
      : [];
    const effectiveSupportingProofs = supportingProofs?.length ? supportingProofs : supportingProof ? [supportingProof] : requestProofs;
    const effectiveSupportingProof = effectiveSupportingProofs[0] || null;
    const voidInfo = {
      reason,
      voidedAt: now,
      voidedBy: user._id,
      voidedByName: actorName(user),
      authorizationMethod: 'role_authorized',
      requestId,
      supportingProof: effectiveSupportingProof,
      supportingProofs: effectiveSupportingProofs,
    };
    const voidRequestReview = sale.voidRequest?.status === 'pending' ? {
      reviewedBy: user._id,
      reviewedByName: actorName(user),
      reviewedAt: now,
    } : null;
    const voidedSale = await claimSale(saleId, voidInfo, session, voidRequestReview);
    if (!voidedSale) {
      const error = new Error('Sale lifecycle changed while the void was being processed. Refresh and retry.');
      error.status = 409;
      throw error;
    }

    const saleLabel = displaySaleId(voidedSale);
    const restorations = [];
    for (const item of aggregateSaleItems(voidedSale.items)) {
      const existingProduct = await findProduct(item.productId, session);
      let batchMovementRefs = [];
      let reconciliationRequired = false;
      if (existingProduct?.expiryTrackingEnabled && existingProduct.expiryBatchReconciled) {
        const batchState = await inspectBatchState(existingProduct, session);
        const saleMovements = await findSaleBatchMovements(voidedSale._id, existingProduct._id, session);
        const allocatedQuantity = saleMovements.reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
        const allocatedBatchIds = [...new Set(saleMovements.map((movement) => objectIdString(movement.batch)).filter(Boolean))];
        const allocatedBatches = allocatedBatchIds.length
          ? await ExpiryBatch.find({ _id: { $in: allocatedBatchIds }, product: existingProduct._id })
            .select('_id trackingPeriodId trackingPeriodClosedAt').session(session).lean()
          : [];
        const activeBatchIds = new Set(allocatedBatches
          .filter((batch) => isBatchInActivePeriod(existingProduct, batch))
          .map((batch) => objectIdString(batch._id)));
        const allocationsAreCurrent = saleMovements.length > 0
          && allocatedBatchIds.length === saleMovements.length
          && saleMovements.every((movement) => activeBatchIds.has(objectIdString(movement.batch)));
        if (batchState.valid && allocatedQuantity === item.quantity && allocationsAreCurrent) {
          const restoredMovements = await restoreSaleBatches({
            product: existingProduct,
            allocations: saleMovements.map((movement) => ({ batch: movement.batch, batchId: movement.batchId, expiryDate: movement.expiryDate, quantity: movement.quantity })),
            saleId: voidedSale._id,
            requestId,
            operationKeyPrefix: `sale-void:${voidedSale._id}:${requestId}:${existingProduct._id}`,
            actor: user,
            session,
          });
          batchMovementRefs = restoredMovements.map((movement) => movement._id);
        } else {
          // Historical stock is restored without guessing its original lot.
          reconciliationRequired = true;
        }
      } else if (existingProduct && item.hasBatchAllocation) {
        // Tracking may have been intentionally disabled after the sale. Preserve
        // the original allocation and restore aggregate stock only; the dormant
        // batch ledger must be physically verified before expiry tracking resumes.
        reconciliationRequired = true;
      }
      const product = await restoreProduct(item.productId, item.quantity, session);
      if (!product) {
        const error = new Error(`Referenced product ${item.code || item.productId} no longer exists.`);
        error.status = 409;
        throw error;
      }
      if (reconciliationRequired) {
        await Product.updateOne({ _id: product._id }, { $set: {
          expiryBatchReconciled: false,
          expiryBatchReconciledAt: null,
          expiryBatchReconciledBy: null,
        }, ...(product.expiryTrackingEnabled ? { $inc: { expiryUnassignedStock: item.quantity } } : {}) }, { session });
      }
      const stockAfter = Number(product.stock);
      const stockBefore = stockAfter - item.quantity;
      const code = String(product.sku || item.code || '').trim().toUpperCase();
      await writeInventoryLog({
        user,
        action: 'ADD',
        code,
        productRef: product._id,
        saleRef: voidedSale._id,
        quantity: item.quantity,
        stockBefore,
        stockAfter,
        batchMovementRefs,
        details: `SALE VOID RESTORE — ${saleLabel} — +${item.quantity} ${code || item.name}; reason: ${reason}${reconciliationRequired ? '. Historical batch records were preserved; verify batches before expiry tracking resumes.' : ''}`,
      });
      restorations.push({
        productId: objectIdString(product._id),
        code,
        quantity: item.quantity,
        stockBefore,
        stockAfter,
        batchReconciliationRequired: reconciliationRequired,
      });
    }

    const restoredSummary = restorations.map((entry) => `${entry.code || entry.productId} +${entry.quantity}${entry.batchReconciliationRequired ? ' (expiry batch verification needed)' : ''}`).join(', ');
    await writeActivityLog({
      user,
      action: 'SALE_VOIDED',
      details: `${saleLabel} voided. Reason: ${reason}. Supporting proof: ${effectiveSupportingProof ? 'attached' : 'none'}. Restored: ${restoredSummary}.`,
      ipAddress,
      userAgent,
    });

    afterCommit(() => publishSale({
      saleId: voidedSale._id,
      cashierId: voidedSale.cashier,
      changeType: voidRequestReview ? 'sale.void-request.approved' : 'sale.voided',
    }));
    afterCommit(() => publishInventory({
      reason: 'sale.voided',
      productCodes: restorations.map((entry) => entry.code).filter(Boolean),
    }));

    return { sale: voidedSale, replayed: false, restorations };
  });
};

module.exports = { aggregateSaleItems, executeSaleVoid };
