import transactionReferenceRules from '../../shared/transactionReferenceRules.json' with { type: 'json' };

export const TRANSACTION_REFERENCE_MAX_LENGTH = transactionReferenceRules.maxLength;
export const TRANSACTION_REFERENCE_NUMERIC_MESSAGE = transactionReferenceRules.numericMessage.replace('Reference No.', 'Invoice No.');
const TRANSACTION_REFERENCE_DIGITS_PATTERN = new RegExp(transactionReferenceRules.digitsPattern);

export const normalizeTransactionReferenceNumber = (value) => String(value || '').trim();

export const isValidTransactionReferenceNumber = (value) => {
  const normalized = normalizeTransactionReferenceNumber(value);
  return normalized.length <= TRANSACTION_REFERENCE_MAX_LENGTH
    && TRANSACTION_REFERENCE_DIGITS_PATTERN.test(normalized);
};

export const normalizeTransactionReferenceInput = (value) => Array.from(String(value ?? ''))
  .filter((character) => TRANSACTION_REFERENCE_DIGITS_PATTERN.test(character))
  .join('')
  .slice(0, TRANSACTION_REFERENCE_MAX_LENGTH);

export const TRANSACTION_REFERENCE_REQUIRED_MESSAGE = 'Provide an Invoice No. or Supporting Document.';

export const toInvoiceNumberTerminology = (message) => String(message || '')
  .replaceAll('a Reference No.', 'an Invoice No.')
  .replaceAll('A Reference No.', 'An Invoice No.')
  .replaceAll('Reference No.', 'Invoice No.')
  .replaceAll('reference number', 'invoice number')
  .replaceAll('Reference number', 'Invoice number');

export const getTransactionReferenceNumberError = (value) => {
  const normalized = normalizeTransactionReferenceNumber(value);
  if (!normalized) return '';
  if (normalized.length > TRANSACTION_REFERENCE_MAX_LENGTH) {
    return `Invoice No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.`;
  }
  return isValidTransactionReferenceNumber(normalized)
    ? ''
    : TRANSACTION_REFERENCE_NUMERIC_MESSAGE;
};

export const hasUsableTransactionReference = ({
  referenceNumber,
  documentFile = null,
  existingReference = null,
  referenceNumberOnly = false,
} = {}) => {
  const normalized = normalizeTransactionReferenceNumber(referenceNumber);
  if (normalized) return isValidTransactionReferenceNumber(normalized);
  if (referenceNumberOnly) return false;
  return Boolean(documentFile || existingReference?.supportingDocument);
};
