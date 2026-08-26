const normalizeNumericSource = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
};

const parseStrictWholeNumber = (value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const source = normalizeNumericSource(value);
  if (!/^\d+$/.test(source)) return null;

  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};

const parseStrictDecimal = (value, { min = 0, max = Number.MAX_VALUE, maxDecimalPlaces = 2 } = {}) => {
  const source = normalizeNumericSource(value);
  const expression = new RegExp(`^\\d+(?:\\.\\d{1,${maxDecimalPlaces}})?$`);
  if (!expression.test(source)) return null;

  const parsed = Number(source);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};

module.exports = {
  parseStrictDecimal,
  parseStrictWholeNumber,
};
