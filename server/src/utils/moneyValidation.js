const MONEY_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const MAX_SAFE_MONEY_CENTAVOS = Number.MAX_SAFE_INTEGER;

const normalizeMoneySource = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  return '';
};

const getMoneyCentavos = (value) => {
  const source = normalizeMoneySource(value);
  if (!MONEY_INPUT_PATTERN.test(source)) return null;

  const [wholePart, decimalPart = ''] = source.split('.');
  return BigInt(`${wholePart}${decimalPart.padEnd(2, '0')}`);
};

const isMoneyInputTooLarge = (value) => {
  const centavos = getMoneyCentavos(value);
  return centavos !== null && centavos > BigInt(MAX_SAFE_MONEY_CENTAVOS);
};

const parseSafeMoney = (value, { min = 0 } = {}) => {
  const centavos = getMoneyCentavos(value);
  if (centavos === null || centavos > BigInt(MAX_SAFE_MONEY_CENTAVOS)) return null;

  const minCentavos = BigInt(Math.ceil(Number(min) * 100));
  if (centavos < minCentavos) return null;
  return Number(centavos) / 100;
};

const parseSafeMoneyToCentavos = (value) => {
  const centavos = getMoneyCentavos(value);
  if (centavos === null || centavos > BigInt(MAX_SAFE_MONEY_CENTAVOS)) return null;
  return Number(centavos);
};

module.exports = {
  MAX_SAFE_MONEY_CENTAVOS,
  isMoneyInputTooLarge,
  parseSafeMoney,
  parseSafeMoneyToCentavos,
};
