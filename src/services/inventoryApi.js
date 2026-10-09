import { apiBlobRequest, apiRequest } from './apiClient';
import { getStockStatus } from '../utils/recommendationLogic';

const toStatus = (stock) => {
  return getStockStatus({ stock });
};

export const mapApiProductToUi = (product) => ({
  id: product._id,
  code: product.sku,
  name: product.name,
  brand: product.brand || '',
  color: product.color || '',
  size: product.size || '',
  attributes: product.attributes || {},
  supplier: product.supplierName || product.supplier || 'Local Supplier',
  imageUrl: product.imageUrl || product.image || '',
  category: product.category || 'General',
  price: Number(product.price || 0),
  stock: Number(product.stock || 0),
  status: toStatus(Number(product.stock || 0)),
  manualAlternatives: Array.isArray(product.manualAlternatives) ? product.manualAlternatives : [],
  excludedAlternatives: Array.isArray(product.excludedAlternatives) ? product.excludedAlternatives : [],
  manualBudgetOptions: Array.isArray(product.manualBudgetOptions) ? product.manualBudgetOptions : [],
  excludedBudgetOptions: Array.isArray(product.excludedBudgetOptions) ? product.excludedBudgetOptions : [],
  isActive: product.isActive,
  isArchived: product.isActive === false,
  updatedAt: product.updatedAt || null,
});

const mapUiProductToApi = (product) => ({
  name: product.name,
  sku: product.code,
  category: product.category,
  stock: Number(product.stock || 0),
  price: Number(product.price || 0),
  brand: product.brand || '',
  color: product.color || '',
  size: product.size || '',
  attributes: product.attributes || {},
  supplierName: product.supplier || 'Local Supplier',
  imageUrl: product.imageUrl || '',
  isActive: product.isArchived ? false : true,
  ...(product.clientRequestId ? { clientRequestId: product.clientRequestId } : {}),
});

export const listProductsApi = async () => {
  const products = await apiRequest('/api/products');
  return Array.isArray(products) ? products.map(mapApiProductToUi) : [];
};

export const createProductApi = async (product) => {
  const created = await apiRequest('/api/products', {
    method: 'POST',
    body: JSON.stringify(mapUiProductToApi(product)),
  });
  return mapApiProductToUi(created);
};

export const updateProductApi = async (productId, updates, options = {}) => {
  const payload = {
    ...mapUiProductToApi(updates),
    ...(options.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}),
  };

  const updated = await apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapApiProductToUi(updated);
};

export const updateProductStockApi = async (productId, stock, options = {}) => {
  const adjustmentReason = String(options.adjustmentReason || '').trim();

  return apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      stock,
      ...(options.expectedStock !== undefined ? { expectedStock: options.expectedStock } : {}),
      ...(options.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}),
      ...(adjustmentReason ? { inventoryAdjustmentReason: adjustmentReason } : {}),
      ...(options.adjustmentRequestId ? { adjustmentRequestId: options.adjustmentRequestId } : {}),
    }),
  });
};

export const addProductRecommendationApi = async (productId, recommendation) => {
  const updated = await apiRequest(`/api/products/${productId}/recommendations`, {
    method: 'POST',
    body: JSON.stringify(recommendation),
  });
  return mapApiProductToUi(updated);
};

export const removeProductRecommendationApi = async (productId, alternativeCode, type = 'alternative') => {
  const updated = await apiRequest(`/api/products/${productId}/recommendations/${encodeURIComponent(alternativeCode)}?type=${encodeURIComponent(type)}`, {
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

export const voidSaleApi = async (saleId, { reason, requestId, proofFile } = {}) => {
  const formData = new FormData();
  formData.append('reason', String(reason || '').trim());
  formData.append('requestId', String(requestId || '').trim());
  if (proofFile) formData.append('proof', proofFile);
  return apiRequest(`/api/sales/${encodeURIComponent(saleId)}/void`, {
    method: 'POST',
    body: formData,
  });
};

export const getSaleVoidProofApi = async (saleId) => apiBlobRequest(
  `/api/sales/${encodeURIComponent(saleId)}/void-proof`
);

export const updateSaleTransactionReferenceApi = async (saleId, { referenceNumber, documentFile } = {}) => {
  const formData = new FormData();
  formData.append('referenceNumber', String(referenceNumber || '').trim());
  if (documentFile) formData.append('document', documentFile);
  return apiRequest(`/api/sales/${encodeURIComponent(saleId)}/transaction-reference`, {
    method: 'PATCH',
    body: formData,
  });
};

export const getSaleSupportingDocumentApi = async (saleId) => apiBlobRequest(
  `/api/sales/${encodeURIComponent(saleId)}/supporting-document`
);

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

export const getCreditTransactionByIdApi = async (id) => {
  return apiRequest(`/api/credit-transactions/${id}`);
};

export const recordCreditPaymentApi = async (id, payload) => {
  return apiRequest(`/api/credit-transactions/${id}/payments`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
};

export const markCreditTransactionPaidApi = async (id, payload = {}) => {
  const formData = new FormData();
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || key === 'proofFile') return;
    formData.append(key, String(value));
  });
  if (payload?.proofFile) {
    formData.append('proof', payload.proofFile);
  }

  return apiRequest(`/api/credit-transactions/${id}/mark-paid`, {
    method: 'PATCH',
    body: formData,
  });
};

export const getCreditTransactionProofApi = async (id) => {
  return apiBlobRequest(`/api/credit-transactions/${id}/proof`);
};

export const extendCreditTransactionTermApi = async (id, payload = {}) => {
  return apiRequest(`/api/credit-transactions/${id}/extend-term`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const cancelCreditTransactionApi = async (id, payload = {}) => {
  return apiRequest(`/api/credit-transactions/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
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

export const createSpecialOrderApi = async (payload) => {
  return apiRequest('/api/special-orders', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
};

export const updateSpecialOrderApi = async (id, payload) => {
  return apiRequest(`/api/special-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
};

export const completeSpecialOrderApi = async (id, payload = {}) => {
  return apiRequest(`/api/special-orders/${id}/complete`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const getSpecialOrderReceiptApi = async (id) => {
  return apiRequest(`/api/special-orders/${id}/receipt`);
};
