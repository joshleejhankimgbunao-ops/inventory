const imageSource = (entry) => {
  if (typeof entry === 'string') return entry.trim();
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.imageUrl || entry.url || entry.src || entry.dataUrl || '').trim();
};

export const productImageEntries = (product) => {
  const listedImages = Array.isArray(product?.images) && product.images.length
    ? product.images
    : Array.isArray(product?.imageUrls) && product.imageUrls.length
      ? product.imageUrls
      : Array.isArray(product?.imageUrl)
        ? product.imageUrl
        : [product?.imageUrl || product?.image || ''];
  const productId = String(product?.id || product?._id || '');
  if (!productId) return [];

  return listedImages.flatMap((entry, imageIndex) => {
    const src = imageSource(entry);
    if (!src) return [];
    const metadata = entry && typeof entry === 'object' ? entry : {};
    return [{
      source: 'product',
      productId,
      imageIndex,
      src,
      name: String(metadata.originalName || metadata.name || `${product?.name || 'Product'} image ${imageIndex + 1}`),
      mimeType: String(metadata.mimeType || ''),
    }];
  });
};

export const isProductImageReference = (photo) => photo?.source === 'product'
  && Boolean(photo.productId)
  && Number.isSafeInteger(photo.imageIndex)
  && photo.imageIndex >= 0;

export const inventoryProductPhotosForSelection = (currentPhotos, currentProductId, product) => {
  const nextProductId = String(product?.id || product?._id || '');
  const previousPhotos = currentPhotos || [];
  if (!nextProductId || nextProductId !== String(currentProductId || '')) return productImageEntries(product);
  const latestImagesByIndex = new Map(productImageEntries(product).map((photo) => [photo.imageIndex, photo]));
  return previousPhotos.flatMap((photo) => {
    if (!isProductImageReference(photo)) return [photo];
    const refreshed = photo.productId === nextProductId ? latestImagesByIndex.get(photo.imageIndex) : null;
    return refreshed ? [refreshed] : [];
  });
};

export const quotationPhotoSelections = (photos = []) => photos.map((photo) => (
  isProductImageReference(photo)
    ? { type: 'product', imageIndex: photo.imageIndex }
    : { type: 'upload' }
));
