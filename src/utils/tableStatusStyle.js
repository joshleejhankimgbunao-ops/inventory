const ACTIVE_STATUSES = new Set([
  'pending',
  'in progress',
  'ready for pickup',
  'unpaid',
  'partially paid',
  'near due',
  'due today',
]);

const CRITICAL_STATUSES = new Set(['overdue']);

export const getAttentionRowClass = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (CRITICAL_STATUSES.has(normalizedStatus)) return 'attention-row-critical';
  if (ACTIVE_STATUSES.has(normalizedStatus)) return 'attention-row-active';
  return 'attention-row-final';
};

export const getAttentionStatusGroup = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (CRITICAL_STATUSES.has(normalizedStatus)) return 'critical';
  if (ACTIVE_STATUSES.has(normalizedStatus)) return 'active';
  return 'final';
};
