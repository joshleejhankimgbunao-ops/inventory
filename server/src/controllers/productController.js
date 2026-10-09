const Product = require('../models/Product');
const Category = require('../models/Category');
const { writeActivityLog, writeInventoryLog } = require('../services/logService');
const { publishInventoryUpdated } = require('../services/realtimeService');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoney } = require('../utils/moneyValidation');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');
const { applyLegacyCompatibility, getEffectiveDefinitions, plainAttributes, validateProductAttributeValues } = require('../utils/productAttributes');
const { buildProductConfigurationIdentity, productConfigurationInput } = require('../utils/productConfigurationIdentity');

const DUPLICATE_CONFIGURATION_MESSAGE = 'A product with the same configuration already exists. Update the existing product or add a distinguishing product attribute.';

const resolveProductAttributes = async ({ categoryName, attributes, legacy }) => {
  // Legacy clients do not send an attributes payload. Preserve their existing
  // fixed-field contract while new clients receive category-aware validation.
  if (attributes === undefined) return { attributes: {}, legacy };
  const category = await Category.findOne({ name: categoryName });
  if (!category) return { attributes: plainAttributes(attributes), legacy };
  const definitions = getEffectiveDefinitions(category);
  const values = validateProductAttributeValues(definitions, attributes, legacy);
  return { attributes: values, legacy: applyLegacyCompatibility(definitions, values, legacy) };
};

const normalizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const SKU_MAX_LENGTH = 100;
const CATEGORY_SKU_PREFIXES = {
  Lumbers: 'LBR',
  'Steel Bars': 'STL',
  'Galvanized Sheets': 'GS',
  Plywoods: 'PLY',
  Boards: 'BRD',
  'Steel Plates': 'SPL',
  Pipes: 'PIP',
  Paints: 'PNT',
  Thinners: 'THN',
  'Door Locksets': 'DLK',
  'Drawer Handles': 'DRH',
  Padlocks: 'PDL',
  'Adhesives & Tapes': 'ADH',
  'Construction Tools': 'CTL',
  'Galvanized Wires': 'GW',
  'Cement, Sand & Gravel': 'CMT',
  'Bolts, Nuts, Screws & Nails': 'BNS',
  'Door Closers & Hinges': 'DCH',
  'Electrical & Lighting': 'ELC',
  'Plumbing Materials': 'PLB',
  'Pressure Tanks': 'PTK',
  'Caster Wheels': 'CW',
  'Ropes & Chains': 'RC',
  Screens: 'SCR',
  Others: 'OTH',
};

const normalizeSku = (value) => normalizeString(value).toUpperCase();

const validateSku = (sku) => {
  if (!sku) {
    return 'SKU is required.';
  }
  if (sku.length > SKU_MAX_LENGTH) {
    return `SKU cannot exceed ${SKU_MAX_LENGTH} characters.`;
  }
  if (/[\u0000-\u001F\u007F]/.test(sku)) {
    return 'SKU cannot contain control characters.';
  }
  return '';
};

const getSkuPrefix = (category) => CATEGORY_SKU_PREFIXES[normalizeString(category)] || 'OTH';

const generateNextSku = async (category) => {
  const prefix = getSkuPrefix(category);
  const matchingProducts = await Product.find({
    sku: new RegExp(`^${prefix}-\\d+$`, 'i'),
  }).select('sku').lean();
  const usedSkus = new Set(matchingProducts.map((product) => normalizeSku(product?.sku)));

  let counter = 1;
  let candidate = `${prefix}-${String(counter).padStart(3, '0')}`;
  while (usedSkus.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${String(counter).padStart(3, '0')}`;
  }
  return candidate;
};

const isDuplicateKeyError = (error) => Number(error?.code) === 11000;

const getConfigurationDefinitions = async (categoryName) => {
  const category = await Category.findOne({ name: categoryName });
  return category ? getEffectiveDefinitions(category) : [];
};

const findConfigurationConflict = async ({ candidate, definitions, excludeId = null }) => {
  const identity = buildProductConfigurationIdentity({
    ...productConfigurationInput(candidate),
    definitions,
  });
  const candidates = await Product.find({
    category: candidate.category,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });

  return candidates.find((product) => (
    buildProductConfigurationIdentity({
      ...productConfigurationInput(product),
      definitions,
    }) === identity
  )) || null;
};

const buildInventoryLogDetails = ({ productName, stockDelta, adjustmentReason }) => {
  const reason = normalizeString(adjustmentReason);

  if (reason && stockDelta > 0) {
    return `Added ${stockDelta} of ${productName} — Reason: ${reason}`;
  }

  if (reason && stockDelta < 0) {
    return `Deducted ${Math.abs(stockDelta)} of ${productName} — Reason: ${reason}`;
  }

  return `Updated product ${productName}`;
};

const listProducts = async (req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    return res.json(products);
  } catch (error) {
    return next(error);
  }
};

const createProduct = async (req, res, next) => {
  try {
    const clientRequestId = normalizeString(req.body?.clientRequestId);
    if (clientRequestId) {
      const existing = await Product.findOne({ clientRequestId });
      if (existing) return res.status(200).json(existing);
    }

    const name = normalizeHumanReadable(req.body?.name);
    const requestedSku = normalizeSku(req.body?.sku);
    const category = normalizeHumanReadable(req.body?.category);
    const brand = normalizeHumanReadable(req.body?.brand);
    const color = normalizeHumanReadable(req.body?.color);
    const size = normalizeString(req.body?.size);
    const supplierName = normalizeHumanReadable(req.body?.supplierName);
    const imageUrl = normalizeString(req.body?.imageUrl);
    const hasStock = Object.prototype.hasOwnProperty.call(req.body || {}, 'stock');
    const stock = hasStock ? parseStrictWholeNumber(req.body.stock) : 0;
    const price = parseSafeMoney(req.body?.price);

    if (!name || req.body?.price === undefined || req.body?.price === null || req.body?.price === '') {
      return res.status(400).json({ message: 'name and price are required.' });
    }
    if (price === null) {
      return res.status(400).json({ message: isMoneyInputTooLarge(req.body?.price) ? 'Amount is too large. Please enter a smaller value.' : 'price must be a non-negative number with up to 2 decimal places.' });
    }
    if (stock === null) {
      return res.status(400).json({ message: 'stock must be a non-negative whole number.' });
    }

    let resolvedAttributes;
    try {
      resolvedAttributes = await resolveProductAttributes({ categoryName: category, attributes: req.body?.attributes, legacy: { brand, color, size } });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const createPayload = {
      name,
      category,
      brand: resolvedAttributes.legacy.brand,
      color: resolvedAttributes.legacy.color,
      size: resolvedAttributes.legacy.size,
      attributes: resolvedAttributes.attributes,
      supplierName,
      imageUrl,
      stock,
      price,
      ...(clientRequestId ? { clientRequestId } : {}),
    };

    const configurationDefinitions = await getConfigurationDefinitions(category);
    const configurationConflict = await findConfigurationConflict({
      candidate: createPayload,
      definitions: configurationDefinitions,
    });
    if (configurationConflict) {
      return res.status(409).json({ message: DUPLICATE_CONFIGURATION_MESSAGE });
    }

    let product;
    if (requestedSku) {
      const validationMessage = validateSku(requestedSku);
      if (validationMessage) {
        return res.status(400).json({ message: validationMessage });
      }
      const existing = await Product.findOne({ sku: requestedSku });
      if (existing) {
        return res.status(409).json({ message: 'SKU already exists.' });
      }
      try {
        product = await Product.create({ ...createPayload, sku: requestedSku });
      } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.clientRequestId) {
          const existing = await Product.findOne({ clientRequestId });
          if (existing) return res.status(200).json(existing);
        }
        if (isDuplicateKeyError(error)) {
          return res.status(409).json({ message: 'SKU already exists.' });
        }
        throw error;
      }
    } else {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const generatedSku = await generateNextSku(category);
        try {
          product = await Product.create({ ...createPayload, sku: generatedSku });
          break;
        } catch (error) {
          if (error?.code === 11000 && error?.keyPattern?.clientRequestId) {
            const existing = await Product.findOne({ clientRequestId });
            if (existing) return res.status(200).json(existing);
          }
          if (!isDuplicateKeyError(error)) {
            throw error;
          }
        }
      }
      if (!product) {
        return res.status(409).json({ message: 'Could not generate a unique SKU. Please try again.' });
      }
    }

    await writeInventoryLog({
      action: 'CREATE',
      code: product.sku,
      productRef: product._id,
      user: req.user,
      details: `Created product ${product.name}`,
      quantity: Number(product.stock || 0),
      stockBefore: 0,
      stockAfter: Number(product.stock || 0),
    });

    await writeActivityLog({
      user: req.user,
      action: 'Created Product',
      details: `Created ${product.name} (${product.sku})`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishInventoryUpdated({ reason: 'product.created', productCodes: [product.sku] });

    return res.status(201).json(product);
  } catch (error) {
    return next(error);
  }
};

const getRecommendationFields = (type) => (
  type === 'budget'
    ? { manualField: 'manualBudgetOptions', excludedField: 'excludedBudgetOptions', label: 'Budget Option' }
    : { manualField: 'manualAlternatives', excludedField: 'excludedAlternatives', label: 'Alternative Product' }
);

const addProductRecommendation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const type = req.body?.type === 'budget' ? 'budget' : 'alternative';
    const recommendationCode = normalizeSku(req.body?.recommendationCode);
    const recommendationId = normalizeString(req.body?.recommendationId);
    const { manualField, excludedField, label } = getRecommendationFields(type);

    if (!recommendationCode || !recommendationId) {
      return res.status(400).json({ message: 'A recommendation product is required.' });
    }

    const [target, candidate] = await Promise.all([
      Product.findById(id),
      Product.findOne({ _id: recommendationId, sku: recommendationCode, isActive: { $ne: false }, stock: { $gt: 0 } }),
    ]);
    if (!target) return res.status(404).json({ message: 'Product not found.' });
    if (!candidate) return res.status(400).json({ message: 'The selected recommendation is unavailable.' });
    if (String(target._id) === String(candidate._id) || target.sku === candidate.sku) {
      return res.status(400).json({ message: 'A product cannot recommend itself.' });
    }

    const result = await Product.updateOne(
      { _id: id, [manualField]: { $ne: recommendationCode } },
      { $addToSet: { [manualField]: recommendationCode }, $pull: { [excludedField]: recommendationCode } },
      { runValidators: true }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      return res.status(409).json({ message: 'This recommendation is already present.' });
    }

    const product = await Product.findById(id);
    await writeActivityLog({
      user: req.user,
      action: 'Added Recommendation',
      details: `Added ${label} ${recommendationCode} to ${product.name} (${product.sku})`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    publishInventoryUpdated({ reason: 'product.recommendation.added', productCodes: [product.sku] });
    return res.json(product);
  } catch (error) {
    return next(error);
  }
};

const removeProductRecommendation = async (req, res, next) => {
  try {
    const { id, alternativeCode } = req.params;
    const normalizedAlternativeCode = normalizeSku(alternativeCode);
    const type = req.query?.type === 'budget' ? 'budget' : 'alternative';
    const { manualField, excludedField, label } = getRecommendationFields(type);

    if (!normalizedAlternativeCode) {
      return res.status(400).json({ message: 'A recommendation code is required.' });
    }

    const updateResult = await Product.updateOne(
      {
        _id: id,
        $or: [
          { [manualField]: normalizedAlternativeCode },
          { [excludedField]: { $ne: normalizedAlternativeCode } },
        ],
      },
      {
        $addToSet: { [excludedField]: normalizedAlternativeCode },
        $pull: { [manualField]: normalizedAlternativeCode },
      },
      { runValidators: true }
    );

    if (updateResult.matchedCount !== 1 || updateResult.modifiedCount !== 1) {
      const productExists = await Product.exists({ _id: id });
      return res.status(productExists ? 409 : 404).json({
        message: productExists
          ? 'This recommendation was already removed or is no longer available.'
          : 'Product not found.',
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    await writeActivityLog({
      user: req.user,
      action: 'Removed Recommendation',
      details: `Removed ${label} ${normalizedAlternativeCode} from ${product.name} (${product.sku})`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishInventoryUpdated({ reason: 'product.recommendation.removed', productCodes: [product.sku] });

    return res.json(product);
  } catch (error) {
    return next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await Product.findById(id);

    if (!existing) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const stockBefore = Number(existing.stock || 0);
    const adjustmentRequestId = req.body?.stock !== undefined
      ? normalizeString(req.body?.adjustmentRequestId)
      : '';
    // A retry of an accepted adjustment must replay even though its original
    // stock/timestamp preconditions are now stale.
    if (adjustmentRequestId && existing.lastStockAdjustmentRequestId === adjustmentRequestId) {
      return res.json(existing);
    }
    const expectedUpdatedAtRaw = normalizeString(req.body?.expectedUpdatedAt);
    if (expectedUpdatedAtRaw) {
      const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
      if (Number.isNaN(expectedUpdatedAt.getTime())) {
        return res.status(400).json({ message: 'Invalid product version. Refresh and retry.' });
      }
      if (!Number.isNaN(expectedUpdatedAt.getTime()) && existing.updatedAt) {
        if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          return res.status(409).json({ message: 'This product was updated by another user. Please refresh and try again.' });
        }
      }
    }

    if (req.body?.expectedStock !== undefined) {
      const expectedStock = parseStrictWholeNumber(req.body.expectedStock);
      if (expectedStock === null) return res.status(400).json({ message: 'Invalid expected stock.' });
      if (expectedStock !== stockBefore) {
        return res.status(409).json({ message: 'Stock changed. Refresh and retry this adjustment.' });
      }
    }

    const payload = {};

    if (req.body?.name !== undefined) payload.name = normalizeHumanReadable(req.body.name);
    if (req.body?.sku !== undefined) {
      const requestedSku = normalizeSku(req.body.sku);
      const validationMessage = validateSku(requestedSku);
      if (validationMessage) {
        return res.status(400).json({ message: validationMessage });
      }
      const duplicateSku = await Product.findOne({ _id: { $ne: id }, sku: requestedSku });
      if (duplicateSku) {
        return res.status(409).json({ message: 'SKU already exists.' });
      }
      payload.sku = requestedSku;
    }
    if (req.body?.category !== undefined) payload.category = normalizeHumanReadable(req.body.category);
    if (req.body?.brand !== undefined) payload.brand = normalizeHumanReadable(req.body.brand);
    if (req.body?.color !== undefined) payload.color = normalizeHumanReadable(req.body.color);
    if (req.body?.size !== undefined) payload.size = normalizeString(req.body.size);
    if (req.body?.supplierName !== undefined) payload.supplierName = normalizeHumanReadable(req.body.supplierName);
    if (req.body?.imageUrl !== undefined) payload.imageUrl = normalizeString(req.body.imageUrl);
    if (req.body?.isActive !== undefined) payload.isActive = Boolean(req.body.isActive);

    if (req.body?.attributes !== undefined) {
      try {
        const legacy = {
          // Existing legacy values remain the fallback for attributes that are
          // no longer configured. Configured Brand/Color/Size values are still
          // mirrored from the authoritative attributes payload below.
          brand: existing.brand,
          color: existing.color,
          size: existing.size,
        };
        const resolved = await resolveProductAttributes({
          categoryName: payload.category ?? existing.category,
          attributes: req.body?.attributes ?? plainAttributes(existing.attributes),
          legacy,
        });
        payload.attributes = resolved.attributes;
        payload.brand = resolved.legacy.brand;
        payload.color = resolved.legacy.color;
        payload.size = resolved.legacy.size;
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
    }

    if (req.body?.stock !== undefined) {
      const stockValue = parseStrictWholeNumber(req.body.stock);
      if (stockValue === null) {
        return res.status(400).json({ message: 'stock must be a non-negative whole number.' });
      }
      payload.stock = stockValue;
      if (adjustmentRequestId) payload.lastStockAdjustmentRequestId = adjustmentRequestId;
    }

    if (req.body?.price !== undefined) {
      const priceValue = parseSafeMoney(req.body.price);
      if (priceValue === null) {
        return res.status(400).json({ message: isMoneyInputTooLarge(req.body.price) ? 'Amount is too large. Please enter a smaller value.' : 'price must be a non-negative number with up to 2 decimal places.' });
      }
      payload.price = priceValue;
    }

    const configurationCandidate = {
      category: payload.category ?? existing.category,
      name: payload.name ?? existing.name,
      attributes: payload.attributes ?? plainAttributes(existing.attributes),
      brand: payload.brand ?? existing.brand,
      color: payload.color ?? existing.color,
      size: payload.size ?? existing.size,
    };
    const configurationDefinitions = await getConfigurationDefinitions(configurationCandidate.category);
    const existingConfigurationIdentity = buildProductConfigurationIdentity({
      ...productConfigurationInput(existing),
      definitions: configurationDefinitions,
    });
    const updatedConfigurationIdentity = buildProductConfigurationIdentity({
      ...productConfigurationInput(configurationCandidate),
      definitions: configurationDefinitions,
    });
    if (existingConfigurationIdentity !== updatedConfigurationIdentity) {
      const configurationConflict = await findConfigurationConflict({
        candidate: configurationCandidate,
        definitions: configurationDefinitions,
        excludeId: id,
      });
      if (configurationConflict) {
        return res.status(409).json({ message: DUPLICATE_CONFIGURATION_MESSAGE });
      }
    }

    const product = await Product.findOneAndUpdate({
      _id: id,
      // Compare inside the actual write, including callers without a client
      // timestamp, so changes after our read cannot be silently overwritten.
      ...(payload.stock !== undefined ? { stock: stockBefore } : {}),
      ...((payload.stock !== undefined || expectedUpdatedAtRaw) && existing.updatedAt
        ? { updatedAt: new Date(expectedUpdatedAtRaw || existing.updatedAt) } : {}),
      ...(adjustmentRequestId ? { lastStockAdjustmentRequestId: { $ne: adjustmentRequestId } } : {}),
    }, payload, {
      new: true,
      runValidators: true,
    });

    if (!product && adjustmentRequestId) {
      const replayedProduct = await Product.findById(id);
      if (replayedProduct?.lastStockAdjustmentRequestId === adjustmentRequestId) {
        return res.json(replayedProduct);
      }
    }
    if (!product) {
      return res.status(409).json({ message: 'Product changed or is no longer available. Refresh and retry.' });
    }

    const stockAfter = Number(product.stock || 0);
    const stockDelta = stockAfter - stockBefore;
    const inventoryAdjustmentReason = normalizeString(req.body?.inventoryAdjustmentReason);
    const archiveStateChanged = payload.isActive !== undefined && Boolean(product.isActive) !== Boolean(existing.isActive);

    let inventoryAction = 'UPDATE';
    if (archiveStateChanged) {
      inventoryAction = product.isActive ? 'RESTORE' : 'ARCHIVE';
    } else if (stockDelta > 0) {
      inventoryAction = 'ADD';
    } else if (stockDelta < 0) {
      inventoryAction = 'DEDUCT';
    }

    await writeInventoryLog({
      action: inventoryAction,
      code: product.sku,
      productRef: product._id,
      user: req.user,
      details: archiveStateChanged
        ? `${product.isActive ? 'Restored' : 'Archived'} product ${product.name}`
        : buildInventoryLogDetails({
          productName: product.name,
          stockDelta,
          adjustmentReason: inventoryAdjustmentReason,
        }),
      quantity: Math.abs(stockDelta),
      stockBefore,
      stockAfter,
    });

    await writeActivityLog({
      user: req.user,
      action: archiveStateChanged ? (product.isActive ? 'Restored Product' : 'Archived Product') : 'Updated Product',
      details: archiveStateChanged
        ? `${product.isActive ? 'Restored' : 'Archived'} ${product.name} (${product.sku})`
        : `Updated ${product.name} (${product.sku})`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    publishInventoryUpdated({ reason: 'product.updated', productCodes: [product.sku] });

    return res.json(product);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: 'SKU already exists.' });
    }
    return next(error);
  }
};

module.exports = {
  addProductRecommendation,
  buildInventoryLogDetails,
  generateNextSku,
  getSkuPrefix,
  DUPLICATE_CONFIGURATION_MESSAGE,
  findConfigurationConflict,
  normalizeSku,
  validateSku,
  listProducts,
  createProduct,
  removeProductRecommendation,
  updateProduct,
};
