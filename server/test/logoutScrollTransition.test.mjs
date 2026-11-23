import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetLogoutScrollPositions } from '../../src/utils/logoutScroll.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.jsx'), 'utf8');

test('logout resets document and Dashboard scroll regions before changing authentication state', () => {
  const logoutStart = app.indexOf('const handleLogout = () => {');
  const logoutEnd = app.indexOf('\n  };', logoutStart);
  const logoutHandler = app.slice(logoutStart, logoutEnd);

  assert.ok(logoutStart >= 0, 'logout handler exists');
  assert.ok(logoutHandler.indexOf('resetLogoutScrollPositions()') < logoutHandler.indexOf('setIsAuthenticated(false)'));
  assert.match(app, /<AnimatePresence mode="wait" initial=\{false\}>/);
  assert.match(dashboard, /<nav data-dashboard-scroll-container/);
  assert.match(dashboard, /<main data-dashboard-scroll-container/);
});

test('logout scroll reset clears document and nested positions and hides only outgoing Dashboard scrollbars', () => {
  const regions = [
    { scrollTop: 420, style: { overflowY: 'auto' } },
    { scrollTop: 88, style: { overflowY: 'auto' } },
  ];
  const documentRef = {
    documentElement: { scrollTop: 220 },
    body: { scrollTop: 180 },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-dashboard-scroll-container]');
      return regions;
    },
  };
  const scrollCalls = [];
  const windowRef = { scrollTo: (...args) => scrollCalls.push(args) };

  resetLogoutScrollPositions(documentRef, windowRef);

  assert.deepEqual(scrollCalls, [[0, 0]]);
  assert.equal(documentRef.documentElement.scrollTop, 0);
  assert.equal(documentRef.body.scrollTop, 0);
  assert.deepEqual(regions.map(({ scrollTop }) => scrollTop), [0, 0]);
  assert.deepEqual(regions.map(({ style }) => style.overflowY), ['hidden', 'hidden']);
});

test('logout scroll reset safely does nothing without a browser document', () => {
  assert.doesNotThrow(() => resetLogoutScrollPositions(null, null));
});
