import locationData from '../../shared/lagunaPsgc.json';

export const LAGUNA_LOCATION_DATA = locationData;
export const LAGUNA_LOCALITIES = locationData.localities;

export const normalizeLocationName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/^(?:(?:city|municipality) of )/i, '')
  .toLocaleLowerCase();

export const findLagunaLocality = (value) => {
  const key = normalizeLocationName(value);
  return LAGUNA_LOCALITIES.find((locality) => normalizeLocationName(locality.name) === key) || null;
};

export const findLagunaBarangay = (locality, value) => {
  const key = normalizeLocationName(value);
  if (!locality || !key) return null;
  return locality.barangays.find((barangay) => normalizeLocationName(barangay.name) === key) || null;
};

export const validateLagunaDeliveryLocation = (fulfillment = {}) => {
  const cityName = String(fulfillment.cityMunicipality || '').trim();
  const barangayName = String(fulfillment.barangay || '').trim();
  const locality = cityName ? findLagunaLocality(cityName) : null;

  if (cityName && !locality) return 'Choose a valid Laguna city or municipality from the list.';
  if (barangayName && !locality) return 'Select a city or municipality before selecting a barangay.';
  if (barangayName && !findLagunaBarangay(locality, barangayName)) return 'Choose a barangay within the selected city or municipality.';
  return '';
};
