const { getManilaCalendarDayNumber } = require('../utils/manilaCalendar');

const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const manilaCalendarDayNumber = getManilaCalendarDayNumber;

const getExtensionEntry = (log) => {
  const details = String(log?.details || '');
  const match = details.match(/^Credit transaction (\S+) term extended by (\d+) day\(s\)\./i);
  const days = Number(match?.[2]);
  const createdAt = parseDate(log?.createdAt);
  if (!match || !Number.isSafeInteger(days) || days < 1 || !createdAt) return null;
  return {
    transactionId: match[1].toLowerCase(),
    days,
    createdAt,
    authenticated: Boolean(log?.userRef),
  };
};

const getPaymentActionEntry = (log) => {
  if (String(log?.action || '') !== 'Recorded Credit Payment' || !log?.userRef) return null;
  const details = String(log.details || '');
  const match = details.match(/^Credit transaction (\S+) payment recorded: (\d+(?:\.\d{1,2})?)\. Remaining balance: (\d+(?:\.\d{1,2})?)\.$/i);
  const createdAt = parseDate(log?.createdAt);
  if (!match || !createdAt) return null;
  return {
    transactionId: match[1].toLowerCase(),
    amountCents: Math.round(Number(match[2]) * 100),
    remainingBalanceCents: Math.round(Number(match[3]) * 100),
    userRef: String(log.userRef),
    createdAt,
  };
};

const getPaymentTimeline = (transaction, paymentActionLogs = []) => {
  const rawPayments = Array.isArray(transaction?.paymentHistory) ? transaction.paymentHistory : [];
  const amountPaidCents = Math.round(Number(transaction?.amountPaid || 0) * 100);
  const totalAmountCents = Math.round(Number(transaction?.totalAmount) * 100);
  const remainingBalanceCents = Math.round(Number(transaction?.remainingBalance) * 100);
  if (!Number.isFinite(amountPaidCents) || amountPaidCents < 0) return { reliable: false, payments: [], reason: 'Payment totals are invalid.' };
  if (!Number.isFinite(totalAmountCents) || !Number.isFinite(remainingBalanceCents)) {
    return { reliable: false, payments: [], reason: 'Order amount or remaining balance is unavailable.' };
  }

  const parsedPayments = rawPayments.map((payment, historyIndex) => {
    const paymentDate = parseDate(payment?.paymentDate);
    const amount = Number(payment?.amount);
    const amountCents = Math.round(amount * 100);
    if (!paymentDate || !Number.isFinite(amountCents) || amountCents < 0) return null;
    const hasRecordedAt = payment?.recordedAt !== undefined && payment?.recordedAt !== null && payment?.recordedAt !== '';
    const recordedAt = hasRecordedAt ? parseDate(payment.recordedAt) : null;
    return {
      historyIndex,
      paymentDate,
      paymentDay: manilaCalendarDayNumber(paymentDate),
      amountCents,
      amount,
      type: String(payment?.type || 'payment'),
      clientRequestId: String(payment?.clientRequestId || '').trim(),
      recordedById: payment?.recordedById ? String(payment.recordedById) : '',
      recordedAt,
      hasRecordedAt,
      invalidRecordedAt: hasRecordedAt && !recordedAt,
    };
  });

  const payments = parsedPayments.filter(Boolean);
  if (parsedPayments.some((payment) => !payment)) return { reliable: false, payments, reason: 'Payment dates or amounts are invalid.' };
  if (payments.some((payment) => payment.invalidRecordedAt)) {
    return { reliable: false, payments, reason: 'Payment recording timestamps are invalid.' };
  }
  const paymentRequestIds = payments.map((payment) => payment.clientRequestId).filter(Boolean);
  if (new Set(paymentRequestIds).size !== paymentRequestIds.length) {
    return { reliable: false, payments, reason: 'Duplicate payment entries were found in payment history.' };
  }
  const paidCentsFromHistory = payments.reduce((total, payment) => total + payment.amountCents, 0);
  if (paidCentsFromHistory !== amountPaidCents) {
    return { reliable: false, payments, reason: 'Payment entries do not reconcile with the recorded paid amount.' };
  }
  if (amountPaidCents + remainingBalanceCents !== totalAmountCents) {
    return { reliable: false, payments, reason: 'Recorded payments and balance do not reconcile with the credit order total.' };
  }
  const paymentActionEntries = (Array.isArray(paymentActionLogs) ? paymentActionLogs : [])
    .map(getPaymentActionEntry)
    .filter((entry) => entry?.transactionId === String(transaction?.creditTransactionId || '').trim().toLowerCase());
  let fullPaymentDate = null;
  let fullPaymentRecordedAt = null;
  let fullPaymentRecordedAtSource = '';
  let fullPaymentActionConflict = false;
  if (totalAmountCents > 0 && amountPaidCents === totalAmountCents && remainingBalanceCents === 0) {
    let cumulativePaidCents = 0;
    for (const payment of payments) {
      cumulativePaidCents += payment.amountCents;
      if (cumulativePaidCents >= totalAmountCents) {
        fullPaymentDate = payment.paymentDate;
        const expectedRemainingCents = Math.max(0, totalAmountCents - cumulativePaidCents);
        const matchingPayments = payments.filter((candidate, candidateIndex) => {
          let cumulative = 0;
          for (let index = 0; index <= candidateIndex; index += 1) cumulative += payments[index].amountCents;
          return candidate.amountCents === payment.amountCents
            && Math.max(0, totalAmountCents - cumulative) === expectedRemainingCents;
        });
        const matchingLogs = paymentActionEntries.filter((entry) => (
          entry.amountCents === payment.amountCents
          && entry.remainingBalanceCents === expectedRemainingCents
        ));

        if (payment.recordedAt) {
          fullPaymentRecordedAt = payment.recordedAt;
          fullPaymentRecordedAtSource = 'payment-history';
          if (matchingLogs.length > 1 || (matchingLogs.length === 1 && (
            matchingLogs[0].createdAt < payment.recordedAt
            || (payment.recordedById && matchingLogs[0].userRef !== payment.recordedById)
          ))) {
            fullPaymentActionConflict = true;
          }
        } else if (payment.type.toLowerCase() === 'down_payment'
          && payment.clientRequestId.startsWith('initial-down-payment:')) {
          // The original POS path generated both this payment date and the
          // ledger entry server-side at credit-sale creation.
          fullPaymentRecordedAt = payment.paymentDate;
          fullPaymentRecordedAtSource = 'server-created-down-payment';
        } else if (matchingPayments.length === 1 && matchingLogs.length === 1
          && (!payment.recordedById || matchingLogs[0].userRef === payment.recordedById)) {
          // Legacy logs have no request ID, so accept them only when the
          // authenticated actor, transaction, amount, and resulting balance
          // uniquely identify this payment entry.
          fullPaymentRecordedAt = matchingLogs[0].createdAt;
          fullPaymentRecordedAtSource = 'authenticated-activity-log';
        } else if (matchingLogs.length > 0) {
          fullPaymentActionConflict = true;
        }
        break;
      }
    }
  }

  return {
    reliable: true,
    payments,
    fullPaymentDate,
    fullPaymentRecordedAt,
    fullPaymentRecordedAtSource,
    fullPaymentActionConflict,
    reason: '',
  };
};

const getExtensionTimeline = (transaction, allLogs) => {
  const transactionId = String(transaction?.creditTransactionId || '').trim().toLowerCase();
  const matchingLogs = (Array.isArray(allLogs) ? allLogs : [])
    .map(getExtensionEntry)
    .filter((entry) => entry?.transactionId === transactionId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const originalDueDate = parseDate(transaction?.originalDueDate);
  const currentDueDate = parseDate(transaction?.dueDate);
  const hasOriginalDueDate = transaction?.originalDueDate !== undefined
    && transaction?.originalDueDate !== null
    && transaction?.originalDueDate !== '';

  if (!originalDueDate) {
    return {
      reliable: matchingLogs.length === 0 && Boolean(currentDueDate) && !hasOriginalDueDate,
      lateDays: 0,
      hasExtensionHistory: matchingLogs.length > 0 || hasOriginalDueDate,
      extensions: [],
    };
  }
  if (!currentDueDate || matchingLogs.length === 0) {
    return { reliable: false, lateDays: 0, hasExtensionHistory: true, extensions: [] };
  }

  const originalDueDay = manilaCalendarDayNumber(originalDueDate);
  let effectiveDueDay = originalDueDay;
  let lateDays = 0;
  let daysAlreadyAdded = 0;
  const extensions = [];
  if (effectiveDueDay === null) return { reliable: false, lateDays: 0, hasExtensionHistory: true, extensions };

  for (const extension of matchingLogs) {
    const extensionDay = manilaCalendarDayNumber(extension.createdAt);
    if (extensionDay === null) return { reliable: false, lateDays: 0, hasExtensionHistory: true, extensions };
    if (extensionDay > effectiveDueDay) lateDays += extensionDay - effectiveDueDay;
    extensions.push({ ...extension, extensionDay, priorDueDay: effectiveDueDay });
    daysAlreadyAdded += extension.days;
    // Due dates are Manila calendar days, independent of the backend host timezone.
    effectiveDueDay = originalDueDay + daysAlreadyAdded;
  }

  return {
    reliable: effectiveDueDay === manilaCalendarDayNumber(currentDueDate),
    lateDays,
    hasExtensionHistory: true,
    extensions,
  };
};

const getOverdueBeforeExtensionDays = (extensionTimeline, fullPaymentDate) => {
  if (!extensionTimeline.hasExtensionHistory || !extensionTimeline.reliable) return null;
  const paidDay = fullPaymentDate ? manilaCalendarDayNumber(fullPaymentDate) : null;
  const overdueIntervals = extensionTimeline.extensions
    .map(({ extensionDay, priorDueDay }) => ({
      start: priorDueDay + 1,
      end: paidDay === null ? extensionDay : Math.min(extensionDay, paidDay),
    }))
    .filter(({ start, end }) => end >= start)
    .sort((a, b) => a.start - b.start);

  // Merge intervals defensively so a malformed or overlapping history cannot
  // count the same Manila calendar day twice.
  let totalDays = 0;
  let currentStart = null;
  let currentEnd = null;
  for (const interval of overdueIntervals) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      totalDays += currentEnd - currentStart + 1;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentStart !== null) totalDays += currentEnd - currentStart + 1;
  return totalDays;
};

const deriveCurrentPaymentStatus = (transaction, now) => {
  const status = String(transaction?.status || '').toLowerCase();
  if (status === 'cancelled' || transaction?.cancelledAt) return 'Cancelled';
  const remaining = Number(transaction?.remainingBalance || 0);
  const amountPaid = Number(transaction?.amountPaid || 0);
  const dueDay = manilaCalendarDayNumber(transaction?.dueDate);
  const todayDay = manilaCalendarDayNumber(now);
  if (remaining <= 0) return 'Paid';
  if (dueDay !== null && todayDay !== null && dueDay < todayDay) return 'Overdue';
  return amountPaid > 0 ? 'Partially Paid' : 'Unpaid';
};

const getExtensionSettlementIssue = (extensionTimeline, paymentTimeline) => {
  if (!paymentTimeline.fullPaymentDate || extensionTimeline.extensions.length === 0) return '';
  if (paymentTimeline.fullPaymentActionConflict) {
    return 'Payment and audit records do not establish a reliable ledger sequence.';
  }
  if (!paymentTimeline.fullPaymentRecordedAt) {
    const paidDay = manilaCalendarDayNumber(paymentTimeline.fullPaymentDate);
    if (extensionTimeline.extensions.some((extension) => extension.extensionDay === paidDay)) {
      return 'Payment and extension share a calendar date, but their ledger order cannot be confirmed.';
    }
    return 'A reliable ledger-recorded time for full payment is unavailable.';
  }
  for (const extension of extensionTimeline.extensions) {
    if (!extension.authenticated) {
      return 'An extension timestamp is not linked to an authenticated actor.';
    }
    if (extension.createdAt.getTime() === paymentTimeline.fullPaymentRecordedAt.getTime()) {
      return 'The extension and full payment have indistinguishable recorded times.';
    }
    if (extension.createdAt > paymentTimeline.fullPaymentRecordedAt) {
      return 'An extension was recorded after the full payment was recorded in the ledger.';
    }
  }

  return '';
};

const classifyCreditOrder = (transaction, extensionLogs, now, paymentActionLogs = []) => {
  const dueDate = parseDate(transaction?.dueDate);
  const dueDay = manilaCalendarDayNumber(dueDate);
  const todayDay = manilaCalendarDayNumber(now);
  const remaining = Number(transaction?.remainingBalance || 0);
  const status = deriveCurrentPaymentStatus(transaction, now);
  const isCancelled = status === 'Cancelled';
  const paymentTimeline = getPaymentTimeline(transaction, paymentActionLogs);
  const extensionTimeline = getExtensionTimeline(transaction, extensionLogs);
  const cancelDate = parseDate(transaction?.cancelledAt);
  const cancelDay = manilaCalendarDayNumber(cancelDate);
  const fullPaymentDay = manilaCalendarDayNumber(paymentTimeline.fullPaymentDate);
  const overdueTimelineMayBeRelevant = extensionTimeline.hasExtensionHistory
    || (dueDay !== null && todayDay !== null && dueDay < todayDay)
    || (isCancelled && cancelDay !== null && dueDay !== null && cancelDay > dueDay);

  let paymentDaysLate = null;
  let overdueBeforeExtensionDays = null;
  let overdueAtCancellationDays = null;
  let confirmedOverdue = false;
  let currentlyOverdue = false;
  let unverifiedReason = '';

  if (!dueDate) {
    unverifiedReason = 'Due date is missing or invalid.';
  } else if ((transaction?.originalDueDate || extensionTimeline.hasExtensionHistory) && !extensionTimeline.reliable) {
    unverifiedReason = 'Credit extension history is incomplete or does not match the recorded due date.';
  } else if (!paymentTimeline.reliable && overdueTimelineMayBeRelevant) {
    unverifiedReason = paymentTimeline.reason || 'Payment history does not reconcile with the credit order balance.';
  } else if (getExtensionSettlementIssue(extensionTimeline, paymentTimeline)) {
    unverifiedReason = getExtensionSettlementIssue(extensionTimeline, paymentTimeline);
  } else if (extensionTimeline.extensions.some((extension) => cancelDate && extension.createdAt > cancelDate)) {
    unverifiedReason = 'An extension was recorded after the order was cancelled.';
  } else if (isCancelled && remaining > 0 && dueDay !== null && cancelDay === null && dueDay < todayDay) {
    unverifiedReason = 'Cancellation date is unavailable for a past-due order.';
  } else if (remaining <= 0 && !paymentTimeline.fullPaymentDate && dueDay !== null && todayDay !== null && dueDay < todayDay) {
    unverifiedReason = 'Payment dates are unavailable, so the settlement timing cannot be verified.';
  } else {
    overdueBeforeExtensionDays = getOverdueBeforeExtensionDays(extensionTimeline, paymentTimeline.fullPaymentDate);
    if (remaining <= 0 && fullPaymentDay !== null && dueDay !== null) {
      paymentDaysLate = Math.max(0, fullPaymentDay - dueDay);
    }

    if (isCancelled && remaining > 0 && cancelDay !== null && dueDay !== null && cancelDay > dueDay) {
      confirmedOverdue = true;
      overdueAtCancellationDays = cancelDay - dueDay;
    } else if (!isCancelled && remaining > 0 && dueDay !== null && todayDay !== null && dueDay < todayDay) {
      currentlyOverdue = true;
      confirmedOverdue = true;
    }

    if (Number.isFinite(overdueBeforeExtensionDays) && overdueBeforeExtensionDays > 0) confirmedOverdue = true;
    if (Number.isFinite(paymentDaysLate) && paymentDaysLate > 0) confirmedOverdue = true;
  }

  return {
    confirmedOverdue,
    currentlyOverdue,
    paymentDaysLate,
    overdueBeforeExtensionDays,
    overdueAtCancellationDays,
    // Keep the old response key as a compatibility alias, now with the clearly
    // defined final-payment metric rather than extension-delay days.
    daysLate: paymentDaysLate,
    unverifiedReason,
    paymentStatus: status,
    dueDate,
    originalDueDate: parseDate(transaction?.originalDueDate),
    paymentHistory: paymentTimeline.payments.map((payment) => ({
      paymentDate: payment.paymentDate,
      amount: payment.amount,
      type: payment.type,
    })),
  };
};

const buildCustomerOverdueHistory = (transactions, extensionLogs = [], now = new Date(), paymentActionLogs = []) => {
  const customers = new Map();

  for (const transaction of transactions || []) {
    const rawName = String(transaction?.customerName || '').trim();
    const name = rawName || 'Unknown customer';
    const customerId = String(transaction?.customerId || '').trim();
    const transactionId = String(transaction?.creditTransactionId || '').trim();
    const unlinkedRecordId = transactionId || String(transaction?._id || 'unknown');
    const groupKey = customerId
      ? `id:${customerId}`
      : rawName
        ? `name:${name.toLocaleLowerCase()}`
        : `unlinked-order:${unlinkedRecordId}`;
    if (!customers.has(groupKey)) {
      customers.set(groupKey, {
        customerKey: groupKey,
        customerName: name,
        customerIdentityUnverified: !customerId,
        totalCreditOrders: 0,
        lifetimeOverdueCount: 0,
        currentlyOverdueCount: 0,
        unverifiedCount: 0,
        overdueOrders: [],
        unverifiedOrders: [],
      });
    }

    const customer = customers.get(groupKey);
    customer.customerName = name;
    customer.totalCreditOrders += 1;
    const result = classifyCreditOrder(transaction, extensionLogs, now, paymentActionLogs);
    const order = {
      creditTransactionId: String(transaction?.creditTransactionId || ''),
      createdAt: parseDate(transaction?.createdAt),
      dueDate: result.dueDate,
      originalDueDate: result.originalDueDate,
      paymentStatus: result.paymentStatus,
      totalAmount: Number(transaction?.totalAmount || 0),
      amountPaid: Number(transaction?.amountPaid || 0),
      remainingBalance: Number(transaction?.remainingBalance || 0),
      paymentHistory: result.paymentHistory,
      daysLate: result.confirmedOverdue ? result.paymentDaysLate : null,
      paymentDaysLate: result.confirmedOverdue ? result.paymentDaysLate : null,
      overdueBeforeExtensionDays: result.confirmedOverdue ? result.overdueBeforeExtensionDays : null,
      overdueAtCancellationDays: result.confirmedOverdue ? result.overdueAtCancellationDays : null,
      currentlyOverdue: result.currentlyOverdue,
    };

    if (result.confirmedOverdue) {
      customer.lifetimeOverdueCount += 1;
      if (result.currentlyOverdue) customer.currentlyOverdueCount += 1;
      customer.overdueOrders.push(order);
    } else if (result.unverifiedReason) {
      customer.unverifiedCount += 1;
      customer.unverifiedOrders.push({ ...order, reason: result.unverifiedReason });
    }
  }

  return Array.from(customers.values()).sort((a, b) => (
    b.lifetimeOverdueCount - a.lifetimeOverdueCount
    || a.customerName.localeCompare(b.customerName)
  ));
};

module.exports = {
  buildCustomerOverdueHistory,
  classifyCreditOrder,
  getPaymentTimeline,
  getExtensionTimeline,
  manilaCalendarDayNumber,
  // Keep the original export name for existing test/tooling consumers.
  localDayNumber: manilaCalendarDayNumber,
};
