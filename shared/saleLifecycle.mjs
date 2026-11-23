// Native ESM for Vite and Node >=20.19 (the existing Mongoose runtime minimum).
export const getSaleStatus = (sale) => sale?.status || 'completed';
export const isVoidedSale = (sale) => getSaleStatus(sale) === 'voided';
export const isValidSaleForReporting = (sale) => !isVoidedSale(sale);
export const getValidSales = (sales = []) => (Array.isArray(sales) ? sales : []).filter(isValidSaleForReporting);
// Financial Special Order sales are recorded before physical issue. Preserve the
// historical assumption only for legacy rows with no fulfillment projection.
export const isSalePhysicallyFulfilledForItemReporting = (sale) => (
  sale?.saleType !== 'special-order'
  || !sale?.specialOrderFulfillmentStatus
  || ['Picked Up', 'Delivered'].includes(sale.specialOrderFulfillmentStatus)
);
export const isImmediateSaleCollectionForReporting = (sale) => (
  isValidSaleForReporting(sale)
  && String(sale?.paymentMethod || '').toLowerCase() !== 'credit'
  && sale?.collectionSource !== 'special_order_ledger'
);

// saleStatus is projected from the persisted linked Sale by the backend.
// Do not infer lifecycle from Credit status, balances, or a local History cache.
export const isValidCreditCollectionForReporting = (credit) => (
  credit?.saleStatus !== 'voided'
);
// Special Order payment events are reported from their authoritative payment
// ledger. Their linked CreditTransaction mirrors those entries for receivables
// and overdue management, so its paymentHistory must not be counted again as
// collections.
export const isCreditPaymentCollectionForReporting = (credit) => (
  isValidCreditCollectionForReporting(credit)
  && credit?.collectionSource !== 'special_order_ledger'
);
