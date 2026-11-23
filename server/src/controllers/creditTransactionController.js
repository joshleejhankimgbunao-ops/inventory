const CreditTransaction = require('../models/CreditTransaction');
const Sale = require('../models/Sale');
const SpecialOrderPaymentLedger = require('../models/SpecialOrderPaymentLedger');
const ActivityLog = require('../models/ActivityLog');
const mongoose = require('mongoose');
const { getSaleStatus } = require('../../../shared/saleLifecycle.mjs');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { writeActivityLog } = require('../services/logService');
const { publishCreditTransactionsUpdated, publishSpecialOrderUpdated } = require('../services/realtimeService');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoneyToCentavos } = require('../utils/moneyValidation');
const { R2StorageError, isObjectNotFoundError, r2Storage } = require('../services/r2StorageService');
const { normalizeCreditPaymentMethod } = require('../utils/paymentMethodNormalization');
const { buildCustomerOverdueHistory } = require('../services/creditOverdueHistory');
const {
  addManilaCalendarDays,
  getManilaCalendarDayNumber,
  startOfManilaCalendarDay,
} = require('../utils/manilaCalendar');

const normalizeString = (value) => String(value || '').trim();
const MAX_CREDIT_TERM_DAYS = 60;
const PAYMENT_PROCESSING_LOCK_MS = 5 * 60 * 1000;
const PROOF_OF_PAYMENT_DIRECTORY = path.resolve(__dirname, '../../uploads/payment-proofs');
const PAYMENT_PROOF_PREFIX = 'payment-proofs/';
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const hasSignature = (buffer, signature) => Buffer.isBuffer(buffer)
  && buffer.length >= signature.length
  && signature.every((value, index) => buffer[index] === value);

const getProofImageMetadata = (file) => {
  if (!file?.buffer?.length) {
    const error = new Error('Proof of Payment is required.');
    error.status = 400;
    throw error;
  }
  if (file.buffer.length > 5 * 1024 * 1024) {
    const error = new Error('Proof of Payment must be 5 MB or smaller.');
    error.status = 400;
    throw error;
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  const isJpeg = mimeType === 'image/jpeg' && hasSignature(file.buffer, JPEG_SIGNATURE);
  const isPng = mimeType === 'image/png' && hasSignature(file.buffer, PNG_SIGNATURE);
  if (!isJpeg && !isPng) {
    const error = new Error('Proof of Payment must be a valid JPG, JPEG, or PNG image.');
    error.status = 400;
    throw error;
  }

  return {
    extension: isPng ? 'png' : 'jpg',
    mimeType: isPng ? 'image/png' : 'image/jpeg',
  };
};

const isLocalProofStorageAllowed = () => process.env.NODE_ENV !== 'production';

const toProofObjectKey = (storageKey) => `${PAYMENT_PROOF_PREFIX}${storageKey}`;

const assertValidProofStorageKey = (storageKey) => /^[a-f0-9-]+\.(jpg|png)$/i.test(String(storageKey || ''));

const persistProofOfPayment = async ({ file, user }, {
  storage = r2Storage,
  allowLocalStorage = isLocalProofStorageAllowed(),
} = {}) => {
  const { extension, mimeType } = getProofImageMetadata(file);
  const storageKey = `${randomUUID()}.${extension}`;

  if (storage.isConfigured()) {
    await storage.putObject({
      key: toProofObjectKey(storageKey),
      body: file.buffer,
      contentType: mimeType,
      metadata: {
        originalfilename: path.basename(String(file.originalname || `proof.${extension}`)),
      },
    });
  } else if (allowLocalStorage) {
    await fs.mkdir(PROOF_OF_PAYMENT_DIRECTORY, { recursive: true });
    await fs.writeFile(path.join(PROOF_OF_PAYMENT_DIRECTORY, storageKey), file.buffer, { flag: 'wx' });
  } else {
    throw new R2StorageError('Cloud storage is required for payment proofs in production.', {
      code: 'R2_NOT_CONFIGURED',
    });
  }

  return {
    storageKey,
    fileName: path.basename(String(file.originalname || `proof.${extension}`)),
    mimeType,
    uploadedAt: new Date(),
    uploadedBy: user?._id || null,
  };
};

const getSubmittedProofFiles = (req) => [
  ...(Array.isArray(req.files) ? req.files : [
    ...(req.files?.proof || []),
    ...(req.files?.proofs || []),
  ]),
  ...(req.file ? [req.file] : []),
];

const validateProofCount = (files) => {
  if (files.length < 1 || files.length > 3) {
    const error = new Error('Choose 1 to 3 proof photos.');
    error.status = 400;
    throw error;
  }
};

const persistProofSet = async ({ files, user, persistProof, saved }) => {
  validateProofCount(files);
  for (const file of files) saved.push(await persistProof({ file, user }));
  return saved;
};

const removeUnreferencedProofs = async (proofs, removeProof) => {
  for (const proof of proofs) {
    try { await removeProof(proof.storageKey); }
    catch (error) { console.error('Unable to remove unreferenced payment proof:', error.message); }
  }
};

const removeStoredProof = async (storageKey, {
  storage = r2Storage,
  allowLocalStorage = isLocalProofStorageAllowed(),
} = {}) => {
  if (!assertValidProofStorageKey(storageKey)) return;

  if (storage.isConfigured()) {
    await storage.deleteObject(toProofObjectKey(storageKey));
    return;
  }

  if (!allowLocalStorage) {
    return;
  }

  try {
    await fs.unlink(path.join(PROOF_OF_PAYMENT_DIRECTORY, storageKey));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const getStoredProof = async (storageKey, {
  storage = r2Storage,
  allowLocalStorage = isLocalProofStorageAllowed(),
} = {}) => {
  if (!assertValidProofStorageKey(storageKey)) {
    return null;
  }

  if (storage.isConfigured()) {
    try {
      const object = await storage.getObject(toProofObjectKey(storageKey));
      return { type: 'r2', object };
    } catch (error) {
      if (!isObjectNotFoundError(error) || !allowLocalStorage) {
        throw error;
      }
      // Keep previously stored local proof files accessible during local migration work.
    }
  } else if (!allowLocalStorage) {
    throw new R2StorageError('Cloud storage is required for payment proofs in production.', {
      code: 'R2_NOT_CONFIGURED',
    });
  }

  const filePath = path.resolve(PROOF_OF_PAYMENT_DIRECTORY, storageKey);
  if (!filePath.startsWith(`${PROOF_OF_PAYMENT_DIRECTORY}${path.sep}`)) {
    return null;
  }

  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  return { type: 'local', filePath };
};

const ensureCashierOwnsCreditTransaction = async ({ transaction, user }) => {
  if (user?.role !== 'cashier') return;

  const sale = await Sale.findById(transaction.orderId).select('cashier');
  if (!sale || String(sale.cashier) !== String(user._id)) {
    const error = new Error('You can only modify your own credit transactions.');
    error.status = 403;
    throw error;
  }
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

const toUserReference = (user) => {
  if (!user || typeof user !== 'object') return null;

  const id = String(user._id || user.id || '').trim();
  if (!id) return null;

  return {
    id,
    displayName: String(user.displayName || '').trim(),
    name: String(user.name || '').trim(),
    username: String(user.username || '').trim(),
    role: String(user.role || '').trim(),
  };
};

const resolveStatus = ({ remainingBalance, amountPaid, dueDate, status, now = new Date() }) => {
  if (String(status || '').toLowerCase() === 'cancelled') return 'Cancelled';
  const remaining = Number(remainingBalance || 0);
  const paid = Number(amountPaid || 0);
  const dueDay = getManilaCalendarDayNumber(dueDate);
  const todayDay = getManilaCalendarDayNumber(now);
  const isOverdue = dueDay !== null && todayDay !== null && dueDay < todayDay;

  if (remaining <= 0) return 'Paid';
  if (paid <= 0) return isOverdue ? 'Overdue' : 'Unpaid';
  return isOverdue ? 'Overdue' : 'Partially Paid';
};

const applyCreditTermExtension = async ({ transaction, extensionDays }) => {
  const extensionValue = parseStrictWholeNumber(extensionDays, { min: 1 });
  if (extensionValue === null) {
    const error = new Error('Extension day must be a whole number greater than 0.');
    error.status = 400;
    throw error;
  }

  const currentTermDays = Number(transaction.termDays || 0);
  const maxAllowedExtension = Math.max(0, MAX_CREDIT_TERM_DAYS - currentTermDays);
  if (extensionValue > maxAllowedExtension) {
    const error = new Error(`Extension exceeds maximum allowed. You can only extend by up to ${maxAllowedExtension} day(s).`);
    error.status = 400;
    throw error;
  }

  const dueDateBase = new Date(transaction.dueDate);
  if (!transaction.originalDueDate) {
    transaction.originalDueDate = new Date(dueDateBase.getTime());
  }
  const extendedDueDate = addManilaCalendarDays(dueDateBase, extensionValue);
  transaction.termDays = currentTermDays + extensionValue;
  transaction.dueDate = extendedDueDate;

  return {
    extensionDays: extensionValue,
    maxAllowedExtension,
  };
};

const saveCreditTermExtension = async ({ transaction, expectedState, model = CreditTransaction, now = new Date() }) => {
  const filter = {
    _id: expectedState._id,
    dueDate: expectedState.dueDate,
    termDays: expectedState.termDays,
    amountPaid: expectedState.amountPaid,
    remainingBalance: expectedState.remainingBalance,
    updatedAt: expectedState.updatedAt ? expectedState.updatedAt : { $in: [null] },
    $or: [
      { paymentProcessingRequestId: '' },
      { paymentProcessingRequestId: null },
      { paymentProcessingRequestId: { $exists: false } },
      { paymentProcessingStartedAt: { $lt: new Date(now.getTime() - PAYMENT_PROCESSING_LOCK_MS) } },
    ],
  };

  return model.findOneAndUpdate(filter, {
    $set: {
      dueDate: transaction.dueDate,
      originalDueDate: transaction.originalDueDate,
      termDays: transaction.termDays,
      status: transaction.status,
    },
  }, { new: true, runValidators: true });
};

const refreshOverdueRecords = async () => {
  const today = startOfManilaCalendarDay(new Date());
  await CreditTransaction.updateMany(
    {
      status: { $in: ['Unpaid', 'Partially Paid'] },
      dueDate: { $lt: today },
      remainingBalance: { $gt: 0 },
      isArchived: false,
    },
    { $set: { status: 'Overdue' } }
  );
};

const listCreditTransactions = async (req, res, next) => {
  try {
    await refreshOverdueRecords();

    const status = normalizeString(req.query?.status);
    const search = normalizeString(req.query?.search);
    const includeArchived = parseBool(req.query?.includeArchived, false);

    const query = {};

    if (!includeArchived) {
      query.isArchived = false;
    }

    if (status && status.toLowerCase() !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { creditTransactionId: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
      ];
    }

    if (req.user?.role === 'cashier') {
      const cashierSales = await Sale.find({ cashier: req.user._id }, '_id');
      const saleIds = cashierSales.map((sale) => sale._id);
      query.orderId = { $in: saleIds };
    }

    const rows = await CreditTransaction.find(query)
      .populate({
        path: 'orderId',
        select: 'createdAt paymentMethod notes cashier cashierName status collectionSource saleType specialOrderId specialOrderNumber',
        populate: {
          path: 'cashier',
          select: 'displayName name username role',
        },
      })
      .populate('paymentHistory.recordedById', 'displayName name username role')
      .sort({ createdAt: -1 });

    const records = rows.map((row) => {
      const statusValue = resolveStatus({
        remainingBalance: row.remainingBalance,
        amountPaid: row.amountPaid,
        dueDate: row.dueDate,
        status: row.status,
      });

      const notes = String(row.orderId?.notes || '').trim();
      const modeMatch = notes.match(/(?:preferred mode of payment|down payment method):\s*(.+)$/i);
      const creditPaymentMode = modeMatch ? String(modeMatch[1] || '').trim() : '';

      return {
        _id: row._id,
        creditTransactionId: row.creditTransactionId,
        orderId: row.orderId?._id || row.orderId,
        saleStatus: row.orderId?._id ? getSaleStatus(row.orderId) : null,
        orderReference: row.orderId?._id ? `TRX-${String(row.orderId._id).slice(-8).toUpperCase()}` : '',
        paymentMethod: row.orderId?.paymentMethod || 'cash',
        collectionSource: row.orderId?.collectionSource || 'sale',
        saleType: row.orderId?.saleType || 'regular',
        specialOrderId: row.orderId?.specialOrderId || null,
        specialOrderNumber: row.orderId?.specialOrderNumber || '',
        creditPaymentMode,
        customerId: row.customerId,
        customerName: row.customerName,
        totalAmount: Number(row.totalAmount || 0),
        netAmount: Number(row.netAmount || row.totalAmount || 0),
        vatAmount: Number(row.vatAmount || 0),
        grossAmount: Number(row.grossAmount || row.totalAmount || 0),
        pricingMode: row.pricingMode || 'inclusive',
        vatMode: row.vatMode || 'vatable',
        customerIsVatExempt: false,
        hasVatApplicableItems: Boolean(row.hasVatApplicableItems),
        hasVatableItems: Boolean(row.hasVatableItems),
        hasZeroRatedItems: Boolean(row.hasZeroRatedItems),
        vatRatesUsed: Array.isArray(row.vatRatesUsed) ? row.vatRatesUsed : [],
        amountPaid: Number(row.amountPaid || 0),
        downPaymentAmount: Number(row.downPaymentAmount || 0),
        remainingBalance: Number(row.remainingBalance || 0),
        termDays: Number(row.termDays || 0),
        dueDate: row.dueDate,
        status: statusValue,
        paymentHistory: Array.isArray(row.paymentHistory)
          ? row.paymentHistory.map((payment) => {
            const paymentValue = typeof payment?.toObject === 'function' ? payment.toObject() : payment;
            return {
              ...paymentValue,
              recordedByUser: toUserReference(paymentValue?.recordedById),
            };
          })
          : [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        originalDueDate: row.originalDueDate,
        cashierId: String(row.orderId?.cashier?._id || row.orderId?.cashier || ''),
        cashierName: row.orderId?.cashierName || '',
        cashierUser: toUserReference(row.orderId?.cashier),
        isArchived: Boolean(row.isArchived),
      };
    });

    return res.json(records);
  } catch (error) {
    return next(error);
  }
};

const getCustomerOverdueHistory = async (req, res, next, dependencies = {}) => {
  try {
    const findTransactions = dependencies.findTransactions || (async (user) => {
      const query = {};
      if (user?.role === 'cashier') {
        const cashierSales = await Sale.find({ cashier: user._id }, '_id').lean();
        query.orderId = { $in: cashierSales.map((sale) => sale._id) };
      }

      return CreditTransaction.find(query)
        .select('creditTransactionId customerId customerName totalAmount amountPaid remainingBalance dueDate originalDueDate status paymentHistory createdAt cancelledAt isArchived')
        .sort({ createdAt: 1 })
        .lean();
    });
    const findExtensionLogs = dependencies.findExtensionLogs
      || (() => ActivityLog.find({ action: 'Extended Credit Term' }).select('details createdAt userRef').lean());
    const findPaymentLogs = dependencies.findPaymentLogs
      || (() => ActivityLog.find({ action: 'Recorded Credit Payment' }).select('action details createdAt userRef').lean());

    const [transactions, extensionLogs, paymentLogs] = await Promise.all([
      findTransactions(req.user),
      findExtensionLogs(),
      findPaymentLogs(),
    ]);
    const customers = buildCustomerOverdueHistory(transactions, extensionLogs, dependencies.now || new Date(), paymentLogs);
    return res.json({ customers });
  } catch (error) {
    return next(error);
  }
};

const getCreditTransactionsSummary = async (req, res, next) => {
  try {
    await refreshOverdueRecords();

    const summaryQuery = { isArchived: false };

    if (req.user?.role === 'cashier') {
      const cashierSales = await Sale.find({ cashier: req.user._id }, '_id');
      const saleIds = cashierSales.map((sale) => sale._id);
      summaryQuery.orderId = { $in: saleIds };
    }

    const rows = await CreditTransaction.find(summaryQuery);
    const summary = rows.reduce((acc, row) => {
      const status = resolveStatus({
        remainingBalance: row.remainingBalance,
        amountPaid: row.amountPaid,
        dueDate: row.dueDate,
        status: row.status,
      });

      if (status === 'Cancelled') {
        return acc;
      }

      acc.totalCreditReceivables += Number(row.remainingBalance || 0);
      acc.totalVatAmount += Number(row.vatAmount || 0);
      acc.totalNetAmount += Number(row.netAmount || row.totalAmount || 0);
      acc.totalGrossAmount += Number(row.grossAmount || row.totalAmount || 0);
      if (status === 'Unpaid') acc.unpaidAccounts += 1;
      if (status === 'Partially Paid') acc.partiallyPaidAccounts += 1;
      if (status === 'Paid') acc.paidAccounts += 1;
      if (status === 'Overdue') acc.overdueAccounts += 1;
      return acc;
    }, {
      totalCreditReceivables: 0,
      totalVatAmount: 0,
      totalNetAmount: 0,
      totalGrossAmount: 0,
      unpaidAccounts: 0,
      partiallyPaidAccounts: 0,
      paidAccounts: 0,
      overdueAccounts: 0,
      totalAccounts: rows.length,
    });

    return res.json(summary);
  } catch (error) {
    return next(error);
  }
};

const getCreditTransactionById = async (req, res, next) => {
  try {
    await refreshOverdueRecords();
    const { id } = req.params;

    const row = await CreditTransaction.findById(id)
      .populate({
        path: 'orderId',
        populate: {
          path: 'cashier',
          select: 'displayName name username role',
        },
      })
      .populate('paymentHistory.recordedById', 'displayName name username role');
    if (!row) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    if (req.user?.role === 'cashier') {
      // `orderId.cashier` is populated above.  Compare its ObjectId (rather
      // than stringifying the populated User document) so this uses the same
      // canonical ownership key as the list and payment/proof endpoints.
      const orderCashierId = String(row.orderId?.cashier?._id || row.orderId?.cashier || '');
      if (!orderCashierId || orderCashierId !== String(req.user._id)) {
        return res.status(403).json({ message: 'You can only access your own credit transactions.' });
      }
    }

    const status = resolveStatus({
      remainingBalance: row.remainingBalance,
      amountPaid: row.amountPaid,
      dueDate: row.dueDate,
      status: row.status,
    });

    const record = row.toObject();

    return res.json({
      ...record,
      status,
      saleStatus: row.orderId?._id ? getSaleStatus(row.orderId) : null,
      orderReference: row.orderId?._id ? `TRX-${String(row.orderId._id).slice(-8).toUpperCase()}` : '',
      cashierId: String(row.orderId?.cashier?._id || row.orderId?.cashier || ''),
      cashierName: row.orderId?.cashierName || '',
      cashierUser: toUserReference(row.orderId?.cashier),
      paymentHistory: Array.isArray(record.paymentHistory)
        ? record.paymentHistory.map((payment) => ({
          ...payment,
          recordedByUser: toUserReference(payment?.recordedById),
        }))
        : [],
    });
  } catch (error) {
    return next(error);
  }
};

const applyPaymentToCreditTransaction = async ({
  transaction,
  amount,
  method,
  reference,
  note,
  paymentDate,
  proof = null,
  proofs = [],
  clientRequestId = '',
  user,
  req,
  onTransactionSaved,
  findSale = (id, session = null) => {
    const query = Sale.findById(id);
    return session ? query.session(session) : query;
  },
  writeLog = writeActivityLog,
  publishUpdate = publishCreditTransactionsUpdated,
  startSession = () => mongoose.startSession(),
}) => {
  const amountCentavos = parseSafeMoneyToCentavos(amount);
  if (amountCentavos === null || amountCentavos < 1) {
    const error = new Error(isMoneyInputTooLarge(amount) ? 'Amount is too large. Please enter a smaller value.' : 'Payment amount must be greater than zero and use no more than two decimal places.');
    error.status = 400;
    throw error;
  }

  const remainingCentavos = parseSafeMoneyToCentavos(transaction.remainingBalance);
  if (remainingCentavos === null || remainingCentavos <= 0) {
    const error = new Error('This account is already fully paid.');
    error.status = 400;
    throw error;
  }
  if (amountCentavos > remainingCentavos) {
    const error = new Error('Payment amount cannot exceed the outstanding balance.');
    error.status = 400;
    throw error;
  }

  const totalCentavos = parseSafeMoneyToCentavos(transaction.totalAmount);
  if (totalCentavos === null || totalCentavos < remainingCentavos) {
    const error = new Error('Credit transaction balance is invalid.');
    error.status = 409;
    throw error;
  }

  const paymentMethod = normalizeString(method);
  if (!paymentMethod) {
    const error = new Error('Select a payment method.');
    error.status = 400;
    throw error;
  }

  const appliedAmount = amountCentavos / 100;
  const nextRemainingCentavos = remainingCentavos - amountCentavos;
  const nextRemaining = nextRemainingCentavos / 100;
  const nextAmountPaid = (totalCentavos - nextRemainingCentavos) / 100;
  const recordedAt = new Date();
  const parsedPaymentDate = paymentDate ? new Date(paymentDate) : new Date();
  if (Number.isNaN(parsedPaymentDate.getTime())) {
    const error = new Error('Invalid payment date.');
    error.status = 400;
    throw error;
  }

  transaction.paymentHistory.push({
    paymentDate: parsedPaymentDate,
    recordedAt,
    amount: appliedAmount,
    type: 'payment',
    method: normalizeCreditPaymentMethod(paymentMethod),
    reference: normalizeString(reference),
    note: normalizeString(note),
    recordedBy: user?.name || user?.displayName || user?.username || 'System',
    recordedById: user?._id || null,
    clientRequestId: normalizeString(clientRequestId),
    ...(proof ? { proof } : {}),
    ...(proofs.length ? { proofs } : {}),
  });
  transaction.amountPaid = nextAmountPaid;
  transaction.remainingBalance = nextRemaining;
  transaction.status = resolveStatus({
    remainingBalance: nextRemaining,
    amountPaid: nextAmountPaid,
    dueDate: transaction.dueDate,
  });
  if (nextRemaining <= 0 && proof) {
    transaction.proofOfPayment = proof;
  }
  let relatedSpecialOrder = null;
  const persistPaymentAndSale = async (session = null) => {
    const sale = await findSale(transaction.orderId, session);
    let specialOrderLedger = null;
    if (sale?.collectionSource === 'special_order_ledger') {
      if (amountCentavos !== remainingCentavos) {
        const error = new Error('Credit Special Order balances must be settled in one final payment.');
        error.status = 400;
        throw error;
      }
      const ledgerQuery = SpecialOrderPaymentLedger.findOne({ specialOrder: sale.specialOrderId });
      specialOrderLedger = await (session ? ledgerQuery.session(session) : ledgerQuery);
      const ledgerPaid = (specialOrderLedger?.payments || []).reduce((sum, entry) => sum + Number(entry.amountCentavos || 0), 0);
      if (!specialOrderLedger || specialOrderLedger.paymentPlan !== 'credit'
        || String(specialOrderLedger.creditTransaction || '') !== String(transaction._id)
        || String(specialOrderLedger.creditTransactionId || '') !== String(transaction.creditTransactionId)
        || specialOrderLedger.remainingBalanceCentavos !== remainingCentavos
        || specialOrderLedger.amountPaidCentavos !== ledgerPaid
        || specialOrderLedger.approvedTotalCentavos !== totalCentavos
        || totalCentavos - ledgerPaid !== remainingCentavos
        || specialOrderLedger.payments.some((entry) => entry.requestId === normalizeString(clientRequestId))) {
        const error = new Error('Special Order and Credit Transaction payment records need review; no payment was recorded.');
        error.status = 409;
        throw error;
      }
      specialOrderLedger.payments.push({
        requestId: normalizeString(clientRequestId),
        type: 'final_payment',
        amountCentavos,
        method: normalizeCreditPaymentMethod(paymentMethod),
        reference: normalizeString(reference),
        notes: normalizeString(note),
        proofs: proofs.map((entry) => ({
          storageKey: entry.storageKey,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          uploadedAt: entry.uploadedAt || recordedAt,
          uploadedBy: entry.uploadedBy || user?._id,
        })),
        recordedAt,
        recordedBy: user?._id,
      });
      specialOrderLedger.amountPaidCentavos += amountCentavos;
      specialOrderLedger.remainingBalanceCentavos = 0;
      specialOrderLedger.status = 'Fully Paid';
      relatedSpecialOrder = { id: sale.specialOrderId, number: sale.specialOrderNumber };
    }

    await transaction.save(session ? { session } : undefined);
    if (sale) {
      sale.paymentStatus = nextRemaining <= 0 ? 'Paid' : 'Partially Paid';
      await sale.save(session ? { session } : undefined);
    }
    if (specialOrderLedger) await specialOrderLedger.save(session ? { session } : undefined);
  };

  if (startSession) {
    const session = await startSession();
    try {
      await session.withTransaction(async () => persistPaymentAndSale(session));
    } finally {
      await session.endSession();
    }
  } else {
    await persistPaymentAndSale();
  }
  if (onTransactionSaved) onTransactionSaved();

  await writeLog({
    user,
    action: 'Recorded Credit Payment',
    details: `Credit transaction ${transaction.creditTransactionId} payment recorded: ${appliedAmount}. Remaining balance: ${nextRemaining}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
  });

  publishUpdate({
    reason: 'credit-transaction.payment-recorded',
    creditTransactionId: transaction._id,
  });
  if (relatedSpecialOrder) publishSpecialOrderUpdated({
    orderId: relatedSpecialOrder.id,
    orderNumber: relatedSpecialOrder.number,
    status: 'In Progress',
  });

  return transaction;
};

const recordCreditPayment = async (req, res, next, dependencies = {}) => {
  const { id } = req.params;
  const paymentRequestId = normalizeString(req.body?.clientRequestId) || randomUUID();
  const findTransaction = dependencies.findTransaction || ((transactionId) => CreditTransaction.findById(transactionId));
  const findSale = dependencies.findSale || ((saleId) => Sale.findById(saleId).select('collectionSource'));
  const persistProof = dependencies.persistProof || persistProofOfPayment;
  const removeProof = dependencies.removeProof || removeStoredProof;
  const applyPayment = dependencies.applyPayment || applyPaymentToCreditTransaction;
  const claimPayment = dependencies.claimPayment || (async ({ transactionId, requestId }) => CreditTransaction.findOneAndUpdate(
    {
      _id: transactionId,
      remainingBalance: { $gt: 0 },
      status: { $ne: 'Cancelled' },
      'paymentHistory.clientRequestId': { $ne: requestId },
      $or: [
        { paymentProcessingRequestId: '' },
        { paymentProcessingRequestId: null },
        { paymentProcessingRequestId: { $exists: false } },
        { paymentProcessingStartedAt: { $lt: new Date(Date.now() - PAYMENT_PROCESSING_LOCK_MS) } },
      ],
    },
    {
      $set: {
        paymentProcessingRequestId: requestId,
        paymentProcessingStartedAt: new Date(),
      },
    },
    { new: true }
  ));
  const releasePayment = dependencies.releasePayment || (async ({ transactionId, requestId }) => CreditTransaction.updateOne(
    { _id: transactionId, paymentProcessingRequestId: requestId },
    { $set: { paymentProcessingRequestId: '', paymentProcessingStartedAt: null } }
  ));
  let paymentClaimed = false;
  const savedProofs = [];
  let isProofReferenced = false;

  try {
    let transaction = await findTransaction(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureCashierOwnsCreditTransaction({ transaction, user: req.user });
    if (String(transaction.status || '').toLowerCase() === 'cancelled') {
      return res.status(409).json({ message: 'Cancelled credit transactions cannot receive payments.' });
    }
    if ((transaction.paymentHistory || []).some((payment) => payment?.clientRequestId === paymentRequestId)) {
      return res.json(transaction);
    }
    const linkedSale = await findSale(transaction.orderId);
    if (linkedSale?.collectionSource === 'special_order_ledger') {
      return res.status(409).json({ message: 'Credit Special Order balances must be settled in one final payment using Mark Paid.' });
    }

    const claimedTransaction = await claimPayment({ transactionId: id, requestId: paymentRequestId, transaction });
    if (!claimedTransaction) {
      transaction = await findTransaction(id);
      if ((transaction?.paymentHistory || []).some((payment) => payment?.clientRequestId === paymentRequestId)) {
        return res.json(transaction);
      }
      return res.status(409).json({ message: 'This payment is already being processed.' });
    }
    transaction = claimedTransaction;
    paymentClaimed = true;

    await persistProofSet({ files: getSubmittedProofFiles(req), user: req.user, persistProof, saved: savedProofs });

    const updated = await applyPayment({
      transaction,
      amount: req.body?.amount,
      method: req.body?.method,
      reference: req.body?.reference,
      note: req.body?.note,
      paymentDate: req.body?.paymentDate,
      proof: savedProofs[0],
      proofs: savedProofs,
      clientRequestId: paymentRequestId,
      user: req.user,
      req,
      onTransactionSaved: () => {
        isProofReferenced = true;
      },
    });

    return res.json(updated);
  } catch (error) {
    if (!isProofReferenced) await removeUnreferencedProofs(savedProofs, removeProof);
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  } finally {
    if (paymentClaimed) {
      try {
        await releasePayment({ transactionId: id, requestId: paymentRequestId });
      } catch (releaseError) {
        console.error('Unable to release credit payment processing lock:', releaseError.message);
      }
    }
  }
};

const markCreditTransactionFullyPaid = async (req, res, next, dependencies = {}) => {
  const savedProofs = [];
  let isProofReferenced = false;
  let paymentClaimed = false;
  const paymentRequestId = normalizeString(req.body?.clientRequestId) || randomUUID();
  const findTransaction = dependencies.findTransaction || ((id) => CreditTransaction.findById(id));
  const ensureOwnership = dependencies.ensureOwnership || ensureCashierOwnsCreditTransaction;
  const persistProof = dependencies.persistProof || persistProofOfPayment;
  const applyPayment = dependencies.applyPayment || applyPaymentToCreditTransaction;
  const removeProof = dependencies.removeProof || removeStoredProof;
  const findSale = dependencies.findSale || ((id) => Sale.findById(id));
  const claimPayment = dependencies.claimPayment || (dependencies.findTransaction
    ? (async ({ transaction }) => transaction)
    : (async ({ id, requestId }) => CreditTransaction.findOneAndUpdate(
      {
        _id: id,
        remainingBalance: { $gt: 0 },
        status: { $ne: 'Cancelled' },
        'paymentHistory.clientRequestId': { $ne: requestId },
        $or: [
          { paymentProcessingRequestId: '' },
          { paymentProcessingRequestId: null },
          { paymentProcessingRequestId: { $exists: false } },
          { paymentProcessingStartedAt: { $lt: new Date(Date.now() - PAYMENT_PROCESSING_LOCK_MS) } },
        ],
      },
      {
        $set: {
          paymentProcessingRequestId: requestId,
          paymentProcessingStartedAt: new Date(),
        },
      },
      { new: true }
    )));
  const releasePayment = dependencies.releasePayment || (dependencies.findTransaction
    ? (async () => {})
    : (async ({ id, requestId }) => CreditTransaction.updateOne(
      { _id: id, paymentProcessingRequestId: requestId },
      { $set: { paymentProcessingRequestId: '', paymentProcessingStartedAt: null } }
    )));

  try {
    const { id } = req.params;
    let transaction = await findTransaction(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureOwnership({ transaction, user: req.user });

    if (String(transaction.status || '').toLowerCase() === 'cancelled') {
      return res.status(409).json({ message: 'Cancelled credit transactions cannot receive payments.' });
    }

    if ((transaction.paymentHistory || []).some((payment) => payment?.clientRequestId === paymentRequestId)) {
      return res.json(transaction);
    }

    const remaining = Number(transaction.remainingBalance || 0);
    if (remaining <= 0) {
      return res.json(transaction);
    }

    const extensionRaw = Object.prototype.hasOwnProperty.call(req.body || {}, 'extensionDays')
      ? req.body.extensionDays
      : 0;
    const extensionDays = parseStrictWholeNumber(extensionRaw);
    if (extensionDays === null) {
      return res.status(400).json({ message: 'Extension day must be a whole number greater than or equal to 0.' });
    }
    const saleForPayment = await findSale(transaction.orderId);
    if (saleForPayment?.collectionSource === 'special_order_ledger' && extensionDays > 0) {
      return res.status(400).json({ message: 'Extend the Credit Term before recording the final Special Order payment.' });
    }

    const claimedTransaction = await claimPayment({ id, requestId: paymentRequestId, transaction });
    if (!claimedTransaction) {
      return res.status(409).json({ message: 'This payment is already being processed.' });
    }
    transaction = claimedTransaction;
    paymentClaimed = true;

    await persistProofSet({ files: getSubmittedProofFiles(req), user: req.user, persistProof, saved: savedProofs });
    const proofOfPayment = savedProofs[0];

    if (extensionDays > 0) {
      await applyCreditTermExtension({ transaction, extensionDays });
    }

    const finalNote = normalizeString(req.body?.note) || 'Marked as fully paid.';
    const noteWithExtension = extensionDays > 0
      ? `${finalNote} (Extension applied: +${extensionDays} day(s), term is now ${transaction.termDays} day(s).)`
      : finalNote;

    transaction.proofOfPayment = proofOfPayment;

    const updated = await applyPayment({
      transaction,
      amount: remaining,
      method: req.body?.method || 'cash',
      reference: req.body?.reference,
      note: noteWithExtension,
      paymentDate: req.body?.paymentDate,
      proof: proofOfPayment,
      proofs: savedProofs,
      clientRequestId: paymentRequestId,
      user: req.user,
      req,
      onTransactionSaved: () => {
        isProofReferenced = true;
      },
    });

    if (extensionDays > 0) {
      const saleForTermSync = await findSale(transaction.orderId);
      if (saleForTermSync) {
        saleForTermSync.creditTermDays = Number(transaction.termDays || 0);
        saleForTermSync.dueDate = transaction.dueDate;
        await saleForTermSync.save();
      }
    }

    return res.json(updated);
  } catch (error) {
    if (!isProofReferenced) await removeUnreferencedProofs(savedProofs, removeProof);
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  } finally {
    if (paymentClaimed) {
      try {
        await releasePayment({ id: req.params.id, requestId: paymentRequestId });
      } catch (releaseError) {
        console.error('Unable to release credit payment processing lock:', releaseError.message);
      }
    }
  }
};

const getCreditTransactionProofOfPayment = async (req, res, next, dependencies = {}) => {
  const findTransaction = dependencies.findTransaction
    || ((id) => CreditTransaction.findById(id).select('orderId proofOfPayment'));
  const ensureOwnership = dependencies.ensureOwnership || ensureCashierOwnsCreditTransaction;
  const getProof = dependencies.getProof || getStoredProof;

  try {
    const transaction = await findTransaction(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureOwnership({ transaction, user: req.user });

    const proof = transaction.proofOfPayment;
    const storageKey = String(proof?.storageKey || '');
    if (!proof || !assertValidProofStorageKey(storageKey)) {
      return res.status(404).json({ message: 'Proof of Payment is not available.' });
    }

    try {
      const storedProof = await getProof(storageKey);
      if (!storedProof) {
        return res.status(404).json({ message: 'Proof of Payment is not available.' });
      }

      res.set('Cache-Control', 'private, no-store');
      res.type(proof.mimeType);

      if (storedProof.type === 'local') {
        return res.sendFile(storedProof.filePath);
      }

      const body = storedProof.object?.Body;
      if (!body) {
        return res.status(404).json({ message: 'Proof of Payment is not available.' });
      }
      if (typeof body.pipe === 'function') {
        body.on('error', (error) => next(error));
        body.pipe(res);
        return undefined;
      }
      if (typeof body.transformToByteArray === 'function') {
        const bytes = await body.transformToByteArray();
        return res.send(Buffer.from(bytes));
      }
      return res.status(404).json({ message: 'Proof of Payment is not available.' });
    } catch (error) {
      if (isObjectNotFoundError(error)) {
        return res.status(404).json({ message: 'Proof of Payment is not available.' });
      }
      throw error;
    }
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  }
};

const getCreditPaymentHistoryProof = async (req, res, next, dependencies = {}) => {
  const findTransaction = dependencies.findTransaction
    || ((id) => CreditTransaction.findById(id).select('orderId paymentHistory'));

  try {
    const transaction = await findTransaction(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    const requestId = normalizeString(req.params.requestId);
    const payment = (transaction.paymentHistory || []).find((entry) => normalizeString(entry?.clientRequestId) === requestId);
    const index = req.params.index === undefined ? 0 : Number(req.params.index);
    const proof = Number.isSafeInteger(index) && index >= 0
      ? (payment?.proofs?.[index] || (index === 0 ? payment?.proof : null))
      : null;
    if (!proof?.storageKey) {
      return res.status(404).json({ message: 'Proof of Payment is not available.' });
    }

    const value = typeof transaction.toObject === 'function' ? transaction.toObject() : transaction;
    return getCreditTransactionProofOfPayment(req, res, next, {
      ...dependencies,
      findTransaction: async () => ({ ...value, proofOfPayment: proof }),
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  }
};

const extendCreditTransactionTerm = async (req, res, next) => {
  try {
    const { id } = req.params;
    let transaction = await CreditTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureCashierOwnsCreditTransaction({ transaction, user: req.user });

    const remaining = Number(transaction.remainingBalance || 0);
    if (remaining <= 0) {
      return res.status(400).json({ message: 'Cannot extend term for a fully paid account.' });
    }

    const expectedState = {
      _id: transaction._id,
      updatedAt: transaction.updatedAt ? new Date(transaction.updatedAt) : null,
      dueDate: new Date(transaction.dueDate),
      termDays: Number(transaction.termDays || 0),
      amountPaid: Number(transaction.amountPaid || 0),
      remainingBalance: remaining,
    };

    const { extensionDays } = await applyCreditTermExtension({
      transaction,
      extensionDays: req.body?.extensionDays,
    });

    transaction.status = resolveStatus({
      remainingBalance: transaction.remainingBalance,
      amountPaid: transaction.amountPaid,
      dueDate: transaction.dueDate,
      status: transaction.status,
    });
    const updatedTransaction = await saveCreditTermExtension({ transaction, expectedState });
    if (!updatedTransaction) {
      return res.status(409).json({ message: 'This credit transaction changed while the extension was being applied. Refresh and try again.' });
    }
    transaction = updatedTransaction;

    const sale = await Sale.findById(transaction.orderId);
    if (sale) {
      sale.creditTermDays = Number(transaction.termDays || 0);
      sale.dueDate = transaction.dueDate;
      await sale.save();
    }

    const note = normalizeString(req.body?.note);
    await writeActivityLog({
      user: req.user,
      action: 'Extended Credit Term',
      details: `Credit transaction ${transaction.creditTransactionId} term extended by ${extensionDays} day(s). New term: ${transaction.termDays} day(s).`,
      metadata: {
        note,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishCreditTransactionsUpdated({
      reason: 'credit-transaction.term-extended',
      creditTransactionId: transaction._id,
    });

    return res.json(transaction);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  }
};

const cancelCreditTransaction = async (req, res, next, dependencies = {}) => {
  const savedProofs = [];
  let committed = false;
  const findTransaction = dependencies.findTransaction || ((id) => CreditTransaction.findById(id));
  const updateTransaction = dependencies.updateTransaction || ((query, update, options) => CreditTransaction.findOneAndUpdate(query, update, options));
  const ensureOwnership = dependencies.ensureOwnership || ensureCashierOwnsCreditTransaction;
  const persistProof = dependencies.persistProof || persistProofOfPayment;
  const removeProof = dependencies.removeProof || removeStoredProof;
  const writeLog = dependencies.writeLog || writeActivityLog;
  const publishUpdate = dependencies.publishUpdate || publishCreditTransactionsUpdated;
  try {
    const { id } = req.params;
    const transaction = await findTransaction(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureOwnership({ transaction, user: req.user });

    if (String(transaction.status || '').toLowerCase() === 'cancelled') {
      return res.json({ message: 'Credit transaction already cancelled.', transaction });
    }

    const reason = normalizeString(req.body?.reason);
    if (!reason) {
      return res.status(400).json({ message: 'Cancellation reason is required.' });
    }

    const files = getSubmittedProofFiles(req);
    validateProofCount(files);
    await persistProofSet({ files, user: req.user, persistProof, saved: savedProofs });

    const updated = await updateTransaction({
      _id: transaction._id,
      status: { $ne: 'Cancelled' },
      $or: [
        { paymentProcessingRequestId: '' },
        { paymentProcessingRequestId: null },
        { paymentProcessingRequestId: { $exists: false } },
      ],
    }, { $set: {
      cancelReason: reason,
      cancelledAt: new Date(),
      cancelledBy: req.user?._id || null,
      cancelProofs: savedProofs,
      status: 'Cancelled',
    } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ message: 'A payment or cancellation changed this credit transaction. Refresh and retry.' });
    committed = true;

    await writeLog({
      user: req.user,
      action: 'Cancelled Credit Transaction',
      details: `Cancelled credit transaction ${transaction.creditTransactionId}.`,
      metadata: {
        reason,
        orderId: transaction.orderId,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishUpdate({
      reason: 'credit-transaction.cancelled',
      creditTransactionId: transaction._id,
    });

    return res.json({ message: 'Credit transaction cancelled.', transaction: updated });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (!committed) await removeUnreferencedProofs(savedProofs, removeProof);
  }
};

const getCreditCancellationProof = async (req, res, next, dependencies = {}) => {
  try {
    const findTransaction = dependencies.findTransaction || ((id) => CreditTransaction.findById(id).select('orderId cancelProofs'));
    const ensureOwnership = dependencies.ensureOwnership || ensureCashierOwnsCreditTransaction;
    const transaction = await findTransaction(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Credit transaction not found.' });
    await ensureOwnership({ transaction, user: req.user });
    const index = Number(req.params.index);
    const proof = Number.isSafeInteger(index) && index >= 0 ? transaction.cancelProofs?.[index] : null;
    if (!proof?.storageKey) return res.status(404).json({ message: 'Cancellation proof is not available.' });
    return getCreditTransactionProofOfPayment(req, res, next, {
      ...dependencies,
      findTransaction: async () => ({ orderId: transaction.orderId, proofOfPayment: proof }),
    });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

module.exports = {
  listCreditTransactions,
  getCustomerOverdueHistory,
  getCreditTransactionsSummary,
  getCreditTransactionById,
  recordCreditPayment,
  markCreditTransactionFullyPaid,
  getCreditTransactionProofOfPayment,
  getCreditPaymentHistoryProof,
  extendCreditTransactionTerm,
  cancelCreditTransaction,
  getCreditCancellationProof,
  persistProofOfPayment,
  removeStoredProof,
  getStoredProof,
  __test: {
    getProofImageMetadata,
    getStoredProof,
    persistProofOfPayment,
    removeStoredProof,
    toProofObjectKey,
    applyCreditTermExtension,
    resolveStatus,
    saveCreditTermExtension,
    applyPaymentToCreditTransaction,
  },
};
