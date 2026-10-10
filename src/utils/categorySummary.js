export const getActiveConfiguredCategories = (categories) => {
  if (!Array.isArray(categories)) return [];

  return categories.filter((category) => (
    category?.isActive !== false && String(category?.name || '').trim()
  ));
};

export const getConfiguredCategoryCount = (categories) => getActiveConfiguredCategories(categories).length;
