/* global require, process, module, __dirname */
const path = require('node:path');
const { isIP } = require('node:net');
const nodemailer = require('nodemailer');

const BRAND = {
  name: 'TLC Workspace',
  navy: '#111827',
  white: '#FFFFFF',
  canvas: '#F1F5F9',
  border: '#E2E8F0',
  text: '#1F2937',
  muted: '#64748B',
};
const INLINE_LOGO_CID = 'tlc-workspace-logo';
const INLINE_LOGO_PATH = path.resolve(__dirname, '../../../public/tlc-logo.png');

let cachedTransporter = null;
let cachedTransporterConfig = '';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const cleanHeaderValue = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();

const isPrivateIpAddress = (hostname) => {
  const address = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(address);

  if (version === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }

  if (version === 6) {
    return address === '::'
      || address === '::1'
      || address.startsWith('fc')
      || address.startsWith('fd')
      || address.startsWith('fe8')
      || address.startsWith('fe9')
      || address.startsWith('fea')
      || address.startsWith('feb');
  }

  return false;
};

const getPublicHttpsUrl = (value) => {
  const rawUrl = String(value || '').trim();
  if (!rawUrl) return '';

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIpAddress(hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
};

const getPublicApplicationUrl = () => {
  const appUrl = getPublicHttpsUrl(process.env.CLIENT_ORIGIN);
  return appUrl ? appUrl.replace(/\/$/, '') : '';
};

const getEmailLogoUrl = () => {
  return getPublicHttpsUrl(process.env.MAIL_LOGO_URL) || `cid:${INLINE_LOGO_CID}`;
};

const getEmailLogoAttachments = () => {
  if (getPublicHttpsUrl(process.env.MAIL_LOGO_URL)) return [];

  return [{
    filename: 'tlc-logo.png',
    path: INLINE_LOGO_PATH,
    cid: INLINE_LOGO_CID,
    contentType: 'image/png',
    contentDisposition: 'inline',
  }];
};

const getTransporter = () => {
  const host = cleanHeaderValue(process.env.MAIL_HOST);
  const port = Number(process.env.MAIL_PORT || 587);
  const user = cleanHeaderValue(process.env.MAIL_USER);
  const pass = process.env.MAIL_PASS;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass) {
    return null;
  }

  const configuredSecure = String(process.env.MAIL_SECURE || '').trim().toLowerCase();
  const secure = configuredSecure
    ? ['true', '1', 'yes'].includes(configuredSecure)
    : port === 465;
  const configFingerprint = JSON.stringify({ host, port, user, pass, secure });

  if (cachedTransporter && cachedTransporterConfig === configFingerprint) {
    return cachedTransporter;
  }

  cachedTransporterConfig = configFingerprint;
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransporter;
};

const getMailFrom = () => ({
  name: cleanHeaderValue(process.env.MAIL_FROM_NAME) || BRAND.name,
  // Keep the existing SMTP-account fallback for compatibility. Configure
  // MAIL_FROM explicitly when the official business mailbox is provisioned.
  address: cleanHeaderValue(process.env.MAIL_FROM || process.env.MAIL_USER),
});

const getMailReplyTo = () => cleanHeaderValue(process.env.MAIL_REPLY_TO);

const getSharedMailOptions = () => {
  const replyTo = getMailReplyTo();
  return {
    from: getMailFrom(),
    ...(replyTo ? { replyTo } : {}),
  };
};

const getGreeting = (recipientName) => {
  const name = String(recipientName || '').trim();
  return name ? `Hello ${name},` : 'Hello,';
};

const buildEmailShell = ({ title, greeting, introduction, contentHtml, noticeHtml = '' }) => {
  const logoUrl = getEmailLogoUrl();
  const brandMark = `<img src="${escapeHtml(logoUrl)}" width="42" height="42" alt="Tableria La Confianza logo" style="display:block;width:42px;height:42px;object-fit:contain;border:0;outline:none;text-decoration:none;">`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(title)}</title>
  <style>
    @media screen and (max-width: 620px) {
      .tlc-email-shell { width: 100% !important; }
      .tlc-email-padding { padding-left: 20px !important; padding-right: 20px !important; }
      .tlc-email-outer-padding { padding: 16px 8px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(introduction)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background-color:${BRAND.canvas};">
    <tr>
      <td class="tlc-email-outer-padding" align="center" style="padding:32px 14px;">
        <!--[if mso]><table role="presentation" align="center" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table class="tlc-email-shell" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background-color:${BRAND.white};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td class="tlc-email-padding" style="padding:18px 30px;background-color:${BRAND.white};border-bottom:1px solid ${BRAND.border};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td width="54" valign="middle" style="width:54px;padding-right:12px;">${brandMark}</td>
                  <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;color:${BRAND.navy};font-size:16px;font-weight:700;line-height:22px;">${BRAND.name}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="tlc-email-padding" style="padding:30px 34px 24px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">
              <p style="margin:0 0 16px;color:${BRAND.muted};font-size:14px;line-height:21px;">${escapeHtml(greeting)}</p>
              <h1 style="margin:0 0 12px;color:${BRAND.navy};font-family:Arial,Helvetica,sans-serif;font-size:23px;font-weight:700;line-height:30px;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 22px;color:${BRAND.text};font-size:14px;line-height:22px;">${escapeHtml(introduction)}</p>
              ${contentHtml}
              ${noticeHtml}
            </td>
          </tr>
          <tr>
            <td class="tlc-email-padding" style="padding:16px 34px;background-color:#F8FAFC;border-top:1px solid ${BRAND.border};font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;color:${BRAND.muted};font-size:11px;line-height:17px;">Tableria La Confianza Co., Inc.</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildActionContent = ({ label, url, fallbackLabel }) => `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-collapse:collapse;">
    <tr>
      <td align="center" bgcolor="${BRAND.navy}" style="border-radius:7px;background-color:${BRAND.navy};">
        <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:12px 20px;border-radius:7px;color:${BRAND.white};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:18px;text-align:center;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 6px;color:${BRAND.muted};font-size:12px;line-height:18px;">${escapeHtml(fallbackLabel)}</p>
  <p style="margin:0 0 20px;overflow-wrap:anywhere;word-break:break-word;color:${BRAND.navy};font-size:12px;line-height:19px;"><a href="${escapeHtml(url)}" target="_blank" style="color:${BRAND.navy};text-decoration:underline;">${escapeHtml(url)}</a></p>`;

const buildResetSubject = (purpose) => (purpose === 'pin' ? 'Reset your PIN' : 'Reset your password');

const buildResetBody = ({ purpose, resetUrl, expiresMinutes, recipientName }) => {
  const credentialName = purpose === 'pin' ? 'PIN' : 'password';
  return [
    getGreeting(recipientName),
    '',
    purpose === 'pin'
      ? 'A PIN reset was requested for your account.'
      : 'A password reset was requested for your account.',
    `Use this one-time link to continue: ${resetUrl}`,
    '',
    `This link expires in ${expiresMinutes} minutes and can only be used once.`,
    `If you did not request a ${credentialName} reset, you can ignore this email. Your account will not change unless the link is used.`,
    '',
    'Tableria La Confianza Co., Inc.',
  ].join('\n');
};

const buildResetHtml = ({ purpose, resetUrl, expiresMinutes, recipientName }) => {
  const isPin = purpose === 'pin';
  const credentialName = isPin ? 'PIN' : 'password';
  const title = isPin ? 'Reset your PIN' : 'Reset your password';
  const introduction = isPin
    ? 'A PIN reset was requested for your account. Use the button below to choose a new PIN.'
    : 'A password reset was requested for your account. Use the button below to choose a new password.';
  const actionContent = buildActionContent({
    label: isPin ? 'Reset PIN' : 'Reset Password',
    url: resetUrl,
    fallbackLabel: "If the button doesn't open, copy and paste this link:",
  });
  const noticeHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${BRAND.border};"><tr><td style="padding-top:14px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">This link expires in <strong style="color:${BRAND.text};">${escapeHtml(expiresMinutes)} minutes</strong> and can only be used once. If you did not request a ${credentialName} reset, you can ignore this email.</td></tr></table>`;

  return buildEmailShell({
    title,
    greeting: getGreeting(recipientName),
    introduction,
    contentHtml: actionContent,
    noticeHtml,
  });
};

const buildCredentialsSubject = () => 'Your TLC Workspace account is ready';

const buildCredentialsBody = ({ recipientName, username, password, pin, createdByName, applicationUrl }) => {
  const lines = [
    getGreeting(recipientName),
    '',
    'Sign in using the temporary credentials below:',
    `Username: ${username}`,
    `Temporary password: ${password}`,
  ];
  if (pin) lines.push(`Temporary PIN: ${pin}`);
  if (createdByName) lines.push('', `Created by: ${createdByName}`);
  if (applicationUrl) lines.push('', `Open Workspace: ${applicationUrl}`);
  lines.push('', 'Keep these credentials private. Replace your temporary password and PIN during first-login security setup.', '', 'Tableria La Confianza Co., Inc.');
  return lines.join('\n');
};

const buildCredentialRows = ({ username, password, pin }) => {
  const rows = [
    ['Username', username],
    ['Temporary password', password],
  ];
  if (pin) rows.push(['Temporary PIN', pin]);

  return rows.map(([label, value], index) => `
    <tr>
      <td style="${index ? `padding-top:12px;border-top:1px solid ${BRAND.border};` : ''}padding-right:16px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;vertical-align:top;">${escapeHtml(label)}</td>
      <td align="right" style="${index ? `padding-top:12px;border-top:1px solid ${BRAND.border};` : ''}color:${BRAND.navy};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:19px;overflow-wrap:anywhere;word-break:break-word;text-align:right;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join('');
};

const buildCredentialsHtml = ({ recipientName, username, password, pin, createdByName }) => {
  const applicationUrl = getPublicApplicationUrl();
  const creatorName = String(createdByName || '').trim();
  const contentHtml = `
    ${creatorName ? `<p style="margin:0 0 16px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;">Created by ${escapeHtml(creatorName)}.</p>` : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 20px;border:1px solid ${BRAND.border};border-radius:8px;border-collapse:separate;border-spacing:0;background-color:#F8FAFC;">
      <tr><td style="padding:16px 16px 15px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${buildCredentialRows({ username, password, pin })}</table>
      </td></tr>
    </table>
    ${applicationUrl ? buildActionContent({ label: 'Open Workspace', url: applicationUrl, fallbackLabel: "If the button doesn't open, use this address:" }) : ''}`;

  return buildEmailShell({
    title: 'Your account is ready',
    greeting: getGreeting(recipientName),
    introduction: 'Sign in using the temporary credentials below.',
    contentHtml,
    noticeHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid ${BRAND.border};"><tr><td style="padding-top:14px;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">Keep these credentials private. Replace your temporary password and PIN during first-login security setup.</td></tr></table>`,
  });
};

const buildAccountCredentialsBody = ({ recipientName, username, password, pin, createdByName }) => (
  buildCredentialsBody({ recipientName, username, password, pin, createdByName, applicationUrl: getPublicApplicationUrl() })
);

const buildAccountCredentialsHtml = (values) => buildCredentialsHtml(values);

const sendMail = async (message) => {
  const transporter = getTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Mail service is not configured in production.');
    }

    console.warn('[MAIL DEV MODE] SMTP is not configured. Email was not sent.');
    return { simulated: true };
  }

  const attachments = [
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    ...getEmailLogoAttachments(),
  ];

  await transporter.sendMail({
    ...getSharedMailOptions(),
    ...message,
    ...(attachments.length ? { attachments } : {}),
  });
  return { simulated: false };
};

const sendResetEmail = async ({ to, purpose, resetUrl, expiresMinutes, recipientName }) => {
  if (process.env.NODE_ENV === 'production' && !getPublicHttpsUrl(resetUrl)) {
    throw new Error('A public HTTPS reset URL is required for production email.');
  }

  return sendMail({
    to,
    subject: buildResetSubject(purpose),
    text: buildResetBody({ purpose, resetUrl, expiresMinutes, recipientName }),
    html: buildResetHtml({ purpose, resetUrl, expiresMinutes, recipientName }),
  });
};

const sendAccountCredentialsEmail = async ({
  to,
  recipientName,
  username,
  password,
  pin,
  createdByName,
}) => {
  const values = { recipientName, username, password, pin, createdByName };
  return sendMail({
    to,
    subject: buildCredentialsSubject(),
    text: buildAccountCredentialsBody(values),
    html: buildAccountCredentialsHtml(values),
  });
};

const sendConfiguredTestEmail = async (to) => {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('SMTP is not configured. Set the backend MAIL_* environment variables first.');
  }

  await transporter.verify();
  const content = 'This is a TLC Workspace email delivery test. It was sent using the configured backend mail sender.';
  const attachments = getEmailLogoAttachments();
  await transporter.sendMail({
    ...getSharedMailOptions(),
    to,
    subject: 'TLC Workspace email delivery test',
    text: `${content}\n\nTLC Workspace`,
    html: buildEmailShell({
      title: 'Email delivery test',
      greeting: 'Hello,',
      introduction: content,
      contentHtml: '',
    }),
    ...(attachments.length ? { attachments } : {}),
  });
  return { simulated: false };
};

module.exports = {
  sendResetEmail,
  sendAccountCredentialsEmail,
  sendConfiguredTestEmail,
  __test: {
    buildResetBody,
    buildResetHtml,
    buildAccountCredentialsBody,
    buildAccountCredentialsHtml,
    getEmailLogoUrl,
    getEmailLogoAttachments,
    getMailFrom,
    getSharedMailOptions,
    getPublicApplicationUrl,
    getPublicHttpsUrl,
  },
};
