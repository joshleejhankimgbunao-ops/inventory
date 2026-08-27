const CreditTransaction = require('../models/CreditTransaction');
const Sale = require('../models/Sale');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { writeActivityLog } = require('../services/logService');
const { publishCreditTransactionsUpdated } = require('../services/realtimeService');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoney } = require('../utils/moneyValidation');
const { R2StorageError, isObjectNotFoundError, r2Storage } = require('../services/r2StorageService');

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
  const effectiveDueDate = new Date(dueDate);
  const currentDate = new Date(now);
  effectiveDueDate.setHours(0, 0, 0, 0);
  currentDate.setHours(0, 0, 0, 0);
  const isOverdue = !Number.isNaN(effectiveDueDate.getTime()) && effectiveDueDate.getTime() < currentDate.getTime();

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
    transaction.originalDueDate = dueDateBase;
  }
  dueDateBase.setDate(dueDateBase.getDate() + extensionValue);
  transaction.termDays = currentTermDays + extensionValue;
  transaction.dueDate = dueDateBase;

  return {
    extensionDays: extensionValue,
    maxAllowedExtension,
  };
};

const refreshOverdueRecords = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
        select: 'createdAt paymentMethod notes cashier cashierName',
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
      const modeMatch = notes.match(/preferred mode of payment:\s*(.+)$/i);
      const creditPaymentMode = modeMatch ? String(modeMatch[1] || '').trim() : '';

      return {
        _id: row._id,
        creditTransactionId: row.creditTransactionId,
        orderId: row.orderId?._id || row.orderId,
        orderReference: row.orderId?._id ? `TRX-${String(row.orderId._id).slice(-8).toUpperCase()}` : '',
        paymentMethod: row.orderId?.paymentMethod || 'cash',
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
      const orderCashierId = row.orderId?.cashier ? String(row.orderId.cashier) : '';
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
  clientRequestId = '',
  user,
  req,
  onTransactionSaved,
}) => {
  const amountValue = parseSafeMoney(amount, { min: 0.01 });
  if (amountValue === null) {
    const error = new Error(isMoneyInputTooLarge(amount) ? 'Amount is too large. Please enter a smaller value.' : 'Payment amount must be greater than zero.');
    error.status = 400;
    throw error;
  }

  const remaining = Number(transaction.remainingBalance || 0);
  if (remaining <= 0) {
    const error = new Error('This account is already fully paid.');
    error.status = 400;
    throw error;
  }

  const appliedAmount = Math.min(amountValue, remaining);
  const nextAmountPaid = Number(transaction.amountPaid || 0) + appliedAmount;
  const nextRemaining = Math.max(0, Number(transaction.totalAmount || 0) - nextAmountPaid);
  const parsedPaymentDate = paymentDate ? new Date(paymentDate) : new Date();
  if (Number.isNaN(parsedPaymentDate.getTime())) {
    const error = new Error('Invalid payment date.');
    error.status = 400;
    throw error;
  }

  transaction.paymentHistory.push({
    paymentDate: parsedPaymentDate,
    amount: appliedAmount,
    method: normalizeString(method || 'cash').toLowerCase(),
    reference: normalizeString(reference),
    note: normalizeString(note),
    recordedBy: user?.displayName || user?.name || user?.username || 'System',
    recordedById: user?._id || null,
    clientRequestId: normalizeString(clientRequestId),
  });
  transaction.amountPaid = nextAmountPaid;
  transaction.remainingBalance = nextRemaining;
  transaction.status = resolveStatus({
    remainingBalance: nextRemaining,
    amountPaid: nextAmountPaid,
    dueDate: transaction.dueDate,
  });
  await transaction.save();
  if (onTransactionSaved) onTransactionSaved();

  const sale = await Sale.findById(transaction.orderId);
  if (sale) {
    sale.paymentStatus = nextRemaining <= 0 ? 'Paid' : 'Partially Paid';
    await sale.save();
  }

  await writeActivityLog({
    user,
    action: 'Recorded Credit Payment',
    details: `Credit transaction ${transaction.creditTransactionId} payment recorded: ${appliedAmount}. Remaining balance: ${nextRemaining}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
  });

  publishCreditTransactionsUpdated({
    reason: 'credit-transaction.payment-recorded',
    creditTransactionId: transaction._id,
  });

  return transaction;
};

const recordCreditPayment = async (req, res, next, dependencies = {}) => {
  const { id } = req.params;
  const paymentRequestId = normalizeString(req.body?.clientRequestId) || randomUUID();
  const findTransaction = dependencies.findTransaction || ((transactionId) => CreditTransaction.findById(transactionId));
  const claimPayment = dependencies.claimPayment || (async ({ transactionId, requestId }) => CreditTransaction.findOneAndUpdate(
    {
      _id: transactionId,
      remainingBalance: { $gt: 0 },
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

  try {
    let transaction = await findTransaction(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureCashierOwnsCreditTransaction({ transaction, user: req.user });
    if ((transaction.paymentHistory || []).some((payment) => payment?.clientRequestId === paymentRequestId)) {
      return res.json(transaction);
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

    const updated = await applyPaymentToCreditTransaction({
      transaction,
      amount: req.body?.amount,
      method: req.body?.method,
      reference: req.body?.reference,
      note: req.body?.note,
      paymentDate: req.body?.paymentDate,
      clientRequestId: paymentRequestId,
      user: req.user,
      req,
    });

    return res.json(updated);
  } catch (error) {
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
  let savedProof = null;
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

    const claimedTransaction = await claimPayment({ id, requestId: paymentRequestId, transaction });
    if (!claimedTransaction) {
      return res.status(409).json({ message: 'This payment is already being processed.' });
    }
    transaction = claimedTransaction;
    paymentClaimed = true;

    const proofOfPayment = await persistProof({ file: req.file, user: req.user });
    savedProof = proofOfPayment;

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
    if (savedProof?.storageKey && !isProofReferenced) {
      try {
        await removeProof(savedProof.storageKey);
      } catch (cleanupError) {
        console.error('Unable to remove unreferenced payment proof:', cleanupError.message);
      }
    }
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

const extendCreditTransactionTerm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transaction = await CreditTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureCashierOwnsCreditTransaction({ transaction, user: req.user });

    const remaining = Number(transaction.remainingBalance || 0);
    if (remaining <= 0) {
      return res.status(400).json({ message: 'Cannot extend term for a fully paid account.' });
    }

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
    await transaction.save();

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

const cancelCreditTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transaction = await CreditTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ message: 'Credit transaction not found.' });
    }

    await ensureCashierOwnsCreditTransaction({ transaction, user: req.user });

    if (String(transaction.status || '').toLowerCase() === 'cancelled') {
      return res.json({ message: 'Credit transaction already cancelled.', transaction });
    }

    const reason = normalizeString(req.body?.reason);
    if (!reason) {
      return res.status(400).json({ message: 'Cancellation reason is required.' });
    }

    transaction.cancelReason = reason;
    transaction.cancelledAt = new Date();
    transaction.cancelledBy = req.user?._id || null;
    transaction.status = 'Cancelled';
    await transaction.save();

    await writeActivityLog({
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

    publishCreditTransactionsUpdated({
      reason: 'credit-transaction.cancelled',
      creditTransactionId: transaction._id,
    });

    return res.json({ message: 'Credit transaction cancelled.', transaction });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listCreditTransactions,
  getCreditTransactionsSummary,
  getCreditTransactionById,
  recordCreditPayment,
  markCreditTransactionFullyPaid,
  getCreditTransactionProofOfPayment,
  extendCreditTransactionTerm,
  cancelCreditTransaction,
  __test: {
    getStoredProof,
    persistProofOfPayment,
    removeStoredProof,
    toProofObjectKey,
  },
};
