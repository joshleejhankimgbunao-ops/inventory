export const createClientRequestId = (prefix = 'request') => {
  const normalizedPrefix = String(prefix || 'request').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'request';
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  return `${normalizedPrefix}:${randomId}`;
};
