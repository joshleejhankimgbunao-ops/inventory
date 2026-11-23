import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getFieldErrorEntries, normalizeFieldKey } from '../../src/utils/formValidationNavigation.js';

test('normalizes bracketed server field paths for matching controls', () => {
  assert.equal(normalizeFieldKey('items[2].sellingPrice'), 'items.2.sellingprice');
});

test('reads server field errors in object and validation-list formats', () => {
  assert.deepEqual(getFieldErrorEntries({ fieldErrors: { email: 'Enter a valid email.' } }), [
    ['email', 'Enter a valid email.'],
  ]);
  assert.deepEqual(getFieldErrorEntries({ errors: [
    { path: 'items[0].quantity', message: 'Enter a whole number.' },
  ] }), [
    ['items[0].quantity', 'Enter a whole number.'],
  ]);
  assert.deepEqual(getFieldErrorEntries({ errors: { customer: { email: 'Choose a valid email.' } } }), [
    ['customer.email', 'Choose a valid email.'],
  ]);
});

test('ignores generic API errors instead of treating them as field errors', () => {
  assert.deepEqual(getFieldErrorEntries({ message: 'The server is unavailable.' }), []);
  assert.deepEqual(getFieldErrorEntries({ errors: 'Permission denied.' }), []);
});

test('installs scoped native validation, keyboard-focus, and API field-error handling', async () => {
  const source = await readFile(new URL('../../src/utils/formValidationNavigation.js', import.meta.url), 'utf8');
  const apiClient = await readFile(new URL('../../src/services/apiClient.js', import.meta.url), 'utf8');
  assert.match(source, /document\.addEventListener\('invalid', handleInvalid, true\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /field\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /app:field-validation/);
  assert.match(source, /scrollTo\(\{ top: nextTop, behavior \}\)/);
  assert.match(source, /aria-controls/);
  assert.match(source, /validationAliases/);
  assert.match(source, /getVisibleScrollBounds/);
  assert.match(apiClient, /consumePendingValidationSubmissionScope/);
  assert.match(apiClient, /detail: \{ errors: error\.validationErrors, scope: validationScope \}/);
});

test('supports visible file-upload labels and associates server errors with the originating submission', async () => {
  const source = await readFile(new URL('../../src/utils/formValidationNavigation.js', import.meta.url), 'utf8');
  const apiClient = await readFile(new URL('../../src/services/apiClient.js', import.meta.url), 'utf8');
  assert.match(source, /input\[type="file"\]/);
  assert.match(source, /validationGeneratedInvalidLabel/);
  assert.match(source, /event\.detail\?\.scope/);
  assert.match(apiClient, /const validationScope = consumePendingValidationSubmissionScope\(\)/);
});

test('connects custom POS and Special Orders payment submissions to their invalid controls', async () => {
  const posPage = await readFile(new URL('../../src/pages/PointOfSale.jsx', import.meta.url), 'utf8');
  const batchEditor = await readFile(new URL('../../src/components/ExpiryBatchVerification.jsx', import.meta.url), 'utf8');
  const specialOrders = await readFile(new URL('../../src/pages/SpecialOrders.jsx', import.meta.url), 'utf8');
  assert.match(posPage, /data-validation-scope="pos-payment"/);
  assert.match(posPage, /data-validation-scope="pos-order-list"/);
  assert.match(posPage, /data-validation-submit/);
  assert.match(posPage, /reportCheckoutFieldError\('cashAmount'/);
  assert.ok(posPage.includes('const validationPrefix = `batchPicks.${item.productKey}`'));
  assert.ok(posPage.includes('`${validationPrefix}.${field}`'));
  assert.match(batchEditor, /validationKeyPrefix/);
  assert.match(specialOrders, /data-validation-scope="special-order-payment"/);
  assert.match(specialOrders, /reportPaymentFieldError\('termDays'/);
});
