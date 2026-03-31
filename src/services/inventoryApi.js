import { apiRequest } from './apiClient';

const toStatus = (stock) => {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= 10) return 'Critical';
  return 'In Stock';
};

export const mapApiProductToUi = (product) => ({
  id: product._id,
  code: product.sku,
  name: product.name,
  brand: product.brand || '',
  color: product.color || '',
  size: product.size || '',
  category: product.category || 'General',
  price: Number(product.price || 0),
  stock: Number(product.stock || 0),
  status: toStatus(Number(product.stock || 0)),
  isActive: product.isActive,
  supplierName: product.supplierName || '',
});

export const listProductsApi = async () => {
  const products = await apiRequest('/api/products');
  return Array.isArray(products) ? products.map(mapApiProductToUi) : [];
};

export const updateProductStockApi = async (productId, stock) => {
  return apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({ stock }),
  });
};

export const createProductApi = async (payload) => {
  const created = await apiRequest('/api/products', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return mapApiProductToUi(created);
};

export const updateProductApi = async (productId, payload) => {
  const updated = await apiRequest(`/api/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapApiProductToUi(updated);
};

export const createSaleApi = async (items, paymentMethod = 'cash') => {
  return apiRequest('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items, paymentMethod }),
  });
};

export const listSalesHistoryApi = async (includeArchived = true) => {
  const sales = await apiRequest(`/api/sales/history-view?includeArchived=${includeArchived ? 'true' : 'false'}`);
  return Array.isArray(sales) ? sales : [];
};

export const archiveSaleApi = async (saleId) => {
  return apiRequest(`/api/sales/${saleId}/archive`, {
    method: 'PATCH',
  });
};

export const restoreSaleApi = async (saleId) => {
  return apiRequest(`/api/sales/${saleId}/restore`, {
    method: 'PATCH',
  });
};

const mapInventoryLog = (log) => ({
  id: log._id,
  date: log.createdAt,
  action: log.action,
  code: log.code || '',
  details: log.details || '',
  user: log.user || 'System',
});

const mapActivityLog = (log) => ({
  id: log._id,
  user: log.user || 'System',
  action: log.action || '',
  details: log.details || '',
  timestamp: log.createdAt ? new Date(log.createdAt).getTime() : Date.now(),
});

export const listInventoryLogsApi = async (limit = 200) => {
  const logs = await apiRequest(`/api/logs/inventory?limit=${limit}`);
  return Array.isArray(logs) ? logs.map(mapInventoryLog) : [];
};

export const listActivityLogsApi = async (limit = 200) => {
  const logs = await apiRequest(`/api/logs/activity?limit=${limit}`);
  return Array.isArray(logs) ? logs.map(mapActivityLog) : [];
};

const mapPartnerToUi = (partner) => {
  const kind = partner.type === 'supplier' ? 'suppliers' : 'customers';
  return {
    id: partner._id,
    name: partner.name || '',
    contact: partner.contact || '',
    email: partner.email || '',
    address: partner.address || '',
    isArchived: Boolean(partner.isArchived),
    products: kind === 'suppliers' ? (partner.note || 'General') : '',
    type: kind === 'customers' ? (partner.note || 'Regular') : '',
    partnerKind: kind,
  };
};

export const listPartnersApi = async ({ type, includeArchived = true, search = '' } = {}) => {
  const query = new URLSearchParams();
  if (type) {
    query.set('type', type);
  }
  query.set('includeArchived', includeArchived ? 'true' : 'false');
  if (search) {
    query.set('search', search);
  }

  const endpoint = `/api/partners?${query.toString()}`;
  const partners = await apiRequest(endpoint);
  return Array.isArray(partners) ? partners.map(mapPartnerToUi) : [];
};

export const createPartnerApi = async ({ type, name, contact, email, address, note }) => {
  const created = await apiRequest('/api/partners', {
    method: 'POST',
    body: JSON.stringify({ type, name, contact, email, address, note }),
  });
  return mapPartnerToUi(created);
};

export const updatePartnerApi = async (id, payload) => {
  const updated = await apiRequest(`/api/partners/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return mapPartnerToUi(updated);
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
