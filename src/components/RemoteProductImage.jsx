import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useInventory } from '../context/InventoryContext';

const productId = (product) => String(product?.id || product?._id || '').trim();
const imageSource = (product) => String(product?.imageUrl || product?.image || '').trim();

/** Loads legacy/database-backed image references only when the image is near the viewport. */
const RemoteProductImage = ({
  product,
  products,
  className = '',
  imageClassName = '',
  fit = 'contain',
  alt,
  ariaLabel,
  decorative = false,
  onPreview,
  placeholderClassName = '',
  placeholderText,
  attributes = {},
  overlay = null,
}) => {
  const candidates = useMemo(() => (Array.isArray(products) && products.length ? products : (product ? [product] : [])), [product, products]);
  const ids = useMemo(() => candidates.map(productId).filter(Boolean), [candidates]);
  const identitySignature = ids.join('|');
  const { ensureInventoryImages, productImageRevisions = {} } = useInventory();
  const revisionSignature = ids.map((id) => `${id}:${Number(productImageRevisions[id] || 0)}`).join('|');
  const imageVersionById = useMemo(() => Object.fromEntries(revisionSignature
    ? revisionSignature.split('|').map((entry) => {
      const [id, version] = entry.split(':');
      return [id, Number(version || 0)];
    })
    : []), [revisionSignature]);
  const [resolvedImages, setResolvedImages] = useState({});
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const requestSignature = useMemo(() => candidates
    .filter((candidate) => !imageSource(candidate))
    .map((candidate) => productId(candidate))
    .filter(Boolean)
    .join('|'), [candidates]);
  const revisionNeedsRefresh = ids.some((id) => Number(productImageRevisions[id] || 0) > 0);
  const needsRemoteRequest = Boolean(requestSignature || revisionNeedsRefresh);
  const elementRef = useRef(null);
  const requestedSignatureRef = useRef('');

  useEffect(() => {
    if (!needsRemoteRequest) return undefined;
    const requestSignatureKey = `${identitySignature}:${revisionSignature}:${requestSignature}`;
    if (requestedSignatureRef.current === requestSignatureKey) return undefined;
    const node = elementRef.current;
    let active = true;
    let observer;
    const loadImages = () => {
      if (requestedSignatureRef.current === requestSignatureKey) return;
      requestedSignatureRef.current = requestSignatureKey;
      const requestIds = identitySignature.split('|').filter(Boolean);
      void ensureInventoryImages({ productIds: requestIds }).then((images) => {
        if (!active) return;
        const next = {};
        requestIds.forEach((id) => {
          const revision = Number(imageVersionById[id] || 0);
          next[`${id}:${revision}`] = String(images.get(id) || '');
        });
        setResolvedImages((previous) => ({ ...previous, ...next }));
        setFailedImageUrl('');
      });
    };
    if (!node || typeof IntersectionObserver === 'undefined') {
      loadImages();
      return () => { active = false; };
    }
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadImages();
        observer.disconnect();
      }
    }, { rootMargin: '240px 0px', threshold: 0 });
    observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [ensureInventoryImages, identitySignature, imageVersionById, needsRemoteRequest, requestSignature, revisionSignature]);

  const selected = candidates.find((candidate) => {
    const id = productId(candidate);
    const revision = Number(productImageRevisions[id] || 0);
    const resolvedImage = resolvedImages[`${id}:${revision}`];
    return Boolean(revision > 0 ? resolvedImage : (imageSource(candidate) || resolvedImage));
  });
  const selectedId = productId(selected);
  const selectedRevision = Number(productImageRevisions[selectedId] || 0);
  const resolvedImage = resolvedImages[`${selectedId}:${selectedRevision}`];
  const selectedRevisionNeedsRefresh = selectedRevision > 0;
  const imageUrl = selected
    ? String(selectedRevisionNeedsRefresh ? resolvedImage || '' : (imageSource(selected) || resolvedImage || ''))
    : '';
  const visibleImageUrl = imageUrl && failedImageUrl !== imageUrl ? imageUrl : '';
  const visibleProduct = selected && selectedId && resolvedImage
    ? { ...selected, imageUrl: resolvedImage }
    : selected;
  const label = alt || selected?.name || product?.name || product?.code || 'Product image';
  const containerClassName = `relative flex items-center justify-center overflow-hidden ${className}`;
  const placeholder = (
    <div className={`flex h-full w-full items-center justify-center ${placeholderClassName}`} aria-hidden="true">
      {placeholderText || <svg className="h-7 w-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 16l4-4a3 3 0 014 0l4 4m-2-2l2-2a3 3 0 014 0l2 2m-14 4h16" />
      </svg>}
    </div>
  );
  const image = visibleImageUrl ? (
    <img
      src={visibleImageUrl}
      alt={label}
      loading="eager"
      decoding="async"
      onError={() => setFailedImageUrl(visibleImageUrl)}
      className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${imageClassName}`}
    />
  ) : placeholder;

  if (onPreview) {
    return (
      <button
        ref={elementRef}
        type="button"
        disabled={!visibleImageUrl}
        onClick={(event) => visibleProduct && onPreview(event, visibleProduct)}
        className={`${containerClassName} ${visibleImageUrl ? 'cursor-zoom-in' : 'cursor-default'}`}
        {...attributes}
        aria-label={ariaLabel || (visibleImageUrl ? `Enlarge image for ${label}` : `No image for ${label}`)}
      >
        {image}
        {visibleImageUrl && overlay}
      </button>
    );
  }

  return <div ref={elementRef} className={containerClassName} aria-hidden={decorative || undefined} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : visibleImageUrl ? label : `No image for ${label}`}>{image}</div>;
};

export default RemoteProductImage;
