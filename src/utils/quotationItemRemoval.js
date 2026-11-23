const SYSTEM_ITEM_FIELDS = new Set(['__rowId', 'itemId', 'originalUnitPrice']);

const hasMeaningfulValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'object') return Object.values(value).some(hasMeaningfulValue);
  return false;
};

/** Checks the form item itself while excluding generated IDs and untouched defaults. */
export const hasMeaningfulQuotationItemInput = (item) => {
  if (!item || typeof item !== 'object') return false;
  if (item.itemType === 'inventory') return true;

  return Object.entries(item).some(([key, value]) => {
    if (SYSTEM_ITEM_FIELDS.has(key)) return false;
    if (key === 'itemType' && value === 'custom') return false;
    // createFormItem starts at numeric 1; an edited text input stores "1".
    if (key === 'quantity' && value === 1) return false;
    return hasMeaningfulValue(value);
  });
};

/** Removes one current form row by its stable identifier and retains the minimum-item fallback. */
export const removeQuotationFormItemById = (items, targetId, createFallbackItem) => {
  const currentItems = Array.isArray(items) ? items : [];
  if (!targetId) return currentItems;
  const remainingItems = currentItems.filter((item) => (
    String(item.itemId || '') !== String(targetId) && String(item.__rowId || '') !== String(targetId)
  ));
  if (remainingItems.length === currentItems.length) return currentItems;
  return remainingItems.length > 0 ? remainingItems : [createFallbackItem()];
};

const displayText = (value) => {
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value).trim();
};

const normalizeText = (value) => displayText(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();

const attributeEntries = (attributes) => {
  if (attributes instanceof Map) return [...attributes.entries()];
  if (Array.isArray(attributes)) return attributes.map((entry) => [entry?.label || entry?.name || entry?.key, entry?.value]);
  if (!attributes || typeof attributes !== 'object') return [];
  return Object.entries(attributes);
};

/** Returns only populated, staff-readable item details for the removal dialog. */
export const getQuotationItemRemovalSummary = (item) => {
  if (!item || typeof item !== 'object') return [];
  const rows = [];
  const add = (label, value) => {
    const text = displayText(value);
    if (text && !rows.some((row) => normalizeText(row.value) === normalizeText(text))) rows.push({ label, value: text });
  };

  add('Product', item.itemName || item.displayName || item.productName || item.name);
  if (!rows.some((row) => row.label === 'Product') && item.itemType === 'inventory') add('Product Type', 'Existing Product');
  add('SKU', item.sku || item.code);

  const detailParts = [];
  const addDetail = (value) => {
    const text = displayText(value);
    const normalized = normalizeText(text);
    if (!normalized || detailParts.some((part) => normalizeText(part) === normalized)) return;
    detailParts.push(text);
  };
  const description = displayText(item.description);
  addDetail(description);
  addDetail(item.variant);
  for (const [label, value] of attributeEntries(item.attributes)) {
    const text = displayText(value);
    if (!text || (description && normalizeText(description).includes(normalizeText(text)))) continue;
    addDetail(`${displayText(label) ? `${displayText(label)}: ` : ''}${text}`);
  }
  add('Details', detailParts.join('; '));
  add('Supplier', item.supplierName || item.supplier?.name);

  const quantity = displayText(item.quantity);
  const unit = displayText(item.sellingUnit);
  add('Quantity', [quantity, unit].filter(Boolean).join(' '));
  add('Unit Price', item.sellingPrice ?? item.unitPrice);
  add('Purchase Cost', item.purchaseCost);
  add('Expected Date', item.expectedArrivalDate);
  add('Price Adjustment Reason', item.priceOverrideReason);
  add('Item Notes', item.remarks);
  if (Array.isArray(item.photos) && item.photos.length) {
    add('Product Images', `${item.photos.length} selected`);
  }
  return rows;
};
