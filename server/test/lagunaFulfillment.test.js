const test = require('node:test');
const assert = require('node:assert/strict');
const locationData = require('../../shared/lagunaPsgc.json');
const { normalizeLagunaDeliveryFields } = require('../src/utils/lagunaFulfillment');

test('bundled Laguna PSGC subset contains all published localities and barangays', () => {
  assert.equal(locationData.datasetVersion, '2026-10-12');
  assert.equal(locationData.province.name, 'Laguna');
  assert.equal(locationData.localities.length, 30);
  assert.equal(locationData.localities.filter((item) => item.type === 'municipality').length, 24);
  assert.equal(locationData.localities.filter((item) => item.type === 'component_city').length, 6);
  assert.equal(locationData.localities.reduce((sum, item) => sum + item.barangays.length, 0), 681);
  assert.equal(new Set(locationData.localities.map((item) => item.code)).size, 30);
  assert.equal(new Set(locationData.localities.flatMap((item) => item.barangays.map((barangay) => barangay.code))).size, 681);
});

test('delivery accepts a blank or partial address and canonicalizes the province', () => {
  assert.deepEqual(normalizeLagunaDeliveryFields({ province: 'Cavite' }), {
    addressLine: '', barangay: '', cityMunicipality: '', province: 'Laguna',
  });
  assert.deepEqual(normalizeLagunaDeliveryFields({ addressLine: 'Unit 2, National Road' }), {
    addressLine: 'Unit 2, National Road', barangay: '', cityMunicipality: '', province: 'Laguna',
  });
  assert.deepEqual(normalizeLagunaDeliveryFields({ cityMunicipality: 'Cabuyao' }), {
    addressLine: '', barangay: '', cityMunicipality: 'City of Cabuyao', province: 'Laguna',
  });
});

test('delivery accepts only a barangay belonging to its selected Laguna locality', () => {
  const cabuyao = locationData.localities.find((item) => item.name === 'City of Cabuyao');
  const binan = locationData.localities.find((item) => item.name === 'City of Biñan');
  const validBarangay = cabuyao.barangays[0];
  assert.deepEqual(normalizeLagunaDeliveryFields({ cityMunicipality: 'Cabuyao', barangay: validBarangay.name }), {
    addressLine: '', barangay: validBarangay.name, cityMunicipality: cabuyao.name, province: 'Laguna',
  });
  assert.throws(() => normalizeLagunaDeliveryFields({ barangay: validBarangay.name }), { status: 400 });
  assert.throws(() => normalizeLagunaDeliveryFields({ cityMunicipality: 'Not a Laguna locality' }), { status: 400 });
  assert.throws(() => normalizeLagunaDeliveryFields({ cityMunicipality: cabuyao.name, barangay: binan.barangays[0].name }), { status: 400 });
});

test('delivery still rejects an excessively long manually entered street address', () => {
  assert.throws(() => normalizeLagunaDeliveryFields({ addressLine: 'x'.repeat(201) }), { status: 400 });
});
