const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const CreditTransaction = require('../models/CreditTransaction');
const SpecialOrder = require('../models/SpecialOrder');
const SpecialOrderQuotation = require('../models/SpecialOrderQuotation');
const Partner = require('../models/Partner');
const Setting = require('../models/Setting');
const Product = require('../models/Product');
const Category = require('../models/Category');
const InventoryLog = require('../models/InventoryLog');
const SpecialOrderStockReservation = require('../models/SpecialOrderStockReservation');
const { getStockAvailability, applyStockOperation } = require('../services/specialOrderStockService');
const {
  consumeReservedExpiryBatches,
  replaceReservedBatchesWithVerified,
  normalizeBatchAllocations,
  batchAllocationSignature,
  validateBatchVerification,
  getExpiryBatchAvailability,
} = require('../services/expiryBatchAllocationService');
const StockOperation = require('../models/SpecialOrderStockOperation');
const SpecialOrderPaymentLedger = require('../models/SpecialOrderPaymentLedger');
const { persistProofOfPayment, removeStoredProof, getStoredProof } = require('./creditTransactionController');
const { createSpecialOrderQuotationDocument } = require('../services/specialOrderQuotationDocument');
const { getReferenceDate, ensureReferenceCounter, allocateSpecialOrderReference } = require('../services/specialOrderReference');
const { ensurePaymentReferenceCounter, allocatePaymentReference } = require('../services/specialOrderPaymentReference');
const { prepareSpecialOrderInvoice, assertSpecialOrderInvoiceAvailable } = require('../services/specialOrderInvoiceReference');
const { writeActivityLog } = require('../services/logService');
const { withPostCommitNotifications } = require('../services/postCommitNotifications');
const {
  publishSaleCreated,
  publishSpecialOrderUpdated,
  publishInventoryUpdated,
  publishInventoryLogged,
  publishCreditTransactionsUpdated,
} = require('../services/realtimeService');
const { parseStrictWholeNumber } = require('../utils/numericValidation');
const { isMoneyInputTooLarge, parseSafeMoney, parseSafeMoneyToCentavos } = require('../utils/moneyValidation');
const { mapSaleToTransactionContract, generateCreditTransactionId } = require('./saleController');
const { normalizeHumanReadable } = require('../../../shared/textNormalization.cjs');
const { isValidTransactionReferenceNumber, TRANSACTION_REFERENCE_MAX_LENGTH, TRANSACTION_REFERENCE_NUMERIC_MESSAGE } = require('../../../shared/transactionReference.cjs');
const { uploadDocument, removeDocument } = require('../services/transactionSupportingDocument');
const { randomUUID } = require('crypto');
const { uploadQuotationImage, removeQuotationImage, getQuotationImage, inspectImage, MAX_FILE_SIZE } = require('../services/specialOrderQuotationImage');
const { isObjectNotFoundError } = require('../services/r2StorageService');
const { normalizeLagunaDeliveryFields } = require('../utils/lagunaFulfillment');
const { productImageSources, createProductImageReference, parseProductDataImage } = require('../utils/specialOrderProductImages');
const { getProductDisplayName } = require('../utils/productDisplayName');
const { normalizeCreditPaymentMethod } = require('../utils/paymentMethodNormalization');
const { addManilaCalendarDays, startOfManilaCalendarDay } = require('../utils/manilaCalendar');
const { isValidExpiryDate } = require('../utils/productExpiry');
const { normalizeQuotationExpirySelections } = require('../utils/specialOrderExpirySelections');

const normalizeString = (value) => String(value || '').trim();

const createValidationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const normalizeFulfillment = (value) => {
  const method = normalizeString(value?.method);
  if (!['Store Pickup', 'Free Delivery'].includes(method)) throw createValidationError('Select Store Pickup or Free Delivery.');
  const preferredDate = normalizeString(value?.preferredDate);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? new Date(`${preferredDate}T00:00:00Z`) : null;
  if (preferredDate && (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== preferredDate)) {
    throw createValidationError('Enter a valid preferred fulfillment date.');
  }
  if (method === 'Store Pickup') return { method, preferredDate, addressLine: '', barangay: '', cityMunicipality: '', province: '' };
  return { method, preferredDate, ...normalizeLagunaDeliveryFields(value) };
};

const phaseOneCompletionError = () => Object.assign(new Error('Order completion is temporarily unavailable.'), { status: 409 });

const normalizePhaseOneTaxTreatment = (value) => {
  const treatment = normalizeString(value);
  if (!['standard', 'vat_zero_rated'].includes(treatment)) throw createValidationError('Select VAT-Rated or VAT Zero-Rated before generating the quotation.');
  return treatment;
};

const normalizePhaseOneItem = async (item, existing, user) => {
  const itemType = normalizeString(item?.itemType);
  if (!['inventory', 'custom'].includes(itemType)) throw createValidationError('Select Existing Product or Custom Product for each item.');
  if (itemType === 'custom') {
    if (item?.inventoryProduct || item?.productId) throw createValidationError('Custom items cannot reference an inventory product.');
    const sellingUnit = normalizeString(item?.sellingUnit);
    if (!sellingUnit && !(existing && !normalizeString(existing.sellingUnit))) throw createValidationError('Selling Unit is required for each quotation item.');
    const expiryDate = normalizeString(item?.expiryDate);
    if (expiryDate && !isValidExpiryDate(expiryDate)) throw createValidationError('Enter a valid custom-product expiry date.');
    if (Array.isArray(item?.quotationExpirySelections) && item.quotationExpirySelections.length) throw createValidationError('Custom products cannot reference inventory expiry batches.');
    return { ...item, sellingUnit, expiryDate, quotationExpirySelections: [], itemType, inventoryProduct: null, inventorySnapshot: null, originalUnitPrice: null, priceOverrideReason: '', priceOverrideBy: null };
  }
  const productId = normalizeString(item?.inventoryProduct || item?.productId);
  if (!mongoose.isValidObjectId(productId)) throw createValidationError('Select an exact inventory SKU.');
  const sameSavedProduct = existing?.itemType === 'inventory' && String(existing.inventoryProduct) === productId;
  let currentProduct = null;
  let snapshot;
  if (sameSavedProduct && existing.inventorySnapshot) {
    snapshot = existing.inventorySnapshot.toObject?.() || existing.inventorySnapshot;
  } else {
    currentProduct = await Product.findOne({ _id: productId, isActive: { $ne: false } }).lean();
    if (!currentProduct) throw createValidationError('The selected inventory SKU is unavailable. Select an active SKU again.');
    snapshot = {
      sku: normalizeString(currentProduct.sku), name: normalizeString(currentProduct.name),
      brand: normalizeString(currentProduct.brand), color: normalizeString(currentProduct.color), size: normalizeString(currentProduct.size),
      category: normalizeString(currentProduct.category), sellingUnit: normalizeString(currentProduct.sellingUnit),
      attributes: currentProduct.attributes instanceof Map ? Object.fromEntries(currentProduct.attributes) : { ...(currentProduct.attributes || {}) },
      originalUnitPrice: parseSafeMoney(currentProduct.price),
      expiryTrackingEnabled: currentProduct.expiryTrackingEnabled === true,
      expiryTrackingPeriodId: currentProduct.expiryTrackingPeriodId || '',
    };
  }
  if (!snapshot?.sku || snapshot.originalUnitPrice === null) throw createValidationError('The selected inventory SKU has invalid saved product details.');
  if (!normalizeString(snapshot.sellingUnit) && !(existing && !normalizeString(existing.sellingUnit))) throw createValidationError('The selected inventory product has no saved Selling Unit. Select a valid SKU or update its product details.');
  if (normalizeString(item?.sku) !== snapshot.sku) throw createValidationError('The selected inventory SKU changed. Select the exact SKU again.');
  const category = snapshot.category
    ? await Category.findOne({ name: snapshot.category }).lean()
    : null;
  const displayName = getProductDisplayName(snapshot, category || {});
  const quotedPrice = parseSafeMoney(item?.unitPrice ?? item?.sellingPrice);
  if (quotedPrice === null) throw createValidationError('Enter a valid quoted unit price.');
  const changed = parseSafeMoneyToCentavos(quotedPrice) !== parseSafeMoneyToCentavos(snapshot.originalUnitPrice);
  const preservingApprovedPrice = Boolean(sameSavedProduct && parseSafeMoneyToCentavos(existing.unitPrice ?? existing.sellingPrice) === parseSafeMoneyToCentavos(quotedPrice)
    && normalizeString(existing.priceOverrideReason) && existing.priceOverrideBy);
  const reason = changed ? (preservingApprovedPrice ? normalizeString(existing.priceOverrideReason) : normalizeString(item?.priceOverrideReason)) : '';
  if (changed && !preservingApprovedPrice && !['admin', 'superadmin'].includes(user?.role)) {
    throw Object.assign(new Error('Only Admin or Super Admin may adjust an inventory product unit price.'), { status: 403 });
  }
  if (changed && !preservingApprovedPrice && (typeof item?.priceOverrideReason !== 'string' || reason.length > 500)) {
    throw createValidationError('Price adjustment reason must be text of 500 characters or fewer.');
  }
  if (changed && !reason && !preservingApprovedPrice) throw createValidationError('Enter a reason for the inventory price adjustment.');
  const quantity = parseStrictWholeNumber(item?.quantity, { min: 1 });
  const requestedExpirySelections = item?.quotationExpirySelections ?? existing?.quotationExpirySelections ?? [];
  let expirySelections = [];
  if (Array.isArray(requestedExpirySelections) && requestedExpirySelections.length) {
    if (!currentProduct) currentProduct = await Product.findOne({ _id: productId, isActive: { $ne: false } }).lean();
    if (!currentProduct) throw createValidationError('The selected inventory SKU is unavailable. Select an active SKU again.');
    const availability = await getExpiryBatchAvailability(currentProduct);
    expirySelections = normalizeQuotationExpirySelections({
      product: currentProduct,
      selections: requestedExpirySelections,
      quantity,
      availability,
    });
  }
  if (normalizeString(item?.expiryDate)) throw createValidationError('Inventory product expiry dates must come from verified batch records.');
  return {
    ...item, itemType, itemName: displayName, sellingUnit: snapshot.sellingUnit,
    inventoryProduct: productId, inventorySnapshot: snapshot, originalUnitPrice: snapshot.originalUnitPrice,
    priceOverrideReason: reason,
    priceOverrideBy: changed ? (preservingApprovedPrice ? existing.priceOverrideBy : user?._id) : null,
    expiryDate: '',
    quotationExpirySelections: expirySelections,
  };
};

const parseExpectedArrivalDate = (value) => {
  const source = normalizeString(value);
  if (!source) return { error: 'Each special order item requires an expected date.' };

  const matchedDate = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) return { error: 'Each special order item requires a valid expected date.' };

  const [, year, month, day] = matchedDate;
  const expectedArrivalDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    expectedArrivalDate.getUTCFullYear() !== Number(year)
    || expectedArrivalDate.getUTCMonth() !== Number(month) - 1
    || expectedArrivalDate.getUTCDate() !== Number(day)
  ) return { error: 'Each special order item requires a valid expected date.' };

  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (expectedArrivalDate.getTime() < today) {
    return { error: 'Each special order item expected date cannot be earlier than today.' };
  }

  return { expectedArrivalDate };
};

const ensureCashierOwnsSpecialOrder = ({ order, user }) => {
  if (user?.role !== 'cashier') return;

  if (!order?.createdBy || String(order.createdBy) !== String(user._id)) {
    const error = new Error('You can only modify your own special orders.');
    error.status = 403;
    throw error;
  }
};

const publishSpecialOrderChange = (order) => {
  publishSpecialOrderUpdated({
    orderId: order?._id,
    orderNumber: order?.orderNumber,
    status: order?.status,
  });
};

const normalizeOrderItem = (item, quotationFirst = false) => {
  const itemName = item?.itemType === 'inventory' ? normalizeString(item?.itemName) : normalizeHumanReadable(item?.itemName);
  const sellingUnit = normalizeString(item?.sellingUnit);
  const quantity = parseStrictWholeNumber(item?.quantity, { min: 1 });
  const purchaseCostRaw = item?.purchaseCost;
  const sellingPriceRaw = item?.sellingPrice;
  const purchaseCost = quotationFirst && !hasValue(purchaseCostRaw) ? 0 : parseSafeMoney(purchaseCostRaw);
  const sellingPrice = parseSafeMoney(sellingPriceRaw);

  if (!itemName) {
    throw createValidationError('Each special order item requires an item name.');
  }
  if (quotationFirst && !sellingUnit) throw createValidationError(`Selling Unit is required for ${itemName}.`);
  const expiryDate = normalizeString(item?.expiryDate);
  if (expiryDate && !isValidExpiryDate(expiryDate)) throw createValidationError(`Expiry date for ${itemName} must be a valid calendar date.`);

  if (quantity === null) {
    throw createValidationError(`Quantity for ${itemName} must be a whole number greater than 0.`);
  }
  if (purchaseCost === null || (quotationFirst ? purchaseCost < 0 : !hasValue(purchaseCostRaw) || purchaseCost <= 0)) {
    throw createValidationError(isMoneyInputTooLarge(purchaseCostRaw) ? 'Amount is too large. Please enter a smaller value.' : `Purchase cost for ${itemName} is required and must be greater than 0.`);
  }
  if (!hasValue(sellingPriceRaw) || sellingPrice === null || (quotationFirst ? sellingPrice < 0 : sellingPrice <= 0)) {
    throw createValidationError(isMoneyInputTooLarge(sellingPriceRaw) ? 'Amount is too large. Please enter a smaller value.' : `Selling price for ${itemName} is required and must be greater than 0.`);
  }

  const { expectedArrivalDate, error: expectedArrivalDateError } = quotationFirst && !hasValue(item?.expectedArrivalDate)
    ? { expectedArrivalDate: null } : parseExpectedArrivalDate(item?.expectedArrivalDate);
  if (expectedArrivalDateError) throw createValidationError(expectedArrivalDateError);

  return {
    itemName,
    description: normalizeHumanReadable(item?.description),
    sellingUnit,
    expiryDate: item?.itemType === 'custom' ? expiryDate : '',
    quotationExpirySelections: Array.isArray(item?.quotationExpirySelections) ? item.quotationExpirySelections : [],
    itemType: item?.itemType === 'inventory' ? 'inventory' : 'custom',
    inventoryProduct: item?.inventoryProduct || null,
    inventorySnapshot: item?.inventorySnapshot || null,
    originalUnitPrice: item?.originalUnitPrice ?? null,
    priceOverrideReason: normalizeString(item?.priceOverrideReason),
    priceOverrideBy: item?.priceOverrideBy || null,
    quantity,
    supplier: normalizeString(item?.supplierId) || item?.supplier || null,
    supplierName: normalizeHumanReadable(item?.supplierName),
    purchaseCost,
    sellingPrice,
    expectedArrivalDate,
    remarks: normalizeString(item?.remarks),
  };
};

const normalizeOrderItems = (body, quotationFirst = false) => {
  if (Array.isArray(body?.items)) return body.items.map((item) => normalizeOrderItem(item, quotationFirst));

  const hasLegacyItem = ['itemName', 'description', 'quantity', 'supplierName', 'purchaseCost', 'sellingPrice', 'expectedArrivalDate', 'remarks']
    .some((field) => body?.[field] !== undefined);
  if (!hasLegacyItem) return [];

  const fallbackItem = normalizeOrderItem({
    itemName: body?.itemName,
    description: body?.description,
    quantity: body?.quantity,
    supplierName: body?.supplierName,
    purchaseCost: body?.purchaseCost,
    sellingPrice: body?.sellingPrice,
    expectedArrivalDate: body?.expectedArrivalDate,
    remarks: body?.remarks,
  });

  return [fallbackItem];
};

const getSpecialOrderClientRequestId = (order) => `special-order:${String(order?._id || '')}`;

const isDuplicateClientRequestIdError = (error) => {
  return error?.code === 11000 && Boolean(error?.keyPattern?.clientRequestId);
};

const enrichOrder = (order) => {
  const raw = typeof order?.toObject === 'function' ? order.toObject() : order;
  if (!raw) return null;

  return {
    ...raw,
    statusHistory: Array.isArray(raw.statusHistory) ? raw.statusHistory : [],
  };
};

const buildQuery = (req) => {
  const query = {};
  const status = normalizeString(req.query?.status);
  const search = normalizeString(req.query?.search);

  if (status && status.toLowerCase() !== 'all') {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { itemName: { $regex: search, $options: 'i' } },
      { supplierName: { $regex: search, $options: 'i' } },
      { remarks: { $regex: search, $options: 'i' } },
      { 'items.itemName': { $regex: search, $options: 'i' } },
      { 'items.supplierName': { $regex: search, $options: 'i' } },
    ];
  }

  if (req.user?.role === 'cashier') {
    query.createdBy = req.user._id;
  }

  return query;
};

const quotationNumberFor = (order, version) => `${order.orderNumber}-Q${version}`;

const ensureOrderCanHaveQuotation = (order) => {
  if (order.status === 'Completed') throw Object.assign(new Error('Completed special orders cannot be quoted.'), { status: 400 });
  if (order.status === 'Cancelled') throw Object.assign(new Error('Cancelled special orders cannot be quoted.'), { status: 400 });
};

const quotationItemsFromOrder = (order) => {
  const items = Array.isArray(order.items) && order.items.length ? order.items : [order];
  return normalizeQuotationItems(items.map((item) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.sellingPrice || 0);
    return {
      itemName: item.itemType === 'inventory' ? normalizeString(item.itemName || order.itemName) : normalizeHumanReadable(item.itemName || order.itemName),
      description: normalizeHumanReadable(item.description || ''),
      sellingUnit: normalizeString(item.sellingUnit || item.unit || ''),
      expiryDate: item.itemType === 'custom' ? normalizeString(item.expiryDate) : '',
      quotationExpirySelections: item.quotationExpirySelections || [],
      itemType: item.itemType || 'custom',
      inventoryProduct: item.inventoryProduct || null,
      inventorySnapshot: item.inventorySnapshot || null,
      originalUnitPrice: item.originalUnitPrice ?? null,
      priceOverrideReason: item.priceOverrideReason || '',
      priceOverrideBy: item.priceOverrideBy || null,
      quantity,
      unitPrice,
      lineAmount: quantity * unitPrice,
    };
  }), [], { allowLegacyMissingSellingUnit: true });
};

const normalizeQuotationItems = (items, existingItems = [], { allowLegacyMissingSellingUnit = false } = {}) => {
  if (!Array.isArray(items) || items.length === 0) throw createValidationError('A quotation requires at least one item.');
  const existingById = new Map(existingItems.map((item) => [String(item.itemId || ''), item]));
  const normalized = items.map((item) => {
    const itemName = item?.itemType === 'inventory' ? normalizeString(item?.itemName || item?.name) : normalizeHumanReadable(item?.itemName || item?.name);
    const quantity = parseStrictWholeNumber(item?.quantity, { min: 1 });
    const unitPrice = parseSafeMoney(item?.unitPrice ?? item?.sellingPrice);
    if (!itemName) throw createValidationError('Each quotation item requires an item name.');
    if (quantity === null) throw createValidationError(`Quantity for ${itemName} must be a whole number greater than 0.`);
    if (unitPrice === null || unitPrice < 0) throw createValidationError(`Unit price for ${itemName} must be a valid amount.`);
    const unitCentavos = parseSafeMoneyToCentavos(item?.unitPrice ?? item?.sellingPrice);
    if (parseSafeMoneyToCentavos(unitPrice) !== unitCentavos) throw createValidationError('Quotation unit price is too large to preserve centavo precision.');
    const itemId = /^[a-f0-9-]{36}$/i.test(String(item?.itemId || '')) ? String(item.itemId) : randomUUID();
    const existingItem = existingById.get(itemId);
    const sellingUnit = normalizeString(item?.sellingUnit || item?.unit);
    if (!sellingUnit && !(allowLegacyMissingSellingUnit || (existingItem && !normalizeString(existingItem.sellingUnit)))) {
      throw createValidationError(`Selling Unit is required for ${itemName}.`);
    }
    const expiryDate = item?.itemType === 'custom' ? normalizeString(item?.expiryDate) : '';
    if (expiryDate && !isValidExpiryDate(expiryDate)) throw createValidationError(`Expiry date for ${itemName} must be a valid calendar date.`);
    const savedImages = Array.isArray(existingItem?.images) ? existingItem.images : [];
    const requestedKeys = Array.isArray(item?.imageKeys) ? item.imageKeys.map(String) : savedImages.map((image) => String(image.key));
    if (new Set(requestedKeys).size !== requestedKeys.length || requestedKeys.some((key) => !savedImages.some((image) => String(image.key) === key))) throw createValidationError(`Product photos for ${itemName} are invalid.`);
    const images = requestedKeys.map((key) => savedImages.find((image) => String(image.key) === key));
    if (images.length > 3) throw createValidationError(`Product ${itemName} can have at most 3 photos.`);
    return {
      itemId,
      itemName,
      description: normalizeHumanReadable(item?.description),
      sellingUnit,
      expiryDate,
      quotationExpirySelections: Array.isArray(item?.quotationExpirySelections) ? item.quotationExpirySelections : (existingItem?.quotationExpirySelections || []),
      itemType: item?.itemType === 'inventory' ? 'inventory' : 'custom',
      inventoryProduct: item?.itemType === 'inventory' ? item.inventoryProduct : null,
      inventorySnapshot: item?.itemType === 'inventory' ? item.inventorySnapshot : null,
      originalUnitPrice: item?.itemType === 'inventory' ? item.originalUnitPrice : null,
      priceOverrideReason: item?.itemType === 'inventory' ? normalizeString(item.priceOverrideReason) : '',
      priceOverrideBy: item?.itemType === 'inventory' ? item.priceOverrideBy : null,
      quantity,
      unitPrice,
      lineAmount: quotationMoney(Number(BigInt(unitCentavos) * BigInt(quantity))),
      images,
    };
  });
  if (new Set(normalized.map((item) => item.itemId)).size !== normalized.length) throw createValidationError('Quotation product IDs must be unique. Reload and retry.');
  return normalized;
};

const quotationTotals = (items) => {
  const total = quotationMoney(items.reduce((sum, item) => sum + parseSafeMoneyToCentavos(item.lineAmount), 0));
  return { subtotal: total, total };
};

const checkedMoney = (centavos) => {
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw createValidationError('Quotation amount is too large.');
  return centavos;
};

const quotationMoney = (centavos) => {
  const amount = checkedMoney(centavos) / 100;
  if (parseSafeMoneyToCentavos(amount) !== centavos) throw createValidationError('Quotation amount is too large to preserve centavo precision.');
  return amount;
};

const validateQuotationAmounts = (quotation) => {
  const items = normalizeQuotationItems(quotation.items, quotation.items);
  const totals = quotationTotals(items);
  const matches = (stored, expected) => Number.isFinite(Number(stored)) && Math.abs(Number(stored) - expected) < 0.000001;
  if (!items.every((item, index) => matches(quotation.items[index].lineAmount, item.lineAmount))
    || !matches(quotation.subtotal, totals.subtotal) || !matches(quotation.total, totals.total)) {
    throw Object.assign(new Error('Quotation amounts are inconsistent. Revise the quotation before proceeding.'), { status: 409 });
  }
  return { items, ...totals };
};

const getCurrentQuotation = async (order, session = null) => {
  let query = SpecialOrderQuotation.find({ specialOrder: order._id, isCurrent: true }).limit(2);
  if (session) query = query.session(session);
  const current = await query;
  if (current.length > 1 || (order.currentQuotation && (!current[0] || String(order.currentQuotation) !== String(current[0]._id)))) {
    throw Object.assign(new Error('Quotation history needs review: the current version is inconsistent.'), { status: 409 });
  }
  return current[0] || null;
};

const quotationResponse = (quotation) => (typeof quotation?.toObject === 'function' ? quotation.toObject() : quotation);

const buildSalePayload = (order, req, { referenceNumber = '', supportingDocument = null, quotation = null, fulfillmentStatus = null } = {}) => {
  const ledgerFunded = Number(order.workflowVersion) >= 2;
  const sourceItems = quotation?.items?.length
    ? normalizeQuotationItems(quotation.items)
    : Array.isArray(order.items) && order.items.length > 0
    ? order.items
    : [{ itemName: order.itemName, quantity: order.quantity, sellingPrice: order.sellingPrice }];

  const lineTotal = quotation
    ? quotationTotals(sourceItems).total
    : sourceItems.reduce((sum, item) => sum + (Number(item.unitPrice ?? item.sellingPrice ?? 0) * Number(item.quantity || 0)), 0);

  return {
    items: sourceItems.map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice ?? item.sellingPrice ?? 0);
      return {
        product: ledgerFunded && item.itemType === 'inventory' ? item.inventoryProduct : null,
        name: item.itemName || order.itemName,
        ...(quotation ? { description: item.description, sellingUnit: item.sellingUnit } : {}),
        code: ledgerFunded && item.itemType === 'inventory' ? item.inventorySnapshot?.sku : `${order.orderNumber}-${index + 1}`,
        quantity,
        unitPrice,
        subtotal: quotation ? item.lineAmount : unitPrice * quantity,
      };
    }),
    totalAmount: lineTotal,
    netAmount: ledgerFunded ? null : lineTotal,
    vatAmount: ledgerFunded ? null : 0,
    ...(ledgerFunded ? { vatCalculationStatus: 'not_calculated', taxTreatment: quotation?.customerDetails?.taxTreatment || order.taxTreatment } : {}),
    grossAmount: lineTotal,
    pricingMode: ledgerFunded ? 'agreed' : 'inclusive',
    vatMode: ledgerFunded && order.taxTreatment === 'vat_zero_rated' ? 'zero-rated' : 'vatable',
    customerIsVatExempt: false,
    hasVatApplicableItems: false,
    hasVatableItems: !ledgerFunded,
    hasZeroRatedItems: false,
    vatRatesUsed: [],
    paymentMethod: ledgerFunded ? 'other' : 'cash',
    ...(ledgerFunded ? { collectionSource: 'special_order_ledger' } : {}),
    saleType: 'special-order',
    ...(ledgerFunded ? { specialOrderFulfillmentStatus: fulfillmentStatus || 'Awaiting Items' } : {}),
    paymentStatus: 'Paid',
    customer: quotation ? quotation.customer || null : order.customer || null,
    customerName: quotation ? quotation.customerName : order.customerName,
    ...(quotation ? { customerDetails: quotation.customerDetails } : {}),
    cashier: req.user._id,
    cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown',
    notes: `Special Order ${order.orderNumber}. ${order.remarks || ''}`.trim(),
    isArchived: false,
    specialOrderId: order._id,
    specialOrderNumber: order.orderNumber,
    ...(quotation ? {
      specialOrderQuotationId: quotation._id,
      specialOrderQuotationVersion: quotation.version,
    } : {}),
    clientRequestId: getSpecialOrderClientRequestId(order),
    ...((referenceNumber || supportingDocument) ? { transactionReference: {
      referenceNumber,
      supportingDocument,
      savedAt: new Date(),
      savedBy: req.user?._id || null,
      correctedAt: null,
      correctionHistory: [],
    } } : {}),
  };
};

const buildSpecialOrderReceiptResult = (order, sale) => ({
  order: enrichOrder(order),
  sale,
  receiptTransaction: sale ? mapSaleToTransactionContract(sale) : null,
});

const findSpecialOrderSale = async (order, session = null) => {
  if (Number(order.workflowVersion) >= 2) {
    const query = Sale.find({ $or: [
      { clientRequestId: getSpecialOrderClientRequestId(order) },
      { specialOrderId: order._id },
    ] }).limit(2).populate('cashier', 'name displayName username role');
    const matches = await (session ? query.session(session) : query);
    if (matches.length > 1 || (matches[0] && (
      matches[0].clientRequestId !== getSpecialOrderClientRequestId(order)
      || String(matches[0].specialOrderId || '') !== String(order._id)
      || matches[0].collectionSource !== 'special_order_ledger'
    ))) throw Object.assign(new Error('Linked sale records need administrative review.'), { status: 409 });
    return matches[0] || null;
  }
  const selectors = [
    { clientRequestId: getSpecialOrderClientRequestId(order) },
    { specialOrderId: order._id },
  ];
  if (order.linkedSaleId) selectors.unshift({ _id: order.linkedSaleId });

  const query = Sale.findOne({ $or: selectors })
    .populate('cashier', 'name displayName username role');
  return session ? query.session(session) : query;
};

const markSpecialOrderCompleted = async ({ order, sale, req, session = null, statusNote, activityDetails }) => {
  order.status = 'Completed';
  order.completedAt = new Date();
  order.completedBy = req.user?._id || null;
  order.updatedBy = req.user?._id || null;
  order.linkedSaleId = sale._id;
  order.statusHistory.push({ status: 'Completed', changedBy: req.user?._id || null,
    note: statusNote || 'Financially settled and administratively closed under its recorded Sale; this status does not confirm physical delivery.' });
  await order.save(session ? { session } : undefined);

  await writeActivityLog({
    user: req.user,
    action: 'Completed Special Order',
    details: activityDetails || `Special Order ${order.orderNumber} administratively completed under Sale ${sale._id}; no physical delivery confirmation was recorded.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    ...(session ? { session } : {}),
  });

  return order;
};

// Sale recording never consumes stock. Administrative completion consumes
// exact-SKU stock holds in the same transaction that closes the order.
const consumePhaseFiveStock = async ({ order, quotation, sale, req, session, requestId, batchVerifications = new Map() }) => {
  const expected = new Map();
  const inventoryLogs = [];
  for (const item of quotation.items) {
    if (item.itemType !== 'inventory') continue;
    if (!item.inventoryProduct || !item.inventorySnapshot?.sku || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw Object.assign(new Error('An inventory item needs review before completion.'), { status: 409 });
    }
    const key = String(item.inventoryProduct);
    const group = expected.get(key) || { product: item.inventoryProduct, sku: item.inventorySnapshot.sku, quantity: 0 };
    if (group.sku !== item.inventorySnapshot.sku || !Number.isSafeInteger(group.quantity + item.quantity)) {
      throw Object.assign(new Error('Inventory item quantities need review before completion.'), { status: 409 });
    }
    group.quantity += item.quantity;
    expected.set(key, group);
  }
  const reservations = await SpecialOrderStockReservation.find({ specialOrder: order._id, status: 'Active' }).session(session);
  if (reservations.length !== expected.size) throw Object.assign(new Error('Reserved stock no longer matches this order.'), { status: 409 });
  const activeReservations = await SpecialOrderStockReservation.find({ product: { $in: [...expected.values()].map((group) => group.product) }, status: 'Active' }).session(session);
  const activeTotals = new Map();
  for (const active of activeReservations) {
    const key = String(active.product);
    if (!Number.isSafeInteger(active.reservedQuantity) || active.reservedQuantity < 1) {
      throw Object.assign(new Error('Reserved stock needs review before completion.'), { status: 409 });
    }
    const total = (activeTotals.get(key) || 0) + active.reservedQuantity;
    if (!Number.isSafeInteger(total)) throw Object.assign(new Error('Reserved stock needs review before completion.'), { status: 409 });
    activeTotals.set(key, total);
  }
  for (const reservation of reservations) {
    const group = expected.get(String(reservation.product));
    if (!group || reservation.sku !== group.sku || reservation.reservedQuantity !== group.quantity || reservation.orderedQuantity !== group.quantity) {
      throw Object.assign(new Error('Reserved stock no longer matches the approved items.'), { status: 409 });
    }
    const before = await Product.findOneAndUpdate({
      _id: reservation.product, sku: group.sku, isActive: { $ne: false },
      stock: { $gte: group.quantity }, reservedStock: activeTotals.get(String(reservation.product)),
      $expr: { $gte: ['$stock', { $ifNull: ['$reservedStock', 0] }] },
    }, { $inc: { stock: -group.quantity, reservedStock: -group.quantity } }, { session, returnDocument: 'before' });
    if (!before) throw Object.assign(new Error(`Reserved stock for ${group.sku} changed. Reload before completion.`), { status: 409 });
    if (before.expiryTrackingEnabled && !before.expiryBatchReconciled) {
      throw Object.assign(new Error(`Batch verification is needed for ${group.sku}. Verify batches in Inventory before completing this Special Order.`), { status: 409 });
    }
    let batchVerification = null;
    if (before.expiryTrackingEnabled) {
      const verification = batchVerifications.get(String(reservation.product));
      if (!verification) throw Object.assign(new Error(`Confirm the physical batch picks for ${group.sku} before completion.`), { status: 400 });
      batchVerification = await replaceReservedBatchesWithVerified({
        product: before,
        currentAllocations: reservation.batchAllocations,
        quantity: group.quantity,
        proposedAllocations: verification.proposed,
        verifiedAllocations: verification.verified,
        reason: verification.reason,
        session,
        orderId: order._id,
        requestId,
        operationKeyPrefix: `special-order-physical-verify:${order._id}:${requestId}:${reservation.product}`,
        actor: req.user,
      });
      reservation.batchAllocations = batchVerification.allocations;
      reservation.history.push({
        action: 'Physical Verify', quantity: group.quantity, requestId, actor: req.user._id,
        batchAllocations: batchVerification.audit.verifiedAllocations,
        proposedBatchAllocations: batchVerification.audit.proposedAllocations,
        reason: batchVerification.audit.overrideReason,
        at: batchVerification.audit.verifiedAt,
      });
      for (const saleItem of sale.items || []) {
        if (String(saleItem.product || '') === String(reservation.product)) {
          saleItem.batchVerification = batchVerification.audit;
        }
      }
    }
    const batchAllocation = before.expiryTrackingEnabled
      ? await consumeReservedExpiryBatches({
        product: before, allocations: reservation.batchAllocations, quantity: group.quantity,
        session, saleId: sale._id, orderId: order._id, requestId,
        operationKeyPrefix: `special-order-consume:${order._id}:${requestId}:${reservation.product}`,
        actor: req.user,
      }) : null;
    const now = new Date();
    reservation.status = 'Consumed';
    reservation.consumedAt = now;
    reservation.consumedBy = req.user._id;
    reservation.consumedSale = sale._id;
    reservation.updatedBy = req.user._id;
    reservation.history.push({ action: 'Consume', quantity: group.quantity, requestId, actor: req.user._id, at: now, batchAllocations: reservation.batchAllocations || [] });
    await reservation.save({ session });
    const [log] = await InventoryLog.create([{
      action: 'DEDUCT', code: group.sku, productRef: reservation.product,
      saleRef: sale._id, specialOrderRef: order._id,
      batchMovementRefs: batchAllocation?.movements.map((movement) => movement._id) || [],
      userRef: req.user._id, user: req.user.displayName || req.user.name || req.user.username || 'System',
      details: `Special Order ${order.orderNumber} inventory deducted at administrative completion under sale ${sale._id}.`,
      quantity: group.quantity, stockBefore: before.stock, stockAfter: before.stock - group.quantity,
    }], { session });
    inventoryLogs.push({ id: log._id, action: log.action, code: log.code, user: log.user, occurredAt: log.createdAt });
  }
  return inventoryLogs;
};

const validatePhaseFiveFinancialSale = async ({ order, quotation, session, allowLinkedSale = false, requireFulfillment = true }) => {
  const eligibleStatus = order.status === 'In Progress' || (allowLinkedSale && order.status === 'Completed');
  if (Number(order.workflowVersion) !== 2 || !eligibleStatus || (!allowLinkedSale && order.linkedSaleId)) throw phaseOneCompletionError();
  if (!['standard', 'vat_zero_rated'].includes(order.taxTreatment)
    || quotation.customerDetails?.taxTreatment !== order.taxTreatment
    || quotation.documentSnapshot?.taxTreatment !== order.taxTreatment) {
    throw Object.assign(new Error('The approved tax classification needs review before completion.'), { status: 409 });
  }
  if (requireFulfillment && (!['Store Pickup', 'Free Delivery'].includes(quotation.fulfillment?.method)
    || order.fulfillment?.method !== quotation.fulfillment.method)) {
    throw Object.assign(new Error('The approved fulfillment method needs review.'), { status: 409 });
  }
  const ledger = await SpecialOrderPaymentLedger.findOne({ specialOrder: order._id }).session(session);
  const total = parseSafeMoneyToCentavos(validateQuotationAmounts(quotation).total);
  if (!ledger || !total || String(ledger.approvedQuotation) !== String(quotation._id)
    || ledger.approvedTotalCentavos !== total || ledger.amountPaidCentavos !== total
    || ledger.remainingBalanceCentavos !== 0 || ledger.status !== 'Fully Paid') {
    throw Object.assign(new Error('Pay the full approved balance before recording the sale.'), { status: 409 });
  }
  const seen = new Set();
  let paid = 0;
  for (const payment of ledger.payments || []) {
    if (!payment.requestId || seen.has(payment.requestId) || !Number.isSafeInteger(payment.amountCentavos)
      || payment.amountCentavos < 1 || !payment.recordedAt || Number.isNaN(new Date(payment.recordedAt).getTime())) {
      throw Object.assign(new Error('Payment history needs review before recording the sale.'), { status: 409 });
    }
    seen.add(payment.requestId);
    paid += payment.amountCentavos;
  }
  if (!Number.isSafeInteger(paid) || paid !== total || ledger.payments?.[0]?.type !== 'down_payment') {
    throw Object.assign(new Error('Payment history needs review before recording the sale.'), { status: 409 });
  }
};

const isCustomOnlyQuotation = (quotation) => Array.isArray(quotation?.items) && quotation.items.length > 0
  && quotation.items.every((item) => item.itemType === 'custom' && !item.inventoryProduct && !item.inventorySnapshot);

const getSaleFulfillmentStatus = (availability, order) => {
  if (order.fulfillmentHandover?.confirmedAt) return order.fulfillmentHandover.status;
  if (order.status === 'Completed') return 'Completed';
  return availability?.fulfillment?.status || 'Awaiting Items';
};

const recordPhaseFiveFinancialSale = async ({ order, quotation, req, session, referenceNumber = '', supportingDocument = null, requireFulfillment = true }) => {
  await validatePhaseFiveFinancialSale({ order, quotation, session, requireFulfillment });
  const availability = await getStockAvailability(order, session);
  await assertSpecialOrderInvoiceAvailable(referenceNumber, session);
  const [sale] = await Sale.create([buildSalePayload(order, req, {
    referenceNumber, supportingDocument, quotation,
    fulfillmentStatus: getSaleFulfillmentStatus(availability, order),
  })], { session });
  const recordedAt = new Date();
  order.linkedSaleId = sale._id;
  order.financialRecordedAt = recordedAt;
  order.financialRecordedBy = req.user._id;
  order.updatedBy = req.user._id;
  order.statusHistory.push({ status: 'Sale Recorded', changedBy: req.user._id, changedAt: recordedAt, note: `Sale ${sale._id} recorded; inventory remains reserved or may require replenishment before administrative completion.` });
  await order.save({ session });
  await logQuotationAction(req, 'Recorded Special Order Sale', `Recorded sale ${sale._id} for ${order.orderNumber}; inventory deduction remains pending until administrative completion.`, session);
  return { sale, availability };
};

const recordCreditSpecialOrderSale = async ({ order, quotation, req, session, amountPaidCentavos, remainingBalanceCentavos, termDays, dueDate, requestId, method, otherMethod, reference, notes, proofs, recordedAt }) => {
  const customer = quotation.customer
    ? await Partner.findOne({ _id: quotation.customer, type: 'customer', customerType: { $in: ['regular', null] }, isArchived: false }).session(session)
    : null;
  if (!customer) throw createValidationError('A registered customer is required for a Credit Special Order. Select a valid customer before recording the down payment.');

  const salePayload = buildSalePayload(order, req, { quotation });
  const tenderLabel = otherMethod || method;
  const saleNotes = [salePayload.notes, `Down payment method: ${tenderLabel}`].filter(Boolean).join(' ').trim();
  const [sale] = await Sale.create([{
    ...salePayload,
    paymentMethod: 'credit',
    paymentStatus: remainingBalanceCentavos === 0 ? 'Paid' : 'Partially Paid',
    creditTermDays: termDays,
    dueDate,
    notes: saleNotes,
  }], { session });

  const totalAmount = sale.totalAmount;
  const downPaymentAmount = amountPaidCentavos / 100;
  const remainingBalance = remainingBalanceCentavos / 100;
  const [creditTransaction] = await CreditTransaction.create([{
    creditTransactionId: generateCreditTransactionId(),
    orderId: sale._id,
    customerId: customer._id,
    customerName: customer.name || quotation.customerName,
    totalAmount,
    netAmount: totalAmount,
    vatAmount: 0,
    grossAmount: totalAmount,
    pricingMode: 'inclusive',
    vatMode: sale.vatMode || 'vatable',
    customerIsVatExempt: Boolean(sale.customerIsVatExempt),
    hasVatApplicableItems: Boolean(sale.hasVatApplicableItems),
    hasVatableItems: Boolean(sale.hasVatableItems),
    hasZeroRatedItems: Boolean(sale.hasZeroRatedItems),
    vatRatesUsed: Array.isArray(sale.vatRatesUsed) ? sale.vatRatesUsed : [],
    amountPaid: downPaymentAmount,
    downPaymentAmount,
    remainingBalance,
    termDays,
    dueDate,
    originalDueDate: dueDate,
    status: remainingBalanceCentavos === 0 ? 'Paid' : 'Partially Paid',
    paymentHistory: [{
      paymentDate: recordedAt,
      recordedAt,
      amount: downPaymentAmount,
      type: 'down_payment',
      method: normalizeCreditPaymentMethod(otherMethod || method),
      reference,
      note: notes,
      recordedBy: req.user.name || req.user.displayName || req.user.username || 'Unknown',
      recordedById: req.user._id,
      clientRequestId: `special-order-down-payment:${requestId}`,
      ...(proofs[0] ? { proof: proofs[0] } : {}),
      ...(proofs.length ? { proofs } : {}),
    }],
  }], { session });

  sale.creditTransactionId = creditTransaction.creditTransactionId;
  await sale.save({ session });
  order.linkedSaleId = sale._id;
  order.financialRecordedAt = recordedAt;
  order.financialRecordedBy = req.user._id;
  order.updatedBy = req.user._id;
  order.statusHistory.push({ status: 'Sale Recorded', changedBy: req.user._id, changedAt: recordedAt,
    note: `Credit Sale ${sale._id} and balance ${creditTransaction.creditTransactionId} recorded after the required down payment.` });
  await order.save({ session });
  await writeActivityLog({
    user: req.user,
    action: 'Created Credit Sale',
    details: `Credit Special Order ${order.orderNumber} recorded as Sale ${sale._id}; down payment ${amountPaidCentavos} centavos and remaining balance ${remainingBalanceCentavos} centavos due ${dueDate.toISOString()}.`,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    session,
  });
  return { sale, creditTransaction };
};

const syncRecordedSaleFulfillment = async (order, session) => {
  if (!order.linkedSaleId) return null;
  const availability = await getStockAvailability(order, session);
  const status = getSaleFulfillmentStatus(availability, order);
  const updated = await Sale.findOneAndUpdate({ _id: order.linkedSaleId, specialOrderId: order._id, collectionSource: 'special_order_ledger' },
    { $set: { specialOrderFulfillmentStatus: status } }, { session, returnDocument: 'after' });
  if (!updated) throw Object.assign(new Error('The recorded sale needs administrative review.'), { status: 409 });
  return updated;
};

const recoverSpecialOrderCompletion = async ({ orderId, req }) => {
  return withSpecialOrderTransaction({ ...req, params: { ...req.params, id: orderId } }, async (order, session) => {
    const sale = await findSpecialOrderSale(order, session);
    if (!sale) return null;
    if (order.status === 'Completed' || (Number(order.workflowVersion) >= 2 && String(order.linkedSaleId || '') === String(sale._id))) return { order, sale };
    if (order.status !== 'In Progress') return null;
    if (Number(order.workflowVersion) >= 2) return null; // Phase 5B must never repair a sale without proving stock consumption.
    const completedOrder = await markSpecialOrderCompleted({ order, sale, req, session });
    return { order: completedOrder, sale };
  });
};

const listSpecialOrders = async (req, res, next) => {
  try {
    const orders = await SpecialOrder.find(buildQuery(req)).sort({ createdAt: -1 });
    const quotations = await SpecialOrderQuotation.find({ specialOrder: { $in: orders.map((order) => order._id) }, isCurrent: true })
      .select('-documentSnapshot').lean();
    return res.json(orders.map((order) => {
      const current = quotations.filter((quotation) => String(quotation.specialOrder) === String(order._id));
      const quotation = current.length === 1 && (!order.currentQuotation || String(order.currentQuotation) === String(current[0]._id)) ? current[0] : null;
      return { ...enrichOrder(order), quotation };
    }));
  } catch (error) {
    return next(error);
  }
};

const createSpecialOrder = async (req, res, next) => {
  let session;
  const uploadedInitialImages = [];
  let creationCommitted = false;
  try {
    if (req.body?.payload !== undefined) {
      try { req.body = JSON.parse(req.body.payload); }
      catch { throw createValidationError('Invalid quotation request. Please retry.'); }
    }
    const generateQuotation = req.body?.generateQuotation === true;
    if (generateQuotation && req.body?.quotationFirst !== true) throw createValidationError('Direct generation requires quotation-first preparation.');
    const clientRequestId = normalizeString(req.body?.clientRequestId);
    if (typeof req.body?.clientRequestId !== 'string' || !clientRequestId) {
      throw createValidationError('A request ID is required to create a Special Order.');
    }
    if (clientRequestId) {
      const existing = await SpecialOrder.findOne({ clientRequestId });
      if (existing) {
        ensureCashierOwnsSpecialOrder({ order: existing, user: req.user });
        if (Number(existing.workflowVersion) >= 2 && normalizeString(req.body?.taxTreatment) !== existing.taxTreatment) {
          throw Object.assign(new Error('This request ID belongs to a quotation with a different VAT classification. Reload the saved quotation.'), { status: 409 });
        }
        return res.status(200).json(await specialOrderCreationResponse(existing, generateQuotation));
      }
    }

    const customerId = normalizeString(req.body?.customerId);
    if (!customerId) throw createValidationError('Select an active regular customer.');
    const supplierId = normalizeString(req.body?.supplierId);
    const customerNameInput = normalizeHumanReadable(req.body?.customerName);
    const supplierNameInput = normalizeHumanReadable(req.body?.supplierName);
    const phaseOne = Number(req.body?.workflowVersion) === 2 || Boolean(req.body?.fulfillment)
      || (req.body?.items || []).some((item) => item?.itemType === 'inventory');
    if (phaseOne && (!generateQuotation || req.body?.quotationFirst !== true)) throw createValidationError('New mixed-product orders require direct quotation generation.');
    const taxTreatment = phaseOne ? normalizePhaseOneTaxTreatment(req.body?.taxTreatment) : null;
    const fulfillment = phaseOne ? normalizeFulfillment(req.body?.fulfillment) : null;
    const requestedItems = phaseOne ? await Promise.all((req.body?.items || []).map((item) => normalizePhaseOneItem(item, null, req.user))) : req.body?.items;
    const items = normalizeOrderItems(phaseOne ? { ...req.body, items: requestedItems } : req.body, req.body?.quotationFirst === true);
    const initialFilesByItem = new Map();
    if (generateQuotation) {
      const itemIds = (req.body.items || []).map((item) => String(item.itemId || ''));
      if (itemIds.length !== items.length || itemIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || new Set(itemIds).size !== itemIds.length) {
        throw createValidationError('Each quotation product needs a unique item ID. Reload and retry.');
      }
      for (const file of req.files || []) {
        const itemId = String(file.fieldname || '').replace(/^itemImages:/, '');
        if (file.fieldname !== `itemImages:${itemId}` || !itemIds.includes(itemId)) throw createValidationError('A product photo is not associated with this quotation.');
        if (file.size > MAX_FILE_SIZE) throw createValidationError('Each product photo must be 5 MB or smaller.');
        inspectImage(file);
        const photos = initialFilesByItem.get(itemId) || [];
        photos.push(file);
        if (photos.length > 3) throw createValidationError('A product can have at most 3 photos.');
        initialFilesByItem.set(itemId, photos);
      }
    } else if ((req.files || []).length) throw createValidationError('Product photos are only accepted when generating a quotation.');

    if (!customerNameInput) {
      return res.status(400).json({ message: 'customerName is required.' });
    }
    if (items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required.' });
    }

    let customer = null;
    let supplier = null;
    if (customerId) {
      customer = await Partner.findOne({ _id: customerId, type: 'customer', customerType: { $in: ['regular', null] }, isArchived: false });
      if (!customer) throw createValidationError('Select an active regular customer.');
      if (phaseOne && (customer.taxTreatment === 'exempt' || customer.isVatExempt === true)) throw createValidationError('VAT-exempt customer quotations need an approved tax rule before generation.');
    }
    if (supplierId) {
      supplier = await Partner.findOne({ _id: supplierId, type: 'supplier' });
    }

    const quotationFirst = req.body?.quotationFirst === true;
    const initialImagesByItem = new Map();
    if (generateQuotation) {
      for (const requestedItem of req.body.items) {
        const itemId = String(requestedItem.itemId);
        const files = initialFilesByItem.get(itemId) || [];
        const uploaded = [];
        for (const file of files) {
          const image = await uploadQuotationImage(file);
          uploadedInitialImages.push(image);
          uploaded.push(image);
        }
        const selections = Array.isArray(requestedItem.photoSelections)
          ? requestedItem.photoSelections
          : uploaded.map(() => ({ type: 'upload' }));
        if (selections.length > 3) throw createValidationError(`Product ${requestedItem.itemName || 'item'} can have at most 3 photos.`);
        const uploadSelections = selections.filter((selection) => selection?.type === 'upload').length;
        if (uploadSelections !== uploaded.length) throw createValidationError('Selected product photos changed. Review the Product Images section and retry.');
        const images = [];
        let uploadIndex = 0;
        const seenProductIndexes = new Set();
        for (const selection of selections) {
          if (selection?.type === 'upload') {
            images.push(uploaded[uploadIndex++]);
            continue;
          }
          if (selection?.type !== 'product' || requestedItem.itemType !== 'inventory' || !Number.isSafeInteger(selection.imageIndex) || selection.imageIndex < 0 || seenProductIndexes.has(selection.imageIndex)) {
            throw createValidationError('A selected Product Master image is invalid. Select the product again and retry.');
          }
          seenProductIndexes.add(selection.imageIndex);
          const product = await Product.findOne({ _id: requestedItem.inventoryProduct, isActive: { $ne: false } }).lean();
          if (!product || !productImageSources(product).some((entry) => entry.imageIndex === selection.imageIndex)) {
            throw Object.assign(new Error('The selected product image is no longer available. Refresh the product and retry.'), { status: 409 });
          }
          images.push(createProductImageReference(product, selection));
        }
        initialImagesByItem.set(itemId, images);
      }
    }
    const orderPayload = {
      customer: customer?._id || null,
      customerName: customer?.name || customerNameInput,
      items: items.map((item) => ({
        ...item,
        supplier: item.supplier || supplier?._id || null,
        supplierName: item.supplierName || supplier?.name || supplierNameInput,
      })),
      workflowVersion: phaseOne ? 2 : 1,
      ...(phaseOne ? { taxTreatment } : {}),
      fulfillment,
      itemName: items[0].itemName,
      description: items[0].description,
      quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      supplier: supplier?._id || null,
      supplierName: items[0].supplierName || supplier?.name || supplierNameInput,
      purchaseCost: items.reduce((sum, item) => sum + Number(item.purchaseCost || 0) * Number(item.quantity || 0), 0),
      sellingPrice: phaseOne
        ? quotationMoney(items.reduce((sum, item) => checkedMoney(sum + parseSafeMoneyToCentavos(item.sellingPrice) * item.quantity), 0))
        : items.reduce((sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 0), 0),
      expectedArrivalDate: items.find((item) => item.expectedArrivalDate)?.expectedArrivalDate || null,
      status: 'Pending',
      ...(clientRequestId ? { clientRequestId } : {}),
      remarks: normalizeString(req.body?.remarks),
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
      statusHistory: [{ status: 'Pending', changedBy: req.user?._id || null, note: 'Order created; quotation preparation is available.' }],
    };
    let created;
    let createdQuotation;
    const create = async () => {
      const orderNumber = await allocateSpecialOrderReference(referenceDate, session);
      [created] = await SpecialOrder.create([{ ...orderPayload, orderNumber }], { session });
      if (quotationFirst) {
        createdQuotation = await createInitialQuotation(created, customer, req.body?.quotationDetails, req, session, generateQuotation ? { itemIds: req.body.items.map((item) => item.itemId), imagesByItem: initialImagesByItem } : null);
        if (generateQuotation) createdQuotation = await generateSpecialOrderQuotation(created, createdQuotation, req, session, { allowMissingPhotos: true });
      }
      await writeActivityLog({
        user: req.user,
        action: 'Created Special Order',
        details: `Special order ${created.orderNumber} created for ${created.customerName} (${created.itemName}).`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || '',
        ...(session ? { session } : {}),
      });
    };
    const referenceDate = getReferenceDate();
    await ensureReferenceCounter(referenceDate);
    session = await mongoose.startSession();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await withPostCommitNotifications(session, create);
        break;
      } catch (error) {
        if (error?.code !== 11000 || !error?.keyPattern?.orderNumber || attempt >= 4) throw error;
      }
    }
    creationCommitted = true;

    publishSpecialOrderChange(created);

    return res.status(201).json(generateQuotation ? { ...enrichOrder(created), quotation: quotationResponse(createdQuotation) } : enrichOrder(created));
  } catch (error) {
    if (!creationCommitted && uploadedInitialImages.length) {
      try {
        // A commit acknowledgement can fail after MongoDB has persisted the
        // quotation. Never delete a photo if any committed version references it.
        const saved = await SpecialOrderQuotation.find({ 'items.images.key': { $in: uploadedInitialImages.map((image) => image.key) } }).select('items.images.key').lean();
        const retained = new Set(saved.flatMap((quotation) => quotation.items.flatMap((item) => (item.images || []).map((image) => image.key))));
        await Promise.all(uploadedInitialImages.filter((image) => !retained.has(image.key)).map((image) => removeQuotationImage(image.key).catch(() => undefined)));
      } catch (cleanupError) { console.error('Unable to verify cleanup for failed quotation image upload:', cleanupError.message); }
    }
    if (isDuplicateClientRequestIdError(error)) {
      const existing = await SpecialOrder.findOne({ clientRequestId: normalizeString(req.body?.clientRequestId) });
      if (existing) {
        try {
          ensureCashierOwnsSpecialOrder({ order: existing, user: req.user });
          if (Number(existing.workflowVersion) >= 2 && normalizeString(req.body?.taxTreatment) !== existing.taxTreatment) {
            throw Object.assign(new Error('This request ID belongs to a quotation with a different VAT classification. Reload the saved quotation.'), { status: 409 });
          }
          return res.status(200).json(await specialOrderCreationResponse(existing, req.body?.generateQuotation === true));
        } catch (ownershipError) {
          if (ownershipError?.status) return res.status(ownershipError.status).json({ message: ownershipError.message });
          return next(ownershipError);
        }
      }
    }
    if (error?.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
};

const getSpecialOrderReceipt = async (req, res, next) => {
  try {
    const order = await SpecialOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Special order not found.' });
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });
    if (!order.linkedSaleId && order.status !== 'Completed') {
      return res.status(404).json({ message: 'The Sale has not been recorded for this Special Order.' });
    }

    const sale = await findSpecialOrderSale(order);
    if (!sale) {
      return res.status(404).json({ message: 'Finalized sale for this special order was not found.' });
    }

    const result = buildSpecialOrderReceiptResult(order, sale);
    return res.json({ order: result.order, receiptTransaction: result.receiptTransaction });
  } catch (error) {
    return next(error);
  }
};

const updateSpecialOrder = async (req, res, next) => {
  try {
    const updatedOrder = await withSpecialOrderTransaction(req, async (order, session) => {

      if (!['Pending', 'In Progress'].includes(order.status)) {
        throw createValidationError('Only unfinished special orders can be edited.');
      }

      const payload = {};
      if (req.body?.customerName !== undefined) {
        payload.customerName = normalizeHumanReadable(req.body.customerName);
        if (!payload.customerName) {
          throw createValidationError('customerName is required.');
        }
      }
      if (req.body?.items !== undefined || req.body?.itemName !== undefined) {
        const items = normalizeOrderItems(req.body);
        if (items.length === 0) {
          throw createValidationError('At least one item is required.');
        }

        payload.items = items;
        payload.itemName = items[0].itemName;
        payload.description = items[0].description;
        payload.quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        payload.supplierName = items[0].supplierName || normalizeString(req.body.supplierName);
        payload.purchaseCost = items.reduce((sum, item) => sum + Number(item.purchaseCost || 0) * Number(item.quantity || 0), 0);
        payload.sellingPrice = items.reduce((sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 0), 0);
        payload.expectedArrivalDate = items.find((item) => item.expectedArrivalDate)?.expectedArrivalDate || null;
      }
      if (req.body?.remarks !== undefined) payload.remarks = normalizeString(req.body.remarks);
      if (req.body?.status !== undefined) {
        throw createValidationError('Use the status endpoint to change a special order status.');
      }
      if (req.body?.customerId !== undefined) {
        const customer = req.body.customerId ? await Partner.findOne({ _id: req.body.customerId, type: 'customer', customerType: { $in: ['regular', null] }, isArchived: false }).session(session) : null;
        if (req.body.customerId && !customer) throw createValidationError('Select an active regular customer.');
        payload.customer = customer?._id || null;
        if (customer?.name) payload.customerName = customer.name;
      }
      if (req.body?.supplierId !== undefined) {
        const supplier = req.body.supplierId ? await Partner.findOne({ _id: req.body.supplierId, type: 'supplier' }) : null;
        payload.supplier = supplier?._id || null;
        if (supplier?.name) payload.supplierName = supplier.name;
      }

      if (payload.quantity !== undefined && (!Number.isFinite(payload.quantity) || payload.quantity < 1)) {
        throw createValidationError('quantity must be at least 1.');
      }

      const current = await getCurrentQuotation(order, session);
      if (current && Object.keys(payload).some((key) => ['items', 'itemName', 'description', 'quantity', 'sellingPrice', 'customer', 'customerName'].includes(key))) {
        throw Object.assign(new Error('Edit the quotation draft or revise the issued quotation before changing quoted order details.'), { status: 409 });
      }
      order.set({ ...payload, updatedBy: req.user?._id || null });
      await order.save({ session });

      await writeActivityLog({
        user: req.user,
        session,
        action: 'Updated Special Order',
        details: `Special order ${order.orderNumber} updated.`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || '',
      });

      return order;
    });
    publishSpecialOrderChange(updatedOrder);
    return res.json(enrichOrder(updatedOrder));
  } catch (error) {
    return quotationActionError(error, res, next);
  }
};

const updateSpecialOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await SpecialOrder.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Special order not found.' });
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });

    return res.status(400).json({
      message: 'Manual status changes are not available. Record the customer decision or use Save Transaction for eligible In Progress orders.',
    });
  } catch (error) {
    return next(error);
  }
};

const findOwnedOrder = async (id, user, session = null) => {
  const query = SpecialOrder.findById(id);
  const order = await (session ? query.session(session) : query);
  if (!order) throw Object.assign(new Error('Special order not found.'), { status: 404 });
  ensureCashierOwnsSpecialOrder({ order, user });
  return order;
};

// Every lifecycle mutation and finalization writes this same document first.
// MongoDB retries a conflicting transaction with a fresh snapshot after the
// winning operation commits, before quotation eligibility is read.
const lockSpecialOrder = async (id, user, session) => {
  await findOwnedOrder(id, user, session);
  const order = await SpecialOrder.findOneAndUpdate({
    _id: id,
    ...(user?.role === 'cashier' ? { createdBy: user._id } : {}),
  }, { $inc: { __v: 1 } }, { session, returnDocument: 'after' });
  if (!order) throw Object.assign(new Error('Special order access changed. Please reload.'), { status: 409 });
  return order;
};

const withSpecialOrderTransaction = async (req, operation) => {
  const session = await mongoose.startSession();
  try {
    return await withPostCommitNotifications(session, async () => {
      const order = await lockSpecialOrder(req.params.id, req.user, session);
      return operation(order, session);
    });
  } finally {
    await session.endSession();
  }
};

const stockRequestId = (req) => {
  const requestId = normalizeString(req.body?.requestId);
  if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(requestId)) throw createValidationError('A valid stock action request ID is required.');
  return requestId;
};

const paymentRequestId = (req) => {
  const requestId = normalizeString(req.body?.requestId);
  if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(requestId)) throw createValidationError('A valid payment request ID is required.');
  return requestId;
};

const paymentNotes = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > 500) throw createValidationError('Payment notes must be text of 500 characters or fewer.');
  return value.trim();
};

const parseDownPaymentPercentageBasisPoints = (value) => {
  const text = String(value ?? '').trim();
  const normalizedText = text.startsWith('.') ? `0${text}` : text;
  const match = normalizedText.match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
  return basisPoints > 0 && basisPoints <= 10000 ? basisPoints : null;
};

const calculateDownPaymentCentavos = (totalCentavos, percentageBasisPoints) => {
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 1
    || !Number.isSafeInteger(percentageBasisPoints) || percentageBasisPoints < 1 || percentageBasisPoints > 10000) return null;
  const rounded = (BigInt(totalCentavos) * BigInt(percentageBasisPoints) + 5000n) / 10000n;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
};

const formatDownPaymentPercentage = (percentageBasisPoints) => (percentageBasisPoints / 100)
  .toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');

const validatePaymentEvidence = ({ method, reference, files, chequeCleared }) => {
  if (reference.length > 150) throw createValidationError('Payment reference must be 150 characters or fewer.');
  if (files.length > 3) throw createValidationError('Choose up to 3 proof photos.');
  if (method !== 'cash' && !reference && files.length === 0) throw createValidationError('Provide a payment reference or payment proof.');
  if (method === 'cheque' && !chequeCleared) throw createValidationError('Confirm that the cheque has cleared before recording payment.');
};

const paymentResponse = (ledger, replayed = false) => {
  if (!ledger) return { ledger: null, replayed };
  return { ledger: {
    specialOrder: ledger.specialOrder,
    approvedQuotation: ledger.approvedQuotation,
    paymentPlan: ledger.paymentPlan || 'cash',
    ...(Number.isFinite(ledger.downPaymentPercentage) ? { downPaymentPercentage: ledger.downPaymentPercentage } : {}),
    creditTransactionId: ledger.creditTransactionId || '',
    approvedTotalCentavos: ledger.approvedTotalCentavos,
    amountPaidCentavos: ledger.amountPaidCentavos,
    remainingBalanceCentavos: ledger.remainingBalanceCentavos,
    status: ledger.status,
    reservationAtPayment: ledger.reservationAtPayment || [],
    payments: (ledger.payments || []).map((payment) => ({
      id: `${String(ledger.specialOrder)}:${payment.requestId}`,
      requestId: payment.requestId, type: payment.type, amountCentavos: payment.amountCentavos,
      method: payment.method, otherMethod: payment.otherMethod, reference: payment.reference,
      internalReference: payment.internalReference || '', notes: payment.notes || '', chequeCleared: payment.chequeCleared ?? null, recordedAt: payment.recordedAt,
      recordedBy: payment.recordedBy,
      proofs: (payment.proofs || []).map((proof) => ({ fileName: proof.fileName, mimeType: proof.mimeType, uploadedAt: proof.uploadedAt })),
    })),
  }, replayed };
};

const getSpecialOrderPayments = async (req, res, next) => {
  try {
    const order = await findOwnedOrder(req.params.id, req.user);
    const ledger = await SpecialOrderPaymentLedger.findOne({ specialOrder: order._id });
    return res.json(paymentResponse(ledger));
  } catch (error) { return quotationActionError(error, res, next); }
};

const listSpecialOrderCollections = async (req, res, next) => {
  try {
    const ledgers = await SpecialOrderPaymentLedger.find({}).select('specialOrder approvedTotalCentavos amountPaidCentavos remainingBalanceCentavos payments').lean();
    const events = [];
    for (const ledger of ledgers) {
      const seen = new Set();
      let paid = 0;
      for (const payment of ledger.payments || []) {
        const amount = Number(payment.amountCentavos);
        const recordedAt = new Date(payment.recordedAt);
        if (!payment.requestId || seen.has(payment.requestId) || !Number.isSafeInteger(amount) || amount < 1 || Number.isNaN(recordedAt.getTime())) {
          return res.status(409).json({ message: 'Special Order collections need administrative review.' });
        }
        seen.add(payment.requestId);
        paid += amount;
        if (!Number.isSafeInteger(paid)) return res.status(409).json({ message: 'Special Order collections need administrative review.' });
        events.push({ specialOrderId: String(ledger.specialOrder), requestId: payment.requestId,
          type: payment.type, amountCentavos: amount, recordedAt: payment.recordedAt });
      }
      if (paid !== ledger.amountPaidCentavos || ledger.approvedTotalCentavos - paid !== ledger.remainingBalanceCentavos) {
        return res.status(409).json({ message: 'Special Order collections need administrative review.' });
      }
    }
    return res.json({ events });
  } catch (error) { return next(error); }
};

const recordSpecialOrderDownPayment = async (req, res, next) => {
  const savedProofs = [];
  let committedProofKeys = new Set();
  try {
    const requestId = paymentRequestId(req);
    const order = await findOwnedOrder(req.params.id, req.user);
    const existing = await SpecialOrderPaymentLedger.findOne({ specialOrder: order._id });
    if (existing) {
      if (existing.payments?.[0]?.requestId !== requestId) {
        throw Object.assign(new Error('The initial down payment has already been recorded.'), { status: 409 });
      }
      return res.json({ ...paymentResponse(existing, true), ...(order.linkedSaleId ? { order: enrichOrder(order) } : {}), availability: await getStockAvailability(order) });
    }
    const amountCentavos = parseSafeMoneyToCentavos(req.body?.amount);
    const downPaymentPercentageBasisPoints = parseDownPaymentPercentageBasisPoints(req.body?.downPaymentPercentage);
    if (downPaymentPercentageBasisPoints === null) {
      throw createValidationError('Down payment percentage must be greater than 0% and no more than 100%, using up to 2 decimal places.');
    }
    const paymentPlan = normalizeString(req.body?.paymentPlan || 'cash').toLowerCase();
    if (!['cash', 'credit'].includes(paymentPlan)) throw createValidationError('Select Cash or Credit for the payment plan.');
    const termDays = paymentPlan === 'credit' ? parseStrictWholeNumber(req.body?.termDays, { min: 1, max: 60 }) : null;
    if (paymentPlan === 'credit' && termDays === null) throw createValidationError('Credit terms must be between 1 and 60 days.');
    if (!Number.isSafeInteger(amountCentavos) || amountCentavos < 1) throw createValidationError('Down payment must be at least ₱0.01 and no more than the approved quotation total.');
    const methodInput = normalizeString(req.body?.method).toLowerCase();
    const supported = new Set(['cash', 'gcash', 'cheque', 'bank transfer', 'other']);
    if (!supported.has(methodInput)) throw createValidationError('Select a valid down payment method.');
    const method = methodInput === 'other' ? 'Other' : methodInput;
    const otherMethod = methodInput === 'other' ? normalizeHumanReadable(req.body?.otherMethod) : '';
    if (methodInput === 'other' && (!otherMethod || otherMethod.length > 80)) throw createValidationError('Enter the other payment method (up to 80 characters).');
    const reference = methodInput === 'cash' ? '' : normalizeString(req.body?.reference);
    const notes = paymentNotes(req.body?.notes);
    const chequeCleared = req.body?.chequeCleared === true || req.body?.chequeCleared === 'true';
    const files = [...(req.files?.proof || []), ...(req.files?.proofs || [])];
    validatePaymentEvidence({ method: methodInput, reference, files, chequeCleared });
    // Validate the accepted snapshot before uploading; repeat every check under the order lock below.
    if (Number(order.workflowVersion) < 2 || order.status !== 'In Progress' || order.linkedSaleId) {
      throw Object.assign(new Error('An accepted active Phase 1 Special Order is required for a down payment.'), { status: 409 });
    }
    const current = await getCurrentQuotation(order);
    if (!current || current.status !== 'Accepted' || String(order.transactionQuotation) !== String(current._id)) {
      throw Object.assign(new Error('The current accepted quotation is required before collecting a down payment.'), { status: 409 });
    }
    const approvedTotalCentavos = parseSafeMoneyToCentavos(validateQuotationAmounts(current).total);
    const expectedDownPaymentCentavos = calculateDownPaymentCentavos(approvedTotalCentavos, downPaymentPercentageBasisPoints);
    if (!approvedTotalCentavos || !Number.isSafeInteger(amountCentavos) || amountCentavos < 1 || amountCentavos > approvedTotalCentavos) {
      throw createValidationError('Down payment must be at least ₱0.01 and no more than the approved quotation total.');
    }
    if (expectedDownPaymentCentavos === null || amountCentavos !== expectedDownPaymentCentavos) {
      throw createValidationError(`Down payment must match ${formatDownPaymentPercentage(downPaymentPercentageBasisPoints)}% of the approved total (${(expectedDownPaymentCentavos / 100).toFixed(2)}).`);
    }
    if (paymentPlan === 'credit' && (!current.customer || !await Partner.exists({ _id: current.customer, type: 'customer', customerType: { $in: ['regular', null] }, isArchived: false }))) {
      throw createValidationError('A registered customer is required for a Credit Special Order.');
    }
    for (const file of files) savedProofs.push(await persistProofOfPayment({ file, user: req.user }));
    const recordedAt = new Date();
    const paymentDate = methodInput === 'cash' ? getReferenceDate(recordedAt) : '';
    if (paymentDate) await ensurePaymentReferenceCounter(paymentDate);
    const result = await withSpecialOrderTransaction(req, async (lockedOrder, session) => {
      const prior = await SpecialOrderPaymentLedger.findOne({ specialOrder: lockedOrder._id }).session(session);
      if (prior) {
        if (prior.payments?.[0]?.requestId !== requestId) throw Object.assign(new Error('The initial down payment has already been recorded.'), { status: 409 });
        return { order: lockedOrder, ledger: prior, replayed: true, stockChanged: false };
      }
      if (Number(lockedOrder.workflowVersion) < 2 || lockedOrder.status !== 'In Progress' || lockedOrder.linkedSaleId) {
        throw Object.assign(new Error('This Special Order is no longer eligible for a down payment.'), { status: 409 });
      }
      const quotation = await getCurrentQuotation(lockedOrder, session);
      if (!quotation || quotation.status !== 'Accepted' || String(lockedOrder.transactionQuotation) !== String(quotation._id)) {
        throw Object.assign(new Error('The accepted quotation changed. Reload before recording payment.'), { status: 409 });
      }
      const total = parseSafeMoneyToCentavos(validateQuotationAmounts(quotation).total);
      const currentRequiredDownPaymentCentavos = calculateDownPaymentCentavos(total, downPaymentPercentageBasisPoints);
      if (total !== approvedTotalCentavos || !Number.isSafeInteger(amountCentavos) || amountCentavos > total
        || currentRequiredDownPaymentCentavos === null || amountCentavos !== currentRequiredDownPaymentCentavos) {
        throw Object.assign(new Error('The approved quotation total or down payment changed. Reload before recording payment.'), { status: 409 });
      }
      if (paymentPlan === 'credit' && (!quotation.customer || !await Partner.exists({ _id: quotation.customer, type: 'customer', customerType: { $in: ['regular', null] }, isArchived: false }).session(session))) {
        throw createValidationError('A registered customer is required for a Credit Special Order.');
      }
      const hasInventoryItems = quotation.items.some((item) => item.itemType === 'inventory');
      const reservation = hasInventoryItems
        ? await applyStockOperation({ order: lockedOrder, session, actor: req.user._id, requestId: `down-payment:${requestId}`, action: 'Reserve' })
        : { changes: [] };
      const availability = await getStockAvailability(lockedOrder, session);
      const internalReference = paymentDate ? await allocatePaymentReference(paymentDate, session) : '';
      let creditRecords = null;
      if (paymentPlan === 'credit') {
        const startOfToday = startOfManilaCalendarDay(recordedAt);
        const dueDate = startOfToday ? addManilaCalendarDays(startOfToday, termDays) : null;
        if (!dueDate) throw createValidationError('A valid credit due date could not be calculated.');
        creditRecords = await recordCreditSpecialOrderSale({
          order: lockedOrder,
          quotation,
          req,
          session,
          amountPaidCentavos: amountCentavos,
          remainingBalanceCentavos: total - amountCentavos,
          termDays,
          dueDate,
          requestId,
          method,
          otherMethod,
          reference: internalReference || reference,
          notes,
          proofs: savedProofs,
          recordedAt,
        });
      }
      const [ledger] = await SpecialOrderPaymentLedger.create([{
        specialOrder: lockedOrder._id, approvedQuotation: quotation._id, approvedTotalCentavos: total,
        paymentPlan,
        ...(creditRecords ? { creditTransaction: creditRecords.creditTransaction._id, creditTransactionId: creditRecords.creditTransaction.creditTransactionId } : {}),
        downPaymentPercentage: downPaymentPercentageBasisPoints / 100,
        amountPaidCentavos: amountCentavos, remainingBalanceCentavos: total - amountCentavos,
        status: total === amountCentavos ? 'Fully Paid' : 'Partially Paid',
        reservationAtPayment: availability.items.map((item) => ({
          productId: item.itemType === 'inventory' ? item.productId : null,
          itemType: item.itemType, sku: item.sku || '', orderedQuantity: item.orderedQuantity,
          reservedQuantity: item.allocatedToOrder || 0,
          shortageQuantity: item.itemType === 'inventory' ? Math.max(0, item.orderedQuantity - (item.allocatedToOrder || 0)) : 0,
        })),
        payments: [{
          requestId, type: 'down_payment', amountCentavos, method, otherMethod, reference: internalReference || reference, internalReference, notes,
          chequeCleared: methodInput === 'cheque' ? true : null,
          proofs: savedProofs, recordedAt, recordedBy: req.user._id,
        }],
      }], { session });
      await logQuotationAction(req, 'Recorded Special Order Down Payment', `Recorded ${amountCentavos} centavos for ${lockedOrder.orderNumber}; reserved ${reservation.changes.length} SKU(s).`, session);
      return { order: lockedOrder, ledger, sale: creditRecords?.sale || null, creditTransaction: creditRecords?.creditTransaction || null, replayed: false, stockChanged: reservation.changes.length > 0 };
    });
    committedProofKeys = new Set((result.ledger.payments?.[0]?.proofs || []).map((proof) => proof.storageKey));
    if (!result.replayed) {
      publishSpecialOrderChange(result.order);
      if (result.sale) publishSaleCreated({ saleId: result.sale._id, cashierId: req.user?._id, cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown' });
      if (result.creditTransaction) publishCreditTransactionsUpdated({ reason: 'special-order.credit-created', creditTransactionId: result.creditTransaction._id });
      if (result.stockChanged) publishInventoryUpdated({ reason: 'special-order.down-payment-reservation', productCodes: [] });
    }
    return res.status(result.replayed ? 200 : 201).json({ ...paymentResponse(result.ledger, result.replayed), ...(result.order.linkedSaleId ? { order: enrichOrder(result.order) } : {}), availability: await getStockAvailability(result.order) });
  } catch (error) { return quotationActionError(error, res, next); }
  finally {
    if (savedProofs.length) {
      // A response may fail after commit. Never delete a key referenced by the committed ledger.
      try {
        const persisted = await SpecialOrderPaymentLedger.findOne({ specialOrder: req.params.id }).select('payments.proofs.storageKey').lean();
        for (const payment of persisted?.payments || []) for (const proof of payment.proofs || []) committedProofKeys.add(proof.storageKey);
      } catch (error) { console.error('Unable to verify Special Order proof cleanup; retained files to protect committed evidence:', error.message); committedProofKeys = new Set(savedProofs.map((proof) => proof.storageKey)); }
      for (const proof of savedProofs) if (!committedProofKeys.has(proof.storageKey)) {
        try { await removeStoredProof(proof.storageKey); }
        catch (error) { console.error('Unable to remove unreferenced Special Order proof:', error.message); }
      }
    }
  }
};

const recordSpecialOrderAdditionalPayment = async (req, res, next) => {
  const savedProofs = [];
  let committedProofKeys = new Set();
  let uploadedDocument = null;
  let documentPersisted = false;
  try {
    const requestId = paymentRequestId(req);
    const order = await findOwnedOrder(req.params.id, req.user);
    const ledger = await SpecialOrderPaymentLedger.findOne({ specialOrder: order._id });
    if (!ledger) throw Object.assign(new Error('Record the required down payment first.'), { status: 409 });
    if (ledger.paymentPlan === 'credit') throw Object.assign(new Error('Credit Special Order balances must be settled through the linked Credit Transaction.'), { status: 409 });
    const amountCentavos = parseSafeMoneyToCentavos(req.body?.amount);
    if (!Number.isSafeInteger(amountCentavos) || amountCentavos < 1) throw createValidationError('Enter a payment of at least ₱0.01.');
    const methodInput = normalizeString(req.body?.method).toLowerCase();
    if (!new Set(['cash', 'gcash', 'cheque', 'bank transfer', 'other']).has(methodInput)) throw createValidationError('Select a valid payment method.');
    const method = methodInput === 'other' ? 'Other' : methodInput;
    const otherMethod = methodInput === 'other' ? normalizeHumanReadable(req.body?.otherMethod) : '';
    if (methodInput === 'other' && (!otherMethod || otherMethod.length > 80)) throw createValidationError('Enter the other payment method (up to 80 characters).');
    const submittedReference = normalizeString(req.body?.reference);
    const reference = methodInput === 'cash' ? '' : submittedReference;
    const notes = paymentNotes(req.body?.notes);
    const chequeCleared = req.body?.chequeCleared === true || req.body?.chequeCleared === 'true';
    const invoiceNumber = normalizeString(req.body?.invoiceNumber);
    const documentFile = req.files?.document?.[0] || null;
    const samePayment = (payment) => payment.amountCentavos === amountCentavos && payment.method === method
      && (payment.otherMethod || '') === otherMethod && (payment.notes || '') === notes
      && (payment.internalReference && methodInput === 'cash' ? true : (payment.reference || '') === submittedReference);
    const existing = ledger.payments.find((payment) => payment.requestId === requestId);
    if (existing) {
      if (existing.type === 'down_payment' || !samePayment(existing)) throw Object.assign(new Error('This payment request ID belongs to a different payment.'), { status: 409 });
      if (invoiceNumber && order.linkedSaleId) {
        const sale = await findSpecialOrderSale(order);
        if (!sale || String(sale._id) !== String(order.linkedSaleId) || sale.transactionReference?.referenceNumber !== invoiceNumber) {
          throw Object.assign(new Error('This payment request ID belongs to a different sale reference.'), { status: 409 });
        }
      }
      return res.json({ ...paymentResponse(ledger, true), ...(order.linkedSaleId ? { order: enrichOrder(order) } : {}) });
    }
    const files = [...(req.files?.proof || []), ...(req.files?.proofs || [])];
    validatePaymentEvidence({ method: methodInput, reference, files, chequeCleared });
    if (Number(order.workflowVersion) < 2 || order.status !== 'In Progress' || order.linkedSaleId || ledger.remainingBalanceCentavos < 1) {
      throw Object.assign(new Error('This Special Order is not eligible for another payment.'), { status: 409 });
    }
    if (amountCentavos !== ledger.remainingBalanceCentavos) throw createValidationError('The remaining Cash Special Order balance must be settled in one final payment.');
    const current = await getCurrentQuotation(order);
    if (!current || current.status !== 'Accepted' || String(current._id) !== String(ledger.approvedQuotation)
      || String(order.transactionQuotation) !== String(current._id)) {
      throw Object.assign(new Error('The accepted quotation changed. Reload before recording payment.'), { status: 409 });
    }
    const finalCustomPayment = amountCentavos === ledger.remainingBalanceCentavos && isCustomOnlyQuotation(current);
    if ((invoiceNumber || documentFile) && !finalCustomPayment) throw createValidationError('Sale evidence is accepted only with the final payment for a Custom-Only order.');
    if (finalCustomPayment && !invoiceNumber && !documentFile) throw createValidationError('Provide an Invoice No. or Supporting Document to record the Sale with the final payment.');
    if (invoiceNumber && (invoiceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH || !isValidTransactionReferenceNumber(invoiceNumber))) {
      throw createValidationError(invoiceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH
        ? `Invoice No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.`
        : TRANSACTION_REFERENCE_NUMERIC_MESSAGE.replace('Reference No.', 'Invoice No.'));
    }
    if (finalCustomPayment && invoiceNumber) await prepareSpecialOrderInvoice(invoiceNumber);
    for (const file of files) savedProofs.push(await persistProofOfPayment({ file, user: req.user }));
    if (documentFile) uploadedDocument = await uploadDocument(documentFile);
    const recordedAt = new Date();
    const paymentDate = methodInput === 'cash' ? getReferenceDate(recordedAt) : '';
    if (paymentDate) await ensurePaymentReferenceCounter(paymentDate);
    const result = await withSpecialOrderTransaction(req, async (lockedOrder, session) => {
      const currentLedger = await SpecialOrderPaymentLedger.findOne({ specialOrder: lockedOrder._id }).session(session);
      const replay = currentLedger?.payments?.find((payment) => payment.requestId === requestId);
      if (replay) {
        if (replay.type === 'down_payment' || !samePayment(replay)) throw Object.assign(new Error('This payment request ID belongs to a different payment.'), { status: 409 });
        if (invoiceNumber && lockedOrder.linkedSaleId) {
          const sale = await findSpecialOrderSale(lockedOrder, session);
          if (!sale || String(sale._id) !== String(lockedOrder.linkedSaleId) || sale.transactionReference?.referenceNumber !== invoiceNumber) {
            throw Object.assign(new Error('This payment request ID belongs to a different sale reference.'), { status: 409 });
          }
        }
        return { order: lockedOrder, ledger: currentLedger, replayed: true };
      }
      if (Number(lockedOrder.workflowVersion) < 2 || lockedOrder.status !== 'In Progress' || lockedOrder.linkedSaleId || !currentLedger) {
        throw Object.assign(new Error('This Special Order is no longer eligible for payment.'), { status: 409 });
      }
      if (currentLedger.paymentPlan === 'credit') throw Object.assign(new Error('Credit Special Order balances must be settled through the linked Credit Transaction.'), { status: 409 });
      const quotation = await getCurrentQuotation(lockedOrder, session);
      if (!quotation || quotation.status !== 'Accepted' || String(quotation._id) !== String(currentLedger.approvedQuotation)
        || String(lockedOrder.transactionQuotation) !== String(quotation._id)
        || parseSafeMoneyToCentavos(validateQuotationAmounts(quotation).total) !== currentLedger.approvedTotalCentavos) {
        throw Object.assign(new Error('The approved quotation changed. Reload before recording payment.'), { status: 409 });
      }
      const paidFromEvents = currentLedger.payments.reduce((sum, payment) => sum + payment.amountCentavos, 0);
      if (!Number.isSafeInteger(paidFromEvents) || paidFromEvents !== currentLedger.amountPaidCentavos
        || currentLedger.approvedTotalCentavos - paidFromEvents !== currentLedger.remainingBalanceCentavos) {
        throw Object.assign(new Error('Payment history requires administrative review.'), { status: 409 });
      }
      if (amountCentavos > currentLedger.remainingBalanceCentavos) throw createValidationError('Payment exceeds the remaining balance. Reload and try again.');
      if (amountCentavos !== currentLedger.remainingBalanceCentavos) throw createValidationError('The remaining Cash Special Order balance must be settled in one final payment.');
      const isFinal = amountCentavos === currentLedger.remainingBalanceCentavos;
      const autoRecordSale = isFinal && isCustomOnlyQuotation(quotation);
      if (autoRecordSale && !invoiceNumber && !uploadedDocument) {
        throw createValidationError('Provide an Invoice No. or Supporting Document to record the Sale with the final payment.');
      }
      if (!autoRecordSale && (invoiceNumber || uploadedDocument)) {
        throw Object.assign(new Error('The remaining balance changed. Reload before recording this payment.'), { status: 409 });
      }
      if (autoRecordSale && await SpecialOrderStockReservation.exists({ specialOrder: lockedOrder._id, status: 'Active' }).session(session)) {
        throw Object.assign(new Error('Existing stock reservations need review before the Sale can be recorded.'), { status: 409 });
      }
      if (autoRecordSale && await findSpecialOrderSale(lockedOrder, session)) {
        throw Object.assign(new Error('A Sale already exists for this order. Reload before recording payment.'), { status: 409 });
      }
      const internalReference = paymentDate ? await allocatePaymentReference(paymentDate, session) : '';
      currentLedger.payments.push({
        requestId, type: isFinal ? 'final_payment' : 'partial_payment', amountCentavos,
        method, otherMethod, reference: internalReference || reference, internalReference, notes, chequeCleared: methodInput === 'cheque' ? true : null,
        proofs: savedProofs, recordedAt, recordedBy: req.user._id,
      });
      currentLedger.amountPaidCentavos += amountCentavos;
      currentLedger.remainingBalanceCentavos -= amountCentavos;
      currentLedger.status = isFinal ? 'Fully Paid' : 'Partially Paid';
      await currentLedger.save({ session });
      await logQuotationAction(req, 'Recorded Special Order Payment', `Recorded ${amountCentavos} centavos for ${lockedOrder.orderNumber}; ${currentLedger.remainingBalanceCentavos} centavos remain.`, session);
      const { sale, availability } = autoRecordSale
        ? await recordPhaseFiveFinancialSale({ order: lockedOrder, quotation, req, session, referenceNumber: invoiceNumber, supportingDocument: uploadedDocument })
        : {};
      return { order: lockedOrder, ledger: currentLedger, sale, availability, replayed: false };
    });
    committedProofKeys = new Set(result.ledger.payments.find((payment) => payment.requestId === requestId)?.proofs?.map((proof) => proof.storageKey) || []);
    documentPersisted = Boolean(uploadedDocument?.key && result.sale?.transactionReference?.supportingDocument?.key === uploadedDocument.key);
    if (!result.replayed) {
      publishSpecialOrderChange(result.order);
      if (result.sale) {
        publishSaleCreated({ saleId: result.sale._id, cashierId: req.user?._id, cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown' });
      }
    }
    return res.status(result.replayed ? 200 : 201).json({ ...paymentResponse(result.ledger, result.replayed),
      ...(result.order.linkedSaleId ? { order: enrichOrder(result.order) } : {}),
      ...(result.availability ? { availability: result.availability } : {}) });
  } catch (error) { return quotationActionError(error, res, next); }
  finally {
    if (uploadedDocument?.key && !documentPersisted) {
      try {
        const persistedSale = await Sale.findOne({ specialOrderId: req.params.id, 'transactionReference.supportingDocument.key': uploadedDocument.key }).select('_id').lean();
        if (!persistedSale) await removeDocument(uploadedDocument.key);
      } catch (error) { console.error('Unable to verify Special Order document cleanup; retained possible Sale evidence:', error.message); }
    }
    if (savedProofs.length) {
      try {
        const persisted = await SpecialOrderPaymentLedger.findOne({ specialOrder: req.params.id }).select('payments.proofs.storageKey').lean();
        for (const payment of persisted?.payments || []) for (const proof of payment.proofs || []) committedProofKeys.add(proof.storageKey);
      } catch (error) { console.error('Unable to verify Special Order proof cleanup; retained files to protect committed evidence:', error.message); committedProofKeys = new Set(savedProofs.map((proof) => proof.storageKey)); }
      for (const proof of savedProofs) if (!committedProofKeys.has(proof.storageKey)) {
        try { await removeStoredProof(proof.storageKey); }
        catch (error) { console.error('Unable to remove unreferenced Special Order proof:', error.message); }
      }
    }
  }
};

const getSpecialOrderPaymentProof = async (req, res, next) => {
  try {
    const order = await findOwnedOrder(req.params.id, req.user);
    const ledger = await SpecialOrderPaymentLedger.findOne({ specialOrder: order._id });
    const payment = ledger?.payments?.find((entry) => entry.requestId === req.params.requestId);
    const index = Number(req.params.index);
    const proof = Number.isSafeInteger(index) && index >= 0 ? payment?.proofs?.[index] : null;
    if (!proof?.storageKey) return res.status(404).json({ message: 'Payment proof is not available.' });
    const stored = await getStoredProof(proof.storageKey);
    if (!stored) return res.status(404).json({ message: 'Payment proof is not available.' });
    res.set('Cache-Control', 'private, no-store');
    res.type(proof.mimeType);
    if (stored.type === 'local') return res.sendFile(stored.filePath);
    const body = stored.object?.Body;
    if (typeof body?.pipe === 'function') { body.on('error', next); body.pipe(res); return undefined; }
    if (typeof body?.transformToByteArray === 'function') return res.send(Buffer.from(await body.transformToByteArray()));
    return res.status(404).json({ message: 'Payment proof is not available.' });
  } catch (error) {
    if (isObjectNotFoundError(error)) return res.status(404).json({ message: 'Payment proof is not available.' });
    return quotationActionError(error, res, next);
  }
};

const getSpecialOrderStockAvailability = async (req, res, next) => {
  try {
    const order = await findOwnedOrder(req.params.id, req.user);
    return res.json(await getStockAvailability(order));
  } catch (error) { return quotationActionError(error, res, next); }
};

const validateSpecialOrderBatchVerifications = (inventoryItems, submitted = []) => {
  const tracked = inventoryItems.filter((item) => item.expiryTrackingEnabled === true);
  if (!Array.isArray(submitted) || submitted.length !== tracked.length) {
    throw Object.assign(new Error('Confirm the physical batch picks for every expiry-tracked item before completion.'), { status: 400 });
  }
  const submittedById = new Map();
  for (const row of submitted) {
    const productId = String(row?.productId || '').trim();
    if (!mongoose.isValidObjectId(productId) || submittedById.has(productId)) {
      throw createValidationError('Batch verification details are invalid. Refresh stock and try again.');
    }
    submittedById.set(productId, row);
  }
  const verified = new Map();
  for (const item of tracked) {
    const productId = String(item.productId);
    const row = submittedById.get(productId);
    const currentProposal = normalizeBatchAllocations(item.proposedBatchAllocations);
    const suppliedProposal = normalizeBatchAllocations(row?.proposedAllocations);
    if (!row || !currentProposal || !suppliedProposal
      || batchAllocationSignature(currentProposal) !== batchAllocationSignature(suppliedProposal)) {
      throw Object.assign(new Error(`Batch availability for ${item.sku} changed. Refresh stock and confirm the batch picks again.`), { status: 409 });
    }
    if (!Number.isSafeInteger(Number(row.productStock)) || Number(row.productStock) !== Number(item.productStock)
      || !Number.isSafeInteger(Number(row.productReserved)) || Number(row.productReserved) !== Number(item.productReserved)) {
      throw Object.assign(new Error(`Stock for ${item.sku} changed. Refresh stock and confirm the batch picks again.`), { status: 409 });
    }
    const result = validateBatchVerification({
      quantity: Number(item.orderedQuantity),
      proposedAllocations: suppliedProposal,
      verifiedAllocations: row.verifiedAllocations,
      reason: row.reason,
    });
    verified.set(productId, { ...result, reason: result.overrideReason });
  }
  if ([...submittedById.keys()].some((productId) => !tracked.some((item) => String(item.productId) === productId))) {
    throw createValidationError('Batch verification was submitted for an item outside this order.');
  }
  return verified;
};

const sourceSpecialOrderCustomItem = async (req, res, next) => {
  try {
    const requestId = stockRequestId(req);
    const itemId = normalizeString(req.body?.itemId);
    const quantity = parseStrictWholeNumber(req.body?.quantity);
    if (!itemId || quantity === null || quantity < 1) throw createValidationError('Select a custom item and enter a quantity of at least 1.');
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      const previous = (order.fulfillmentOperations || []).find((event) => event.requestId === requestId);
      if (previous) {
        if (previous.action !== 'Source Custom' || previous.itemId !== itemId || previous.quantity !== quantity) {
          throw Object.assign(new Error('This request ID was used for another fulfillment action.'), { status: 409 });
        }
        return { order, replayed: true };
      }
      if (Number(order.workflowVersion) < 2 || order.status !== 'In Progress'
        || !await SpecialOrderPaymentLedger.exists({ specialOrder: order._id }).session(session)) {
        throw Object.assign(new Error('An active order with a recorded down payment is required.'), { status: 409 });
      }
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || quotation.status !== 'Accepted' || String(order.transactionQuotation) !== String(quotation._id)) {
        throw Object.assign(new Error('The accepted quotation changed. Reload before confirming sourcing.'), { status: 409 });
      }
      const matching = quotation.items.filter((item) => item.itemId === itemId && item.itemType === 'custom');
      if (matching.length !== 1) throw createValidationError('Select a custom item from the accepted quotation.');
      const item = matching[0];
      const sourcing = (order.customSourcing || []).find((entry) => entry.itemId === itemId);
      const sourced = Number(sourcing?.sourcedQuantity || 0);
      if (quantity > item.quantity - sourced) throw createValidationError('Sourced quantity exceeds the remaining ordered quantity.');
      const now = new Date();
      if (sourcing) {
        sourcing.sourcedQuantity = sourced + quantity;
        sourcing.updatedAt = now;
        sourcing.updatedBy = req.user._id;
      } else order.customSourcing.push({ itemId, sourcedQuantity: quantity, updatedAt: now, updatedBy: req.user._id });
      order.fulfillmentOperations.push({ requestId, action: 'Source Custom', itemId, quantity, actor: req.user._id, at: now });
      order.updatedBy = req.user._id;
      await order.save({ session });
      await syncRecordedSaleFulfillment(order, session);
      await logQuotationAction(req, 'Confirmed Custom Item Sourcing', `Confirmed ${quantity} ${item.sellingUnit || 'unit(s)'} of ${item.itemName} for ${order.orderNumber}.`, session);
      return { order, replayed: false };
    });
    if (!result.replayed) publishSpecialOrderChange(result.order);
    return res.json({ order: enrichOrder(result.order), availability: await getStockAvailability(result.order), replayed: result.replayed });
  } catch (error) { return quotationActionError(error, res, next); }
};

const completeSpecialOrderProcessing = async (req, res, next) => {
  let session;
  let uploadedDocument = null;
  let documentPersisted = false;

  try {
    let payload = req.body || {};
    if (typeof payload.payload === 'string') {
      try { payload = { ...payload, ...JSON.parse(payload.payload) }; }
      catch { throw createValidationError('Completion details are invalid.'); }
    }
    req.body = payload;
    const requestId = stockRequestId(req);
    const referenceNumber = normalizeString(payload.referenceNumber);
    const quotationId = normalizeString(payload.quotationId);
    if (referenceNumber && (!isValidTransactionReferenceNumber(referenceNumber) || referenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH)) {
      throw createValidationError(referenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH
        ? `Invoice No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.`
        : TRANSACTION_REFERENCE_NUMERIC_MESSAGE);
    }

    const orderForValidation = await findOwnedOrder(req.params.id, req.user);
    const preexistingSale = await findSpecialOrderSale(orderForValidation);
    if (orderForValidation.linkedSaleId && !preexistingSale) {
      throw Object.assign(new Error('The linked Sale needs administrative review.'), { status: 409 });
    }
    if (referenceNumber && !preexistingSale) await prepareSpecialOrderInvoice(referenceNumber);
    if (orderForValidation.status !== 'Completed' && req.file && !preexistingSale) uploadedDocument = await uploadDocument(req.file);

    session = await mongoose.startSession();
    let result;
    await withPostCommitNotifications(session, async () => {
      const order = await lockSpecialOrder(req.params.id, req.user, session);
      // Preserve old completed records as-is. A retry (or a second request)
      // must never re-consume inventory or reinterpret historical handover.
      if (order.status === 'Completed') {
        const completedSale = await findSpecialOrderSale(order, session);
        result = { order, sale: completedSale, saleCreated: false, replayed: true, inventoryLogs: [] };
        return;
      }
      if (order.status !== 'In Progress' || Number(order.workflowVersion) !== 2) {
        throw Object.assign(new Error('Only an active accepted Special Order can be completed through this workflow.'), { status: 409 });
      }
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || quotation.status !== 'Accepted' || String(order.transactionQuotation) !== String(quotation._id)) {
        throw Object.assign(new Error('The current accepted quotation needs review before completion.'), { status: 409 });
      }
      if (quotationId && String(quotationId) !== String(quotation._id)) {
        throw Object.assign(new Error('The accepted quotation changed. Reload before completing this order.'), { status: 409 });
      }
      const ledger = await SpecialOrderPaymentLedger.findOne({ specialOrder: order._id }).session(session);
      await validatePhaseFiveFinancialSale({ order, quotation, session, allowLinkedSale: true, requireFulfillment: false });
      const availability = await getStockAvailability(order, session);
      const inventoryItems = availability.items.filter((item) => item.itemType === 'inventory');
      const alreadyConsumed = inventoryItems.find((item) => Number(item.consumedQuantity || 0) > 0);
      if (alreadyConsumed) {
        throw Object.assign(new Error(`Stock for ${alreadyConsumed.sku} was already consumed and needs administrative review.`), { status: 409 });
      }
      const reservationNeedsReview = inventoryItems.find((item) => item.reservationNeedsReview);
      if (reservationNeedsReview) {
        throw Object.assign(new Error(`The reservation for ${reservationNeedsReview.sku} needs review before completion.`), { status: 409 });
      }
      const shortage = inventoryItems.find((item) => Number(item.shortage || 0) > 0);
      if (shortage) {
        throw Object.assign(new Error(`Insufficient stock for ${shortage.sku}: ${shortage.shortage} more ${shortage.sellingUnit || 'unit(s)'} required. Use the existing Stock In process, then refresh stock.`), { status: 409 });
      }
      if (inventoryItems.length === 0 && await SpecialOrderStockReservation.exists({ specialOrder: order._id, status: 'Active', reservedQuantity: { $gt: 0 } }).session(session)) {
        throw Object.assign(new Error('This Custom-Only order has an unexpected stock reservation and needs administrative review.'), { status: 409 });
      }
      const batchVerifications = validateSpecialOrderBatchVerifications(inventoryItems, payload.batchVerifications || []);

      let sale = await findSpecialOrderSale(order, session);
      let saleCreated = false;
      if (order.linkedSaleId && (!sale || String(order.linkedSaleId) !== String(sale._id))) {
        throw Object.assign(new Error('The linked Sale needs administrative review.'), { status: 409 });
      }
      if (!sale) {
        if (!referenceNumber && !uploadedDocument) throw createValidationError('Provide an Invoice No. or Supporting Document.');
        const recorded = await recordPhaseFiveFinancialSale({
          order, quotation, req, session, referenceNumber, supportingDocument: uploadedDocument, requireFulfillment: false,
        });
        sale = recorded.sale;
        saleCreated = true;
      } else {
        if (sale.saleType !== 'special-order' || sale.paymentStatus !== 'Paid'
          || sale.collectionSource !== 'special_order_ledger'
          || String(sale.specialOrderId || '') !== String(order._id)
          || sale.clientRequestId !== getSpecialOrderClientRequestId(order)
          || !ledger || parseSafeMoneyToCentavos(sale.totalAmount) !== ledger.approvedTotalCentavos) {
          throw Object.assign(new Error('The recorded Sale needs administrative review.'), { status: 409 });
        }
        if (!order.linkedSaleId) {
          order.linkedSaleId = sale._id;
          order.financialRecordedAt = order.financialRecordedAt || sale.createdAt || new Date();
          order.financialRecordedBy = order.financialRecordedBy || sale.cashier?._id || sale.cashier || null;
          order.updatedBy = req.user._id;
          await order.save({ session });
        }
      }

      // Reserve any currently available, unreserved quantities inside this
      // transaction. If stock changed concurrently, the whole completion rolls back.
      if (inventoryItems.length) await applyStockOperation({ order, session, actor: req.user._id, requestId: `completion-reserve:${requestId}`, action: 'Reserve' });
      const inventoryLogs = inventoryItems.length
        ? await consumePhaseFiveStock({ order, quotation, sale, req, session, requestId, batchVerifications }) : [];
      const now = new Date();
      order.fulfillmentOperations.push({ requestId, action: 'Complete Order', quantity: 0, actor: req.user._id, at: now });
      order.updatedBy = req.user._id;
      sale.specialOrderFulfillmentStatus = 'Administrative Closure';
      await sale.save({ session });
      const completed = await markSpecialOrderCompleted({
        order, sale, req, session,
        statusNote: 'Fully paid order completed after accepted quotation, Sale, and inventory validation.',
        activityDetails: `Special Order ${order.orderNumber} completed under Sale ${sale._id} after payment and inventory validation.`,
      });
      result = { order: completed, sale, saleCreated, replayed: false, inventoryLogs };
    });
    documentPersisted = Boolean(uploadedDocument?.key && String(result?.sale?.transactionReference?.supportingDocument?.key || '') === uploadedDocument.key);
    if (!result.replayed) {
      publishSpecialOrderChange(result.order);
      if (result.saleCreated) {
        publishSaleCreated({ saleId: result.sale._id, cashierId: req.user?._id, cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown' });
      }
      for (const log of result.inventoryLogs || []) publishInventoryLogged(log);
      if ((result.inventoryLogs || []).length) publishInventoryUpdated({ reason: 'special-order.completed', productCodes: result.inventoryLogs.map((log) => log.code) });
    }
    return res.json({ ...buildSpecialOrderReceiptResult(result.order, result.sale), availability: await getStockAvailability(result.order), replayed: result.replayed });
  } catch (error) {
    if (error?.code === 11000 && String(error?.message || '').includes('transactionReference.referenceNumber')) {
      return res.status(409).json({ message: 'This invoice number is already used by another transaction.' });
    }
    return quotationActionError(error, res, next);
  } finally {
    if (session) await session.endSession();
    if (uploadedDocument?.key && !documentPersisted) {
      try { await removeDocument(uploadedDocument.key); } catch (error) { console.error('Unable to remove orphan supporting document:', error.message); }
    }
  }
};

const changeSpecialOrderStock = (action) => async (req, res, next) => {
  try {
    const requestId = stockRequestId(req);
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      if (Number(order.workflowVersion) < 2 || order.status !== 'In Progress') {
        throw Object.assign(new Error('Only active Phase 1 Special Orders can reserve or release stock.'), { status: 409 });
      }
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || quotation.status !== 'Accepted' || String(order.transactionQuotation) !== String(quotation._id)) {
        throw Object.assign(new Error('An accepted current quotation is required for stock reservation.'), { status: 409 });
      }
      if (action === 'Reserve' && !quotation.items.some((item) => item.itemType === 'inventory')) {
        throw Object.assign(new Error('This Custom-Only order has no inventory-linked items to reserve.'), { status: 409 });
      }
      if (action === 'Release' && await SpecialOrderPaymentLedger.exists({ specialOrder: order._id }).session(session)) {
        throw Object.assign(new Error('Reservations cannot be manually released after a down payment. Resolve the paid order through an authorized process.'), { status: 409 });
      }
      const operation = await applyStockOperation({ order, session, actor: req.user._id, requestId, action });
      if (!operation.replayed) await syncRecordedSaleFulfillment(order, session);
      if (!operation.replayed) await logQuotationAction(req, `${action} Special Order Stock`, `${action} stock for ${order.orderNumber}: ${operation.changes.length} SKU(s) changed.`, session);
      return { operation, order };
    });
    if (result.operation.changes.length && !result.operation.replayed) {
      publishInventoryUpdated({ reason: 'special-order.reservation', productCodes: [] });
      publishSpecialOrderChange(result.order);
    }
    return res.json({ ...await getStockAvailability(result.order), replayed: result.operation.replayed });
  } catch (error) { return quotationActionError(error, res, next); }
};

const cancelReservedSpecialOrder = async (req, res, next) => {
  try {
    const requestId = stockRequestId(req);
    const reason = normalizeString(req.body?.reason);
    if (!reason || reason.length > 500) throw createValidationError('Enter a cancellation reason of 500 characters or fewer.');
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      if (order.status === 'Cancelled') {
        const replay = await StockOperation.findOne({ specialOrder: order._id, requestId, action: 'Cancel' }).session(session);
        if (replay) return { order, replayed: true, changes: replay.changes };
      }
      if (Number(order.workflowVersion) < 2 || order.status !== 'In Progress' || order.linkedSaleId) {
        throw Object.assign(new Error('Only active Phase 1 Special Orders can be cancelled here.'), { status: 409 });
      }
      if (await SpecialOrderPaymentLedger.exists({ specialOrder: order._id }).session(session)) {
        throw Object.assign(new Error('This order has a collected down payment. Cancellation is paused until an authorized refund or resolution policy is approved; no payment or stock hold has been reversed.'), { status: 409 });
      }
      const operation = await applyStockOperation({ order, session, actor: req.user._id, requestId, action: 'Cancel' });
      order.status = 'Cancelled';
      order.cancelledAt = new Date();
      order.cancelledBy = req.user._id;
      order.cancelledReason = reason;
      order.updatedBy = req.user._id;
      order.statusHistory.push({ status: 'Cancelled', changedBy: req.user._id, note: reason });
      await order.save({ session });
      await logQuotationAction(req, 'Cancelled Special Order', `Cancelled ${order.orderNumber}; active stock holds released. Reason: ${reason}`, session);
      return { order, replayed: false, changes: operation.changes };
    });
    if (!result.replayed) {
      publishSpecialOrderChange(result.order);
      if (result.changes.length) publishInventoryUpdated({ reason: 'special-order.reservation-released', productCodes: [] });
    }
    return res.json({ order: enrichOrder(result.order), availability: await getStockAvailability(result.order), replayed: result.replayed });
  } catch (error) { return quotationActionError(error, res, next); }
};

const quotationActionError = (error, res, next) => {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  if (error?.code === 11000) return res.status(409).json({ message: 'Quotation changed concurrently. Reload and try again.' });
  if (String(error?.message || '').includes('Transaction numbers are only allowed')) {
    return res.status(503).json({ message: 'Special Orders requires a transaction-capable database. Please contact an administrator.' });
  }
  return next(error);
};

const logQuotationAction = (req, action, details, session) => writeActivityLog({
  user: req.user, action, details, session, ipAddress: req.ip, userAgent: req.get('user-agent') || '',
});

const normalizeQuotationMetadata = (input, base = {}) => {
  const details = { ...(base?.toObject?.() || base) };
  for (const field of ['attentionName', 'attentionPosition', 'authorizedSignatoryName']) {
    if (input?.[field] !== undefined) {
      if (typeof input[field] !== 'string' || input[field].trim().length > 150) throw createValidationError('Quotation metadata must be text with at most 150 characters.');
      details[field] = input[field].trim();
    }
  }
  return details;
};

const createInitialQuotation = async (order, customer, metadata, req, session, initialPhotos = null) => {
  const items = quotationItemsFromOrder(order).map((item, index) => initialPhotos ? {
    ...item,
    itemId: initialPhotos.itemIds[index],
    images: initialPhotos.imagesByItem.get(initialPhotos.itemIds[index]) || [],
  } : item);
  const [quotation] = await SpecialOrderQuotation.create([{
    specialOrder: order._id, quotationNumber: quotationNumberFor(order, 1), version: 1,
    customer: order.customer || null, customerName: order.customerName,
    customerDetails: {
      address: normalizeString(customer?.address), contact: normalizeString(customer?.contact), email: normalizeString(customer?.email),
      attentionName: normalizeString(customer?.attentionName), attentionPosition: normalizeString(customer?.attentionPosition), taxTreatment: Number(order.workflowVersion) >= 2 ? order.taxTreatment : customer?.taxTreatment || 'standard',
    },
    quotationDetails: normalizeQuotationMetadata(metadata, { attentionName: normalizeString(customer?.attentionName), attentionPosition: normalizeString(customer?.attentionPosition) }),
    fulfillment: order.fulfillment || null,
    items, ...quotationTotals(items), createdBy: req.user?._id || null,
  }], { session });
  order.currentQuotation = quotation._id;
  order.updatedBy = req.user?._id || null;
  await order.save({ session });
  await logQuotationAction(req, 'Created Special Order Quotation', `Quotation ${quotation.quotationNumber} created for ${order.orderNumber}.`, session);
  return quotation;
};

// A retry returns the committed document; it must never silently convert a legacy draft.
const specialOrderCreationResponse = async (order, generateQuotation) => {
  if (!generateQuotation) return enrichOrder(order);
  const quotation = await getCurrentQuotation(order);
  if (!quotation?.documentSnapshot || quotation.status === 'Draft') {
    throw Object.assign(new Error('This request already belongs to an unfinished quotation. Open View Details to complete it.'), { status: 409 });
  }
  return { ...enrichOrder(order), quotation: quotationResponse(quotation) };
};

const listSpecialOrderQuotations = async (req, res, next) => {
  try {
    const order = await findOwnedOrder(req.params.id, req.user);
    const quotations = await SpecialOrderQuotation.find({ specialOrder: order._id }).sort({ version: -1 })
      .populate('createdBy issuedBy decidedBy', 'name displayName username');
    return res.json(quotations.map(quotationResponse));
  } catch (error) { return quotationActionError(error, res, next); }
};

const getSpecialOrderQuotationDocument = async (req, res, next) => {
  try {
    const order = await findOwnedOrder(req.params.id, req.user);
    const quotation = await SpecialOrderQuotation.findOne({ _id: req.params.quotationId, specialOrder: order._id }).lean();
    if (!quotation) return res.status(404).json({ message: 'Quotation version not found for this Special Order.' });
    if (!quotation.documentSnapshot) {
      return res.status(409).json({ message: quotation.status === 'Draft'
        ? 'Generate Quotation from Edit Draft before previewing or downloading this version.'
        : 'The historical document snapshot is unavailable. Please request administrative review; current settings will not replace historical document data.' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.json(quotation.documentSnapshot);
  } catch (error) { return quotationActionError(error, res, next); }
};

const uploadSpecialOrderQuotationImages = async (req, res, next) => {
  const uploaded = [];
  let committed = false;
  try {
    if (!Array.isArray(req.files) || req.files.length < 1) throw createValidationError('Choose at least one product photo to upload.');
    if (req.files.length > 3) throw createValidationError('A product can have at most 3 photos.');
    const replaceKey = normalizeString(req.body?.replaceKey);
    if (replaceKey && req.files.length !== 1) throw createValidationError('Select exactly one replacement photo.');
    for (const file of req.files) uploaded.push(await uploadQuotationImage(file));
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      ensureOrderCanHaveQuotation(order);
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || String(quotation._id) !== String(req.params.quotationId) || quotation.status !== 'Draft') throw Object.assign(new Error('Only the current draft quotation can be changed. Reload this order.'), { status: 409 });
      const item = quotation.items.find((entry) => String(entry.itemId) === String(req.params.itemId));
      if (!item) throw createValidationError('Quotation product was not found. Save or reload the draft and try again.');
      if (replaceKey) {
        const position = item.images.findIndex((image) => String(image.key) === replaceKey);
        if (position < 0) throw createValidationError('The photo to replace is no longer in this draft. Reload and retry.');
        item.images.splice(position, 1, uploaded[0]);
      } else {
        if ((item.images?.length || 0) + uploaded.length > 3) throw createValidationError(`Product ${item.itemName} can have at most 3 photos.`);
        item.images.push(...uploaded);
      }
      await quotation.save({ session });
      await logQuotationAction(req, replaceKey ? 'Replaced Special Order Product Photo' : 'Uploaded Special Order Product Photos', `${uploaded.length} product photo(s) ${replaceKey ? 'replaced in' : 'added to'} ${quotation.quotationNumber}.`, session);
      return quotation;
    });
    committed = true;
    if (replaceKey) {
      try { await removeQuotationImageIfUnreferenced(replaceKey); }
      catch (error) { console.error('Unable to check or remove replaced quotation product photo:', error.message); }
    }
    publishSpecialOrderChange({ _id: req.params.id });
    return res.status(201).json(quotationResponse(result));
  } catch (error) {
    if (!committed) await Promise.all(uploaded.map(async (image) => {
      try { await removeQuotationImageIfUnreferenced(image.key); }
      catch (cleanupError) { console.error('Unable to verify cleanup for failed product photo upload:', cleanupError.message); }
    }));
    return quotationActionError(error, res, next);
  }
};

const removeQuotationImageIfUnreferenced = async (key) => {
  // The current draft may share a photo with immutable issued revisions.
  if (String(key || '').startsWith('product-')) return;
  const stillReferenced = await SpecialOrderQuotation.exists({ $or: [
    { 'items.images.key': key },
    { 'documentSnapshot.items.images.key': key },
  ] });
  if (!stillReferenced) await removeQuotationImage(key);
};

const removeSpecialOrderQuotationImage = async (req, res, next) => {
  try {
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      ensureOrderCanHaveQuotation(order);
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || String(quotation._id) !== String(req.params.quotationId) || quotation.status !== 'Draft') throw Object.assign(new Error('Only the current draft quotation can be changed. Reload this order.'), { status: 409 });
      const item = quotation.items.find((entry) => String(entry.itemId) === String(req.params.itemId));
      if (!item) throw createValidationError('Quotation product was not found.');
      const image = item.images.find((entry) => String(entry.key) === String(req.params.imageKey));
      if (!image) throw createValidationError('Product photo was not found.');
      item.images = item.images.filter((entry) => String(entry.key) !== String(req.params.imageKey));
      await quotation.save({ session });
      await logQuotationAction(req, 'Removed Special Order Product Photo', `A product photo was removed from ${quotation.quotationNumber}.`, session);
      return { quotation, image };
    });
    try {
      // Revisions can share immutable photo keys with older issued snapshots.
      await removeQuotationImageIfUnreferenced(result.image.key);
    } catch (error) { console.error('Unable to check or remove quotation product photo:', error.message); }
    publishSpecialOrderChange({ _id: req.params.id });
    return res.json(quotationResponse(result.quotation));
  } catch (error) { return quotationActionError(error, res, next); }
};

const getSpecialOrderQuotationImage = async (req, res, next) => {
  try {
    const order = await findOwnedOrder(req.params.id, req.user);
    const quotation = await SpecialOrderQuotation.findOne({ _id: req.params.quotationId, specialOrder: order._id }).lean();
    if (!quotation) return res.status(404).json({ message: 'Quotation version not found for this Special Order.' });
    const sourceItems = quotation.documentSnapshot?.items || quotation.items || [];
    const item = sourceItems.find((entry) => String(entry.itemId) === String(req.params.itemId));
    const image = item?.images?.find((entry) => String(entry.key) === String(req.params.imageKey));
    if (!image) return res.status(404).json({ message: 'Quotation product photo is not available.' });
    if (image.sourceProductId) {
      const product = await Product.findById(image.sourceProductId).lean();
      const source = productImageSources(product).find((entry) => entry.imageIndex === Number(image.sourceImageIndex));
      if (!source) return res.status(404).json({ message: 'The saved Product Master image is no longer available.' });
      const dataImage = parseProductDataImage(source.sourceUrl);
      if (dataImage) {
        res.set('Cache-Control', 'private, no-store');
        res.type(dataImage.mimeType);
        return res.send(dataImage.buffer);
      }
      if (image.sourceUrl && image.sourceUrl !== source.sourceUrl) return res.status(409).json({ message: 'The Product Master image changed after this quotation was prepared.' });
      if (/^https?:\/\//i.test(source.sourceUrl) || source.sourceUrl.startsWith('/')) return res.redirect(302, source.sourceUrl);
      return res.status(404).json({ message: 'The saved Product Master image is no longer available.' });
    }
    const stored = await getQuotationImage(image.key);
    if (!stored) return res.status(404).json({ message: 'Quotation product photo is not available.' });
    res.set('Cache-Control', 'private, no-store'); res.type(image.mimeType);
    if (stored.type === 'local') return res.sendFile(stored.filePath);
    const body = stored.object?.Body;
    if (typeof body?.pipe === 'function') { body.on('error', next); body.pipe(res); return undefined; }
    if (typeof body?.transformToByteArray === 'function') return res.send(Buffer.from(await body.transformToByteArray()));
    return res.status(404).json({ message: 'Quotation product photo is not available.' });
  } catch (error) {
    if (isObjectNotFoundError(error)) return res.status(404).json({ message: 'Quotation product photo is not available.' });
    return quotationActionError(error, res, next);
  }
};

const prepareSpecialOrderQuotation = async (req, res, next) => {
  try {
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      ensureOrderCanHaveQuotation(order);
      const current = await getCurrentQuotation(order, session);
      if (current) {
        if (!order.currentQuotation) {
          order.currentQuotation = current._id;
          await order.save({ session });
        }
        return { quotation: current, created: false };
      }
      const historyExists = await SpecialOrderQuotation.exists({ specialOrder: order._id }).session(session);
      if (historyExists) throw Object.assign(new Error('Quotation history has no current version. Please request administrative review.'), { status: 409 });
      const customer = order.customer ? await Partner.findById(order.customer).session(session) : null;
      const quotation = await createInitialQuotation(order, customer, null, req, session);
      return { quotation, created: true };
    });
    publishSpecialOrderChange({ _id: req.params.id });
    return res.status(result.created ? 201 : 200).json(quotationResponse(result.quotation));
  } catch (error) { return quotationActionError(error, res, next); }
};

const mutateCurrentQuotation = async (req, res, next, allowedStatuses, operation) => {
  try {
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      ensureOrderCanHaveQuotation(order);
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || String(quotation._id) !== String(req.params.quotationId)) {
        throw Object.assign(new Error('Only the current quotation can be changed. Reload this order.'), { status: 409 });
      }
      if (!allowedStatuses.includes(quotation.status)) {
        throw Object.assign(new Error('Quotation is no longer eligible for this action. Reload this order.'), { status: 409 });
      }
      return operation(order, quotation, session);
    });
    for (const key of result.cleanupKeys || []) {
      try { await removeQuotationImageIfUnreferenced(key); }
      catch (error) { console.error('Unable to check or remove discarded quotation product photo:', error.message); }
    }
    publishSpecialOrderChange({ _id: req.params.id });
    return res.status(result.created ? 201 : 200).json(quotationResponse(result.quotation));
  } catch (error) { return quotationActionError(error, res, next); }
};

const updateSpecialOrderQuotation = (req, res, next) => mutateCurrentQuotation(req, res, next, ['Draft'], async (order, quotation, session) => {
  const requestedItems = Number(order.workflowVersion) >= 2
    ? await Promise.all((req.body?.items || []).map((item) => normalizePhaseOneItem(item, quotation.items.find((saved) => saved.itemId === item.itemId), req.user)))
    : req.body?.items;
  const items = normalizeQuotationItems(requestedItems, quotation.items);
  const fulfillment = Number(order.workflowVersion) >= 2 ? normalizeFulfillment(req.body?.fulfillment) : quotation.fulfillment;
  const taxTreatment = Number(order.workflowVersion) >= 2
    ? normalizePhaseOneTaxTreatment(req.body?.taxTreatment ?? quotation.customerDetails?.taxTreatment)
    : quotation.customerDetails?.taxTreatment;
  const retainedKeys = new Set(items.flatMap((item) => item.images.map((image) => image.key)));
  const cleanupKeys = quotation.items.flatMap((item) => (item.images || []).map((image) => image.key)).filter((key) => !retainedKeys.has(key));
  const quotationDetails = normalizeQuotationMetadata(req.body?.quotationDetails, quotation.quotationDetails);
  const updated = await SpecialOrderQuotation.findOneAndUpdate({
    _id: quotation._id, specialOrder: order._id, isCurrent: true, status: 'Draft',
  }, { $set: { items, quotationDetails, fulfillment, ...(Number(order.workflowVersion) >= 2 ? { 'customerDetails.taxTreatment': taxTreatment } : {}), ...quotationTotals(items) } }, { session, returnDocument: 'after', runValidators: true });
  if (!updated) throw Object.assign(new Error('Quotation draft changed concurrently.'), { status: 409 });
  if (Number(order.workflowVersion) >= 2) {
    order.fulfillment = fulfillment;
    order.taxTreatment = taxTreatment;
    await order.save({ session });
  }
  await logQuotationAction(req, 'Updated Special Order Quotation', `Draft quotation ${updated.quotationNumber} updated.`, session);
  return { quotation: updated, cleanupKeys };
});

const generateSpecialOrderQuotation = async (order, quotation, req, session, { allowMissingPhotos = false } = {}) => {
  validateQuotationAmounts(quotation);
  if (!allowMissingPhotos) {
    const missingPhoto = quotation.items.find((item) => !Array.isArray(item.images) || item.images.length < 1);
    if (missingPhoto) throw createValidationError(`Add at least one product photo for ${missingPhoto.itemName} before generating the quotation.`);
  }
  const issuedAt = new Date();
  const settings = await Setting.findOne({ singletonKey: 'default' }).session(session).lean();
  const documentSnapshot = createSpecialOrderQuotationDocument({ order, quotation, settings, issuedAt });
  const updated = await SpecialOrderQuotation.findOneAndUpdate({
    _id: quotation._id, specialOrder: order._id, isCurrent: true, status: 'Draft',
  }, { $set: { status: 'Awaiting Decision', issuedBy: req.user._id, issuedAt, documentSnapshot } }, { session, returnDocument: 'after', runValidators: true });
  if (!updated) throw Object.assign(new Error('Quotation was already issued.'), { status: 409 });
  await logQuotationAction(req, 'Issued Special Order Quotation', `Quotation ${updated.quotationNumber} was marked as issued.`, session);
  return updated;
};

const issueSpecialOrderQuotation = (req, res, next) => mutateCurrentQuotation(req, res, next, ['Draft'], async (order, quotation, session) => ({
  quotation: await generateSpecialOrderQuotation(order, quotation, req, session),
}));

const decideSpecialOrderQuotation = async (req, res, next) => {
  try {
    const input = normalizeString(req.body?.decision).toLowerCase();
    if (!['accepted', 'declined'].includes(input)) throw createValidationError('Choose Accepted or Declined.');
    const decision = input === 'accepted' ? 'Accepted' : 'Declined';
    const result = await withSpecialOrderTransaction(req, async (order, session) => {
      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || String(quotation._id) !== String(req.params.quotationId)) throw Object.assign(new Error('Only the current quotation can receive a decision.'), { status: 409 });
      // A lost response or repeated click must not change the original decision audit.
      if (quotation.status === decision && quotation.decision === decision) return { order, quotation };
      if (quotation.status !== 'Awaiting Decision' || !['Pending', 'In Progress'].includes(order.status) || order.linkedSaleId) throw Object.assign(new Error('The customer decision is final or this request is no longer eligible.'), { status: 409 });
      validateQuotationAmounts(quotation);
      const decidedAt = new Date();
      const updated = await SpecialOrderQuotation.findOneAndUpdate({
        _id: quotation._id, specialOrder: order._id, isCurrent: true, status: 'Awaiting Decision',
      }, { $set: { status: decision, decision, decidedBy: req.user._id, decidedAt } }, { session, returnDocument: 'after', runValidators: true });
      if (!updated) throw Object.assign(new Error('A customer decision was already recorded.'), { status: 409 });
      order.updatedBy = req.user._id;
      if (decision === 'Accepted') {
        order.status = 'In Progress';
        order.transactionQuotation = quotation._id;
        order.transactionStartedAt = decidedAt;
        order.transactionStartedBy = req.user._id;
      } else {
        order.status = 'Cancelled';
        order.cancelledAt = decidedAt;
        order.cancelledBy = req.user._id;
        order.cancelledReason = normalizeString(req.body?.reason);
        order.transactionQuotation = null;
        order.transactionStartedAt = null;
        order.transactionStartedBy = null;
      }
      order.statusHistory.push({ status: order.status, changedBy: req.user._id, changedAt: decidedAt, note: `${decision} quotation ${quotation.quotationNumber}.${order.cancelledReason ? ` ${order.cancelledReason}` : ''}` });
      await order.save({ session });
      await logQuotationAction(req, 'Recorded Special Order Quotation Decision', `Customer ${decision.toLowerCase()} quotation ${updated.quotationNumber}.`, session);
      return { order, quotation: updated };
    });
    publishSpecialOrderChange(result.order);
    return res.json({ ...quotationResponse(result.quotation), order: enrichOrder(result.order) });
  } catch (error) { return quotationActionError(error, res, next); }
};

const reviseSpecialOrderQuotation = (req, res, next) => mutateCurrentQuotation(req, res, next, ['Awaiting Decision'], async (order, quotation, session) => {
  const superseded = await SpecialOrderQuotation.findOneAndUpdate({
    _id: quotation._id, specialOrder: order._id, isCurrent: true, status: quotation.status,
  }, { $set: { isCurrent: false, status: 'Superseded' } }, { session, returnDocument: 'after' });
  if (!superseded) throw Object.assign(new Error('Quotation was already revised.'), { status: 409 });
  const items = normalizeQuotationItems(quotation.items, quotation.items);
  const [revision] = await SpecialOrderQuotation.create([{
    specialOrder: order._id,
    quotationNumber: quotationNumberFor(order, quotation.version + 1),
    version: quotation.version + 1,
    status: 'Draft', isCurrent: true,
    customer: quotation.customer, customerName: quotation.customerName, customerDetails: quotation.customerDetails,
    quotationDetails: quotation.quotationDetails,
    fulfillment: quotation.fulfillment || null,
    items, ...quotationTotals(items), createdBy: req.user._id, revisionOf: quotation._id,
  }], { session });
  order.currentQuotation = revision._id;
  order.transactionQuotation = null;
  order.transactionStartedAt = null;
  order.transactionStartedBy = null;
  if (order.status === 'In Progress') {
    order.status = 'Pending';
    order.statusHistory.push({ status: 'Pending', changedBy: req.user._id, note: 'Quotation revised; a fresh customer decision is required.' });
  }
  order.updatedBy = req.user._id;
  await order.save({ session });
  await logQuotationAction(req, 'Revised Special Order Quotation', `Quotation ${quotation.quotationNumber} revised as ${revision.quotationNumber}.`, session);
  return { quotation: revision, created: true };
});

// Recording the financial Sale is separate from physical readiness and issuance.
const finalizeSpecialOrder = async (req, res, next) => {
  let session;
  let uploadedDocument = null;
  let documentPersisted = false;

  try {
    const rawPayload = req.body?.payload;
    if (typeof rawPayload !== 'string') return res.status(400).json({ message: 'Final transaction payload is required.' });
    const payload = JSON.parse(rawPayload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ message: 'Final transaction payload is invalid.' });
    }

    const referenceNumber = normalizeString(payload.referenceNumber);
    const quotationId = normalizeString(payload.quotationId);
    if (referenceNumber && (!isValidTransactionReferenceNumber(referenceNumber) || referenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH)) {
      return res.status(400).json({ message: referenceNumber.length > TRANSACTION_REFERENCE_MAX_LENGTH
        ? `Invoice No. must be ${TRANSACTION_REFERENCE_MAX_LENGTH} characters or fewer.`
        : TRANSACTION_REFERENCE_NUMERIC_MESSAGE });
    }
    if (!referenceNumber && !req.file) {
      return res.status(400).json({ message: 'Provide an Invoice No. or Supporting Document.' });
    }

    const orderForValidation = await SpecialOrder.findById(req.params.id);
    if (!orderForValidation) return res.status(404).json({ message: 'Special order not found.' });
    ensureCashierOwnsSpecialOrder({ order: orderForValidation, user: req.user });
    if (Number(orderForValidation.workflowVersion) < 2 && orderForValidation.items?.some((item) => item.itemType === 'inventory')) throw phaseOneCompletionError();

    const existingSale = await findSpecialOrderSale(orderForValidation);
    if (existingSale) {
      if (Number(orderForValidation.workflowVersion) >= 2) {
        if (String(orderForValidation.linkedSaleId || '') !== String(existingSale._id)) return res.status(409).json({ message: 'A Sale exists without a matching Special Order link. Administrative review is required.' });
        return res.status(200).json(buildSpecialOrderReceiptResult(orderForValidation, existingSale));
      }
      if (orderForValidation.status === 'Completed') return res.status(200).json(buildSpecialOrderReceiptResult(orderForValidation, existingSale));
      const recovered = await recoverSpecialOrderCompletion({ orderId: req.params.id, req });
      if (!recovered) return res.status(409).json({ message: 'Special order completion needs administrative review.' });
      publishSpecialOrderChange(recovered.order);
      return res.status(200).json(buildSpecialOrderReceiptResult(recovered.order, recovered.sale));
    }

    if (orderForValidation.status !== 'In Progress') {
      return res.status(400).json({ message: 'Only In Progress special orders can be completed.' });
    }

    const acceptedQuotation = await getCurrentQuotation(orderForValidation);
    if (!acceptedQuotation || acceptedQuotation.status !== 'Accepted' || !quotationId || String(acceptedQuotation._id) !== quotationId) {
      return res.status(400).json({ message: 'The current accepted quotation is required to finalize this special order.' });
    }
    validateQuotationAmounts(acceptedQuotation);
    if (String(orderForValidation.transactionQuotation || '') !== quotationId) {
      return res.status(409).json({ message: 'The accepted quotation does not match the activated order. Request administrative review.' });
    }

    if (referenceNumber) await prepareSpecialOrderInvoice(referenceNumber);
    if (req.file) uploadedDocument = await uploadDocument(req.file);
    session = await mongoose.startSession();
    let result;
    await withPostCommitNotifications(session, async () => {
      const order = await lockSpecialOrder(req.params.id, req.user, session);
      if (Number(order.workflowVersion) < 2 && order.items?.some((item) => item.itemType === 'inventory')) throw phaseOneCompletionError();

      const saleAlreadyCreated = await findSpecialOrderSale(order, session);
      if (saleAlreadyCreated) {
        if (Number(order.workflowVersion) >= 2) {
          if (String(order.linkedSaleId || '') !== String(saleAlreadyCreated._id)) throw Object.assign(new Error('This Sale exists without a matching Special Order link. Administrative review is required.'), { status: 409 });
          result = { order, sale: saleAlreadyCreated, saleCreated: false, inventoryLogs: [] };
          return;
        }
        const completedOrder = order.status === 'Completed'
          ? order
          : await markSpecialOrderCompleted({ order, sale: saleAlreadyCreated, req, session });
        result = { order: completedOrder, sale: saleAlreadyCreated, saleCreated: false };
        return;
      }
      if (order.status !== 'In Progress') throw Object.assign(new Error('Only In Progress special orders can be completed.'), { status: 400 });

      const quotation = await getCurrentQuotation(order, session);
      if (!quotation || quotation.status !== 'Accepted' || String(quotation._id) !== quotationId) {
        throw Object.assign(new Error('The current accepted quotation is required to finalize this special order.'), { status: 400 });
      }
      validateQuotationAmounts(quotation);
      if (String(order.transactionQuotation || '') !== quotationId) {
        throw Object.assign(new Error('The accepted quotation does not match the activated order. Request administrative review.'), { status: 409 });
      }

      if (Number(order.workflowVersion) >= 2) {
        const { sale } = await recordPhaseFiveFinancialSale({ order, quotation, req, session, referenceNumber, supportingDocument: uploadedDocument });
        result = { order, sale, saleCreated: true, inventoryLogs: [] };
        return;
      }

      await assertSpecialOrderInvoiceAvailable(referenceNumber, session);
      const [sale] = await Sale.create([buildSalePayload(order, req, { referenceNumber, supportingDocument: uploadedDocument, quotation })], { session });
      const completedOrder = await markSpecialOrderCompleted({ order, sale, req, session });
      result = { order: completedOrder, sale, saleCreated: true, inventoryLogs: [] };
    });
    documentPersisted = Boolean(uploadedDocument?.key && String(result?.sale?.transactionReference?.supportingDocument?.key || '') === uploadedDocument.key);

    if (result?.saleCreated) {
      publishSaleCreated({ saleId: result.sale._id, cashierId: req.user?._id, cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown' });
      for (const log of result.inventoryLogs || []) publishInventoryLogged(log);
      if (Number(result.order?.workflowVersion) >= 2 && result.sale.items?.some((item) => item.product)) publishInventoryUpdated({ reason: 'special-order.finalized', productCodes: result.sale.items.filter((item) => item.product).map((item) => item.code) });
    }
    publishSpecialOrderChange(result.order);
    return res.status(result.saleCreated ? 201 : 200).json(buildSpecialOrderReceiptResult(result.order, result.sale));
  } catch (error) {
    if (isDuplicateClientRequestIdError(error)) {
      try {
        const recovered = await recoverSpecialOrderCompletion({ orderId: req.params.id, req });
        if (recovered) {
          documentPersisted = Boolean(uploadedDocument?.key && String(recovered.sale?.transactionReference?.supportingDocument?.key || '') === uploadedDocument.key);
          return res.status(200).json(buildSpecialOrderReceiptResult(recovered.order, recovered.sale));
        }
      } catch (recoveryError) { return quotationActionError(recoveryError, res, next); }
    }
    if (error?.code === 11000 && String(error?.message || '').includes('transactionReference.referenceNumber')) {
      return res.status(409).json({ message: 'This invoice number is already used by another transaction.' });
    }
    return quotationActionError(error, res, next);
  } finally {
    if (session) await session.endSession();
    if (uploadedDocument?.key && !documentPersisted) {
      try { await removeDocument(uploadedDocument.key); } catch (error) { console.error('Unable to remove orphan supporting document:', error.message); }
    }
  }
};

const completeSpecialOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  const completeWithSession = async (orderId) => {
    const order = await SpecialOrder.findById(orderId).session(session);
    if (!order) {
      const error = new Error('Special order not found.');
      error.status = 404;
      throw error;
    }

    ensureCashierOwnsSpecialOrder({ order, user: req.user });
    if (Number(order.workflowVersion) >= 2 || order.items?.some((item) => item.itemType === 'inventory')) throw phaseOneCompletionError();

    if (order.status === 'Cancelled') {
      const error = new Error('Cancelled special orders cannot be completed.');
      error.status = 400;
      throw error;
    }

    if (order.status === 'Completed') {
      const sale = await findSpecialOrderSale(order, session);
      return { order, sale, saleCreated: false };
    }

    if (order.status !== 'In Progress') {
      const error = new Error('Only In Progress special orders can be completed.');
      error.status = 400;
      throw error;
    }

    const existingSale = await findSpecialOrderSale(order, session);
    if (existingSale) {
      const completedOrder = await markSpecialOrderCompleted({ order, sale: existingSale, req, session });
      return { order: completedOrder, sale: existingSale, saleCreated: false };
    }

    const [sale] = await Sale.create([buildSalePayload(order, req)], { session });
    const completedOrder = await markSpecialOrderCompleted({ order, sale, req, session });

    return { order: completedOrder, sale, saleCreated: true };
  };

  try {
    const { id } = req.params;
    const result = await withPostCommitNotifications(session, async () => completeWithSession(id));

    if (result.saleCreated && result.sale?._id) {
      publishSaleCreated({
        saleId: result.sale._id,
        cashierId: req.user?._id,
        cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown',
      });
    }

    publishSpecialOrderChange(result.order);

    return res.json(buildSpecialOrderReceiptResult(result.order, result.sale));
  } catch (error) {
    if (isDuplicateClientRequestIdError(error)) {
      try {
        const recovered = await recoverSpecialOrderCompletion({ orderId: req.params.id, req });
        if (recovered) {
          publishSpecialOrderChange(recovered.order);
          return res.json(buildSpecialOrderReceiptResult(recovered.order, recovered.sale));
        }
      } catch (recoveryError) {
        if (recoveryError?.status) {
          return res.status(recoveryError.status).json({ message: recoveryError.message });
        }
        return next(recoveryError);
      }
    }

    const message = String(error?.message || '').toLowerCase();
    const transactionUnsupported = message.includes('transaction numbers are only allowed on a replica set member or mongos');

    if (!transactionUnsupported) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      return next(error);
    }

    try {
      const order = await SpecialOrder.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ message: 'Special order not found.' });
      }

      ensureCashierOwnsSpecialOrder({ order, user: req.user });

      if (order.status === 'Cancelled') {
        // Legacy no-transaction fallback still runs the same completion guard.
        return res.status(400).json({ message: 'Cancelled special orders cannot be completed.' });
      }
      if (Number(order.workflowVersion) >= 2 || order.items?.some((item) => item.itemType === 'inventory')) throw phaseOneCompletionError();

      if (order.status === 'Completed') {
        const sale = await findSpecialOrderSale(order);
        return res.json(buildSpecialOrderReceiptResult(order, sale));
      }

      if (order.status !== 'In Progress') {
        return res.status(400).json({ message: 'Only In Progress special orders can be completed.' });
      }

      const existingSale = await findSpecialOrderSale(order);
      if (existingSale) {
        const completedOrder = await markSpecialOrderCompleted({ order, sale: existingSale, req });
        publishSpecialOrderChange(completedOrder);
        return res.json(buildSpecialOrderReceiptResult(completedOrder, existingSale));
      }

      const [sale] = await Sale.create([buildSalePayload(order, req)]);
      const completedOrder = await markSpecialOrderCompleted({ order, sale, req });

      publishSaleCreated({
        saleId: sale._id,
        cashierId: req.user?._id,
        cashierName: req.user.name || req.user.displayName || req.user.username || 'Unknown',
      });
      publishSpecialOrderChange(completedOrder);

      return res.json(buildSpecialOrderReceiptResult(completedOrder, sale));
    } catch (fallbackError) {
      if (isDuplicateClientRequestIdError(fallbackError)) {
        try {
          const recovered = await recoverSpecialOrderCompletion({ orderId: req.params.id, req });
          if (recovered) {
            publishSpecialOrderChange(recovered.order);
            return res.json(buildSpecialOrderReceiptResult(recovered.order, recovered.sale));
          }
        } catch (recoveryError) {
          if (recoveryError?.status) {
            return res.status(recoveryError.status).json({ message: recoveryError.message });
          }
          return next(recoveryError);
        }
      }

      if (fallbackError?.status) {
        return res.status(fallbackError.status).json({ message: fallbackError.message });
      }
      return next(fallbackError);
    } finally {
      await session.endSession();
    }
  } finally {
    await session.endSession();
  }
};

module.exports = {
  listSpecialOrders,
  getSpecialOrderReceipt,
  createSpecialOrder,
  updateSpecialOrder,
  updateSpecialOrderStatus,
  getSpecialOrderStockAvailability,
  getSpecialOrderPayments,
  listSpecialOrderCollections,
  recordSpecialOrderDownPayment,
  recordSpecialOrderAdditionalPayment,
  getSpecialOrderPaymentProof,
  sourceSpecialOrderCustomItem,
  completeSpecialOrderProcessing,
  reserveSpecialOrderStock: changeSpecialOrderStock('Reserve'),
  releaseSpecialOrderStock: changeSpecialOrderStock('Release'),
  cancelReservedSpecialOrder,
  listSpecialOrderQuotations,
  getSpecialOrderQuotationDocument,
  getSpecialOrderQuotationImage,
  prepareSpecialOrderQuotation,
  updateSpecialOrderQuotation,
  uploadSpecialOrderQuotationImages,
  removeSpecialOrderQuotationImage,
  issueSpecialOrderQuotation,
  decideSpecialOrderQuotation,
  reviseSpecialOrderQuotation,
  finalizeSpecialOrder,
  completeSpecialOrder,
  __test: {
    buildSalePayload,
    buildSpecialOrderReceiptResult,
    getSpecialOrderClientRequestId,
    validateSpecialOrderBatchVerifications,
    consumePhaseFiveStock,
    parseDownPaymentPercentageBasisPoints,
    calculateDownPaymentCentavos,
  },
};
