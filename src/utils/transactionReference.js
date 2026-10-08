import transactionReferenceRules from '../../shared/transactionReferenceRules.json' with { type: 'json' };

export const TRANSACTION_REFERENCE_MAX_LENGTH = transactionReferenceRules.maxLength;
export const TRANSACTION_REFERENCE_NUMERIC_MESSAGE = transactionReferenceRules.numericMessage;
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

export const TRANSACTION_REFERENCE_REQUIRED_MESSAGE = 'Provide a Reference No. or Supporting Document.';

export const getTransactionReferenceNumberError = (value) => {
  const normalized = normalizeTransactionReferenceNumber(value);
  if (!normalized) return '';
  if (normalized.length > TRANSACTION_REFERENCE_MAX_LENGTH) {
    return `Reference No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.`;
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
