import { getProductDisplayName, hasStoredProductName } from './productDisplayName.js';

const toNonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};
const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const toDisplayText = (value) => (typeof value === 'string' || typeof value === 'number')
  ? String(value).trim()
  : '';

const getProductAttributes = (product) => {
  const attributes = product?.attributes;
  if (attributes instanceof Map) return Array.from(attributes.entries());
  if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) return Object.entries(attributes);
  return [];
};

const getProductLegendBaseName = (product) => {
  const name = toDisplayText(product?.productName || product?.name);
  const code = toDisplayText(product?.code || product?.sku);
  if (!name || (code && name.toLocaleLowerCase() === `sku ${code}`.toLocaleLowerCase())) return 'Unknown product';
  return name;
};

const normalizeLabelKey = (value) => String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
const titleCaseLabel = (value) => String(value || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());

const getProductLabelFacets = (product) => {
  const productName = toDisplayText(product?.productName || product?.name);
  const normalizedName = productName.toLocaleLowerCase();
  const values = new Map();
  const addFacet = (key, label, rawValue, { includeKey = false } = {}) => {
    const value = toDisplayText(rawValue);
    if (!value || normalizedName.includes(value.toLocaleLowerCase())) return;
    const normalizedKey = normalizeLabelKey(key);
    if (!normalizedKey || values.has(normalizedKey)) return;
    values.set(normalizedKey, {
      key: normalizedKey,
      value,
      label: includeKey ? `${label}: ${value}` : value,
    });
  };

  addFacet('brand', 'Brand', product?.brand);
  addFacet('color', 'Color', product?.color);
  addFacet('size', 'Size', product?.size);
  addFacet('variant', 'Variant', product?.variant || product?.variantName || product?.variantLabel);

  getProductAttributes(product).forEach(([key, value]) => {
    const normalizedKey = normalizeLabelKey(key);
    if (['brand', 'color', 'size'].includes(normalizedKey)) {
      addFacet(normalizedKey, titleCaseLabel(normalizedKey), value);
      return;
    }
    if (['variant', 'variantname', 'variantlabel'].includes(normalizedKey)) {
      addFacet('variant', 'Variant', value);
      return;
    }
    addFacet(normalizedKey, titleCaseLabel(key), value, { includeKey: true });
  });

  return Array.from(values.values());
};

const getShortestUniqueSkuSuffix = (product, products) => {
  const code = toDisplayText(product?.code || product?.sku);
  const identifier = code || toDisplayText(product?.productId || product?.variantId || product?._id);
  if (!identifier) return '';
  const identifiers = products.map((entry) => toDisplayText(entry?.code || entry?.sku)
    || toDisplayText(entry?.productId || entry?.variantId || entry?._id)).map((value) => value.toLocaleLowerCase());
  const minimumLength = Math.min(3, identifier.length);
  for (let length = minimumLength; length <= identifier.length; length += 1) {
    const suffix = identifier.slice(-length);
    const normalizedSuffix = suffix.toLocaleLowerCase();
    if (identifiers.filter((candidate) => candidate.endsWith(normalizedSuffix)).length === 1) {
      return code ? `SKU ...${suffix}` : `ID ...${suffix}`;
    }
  }

  return code ? `SKU ${code}` : `ID ${identifier}`;
};

export const getTopSellingProductSpecificationDetails = (product) => {
  if (!product || product.isAggregate) return [];
  const details = [];
  const addDetail = (label, rawValue) => {
    const value = toDisplayText(rawValue);
    if (!value) return;
    const normalizedValue = value.toLocaleLowerCase();
    if (details.some((entry) => entry.value.toLocaleLowerCase() === normalizedValue)) return;
    details.push({ label, value });
  };

  addDetail('Brand', product.brand);
  addDetail('Color', product.color);
  addDetail('Size', product.size);
  addDetail('Variant', product.variant || product.variantName || product.variantLabel);
  getProductAttributes(product).forEach(([key, value]) => {
    const normalizedKey = normalizeLabelKey(key);
    if (['brand', 'color', 'size'].includes(normalizedKey)) {
      addDetail(titleCaseLabel(normalizedKey), value);
      return;
    }
    if (['variant', 'variantname', 'variantlabel'].includes(normalizedKey)) {
      addDetail('Variant', value);
      return;
    }
    addDetail(titleCaseLabel(key), value);
  });
  return details;
};

export const buildTopSellingProductLegendLabels = (products) => {
  const productRows = Array.isArray(products) ? products : [];
  const labels = productRows.map(getProductLegendBaseName);
  const groups = new Map();
  labels.forEach((label, index) => {
    const key = label.toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) || []), index]);
  });

  groups.forEach((indices) => {
    if (indices.length < 2) return;
    const group = indices.map((index) => productRows[index]);
    const facetKeys = Array.from(new Set(group.flatMap((product) => getProductLabelFacets(product).map((facet) => facet.key))));
    const priority = ['brand', 'color', 'size', 'variant'];
    facetKeys.sort((left, right) => {
      const leftRank = priority.indexOf(left);
      const rightRank = priority.indexOf(right);
      return (leftRank < 0 ? priority.length : leftRank) - (rightRank < 0 ? priority.length : rightRank)
        || left.localeCompare(right);
    });
    facetKeys.splice(8);

    const facetsByIndex = new Map(indices.map((index) => [index, new Map(getProductLabelFacets(productRows[index]).map((facet) => [facet.key, facet]))]));
    let distinguishingKeys = null;
    const findUniqueFacetSet = (start, remaining, selected) => {
      if (remaining === 0) {
        const signatures = indices.map((index) => selected
          .map((key) => facetsByIndex.get(index).get(key)?.value.toLocaleLowerCase() || '')
          .join('|'));
        return signatures.every(Boolean) && new Set(signatures).size === signatures.length ? [...selected] : null;
      }
      for (let index = start; index <= facetKeys.length - remaining; index += 1) {
        const result = findUniqueFacetSet(index + 1, remaining - 1, [...selected, facetKeys[index]]);
        if (result) return result;
      }
      return null;
    };

    for (let count = 1; count <= facetKeys.length && !distinguishingKeys; count += 1) {
      distinguishingKeys = findUniqueFacetSet(0, count, []);
    }

    indices.forEach((productIndex) => {
      const facets = facetsByIndex.get(productIndex);
      const selectedFacets = distinguishingKeys
        ? distinguishingKeys.map((key) => facets.get(key))
        : facetKeys.map((key) => facets.get(key)).filter(Boolean);
      if (selectedFacets.length) {
        labels[productIndex] += ` (${selectedFacets.map((facet) => facet.label).join(', ')})`;
      }
    });

  });

  const expandedLabels = labels.map((label, index) => {
    const candidate = getProductLabelFacets(productRows[index])
      .map((facet) => `${label} (${facet.label})`)
      .find((candidateLabel) => labels.some((otherLabel, otherIndex) => (
        otherIndex !== index && otherLabel.toLocaleLowerCase() === candidateLabel.toLocaleLowerCase()
      )));
    return candidate || label;
  });
  labels.splice(0, labels.length, ...expandedLabels);

  const labelCounts = new Map();
  labels.forEach((label, index) => {
    const key = label.toLocaleLowerCase();
    labelCounts.set(key, [...(labelCounts.get(key) || []), index]);
  });
  labelCounts.forEach((duplicateIndices) => {
    if (duplicateIndices.length < 2) return;
    duplicateIndices.forEach((index) => {
      const suffix = getShortestUniqueSkuSuffix(productRows[index], productRows);
      if (suffix) labels[index] += ` (${suffix})`;
    });
  });

  return labels;
};

export const formatReportChartPercentage = (value) => {
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage <= 0) return '0%';
  if (percentage < 1) return '<1%';
  return `${percentage.toFixed(1)}%`;
};

export const buildTopProductsReportStats = (transactions, inventory, categories = []) => {
  const inventoryByCode = new Map(
    (inventory || [])
      .filter((item) => item?.code)
      .map((item) => [String(item.code).toUpperCase(), item])
  );
  const stats = new Map();

  (transactions || []).forEach((transaction) => {
    transaction.items?.forEach((item) => {
      const code = String(item.code || item.sku || '').trim();
      const inventoryProduct = code ? inventoryByCode.get(code.toUpperCase()) : null;
      const displayProduct = hasStoredProductName(item) ? item : inventoryProduct || item;
      const recordedProductName = getProductDisplayName(displayProduct, categories);
      const productName = recordedProductName || (code ? `SKU ${code}` : 'Unknown product');
      const color = inventoryProduct?.color || item.color || '';
      const size = inventoryProduct?.size || item.size || '';
      const brand = inventoryProduct?.brand || item.brand || '';
      const variant = inventoryProduct?.variant || inventoryProduct?.variantName || inventoryProduct?.variantLabel
        || item.variant || item.variantName || item.variantLabel || '';
      const attributes = inventoryProduct?.attributes || item.attributes || {};
      const attributeDetails = attributes && typeof attributes === 'object'
        ? Object.entries(attributes)
          .filter(([key, value]) => !['color', 'size'].includes(key.toLowerCase()) && ['string', 'number'].includes(typeof value) && String(value).trim())
          .slice(0, 2)
          .map(([key, value]) => `${key}: ${String(value).trim()}`)
        : [];
      const variantDetails = [...new Set([color, size, ...attributeDetails].map((value) => String(value || '').trim()).filter(Boolean))];
      const brandPrefix = brand && !productName.toLocaleLowerCase().includes(brand.toLocaleLowerCase()) ? brand : '';
      const chartLabel = [brandPrefix, productName, ...variantDetails, code ? `SKU ${code}` : ''].filter(Boolean).join(' · ');
      const fallbackIdentity = [item.productId || '', item.variantId || '', brand, productName, ...variantDetails].join('|');
      const identity = code ? `sku:${code.toUpperCase()}` : `product:${fallbackIdentity}`;
      const current = stats.get(identity) || {
        code,
        name: productName,
        productName: recordedProductName || 'Unknown product',
        productId: item.productId || '',
        variantId: item.variantId || '',
        brand,
        color,
        size,
        variant,
        attributes,
        chartLabel,
        qty: 0,
        revenue: 0,
      };
      current.qty += Number(item.qty) || 0;
      current.revenue += (Number(item.price) || 0) * (Number(item.qty) || 0);
      stats.set(identity, current);
    });
  });

  return Array.from(stats.values()).sort((left, right) => right.revenue - left.revenue);
};

const sortSalesCategories = (categories) => (categories || [])
    .map((category) => ({
      ...category,
      name: String(category?.name || 'Uncategorized').trim() || 'Uncategorized',
      value: toFiniteNumber(category?.value),
    }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));

const withSalesCategoryPercentages = (categories) => {
  const totalSales = categories.reduce((total, category) => total + category.value, 0);
  return categories.map((category) => ({
    ...category,
    percentage: totalSales > 0 ? (category.value / totalSales) * 100 : 0,
    isAggregate: false,
  }));
};

export const buildAllSalesCategoryChartData = (categories) => (
  withSalesCategoryPercentages(sortSalesCategories(categories))
);

export const buildSalesCategoryChartData = (categories, limit = 10) => {
  const sortedCategories = sortSalesCategories(categories);

  const totalSales = sortedCategories.reduce((total, category) => total + category.value, 0);
  const hasOthers = sortedCategories.length > limit;
  const topCategories = sortedCategories.slice(0, limit).map((category) => ({
    ...category,
    name: hasOthers && category.name.toLocaleLowerCase() === 'others' ? 'Others category' : category.name,
    percentage: totalSales > 0 ? (category.value / totalSales) * 100 : 0,
    isAggregate: false,
  }));

  if (!hasOthers) return topCategories;

  const remainingCategories = sortedCategories.slice(limit);
  const othersValue = remainingCategories.reduce((total, category) => total + category.value, 0);
  return [
    ...topCategories,
    {
      name: 'Others',
      value: othersValue,
      percentage: totalSales > 0 ? (othersValue / totalSales) * 100 : 0,
      isAggregate: true,
      categoryCount: remainingCategories.length,
    },
  ];
};

export const buildTopSellingProductsChartData = (products, limit = 10) => {
  const rankedProducts = (products || [])
    .map((product) => ({
      ...product,
      qty: toNonNegativeNumber(product?.qty),
      revenue: toNonNegativeNumber(product?.revenue),
    }))
    .sort((left, right) => right.qty - left.qty
      || String(left.chartLabel || left.name || left.code || '').localeCompare(String(right.chartLabel || right.name || right.code || ''))
      || String(left.code || '').localeCompare(String(right.code || '')));

  const totalQuantity = rankedProducts.reduce((total, product) => total + product.qty, 0);
  const visibleProducts = rankedProducts.slice(0, limit);
  const legendLabels = buildTopSellingProductLegendLabels(visibleProducts);
  const chartProducts = visibleProducts.map((product, index) => ({
    ...product,
    name: legendLabels[index],
    legendLabel: legendLabels[index],
    productName: product.productName || product.name || 'Unknown product',
    value: product.qty,
    percentage: totalQuantity > 0 ? (product.qty / totalQuantity) * 100 : 0,
    isAggregate: false,
  }));

  if (rankedProducts.length <= limit) return chartProducts;

  chartProducts.forEach((product) => {
    if (product.name.toLocaleLowerCase() !== 'other products') return;
    const suffix = getShortestUniqueSkuSuffix(product, rankedProducts);
    if (suffix) {
      product.name = `Other Products (${suffix})`;
      product.legendLabel = product.name;
    }
  });

  const remainingProducts = rankedProducts.slice(limit);
  const othersQuantity = remainingProducts.reduce((total, product) => total + product.qty, 0);
  const othersRevenue = remainingProducts.reduce((total, product) => total + product.revenue, 0);
  return [
    ...chartProducts,
    {
      name: 'Other Products',
      value: othersQuantity,
      qty: othersQuantity,
      revenue: othersRevenue,
      percentage: totalQuantity > 0 ? (othersQuantity / totalQuantity) * 100 : 0,
      isAggregate: true,
      productCount: remainingProducts.length,
    },
  ];
};
