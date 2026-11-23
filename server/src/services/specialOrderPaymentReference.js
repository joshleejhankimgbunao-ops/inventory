const SpecialOrderCounter = require('../models/SpecialOrderCounter');
const { getReferenceDate, ensureReferenceCounter } = require('./specialOrderReference');

const paymentCounterKey = (date) => `PAY-${date}`;
const ensurePaymentReferenceCounter = (date) => ensureReferenceCounter(paymentCounterKey(date));

const allocatePaymentReference = async (date, session) => {
  if (!session) throw new Error('A transaction is required to allocate a payment reference.');
  const counter = await SpecialOrderCounter.findOneAndUpdate(
    { _id: paymentCounterKey(date) }, { $inc: { sequence: 1 } }, { returnDocument: 'after', session }
  ).lean();
  if (!counter || !Number.isSafeInteger(counter.sequence) || counter.sequence < 1) {
    throw new Error('Payment reference counter is unavailable or exhausted.');
  }
  return `PAY-${date}-${String(counter.sequence).padStart(4, '0')}`;
};

module.exports = { getReferenceDate, ensurePaymentReferenceCounter, allocatePaymentReference };
