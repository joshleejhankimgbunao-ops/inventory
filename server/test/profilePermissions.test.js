/* global require, __dirname */
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const test = require('node:test');

const User = require('../src/models/User');
const { updateMyEmail, updateMyProfile } = require('../src/controllers/authController');

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

const createUser = async (overrides = {}) => ({
  _id: 'cashier-1',
  name: 'Cashier One',
  displayName: 'Cashier One',
  username: 'cashier.one',
  email: 'cashier@example.com',
  phone: '09171234567',
  avatarUrl: '',
  role: 'cashier',
  isActive: true,
  password: await bcrypt.hash('CurrentPass1!', 4),
  pinHash: await bcrypt.hash('123456', 4),
  preferences: {},
  save: async () => {},
  ...overrides,
});

test('cashiers cannot update identity or employment details through self-service endpoints', async (context) => {
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  context.after(() => {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
  });

  User.findById = () => assert.fail('restricted cashier requests must be rejected before reading the user');
  User.findOne = () => assert.fail('restricted cashier requests must be rejected before checking duplicates');

  for (const payload of [
    { name: 'Changed Name' },
    { displayName: 'Changed Display Name' },
    { email: 'changed@example.com' },
    { phone: '09991234567' },
    { role: 'admin' },
  ]) {
    const response = createResponse();
    await updateMyProfile({ user: { _id: 'cashier-1', role: 'cashier' }, body: payload }, response, assert.fail);
    assert.equal(response.statusCode, 403);
    assert.match(response.body.message, /managed by an administrator/i);
  }

  const emailResponse = createResponse();
  await updateMyEmail({ user: { _id: 'cashier-1', role: 'cashier' }, body: { email: 'changed@example.com' } }, emailResponse, assert.fail);
  assert.equal(emailResponse.statusCode, 403);
});

test('cashiers can still update username, password, and PIN under existing verification rules', async (context) => {
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  context.after(() => {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
  });

  const user = await createUser();
  User.findById = () => ({ select: async () => user });
  User.findOne = async () => null;

  const response = createResponse();
  await updateMyProfile({
    user: { _id: 'cashier-1', role: 'cashier' },
    body: {
      username: 'cashier.renamed',
      currentPassword: 'CurrentPass1!',
      newPassword: 'UpdatedPass1!',
      currentPin: '123456',
      newPin: '654321',
    },
  }, response, assert.fail);

  assert.equal(response.statusCode, 200);
  assert.equal(user.username, 'cashier.renamed');
  assert.equal(await bcrypt.compare('UpdatedPass1!', user.password), true);
  assert.equal(await bcrypt.compare('654321', user.pinHash), true);
  assert.equal(user.name, 'Cashier One');
  assert.equal(user.email, 'cashier@example.com');
  assert.equal(user.phone, '09171234567');
});

test('non-cashier self-profile updates retain their existing identity update capability', async (context) => {
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  context.after(() => {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
  });

  const user = await createUser({ role: 'admin', username: 'admin.one', email: 'admin@example.com' });
  User.findById = () => ({ select: async () => user });
  User.findOne = async () => null;

  const response = createResponse();
  await updateMyProfile({
    user: { _id: 'cashier-1', role: 'admin' },
    body: {
      username: 'admin.renamed',
      name: 'Admin Renamed',
      displayName: 'Admin Display',
      email: 'admin.renamed@example.com',
      phone: '09991234567',
    },
  }, response, assert.fail);

  assert.equal(response.statusCode, 200);
  assert.equal(user.name, 'Admin Renamed');
  assert.equal(user.displayName, 'Admin Display');
  assert.equal(user.email, 'admin.renamed@example.com');
  assert.equal(user.phone, '09991234567');
});

test('Profile renders Cashier personal details as read-only and keeps Automatic Printing available', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Profile.jsx'), 'utf8');

  assert.match(source, /const isCashierProfile = userRole === ROLES\.CASHIER/);
  assert.match(source, /Personal account details are managed by an administrator\./);
  assert.match(source, /<dl className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">/);
  assert.match(source, /Automatically print the Order Confirmation after a successful transaction\./);
  assert.match(source, /aria-label=\{`\$\{autoPrint \? 'Disable' : 'Enable'\} automatic printing`\}/);
  assert.match(source, /\{\(!isCashierProfile \|\| activeSection === 'security'\) && \(/);
});
