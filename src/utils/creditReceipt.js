const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  gcash: 'GCash',
  cheque: 'Cheque',
  'bank transfer': 'Bank Transfer',
  other: 'Other',
};

const getRecordedByName = (payment = {}, record = {}) => {
  const user = payment.recordedByUser || payment.recordedById || {};
  return String(
    user.name
    || user.displayName
    || user.username
    || payment.recordedBy
    || record.cashierName
    || ''
  ).trim();
};

const formatPaymentMethod = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return PAYMENT_METHOD_LABELS[normalized] || String(value || '').trim();
};

export const isFullyPaidCreditTransaction = (record) => {
  return String(record?.status || '').trim().toLowerCase() === 'paid'
    && Number(record?.remainingBalance || 0) <= 0;
};

export const buildCreditReceiptTransaction = (record = {}) => {
  const payments = Array.isArray(record.paymentHistory) ? record.paymentHistory : [];
  const finalizedPayment = payments.length > 0 ? payments[payments.length - 1] : {};
  const sale = record.orderId && typeof record.orderId === 'object' ? record.orderId : {};
  const items = Array.isArray(sale.items) ? sale.items : [];

  return {
    id: String(record.creditTransactionId || '').trim(),
    receiptType: 'credit-payment',
    date: finalizedPayment.paymentDate || record.updatedAt || '',
    cashier: getRecordedByName(finalizedPayment, record),
    customerName: String(record.customerName || '').trim(),
    paymentMethod: 'Credit',
    paymentStatus: String(record.status || '').trim(),
    creditPaymentMode: formatPaymentMethod(finalizedPayment.method || record.creditPaymentMode),
    paymentReference: String(finalizedPayment.reference || '').trim(),
    orderReference: String(record.orderReference || '').trim(),
    total: Number(record.totalAmount || 0),
    amountPaid: Number(record.amountPaid || 0),
    remainingBalance: Number(record.remainingBalance || 0),
    balance: Number(record.remainingBalance || 0),
    netAmount: Number(record.netAmount ?? record.totalAmount ?? 0),
    vatAmount: Number(record.vatAmount || 0),
    grossAmount: Number(record.grossAmount ?? record.totalAmount ?? 0),
    termDays: Number(record.termDays || 0) || null,
    dueDate: record.dueDate || null,
    items: items.map((item, index) => ({
      id: item.product ? String(item.product) : `${record.creditTransactionId || 'credit'}-${index}`,
      code: String(item.code || '').trim(),
      name: String(item.name || 'Item').trim(),
      qty: Number(item.quantity || 0),
      price: Number(item.unitPrice || 0),
      subtotal: Number(item.subtotal ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))) || 0,
    })),
  };
};
