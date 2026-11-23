import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeProductAttributeValues, normalizeProductText } from '../../src/utils/productTextNormalization.js';

test('normalizes lowercase, uppercase, and inconsistent descriptive text to Title Case', () => {
  assert.equal(normalizeProductText('electrical wire'), 'Electrical Wire');
  assert.equal(normalizeProductText('ELECTRICAL WIRE'), 'Electrical Wire');
  assert.equal(normalizeProductText('dAvIeS lAtEx PaInT'), 'Davies Latex Paint');
  assert.equal(normalizeProductText('yellow-green / red'), 'Yellow-Green / Red');
  assert.equal(normalizeProductText("  mAtErIaL: pvc, o'NEIL  "), "Material: PVC, O'Neil");
});

test('preserves technical abbreviations and intentional brand casing', () => {
  assert.equal(normalizeProductText('pvc led abs pipe'), 'PVC LED ABS Pipe');
  assert.equal(normalizeProductText('Boysen DeWalt iPhone eBay'), 'Boysen DeWalt iPhone eBay');
  assert.equal(normalizeProductText('PHELPS DODGE'), 'Phelps Dodge');
});

test('does not change measurements, numeric model fragments, or blank optional text', () => {
  assert.equal(normalizeProductText('2.0mm x 4 ft'), '2.0mm x 4 ft');
  assert.equal(normalizeProductText('PVC 1/2 in'), 'PVC 1/2 in');
  assert.equal(normalizeProductText('ABC-123'), 'ABC-123');
  assert.equal(normalizeProductText('   '), '');
  assert.equal(normalizeProductText(null), '');
});

test('normalizes only configured text attributes, leaving selections and numeric values unchanged', () => {
  const definitions = [
    { key: 'material', type: 'text' },
    { key: 'finish', type: 'select' },
    { key: 'thickness', type: 'number' },
    { key: 'weight', type: 'number_unit', unit: 'kg' },
  ];
  assert.deepEqual(normalizeProductAttributeValues(definitions, {
    material: 'pvc board', finish: 'matte-black', thickness: '2.5', weight: 10,
  }), {
    material: 'PVC Board', finish: 'matte-black', thickness: '2.5', weight: 10,
  });
});

test('Add/Edit Product forms normalize on blur and normalize the values sent to save', async () => {
  const page = await readFile(new URL('../../src/pages/ProductList.jsx', import.meta.url), 'utf8');
  const attributeFields = await readFile(new URL('../../src/components/ProductAttributeFields.jsx', import.meta.url), 'utf8');
  assert.match(page, /onBlur=\{e => setFormData\(\(prev\) => \(\{ \.\.\.prev, name: normalizeProductText\(e\.target\.value\) \}\)\)\}/);
  for (const field of ['brand', 'color', 'size']) {
    assert.match(page, new RegExp(`onBlur={e => setFormData\\(\\(prev\\) => \\(\\{ \\.\\.\\.prev, ${field}: normalizeProductText\\(e\\.target\\.value\\) \\}\\)\\)}`));
  }
  assert.match(page, /const normalizedAttributeValues = normalizeProductAttributeValues\(attributeDefinitions, formData\.attributes\)/);
  assert.equal((page.match(/attributes: normalizedAttributeValues/g) || []).length, 2, 'both create and edit payloads use normalized attributes');
  const saveHandler = page.slice(page.indexOf('const handleSave = async'));
  assert.equal((saveHandler.match(/name: cleanedName/g) || []).length, 2, 'both create and edit payloads use the normalized name');
  assert.match(attributeFields, /onBlur: \(!definition\.type \|\| definition\.type === 'text'\)/);
});
