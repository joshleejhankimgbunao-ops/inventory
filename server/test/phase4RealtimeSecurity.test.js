const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createStreamTicket,
  consumeStreamTicket,
  publishCategoriesUpdated,
  publishRealtimeResync,
  publishUsersUpdated,
  revokeRealtimeUser,
  subscribeClient,
} = require('../src/services/realtimeService');
const User = require('../src/models/User');
const { updateUserByUsername } = require('../src/controllers/authController');

const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', ...parts), 'utf8');
const source = {
  categories: read('src/controllers/categoryController.js'),
  realtime: read('src/services/realtimeService.js'),
  auth: read('src/controllers/authController.js'),
  authMiddleware: read('src/middleware/authMiddleware.js'),
  realtimeController: read('src/controllers/realtimeController.js'),
  realtimeRoutes: read('src/routes/realtimeRoutes.js'),
  userModel: read('src/models/User.js'),
  settingController: read('src/controllers/settingController.js'),
  categoryContext: fs.readFileSync(path.resolve(__dirname, '../../src/context/InventoryContext.jsx'), 'utf8'),
  userList: fs.readFileSync(path.resolve(__dirname, '../../src/pages/UserList.jsx'), 'utf8'),
  partners: fs.readFileSync(path.resolve(__dirname, '../../src/pages/Partners.jsx'), 'utf8'),
  authContext: fs.readFileSync(path.resolve(__dirname, '../../src/context/AuthContext.jsx'), 'utf8'),
  settings: fs.readFileSync(path.resolve(__dirname, '../../src/pages/Settings.jsx'), 'utf8'),
  realtimeClient: fs.readFileSync(path.resolve(__dirname, '../../src/services/realtimeClient.js'), 'utf8'),
};

test('category create, edit/archive/restore, and delete publish safe invalidations after persistence', () => {
  assert.match(source.categories, /publishCategoriesUpdated\(\{ reason: 'category\.created'/);
  assert.match(source.categories, /await transactionalCategory\.save\(\{ session \}\);[\s\S]*?await propagateCategoryRename\([\s\S]*?publishCategoriesUpdated\(/);
  assert.match(source.categories, /updatedCategory = await category\.save\(\);[\s\S]*?publishCategoriesUpdated\(/);
  assert.match(source.categories, /await category\.deleteOne\(\);[\s\S]*?publishCategoriesUpdated\(\{ reason: 'category\.deleted'/);
  assert.match(source.realtime, /publishCategoriesUpdated[\s\S]*?publishEvent\('categories\.updated'/);
  assert.doesNotMatch(source.realtime.match(/const publishCategoriesUpdated[\s\S]*?\n};/)?.[0] || '', /email|password|phone/);
});

test('shared category state refreshes for mutations and reconnects without stale responses', () => {
  assert.match(source.categoryContext, /requestSequence === categoriesRequestSequenceRef\.current/);
  assert.match(source.categoryContext, /subscribeRealtimeEvent\('categories\.updated'/);
  assert.match(source.categoryContext, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(source.categoryContext, /unsubscribeCategories\(\);[\s\S]*?unsubscribeResync\(\);/);
  assert.match(source.categoryContext, /Review any open category filters or forms/);
});

test('user events are superadmin-scoped and access changes invalidate tokens, tickets, and streams', () => {
  assert.match(source.realtime, /const publishUsersUpdated[\s\S]*?publishEvent\('users\.updated',[\s\S]*?roles: \['superadmin'\]/);
  assert.match(source.realtime, /const revokeRealtimeUser[\s\S]*?client\.userId === normalizedUserId[\s\S]*?streamTickets\.forEach/);
  assert.match(source.userModel, /authRevokedAt:[\s\S]*?type: Date/);
  assert.match(source.authMiddleware, /tokenIssuedAtMs <= user\.authRevokedAt\.getTime\(\)/);
  assert.match(source.auth, /afterRevocationSeconds[\s\S]*?Math\.floor\(revokedAtMs \/ 1000\) \+ 1/);
  assert.match(source.auth, /const accessChanged = previousRole !== user\.role \|\| previousIsActive !== \(user\.isActive !== false\);[\s\S]*?user\.authRevokedAt = new Date\(/);
  assert.match(source.auth, /await user\.save\(\{ validateBeforeSave: false \}\);[\s\S]*?if \(accessChanged\) revokeRealtimeUser\(user\._id\);[\s\S]*?publishUsersUpdated/);
  assert.match(source.realtimeRoutes, /sessionWasRevoked[\s\S]*?if \(!user \|\| !user\.isActive \|\| sessionWasRevoked\)/);
});

test('users.updated reaches only Super Admin streams and access revocation closes the affected user', () => {
  const streams = new Map();
  const openStream = (userId, role) => {
    let output = '';
    let ended = false;
    const res = {
      writableEnded: false,
      setHeader() {},
      flushHeaders() {},
      write(chunk) { output += chunk; return true; },
      end() { ended = true; this.writableEnded = true; },
    };
    const req = { on() {} };
    subscribeClient(req, res, { _id: userId, role }, { sessionId: `${userId}-session` });
    streams.set(userId, { get output() { return output; }, get ended() { return ended; } });
  };

  openStream('admin-1', 'admin');
  openStream('cashier-1', 'cashier');
  openStream('superadmin-1', 'superadmin');
  publishUsersUpdated({ reason: 'user.access-updated' });
  assert.doesNotMatch(streams.get('admin-1').output, /event: users\.updated/);
  assert.doesNotMatch(streams.get('cashier-1').output, /event: users\.updated/);
  assert.match(streams.get('superadmin-1').output, /event: users\.updated/);
  publishCategoriesUpdated({ reason: 'category.renamed', name: 'New Name', previousName: 'Old Name' });
  publishRealtimeResync({ reason: 'system.restored' });
  for (const role of ['admin-1', 'cashier-1', 'superadmin-1']) {
    assert.match(streams.get(role).output, /event: categories\.updated/);
    assert.match(streams.get(role).output, /event: realtime\.resync/);
  }

  const ticket = createStreamTicket({ user: { _id: 'superadmin-1' } });
  revokeRealtimeUser('superadmin-1');
  assert.equal(streams.get('superadmin-1').ended, true);
  assert.equal(consumeStreamTicket(ticket.ticket), null);
  revokeRealtimeUser('admin-1');
  revokeRealtimeUser('cashier-1');
});

test('role downgrade and deactivation/reactivation revoke old sessions and active user streams', async () => {
  const originalFindOne = User.findOne;
  const user = {
    _id: 'phase4-user-1',
    name: 'Staff',
    displayName: 'Staff',
    username: 'staff-one',
    email: 'staff@example.test',
    role: 'admin',
    isPrimarySuperAdmin: false,
    isActive: true,
    authRevokedAt: null,
    preferences: {},
    save: async () => user,
  };
  User.findOne = (filter) => {
    const result = filter?.username ? user : null;
    return {
      select: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
  };

  const makeRequest = (body) => ({
    params: { username: user.username },
    body,
    user: { _id: 'primary-1', role: 'superadmin', isPrimarySuperAdmin: true },
  });
  const makeResponse = () => ({ body: null, json(value) { this.body = value; return this; } });
  const openStream = (role) => {
    let ended = false;
    const res = {
      writableEnded: false,
      setHeader() {},
      flushHeaders() {},
      write() { return true; },
      end() { ended = true; this.writableEnded = true; },
    };
    subscribeClient({ on() {} }, res, { _id: user._id, role }, { sessionId: `session-${role}` });
    return () => ended;
  };

  try {
    const adminStreamEnded = openStream('admin');
    const oldSessionTicket = createStreamTicket({ user, authIssuedAtMs: Date.now() - 5000 });
    const downgradeResponse = makeResponse();
    await updateUserByUsername(makeRequest({ role: 'cashier' }), downgradeResponse, assert.fail);
    assert.ok(user.authRevokedAt instanceof Date);
    const firstRevocationAt = user.authRevokedAt.getTime();
    assert.equal(user.role, 'cashier');
    assert.equal(adminStreamEnded(), true);
    assert.equal(consumeStreamTicket(oldSessionTicket.ticket), null);

    user.isActive = true;
    const activeStreamEnded = openStream('cashier');
    const preDeactivationTicket = createStreamTicket({ user, authIssuedAtMs: firstRevocationAt - 1000 });
    await updateUserByUsername(makeRequest({ isActive: false }), makeResponse(), assert.fail);
    const secondRevocationAt = user.authRevokedAt.getTime();
    assert.ok(secondRevocationAt > firstRevocationAt);
    assert.equal(user.isActive, false);
    assert.equal(activeStreamEnded(), true);
    assert.equal(consumeStreamTicket(preDeactivationTicket.ticket), null);

    await updateUserByUsername(makeRequest({ isActive: true }), makeResponse(), assert.fail);
    assert.ok(user.authRevokedAt.getTime() > secondRevocationAt);
    assert.equal(user.isActive, true);
  } finally {
    User.findOne = originalFindOne;
    revokeRealtimeUser(user._id);
  }
});

test('User List resynchronizes safely while preserving page and unfinished forms', () => {
  assert.match(source.userList, /subscribeRealtimeEvent\('users\.updated'/);
  assert.match(source.userList, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(source.userList, /preservePage: true/);
  assert.match(source.userList, /requestSequence !== usersRequestSequenceRef\.current/);
  assert.match(source.auth, /publishUsersUpdated\(\{ reason: 'user\.created' \}\)/);
  assert.match(source.auth, /revokeRealtimeUser\(user\._id\);[\s\S]*?publishUsersUpdated\(\{ reason: 'user\.deleted' \}\)/);
});

test('Partners, global settings, and backup history resynchronize with request cleanup', () => {
  assert.match(source.partners, /subscribeRealtimeEvent\('partners\.updated'/);
  assert.match(source.partners, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(source.partners, /requestSequence === partnersRequestSequenceRef\.current/);
  assert.match(source.authContext, /subscribeRealtimeEvent\('settings\.updated'/);
  assert.match(source.authContext, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(source.authContext, /refreshPending && !disposed/);
  assert.match(source.settings, /subscribeRealtimeEvent\('settings\.updated'/);
  assert.match(source.settings, /subscribeRealtimeEvent\('realtime\.resync'/);
  assert.match(source.settings, /backupHistoryRequestSequenceRef/);
});

test('backup restore invalidation occurs only after commit and forces fresh authorization', () => {
  const restore = source.settingController.match(/const restoreSystemBackup = async[\s\S]*?\n};/)?.[0] || '';
  const commitIndex = restore.indexOf('await session.withTransaction');
  const resyncIndex = restore.indexOf("publishRealtimeResync({ reason: 'system.restored' })");
  const revokeIndex = restore.indexOf('revokeAllRealtimeConnections()');
  assert.ok(commitIndex >= 0 && resyncIndex > commitIndex && revokeIndex > resyncIndex);
  assert.match(source.realtime, /const publishRealtimeResync[\s\S]*?publishEvent\('realtime\.resync'/);
  assert.match(source.realtime, /const revokeAllRealtimeConnections = \(\) => \{[\s\S]*?streamTickets\.clear\(\);[\s\S]*?removeClient\(clientId, \{ close: true \}\)/);
  assert.match(source.realtimeClient, /dispatchers\.has\(eventName\)/);
});
