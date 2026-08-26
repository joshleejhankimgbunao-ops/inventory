const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  createStreamTicket,
  subscribeClient,
} = require('../services/realtimeService');

const getBearerToken = (req) => {
  const authorization = String(req.get('authorization') || '').trim();
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
};

const createTicket = (req, res) => {
  const primaryToken = getBearerToken(req);
  const claims = jwt.decode(primaryToken);
  const authExpiresAtMs = Number(claims?.exp || 0) * 1000;
  const authIssuedAtMs = Number(claims?.iat || 0) * 1000;

  if (!primaryToken || !authExpiresAtMs || authExpiresAtMs <= Date.now()) {
    return res.status(401).json({ message: 'Unauthorized: invalid token.' });
  }

  const ticket = createStreamTicket({
    user: req.user,
    sessionId: crypto.createHash('sha256').update(primaryToken).digest('hex').slice(0, 12),
    authIssuedAtMs,
    authExpiresAtMs,
  });

  return res.json({
    streamToken: ticket.ticket,
    expiresAt: ticket.expiresAt,
  });
};

const streamEvents = (req, res) => {
  subscribeClient(req, res, req.user, req.realtimeSession);
};

module.exports = {
  createTicket,
  streamEvents,
};
