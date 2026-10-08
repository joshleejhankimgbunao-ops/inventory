const mongoose = require('mongoose');
const { getSaleStatus } = require('../../../shared/saleLifecycle.mjs');
const { getSaleVoidEligibility } = require('../services/saleVoidEligibility');
const { executeSaleVoid } = require('../services/saleVoidService');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Partner = require('../models/Partner');
const CreditTransaction = require('../models/CreditTransaction');
const { writeActivityLog, writeInventoryLog } = require('../services/logService');
const { publishSaleCreated, publishInventoryUpdated, publishCreditTransactionsUpdated } = require('../services/realtimeService');
const { normalizeVatMode, computeTransactionVatBreakdown, toMoney } = require('../utils/vat');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoneyToCentavos } = require('../utils/moneyValidation');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');
const {
  TRANSACTION_REFERENCE_MAX_LENGTH,
  TRANSACTION_REFERENCE_NUMERIC_MESSAGE,
  isValidTransactionReferenceNumber,
} = require('../../../shared/transactionReference.cjs');
const { uploadDocument, removeDocument, getDocument } = require('../services/transactionSupportingDocument');
const { uploadProof, removeProof, getProof } = require('../services/saleVoidProof');
const { isObjectNotFoundError } = require('../services/r2StorageService');

const MIN_CREDIT_TERM_DAYS = 1;
const MAX_CREDIT_TERM_DAYS = 60;
const CREDIT_PAYMENT_MODE_LABELS = {
  cash: 'Cash',
  gcash: 'GCash',
  cheque: 'Cheque',
  'bank transfer': 'Bank Transfer',
  other: 'Other',
};

const normalizePaymentMethod = (value) => {
  const normalized = String(value || 'cash').trim().toLowerCase();
  if (['cash', 'gcash', 'card', 'other', 'credit'].includes(normalized)) {
    return normalized;
  }
  return '';
};

const parseCreditTermDays = (value) => {
  return parseStrictWholeNumber(value, {
    min: MIN_CREDIT_TERM_DAYS,
    max: MAX_CREDIT_TERM_DAYS,
  });
};

const resolveCreditPaymentMode = ({ mode, other }) => {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CREDIT_PAYMENT_MODE_LABELS, normalizedMode)) {
    return null;
  }

  if (normalizedMode !== 'other') {
    return CREDIT_PAYMENT_MODE_LABELS[normalizedMode];
  }

  const customMode = normalizeHumanReadable(other);
  return customMode || null;
};

const computeDueDate = ({ startDate = new Date(), termDays }) => {
  const dueDate = new Date(startDate);
  dueDate.setHours(0, 0, 0, 0);
  dueDate.setDate(dueDate.getDate() + Number(termDays || 0));
  return dueDate;
};

const generateCreditTransactionId = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CR-${y}${m}${d}-${suffix}`;
};

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const normalizeClientRequestId = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const resolveCashierName = (user) => {
  return user?.name || user?.displayName || user?.username || 'Unknown';
};

const publicTransactionReference = (reference) => {
  if (!reference) return null;
  const document = reference.supportingDocument;
  return {
    referenceNumber: String(reference.referenceNumber || '').trim(),
    supportingDocument: document ? {
      originalName: document.originalName,
      mimeType: document.mimeType,
      size: document.size,
      uploadedAt: document.uploadedAt,
    } : null,
  };
};

const publicVoidSupportingProof = (proof) => proof ? {
  originalName: proof.originalName,
  mimeType: proof.mimeType,
  size: proof.size,
  uploadedAt: proof.uploadedAt,
} : null;

const mapSaleToTransactionContract = (sale) => {
  const saleObj = typeof sale.toObject === 'function' ? sale.toObject() : sale;
  const rawSaleId = String(saleObj?._id || '');
  const displayId = rawSaleId
    ? `TRX-${rawSaleId.slice(-8).toUpperCase()}`
    : `TRX-${Date.now().toString().slice(-8)}`;
  const cashierLabel = saleObj?.cashier?.name || saleObj?.cashier?.displayName || saleObj?.cashier?.username || saleObj?.cashierName || 'Unknown';
  const cashierUser = saleObj?.cashier?._id
    ? {
      id: String(saleObj.cashier._id),
      displayName: saleObj.cashier.displayName || '',
      name: saleObj.cashier.name || '',
      username: saleObj.cashier.username || '',
      role: saleObj.cashier.role || '',
    }
    : null;
  const creditPaymentModeMatch = String(saleObj?.notes || '').trim().match(/preferred mode of payment:\s*(.+)$/i);
  const creditPaymentMode = creditPaymentModeMatch
    ? String(creditPaymentModeMatch[1] || '').trim()
    : '';

  return {
    id: displayId,
    sourceId: rawSaleId,
    clientRequestId: saleObj.clientRequestId || '',
    status: getSaleStatus(saleObj),
    voidEligible: getSaleVoidEligibility(saleObj).eligible,
    voidInfo: saleObj.voidInfo ? {
      reason: saleObj.voidInfo.reason,
      voidedAt: saleObj.voidInfo.voidedAt,
      voidedBy: saleObj.voidInfo.voidedBy,
      voidedByName: saleObj.voidInfo.voidedByName,
      authorizationMethod: saleObj.voidInfo.authorizationMethod,
      requestId: saleObj.voidInfo.requestId,
      supportingProof: publicVoidSupportingProof(saleObj.voidInfo.supportingProof),
    } : null,
    date: saleObj.createdAt,
    cashierId: String(saleObj?.cashier?._id || saleObj?.cashier || ''),
    cashierUser,
    cashier: cashierLabel,
    cashierRole: String(saleObj?.cashier?.role || '').toLowerCase(),
    total: Number(saleObj.totalAmount || 0),
    paymentMethod: saleObj.paymentMethod || 'cash',
    paymentStatus: saleObj.paymentStatus || 'Paid',
    saleType: saleObj.saleType || (saleObj.specialOrderId ? 'special-order' : 'regular'),
    specialOrderId: saleObj.specialOrderId ? String(saleObj.specialOrderId) : '',
    specialOrderNumber: saleObj.specialOrderNumber || '',
    creditTransactionId: saleObj.creditTransactionId || '',
    netAmount: Number(saleObj.netAmount || saleObj.totalAmount || 0),
    vatAmount: Number(saleObj.vatAmount || 0),
    grossAmount: Number(saleObj.grossAmount || saleObj.totalAmount || 0),
    pricingMode: saleObj.pricingMode || 'inclusive',
    vatMode: saleObj.vatMode || 'vatable',
    customerIsVatExempt: false,
    hasVatApplicableItems: Boolean(saleObj.hasVatApplicableItems),
    hasVatableItems: Boolean(saleObj.hasVatableItems),
    hasZeroRatedItems: Boolean(saleObj.hasZeroRatedItems),
    vatRatesUsed: Array.isArray(saleObj.vatRatesUsed) ? saleObj.vatRatesUsed : [],
    customerId: saleObj.customer ? String(saleObj.customer) : '',
    customerName: saleObj.customerName || '',
    creditPaymentMode,
    termDays: Number(saleObj.creditTermDays || 0) || null,
    dueDate: saleObj.dueDate || null,
    cashImpactAmount: saleObj.paymentMethod === 'credit' ? 0 : Number(saleObj.totalAmount || 0),
    notes: saleObj.notes || '',
    transactionReference: publicTransactionReference(saleObj.transactionReference),
    isArchived: Boolean(saleObj.isArchived),
    items: (saleObj.items || []).map((item, index) => ({
      id: item.product ? String(item.product) : `${saleObj._id}-${index}`,
      code: item.code || '',
      name: item.name,
      qty: Number(item.quantity || 0),
      price: Number(item.unitPrice || 0),
      subtotal: Number(item.subtotal || 0),
    })),
  };
};

const listSales = async (req, res, next) => {
  try {
    const includeArchived = parseBool(req.query?.includeArchived, true);
    const query = includeArchived ? {} : { isArchived: false };
    // This endpoint is a valid-sales feed. The separate history-view endpoint
    // deliberately retains voided records for audit/history.
    query.status = { $ne: 'voided' };

    query.$or = [
      { paymentMethod: { $ne: 'credit' } },
      { paymentStatus: 'Paid' },
    ];

    const sales = await Sale.find(query)
      .populate('cashier', 'name username role')
      .sort({ createdAt: -1 });

    return res.json(sales);
  } catch (error) {
    return next(error);
  }
};

const listSalesHistoryView = async (req, res, next) => {
  try {
    const includeArchived = parseBool(req.query?.includeArchived, true);
    const query = includeArchived ? {} : { isArchived: false };

    if (req.user?.role === 'cashier') {
      query.cashier = req.user._id;
    }

    const sales = await Sale.find(query)
      .populate('cashier', 'name displayName username role')
      .sort({ createdAt: -1 });

    const transactions = sales.map(mapSaleToTransactionContract);
    return res.json(transactions);
  } catch (error) {
    return next(error);
  }
};

const executeSaleCreation = async ({ req, session = null, clientRequestId = '' }) => {
  const { items = [], notes = '' } = req.body;
  const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
  const vatMode = normalizeVatMode(req.body?.vatMode);
  const isCreditSale = paymentMethod === 'credit';
  const saleType = String(req.body?.saleType || '').trim().toLowerCase() === 'special-order' ? 'special-order' : 'regular';
  const customerId = String(req.body?.customerId || '').trim();
  const creditTermDays = parseCreditTermDays(req.body?.termDays);
  const hasTransactionReferenceNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'transactionReferenceNumber');
  if (hasTransactionReferenceNumber && typeof req.body.transactionReferenceNumber !== 'string') {
    const referenceError = new Error('Reference No. must be text.');
    referenceError.status = 400;
    throw referenceError;
  }
  const transactionReferenceNumber = hasTransactionReferenceNumber
    ? String(req.body.transactionReferenceNumber || '').trim()
    : '';
  if (hasTransactionReferenceNumber && !transactionReferenceNumber) {
    const referenceError = new Error('Provide a Reference No. for an offline Cash Sale.');
    referenceError.status = 400;
    throw referenceError;
  }
  if (hasTransactionReferenceNumber && (transactionReferenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH
    || !isValidTransactionReferenceNumber(transactionReferenceNumber))) {
    const referenceError = new Error(transactionReferenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH
      ? `Reference No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.`
      : TRANSACTION_REFERENCE_NUMERIC_MESSAGE);
    referenceError.status = 400;
    throw referenceError;
  }

  if (!paymentMethod) {
    const paymentMethodError = new Error('Unsupported payment method.');
    paymentMethodError.status = 400;
    throw paymentMethodError;
  }

  if (transactionReferenceNumber && paymentMethod !== 'cash') {
    const referenceError = new Error('Offline Transaction Reference is only supported for Cash Sales.');
    referenceError.status = 400;
    throw referenceError;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const validationError = new Error('items are required.');
    validationError.status = 400;
    throw validationError;
  }

  const preparedItems = [];
  const inventoryAdjustments = [];
  let totalAmount = 0;

  let creditCustomer = null;
  let creditCustomerName = '';
  let creditPaymentMode = '';
  let dueDate = null;
  const customerIsVatExempt = false;

  if (isCreditSale) {
    if (!creditTermDays) {
      const termError = new Error(`termDays must be between ${MIN_CREDIT_TERM_DAYS} and ${MAX_CREDIT_TERM_DAYS} for credit sales.`);
      termError.status = 400;
      throw termError;
    }

    if (!customerId || !mongoose.isValidObjectId(customerId)) {
      const customerError = new Error('Select a valid eligible regular customer for credit checkout.');
      customerError.status = 400;
      throw customerError;
    }

    creditCustomer = await Partner.findOne({
      _id: customerId,
      type: 'customer',
      customerType: { $in: ['regular', null] },
      isVerifiedCustomer: { $ne: false },
      isArchived: false,
    }, null, session ? { session } : undefined);

    if (!creditCustomer) {
      const customerError = new Error('Selected customer is not eligible for credit checkout.');
      customerError.status = 400;
      throw customerError;
    }

    creditCustomerName = String(creditCustomer.name || '').trim();
    creditPaymentMode = resolveCreditPaymentMode({
      mode: req.body?.creditPaymentMode,
      other: req.body?.creditPaymentModeOther,
    });

    if (!creditPaymentMode) {
      const paymentModeError = new Error('Select a valid payment method for credit checkout.');
      paymentModeError.status = 400;
      throw paymentModeError;
    }

    dueDate = computeDueDate({ startDate: new Date(), termDays: creditTermDays });
  }

  for (const item of items) {
    const product = await Product.findById(item.productId, null, session ? { session } : undefined);
    if (!product || !product.isActive) {
      const productError = new Error(`Invalid product: ${item.productId}`);
      productError.status = 400;
      throw productError;
    }

    const quantity = parseStrictWholeNumber(item.quantity, { min: 1 });
    if (quantity === null) {
      const quantityError = new Error(`Invalid quantity for ${product.name}`);
      quantityError.status = 400;
      throw quantityError;
    }

    if (product.stock < quantity) {
      const stockError = new Error(`Insufficient stock for ${product.name}`);
      stockError.status = 400;
      throw stockError;
    }

    const subtotal = quantity * product.price;
    preparedItems.push({
      product: product._id,
      name: product.name,
      code: product.sku,
      quantity,
      unitPrice: product.price,
      subtotal,
    });

    totalAmount += subtotal;
    const stockBefore = Number(product.stock || 0);
    product.stock -= quantity;
    await product.save(session ? { session } : undefined);

    inventoryAdjustments.push({
      code: product.sku,
      productRef: product._id,
      name: product.name,
      quantity,
      stockBefore,
      stockAfter: Number(product.stock || 0),
    });
  }

  const vatSummary = computeTransactionVatBreakdown({
    grossAmount: totalAmount,
    vatMode,
    customerIsVatExempt,
  });
  const grossAmount = toMoney(totalAmount);
  const netAmount = toMoney(vatSummary.netAmount);
  const vatAmount = toMoney(vatSummary.vatAmount);
  const payableTotal = vatMode === 'zero-rated' || customerIsVatExempt
    ? netAmount
    : grossAmount;

  if (!isCreditSale && paymentMethod === 'cash') {
    const cashTendered = req.body?.cashTendered ?? req.body?.cash;
    if (isMoneyInputTooLarge(cashTendered)) {
      const error = new Error('Amount is too large. Please enter a smaller value.');
      error.status = 400;
      throw error;
    }

    const cashTenderedCentavos = parseSafeMoneyToCentavos(cashTendered);
    const payableTotalCentavos = parseSafeMoneyToCentavos(payableTotal);
    if (cashTenderedCentavos === null || payableTotalCentavos === null) {
      const error = new Error('Cash tendered must be a valid monetary amount.');
      error.status = 400;
      throw error;
    }
    if (cashTenderedCentavos < payableTotalCentavos) {
      const error = new Error('Cash tendered must be at least the total amount.');
      error.status = 400;
      throw error;
    }
  }

  const [sale] = await Sale.create([{
    items: preparedItems,
    totalAmount: payableTotal,
    netAmount,
    vatAmount,
    grossAmount,
    pricingMode: 'inclusive',
    vatMode,
    customerIsVatExempt,
    hasVatApplicableItems: vatSummary.hasVatApplicableItems,
    hasVatableItems: vatSummary.hasVatableItems,
    hasZeroRatedItems: vatSummary.hasZeroRatedItems,
    vatRatesUsed: vatSummary.vatRatesUsed,
    paymentMethod,
    saleType,
    paymentStatus: isCreditSale ? 'Pending' : 'Paid',
    customer: creditCustomer?._id || null,
    customerName: isCreditSale ? creditCustomerName : '',
    creditTermDays: isCreditSale ? creditTermDays : null,
    dueDate: isCreditSale ? dueDate : null,
    notes: isCreditSale ? `Preferred mode of payment: ${creditPaymentMode}` : notes,
    cashier: req.user._id,
    cashierName: resolveCashierName(req.user),
    ...(transactionReferenceNumber ? { transactionReference: { referenceNumber: transactionReferenceNumber, supportingDocument: null } } : {}),
    ...(saleType === 'special-order' ? { specialOrderId: req.body?.specialOrderId || null, specialOrderNumber: String(req.body?.specialOrderNumber || '').trim() } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
  }], session ? { session } : undefined);

  for (const adjustment of inventoryAdjustments) {
    await writeInventoryLog({
      action: 'DEDUCT',
      code: adjustment.code,
      productRef: adjustment.productRef,
      user: req.user,
      details: `Sold ${adjustment.quantity} of ${adjustment.name}`,
      quantity: adjustment.quantity,
      stockBefore: adjustment.stockBefore,
      stockAfter: adjustment.stockAfter,
      session,
    });
  }

  let creditTransaction = null;

  if (isCreditSale) {
    const [createdCreditTransaction] = await CreditTransaction.create([{
      creditTransactionId: generateCreditTransactionId(),
      orderId: sale._id,
      customerId: creditCustomer?._id || null,
      customerName: creditCustomerName,
      totalAmount: payableTotal,
      netAmount,
      vatAmount,
      grossAmount,
      pricingMode: 'inclusive',
      vatMode,
      customerIsVatExempt,
      hasVatApplicableItems: vatSummary.hasVatApplicableItems,
      hasVatableItems: vatSummary.hasVatableItems,
      hasZeroRatedItems: vatSummary.hasZeroRatedItems,
      vatRatesUsed: vatSummary.vatRatesUsed,
      amountPaid: 0,
      remainingBalance: payableTotal,
      termDays: creditTermDays,
      dueDate,
      status: 'Unpaid',
      paymentHistory: [],
    }], session ? { session } : undefined);

    creditTransaction = createdCreditTransaction;
    sale.creditTransactionId = creditTransaction.creditTransactionId;
    await sale.save(session ? { session } : undefined);
  }

  await writeActivityLog({
    user: req.user,
    action: isCreditSale ? 'Created Credit Sale' : 'Created Sale',
    details: isCreditSale
      ? `Credit sale ${sale._id} created for ${creditCustomerName || 'customer'} with ${preparedItems.length} item(s), total ${payableTotal}, due ${dueDate?.toISOString() || 'n/a'}.`
      : `Sale ${sale._id} created with ${preparedItems.length} item(s), total ${payableTotal}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    session,
  });

  return { sale, creditTransaction };
};

const createSale = async (req, res, next) => {
  let session;
  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);

  try {
    if (clientRequestId) {
      const existingSale = await Sale.findOne({ clientRequestId });
      if (existingSale) {
        return res.status(200).json(existingSale);
      }
    }

    session = await mongoose.startSession();
    let createdSale = null;
    let createdCreditTransaction = null;

    await session.withTransaction(async () => {
      const created = await executeSaleCreation({ req, session, clientRequestId });
      createdSale = created.sale;
      createdCreditTransaction = created.creditTransaction;
    });

    if (createdSale?._id) {
      publishSaleCreated({
        saleId: createdSale._id,
        cashierId: req.user?._id,
        cashierName: resolveCashierName(req.user),
      });
      publishInventoryUpdated({ reason: 'sale.created' });
      if (createdCreditTransaction?._id) {
        publishCreditTransactionsUpdated({
          reason: 'credit-transaction.created',
          creditTransactionId: createdCreditTransaction._id,
        });
      }
    }

    return res.status(201).json(createdSale);
  } catch (error) {
    const duplicateRequest = error?.code === 11000 && error?.keyPattern?.clientRequestId;
    if (duplicateRequest && clientRequestId) {
      const existingSale = await Sale.findOne({ clientRequestId });
      if (existingSale) {
        return res.status(200).json(existingSale);
      }
    }

    const message = String(error?.message || '').toLowerCase();
    const transactionUnsupported = message.includes('transaction numbers are only allowed on a replica set member or mongos');

    if (!transactionUnsupported) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      return next(error);
    }

    return res.status(503).json({
      message: 'Checkout is temporarily unavailable because the local database transaction service is not ready. Please contact an administrator and try again.',
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

const getSaleHistoryView = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const sale = await Sale.findById(req.params.id).populate('cashier', 'name displayName username role');
    if (!sale) return res.status(404).json({ message: 'Sale not found.' });
    if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: 'You can only view your own sales.' });
    return res.json(mapSaleToTransactionContract(sale));
  } catch (error) {
    return next(error);
  }
};

const voidSale = async (req, res, next, dependencies = {}) => {
  const upload = dependencies.uploadProof || uploadProof;
  const remove = dependencies.removeProof || removeProof;
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  let uploaded = null;
  let persisted = false;
  try {
    if (!['admin', 'superadmin'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ message: 'Only an Admin or Super Admin can void a Sale.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const requestId = normalizeClientRequestId(req.body?.requestId);
    if (!reason) return res.status(400).json({ message: 'Void reason is required.' });
    if (reason.length > 500) return res.status(400).json({ message: 'Void reason must be 500 characters or fewer.' });
    if (Array.from(reason).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      return res.status(400).json({ message: 'Void reason contains invalid characters.' });
    }
    if (!requestId) return res.status(400).json({ message: 'Void request ID is required.' });
    if (requestId.length > 128) return res.status(400).json({ message: 'Void request ID must be 128 characters or fewer.' });

    if (req.file) {
      const existingSale = await findSale(req.params.id);
      if (!existingSale) return res.status(404).json({ message: 'Sale not found.' });
      if (getSaleStatus(existingSale) !== 'voided') uploaded = await upload(req.file);
    }

    const result = await (dependencies.executeSaleVoid || executeSaleVoid)({
      saleId: req.params.id,
      reason,
      requestId,
      supportingProof: uploaded,
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || '',
    });
    persisted = Boolean(uploaded?.key
      && !result.replayed
      && String(result.sale?.voidInfo?.supportingProof?.key || '') === String(uploaded.key));
    return res.status(200).json({
      sale: mapSaleToTransactionContract(result.sale),
      replayed: Boolean(result.replayed),
      restorations: result.restorations,
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('transaction numbers are only allowed on a replica set member or mongos')) {
      return res.status(503).json({
        message: 'Sale voiding is temporarily unavailable because the database transaction service is not ready.',
      });
    }
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (uploaded?.key && !persisted) {
      try { await remove(uploaded.key); } catch (error) { console.error('Unable to remove orphan Sale Void proof:', error.message); }
    }
  }
};

const canAccessSale = (sale, user) => user?.role !== 'cashier'
  || String(sale?.cashier?._id || sale?.cashier || '') === String(user?._id || '');

const updateSaleTransactionReference = async (req, res, next, dependencies = {}) => {
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const updateSale = dependencies.updateSale || ((query, update) => Sale.findOneAndUpdate(query, update, { new: true, runValidators: true }));
  const upload = dependencies.upload || uploadDocument;
  const remove = dependencies.remove || removeDocument;
  let uploaded = null;
  let persisted = false;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const sale = await findSale(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found.' });
    if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: 'You can only update your own sales.' });
    if (getSaleStatus(sale) === 'voided') return res.status(409).json({ message: 'Transaction references are read-only after a Sale is voided.' });

    const hasNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'referenceNumber');
    if (hasNumber && typeof req.body.referenceNumber !== 'string') {
      return res.status(400).json({ message: 'Reference No. must be text.' });
    }
    const referenceNumber = hasNumber ? String(req.body.referenceNumber || '').trim() : '';
    if (referenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH) {
      return res.status(400).json({ message: `Reference No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.` });
    }
    if (referenceNumber && !isValidTransactionReferenceNumber(referenceNumber)) {
      return res.status(400).json({ message: TRANSACTION_REFERENCE_NUMERIC_MESSAGE });
    }
    const existingReferenceNumber = String(sale.transactionReference?.referenceNumber || '').trim();
    const existingDocument = sale.transactionReference?.supportingDocument || null;
    const effectiveReferenceNumber = hasNumber ? referenceNumber : existingReferenceNumber;
    if (!effectiveReferenceNumber && !req.file && !existingDocument) {
      return res.status(400).json({ message: 'Provide a Reference No. or Supporting Document.' });
    }

    if (req.file) uploaded = await upload(req.file);
    const oldKey = sale.transactionReference?.supportingDocument?.key || null;
    const update = { $set: { transactionReference: {
      referenceNumber: effectiveReferenceNumber,
      supportingDocument: uploaded || existingDocument,
    } } };
    const query = { _id: sale._id, 'transactionReference.supportingDocument.key': oldKey };
    const updated = await updateSale(query, update);
    if (!updated) return res.status(409).json({ message: 'This reference was updated elsewhere. Refresh and retry.' });
    persisted = true;
    if (uploaded && oldKey && oldKey !== uploaded.key) {
      try { await remove(oldKey); } catch (error) { console.error('Unable to remove replaced supporting document:', error.message); }
    }
    return res.json(mapSaleToTransactionContract(updated));
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (uploaded?.key && !persisted) {
      try { await remove(uploaded.key); } catch (error) { console.error('Unable to remove orphan supporting document:', error.message); }
    }
  }
};

const getSaleSupportingDocument = async (req, res, next, dependencies = {}) => {
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const read = dependencies.read || getDocument;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const sale = await findSale(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found.' });
    if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: 'You can only view your own sales.' });
    const document = sale.transactionReference?.supportingDocument;
    if (!document?.key) return res.status(404).json({ message: 'Supporting Document is not available.' });
    const stored = await read(document.key);
    if (!stored) return res.status(404).json({ message: 'Supporting Document is not available.' });
    res.set('Cache-Control', 'private, no-store');
    res.type(document.mimeType);
    if (stored.type === 'local') return res.sendFile(stored.filePath);
    const body = stored.object?.Body;
    if (typeof body?.pipe === 'function') { body.on('error', next); body.pipe(res); return undefined; }
    if (typeof body?.transformToByteArray === 'function') return res.send(Buffer.from(await body.transformToByteArray()));
    return res.status(404).json({ message: 'Supporting Document is not available.' });
  } catch (error) {
    if (isObjectNotFoundError(error)) return res.status(404).json({ message: 'Supporting Document is not available.' });
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

const safeDownloadName = (value, fallback) => String(value || fallback)
  .replace(/[\r\n"]/g, '_')
  .replace(/[^a-zA-Z0-9._ ()-]/g, '_');

const getSaleVoidProof = async (req, res, next, dependencies = {}) => {
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const read = dependencies.read || getProof;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const sale = await findSale(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found.' });
    if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: 'You can only view your own sales.' });
    const proof = sale.voidInfo?.supportingProof;
    if (!proof?.key) return res.status(404).json({ message: 'Supporting Proof is not available.' });
    const stored = await read(proof.key);
    if (!stored) return res.status(404).json({ message: 'Supporting Proof is not available.' });
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', `inline; filename="${safeDownloadName(proof.originalName, 'sale-void-proof')}"`);
    res.type(proof.mimeType);
    if (stored.type === 'local') return res.sendFile(stored.filePath);
    const body = stored.object?.Body;
    if (typeof body?.pipe === 'function') { body.on('error', next); body.pipe(res); return undefined; }
    if (typeof body?.transformToByteArray === 'function') return res.send(Buffer.from(await body.transformToByteArray()));
    return res.status(404).json({ message: 'Supporting Proof is not available.' });
  } catch (error) {
    if (isObjectNotFoundError(error)) return res.status(404).json({ message: 'Supporting Proof is not available.' });
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

const archiveSale = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found.' });
    }

    sale.isArchived = true;
    sale.archivedAt = new Date();
    sale.archivedBy = req.user?._id || null;
    await sale.save();

    await writeActivityLog({
      user: req.user,
      action: 'Archived Sale',
      details: `Archived sale ${sale._id}.`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    return res.json({ message: 'Sale archived.', sale });
  } catch (error) {
    return next(error);
  }
};

const restoreSale = async (req, res, next) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found.' });
    }

    sale.isArchived = false;
    sale.archivedAt = null;
    sale.archivedBy = null;
    await sale.save();

    await writeActivityLog({
      user: req.user,
      action: 'Restored Sale',
      details: `Restored sale ${sale._id}.`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    return res.json({ message: 'Sale restored.', sale });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  mapSaleToTransactionContract,
  listSales,
  listSalesHistoryView,
  getSaleHistoryView,
  createSale,
  voidSale,
  getSaleVoidProof,
  updateSaleTransactionReference,
  getSaleSupportingDocument,
  archiveSale,
  restoreSale,
};
