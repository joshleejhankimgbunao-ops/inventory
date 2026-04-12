import React, { createContext, useState, useEffect, useContext } from 'react';
import { ROLES, roleNames, canAccess } from '../constants/roles';
import { getSettingsApi, updateSettingsApi } from '../services/settingsApi';
import { meApi } from '../services/authApi';

const DEFAULT_APP_SETTINGS = {
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
    autoSync: true,
    lowStockAlert: 10,
    desktopNotifications: true,
    maxStockLimit: 100,
    budgetRanges: {
        low: { min: 0, max: 500 },
        moderate: { min: 500, max: 2000 },
        high: { min: 2000, max: 1000000 },
    },
    adminUser: 'Owner',
    adminDisplayName: 'Admin User',
    adminPassword: '123456',
    adminPin: '123456',
};

const mergeSettings = (incoming = {}) => ({
    ...DEFAULT_APP_SETTINGS,
    ...(incoming || {}),
    budgetRanges: {
        ...DEFAULT_APP_SETTINGS.budgetRanges,
        ...(incoming?.budgetRanges || {}),
    },
});

const AUTH_FALLBACK = {
    userRole: ROLES.SUPER_ADMIN,
    setUserRole: () => {},
    appSettings: DEFAULT_APP_SETTINGS,
    updateSettings: () => {},
    currentUserName: 'Admin User',
    setCurrentUserName: () => {},
    currentUserAvatar: null,
    setCurrentUserAvatar: () => {},
    currentAuthUsername: '',
    mustChangeCredentials: false,
    setMustChangeCredentials: () => {},
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
    const [currentAuthUsername, setCurrentAuthUsername] = useState(() => sessionStorage.getItem('authUsername') || '');
    const [mustChangeCredentials, setMustChangeCredentials] = useState(() => sessionStorage.getItem('mustChangeCredentials') === 'true');

    // 2. App Settings (backend-first)
    const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);

    useEffect(() => {
        let isMounted = true;

        const loadSettings = async () => {
            try {
                const remoteSettings = await getSettingsApi();
                if (isMounted && remoteSettings) {
                    setAppSettings(mergeSettings(remoteSettings));
                }
            } catch {
                // Keep defaults when backend is temporarily unavailable.
            }
        };

        loadSettings();

        return () => {
            isMounted = false;
        };
    }, []);

    // migrate legacy sessionStorage value "admin" -> superadmin
    // run only once on mount; this prevents converting newly logged-in
    // Admin users who legitimately have the "admin" role.
    useEffect(() => {
        const storedRole = sessionStorage.getItem('userRole');
        const authUsername = String(currentAuthUsername || sessionStorage.getItem('authUsername') || '').trim().toLowerCase();
        const configuredAdminUser = String(appSettings.adminUser || '').trim().toLowerCase();

        if (storedRole === 'admin' && authUsername && configuredAdminUser && authUsername === configuredAdminUser) {
            setUserRole(ROLES.SUPER_ADMIN);
            sessionStorage.setItem('userRole', ROLES.SUPER_ADMIN);
        }
    }, [appSettings.adminUser, currentAuthUsername]);

    const resolveNonCashierName = () => {
        const authUsername = (currentAuthUsername || '').trim().toLowerCase();
        const configuredAdminUser = (appSettings.adminUser || '').trim().toLowerCase();
        const preferredDisplayName = (appSettings.adminDisplayName || '').trim();

        const isPrimaryAdminAccount = authUsername && configuredAdminUser && authUsername === configuredAdminUser;
        if (isPrimaryAdminAccount && preferredDisplayName) {
            return preferredDisplayName;
        }

        return preferredDisplayName || 'Admin User';
    };

    // 3. Current User Name Logic
    // store as state so updates propagate even when role remains constant
    const [currentUserName, setCurrentUserName] = useState(() => {
        if (userRole === ROLES.CASHIER) {
            return 'Cashier';
        }
        return resolveNonCashierName();
    });

    // keep the name in sync whenever the underlying role or settings change
    useEffect(() => {
        if (userRole === ROLES.CASHIER) {
            if (!currentUserName) {
                setCurrentUserName('Cashier');
            }
            return;
        }

        const authUsername = (currentAuthUsername || '').trim().toLowerCase();
        const configuredAdminUser = (appSettings.adminUser || '').trim().toLowerCase();
        const preferredDisplayName = (appSettings.adminDisplayName || '').trim();
        const isPrimaryAdminAccount = authUsername && configuredAdminUser && authUsername === configuredAdminUser;

        if (isPrimaryAdminAccount && preferredDisplayName && currentUserName !== preferredDisplayName) {
            setCurrentUserName(preferredDisplayName);
            return;
        }

        if (!currentUserName) {
            setCurrentUserName(preferredDisplayName || 'Admin User');
        }
    }, [userRole, currentAuthUsername, appSettings.adminUser, appSettings.adminDisplayName, currentUserName]);

    // 4. Update Settings Helper
    const updateSettings = async (newSettings) => {
        const mergedSettings = mergeSettings(newSettings);
        setAppSettings(mergedSettings);

        try {
            const savedSettings = await updateSettingsApi(mergedSettings);
            if (savedSettings) {
                setAppSettings(mergeSettings(savedSettings));
            }
        } catch (error) {
            console.error('Failed to persist settings to backend:', error);
        }
    };

    // 5. Dark Mode Effect
    const [isDarkMode, setIsDarkMode] = useState(Boolean(DEFAULT_APP_SETTINGS.darkMode));

    useEffect(() => {
        setIsDarkMode(Boolean(appSettings.darkMode));
    }, [appSettings.darkMode]);
    
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
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
        const sessionAvatar = sessionStorage.getItem('userAvatar');
        if (sessionAvatar) {
            return sessionAvatar;
        }

        if (userRole === ROLES.SUPER_ADMIN) {
            return appSettings.avatar || null;
        }

        return null;
    };

    const [currentUserAvatar, setCurrentUserAvatar] = useState(() => computeAvatar());
    useEffect(() => {
        setCurrentUserAvatar(computeAvatar());
    }, [userRole, currentUserName, currentAuthUsername, appSettings]);

    useEffect(() => {
        let isMounted = true;

        const hydrateCurrentUserFromBackend = async () => {
            try {
                const response = await meApi();
                const user = response?.user;

                if (!isMounted || !user) {
                    return;
                }

                const backendRole = user.role || ROLES.CASHIER;
                const username = String(user.username || '').trim();
                const backendName = String(user.name || '').trim();
                const backendDisplayName = String(user.displayName || '').trim();
                const isSuperAdminAccount = backendRole === ROLES.SUPER_ADMIN;
                const preferredSuperAdminName = String(appSettings.adminDisplayName || '').trim();
                const canonicalName = isSuperAdminAccount
                    ? (preferredSuperAdminName || backendName || 'Super Admin')
                    : (backendDisplayName || backendName || username || 'User');
                const backendAvatar = user.avatarUrl || user.avatar || '';
                const mustRotateCredentials = Boolean(user.mustChangeCredentials);

                if (username) {
                    sessionStorage.setItem('authUsername', username);
                    setCurrentAuthUsername(username);
                }

                sessionStorage.setItem('userRole', backendRole);
                setUserRole(backendRole);

                sessionStorage.setItem('mustChangeCredentials', mustRotateCredentials ? 'true' : 'false');
                setMustChangeCredentials(mustRotateCredentials);

                sessionStorage.setItem('userName', canonicalName);
                setCurrentUserName(canonicalName);

                if (backendAvatar) {
                    sessionStorage.setItem('userAvatar', backendAvatar);
                    setCurrentUserAvatar(backendAvatar);
                } else {
                    sessionStorage.removeItem('userAvatar');
                    setCurrentUserAvatar(isSuperAdminAccount ? (appSettings.avatar || null) : null);
                }
            } catch {
                // Keep session fallback values when user hydration is unavailable.
            }
        };

        hydrateCurrentUserFromBackend();

        return () => {
            isMounted = false;
        };
    }, [appSettings.adminDisplayName, appSettings.avatar]);

    const resolveAvatarForSession = (roleOverride) => {
        const sessionAvatar = sessionStorage.getItem('userAvatar');
        if (sessionAvatar) {
            return sessionAvatar;
        }

        const effectiveRole = roleOverride || userRole;
        if (effectiveRole === ROLES.SUPER_ADMIN) {
            return appSettings.avatar || null;
        }

        return null;
    };

    const applyAuthenticatedSession = ({ role, name, avatar, username, mustChangeCredentials: mustChangeCredentialsOverride }) => {
        const nextRole = role || userRole;
        const nextName = name || currentUserName;
        const nextMustChangeCredentials = Boolean(mustChangeCredentialsOverride);

        if (typeof username === 'string') {
            sessionStorage.setItem('authUsername', username);
            setCurrentAuthUsername(username);
        }

        if (role) {
            sessionStorage.setItem('userRole', role);
            setUserRole(role);
        }

        if (name) {
            sessionStorage.setItem('userName', name);
            setCurrentUserName(name);
        }

        sessionStorage.setItem('mustChangeCredentials', nextMustChangeCredentials ? 'true' : 'false');
        setMustChangeCredentials(nextMustChangeCredentials);

        if (avatar !== undefined) {
            if (avatar) {
                sessionStorage.setItem('userAvatar', avatar);
                setCurrentUserAvatar(avatar);
            } else {
                sessionStorage.removeItem('userAvatar');
                setCurrentUserAvatar(null);
            }
            return;
        }

        // Login payloads may omit avatar; resolve from known local sources immediately.
        const resolvedAvatar = resolveAvatarForSession(nextRole);
        if (nextRole === ROLES.SUPER_ADMIN) {
            setCurrentUserAvatar(resolvedAvatar || null);
            return;
        }

        setCurrentUserAvatar(resolvedAvatar);
    };

    const clearAuthenticatedSession = () => {
        sessionStorage.removeItem('userRole');
        sessionStorage.removeItem('userName');
        sessionStorage.removeItem('userAvatar');
        sessionStorage.removeItem('authUsername');
        sessionStorage.removeItem('mustChangeCredentials');
        setUserRole(ROLES.SUPER_ADMIN);
        setCurrentUserName(appSettings.adminDisplayName || 'Admin User');
        setCurrentUserAvatar(null);
        setCurrentAuthUsername('');
        setMustChangeCredentials(false);
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
            currentAuthUsername,
            mustChangeCredentials,
            setMustChangeCredentials,
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
