const assert = require('node:assert/strict');
const test = require('node:test');

const servicePath = require.resolve('../src/services/realtimeService');

const createStream = (user) => {
  const chunks = [];
  let onClose = () => {};
  const req = { on: (event, handler) => { if (event === 'close') onClose = handler; } };
  const res = {
    writableEnded: false,
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk) => chunks.push(String(chunk)),
    end: () => { res.writableEnded = true; },
  };
  return { req, res, user, chunks, close: () => onClose() };
};

test('sale.updated void-request refresh events reach Admin and Super Admin users plus the owning cashier only', () => {
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref: () => {} });
  delete require.cache[servicePath];
  const { publishSaleUpdated, subscribeClient } = require('../src/services/realtimeService');
  global.setInterval = originalSetInterval;

  const admin = createStream({ _id: 'admin-1', role: 'admin' });
  const superAdmin = createStream({ _id: 'superadmin-1', role: 'superadmin' });
  const owner = createStream({ _id: 'cashier-1', role: 'cashier' });
  const other = createStream({ _id: 'cashier-2', role: 'cashier' });
  subscribeClient(admin.req, admin.res, admin.user);
  subscribeClient(superAdmin.req, superAdmin.res, superAdmin.user);
  subscribeClient(owner.req, owner.res, owner.user);
  subscribeClient(other.req, other.res, other.user);
  admin.chunks.length = 0;
  superAdmin.chunks.length = 0;
  owner.chunks.length = 0;
  other.chunks.length = 0;

  publishSaleUpdated({
    saleId: '68a01234567890abcdef1234',
    cashierId: 'cashier-1',
    changeType: 'sale.void-request.requested',
  });

  assert.match(admin.chunks.join(''), /event: sale\.updated/);
  assert.match(superAdmin.chunks.join(''), /event: sale\.updated/);
  assert.match(owner.chunks.join(''), /event: sale\.updated/);
  assert.equal(other.chunks.length, 0);
  assert.match(admin.chunks.join(''), /68a01234567890abcdef1234/);
  assert.match(admin.chunks.join(''), /sale\.void-request\.requested/);
  assert.doesNotMatch(admin.chunks.join(''), /reason|voidInfo|status/);

  admin.close();
  superAdmin.close();
  owner.close();
  other.close();
  delete require.cache[servicePath];
});
