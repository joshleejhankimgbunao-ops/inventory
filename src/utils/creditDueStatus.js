import { isValidCreditCollectionForReporting } from '../../shared/saleLifecycle.mjs';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toCalendarStart = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const getCreditDueStatus = (record, now = new Date()) => {
  const storedStatus = String(record?.status || '').trim().toLowerCase();
  if (storedStatus === 'cancelled') return 'Cancelled';

  const remainingBalance = Number(record?.remainingBalance || 0);
  if (storedStatus === 'paid' || remainingBalance <= 0) return 'Paid';

  const dueDate = toCalendarStart(record?.dueDate);
  const today = toCalendarStart(now);
  if (!dueDate || !today) return 'Unpaid';

  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / DAY_IN_MS);
  if (daysUntilDue < 0) return 'Overdue';
  if (daysUntilDue === 0) return 'Due Today';
  if (daysUntilDue <= 3) return 'Near Due';
  return 'Unpaid';
};

export const getCreditDueAlertCounts = (records, now = new Date()) => {
  return (Array.isArray(records) ? records : []).reduce((counts, record) => {
    const status = getCreditDueStatus(record, now);
    if (status === 'Overdue') counts.overdue += 1;
    if (status === 'Due Today') counts.dueToday += 1;
    if (status === 'Near Due') counts.nearDue += 1;
    return counts;
  }, { overdue: 0, dueToday: 0, nearDue: 0 });
};

export const getOutstandingCreditSummary = (records, now = new Date()) => {
  return (Array.isArray(records) ? records : []).reduce((summary, record) => {
    const status = getCreditDueStatus(record, now);
    const remainingBalance = Number(record?.remainingBalance || 0);

    if (!isValidCreditCollectionForReporting(record) || !Number.isFinite(remainingBalance) || remainingBalance <= 0 || status === 'Paid' || status === 'Cancelled') {
      return summary;
    }

    summary.outstandingBalance += remainingBalance;
    summary.openCount += 1;
    if (status === 'Overdue') summary.overdueCount += 1;
    return summary;
  }, { outstandingBalance: 0, openCount: 0, overdueCount: 0 });
};
