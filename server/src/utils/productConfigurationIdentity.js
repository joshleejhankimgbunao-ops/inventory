const { plainAttributes } = require('./productAttributes');

const normalizeIdentityText = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase();

const normalizeIdentityNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : normalizeIdentityText(value);
};

const normalizedAttributeValue = (definition, value) => {
  if (definition.type === 'number' || definition.type === 'number_unit') {
    return normalizeIdentityNumber(value);
  }
  return normalizeIdentityText(value);
};

const configuredAttributeValue = ({ definition, attributes, legacy }) => {
  const values = plainAttributes(attributes);
  const legacyValue = ['brand', 'color', 'size'].includes(definition.key)
    ? legacy?.[definition.key]
    : undefined;
  return values[definition.key] ?? legacyValue ?? '';
};

const buildProductConfigurationIdentity = ({
  category,
  name,
  definitions = [],
  attributes = {},
  legacy = {},
  brand,
  color,
  size,
  sellingUnit,
}) => {
  const normalizedDefinitions = [...definitions]
    .map((definition) => ({ ...definition, key: normalizeIdentityText(definition?.key) }))
    .filter((definition) => definition.key)
    .sort((left, right) => left.key.localeCompare(right.key));

  return JSON.stringify({
    category: normalizeIdentityText(category),
    name: normalizeIdentityText(name),
    sellingUnit: normalizeIdentityText(sellingUnit),
    attributes: normalizedDefinitions.map((definition) => ({
      key: definition.key,
      value: normalizedAttributeValue(definition, configuredAttributeValue({
        definition,
        attributes,
        legacy: {
          brand: legacy.brand ?? brand,
          color: legacy.color ?? color,
          size: legacy.size ?? size,
        },
      })),
    })),
  });
};

const productConfigurationInput = (product) => ({
  category: product?.category,
  name: product?.name,
  sellingUnit: product?.sellingUnit,
  attributes: product?.attributes,
  legacy: {
    brand: product?.brand,
    color: product?.color,
    size: product?.size,
  },
});

const productConfigurationsConflict = (left, right, definitions = []) => {
  const leftInput = productConfigurationInput(left);
  const rightInput = productConfigurationInput(right);
  const leftUnit = normalizeIdentityText(leftInput.sellingUnit);
  const rightUnit = normalizeIdentityText(rightInput.sellingUnit);
  // A legacy missing unit cannot establish a distinct configuration.
  if (leftUnit && rightUnit) {
    return buildProductConfigurationIdentity({ ...leftInput, definitions })
      === buildProductConfigurationIdentity({ ...rightInput, definitions });
  }
  return buildProductConfigurationIdentity({ ...leftInput, sellingUnit: '', definitions })
    === buildProductConfigurationIdentity({ ...rightInput, sellingUnit: '', definitions });
};

const findDuplicateConfigurationGroups = (products, definitionsByCategory = new Map()) => {
  const groups = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const definitions = definitionsByCategory.get(product?.category) || [];
    const identity = buildProductConfigurationIdentity({ ...productConfigurationInput(product), sellingUnit: '', definitions });
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(product);
  });

  return [...groups.values()].flatMap((group) => {
    if (group.length < 2) return [];
    if (group.some((product) => !normalizeIdentityText(product?.sellingUnit))) return [group];
    const byUnit = new Map();
    group.forEach((product) => {
      const unit = normalizeIdentityText(product.sellingUnit);
      if (!byUnit.has(unit)) byUnit.set(unit, []);
      byUnit.get(unit).push(product);
    });
    return [...byUnit.values()].filter((sameUnit) => sameUnit.length > 1);
  });
};

module.exports = {
  buildProductConfigurationIdentity,
  findDuplicateConfigurationGroups,
  normalizeIdentityText,
  productConfigurationsConflict,
  productConfigurationInput,
};
