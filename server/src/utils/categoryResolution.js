const mongoose = require('mongoose');
const Category = require('../models/Category');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCategoryName = (value) => normalizeHumanReadable(
  String(value ?? '').trim().replace(/\s+/g, ' ')
);

const normalizeCategoryKey = (value) => normalizeCategoryName(value).toLocaleLowerCase();

const categoryNameCondition = (value) => ({
  $regex: `^${escapeRegex(normalizeCategoryName(value))}$`,
  $options: 'i',
});

const findCategoryByExactName = async ({
  categoryName,
  activeOnly = false,
  CategoryModel = Category,
  session = null,
}) => {
  const normalizedName = normalizeCategoryName(categoryName);
  if (!normalizedName) return null;

  return CategoryModel.findOne({
    name: categoryNameCondition(normalizedName),
    ...(activeOnly ? { isActive: true } : {}),
  }, null, session ? { session } : undefined);
};

const resolveCategory = async ({
  categoryRef,
  categoryName,
  activeOnly = false,
  CategoryModel = Category,
  session = null,
}) => {
  const reference = categoryRef?._id || categoryRef;
  if (reference && mongoose.isValidObjectId(reference)) {
    const referencedCategory = await CategoryModel.findOne({
      _id: reference,
      ...(activeOnly ? { isActive: true } : {}),
    }, null, session ? { session } : undefined);
    if (referencedCategory) return referencedCategory;
  }

  return findCategoryByExactName({
    categoryName,
    activeOnly,
    CategoryModel,
    session,
  });
};

const resolveProductCategory = (product, options = {}) => resolveCategory({
  categoryRef: product?.categoryRef,
  categoryName: product?.category,
  ...options,
});

module.exports = {
  categoryNameCondition,
  findCategoryByExactName,
  normalizeCategoryKey,
  normalizeCategoryName,
  resolveCategory,
  resolveProductCategory,
};
