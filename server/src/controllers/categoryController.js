const Category = require('../models/Category');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');

const normalizeUnits = (units) => {
  if (!Array.isArray(units)) return undefined;

  const normalized = units
    .map((unit) => String(unit || '').trim())
    .filter(Boolean);

  return [...new Set(normalized)];
};

// @desc    Get all categories
// @route   GET /api/categories
// @access  Private
const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    next(error);
  }
};

// @desc    Create new category
// @route   POST /api/categories
// @access  Private Admin
const createCategory = async (req, res, next) => {
  try {
    const { 
      name, description, 
      showBrand, requireBrand, 
      showColor, requireColor, 
      showSize, requireSize, 
      sizeUnits
    } = req.body;

    const normalizedName = normalizeHumanReadable(name);
    if (!normalizedName) {
      res.status(400);
      throw new Error('Category name is required');
    }

    const categoryExists = await Category.findOne({
      name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });
    if (categoryExists) {
      res.status(400);
      throw new Error('Category already exists');
    }

    const normalizedUnits = normalizeUnits(sizeUnits);

    const category = await Category.create({ 
      name: normalizedName, description,
      showBrand, requireBrand,
      showColor, requireColor,
      showSize, requireSize,
      ...(normalizedUnits ? { sizeUnits: normalizedUnits } : {}),
      showSupplier: true
    });
    res.status(201).json(category);
  } catch (error) {
    if (error?.code === 11000) {
      res.status(400);
      return next(new Error('Category already exists'));
    }
    next(error);
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private Admin
const updateCategory = async (req, res, next) => {
  try {
    const { 
      name, description, isActive,
      showBrand, requireBrand,
      showColor, requireColor,
      showSize, requireSize,
      sizeUnits
    } = req.body;
    const categoryId = req.params.id;
    const normalizedName = name !== undefined ? normalizeHumanReadable(name) : undefined;

    const category = await Category.findById(categoryId);
    
    if (category) {
      if (normalizedName !== undefined) {
        if (!normalizedName) {
          res.status(400);
          throw new Error('Category name is required');
        }

        const nameConflict = await Category.findOne({
          _id: { $ne: categoryId },
          name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        });
        if (nameConflict) {
          res.status(400);
          throw new Error('Category already exists');
        }

        category.name = normalizedName;
      }
      if (description !== undefined) category.description = description;
      if (isActive !== undefined) category.isActive = isActive;
      
      if (showBrand !== undefined) category.showBrand = showBrand;
      if (requireBrand !== undefined) category.requireBrand = requireBrand;
      if (showColor !== undefined) category.showColor = showColor;
      if (requireColor !== undefined) category.requireColor = requireColor;
      if (showSize !== undefined) category.showSize = showSize;
      if (requireSize !== undefined) category.requireSize = requireSize;
      const normalizedUnits = normalizeUnits(sizeUnits);
      if (normalizedUnits !== undefined) {
        category.sizeUnits = normalizedUnits;
      }
      category.showSupplier = true;

      const updatedCategory = await category.save();
      res.json(updatedCategory);
    } else {
      res.status(404);
      throw new Error('Category not found');
    }
  } catch (error) {
    if (error?.code === 11000) {
      res.status(400);
      return next(new Error('Category already exists'));
    }
    next(error);
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private Admin
const deleteCategory = async (req, res, next) => {
  try {
    const categoryId = req.params.id;
    const category = await Category.findById(categoryId);

    if (category) {
      await category.deleteOne();
      res.json({ message: 'Category removed' });
    } else {
      res.status(404);
      throw new Error('Category not found');
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
