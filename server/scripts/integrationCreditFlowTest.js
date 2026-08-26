require('dotenv').config({ quiet: true });
const { requireFirstExplicitEnv, requireFirstExplicitPinEnv } = require('../src/config/security');


const baseUrl = process.env.TEST_BASE_URL || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000';
const credentialCandidate = {
  username: requireFirstExplicitEnv(['TEST_USERNAME', 'SMOKE_USERNAME']),
  password: requireFirstExplicitEnv(['TEST_PASSWORD', 'SMOKE_PASSWORD']),
  pin: requireFirstExplicitPinEnv(['TEST_PIN', 'SMOKE_PIN']),
  source: 'explicit TEST_* or SMOKE_* environment',
};

const allowMutation = String(process.env.TEST_CREDIT_ALLOW_MUTATION || '').toLowerCase() === 'true';

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

const assert = (condition, message, details) => {
  if (!condition) {
    fail(message, details);
  }
};

const buildCredentialCandidates = () => [credentialCandidate];

const attemptLogin = async (candidate) => {
  const firstLogin = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: candidate.username, password: candidate.password }),
  });

  if (!firstLogin.ok) {
    return {
      ok: false,
      candidate,
      reason: firstLogin.payload,
    };
  }

  if (firstLogin.payload?.requiresPin) {
    const pinLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: candidate.username, password: candidate.password, pin: candidate.pin }),
    });

    if (!pinLogin.ok || !pinLogin.payload?.token) {
      return {
        ok: false,
        candidate,
        reason: pinLogin.payload,
      };
    }

    return {
      ok: true,
      candidate,
      token: pinLogin.payload.token,
      usedPin: true,
    };
  }

  if (!firstLogin.payload?.token) {
    return {
      ok: false,
      candidate,
      reason: firstLogin.payload,
    };
  }

  return {
    ok: true,
    candidate,
    token: firstLogin.payload.token,
    usedPin: false,
  };
};

const run = async () => {
  console.log('Running integration credit flow test');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mutation mode: ${allowMutation ? 'ON' : 'OFF (read-only)'}`);

  const health = await requestJson('/api/health');
  assert(health.ok && health.payload?.status === 'ok', 'Health endpoint failed.', health.payload);
  console.log('PASS: Health endpoint');

  const credentialCandidates = buildCredentialCandidates();
  let auth = null;
  const failedAttempts = [];

  for (const candidate of credentialCandidates) {
    const result = await attemptLogin(candidate);
    if (result.ok) {
      auth = result;
      break;
    }
    failedAttempts.push({
      username: candidate.username,
      source: candidate.source,
      reason: result.reason,
    });
  }

  assert(Boolean(auth?.token), 'Login endpoint failed for all credential candidates.', {
    tried: failedAttempts,
    hint: 'Set TEST_USERNAME, TEST_PASSWORD, and TEST_PIN for explicit test credentials.',
  });

  const token = auth.token;
  if (auth.usedPin) {
    console.log(`PASS: Login with PIN (${auth.candidate.username} via ${auth.candidate.source})`);
  } else {
    console.log(`PASS: Login without PIN (${auth.candidate.username} via ${auth.candidate.source})`);
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  const summary = await requestJson('/api/credit-transactions/summary', {
    method: 'GET',
    headers: authHeaders,
  });

  assert(summary.ok, 'Credit summary endpoint failed.', summary.payload);
  const summaryPayload = summary.payload || {};
  assert(
    Object.prototype.hasOwnProperty.call(summaryPayload, 'totalCreditReceivables')
      && Object.prototype.hasOwnProperty.call(summaryPayload, 'unpaidAccounts')
      && Object.prototype.hasOwnProperty.call(summaryPayload, 'partiallyPaidAccounts')
      && Object.prototype.hasOwnProperty.call(summaryPayload, 'paidAccounts')
      && Object.prototype.hasOwnProperty.call(summaryPayload, 'overdueAccounts'),
    'Credit summary contract mismatch.',
    summaryPayload
  );
  console.log('PASS: Credit summary endpoint');

  const list = await requestJson('/api/credit-transactions?status=All&includeArchived=false', {
    method: 'GET',
    headers: authHeaders,
  });

  assert(list.ok && Array.isArray(list.payload), 'Credit transactions list endpoint failed.', list.payload);
  console.log(`PASS: Credit transactions list endpoint (${list.payload.length} records)`);

  if (list.payload.length > 0) {
    const sample = list.payload[0];
    const hasContract =
      sample
      && typeof sample.creditTransactionId === 'string'
      && Object.prototype.hasOwnProperty.call(sample, 'customerName')
      && Object.prototype.hasOwnProperty.call(sample, 'totalAmount')
      && Object.prototype.hasOwnProperty.call(sample, 'remainingBalance')
      && Object.prototype.hasOwnProperty.call(sample, 'status')
      && Array.isArray(sample.paymentHistory);

    assert(hasContract, 'Credit transaction list contract mismatch.', sample);
    console.log('PASS: Credit transaction contract validation');

    const detail = await requestJson(`/api/credit-transactions/${sample._id}`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert(detail.ok && detail.payload?._id, 'Credit transaction details endpoint failed.', detail.payload);
    console.log('PASS: Credit transaction details endpoint');
  }

  const history = await requestJson('/api/sales/history-view?includeArchived=true', {
    method: 'GET',
    headers: authHeaders,
  });

  assert(history.ok && Array.isArray(history.payload), 'Sales history endpoint failed.', history.payload);
  const creditSales = history.payload.filter((row) => String(row?.paymentMethod || '').toLowerCase() === 'credit');
  console.log(`PASS: Sales history endpoint (${creditSales.length} credit-tagged rows)`);

  if (!allowMutation) {
    console.log('PASS: Read-only credit flow checks completed.');
    return;
  }

  const target = list.payload.find((row) => Number(row?.remainingBalance || 0) > 0);
  if (!target) {
    console.log('SKIP: Mutation mode enabled but no unpaid/partial credit transaction found.');
    console.log('PASS: Credit flow checks completed (mutation skipped).');
    return;
  }

  const beforeAmountPaid = Number(target.amountPaid || 0);
  const beforeRemaining = Number(target.remainingBalance || 0);
  const paymentAmount = Math.min(1, beforeRemaining);

  const payment = await requestJson(`/api/credit-transactions/${target._id}/payments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      amount: paymentAmount,
      method: 'cash',
      note: 'integrationCreditFlowTest mutation check',
    }),
  });

  assert(payment.ok, 'Record payment endpoint failed.', payment.payload);

  const afterDetail = await requestJson(`/api/credit-transactions/${target._id}`, {
    method: 'GET',
    headers: authHeaders,
  });

  assert(afterDetail.ok, 'Unable to fetch transaction after payment.', afterDetail.payload);

  const afterAmountPaid = Number(afterDetail.payload?.amountPaid || 0);
  const afterRemaining = Number(afterDetail.payload?.remainingBalance || 0);

  assert(afterAmountPaid >= beforeAmountPaid, 'Payment did not increase amountPaid as expected.', {
    beforeAmountPaid,
    afterAmountPaid,
    transactionId: target.creditTransactionId,
  });
  assert(afterRemaining <= beforeRemaining, 'Payment did not reduce remainingBalance as expected.', {
    beforeRemaining,
    afterRemaining,
    transactionId: target.creditTransactionId,
  });

  console.log('PASS: Mutation payment check');
  console.log('PASS: Integration credit flow test completed');
};

run().catch((error) => {
  fail('Unexpected integration credit flow test failure.', error?.stack || error?.message || error);
});
