const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const {
  JWT_MIN_SECRET_BYTES,
  requireExplicitEnv,
  requireExplicitPinEnv,
  validateJwtSecret,
} = require('../src/config/security');

test('JWT validation rejects missing, blank, short, placeholder, whitespace, and repeated values', () => {
  const rejected = [
    undefined,
    '',
    '   ',
    'x'.repeat(JWT_MIN_SECRET_BYTES - 1),
    'x'.repeat(JWT_MIN_SECRET_BYTES),
    ` ${crypto.randomBytes(32).toString('base64url')}`,
    'replace-with-random-32-byte-or-longer-secret',
    'example-value-padded-until-it-is-long-enough-123456789',
  ];

  for (const candidate of rejected) {
    assert.throws(() => validateJwtSecret(candidate));
  }
});

test('JWT validation accepts a runtime-random 32-byte secret', () => {
  const candidate = crypto.randomBytes(32).toString('base64url');
  assert.equal(validateJwtSecret(candidate), candidate);
});

test('JWT validation errors never echo a rejected candidate', () => {
  const candidate = 'sentinel-example-value-that-must-not-appear-in-errors';
  assert.throws(
    () => validateJwtSecret(candidate),
    (error) => !error.message.includes(candidate),
  );
});

test('rotating a JWT key rejects old tokens and accepts newly signed tokens', () => {
  const oldSecret = crypto.randomBytes(32).toString('base64url');
  const newSecret = crypto.randomBytes(32).toString('base64url');
  const oldToken = jwt.sign({ id: 'test-user' }, oldSecret, { algorithm: 'HS256' });
  const newToken = jwt.sign({ id: 'test-user' }, newSecret, { algorithm: 'HS256' });

  assert.throws(() => jwt.verify(oldToken, newSecret, { algorithms: ['HS256'] }));
  assert.equal(jwt.verify(newToken, newSecret, { algorithms: ['HS256'] }).id, 'test-user');
});

test('explicit credential helpers fail closed and preserve password bytes', () => {
  const previousPassword = process.env.TEST_REQUIRED_PASSWORD;
  const previousPin = process.env.TEST_REQUIRED_PIN;

  try {
    delete process.env.TEST_REQUIRED_PASSWORD;
    delete process.env.TEST_REQUIRED_PIN;
    assert.throws(() => requireExplicitEnv('TEST_REQUIRED_PASSWORD'));
    assert.throws(() => requireExplicitPinEnv('TEST_REQUIRED_PIN'));

    process.env.TEST_REQUIRED_PASSWORD = '  deliberate surrounding spaces  ';
    process.env.TEST_REQUIRED_PIN = '12345x';
    assert.equal(requireExplicitEnv('TEST_REQUIRED_PASSWORD'), '  deliberate surrounding spaces  ');
    assert.throws(() => requireExplicitPinEnv('TEST_REQUIRED_PIN'));
  } finally {
    if (previousPassword === undefined) delete process.env.TEST_REQUIRED_PASSWORD;
    else process.env.TEST_REQUIRED_PASSWORD = previousPassword;
    if (previousPin === undefined) delete process.env.TEST_REQUIRED_PIN;
    else process.env.TEST_REQUIRED_PIN = previousPin;
  }
});
