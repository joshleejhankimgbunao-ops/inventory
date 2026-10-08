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
const { updateMyPreferences } = require('../src/controllers/authController');
const loadThemePreference = () => import('../../src/utils/themePreference.js');

const createStorage = () => {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  };
};

const createRoot = () => {
  const classes = new Set();
  return {
    classList: {
      toggle: (name, enabled) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
  };
};

test('theme defaults to light when no persisted preference exists', async () => {
  const { readStoredThemePreference } = await loadThemePreference();
  assert.equal(readStoredThemePreference(createStorage()), false);
});

test('theme persistence restores both dark and light selections', async () => {
  const { persistThemePreference, readStoredThemePreference } = await loadThemePreference();
  const storage = createStorage();

  persistThemePreference(true, storage);
  assert.equal(readStoredThemePreference(storage), true);

  persistThemePreference(false, storage);
  assert.equal(readStoredThemePreference(storage), false);
});

test('root dark class remains synchronized with the selected preference', async () => {
  const { applyThemePreference } = await loadThemePreference();
  const root = createRoot();

  applyThemePreference(true, root);
  assert.equal(root.classList.contains('dark'), true);

  applyThemePreference(false, root);
  assert.equal(root.classList.contains('dark'), false);
});

test('authenticated preference updates persist Dark Mode for the current user', async () => {
  const originalFindById = User.findById;
  const currentUser = new User({
    name: 'Theme User',
    username: 'theme-user',
    password: 'Password123',
    preferences: { darkMode: false },
  });
  currentUser.isActive = true;
  currentUser.save = async () => currentUser;
  User.findById = async () => currentUser;

  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
    },
  };

  try {
    await updateMyPreferences(
      { user: { _id: 'authenticated-theme-user' }, body: { darkMode: true } },
      response,
      (error) => { throw error; },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(currentUser.preferences.darkMode, true);
    assert.equal(response.body.user.preferences.darkMode, true);
  } finally {
    User.findById = originalFindById;
  }
});
