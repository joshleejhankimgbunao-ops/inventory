require('dotenv').config({ quiet: true });

const baseUrl = process.env.TEST_BASE_URL || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000';
const username = process.env.TEST_USERNAME || process.env.SMOKE_USERNAME || 'owner';
const password = process.env.TEST_PASSWORD || process.env.SMOKE_PASSWORD || 'owner123';
const pin = process.env.TEST_PIN || process.env.SMOKE_PIN || '111111';

const fail = (message, details) => {
  console.error(`FAILED: ${message}`);
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
        message: 'Network request failed.',
        error: error?.message || String(error),
      },
    };
  }

  const payload = await toJsonSafe(response);
  return { ok: response.ok, status: response.status, payload };
};

const run = async () => {
  console.log('Running integration auth flow test');
  console.log(`Base URL: ${baseUrl}`);

  const health = await requestJson('/api/health');
  if (!health.ok || health.payload?.status !== 'ok') {
    fail('Health endpoint failed.', health.payload);
  }
  console.log('PASS: Health endpoint');

  const loginAttempt = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (!loginAttempt.ok) {
    fail('Login endpoint failed.', {
      username,
      response: loginAttempt.payload,
    });
  }

  let token = loginAttempt.payload?.token;
  if (loginAttempt.payload?.requiresPin) {
    const pinAttempt = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, pin }),
    });

    if (!pinAttempt.ok || !pinAttempt.payload?.token) {
      fail('PIN login failed.', {
        username,
        response: pinAttempt.payload,
      });
    }

    token = pinAttempt.payload.token;
    console.log('PASS: Login endpoint with PIN');
  } else if (token) {
    console.log('PASS: Login endpoint without PIN');
  } else {
    fail('Login succeeded but token is missing.', loginAttempt.payload);
  }

  const me = await requestJson('/api/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!me.ok || !me.payload?.user?.username) {
    fail('Authenticated profile endpoint failed.', me.payload);
  }

  if (String(me.payload.user.username).toLowerCase() !== String(username).toLowerCase()) {
    fail('Authenticated profile returned unexpected username.', {
      expected: username,
      actual: me.payload.user.username,
    });
  }

  console.log('PASS: Authenticated profile endpoint');
  console.log('PASS: Integration auth flow test completed');
};

run().catch((error) => {
  fail('Unexpected test failure.', error?.stack || error?.message || error);
});
