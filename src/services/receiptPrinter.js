const DEFAULT_RECEIPT_PRINTER_URL = import.meta.env?.VITE_RECEIPT_PRINTER_URL || 'http://127.0.0.1:8787';
const SINGLE_PRINT_TIMEOUT_MS = 10000;
const RECEIPT_PRINT_TIMEOUT_MS = 10000;

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeReceiptItem = (item) => {
  const qty = Number(item?.qty ?? item?.quantity ?? 0) || 0;
  const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
  const subtotal = Number(item?.subtotal ?? (qty * unitPrice)) || 0;
  const baseName = String(item?.name || '').trim();
  const brand = String(item?.brand || '').trim();
  const color = String(item?.color || '').trim();
  const label = [brand, baseName].filter(Boolean).join(' ').trim() || baseName || 'Item';

  return {
    label: color ? `${label} — ${color}` : label,
    code: String(item?.code || '').trim(),
    qty,
    unitPrice,
    subtotal,
  };
};

const normalizeReceiptTransaction = (transaction = {}, settings = {}, { isReprint = false } = {}) => {
  const items = Array.isArray(transaction?.items) ? transaction.items.map(normalizeReceiptItem) : [];
  const paymentMethod = String(transaction?.paymentMethod || '').trim();
  const balanceSource = transaction?.remainingBalance ?? transaction?.balance;
  const balance = toOptionalNumber(balanceSource);
  const cash = toOptionalNumber(transaction?.cash ?? transaction?.cashTendered);
  const change = toOptionalNumber(transaction?.change);
  const amountPaid = toOptionalNumber(transaction?.amountPaid);

  return {
    store: {
      name: String(settings?.storeName || 'Tableria La Confianza').trim(),
      address: String(settings?.storeAddress || '').trim(),
      contactPhone: String(settings?.contactPhone || '').trim(),
      contactPhoneSecondary: String(settings?.contactPhoneSecondary || '').trim(),
    },
    receipt: {
      id: String(transaction?.id || transaction?.receiptNumber || transaction?.transactionId || '').trim(),
      date: String(transaction?.date || transaction?.createdAt || '').trim(),
      cashier: String(transaction?.cashier || transaction?.cashierName || '').trim(),
      paymentMethod,
      documentType: String(transaction?.documentType || '').trim(),
      status: String(transaction?.status || '').trim().toLowerCase(),
      voidInfo: transaction?.voidInfo ? {
        reason: String(transaction.voidInfo.reason || '').trim(),
        voidedAt: transaction.voidInfo.voidedAt ? String(transaction.voidInfo.voidedAt) : '',
      } : null,
      transactionReference: String(transaction?.transactionReference?.referenceNumber || '').trim(),
      paymentStatus: String(transaction?.paymentStatus || '').trim(),
      customerName: String(transaction?.customerName || '').trim(),
      specialOrderNumber: String(transaction?.specialOrderNumber || '').trim(),
      orderReference: String(transaction?.orderReference || '').trim(),
      paymentReference: String(transaction?.paymentReference || '').trim(),
      dueDate: transaction?.dueDate ? String(transaction.dueDate) : '',
      creditPaymentMode: String(transaction?.creditPaymentMode || transaction?.modeOfPayment || '').trim(),
      termDays: transaction?.termDays ?? null,
      balance: Number.isFinite(balance) ? balance : null,
      amountPaid: Number.isFinite(amountPaid) ? amountPaid : null,
      total: Number(transaction?.total ?? transaction?.totalAmount ?? 0) || 0,
      cash,
      change,
      netAmount: Number(transaction?.netAmount ?? transaction?.total ?? transaction?.totalAmount ?? 0) || 0,
      vatAmount: Number(transaction?.vatAmount || 0) || 0,
      grossAmount: Number(transaction?.grossAmount ?? transaction?.total ?? transaction?.totalAmount ?? 0) || 0,
      isReprint: Boolean(isReprint),
      items,
    },
  };
};

const postToLocalPrinterService = async (payload, timeoutMs = SINGLE_PRINT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${DEFAULT_RECEIPT_PRINTER_URL}/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok === false) {
      const message = body?.message || `Printer service error (${response.status})`;
      const error = new Error(message);
      error.status = response.status || 500;
      throw error;
    }

    return body || { ok: true };
  } catch (error) {
    if (error?.name === 'AbortError' || /aborted/i.test(String(error?.message || ''))) {
      const timeoutError = new Error('Printer service timed out. Please try again.');
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const buildReceiptPrintPayload = (transaction = {}, settings = {}, options = {}) => normalizeReceiptTransaction(transaction, settings, options);

export const printDocument = async ({ lines } = {}) => {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => String(line ?? ''))
    : [];

  if (normalizedLines.length === 0) {
    throw new Error('At least one print line is required.');
  }

  await postToLocalPrinterService({ lines: normalizedLines });
  return { ok: true, source: 'local-service', payload: { lines: normalizedLines } };
};

export const printReceipt = async ({
  transaction,
  settings,
  isReprint = false,
} = {}) => {
  const payload = buildReceiptPrintPayload(transaction, settings, { isReprint });

  const result = await postToLocalPrinterService(payload, RECEIPT_PRINT_TIMEOUT_MS);
  return { ...result, ok: true, source: 'local-service', payload };
};
