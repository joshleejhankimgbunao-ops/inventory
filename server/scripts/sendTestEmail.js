/* global process, require, __dirname */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { sendConfiguredTestEmail } = require('../src/services/emailService');

const recipient = String(process.argv[2] || '').trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error('Usage: npm run mail:test -- recipient@example.com');
  process.exitCode = 1;
} else {
  sendConfiguredTestEmail(recipient)
    .then(() => {
      console.info('TLC Workspace test email sent successfully.');
    })
    .catch(() => {
      console.error('TLC Workspace test email failed. Check the backend SMTP configuration and provider logs.');
      process.exitCode = 1;
    });
}
