/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.resolve(__dirname, '../../src/App.jsx'), 'utf8');
const dashboard = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Dashboard.jsx'), 'utf8');
const authContext = fs.readFileSync(path.resolve(__dirname, '../../src/context/AuthContext.jsx'), 'utf8');

const promptEffectStart = app.indexOf('useLayoutEffect(() => {');
const promptEffectEnd = app.indexOf('  }, [\n    appSettings.desktopNotifications', promptEffectStart);
const promptEffect = app.slice(promptEffectStart, promptEffectEnd);

test('desktop alerts prompt waits for an authenticated protected screen and loaded settings', () => {
  assert.match(app, /if \(!isAuthenticated\) \{[\s\S]*?dismissDesktopAlertPrompt\(\);[\s\S]*?desktopAlertPromptDismissedRef\.current = false;/);
  assert.match(app, /if \(isPublicRoute\) \{[\s\S]*?dismissDesktopAlertPrompt\(\);/);
  assert.match(app, /if \(isSettingsLoading\) return;/);
  assert.match(app, /const authenticatedUserKey = String\(currentAuthUserId \|\| currentAuthUsername \|\| ''\)\.trim\(\);/);
  assert.match(app, /window\.Notification\.permission === 'default'/);
});

test('desktop alerts prompt remains until Allow or Later and does not duplicate per session', () => {
  assert.match(promptEffect, /if \(desktopAlertPromptShownRef\.current \|\| desktopAlertPromptDismissedRef\.current\) return;/);
  assert.ok(promptEffect.indexOf('desktopAlertPromptShownRef.current || desktopAlertPromptDismissedRef.current')
    < promptEffect.indexOf('if (isSettingsLoading) return;'));
  assert.match(promptEffect, /if \(!shouldOfferDesktopAlerts\) return;/);
  assert.doesNotMatch(promptEffect, /if \(!shouldOfferDesktopAlerts\) \{\s*dismissDesktopAlertPrompt\(\);/);
  assert.match(app, /duration: Infinity/);
  assert.match(app, /desktopAlertPromptDismissedRef\.current = true;[\s\S]*?toast\.dismiss\(toastId\)/);
  assert.match(app, /onClick=\{\(\) => dismissToast\(t\.id\)\}/);
  assert.match(app, /Enable Desktop Alerts\?/);
  assert.match(app, />\s*Allow\s*</);
  assert.match(app, />\s*Later\s*</);
});

test('authenticated identity changes wait for that identity settings before prompting', () => {
  assert.match(authContext, /if \(username !== currentAuthUsername\) \{\s*\/\/ Keep consumers from acting on the previous session's\s*\/\/ settings while the new authenticated identity is loading\.\s*setIsSettingsLoading\(true\);\s*\}/);
});

test('low-stock notification delivery remains in Dashboard', () => {
  assert.match(dashboard, /Low Stock Alert/);
  assert.match(dashboard, /window\.Notification\.permission === 'granted'/);
  assert.match(dashboard, /new window\.Notification\("Inventory Alert!"/);
  assert.doesNotMatch(dashboard, /Enable Desktop Alerts\?/);
});
