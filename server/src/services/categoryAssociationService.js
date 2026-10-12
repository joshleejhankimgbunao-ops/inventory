const Product = require('../models/Product');
const Partner = require('../models/Partner');
const Setting = require('../models/Setting');
const { categoryNameCondition, normalizeCategoryKey } = require('../utils/categoryResolution');

const renameStockRuleCategoryKey = (settings, previousName, nextName) => {
  const categoryRules = settings?.stockRules?.categories;
  if (!categoryRules) return false;

  const entries = categoryRules instanceof Map
    ? [...categoryRules.entries()]
    : Object.entries(categoryRules);
  const previousKey = normalizeCategoryKey(previousName);
  const nextKey = normalizeCategoryKey(nextName);
  const previousEntries = entries.filter(([key]) => normalizeCategoryKey(key) === previousKey);
  if (previousEntries.length === 0) return false;

  const existingTarget = entries.find(([key]) => (
    normalizeCategoryKey(key) === nextKey
    && normalizeCategoryKey(key) !== previousKey
  ));
  const value = existingTarget?.[1] ?? previousEntries[0][1];

  if (categoryRules instanceof Map) {
    previousEntries.forEach(([key]) => categoryRules.delete(key));
    if (!existingTarget) categoryRules.set(nextName, value);
  } else {
    previousEntries.forEach(([key]) => delete categoryRules[key]);
    if (!existingTarget) categoryRules[nextName] = value;
  }
  settings.markModified?.('stockRules.categories');
  return true;
};

const propagateCategoryRename = async ({
  categoryId,
  previousName,
  nextName,
  session,
  ProductModel = Product,
  PartnerModel = Partner,
  SettingModel = Setting,
}) => {
  const options = session ? { session } : undefined;
  const products = await ProductModel.updateMany(
    { categoryRef: categoryId },
    { $set: { category: nextName } },
    options
  );

  const partners = await PartnerModel.updateMany(
    { 'supplierCapabilities.category': categoryNameCondition(previousName) },
    { $set: { 'supplierCapabilities.$[capability].category': nextName } },
    {
      ...(options || {}),
      arrayFilters: [{ 'capability.category': categoryNameCondition(previousName) }],
    }
  );

  const settings = await SettingModel.findOne(
    { singletonKey: 'default' },
    null,
    options
  );
  let settingsUpdated = false;
  if (settings && renameStockRuleCategoryKey(settings, previousName, nextName)) {
    await settings.save(options);
    settingsUpdated = true;
  }

  return {
    productsUpdated: products?.modifiedCount || 0,
    partnersUpdated: partners?.modifiedCount || 0,
    settingsUpdated,
  };
};

module.exports = {
  propagateCategoryRename,
  renameStockRuleCategoryKey,
};
