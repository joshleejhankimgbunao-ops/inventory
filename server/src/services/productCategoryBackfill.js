const { normalizeCategoryKey, normalizeCategoryName } = require('../utils/categoryResolution');

const hasCategoryRef = (product) => Boolean(product?.categoryRef?._id || product?.categoryRef);

const groupReviewItems = (items, detailBuilder) => {
  const groups = new Map();
  items.forEach((item) => {
    const displayName = normalizeCategoryName(item.product?.category) || '(blank)';
    const key = normalizeCategoryKey(displayName);
    if (!groups.has(key)) {
      groups.set(key, {
        categoryName: displayName,
        products: [],
        ...detailBuilder(item),
      });
    }
    groups.get(key).products.push({
      id: String(item.product?._id || ''),
      sku: item.product?.sku || '',
    });
  });
  return [...groups.values()];
};

const planProductCategoryBackfill = ({ products = [], categories = [] }) => {
  const categoriesByName = new Map();
  categories.forEach((category) => {
    const key = normalizeCategoryKey(category?.name);
    if (!key) return;
    if (!categoriesByName.has(key)) categoriesByName.set(key, []);
    categoriesByName.get(key).push(category);
  });

  const actions = [];
  const unmatched = [];
  const ambiguous = [];
  let alreadyLinked = 0;

  products.forEach((product) => {
    if (hasCategoryRef(product)) {
      alreadyLinked += 1;
      return;
    }
    const matches = categoriesByName.get(normalizeCategoryKey(product?.category)) || [];
    if (matches.length === 1) {
      actions.push({
        product,
        category: matches[0],
        canonicalCategoryName: matches[0].name,
      });
    } else if (matches.length === 0) {
      unmatched.push({ product });
    } else {
      ambiguous.push({ product, matches });
    }
  });

  const unmatchedCategoryNames = groupReviewItems(unmatched, () => ({}));
  const ambiguousMatches = groupReviewItems(ambiguous, ({ matches }) => ({
    matches: matches.map((category) => ({
      id: String(category?._id || ''),
      name: category?.name || '',
    })),
  }));

  return {
    actions,
    report: {
      totalProductsScanned: products.length,
      alreadyLinked,
      successfullyMatchable: actions.length,
      unmatchedCategoryNames,
      ambiguousMatches,
      productsRequiringManualReview: unmatched.length + ambiguous.length,
    },
  };
};

const executeProductCategoryBackfill = async ({
  products,
  categories,
  apply = false,
  ProductModel,
}) => {
  const { actions, report } = planProductCategoryBackfill({ products, categories });
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    ...report,
    updated: 0,
    writeConflicts: [],
  };

  if (!apply) return result;
  if (!ProductModel) throw new Error('ProductModel is required in apply mode.');

  for (const action of actions) {
    const update = await ProductModel.updateOne({
      _id: action.product._id,
      $or: [
        { categoryRef: null },
        { categoryRef: { $exists: false } },
      ],
      category: action.product.category,
    }, {
      $set: {
        categoryRef: action.category._id,
        category: action.canonicalCategoryName,
      },
    });

    if (update?.modifiedCount === 1) {
      result.updated += 1;
    } else {
      result.writeConflicts.push({
        id: String(action.product?._id || ''),
        sku: action.product?.sku || '',
      });
    }
  }

  return result;
};

module.exports = {
  executeProductCategoryBackfill,
  planProductCategoryBackfill,
};
