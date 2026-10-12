const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('Restart App reinitializes from the root without clearing pending offline queue storage', async () => {
  const { restartApp } = await import('../../src/utils/appRecovery.js');
  const storage = new Map([
    ['syncQueue:user:cashier-1', JSON.stringify([{ clientRequestId: 'sale:pending-1' }])],
    ['syncQueue:legacy-unassigned', JSON.stringify([{ clientRequestId: 'sale:legacy-1' }])],
  ]);
  const location = {
    assign: (path) => { location.assignedPath = path; },
  };

  restartApp({ location, localStorage: storage, sessionStorage: storage });
  assert.equal(location.assignedPath, '/');
  assert.equal(storage.get('syncQueue:user:cashier-1'), JSON.stringify([{ clientRequestId: 'sale:pending-1' }]));
  assert.equal(storage.get('syncQueue:legacy-unassigned'), JSON.stringify([{ clientRequestId: 'sale:legacy-1' }]));

});

test('global error screen offers only Restart App and retains error details', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/components/ErrorBoundary.jsx'), 'utf8');

  assert.match(source, /Restart App/);
  assert.match(source, /If the problem continues, contact the administrator\./);
  assert.match(source, /this\.state\.error && this\.state\.error\.toString\(\)/);
  assert.doesNotMatch(source, /Reload Page|reloadPage/);
});
