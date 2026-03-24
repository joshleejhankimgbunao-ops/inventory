import React, { useState, useEffect, Suspense, lazy } from 'react';
import { toast } from 'react-hot-toast';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { getLowStockThreshold } from '../utils/recommendationLogic';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import { ROLES } from '../constants/roles';
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
  ];
  pages.forEach(load => load());
};



const RequireAdmin = ({ userRole, children }) => {
    // only the single super admin may pass this guard
    if (userRole !== ROLES.SUPER_ADMIN) {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
};

const Dashboard = ({ onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const activeMenu = React.useMemo(() => {
    const path = location.pathname;
    if (path === '/' || path === '/dashboard' || path === '/dashboard/') return 'Dashboard';
    if (path.startsWith('/pos')) return 'Point of Sale';
    if (path.startsWith('/inventory')) return 'Inventory';
    if (path.startsWith('/product-list')) return 'Product List';
    if (path.startsWith('/partners')) return 'Partners';
    if (path.startsWith('/reports')) return 'Reports';
    if (path.startsWith('/recommendations')) return 'Recommendation';
    if (path.startsWith('/users')) return 'User List';
    if (path.startsWith('/history')) return 'History Logs';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/profile')) return 'Profile';
    return 'Dashboard';
  }, [location.pathname]);

  // Handle Navigation and Close Menu
  const handleNavigation = (menuName, path) => {
      // Force update location and state
      navigate(path);
      // We don't need to manually set activeMenu because it is derived from location.pathname
  };

  const { userRole, appSettings, updateSettings, currentUserName, isDarkMode, setIsDarkMode, isAdminOrAbove, roleNames, currentUserAvatar } = useAuth();
  // we rely on the context's currentUserAvatar which already handles
  // super‑admin/appSettings and any avatar stored on a user record.
  const { 
    activityLogs, setActivityLogs, logActivity,
    processedInventory, 
    renameUserReferences
  } = useInventory();

  const handleUpdateSettings = (newSettings) => {
    if (newSettings.adminDisplayName !== appSettings.adminDisplayName) {
        renameUserReferences(appSettings.adminDisplayName, newSettings.adminDisplayName);
    }
    updateSettings(newSettings);
  };
  
  // Track if user has viewed activity logs to clear notification badge
  const [hasViewedLogs, setHasViewedLogs] = useState(() => {
    return localStorage.getItem('hasViewedLogs') === 'true';
  });
  
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
    if (appSettings.desktopNotifications && 'Notification' in window && Notification.permission === 'default') {
        const toastId = toast((t) => ( 
            <div className="flex flex-col gap-2 min-w-[200px]">
                <span className="font-bold text-sm">Enable Desktop Alerts?</span>
                <span className="text-xs text-gray-500">Get notified when stock is low.</span>
                <div className="flex gap-2 text-xs font-bold mt-1">
                    <button 
                        onClick={() => {
                            toast.dismiss(t.id);
                            Notification.requestPermission().then(perm => {
                                if (perm === 'granted') {
                                    new Notification("Notifications Enabled", { body: "You will now receive stock alerts." });
                                }
                            });
                        }}
                        className="bg-white border-2 border-gray-200 text-gray-900 font-black px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
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



  // Trigger Notification when Critical Items are found
  useEffect(() => {
      // Check for critical items based on app settings or default 0
      const criticalItems = processedInventory.filter(item => item.status === 'Critical');
      
      if (criticalItems.length > 0) {
          // Unique key for session debounce
          const notifiedKey = `notified_critical_${criticalItems.length}_${new Date().getHours()}`;
          
          if (!sessionStorage.getItem(notifiedKey)) {
              
              // 1. ALWAYS Show In-App Toast (No permission needed)
              toast.custom((t) => (
                <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} w-full max-w-sm pointer-events-auto bg-[#1e1e1e] shadow-2xl rounded-lg ring-1 ring-white/10 overflow-hidden flex items-center p-2 gap-3 border border-gray-700/50`}>
                    {/* Icon Section */}
                    <div className="flex-shrink-0 bg-red-500/10 p-2 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-red-500 animate-pulse">
                            <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                        </svg>
                    </div>

                    {/* Text Section */}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">Low Stock Alert</p>
                        <p className="text-xs text-gray-400">
                            <span className="font-bold text-red-400">{criticalItems.length} {criticalItems.length === 1 ? 'item' : 'items'}</span> critical.
                        </p>
                    </div>

                    {/* Button Section - Separate and distinct */}
                    <div className="flex-shrink-0">
                        <button
                          onClick={() => {
                              toast.dismiss(t.id);
                              navigate('/inventory'); // Use React Router navigate
                          }}
                          className="px-4 py-2 bg-white text-black text-xs font-black uppercase tracking-wider rounded-md hover:bg-gray-200 transition-colors shadow-lg"
                        >
                          View
                        </button>
                    </div>
                </div>
              ), { duration: 6000 });

              // 2. ALSO Show Desktop Notification (Only if enabled & allowed)
              if (appSettings.desktopNotifications && Notification.permission === 'granted') {
                 new Notification("Inventory Alert!", {
                    body: `You have ${criticalItems.length} ${criticalItems.length === 1 ? 'item that is' : 'items that are'} low on stock.`,
                    icon: logo,
                    requireInteraction: true
                 });
              }

              // Mark as notified for this hour/count
              sessionStorage.setItem(notifiedKey, 'true');
          }
      }
  }, [processedInventory, appSettings.desktopNotifications]);





  // Activity Log Modal State
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [actLogSearch, setActLogSearch] = useState('');
  const [actLogUserFilter, setActLogUserFilter] = useState('All');
  const [actLogActionFilter, setActLogActionFilter] = useState('All');
  
  // When activity log is opened, mark notifications as read
  const handleOpenActivityLog = () => {
    setIsActivityLogOpen(true);
    setIsProfileMenuOpen(false);
    setActLogSearch('');
    setActLogUserFilter('All');
    setActLogActionFilter('All');
    
    // Calculate current relevant logs count and save as "read" count
    const relevantLogsCount = activityLogs.filter(log => log.user !== currentUserName).length;
    localStorage.setItem('readLogCount', relevantLogsCount.toString());
    
    // Also trigger UI update
    setHasViewedLogs(true); // Using this as a trigger to re-render, though we'll use the count for logic
  };

  // Get read count on init
  const [readLogCount, setReadLogCount] = useState(() => {
     return parseInt(localStorage.getItem('readLogCount') || '0');
  });

  // Effect to update readLogCount when modal opens
  useEffect(() => {
     if (isActivityLogOpen) {
        const relevantLogsCount = activityLogs.filter(log => log.user !== currentUserName).length;
        setReadLogCount(relevantLogsCount);
        localStorage.setItem('readLogCount', relevantLogsCount.toString());
     }
  }, [isActivityLogOpen, activityLogs, currentUserName]);

  // Desktop Hover State
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const hoverTimeoutRef = React.useRef(null);

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
    // Log the logout activity
    logActivity(currentUserName, 'Logged Out');
    setIsLogoutModalOpen(false);
    onLogout();
  };

  const handleMouseEnter = () => {
    // Only apply hover effect on desktop
    if (window.innerWidth >= 768) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = setTimeout(() => {
        setIsSidebarHovered(true);
      }, 150);
    }
  };

  const handleMouseLeave = () => {
    if (window.innerWidth >= 768) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      setIsSidebarHovered(false);
    }
  };

  // Close mobile menu when selecting an item
  const handleMenuClick = (menuName) => {
    // setActiveMenu is removed, rely on URL
    setIsMobileMenuOpen(false);
  };



  const menuItems = React.useMemo(() => {
    const allItems = [
    { 
      category: 'General',
      name: 'Dashboard', 
      path: '/dashboard',
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
    },
    { 
        category: 'Features',
        name: 'Recommendation',
        path: '/recommendations', 
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
    },
    { 
      category: 'Sales',
      name: 'Point of Sale',
      path: '/pos', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    },
    { 
      category: 'Sales',
      name: 'History Logs',
      path: '/history', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    },
    { 
      category: 'Inventory',
      name: 'Inventory',
      path: '/inventory', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
    },
    { 
      category: 'Inventory',
      name: 'Product List',
      path: '/product-list', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
    },
    { 
      category: 'Analytics',
      name: 'Reports',
      path: '/reports', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
    },
    { 
        category: 'Management',
        name: 'Partners',
        path: '/partners', 
        icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    },
    { 
      category: 'Management',
      name: 'User List',
      path: '/users', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
    },
    { 
      category: 'Management',
      name: 'Settings',
      path: '/settings', 
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    },
    // Hidden Menu Item for Profile
    {
        category: 'System',
        name: 'Profile',
        path: '/profile',
        hidden: true
    }
    ];

    if (userRole === ROLES.CASHIER) {
       // cashiers get sales interface plus history
       const allowed = ['Dashboard', 'Point of Sale', 'Product List', 'History Logs', 'Profile'];
       return allItems.filter(item => allowed.includes(item.name));
    }

    if (userRole === ROLES.ADMIN) {
       // admin may now also use the point‑of‑sale module and view transaction history
         const allowed = ['Dashboard','Recommendation','Inventory','Product List','Reports','Partners','Point of Sale','History Logs','Profile'];
       return allItems.filter(item => allowed.includes(item.name));
    }

    return allItems; // super admin sees everything

  }, [userRole]);

  const isFixedLayout = ['Point of Sale', 'History Logs', 'Inventory', 'Dashboard', 'Recommendation', 'Partners'].includes(activeMenu);

  return (
    <div className="flex h-screen bg-gray-50 flex-col overflow-hidden">
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
                    <h3 className="text-xl font-black text-gray-900 mb-2 tracking-tight">Signing Out?</h3>
                    <p className="text-gray-500 text-sm font-medium mb-6 leading-relaxed">Are you sure you want to end your session?</p>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setIsLogoutModalOpen(false)}
                            className="flex-1 py-2 px-4 rounded-lg font-bold uppercase tracking-wider hover:opacity-90 transition-all duration-300 shadow-sm transform hover:-translate-y-0.5 outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 text-sm"
                            style={{ backgroundColor: '#ffffff', color: '#111827', border: '2px solid #111827' }}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={confirmLogout}
                            className="flex-1 py-2 px-4 rounded-lg font-bold uppercase tracking-wider hover:opacity-90 transition-all duration-300 shadow-md transform hover:-translate-y-0.5 outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 text-sm"
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
                            <h3 className="font-black text-sm text-gray-900 leading-tight">Activity Log</h3>
                            <p className="text-[10px] font-bold text-gray-400 mt-0.5">{activityLogs.length} total entries</p>
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
                            onChange={(e) => setActLogSearch(e.target.value)}
                            className="w-full pl-8 pr-8 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/5 transition-all placeholder:text-gray-400"
                        />
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
                                className="flex-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white border border-gray-200 focus:border-gray-900 focus:outline-none cursor-pointer transition-all"
                            >
                                <option value="All">All Users</option>
                                {[...new Set(activityLogs.map(l => l.user))].sort().map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        )}
                        <select 
                            value={actLogActionFilter} 
                            onChange={(e) => setActLogActionFilter(e.target.value)}
                            className="flex-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white border border-gray-200 focus:border-gray-900 focus:outline-none cursor-pointer transition-all"
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
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[10px] font-bold">
                                        {actLogUserFilter}
                                        <button onClick={() => setActLogUserFilter('All')} className="hover:text-gray-300 transition-colors"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    </span>
                                )}
                                {actLogActionFilter !== 'All' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[10px] font-bold">
                                        {actLogActionFilter}
                                        <button onClick={() => setActLogActionFilter('All')} className="hover:text-gray-300 transition-colors"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    </span>
                                )}
                                {actLogSearch && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[10px] font-bold">
                                        "{actLogSearch}"
                                        <button onClick={() => setActLogSearch('')} className="hover:text-gray-300 transition-colors"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                    </span>
                                )}
                            </div>
                            <button onClick={() => { setActLogSearch(''); setActLogUserFilter('All'); setActLogActionFilter('All'); }} className="text-[10px] font-bold text-gray-400 hover:text-gray-600 transition-colors">
                                Clear filters
                            </button>
                        </div>
                    )}
                </div>
                {/* Log Content */}
                <div className="overflow-y-auto flex-1">
                    {(() => {
                        // Admin sees ALL logs. Cashier sees ONLY their own logs.
                        let visibleLogs = isAdminOrAbove() 
                            ? [...activityLogs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                            : activityLogs.filter(log => log.user === currentUserName).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                        // Apply user filter
                        if (actLogUserFilter !== 'All') {
                            visibleLogs = visibleLogs.filter(log => log.user === actLogUserFilter);
                        }

                        // Apply action type filter
                        if (actLogActionFilter !== 'All') {
                            const actionMap = {
                                login: ['logged in', 'logged out'],
                                product: ['created product', 'updated product', 'archived product', 'restored product'],
                                stock: ['stock in', 'stock out'],
                                sale: ['processed sale'],
                                user: ['created user', 'updated user', 'archived user', 'restored user'],
                                partner: ['added partner', 'updated partner', 'archived partner'],
                                settings: ['updated settings']
                            };
                            const keywords = actionMap[actLogActionFilter] || [];
                            visibleLogs = visibleLogs.filter(log => {
                                const a = (log.action || '').toLowerCase();
                                return keywords.some(k => a.includes(k));
                            });
                        }

                        // Apply search
                        if (actLogSearch.trim()) {
                            const q = actLogSearch.toLowerCase();
                            visibleLogs = visibleLogs.filter(log => 
                                (log.user || '').toLowerCase().includes(q) ||
                                (log.action || '').toLowerCase().includes(q) ||
                                (log.details || '').toLowerCase().includes(q)
                            );
                        }

                        // Relative time helper
                        const getRelativeTime = (ts) => {
                            if (!ts) return '';
                            const diff = Date.now() - ts;
                            const mins = Math.floor(diff / 60000);
                            if (mins < 1) return 'Just now';
                            if (mins < 60) return `${mins}m ago`;
                            const hrs = Math.floor(mins / 60);
                            if (hrs < 24) return `${hrs}h ago`;
                            const days = Math.floor(hrs / 24);
                            if (days === 1) return 'Yesterday';
                            if (days < 7) return `${days}d ago`;
                            return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        };

                        // Exact local date/time formatter for activity log
                        const formatExact = (ts) => {
                            if (!ts) return '';
                            const d = new Date(ts);
                            if (Number.isNaN(d.getTime())) return ts;
                            return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        };

                        // Date group helper
                        const getDateGroup = (ts) => {
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
                        };

                        // Action style helper
                        const getActionStyle = (action) => {
                            const a = (action || '').toLowerCase();
                            if (a.includes('logged in')) return { bg: 'bg-emerald-50', ring: 'ring-emerald-500/20', text: 'text-emerald-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /> };
                            if (a.includes('logged out')) return { bg: 'bg-orange-50', ring: 'ring-orange-500/20', text: 'text-orange-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /> };
                            if (a.includes('created') || a.includes('added')) return { bg: 'bg-blue-50', ring: 'ring-blue-500/20', text: 'text-blue-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /> };
                            if (a.includes('updated') || a.includes('settings')) return { bg: 'bg-purple-50', ring: 'ring-purple-500/20', text: 'text-purple-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /> };
                            if (a.includes('archived')) return { bg: 'bg-red-50', ring: 'ring-red-500/20', text: 'text-red-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /> };
                            if (a.includes('restored')) return { bg: 'bg-teal-50', ring: 'ring-teal-500/20', text: 'text-teal-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /> };
                            if (a.includes('sale') || a.includes('processed')) return { bg: 'bg-amber-50', ring: 'ring-amber-500/20', text: 'text-amber-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /> };
                            if (a.includes('stock in')) return { bg: 'bg-green-50', ring: 'ring-green-500/20', text: 'text-green-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12" /> };
                            if (a.includes('stock out')) return { bg: 'bg-rose-50', ring: 'ring-rose-500/20', text: 'text-rose-600', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" /> };
                            return { bg: 'bg-gray-50', ring: 'ring-gray-500/20', text: 'text-gray-500', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> };
                        };

                        // Group by date
                        let lastGroup = '';

                        return visibleLogs.length === 0 ? (
                            <div className="p-10 text-center">
                                <div className="bg-gray-100 rounded-2xl p-4 w-fit mx-auto mb-3">
                                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                </div>
                                <p className="text-sm font-black text-gray-900">{actLogSearch || actLogUserFilter !== 'All' || actLogActionFilter !== 'All' ? 'No matching logs' : 'No activity recorded'}</p>
                                <p className="text-xs font-medium text-gray-400 mt-1">{actLogSearch || actLogUserFilter !== 'All' || actLogActionFilter !== 'All' ? 'Try adjusting your search or filters' : 'Activity will appear here as actions are performed'}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {visibleLogs.map((log) => {
                                    const group = getDateGroup(log.timestamp);
                                    const showGroup = group !== lastGroup;
                                    lastGroup = group;
                                    const style = getActionStyle(log.action);
                                    return (
                                        <React.Fragment key={log.id}>
                                            {showGroup && (
                                                <div className="px-4 py-2 bg-gray-50/80 sticky top-0 z-10 border-b border-gray-100">
                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{group}</p>
                                                </div>
                                            )}
                                            <div className="px-4 py-2.5 hover:bg-gray-50/80 transition-colors flex items-center gap-3 group">
                                                <div className={`${style.bg} ring-1 ${style.ring} p-2 rounded-xl shrink-0`}>
                                                    <svg className={`w-3.5 h-3.5 ${style.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">{style.icon}</svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-center gap-2">
                                                        <p className="text-xs font-black text-gray-900 truncate">{log.user}</p>
                                                        <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap tabular-nums">{formatExact(log.timestamp)}</span>
                                                    </div>
                                                    <p className="text-[11px] font-bold text-gray-600 mt-0.5">{log.action}</p>
                                                    {log.details && <p className="text-[10px] text-gray-400 font-medium mt-0.5 truncate">{log.details}</p>}
                                                </div>
                                            </div>
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        );
                    })()}
                </div>
                {/* Footer */}
                <div className="p-3 bg-gray-50 border-t border-gray-100 shrink-0">
                    <button 
                        onClick={() => setIsActivityLogOpen(false)}
                        className="w-full py-2 rounded-xl font-bold uppercase tracking-wider hover:opacity-90 transition-all shadow-sm text-xs"
                        style={{ backgroundColor: '#111827', color: '#ffffff' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
       )}

       {/* Top Header - Fixed and Full Width */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-[#111827] shadow-md z-50 flex items-center justify-between px-4 border-b border-gray-800">
         <div className="flex items-center space-x-4">
            {/* Mobile Menu Button */}
            <button 
                className="md:hidden p-2 text-gray-300 hover:text-white focus:outline-none"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>

            <div className="flex items-center space-x-2">
              <img src={logo} alt="TLC Logo" className="w-10 h-10 object-contain hidden sm:block rounded-full border-2 border-white/20" />
              <div className="flex flex-col">
                <span className="text-lg sm:text-xl font-semibold text-white tracking-tight leading-tight">Tableria La Confianza</span>
                <span className="text-sm text-gray-400 font-medium">Co., Inc.</span>
              </div>
            </div>
         </div>
         <div className="flex items-center space-x-4">
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
                    <div className="h-9 w-9 rounded-full bg-gray-600 flex items-center justify-center text-white font-bold border border-white/20 relative overflow-hidden">
                        {currentUserAvatar ? (
                            <img src={currentUserAvatar} alt="User Info" className="w-full h-full object-cover rounded-full" />
                        ) : userRole === ROLES.CASHIER ? (
                            <span>C</span>
                        ) : (
                            <span>{currentUserName ? currentUserName.charAt(0).toUpperCase() : 'U'}</span>
                        )}
                        {/* Red Notification Dot on Avatar */}
                        {!currentUserAvatar && isAdminOrAbove() && <span className="absolute top-0 right-0 h-2 w-2 bg-red-500 rounded-full border border-white ring-1 ring-white"></span>}
                    </div>
                </button>


                {/* Dropdown Menu */}
                {isProfileMenuOpen && (
                    <div className="absolute right-0 mt-3 w-56 bg-[#1f2937] backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] py-1 z-50 transform origin-top-right transition-all duration-200 animate-in fade-in zoom-in-95 ring-1 ring-white/10">
                        {/* Header Section */}
                        <div className="px-3 py-3 border-b border-gray-700/50 bg-gray-800/30">
                             <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1.5 ml-1">Signed in as</p>
                             <div className="bg-gray-800/80 rounded-xl p-2 flex items-center gap-3 border border-gray-700/50 shadow-inner">
                                 <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-xs shrink-0 border border-gray-600">
                                    {currentUserAvatar ? (
                                        <img src={currentUserAvatar} alt="User" className="w-full h-full object-cover rounded-full" />
                                    ) : userRole === ROLES.CASHIER ? (
                                        <span>C</span>
                                    ) : (
                                        <span>{currentUserName ? currentUserName.charAt(0).toUpperCase() : 'A'}</span>
                                    )}
                                 </div>
                                 <div className="overflow-hidden">
                                     <p className="text-xs font-bold text-white truncate leading-tight mb-0.5">
                                         {roleNames[userRole] || 'User'}
                                     </p>
                                     <div className="flex items-center gap-1.5">
                                         <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                         <p className="text-[10px] font-medium text-gray-400">{currentUserName}</p>
                                     </div>
                                 </div>
                             </div>
                        </div>

                        {/* Menu Items */}
                        <div className="p-1.5 space-y-0.5">
                            <button onClick={() => { handleNavigation('Profile', '/profile'); setIsProfileMenuOpen(false); }} className="w-full text-left px-2.5 py-2 text-xs font-bold text-gray-300 hover:text-white rounded-xl flex items-center gap-2.5 transition-all group !bg-transparent hover:!bg-gray-800/80">
                                <div className="p-1 bg-gray-800 rounded-lg group-hover:bg-gray-700 transition-all text-gray-400 group-hover:text-white shadow-sm ring-1 ring-gray-700/50">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                </div>
                                <span className="flex-1">My Profile</span>
                                <svg className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                            </button>
                            
                            <button onClick={handleOpenActivityLog} className="w-full text-left px-2.5 py-2 text-xs font-bold text-gray-300 hover:text-white rounded-xl flex items-center gap-2.5 transition-all group !bg-transparent hover:!bg-gray-800/80 relative">
                                <div className="p-1 bg-gray-800 rounded-lg group-hover:bg-gray-700 transition-all text-gray-400 group-hover:text-white shadow-sm ring-1 ring-gray-700/50">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                </div>
                                Activity Log
                                {(() => {
                                    if (userRole !== 'admin') return null;
                                    const relevantLogs = activityLogs.filter(log => log.user !== currentUserName);
                                    const unreadCount = relevantLogs.length - readLogCount;
                                    return unreadCount > 0 ? (
                                        <span className="ml-auto bg-red-500/90 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm shadow-red-900/50 ring-1 ring-red-400/50">
                                            {unreadCount}
                                        </span>
                                    ) : null;
                                })()}
                            </button>

                            <div className="w-full text-left px-2.5 py-2 text-xs font-bold text-gray-300 hover:text-white rounded-xl flex items-center justify-between transition-all group !bg-transparent hover:!bg-gray-800/80 cursor-pointer" onClick={(e) => { e.stopPropagation(); setIsDarkMode(!isDarkMode); }}>
                                <div className="flex items-center gap-2.5">
                                    <div className="p-1 bg-gray-800 rounded-lg group-hover:bg-gray-700 transition-all text-gray-400 group-hover:text-white shadow-sm ring-1 ring-gray-700/50">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                                    </div>
                                    Dark Mode
                                </div>
                                <button 
                                    className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-300 focus:outline-none ring-1 ring-inset ${isDarkMode ? 'bg-indigo-600 ring-indigo-500' : 'bg-gray-700 ring-gray-600'}`}
                                >
                                    <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center ${isDarkMode ? 'translate-x-[14px]' : 'translate-x-0'}`}>
                                        {isDarkMode && <div className="w-1 h-1 rounded-full bg-indigo-600/20"></div>}
                                    </div>
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-gray-700/50 my-1 mx-3"></div>

                        <div className="p-1.5">
                            <button 
                                onClick={handleLogoutClick}
                                className="w-full text-left px-2.5 py-2 text-xs font-bold text-red-400 hover:text-red-300 rounded-xl flex items-center gap-2.5 transition-all group !bg-transparent hover:!bg-red-900/20"
                            >
                                <div className="p-1.5 bg-red-900/20 rounded-lg group-hover:bg-red-900/40 transition-all text-red-500 hover:text-red-400 shadow-sm ring-1 ring-red-900/30">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
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
            fixed top-16 bottom-0 left-0 z-40 bg-[#111827] border-r border-gray-800 flex flex-col shadow-xl transition-all duration-300 ease-in-out
            md:translate-x-0 
            ${isMobileMenuOpen ? 'translate-x-0 w-56' : '-translate-x-full w-56'} 
            ${isSidebarHovered ? 'md:w-56' : 'md:w-16'}
          `}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          
          <nav className="flex-1 overflow-y-auto pb-6 scrollbar-hide overflow-x-hidden transition-all duration-300 pt-6">
            <ul className="space-y-1 px-3">
              {menuItems.map((item, index) => {
                 if (item.hidden) return null; // Skip hidden items from sidebar
                 const prevCategory = index > 0 ? menuItems[index - 1].category : null;
                 const showHeader = item.category !== prevCategory;
                 const isActive = activeMenu === item.name;
                        
                 return (
                    <React.Fragment key={item.name}>
                        {showHeader && (isSidebarHovered || isMobileMenuOpen) && (
                            <li className="px-3 py-2 mt-6 first:mt-2 text-xs font-semibold text-gray-500 uppercase tracking-widest">
                                {item.category}
                            </li>
                        )}
                        <li>
                        <button
                            onClick={() => {
                                handleNavigation(item.name, item.path);
                                setIsMobileMenuOpen(false);
                            }}
                            className={`group w-full flex items-center ${(isSidebarHovered || isMobileMenuOpen) ? 'space-x-3 px-3' : 'justify-center px-0'} py-2 rounded-lg transition-all duration-300 ease-out text-sm outline-none border border-transparent ${
                            isActive
                                ? 'font-semibold bg-white text-gray-900 shadow-lg shadow-black/20 transform scale-[1.02]' 
                                : 'font-medium text-gray-400 hover:bg-gray-800 hover:border-gray-700 hover:text-white active:scale-95'
                            }`}
                            title={(!isSidebarHovered && !isMobileMenuOpen) ? item.name : ''}
                        >
                            <span className={`transition-all duration-300 shrink-0 ${isActive ? 'text-gray-900' : 'text-gray-400 group-hover:text-white group-hover:scale-110'}`}>
                            {item.icon}
                            </span>
                            <span className={`whitespace-nowrap transition-all duration-300 transform ${(isSidebarHovered || isMobileMenuOpen) ? 'opacity-100 translate-x-0 w-auto' : 'opacity-0 -translate-x-10 w-0 overflow-hidden hidden md:block'} ${(!isActive) ? 'group-hover:translate-x-1' : ''}`}>
                                {item.name}
                            </span>
                        </button>
                        </li>
                    </React.Fragment>
                 );
              })}
            </ul>
          </nav>

          <div className="p-3 border-t border-gray-800 bg-[#111827]">
             <button
               onClick={handleLogoutClick}
               className={`w-full flex items-center ${(isSidebarHovered || isMobileMenuOpen) ? 'space-x-3 px-3' : 'justify-center px-0'} py-2 rounded-lg text-sm font-bold text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors`}
               title={(!isSidebarHovered && !isMobileMenuOpen) ? "Sign Out" : ""}
             >
               <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
               <span className={`whitespace-nowrap transition-all duration-300 ${(isSidebarHovered || isMobileMenuOpen) ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden hidden md:block'}`}>Sign Out</span>
             </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className={`flex-1 transition-all duration-300 ease-in-out bg-gray-50 p-2 ml-0 ${isSidebarHovered ? 'md:ml-56' : 'md:ml-16'} ${isFixedLayout ? 'overflow-hidden h-full' : 'overflow-y-auto h-full'}`}>
           <div className={`w-full ${isFixedLayout ? 'h-full' : ''}`}>
             
             <Suspense fallback={<PageSkeleton />}>
             <Routes>
                {/* Public / Common Routes */}
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardHome onViewAllProducts={() => handleNavigation('Product List', '/product-list')} onNavigate={(menu) => {
                    // Map menu names to paths
                     if (menu === 'Product List') handleNavigation('Product List', '/product-list');
                     else if (menu === 'Dashboard') handleNavigation('Dashboard', '/dashboard');
                     else if (menu === 'History Logs') handleNavigation('History Logs', '/history');
                     else if (menu === 'Inventory') handleNavigation('Inventory', '/inventory');
                     else if (menu === 'Reports') handleNavigation('Reports', '/reports');
                }} />} />
                
                <Route path="pos" element={<PointOfSale />} />
                
                <Route path="product-list" element={<ProductList />} />
                
                <Route path="history" element={<History />} />
                
                <Route path="profile" element={<Profile />} />

                {/* Admin Only Routes */}
                <Route path="inventory" element={<Inventory />} />
                <Route path="users" element={<RequireAdmin userRole={userRole}><UserList /></RequireAdmin>} />
                <Route path="reports" element={<Reports />} />
                <Route path="recommendations" element={<Recommendation />} />
                <Route path="partners" element={<Partners viewOnly={userRole === ROLES.ADMIN} />} />
                <Route path="settings" element={<RequireAdmin userRole={userRole}><Settings /></RequireAdmin>} />
                
                {/* Fallback */}
                <Route path="*" element={<div className="flex flex-col items-center justify-center p-10 mt-10 text-gray-400">
                    <h1 className="text-6xl font-black text-gray-200">404</h1>
                    <p className="text-xl font-bold mt-2">Page Not Found</p>
                    <button onClick={() => navigate('/dashboard')} className="mt-6 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">Go Home</button>
                </div>} />
             </Routes>
             </Suspense>

           </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
