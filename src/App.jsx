import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
// `motion` is used as a JSX member; core no-unused-vars does not count that reference.
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Toaster, ToastBar, toast } from 'react-hot-toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ResetCredential from './pages/ResetCredential';
import { getAuthToken, clearAuthToken, AUTH_SESSION_EXPIRED_EVENT } from './services/apiClient';
import { logoutApi } from './services/authApi';
import { resumeRealtime, stopRealtime } from './services/realtimeClient';
import { useAuth } from './context/AuthContext';
import {
  authDashboardScreenTransition,
  authDashboardScreenVariants,
  authLoginScreenTransition,
  authLoginScreenVariants,
  getAuthMotionTransition,
} from './utils/authTransitions';
import { resetLogoutScrollPositions } from './utils/logoutScroll';
import './App.css';

const AuthTransitionScreen = ({ children, variants, transition }) => {
  const isPresent = useIsPresent();

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition}
      className="min-h-screen w-full"
      aria-hidden={!isPresent}
      inert={!isPresent}
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
  );
};

function App() {
  const {
    clearAuthenticatedSession,
    appSettings,
    isSettingsLoading,
    currentAuthUserId,
    currentAuthUsername,
  } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const logoutStartedRef = useRef(false);
  const desktopAlertPromptToastIdRef = useRef(null);
  const desktopAlertPromptShownRef = useRef(false);
  const desktopAlertPromptDismissedRef = useRef(false);
  // Token in session storage is the single source of auth state on the client.
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return Boolean(getAuthToken());
  });
  
  const navigate = useNavigate();
  const location = useLocation();
  const isLoginRoute = location.pathname === '/login';
  const isResetRoute = ['/reset-password', '/reset-pin'].includes(location.pathname);
  const isPublicRoute = isLoginRoute || isResetRoute;
  const appScreenVariants = isAuthenticated ? authDashboardScreenVariants : authLoginScreenVariants;
  const appScreenTransition = getAuthMotionTransition(
    prefersReducedMotion,
    isAuthenticated ? authDashboardScreenTransition : authLoginScreenTransition
  );

  const dismissToast = useCallback((toastId) => {
    if (String(desktopAlertPromptToastIdRef.current || '') === String(toastId)) {
      desktopAlertPromptDismissedRef.current = true;
      desktopAlertPromptShownRef.current = false;
      desktopAlertPromptToastIdRef.current = null;
    }
    toast.dismiss(toastId);
  }, []);

  useLayoutEffect(() => {
    const dismissDesktopAlertPrompt = () => {
      if (desktopAlertPromptToastIdRef.current) {
        toast.dismiss(desktopAlertPromptToastIdRef.current);
        desktopAlertPromptToastIdRef.current = null;
      }
      desktopAlertPromptShownRef.current = false;
    };

    if (!isAuthenticated) {
      dismissDesktopAlertPrompt();
      desktopAlertPromptDismissedRef.current = false;
      return;
    }

    // The prompt belongs to the authenticated application shell, never Login
    // or credential-reset routes. Wait for persisted settings before deciding.
    if (isPublicRoute) {
      dismissDesktopAlertPrompt();
      return;
    }

    // Once offered, keep this prompt stable across settings refreshes and
    // permission state updates. Only explicit dismissal or leaving the
    // authenticated app shell may close it.
    if (desktopAlertPromptShownRef.current || desktopAlertPromptDismissedRef.current) return;

    if (isSettingsLoading) return;

    const authenticatedUserKey = String(currentAuthUserId || currentAuthUsername || '').trim();
    if (!authenticatedUserKey) return;

    const notificationApiAvailable = typeof window !== 'undefined'
      && 'Notification' in window
      && window.Notification;
    const shouldOfferDesktopAlerts = appSettings.desktopNotifications
      && notificationApiAvailable
      && window.Notification.permission === 'default';

    if (!shouldOfferDesktopAlerts) return;

    desktopAlertPromptShownRef.current = true;
    desktopAlertPromptToastIdRef.current = toast((t) => {
      const dismissPrompt = () => {
        dismissToast(t.id);
      };

      return (
        <div className="flex flex-col gap-2 min-w-[200px]">
          <span className="font-semibold text-sm">Enable Desktop Alerts?</span>
          <span className="text-xs text-gray-500">Get notified when stock is low.</span>
          <div className="flex gap-2 text-xs font-semibold mt-1">
            <button
              type="button"
              onClick={() => {
                dismissPrompt();
                window.Notification.requestPermission().then((permission) => {
                  if (permission === 'granted') {
                    new window.Notification('Notifications Enabled', {
                      body: 'You will now receive stock alerts.',
                    });
                  }
                }).catch(() => {});
              }}
              className="bg-white border-2 border-gray-200 text-gray-900 font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={dismissPrompt}
              className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200"
            >
              Later
            </button>
          </div>
        </div>
      );
    }, {
      duration: Infinity,
      position: 'bottom-right',
      style: { border: '1px solid #E5E7EB', padding: '16px' },
    });
  }, [
    appSettings.desktopNotifications,
    currentAuthUserId,
    currentAuthUsername,
    dismissToast,
    isAuthenticated,
    isPublicRoute,
    isSettingsLoading,
  ]);

  useEffect(() => {
    // If user is not authenticated and tries to access protected route (anything not /login), redirect
    if (!isAuthenticated && !isPublicRoute) {
         navigate('/login', { replace: true });
    }
    // If user IS authenticated and tries to go to login, redirect to dashboard home.
    // Reset routes stay accessible so email reset links work even during an active session.
    if (isAuthenticated && isLoginRoute) {
        navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isPublicRoute, isLoginRoute, navigate]);

  useEffect(() => {
    const handleSessionExpired = () => {
      if (logoutStartedRef.current) return;
      logoutStartedRef.current = true;
      stopRealtime();
      clearAuthenticatedSession();
      clearAuthToken();
      setIsAuthenticated(false);
      navigate('/login', { replace: true });
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [navigate, clearAuthenticatedSession]);

  const handleLogin = () => {
    logoutStartedRef.current = false;
    setIsAuthenticated(true);
    resumeRealtime();
    navigate('/dashboard', { replace: true });
  };

  const handleLogout = () => {
    if (logoutStartedRef.current) return;
    logoutStartedRef.current = true;
    resetLogoutScrollPositions();

    // Start the audit request while the current bearer token is still available,
    // then invalidate the local session immediately without waiting on the network.
    const logoutRequest = logoutApi();
    stopRealtime();
    clearAuthenticatedSession();
    clearAuthToken();
    setIsAuthenticated(false);
    navigate('/login', { replace: true });

    void logoutRequest.catch(() => {
      // Local sign-out is complete even if the logout audit request fails.
    });
  };

  return (
    <>
      <Toaster 
        position="top-right" 
        containerClassName="app-toaster"
        toastOptions={{
          className: '',
          duration: 4000,
          style: {
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '8px 12px',
            color: '#fff',
            fontSize: '12px',
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            fontWeight: '600',
            borderRadius: '12px',
            boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
            maxWidth: '300px',
            width: 'auto',
          },
          success: {
            iconTheme: {
              primary: '#fff',
              secondary: '#000',
            },
            duration: 4000,
          },
          error: {
             iconTheme: {
              primary: '#fff',
              secondary: '#000',
            },
            duration: 4000,
          }
        }}
      >
        {(t) => (
          <ToastBar toast={t}>
            {({ icon, message }) => (
              <div className="app-toast-bar flex flex-col w-full relative min-w-60" data-toast-type={t.type}>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Dismiss notification"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
                <div className="flex items-center gap-3 px-4 py-3 pr-10">
                  <span className="app-toast-icon shrink-0 scale-100" data-toast-type={t.type}>{icon}</span>
                  <div className="text-xs font-semibold leading-relaxed">{message}</div>
                </div>
                {t.type !== 'loading' && t.duration !== Infinity && (
                  <div className="h-0.5 w-full bg-white/10 mt-auto">
                     <div 
                        className="h-full bg-white"
                        style={{ 
                          animation: `toast-progress ${t.duration}ms linear forwards`, 
                          width: '100%' 
                        }} 
                     />
                  </div>
                )}
              </div>
            )}
          </ToastBar>
        )}
      </Toaster>
      
      <AnimatePresence mode="wait" initial={false}>
        <AuthTransitionScreen
          key={isAuthenticated ? 'authenticated-app' : 'authentication'}
          variants={appScreenVariants}
          transition={appScreenTransition}
        >
          <Routes location={location}>
            <Route path="/login" element={
              !isAuthenticated ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" replace />
            } />
            <Route path="/reset-password" element={<ResetCredential mode="password" />} />
            <Route path="/reset-pin" element={<ResetCredential mode="pin" />} />
            <Route path="/*" element={
              isAuthenticated ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" replace />
            } />
          </Routes>
        </AuthTransitionScreen>
      </AnimatePresence>
    </>
  );
}

export default App;
