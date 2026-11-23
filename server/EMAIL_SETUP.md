# TLC Workspace email setup

The backend sends Forgot Password, Forgot PIN, and New Account Credentials messages through the shared Nodemailer SMTP service. All three use the same sender identity and the TLC Workspace email layout.

## Backend environment

Set these values in the backend's private environment (for example, `server/.env` locally or the backend deployment's secret configuration). Do not put SMTP credentials in frontend variables or source control.

| Variable | Purpose |
| --- | --- |
| `MAIL_HOST` | SMTP host supplied by the TLC business email provider |
| `MAIL_PORT` | SMTP port; commonly `587` for STARTTLS or `465` for implicit TLS, as specified by the provider |
| `MAIL_SECURE` | Optional `true`/`false`; when blank, port 465 enables TLS mode |
| `MAIL_USER` | SMTP username or mailbox identity supplied by the provider |
| `MAIL_PASS` | SMTP password or provider-issued SMTP/app credential |
| `MAIL_FROM_NAME` | Sender display name; defaults to `TLC Workspace` |
| `MAIL_FROM` | Official TLC business sender email address, once provisioned and authorized by the provider |
| `MAIL_REPLY_TO` | Optional monitored business reply address |
| `MAIL_LOGO_URL` | Optional absolute, publicly accessible HTTPS logo URL; when blank or invalid, the actual logo is embedded in each message as an inline CID image |
| `CLIENT_ORIGIN` | Deployed public HTTPS application origin used for account access links/buttons |
| `RESET_URL_BASE` | Base URL for password and PIN reset links; preserve the deployed application URL |

`MAIL_FROM` falls back to `MAIL_USER` for compatibility with the existing SMTP setup. The sender is not switched to an official business address until the mailbox address and provider credentials are supplied and successfully tested. The example environment file intentionally contains no invented business domain or working credentials.

The exact existing logo asset at `public/tlc-logo.png` is embedded as an inline Nodemailer attachment referenced by its Content-ID when `MAIL_LOGO_URL` is blank or invalid. This avoids relying on a web-hosted image for normal delivery. If `MAIL_LOGO_URL` is set, it must be an absolute, externally accessible HTTPS URL. No production hostname is hardcoded. Production password/PIN reset messages are not sent with an HTTP, localhost, or private-network reset URL.

Use the provider's documented SMTP endpoint, TLS mode, and credential type. If the provider requires an OAuth-only or API-based transport instead of SMTP username plus password/app credential, add and verify that provider-specific transport before enabling the mailbox; do not put an OAuth client secret or refresh token in `MAIL_PASS` unless the provider explicitly documents it as an SMTP credential.

After setting the backend values, restart the backend and send a test message to a mailbox you control:

```powershell
cd server
npm.cmd run mail:test -- recipient@example.com
```

The test command requires an explicit recipient, verifies the SMTP connection, and sends a generic test message using the same configured sender identity. Its console output does not print credentials or email content. Test delivery and verify the From/Reply-To headers and rendering in both Gmail and Outlook before using the business sender for users.

## Credential email note

The current account-creation flow sends the generated initial password and PIN, when present, in the New Account Credentials email. The flow marks the account as requiring first-login credential replacement, and the existing first-login security setup enforces that replacement. This redesign preserves that behavior and does not log credential values. Email remains a sensitive delivery channel; a future security improvement would replace emailed secrets with a short-lived account activation/password-setup flow and deliver only a one-time setup link.
