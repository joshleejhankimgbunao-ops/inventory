const test = require('node:test');
const assert = require('node:assert/strict');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: {
    publishActivityLogged: () => {},
    publishInventoryLogged: () => {},
    revokeRealtimeSession: () => {},
  },
};

const User = require('../src/models/User');
const Setting = require('../src/models/Setting');
const { updateMyPreferences } = require('../src/controllers/authController');

const makeUser = (username, autoPrintReceipts) => {
  const user = new User({
    name: username,
    username,
    password: 'Password123',
    role: 'cashier',
  });

  if (autoPrintReceipts !== undefined) {
    user.preferences.autoPrintReceipts = autoPrintReceipts;
  }

  return user;
};

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

test('Auto Print defaults OFF and remains independent between users with the same role', () => {
  const cashierA = makeUser('cashier-a', true);
  const cashierB = makeUser('cashier-b');

  assert.equal(cashierA.preferences.autoPrintReceipts, true);
  assert.equal(cashierB.preferences.autoPrintReceipts, false);

  cashierB.preferences.autoPrintReceipts = true;

  assert.equal(cashierA.preferences.autoPrintReceipts, true);
  assert.equal(cashierB.preferences.autoPrintReceipts, true);

  cashierA.preferences.autoPrintReceipts = false;

  assert.equal(cashierA.preferences.autoPrintReceipts, false);
  assert.equal(cashierB.preferences.autoPrintReceipts, true);
});

test('Auto Print is a user preference and is not part of global Settings', () => {
  assert.ok(User.schema.path('preferences.autoPrintReceipts'));
  assert.equal(Setting.schema.path('autoPrintReceipts'), undefined);

  const existingUserWithoutExplicitAutoPrint = new User({
    name: 'Existing User',
    username: 'existing-user',
    password: 'Password123',
    preferences: { darkMode: true },
  });

  assert.equal(existingUserWithoutExplicitAutoPrint.preferences.autoPrintReceipts, false);
});

test('self preference endpoint updates only the authenticated user and ignores arbitrary user IDs', async () => {
  const originalFindById = User.findById;
  const authenticatedUser = makeUser('cashier-a', false);
  authenticatedUser.isActive = true;
  let queriedUserId = '';
  let saveCount = 0;
  authenticatedUser.save = async () => {
    saveCount += 1;
    return authenticatedUser;
  };

  User.findById = async (userId) => {
    queriedUserId = String(userId);
    return authenticatedUser;
  };

  try {
    const req = {
      user: { _id: 'authenticated-user-a' },
      body: {
        autoPrintReceipts: true,
        userId: 'attempted-target-user-b',
      },
    };
    const res = makeResponse();
    let forwardedError = null;

    await updateMyPreferences(req, res, (error) => {
      forwardedError = error;
    });

    assert.equal(forwardedError, null);
    assert.equal(queriedUserId, 'authenticated-user-a');
    assert.equal(saveCount, 1);
    assert.equal(authenticatedUser.preferences.autoPrintReceipts, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.preferences.autoPrintReceipts, true);
  } finally {
    User.findById = originalFindById;
  }
});

test('self preference endpoint rejects a payload containing no supported preference', async () => {
  const originalFindById = User.findById;
  const authenticatedUser = makeUser('cashier-a', false);
  authenticatedUser.isActive = true;
  let saveCount = 0;
  authenticatedUser.save = async () => {
    saveCount += 1;
    return authenticatedUser;
  };

  User.findById = async () => authenticatedUser;

  try {
    const req = {
      user: { _id: 'authenticated-user-a' },
      body: { userId: 'attempted-target-user-b' },
    };
    const res = makeResponse();

    await updateMyPreferences(req, res, (error) => {
      throw error;
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'No valid preferences fields provided.');
    assert.equal(saveCount, 0);
    assert.equal(authenticatedUser.preferences.autoPrintReceipts, false);
  } finally {
    User.findById = originalFindById;
  }
});
