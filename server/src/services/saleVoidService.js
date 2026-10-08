const Sale = require('../models/Sale');
const Product = require('../models/Product');
const { withAuditedTransaction } = require('./auditedTransaction');
const { checkSaleVoidEligibility } = require('./saleVoidEligibility');
const { publishSaleUpdated, publishInventoryUpdated } = require('./realtimeService');

const objectIdString = (value) => String(value?._id || value || '');
const displaySaleId = (sale) => `TRX-${objectIdString(sale?._id).slice(-8).toUpperCase()}`;
const actorName = (user) => user?.name || user?.displayName || user?.username || 'Unknown';

const aggregateSaleItems = (items = []) => {
  const byProduct = new Map();
  items.forEach((item) => {
    const productId = objectIdString(item.product);
    const existing = byProduct.get(productId);
    if (existing) {
      existing.quantity += Number(item.quantity);
      return;
    }
    byProduct.set(productId, {
      productId,
      quantity: Number(item.quantity),
      code: String(item.code || '').trim().toUpperCase(),
      name: String(item.name || '').trim(),
    });
  });
  return [...byProduct.values()];
};

const executeSaleVoid = async ({
  saleId,
  reason,
  requestId,
  supportingProof = null,
  user,
  ipAddress = '',
  userAgent = '',
}, dependencies = {}) => {
  const runTransaction = dependencies.runTransaction || withAuditedTransaction;
  const findSale = dependencies.findSale || (async (id, session) => Sale.findById(id).session(session));
  const checkEligibility = dependencies.checkEligibility || checkSaleVoidEligibility;
  const claimSale = dependencies.claimSale || ((id, voidInfo, session) => Sale.findOneAndUpdate(
    { _id: id, status: { $ne: 'voided' } },
    { $set: { status: 'voided', voidInfo } },
    { new: true, runValidators: true, session }
  ));
  const restoreProduct = dependencies.restoreProduct || ((id, quantity, session) => Product.findOneAndUpdate(
    { _id: id },
    { $inc: { stock: quantity } },
    { new: true, runValidators: true, session }
  ));
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
    const voidInfo = {
      reason,
      voidedAt: now,
      voidedBy: user._id,
      voidedByName: actorName(user),
      authorizationMethod: 'role_authorized',
      requestId,
      supportingProof,
    };
    const voidedSale = await claimSale(saleId, voidInfo, session);
    if (!voidedSale) {
      const error = new Error('Sale lifecycle changed while the void was being processed. Refresh and retry.');
      error.status = 409;
      throw error;
    }

    const saleLabel = displaySaleId(voidedSale);
    const restorations = [];
    for (const item of aggregateSaleItems(voidedSale.items)) {
      const product = await restoreProduct(item.productId, item.quantity, session);
      if (!product) {
        const error = new Error(`Referenced product ${item.code || item.productId} no longer exists.`);
        error.status = 409;
        throw error;
      }
      const stockAfter = Number(product.stock);
      const stockBefore = stockAfter - item.quantity;
      const code = String(product.sku || item.code || '').trim().toUpperCase();
      await writeInventoryLog({
        user,
        action: 'ADD',
        code,
        productRef: product._id,
        quantity: item.quantity,
        stockBefore,
        stockAfter,
        details: `SALE VOID RESTORE — ${saleLabel} — +${item.quantity} ${code || item.name}; reason: ${reason}`,
      });
      restorations.push({
        productId: objectIdString(product._id),
        code,
        quantity: item.quantity,
        stockBefore,
        stockAfter,
      });
    }

    const restoredSummary = restorations.map((entry) => `${entry.code || entry.productId} +${entry.quantity}`).join(', ');
    await writeActivityLog({
      user,
      action: 'SALE_VOIDED',
      details: `${saleLabel} voided. Reason: ${reason}. Supporting proof: ${supportingProof ? 'attached' : 'none'}. Restored: ${restoredSummary}.`,
      ipAddress,
      userAgent,
    });

    afterCommit(() => publishSale({ saleId: voidedSale._id, cashierId: voidedSale.cashier }));
    afterCommit(() => publishInventory({
      reason: 'sale.voided',
      productCodes: restorations.map((entry) => entry.code).filter(Boolean),
    }));

    return { sale: voidedSale, replayed: false, restorations };
  });
};

module.exports = { aggregateSaleItems, executeSaleVoid };
