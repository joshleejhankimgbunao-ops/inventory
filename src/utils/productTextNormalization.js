const TECHNICAL_TERMS = new Map([
  ['abs', 'ABS'], ['ac', 'AC'], ['awg', 'AWG'], ['cpvc', 'CPVC'], ['gi', 'GI'],
  ['hdpe', 'HDPE'], ['hdf', 'HDF'], ['hp', 'HP'], ['ibm', 'IBM'], ['ip', 'IP'],
  ['led', 'LED'], ['ldpe', 'LDPE'], ['mdf', 'MDF'], ['nema', 'NEMA'], ['osb', 'OSB'],
  ['pex', 'PEX'], ['ppr', 'PPR'], ['pvc', 'PVC'], ['thhn', 'THHN'], ['thw', 'THW'],
  ['u-pvc', 'uPVC'], ['upvc', 'uPVC'], ['usb', 'USB'],
]);

const UNITS = new Set([
  'cm', 'ft', 'g', 'gal', 'in', 'inch', 'inches', 'kg', 'km', 'l', 'lb', 'lbs',
  'm', 'mg', 'ml', 'mm', 'oz', 'pc', 'pcs', 'yd',
]);

const hasNumericContext = (value, start, end) => (
  /\d$/.test(value.slice(0, start))
  || /^\d/.test(value.slice(end))
  || /(?:^|\s)\d+(?:[./ -]\d+)*\s*$/.test(value.slice(0, start))
  || /^\s*\d+(?:[./ -]\d)*(?:\s|$)/.test(value.slice(end))
);

const isNumericMultiplicationMark = (value, start, end) => (
  /\d[\p{L}]*\s*$/u.test(value.slice(0, start)) && /^\s*\d/.test(value.slice(end))
);

const isIntentionalMixedCase = (word) => (
  /^[A-Z][a-z]+[A-Z][a-z]+$/.test(word)
  || /^[a-z][A-Z][a-z]+$/.test(word)
);

const titleCaseWord = (word) => {
  const technical = TECHNICAL_TERMS.get(word.toLowerCase());
  if (technical) return technical;
  if (/^[\p{Lu}][\p{Ll}]+$/u.test(word) || isIntentionalMixedCase(word)) return word;

  const normalized = word.toLowerCase();
  return normalized.replace(/^(\p{L})/u, (letter) => letter.toUpperCase());
};

const normalizeToken = (token) => {
  if (!token.includes("'") && !token.includes('’')) return titleCaseWord(token);
  const pieces = token.split(/(['’])/);
  return pieces.map((piece, index) => {
    if (piece === "'" || piece === '’') return piece;
    if (index > 0 && piece.length === 1) return piece.toLocaleLowerCase();
    return titleCaseWord(piece);
  }).join('');
};

export const normalizeProductText = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.replace(/[\p{L}]+(?:['’][\p{L}]+)*/gu, (token, offset, source) => {
    const end = offset + token.length;
    const isUnit = UNITS.has(token.toLowerCase()) && hasNumericContext(source, offset, end);
    const isMeasurementSeparator = token.toLowerCase() === 'x' && isNumericMultiplicationMark(source, offset, end);
    const isNumericOrModelFragment = /\d/.test(source[offset - 1] || '')
      || /\d/.test(source[end] || '')
      || /^[./#-]\s*\d/.test(source.slice(end))
      || /\d[./#-]$/.test(source.slice(0, offset));
    if (isUnit || isMeasurementSeparator || isNumericOrModelFragment) return token;
    return normalizeToken(token);
  });
};

export const normalizeProductAttributeValues = (definitions = [], values = {}) => {
  const normalized = { ...(values || {}) };
  for (const definition of definitions) {
    if (definition?.type && definition.type !== 'text') continue;
    if (typeof normalized[definition?.key] !== 'string') continue;
    normalized[definition.key] = normalizeProductText(normalized[definition.key]);
  }
  return normalized;
};
