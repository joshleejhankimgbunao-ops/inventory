const ATTRIBUTE_TYPES = new Set(['text', 'number', 'select', 'number_unit']);
const invalidDefinition = (message) => Object.assign(new Error(message), { code: 'INVALID_PRODUCT_ATTRIBUTES' });

const normalizeAttributeKey = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 64);

const normalizeDefinitions = (definitions) => {
  if (!Array.isArray(definitions)) throw invalidDefinition('Product attributes must be a list.');
  const keys = new Set();
  return definitions.map((raw, index) => {
    const name = String(raw?.name || '').trim();
    const key = normalizeAttributeKey(name);
    const type = String(raw?.type || 'text').trim().toLowerCase();
    const unit = String(raw?.unit || '').trim();
    const options = [...new Set((Array.isArray(raw?.options) ? raw.options : [])
      .map((option) => String(option || '').trim()).filter(Boolean))];
    if (!name || !key) throw invalidDefinition('Each product attribute needs a name.');
    if (keys.has(key)) throw invalidDefinition(`Duplicate product attribute: ${name}.`);
    if (!ATTRIBUTE_TYPES.has(type)) throw invalidDefinition(`Unsupported product attribute type: ${type}.`);
    if (type === 'select' && options.length === 0) throw invalidDefinition(`${name} needs at least one option.`);
    if (type === 'number_unit' && !unit) throw invalidDefinition(`${name} needs a unit.`);
    keys.add(key);
    return { name, key, type, required: Boolean(raw?.required), unit, options, order: index };
  });
};

const legacyDefinitions = (category = {}) => {
  const definitions = [];
  if (category.showBrand) definitions.push({ name: 'Brand', key: 'brand', type: 'text', required: Boolean(category.requireBrand), unit: '', options: [] });
  if (category.showColor) definitions.push({ name: 'Color', key: 'color', type: 'text', required: Boolean(category.requireColor), unit: '', options: [] });
  if (category.showSize !== false) definitions.push({ name: 'Size / Variant', key: 'size', type: 'text', required: Boolean(category.requireSize), unit: '', options: [] });
  return definitions.map((definition, order) => ({ ...definition, order }));
};

const getEffectiveDefinitions = (category = {}) => {
  const raw = category.productAttributes;
  return Number(category.attributeSchemaVersion || 0) >= 1
    ? (Array.isArray(raw) ? raw.map((item) => (item?.toObject ? item.toObject() : item)) : [])
    : legacyDefinitions(category);
};

const plainAttributes = (value) => {
  if (value instanceof Map) return Object.fromEntries(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
};

const validateProductAttributeValues = (definitions, supplied, legacy = {}) => {
  const input = plainAttributes(supplied);
  const output = {};
  definitions.forEach((definition) => {
    const fallback = ['brand', 'color', 'size'].includes(definition.key) ? legacy[definition.key] : undefined;
    const raw = input[definition.key] ?? fallback;
    const blank = raw === undefined || raw === null || String(raw).trim() === '';
    if (blank) {
      if (definition.required) throw new Error(`${definition.name} is required.`);
      return;
    }
    if (definition.type === 'number' || definition.type === 'number_unit') {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(`${definition.name} must be a valid number.`);
      output[definition.key] = number;
      return;
    }
    const value = String(raw).trim();
    if (definition.type === 'select') {
      const option = definition.options.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
      if (!option) throw new Error(`${definition.name} must use one of its configured options.`);
      output[definition.key] = option;
      return;
    }
    output[definition.key] = value;
  });
  return output;
};

const applyLegacyCompatibility = (definitions, values, fallback = {}) => {
  const result = { ...fallback };
  ['brand', 'color', 'size'].forEach((key) => {
    const definition = definitions.find((item) => item.key === key);
    if (!definition) return;
    const value = values[key];
    result[key] = value === undefined ? '' : `${value}${definition.type === 'number_unit' && definition.unit ? ` ${definition.unit}` : ''}`;
  });
  return result;
};

module.exports = {
  applyLegacyCompatibility,
  getEffectiveDefinitions,
  legacyDefinitions,
  normalizeAttributeKey,
  normalizeDefinitions,
  plainAttributes,
  validateProductAttributeValues,
};
