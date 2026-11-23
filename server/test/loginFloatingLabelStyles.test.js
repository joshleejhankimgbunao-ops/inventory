/* global require, __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
const login = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.jsx'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../../src/App.jsx'), 'utf8');
const authTransitions = fs.readFileSync(path.resolve(__dirname, '../../src/utils/authTransitions.js'), 'utf8');

test('authentication transitions preserve the login flow and honor reduced motion', () => {
  assert.match(login, /<AnimatePresence mode="wait" initial=\{false\}>[\s\S]*?key=\{authScreenKey\}/);
  assert.match(login, /const authScreenKey = showForgot[\s\S]*?`forgot-\$\{forgotType\}`[\s\S]*?'pin-verification' : 'login-credentials'/);
  assert.match(login, /variants=\{authFormVariants\}[\s\S]*?transition=\{formMotionTransition\}/);
  assert.match(login, /onAnimationComplete=\{\(\) => \{\s*if \(authScreenKey === 'pin-verification' && !isLoading\) inputsRef\.current\?\.\[0\]\?\.focus\(\);/);
  assert.equal((login.match(/<AnimatePresence\b/g) || []).length, 1, 'auth form screens share one AnimatePresence boundary');
  assert.match(login, /useReducedMotion\(\)/);
  assert.match(app, /<AnimatePresence mode="wait" initial=\{false\}>[\s\S]*?key=\{isAuthenticated \? 'authenticated-app' : 'authentication'\}/);
  assert.match(app, /<Routes location=\{location\}>/);
  assert.match(app, /const isPresent = useIsPresent\(\);[\s\S]*?aria-hidden=\{!isPresent\}[\s\S]*?inert=\{!isPresent\}/);
  assert.match(app, /useReducedMotion\(\)/);
  assert.match(app, /isAuthenticated \? <Dashboard onLogout=\{handleLogout\} \/> : <Navigate to="\/login" replace \/>/);
  assert.match(authTransitions, /duration: 0\.3/);
  assert.match(authTransitions, /authLoginScreenVariants = \{[\s\S]*?initial: \{ opacity: 0, y: 8 \}[\s\S]*?exit: \{ opacity: 0, y: -8 \}/);
  assert.match(authTransitions, /authDashboardScreenVariants = \{[\s\S]*?exit: \{ opacity: 0, y: -8 \}/);
  assert.match(authTransitions, /authLoginScreenTransition = \{\s*duration: 0\.35,\s*ease: \[0\.22, 1, 0\.36, 1\]/);
  assert.match(authTransitions, /duration: 0\.35/);
  assert.match(authTransitions, /prefersReducedMotion \? \{ duration: 0 \} : transition/);
});

test('Login, PIN, Forgot Password, and Forgot PIN share the same keyed form transition', () => {
  assert.match(login, /showForgot\s*\?\s*`forgot-\$\{forgotType\}`\s*:\s*needsPin\s*\?\s*'pin-verification'\s*:\s*'login-credentials'/);
  assert.match(login, /key=\{authScreenKey\}[\s\S]*?variants=\{authFormVariants\}[\s\S]*?transition=\{formMotionTransition\}/);
  assert.match(login, /onClick=\{\(\) => \{ setForgotType\(needsPin \? 'pin' : 'password'\); setShowForgot\(true\); \}\}/);
  assert.match(login, /const handleForgotBack = \(\) => \{\s*setShowForgot\(false\);\s*if \(forgotType === 'pin'\) \{\s*setNeedsPin\(true\);/);
});

test('logout invalidates the local session without waiting for the audit request', () => {
  assert.match(app, /const handleLogout = \(\) => \{[\s\S]*?const logoutRequest = logoutApi\(\);[\s\S]*?clearAuthToken\(\);[\s\S]*?setIsAuthenticated\(false\);[\s\S]*?navigate\('\/login', \{ replace: true \}\);[\s\S]*?void logoutRequest\.catch/);
  assert.doesNotMatch(app, /await logoutApi\(\)/);
});

test('successful PIN verification keeps the PIN view stable while the app screen exits', () => {
  const successfulLogin = login.match(/setAuthToken\(response\.token\);[\s\S]*?onLogin\(\);/)?.[0] || '';

  assert.match(successfulLogin, /setPin\(''\);/);
  assert.doesNotMatch(successfulLogin, /setNeedsPin\(false\)/);
  assert.match(login, /Keep the PIN view mounted for the outer authentication screen's exit/);
});

test('Login floating labels keep an opaque surface over outlined input borders', () => {
  const lightLabelRule = css.match(/^\.login-input-label\s*\{([^}]*)\}/m)?.[1] || '';

  assert.match(login, /login-input-label[^\n]*bg-white[^\n]*px-1/);
  assert.match(lightLabelRule, /background-color:\s*#ffffff !important;/);
  assert.match(lightLabelRule, /text-shadow:\s*none;/);
  assert.doesNotMatch(lightLabelRule, /background-color:\s*transparent !important;/);
});

test('Login floating labels keep the white inset surface in dark application theme', () => {
  const authCss = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.css'), 'utf8');

  assert.match(authCss, /html\.dark \.login-page \.login-input,[\s\S]*background-color:\s*#ffffff !important;/);
  assert.match(authCss, /html\.dark \.login-page \.login-input-label\s*\{\s*background-color:\s*#ffffff !important;/);
  assert.match(authCss, /html\.dark \.login-page \.login-pin-mask\s*\{\s*color:\s*#111827;/);
});

test('Login and PIN use the original navy canvas and pure-white card in either theme', () => {
  const authCss = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.css'), 'utf8');
  const darkThemeCss = css.match(/html\.dark \.login-page\s*\{([^}]*)\}/)?.[1] || '';
  const darkAuthCss = authCss.match(/html\.dark \.login-page\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(authCss.match(/^\.login-page\s*\{([^}]*)\}/m)?.[1] || '', /background:\s*linear-gradient\(to bottom right, #111827 0%, #0f172a 50%, #0f1419 100%\);/);
  assert.match(darkThemeCss, /background:\s*linear-gradient\(to bottom right, #111827 0%, #0f172a 50%, #0f1419 100%\) !important;/);
  assert.match(darkAuthCss, /background:\s*linear-gradient\(to bottom right, #111827 0%, #0f172a 50%, #0f1419 100%\) !important;/);
  assert.match(authCss, /html\.dark \.login-page \.login-card,[\s\S]*?background-color:\s*#ffffff !important;/);
  assert.match(authCss, /html\.dark \.login-page \.login-footer \.text-gray-100\s*\{\s*color:\s*#f3f4f6 !important;/);
});

test('Login date and time pill reuses the original translucent navy treatment', () => {
  const loginPage = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.jsx'), 'utf8');
  const authCss = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.css'), 'utf8');

  assert.match(loginPage, /login-date-pill bg-white\/10 backdrop-blur-md border border-white\/10 px-6 py-2 rounded-full shadow-lg/);
  assert.match(loginPage, /dateClassName="text-white font-medium" timeClassName="text-gray-300 font-normal"/);
  assert.match(css, /\.login-date-pill\s*\{\s*border-color:\s*rgba\(255, 255, 255, 0\.16\);/);
  assert.doesNotMatch(authCss, /login-date-pill\s*\{[^}]*background:\s*#ffffff/);
  assert.doesNotMatch(css, /html\.dark \.login-date-pill\s*\{/);
});

test('desktop Login card gets modest outer dimensions while the form content width stays capped', () => {
  const authCss = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.css'), 'utf8');

  assert.match(authCss, /@media \(min-width: 768px\)\s*\{[\s\S]*?\.login-page \.login-card \{ max-width: 60rem; \}/);
  assert.match(authCss, /@media \(min-width: 1024px\) and \(min-height: 720px\)\s*\{\s*\.login-page \.login-card \{ min-height: 35rem; \}/);
  assert.match(authCss, /\.login-page \.login-auth-transition-screen\s*\{\s*width: 100%;\s*max-width: 19\.375rem;\s*align-self: center;/);
  assert.match(authCss, /@media \(max-width: 767px\)\s*\{\s*\.login-page \.login-card \{ max-width: 28rem; \}/);
});

test('PIN verification action reserves a stable responsive status slot while inactive', () => {
  const authCss = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Login.css'), 'utf8');

  assert.match(login, /login-pin-status-slot/);
  assert.match(login, /aria-live=\{needsPin \? 'polite' : undefined\}/);
  assert.match(login, /Verifying PIN\.\.\./);
  assert.doesNotMatch(login, /hidden=\{needsPin && !isLoading\}/);
  assert.match(authCss, /\.login-page \.login-pin-status-slot\s*\{\s*min-height:\s*2\.5rem;/);
  assert.match(authCss, /@media \(max-width: 767px\)[\s\S]*?\.login-page \.login-pin-status-slot\s*\{\s*min-height:\s*44px;/);
});
