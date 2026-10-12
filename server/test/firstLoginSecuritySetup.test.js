const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const test = require('node:test');

const User = require('../src/models/User');
const { completeFirstLoginSecuritySetup, updateMyProfile } = require('../src/controllers/authController');

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return body;
  },
});

const createFirstLoginUser = async (overrides = {}) => ({
  _id: 'first-login-user',
  name: 'First Login User',
  displayName: 'First Login User',
  username: 'user-000010',
  email: 'first-login@example.com',
  phone: '',
  avatarUrl: '',
  preferences: {},
  role: 'cashier',
  isActive: true,
  mustChangeCredentials: true,
  password: await bcrypt.hash('TemporaryPass1!', 4),
  pinHash: await bcrypt.hash('123456', 4),
  saveCalls: 0,
  async save() {
    this.saveCalls += 1;
    return this;
  },
  ...overrides,
});

test('first-login setup requires both a valid password and a six-digit PIN before changing anything', async (context) => {
  const originalFindById = User.findById;
  context.after(() => {
    User.findById = originalFindById;
  });

  const user = await createFirstLoginUser();
  User.findById = () => ({ select: async () => user });

  const response = createResponse();
  await completeFirstLoginSecuritySetup({
    user: { _id: user._id },
    body: { newPassword: 'ValidPass1!', newPin: '12345' },
  }, response, assert.fail);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /newPin must be exactly 6 digits/i);
  assert.equal(user.mustChangeCredentials, true);
  assert.equal(user.saveCalls, 0);
});

test('first-login setup updates password and leading-zero PIN together before clearing the required flag', async (context) => {
  const originalFindById = User.findById;
  context.after(() => {
    User.findById = originalFindById;
  });

  const user = await createFirstLoginUser();
  User.findById = () => ({ select: async () => user });

  const response = createResponse();
  await completeFirstLoginSecuritySetup({
    user: { _id: user._id },
    body: { newPassword: 'UpdatedPass1!', newPin: '062517' },
  }, response, assert.fail);

  assert.equal(response.statusCode, 200);
  assert.equal(user.saveCalls, 1);
  assert.equal(user.mustChangeCredentials, false);
  assert.equal(await bcrypt.compare('UpdatedPass1!', user.password), true);
  assert.equal(await bcrypt.compare('062517', user.pinHash), true);
  assert.equal(response.body.user.mustChangeCredentials, false);
});

test('first-login setup cannot be repeated after the required flag is cleared', async (context) => {
  const originalFindById = User.findById;
  context.after(() => {
    User.findById = originalFindById;
  });

  const user = await createFirstLoginUser({ mustChangeCredentials: false });
  User.findById = () => ({ select: async () => user });

  const response = createResponse();
  await completeFirstLoginSecuritySetup({
    user: { _id: user._id },
    body: { newPassword: 'UpdatedPass1!', newPin: '062517' },
  }, response, assert.fail);

  assert.equal(response.statusCode, 409);
  assert.equal(user.saveCalls, 0);
});

test('the normal self-profile endpoint cannot clear first-login setup with a single credential change', async (context) => {
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  context.after(() => {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
  });

  const user = await createFirstLoginUser();
  const originalPassword = user.password;
  User.findById = () => ({ select: async () => user });
  User.findOne = async () => null;

  const response = createResponse();
  await updateMyProfile({
    user: { _id: user._id, role: 'cashier' },
    body: { username: user.username, newPassword: 'UpdatedPass1!', currentPassword: 'TemporaryPass1!' },
  }, response, assert.fail);

  assert.equal(response.statusCode, 409);
  assert.equal(user.mustChangeCredentials, true);
  assert.equal(user.password, originalPassword);
  assert.equal(user.saveCalls, 0);
});

test('the required first-login setup is rendered as one non-dismissible password-and-PIN flow', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Profile.jsx'), 'utf8');

  assert.match(source, /Secure Your Account/);
  assert.match(source, /Save & Continue/);
  assert.match(source, /Confirm New Password/);
  assert.match(source, /Confirm Security PIN/);
  assert.match(source, /completeFirstLoginSecuritySetupApi/);
  assert.doesNotMatch(source, /setShowSecurityRequirementModal/);
});
