import { apiBlobRequest, apiRequest } from './apiClient';
import { getStockStatus } from '../utils/recommendationLogic';

const toStatus = (stock) => {
  return getStockStatus({ stock });
};

const getAttributeRecord = (product) => (
  product?.attributes instanceof Map
    ? Object.fromEntries(product.attributes)
    : (product?.attributes && typeof product.attributes === 'object' ? product.attributes : {})
);

const getAttributeValue = (attributes, keys) => keys
  .map((key) => Object.entries(attributes).find(([attributeKey]) => String(attributeKey).toLowerCase() === key.toLowerCase())?.[1])
  .map((value) => String(value || '').trim())
  .find(Boolean) || '';

const isPackagingVolume = (value) => /^\d+(?:\.\d+)?\s*(?:gallon|gallons|liter|liters|can|pcs)$/i.test(String(value || '').trim());

export const mapApiProductToUi = (product) => {
  const attributes = getAttributeRecord(product);
  const normalizedSize = [
    product?.size,
    attributes.size,
    attributes.spec,
    attributes.variant_name,
    attributes.variantName,
    attributes.dimension,
    attributes.dimensions,
    attributes.length,
    attributes.thickness,
    product?.spec,
    product?.dimension,
    product?.length,
    product?.thickness,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && !isPackagingVolume(value)) || '';
  const normalizedColor = String(product?.color || getAttributeValue(attributes, ['color', 'shade']) || '').trim();

  return {
  id: product._id,
  code: product.sku,
  name: product.name,
  brand: product.brand || '',
  color: normalizedColor,
  size: normalizedSize,
  length: product.length || attributes.length || '',
  thickness: product.thickness || attributes.thickness || '',
  spec: product.spec || attributes.spec || '',
  dimension: product.dimension || attributes.dimension || '',
  variantName: product.variantName || product.variant_name || attributes.variantName || attributes.variant_name || '',
  attributes,
  supplier: product.supplierName || product.supplier || '',
  imageUrl: product.imageUrl || product.image || '',
  images: Array.isArray(product.images) ? product.images : (Array.isArray(product.imageUrls) ? product.imageUrls : []),
  category: product.category || 'General',
  sellingUnit: product.sellingUnit || '',
  expiryTrackingEnabled: product.expiryTrackingEnabled === true,
  expiryTrackingPeriodId: product.expiryTrackingPeriodId || null,
  expiryBatchReconciled: product.expiryBatchReconciled === true,
  expiryBatchReconciledAt: product.expiryBatchReconciledAt || null,
  expiryUnassignedStock: Number(product.expiryUnassignedStock || 0),
  ...(product.maxStock === undefined || product.maxStock === null || product.maxStock === '' ? {} : { maxStock: Number(product.maxStock) }),
  ...(product.reorderLevel === undefined || product.reorderLevel === null || product.reorderLevel === '' ? {} : { reorderLevel: Number(product.reorderLevel) }),
  ...(product.lowStockThreshold === undefined || product.lowStockThreshold === null || product.lowStockThreshold === '' ? {} : { lowStockThreshold: Number(product.lowStockThreshold) }),
  initialStockBatch: product.initialStockBatch || null,
  price: Number(product.price || 0),
  ...(product.purchaseCost === undefined || product.purchaseCost === null || product.purchaseCost === ''
    ? {}
    : { purchaseCost: Number(product.purchaseCost) }),
  recommendationPriceValid: ['number', 'string'].includes(typeof product.price) && String(product.price).trim() !== '' && Number.isFinite(Number(product.price)) && Number(product.price) >= 0,
  stock: Number(product.stock || 0),
  reservedStock: Number(product.reservedStock || 0),
  availableToSell: product.isActive === false ? 0 : Math.max(0, Number(product.availableToSell ?? (Number(product.stock || 0) - Number(product.reservedStock || 0)))),
  status: toStatus(Number(product.stock || 0)),
  manualAlternatives: Array.isArray(product.manualAlternatives) ? product.manualAlternatives : [],
  excludedAlternatives: Array.isArray(product.excludedAlternatives) ? product.excludedAlternatives : [],
  manualBudgetOptions: Array.isArray(product.manualBudgetOptions) ? product.manualBudgetOptions : [],
  excludedBudgetOptions: Array.isArray(product.excludedBudgetOptions) ? product.excludedBudgetOptions : [],
  recommendationBases: Array.isArray(product.recommendationBases) ? product.recommendationBases : [],
  recommendationReviews: Array.isArray(product.recommendationReviews) ? product.recommendationReviews : [],
  recommendationRevision: Number(product.recommendationRevision || 0),
  isActive: product.isActive,
  isArchived: product.isActive === false,
  createdAt: product.createdAt || null,
  updatedAt: product.updatedAt || null,
  };
};

const mapUiProductToApi = (product) => ({
  name: product.name,
  sku: product.code,
  category: product.category,
  stock: Number(product.stock || 0),
  price: Number(product.price || 0),
  ...(Object.prototype.hasOwnProperty.call(product || {}, 'purchaseCost')
    ? { purchaseCost: product.purchaseCost === '' || product.purchaseCost === null ? null : Number(product.purchaseCost) }
    : {}),
  brand: product.brand || '',
  color: product.color || '',
  size: product.size || '',
  attributes: product.attributes || {},
  supplierName: product.supplier || '',
  ...(Object.prototype.hasOwnProperty.call(product || {}, 'imageUrl') ? { imageUrl: product.imageUrl || '' } : {}),
  sellingUnit: product.sellingUnit || '',
  ...(Object.prototype.hasOwnProperty.call(product || {}, 'expiryTrackingEnabled')
    ? { expiryTrackingEnabled: product.expiryTrackingEnabled === true }
    : {}),
  isActive: product.isArchived ? false : true,
  ...(product.clientRequestId ? { clientRequestId: product.clientRequestId } : {}),
});

export const listProductsApi = async ({ includeImages = true } = {}) => {
  const products = await apiRequest(`/api/products${includeImages ? '' : '?includeImages=false'}`);
  return Array.isArray(products) ? products.map(mapApiProductToUi) : [];
};

export const listProductImagesApi = async (productIds = []) => {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => /^[a-f\d]{24}$/i.test(id)))];
  if (!ids.length) return [];
  const query = new URLSearchParams({ ids: ids.join(',') });
  const images = await apiRequest(`/api/products/images?${query.toString()}`);
  return Array.isArray(images) ? images : [];
};

export const listActiveRecommendationProductsApi = async () => {
  const products = await apiRequest('/api/products/recommendations/active');
  return Array.isArray(products) ? products.map(mapApiProductToUi) : [];
};

export const createProductApi = async (product) => {
  const created = await apiRequest('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      ...mapUiProductToApi(product),
      expiryTrackingEnabled: product.expiryTrackingEnabled === true,
      ...(product.expiryTrackingEnabled ? { initialStockBatch: product.initialStockBatch } : {}),
    }),
  });
  return mapApiProductToUi(created);
};

export const updateProductApi = async (productId, updates, options = {}) => {
  const payload = {
    ...mapUiProductToApi(updates),
    ...(options.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}),
    ...(options.expiryTrackingDisableReason
      ? { expiryTrackingDisableReason: String(options.expiryTrackingDisableReason).trim() }
      : {}),
  };

  const updated = await apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapApiProductToUi(updated);
};

export const archiveSelectedProductVariantsApi = async (familyId, variantIds) => {
  const response = await apiRequest(`/api/products/family/${encodeURIComponent(familyId)}/archive-selected`, {
    method: 'PATCH',
    body: JSON.stringify({ variantIds }),
  });
  return {
    products: Array.isArray(response?.products) ? response.products.map(mapApiProductToUi) : [],
    archivedSkus: Array.isArray(response?.archivedSkus) ? response.archivedSkus : [],
    notArchivedSkus: Array.isArray(response?.notArchivedSkus) ? response.notArchivedSkus : [],
  };
};

export const updateProductStockApi = async (productId, stock, options = {}) => {
  const adjustmentReason = String(options.adjustmentReason || '').trim();

  return apiRequest(`/api/products/${productId}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({
      stock,
      ...(options.expectedStock !== undefined ? { expectedStock: options.expectedStock } : {}),
      ...(options.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}),
      ...(adjustmentReason ? { inventoryAdjustmentReason: adjustmentReason } : {}),
      ...(options.adjustmentRequestId ? { adjustmentRequestId: options.adjustmentRequestId } : {}),
      ...(options.adjustmentType ? { adjustmentType: options.adjustmentType } : {}),
      ...(options.adjustmentQuantity !== undefined ? { adjustmentQuantity: options.adjustmentQuantity } : {}),
      ...(Array.isArray(options.batchAllocations) ? { batchAllocations: options.batchAllocations } : {}),
      ...(options.expiryBatch ? { expiryBatch: {
        ...options.expiryBatch,
        ...(options.enableExpiryTracking === true ? { enableTracking: true } : {}),
      } } : {}),
      ...(options.expiryVerification ? { expiryVerification: options.expiryVerification } : {}),
    }),
  });
};

export const listProductExpiryBatchesApi = async (productId, quantity = null, options = {}) => {
  const query = new URLSearchParams();
  if (quantity) query.set('quantity', String(quantity));
  if (options.activationPreview) query.set('activationPreview', 'true');
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiRequest(`/api/products/${productId}/expiry-batches${suffix}`);
};
export const correctExpiryBatchDateApi = async (productId, batchId, payload) => apiRequest(
  `/api/products/${productId}/expiry-batches/${batchId}/correct-expiry`,
  { method: 'PATCH', body: JSON.stringify(payload || {}) },
);
export const getExpiryBatchMonitoringApi = async () => apiRequest('/api/products/expiry-batches/monitoring');
export const reconcileProductExpiryBatchesApi = async (productId, payload) => apiRequest(`/api/products/${productId}/expiry-batches/reconcile`, {
  method: 'POST', body: JSON.stringify(payload || {}),
});
export const verifyExpiryBatchesAndAddStockApi = async (productId, payload) => apiRequest(`/api/products/${productId}/expiry-batches/verify-stock-in`, {
  method: 'POST', body: JSON.stringify(payload || {}),
});
export const addProductRecommendationApi = async (productId, recommendation) => {
  const updated = await apiRequest(`/api/products/${productId}/recommendations`, {
    method: 'POST',
    body: JSON.stringify(recommendation),
  });
  return mapApiProductToUi(updated);
};

export const editProductRecommendationBasisApi = async (productId, candidateId, basis) => {
  const updated = await apiRequest(`/api/products/${productId}/recommendations/${encodeURIComponent(candidateId)}/basis`, {
    method: 'PATCH', body: JSON.stringify(basis),
  });
  return mapApiProductToUi(updated);
};

export const reviewProductRecommendationApi = async (productId, candidateId, review) => {
  const updated = await apiRequest(`/api/products/${productId}/recommendations/${encodeURIComponent(candidateId)}/review`, {
    method: 'PATCH', body: JSON.stringify(review),
  });
  return mapApiProductToUi(updated);
};

export const removeProductRecommendationApi = async (productId, alternativeCode, type = 'alternative', options = {}) => {
  const revision = options.expectedRevision === undefined ? '' : `&expectedRevision=${encodeURIComponent(options.expectedRevision)}`;
  const updated = await apiRequest(`/api/products/${productId}/recommendations/${encodeURIComponent(alternativeCode)}?type=${encodeURIComponent(type)}${revision}`, {
    method: 'DELETE',
  });
  return mapApiProductToUi(updated);
};

export const createSaleApi = async (items, paymentMethod = 'cash', clientRequestId = '', options = {}) => {
  const payload = {
    items,
    paymentMethod,
    ...(options.saleType ? { saleType: options.saleType } : {}),
    ...(options.specialOrderId ? { specialOrderId: options.specialOrderId } : {}),
    ...(options.specialOrderNumber ? { specialOrderNumber: options.specialOrderNumber } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(options.customerId ? { customerId: options.customerId } : {}),
    ...(options.customerName ? { customerName: String(options.customerName).trim() } : {}),
    ...(options.creditPaymentMode ? { creditPaymentMode: String(options.creditPaymentMode).trim() } : {}),
    ...(options.creditPaymentModeOther ? { creditPaymentModeOther: String(options.creditPaymentModeOther).trim() } : {}),
    ...(options.downPaymentAmount !== undefined ? { downPaymentAmount: String(options.downPaymentAmount).trim() } : {}),
    ...(options.termDays ? { termDays: Number(options.termDays) } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
    ...(options.vatMode ? { vatMode: String(options.vatMode).trim() } : {}),
    ...(options.cashTendered !== undefined ? { cashTendered: String(options.cashTendered).trim() } : {}),
    ...(options.transactionReferenceNumber ? { transactionReferenceNumber: String(options.transactionReferenceNumber).trim() } : {}),
  };

  return apiRequest('/api/sales', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const finalizeSaleWithReferenceApi = async ({
  items,
  paymentMethod = 'cash',
  clientRequestId = '',
  referenceNumber = '',
  documentFile = null,
  downPaymentProofFiles = [],
  batchVerifications = [],
  options = {},
} = {}) => {
  const payload = {
    items: Array.isArray(items) ? items : [],
    ...(Array.isArray(batchVerifications) && batchVerifications.length ? { batchVerifications } : {}),
    paymentMethod,
    clientRequestId,
    referenceNumber: String(referenceNumber || '').trim(),
    ...(options.saleType ? { saleType: options.saleType } : {}),
    ...(options.specialOrderId ? { specialOrderId: options.specialOrderId } : {}),
    ...(options.specialOrderNumber ? { specialOrderNumber: options.specialOrderNumber } : {}),
    ...(options.customerId ? { customerId: options.customerId } : {}),
    ...(options.customerName ? { customerName: String(options.customerName).trim() } : {}),
    ...(options.creditPaymentMode ? { creditPaymentMode: String(options.creditPaymentMode).trim() } : {}),
    ...(options.creditPaymentModeOther ? { creditPaymentModeOther: String(options.creditPaymentModeOther).trim() } : {}),
    ...(options.downPaymentAmount !== undefined ? { downPaymentAmount: String(options.downPaymentAmount).trim() } : {}),
    ...(options.termDays ? { termDays: Number(options.termDays) } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
    ...(options.vatMode ? { vatMode: String(options.vatMode).trim() } : {}),
    ...(options.cashTendered !== undefined ? { cashTendered: String(options.cashTendered).trim() } : {}),
  };
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  if (documentFile) formData.append('document', documentFile);
  downPaymentProofFiles.forEach((file) => formData.append('downPaymentProofs', file));
  return apiRequest('/api/sales/finalize', { method: 'POST', body: formData });
};

const mapHistorySale = (sale) => {
  const paymentMethodLabels = {
    cash: 'Cash',
    gcash: 'GCash',
    card: 'Card',
    cheque: 'Cheque',
    other: 'Other',
    credit: 'Credit',
  };
  return {
    ...sale,
    paymentMethod: paymentMethodLabels[String(sale?.paymentMethod || '').trim().toLowerCase()]
      || String(sale?.paymentMethod || 'Cash').trim(),
  };
};

export const listSalesHistoryViewApi = async (includeArchived = true) => {
  const sales = await apiRequest(`/api/sales/history-view?includeArchived=${includeArchived ? 'true' : 'false'}`);

  return Array.isArray(sales)
    ? sales.map(mapHistorySale)
    : [];
};

export const getSaleHistoryViewApi = async (saleId) => mapHistorySale(await apiRequest(
  `/api/sales/${encodeURIComponent(saleId)}/history-view`
));

export const voidSaleApi = async (saleId, { reason, requestId, proofFile, proofFiles = [] } = {}) => {
  const formData = new FormData();
  formData.append('reason', String(reason || '').trim());
  formData.append('requestId', String(requestId || '').trim());
  if (proofFile) formData.append('proof', proofFile);
  proofFiles.forEach((file) => formData.append('proofs', file));
  return apiRequest(`/api/sales/${encodeURIComponent(saleId)}/void`, {
    method: 'POST',
    body: formData,
  });
};

export const requestSaleVoidApi = async (saleId, { reason, proofFile, proofFiles = [] } = {}) => {
  const formData = new FormData();
  formData.append('reason', String(reason || '').trim());
  if (proofFile) formData.append('proof', proofFile);
  proofFiles.forEach((file) => formData.append('proofs', file));
  return apiRequest(`/api/sales/${encodeURIComponent(saleId)}/void-request`, {
    method: 'POST',
    body: formData,
  });
};

export const getPendingSaleVoidRequestCountApi = async () => {
  const response = await apiRequest('/api/sales/void-requests/pending-count');
  return Number(response?.count || 0);
};

export const declineSaleVoidRequestApi = async (saleId, reason = '') => apiRequest(
  `/api/sales/${encodeURIComponent(saleId)}/void-request/decline`,
  { method: 'PATCH', body: JSON.stringify({ reason: String(reason || '').trim() }) }
);

export const getSaleVoidProofApi = async (saleId, { stage, index } = {}) => {
  const params = new URLSearchParams();
  if (stage) params.set('stage', stage);
  if (index !== undefined) params.set('index', String(index));
  return apiBlobRequest(`/api/sales/${encodeURIComponent(saleId)}/void-proof${params.size ? `?${params}` : ''}`);
};

export const updateSaleTransactionReferenceApi = async (saleId, { referenceNumber, documentFile } = {}) => {
  const formData = new FormData();
  formData.append('referenceNumber', String(referenceNumber || '').trim());
  if (documentFile) formData.append('document', documentFile);
  return apiRequest(`/api/sales/${encodeURIComponent(saleId)}/transaction-reference`, {
    method: 'PATCH',
    body: formData,
  });
};

export const correctSaleTransactionReferenceApi = async (saleId, { referenceNumber, documentFile, reason } = {}) => {
  const formData = new FormData();
  if (referenceNumber !== undefined) formData.append('referenceNumber', String(referenceNumber || '').trim());
  formData.append('reason', String(reason || '').trim());
  if (documentFile) formData.append('document', documentFile);
  return apiRequest(`/api/sales/${encodeURIComponent(saleId)}/transaction-reference/correct`, {
    method: 'PATCH',
    body: formData,
  });
};

export const getSaleSupportingDocumentApi = async (saleId, options = {}) => {
  const params = new URLSearchParams();
  if (options.correctionIndex !== undefined) params.set('correctionIndex', String(options.correctionIndex));
  if (options.version) params.set('version', options.version);
  const query = params.toString();
  return apiBlobRequest(`/api/sales/${encodeURIComponent(saleId)}/supporting-document${query ? `?${query}` : ''}`);
};

export const listActivityLogsApi = async (limit = 100) => {
  const logs = await apiRequest(`/api/logs/activity?limit=${Number(limit) || 100}`);
  if (!Array.isArray(logs)) {
    return [];
  }

  return logs.map((log) => ({
    ...log,
    timestamp: new Date(log.createdAt || log.timestamp || Date.now()).getTime(),
  }));
};

export const getUnreadActivityCountApi = async () => {
  const response = await apiRequest('/api/logs/activity/unread-count');
  const count = Number(response?.count || 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

export const markActivityLogsReadApi = async () => apiRequest('/api/logs/activity/mark-read', {
  method: 'POST',
  body: JSON.stringify({}),
});

export const listInventoryLogsApi = async (limit = 100) => {
  const logs = await apiRequest(`/api/logs/inventory?limit=${Number(limit) || 100}`);
  if (!Array.isArray(logs)) {
    return [];
  }

  return logs.map((log) => ({
    ...log,
    date: log.date || log.createdAt || new Date().toISOString(),
  }));
};

export const listCategoriesApi = async () => {
  return apiRequest('/api/categories');
};

export const createCategoryApi = async (data) => {
  return apiRequest('/api/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateCategoryApi = async (id, data) => {
  return apiRequest(`/api/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const deleteCategoryApi = async (id) => {
  return apiRequest(`/api/categories/${id}`, {
    method: 'DELETE',
  });
};

export const listPartnersApi = async ({ type, includeArchived = false, search = '' } = {}) => {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  params.set('includeArchived', includeArchived ? 'true' : 'false');
  if (search) params.set('search', search);

  const result = await apiRequest(`/api/partners?${params.toString()}`);
  return Array.isArray(result) ? result : [];
};

export const createPartnerApi = async (payload) => {
  return apiRequest('/api/partners', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const updatePartnerApi = async (id, payload, options = {}) => {
  const requestPayload = {
    ...(payload || {}),
    ...(options.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}),
  };

  return apiRequest(`/api/partners/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(requestPayload),
  });
};

export const archivePartnerApi = async (id) => {
  return apiRequest(`/api/partners/${id}/archive`, {
    method: 'PATCH',
  });
};

export const restorePartnerApi = async (id) => {
  return apiRequest(`/api/partners/${id}/restore`, {
    method: 'PATCH',
  });
};

export const listCreditTransactionsApi = async ({ status = 'All', search = '', includeArchived = false } = {}) => {
  const params = new URLSearchParams();
  if (status && status !== 'All') {
    params.set('status', status);
  }
  if (search) {
    params.set('search', search);
  }
  params.set('includeArchived', includeArchived ? 'true' : 'false');

  const rows = await apiRequest(`/api/credit-transactions?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
};

export const getCreditTransactionsSummaryApi = async () => {
  return apiRequest('/api/credit-transactions/summary');
};

export const getCreditTransactionsDashboardSnapshotApi = async () => {
  const rows = await apiRequest('/api/credit-transactions/dashboard-snapshot');
  return Array.isArray(rows) ? rows : [];
};

export const getCustomerOverdueHistoryApi = async () => {
  return apiRequest('/api/credit-transactions/customer-overdue-history');
};

export const getCreditTransactionByIdApi = async (id) => {
  return apiRequest(`/api/credit-transactions/${id}`);
};

export const recordCreditPaymentApi = async (id, payload) => {
  const formData = new FormData();
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || key === 'proofFile' || key === 'proofFiles') return;
    formData.append(key, String(value));
  });
  if (payload?.proofFile) {
    formData.append('proof', payload.proofFile);
  }
  (payload?.proofFiles || []).forEach((file) => formData.append('proofs', file));
  return apiRequest(`/api/credit-transactions/${id}/payments`, {
    method: 'POST',
    body: formData,
  });
};

export const markCreditTransactionPaidApi = async (id, payload = {}) => {
  const formData = new FormData();
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || key === 'proofFile' || key === 'proofFiles') return;
    formData.append(key, String(value));
  });
  if (payload?.proofFile) {
    formData.append('proof', payload.proofFile);
  }
  (payload?.proofFiles || []).forEach((file) => formData.append('proofs', file));

  return apiRequest(`/api/credit-transactions/${id}/mark-paid`, {
    method: 'PATCH',
    body: formData,
  });
};

export const getCreditTransactionProofApi = async (id) => {
  return apiBlobRequest(`/api/credit-transactions/${id}/proof`);
};

export const getCreditPaymentProofApi = async (id, requestId, index = 0) => {
  return apiBlobRequest(`/api/credit-transactions/${id}/payments/${encodeURIComponent(requestId)}/proofs/${index}`);
};

export const getCreditCancellationProofApi = async (id, index) => apiBlobRequest(
  `/api/credit-transactions/${id}/cancellation-proofs/${index}`
);

export const extendCreditTransactionTermApi = async (id, payload = {}) => {
  return apiRequest(`/api/credit-transactions/${id}/extend-term`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const cancelCreditTransactionApi = async (id, payload = {}) => {
  const formData = new FormData();
  formData.append('reason', String(payload.reason || '').trim());
  (payload.proofFiles || []).forEach((file) => formData.append('proofs', file));
  return apiRequest(`/api/credit-transactions/${id}/cancel`, {
    method: 'PATCH',
    body: formData,
  });
};

export const listSpecialOrdersApi = async ({ status = 'All', search = '' } = {}) => {
  const params = new URLSearchParams();
  if (status && status !== 'All') {
    params.set('status', status);
  }
  if (search) {
    params.set('search', search);
  }

  const rows = await apiRequest(`/api/special-orders?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
};

export const createSpecialOrderApi = async (payload, itemPhotos) => {
  const body = itemPhotos ? new FormData() : JSON.stringify(payload || {});
  if (itemPhotos) {
    body.append('payload', JSON.stringify(payload || {}));
    for (const [itemId, photos] of itemPhotos) {
      for (const file of photos) body.append(`itemImages:${itemId}`, file);
    }
  }
  return apiRequest('/api/special-orders', {
    method: 'POST',
    body,
  });
};

export const updateSpecialOrderApi = async (id, payload) => {
  return apiRequest(`/api/special-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
};

export const listSpecialOrderQuotationsApi = async (id) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/quotations`);

export const getSpecialOrderStockAvailabilityApi = async (id) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/stock-availability`);

export const getSpecialOrderPaymentsApi = async (id) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/payments`);
export const listSpecialOrderCollectionsApi = async () => apiRequest('/api/special-orders/collections');

export const recordSpecialOrderDownPaymentApi = async (id, { requestId, amount, downPaymentPercentage, paymentPlan, termDays, method, otherMethod, reference, notes, chequeCleared, proofs }) => {
  const body = new FormData();
  body.append('requestId', requestId);
  body.append('amount', amount);
  body.append('downPaymentPercentage', String(downPaymentPercentage ?? '50'));
  body.append('paymentPlan', paymentPlan || 'cash');
  if (paymentPlan === 'credit' && termDays !== undefined) body.append('termDays', String(termDays));
  body.append('method', method);
  body.append('otherMethod', otherMethod || '');
  body.append('reference', method === 'cash' ? '' : (reference || ''));
  body.append('notes', notes || '');
  if (chequeCleared) body.append('chequeCleared', 'true');
  for (const file of proofs || []) body.append('proofs', file);
  return apiRequest(`/api/special-orders/${encodeURIComponent(id)}/payments/down-payment`, { method: 'POST', body });
};

export const recordSpecialOrderPaymentApi = async (id, { requestId, amount, method, otherMethod, reference, notes, chequeCleared, invoiceNumber, saleDocuments, proofs }) => {
  const body = new FormData();
  body.append('requestId', requestId);
  body.append('amount', amount);
  body.append('method', method);
  body.append('otherMethod', otherMethod || '');
  body.append('reference', method === 'cash' ? '' : (reference || ''));
  body.append('notes', notes || '');
  if (chequeCleared) body.append('chequeCleared', 'true');
  if (invoiceNumber) body.append('invoiceNumber', invoiceNumber);
  if (saleDocuments?.[0]) body.append('document', saleDocuments[0]);
  for (const file of proofs || []) body.append('proofs', file);
  return apiRequest(`/api/special-orders/${encodeURIComponent(id)}/payments`, { method: 'POST', body });
};

export const sourceSpecialOrderCustomItemApi = async (id, requestId, itemId, quantity) => apiRequest(
  `/api/special-orders/${encodeURIComponent(id)}/fulfillment/custom-sourcing`,
  { method: 'POST', body: JSON.stringify({ requestId, itemId, quantity }) }
);

export const completeSpecialOrderProcessingApi = async (id, requestId, { referenceNumber = '', documentFile = null, quotationId = '', batchVerifications = [] } = {}) => {
  const formData = new FormData();
  formData.append('payload', JSON.stringify({
    requestId,
    referenceNumber: String(referenceNumber || '').trim(),
    quotationId: String(quotationId || '').trim(),
    ...(Array.isArray(batchVerifications) && batchVerifications.length ? { batchVerifications } : {}),
  }));
  if (documentFile) formData.append('document', documentFile);
  return apiRequest(`/api/special-orders/${encodeURIComponent(id)}/complete`, {
    method: 'POST', body: formData,
  });
};

export const getSpecialOrderPaymentProofApi = async (id, requestId, index) => apiBlobRequest(
  `/api/special-orders/${encodeURIComponent(id)}/payments/${encodeURIComponent(requestId)}/proofs/${index}`
);

export const reserveSpecialOrderStockApi = async (id, requestId) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/reservations`, {
  method: 'POST', body: JSON.stringify({ requestId }),
});

export const releaseSpecialOrderStockApi = async (id, requestId) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/reservations/release`, {
  method: 'POST', body: JSON.stringify({ requestId }),
});

export const cancelReservedSpecialOrderApi = async (id, requestId, reason) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/cancel`, {
  method: 'POST', body: JSON.stringify({ requestId, reason }),
});

export const getSpecialOrderQuotationDocumentApi = async (orderId, quotationId) => apiRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/document`
);

export const prepareSpecialOrderQuotationApi = async (id) => apiRequest(`/api/special-orders/${encodeURIComponent(id)}/quotations`, { method: 'POST' });

export const updateSpecialOrderQuotationApi = async (orderId, quotationId, payload) => apiRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}`,
  { method: 'PATCH', body: JSON.stringify(payload || {}) }
);
export const uploadSpecialOrderQuotationImagesApi = async (orderId, quotationId, itemId, files, replaceKey = '') => {
  const formData = new FormData();
  Array.from(files || []).forEach((file) => formData.append('images', file));
  if (replaceKey) formData.append('replaceKey', replaceKey);
  return apiRequest(`/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/items/${encodeURIComponent(itemId)}/images`, { method: 'POST', body: formData });
};
export const removeSpecialOrderQuotationImageApi = async (orderId, quotationId, itemId, imageKey) => apiRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/items/${encodeURIComponent(itemId)}/images/${encodeURIComponent(imageKey)}`,
  { method: 'DELETE' }
);
export const getSpecialOrderQuotationImageApi = async (orderId, quotationId, itemId, imageKey) => apiBlobRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/items/${encodeURIComponent(itemId)}/images/${encodeURIComponent(imageKey)}`
);

export const issueSpecialOrderQuotationApi = async (orderId, quotationId) => apiRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/issue`,
  { method: 'POST' }
);

export const decideSpecialOrderQuotationApi = async (orderId, quotationId, decision, reason = '') => apiRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/decision`,
  { method: 'POST', body: JSON.stringify({ decision, reason }) }
);

export const reviseSpecialOrderQuotationApi = async (orderId, quotationId) => apiRequest(
  `/api/special-orders/${encodeURIComponent(orderId)}/quotations/${encodeURIComponent(quotationId)}/revise`,
  { method: 'POST' }
);

export const finalizeSpecialOrderWithReferenceApi = async (id, { referenceNumber = '', documentFile = null, quotationId = '' } = {}) => {
  const formData = new FormData();
  formData.append('payload', JSON.stringify({ referenceNumber: String(referenceNumber || '').trim(), quotationId: String(quotationId || '').trim() }));
  if (documentFile) formData.append('document', documentFile);
  return apiRequest(`/api/special-orders/${encodeURIComponent(id)}/finalize`, {
    method: 'POST',
    body: formData,
  });
};

export const getSpecialOrderReceiptApi = async (id) => {
  return apiRequest(`/api/special-orders/${id}/receipt`);
};
