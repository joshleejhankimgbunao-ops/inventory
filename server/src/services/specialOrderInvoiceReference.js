const Sale = require('../models/Sale');
const SpecialOrderCounter = require('../models/SpecialOrderCounter');
const { ensureReferenceCounter } = require('./specialOrderReference');

const invoiceLockKey = (referenceNumber) => `INVOICE:${referenceNumber}`;

const prepareSpecialOrderInvoice = (referenceNumber) => ensureReferenceCounter(invoiceLockKey(referenceNumber));

const assertSpecialOrderInvoiceAvailable = async (referenceNumber, session, excludedSaleId = null) => {
  if (!referenceNumber) return;
  if (!session) throw new Error('A transaction is required to validate an invoice number.');
  // Serialize all invoice writes using the same invoice number before
  // checking existing Sales, without modifying historical invoice records.
  const lock = await SpecialOrderCounter.findOneAndUpdate(
    { _id: invoiceLockKey(referenceNumber) }, { $inc: { sequence: 1 } }, { returnDocument: 'after', session }
  ).lean();
  if (!lock) throw new Error('Invoice validation is unavailable. Retry the transaction.');
  if (await Sale.exists({ 'transactionReference.referenceNumber': referenceNumber, ...(excludedSaleId ? { _id: { $ne: excludedSaleId } } : {}) }).session(session)) {
    throw Object.assign(new Error('This invoice number is already used by another transaction.'), { status: 409 });
  }
};

module.exports = { prepareSpecialOrderInvoice, assertSpecialOrderInvoiceAvailable };
