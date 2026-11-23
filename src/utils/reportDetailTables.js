import { getValidSales } from '../../shared/saleLifecycle.mjs';
import { getProductDisplayName } from './productDisplayName.js';

const asMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
};

const asStock = (value) => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
};

export const buildSalesReportRows = (sales, creditTransactions, specialOrderCollections) => {
  const creditBySale = new Map((creditTransactions || []).filter((credit) => credit?.orderId).map((credit) => [String(credit.orderId), credit]));
  const specialPaidByOrder = new Map();
  for (const payment of specialOrderCollections || []) {
    const orderId = String(payment?.specialOrderId || '');
    const cents = Number(payment?.amountCentavos);
    if (!orderId || !Number.isSafeInteger(cents) || cents < 1) continue;
    specialPaidByOrder.set(orderId, (specialPaidByOrder.get(orderId) || 0) + cents);
  }

  return getValidSales(sales).map((sale) => {
    const total = asMoney(sale.total);
    const isSpecial = sale.saleType === 'special-order' || Boolean(sale.specialOrderId);
    const isCredit = !isSpecial && String(sale.paymentMethod || '').toLowerCase() === 'credit';
    const credit = isCredit ? creditBySale.get(String(sale.sourceId || '')) : null;
    let paid = null;
    let remaining = null;
    let paymentStatus = 'Needs Review';

    if (isSpecial && specialPaidByOrder.has(String(sale.specialOrderId || ''))) {
      paid = specialPaidByOrder.get(String(sale.specialOrderId)) / 100;
      remaining = total === null || paid > total ? null : Math.round(total * 100 - paid * 100) / 100;
      paymentStatus = remaining === null ? 'Needs Review' : remaining === 0 ? 'Paid' : 'Partially Paid';
    } else if (isSpecial && sale.collectionSource === 'special_order_ledger') {
      // Do not turn an unavailable ledger into a fabricated zero payment.
      paymentStatus = 'Needs Review';
    } else if (isCredit && credit) {
      paid = asMoney(credit.amountPaid);
      remaining = asMoney(credit.remainingBalance);
      paymentStatus = total !== null && paid !== null && remaining !== null && Math.round((paid + remaining) * 100) === Math.round(total * 100)
        ? credit.status || sale.paymentStatus || 'Needs Review'
        : 'Needs Review';
    } else if (isCredit) {
      paymentStatus = 'Needs Review';
    } else if (total !== null && sale.paymentStatus === 'Paid') {
      // Immediate POS and legacy, non-ledger Special Order sales.
      paid = total;
      remaining = 0;
      paymentStatus = 'Paid';
    }

    return {
      id: sale.sourceId || sale.id,
      transactionId: sale.id || '—',
      date: sale.date,
      customer: sale.customerName || sale.customer || (isSpecial ? 'Special Order Customer' : 'Walk-in Customer'),
      saleType: isSpecial ? 'Special Order' : isCredit ? 'Credit' : 'Cash',
      total,
      paid,
      remaining,
      paymentStatus,
      fulfillment: isSpecial ? sale.specialOrderFulfillmentStatus || 'Not recorded' : '—',
    };
  });
};

export const buildInventoryReportRows = (products, categories = []) => (products || []).map((product) => ({
  id: product.id || product.code,
  sku: product.code || '—',
  name: getProductDisplayName(product, categories),
  category: product.category || '—',
  sellingUnit: product.sellingUnit || '—',
  physical: asStock(product.stock),
  reserved: asStock(product.reservedStock),
  available: asStock(product.availableToSell),
  status: product.isActive === false ? 'Inactive' : product.status || '—',
}));

export const filterAndSortReportRows = (rows, { search = '', filters = {}, sortKey, sortDirection = 'asc' } = {}) => {
  const needle = search.trim().toLocaleLowerCase();
  const filtered = (rows || []).filter((row) => (
    (!needle || Object.values(row).some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)))
    && Object.entries(filters).every(([key, value]) => !value || String(row[key] ?? '') === String(value))
  ));
  if (!sortKey) return filtered;
  return filtered.sort((left, right) => {
    const a = left[sortKey];
    const b = right[sortKey];
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    const comparison = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    return sortDirection === 'desc' ? -comparison : comparison;
  });
};

export const paginateReportRows = (rows, page, pageSize) => {
  const safeSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 10;
  const totalPages = Math.ceil(rows.length / safeSize);
  const currentPage = Math.min(Math.max(1, Number(page) || 1), Math.max(1, totalPages));
  return {
    currentPage,
    totalPages,
    rows: rows.slice((currentPage - 1) * safeSize, currentPage * safeSize),
  };
};
