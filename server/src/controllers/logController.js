const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');
const User = require('../models/User');
const mongoose = require('mongoose');
const { publishActivityRead } = require('../services/realtimeService');

const toPositiveInt = (value, fallback = 50, max = 200) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

const buildUnreadActivityQuery = ({ userId, actorName, readAt, readId }) => {
  const clauses = [];
  if (userId) clauses.push({ userRef: { $ne: userId } });
  if (actorName) clauses.push({ user: { $ne: actorName } });

  if (readAt) {
    const markerDate = new Date(readAt);
    if (!Number.isNaN(markerDate.getTime())) {
      const markerId = mongoose.Types.ObjectId.isValid(String(readId || ''))
        ? new mongoose.Types.ObjectId(String(readId))
        : null;
      clauses.push(markerId
        ? { $or: [
          { createdAt: { $gt: markerDate } },
          { createdAt: markerDate, _id: { $gt: markerId } },
        ] }
        : { createdAt: { $gt: markerDate } });
    }
  }

  return clauses.length ? { $and: clauses } : {};
};

const getLatestActivityLog = (activityModel = ActivityLog) => activityModel.findOne()
  .sort({ createdAt: -1, _id: -1 })
  .select('_id createdAt')
  .lean();

const actorDisplayName = (user) => String(user?.displayName || user?.name || user?.username || '').trim();

const getActivityUnreadCount = async (req, res, next, dependencies = {}) => {
  try {
    const activityModel = dependencies.ActivityLog || ActivityLog;
    const userModel = dependencies.User || User;
    let currentUser = req.user;
    let preferences = currentUser?.preferences || {};
    let readAt = preferences.activityLogReadAt || null;
    let readId = preferences.activityLogReadId || '';

    // Legacy users who had already viewed logs have no exact historical cursor.
    // Treat the latest existing entry as their migration baseline so old logs do
    // not suddenly appear as thousands of unread items after this upgrade.
    if (!readAt && !readId && preferences.hasViewedLogs) {
      const latest = dependencies.findLatestActivityLog
        ? await dependencies.findLatestActivityLog()
        : await getLatestActivityLog(activityModel);
      readAt = latest?.createdAt || new Date();
      readId = latest?._id ? String(latest._id) : '';
      await userModel.updateOne({
        _id: currentUser._id,
        'preferences.activityLogReadAt': null,
        'preferences.activityLogReadId': { $in: ['', null] },
      }, {
        $set: {
          'preferences.activityLogReadAt': readAt,
          'preferences.activityLogReadId': readId,
        },
      });
      currentUser = await userModel.findById(currentUser._id).select('name displayName username preferences');
      preferences = currentUser?.preferences || {};
      readAt = preferences.activityLogReadAt || readAt;
      readId = preferences.activityLogReadId || readId;
    }

    const query = buildUnreadActivityQuery({
      userId: currentUser?._id,
      actorName: actorDisplayName(currentUser),
      readAt,
      readId,
    });
    const count = await (dependencies.countActivityLogs
      ? dependencies.countActivityLogs(query)
      : activityModel.countDocuments(query));
    return res.json({ count: Math.max(0, Number(count) || 0) });
  } catch (error) {
    return next(error);
  }
};

const markActivityLogsRead = async (req, res, next, dependencies = {}) => {
  try {
    const activityModel = dependencies.ActivityLog || ActivityLog;
    const userModel = dependencies.User || User;
    const latest = dependencies.findLatestActivityLog
      ? await dependencies.findLatestActivityLog()
      : await getLatestActivityLog(activityModel);
    const readAt = latest?.createdAt || new Date();
    const readId = latest?._id ? String(latest._id) : '';
    const newerCursorFilter = {
      _id: req.user._id,
      $or: [
        { 'preferences.activityLogReadAt': { $exists: false } },
        { 'preferences.activityLogReadAt': null },
        { 'preferences.activityLogReadAt': { $lt: readAt } },
        {
          'preferences.activityLogReadAt': readAt,
          'preferences.activityLogReadId': { $lt: readId },
        },
      ],
    };
    const result = await userModel.updateOne(newerCursorFilter, {
      $set: {
        'preferences.hasViewedLogs': true,
        'preferences.activityLogReadAt': readAt,
        'preferences.activityLogReadId': readId,
      },
    });
    if (!result?.matchedCount && !result?.n) {
      const userExists = dependencies.userExists
        ? await dependencies.userExists(req.user._id)
        : await userModel.exists({ _id: req.user._id });
      if (!userExists) return res.status(404).json({ message: 'User not found.' });
    }

    (dependencies.publishRead || publishActivityRead)({ userId: req.user._id });
    return res.json({ count: 0 });
  } catch (error) {
    return next(error);
  }
};

const buildDateFilter = (from, to) => {
  const createdAt = {};

  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) {
      createdAt.$gte = fromDate;
    }
  }

  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) {
      createdAt.$lte = toDate;
    }
  }

  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
};

const listActivityLogs = async (req, res, next) => {
  try {
    const action = normalize(req.query?.action);
    const user = normalize(req.query?.user);
    const from = normalize(req.query?.from);
    const to = normalize(req.query?.to);
    const limit = toPositiveInt(req.query?.limit, 50);

    const query = {
      ...buildDateFilter(from, to),
    };

    if (action) {
      query.action = action;
    }

    if (user) {
      query.user = { $regex: user, $options: 'i' };
    }

    const logs = await ActivityLog.find(query)
      .populate('userRef', 'name displayName username role')
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json(logs);
  } catch (error) {
    return next(error);
  }
};

const listInventoryLogs = async (req, res, next) => {
  try {
    const action = normalize(req.query?.action);
    const user = normalize(req.query?.user);
    const code = normalize(req.query?.code).toUpperCase();
    const from = normalize(req.query?.from);
    const to = normalize(req.query?.to);
    const limit = toPositiveInt(req.query?.limit, 50);

    const query = {
      ...buildDateFilter(from, to),
    };

    if (action) {
      query.action = action.toUpperCase();
    }

    if (user) {
      query.user = { $regex: user, $options: 'i' };
    }

    if (code) {
      query.code = { $regex: `^${code}`, $options: 'i' };
    }

    const logs = await InventoryLog.find(query)
      .populate('userRef', 'name displayName username role')
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json(logs);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listActivityLogs,
  listInventoryLogs,
  getActivityUnreadCount,
  markActivityLogsRead,
  buildUnreadActivityQuery,
};
