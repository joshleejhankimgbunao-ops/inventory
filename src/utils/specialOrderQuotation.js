import { parseMoneyToCentavos } from './numericInput.js';

export const createQuotationDraft = (quotation, settings = {}) => ({
  items: (quotation?.items || []).map((item) => ({ ...item, sku: item.inventorySnapshot?.sku || '', itemId: item.itemId || quotationItemId(), images: item.images || [] })),
  taxTreatment: quotation?.customerDetails?.taxTreatment || '',
  fulfillment: quotation?.fulfillment || { method: '', addressLine: '', barangay: '', cityMunicipality: '', province: '', preferredDate: '' },
  quotationDetails: {
    attentionName: quotation?.quotationDetails?.attentionName ?? quotation?.customerDetails?.attentionName ?? '',
    attentionPosition: quotation?.quotationDetails?.attentionPosition ?? quotation?.customerDetails?.attentionPosition ?? '',
    authorizedSignatoryName: quotation?.quotationDetails?.authorizedSignatoryName ?? settings.authorizedSignatoryName ?? '',
  },
});

export const editQuotationItem = (draft, index, field, value) => ({
  ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
});

const quotationItemId = () => globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`;

export const addQuotationItem = (draft) => ({
  ...draft, items: [...draft.items, { itemId: quotationItemId(), itemType: 'custom', itemName: '', description: '', quantity: 1, sellingUnit: '', unitPrice: '', images: [] }],
});

export const removeQuotationItem = (draft, index) => ({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) });

export const quotationDraftSummary = (draft) => {
  const lines = (draft?.items || []).map((item) => {
    const quantity = Number(item.quantity);
    const price = parseMoneyToCentavos(String(item.unitPrice));
    const cents = price === null ? NaN : quantity * price;
    const valid = String(item.itemName || '').trim() && /^\d+$/.test(String(item.quantity)) && Number.isSafeInteger(quantity) && quantity >= 1 && Number.isSafeInteger(cents) && cents >= 0;
    return valid ? cents : null;
  });
  const totalCents = lines.reduce((sum, cents) => sum + (cents ?? 0), 0);
  return { lines: lines.map((cents) => cents === null ? null : cents / 100), total: totalCents / 100, valid: lines.length > 0 && lines.every((line) => line !== null) && Number.isSafeInteger(totalCents) };
};

export const createQuotationRequestGate = () => {
  let sequence = 0;
  let selectedId = '';
  return {
    begin(orderId) { selectedId = String(orderId); return { orderId: selectedId, sequence: ++sequence }; },
    isCurrent(ticket) { return ticket?.sequence === sequence && ticket?.orderId === selectedId; },
    invalidate() { selectedId = ''; sequence += 1; },
  };
};

export const approvedSpecialOrderTaxTreatment = (order, quotation) => {
  const treatment = order?.taxTreatment;
  return ['standard', 'vat_zero_rated'].includes(treatment)
    && quotation?.customerDetails?.taxTreatment === treatment
    && quotation?.documentSnapshot?.taxTreatment === treatment
    ? treatment : null;
};

export const quotationCapabilities = (order, quotation, role, userId) => {
  const ownerId = String(order?.createdBy?._id || order?.createdBy || '');
  const allowed = ['admin', 'superadmin'].includes(role) || (role === 'cashier' && Boolean(userId) && ownerId === String(userId));
  const unfinished = ['Pending', 'In Progress'].includes(order?.status);
  const current = quotation?.isCurrent === true && (!order?.currentQuotation || String(order.currentQuotation) === String(quotation._id));
  const accepted = current && quotation.status === 'Accepted';
  const started = order?.status === 'In Progress' && String(order?.transactionQuotation || '') === String(quotation?._id || '') && accepted;
  return {
    allowed, prepare: allowed && unfinished && !quotation,
    edit: allowed && unfinished && current && quotation.status === 'Draft',
    generate: allowed && unfinished && current && quotation.status === 'Draft',
    decide: allowed && unfinished && current && quotation.status === 'Awaiting Decision',
    revise: allowed && unfinished && current && quotation.status === 'Awaiting Decision',
    complete: allowed && unfinished && started && Number(order?.workflowVersion || 1) < 2,
  };
};

export const acceptedQuotationTransaction = (order, quotation, cashier) => ({
  items: (quotation.items || []).map((item, index) => ({ name: item.itemName, description: item.description || '', sellingUnit: item.sellingUnit || '', code: `${order.orderNumber}-${index + 1}`, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), subtotal: Number(item.lineAmount) })),
  total: Number(quotation.total), grossAmount: Number(quotation.total),
  netAmount: Number(order?.workflowVersion) >= 2 ? null : Number(quotation.total),
  vatAmount: Number(order?.workflowVersion) >= 2 ? null : 0,
  ...(Number(order?.workflowVersion) >= 2 ? { vatCalculationStatus: 'not_calculated', taxTreatment: quotation.customerDetails?.taxTreatment || order.taxTreatment } : {}),
  customerName: quotation.customerName, customerDetails: { ...quotation.customerDetails }, customerId: quotation.customer || null,
  paymentMethod: Number(order?.workflowVersion) >= 2 ? 'other' : 'cash',
  ...(Number(order?.workflowVersion) >= 2 ? { collectionSource: 'special_order_ledger' } : {}),
  paymentStatus: Number(order?.workflowVersion) >= 2 ? 'Pending' : 'Paid', cashier, date: new Date().toISOString(), specialOrderNumber: order.orderNumber,
  specialOrderQuotationId: quotation._id, specialOrderQuotationVersion: quotation.version,
});

// Processing always reads the accepted snapshot, never the original request prices.
export const quotationOrderView = (order, quotation = order?.quotation) => {
  if (!quotation || !quotation.isCurrent || (order?.currentQuotation && String(order.currentQuotation) !== String(quotation._id))) return order;
  if (['In Progress', 'Completed'].includes(order.status) && quotation.status !== 'Accepted') return order;
  return {
    ...order, customerName: quotation.customerName, customerDetails: quotation.customerDetails,
    fulfillment: quotation.fulfillment || order.fulfillment,
    quotation,
    items: quotation.items.map((item) => ({ ...item, sellingPrice: item.unitPrice })),
    sellingPrice: quotation.total,
  };
};
