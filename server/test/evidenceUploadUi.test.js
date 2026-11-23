const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const source = (name) => readFileSync(path.resolve(__dirname, '../../src', name), 'utf8');

test('shared evidence selection accepts 1–3 valid photos and rejects excess, invalid, empty, and oversized files', async () => {
  const { validateEvidenceFiles } = await import('../../src/utils/evidenceUpload.js');
  const photo = (type = 'image/jpeg', size = 1024) => ({ type, size });
  for (const count of [1, 2, 3]) {
    assert.equal(validateEvidenceFiles(Array.from({ length: count }, () => photo())), '');
  }
  assert.match(validateEvidenceFiles(Array.from({ length: 4 }, () => photo())), /no more than 3/);
  assert.match(validateEvidenceFiles([photo('image/webp')]), /JPG or PNG/);
  assert.match(validateEvidenceFiles([photo('image/png', 0)]), /5 MB/);
  assert.match(validateEvidenceFiles([photo('image/png', (5 * 1024 * 1024) + 1)]), /5 MB/);
  assert.equal(validateEvidenceFiles([photo('application/pdf')], { allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] }), '');
});

test('checkout, payment, cancellation, and void screens wire the shared uploader to distinct API fields', () => {
  const pos = source('pages/PointOfSale.jsx');
  const credit = source('pages/CreditTransactions.jsx');
  const history = source('pages/History.jsx');
  const specialOrders = source('pages/SpecialOrders.jsx');
  const api = source('services/inventoryApi.js');
  const component = source('components/EvidenceUploadField.jsx');
  const uploadArea = source('components/ProductPhotoUploadArea.jsx');
  assert.match(pos, /label="Down Payment Proof"[^\r\n]*minFiles=\{1\} maxFiles=\{3\}[^\r\n]*uploadPresentation="dashed" uploadLabel="Add Payment Proof"/);
  assert.match(pos, /downPaymentProofFiles\.length < 1/);
  assert.match(api, /formData\.append\('downPaymentProofs', file\)/);
  assert.match(credit, /label="Proof of Payment"[^\r\n]*minFiles=\{1\} maxFiles=\{3\}/);
  assert.match(credit, /label="Proof of Cancellation"[^\r\n]*minFiles=\{1\} maxFiles=\{3\}/);
  assert.match(history, /label="Supporting Proof"[^\r\n]*maxFiles=\{3\} allowedTypes=\{\['image\/jpeg', 'image\/png', 'application\/pdf'\]\}/);
  assert.match(specialOrders, /id="special-order-final-sale-document" label="Supporting Document"[^\r\n]*maxFiles=\{1\} uploadPresentation="dashed" uploadLabel="Add Photo"/);
  assert.match(specialOrders, /id="special-order-down-payment-proofs" label="Payment Proof Photos"[^\r\n]*maxFiles=\{3\} uploadPresentation="dashed" uploadLabel="Add Photo"/);
  assert.match(api, /formData\.append\('proofs', file\)/);
  for (const action of ['View', 'Replace', 'Remove', 'Add']) assert.match(component, new RegExp(action));
  assert.match(component, /<ProductPhotoUploadArea disabled=\{disabled\} inputProps=\{\{ ref: addInputRef, id: `\$\{id\}-add` \}\} labelText=\{uploadLabel\}/);
  assert.match(component, /onFilesSelected=\{addFiles\}/);
  assert.match(component, /const validate = \(nextFiles\) => validateEvidenceFiles\(nextFiles, \{ maxFiles, maxBytes, allowedTypes \}\)/);
  assert.match(component, /const message = validate\(next\)/);
  assert.match(component, /aria-label=\{`Remove \$\{file\.name\}`\}/);
  assert.match(component, /labelText=\{uploadLabel\}/);
  assert.match(uploadArea, /onDrop=/);
});
