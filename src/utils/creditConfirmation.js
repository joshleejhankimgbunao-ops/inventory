const formatPaymentMethod = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'gcash') return 'GCash';
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
};

const getCashierName = (sale, record) => {
  const cashier = sale?.cashier;
  return String(
    sale?.cashierName
    || cashier?.displayName
    || cashier?.name
    || cashier?.username
    || record?.cashierName
    || ''
  ).trim();
};

/** Builds a view-only confirmation from the authoritative linked Sale snapshot. */
export const buildCreditConfirmation = (record = {}) => {
  const sale = record?.orderId && typeof record.orderId === 'object' ? record.orderId : null;
  const saleId = String(sale?._id?._id || sale?._id || '').trim();
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const total = Number(sale?.totalAmount);

  if (!saleId || items.length === 0 || !Number.isFinite(total) || total < 0) return null;

  const paymentHistory = Array.isArray(record.paymentHistory) ? record.paymentHistory : [];
  const downPaymentEvent = paymentHistory.find((payment) => payment?.type === 'down_payment');
  const downPaymentAmount = record.downPaymentAmount ?? downPaymentEvent?.amount;
  const hasRecordedDownPayment = Number.isFinite(Number(downPaymentAmount));
  const additionalPayments = paymentHistory
    .filter((payment, index) => {
      if (payment?.type === 'down_payment') return false;

      // Some historical entries predate the explicit payment type. When the
      // first event exactly matches the saved original down payment, keep it
      // out of the subsequent-payment list instead of showing it twice.
      return !(!downPaymentEvent
        && index === 0
        && hasRecordedDownPayment
        && Number(payment?.amount) === Number(downPaymentAmount));
    })
    .map((payment) => ({
      amount: payment?.amount,
      paymentDate: payment?.paymentDate || null,
      method: formatPaymentMethod(payment?.method),
      reference: String(payment?.reference || '').trim(),
    }));
  const savedNetAmount = sale.netAmount ?? record.netAmount;
  const savedVatAmount = sale.vatAmount ?? record.vatAmount;
  const vatCalculationStatus = sale.vatCalculationStatus || (
    savedNetAmount !== null && savedNetAmount !== undefined
    && savedVatAmount !== null && savedVatAmount !== undefined
      ? 'calculated'
      : 'not_calculated'
  );
  const customerName = String(sale.customerName || record.customerName || '').trim();
  const customerDetails = sale.customerDetails && typeof sale.customerDetails === 'object'
    ? sale.customerDetails
    : {};
  const transaction = {
    id: String(record.orderReference || `TRX-${saleId.slice(-8).toUpperCase()}`).trim(),
    creditTransactionId: String(record.creditTransactionId || '').trim(),
    date: sale.createdAt || record.createdAt || null,
    cashier: getCashierName(sale, record),
    customerName,
    customerDetails,
    items: items.map((item, index) => ({
      ...item,
      id: item?.product ? String(item.product?._id || item.product) : `${saleId}-${index}`,
      qty: Number(item?.quantity ?? item?.qty ?? 0),
      price: Number(item?.unitPrice ?? item?.price ?? 0),
    })),
    total,
    paymentMethod: sale.paymentMethod || 'credit',
    paymentStatus: String(record.status || sale.paymentStatus || 'Partially Paid'),
    vatCalculationStatus,
    taxTreatment: sale.taxTreatment || null,
    vatMode: sale.vatMode || null,
    netAmount: vatCalculationStatus === 'not_calculated'
      ? null
      : (savedNetAmount ?? null),
    vatAmount: vatCalculationStatus === 'not_calculated'
      ? null
      : (savedVatAmount ?? null),
    grossAmount: sale.grossAmount ?? record.grossAmount ?? total,
    downPaymentAmount,
    additionalPayments,
    amountPaid: record.amountPaid,
    remainingBalance: record.remainingBalance,
    creditPaymentMode: formatPaymentMethod(
      downPaymentEvent?.method || record.creditPaymentMode,
    ),
    termDays: record.termDays ?? sale.creditTermDays,
    dueDate: record.dueDate || sale.dueDate || null,
  };

  return {
    transaction,
    customer: {
      name: customerName,
      address: String(customerDetails.address || '').trim(),
    },
  };
};
