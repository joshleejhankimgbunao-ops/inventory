import { getValidSales } from '../../shared/saleLifecycle.mjs';

const toNonNegativeMoney = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
};

/**
 * Returns recognized sales revenue excluding separately recorded VAT.
 * The API's netAmount is authoritative when calculated. Legacy and agreed-price
 * Special Order rows fall back to the recorded sale total, less VAT only when
 * a VAT amount was actually recorded.
 */
export const getRecognizedSalesRevenue = (sale) => {
  const calculationStatus = String(sale?.vatCalculationStatus || '').toLowerCase();
  const netAmount = toNonNegativeMoney(sale?.netAmount);
  if (calculationStatus !== 'not_calculated' && netAmount !== null) return netAmount;

  const total = toNonNegativeMoney(sale?.total ?? sale?.totalAmount);
  if (total === null) return null;

  const vatAmount = toNonNegativeMoney(sale?.vatAmount);
  if (vatAmount !== null) {
    if (vatAmount > total) return null;
    return Math.round((total - vatAmount) * 100) / 100;
  }

  return total;
};

const isFinalizedSale = (sale) => {
  // Older valid-sale API projections may omit status; the persisted Sale model
  // defaults those records to completed. Explicit non-completed states fail closed.
  const status = String(sale?.status || 'completed').trim().toLowerCase();
  return status === 'completed';
};

const getSaleIdentity = (sale) => String(sale?.sourceId || sale?.id || '').trim();

const getSpecialOrderIdentity = (sale) => (
  String(sale?.specialOrderId || '').trim()
  || (sale?.saleType === 'special-order' ? String(sale?.specialOrderNumber || '').trim() : '')
);

/** Sums unique finalized Sale records; payment events are deliberately excluded. */
export const sumRecognizedSalesRevenue = (sales = []) => {
  const seenSaleIds = new Set();
  const seenSpecialOrders = new Set();

  const totalCents = getValidSales(Array.isArray(sales) ? sales : []).reduce((sum, sale) => {
    if (!isFinalizedSale(sale)) return sum;

    const saleIdentity = getSaleIdentity(sale);
    if (saleIdentity && seenSaleIds.has(saleIdentity)) return sum;

    const specialOrderIdentity = getSpecialOrderIdentity(sale);
    if (specialOrderIdentity && seenSpecialOrders.has(specialOrderIdentity)) return sum;

    const amount = getRecognizedSalesRevenue(sale);
    if (amount === null) return sum;

    if (saleIdentity) seenSaleIds.add(saleIdentity);
    if (specialOrderIdentity) seenSpecialOrders.add(specialOrderIdentity);
    return sum + Math.round(amount * 100);
  }, 0);

  return totalCents / 100;
};

export const sumRecognizedSalesRevenueInPeriod = (sales = [], period) => {
  if (!period?.previousStart || !period?.previousEnd) return 0;
  const start = new Date(period.previousStart).getTime();
  const end = new Date(period.previousEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  return sumRecognizedSalesRevenue((Array.isArray(sales) ? sales : []).filter((sale) => {
    const saleDate = new Date(sale?.date).getTime();
    return Number.isFinite(saleDate) && saleDate >= start && saleDate < end;
  }));
};
