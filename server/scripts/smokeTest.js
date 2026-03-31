require('dotenv').config({ quiet: true });

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000';
const username = process.env.SMOKE_USERNAME || 'owner';
const password = process.env.SMOKE_PASSWORD || 'owner123';
const pin = process.env.SMOKE_PIN || '111111';

const fail = (message, details) => {
  console.error(`❌ ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
};

const toJsonSafe = async (response) => {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await toJsonSafe(response);
  return { ok: response.ok, status: response.status, payload };
};

const run = async () => {
  console.log('--- Backend Smoke Test (Phase 8) ---');
  console.log(`Base URL: ${baseUrl}`);

  const health = await requestJson('/api/health');
  if (!health.ok || health.payload?.status !== 'ok') {
    fail('Health check failed.', health.payload);
  }
  console.log('✅ Health check passed.');

  const firstLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (!firstLogin.ok) {
    fail('Login with username/password failed.', firstLogin.payload);
  }

  let token = firstLogin.payload?.token;
  if (firstLogin.payload?.requiresPin) {
    const secondLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, pin }),
    });

    if (!secondLogin.ok || !secondLogin.payload?.token) {
      fail('PIN verification login failed.', secondLogin.payload);
    }

    token = secondLogin.payload.token;
    console.log('✅ Login with PIN challenge passed.');
  } else if (token) {
    console.log('✅ Login without PIN challenge passed.');
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
  console.log('✅ Authenticated /me check passed.');

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
  console.log(`✅ Users list check passed (${users.payload.length} records).`);

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
  console.log('✅ Preferences PATCH check passed.');

  const publicSettings = await requestJson('/api/settings', {
    method: 'GET',
  });

  if (!publicSettings.ok || !publicSettings.payload?.storeName) {
    fail('/api/settings (public GET) failed.', publicSettings.payload);
  }
  console.log('✅ Public settings GET check passed.');

  const patchPayload = {
    autoSync: Boolean(publicSettings.payload.autoSync),
  };

  const patchedSettings = await requestJson('/api/settings', {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify(patchPayload),
  });

  if (!patchedSettings.ok || !patchedSettings.payload?.settings) {
    fail('/api/settings (authenticated PATCH) failed.', patchedSettings.payload);
  }
  console.log('✅ Authenticated settings PATCH check passed.');

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
  console.log(`✅ Products check passed (${products.payload.length} records).`);

  const partners = await requestJson('/api/partners?type=supplier&includeArchived=true', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!partners.ok || !Array.isArray(partners.payload)) {
    fail('/api/partners check failed.', partners.payload);
  }
  console.log(`✅ Partners check passed (${partners.payload.length} records).`);

  const activityLogs = await requestJson('/api/logs/activity?limit=20', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!activityLogs.ok || !Array.isArray(activityLogs.payload)) {
    fail('/api/logs/activity check failed.', activityLogs.payload);
  }
  console.log(`✅ Activity logs check passed (${activityLogs.payload.length} records).`);

  const inventoryLogs = await requestJson('/api/logs/inventory?limit=20', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!inventoryLogs.ok || !Array.isArray(inventoryLogs.payload)) {
    fail('/api/logs/inventory check failed.', inventoryLogs.payload);
  }
  console.log(`✅ Inventory logs check passed (${inventoryLogs.payload.length} records).`);

  const sales = await requestJson('/api/sales', {
    method: 'GET',
    headers: authHeaders,
  });

  if (!sales.ok || !Array.isArray(sales.payload)) {
    fail('/api/sales check failed.', sales.payload);
  }
  console.log(`✅ Sales check passed (${sales.payload.length} records).`);

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
  console.log(`✅ Sales history-view check passed (${salesHistory.payload.length} records).`);

  console.log('🎉 Phase 8 smoke test PASSED.');
};

run().catch((error) => {
  fail('Unexpected smoke test failure.', error?.stack || error?.message || error);
});
