import React, { createContext, useState, useEffect, useContext } from 'react';
import { getLowStockThreshold } from '../utils/recommendationLogic';
import { ROLES, roleNames, canAccess, isAtLeast } from '../constants/roles';

const AUTH_FALLBACK = {
    userRole: ROLES.SUPER_ADMIN,
    setUserRole: () => {},
    appSettings: {
        storeName: 'Tableria La Confianza Co., Inc.',
        storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
        contactPhone: '0917-545-2166',
        contactPhoneSecondary: '(049) 545-2166',
        storePrimaryEmail: 'tableria@yahoo.com',
        storeSecondaryEmail: 'tableria1@gmail.com',
        storeMapLink: 'https://maps.app.goo.gl/9QdZo3bu4W62qTjQ8',
        currency: 'PHP',
        darkMode: false,
        autoPrintReceipts: false,
        lowStockAlert: 10,
        desktopNotifications: true,
        maxStockLimit: 100,
        adminUser: 'Owner',
        adminDisplayName: 'Admin User',
        adminPassword: '123456',
        adminPin: '123456'
    },
    updateSettings: () => {},
    currentUserName: 'Admin User',
    setCurrentUserName: () => {},
    currentUserAvatar: null,
    setCurrentUserAvatar: () => {},
    isDarkMode: false,
    setIsDarkMode: () => {},
    isSuperAdmin: () => true,
    isAdmin: () => false,
    isAdminOrAbove: () => true,
    isCashier: () => false,
    canViewPage: () => true,
    applyAuthenticatedSession: () => {},
    clearAuthenticatedSession: () => {},
    ROLES,
    roleNames,
};

const AuthContext = createContext(AUTH_FALLBACK);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        return AUTH_FALLBACK;
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    // 1. User Role
    // default to SUPER_ADMIN if nothing stored; we migrate any legacy "admin" values below
    const [userRole, setUserRole] = useState(() => {
        const stored = sessionStorage.getItem('userRole');
        return stored || ROLES.SUPER_ADMIN;
    });

    // migrate legacy sessionStorage value "admin" -> superadmin
    // run only once on mount; this prevents converting newly logged-in
    // Admin users who legitimately have the "admin" role.
    useEffect(() => {
        const storedRole = sessionStorage.getItem('userRole');
        const storedName = sessionStorage.getItem('userName');
        // only upgrade if it's the original admin account (display name matches default)
        const adminDisplay = appSettings.adminDisplayName || 'Admin User';
        if (storedRole === 'admin' && storedName === adminDisplay) {
            setUserRole(ROLES.SUPER_ADMIN);
            sessionStorage.setItem('userRole', ROLES.SUPER_ADMIN);
        }
    }, []);

    // migrate stored users array in localStorage to use our role constants
    useEffect(() => {
        try {
            const raw = localStorage.getItem('users');
            if (raw) {
                let arr = JSON.parse(raw);
                let changed = false;
                arr = arr.map(u => {
                    // only convert the built-in admin account (username 'admin')
                    if (u.username === 'admin' && (u.role === 'Administrator' || u.role === 'admin')) {
                        changed = true;
                        return { ...u, role: ROLES.SUPER_ADMIN };
                    }
                    return u;
                });
                if (changed) {
                    localStorage.setItem('users', JSON.stringify(arr));
                }
            }
        } catch(e) {
            // ignore parsing errors
        }
    }, []);

    // 2. App Settings
    const [appSettings, setAppSettings] = useState(() => {
        const defaults = {
            storeName: 'Tableria La Confianza Co., Inc.',
            storeAddress: 'Manila S Rd, Calamba, 4027 Laguna',
            contactPhone: '0917-545-2166',
            contactPhoneSecondary: '(049) 545-2166',
            storePrimaryEmail: 'tableria@yahoo.com',
            storeSecondaryEmail: 'tableria1@gmail.com',
            storeMapLink: 'https://maps.app.goo.gl/9QdZo3bu4W62qTjQ8',
            currency: 'PHP',
            darkMode: false,
            autoPrintReceipts: false,
            lowStockAlert: 10,
            desktopNotifications: true,
            maxStockLimit: 100,
            adminUser: 'Owner',
            adminDisplayName: 'Admin User',
            adminPassword: '123456',
            adminPin: '123456' // default security PIN for admin
        };
        try {
            const savedSettings = localStorage.getItem('appSettings');
            return savedSettings ? { ...defaults, ...JSON.parse(savedSettings) } : defaults;
        } catch (error) {
            console.error("Failed to parse app settings:", error);
            return defaults;
        }
    });

    // 3. Current User Name Logic
    // store as state so updates propagate even when role remains constant
    const [currentUserName, setCurrentUserName] = useState(() => {
        if (userRole === ROLES.CASHIER) {
            const savedCashier = localStorage.getItem('cashierProfile');
            if (savedCashier) {
                try {
                    return JSON.parse(savedCashier).adminDisplayName || 'Cashier';
                } catch(e) { return 'Cashier'; }
            }
            return 'Cashier';
        }
        const stored = sessionStorage.getItem('userName');
        return stored || appSettings.adminDisplayName || 'Admin User';
    });

    // keep the name in sync whenever the underlying role or settings change
    useEffect(() => {
        if (userRole === ROLES.CASHIER) {
            const savedCashier = localStorage.getItem('cashierProfile');
            if (savedCashier) {
                try {
                    setCurrentUserName(JSON.parse(savedCashier).adminDisplayName || 'Cashier');
                } catch(e) { setCurrentUserName('Cashier'); }
            } else {
                setCurrentUserName('Cashier');
            }
        } else {
            const stored = sessionStorage.getItem('userName');
            setCurrentUserName(stored || appSettings.adminDisplayName || 'Admin User');
        }
    }, [userRole, appSettings]);

    // 4. Update Settings Helper
    const updateSettings = (newSettings) => {
        setAppSettings(newSettings);
        localStorage.setItem('appSettings', JSON.stringify(newSettings));
        // Note: Dependent updates (logs/transactions renaming) should be handled by the consumer 
        // or we need to expose a way to trigger them. 
        // For now, we will expose 'updateSettings' and let the consumer handle side effects if needed,
        // or we can move the side-effect logic here if we have access to setTransactions (which we don't yet).
    };

    // 5. Dark Mode Effect
    const [isDarkMode, setIsDarkMode] = useState(() => {
        return localStorage.getItem('theme') === 'dark';
    });
    
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [isDarkMode]);

    // 6. Role helper exports
    const isSuperAdmin = () => userRole === ROLES.SUPER_ADMIN;
    const isAdmin = () => userRole === ROLES.ADMIN;
    const isAdminOrAbove = () => isSuperAdmin() || isAdmin();
    const isCashier = () => userRole === ROLES.CASHIER;
    const canViewPage = (page) => canAccess(userRole, page);

    // avatar for current session – keep as state so role-stable switches refresh
    const computeAvatar = () => {
        if (userRole === ROLES.CASHIER) {
            const savedCashier = localStorage.getItem('cashierProfile');
            if (savedCashier) {
                try { return JSON.parse(savedCashier).avatar || null; } catch {}; 
            }
            return null;
        }
        if (userRole === ROLES.ADMIN) {
            const users = JSON.parse(localStorage.getItem('users') || '[]');
            const username = sessionStorage.getItem('userName');
            const me = users.find(u => u.name === username || u.username === username);
            if (me && me.avatar) return me.avatar;
            // don't fall back to the global superadmin avatar for regular admins
            const storedAvatar = sessionStorage.getItem('userAvatar');
            return storedAvatar || null;
        }
        const storedAvatar = sessionStorage.getItem('userAvatar');
        return storedAvatar || appSettings.avatar || null;
    };

    const [currentUserAvatar, setCurrentUserAvatar] = useState(() => computeAvatar());
    useEffect(() => {
        setCurrentUserAvatar(computeAvatar());
    }, [userRole, appSettings]);

    const applyAuthenticatedSession = ({ role, name, avatar }) => {
        if (role) {
            sessionStorage.setItem('userRole', role);
            setUserRole(role);
        }

        if (name) {
            sessionStorage.setItem('userName', name);
            setCurrentUserName(name);
        }

        if (avatar) {
            sessionStorage.setItem('userAvatar', avatar);
            setCurrentUserAvatar(avatar);
        } else {
            sessionStorage.removeItem('userAvatar');
            setCurrentUserAvatar(null);
        }
    };

    const clearAuthenticatedSession = () => {
        sessionStorage.removeItem('userRole');
        sessionStorage.removeItem('userName');
        sessionStorage.removeItem('userAvatar');
        setUserRole(ROLES.SUPER_ADMIN);
        setCurrentUserName(appSettings.adminDisplayName || 'Admin User');
        setCurrentUserAvatar(null);
    };

    return (
        <AuthContext.Provider value={{ 
            userRole, 
            setUserRole,
            appSettings, 
            updateSettings, 
            currentUserName,
            setCurrentUserName,
            currentUserAvatar,
            setCurrentUserAvatar,
            isDarkMode,
            setIsDarkMode,
            isSuperAdmin,
            isAdmin,
            isAdminOrAbove,
            isCashier,
            canViewPage,
            applyAuthenticatedSession,
            clearAuthenticatedSession,
            ROLES,
            roleNames
        }}>
            {children}
        </AuthContext.Provider>
    );
};
