export const PENDING_VOID_REQUEST_FILTER = 'PENDING_VOID';

export const isPendingVoidRequest = (sale) => (
  String(sale?.voidRequest?.status || '').trim().toLowerCase() === 'pending'
);

export const countPendingVoidRequests = (sales) => (
  Array.isArray(sales) ? sales.filter(isPendingVoidRequest).length : 0
);

export const getPendingVoidRequestAlertSessionKey = (userId) => (
  `pending-void-request-alert-shown:${String(userId || '').trim()}`
);
