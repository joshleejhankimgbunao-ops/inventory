import { approvedSpecialOrderTaxTreatment, quotationCapabilities } from './specialOrderQuotation.js';

const hasCurrentAcceptedQuotation = (order, quotation) => quotation?.status === 'Accepted'
  && quotation?.isCurrent === true
  && (!order?.currentQuotation || String(order.currentQuotation) === String(quotation?._id || ''))
  && String(order?.transactionQuotation || '') === String(quotation?._id || '')
  && Boolean(approvedSpecialOrderTaxTreatment(order, quotation));

export const canViewSpecialOrderTransaction = (order, hasPermission) => {
  const linkedSaleId = order?.linkedSaleId;
  const hasLinkedSale = typeof linkedSaleId === 'string'
    ? linkedSaleId.trim().length > 0
    : Boolean(linkedSaleId && typeof linkedSaleId === 'object' && (linkedSaleId._id || linkedSaleId.id));

  return order?.status === 'Completed' && hasLinkedSale && hasPermission === true;
};

export const getPhaseFiveTableNextAction = ({
  order,
  quotation = order?.quotation,
  paymentLedger = null,
  paymentLoading = false,
  paymentError = '',
  quotationError = '',
  stockAvailability = null,
  stockLoading = false,
  stockError = '',
  role,
  userId,
}) => {
  if (Number(order?.workflowVersion) < 2 || order?.status !== 'In Progress') return null;

  const capabilities = quotationCapabilities(order, quotation, role, userId);
  if (!capabilities.allowed || !['cashier', 'admin', 'superadmin'].includes(role)) return null;
  if (paymentLoading) return { type: 'checking', label: 'Checking...', reason: 'Checking payment status.' };
  if (paymentError) return { type: 'payment-blocked', label: 'Record Payment', reason: 'Payment status could not be checked. Open View Details to retry.' };

  const quotationReady = hasCurrentAcceptedQuotation(order, quotation);
  const paymentComplete = paymentLedger?.status === 'Fully Paid' && paymentLedger?.remainingBalanceCentavos === 0;
  if (!paymentComplete) {
    return quotationReady
      ? { type: 'record-payment', label: 'Record Payment' }
      : { type: 'payment-blocked', label: 'Record Payment', reason: quotationError || 'Accepted quotation needs review.' };
  }

  if (!quotationReady) return { type: 'complete-blocked', label: 'Complete Order', reason: quotationError || 'Accepted quotation needs review.' };
  if (stockLoading) return { type: 'checking', label: 'Checking...', reason: 'Checking stock and fulfillment.' };
  if (stockError || !stockAvailability) {
    return { type: 'complete-blocked', label: 'Complete Order', reason: 'Stock status could not be checked. Open View Details to retry.' };
  }

  const inventoryItems = (stockAvailability.items || []).filter((item) => item.itemType === 'inventory');
  if (inventoryItems.some((item) => item.reservationNeedsReview)) {
    return { type: 'complete-blocked', label: 'Complete Order', reason: 'A stock reservation needs review.' };
  }
  if (inventoryItems.some((item) => Number(item.shortage || 0) > 0)) {
    return { type: 'complete-blocked', label: 'Complete Order', reason: 'Insufficient stock to complete this order.' };
  }
  if (stockAvailability.fulfillment?.canComplete !== true) {
    return { type: 'complete-blocked', label: 'Complete Order', reason: 'Order requirements are not ready.' };
  }

  return { type: 'complete-order', label: 'Complete Order' };
};
