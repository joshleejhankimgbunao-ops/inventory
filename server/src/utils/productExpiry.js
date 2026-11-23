const isValidExpiryDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const manilaDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});

const getManilaBusinessDate = (now = new Date()) => {
  const parts = Object.fromEntries(manilaDateFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const classifyExpiryBatch = ({ expiryDate, remainingQuantity, balanceConfirmed, asOfDate }) => {
  if (!isValidExpiryDate(expiryDate) || !isValidExpiryDate(asOfDate)) {
    throw new Error('Expiry classification requires valid calendar dates.');
  }
  const daysUntilExpiry = Math.round((Date.parse(`${expiryDate}T00:00:00.000Z`) - Date.parse(`${asOfDate}T00:00:00.000Z`)) / 86400000);
  if (balanceConfirmed && Number(remainingQuantity) === 0) {
    return { status: 'Depleted', daysUntilExpiry };
  }
  if (daysUntilExpiry <= 0) return { status: 'Expired', daysUntilExpiry };
  if (daysUntilExpiry <= 30) return { status: 'Expiring Soon', daysUntilExpiry };
  return { status: 'Valid', daysUntilExpiry };
};

const isFutureExpiryDate = (value, now = new Date()) =>
  isValidExpiryDate(value) && value > getManilaBusinessDate(now);

const buildInitialExpiry = ({ body, stock, sellingUnit, user, now = new Date() }) => {
  if (body.expiryTrackingEnabled !== undefined && typeof body.expiryTrackingEnabled !== 'boolean') {
    throw new Error('Expiry tracking must be enabled or disabled.');
  }
  const expiryTrackingEnabled = body.expiryTrackingEnabled === true;
  if (!expiryTrackingEnabled) return { expiryTrackingEnabled: false, initialStockBatch: null };
  if (typeof body.clientRequestId !== 'string' || !body.clientRequestId.trim()) {
    throw new Error('A request ID is required when creating an expiry-tracked product.');
  }
  if (Number(stock) === 0) return { expiryTrackingEnabled, initialStockBatch: null };

  const expiryDate = body.initialStockBatch?.expiryDate;
  if (!isValidExpiryDate(expiryDate)) {
    throw new Error('Enter a valid expiry date for the initial stock batch (YYYY-MM-DD).');
  }
  if (!isFutureExpiryDate(expiryDate, now)) {
    throw new Error('Expiry date must be later than today.');
  }
  const lotValue = body.initialStockBatch?.lotNumber;
  if (lotValue !== undefined && typeof lotValue !== 'string') {
    throw new Error('Batch/Lot Number must be text.');
  }
  const lotNumber = (lotValue || '').trim();
  if (lotNumber.length > 100) throw new Error('Batch/Lot Number cannot exceed 100 characters.');

  return {
    expiryTrackingEnabled,
    initialStockBatch: {
      quantityReceived: stock,
      sellingUnit,
      expiryDate,
      lotNumber,
      receivedBy: user?._id || null,
    },
  };
};

module.exports = { buildInitialExpiry, isValidExpiryDate, isFutureExpiryDate, getManilaBusinessDate, classifyExpiryBatch };
