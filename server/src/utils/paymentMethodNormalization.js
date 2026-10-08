const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');

const STANDARD_PAYMENT_METHODS = new Set(['cash', 'gcash', 'cheque', 'bank transfer']);

const normalizeCreditPaymentMethod = (value) => {
  const trimmed = String(value || 'cash').trim();
  const standardMethod = trimmed.toLowerCase();
  return STANDARD_PAYMENT_METHODS.has(standardMethod) ? standardMethod : normalizeHumanReadable(trimmed);
};

module.exports = { normalizeCreditPaymentMethod };
