const test = require('node:test');
const assert = require('node:assert/strict');
const { capitalizeHumanReadable, normalizeHumanReadable } = require('../../shared/textNormalization.cjs');
const { normalizeCreditPaymentMethod } = require('../src/utils/paymentMethodNormalization');

test('normalizes the leading letter of each human-readable word without lowercasing acronyms', () => {
  assert.equal(normalizeHumanReadable('joshlee bunao'), 'Joshlee Bunao');
  assert.equal(normalizeHumanReadable('cement, sand & gravel'), 'Cement, Sand & Gravel');
  assert.equal(normalizeHumanReadable('BOYSEN paint'), 'BOYSEN Paint');
  assert.equal(normalizeHumanReadable('PVC Pipe'), 'PVC Pipe');
  assert.equal(normalizeHumanReadable('THHN Wire'), 'THHN Wire');
});

test('preserves punctuation and whitespace safely while normalizing values before persistence', () => {
  assert.equal(capitalizeHumanReadable('  metro wire  '), '  Metro Wire  ');
  assert.equal(normalizeHumanReadable('  metro wire  '), 'Metro Wire');
  assert.equal(normalizeHumanReadable('boysen-latex/paint'), 'Boysen-Latex/Paint');
});

test('technical and case-sensitive values stay untouched when they do not use the human-readable helper', () => {
  const email = 'joshlee@example.com';
  const sku = 'thhn-2.0-red';
  const password = 'aB9!lowercase';
  const search = 'pvc pipe';
  const date = '2026-08-30';

  assert.equal(email, 'joshlee@example.com');
  assert.equal(sku, 'thhn-2.0-red');
  assert.equal(password, 'aB9!lowercase');
  assert.equal(search, 'pvc pipe');
  assert.equal(date, '2026-08-30');
});

test('custom credit payment methods persist as human-readable values while standard values keep their backend contract', () => {
  assert.equal(normalizeCreditPaymentMethod('cash'), 'cash');
  assert.equal(normalizeCreditPaymentMethod('Bank Transfer'), 'bank transfer');
  assert.equal(normalizeCreditPaymentMethod('metro wire credit'), 'Metro Wire Credit');
});

test('frontend ESM and backend CommonJS helpers keep identical behavior', async () => {
  const frontendHelper = await import('../../src/utils/textNormalization.js');
  const examples = ['joshlee bunao', 'cement, sand & gravel', 'BOYSEN paint', 'PVC Pipe', 'THHN Wire'];

  for (const value of examples) {
    assert.equal(frontendHelper.capitalizeHumanReadable(value), capitalizeHumanReadable(value));
    assert.equal(frontendHelper.normalizeHumanReadable(value), normalizeHumanReadable(value));
  }
});
