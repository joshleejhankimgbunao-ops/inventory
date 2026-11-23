const locationData = require('../../../shared/lagunaPsgc.json');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');

const normalizeLocationName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/^(?:(?:city|municipality) of )/i, '')
  .toLocaleLowerCase();

const createValidationError = (message) => Object.assign(new Error(message), { status: 400 });

const normalizeLagunaDeliveryFields = (value = {}) => {
  const addressLine = normalizeHumanReadable(value.addressLine);
  const cityInput = normalizeHumanReadable(value.cityMunicipality);
  const barangayInput = normalizeHumanReadable(value.barangay);
  const localityKey = normalizeLocationName(cityInput);
  const locality = localityKey
    ? locationData.localities.find((item) => normalizeLocationName(item.name) === localityKey)
    : null;

  if (cityInput && !locality) throw createValidationError('Choose a valid Laguna city or municipality from the list.');
  if (barangayInput && !locality) throw createValidationError('Select a city or municipality before selecting a barangay.');

  const barangayKey = normalizeLocationName(barangayInput);
  const barangay = barangayKey && locality
    ? locality.barangays.find((item) => normalizeLocationName(item.name) === barangayKey)
    : null;
  if (barangayInput && !barangay) throw createValidationError('Choose a barangay within the selected city or municipality.');
  if (addressLine.length > 200) throw createValidationError('Street address is too long.');

  return {
    addressLine,
    barangay: barangay?.name || '',
    cityMunicipality: locality?.name || '',
    province: 'Laguna',
  };
};

module.exports = { normalizeLocationName, normalizeLagunaDeliveryFields };
