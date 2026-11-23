const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');
const { publishActivityLogged, publishInventoryLogged } = require('./realtimeService');
const { deferPostCommitNotification } = require('./postCommitNotifications');

const publishLogNotification = (session, notify) => {
  if (!session) {
    notify();
    return;
  }

  if (deferPostCommitNotification(session, notify)) return;

  // Never announce a session-bound log while its transaction is still open.
  // Transactional callers use withPostCommitNotifications to flush after commit.
  if (typeof session.inTransaction === 'function' && session.inTransaction()) return;
  notify();
};

const normalizeUserName = (user, fallback = 'System') => {
  if (!user) return fallback;
  return user.displayName || user.name || user.username || fallback;
};

const writeActivityLog = async ({
  user = null,
  action,
  details = '',
  ipAddress = '',
  userAgent = '',
  session = null,
}) => {
  if (!action) {
    return null;
  }

  try {
    const [created] = await ActivityLog.create([{
      userRef: user?._id || null,
      user: normalizeUserName(user),
      action,
      details,
      ipAddress,
      userAgent,
    }], session ? { session } : undefined);

    if (created) {
      publishLogNotification(session, () => publishActivityLogged({
        id: created._id,
        action: created.action,
        user: created.user,
        occurredAt: created.createdAt,
      }));
    }

    return created || null;
  } catch (error) {
    console.warn('[LOGGING] Failed to write activity log:', error.message);
    return null;
  }
};

const writeInventoryLog = async ({
  action,
  code,
  productRef = null,
  saleRef = null,
  specialOrderRef = null,
  user = null,
  details = '',
  quantity = null,
  stockBefore = null,
  stockAfter = null,
  batchMovementRefs = [],
  session = null,
}) => {
  if (!action || !code) {
    return null;
  }

  try {
    const [created] = await InventoryLog.create([{
      action,
      code,
      productRef,
      saleRef,
      specialOrderRef,
      userRef: user?._id || null,
      user: normalizeUserName(user),
      details,
      quantity,
      stockBefore,
      stockAfter,
      batchMovementRefs: Array.isArray(batchMovementRefs) ? batchMovementRefs : [],
    }], session ? { session } : undefined);

    if (created) {
      publishLogNotification(session, () => publishInventoryLogged({
        id: created._id,
        action: created.action,
        code: created.code,
        user: created.user,
        occurredAt: created.createdAt,
      }));
    }

    return created || null;
  } catch (error) {
    console.warn('[LOGGING] Failed to write inventory log:', error.message);
    return null;
  }
};

module.exports = {
  writeActivityLog,
  writeInventoryLog,
};
