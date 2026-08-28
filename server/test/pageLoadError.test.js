const assert = require('node:assert/strict');
const test = require('node:test');

const loadPageLoadError = () => import('../../src/utils/pageLoadError.js');

test('page load errors identify deliberate browser offline state before network error text', async () => {
  const { getPageLoadError } = await loadPageLoadError();
  assert.deepEqual(
    getPageLoadError(new Error('Cannot reach API server. Please make sure the backend is running.'), { online: false }),
    { title: "You're Offline", message: 'This page requires an internet connection.' },
  );
});

test('page load errors retain backend-unavailable and specific online error messages', async () => {
  const { getPageLoadError } = await loadPageLoadError();
  assert.deepEqual(
    getPageLoadError(new Error('Cannot reach API server. Please make sure the backend is running.'), { online: true }),
    { title: 'Load Failed', message: 'Cannot reach API server. Please make sure the backend is running.' },
  );
  assert.deepEqual(
    getPageLoadError(new TypeError('Failed to fetch'), { online: true }),
    { title: 'Load Failed', message: 'Cannot reach API server. Please make sure the backend is running.' },
  );
  assert.deepEqual(
    getPageLoadError(new Error('Access denied.'), { online: true }),
    { title: 'Load Failed', message: 'Access denied.' },
  );
});
