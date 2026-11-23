/* global process, require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const {
  sendResetEmail,
  sendAccountCredentialsEmail,
  sendConfiguredTestEmail,
  __test: emailTemplates,
} = require('../src/services/emailService');

test('TLC reset, PIN reset, and account credential emails share the configured branded sender', async () => {
  const envKeys = [
    'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM',
    'MAIL_FROM_NAME', 'MAIL_REPLY_TO', 'MAIL_LOGO_URL', 'CLIENT_ORIGIN', 'RESET_URL_BASE', 'NODE_ENV',
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalCreateTransport = nodemailer.createTransport;
  const sentMessages = [];
  const transportOptions = [];
  let verifyCount = 0;
  const fakeTransport = {
    verify: async () => { verifyCount += 1; },
    sendMail: async (message) => { sentMessages.push(message); return { messageId: `test-${sentMessages.length}` }; },
  };

  try {
    assert.deepEqual(
      fs.readFileSync(path.resolve(__dirname, '../../src/assets/logo.png')),
      fs.readFileSync(path.resolve(__dirname, '../../public/tlc-logo.png')),
      'public email logo should be the unmodified TLC logo asset',
    );
    Object.assign(process.env, {
      MAIL_HOST: 'smtp.example.test',
      MAIL_PORT: '587',
      MAIL_SECURE: 'false',
      MAIL_USER: 'smtp-user@example.test',
      MAIL_PASS: 'test-only-not-a-real-secret',
      MAIL_FROM: 'accounts@tlc.example.test',
      MAIL_FROM_NAME: 'TLC Workspace',
      MAIL_REPLY_TO: 'support@tlc.example.test',
      MAIL_LOGO_URL: '',
      CLIENT_ORIGIN: 'https://workspace.example.test',
      RESET_URL_BASE: 'https://workspace.example.test',
      NODE_ENV: 'test',
    });
    nodemailer.createTransport = (options) => {
      transportOptions.push(options);
      return fakeTransport;
    };

    const passwordResult = await sendResetEmail({
      to: 'password-recipient@example.test',
      purpose: 'password',
      resetUrl: 'https://workspace.example.test/reset-password?token=password-token&source=email',
      expiresMinutes: 15,
      recipientName: 'Morgan',
    });
    const pinResult = await sendResetEmail({
      to: 'pin-recipient@example.test',
      purpose: 'pin',
      resetUrl: 'https://workspace.example.test/reset-pin?token=pin-token',
      expiresMinutes: 12,
      recipientName: 'Taylor',
    });
    const accountResult = await sendAccountCredentialsEmail({
      to: 'new-user@example.test',
      recipientName: 'Jordan',
      username: 'jordan.staff',
      password: 'Temporary#Password48',
      pin: '482961',
      createdByName: 'Alex Admin',
    });

    assert.deepEqual([passwordResult.simulated, pinResult.simulated, accountResult.simulated], [false, false, false]);
    assert.equal(sentMessages.length, 3);
    assert.equal(transportOptions.length, 1);
    assert.deepEqual(transportOptions[0], {
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: { user: 'smtp-user@example.test', pass: 'test-only-not-a-real-secret' },
    });

    for (const message of sentMessages) {
      assert.deepEqual(message.from, { name: 'TLC Workspace', address: 'accounts@tlc.example.test' });
      assert.equal(message.replyTo, 'support@tlc.example.test');
      assert.ok(message.html.includes('TLC Workspace'));
      assert.ok(message.text.includes('Tableria La Confianza Co., Inc.'));
      assert.match(message.html, /<meta name="viewport"/);
      assert.match(message.html, /role="presentation"/);
      assert.match(message.html, /src="cid:tlc-workspace-logo"/);
      assert.match(message.html, /alt="Tableria La Confianza logo"/);
      assert.doesNotMatch(message.html, /height:4px[^>]*background-color:#FC0D2C/);
      assert.doesNotMatch(message.html, /<td[^>]+background-color:#FC0D2C/);
      assert.equal(message.attachments.length, 1);
      assert.equal(message.attachments[0].cid, 'tlc-workspace-logo');
      assert.equal(message.attachments[0].contentType, 'image/png');
      assert.equal(message.attachments[0].contentDisposition, 'inline');
      assert.equal(message.attachments[0].path, path.resolve(__dirname, '../../public/tlc-logo.png'));
    }

    const [passwordMessage, pinMessage, accountMessage] = sentMessages;
    const mime = await new MailComposer(passwordMessage).compile().build();
    const mimeText = mime.toString('utf8');
    assert.match(mimeText, /Content-ID:\s*<tlc-workspace-logo>/i);
    assert.match(mimeText, /Content-Type:\s*image\/png/i);
    assert.match(mimeText, /Content-Disposition:\s*inline/i);
    assert.equal(passwordMessage.subject, 'Reset your password');
    assert.match(passwordMessage.html, /Reset your password/);
    assert.match(passwordMessage.html, /Reset Password/);
    assert.match(passwordMessage.html, /href="https:\/\/workspace\.example\.test\/reset-password\?token=password-token&amp;source=email"/);
    assert.match(passwordMessage.text, /15 minutes/);
    assert.match(passwordMessage.text, /password-token&source=email/);

    assert.equal(pinMessage.subject, 'Reset your PIN');
    assert.match(pinMessage.html, /Reset your PIN/);
    assert.match(pinMessage.html, /Reset PIN/);
    assert.match(pinMessage.html, /href="https:\/\/workspace\.example\.test\/reset-pin\?token=pin-token"/);
    assert.match(pinMessage.text, /PIN reset/);
    assert.match(pinMessage.text, /12 minutes/);

    assert.equal(accountMessage.subject, 'Your TLC Workspace account is ready');
    assert.equal(accountMessage.to, 'new-user@example.test');
    assert.match(accountMessage.html, /jordan\.staff/);
    assert.match(accountMessage.html, /Temporary password/);
    assert.match(accountMessage.html, /Temporary#Password48/);
    assert.match(accountMessage.html, /Temporary PIN/);
    assert.match(accountMessage.html, /482961/);
    assert.match(accountMessage.html, /Created by Alex Admin/);
    assert.match(accountMessage.html, /Your account is ready/);
    assert.match(accountMessage.html, /Open Workspace/);
    assert.match(accountMessage.html, /https:\/\/workspace\.example\.test/);
    assert.match(accountMessage.text, /Username: jordan\.staff/);
    assert.match(accountMessage.text, /Temporary password: Temporary#Password48/);
    assert.match(accountMessage.text, /Temporary PIN: 482961/);
    assert.match(accountMessage.text, /Replace your temporary password and PIN during first-login security setup/);

    process.env.NODE_ENV = 'production';
    await assert.rejects(
      sendResetEmail({
        to: 'recipient@example.test',
        purpose: 'password',
        resetUrl: 'http://localhost:5173/reset-password?token=local-only',
        expiresMinutes: 15,
      }),
      /public HTTPS reset URL is required/,
    );
    assert.equal(sentMessages.length, 3, 'invalid production reset URL is not sent');
    process.env.NODE_ENV = 'test';

    process.env.MAIL_LOGO_URL = 'https://assets.example.test/tlc-logo.png';
    await sendResetEmail({
      to: 'external-logo@example.test',
      purpose: 'password',
      resetUrl: 'https://workspace.example.test/reset-password?token=external-logo-test',
      expiresMinutes: 15,
    });
    assert.match(sentMessages[3].html, /src="https:\/\/assets\.example\.test\/tlc-logo\.png"/);
    assert.equal(sentMessages[3].attachments, undefined);

    process.env.MAIL_LOGO_URL = '';
    await sendConfiguredTestEmail('qa@example.test');
    assert.equal(verifyCount, 1);
    assert.equal(sentMessages.length, 5);
    assert.deepEqual(sentMessages[4].from, { name: 'TLC Workspace', address: 'accounts@tlc.example.test' });
    assert.equal(sentMessages[4].attachments[0].cid, 'tlc-workspace-logo');

    delete process.env.MAIL_LOGO_URL;
    assert.equal(emailTemplates.getEmailLogoUrl(), 'cid:tlc-workspace-logo');
    const configuredLogoHtml = emailTemplates.buildResetHtml({
      purpose: 'password',
      resetUrl: 'https://workspace.example.test/reset-password?token=fallback',
      expiresMinutes: 15,
    });
    assert.match(configuredLogoHtml, /src="cid:tlc-workspace-logo"/);
    assert.match(configuredLogoHtml, /Tableria La Confianza Co\., Inc\./);
    assert.doesNotMatch(configuredLogoHtml, /Account services|This message was sent/);
    assert.doesNotMatch(configuredLogoHtml, /height:4px[^>]*background-color:#FC0D2C/);
    assert.equal((configuredLogoHtml.match(/TLC Workspace/g) || []).length, 1);

    delete process.env.CLIENT_ORIGIN;
    const noPublicLogoHtml = emailTemplates.buildResetHtml({
      purpose: 'password',
      resetUrl: 'https://workspace.example.test/reset-password?token=fallback',
      expiresMinutes: 15,
    });
    assert.equal(emailTemplates.getEmailLogoUrl(), 'cid:tlc-workspace-logo');
    assert.match(noPublicLogoHtml, /src="cid:tlc-workspace-logo"/);
    assert.doesNotMatch(noPublicLogoHtml, /<span[^>]*>TLC<\/span>/);
    assert.equal(emailTemplates.getPublicHttpsUrl('http://localhost:5173'), '');
    assert.equal(emailTemplates.getPublicHttpsUrl('https://127.0.0.1/logo.png'), '');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
