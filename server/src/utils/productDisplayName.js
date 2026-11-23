const { getEffectiveDefinitions, normalizeAttributeKey, plainAttributes } = require('./productAttributes');

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const normalizeText = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase();

const getProductDisplayName = (product, category = {}) => {
  if (!product) return '';
  const storedName = String(product.name ?? product.itemName ?? '').trim();
  if (storedName) return storedName;

  const attributes = plainAttributes(product.attributes);
  const normalizedAttributes = new Map(Object.entries(attributes).map(([key, value]) => [normalizeAttributeKey(key), value]));
  const definitions = getEffectiveDefinitions(category).sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  const configuredKeys = new Set();
  const parts = [];
  const seen = new Set();
  const add = (value, definition = null) => {
    if (!hasValue(value) || typeof value === 'object') return;
    const text = String(value).trim();
    const unit = String(definition?.type === 'number_unit' ? definition.unit || '' : '').trim();
    const display = unit && text && !text.toLocaleLowerCase().replace(/\s+/g, '').endsWith(unit.toLocaleLowerCase().replace(/\s+/g, ''))
      ? `${text} ${unit}`
      : text;
    const comparable = normalizeText(display);
    if (!comparable || seen.has(comparable)) return;
    seen.add(comparable);
    parts.push(display);
  };

  definitions.forEach((definition) => {
    const key = normalizeAttributeKey(definition.key);
    const nameKey = normalizeAttributeKey(definition.name);
    configuredKeys.add(key);
    configuredKeys.add(nameKey);
    const value = normalizedAttributes.get(key)
      ?? normalizedAttributes.get(nameKey)
      ?? (['brand', 'color', 'size'].includes(key) ? product[key] : undefined);
    add(value, definition);
  });

  Object.entries(attributes).forEach(([key, value]) => {
    if (!configuredKeys.has(normalizeAttributeKey(key))) add(value);
  });

  ['type', 'size', 'variant', 'brand', 'material', 'color'].forEach((key) => {
    if (!configuredKeys.has(normalizeAttributeKey(key))) add(product[key]);
  });

  if (parts.length) return parts.join(' – ');
  return [product.sku, product.code, product.id, product._id].find(hasValue)?.toString().trim() || 'Unnamed product';
};

module.exports = { getProductDisplayName };
