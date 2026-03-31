const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');

const toPositiveInt = (value, fallback = 50, max = 200) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

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
};
