const persistedObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value || '').trim());

export const canOfferSaleVoid = (transaction, { isAdmin = false, isOnline = true } = {}) => Boolean(
  isAdmin
  && isOnline
  && persistedObjectId(transaction?.sourceId)
  && transaction?.voidEligible === true
  && String(transaction?.status || 'completed').toLowerCase() !== 'voided'
);

export const isVoidedOrderConfirmation = (transaction, isOrderConfirmation = false) => Boolean(
  isOrderConfirmation && String(transaction?.status || '').trim().toLowerCase() === 'voided'
);
