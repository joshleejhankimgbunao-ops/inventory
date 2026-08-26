require('dotenv').config({ quiet: true });
const { requireExplicitEnv, requireExplicitPinEnv } = require('../src/config/security');


const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000';
const username = requireExplicitEnv('SMOKE_USERNAME');
const password = requireExplicitEnv('SMOKE_PASSWORD');
const pin = requireExplicitPinEnv('SMOKE_PIN');

const fail = (message, details) => {
  console.error(`FAILED: ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
};

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const buildCredentialHint = () => ({
  username,
  hasPassword: Boolean(password),
  hasPin: Boolean(pin),
  help: 'If credentials are invalid, run: node scripts/createOwner.js and node scripts/setOwnerPin.js',
});

const toJsonSafe = async (response) => {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
};

const requestJson = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: {
        message: 'Network request failed. Ensure backend server is running and SMOKE_BASE_URL is correct.',
        error: error?.message || String(error),
      },
    };
  }

  const payload = await toJsonSafe(response);
  return { ok: response.ok, status: response.status, payload };
};

const requestJsonWithRetry = async (path, options = {}, retryConfig = {}) => {
  const {
    retries = 5,
    delayMs = 800,
    retryOnStatuses = [],
  } = retryConfig;

  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await requestJson(path, options);
    lastResult = result;

    const shouldRetry = result.status === 0 || retryOnStatuses.includes(result.status);
    if (!shouldRetry || attempt === retries) {
      return result;
    }

    await wait(delayMs);
  }

  return lastResult;
};

const run = async () => {
  console.log('--- Backend Smoke Test (Phase 8) ---');
  console.log(`Base URL: ${baseUrl}`);

  const health = await requestJsonWithRetry('/api/health', {}, {
    retries: 8,
    delayMs: 1000,
    retryOnStatuses: [502, 503, 504],
  });
  if (!health.ok || health.payload?.status !== 'ok') {
    fail('Health check failed.', health.payload);
  }
  console.log('PASS: Health check passed.');

  const firstLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (!firstLogin.ok) {
    fail('Login with username/password failed.', {
      ...buildCredentialHint(),
      response: firstLogin.payload,
    });
  }

  let token = firstLogin.payload?.token;
  if (firstLogin.payload?.requiresPin) {
    const secondLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, pin }),
    });

    if (!secondLogin.ok || !secondLogin.payload?.token) {
      fail('PIN verification login failed.', {
        ...buildCredentialHint(),
        response: secondLogin.payload,
      });
    }

    token = secondLogin.payload.token;
    console.log('PASS: Login with PIN challenge passed.');
  } else if (token) {
    console.log('PASS: Login without PIN challenge passed.');
  } else {
    fail('Login response missing token and requiresPin.', firstLogin.payload);
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  const me = await requestJson('/api/auth/me', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!me.ok || !me.payload?.user) {
    fail('/api/auth/me failed.', me.payload);
  }

  const meUser = me.payload.user;
  const hasProfileShape =
    meUser
    && Object.prototype.hasOwnProperty.call(meUser, 'phone')
    && Object.prototype.hasOwnProperty.call(meUser, 'avatarUrl')
    && meUser.preferences
    && Object.prototype.hasOwnProperty.call(meUser.preferences, 'darkMode')
    && Object.prototype.hasOwnProperty.call(meUser.preferences, 'desktopNotifications');

  if (!hasProfileShape) {
    fail('/api/auth/me profile enrichment contract failed.', me.payload);
  }
  console.log('PASS: Authenticated /me check passed.');

  const users = await requestJson('/api/auth/users', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!users.ok || !Array.isArray(users.payload)) {
    fail('/api/auth/users check failed.', users.payload);
  }

  if (users.payload.length > 0) {
    const sampleUser = users.payload[0];
    const hasContract =
      sampleUser
      && typeof sampleUser.username === 'string'
      && Object.prototype.hasOwnProperty.call(sampleUser, 'role')
      && Object.prototype.hasOwnProperty.call(sampleUser, 'isActive')
      && Object.prototype.hasOwnProperty.call(sampleUser, 'preferences');

    if (!hasContract) {
      fail('/api/auth/users contract validation failed.', sampleUser);
    }
  }
  console.log(`PASS: Users list check passed (${users.payload.length} records).`);

  const preferencePatchPayload = {
    darkMode: Boolean(meUser.preferences?.darkMode),
    desktopNotifications: meUser.preferences?.desktopNotifications !== false,
  };

  const preferenceUpdate = await requestJson('/api/auth/me/preferences', {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify(preferencePatchPayload),
  });

  if (!preferenceUpdate.ok || !preferenceUpdate.payload?.user?.preferences) {
    fail('/api/auth/me/preferences PATCH failed.', preferenceUpdate.payload);
  }
  console.log('PASS: Preferences PATCH check passed.');

  const publicSettings = await requestJson('/api/settings', {
    method: 'GET',
  });

  if (!publicSettings.ok || !publicSettings.payload?.storeName) {
    fail('/api/settings (public GET) failed.', publicSettings.payload);
  }
  const allowedPublicSettingKeys = new Set([
    'storeName',
    'storeAddress',
    'contactPhone',
    'contactPhoneSecondary',
    'storeMapLink',
  ]);
  const unexpectedPublicSettingKeys = Object.keys(publicSettings.payload || {})
    .filter((key) => !allowedPublicSettingKeys.has(key));
  if (unexpectedPublicSettingKeys.length > 0) {
    fail('/api/settings exposed fields outside the public allowlist.', {
      unexpectedFieldCount: unexpectedPublicSettingKeys.length,
    });
  }
  console.log('PASS: Public settings GET check passed.');

  const authenticatedSettings = await requestJson('/api/settings', {
    method: 'GET',
    headers: authHeaders,
  });
  if (!authenticatedSettings.ok || typeof authenticatedSettings.payload?.autoSync !== 'boolean') {
    fail('/api/settings (authenticated GET) failed.', authenticatedSettings.payload);
  }
  console.log('PASS: Authenticated settings GET check passed.');

  const patchPayload = {
    autoSync: authenticatedSettings.payload.autoSync,
  };

  const patchedSettings = await requestJson('/api/settings', {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify(patchPayload),
  });

  if (!patchedSettings.ok || !patchedSettings.payload?.settings) {
    fail('/api/settings (authenticated PATCH) failed.', patchedSettings.payload);
  }
  console.log('PASS: Authenticated settings PATCH check passed.');

  const products = await requestJson('/api/products', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!products.ok || !Array.isArray(products.payload)) {
    fail('/api/products check failed.', products.payload);
  }

  if (products.payload.length > 0) {
    const sampleProduct = products.payload[0];
    const hasEnrichedFields =
      Object.prototype.hasOwnProperty.call(sampleProduct, 'brand')
      && Object.prototype.hasOwnProperty.call(sampleProduct, 'color')
      && Object.prototype.hasOwnProperty.call(sampleProduct, 'size')
      && Object.prototype.hasOwnProperty.call(sampleProduct, 'supplierName');

    if (!hasEnrichedFields) {
      fail('/api/products phase 6 contract check failed.', sampleProduct);
    }
  }
  console.log(`PASS: Products check passed (${products.payload.length} records).`);

  const partners = await requestJson('/api/partners?type=supplier&includeArchived=true', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!partners.ok || !Array.isArray(partners.payload)) {
    fail('/api/partners check failed.', partners.payload);
  }
  console.log(`PASS: Partners check passed (${partners.payload.length} records).`);

  const activityLogs = await requestJson('/api/logs/activity?limit=20', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!activityLogs.ok || !Array.isArray(activityLogs.payload)) {
    fail('/api/logs/activity check failed.', activityLogs.payload);
  }
  console.log(`PASS: Activity logs check passed (${activityLogs.payload.length} records).`);

  const inventoryLogs = await requestJson('/api/logs/inventory?limit=20', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!inventoryLogs.ok || !Array.isArray(inventoryLogs.payload)) {
    fail('/api/logs/inventory check failed.', inventoryLogs.payload);
  }
  console.log(`PASS: Inventory logs check passed (${inventoryLogs.payload.length} records).`);

  const sales = await requestJson('/api/sales', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!sales.ok || !Array.isArray(sales.payload)) {
    fail('/api/sales check failed.', sales.payload);
  }
  console.log(`PASS: Sales check passed (${sales.payload.length} records).`);

  const salesHistory = await requestJson('/api/sales/history-view?includeArchived=true', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!salesHistory.ok || !Array.isArray(salesHistory.payload)) {
    fail('/api/sales/history-view check failed.', salesHistory.payload);
  }

  if (salesHistory.payload.length > 0) {
    const sample = salesHistory.payload[0];
    const hasContract =
      sample && typeof sample.id === 'string'
      && Object.prototype.hasOwnProperty.call(sample, 'total')
      && Object.prototype.hasOwnProperty.call(sample, 'cashier')
      && Array.isArray(sample.items);

    if (!hasContract) {
      fail('/api/sales/history-view contract validation failed.', sample);
    }
  }
  console.log(`PASS: Sales history-view check passed (${salesHistory.payload.length} records).`);

  console.log('PASS: Phase 8 smoke test completed.');
};

run().catch((error) => {
  fail('Unexpected smoke test failure.', error?.stack || error?.message || error);
});
