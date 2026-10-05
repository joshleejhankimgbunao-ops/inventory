const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');
const { publishActivityLogged, publishInventoryLogged } = require('./realtimeService');

// Opt-in strict path; best-effort logService callers keep their current behavior.
// Database errors propagate to withTransaction. Each retry gets its own outbox.
const withAuditedTransaction = async (work) => {
  const session = await mongoose.startSession();
  let notifications = [];
  let result;
  try {
    await session.withTransaction(async () => {
      notifications = [];
      const writeLog = async (Model, publish, { user = null, ...fields }) => {
        const [log] = await Model.create([{
          ...fields,
          userRef: user?._id || null,
          user: user?.name || user?.displayName || user?.username || 'System',
        }], { session });
        if (!log) throw new Error('Required audit log was not written.');
        notifications.push(() => publish({
          id: log._id, action: log.action, user: log.user,
          code: log.code, occurredAt: log.createdAt,
        }));
        return log;
      };
      result = await work({
        session,
        writeActivityLog: (entry) => writeLog(ActivityLog, publishActivityLogged, entry),
        writeInventoryLog: (entry) => writeLog(InventoryLog, publishInventoryLogged, entry),
        afterCommit: (notify) => notifications.push(notify),
      });
    });
  } finally {
    await session.endSession();
  }
  // Delivery failure must not turn an already committed operation into a retry.
  for (const notify of notifications) {
    try { await notify(); } catch (error) {
      console.warn('[AUDIT] Post-commit notification failed:', error.message);
    }
  }
  return result;
};

module.exports = { withAuditedTransaction };
