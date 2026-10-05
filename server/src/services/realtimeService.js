const { randomBytes, randomUUID } = require('crypto');

const KEEPALIVE_INTERVAL_MS = 25000;
const REALTIME_TICKET_TTL_MS = 60000;
const clients = new Map();
const streamTickets = new Map();

const writeEvent = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data || {})}\n\n`);
};

const removeClient = (clientId, { close = false } = {}) => {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  clients.delete(clientId);
  if (client.expiresTimer) {
    clearTimeout(client.expiresTimer);
  }

  if (close && !client.res.writableEnded) {
    client.res.end();
  }
};

const createStreamTicket = ({ user, sessionId = '', authIssuedAtMs = 0, authExpiresAtMs = 0 } = {}) => {
  const now = Date.now();
  const defaultExpiresAtMs = now + REALTIME_TICKET_TTL_MS;
  const expiresAtMs = authExpiresAtMs > now
    ? Math.min(defaultExpiresAtMs, authExpiresAtMs)
    : defaultExpiresAtMs;
  const ticket = randomBytes(32).toString('base64url');

  streamTickets.set(ticket, {
    userId: String(user?._id || ''),
    sessionId: String(sessionId || ''),
    authIssuedAtMs: Number(authIssuedAtMs || 0),
    authExpiresAtMs: Number(authExpiresAtMs || 0),
    expiresAtMs,
  });

  return {
    ticket,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
};

const consumeStreamTicket = (ticket) => {
  const normalizedTicket = String(ticket || '').trim();
  const record = streamTickets.get(normalizedTicket);
  streamTickets.delete(normalizedTicket);

  if (!record || !record.userId || record.expiresAtMs <= Date.now()) {
    return null;
  }

  return record;
};

const subscribeClient = (req, res, user, session = {}) => {
  const clientId = randomUUID();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const client = {
    id: clientId,
    res,
    userId: String(user?._id || ''),
    role: user?.role || 'unknown',
    sessionId: String(session.sessionId || ''),
    expiresTimer: null,
  };

  if (session.authExpiresAtMs > Date.now()) {
    client.expiresTimer = setTimeout(() => {
      removeClient(clientId, { close: true });
    }, session.authExpiresAtMs - Date.now());
  }

  clients.set(clientId, client);

  writeEvent(res, 'connected', { ok: true, clientId });

  req.on('close', () => {
    removeClient(clientId);
  });
};

const revokeRealtimeSession = (sessionId) => {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return;
  }

  clients.forEach((client, clientId) => {
    if (client.sessionId === normalizedSessionId) {
      removeClient(clientId, { close: true });
    }
  });
};

const publishEvent = (event, payload = {}, options = {}) => {
  const targetRoles = Array.isArray(options.roles) ? options.roles : null;
  const targetUserIds = Array.isArray(options.userIds)
    ? new Set(options.userIds.map((id) => String(id)))
    : null;

  clients.forEach((client) => {
    if (targetRoles && !targetRoles.includes(client.role)) {
      return;
    }

    if (targetUserIds && !targetUserIds.has(client.userId)) {
      return;
    }

    writeEvent(client.res, event, payload);
  });
};

const publishSaleCreated = ({ saleId, cashierId, cashierName }) => {
  publishEvent('sale.created', {
    saleId: String(saleId || ''),
    cashierId: String(cashierId || ''),
    cashierName: cashierName || '',
    occurredAt: new Date().toISOString(),
  });
};

const publishSpecialOrderUpdated = ({ orderId = '', orderNumber = '', status = '' } = {}) => {
  publishEvent('special-order.updated', {
    orderId: String(orderId || ''),
    orderNumber: String(orderNumber || ''),
    status: String(status || ''),
    occurredAt: new Date().toISOString(),
  });
};

// Lifecycle updates carry identifiers only; clients refetch authoritative data.
const publishSaleUpdated = ({ saleId = '', cashierId = '' } = {}) => {
  const payload = { saleId: String(saleId), occurredAt: new Date().toISOString() };
  publishEvent('sale.updated', payload, { roles: ['superadmin', 'admin'] });
  if (cashierId) publishEvent('sale.updated', payload, { roles: ['cashier'], userIds: [cashierId] });
};

const publishInventoryUpdated = ({ reason = 'unknown', productCodes = [] } = {}) => {
  publishEvent('inventory.updated', {
    reason,
    productCodes: Array.isArray(productCodes) ? productCodes : [],
    occurredAt: new Date().toISOString(),
  });
};

const publishSettingsUpdated = ({ keys = [], changedBy = '' } = {}) => {
  publishEvent('settings.updated', {
    keys: Array.isArray(keys) ? keys : [],
    changedBy: String(changedBy || ''),
    occurredAt: new Date().toISOString(),
  });
};

const publishPartnersUpdated = ({ reason = 'unknown', partnerId = '', partnerType = '' } = {}) => {
  publishEvent('partners.updated', {
    reason,
    partnerId: String(partnerId || ''),
    partnerType: String(partnerType || ''),
    occurredAt: new Date().toISOString(),
  });
};

const publishCreditTransactionsUpdated = ({ reason = 'unknown', creditTransactionId = '' } = {}) => {
  publishEvent('credit-transactions.updated', {
    reason,
    creditTransactionId: String(creditTransactionId || ''),
    occurredAt: new Date().toISOString(),
  });
};

const publishActivityLogged = ({
  id = '',
  action = '',
  user = '',
  occurredAt = null,
} = {}) => {
  publishEvent('activity.logged', {
    id: String(id || ''),
    action: String(action || ''),
    user: String(user || ''),
    occurredAt: occurredAt || new Date().toISOString(),
  }, {
    roles: ['superadmin', 'admin'],
  });
};

const publishInventoryLogged = ({
  id = '',
  action = '',
  code = '',
  user = '',
  occurredAt = null,
} = {}) => {
  publishEvent('inventory.logged', {
    id: String(id || ''),
    action: String(action || ''),
    code: String(code || ''),
    user: String(user || ''),
    occurredAt: occurredAt || new Date().toISOString(),
  }, {
    roles: ['superadmin', 'admin'],
  });
};

setInterval(() => {
  clients.forEach((client) => {
    writeEvent(client.res, 'ping', { ts: Date.now() });
  });
}, KEEPALIVE_INTERVAL_MS);

setInterval(() => {
  const now = Date.now();
  streamTickets.forEach((ticket, value) => {
    if (value.expiresAtMs <= now) {
      streamTickets.delete(ticket);
    }
  });
}, REALTIME_TICKET_TTL_MS);

module.exports = {
  subscribeClient,
  createStreamTicket,
  consumeStreamTicket,
  revokeRealtimeSession,
  publishEvent,
  publishSaleCreated,
  publishSaleUpdated,
  publishSpecialOrderUpdated,
  publishInventoryUpdated,
  publishSettingsUpdated,
  publishPartnersUpdated,
  publishCreditTransactionsUpdated,
  publishActivityLogged,
  publishInventoryLogged,
};
