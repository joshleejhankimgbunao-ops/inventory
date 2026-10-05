// Native ESM for Vite and Node >=20.19 (the existing Mongoose runtime minimum).
export const getSaleStatus = (sale) => sale?.status || 'completed';
export const isVoidedSale = (sale) => getSaleStatus(sale) === 'voided';
export const isValidSaleForReporting = (sale) => !isVoidedSale(sale);
export const getValidSales = (sales = []) => (Array.isArray(sales) ? sales : []).filter(isValidSaleForReporting);

// saleStatus is projected from the persisted linked Sale by the backend.
// Do not infer lifecycle from Credit status, balances, or a local History cache.
export const isValidCreditCollectionForReporting = (credit) => (
  credit?.saleStatus !== 'voided'
);
