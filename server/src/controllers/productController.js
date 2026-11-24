const Product = require('../models/Product');
const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const SpecialOrder = require('../models/SpecialOrder');
const Setting = require('../models/Setting');
const { writeActivityLog, writeInventoryLog } = require('../services/logService');
const { publishInventoryUpdated } = require('../services/realtimeService');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { buildInitialExpiry, getManilaBusinessDate, classifyExpiryBatch } = require('../utils/productExpiry');
const ExpiryBatch = require('../models/ExpiryBatch');
const ExpiryBatchCorrection = require('../models/ExpiryBatchCorrection');
const ExpiryBatchMovement = require('../models/ExpiryBatchMovement');
const ExpiryBatchReceipt = require('../models/ExpiryBatchReceipt');
const ExpiryBatchReconciliation = require('../models/ExpiryBatchReconciliation');
const SpecialOrderStockReservation = require('../models/SpecialOrderStockReservation');
const { withAuditedTransaction } = require('../services/auditedTransaction');
const { createProductWithOpeningExpiryBatch, receiveExpiryBatch, verifyExpiryBatchesAndReceiveStock } = require('../services/expiryBatchService');
const { correctExpiryBatchDate: correctExpiryBatchDateService } = require('../services/expiryBatchCorrectionService');
const { activeBatchFilter, batchesToCloseFilter, createExpiryTrackingPeriodId } = require('../services/expiryBatchLifecycle');
const {
  inspectBatchState,
  getExpiryBatchAvailability,
  allocateSelectedUnreservedBatches,
  normalizeSelectedStockOutAllocations,
  selectAllocations,
  reconcileExpiryBatches,
} = require('../services/expiryBatchAllocationService');
const { isMoneyInputTooLarge, parseSafeMoney } = require('../utils/moneyValidation');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');
const { MAX_PRODUCT_IMAGE_BYTES, validateImageSource } = require('../utils/imageSourceValidation');
const { applyLegacyCompatibility, getEffectiveDefinitions, plainAttributes, validateProductAttributeValues } = require('../utils/productAttributes');
const { buildProductConfigurationIdentity, productConfigurationInput, productConfigurationsConflict } = require('../utils/productConfigurationIdentity');
const { addProductRecommendation, editProductRecommendationBasis, removeProductRecommendation } = require('./recommendationController');
const {
  categoryNameCondition,
  normalizeCategoryKey,
  resolveCategory,
  resolveProductCategory,
} = require('../utils/categoryResolution');

const DUPLICATE_CONFIGURATION_MESSAGE = 'A product with the same configuration already exists. Update the existing product or add a distinguishing product attribute.';
const canViewPurchaseCost = (user) => ['admin', 'superadmin'].includes(user?.role);
const withoutPurchaseCost = (product, user) => {
  if (canViewPurchaseCost(user)) return product;
  const safeProduct = { ...product };
  delete safeProduct.purchaseCost;
  return safeProduct;
};

const getExpiryTrackingDisableBlocker = async (product, { session = null } = {}) => {
  const inSession = (query) => (session ? query.session(session) : query);
  const [batches, activeReservation, consumedReservations, openSpecialOrder, sales, saleMovements] = await Promise.all([
    inSession(ExpiryBatch.find({ product: product._id }).select('reservedQuantity').lean()),
    inSession(SpecialOrderStockReservation.exists({ product: product._id, status: 'Active' })),
    inSession(SpecialOrderStockReservation.find({ product: product._id, status: 'Consumed' })
      .select('consumedSale consumedAt').lean()),
    inSession(SpecialOrder.exists({
      status: { $nin: ['Completed', 'Cancelled'] },
      'items.inventoryProduct': product._id,
    })),
    inSession(Sale.find({ 'items.product': product._id })
      .select('status voidRequest.status items.product items.quantity items.batchVerification.proposedAllocations items.batchVerification.verifiedAllocations')
      .lean()),
    inSession(ExpiryBatchMovement.find({
      product: product._id,
      type: { $in: ['SALE', 'SPECIAL_ORDER_CONSUME', 'SALE_VOID'] },
    }).select('type sourceType sourceId batch quantity').lean()),
  ]);

  if (batches.some((batch) => {
    const quantity = batch.reservedQuantity === undefined ? 0 : Number(batch.reservedQuantity);
    return batch.reservedQuantity === null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 0;
  })) {
    return 'Expiry Tracking cannot be turned off because batch reservations need review.';
  }
  if (activeReservation) {
    return 'An active Special Order reservation uses this SKU. Release or complete it before turning off Expiry Tracking.';
  }
  if (openSpecialOrder) {
    return 'An open Special Order uses this SKU. Complete or cancel it before turning off Expiry Tracking.';
  }

  const salesById = new Map(sales.map((sale) => [String(sale._id), sale]));
  if (consumedReservations.some((reservation) => (
    !reservation.consumedAt || !reservation.consumedSale || !salesById.has(String(reservation.consumedSale))
  ))) {
    return 'A completed Special Order batch record needs manual review before turning off Expiry Tracking.';
  }
  if (sales.some((sale) => sale.voidRequest?.status === 'pending')) {
    return 'A Sale Void request is pending for this SKU. Resolve it before turning off Expiry Tracking.';
  }
  if (sales.some((sale) => sale.items.some((item) => {
    if (String(item.product) !== String(product._id)) return false;
    const proposed = item.batchVerification?.proposedAllocations || [];
    const verified = item.batchVerification?.verifiedAllocations || [];
    if (!proposed.length && !verified.length) return false;
    const isVoided = String(sale.status || 'completed').toLowerCase() === 'voided';
    const proposedTotal = proposed.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    const verifiedTotal = verified.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    return !isVoided && (
      !verified.length
      || (proposed.length > 0 && proposedTotal !== Number(item.quantity))
      || verifiedTotal !== Number(item.quantity)
    );
  }))) {
    return 'An incomplete batch allocation for this SKU needs manual review before turning off Expiry Tracking.';
  }
  if (saleMovements.some((movement) => {
    if (!movement.sourceId || !['Sale', 'SaleVoid'].includes(movement.sourceType)) return true;
    const sale = salesById.get(String(movement.sourceId));
    if (!sale) return true;
    if (movement.type === 'SALE_VOID' && String(sale.status || '').toLowerCase() !== 'voided') return true;
    return !sale.items.some((item) => (
      String(item.product) === String(product._id)
        && (item.batchVerification?.verifiedAllocations || []).some((allocation) => (
          String(allocation.batch) === String(movement.batch)
            && Number(allocation.quantity) === Number(movement.quantity)
        ))
    ));
  })) {
    return 'Some batch sale history for this SKU is incomplete. Contact an administrator for review before turning off Expiry Tracking.';
  }

  // Completed and voided sale allocations are retained as historical records.
  // Sale Void restores aggregate Product.stock while tracking is off, and a
  // later re-enable always requires batch verification when history exists.
  return '';
};

const normalizeProductFamilyPart = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase();

const getArchiveInventoryBlocker = (product = {}) => {
  const stock = product.stock === null || product.stock === undefined || String(product.stock).trim() === ''
    ? Number.NaN
    : Number(product.stock);
  // Legacy SKU records predate the reservation counter; the Product schema's
  // default for a missing counter is zero, matching the existing app semantics.
  const reservedStock = product.reservedStock === undefined
    ? 0
    : (product.reservedStock === null || String(product.reservedStock).trim() === '' ? Number.NaN : Number(product.reservedStock));
  if (Number.isFinite(stock) && stock === 0 && Number.isFinite(reservedStock) && reservedStock === 0) return null;
  return {
    sku: String(product.sku || '').trim(),
    stock: Number.isFinite(stock) ? stock : null,
    reservedStock: Number.isFinite(reservedStock) ? reservedStock : null,
    sellingUnit: String(product.sellingUnit || '').trim() || 'unit',
  };
};

const formatArchiveBlockerMessage = ({ stock, reservedStock = 0, sellingUnit = 'unit' }) => {
  const parsedStock = stock === null || stock === undefined ? Number.NaN : Number(stock);
  const parsedReserved = reservedStock === null || reservedStock === undefined ? Number.NaN : Number(reservedStock);
  const stockMessage = Number.isFinite(parsedStock)
    ? `This item still has ${parsedStock} ${sellingUnit} in stock.`
    : 'This item has an unknown stock quantity.';
  const reservationNote = Number.isFinite(parsedReserved) && parsedReserved !== 0
    ? ` ${reservedStock} ${sellingUnit} remain reserved or allocated.`
    : (Number.isFinite(parsedReserved) ? '' : ' The reserved quantity could not be verified.');
  const reservationRequirement = reservationNote ? ' Reserved quantity must also be zero before archiving.' : '';
  return `${stockMessage}${reservationNote} Stock must be zero before archiving.${reservationRequirement}`;
};

const resolveProductAttributes = async ({ category, attributes, legacy }) => {
  // Legacy clients do not send an attributes payload. Preserve their existing
  // fixed-field contract while new clients receive category-aware validation.
  if (attributes === undefined) return { attributes: {}, legacy };
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

const categorySellingUnits = (category) => (
  Array.isArray(category?.sizeUnits)
    ? category.sizeUnits.map((unit) => normalizeString(unit)).filter(Boolean)
    : []
);

const resolveSellingUnit = ({ sellingUnit, category, required = false }) => {
  const requestedUnit = normalizeString(sellingUnit);
  const availableUnits = categorySellingUnits(category);

  if (!requestedUnit) {
    if (required && availableUnits.length === 0) {
      throw new Error('No selling units are configured for this category.');
    }
    if (required) {
      throw new Error('Select a selling unit configured for this category.');
    }
    return '';
  }

  const configuredUnit = availableUnits.find((unit) => unit.toLowerCase() === requestedUnit.toLowerCase());
  if (!configuredUnit) {
    throw new Error('Selected selling unit is not configured for this category.');
  }

  return configuredUnit;
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

const getConfigurationDefinitions = (category) => (
  category ? getEffectiveDefinitions(category) : []
);

const findConfigurationConflict = async ({ candidate, definitions, excludeId = null }) => {
  const categoryRef = candidate.categoryRef?._id || candidate.categoryRef;
  const candidates = await Product.find({
    ...(categoryRef ? {
      $or: [
        { categoryRef },
        {
          categoryRef: null,
          category: categoryNameCondition(candidate.category),
        },
      ],
    } : { category: categoryNameCondition(candidate.category) }),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });

  return candidates.find((product) => productConfigurationsConflict(candidate, product, definitions)) || null;
};

const buildInventoryLogDetails = ({ productName, stockDelta, adjustmentReason, sellingUnit }) => {
  const reason = normalizeString(adjustmentReason);
  const unit = normalizeString(sellingUnit);
  const quantity = `${Math.abs(stockDelta)}${unit ? ` ${unit}` : ''}`;

  if (reason && stockDelta > 0) {
    return `Added ${quantity} of ${productName} — Reason: ${reason}`;
  }

  if (reason && stockDelta < 0) {
    return `Deducted ${quantity} of ${productName} — Reason: ${reason}`;
  }

  return `Updated product ${productName}`;
};

const listProducts = async (req, res, next) => {
  try {
    const includeImages = String(req.query?.includeImages || 'true').trim().toLowerCase() !== 'false';
    const productQuery = Product.find().sort({ createdAt: -1 });
    if (!includeImages) productQuery.select('-imageUrl');
    const products = await productQuery.lean();
    const reconciledTracked = products.filter((product) => product.expiryTrackingEnabled
      && product.expiryTrackingPeriodId && product.expiryBatchReconciled);
    const batchRows = reconciledTracked.length
      ? await ExpiryBatch.find({ $or: reconciledTracked.map((product) => activeBatchFilter(product)) })
        .select('product remainingQuantity reservedQuantity expiryDate')
        .lean() : [];
    const batchesByProduct = new Map();
    for (const batch of batchRows) {
      const key = String(batch.product);
      const rows = batchesByProduct.get(key) || [];
      rows.push(batch);
      batchesByProduct.set(key, rows);
    }
    const today = getManilaBusinessDate();
    return res.json(products.map((product) => {
      let availableToSell = product.isActive === false ? 0
        : Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0));
      if (product.expiryTrackingEnabled && product.expiryTrackingPeriodId && product.expiryBatchReconciled) {
        const batches = batchesByProduct.get(String(product._id)) || [];
        const batchStock = batches.reduce((sum, batch) => sum + Number(batch.remainingQuantity || 0), 0);
        const batchReserved = batches.reduce((sum, batch) => sum + Number(batch.reservedQuantity || 0), 0);
        const integrityValid = batchStock === Number(product.stock || 0)
          && batchReserved === Number(product.reservedStock || 0)
          && Number.isSafeInteger(Number(product.stock || 0))
          && Number.isSafeInteger(Number(product.reservedStock || 0))
          && batches.every((batch) => Number.isSafeInteger(batch.remainingQuantity)
            && batch.remainingQuantity >= 0
            && Number.isSafeInteger(batch.reservedQuantity)
            && batch.reservedQuantity >= 0
            && batch.reservedQuantity <= batch.remainingQuantity);
        availableToSell = integrityValid && product.isActive !== false
          ? batches.reduce((sum, batch) => batch.expiryDate > today
            ? sum + Number(batch.remainingQuantity || 0) - Number(batch.reservedQuantity || 0) : sum, 0) : 0;
      }
      if (product.expiryTrackingEnabled
        && (!product.expiryTrackingPeriodId || !product.expiryBatchReconciled)) availableToSell = 0;
      return withoutPurchaseCost({ ...product, availableToSell }, req.user);
    }));
  } catch (error) {
    return next(error);
  }
};

const listProductImages = async (req, res, next) => {
  try {
    const products = await Product.find().select('_id sku imageUrl').lean();
    return res.json(products.map((product) => ({
      id: String(product._id),
      code: String(product.sku || ''),
      imageUrl: String(product.imageUrl || ''),
    })));
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
    const requestedCategoryName = normalizeHumanReadable(req.body?.category);
    const brand = normalizeHumanReadable(req.body?.brand);
    const color = normalizeHumanReadable(req.body?.color);
    const size = normalizeString(req.body?.size);
    const supplierName = normalizeHumanReadable(req.body?.supplierName);
    const imageUrl = validateImageSource(req.body?.imageUrl, {
      maxBytes: MAX_PRODUCT_IMAGE_BYTES,
      fieldName: 'Product image',
    });
    const hasStock = Object.prototype.hasOwnProperty.call(req.body || {}, 'stock');
    const stock = hasStock ? parseStrictWholeNumber(req.body.stock) : 0;
    const price = parseSafeMoney(req.body?.price);
    const purchaseCost = parseSafeMoney(req.body?.purchaseCost);

    if (req.body?.price === undefined || req.body?.price === null || req.body?.price === '') {
      return res.status(400).json({ message: 'price is required.' });
    }
    if (price === null) {
      return res.status(400).json({ message: isMoneyInputTooLarge(req.body?.price) ? 'Amount is too large. Please enter a smaller value.' : 'price must be a non-negative number with up to 2 decimal places.' });
    }
    if (req.body?.purchaseCost === undefined || req.body?.purchaseCost === null || req.body?.purchaseCost === '' || purchaseCost === null) {
      return res.status(400).json({ message: isMoneyInputTooLarge(req.body?.purchaseCost) ? 'Amount is too large. Please enter a smaller value.' : 'purchaseCost is required and must be a non-negative number with up to 2 decimal places.' });
    }
    if (stock === null) {
      return res.status(400).json({ message: 'stock must be a non-negative whole number.' });
    }

    const category = await resolveCategory({
      categoryRef: req.body?.categoryRef,
      categoryName: requestedCategoryName,
      activeOnly: true,
    });
    if (!category) {
      return res.status(400).json({ message: 'Selected category is unavailable.' });
    }
    const canonicalCategoryName = category.name;
    let sellingUnit;
    try {
      sellingUnit = resolveSellingUnit({
        sellingUnit: req.body?.sellingUnit,
        category,
        required: true,
      });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    let expiry;
    try {
      expiry = buildInitialExpiry({ body: req.body, stock, sellingUnit, user: req.user });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    let resolvedAttributes;
    try {
      resolvedAttributes = await resolveProductAttributes({ category, attributes: req.body?.attributes, legacy: { brand, color, size } });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const createPayload = {
      name,
      category: canonicalCategoryName,
      categoryRef: category._id,
      sellingUnit,
      ...expiry,
      ...(expiry.expiryTrackingEnabled ? {
        expiryBatchReconciled: true,
        expiryBatchReconciledAt: new Date(),
        expiryBatchReconciledBy: req.user?._id || null,
      } : {}),
      brand: resolvedAttributes.legacy.brand,
      color: resolvedAttributes.legacy.color,
      size: resolvedAttributes.legacy.size,
      attributes: resolvedAttributes.attributes,
      supplierName,
      imageUrl,
      stock,
      price,
      purchaseCost,
      ...(clientRequestId ? { clientRequestId } : {}),
    };

    const configurationDefinitions = getConfigurationDefinitions(category);
    const configurationConflict = await findConfigurationConflict({
      candidate: createPayload,
      definitions: configurationDefinitions,
    });
    if (configurationConflict) {
      if (clientRequestId && configurationConflict.clientRequestId === clientRequestId) {
        return res.status(200).json(configurationConflict);
      }
      return res.status(409).json({ message: DUPLICATE_CONFIGURATION_MESSAGE });
    }

    const hasOpeningExpiryBatch = Boolean(expiry.expiryTrackingEnabled && stock > 0);
    const persistProduct = (sku) => hasOpeningExpiryBatch
      ? withAuditedTransaction(async ({
        session,
        writeActivityLog: writeRequiredActivityLog,
        writeInventoryLog: writeRequiredInventoryLog,
      }) => {
        const createdProduct = await createProductWithOpeningExpiryBatch({
          productPayload: { ...createPayload, sku },
          user: req.user,
          requestId: clientRequestId,
          session,
        });
        const openingBatchMovements = await ExpiryBatchMovement.find({
          product: createdProduct._id,
          type: 'STOCK_IN',
          requestId: `product-create:${clientRequestId}`,
        }).select('_id').session(session).lean();
        await writeRequiredInventoryLog({
          action: 'CREATE',
          code: createdProduct.sku,
          productRef: createdProduct._id,
          user: req.user,
          details: `Created product ${createdProduct.name}`,
          quantity: Number(createdProduct.stock || 0),
          stockBefore: 0,
          stockAfter: Number(createdProduct.stock || 0),
          batchMovementRefs: openingBatchMovements.map((movement) => movement._id),
        });
        await writeRequiredActivityLog({
          user: req.user,
          action: 'Created Product',
          details: `Created ${createdProduct.name} (${createdProduct.sku})`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent') || '',
        });
        return createdProduct;
      })
      : Product.create({ ...createPayload, sku });

    let product;
    if (requestedSku) {
      const validationMessage = validateSku(requestedSku);
      if (validationMessage) {
        return res.status(400).json({ message: validationMessage });
      }
      const existing = await Product.findOne({ sku: requestedSku });
      if (existing) {
        if (clientRequestId && existing.clientRequestId === clientRequestId) return res.status(200).json(existing);
        return res.status(409).json({ message: 'SKU already exists.' });
      }
      try {
        product = await persistProduct(requestedSku);
      } catch (error) {
        if (isDuplicateKeyError(error) && clientRequestId) {
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
        const generatedSku = await generateNextSku(canonicalCategoryName);
        try {
          product = await persistProduct(generatedSku);
          break;
        } catch (error) {
          if (isDuplicateKeyError(error) && clientRequestId) {
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

    if (!hasOpeningExpiryBatch) {
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
    }

    publishInventoryUpdated({ reason: 'product.created', productCodes: [product.sku] });

    return res.status(201).json(product);
  } catch (error) {
    return next(error);
  }
};

const archiveSelectedVariants = async (req, res, next) => {
  let session;
  let selectedProductIds = [];
  let archivedProducts = [];
  let selectedSkus = [];

  try {
    const { id } = req.params;
    const requestedIds = [...new Set((Array.isArray(req.body?.variantIds) ? req.body.variantIds : [])
      .map((variantId) => String(variantId || '').trim())
      .filter(Boolean))];
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'A valid product family is required.' });
    }
    if (requestedIds.length === 0 || requestedIds.length > 100 || requestedIds.some((variantId) => !mongoose.isValidObjectId(variantId))) {
      return res.status(400).json({ message: 'Select between 1 and 100 valid variant records to archive.' });
    }

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const target = await Product.findById(id).session(session);
      if (!target) {
        const error = new Error('Product not found.');
        error.statusCode = 404;
        throw error;
      }

      // Product families are a presentation grouping over separate sellable
      // SKU records. Resolve membership from the database and restrict the
      // write to the explicitly selected variants.
      const allProducts = await Product.find({}).session(session).lean();
      const familyCategory = normalizeProductFamilyPart(target.category);
      const familyName = normalizeProductFamilyPart(target.name);
      const familyProducts = familyName
        ? allProducts.filter((product) => (
          normalizeProductFamilyPart(product.category) === familyCategory
          && normalizeProductFamilyPart(product.name) === familyName
        ))
        // Blank Product Names have no reliable family identity. Match only
        // the requested product instead of treating every blank in a
        // category as one family.
        : allProducts.filter((product) => String(product._id) === String(target._id));
      const requestedIdSet = new Set(requestedIds.map(String));
      const requestedProducts = familyProducts.filter((product) => requestedIdSet.has(String(product._id)));
      const missingIds = requestedIds.filter((variantId) => !requestedProducts.some((product) => String(product._id) === variantId));
      if (missingIds.length > 0) {
        const unrelatedProducts = allProducts.filter((product) => missingIds.includes(String(product._id)));
        const unknownSkus = unrelatedProducts.map((product) => product.sku || String(product._id));
        const error = new Error(`No variants were archived. These selected records do not belong to ${target.name}: ${unknownSkus.join(', ') || missingIds.join(', ')}.`);
        error.statusCode = 409;
        error.notArchivedSkus = unknownSkus.length ? unknownSkus : missingIds;
        throw error;
      }

      selectedProductIds = requestedProducts.map((product) => product._id);
      selectedSkus = requestedProducts.map((product) => String(product.sku || product._id));
      archivedProducts = requestedProducts.filter((product) => product.isActive !== false);

      const blockers = archivedProducts
        .map((product) => ({ product, inventory: getArchiveInventoryBlocker(product) }))
        .filter(({ inventory }) => inventory);
      if (blockers.length > 0) {
        const details = blockers.map(({ product, inventory }) => (
          `${product.sku || 'Unknown SKU'}: ${formatArchiveBlockerMessage(inventory)}`
        )).join(' ');
        const error = new Error(`No variants were archived. ${details}`);
        error.statusCode = 409;
        error.notArchivedSkus = archivedProducts.map((product) => String(product.sku || product._id));
        throw error;
      }

      if (archivedProducts.length === 0) return;

      const result = await Product.updateMany({
        _id: { $in: archivedProducts.map((product) => product._id) },
        isActive: { $ne: false },
        stock: 0,
        $or: [
          { reservedStock: 0 },
          // Missing counters on legacy documents represent the schema's zero default.
          { reservedStock: { $exists: false } },
        ],
      }, { $set: { isActive: false } }, { session });
      const matchedCount = Number(result?.matchedCount ?? result?.n ?? 0);
      if (matchedCount !== archivedProducts.length) {
        const error = new Error(`No variants were archived. Stock, reservations, or archive status changed for the selected SKUs (${archivedProducts.map((product) => product.sku || product._id).join(', ')}). Refresh and retry.`);
        error.statusCode = 409;
        error.notArchivedSkus = archivedProducts.map((product) => String(product.sku || product._id));
        throw error;
      }
    });

    const updatedProducts = await Product.find({ _id: { $in: selectedProductIds } }).lean();
    for (const product of archivedProducts) {
      await writeInventoryLog({
        action: 'ARCHIVE',
        code: product.sku,
        productRef: product._id,
        user: req.user,
        details: `Archived product ${product.name}`,
        quantity: 0,
        stockBefore: 0,
        stockAfter: 0,
      });
    }
    if (archivedProducts.length > 0) {
      await writeActivityLog({
        user: req.user,
        action: 'Archived Product Variants',
        details: `Archived ${archivedProducts.length} variant(s) of ${archivedProducts[0].name}: ${archivedProducts.map((product) => product.sku).join(', ')}.`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || '',
      });
      publishInventoryUpdated({
        reason: 'product.variants.archived',
        productCodes: archivedProducts.map((product) => product.sku),
      });
    }

    return res.json({
      products: updatedProducts.map((product) => withoutPurchaseCost(product.toObject ? product.toObject() : product, req.user)),
      archivedSkus: archivedProducts.map((product) => String(product.sku || product._id)),
      notArchivedSkus: [],
    });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({
      message: error.message,
      notArchivedSkus: error.notArchivedSkus || selectedSkus,
    });
    return next(error);
  } finally {
    if (session) await session.endSession();
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
    const stockBeforeIsKnown = existing.stock !== null && String(existing.stock ?? '').trim() !== ''
      && Number.isSafeInteger(stockBefore) && stockBefore >= 0;
    const isArchiveRequest = req.body?.isActive === false && existing.isActive !== false;
    const reservedStockBefore = Number(existing.reservedStock || 0);
    const reservedStockBeforeIsKnown = existing.reservedStock === undefined
      || (existing.reservedStock !== null && String(existing.reservedStock).trim() !== ''
        && Number.isSafeInteger(reservedStockBefore) && reservedStockBefore >= 0);
    const expiryTrackingWasRequested = req.body?.expiryTrackingEnabled !== undefined;
    let expiryTrackingChanged = false;
    if (isArchiveRequest && getArchiveInventoryBlocker(existing)) {
      const message = formatArchiveBlockerMessage(getArchiveInventoryBlocker(existing));
      return res.status(409).json({ message });
    }
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
          return res.status(409).json({ message: 'This product changed after you opened it. Refresh the product and review the latest values before trying again.' });
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

    if (expiryTrackingWasRequested) {
      if (typeof req.body.expiryTrackingEnabled !== 'boolean') {
        return res.status(400).json({ message: 'Expiry Tracking must be enabled or disabled using a valid checkbox value.' });
      }
      expiryTrackingChanged = req.body.expiryTrackingEnabled !== Boolean(existing.expiryTrackingEnabled);
      if (expiryTrackingChanged) {
        if (!['admin', 'superadmin'].includes(req.user?.role)) {
          return res.status(403).json({ message: 'Only an administrator can change Expiry Tracking.' });
        }

        if (!req.body.expiryTrackingEnabled) {
          if (!stockBeforeIsKnown || !reservedStockBeforeIsKnown) {
            return res.status(409).json({ message: 'Expiry Tracking cannot be turned off because stock details need review.' });
          }
          if (reservedStockBefore > 0) {
            return res.status(409).json({ message: 'Expiry Tracking cannot be turned off while stock is reserved. Release reservations first.' });
          }
          const disableReason = typeof req.body.expiryTrackingDisableReason === 'string'
            ? req.body.expiryTrackingDisableReason.trim()
            : '';
          if (!disableReason) {
            return res.status(400).json({ message: 'Add a reason before turning off Expiry Tracking.' });
          }
          if (disableReason.length > 500) {
            return res.status(400).json({ message: 'The Expiry Tracking change reason must be 500 characters or fewer.' });
          }
          payload.expiryTrackingEnabled = false;
          payload.expiryBatchReconciled = false;
          payload.expiryTrackingPeriodId = null;
          payload.expiryTrackingPeriodStartedAt = null;
          payload.expiryUnassignedStock = stockBefore;
        } else {
          const canStartWithEmptyReconciledLedger = stockBefore === 0 && reservedStockBefore === 0;
          payload.expiryTrackingEnabled = true;
          payload.expiryBatchReconciled = canStartWithEmptyReconciledLedger;
          payload.expiryBatchReconciledAt = canStartWithEmptyReconciledLedger ? new Date() : null;
          payload.expiryBatchReconciledBy = canStartWithEmptyReconciledLedger ? (req.user?._id || null) : null;
          payload.expiryTrackingPeriodId = createExpiryTrackingPeriodId();
          payload.expiryTrackingPeriodStartedAt = new Date();
          payload.expiryUnassignedStock = stockBefore;
        }
      }
    }

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
    const categoryWasRequested = req.body?.category !== undefined || req.body?.categoryRef !== undefined;
    let resolvedCategory = null;
    let categoryChanged = false;
    if (categoryWasRequested) {
      resolvedCategory = await resolveCategory({
        categoryRef: req.body?.categoryRef,
        categoryName: req.body?.category ?? existing.category,
        activeOnly: true,
      });
      if (!resolvedCategory) {
        return res.status(400).json({ message: 'Target category is unavailable.' });
      }

      const existingRef = existing.categoryRef?._id || existing.categoryRef;
      categoryChanged = existingRef
        ? String(existingRef) !== String(resolvedCategory._id)
        : normalizeCategoryKey(existing.category) !== normalizeCategoryKey(resolvedCategory.name);

      payload.category = resolvedCategory.name;
      payload.categoryRef = resolvedCategory._id;
      if (categoryChanged && req.body?.attributes === undefined) {
        return res.status(400).json({ message: 'Product attributes are required when changing category.' });
      }
    }
    if (req.body?.brand !== undefined) payload.brand = normalizeHumanReadable(req.body.brand);
    if (req.body?.color !== undefined) payload.color = normalizeHumanReadable(req.body.color);
    if (req.body?.size !== undefined) payload.size = normalizeString(req.body.size);
    if (req.body?.supplierName !== undefined) payload.supplierName = normalizeHumanReadable(req.body.supplierName);
    if (req.body?.imageUrl !== undefined) {
      const submittedImage = typeof req.body.imageUrl === 'string' ? req.body.imageUrl.trim() : req.body.imageUrl;
      const savedImage = String(existing.imageUrl || '').trim();
      payload.imageUrl = submittedImage === savedImage
        ? existing.imageUrl
        : validateImageSource(submittedImage, {
          maxBytes: MAX_PRODUCT_IMAGE_BYTES,
          fieldName: 'Product image',
        });
    }
    if (req.body?.isActive !== undefined) payload.isActive = Boolean(req.body.isActive);

    if (req.body?.sellingUnit !== undefined) {
      try {
        if (!resolvedCategory) {
          resolvedCategory = await resolveProductCategory(existing);
        }
        if (!resolvedCategory) {
          return res.status(400).json({ message: 'The product category could not be resolved.' });
        }
        const requestedSellingUnit = normalizeString(req.body.sellingUnit);
        const existingSellingUnit = normalizeString(existing.sellingUnit);
        const sellingUnitIsChanging = requestedSellingUnit
          && existingSellingUnit
          && requestedSellingUnit.toLowerCase() !== existingSellingUnit.toLowerCase();

        if (sellingUnitIsChanging) {
          const [hasStock, hasSaleHistory] = await Promise.all([
            Number(existing.stock || 0) > 0,
            Sale.exists({ 'items.product': existing._id }),
          ]);

          if (hasStock || hasSaleHistory) {
            return res.status(409).json({
              message: 'Sold By cannot be changed after stock or sales history exists. Create a new product variant instead.',
            });
          }
        }

        payload.sellingUnit = requestedSellingUnit
          && requestedSellingUnit.toLowerCase() === existingSellingUnit.toLowerCase()
          ? existingSellingUnit
          : resolveSellingUnit({
            sellingUnit: requestedSellingUnit,
            category: resolvedCategory,
            required: Boolean(existingSellingUnit && !requestedSellingUnit),
          });
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
    }

    if (req.body?.attributes !== undefined) {
      try {
        if (!resolvedCategory) {
          resolvedCategory = await resolveProductCategory(existing);
        }
        if (!resolvedCategory) {
          return res.status(400).json({ message: 'The product category could not be resolved.' });
        }
        const legacy = categoryChanged ? { brand: '', color: '', size: '' } : {
          // Existing legacy values remain the fallback for attributes that are
          // no longer configured. Configured Brand/Color/Size values are still
          // mirrored from the authoritative attributes payload below.
          brand: existing.brand,
          color: existing.color,
          size: existing.size,
        };
        const resolved = await resolveProductAttributes({
          category: resolvedCategory,
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
      if (isArchiveRequest && stockValue !== 0) {
        return res.status(409).json({
          message: formatArchiveBlockerMessage({
            stock: stockBefore,
            reservedStock: reservedStockBefore,
            sellingUnit: existing.sellingUnit || 'unit',
          }),
        });
      }
      payload.stock = stockValue;
      if (existing.expiryTrackingEnabled && stockValue !== stockBefore && !req._trustedStockAdjustment) {
        return res.status(409).json({ message: 'Use Stock Operations to change stock for expiry-tracked products.' });
      }
      if (adjustmentRequestId) payload.lastStockAdjustmentRequestId = adjustmentRequestId;
    }

    if (payload.stock > stockBefore && existing.isActive === false && payload.isActive !== true) {
      return res.status(409).json({ message: 'Archived products cannot receive stock. Restore the product first.' });
    }

    if (req.body?.price !== undefined) {
      const priceValue = parseSafeMoney(req.body.price);
      if (priceValue === null) {
        return res.status(400).json({ message: isMoneyInputTooLarge(req.body.price) ? 'Amount is too large. Please enter a smaller value.' : 'price must be a non-negative number with up to 2 decimal places.' });
      }
      payload.price = priceValue;
    }

    let clearPurchaseCost = false;
    if (req.body?.purchaseCost !== undefined) {
      if (req.body.purchaseCost === null || req.body.purchaseCost === '') {
        clearPurchaseCost = true;
      } else {
        const purchaseCostValue = parseSafeMoney(req.body.purchaseCost);
        if (purchaseCostValue === null) {
          return res.status(400).json({ message: isMoneyInputTooLarge(req.body.purchaseCost) ? 'Amount is too large. Please enter a smaller value.' : 'purchaseCost must be a non-negative number with up to 2 decimal places.' });
        }
        payload.purchaseCost = purchaseCostValue;
      }
    }

    const changesConfiguration = ['category', 'categoryRef', 'name', 'attributes', 'brand', 'color', 'size', 'sellingUnit']
      .some((field) => Object.prototype.hasOwnProperty.call(payload, field));
    if (changesConfiguration && !resolvedCategory) {
      resolvedCategory = await resolveProductCategory(existing);
      if (!resolvedCategory) {
        return res.status(400).json({ message: 'The product category could not be resolved.' });
      }
    }
    if (changesConfiguration && resolvedCategory && !categoryWasRequested) {
      const existingRef = existing.categoryRef?._id || existing.categoryRef;
      if (
        String(existingRef || '') !== String(resolvedCategory._id)
        || existing.category !== resolvedCategory.name
      ) {
        payload.categoryRef = resolvedCategory._id;
        payload.category = resolvedCategory.name;
      }
    }
    const configurationCandidate = {
      category: payload.category ?? existing.category,
      categoryRef: payload.categoryRef ?? existing.categoryRef,
      name: payload.name ?? existing.name,
      sellingUnit: payload.sellingUnit ?? existing.sellingUnit,
      attributes: payload.attributes ?? plainAttributes(existing.attributes),
      brand: payload.brand ?? existing.brand,
      color: payload.color ?? existing.color,
      size: payload.size ?? existing.size,
    };
    const configurationDefinitions = getConfigurationDefinitions(resolvedCategory);
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

    const productUpdateFilter = {
      _id: id,
      ...(isArchiveRequest ? { isActive: { $ne: false }, stock: 0, reservedStock: 0 } : {}),
      ...(payload.stock !== undefined && payload.stock < stockBefore
        ? { $expr: { $lte: [{ $ifNull: ['$reservedStock', 0] }, payload.stock] } }
        : {}),
      // Compare inside the actual write, including callers without a client
      // timestamp, so changes after our read cannot be silently overwritten.
      ...(payload.stock !== undefined ? { stock: stockBefore } : {}),
      ...(expiryTrackingChanged ? {
        ...(existing.expiryTrackingEnabled
          ? { expiryTrackingEnabled: true }
          : { expiryTrackingEnabled: { $ne: true } }),
        expiryTrackingPeriodId: existing.expiryTrackingPeriodId || null,
        stock: stockBefore,
        // Legacy product documents can omit reservedStock. Mongoose hydrates
        // that missing field with the schema default (0), so a strict
        // `reservedStock: 0` predicate would never match the persisted row.
        // Treat missing/null as zero while still rejecting any concurrent
        // reservation that changes the effective reserved quantity.
        reservedStock: reservedStockBefore === 0
          ? { $in: [0, null] }
          : reservedStockBefore,
      } : {}),
      ...(payload.stock > stockBefore && payload.isActive !== true ? { isActive: { $ne: false } } : {}),
      ...((payload.stock !== undefined || expiryTrackingChanged || expectedUpdatedAtRaw) && existing.updatedAt
        ? { updatedAt: new Date(expectedUpdatedAtRaw || existing.updatedAt) } : {}),
      ...(adjustmentRequestId ? { lastStockAdjustmentRequestId: { $ne: adjustmentRequestId } } : {}),
    };
    const productUpdate = clearPurchaseCost ? { $set: payload, $unset: { purchaseCost: 1 } } : payload;
    let product;
    let expiryTrackingAuditWritten = false;
    if (expiryTrackingChanged) {
      try {
        product = await withAuditedTransaction(async ({ session, writeActivityLog: writeRequiredActivityLog }) => {
          const current = await Product.findById(id).session(session);
          if (!current) {
            const error = new Error('Product not found. Refresh and retry.');
            error.status = 404;
            throw error;
          }
          const sameVersion = !existing.updatedAt
            || new Date(current.updatedAt || 0).getTime() === existing.updatedAt.getTime();
          const sameStock = Number(current.stock || 0) === stockBefore
            && Number(current.reservedStock || 0) === reservedStockBefore
            && Boolean(current.expiryTrackingEnabled) === Boolean(existing.expiryTrackingEnabled);
          if (!sameVersion || !sameStock) {
            const error = new Error('Stock or Expiry Tracking changed while you were editing. Refresh and review this SKU before trying again.');
            error.status = 409;
            throw error;
          }
          if (!stockBeforeIsKnown || !reservedStockBeforeIsKnown) {
            const error = new Error('Expiry Tracking cannot be turned off because stock details need review.');
            error.status = 409;
            throw error;
          }
          if (!req.body.expiryTrackingEnabled && reservedStockBefore > 0) {
            const error = new Error('Expiry Tracking cannot be turned off while stock is reserved. Release reservations first.');
            error.status = 409;
            throw error;
          }
          const blocker = !req.body.expiryTrackingEnabled
            ? await getExpiryTrackingDisableBlocker(current, { session })
            : '';
          if (blocker) {
            const error = new Error(blocker);
            error.status = 409;
            throw error;
          }

          const closedAt = new Date();
          const closingPeriodId = current.expiryTrackingPeriodId || createExpiryTrackingPeriodId();
          await ExpiryBatch.updateMany(batchesToCloseFilter(current), {
            $set: { trackingPeriodId: closingPeriodId, trackingPeriodClosedAt: closedAt },
          }, { session });

          const updated = await Product.findOneAndUpdate(productUpdateFilter, productUpdate, {
            new: true,
            runValidators: true,
            session,
          });
          if (!updated) {
            const error = new Error('Stock or Expiry Tracking changed while you were editing. Refresh and review this SKU before trying again.');
            error.status = 409;
            throw error;
          }
          await writeRequiredActivityLog({
            user: req.user,
            action: req.body.expiryTrackingEnabled ? 'Expiry Tracking Enabled' : 'Expiry Tracking Disabled',
            details: req.body.expiryTrackingEnabled
              ? stockBefore > 0
                ? `Started expiry tracking period ${updated.expiryTrackingPeriodId} for ${current.name} (${current.sku}). Existing stock ${stockBefore} requires physical batch verification before expiry-based stock selection.`
                : `Started expiry tracking period ${updated.expiryTrackingPeriodId} for ${current.name} (${current.sku}) with an empty stock ledger; no opening batch was created.`
              : `Closed expiry tracking period ${closingPeriodId} for ${current.name} (${current.sku}). Reason: ${req.body.expiryTrackingDisableReason.trim()}. Existing balances, batches, receipts, movements, sale allocations, and references were preserved as history.`,
            ipAddress: req.ip,
            userAgent: req.get('user-agent') || '',
          });
          expiryTrackingAuditWritten = true;
          return updated;
        });
      } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        throw error;
      }
    } else {
      product = await Product.findOneAndUpdate(productUpdateFilter, productUpdate, {
      new: true,
      runValidators: true,
      });
    }

    if (!product && adjustmentRequestId) {
      const replayedProduct = await Product.findById(id);
      if (replayedProduct?.lastStockAdjustmentRequestId === adjustmentRequestId) {
        return res.json(replayedProduct);
      }
    }
    if (!product) {
      if (isArchiveRequest) {
        const latest = await Product.findById(id);
        const latestBlocker = latest && getArchiveInventoryBlocker(latest);
        if (latestBlocker) return res.status(409).json({ message: formatArchiveBlockerMessage(latestBlocker) });
      }
      if (payload.stock !== undefined && payload.stock < stockBefore) {
        const latest = await Product.findById(id).select('reservedStock');
        if (latest && Number(latest.reservedStock || 0) > payload.stock) {
          return res.status(409).json({ message: 'Stock cannot be reduced below the quantity reserved for Special Orders. Release reservations first.' });
        }
      }
      if (expiryTrackingChanged) {
        return res.status(409).json({ message: 'Stock or Expiry Tracking changed while you were editing. Refresh and review this SKU before trying again.' });
      }
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
          sellingUnit: product.sellingUnit,
        }),
      quantity: Math.abs(stockDelta),
      stockBefore,
      stockAfter,
    });

    if (!expiryTrackingAuditWritten) {
      await writeActivityLog({
        user: req.user,
        action: archiveStateChanged ? (product.isActive ? 'Restored Product' : 'Archived Product') : 'Updated Product',
        details: archiveStateChanged
          ? `${product.isActive ? 'Restored' : 'Archived'} ${product.name} (${product.sku})`
          : `Updated ${product.name} (${product.sku})${expiryTrackingChanged
            ? (product.expiryTrackingEnabled
              ? (product.expiryBatchReconciled ? '; enabled expiry tracking with an empty stock ledger' : '; enabled expiry tracking; existing stock needs batch verification')
              : '; disabled expiry tracking; existing stock, batch records, and movements were preserved; retained batches require verification before expiry-based selection resumes')
            : ''}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || '',
      });
    }

    publishInventoryUpdated({ reason: 'product.updated', productCodes: [product.sku] });

    return res.json(product);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: 'SKU already exists.' });
    }
    return next(error);
  }
};

// Stock Operations intentionally has a narrower endpoint than the general
// product editor. Cashiers may record an audited stock movement, but cannot
// use that authority to change catalog, price, or archive fields.
const updateProductStock = async (req, res, next) => {
  const allowedFields = new Set([
    'stock',
    'expectedStock',
    'expectedUpdatedAt',
    'adjustmentRequestId',
    'inventoryAdjustmentReason',
    'adjustmentType',
    'adjustmentQuantity',
    'expiryBatch',
    'expiryVerification',
    'batchAllocations',
  ]);
  const disallowedField = Object.keys(req.body || {}).find((field) => !allowedFields.has(field));
  if (disallowedField) {
    return res.status(400).json({ message: 'Stock adjustments may only change the stock quantity.' });
  }
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'stock')) {
    return res.status(400).json({ message: 'stock is required for a stock adjustment.' });
  }
  const adjustmentType = normalizeString(req.body?.adjustmentType).toUpperCase();
  const adjustmentQuantity = parseStrictWholeNumber(req.body?.adjustmentQuantity, { min: 1 });
  const expectedStock = parseStrictWholeNumber(req.body?.expectedStock);
  const requestedStock = parseStrictWholeNumber(req.body?.stock);
  const adjustmentReason = normalizeString(req.body?.inventoryAdjustmentReason);
  if (!['IN', 'OUT'].includes(adjustmentType) || adjustmentQuantity === null || expectedStock === null || requestedStock === null) {
    return res.status(400).json({ message: 'Stock adjustments require a valid stock-in or stock-out quantity.' });
  }
  if (!adjustmentReason) {
    return res.status(400).json({ message: 'Stock adjustments require a reason.' });
  }
  const expectedTarget = adjustmentType === 'IN'
    ? expectedStock + adjustmentQuantity
    : expectedStock - adjustmentQuantity;
  if (!Number.isSafeInteger(expectedTarget) || expectedTarget < 0 || requestedStock !== expectedTarget) {
    return res.status(400).json({ message: 'Stock adjustment does not match the requested quantity.' });
  }
  if (adjustmentType === 'IN') {
    const settings = await Setting.findOne({ singletonKey: 'default' }).select('maxStockLimit').lean();
    const maxStockLimit = parseStrictWholeNumber(settings?.maxStockLimit, { min: 1 }) || 100;
    if (requestedStock > maxStockLimit) {
      return res.status(400).json({ message: `Stock cannot exceed the configured maximum of ${maxStockLimit}.` });
    }
  }

  const expiryBatch = req.body?.expiryBatch;
  const expiryVerification = req.body?.expiryVerification;
  if (expiryBatch !== undefined && adjustmentType !== 'IN') {
    return res.status(400).json({ message: 'Expiry batch details are only accepted for Stock-In.' });
  }
  if (expiryVerification !== undefined && (adjustmentType !== 'IN' || !expiryBatch || expiryBatch.enableTracking !== true)) {
    return res.status(400).json({ message: 'Existing-stock verification is only accepted when enabling Expiry Tracking during Stock-In.' });
  }
  if (req.body?.batchAllocations !== undefined && adjustmentType !== 'OUT') {
    return res.status(400).json({ message: 'Batch allocations are only accepted for Stock-Out.' });
  }
  if (adjustmentType === 'IN') {
    const currentProduct = await Product.findById(req.params.id).select('expiryTrackingEnabled updatedAt');
    if (!currentProduct) return res.status(404).json({ message: 'Product not found.' });
    const isEnablingTracking = expiryBatch && Object.prototype.hasOwnProperty.call(expiryBatch, 'enableTracking');
    if (isEnablingTracking && expiryBatch.enableTracking !== true) {
      return res.status(400).json({ message: 'Expiry Tracking can only be enabled with a valid checkbox value.' });
    }
    if (isEnablingTracking && !['admin', 'superadmin'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Only an administrator can enable Expiry Tracking.' });
    }
    if (expiryVerification !== undefined) {
      if (!isEnablingTracking || !expiryBatch || typeof expiryBatch !== 'object' || Array.isArray(expiryBatch)) {
        return res.status(400).json({ message: 'Existing-stock verification is only accepted when enabling Expiry Tracking during Stock-In.' });
      }
      const extraExpiryFields = Object.keys(expiryBatch).find((field) => !['expiryDate', 'lotNumber', 'enableTracking'].includes(field));
      if (extraExpiryFields) return res.status(400).json({ message: 'Expiry batch details contain unsupported fields.' });
      if (!expiryVerification || typeof expiryVerification !== 'object' || Array.isArray(expiryVerification)) {
        return res.status(400).json({ message: 'Existing-stock verification details are invalid.' });
      }
      try {
        const received = await receiveExpiryBatch({
          productId: req.params.id,
          quantity: adjustmentQuantity,
          expectedStock,
          expectedUpdatedAt: req.body?.expectedUpdatedAt,
          requestId: String(req.body?.adjustmentRequestId || '').trim(),
          expiryDate: expiryBatch.expiryDate,
          lotNumber: expiryBatch.lotNumber,
          verification: expiryVerification,
          reason: adjustmentReason,
          enableTracking: true,
          user: req.user,
          ipAddress: req.ip,
          userAgent: req.get('user-agent') || '',
        });
        const responseProduct = received.product.toObject();
        const batchAvailability = await getExpiryBatchAvailability(received.product);
        responseProduct.availableToSell = batchAvailability.availableToSell ?? 0;
        return res.json(withoutPurchaseCost(responseProduct, req.user));
      } catch (error) {
        if (error?.status) return res.status(error.status).json({ message: error.message });
        return next(error);
      }
    }
    if (currentProduct.expiryTrackingEnabled) {
      if (!expiryBatch || typeof expiryBatch !== 'object' || Array.isArray(expiryBatch)) {
        if (req.body?.expectedUpdatedAt && currentProduct.updatedAt?.getTime() !== new Date(req.body.expectedUpdatedAt).getTime()) {
          return res.status(409).json({ message: 'Expiry Tracking changed. Refresh the product and retry Stock-In.' });
        }
        return res.status(400).json({ message: 'Expiry date is required for Stock-In on an expiry-tracked product.' });
      }
      if (isEnablingTracking) {
        return res.status(409).json({ message: 'Expiry Tracking changed. Refresh the product and retry Stock-In.' });
      }
      const extraExpiryFields = Object.keys(expiryBatch).find((field) => !['expiryDate', 'lotNumber'].includes(field));
      if (extraExpiryFields) return res.status(400).json({ message: 'Expiry batch details contain unsupported fields.' });
      try {
        const received = await receiveExpiryBatch({
          productId: req.params.id,
          quantity: adjustmentQuantity,
          expectedStock,
          expectedUpdatedAt: req.body?.expectedUpdatedAt,
          requestId: String(req.body?.adjustmentRequestId || '').trim(),
          expiryDate: expiryBatch.expiryDate,
          lotNumber: expiryBatch.lotNumber,
          reason: adjustmentReason,
          enableTracking: false,
          user: req.user,
          ipAddress: req.ip,
          userAgent: req.get('user-agent') || '',
        });
        const responseProduct = received.product.toObject();
        const batchAvailability = await getExpiryBatchAvailability(received.product);
        responseProduct.availableToSell = batchAvailability.availableToSell ?? 0;
        return res.json(withoutPurchaseCost(responseProduct, req.user));
      } catch (error) {
        if (error?.status) return res.status(error.status).json({ message: error.message });
        return next(error);
      }
    }
      if (expiryBatch !== undefined) {
        if (!isEnablingTracking) return res.status(400).json({ message: 'Expiry batch details are only accepted for expiry-tracked products.' });
        const extraExpiryFields = Object.keys(expiryBatch).find((field) => !['expiryDate', 'lotNumber', 'enableTracking'].includes(field));
        if (extraExpiryFields) return res.status(400).json({ message: 'Expiry batch details contain unsupported fields.' });
        if (expiryVerification !== undefined && (!expiryVerification || typeof expiryVerification !== 'object' || Array.isArray(expiryVerification))) {
          return res.status(400).json({ message: 'Existing-stock verification details are invalid.' });
        }
        try {
          const received = await receiveExpiryBatch({
            productId: req.params.id,
            quantity: adjustmentQuantity,
            expectedStock,
            expectedUpdatedAt: req.body?.expectedUpdatedAt,
            requestId: String(req.body?.adjustmentRequestId || '').trim(),
            expiryDate: expiryBatch.expiryDate,
            lotNumber: expiryBatch.lotNumber,
            verification: expiryVerification,
            reason: adjustmentReason,
            enableTracking: true,
            user: req.user,
            ipAddress: req.ip,
            userAgent: req.get('user-agent') || '',
          });
          const responseProduct = received.product.toObject();
          const batchAvailability = await getExpiryBatchAvailability(received.product);
          responseProduct.availableToSell = batchAvailability.availableToSell ?? 0;
          return res.json(withoutPurchaseCost(responseProduct, req.user));
        } catch (error) {
          if (error?.status) return res.status(error.status).json({ message: error.message });
          return next(error);
        }
      }
  }
  if (adjustmentType === 'OUT') {
    const currentProduct = await Product.findById(req.params.id).select('expiryTrackingEnabled expiryBatchReconciled expiryTrackingPeriodId stock lastStockAdjustmentRequestId');
    if (!currentProduct) return res.status(404).json({ message: 'Product not found.' });
    if (currentProduct.expiryTrackingEnabled && !currentProduct.expiryBatchReconciled) {
      return res.status(409).json({ message: 'Batch verification is needed before this Stock-Out. Verify batches in Inventory first.' });
    }
    if (currentProduct.expiryTrackingEnabled) {
      const requestedBatchAllocations = normalizeSelectedStockOutAllocations(req.body?.batchAllocations);
      if (!requestedBatchAllocations) {
        return res.status(400).json({ message: 'Select one or more verified batches to remove stock.' });
      }
      if (requestedBatchAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== adjustmentQuantity) {
        return res.status(400).json({ message: 'Selected batch quantities must equal the removal quantity.' });
      }
      try {
        let updatedProduct;
        await withAuditedTransaction(async ({
          session,
          writeActivityLog: writeRequiredActivityLog,
          writeInventoryLog: writeRequiredInventoryLog,
        }) => {
          const before = await Product.findOne({ _id: req.params.id, isActive: { $ne: false } }).session(session);
          if (!before) throw Object.assign(new Error('Product is no longer available.'), { status: 409 });
          if (!before.expiryTrackingEnabled || !before.expiryBatchReconciled || !before.expiryTrackingPeriodId) {
            throw Object.assign(new Error('Expiry tracking or batch verification changed. Refresh the product before removing stock.'), { status: 409 });
          }
          const requestId = String(req.body?.adjustmentRequestId || '').trim();
          if (!requestId || requestId.length > 160) throw Object.assign(new Error('A valid stock adjustment request ID is required. Refresh and retry.'), { status: 400 });
          const priorMovements = await ExpiryBatchMovement.find({ requestId, type: 'STOCK_OUT' }).session(session).lean();
          if (priorMovements.length) {
            const allocationSignature = (items) => items.map((item) => [String(item.batch), String(item.batchId || ''), String(item.expiryDate || ''), Number(item.quantity)]
              .join(':')).sort().join('|');
            const sameRequest = priorMovements.every((movement) => String(movement.product) === String(before._id)
              && movement.reason === adjustmentReason)
              && priorMovements.reduce((sum, movement) => sum + Number(movement.quantity || 0), 0) === adjustmentQuantity
              && allocationSignature(priorMovements) === allocationSignature(requestedBatchAllocations);
            if (!sameRequest) throw Object.assign(new Error('This stock adjustment request ID was already used for different details.'), { status: 409 });
            updatedProduct = before;
            return;
          }
          if (before.lastStockAdjustmentRequestId === requestId) {
            throw Object.assign(new Error('This adjustment request has already been applied, but its batch history could not be confirmed. Refresh and ask an administrator to review it.'), { status: 409 });
          }
          if (before.stock !== expectedStock || (req.body?.expectedUpdatedAt && before.updatedAt?.getTime() !== new Date(req.body.expectedUpdatedAt).getTime())) {
            throw Object.assign(new Error('Stock changed. Refresh and retry this adjustment.'), { status: 409 });
          }
          const state = await inspectBatchState(before, session);
          if (!state.valid) throw Object.assign(new Error('Batch verification is needed before this Stock-Out. Verify batches in Inventory first.'), { status: 409 });
          const activeAvailable = Math.max(0, before.stock - Number(before.reservedStock || 0));
          if (adjustmentQuantity > activeAvailable) {
            throw Object.assign(new Error(`Only ${activeAvailable} unreserved ${before.sellingUnit || 'unit'} can be removed. Release Special Order reservations first.`), { status: 409 });
          }
          const after = await Product.findOneAndUpdate({
            _id: before._id, stock: expectedStock,
            ...(req.body?.expectedUpdatedAt ? { updatedAt: new Date(req.body.expectedUpdatedAt) } : {}),
            lastStockAdjustmentRequestId: { $ne: requestId },
            $expr: { $gte: [{ $subtract: ['$stock', { $ifNull: ['$reservedStock', 0] }] }, adjustmentQuantity] },
          }, { $inc: { stock: -adjustmentQuantity }, $set: { lastStockAdjustmentRequestId: requestId } }, { session, returnDocument: 'before' });
          if (!after) throw Object.assign(new Error('Stock changed or is reserved. Refresh and retry this adjustment.'), { status: 409 });
          const allocation = await allocateSelectedUnreservedBatches({
            product: before, quantity: adjustmentQuantity, allocations: requestedBatchAllocations,
            session, type: 'STOCK_OUT', sourceType: 'StockOut', sourceId: before._id, requestId,
            operationKeyPrefix: `stock-out:${requestId}:${before._id}`, actor: req.user, reason: adjustmentReason,
          });
          updatedProduct = await Product.findById(before._id).session(session);
          const batchMovementRefs = allocation?.movements.map((movement) => movement._id) || [];
          await writeRequiredInventoryLog({
            action: 'DEDUCT', code: before.sku, productRef: before._id, user: req.user,
            details: buildInventoryLogDetails({ productName: before.name, stockDelta: -adjustmentQuantity, adjustmentReason, sellingUnit: before.sellingUnit }),
            quantity: adjustmentQuantity, stockBefore: before.stock, stockAfter: updatedProduct.stock,
            batchMovementRefs,
          });
          await writeRequiredActivityLog({
            user: req.user, action: 'Removed Stock',
            details: `Removed ${adjustmentQuantity} ${before.sellingUnit || 'unit'} from ${before.name} (${before.sku}) by Stock-Out; reason: ${adjustmentReason}.`,
            ipAddress: req.ip, userAgent: req.get('user-agent') || '',
          });
        });
        publishInventoryUpdated({ reason: 'product.stock-out', productCodes: updatedProduct ? [updatedProduct.sku] : [] });
        const responseProduct = updatedProduct.toObject();
        const batchAvailability = await getExpiryBatchAvailability(updatedProduct);
        responseProduct.availableToSell = batchAvailability.availableToSell ?? 0;
        return res.json(withoutPurchaseCost(responseProduct, req.user));
      } catch (error) {
        if (error?.status) return res.status(error.status).json({ message: error.message });
        return next(error);
      }
    }
    if (req.body?.batchAllocations !== undefined) {
      return res.status(400).json({ message: 'Batch selection is only used for expiry-tracked products.' });
    }
  }
  req._trustedStockAdjustment = true;
  return updateProduct(req, res, next);
};

const listExpiryBatches = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid Product ID.' });
    const product = await Product.findById(req.params.id).select('sku stock reservedStock sellingUnit updatedAt expiryTrackingEnabled expiryBatchReconciled expiryBatchReconciledAt expiryTrackingPeriodId expiryUnassignedStock isActive').lean();
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    if (!product.expiryTrackingEnabled && req.query?.activationPreview === 'true') {
      if (!['admin', 'superadmin'].includes(req.user?.role)) {
        return res.status(403).json({ message: 'Only an administrator can review expiry tracking activation.' });
      }
      if (product.isActive === false) return res.status(409).json({ message: 'Archived products cannot start expiry tracking.' });
      const stock = Number(product.stock || 0);
      const reserved = Number(product.reservedStock || 0);
      return res.json({
        activationPreview: true,
        provisional: true,
        reconciled: false,
        sku: product.sku,
        productStock: stock,
        productUpdatedAt: product.updatedAt,
        productReserved: reserved,
        existingStockToVerify: stock,
        newStockRecorded: 0,
        receiptLedgerValid: true,
        stockPartitionValid: true,
        historicalBatchCount: await ExpiryBatch.countDocuments({ product: product._id }),
        batchRemainingTotal: 0,
        batchReservedTotal: 0,
        availableToSell: 0,
        reconciledAt: null,
        provisionalDifferenceFromProductStock: stock,
        batches: [],
      });
    }
    if (!product.expiryTrackingEnabled) return res.status(409).json({ message: 'Expiry tracking is not enabled for this product.' });
    const batches = await ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).lean();
    const receiptRows = batches.length
      ? await ExpiryBatchReceipt.find({ product: product._id, batch: { $in: batches.map((batch) => batch._id) } }).select('batch quantity').lean()
      : [];
    const receiptTotalsByBatch = new Map();
    for (const receipt of receiptRows) {
      const batchId = String(receipt.batch);
      receiptTotalsByBatch.set(batchId, (receiptTotalsByBatch.get(batchId) || 0) + Number(receipt.quantity || 0));
    }
    const receiptLedgerValid = batches.every((batch) => Number.isSafeInteger(batch.quantityReceived)
      && batch.quantityReceived >= 0
      && batch.quantityReceived === (receiptTotalsByBatch.get(String(batch._id)) || 0));
    const newStockRecorded = receiptRows.reduce((sum, receipt) => sum + Number(receipt.quantity || 0), 0);
    const historicalBatchCount = await ExpiryBatch.countDocuments({ product: product._id, _id: { $nin: batches.map((batch) => batch._id) } });
    const batchRemainingTotal = batches.reduce((sum, batch) => sum + Number(batch.remainingQuantity || 0), 0);
    const batchReservedTotal = batches.reduce((sum, batch) => sum + Number(batch.reservedQuantity || 0), 0);
    const existingStockToVerify = product.expiryTrackingPeriodId
      ? Number(product.expiryUnassignedStock || 0)
      : Number(product.stock || 0);
    const availability = await getExpiryBatchAvailability(product);
    const batchStateValid = Boolean(product.expiryTrackingPeriodId) && product.expiryBatchReconciled && availability.valid
      && batchRemainingTotal === Number(product.stock || 0)
      && batchReservedTotal === Number(product.reservedStock || 0)
      && Number.isSafeInteger(Number(product.stock || 0))
      && Number.isSafeInteger(Number(product.reservedStock || 0))
      && batches.every((batch) => Number.isSafeInteger(batch.remainingQuantity)
        && batch.remainingQuantity >= 0
        && Number.isSafeInteger(batch.reservedQuantity)
        && batch.reservedQuantity >= 0
        && batch.reservedQuantity <= batch.remainingQuantity);
    const requestedQuantity = parseStrictWholeNumber(req.query?.quantity, { min: 1 });
    const today = getManilaBusinessDate();
    const proposed = batchStateValid && requestedQuantity
      ? selectAllocations(batches, requestedQuantity, { allowExpired: false })
      : null;
    return res.json({
      provisional: !batchStateValid,
      reconciled: Boolean(batchStateValid),
      sku: product.sku,
      productStock: Number(product.stock || 0),
      productUpdatedAt: product.updatedAt,
      productReserved: Number(product.reservedStock || 0),
      existingStockToVerify,
      newStockRecorded,
      receiptLedgerValid,
      stockPartitionValid: batchRemainingTotal + existingStockToVerify === Number(product.stock || 0),
      historicalBatchCount,
      batchRemainingTotal,
      batchReservedTotal,
      availableToSell: batchStateValid && availability.valid ? availability.availableToSell : 0,
      reconciledAt: product.expiryBatchReconciledAt || null,
      provisionalDifferenceFromProductStock: Number(product.stock || 0) - batchRemainingTotal,
      ...(requestedQuantity ? {
        proposedAllocations: proposed?.map(({ batch, quantity }) => ({
          batch: batch._id,
          batchId: batch.batchId,
          batchReference: batch.batchReference || '',
          lotNumber: batch.lotNumber || '',
          expiryDate: batch.expiryDate,
          quantity,
        })) || null,
        batchOptions: batchStateValid ? batches.map((batch) => ({
          batch: batch._id,
          batchId: batch.batchId,
          batchReference: batch.batchReference || '',
          lotNumber: batch.lotNumber || '',
          expiryDate: batch.expiryDate,
          availableQuantity: batch.expiryDate > today
            ? Math.max(0, batch.remainingQuantity - Number(batch.reservedQuantity || 0))
            : 0,
        })) : [],
      } : {}),
      batches: batches.map((batch) => ({
        _id: batch._id,
        batchId: batch.batchId,
        batchReference: batch.batchReference || '',
        lotNumber: batch.lotNumber || '',
        expiryDate: batch.expiryDate,
        quantityReceived: batch.quantityReceived,
        remainingQuantity: batch.remainingQuantity,
        reservedQuantity: Number(batch.reservedQuantity || 0),
        receivedAt: batch.receivedAt,
        updatedAt: batch.updatedAt,
        trackingPeriodId: batch.trackingPeriodId || null,
      })),
    });
  } catch (error) {
    return next(error);
  }
};

const correctExpiryBatchDate = async (req, res, next) => {
  try {
    const result = await correctExpiryBatchDateService({
      productId: req.params.id,
      batchId: req.params.batchId,
      newExpiryDate: req.body?.newExpiryDate,
      reason: req.body?.reason,
      requestId: req.body?.requestId,
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
    }, req.user);
    const correction = result.correction;
    return res.json({
      replayed: result.replayed,
      batch: {
        _id: String(result.batch._id),
        batchId: result.batch.batchId,
        batchReference: result.batch.batchReference || '',
        expiryDate: result.batch.expiryDate,
        remainingQuantity: result.batch.remainingQuantity,
        reservedQuantity: Number(result.batch.reservedQuantity || 0),
        updatedAt: result.batch.updatedAt,
      },
      correction: {
        previousExpiryDate: correction.previousExpiryDate,
        newExpiryDate: correction.newExpiryDate,
        reason: correction.reason,
        actorName: correction.actorName,
        correctedAt: correction.createdAt,
      },
    });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

const listExpiryBatchMonitoring = async (req, res, next) => {
  try {
    const asOfDate = getManilaBusinessDate();
    const trackedProducts = await Product.find({ expiryTrackingEnabled: true })
      .select('name sku sellingUnit stock reservedStock expiryTrackingEnabled expiryBatchReconciled expiryTrackingPeriodId expiryUnassignedStock')
      .sort({ name: 1, sku: 1 }).lean();
    // Closed-period records stay browseable as history even when tracking is
    // currently off. Keep their recorded balances visibly historical only.
    const batches = await ExpiryBatch.find({})
      .sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).lean();
    const batchProductIds = [...new Set(batches.map((batch) => String(batch.product)))];
    const trackedIds = new Set(trackedProducts.map((product) => String(product._id)));
    const historicalProducts = batchProductIds.length
      ? await Product.find({ _id: { $in: batchProductIds.filter((id) => !trackedIds.has(id)) } })
        .select('name sku sellingUnit stock reservedStock expiryTrackingEnabled expiryBatchReconciled expiryTrackingPeriodId expiryUnassignedStock')
        .lean()
      : [];
    const products = [...trackedProducts, ...historicalProducts];
    const productById = new Map(products.map((product) => [String(product._id), product]));
    const isCurrentPeriodBatch = (batch) => {
      const product = productById.get(String(batch.product));
      if (!product?.expiryTrackingEnabled || batch.trackingPeriodClosedAt) return false;
      return Boolean(product.expiryTrackingPeriodId)
        && String(batch.trackingPeriodId || '') === String(product.expiryTrackingPeriodId);
    };
    const currentBatches = batches.filter(isCurrentPeriodBatch);
    const productsWithBatches = new Set(currentBatches.map((batch) => String(batch.product)));
    const totalsByProduct = new Map();
    const validNumbersByProduct = new Map(trackedProducts.map((product) => [String(product._id), true]));
    for (const batch of currentBatches) {
      const key = String(batch.product);
      const totals = totalsByProduct.get(key) || { remaining: 0, reserved: 0 };
      totals.remaining += Number(batch.remainingQuantity || 0);
      totals.reserved += Number(batch.reservedQuantity || 0);
      totalsByProduct.set(key, totals);
      const valid = Number.isSafeInteger(batch.remainingQuantity) && batch.remainingQuantity >= 0
        && Number.isSafeInteger(batch.reservedQuantity) && batch.reservedQuantity >= 0
        && batch.reservedQuantity <= batch.remainingQuantity;
      if (!valid) validNumbersByProduct.set(key, false);
    }
    const balanceConfirmedByProduct = new Map(trackedProducts.map((product) => {
      const key = String(product._id);
      const totals = totalsByProduct.get(key) || { remaining: 0, reserved: 0 };
      const confirmed = product.expiryBatchReconciled === true
        && validNumbersByProduct.get(key) === true
        && Number.isSafeInteger(product.stock) && Number.isSafeInteger(Number(product.reservedStock || 0))
        && totals.remaining === product.stock
        && totals.reserved === Number(product.reservedStock || 0);
      return [key, confirmed];
    }));

    const monitoringRows = batches.map((batch) => {
      const product = productById.get(String(batch.product));
      if (!product) return null;
      const isCurrentPeriod = isCurrentPeriodBatch(batch);
      const balanceConfirmed = isCurrentPeriod && balanceConfirmedByProduct.get(String(batch.product)) === true;
      const classification = classifyExpiryBatch({
        expiryDate: batch.expiryDate,
        remainingQuantity: batch.remainingQuantity,
        balanceConfirmed,
        asOfDate,
      });
      return {
        id: String(batch._id),
        productId: String(product._id),
        productName: product.name,
        sku: product.sku,
        productStock: Number(product.stock || 0),
        isHistoricalPeriod: !isCurrentPeriod,
        batchId: batch.batchId,
        batchReference: batch.batchReference || '',
        lotNumber: batch.lotNumber || '',
        expiryDate: batch.expiryDate,
        updatedAt: batch.updatedAt,
        quantityReceived: batch.quantityReceived,
        remainingQuantity: balanceConfirmed ? batch.remainingQuantity : null,
        historicalRemainingQuantity: !isCurrentPeriod ? Number(batch.remainingQuantity || 0) : null,
        hasRemainingStock: Number(batch.remainingQuantity || 0) > 0,
        reservedQuantity: balanceConfirmed ? Number(batch.reservedQuantity || 0) : null,
        sellingUnit: product.sellingUnit || '',
        balanceConfirmed,
        ...(isCurrentPeriod ? classification : { status: 'Historical', daysUntilExpiry: classification.daysUntilExpiry }),
      };
    }).filter(Boolean);

    const confirmedRows = monitoringRows.filter((row) => row.balanceConfirmed && !row.isHistoricalPeriod);
    const expiringSoonBatches = confirmedRows.filter((row) => row.status === 'Expiring Soon').length;
    const expiredRows = confirmedRows.filter((row) => row.status === 'Expired');
    const productsWithExpiredStock = new Set(expiredRows
      .filter((row) => row.remainingQuantity > 0)
      .map((row) => row.productId)).size;
    const expiredRemainingByUnitMap = new Map();
    for (const row of expiredRows) {
      const unit = row.sellingUnit || 'unit';
      expiredRemainingByUnitMap.set(unit, (expiredRemainingByUnitMap.get(unit) || 0) + row.remainingQuantity);
    }
    return res.json({
      asOfDate,
      batches: monitoringRows,
      unassignedProducts: trackedProducts.filter((product) => (
        Number(product.expiryUnassignedStock || 0) > 0
        || (!product.expiryTrackingPeriodId && Number(product.stock || 0) > 0)
        || (!productsWithBatches.has(String(product._id))
          && !balanceConfirmedByProduct.get(String(product._id))
          && Number(product.stock || 0) > 0)
      ))
        .map((product) => ({
          productId: String(product._id), productName: product.name, sku: product.sku,
          productStock: Number(product.stock || 0),
          existingStockToVerify: product.expiryTrackingPeriodId
            ? Number(product.expiryUnassignedStock || 0)
            : Number(product.stock || 0),
          sellingUnit: product.sellingUnit || '',
        })),
      summary: {
        expiringSoonBatches,
        expiredBatches: expiredRows.length,
        productsWithExpiredStock,
        expiredRemainingByUnit: [...expiredRemainingByUnitMap.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([unit, quantity]) => ({ unit, quantity })),
      },
    });
  } catch (error) {
    return next(error);
  }
};

const reconcileProductExpiryBatches = async (req, res, next) => {
  try {
    const rawBatches = req.body?.batches;
    const expectedStock = parseStrictWholeNumber(req.body?.expectedStock);
    const result = await reconcileExpiryBatches({
      productId: req.params.id,
      expectedStock,
      expectedUnassignedStock: parseStrictWholeNumber(req.body?.expectedUnassignedStock),
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
      recordedBatchVersions: req.body?.recordedBatchVersions,
      requestId: String(req.body?.requestId || '').trim(),
      batches: rawBatches,
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    if (!result.replayed) publishInventoryUpdated({ reason: 'product.expiry-batches.reconciled', productCodes: [result.product.sku] });
    const product = await Product.findById(result.product._id).select('sku stock reservedStock sellingUnit updatedAt expiryTrackingEnabled expiryBatchReconciled expiryBatchReconciledAt expiryTrackingPeriodId expiryUnassignedStock').lean();
    const batches = await ExpiryBatch.find(activeBatchFilter(product)).sort({ expiryDate: 1, receivedAt: 1, _id: 1 }).lean();
    const batchRemainingTotal = batches.reduce((sum, batch) => sum + Number(batch.remainingQuantity || 0), 0);
    const batchReservedTotal = batches.reduce((sum, batch) => sum + Number(batch.reservedQuantity || 0), 0);
    const availability = await getExpiryBatchAvailability(product);
    return res.json({
      replayed: Boolean(result.replayed),
      reconciled: Boolean(product.expiryBatchReconciled && availability.valid
        && batchRemainingTotal === Number(product.stock || 0)
        && batchReservedTotal === Number(product.reservedStock || 0)),
      provisional: !(product.expiryBatchReconciled && availability.valid
        && batchRemainingTotal === Number(product.stock || 0)
        && batchReservedTotal === Number(product.reservedStock || 0)),
      sku: product.sku,
      productStock: Number(product.stock || 0),
      productUpdatedAt: product.updatedAt,
      productReserved: Number(product.reservedStock || 0),
      batchRemainingTotal,
      batchReservedTotal,
      availableToSell: availability.valid ? availability.availableToSell : 0,
      reconciledAt: product.expiryBatchReconciledAt || null,
      provisionalDifferenceFromProductStock: Number(product.stock || 0) - batchRemainingTotal,
      existingStockToVerify: Number(product.expiryUnassignedStock || 0),
      newStockRecorded: batches.reduce((sum, batch) => sum + Number(batch.quantityReceived || 0), 0),
      receiptLedgerValid: true,
      stockPartitionValid: batchRemainingTotal + Number(product.expiryUnassignedStock || 0) === Number(product.stock || 0),
      historicalBatchCount: await ExpiryBatch.countDocuments({ product: product._id, _id: { $nin: batches.map((batch) => batch._id) } }),
      batches: batches.map((batch) => ({
        _id: batch._id, batchId: batch.batchId, batchReference: batch.batchReference || '', lotNumber: batch.lotNumber || '',
        expiryDate: batch.expiryDate, quantityReceived: batch.quantityReceived,
        remainingQuantity: batch.remainingQuantity, reservedQuantity: Number(batch.reservedQuantity || 0),
        receivedAt: batch.receivedAt, updatedAt: batch.updatedAt,
      })),
    });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

const verifyExpiryBatchesAndAddStock = async (req, res, next) => {
  const allowedFields = new Set([
    'expectedStock', 'expectedUnassignedStock', 'expectedUpdatedAt', 'recordedBatchVersions',
    'requestId', 'enableTracking', 'batches', 'deliveryBatches', 'reason',
  ]);
  const disallowedField = Object.keys(req.body || {}).find((field) => !allowedFields.has(field));
  if (disallowedField) return res.status(400).json({ message: 'Verification requests contain unsupported fields.' });
  const expectedStock = parseStrictWholeNumber(req.body?.expectedStock, { min: 1 });
  const expectedUnassignedStock = parseStrictWholeNumber(req.body?.expectedUnassignedStock, { min: 1 });
  if (expectedStock === null || expectedUnassignedStock === null) {
    return res.status(400).json({ message: 'Existing stock quantities must be positive whole numbers.' });
  }
  if (typeof req.body?.enableTracking !== 'boolean') {
    return res.status(400).json({ message: 'Expiry tracking state must be confirmed.' });
  }
  if (!Array.isArray(req.body?.batches) || !Array.isArray(req.body?.recordedBatchVersions)
    || !Array.isArray(req.body?.deliveryBatches)) {
    return res.status(400).json({ message: 'Batch verification details are incomplete.' });
  }
  try {
    const settings = await Setting.findOne({ singletonKey: 'default' }).select('maxStockLimit').lean();
    const maxStockLimit = parseStrictWholeNumber(settings?.maxStockLimit, { min: 1 }) || 100;
    const result = await verifyExpiryBatchesAndReceiveStock({
      productId: req.params.id,
      expectedStock,
      expectedUnassignedStock,
      expectedUpdatedAt: req.body?.expectedUpdatedAt,
      recordedBatchVersions: req.body.recordedBatchVersions,
      batches: req.body.batches,
      requestId: String(req.body?.requestId || '').trim(),
      enableTracking: req.body.enableTracking,
      deliveryBatches: req.body.deliveryBatches,
      reason: req.body?.reason,
      maxStockLimit,
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    const product = result.product.toObject();
    const availability = await getExpiryBatchAvailability(result.product);
    product.availableToSell = availability.valid ? availability.availableToSell : 0;
    return res.json({ product: withoutPurchaseCost(product, req.user), replayed: result.replayed, deliveryTotal: result.deliveryTotal });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    if (error?.code === 11000 || error?.codeName === 'DuplicateKey') {
      return res.status(409).json({ message: 'This verification request was already submitted. Refresh the batch details before retrying.' });
    }
    return next(error);
  }
};

module.exports = {
  addProductRecommendation,
  editProductRecommendationBasis,
  buildInventoryLogDetails,
  generateNextSku,
  getSkuPrefix,
  DUPLICATE_CONFIGURATION_MESSAGE,
  findConfigurationConflict,
  normalizeSku,
  validateSku,
  listProducts,
  listProductImages,
  createProduct,
  removeProductRecommendation,
  archiveSelectedVariants,
  updateProduct,
  updateProductStock,
  listExpiryBatches,
  correctExpiryBatchDate,
  listExpiryBatchMonitoring,
  reconcileProductExpiryBatches,
  verifyExpiryBatchesAndAddStock,
};
