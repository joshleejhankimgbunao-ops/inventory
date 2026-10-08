const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const logServicePath = require.resolve('../src/services/logService');
require.cache[logServicePath] = {
  id: logServicePath,
  filename: logServicePath,
  loaded: true,
  exports: { writeActivityLog: async () => {} },
};

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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { login, listUsers } = require('../src/controllers/authController');

const createResponse = () => ({
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

const createUser = (overrides = {}) => {
  const user = {
    _id: overrides._id || 'user-1',
    name: overrides.name || 'Test User',
    displayName: overrides.displayName || 'Test User',
    username: overrides.username || 'test-user',
    email: overrides.email || 'test@example.com',
    phone: '',
    avatarUrl: '',
    preferences: {},
    role: 'cashier',
    isPrimarySuperAdmin: false,
    isActive: overrides.isActive ?? true,
    lastLogin: overrides.lastLogin ?? null,
    mustChangeCredentials: false,
    password: 'hash',
    pinHash: null,
    saveCalls: 0,
    select() {
      return this;
    },
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };

  return user;
};

test('user list returns persisted active state and last-login values', async () => {
  const originalFind = User.find;
  const lastLogin = new Date('2026-08-30T12:34:00.000Z');
  const users = [
    createUser({ _id: 'active-user', username: 'active-user', isActive: true, lastLogin }),
    createUser({ _id: 'inactive-user', username: 'inactive-user', isActive: false, lastLogin: null }),
  ];
  User.find = () => ({ sort: async () => users });

  try {
    const response = createResponse();
    await listUsers({}, response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.map((user) => user.isActive), [true, false]);
    assert.equal(new Date(response.body[0].lastLogin).toISOString(), lastLogin.toISOString());
    assert.equal(response.body[1].lastLogin, null);
  } finally {
    User.find = originalFind;
  }
});

test('a successful authentication persists and returns lastLogin', async () => {
  const originalFindOne = User.findOne;
  const originalCompare = bcrypt.compare;
  const originalSign = jwt.sign;
  const originalJwtSecret = process.env.JWT_SECRET;
  const user = createUser();
  User.findOne = () => user;
  bcrypt.compare = async () => true;
  jwt.sign = () => 'signed-token';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');

  try {
    const response = createResponse();
    const startedAt = Date.now();
    await login(
      { body: { username: 'test-user', password: 'correct-password' }, ip: '127.0.0.1', get: () => '' },
      response,
      assert.fail,
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.token, 'signed-token');
    assert.equal(user.saveCalls, 1);
    assert.ok(user.lastLogin instanceof Date || typeof user.lastLogin === 'number');
    assert.ok(new Date(user.lastLogin).getTime() >= startedAt);
    assert.equal(new Date(response.body.user.lastLogin).getTime(), new Date(user.lastLogin).getTime());
  } finally {
    User.findOne = originalFindOne;
    bcrypt.compare = originalCompare;
    jwt.sign = originalSign;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('a failed password attempt leaves the persisted lastLogin unchanged', async () => {
  const originalFindOne = User.findOne;
  const originalCompare = bcrypt.compare;
  const priorLogin = new Date('2026-08-29T12:34:00.000Z');
  const user = createUser({ lastLogin: priorLogin });
  User.findOne = () => user;
  bcrypt.compare = async () => false;

  try {
    const response = createResponse();
    await login(
      { body: { username: 'test-user', password: 'wrong-password' }, ip: '127.0.0.1', get: () => '' },
      response,
      assert.fail,
    );

    assert.equal(response.statusCode, 401);
    assert.equal(user.saveCalls, 0);
    assert.equal(user.lastLogin.toISOString(), priorLogin.toISOString());
  } finally {
    User.findOne = originalFindOne;
    bcrypt.compare = originalCompare;
  }
});

test('User Management last-login formatting uses Asia/Manila and a clean Never fallback', async () => {
  const { formatUserLastLogin } = await import('../../src/utils/userLastLogin.js');
  const date = '2026-08-30T16:30:00.000Z';

  assert.equal(formatUserLastLogin(null), 'Never');
  assert.equal(formatUserLastLogin('not-a-date'), 'Never');
  assert.match(formatUserLastLogin(date), /Aug 31, 2026.*12:30\s*AM/i);
});
