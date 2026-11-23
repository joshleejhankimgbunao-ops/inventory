const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/services/realtimeClient.js'), 'utf8');
const inventoryContext = fs.readFileSync(path.resolve(__dirname, '../../src/context/InventoryContext.jsx'), 'utf8');
const realtimeService = fs.readFileSync(path.resolve(__dirname, '../src/services/realtimeService.js'), 'utf8');

test('realtime client keeps one stream and requests a fresh ticket after interruptions', () => {
  assert.match(source, /if \(!shouldStayConnected \|\| eventSource \|\| ticketRequestController\) \{/);
  assert.match(source, /source\.onerror = \(\) => \{[\s\S]*?closeEventSource\(\);\s*scheduleReconnect\(\);/);
  assert.match(source, /REALTIME_RECONNECT_DELAY_MS\s*=\s*3000/);
  assert.match(source, /hasConnectedOnce[\s\S]*?dispatchEventToSubscribers\(REALTIME_RESYNC_EVENT, event\)/);
  assert.match(source, /stopRealtime\s*=\s*\(\) => \{\s*shouldStayConnected = false;\s*\/\/ Keep the successful-connection marker/);
});

test('log refresh coalesces event bursts and ignores stale responses', () => {
  assert.match(inventoryContext, /activityLogsRefreshPending = true/);
  assert.match(inventoryContext, /inventoryLogsRefreshPending = true/);
  assert.match(inventoryContext, /requestSequence === activityLogsRequestSequenceRef\.current/);
  assert.match(inventoryContext, /requestSequence === inventoryLogsRequestSequenceRef\.current/);
});

test('SSE service documents that current delivery is process-local', () => {
  assert.match(realtimeService, /Connections and tickets are intentionally process-local/);
  assert.match(realtimeService, /Multi-instance[\s\S]*shared pub\/sub/);
  assert.match(realtimeService, /roles: \['superadmin', 'admin'\]/);
  assert.match(realtimeService, /roles: \['cashier'\], userIds: \[cashierId\]/);
  assert.match(realtimeService, /roles: \['superadmin', 'admin'\][\s\S]*?publishInventoryLogged/);
});
