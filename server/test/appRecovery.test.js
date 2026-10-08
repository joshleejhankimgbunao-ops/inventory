const assert = require('node:assert/strict');
const test = require('node:test');

test('Restart App and Reload Page leave pending offline queue storage untouched', async () => {
  const { reloadPage, restartApp } = await import('../../src/utils/appRecovery.js');
  const storage = new Map([
    ['syncQueue:user:cashier-1', JSON.stringify([{ clientRequestId: 'sale:pending-1' }])],
    ['syncQueue:legacy-unassigned', JSON.stringify([{ clientRequestId: 'sale:legacy-1' }])],
  ]);
  const location = {
    assign: (path) => { location.assignedPath = path; },
    reload: () => { location.reloaded = true; },
  };

  restartApp({ location, localStorage: storage, sessionStorage: storage });
  assert.equal(location.assignedPath, '/');
  assert.equal(storage.get('syncQueue:user:cashier-1'), JSON.stringify([{ clientRequestId: 'sale:pending-1' }]));
  assert.equal(storage.get('syncQueue:legacy-unassigned'), JSON.stringify([{ clientRequestId: 'sale:legacy-1' }]));

  reloadPage({ location, localStorage: storage, sessionStorage: storage });
  assert.equal(location.reloaded, true);
  assert.equal(storage.get('syncQueue:user:cashier-1'), JSON.stringify([{ clientRequestId: 'sale:pending-1' }]));
  assert.equal(storage.get('syncQueue:legacy-unassigned'), JSON.stringify([{ clientRequestId: 'sale:legacy-1' }]));
});
