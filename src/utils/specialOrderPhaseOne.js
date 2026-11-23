import { getProductDisplayName } from './productDisplayName.js';

export const inventoryItemFromProduct = (product, categories = []) => ({
  itemType: 'inventory',
  inventoryProduct: product.id,
  sku: product.code,
  itemName: getProductDisplayName(product, categories),
  sellingUnit: product.sellingUnit || '',
  expiryTrackingEnabled: product.expiryTrackingEnabled === true,
  expiryTrackingPeriodId: product.expiryTrackingPeriodId || '',
  expiryDate: '',
  quotationExpirySelections: [],
  originalUnitPrice: Number(product.price),
  sellingPrice: Number(product.price).toFixed(2),
  unitPrice: Number(product.price).toFixed(2),
  priceOverrideReason: '',
  description: [product.brand, product.color, product.size, ...Object.entries(product.attributes || {}).map(([key, value]) => value ? `${key}: ${value}` : '')].filter(Boolean).join(' · '),
});

export const hasInventoryLinkedItems = (items) => Array.isArray(items)
  && items.some((item) => item?.itemType === 'inventory' && Boolean(item.inventoryProduct || item.productId));

export const fulfillmentDescription = (fulfillment) => {
  if (!fulfillment?.method) return '';
  const isDelivery = fulfillment.method === 'Free Delivery';
  const address = isDelivery ? [fulfillment.addressLine, fulfillment.barangay, fulfillment.cityMunicipality].filter(Boolean).join(', ') : '';
  const method = isDelivery ? 'Free Delivery within Laguna' : fulfillment.method;
  return [method, address, fulfillment.preferredDate ? `Preferred date: ${fulfillment.preferredDate}` : ''].filter(Boolean).join(' · ');
};
