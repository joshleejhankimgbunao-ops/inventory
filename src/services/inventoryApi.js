import { apiRequest } from './apiClient';
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
  supplier: product.supplierName || product.supplier || 'Local Supplier',
  category: product.category || 'General',
  price: Number(product.price || 0),
  stock: Number(product.stock || 0),
  status: toStatus(Number(product.stock || 0)),
  isActive: product.isActive,
  isArchived: product.isActive === false,
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
  supplierName: product.supplier || 'Local Supplier',
  isActive: product.isArchived ? false : true,
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

export const updateProductApi = async (productId, updates) => {
  const updated = await apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(mapUiProductToApi(updates)),
  });
  return mapApiProductToUi(updated);
};

export const updateProductStockApi = async (productId, stock) => {
  return apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stock }),
  });
};

export const createSaleApi = async (items, paymentMethod = 'cash', clientRequestId = '') => {
  return apiRequest('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items, paymentMethod, ...(clientRequestId ? { clientRequestId } : {}) }),
  });
};

export const listSalesHistoryViewApi = async (includeArchived = true) => {
  const sales = await apiRequest(`/api/sales/history-view?includeArchived=${includeArchived ? 'true' : 'false'}`);
  return Array.isArray(sales) ? sales : [];
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

export const updatePartnerApi = async (id, payload) => {
  return apiRequest(`/api/partners/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
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
