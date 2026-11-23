const singleLine = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export const buildQuotationThermalHeaderLines = (receipt = {}) => [
  singleLine(receipt?.storeName),
  singleLine(receipt?.storeAddress),
  singleLine(receipt?.contactPhone).replace(/\D/g, ''),
].filter(Boolean);
