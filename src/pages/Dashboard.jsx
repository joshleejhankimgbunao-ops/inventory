import React, { useState, useEffect, Suspense, lazy } from 'react';
import { toast } from 'react-hot-toast';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import AnimatedPage from '../components/AnimatedPage';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { ROLES, canAccess } from '../constants/roles';
import { listUsersApi, updateMyPreferencesApi } from '../services/authApi';
import { listCreditTransactionsApi } from '../services/inventoryApi';
import { showToast } from '../utils/toastHelper';
import { getCreditDueAlertCounts } from '../utils/creditDueStatus';
import { getActorDisplayName } from '../utils/actorDisplay';
// Dashboard Component for Inventory System
import logo from '../assets/logo.png';
import DateTimeDisplay from '../components/DateTimeDisplay';
import PageSkeleton from '../components/PageSkeleton';

// Lazy Load Pages (prefetched on idle — see useEffect below)
const DashboardHome = lazy(() => import('./DashboardHome'));
const PointOfSale = lazy(() => import('./PointOfSale'));
const Inventory = lazy(() => import('./Inventory'));
const ProductList = lazy(() => import('./ProductList'));
const UserList = lazy(() => import('./UserList'));
const Reports = lazy(() => import('./Reports'));
const Recommendation = lazy(() => import('./Recommendation'));
const Settings = lazy(() => import('./Settings'));
const Profile = lazy(() => import('./Profile'));
const History = lazy(() => import('./History'));
const Partners = lazy(() => import('./Partners'));
const SpecialOrders = lazy(() => import('./SpecialOrders'));
const CreditTransactions = lazy(() => import('./CreditTransactions'));

// Prefetch all page chunks when browser is idle (after initial render)
const prefetchPages = () => {
  const pages = [
    () => import('./DashboardHome'),
    () => import('./PointOfSale'),
    () => import('./Inventory'),
    () => import('./ProductList'),
    () => import('./UserList'),
    () => import('./Reports'),
    () => import('./Recommendation'),
    () => import('./Settings'),
    () => import('./Profile'),
    () => import('./History'),
    () => import('./Partners'),
    () => import('./SpecialOrders'),
        () => import('./CreditTransactions'),
  ];
  pages.forEach(load => load());
};



const RequirePageAccess = ({ userRole, page, children }) => {
    if (!canAccess(userRole, page)) {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
};

const getCreditDueAlertSessionKey = (userId) => `credit-due-alert-shown:${userId}`;
const getLowStockAlertSessionKey = (userId) => `low-stock-alert-shown:${userId}`;

const SignOutIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

const Dashboard = ({ onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const activeMenu = React.useMemo(() => {
    const path = location.pathname;
    if (path === '/' || path === '/dashboard' || path === '/dashboard/') return 'Dashboard';
    if (path.startsWith('/pos')) return 'Point of Sale';
    if (path.startsWith('/inventory')) return 'Inventory';
    if (path.startsWith('/product-list')) return 'Product Master List';
    if (path.startsWith('/partners')) return 'Partners';
    if (path.startsWith('/reports')) return 'Reports';
    if (path.startsWith('/recommendations')) return 'Recommendation';
    if (path.startsWith('/users')) return 'User List';
    if (path.startsWith('/history')) return 'History Logs';
    if (path.startsWith('/special-orders')) return 'Special Orders';
    if (path.startsWith('/credit-transactions')) return 'Credit Transactions';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/profile')) return 'Profile';
    return 'Dashboard';
  }, [location.pathname]);
    const isProfilePage = location.pathname.startsWith('/profile');

  // Handle Navigation and Close Menu
  const handleNavigation = (path) => {
      // Force update location and state
      navigate(path);
      // We don't need to manually set activeMenu because it is derived from location.pathname
  };

    const { userRole, appSettings, currentUserName, isDarkMode, setIsDarkMode, isAdminOrAbove, roleNames, currentUserAvatar, currentAuthUsername, currentAuthUserId, mustChangeCredentials, isAuthBootstrapLoading } = useAuth();
  // we rely on the context's currentUserAvatar which already handles
  // super‑admin/appSettings and any avatar stored on a user record.
  const { 
    activityLogs, setActivityLogs,
    processedInventory, 
        isPageDataLoading
  } = useInventory();

    const [backendUsers, setBackendUsers] = useState([]);
        const [isBackendUsersLoading, setIsBackendUsersLoading] = useState(true);

    const ACTIVITY_LOG_ONE_TIME_RESET_KEY = 'activityLogOneTimeResetDone';

    useEffect(() => {
        let isMounted = true;

        const loadUsers = async () => {
            if (isMounted) {
                setIsBackendUsersLoading(true);
            }

            try {
                const users = await listUsersApi();
                if (!isMounted) {
                    return;
                }
                setBackendUsers(Array.isArray(users) ? users : []);
            } catch {
                if (isMounted) {
                    setBackendUsers([]);
                }
            } finally {
                if (isMounted) {
                    setIsBackendUsersLoading(false);
                }
            }
        };

        loadUsers();

        return () => {
            isMounted = false;
        };
    }, []);

    const isRouteContentLoading = isAuthBootstrapLoading || isPageDataLoading || isBackendUsersLoading;
  
  
  // Request Desktop Notification Permission (User-Interactive Toast)
  useEffect(() => {
    // Prefetch all page chunks when browser is idle
    if ('requestIdleCallback' in window) {
      const idleId = requestIdleCallback(() => prefetchPages(), { timeout: 2000 });
      return () => cancelIdleCallback(idleId);
    } else {
      // Fallback: prefetch after 1s
      const timer = setTimeout(prefetchPages, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

    useEffect(() => {
        if (!mustChangeCredentials) {
            return;
        }

        if (!location.pathname.startsWith('/profile')) {
            navigate('/profile?section=security&required=1', { replace: true });
        }
    }, [mustChangeCredentials, location.pathname, navigate]);

  useEffect(() => {
    // Check if Notification API is available in the browser first
    if (appSettings.desktopNotifications && 'Notification' in window && window.Notification && window.Notification.permission === 'default') {
        const toastId = toast((t) => ( 
            <div className="flex flex-col gap-2 min-w-[200px]">
                <span className="font-semibold text-sm">Enable Desktop Alerts?</span>
                <span className="text-xs text-gray-500">Get notified when stock is low.</span>
                <div className="flex gap-2 text-xs font-semibold mt-1">
                    <button 
                        onClick={() => {
                            toast.dismiss(t.id);
                            // Safe access to Notification
                            if ('Notification' in window && window.Notification) {
                                window.Notification.requestPermission().then(perm => {
                                    if (perm === 'granted') {
                                        new window.Notification("Notifications Enabled", { body: "You will now receive stock alerts." });
                                    }
                                });
                            }
                        }}
                        className="bg-white border-2 border-gray-200 text-gray-900 font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Allow
                    </button>
                    <button 
                        onClick={() => toast.dismiss(t.id)}
                        className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200"
                    >
                        Later
                    </button>
                </div>
            </div>
        ), { 
            duration: 8000, 
            position: 'bottom-right',
            style: { border: '1px solid #E5E7EB', padding: '16px' }
        });

        // Cleanup
        return () => toast.dismiss(toastId);
    }
  }, [appSettings.desktopNotifications]);



  // Evaluate the automatic low-stock alert once after the authenticated session data loads.
  useEffect(() => {
      if (isPageDataLoading) {
          return;
      }

      const alertUserId = String(currentAuthUserId || currentAuthUsername || '').trim();
      if (!alertUserId) {
          return;
      }

      const alertSessionKey = getLowStockAlertSessionKey(alertUserId);
      if (sessionStorage.getItem(alertSessionKey) === 'true') {
          return;
      }

      const attentionItems = processedInventory.filter((item) => item.status === 'Low Stock' || item.status === 'Out of Stock');
      sessionStorage.setItem(alertSessionKey, 'true');

      if (attentionItems.length > 0) {
               
               // 1. ALWAYS Show In-App Toast (No permission needed)
               toast.custom((t) => (
                <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} relative w-full max-w-sm pointer-events-auto bg-[#1e1e1e] shadow-2xl rounded-lg ring-1 ring-white/10 overflow-hidden flex items-center p-2 pr-9 gap-3 border border-gray-700/50`}>
                    <button
                      type="button"
                      onClick={() => toast.dismiss(t.id)}
                      className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                      aria-label="Dismiss notification"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12M18 6 6 18" />
                      </svg>
                    </button>
                    {/* Icon Section */}
                    <div className="flex-shrink-0 bg-red-500/10 p-2 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-red-500 animate-pulse">
                            <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                        </svg>
                    </div>

                    {/* Text Section */}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">Low Stock Alert</p>
                        <p className="text-xs text-gray-400">
                            <span className="font-semibold text-red-400">{attentionItems.length} {attentionItems.length === 1 ? 'item' : 'items'}</span> low or out of stock.
                        </p>
                    </div>

                    {/* Button Section - Separate and distinct */}
                    <div className="flex-shrink-0">
                        <button
                          onClick={() => {
                              toast.dismiss(t.id);
                              navigate('/inventory'); // Use React Router navigate
                          }}
                          className="px-4 py-2 bg-white text-black text-xs font-semibold uppercase tracking-wider rounded-md hover:bg-gray-200 transition-colors shadow-lg"
                        >
                          View
                        </button>
                    </div>
                </div>
              ), { duration: 6000 });

              // 2. ALSO Show Desktop Notification (Only if enabled & allowed)
              // Safe check for Notification API existence
              if (appSettings.desktopNotifications && 'Notification' in window && window.Notification && window.Notification.permission === 'granted') {
                 new window.Notification("Inventory Alert!", {
                          body: `You have ${attentionItems.length} ${attentionItems.length === 1 ? 'item that is' : 'items that are'} low or out of stock.`,
                    icon: logo,
                    requireInteraction: true
                 });
              }

      }
  }, [processedInventory, appSettings.desktopNotifications, currentAuthUserId, currentAuthUsername, isPageDataLoading, navigate]);





  // Activity Log Modal State
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [actLogSearch, setActLogSearch] = useState('');
    const [debouncedActLogSearch, setDebouncedActLogSearch] = useState('');
  const [actLogUserFilter, setActLogUserFilter] = useState('All');
  const [actLogActionFilter, setActLogActionFilter] = useState('All');
    const ACTIVITY_LOG_BATCH_SIZE = 15;
    const ACTIVITY_LOG_LOAD_DELAY_MS = 450;
    const [activityLogVisibleCount, setActivityLogVisibleCount] = useState(ACTIVITY_LOG_BATCH_SIZE);
    const [isActivityLogLoadingMore, setIsActivityLogLoadingMore] = useState(false);
    const activityLogScrollContainerRef = React.useRef(null);
    const activityLogLoadMoreTriggerRef = React.useRef(null);
    const activityLogLoadTimerRef = React.useRef(null);
    const isActivityLogLoadInFlightRef = React.useRef(false);

    useEffect(() => {
        if (sessionStorage.getItem(ACTIVITY_LOG_ONE_TIME_RESET_KEY) === 'true') {
            return;
        }

        setActivityLogs([]);
        sessionStorage.setItem(ACTIVITY_LOG_ONE_TIME_RESET_KEY, 'true');
    }, [setActivityLogs]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedActLogSearch(actLogSearch);
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [actLogSearch]);

    const currentBackendUser = React.useMemo(() => {
        if (!Array.isArray(backendUsers) || backendUsers.length === 0) {
            return null;
        }

        if (currentAuthUsername) {
            const exactMatch = backendUsers.find((user) => {
                const username = String(user?.username || '').trim().toLowerCase();
                return username === currentAuthUsername;
            });

            if (exactMatch) {
                return exactMatch;
            }
        }

        return backendUsers.find((user) => {
            const name = String(user?.name || '').trim();
            return name === currentUserName;
        }) || null;
    }, [backendUsers, currentAuthUsername, currentUserName]);

    const selectableActivityUsers = React.useMemo(() => {
        const normalizeName = (value) => String(value || '').trim().toLowerCase();
        const namesFromLogs = [...new Set(activityLogs.map((l) => (l?.user || '').trim()).filter(Boolean))];
        const currentUsers = Array.isArray(backendUsers) ? backendUsers : [];

        const existingNameSet = new Set(currentUsers.map((u) => normalizeName(u?.name)).filter(Boolean));
        const superAdminNames = currentUsers
            .filter((u) => normalizeName(u?.role) === 'superadmin')
            .map((u) => String(u?.name || '').trim())
            .filter(Boolean);
        const configuredAdminName = String(appSettings?.adminDisplayName || '').trim();
        const preferredSuperAdminName =
            superAdminNames.find((name) => normalizeName(name) !== 'admin user')
            || (normalizeName(currentUserName) !== 'admin user' ? String(currentUserName || '').trim() : '')
            || (normalizeName(configuredAdminName) !== 'admin user' ? configuredAdminName : '');

        const normalizedSuperAdminNames = superAdminNames.map((name) => {
            if (normalizeName(name) === 'admin user' && preferredSuperAdminName) {
                return preferredSuperAdminName;
            }
            return name;
        });

        const filteredLogNames = namesFromLogs
            .map((name) => {
                if (normalizeName(name) === 'admin user' && preferredSuperAdminName) {
                    return preferredSuperAdminName;
                }
                return name;
            })
            .filter((name) => {
                const normalized = normalizeName(name);
                return existingNameSet.has(normalized);
            })
            .sort((a, b) => a.localeCompare(b));

        return [...new Set([...normalizedSuperAdminNames, ...filteredLogNames])]
            .filter((name) => normalizeName(name) !== 'admin user')
            .sort((a, b) => a.localeCompare(b));
    }, [activityLogs, currentUserName, appSettings?.adminDisplayName, backendUsers]);

    useEffect(() => {
        if (actLogUserFilter === 'All') return;
        if (!selectableActivityUsers.includes(actLogUserFilter)) {
            setActLogUserFilter('All');
        }
    }, [actLogUserFilter, selectableActivityUsers]);

    const canViewAllActivityLogs = isAdminOrAbove();

    const filteredActivityLogs = React.useMemo(() => {
        let visibleLogs = canViewAllActivityLogs
            ? [...activityLogs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            : activityLogs
                .filter((log) => log.user === currentUserName)
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (actLogUserFilter !== 'All') {
            visibleLogs = visibleLogs.filter((log) => log.user === actLogUserFilter);
        }

        if (actLogActionFilter !== 'All') {
            const actionMap = {
                login: ['logged in', 'logged out'],
                product: ['created product', 'updated product', 'archived product', 'restored product'],
                stock: ['stock in', 'stock out'],
                sale: ['processed sale'],
                user: ['created user', 'updated user', 'archived user', 'restored user'],
                partner: ['added partner', 'updated partner', 'archived partner'],
                settings: ['updated settings'],
            };
            const keywords = actionMap[actLogActionFilter] || [];
            visibleLogs = visibleLogs.filter((log) => {
                const action = (log.action || '').toLowerCase();
                return keywords.some((keyword) => action.includes(keyword));
            });
        }

        if (debouncedActLogSearch.trim()) {
            const query = debouncedActLogSearch.toLowerCase();
            visibleLogs = visibleLogs.filter((log) => (
                (log.user || '').toLowerCase().includes(query)
                || (log.action || '').toLowerCase().includes(query)
                || (log.details || '').toLowerCase().includes(query)
            ));
        }

        return visibleLogs;
    }, [activityLogs, canViewAllActivityLogs, currentUserName, actLogUserFilter, actLogActionFilter, debouncedActLogSearch]);

    const activitySearchSuggestions = React.useMemo(() => {
        const terms = new Set();

        activityLogs.forEach((log) => {
            [log?.user, log?.action, log?.details]
                .forEach((value) => {
                    const text = String(value || '').trim();
                    if (text) {
                        terms.add(text);
                    }
                });
        });

        return Array.from(terms)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .slice(0, 120);
    }, [activityLogs]);

    const visibleActivityLogs = React.useMemo(() => {
        return filteredActivityLogs.slice(0, activityLogVisibleCount);
    }, [filteredActivityLogs, activityLogVisibleCount]);

    const hasMoreActivityLogs = visibleActivityLogs.length < filteredActivityLogs.length;

    const formatActivityLogExact = React.useCallback((ts) => {
        if (!ts) return '';
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return ts;
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }, []);

    const getActivityLogDateGroup = React.useCallback((ts) => {
        if (!ts) return 'Unknown';
        const now = new Date();
        const date = new Date(ts);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const logDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffDays = Math.floor((today - logDay) / 86400000);

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return 'This Week';
        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }, []);

    const getActivityLogActionStyle = React.useCallback((action) => {
        const normalized = (action || '').toLowerCase();
        if (normalized.includes('logged in')) return { bg: 'bg-emerald-50', ring: 'ring-emerald-500/20', text: 'text-emerald-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /> };
        if (normalized.includes('logged out')) return { bg: 'bg-orange-50', ring: 'ring-orange-500/20', text: 'text-orange-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /> };
        if (normalized.includes('created') || normalized.includes('added')) return { bg: 'bg-blue-50', ring: 'ring-blue-500/20', text: 'text-blue-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /> };
        if (normalized.includes('updated') || normalized.includes('settings')) return { bg: 'bg-purple-50', ring: 'ring-purple-500/20', text: 'text-purple-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /> };
        if (normalized.includes('archived')) return { bg: 'bg-orange-50', ring: 'ring-orange-500/20', text: 'text-orange-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M5 7v13h14V7M8 3h8v4H8V3m1 8h6" /> };
        if (normalized.includes('restored')) return { bg: 'bg-teal-50', ring: 'ring-teal-500/20', text: 'text-teal-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /> };
        if (normalized.includes('sale') || normalized.includes('processed')) return { bg: 'bg-amber-50', ring: 'ring-amber-500/20', text: 'text-amber-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /> };
        if (normalized.includes('stock in')) return { bg: 'bg-green-50', ring: 'ring-green-500/20', text: 'text-green-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12" /> };
        if (normalized.includes('stock out')) return { bg: 'bg-rose-50', ring: 'ring-rose-500/20', text: 'text-rose-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" /> };
        return { bg: 'bg-gray-50', ring: 'ring-gray-500/20', text: 'text-gray-500', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> };
    }, []);

    const resetActivityLogLazyLoad = React.useCallback(() => {
        if (activityLogLoadTimerRef.current) {
            window.clearTimeout(activityLogLoadTimerRef.current);
            activityLogLoadTimerRef.current = null;
        }
        isActivityLogLoadInFlightRef.current = false;
        setIsActivityLogLoadingMore(false);
        setActivityLogVisibleCount(ACTIVITY_LOG_BATCH_SIZE);
    }, [ACTIVITY_LOG_BATCH_SIZE]);

    const loadMoreActivityLogs = React.useCallback(() => {
        if (!hasMoreActivityLogs || isActivityLogLoadInFlightRef.current) {
            return;
        }

        isActivityLogLoadInFlightRef.current = true;
        setIsActivityLogLoadingMore(true);

        activityLogLoadTimerRef.current = window.setTimeout(() => {
            setActivityLogVisibleCount((prev) => Math.min(prev + ACTIVITY_LOG_BATCH_SIZE, filteredActivityLogs.length));
            setIsActivityLogLoadingMore(false);
            isActivityLogLoadInFlightRef.current = false;
            activityLogLoadTimerRef.current = null;
        }, ACTIVITY_LOG_LOAD_DELAY_MS);
    }, [hasMoreActivityLogs, ACTIVITY_LOG_BATCH_SIZE, filteredActivityLogs.length]);

    useEffect(() => {
        if (!isActivityLogOpen) {
            return;
        }
        resetActivityLogLazyLoad();
    }, [isActivityLogOpen, resetActivityLogLazyLoad, debouncedActLogSearch, actLogUserFilter, actLogActionFilter]);

    useEffect(() => {
        if (!isActivityLogOpen || !hasMoreActivityLogs) {
            return;
        }

        const root = activityLogScrollContainerRef.current;
        const target = activityLogLoadMoreTriggerRef.current;
        if (!root || !target) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries;
                if (entry?.isIntersecting) {
                    loadMoreActivityLogs();
                }
            },
            {
                root,
                rootMargin: '0px 0px 180px 0px',
                threshold: 0.01,
            }
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, [isActivityLogOpen, hasMoreActivityLogs, loadMoreActivityLogs, visibleActivityLogs.length]);

    useEffect(() => {
        return () => {
            if (activityLogLoadTimerRef.current) {
                window.clearTimeout(activityLogLoadTimerRef.current);
            }
        };
    }, []);
  
  // When activity log is opened, mark notifications as read
  const handleOpenActivityLog = () => {
    setIsActivityLogOpen(true);
    setIsProfileMenuOpen(false);
    setActLogSearch('');
    setActLogUserFilter('All');
    setActLogActionFilter('All');
        resetActivityLogLazyLoad();
  };

    const [readLogCount, setReadLogCount] = useState(0);

        useEffect(() => {
                const nextReadCount = Number(currentBackendUser?.preferences?.readLogCount || 0);
                setReadLogCount(Number.isFinite(nextReadCount) && nextReadCount >= 0 ? nextReadCount : 0);
        }, [currentBackendUser?.preferences?.readLogCount]);

    const relevantLogs = React.useMemo(() => {
        return activityLogs.filter(log => log.user !== currentUserName);
    }, [activityLogs, currentUserName]);

    const unreadActivityCount = Math.max(0, relevantLogs.length - readLogCount);
    const unreadActivityLabel = unreadActivityCount > 99 ? '99+' : String(unreadActivityCount);

  // Effect to update readLogCount when modal opens
  useEffect(() => {
     if (isActivityLogOpen) {
        const relevantLogsCount = activityLogs.filter(log => log.user !== currentUserName).length;
        setReadLogCount(relevantLogsCount);
        updateMyPreferencesApi({
            hasViewedLogs: true,
            readLogCount: relevantLogsCount,
        }).catch(() => {
            // Keep UI state updated even when backend preference write fails.
        });
     }
  }, [isActivityLogOpen, activityLogs, currentUserName]);

  // Desktop Hover State
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);

  // Mobile Menu State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Profile Menu State
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = React.useRef(null);
  
  // Logout Modal State
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  useEffect(() => {
    // Close profile menu when clicking outside
    const handleClickOutside = (event) => {
        if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
            setIsProfileMenuOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const handleLogoutClick = () => {
    setIsProfileMenuOpen(false);
    setIsMobileMenuOpen(false);
    setIsLogoutModalOpen(true);
  };

    const confirmLogout = () => {
    const alertUserId = String(currentAuthUserId || currentAuthUsername || '').trim();
    if (alertUserId) {
      sessionStorage.removeItem(getCreditDueAlertSessionKey(alertUserId));
      sessionStorage.removeItem(getLowStockAlertSessionKey(alertUserId));
    }
    setIsLogoutModalOpen(false);
    onLogout();
  };

  const handleMouseEnter = () => {
    // Only apply hover effect on desktop
    if (window.innerWidth >= 768) {
            setIsSidebarHovered(true);
    }
  };

  const handleMouseLeave = () => {
    if (window.innerWidth >= 768) {
      setIsSidebarHovered(false);
    }
  };

  const menuItems = React.useMemo(() => {
    const allItems = [
    { 
      category: 'General',
      name: 'Dashboard', 
      page: 'Dashboard',
      path: '/dashboard',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
    },
    { 
        category: 'Features',
        name: 'Recommendation',
        page: 'Recommendation',
        path: '/recommendations', 
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
    },
    { 
      category: 'Sales',
      name: 'Point of Sale',
      page: 'POS',
      path: '/pos', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    },
        {
            category: 'Sales',
            name: 'Special Orders',
            page: 'SpecialOrders',
            path: '/special-orders',
            icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9 2 2 4-4" /></svg>
        },
        {
            category: 'Sales',
            name: 'Credit Transactions',
            page: 'CreditTransactions',
            path: '/credit-transactions',
            icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM3 10h18M7 15h4" /></svg>
        },
    { 
      category: 'Inventory',
      name: 'Inventory',
      page: 'Inventory',
      path: '/inventory', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
    },
    { 
      category: 'Inventory',
      name: 'Product Master List',
      page: 'ProductList',
      path: '/product-list', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
    },
    { 
      category: 'Reports',
      name: 'History Logs',
      page: 'History',
      path: '/history', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    },
    { 
      category: 'Reports',
      name: 'Reports',
      page: 'Reports',
      path: '/reports', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
    },
    { 
        category: 'Management',
        name: 'Partners',
        page: 'Partners',
        path: '/partners', 
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    },
    { 
      category: 'Management',
      name: 'User List',
      page: 'UserList',
      path: '/users', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
    },
    { 
      category: 'Management',
      name: 'Settings',
      page: 'Settings',
      path: '/settings', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    },
    // Hidden Menu Item for Profile
    {
        category: 'System',
        name: 'Profile',
        page: 'Profile',
        path: '/profile',
        hidden: true
    }
    ];

    return allItems.filter((item) => canAccess(userRole, item.page));

  }, [userRole]);

    useEffect(() => {
        let isMounted = true;

        const notifyDueSoonCredits = async () => {
            const isAdminViewer = userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN;
            if (!isAdminViewer) {
                return;
            }

            const alertUserId = String(currentAuthUserId || currentAuthUsername || '').trim();
            if (!alertUserId) {
                return;
            }

            const alertSessionKey = getCreditDueAlertSessionKey(alertUserId);
            if (sessionStorage.getItem(alertSessionKey) === 'true') {
                return;
            }

            try {
                const rows = await listCreditTransactionsApi({ status: 'All' });
                if (!isMounted || !Array.isArray(rows)) {
                    return;
                }

                const counts = getCreditDueAlertCounts(rows);
                const attentionCount = counts.overdue + counts.dueToday + counts.nearDue;
                if (attentionCount === 0) {
                    return;
                }

                if (sessionStorage.getItem(alertSessionKey) === 'true') {
                    return;
                }
                sessionStorage.setItem(alertSessionKey, 'true');

                const summary = [
                    counts.overdue ? `${counts.overdue} overdue` : '',
                    counts.dueToday ? `${counts.dueToday} due today` : '',
                    counts.nearDue ? `${counts.nearDue} near due` : '',
                ].filter(Boolean).join(' • ');

                showToast(
                    'Credit Due Alert',
                    summary,
                    'warning',
                    `credit-due-alert-${alertUserId}`,
                    {
                        actionLabel: 'View Credits',
                        onAction: () => navigate('/credit-transactions'),
                    }
                );
            } catch {
                // Keep dashboard load resilient even if credit list fetch fails.
            }
        };

        void notifyDueSoonCredits();

        return () => {
            isMounted = false;
        };
    }, [userRole, currentAuthUserId, currentAuthUsername, navigate]);

    const isFixedLayout = ['Point of Sale', 'History Logs', 'Special Orders', 'Inventory', 'Dashboard', 'Recommendation', 'Partners', 'Reports'].includes(activeMenu);
    const isSidebarExpanded = isSidebarHovered || isMobileMenuOpen;

  return (
    <div className="flex h-screen bg-slate-200/50 flex-col overflow-hidden">
       {/* Logout Confirmation Modal */}
       {isLogoutModalOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity">
            <div className="bg-white rounded-2xl p-6 max-w-sm md:max-w-md w-full shadow-2xl border border-gray-100 transform scale-100 transition-all">
                <div className="text-center">
                    <div className="bg-gray-100 p-3 rounded-full w-14 h-14 mx-auto flex items-center justify-center mb-4">
                        <svg className="w-6 h-6 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2 tracking-tight">Signing Out?</h3>
                    <p className="text-gray-500 text-sm font-medium mb-6 leading-relaxed">Are you sure you want to end your session?</p>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setIsLogoutModalOpen(false)}
                            className="flex-1 py-2 px-4 rounded-lg font-semibold tracking-wider hover:opacity-90 transition-all duration-300 shadow-sm transform hover:-translate-y-0.5 outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 text-sm"
                            style={{ backgroundColor: '#ffffff', color: '#111827', border: '2px solid #111827' }}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={confirmLogout}
                            className="flex-1 py-2 px-4 rounded-lg font-semibold tracking-wider hover:opacity-90 transition-all duration-300 shadow-md transform hover:-translate-y-0.5 outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 text-sm"
                            style={{ backgroundColor: '#111827', color: '#ffffff', border: '2px solid #111827' }}
                        >
                            Yes, Sign Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
       )}
       
       {/* Activity Log Modal */}
       {isActivityLogOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity" onClick={() => setIsActivityLogOpen(false)}>
            <div className="bg-white rounded-2xl p-0 max-w-md md:max-w-lg w-full shadow-2xl border border-gray-100 transform scale-100 transition-all overflow-hidden flex flex-col max-h-[85vh] mx-4" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-4 py-3.5 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-gray-50 to-white shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="bg-gray-900 p-1.5 rounded-lg">
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm text-gray-900 leading-tight">Activity Log</h3>
                            <p className="text-[10px] font-semibold text-gray-400 mt-0.5">{activityLogs.length} total entries</p>
                        </div>
                    </div>
                    <button onClick={() => setIsActivityLogOpen(false)} className="text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 p-1.5 transition-all">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                {/* Search & Filter Bar */}
                <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/50 space-y-2 shrink-0">
                    <div className="relative">
                        <input 
                            type="text" 
                            placeholder="Search by user, action, or details..."
                            value={actLogSearch}
                            list="dashboard-activity-search-suggestions"
                            onChange={(e) => setActLogSearch(e.target.value)}
                            className="w-full pl-8 pr-8 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/5 transition-all placeholder:text-gray-400"
                        />
                        <datalist id="dashboard-activity-search-suggestions">
                            {activitySearchSuggestions.map((term) => (
                                <option key={term} value={term} />
                            ))}
                        </datalist>
                        <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        {actLogSearch && (
                            <button onClick={() => setActLogSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {isAdminOrAbove() && (
                            <select 
                                value={actLogUserFilter} 
                                onChange={(e) => setActLogUserFilter(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white border border-gray-200 focus:border-gray-900 focus:outline-none cursor-pointer transition-all"
                            >
                                <option value="All">All Users</option>
                                {selectableActivityUsers.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        )}
                        <select 
                            value={actLogActionFilter} 
                            onChange={(e) => setActLogActionFilter(e.target.value)}
                            className="flex-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white border border-gray-200 focus:border-gray-900 focus:outline-none cursor-pointer transition-all"
                        >
                            <option value="All">All Actions</option>
                            <option value="login">Login / Logout</option>
                            <option value="product">Products</option>
                            <option value="stock">Stock In / Out</option>
                            <option value="sale">Sales</option>
                            <option value="user">Users</option>
                            <option value="partner">Partners</option>
                            <option value="settings">Settings</option>
                        </select>
                    </div>
                    {/* Active filters indicator */}
                    {(actLogSearch || actLogUserFilter !== 'All' || actLogActionFilter !== 'All') && (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {actLogUserFilter !== 'All' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[10px] font-semibold">
                                        {actLogUserFilter}
                                        <button onClick={() => setActLogUserFilter('All')} className="hover:text-gray-300 transition-colors"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    </span>
                                )}
                                {actLogActionFilter !== 'All' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[10px] font-semibold">
                                        {actLogActionFilter}
                                        <button onClick={() => setActLogActionFilter('All')} className="hover:text-gray-300 transition-colors"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    </span>
                                )}
                                {actLogSearch && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[10px] font-semibold">
                                        "{actLogSearch}"
                                        <button onClick={() => setActLogSearch('')} className="hover:text-gray-300 transition-colors"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    </span>
                                )}
                            </div>
                            <button onClick={() => { setActLogSearch(''); setActLogUserFilter('All'); setActLogActionFilter('All'); }} className="text-[10px] font-semibold text-gray-400 hover:text-gray-600 transition-colors">
                                Clear filters
                            </button>
                        </div>
                    )}
                </div>
                {/* Log Content */}
                <div ref={activityLogScrollContainerRef} className="overflow-y-auto flex-1">
                    {filteredActivityLogs.length === 0 ? (
                        <div className="p-10 text-center">
                            <div className="bg-gray-100 rounded-2xl p-4 w-fit mx-auto mb-3">
                                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </div>
                            <p className="text-sm font-semibold text-gray-900">{actLogSearch || actLogUserFilter !== 'All' || actLogActionFilter !== 'All' ? 'No matching logs' : 'No activity recorded'}</p>
                            <p className="text-xs font-medium text-gray-400 mt-1">{actLogSearch || actLogUserFilter !== 'All' || actLogActionFilter !== 'All' ? 'Try adjusting your search or filters' : 'Activity will appear here as actions are performed'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {(() => {
                                let lastGroup = '';
                                return visibleActivityLogs.map((log) => {
                                    const group = getActivityLogDateGroup(log.timestamp);
                                    const showGroup = group !== lastGroup;
                                    lastGroup = group;
                                    const style = getActivityLogActionStyle(log.action);

                                    return (
                                        <React.Fragment key={log.id}>
                                            {showGroup && (
                                                <div className="px-4 py-2 bg-gray-50/80 sticky top-0 z-10 border-b border-gray-100">
                                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{group}</p>
                                                </div>
                                            )}
                                            <div className="px-4 py-2.5 hover:bg-gray-50/80 transition-colors flex items-center gap-3 group">
                                                <div className={`${style.bg} ring-1 ${style.ring} p-2 rounded-xl shrink-0`}>
                                                    <svg className={`w-3.5 h-3.5 ${style.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">{style.icon}</svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-center gap-2">
                                                        <p className="text-xs font-semibold text-gray-900 truncate">{getActorDisplayName(log.userRef, log.user)}</p>
                                                        <span className="text-[10px] font-semibold text-gray-400 whitespace-nowrap tabular-nums">{formatActivityLogExact(log.timestamp)}</span>
                                                    </div>
                                                    <p className="text-[11px] font-semibold text-gray-600 mt-0.5">{log.action}</p>
                                                    {log.details && <p className="text-[10px] text-gray-400 font-medium mt-0.5 truncate">{log.details}</p>}
                                                </div>
                                            </div>
                                        </React.Fragment>
                                    );
                                });
                            })()}

                            {hasMoreActivityLogs && (
                                <div ref={activityLogLoadMoreTriggerRef} className="px-4 py-3 flex items-center justify-center bg-white">
                                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-gray-500">
                                        <svg className={`w-4 h-4 text-gray-400 ${isActivityLogLoadingMore ? 'animate-spin' : 'animate-pulse'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 12a8 8 0 018-8m8 8a8 8 0 01-8 8" />
                                        </svg>
                                        Loading more activity...
                                    </div>
                                </div>
                            )}

                            {!hasMoreActivityLogs && filteredActivityLogs.length > ACTIVITY_LOG_BATCH_SIZE && (
                                <div className="px-4 py-3 text-center bg-white">
                                    <p className="text-[11px] font-semibold text-gray-400">No more activity logs</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {/* Footer */}
                <div className="p-3 bg-gray-50 border-t border-gray-100 shrink-0">
                    <button 
                        onClick={() => setIsActivityLogOpen(false)}
                        className="w-full py-2 rounded-xl font-semibold tracking-wider hover:opacity-90 transition-all shadow-sm text-xs"
                        style={{ backgroundColor: '#111827', color: '#ffffff' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
       )}

       {/* Top Header - Fixed and Full Width */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between border-b border-gray-800 bg-[#111827] px-3 shadow-md sm:px-4">
         <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {/* Mobile Menu Button */}
            <button 
                className="h-10 w-10 md:hidden text-gray-300 hover:text-white focus:outline-none"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>

            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <img src={logo} alt="TLC Logo" className="h-7 w-7 shrink-0 rounded-full border border-white/20 object-contain sm:h-10 sm:w-10 sm:border-2" />
              <div className="flex min-w-0 flex-col">
                <span className="whitespace-nowrap text-[11px] font-semibold leading-[1.15] tracking-tight text-white min-[375px]:text-xs sm:text-sm">Tableria La Confianza</span>
                <span className="whitespace-nowrap text-[10px] font-medium leading-[1.15] text-gray-300 sm:text-sm sm:text-white">Company, Incorporated</span>
              </div>
            </div>
         </div>
         <div className="flex shrink-0 items-center gap-2 sm:gap-4">
             {/* Date and Time */}
             <div className="hidden md:block">
                 <DateTimeDisplay className="text-right block" dateClassName="text-gray-200" timeClassName="text-gray-400" />
             </div>

             <div className="h-8 w-px bg-gray-700 hidden md:block"></div>

             {/* User Info Dropdown */}
             <div className="relative" ref={profileMenuRef}>
                 <button 
                    onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    className="flex items-center space-x-3 p-1 rounded-full transition-colors outline-none !bg-white/10 backdrop-blur-md !border-white/10 hover:!bg-white/20 pr-1 shadow-sm"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)', borderColor: 'rgba(255, 255, 255, 0.1)' }}
                 >
                     <div className="text-right hidden sm:block pl-3">
                        <p className="text-xs font-semibold text-white transition-colors">
                            {currentUserName}
                        </p>
                        <p className="text-[10px] text-gray-300 font-medium transition-colors">
                            {roleNames[userRole] || 'User'}
                        </p>
                    </div>
                    <div className="relative shrink-0">
                        <div className="rounded-full bg-linear-to-br from-white/80 via-white/40 to-white/20 p-[1.5px] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.65)]">
                            <div className="h-9 w-9 rounded-full bg-[#111827] p-[1.5px]">
                                <div className="h-full w-full rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold border border-white/20 overflow-hidden">
                                    {currentUserAvatar ? (
                                        <img src={currentUserAvatar} alt="User Info" className="w-full h-full object-cover rounded-full" />
                                    ) : (
                                        <span>{currentUserName ? currentUserName.charAt(0).toUpperCase() : 'U'}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {isAdminOrAbove() && unreadActivityCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-[#111827] shadow-[0_4px_10px_-2px_rgba(239,68,68,0.9)]" />
                        )}
                    </div>
                </button>


                {/* Dropdown Menu */}
                {isProfileMenuOpen && (
                    <div className="account-menu absolute right-0 mt-3 w-56 backdrop-blur-xl border rounded-2xl py-1 z-50 transform origin-top-right transition-all duration-200 animate-in fade-in zoom-in-95">
                        {/* Header Section */}
                        <div className="account-menu-header px-3 py-3 border-b">
                             <p className="account-menu-eyebrow text-[10px] font-semibold uppercase tracking-widest leading-none mb-1.5 ml-1">Signed in as</p>
                             <div className="account-menu-summary rounded-xl p-2 flex items-center gap-3 border">
                                 <div className="rounded-full bg-linear-to-br from-white/30 via-gray-300/20 to-transparent p-[1.5px] shrink-0">
                                    <div className="account-menu-avatar-ring h-8 w-8 rounded-full p-[1.5px]">
                                        <div className="account-menu-avatar h-full w-full rounded-full flex items-center justify-center font-semibold text-xs border overflow-hidden">
                                            {currentUserAvatar ? (
                                                <img src={currentUserAvatar} alt="User" className="w-full h-full object-cover rounded-full" />
                                            ) : (
                                                <span>{currentUserName ? currentUserName.charAt(0).toUpperCase() : 'U'}</span>
                                            )}
                                        </div>
                                    </div>
                                 </div>
                                 <div className="overflow-hidden">
                                     <p className="account-menu-primary text-xs font-semibold truncate leading-tight mb-0.5">
                                         {roleNames[userRole] || 'User'}
                                     </p>
                                     <div className="flex items-center gap-1.5">
                                         <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                         <p className="account-menu-secondary text-[10px] font-medium">{currentUserName}</p>
                                     </div>
                                 </div>
                             </div>
                        </div>

                        {/* Menu Items */}
                        <div className="p-1.5 space-y-0.5">
                            <button onClick={() => { handleNavigation('/profile'); setIsProfileMenuOpen(false); }} className="account-menu-item w-full text-left px-2.5 py-2 text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors group">
                                <div className="account-menu-icon p-1 rounded-lg transition-colors">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                </div>
                                <span className="flex-1">My Profile</span>
                                <svg className="account-menu-chevron w-3 h-3 transition-all group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                            </button>
                            
                            <button onClick={handleOpenActivityLog} className="account-menu-item w-full text-left px-2.5 py-2 text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors group relative">
                                <div className="account-menu-icon p-1 rounded-lg transition-colors">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                </div>
                                Activity Log
                                {isAdminOrAbove() && unreadActivityCount > 0 && (
                                    <span className="ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border border-rose-200/80 bg-rose-100 px-1.5 text-[10px] font-semibold leading-none tabular-nums text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/50 dark:text-rose-300">
                                        {unreadActivityLabel}
                                    </span>
                                )}
                            </button>

                            <div className="account-menu-item w-full text-left px-2.5 py-2 text-xs font-semibold rounded-xl flex items-center justify-between transition-colors group cursor-pointer" onClick={(e) => { e.stopPropagation(); setIsDarkMode(!isDarkMode); }}>
                                <div className="flex items-center gap-2.5">
                                    <div className="account-menu-icon p-1 rounded-lg transition-colors">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                                    </div>
                                    Dark Mode
                                </div>
                                <button 
                                    className={`account-theme-toggle w-8 h-4.5 rounded-full p-0.5 transition-colors duration-300 focus:outline-none ${isDarkMode ? 'account-theme-toggle-on' : ''}`}
                                >
                                    <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center ${isDarkMode ? 'translate-x-[14px]' : 'translate-x-0'}`}>
                                        {isDarkMode && <div className="w-1 h-1 rounded-full bg-indigo-600/20"></div>}
                                    </div>
                                </button>
                            </div>
                        </div>

                        <div className="account-menu-divider border-t my-1 mx-3"></div>

                        <div className="p-1.5">
                            <button 
                                onClick={handleLogoutClick}
                                className="account-menu-signout w-full text-left px-2.5 py-2 text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors group"
                            >
                                <div className="account-menu-signout-icon p-1.5 rounded-lg transition-colors">
                                    <SignOutIcon />
                                </div>
                                <span className="flex-1">Sign Out</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
         </div>
      </header>



      {/* Main Layout Wrapper */}
      <div className="flex flex-1 w-full pt-16 h-screen overflow-hidden">
        
        {/* Mobile Backdrop */}
        {isMobileMenuOpen && (
            <div 
                className="fixed inset-0 bg-black/50 z-30 md:hidden"
                onClick={() => setIsMobileMenuOpen(false)}
            />
        )}

        {/* Sidebar - Responsive */}
        <aside 
          className={`
                        fixed top-16 bottom-0 left-0 z-40 bg-[#111827] flex flex-col transform-gpu
                        transition-[width,transform] duration-420 ease-[cubic-bezier(0.16,1,0.3,1)]
            md:translate-x-0 
            ${isMobileMenuOpen ? 'translate-x-0 w-56' : '-translate-x-full w-56'} 
                        ${isSidebarHovered ? 'md:w-[13.5rem]' : 'md:w-16'}
          `}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          
                      <nav className={`flex-1 overflow-y-auto scrollbar-hide overflow-x-hidden transition-[padding] duration-420 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarExpanded ? 'pb-3 pt-3' : 'pb-4 pt-4'}`}>
            <ul className={isSidebarExpanded ? 'space-y-px px-2' : 'space-y-0.5 px-2.5'}>
              {menuItems.map((item, index) => {
                 if (item.hidden) return null; // Skip hidden items from sidebar
                 const prevCategory = index > 0 ? menuItems[index - 1].category : null;
                 const showHeader = item.category !== prevCategory;
                 const isActive = activeMenu === item.name;
                        
                 return (
                    <React.Fragment key={item.name}>
                        {showHeader && isSidebarExpanded && (
                            <li className="mt-3 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.11em] text-gray-400 first:mt-0.5 transition-opacity duration-300">
                                {item.category}
                            </li>
                        )}
                        <li>
                        <button
                            onClick={() => {
                                handleNavigation(item.path);
                                setIsMobileMenuOpen(false);
                            }}
                            className={`group relative flex w-full items-center rounded-lg border text-sm font-medium leading-none outline-none transition-[background-color,border-color,color] duration-200 ease-in-out ${isSidebarExpanded ? 'h-9 gap-2 px-2' : 'h-10 justify-center px-0'} ${
                            isActive
                                ? 'border-slate-700/70 bg-slate-800/60 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-sm before:bg-[#FC0D2C]'
                                : 'border-transparent text-gray-300 hover:border-slate-700/70 hover:bg-slate-800/60 hover:text-white'
                            }`}
                            title={!isSidebarExpanded ? item.name : ''}
                        >
                            <span className={`relative z-10 shrink-0 transition-colors duration-200 [&>svg]:h-[18px] [&>svg]:w-[18px] ${isActive ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>
                            {item.icon}
                            </span>
                            <span className={`relative z-10 whitespace-nowrap overflow-hidden transform transition-[max-width,opacity,transform] duration-340 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarExpanded ? 'opacity-100 translate-x-0 max-w-44 delay-100' : 'opacity-0 -translate-x-2 max-w-0 delay-0'} ${!isActive ? 'group-hover:translate-x-0.5' : ''}`}>
                                {item.name}
                            </span>
                        </button>
                        </li>
                    </React.Fragment>
                 );
              })}
            </ul>
          </nav>

          <div className={`border-t border-gray-800 bg-[#111827] ${isSidebarExpanded ? 'p-2' : 'p-2.5'}`}>
             <button
               onClick={handleLogoutClick}
                                                             className={`flex w-full items-center rounded-lg text-sm font-medium text-gray-300 transition-colors duration-200 hover:bg-red-500/10 hover:text-red-400 ${isSidebarExpanded ? 'h-9 gap-2.5 px-2' : 'h-10 justify-center px-0'}`}
                             title={!isSidebarExpanded ? "Sign Out" : ""}
             >
               <SignOutIcon />
                               <span className={`whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-340 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarExpanded ? 'opacity-100 max-w-30 delay-100' : 'opacity-0 max-w-0 delay-0'}`}>Sign Out</span>
             </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className={`flex-1 bg-slate-200/50 ml-0 transition-[margin] duration-420 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarHovered ? 'md:ml-[13.5rem]' : 'md:ml-16'} ${isProfilePage ? 'p-2 overflow-hidden h-full' : isFixedLayout ? 'p-2 md:overflow-hidden h-full overflow-y-auto' : 'p-2 overflow-y-auto h-full'}`}>
           <div className={`w-full ${isFixedLayout || activeMenu === 'Credit Transactions' ? 'md:h-full min-h-full' : ''}`}>
             
                 {isRouteContentLoading ? (
                     <PageSkeleton />
                 ) : (
                 <Suspense fallback={<PageSkeleton />}>
                 <AnimatePresence mode="wait">
                 <Routes location={location} key={location.pathname}>
                {/* Public / Common Routes */}
                <Route index element={<RequirePageAccess userRole={userRole} page="Dashboard"><AnimatedPage><DashboardHome onViewAllProducts={() => handleNavigation('/product-list')} onNavigate={(menu) => {
                    if (menu === 'Product Master List') handleNavigation('/product-list');
                    else if (menu === 'Dashboard') handleNavigation('/dashboard');
                    else if (menu === 'History Logs') handleNavigation('/history');
                    else if (menu === 'Inventory') handleNavigation('/inventory');
                    else if (menu === 'Reports') handleNavigation('/reports');
                    else if (menu === 'Credit Transactions') handleNavigation('/credit-transactions');
                }} /></AnimatedPage></RequirePageAccess>} />
                <Route path="dashboard" element={<RequirePageAccess userRole={userRole} page="Dashboard"><AnimatedPage><DashboardHome onViewAllProducts={() => handleNavigation('/product-list')} onNavigate={(menu) => {
                    // Map menu names to paths
                     if (menu === 'Product Master List') handleNavigation('/product-list');
                     else if (menu === 'Dashboard') handleNavigation('/dashboard');
                     else if (menu === 'History Logs') handleNavigation('/history');
                     else if (menu === 'Inventory') handleNavigation('/inventory');
                     else if (menu === 'Reports') handleNavigation('/reports');
                     else if (menu === 'Credit Transactions') handleNavigation('/credit-transactions');
                }} /></AnimatedPage></RequirePageAccess>} />
                
                <Route path="pos" element={<RequirePageAccess userRole={userRole} page="POS"><AnimatedPage><PointOfSale /></AnimatedPage></RequirePageAccess>} />
                
                <Route path="product-list" element={<RequirePageAccess userRole={userRole} page="ProductList"><AnimatedPage><ProductList /></AnimatedPage></RequirePageAccess>} />
                
                <Route path="history" element={<RequirePageAccess userRole={userRole} page="History"><AnimatedPage><History /></AnimatedPage></RequirePageAccess>} />
                <Route path="special-orders" element={<RequirePageAccess userRole={userRole} page="SpecialOrders"><AnimatedPage><SpecialOrders /></AnimatedPage></RequirePageAccess>} />
                <Route path="credit-transactions" element={<RequirePageAccess userRole={userRole} page="CreditTransactions"><AnimatedPage allowPageScroll><CreditTransactions /></AnimatedPage></RequirePageAccess>} />
                
                <Route path="profile" element={<RequirePageAccess userRole={userRole} page="Profile"><AnimatedPage><Profile /></AnimatedPage></RequirePageAccess>} />
                
                {/* Restricted Routes */}
                <Route path="inventory" element={<RequirePageAccess userRole={userRole} page="Inventory"><AnimatedPage><Inventory /></AnimatedPage></RequirePageAccess>} />
                <Route path="users" element={<RequirePageAccess userRole={userRole} page="UserList"><AnimatedPage><UserList /></AnimatedPage></RequirePageAccess>} />
                <Route path="reports" element={<RequirePageAccess userRole={userRole} page="Reports"><AnimatedPage><Reports /></AnimatedPage></RequirePageAccess>} />
                <Route path="recommendations" element={<RequirePageAccess userRole={userRole} page="Recommendation"><AnimatedPage><Recommendation /></AnimatedPage></RequirePageAccess>} />
                <Route path="partners" element={<RequirePageAccess userRole={userRole} page="Partners"><AnimatedPage><Partners viewOnly={userRole === ROLES.ADMIN} /></AnimatedPage></RequirePageAccess>} />
                <Route path="settings" element={<RequirePageAccess userRole={userRole} page="Settings"><AnimatedPage><Settings /></AnimatedPage></RequirePageAccess>} />
                
                {/* Fallback */}
                <Route path="*" element={<AnimatedPage><div className="flex flex-col items-center justify-center p-10 mt-10 text-gray-400">
                    <h1 className="text-6xl font-semibold text-gray-200">404</h1>
                    <p className="text-xl font-semibold mt-2">Page Not Found</p>
                    <button onClick={() => navigate('/dashboard')} className="mt-6 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">Go Home</button>
                </div></AnimatedPage>} />
             </Routes>
             </AnimatePresence>
             </Suspense>
                         )}

           </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
