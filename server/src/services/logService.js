const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');

const normalizeUserName = (user, fallback = 'System') => {
  if (!user) return fallback;
  return user.name || user.username || fallback;
};

const writeActivityLog = async ({
  user = null,
  action,
  details = '',
  ipAddress = '',
  userAgent = '',
}) => {
  if (!action) {
    return null;
  }

  try {
    return await ActivityLog.create({
      userRef: user?._id || null,
      user: normalizeUserName(user),
      action,
      details,
      ipAddress,
      userAgent,
    });
  } catch (error) {
    console.warn('[LOGGING] Failed to write activity log:', error.message);
    return null;
  }
};

const writeInventoryLog = async ({
  action,
  code,
  productRef = null,
  user = null,
  details = '',
  quantity = null,
  stockBefore = null,
  stockAfter = null,
}) => {
  if (!action || !code) {
    return null;
  }

  try {
    return await InventoryLog.create({
      action,
      code,
      productRef,
      userRef: user?._id || null,
      user: normalizeUserName(user),
      details,
      quantity,
      stockBefore,
      stockAfter,
    });
  } catch (error) {
    console.warn('[LOGGING] Failed to write inventory log:', error.message);
    return null;
  }
};

module.exports = {
  writeActivityLog,
  writeInventoryLog,
};
