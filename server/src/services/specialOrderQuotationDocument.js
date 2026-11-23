// Store only document fields, never private settings or live directory/product
// references. Called inside the atomic quotation creation or locked issue transaction.
const text = (value) => String(value ?? '').trim();
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

const createSpecialOrderQuotationDocument = ({ order, quotation, settings, issuedAt }) => {
  const quotationDetails = Object.fromEntries(['attentionName', 'attentionPosition', 'authorizedSignatoryName']
    .map((field) => [field, text(quotation.quotationDetails?.[field])]));
  if (!quotationDetails.authorizedSignatoryName) {
    throw invalid('Authorized Signatory Name is required. Enter the signatory and Generate Quotation again.');
  }
  if (!text(settings?.storeName)) {
    throw invalid('Company information is unavailable. Ask an administrator to configure company settings, then Generate Quotation again.');
  }
  const companyFields = ['storeName', 'storeBusinessSubtitle', 'storeAddress', 'contactPhone', 'contactPhoneSecondary', 'storePrimaryEmail', 'storeSecondaryEmail'];
  return {
    schemaVersion: 1,
    quotationNumber: quotation.quotationNumber,
    specialOrderNumber: order.orderNumber,
    version: quotation.version,
    quotationDate: issuedAt.toISOString(),
    settings: Object.fromEntries(companyFields.map((field) => [field, text(settings[field])])),
    customer: {
      _id: quotation.customer ? String(quotation.customer) : '',
      name: quotation.customerName,
      ...(quotation.customerDetails?.toObject?.() || quotation.customerDetails || {}),
    },
    quotationDetails,
    ...(Number(order.workflowVersion) >= 2 ? { taxTreatment: text(quotation.customerDetails?.taxTreatment) } : {}),
    fulfillment: quotation.fulfillment ? { ...(quotation.fulfillment.toObject?.() || quotation.fulfillment) } : null,
    items: quotation.items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName, description: item.description, sellingUnit: item.sellingUnit,
      itemType: item.itemType || 'custom',
      inventoryProduct: item.inventoryProduct ? String(item.inventoryProduct) : null,
      inventorySnapshot: item.inventorySnapshot ? { ...(item.inventorySnapshot.toObject?.() || item.inventorySnapshot) } : null,
      expiryDate: item.expiryDate || '',
      quotationExpirySelections: (item.quotationExpirySelections || []).map((selection) => ({
        batchId: String(selection.batchId || ''), batchReference: selection.batchReference || '',
        lotNumber: selection.lotNumber || '', expiryDate: selection.expiryDate || '', quantity: selection.quantity,
      })),
      originalUnitPrice: item.originalUnitPrice ?? null,
      priceOverrideReason: item.priceOverrideReason || '',
      priceOverrideBy: item.priceOverrideBy ? String(item.priceOverrideBy) : null,
      quantity: item.quantity, unitPrice: item.unitPrice, lineAmount: item.lineAmount,
      // Object metadata is snapshot with the issued document; image bytes stay in object storage.
      images: (item.images || []).map((image) => ({
        key: image.key, originalName: image.originalName, mimeType: image.mimeType, size: image.size, uploadedAt: image.uploadedAt,
        ...(image.sourceProductId ? { sourceProductId: String(image.sourceProductId), sourceImageIndex: image.sourceImageIndex } : {}),
        ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
      })),
    })),
    subtotal: quotation.subtotal,
    total: quotation.total,
  };
};

module.exports = { createSpecialOrderQuotationDocument };
