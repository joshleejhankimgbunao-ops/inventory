const transactionReferenceRules = require('./transactionReferenceRules.json');

const TRANSACTION_REFERENCE_MAX_LENGTH = transactionReferenceRules.maxLength;
const TRANSACTION_REFERENCE_NUMERIC_MESSAGE = transactionReferenceRules.numericMessage;
const TRANSACTION_REFERENCE_DIGITS_PATTERN = new RegExp(transactionReferenceRules.digitsPattern);

const normalizeTransactionReferenceNumber = (value) => String(value || '').trim();

const isValidTransactionReferenceNumber = (value) => {
  const normalized = normalizeTransactionReferenceNumber(value);
  return normalized.length <= TRANSACTION_REFERENCE_MAX_LENGTH
    && TRANSACTION_REFERENCE_DIGITS_PATTERN.test(normalized);
};

module.exports = {
  TRANSACTION_REFERENCE_MAX_LENGTH,
  TRANSACTION_REFERENCE_NUMERIC_MESSAGE,
  normalizeTransactionReferenceNumber,
  isValidTransactionReferenceNumber,
};
