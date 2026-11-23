import React, { useState, useEffect, useRef } from 'react';
// `motion` is used as a JSX member; core no-unused-vars does not count that reference.
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { showToast } from '../utils/toastHelper';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { ROLES } from '../constants/roles';
import { loginApi, requestPasswordResetApi, requestPinResetApi } from '../services/authApi';
import { setAuthToken } from '../services/apiClient';
import DateTimeDisplay from '../components/DateTimeDisplay';
import './Login.css';
import logo from '../assets/logo.png';
import img28 from '../assets/2.8 (1).jpg';
import img16 from '../assets/1.6.jpg';
import { authFormTransition, authFormVariants, getAuthMotionTransition } from '../utils/authTransitions';

const EyeIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.25 12s3.75-7.5 9.75-7.5 9.75 7.5 9.75 7.5-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    <path d="M6.2 6.2C3.8 8 2.25 12 2.25 12s3.75 7.5 9.75 7.5c2.1 0 3.9-.5 5.4-1.3" />
    <path d="M14.1 4.8c4.5.9 7.65 5.7 7.65 7.2 0 0-1.05 2.1-3 3.95" />
  </svg>
);

const Login = ({ onLogin }) => {
  const prefersReducedMotion = useReducedMotion();
  const { appSettings, applyAuthenticatedSession } = useAuth();
  const { logActivity } = useInventory();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState(''); // 6-digit security PIN stored as string
  const inputsRef = useRef([]); // refs for PIN digit inputs
  const usernameInputRef = useRef(null);
  const [showPassword, setShowPassword] = useState(false);
  // pin visibility toggle removed; input will always mask
  const [isLoading, setIsLoading] = useState(false);
  const [errorShake, setErrorShake] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const cooldownTimer = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [needsPin, setNeedsPin] = useState(false); // show PIN field after valid creds
  const [showForgot, setShowForgot] = useState(false); // toggle forgot screen
  const [forgotType, setForgotType] = useState('password'); // or 'pin'
  const [forgotEmail, setForgotEmail] = useState('');
  const formMotionTransition = getAuthMotionTransition(prefersReducedMotion, authFormTransition);
  const authScreenKey = showForgot
    ? `forgot-${forgotType}`
    : needsPin ? 'pin-verification' : 'login-credentials';

  // clear email field whenever forgot panel opens
  useEffect(() => {
    if (showForgot) {
      setForgotEmail('');
    }
  }, [showForgot]);

  const images = [img28, img16];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prevIndex) => (prevIndex + 1) % images.length);
    }, 5000); // Change image every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Retrieve public settings for display from backend-hydrated auth context.
  const mapLink = appSettings.storeMapLink || "https://maps.app.goo.gl/9QdZo3bu4W62qTjQ8";
  const email1 = appSettings.storePrimaryEmail || "tableria@yahoo.com";
  const email2 = appSettings.storeSecondaryEmail || "tableria1@gmail.com";
  const mobile = appSettings.contactPhone || "0917-545-2166";
  const tel = appSettings.contactPhoneSecondary || "(049) 545-2166";

  const toggleTooltip = (tooltip) => {
    if (activeTooltip === tooltip) {
      setActiveTooltip(null);
    } else {
      setActiveTooltip(tooltip);
    }
  };

  const handleForgotBack = () => {
    setShowForgot(false);
    if (forgotType === 'pin') {
      setNeedsPin(true);
      setTimeout(() => {
        inputsRef.current?.[0]?.focus();
      }, 0);
    }
  };

  const handleForgotSubmit = async () => {
    const emailValue = forgotEmail.trim().toLowerCase();

    if (!emailValue) {
      showToast('Missing Field', 'Enter your registered email.', 'error', 'login-result');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      showToast('Invalid Email', 'Enter a valid registered email address.', 'error', 'login-result');
      return;
    }

    setIsLoading(true);

    try {
      let response;
      if (forgotType === 'pin') {
        response = await requestPinResetApi(emailValue);
      } else {
        response = await requestPasswordResetApi(emailValue);
      }

      if (response?.resetUrl) {
        try {
          await navigator.clipboard.writeText(response.resetUrl);
        } catch {
          // Ignore clipboard failures and still show the reset link.
        }

        showToast(
          'Reset Link Ready',
          `Email is not configured in dev mode. Use this link: ${response.resetUrl}`,
          'info',
          'login-result'
        );

        setShowForgot(false);
        setForgotEmail('');
        return;
      }

      showToast(
        'Request Submitted',
        'If your account exists, a reset link has been sent to that registered email.',
        'success',
        'login-result'
      );
      setShowForgot(false);
      setForgotEmail('');
    } catch (error) {
      showToast('Request Failed', error.message || 'Unable to process reset request.', 'error', 'login-result');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorShake(false);

    if (!email || !password) {
      showToast('Missing Fields', 'Username and password are required.', 'error', 'login-result');
      return;
    }

    setIsLoading(true);

    setTimeout(async () => {
      try {
        const response = await loginApi(email, password, needsPin ? pin : undefined);

        if (response?.requiresPin) {
          setNeedsPin(true);
          setPin('');
          showToast('Enter PIN', 'Please provide your 6-digit security PIN.', 'info', 'login-result');
          return;
        }

        if (!response?.token || !response?.user) {
          throw new Error('Invalid login response from server.');
        }

        const backendRole = response.user.role || ROLES.CASHIER;
        const backendFullName = response.user.name || response.user.username || 'User';
        const backendDisplayName = (response.user.displayName || '').trim();
        const backendName = backendDisplayName || backendFullName;

        const backendAvatar = response.user.avatarUrl || response.user.avatar || '';
        // Keep avatar undefined when unavailable so AuthContext can resolve fallback immediately.
        const resolvedAvatar = backendAvatar || undefined;

        setAuthToken(response.token);

        applyAuthenticatedSession({
          role: backendRole,
          name: backendName,
          fullName: backendFullName,
          avatar: resolvedAvatar,
          username: response.user.username || '',
          userId: String(response.user.id || ''),
          preferences: response.user.preferences,
          mustChangeCredentials: Boolean(response.user.mustChangeCredentials),
        });

        if (response.user.mustChangeCredentials) {
          showToast('Security Setup Required', 'Complete your password and PIN setup before continuing.', 'warning', 'login-result');
        }

        setEmail('');
        setPassword('');
        setPin('');
        // Keep the PIN view mounted for the outer authentication screen's exit.
        // Resetting needsPin here would start a competing PIN → Login animation
        // while this entire screen is already transitioning to the Dashboard.
        logActivity(backendName, 'Logged In');

        onLogin();
        showToast('Access Granted', `Welcome back, ${backendName}!`, 'success', 'login-result');
      } catch (error) {
        const isInvalidPrimaryCredentials = !needsPin
          && Number(error?.status) === 401
          && String(error?.message || '').trim().toLowerCase() === 'invalid credentials.';

        if (isInvalidPrimaryCredentials) {
          setEmail('');
          setPassword('');
          setTimeout(() => {
            usernameInputRef.current?.focus();
          }, 0);
        }

        if (needsPin) {
          setPin('');
          setTimeout(() => {
            inputsRef.current?.[0]?.focus();
          }, 0);
        }
        setErrorShake(true);
        setCooldown(true);
        cooldownTimer.current = setTimeout(() => setCooldown(false), 2000);
        setTimeout(() => setErrorShake(false), 500);
        showToast(
          'Access Denied',
          isInvalidPrimaryCredentials ? 'Invalid username or password.' : (error.message || 'Invalid username, password, or PIN.'),
          'error',
          'login-result'
        );
      } finally {
        setIsLoading(false);
      }
    }, 800);
  };

  // Auto-submit when PIN is complete
  useEffect(() => {
    if (needsPin && pin.length === 6 && !isLoading && !cooldown) {
      handleSubmit({ preventDefault: () => {} });
    }
  }, [pin, needsPin, isLoading, cooldown]);

  useEffect(() => {
    if (needsPin && !isLoading) {
      inputsRef.current?.[0]?.focus();
    }
  }, [needsPin, isLoading]);
   
  return (
    <div className="login-page relative">
      {/* Header Date Time Display */}
      <div className="login-clock relative z-20 flex justify-center">
         <div className="login-date-pill bg-white/10 backdrop-blur-md border border-white/10 px-6 py-2 rounded-full shadow-lg">
            <DateTimeDisplay className="text-center" dateClassName="text-white font-medium" timeClassName="text-gray-300 font-normal" oneLine={true} />
         </div>
      </div>

      {/* Background Decor */}
      <div className="login-page-decor absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-100/10 rounded-full mix-blend-overlay filter blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-100/10 rounded-full mix-blend-overlay filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] bg-purple-100/10 rounded-full mix-blend-overlay filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>

      <div className={`login-card flex w-full max-w-4xl rounded-2xl bg-white shadow-2xl z-10 transition-transform duration-300 ${errorShake ? 'animate-shake' : ''}`}>
        <div className="login-panel w-full p-6 md:w-[40%] flex flex-col justify-center relative">
          
          <div className="login-heading mb-4 text-center mt-6">
            <div className="login-logo mx-auto mb-2 h-14 w-14 hover:scale-105 transition-transform duration-500 cursor-pointer">
                <img src={logo} alt="Logo" className="h-full w-full object-contain drop-shadow-sm rounded-full" />
            </div>
            <h2 className="login-title text-large font-semibold m-3 text-gray-900 tracking-tight">Tableria La Confianza Workspace</h2>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={authScreenKey}
              className="login-auth-transition-screen"
              variants={authFormVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={formMotionTransition}
              onAnimationComplete={() => {
                if (authScreenKey === 'pin-verification' && !isLoading) inputsRef.current?.[0]?.focus();
              }}
            >
          <form onSubmit={handleSubmit} className="space-y-3" autoComplete="on">
            {!showForgot && (
              <>
            <div className="login-auth-step space-y-3">
            {!needsPin && (
            <>
            <div className="relative group">
              <input
                type="text"
                id="username"
                ref={usernameInputRef}
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                className="login-input peer block w-full border border-gray-400 bg-transparent py-2 pl-10 pr-4 text-sm font-medium text-gray-900 rounded-md focus:border-gray-900 focus:outline-none focus:ring-0 placeholder-transparent"
                placeholder=" "
                required
              />
              <label 
                htmlFor="username" 
                className="login-input-label absolute left-10 z-10 bg-white px-1 text-xs text-gray-400"
              >
                Username or Employee ID
              </label>
              <div className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 peer-focus:text-gray-900 transition-colors">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </div>
            </div>

            <div className="relative group mt-5">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                className="login-input peer block w-full border border-gray-400 bg-transparent py-2 pl-10 pr-10 text-sm font-medium text-gray-900 rounded-md focus:border-gray-900 focus:outline-none focus:ring-0 placeholder-transparent"
                placeholder=" "
                required
              />
              <label 
                htmlFor="password" 
                className="login-input-label absolute left-10 z-10 bg-white px-1 text-xs text-gray-400"
              >
                Password
              </label>
              <div className="login-input-icon absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 peer-focus:text-gray-900 transition-colors">
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="login-password-toggle absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 transition-colors cursor-pointer outline-none"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            </>
            )}

            {needsPin && (
            <>
            <div className="login-pin-instruction flex items-center mb-2">
              <button
                type="button"
                onClick={() => { setNeedsPin(false); setPin(''); setEmail(''); setPassword(''); }}
                className="login-pin-back group relative flex items-center justify-center h-8 w-8 shrink-0 rounded-md text-gray-500 hover:text-gray-900 mr-2 -mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                aria-label="Back to Sign in"
                aria-describedby="login-pin-back-tooltip"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 leading-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M13.5 8.5 10 12l3.5 3.5"></path>
                </svg>
                <span id="login-pin-back-tooltip" role="tooltip" className="login-pin-back-tooltip pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-[calc(100vw-2rem)] rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-md transition-all duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                  Back to Sign in
                  <span className="absolute -bottom-1 left-3 h-2 w-2 rotate-45 bg-gray-900"></span>
                </span>
              </button>
              <p className="text-sm text-gray-600 mb-2">Please enter your 6‑digit security PIN to continue.</p>
            </div>
            <div className="login-pin-grid mt-4" role="group" aria-label="Security PIN">
              {[...Array(6)].map((_, i) => (
                <div className="login-pin-cell" key={i}>
                <input
                  type="password"
                  aria-label={`PIN digit ${i + 1}`}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={pin[i] || ''}
                  autoComplete="one-time-code"
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !pin[i] && i > 0) {
                      inputsRef.current?.[i - 1]?.focus();
                    }
                  }}
                  onPaste={(e) => {
                    const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
                    if (!text) {
                      return;
                    }

                    e.preventDefault();
                    setPin(text);

                    const nextIndex = Math.min(text.length, 5);
                    inputsRef.current?.[nextIndex]?.focus();
                  }}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    if (rawValue && /[^0-9]/.test(rawValue)) {
                      setPin('');
                      inputsRef.current?.[0]?.focus();
                      return;
                    }

                    const val = rawValue.replace(/[^0-9]/g, '');
                    const arr = pin.split('');
                    arr[i] = val;
                    const newPin = arr.join('');
                    setPin(newPin);
                    if (val && i < 5 && inputsRef.current[i+1]) {
                      inputsRef.current[i+1].focus();
                    }
                  }}
                  ref={el => inputsRef.current[i] = el}
                  className="login-pin-input w-10 h-10 text-center border border-gray-400 rounded-md text-base font-semibold text-gray-900 bg-white focus:border-gray-900 focus:outline-none"
                  required
                />
                <span className="login-pin-mask" aria-hidden="true">{pin[i] ? '\u2022' : ''}</span>
                </div>
              ))}
            </div>
            </>
            )}
            </div>
            {!showForgot && (
              <div className="mb-4 text-right text-xs">
                <button
                  type="button"
                  className="login-forgot-link group relative text-gray-500 hover:underline hover:text-black"
                  onClick={() => { setForgotType(needsPin ? 'pin' : 'password'); setShowForgot(true); }}
                >
                  {needsPin ? 'Forgot PIN?' : 'Forgot password?'}
                  <div className="pointer-events-none absolute right-0 bottom-full mb-1.5 z-20 w-max rounded-md bg-gray-900 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-lg opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 whitespace-nowrap">
                    {needsPin ? 'Reset your PIN securely' : 'Recover your account credentials'}
                  </div>
                </button>
              </div>
            )}
            <div className="relative group/tooltip">
              <button
                type="submit"
                disabled={needsPin || isLoading || cooldown}
                aria-live={needsPin ? 'polite' : undefined}
                aria-atomic={needsPin ? 'true' : undefined}
                className={`login-primary-action ${needsPin ? 'login-pin-status-slot' : ''} w-full h-10 rounded-xl text-sm font-semibold tracking-wide mt-2 flex items-center justify-center gap-2 relative overflow-hidden ${(needsPin && !isLoading) ? 'bg-transparent text-black shadow-none cursor-default' : 'bg-[#111827] text-white shadow-lg transition-all duration-300'} ${(!needsPin && !isLoading) ? 'hover:opacity-90 transform active:scale-95 hover:-translate-y-0.5' : ''}`}
              >
                {isLoading ? (
                    <>
                      {needsPin ? (
                        <>
                        <svg className="animate-spin -ml-1 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span className="text-white font-semibold animate-pulse">Verifying PIN...</span>
                        </>
                      ) : (
                        // Standard Loading State (for normal login)
                        <div className="flex items-center gap-2">
                             <svg className="animate-spin -ml-1 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Signing In...</span>
                        </div>
                      )}
                    </>
                ) : (
                    <>
                      {needsPin ? (
                        /* Empty state for cleaner UI since instructions are already above */
                        <span></span>
                      ) : (
                        <span>Sign In</span>
                      )}
                    </>
                )}
              </button>
              {needsPin && !isLoading && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-[10px] rounded shadow-sm opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                      Auto-login after 6 digits
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
                  </div>
              )}
            </div>
              </>
            )}
          </form>

          {/* forgot password/pin panel */}
          {showForgot && (
            <div className="login-reset-panel mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="login-reset-accent h-px bg-linear-to-r from-gray-700 to-black"></div>
              <div className="p-4">
                <div className="flex items-start gap-2 mb-3">
                  <div className="login-reset-icon p-1.5 rounded-lg bg-gray-100 text-gray-900 shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8"></path></svg>
                  </div>
                  <div>
                    <h2 className="login-reset-title text-sm font-semibold text-gray-900">Reset {forgotType === 'password' ? 'Password' : 'PIN'}</h2>
                    <p className="login-reset-description text-xs text-gray-600 mt-0.5">
                      {forgotType === 'password'
                        ? 'Enter your registered account email. A reset link will be sent to that same email.'
                        : 'Enter your registered account email. PIN reset instructions will be sent to that same email.'}
                    </p>
                  </div>
                </div>

                <div className="relative mb-3">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-2 11H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2z"></path></svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Enter registered email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    className="login-reset-input w-full pl-10 pr-3 py-2.5 text-sm rounded-lg border border-gray-300 focus:border-gray-900 focus:ring-2 focus:ring-gray-200 outline-none"
                  />
                </div>

                <div className="flex justify-between items-center gap-2">
                  <button
                    type="button"
                    className="login-reset-secondary px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 transition-colors"
                    onClick={handleForgotBack}
                  >
                    {forgotType === 'pin' ? 'Back to PIN' : 'Back'}
                  </button>
                  <button
                    type="button"
                    className="login-reset-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gray-900 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={isLoading}
                    onClick={handleForgotSubmit}
                  >
                    {isLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
              </div>
            </div>
          )}
            </motion.div>
          </AnimatePresence>

          <div className="login-contact-area mt-8 pt-6 border-t border-gray-100">
            <div className="flex justify-center space-x-8">
              <a
                href={mapLink}
                target="_blank"
                rel="noopener noreferrer"
                className="login-contact-action group relative flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 shadow-sm transition-colors duration-200 hover:bg-blue-100"
              >
                <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 w-max -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-md shadow-indigo-500/20 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0 translate-y-1">
                  View Location
                  <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 bg-gray-900"></div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
              </a>

              <div 
                onClick={() => toggleTooltip('email')}
                className="login-contact-action group relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-red-50 text-red-600 shadow-sm transition-colors duration-200 hover:bg-red-100"
              >
                <div className={`absolute bottom-full left-1/2 mb-2 w-max -translate-x-1/2 rounded bg-gray-900 px-2 py-1.5 text-center text-[10px] font-medium text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ${activeTooltip === 'email' ? 'opacity-100 translate-y-0 z-10' : 'opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto'}`}>
                  <p>{email1}</p>
                  <p>{email2}</p>
                  <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 bg-gray-900"></div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
              </div>

              <div 
                onClick={() => toggleTooltip('phone')}
                className="login-contact-action group relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-green-50 text-green-600 shadow-sm transition-colors duration-200 hover:bg-green-100"
              >
                <div className={`absolute bottom-full left-1/2 mb-2 w-max -translate-x-1/2 rounded bg-gray-900 px-2 py-1.5 text-center text-[10px] font-medium text-white shadow-md shadow-indigo-500/20 transition-all duration-300 ${activeTooltip === 'phone' ? 'opacity-100 translate-y-0 z-10' : 'opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto'}`}>
                  {tel && <p>Tel: {tel}</p>}
                  {mobile && <p>Cell: {mobile}</p>}
                  <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 bg-gray-900"></div>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div className="login-image-panel hidden rounded-r-2xl md:w-[60%] md:block relative overflow-hidden group">
          {/* Overlay Effect for "Cinematic" look */}
          <div className="login-image-overlay absolute inset-0 bg-gradient-to-t from-gray-900/10 via-transparent to-transparent z-10 pointer-events-none"></div>
          
          {/* Smooth Fade Transition from Form */}
          <div className="login-image-fade absolute top-0 left-0 h-full w-12 bg-gradient-to-r from-white/85 via-white/25 to-transparent z-20 pointer-events-none"></div>

          {images.map((img, index) => (
            <div
              key={index}
              className={`absolute inset-0 transition-opacity duration-[2000ms] ease-in-out ${
                index === currentImageIndex ? 'opacity-100 z-0' : 'opacity-0 -z-10'
              }`}
            >
              <img 
                src={img} 
                alt={`Store ${index + 1}`} 
                className={`h-full w-full object-cover transform transition-transform duration-[10000ms] ease-linear will-change-transform ${
                    index === currentImageIndex ? 'scale-115' : 'scale-100'
                } ${index === 0 ? 'object-[25%_center]' : 'object-center'}`} 
              />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="login-footer relative w-full text-center">
        <div className="flex flex-col items-center justify-center space-y-1">
             <p className="text-[10px] font-semibold text-gray-100 tracking-[0.2em] ">
                &copy; 2026 Tableria La Confianza Co., Inc.
            </p>
            <p className="text-[9px] font-medium text-gray-300 tracking-widest">
                All Rights Reserved
            </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
