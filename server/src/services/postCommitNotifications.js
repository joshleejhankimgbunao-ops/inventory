const notificationsBySession = new WeakMap();

const deferPostCommitNotification = (session, notification) => {
  const notifications = session && notificationsBySession.get(session);
  if (!notifications || typeof notification !== 'function') return false;
  notifications.push(notification);
  return true;
};

const withPostCommitNotifications = async (session, work) => {
  if (!session || typeof session.withTransaction !== 'function' || typeof work !== 'function') {
    throw new TypeError('A transaction session and work callback are required.');
  }

  let notifications = [];
  const result = await session.withTransaction(async (...args) => {
    // The MongoDB driver may invoke the callback again after a transient error.
    // Keep only notifications registered by the attempt that ultimately commits.
    notifications = [];
    notificationsBySession.set(session, notifications);
    try {
      return await work(...args);
    } finally {
      notificationsBySession.delete(session);
    }
  });

  for (const notify of notifications) {
    try {
      await notify();
    } catch (error) {
      // A notification must never turn an already committed write into a retry.
      console.warn('[REALTIME] Post-commit notification failed:', error?.message || error);
    }
  }

  return result;
};

module.exports = { deferPostCommitNotification, withPostCommitNotifications };
