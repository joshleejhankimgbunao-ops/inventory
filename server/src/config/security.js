const JWT_MIN_SECRET_BYTES = 32;

const PLACEHOLDER_MARKERS = Object.freeze([
  'change-me',
  'changeme',
  'default',
  'example',
  'placeholder',
  'replace-me',
  'replace-with',
  'sample',
  'your-secret',
]);

const getUtf8ByteLength = (value) => Buffer.byteLength(value, 'utf8');

const isRepeatedPattern = (value) => {
  for (let patternLength = 1; patternLength <= Math.min(8, Math.floor(value.length / 2)); patternLength += 1) {
    if (value.length % patternLength !== 0) {
      continue;
    }

    const pattern = value.slice(0, patternLength);
    if (pattern.repeat(value.length / patternLength) === value) {
      return true;
    }
  }

  return false;
};

const validateJwtSecret = (rawSecret) => {
  if (typeof rawSecret !== 'string' || !rawSecret.trim()) {
    throw new Error('JWT_SECRET is required and must not be empty.');
  }

  if (rawSecret !== rawSecret.trim()) {
    throw new Error('JWT_SECRET must not contain leading or trailing whitespace.');
  }

  const secret = rawSecret;
  if (getUtf8ByteLength(secret) < JWT_MIN_SECRET_BYTES) {
    throw new Error(`JWT_SECRET must contain at least ${JWT_MIN_SECRET_BYTES} UTF-8 bytes.`);
  }

  const normalized = secret.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))) {
    throw new Error('JWT_SECRET must not use an example or placeholder value.');
  }

  const uniqueCharacters = new Set(secret).size;
  if (uniqueCharacters < 12 || isRepeatedPattern(secret)) {
    throw new Error('JWT_SECRET is obviously weak; use a cryptographically random value.');
  }

  return secret;
};

const getJwtSecret = () => validateJwtSecret(process.env.JWT_SECRET);

const requireExplicitEnv = (name) => {
  const rawValue = process.env[name];
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new Error(`${name} is required. Set it explicitly before running this command.`);
  }

  return rawValue;
};

const requireExplicitPinEnv = (name) => {
  const pin = requireExplicitEnv(name);
  const configuredLength = Number(process.env.PIN_LENGTH || 6);
  const pinLength = Number.isInteger(configuredLength) && configuredLength > 0 ? configuredLength : 6;

  if (!new RegExp(`^\\d{${pinLength}}$`).test(pin)) {
    throw new Error(`${name} must be exactly ${pinLength} digits.`);
  }

  return pin;
};

const requireFirstExplicitEnv = (names) => {
  for (const name of names) {
    const rawValue = process.env[name];
    if (typeof rawValue === 'string' && rawValue.trim()) {
      return rawValue;
    }
  }

  throw new Error(`${names.join(' or ')} is required. Set it explicitly before running this command.`);
};

const requireFirstExplicitPinEnv = (names) => {
  const matchingName = names.find((name) => typeof process.env[name] === 'string' && process.env[name].trim());
  if (!matchingName) {
    throw new Error(`${names.join(' or ')} is required. Set it explicitly before running this command.`);
  }

  return requireExplicitPinEnv(matchingName);
};

module.exports = {
  JWT_MIN_SECRET_BYTES,
  getJwtSecret,
  requireExplicitEnv,
  requireExplicitPinEnv,
  requireFirstExplicitEnv,
  requireFirstExplicitPinEnv,
  validateJwtSecret,
};
