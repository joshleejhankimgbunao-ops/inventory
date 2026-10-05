const { getSaleStatus } = require('../../../shared/saleLifecycle.mjs');
const Product = require('../models/Product');
const Sale = require('../models/Sale');

const objectIdString = (value) => String(value?._id || value || '');
const isObjectId = (value) => /^[a-f\d]{24}$/i.test(objectIdString(value));

// Read-only foundation. Authorization, live connectivity, and the same checks
// inside a write transaction are still required by any future void endpoint.
const getSaleVoidEligibility = (sale) => {
  const deny = (reason) => ({ eligible: false, reason });
  if (!isObjectId(sale?._id)) return deny('Sale must be persisted on the server.');
  if (getSaleStatus(sale) !== 'completed') return deny('Sale is not completed or is already voided.');
  if (sale.specialOrderId || sale.specialOrderNumber || sale.saleType === 'special-order'
      || String(sale.clientRequestId || '').startsWith('special-order:')) {
    return deny('Special Order sales are not eligible.');
  }
  if (String(sale.paymentMethod || '').toLowerCase() !== 'cash'
      || sale.creditTransactionId || sale.creditTermDays != null || sale.dueDate
      || (sale.paymentStatus && sale.paymentStatus !== 'Paid')) {
    return deny('Only regular Cash Sales are eligible.');
  }
  if (sale.saleType && sale.saleType !== 'regular') return deny('Sale is not regular.');
  if (!sale.items?.length || !sale.items.every((item) => (
    isObjectId(item.product) && Number.isSafeInteger(item.quantity) && item.quantity > 0
  ))) return deny('Sale has missing or invalid product linkage or quantities.');
  return { eligible: true, reason: '' };
};

const checkSaleVoidEligibility = async (saleOrId, { session = null } = {}) => {
  const saleId = objectIdString(saleOrId?._id || saleOrId);
  if (!isObjectId(saleId)) {
    return { eligible: false, reason: 'Sale must be persisted on the server.' };
  }

  let saleQuery = Sale.findById(saleId);
  if (session) saleQuery = saleQuery.session(session);
  const sale = await saleQuery;
  if (!sale) return { eligible: false, reason: 'Sale must be persisted on the server.' };

  const eligibility = getSaleVoidEligibility(sale);
  if (!eligibility.eligible) return eligibility;
  const ids = [...new Set(sale.items.map((item) => objectIdString(item.product)))];
  let productQuery = Product.countDocuments({ _id: { $in: ids } });
  if (session) productQuery = productQuery.session(session);
  const count = await productQuery;
  return count === ids.length ? eligibility : { eligible: false, reason: 'A referenced product no longer exists.' };
};

module.exports = { getSaleVoidEligibility, checkSaleVoidEligibility };
