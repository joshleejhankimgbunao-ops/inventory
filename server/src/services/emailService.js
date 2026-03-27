const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT || 587);
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  return cachedTransporter;
};

const getMailFrom = () => {
  return process.env.MAIL_FROM || process.env.MAIL_USER || 'no-reply@example.com';
};

const buildResetSubject = (purpose) => {
  if (purpose === 'pin') {
    return 'Reset your PIN';
  }

  return 'Reset your password';
};

const buildResetBody = ({ purpose, resetUrl, expiresMinutes, recipientName }) => {
  const credentialName = purpose === 'pin' ? 'PIN' : 'password';
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi,';

  return [
    greeting,
    '',
    `We received a request to reset your ${credentialName}.`,
    `Open this link to continue: ${resetUrl}`,
    '',
    `This link will expire in ${expiresMinutes} minutes and can only be used once.`,
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');
};

const sendResetEmail = async ({ to, purpose, resetUrl, expiresMinutes, recipientName }) => {
  const transporter = getTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Mail service is not configured in production.');
    }

    console.warn('[MAIL DEV MODE] SMTP is not configured. Reset link:', resetUrl);
    return { simulated: true };
  }

  await transporter.sendMail({
    from: getMailFrom(),
    to,
    subject: buildResetSubject(purpose),
    text: buildResetBody({
      purpose,
      resetUrl,
      expiresMinutes,
      recipientName,
    }),
  });

  return { simulated: false };
};

module.exports = {
  sendResetEmail,
};
