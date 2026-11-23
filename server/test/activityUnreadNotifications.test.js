const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const mongoose = require('mongoose');
const {
  buildUnreadActivityQuery,
  getActivityUnreadCount,
  markActivityLogsRead,
} = require('../src/controllers/logController');
const { publishActivityRead, revokeRealtimeUser, subscribeClient } = require('../src/services/realtimeService');

const source = (relativePath) => fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');

test('unread activity count uses a stable date and ID cursor and excludes the current actor', () => {
  const markerId = new mongoose.Types.ObjectId();
  const markerDate = new Date('2026-10-30T10:00:00.000Z');
  const query = buildUnreadActivityQuery({
    userId: new mongoose.Types.ObjectId(),
    actorName: 'Current Admin',
    readAt: markerDate,
    readId: markerId.toString(),
  });

  assert.ok(query.$and[0].userRef.$ne instanceof mongoose.Types.ObjectId);
  assert.deepEqual(query.$and[1], { user: { $ne: 'Current Admin' } });
  assert.deepEqual(query.$and[2], { $or: [
    { createdAt: { $gt: markerDate } },
    { createdAt: markerDate, _id: { $gt: markerId } },
  ] });
});

test('legacy viewed logs establish a one-time cursor before returning the authoritative unread count', async () => {
  const markerId = new mongoose.Types.ObjectId();
  const markerDate = new Date('2026-10-30T11:00:00.000Z');
  const persisted = {};
  let countedQuery;
  const userDoc = {
    _id: 'admin-id',
    name: 'Current Admin',
    displayName: 'Current Admin',
    preferences: { hasViewedLogs: true },
  };
  const fakeUserModel = {
    async updateOne(filter, update) {
      assert.equal(String(filter._id), userDoc._id);
      Object.assign(persisted, update.$set);
      userDoc.preferences.activityLogReadAt = persisted['preferences.activityLogReadAt'];
      userDoc.preferences.activityLogReadId = persisted['preferences.activityLogReadId'];
      return { matchedCount: 1 };
    },
    findById() {
      return { select: async () => userDoc };
    },
  };
  const response = { body: null, json(value) { this.body = value; return this; } };
  await getActivityUnreadCount({ user: userDoc }, response, assert.fail, {
    User: fakeUserModel,
    findLatestActivityLog: async () => ({ _id: markerId, createdAt: markerDate }),
    countActivityLogs: async (query) => { countedQuery = query; return 4; },
  });

  assert.equal(response.body.count, 4);
  assert.equal(persisted['preferences.activityLogReadAt'], markerDate);
  assert.equal(persisted['preferences.activityLogReadId'], markerId.toString());
  assert.deepEqual(countedQuery.$and[2].$or[1]._id.$gt, markerId);
});

test('an Admin with no qualifying unread activity receives a zero count', async () => {
  const userId = new mongoose.Types.ObjectId();
  const response = { body: null, json(value) { this.body = value; return this; } };
  let query;
  await getActivityUnreadCount({ user: {
    _id: userId,
    name: 'Current Admin',
    preferences: { activityLogReadAt: new Date('2026-10-30T10:00:00.000Z'), activityLogReadId: new mongoose.Types.ObjectId().toString() },
  } }, response, assert.fail, {
    countActivityLogs: async (value) => { query = value; return 0; },
  });

  assert.equal(response.body.count, 0);
  assert.ok(query.$and[0].userRef.$ne.equals(userId));
});

test('Admin and Super Admin receive counts from the same unread source', async () => {
  for (const role of ['admin', 'superadmin']) {
    const response = { body: null, json(value) { this.body = value; return this; } };
    await getActivityUnreadCount({ user: {
      _id: new mongoose.Types.ObjectId(),
      role,
      name: `${role} user`,
      preferences: { activityLogReadAt: new Date('2026-10-30T10:00:00.000Z'), activityLogReadId: new mongoose.Types.ObjectId().toString() },
    } }, response, assert.fail, { countActivityLogs: async () => 2 });
    assert.equal(response.body.count, 2, `${role} count`);
  }
});

test('opening Activity Log persists its read cursor and sends a user-scoped realtime update', async () => {
  const markerId = new mongoose.Types.ObjectId();
  const markerDate = new Date('2026-10-30T12:00:00.000Z');
  let savedUpdate;
  let publishedFor;
  const response = { body: null, json(value) { this.body = value; return this; } };
  await markActivityLogsRead({ user: { _id: 'target-admin' } }, response, assert.fail, {
    findLatestActivityLog: async () => ({ _id: markerId, createdAt: markerDate }),
    User: { updateOne: async (_filter, update) => { savedUpdate = update.$set; return { matchedCount: 1 }; } },
    publishRead: ({ userId }) => { publishedFor = userId; },
  });

  assert.equal(response.body.count, 0);
  assert.equal(savedUpdate['preferences.hasViewedLogs'], true);
  assert.equal(savedUpdate['preferences.activityLogReadAt'], markerDate);
  assert.equal(savedUpdate['preferences.activityLogReadId'], markerId.toString());
  assert.equal(publishedFor, 'target-admin');
});

test('a delayed read request cannot move the stored cursor backwards', async () => {
  let updateFilter;
  let published = false;
  const response = { body: null, json(value) { this.body = value; return this; } };
  await markActivityLogsRead({ user: { _id: 'target-admin' } }, response, assert.fail, {
    findLatestActivityLog: async () => ({ _id: '66f000000000000000000001', createdAt: new Date('2026-10-30T12:00:00.000Z') }),
    User: { updateOne: async (filter) => { updateFilter = filter; return { matchedCount: 0 }; } },
    userExists: async () => true,
    publishRead: () => { published = true; },
  });

  assert.ok(updateFilter.$or.some((condition) => condition['preferences.activityLogReadAt']?.$lt));
  assert.equal(response.body.count, 0);
  assert.equal(published, true);
});

test('activity.read is delivered only to the matching Admin or Super Admin session', () => {
  const streams = new Map();
  const openStream = (userId, role) => {
    let output = '';
    const response = {
      writableEnded: false,
      setHeader() {},
      flushHeaders() {},
      write(chunk) { output += chunk; return true; },
      end() { this.writableEnded = true; },
    };
    subscribeClient({ on() {} }, response, { _id: userId, role }, { sessionId: `${userId}-session` });
    streams.set(userId, { get output() { return output; } });
  };

  openStream('target-admin', 'admin');
  openStream('target-superadmin', 'superadmin');
  openStream('other-admin', 'admin');
  openStream('cashier', 'cashier');
  publishActivityRead({ userId: 'target-admin' });
  publishActivityRead({ userId: 'target-superadmin' });
  assert.match(streams.get('target-admin').output, /event: activity\.read/);
  assert.match(streams.get('target-superadmin').output, /event: activity\.read/);
  assert.doesNotMatch(streams.get('other-admin').output, /event: activity\.read/);
  assert.doesNotMatch(streams.get('cashier').output, /event: activity\.read/);
  for (const id of ['target-admin', 'target-superadmin', 'other-admin', 'cashier']) revokeRealtimeUser(id);
});

test('Dashboard refreshes count on activity, read-state, and reconnect events while retaining existing badge placement', () => {
  const dashboard = source('src/pages/Dashboard.jsx');
  const routes = source('server/src/routes/logRoutes.js');
  assert.match(dashboard, /getUnreadActivityCountApi/);
  assert.match(dashboard, /subscribeRealtimeEvent\('activity\.logged'/);
  assert.match(dashboard, /subscribeRealtimeEvent\('activity\.read'/);
  assert.match(dashboard, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(dashboard, /markActivityLogsReadApi()/);
  assert.match(dashboard, /unreadActivityCount > 0/);
  assert.match(routes, /authorizeRoles\('superadmin', 'admin'\), getActivityUnreadCount/);
  assert.match(routes, /authorizeRoles\('superadmin', 'admin'\), markActivityLogsRead/);
});

test('profile indicators share the unread count, stay compact, and do not clear on dropdown open', () => {
  const dashboard = source('src/pages/Dashboard.jsx');
  assert.match(dashboard, /const unreadActivityLabel = unreadActivityCount > 99 \? '99\+' : String\(unreadActivityCount\)/);
  assert.match(dashboard, /h-2\.5 w-2\.5 translate-x-1\/2 -translate-y-1\/2 rounded-full bg-red-500/);
  assert.match(dashboard, /h-5 min-w-5 shrink-0 items-center justify-center whitespace-nowrap rounded-full/);
  assert.equal((dashboard.match(/isAdminOrAbove\(\) && unreadActivityCount > 0/g) || []).length, 2);

  const dropdownOpenHandler = dashboard.match(/onClick=\{\(\) => setIsProfileMenuOpen\(!isProfileMenuOpen\)\}/);
  assert.ok(dropdownOpenHandler, 'profile dropdown remains independently toggleable');
  assert.match(dashboard, /if \(!isActivityLogOpen \|\| !\['admin', 'superadmin'\]/);
  assert.match(dashboard, /markActivityLogsReadApi\(\)/);
});
