const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');
const { publishActivityLogged, publishInventoryLogged } = require('./realtimeService');
const { deferPostCommitNotification, withPostCommitNotifications } = require('./postCommitNotifications');

// Database errors propagate to withTransaction. Notifications share the same
// retry-safe post-commit queue used by logService transactional callers.
const withAuditedTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await withPostCommitNotifications(session, async () => {
      const writeLog = async (Model, publish, { user = null, ...fields }) => {
        const [log] = await Model.create([{
          ...fields,
          userRef: user?._id || null,
          user: user?.name || user?.displayName || user?.username || 'System',
        }], { session });
        if (!log) throw new Error('Required audit log was not written.');
        deferPostCommitNotification(session, () => publish({
          id: log._id, action: log.action, user: log.user,
          code: log.code, occurredAt: log.createdAt,
        }));
        return log;
      };
      return await work({
        session,
        writeActivityLog: (entry) => writeLog(ActivityLog, publishActivityLogged, entry),
        writeInventoryLog: (entry) => writeLog(InventoryLog, publishInventoryLogged, entry),
        afterCommit: (notify) => deferPostCommitNotification(session, notify),
      });
    });
  } finally {
    await session.endSession();
  }
};

module.exports = { withAuditedTransaction };
