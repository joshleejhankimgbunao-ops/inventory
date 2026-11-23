const mongoose = require('mongoose');
const { getSaleStatus } = require('../../../shared/saleLifecycle.mjs');
const { getSaleVoidEligibility } = require('../services/saleVoidEligibility');
const { executeSaleVoid } = require('../services/saleVoidService');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Sale = require('../models/Sale');
const SpecialOrder = require('../models/SpecialOrder');
const Partner = require('../models/Partner');
const CreditTransaction = require('../models/CreditTransaction');
const { writeActivityLog, writeInventoryLog } = require('../services/logService');
const { withPostCommitNotifications } = require('../services/postCommitNotifications');
const { publishSaleCreated, publishSaleUpdated, publishInventoryUpdated, publishCreditTransactionsUpdated } = require('../services/realtimeService');
const { normalizeVatMode, computeTransactionVatBreakdown, toMoney } = require('../utils/vat');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoneyToCentavos } = require('../utils/moneyValidation');
const { normalizeCreditPaymentMethod } = require('../utils/paymentMethodNormalization');
const { addManilaCalendarDays, startOfManilaCalendarDay } = require('../utils/manilaCalendar');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');
const {
  TRANSACTION_REFERENCE_MAX_LENGTH,
  TRANSACTION_REFERENCE_NUMERIC_MESSAGE,
  isValidTransactionReferenceNumber,
} = require('../../../shared/transactionReference.cjs');
const { uploadDocument, removeDocument, getDocument } = require('../services/transactionSupportingDocument');
const { uploadProof, removeProof, getProof } = require('../services/saleVoidProof');
const { isObjectNotFoundError } = require('../services/r2StorageService');
const { persistProofOfPayment, removeStoredProof } = require('./creditTransactionController');
const { prepareSpecialOrderInvoice, assertSpecialOrderInvoiceAvailable } = require('../services/specialOrderInvoiceReference');
const { allocateVerifiedBatches, normalizeBatchAllocations } = require('../services/expiryBatchAllocationService');
const { getProductDisplayName } = require('../utils/productDisplayName');

const MIN_CREDIT_TERM_DAYS = 1;
const MAX_CREDIT_TERM_DAYS = 60;
const TRANSACTION_REFERENCE_DUPLICATE_MESSAGE = 'This reference number is already used by another transaction.';
const CREDIT_PAYMENT_MODE_LABELS = {
  cash: 'Cash',
  gcash: 'GCash',
  cheque: 'Cheque',
  'bank transfer': 'Bank Transfer',
  other: 'Other',
};

const submittedVoidProofFiles = (req) => [
  ...(Array.isArray(req.files) ? req.files : [
    ...(req.files?.proof || []),
    ...(req.files?.proofs || []),
  ]),
  ...(req.file ? [req.file] : []),
];

const uploadVoidProofSet = async (files, upload, saved) => {
  if (files.length > 3) throw Object.assign(new Error('Choose no more than 3 supporting files.'), { status: 400 });
  for (const file of files) saved.push(await upload(file));
  return saved;
};

const removeVoidProofSet = async (proofs, remove) => {
  for (const proof of proofs) {
    try { await remove(proof.key); }
    catch (error) { console.error('Unable to remove orphan Sale Void proof:', error.message); }
  }
};

const validateDownPaymentProofs = (paymentMethod, proofs = []) => {
  if (paymentMethod === 'credit' && (proofs.length < 1 || proofs.length > 3)) {
    throw Object.assign(new Error('Choose 1 to 3 Down Payment Proof photos.'), { status: 400 });
  }
  if (paymentMethod !== 'credit' && proofs.length) {
    throw Object.assign(new Error('Down Payment Proof is only accepted for credit checkout.'), { status: 400 });
  }
};

const normalizePaymentMethod = (value) => {
  const normalized = String(value || 'cash').trim().toLowerCase();
  if (['cash', 'gcash', 'card', 'other', 'credit'].includes(normalized)) {
    return normalized;
  }
  return '';
};

const isTransactionReferenceDuplicateKeyError = (error) => error?.code === 11000
  && (error?.keyPattern?.['transactionReference.referenceNumber']
    || String(error?.message || '').includes('transactionReference.referenceNumber'));

const findSaleWithTransactionReference = (referenceNumber, excludedSaleId = null, session = null) => {
  if (!referenceNumber) return null;

  const query = {
    'transactionReference.referenceNumber': referenceNumber,
    ...(excludedSaleId ? { _id: { $ne: excludedSaleId } } : {}),
  };
  const request = Sale.findOne(query).select('_id');
  return session ? request.session(session) : request;
};

const withInvoiceWriteLock = async (referenceNumber, excludedSaleId, write) => {
  if (!referenceNumber) return write(null);
  await prepareSpecialOrderInvoice(referenceNumber);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      await assertSpecialOrderInvoiceAvailable(referenceNumber, session, excludedSaleId);
      result = await write(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
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
  const startOfBusinessDay = startOfManilaCalendarDay(startDate);
  return startOfBusinessDay
    ? addManilaCalendarDays(startOfBusinessDay, Number(termDays || 0))
    : null;
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

const takeBatchAllocationQuantity = (allocations, quantity) => {
  let remaining = quantity;
  const taken = [];
  while (remaining > 0 && allocations.length) {
    const row = allocations[0];
    const assigned = Math.min(row.quantity, remaining);
    taken.push({ ...row, quantity: assigned });
    row.quantity -= assigned;
    remaining -= assigned;
    if (row.quantity === 0) allocations.shift();
  }
  return remaining === 0 ? taken : null;
};

const getSaleBatchVerifications = (items, body = {}) => {
  const values = body?.batchVerifications;
  if (values === undefined) return new Map();
  if (!Array.isArray(values) || values.length > 100) {
    const error = new Error('Batch verification details are invalid. Return to the Order List and try again.');
    error.status = 400;
    throw error;
  }
  const quantities = new Map();
  for (const item of items) {
    const productId = String(item?.productId || '').trim();
    const quantity = parseStrictWholeNumber(item?.quantity, { min: 1 });
    if (!mongoose.isValidObjectId(productId) || quantity === null) continue;
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  const map = new Map();
  for (const row of values) {
    const productId = String(row?.productId || '').trim();
    const proposed = normalizeBatchAllocations(row?.proposedAllocations);
    const verified = normalizeBatchAllocations(row?.verifiedAllocations);
    const expectedQuantity = quantities.get(productId);
    if (!mongoose.isValidObjectId(productId) || map.has(productId) || !proposed || !verified
      || !expectedQuantity || proposed.reduce((sum, allocation) => sum + allocation.quantity, 0) !== expectedQuantity
      || verified.reduce((sum, allocation) => sum + allocation.quantity, 0) !== expectedQuantity) {
      const error = new Error('Batch verification details do not match the order. Return to the Order List and confirm again.');
      error.status = 400;
      throw error;
    }
    map.set(productId, {
      proposed,
      verified,
      reason: String(row?.reason || '').trim(),
      expectedStock: Number(row?.productStock),
      expectedReservedStock: Number(row?.productReserved),
    });
  }
  return map;
};

const displaySaleId = (sale) => `TRX-${String(sale?._id || '').slice(-8).toUpperCase()}`;

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
    savedAt: reference.savedAt || null,
    correctedAt: reference.correctedAt || null,
    correctionHistory: (reference.correctionHistory || []).map((entry) => ({
      previousReferenceNumber: String(entry.previousReferenceNumber || '').trim(),
      previousSupportingDocument: publicVoidSupportingProof(entry.previousSupportingDocument),
      correctedReferenceNumber: String(entry.correctedReferenceNumber || '').trim(),
      correctedSupportingDocument: publicVoidSupportingProof(entry.correctedSupportingDocument),
      reason: entry.reason,
      correctedByName: entry.correctedByName,
      correctedAt: entry.correctedAt,
    })),
  };
};

const publicCreatedSale = (sale) => {
  const raw = typeof sale?.toObject === 'function' ? sale.toObject() : sale;
  return raw ? { ...raw, transactionReference: publicTransactionReference(raw.transactionReference) } : raw;
};

const publicVoidSupportingProof = (proof) => proof ? {
  originalName: proof.originalName,
  mimeType: proof.mimeType,
  size: proof.size,
  uploadedAt: proof.uploadedAt,
} : null;

const publicVoidRequest = (request) => request ? {
  status: request.status,
  reason: request.reason,
  requestedByName: request.requestedByName,
  requestedAt: request.requestedAt,
  supportingProof: publicVoidSupportingProof(request.supportingProof),
  supportingProofs: (request.supportingProofs?.length ? request.supportingProofs : request.supportingProof ? [request.supportingProof] : []).map(publicVoidSupportingProof),
  reviewedByName: request.reviewedByName || '',
  reviewedAt: request.reviewedAt || null,
  declineReason: request.declineReason || '',
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
  const creditPaymentModeMatch = String(saleObj?.notes || '').trim().match(/(?:preferred mode of payment|down payment method):\s*(.+)$/i);
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
      supportingProofs: (saleObj.voidInfo.supportingProofs?.length ? saleObj.voidInfo.supportingProofs : saleObj.voidInfo.supportingProof ? [saleObj.voidInfo.supportingProof] : []).map(publicVoidSupportingProof),
    } : null,
    voidRequest: publicVoidRequest(saleObj.voidRequest),
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
    specialOrderFulfillmentStatus: saleObj.specialOrderFulfillmentStatus || null,
    specialOrderNumber: saleObj.specialOrderNumber || '',
    ...(saleObj.specialOrderQuotationId ? {
      specialOrderQuotationId: String(saleObj.specialOrderQuotationId),
      specialOrderQuotationVersion: saleObj.specialOrderQuotationVersion,
    } : {}),
    creditTransactionId: saleObj.creditTransactionId || '',
    netAmount: saleObj.vatCalculationStatus === 'not_calculated' ? null : Number(saleObj.netAmount || saleObj.totalAmount || 0),
    vatAmount: saleObj.vatCalculationStatus === 'not_calculated' ? null : Number(saleObj.vatAmount || 0),
    vatCalculationStatus: saleObj.vatCalculationStatus || 'calculated',
    taxTreatment: saleObj.taxTreatment || null,
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
    customerDetails: saleObj.customerDetails || null,
    creditPaymentMode,
    termDays: Number(saleObj.creditTermDays || 0) || null,
    dueDate: saleObj.dueDate || null,
    collectionSource: saleObj.collectionSource || 'sale',
    cashImpactAmount: saleObj.paymentMethod === 'credit' || saleObj.collectionSource === 'special_order_ledger' ? 0 : Number(saleObj.totalAmount || 0),
    notes: saleObj.notes || '',
    transactionReference: publicTransactionReference(saleObj.transactionReference),
    isArchived: Boolean(saleObj.isArchived),
    items: (saleObj.items || []).map((item, index) => ({
      id: item.product ? String(item.product) : `${saleObj._id}-${index}`,
      code: item.code || '',
      name: item.name,
      qty: Number(item.quantity || 0),
      description: item.description || '',
      sellingUnit: item.sellingUnit || '',
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
    // History is a permanent audit feed. Archived flags are preserved in the
    // response, but never suppress a historical transaction from this view.
    const query = {};

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

const executeSaleCreation = async ({ req, session = null, clientRequestId = '', supportingDocument = null, downPaymentProofs = [] }) => {
  const { items = [], notes = '' } = req.body;
  const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
  const vatMode = normalizeVatMode(req.body?.vatMode);
  const isCreditSale = paymentMethod === 'credit';
  validateDownPaymentProofs(paymentMethod, downPaymentProofs);
  const saleType = String(req.body?.saleType || '').trim().toLowerCase() === 'special-order' ? 'special-order' : 'regular';
  const customerId = String(req.body?.customerId || '').trim();
  const creditTermDays = parseCreditTermDays(req.body?.termDays);
  const requiresTransactionReference = req.body?.requireTransactionReference === true;
  const hasTransactionReferenceNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'transactionReferenceNumber');
  const hasFinalReferenceNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'referenceNumber');
  const rawReferenceNumber = hasFinalReferenceNumber
    ? req.body.referenceNumber
    : req.body.transactionReferenceNumber;
  if ((hasTransactionReferenceNumber || hasFinalReferenceNumber) && typeof rawReferenceNumber !== 'string') {
    const referenceError = new Error('Reference No. must be text.');
    referenceError.status = 400;
    throw referenceError;
  }
  const transactionReferenceNumber = (hasTransactionReferenceNumber || hasFinalReferenceNumber)
    ? String(rawReferenceNumber || '').trim()
    : '';
  if (hasTransactionReferenceNumber && !hasFinalReferenceNumber && !transactionReferenceNumber) {
    const referenceError = new Error('Provide a Reference No. for an offline Cash Sale.');
    referenceError.status = 400;
    throw referenceError;
  }
  if ((hasTransactionReferenceNumber || hasFinalReferenceNumber) && (transactionReferenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH
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

  if (requiresTransactionReference && !transactionReferenceNumber && !supportingDocument) {
    const referenceError = new Error('Provide a Reference No. or Supporting Document.');
    referenceError.status = 400;
    throw referenceError;
  }

  if (transactionReferenceNumber && !requiresTransactionReference && paymentMethod !== 'cash') {
    const referenceError = new Error('Offline Transaction Reference is only supported for Cash Sales.');
    referenceError.status = 400;
    throw referenceError;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const validationError = new Error('items are required.');
    validationError.status = 400;
    throw validationError;
  }

  if (transactionReferenceNumber) {
    await assertSpecialOrderInvoiceAvailable(transactionReferenceNumber, session);
  }

  const preparedItems = [];
  const inventoryAdjustments = [];
  const productCategories = new Map();
  const batchVerificationByProduct = getSaleBatchVerifications(items, req.body);
  const saleId = new mongoose.Types.ObjectId();
  let totalAmount = 0;

  let creditCustomer = null;
  let creditCustomerName = '';
  let creditPaymentMode = '';
  let downPaymentCentavos = null;
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

    if (isMoneyInputTooLarge(req.body?.downPaymentAmount)) {
      const paymentError = new Error('Down payment amount is too large. Please enter a smaller value.');
      paymentError.status = 400;
      throw paymentError;
    }

    downPaymentCentavos = parseSafeMoneyToCentavos(req.body?.downPaymentAmount);
    if (downPaymentCentavos === null || downPaymentCentavos < 1) {
      const paymentError = new Error('Down payment must be at least ₱0.01.');
      paymentError.status = 400;
      throw paymentError;
    }

    dueDate = computeDueDate({ startDate: new Date(), termDays: creditTermDays });
  }

  for (const [lineIndex, item] of items.entries()) {
    const product = await Product.findById(item.productId, null, session ? { session } : undefined);
    if (!product || !product.isActive) {
      const productError = new Error(`Invalid product: ${item.productId}`);
      productError.status = 400;
      throw productError;
    }

    const categoryKey = String(product.categoryRef || product.category || '');
    let category = productCategories.get(categoryKey);
    if (!category && categoryKey) {
      category = product.categoryRef
        ? await Category.findById(product.categoryRef).lean()
        : await Category.findOne({ name: product.category }).lean();
      productCategories.set(categoryKey, category || {});
      category = category || {};
    }
    const displayName = getProductDisplayName(product, category || {});

    const quantity = parseStrictWholeNumber(item.quantity, { min: 1 });
    if (quantity === null) {
      const quantityError = new Error(`Invalid quantity for ${displayName}`);
      quantityError.status = 400;
      throw quantityError;
    }

    const subtotal = quantity * product.price;
    const saleItem = {
      product: product._id,
      name: displayName,
      code: product.sku,
      ...(isCreditSale ? { sellingUnit: product.sellingUnit || '' } : {}),
      quantity,
      unitPrice: product.price,
      subtotal,
    };

    totalAmount += subtotal;
    if (Number(product.stock || 0) - Number(product.reservedStock || 0) < quantity) {
      const stockError = new Error(`Insufficient available stock for ${displayName}`);
      stockError.status = 409;
      throw stockError;
    }
    // The conditional write is the checkout/reservation linearization point.
    // It also handles repeated SKU lines in one cart without consuming holds.
    let batchAllocation = null;
    if (product.expiryTrackingEnabled) {
      if (!product.expiryBatchReconciled) {
        const batchError = new Error(`Batch verification is needed for ${product.sku}. Verify batches in Inventory before completing this sale.`);
        batchError.status = 409;
        throw batchError;
      }
      const verification = batchVerificationByProduct.get(String(product._id));
      if (!verification) {
        const batchError = new Error(`Confirm the physical batch picks for ${product.sku} before processing payment.`);
        batchError.status = 400;
        throw batchError;
      }
      if (!Number.isSafeInteger(verification.expectedStock) || verification.expectedStock !== Number(product.stock || 0)
          || !Number.isSafeInteger(verification.expectedReservedStock) || verification.expectedReservedStock !== Number(product.reservedStock || 0)) {
        const batchError = new Error(`Stock for ${product.sku} changed. Return to the Order List, refresh, and confirm the batch picks again.`);
        batchError.status = 409;
        throw batchError;
      }
      const proposedLine = takeBatchAllocationQuantity(verification.proposed, quantity);
      const verifiedLine = takeBatchAllocationQuantity(verification.verified, quantity);
      if (!proposedLine || !verifiedLine) {
        const batchError = new Error(`Batch quantities for ${product.sku} no longer match this order. Return to the Order List and confirm again.`);
        batchError.status = 409;
        throw batchError;
      }
      batchAllocation = await allocateVerifiedBatches({
        product, quantity, proposedAllocations: proposedLine, verifiedAllocations: verifiedLine,
        session, type: 'SALE', sourceType: 'Sale', sourceId: saleId,
        requestId: clientRequestId, operationKeyPrefix: `sale:${saleId}:line:${lineIndex}`,
        actor: req.user, reason: verification.reason,
      });
      saleItem.batchVerification = batchAllocation.audit;
    }
    preparedItems.push(saleItem);
    const beforeDeduction = await Product.findOneAndUpdate({
      _id: product._id, isActive: { $ne: false },
      $expr: { $gte: [{ $subtract: ['$stock', { $ifNull: ['$reservedStock', 0] }] }, quantity] },
    }, { $inc: { stock: -quantity } }, { session, returnDocument: 'before' });
    if (!beforeDeduction) {
      const stockError = new Error(`Insufficient available stock for ${displayName}`);
      stockError.status = 409;
      throw stockError;
    }
    const stockBefore = Number(beforeDeduction.stock || 0);

    inventoryAdjustments.push({
      code: product.sku,
      productRef: product._id,
      name: displayName,
      quantity,
      stockBefore,
      stockAfter: stockBefore - quantity,
      batchMovementRefs: batchAllocation?.movements.map((movement) => movement._id) || [],
    });
  }

  const unusedVerification = [...batchVerificationByProduct.entries()].find(([, verification]) => verification.proposed.length || verification.verified.length);
  if (unusedVerification) {
    const error = new Error('Batch verification was submitted for a product that is not in this order.');
    error.status = 400;
    throw error;
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
  const payableTotalCentavos = parseSafeMoneyToCentavos(payableTotal);

  if (isCreditSale && (payableTotalCentavos === null || downPaymentCentavos >= payableTotalCentavos)) {
    const paymentError = new Error('Down payment must be less than the final transaction total.');
    paymentError.status = 400;
    throw paymentError;
  }

  const downPaymentAmount = isCreditSale ? downPaymentCentavos / 100 : 0;
  const remainingBalance = isCreditSale ? (payableTotalCentavos - downPaymentCentavos) / 100 : 0;

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
    _id: saleId,
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
    paymentStatus: isCreditSale ? 'Partially Paid' : 'Paid',
    customer: creditCustomer?._id || null,
    customerName: isCreditSale ? creditCustomerName : '',
    creditTermDays: isCreditSale ? creditTermDays : null,
    dueDate: isCreditSale ? dueDate : null,
    notes: isCreditSale ? `Down payment method: ${creditPaymentMode}` : notes,
    cashier: req.user._id,
    cashierName: resolveCashierName(req.user),
    ...((transactionReferenceNumber || supportingDocument) ? { transactionReference: {
      referenceNumber: transactionReferenceNumber,
      supportingDocument,
      savedAt: new Date(),
      savedBy: req.user?._id || null,
      correctedAt: null,
      correctionHistory: [],
    } } : {}),
    ...(saleType === 'special-order' ? { specialOrderId: req.body?.specialOrderId || null, specialOrderNumber: String(req.body?.specialOrderNumber || '').trim() } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
  }], session ? { session } : undefined);

  for (const adjustment of inventoryAdjustments) {
    await writeInventoryLog({
      action: 'DEDUCT',
      code: adjustment.code,
      productRef: adjustment.productRef,
      saleRef: sale._id,
      user: req.user,
      details: `Sold ${adjustment.quantity} of ${adjustment.name}`,
      quantity: adjustment.quantity,
      stockBefore: adjustment.stockBefore,
      stockAfter: adjustment.stockAfter,
      batchMovementRefs: adjustment.batchMovementRefs,
      session,
    });
  }

  let creditTransaction = null;

  if (isCreditSale) {
    const initialDownPaymentRecordedAt = new Date();
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
      amountPaid: downPaymentAmount,
      downPaymentAmount,
      remainingBalance,
      termDays: creditTermDays,
      dueDate,
      status: 'Partially Paid',
      paymentHistory: [{
        paymentDate: initialDownPaymentRecordedAt,
        recordedAt: initialDownPaymentRecordedAt,
        amount: downPaymentAmount,
        type: 'down_payment',
        method: normalizeCreditPaymentMethod(creditPaymentMode),
        recordedBy: resolveCashierName(req.user),
        recordedById: req.user?._id || null,
        clientRequestId: `initial-down-payment:${sale._id}`,
        proof: downPaymentProofs[0],
        proofs: downPaymentProofs,
      }],
    }], session ? { session } : undefined);

    creditTransaction = createdCreditTransaction;
    sale.creditTransactionId = creditTransaction.creditTransactionId;
    await sale.save(session ? { session } : undefined);
  }

  await writeActivityLog({
    user: req.user,
    action: isCreditSale ? 'Created Credit Sale' : 'Created Sale',
    details: isCreditSale
      ? `Credit sale ${sale._id} created for ${creditCustomerName || 'customer'} with ${preparedItems.length} item(s), total ${payableTotal}, down payment ${downPaymentAmount}, remaining ${remainingBalance}, due ${dueDate?.toISOString() || 'n/a'}.`
      : `Sale ${sale._id} created with ${preparedItems.length} item(s), total ${payableTotal}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    session,
  });

  return { sale, creditTransaction };
};

const createSale = async (req, res, next) => {
  let session;
  let uploadedDocument = null;
  let documentPersisted = false;
  const uploadedDownPaymentProofs = [];
  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);

  try {
    if (String(req.body?.saleType || '').trim().toLowerCase() === 'special-order'
      || req.body?.specialOrderId || req.body?.specialOrderNumber
      || req.body?.specialOrderQuotationId || req.body?.quotationId
      || clientRequestId.startsWith('special-order:')) {
      return res.status(400).json({ message: 'Use the Special Orders final Save Transaction endpoint for special-order sales.' });
    }
    if (clientRequestId) {
      const existingSale = await Sale.findOne({ clientRequestId });
      if (existingSale) {
        if (!canAccessSale(existingSale, req.user)) return res.status(403).json({ message: 'You can only access your own sales.' });
        if (existingSale.specialOrderId || existingSale.saleType === 'special-order') return res.status(400).json({ message: 'Use the Special Orders final Save Transaction endpoint for special-order sales.' });
        return res.status(200).json(publicCreatedSale(existingSale));
      }
    }

    const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    const downPaymentFiles = req.downPaymentProofFiles || [];
    validateDownPaymentProofs(paymentMethod, downPaymentFiles);
    if (req.file) uploadedDocument = await uploadDocument(req.file);
    for (const file of downPaymentFiles) uploadedDownPaymentProofs.push(await persistProofOfPayment({ file, user: req.user }));

    const rawInvoice = Object.prototype.hasOwnProperty.call(req.body || {}, 'referenceNumber')
      ? req.body.referenceNumber : req.body?.transactionReferenceNumber;
    if (typeof rawInvoice === 'string' && rawInvoice.trim()
      && rawInvoice.trim().length <= TRANSACTION_REFERENCE_MAX_LENGTH
      && isValidTransactionReferenceNumber(rawInvoice.trim())
      && Array.isArray(req.body?.items) && req.body.items.length) {
      await prepareSpecialOrderInvoice(rawInvoice.trim());
    }

    session = await mongoose.startSession();
    let createdSale = null;
    let createdCreditTransaction = null;

    await withPostCommitNotifications(session, async () => {
      const created = await executeSaleCreation({ req, session, clientRequestId, supportingDocument: uploadedDocument, downPaymentProofs: uploadedDownPaymentProofs });
      createdSale = created.sale;
      createdCreditTransaction = created.creditTransaction;
    });
    documentPersisted = Boolean(createdSale?._id);

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

    return res.status(201).json(publicCreatedSale(createdSale));
  } catch (error) {
    const duplicateRequest = (error?.code === 11000 && error?.keyPattern?.clientRequestId)
      || (error?.status === 409 && clientRequestId);
    if (duplicateRequest && clientRequestId) {
      const existingSale = await Sale.findOne({ clientRequestId });
      if (existingSale) {
        if (!canAccessSale(existingSale, req.user)) return res.status(403).json({ message: 'You can only access your own sales.' });
        if (existingSale.specialOrderId || existingSale.saleType === 'special-order') return res.status(400).json({ message: 'Use the Special Orders final Save Transaction endpoint for special-order sales.' });
        return res.status(200).json(publicCreatedSale(existingSale));
      }
    }

    if (isTransactionReferenceDuplicateKeyError(error)) {
      return res.status(409).json({ message: TRANSACTION_REFERENCE_DUPLICATE_MESSAGE });
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
    if (uploadedDocument?.key && !documentPersisted) {
      try { await removeDocument(uploadedDocument.key); } catch (error) { console.error('Unable to remove orphan supporting document:', error.message); }
    }
    if (!documentPersisted) {
      for (const proof of uploadedDownPaymentProofs) {
        try {
          const referenced = await CreditTransaction.exists({ 'paymentHistory.proofs.storageKey': proof.storageKey });
          if (!referenced) await removeStoredProof(proof.storageKey);
        } catch (error) { console.error('Unable to verify cleanup for Down Payment Proof:', error.message); }
      }
    }
  }
};

const finalizeSale = async (req, res, next) => {
  try {
    const rawPayload = req.body?.payload;
    if (typeof rawPayload !== 'string') return res.status(400).json({ message: 'Final transaction payload is required.' });
    const payload = JSON.parse(rawPayload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ message: 'Final transaction payload is invalid.' });
    }
    req.body = { ...payload, requireTransactionReference: true };
    return createSale(req, res, next);
  } catch {
    return res.status(400).json({ message: 'Final transaction payload is invalid.' });
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
  const uploaded = [];
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

    const files = submittedVoidProofFiles(req);
    if (files.length) {
      const existingSale = await findSale(req.params.id);
      if (!existingSale) return res.status(404).json({ message: 'Sale not found.' });
      if (getSaleStatus(existingSale) !== 'voided') await uploadVoidProofSet(files, upload, uploaded);
    }

    const result = await (dependencies.executeSaleVoid || executeSaleVoid)({
      saleId: req.params.id,
      reason,
      requestId,
      supportingProof: uploaded[0] || null,
      supportingProofs: uploaded,
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || '',
    });
    persisted = Boolean(uploaded.length
      && !result.replayed
      && String(result.sale?.voidInfo?.supportingProof?.key || '') === String(uploaded[0].key));
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
    if (!persisted) await removeVoidProofSet(uploaded, remove);
  }
};

const requestSaleVoid = async (req, res, next, dependencies = {}) => {
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const updateSale = dependencies.updateSale || ((query, update, session) => Sale.findOneAndUpdate(query, update, { new: true, runValidators: true, ...(session ? { session } : {}) }));
  const upload = dependencies.uploadProof || uploadProof;
  const remove = dependencies.removeProof || removeProof;
  const publishSale = dependencies.publishSale || publishSaleUpdated;
  const uploaded = [];
  let persisted = false;
  try {
    if (String(req.user?.role || '').toLowerCase() !== 'cashier') return res.status(403).json({ message: 'Only a Cashier can submit a Void request.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const sale = await findSale(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found.' });
    if (!canAccessSale(sale, req.user)) return res.status(403).json({ message: 'You can only request a void for your own Sale.' });
    const eligibility = getSaleVoidEligibility(sale);
    if (!eligibility.eligible) return res.status(409).json({ message: eligibility.reason });
    if (sale.voidRequest?.status === 'pending') return res.status(409).json({ message: 'A Void request is already pending.' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ message: 'Void request reason is required.' });
    if (reason.length > 500) return res.status(400).json({ message: 'Void request reason must be 500 characters or fewer.' });
    await uploadVoidProofSet(submittedVoidProofFiles(req), upload, uploaded);
    const requestedAt = new Date();
    const request = {
      status: 'pending',
      reason,
      requestedBy: req.user._id,
      requestedByName: resolveCashierName(req.user),
      requestedAt,
      supportingProof: uploaded[0] || null,
      supportingProofs: uploaded,
      reviewedBy: null,
      reviewedByName: '',
      reviewedAt: null,
      declineReason: '',
    };
    const updated = await updateSale({ _id: sale._id, status: { $ne: 'voided' }, 'voidRequest.status': { $ne: 'pending' } }, { $set: { voidRequest: request } });
    if (!updated) return res.status(409).json({ message: 'The Sale changed elsewhere. Refresh and retry.' });
    persisted = true;
    await (dependencies.writeActivityLog || writeActivityLog)({
      user: req.user,
      action: 'SALE_VOID_REQUESTED',
      details: `${displaySaleId(updated)} Void requested. Reason: ${reason}.`,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || '',
    });
    publishSale({ saleId: updated._id, cashierId: updated.cashier, changeType: 'sale.void-request.requested' });
    return res.status(201).json(mapSaleToTransactionContract(updated));
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (!persisted) await removeVoidProofSet(uploaded, remove);
  }
};

const getPendingSaleVoidRequestCount = async (req, res, next, dependencies = {}) => {
  const countSales = dependencies.countSales || ((query) => Sale.countDocuments(query));
  try {
    if (!['admin', 'superadmin'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ message: 'Only an Admin or Super Admin can review Void requests.' });
    }
    const count = await countSales({ 'voidRequest.status': 'pending' });
    return res.json({ count });
  } catch (error) {
    return next(error);
  }
};

const declineSaleVoidRequest = async (req, res, next, dependencies = {}) => {
  const updateSale = dependencies.updateSale || ((query, update) => Sale.findOneAndUpdate(query, update, { new: true, runValidators: true }));
  const publishSale = dependencies.publishSale || publishSaleUpdated;
  try {
    if (!['admin', 'superadmin'].includes(String(req.user?.role || '').toLowerCase())) return res.status(403).json({ message: 'Only an Admin or Super Admin can decline a Void request.' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const declineReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (declineReason.length > 500) return res.status(400).json({ message: 'Decline reason must be 500 characters or fewer.' });
    const reviewedAt = new Date();
    const updated = await updateSale({ _id: req.params.id, status: { $ne: 'voided' }, 'voidRequest.status': 'pending' }, { $set: {
      'voidRequest.status': 'declined',
      'voidRequest.reviewedBy': req.user._id,
      'voidRequest.reviewedByName': resolveCashierName(req.user),
      'voidRequest.reviewedAt': reviewedAt,
      'voidRequest.declineReason': declineReason,
    } });
    if (!updated) return res.status(409).json({ message: 'No pending Void request is available to decline.' });
    await (dependencies.writeActivityLog || writeActivityLog)({
      user: req.user,
      action: 'SALE_VOID_REQUEST_DECLINED',
      details: `${displaySaleId(updated)} Void request declined.${declineReason ? ` Reason: ${declineReason}.` : ''}`,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || '',
    });
    publishSale({ saleId: updated._id, cashierId: updated.cashier, changeType: 'sale.void-request.declined' });
    return res.json(mapSaleToTransactionContract(updated));
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

const canAccessSale = (sale, user) => user?.role !== 'cashier'
  || String(sale?.cashier?._id || sale?.cashier || '') === String(user?._id || '');

const updateSaleTransactionReference = async (req, res, next, dependencies = {}) => {
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const updateSale = dependencies.updateSale || ((query, update) => Sale.findOneAndUpdate(query, update, { new: true, runValidators: true }));
  const findSaleByReference = dependencies.findSaleByReference
    || ((referenceNumber, excludedSaleId) => findSaleWithTransactionReference(referenceNumber, excludedSaleId));
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
    const existingReferenceNumber = String(sale.transactionReference?.referenceNumber || '').trim();
    const existingDocument = sale.transactionReference?.supportingDocument || null;
    if (existingReferenceNumber || existingDocument) {
      return res.status(409).json({ message: 'The saved Transaction Reference is locked. An Admin can use Correct Reference when a correction is required.' });
    }

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
    if (!referenceNumber && !req.file) {
      return res.status(400).json({ message: 'Provide a Reference No. or Supporting Document.' });
    }
    if (referenceNumber && await findSaleByReference(referenceNumber, sale._id)) {
      return res.status(409).json({ message: TRANSACTION_REFERENCE_DUPLICATE_MESSAGE });
    }

    if (req.file) uploaded = await upload(req.file);
    const update = { $set: { transactionReference: {
      referenceNumber,
      supportingDocument: uploaded,
      savedAt: new Date(),
      savedBy: req.user?._id || null,
      correctedAt: null,
      correctionHistory: [],
    } } };
    const query = {
      _id: sale._id,
      $and: [
        { $or: [{ 'transactionReference.referenceNumber': { $exists: false } }, { 'transactionReference.referenceNumber': '' }, { transactionReference: null }] },
        { $or: [{ 'transactionReference.supportingDocument': { $exists: false } }, { 'transactionReference.supportingDocument': null }, { transactionReference: null }] },
      ],
    };
    const lockWrite = dependencies.withInvoiceWriteLock || (dependencies.findSaleByReference
      ? async (_number, _id, write) => write(null) : withInvoiceWriteLock);
    const updated = await lockWrite(referenceNumber, sale._id, (session) => updateSale(query, update, session));
    if (!updated) return res.status(409).json({ message: 'This reference was already saved. Refresh to view the locked evidence.' });
    persisted = true;
    return res.json(mapSaleToTransactionContract(updated));
  } catch (error) {
    if (isTransactionReferenceDuplicateKeyError(error)) {
      return res.status(409).json({ message: TRANSACTION_REFERENCE_DUPLICATE_MESSAGE });
    }
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (uploaded?.key && !persisted) {
      try { await remove(uploaded.key); } catch (error) { console.error('Unable to remove orphan supporting document:', error.message); }
    }
  }
};

const correctSaleTransactionReference = async (req, res, next, dependencies = {}) => {
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const updateSale = dependencies.updateSale || ((query, update, session) => Sale.findOneAndUpdate(query, update, { new: true, runValidators: true, ...(session ? { session } : {}) }));
  const findSaleByReference = dependencies.findSaleByReference
    || ((referenceNumber, excludedSaleId) => findSaleWithTransactionReference(referenceNumber, excludedSaleId));
  const upload = dependencies.upload || uploadDocument;
  const remove = dependencies.remove || removeDocument;
  let uploaded = null;
  let persisted = false;
  try {
    if (!['admin', 'superadmin'].includes(String(req.user?.role || '').toLowerCase())) {
      return res.status(403).json({ message: 'Only an Admin or Super Admin can correct a saved Transaction Reference.' });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Sale ID.' });
    const sale = await findSale(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sale not found.' });
    if (getSaleStatus(sale) === 'voided') return res.status(409).json({ message: 'Transaction references are read-only after a Sale is voided.' });

    const currentNumber = String(sale.transactionReference?.referenceNumber || '').trim();
    const currentDocument = sale.transactionReference?.supportingDocument || null;
    if (!currentNumber && !currentDocument) return res.status(409).json({ message: 'Save the initial Transaction Reference before using correction.' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ message: 'Correction reason is required.' });
    if (reason.length > 500) return res.status(400).json({ message: 'Correction reason must be 500 characters or fewer.' });

    const hasNumber = Object.prototype.hasOwnProperty.call(req.body || {}, 'referenceNumber');
    if (hasNumber && typeof req.body.referenceNumber !== 'string') return res.status(400).json({ message: 'Reference No. must be text.' });
    const nextNumber = hasNumber ? String(req.body.referenceNumber || '').trim() : currentNumber;
    if (nextNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH) return res.status(400).json({ message: `Reference No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.` });
    if (nextNumber !== currentNumber && nextNumber && !isValidTransactionReferenceNumber(nextNumber)) return res.status(400).json({ message: TRANSACTION_REFERENCE_NUMERIC_MESSAGE });
    if (!nextNumber && !req.file && !currentDocument) return res.status(400).json({ message: 'Provide a Reference No. or Supporting Document.' });
    if (nextNumber === currentNumber && !req.file) return res.status(400).json({ message: 'Change the Reference No. or choose a new Supporting Document.' });
    if (nextNumber && nextNumber !== currentNumber && await findSaleByReference(nextNumber, sale._id)) {
      return res.status(409).json({ message: TRANSACTION_REFERENCE_DUPLICATE_MESSAGE });
    }

    if (req.file) uploaded = await upload(req.file);
    const now = new Date();
    const nextDocument = uploaded || currentDocument;
    const historyEntry = {
      previousReferenceNumber: currentNumber,
      previousSupportingDocument: currentDocument,
      correctedReferenceNumber: nextNumber,
      correctedSupportingDocument: nextDocument,
      reason,
      correctedBy: req.user._id,
      correctedByName: resolveCashierName(req.user),
      correctedAt: now,
    };
    const query = {
      _id: sale._id,
      'transactionReference.referenceNumber': currentNumber,
      'transactionReference.supportingDocument.key': currentDocument?.key || null,
    };
    const update = {
      $set: {
        'transactionReference.referenceNumber': nextNumber,
        'transactionReference.supportingDocument': nextDocument,
        'transactionReference.correctedAt': now,
      },
      $push: { 'transactionReference.correctionHistory': historyEntry },
    };
    const lockWrite = dependencies.withInvoiceWriteLock || (dependencies.findSaleByReference
      ? async (_number, _id, write) => write(null) : withInvoiceWriteLock);
    const updated = await lockWrite(nextNumber !== currentNumber ? nextNumber : '', sale._id,
      (session) => updateSale(query, update, session));
    if (!updated) return res.status(409).json({ message: 'This reference changed elsewhere. Refresh and retry.' });
    persisted = true;
    await (dependencies.writeActivityLog || writeActivityLog)({
      user: req.user,
      action: 'SALE_REFERENCE_CORRECTED',
      details: `${displaySaleId(updated)} Transaction Reference corrected. Reason: ${reason}.`,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || '',
    });
    return res.json(mapSaleToTransactionContract(updated));
  } catch (error) {
    if (isTransactionReferenceDuplicateKeyError(error)) {
      return res.status(409).json({ message: TRANSACTION_REFERENCE_DUPLICATE_MESSAGE });
    }
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (uploaded?.key && !persisted) {
      try { await remove(uploaded.key); } catch (error) { console.error('Unable to remove orphan corrected supporting document:', error.message); }
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
    let canRead = canAccessSale(sale, req.user);
    if (!canRead && sale.saleType === 'special-order' && sale.specialOrderId) {
      // An administrator may have finalized a cashier-owned order. Grant only
      // read access to its linked evidence, not generic sale/reference editing.
      canRead = Boolean(await SpecialOrder.exists({ _id: sale.specialOrderId, createdBy: req.user._id, status: 'Completed', linkedSaleId: sale._id }));
    }
    if (!canRead) return res.status(403).json({ message: 'You can only view your own sales.' });
    let document = sale.transactionReference?.supportingDocument;
    if (req.query?.correctionIndex !== undefined) {
      if (!['admin', 'superadmin'].includes(String(req.user?.role || '').toLowerCase())) {
        return res.status(403).json({ message: 'Only an Admin or Super Admin can view correction history evidence.' });
      }
      const correctionIndex = Number(req.query.correctionIndex);
      const correction = Number.isSafeInteger(correctionIndex)
        ? sale.transactionReference?.correctionHistory?.[correctionIndex]
        : null;
      if (!correction) return res.status(404).json({ message: 'Correction history entry is not available.' });
      document = req.query.version === 'corrected'
        ? correction.correctedSupportingDocument
        : correction.previousSupportingDocument;
    }
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
    const stage = String(req.query?.stage || '').toLowerCase();
    if (stage && !['request', 'void'].includes(stage)) return res.status(400).json({ message: 'Invalid proof stage.' });
    const index = req.query?.index === undefined ? 0 : Number(req.query.index);
    if (!Number.isSafeInteger(index) || index < 0) return res.status(400).json({ message: 'Invalid proof index.' });
    const completedHasProof = Boolean(sale.voidInfo?.supportingProof || sale.voidInfo?.supportingProofs?.length);
    const source = stage === 'request' ? sale.voidRequest : stage === 'void' ? sale.voidInfo : completedHasProof ? sale.voidInfo : sale.voidRequest;
    const proof = source?.supportingProofs?.[index] || (index === 0 ? source?.supportingProof : null);
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

module.exports = {
  mapSaleToTransactionContract,
  listSales,
  listSalesHistoryView,
  getSaleHistoryView,
  createSale,
  finalizeSale,
  voidSale,
  requestSaleVoid,
  getPendingSaleVoidRequestCount,
  declineSaleVoidRequest,
  getSaleVoidProof,
  updateSaleTransactionReference,
  correctSaleTransactionReference,
  getSaleSupportingDocument,
  generateCreditTransactionId,
  __test: { validateDownPaymentProofs, executeSaleCreation, computeDueDate },
};
