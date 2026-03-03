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
  brand: '',
  color: '',
  size: '',
  category: product.category || 'General',
  price: Number(product.price || 0),
  stock: Number(product.stock || 0),
  status: toStatus(Number(product.stock || 0)),
  isActive: product.isActive,
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

export const createSaleApi = async (items, paymentMethod = 'cash') => {
  return apiRequest('/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items, paymentMethod }),
  });
};
