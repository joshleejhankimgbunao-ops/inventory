import { getValidSales, isValidCreditCollectionForReporting } from '../../shared/saleLifecycle.mjs';

const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const addDays = (value, days) => {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
};

const parseDateInput = (value) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getDashboardComparisonPeriod = ({
  dateRange,
  now = new Date(),
  customStartDate = '',
  customEndDate = '',
  specificDate = '',
}) => {
  const today = startOfDay(now);
  let currentStart;
  let currentEnd;
  let label;
  let previousStart;
  let previousEnd;

  switch (dateRange) {
    case 'today':
      currentStart = today;
      currentEnd = addDays(today, 1);
      label = 'yesterday';
      break;
    case 'week':
      // Match the Dashboard's existing rolling "This Week" start date.
      currentStart = addDays(today, -7);
      currentEnd = addDays(today, 1);
      label = 'last week';
      break;
    case 'month':
      currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
      currentEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      label = 'last month';
      previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      previousEnd = currentStart;
      break;
    case 'year':
      currentStart = new Date(today.getFullYear(), 0, 1);
      currentEnd = new Date(today.getFullYear() + 1, 0, 1);
      label = 'last year';
      previousStart = new Date(today.getFullYear() - 1, 0, 1);
      previousEnd = currentStart;
      break;
    case 'specific_date': {
      const selectedDate = parseDateInput(specificDate);
      if (!selectedDate) return null;
      currentStart = selectedDate;
      currentEnd = addDays(selectedDate, 1);
      label = 'previous day';
      break;
    }
    case 'custom': {
      const start = parseDateInput(customStartDate);
      const end = parseDateInput(customEndDate);
      if (!start || !end || end < start) return null;
      currentStart = start;
      currentEnd = addDays(end, 1);
      label = 'previous period';
      break;
    }
    default:
      return null;
  }

  const duration = currentEnd.getTime() - currentStart.getTime();
  return {
    label,
    previousStart: previousStart || new Date(currentStart.getTime() - duration),
    previousEnd: previousEnd || currentStart,
  };
};

export const getPreviousPeriodMetrics = (transactions, period) => (
  getValidSales(transactions).reduce((summary, transaction) => {
    const transactionDate = new Date(transaction?.date);
    if (Number.isNaN(transactionDate.getTime()) || transactionDate < period.previousStart || transactionDate >= period.previousEnd) {
      return summary;
    }

    const total = Number(transaction?.total || 0);
    return {
      sales: summary.sales + (Number.isFinite(total) ? total : 0),
      orders: summary.orders + 1,
    };
  }, { sales: 0, orders: 0 })
);

export const getPreviousSalesReportMetrics = (transactions, creditTransactions, period) => {
  const summary = getValidSales(transactions).reduce((result, transaction) => {
    const transactionDate = new Date(transaction?.date);
    if (Number.isNaN(transactionDate.getTime()) || transactionDate < period.previousStart || transactionDate >= period.previousEnd) {
      return result;
    }

    const total = Number(transaction?.total || 0);
    const itemCount = (transaction?.items || []).reduce((count, item) => {
      const quantity = Number(item?.qty || 0);
      return count + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);
    return {
      collectedRevenue: result.collectedRevenue + (String(transaction?.paymentMethod || '').toLowerCase() === 'credit' || !Number.isFinite(total) ? 0 : total),
      orders: result.orders + 1,
      items: result.items + itemCount,
    };
  }, { collectedRevenue: 0, orders: 0, items: 0 });

  const creditCollections = (Array.isArray(creditTransactions) ? creditTransactions : []).filter(isValidCreditCollectionForReporting).reduce((total, creditTransaction) => (
    total + (creditTransaction?.paymentHistory || []).reduce((paymentTotal, payment) => {
      const paymentDate = new Date(payment?.paymentDate);
      const amount = Number(payment?.amount || 0);
      return Number.isNaN(paymentDate.getTime())
        || paymentDate < period.previousStart
        || paymentDate >= period.previousEnd
        || !Number.isFinite(amount)
        ? paymentTotal
        : paymentTotal + amount;
    }, 0)
  ), 0);

  return {
    ...summary,
    collectedRevenue: summary.collectedRevenue + creditCollections,
  };
};

export const getMetricTrend = (currentValue, previousValue) => {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const delta = current - previous;

  if (delta === 0) return { direction: 'neutral', delta: 0, percentage: null };
  if (previous === 0) return { direction: 'up', delta, percentage: null };

  return {
    direction: delta > 0 ? 'up' : 'down',
    delta,
    percentage: Math.abs((delta / previous) * 100),
  };
};
