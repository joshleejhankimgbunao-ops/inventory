const test = require('node:test');
const assert = require('node:assert/strict');
const { sendResetEmail } = require('../src/services/emailService');

test('development reset fallback never logs the reset URL or token', async () => {
  const previous = {
    host: process.env.MAIL_HOST,
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
    nodeEnv: process.env.NODE_ENV,
  };
  const originalWarn = console.warn;
  const warnings = [];
  const resetUrl = 'http://localhost/reset-password?token=sensitive-reset-token-sentinel';

  try {
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_USER;
    delete process.env.MAIL_PASS;
    process.env.NODE_ENV = 'test';
    console.warn = (...args) => warnings.push(args.join(' '));

    const result = await sendResetEmail({
      to: 'recipient@example.com',
      purpose: 'password',
      resetUrl,
      expiresMinutes: 30,
      recipientName: 'Recipient',
    });

    assert.equal(result.simulated, true);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].includes(resetUrl), false);
    assert.equal(warnings[0].includes('sensitive-reset-token-sentinel'), false);
  } finally {
    console.warn = originalWarn;
    for (const [key, value] of Object.entries({
      MAIL_HOST: previous.host,
      MAIL_USER: previous.user,
      MAIL_PASS: previous.pass,
      NODE_ENV: previous.nodeEnv,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
