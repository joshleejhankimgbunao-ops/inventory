const path = require('path');
const { randomUUID } = require('crypto');

const productImageSources = (product) => {
  const listedImages = Array.isArray(product?.images) && product.images.length
    ? product.images
    : Array.isArray(product?.imageUrls) && product.imageUrls.length
      ? product.imageUrls
      : Array.isArray(product?.imageUrl)
        ? product.imageUrl
        : [product?.imageUrl || product?.image || ''];
  return listedImages.flatMap((entry, imageIndex) => {
    const sourceUrl = typeof entry === 'string'
      ? entry.trim()
      : String(entry?.imageUrl || entry?.url || entry?.src || entry?.dataUrl || '').trim();
    if (!sourceUrl) return [];
    const metadata = entry && typeof entry === 'object' ? entry : {};
    return [{ sourceUrl, imageIndex, originalName: String(metadata.originalName || metadata.name || '') }];
  });
};

const imageMetadata = (sourceUrl) => {
  const dataImage = String(sourceUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (dataImage) {
    const data = Buffer.from(dataImage[2], 'base64');
    return { mimeType: dataImage[1].toLowerCase(), size: data.length };
  }
  const parsedUrl = /^https?:\/\//i.test(sourceUrl) || sourceUrl.startsWith('/') ? sourceUrl : '';
  if (!parsedUrl) throw Object.assign(new Error('The selected product image is unavailable.'), { status: 400 });
  const extension = path.extname(new URL(sourceUrl, 'http://localhost').pathname).toLowerCase();
  const mimeType = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[extension] || 'application/octet-stream';
  return { mimeType, size: 0, sourceUrl };
};

const createProductImageReference = (product, source) => {
  const sourceInfo = productImageSources(product).find((entry) => entry.imageIndex === source.imageIndex);
  if (!sourceInfo) throw Object.assign(new Error('The selected product image is no longer available. Refresh the product and retry.'), { status: 409 });
  const { mimeType, size, sourceUrl } = imageMetadata(sourceInfo.sourceUrl);
  const sourceProductId = String(product._id);
  const fileExtension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[mimeType] || 'img';
  const originalName = sourceInfo.originalName || `${String(product.sku || product.name || 'product').replace(/[^a-z0-9-_]+/gi, '-')}-${source.imageIndex + 1}.${fileExtension}`;
  return {
    key: `product-${sourceProductId}-${source.imageIndex}-${randomUUID()}`,
    originalName,
    mimeType,
    size,
    uploadedAt: new Date(),
    sourceProductId,
    sourceImageIndex: source.imageIndex,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
};

const parseProductDataImage = (sourceUrl) => {
  const matched = String(sourceUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  return matched ? { mimeType: matched[1].toLowerCase(), buffer: Buffer.from(matched[2], 'base64') } : null;
};

module.exports = { productImageSources, createProductImageReference, parseProductDataImage };
