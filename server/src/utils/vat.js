const VAT_MODE_VATABLE = 'vatable';
const VAT_MODE_ZERO_RATED = 'zero-rated';

const VAT_RATE_PERCENT_BY_MODE = {
  [VAT_MODE_VATABLE]: 12,
  [VAT_MODE_ZERO_RATED]: 0,
};

const normalizeVatMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'exempt') {
    return VAT_MODE_ZERO_RATED;
  }
  if ([VAT_MODE_VATABLE, VAT_MODE_ZERO_RATED].includes(normalized)) {
    return normalized;
  }
  return VAT_MODE_VATABLE;
};

const toMoney = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
};

const resolveVatRatePercent = (vatMode) => {
  const mode = normalizeVatMode(vatMode);
  return VAT_RATE_PERCENT_BY_MODE[mode];
};

const computeInclusiveBreakdown = ({ grossAmount, ratePercent }) => {
  const gross = toMoney(grossAmount);
  const rate = Number(ratePercent || 0);

  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      grossAmount: gross,
      netAmount: gross,
      vatAmount: 0,
    };
  }

  const divisor = 1 + (rate / 100);
  const netAmount = toMoney(gross / divisor);
  const vatAmount = toMoney(gross - netAmount);

  return {
    grossAmount: gross,
    netAmount,
    vatAmount,
  };
};

const computeTransactionVatBreakdown = ({ grossAmount = 0, vatMode, customerIsVatExempt = false }) => {
  const normalizedGross = toMoney(grossAmount);
  const normalizedVatMode = normalizeVatMode(vatMode);
  const isZeroRated = normalizedVatMode === VAT_MODE_ZERO_RATED;
  const hasVatApplicableItems = normalizedGross > 0;
  const vatRatePercent = customerIsVatExempt
    ? 0
    : (isZeroRated ? 0 : VAT_RATE_PERCENT_BY_MODE[VAT_MODE_VATABLE]);

  const netAmount = toMoney(normalizedGross / 1.12);
  const vatAmount = (isZeroRated || customerIsVatExempt)
    ? 0
    : toMoney(normalizedGross - netAmount);

  return {
    pricingMode: 'inclusive',
    customerIsVatExempt: Boolean(customerIsVatExempt),
    hasVatApplicableItems,
    hasVatableItems: hasVatApplicableItems && !isZeroRated && !customerIsVatExempt,
    hasZeroRatedItems: hasVatApplicableItems && (isZeroRated || customerIsVatExempt),
    vatRatesUsed: hasVatApplicableItems ? [vatRatePercent] : [],
    grossAmount: normalizedGross,
    netAmount,
    vatAmount,
  };
};

module.exports = {
  VAT_MODE_VATABLE,
  VAT_MODE_ZERO_RATED,
  normalizeVatMode,
  resolveVatRatePercent,
  computeInclusiveBreakdown,
  computeTransactionVatBreakdown,
  toMoney,
};