import React, { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import { ROLES, roleNames, canAccess } from '../constants/roles';
import { getSettingsApi, updateSettingsApi } from '../services/settingsApi';
import { meApi, updateMyPreferencesApi } from '../services/authApi';
import { getAuthToken } from '../services/apiClient';
import { subscribeRealtimeEvent } from '../services/realtimeClient';
import {
    applyThemePreference,
    persistThemePreference,
    readStoredThemePreference,
} from '../utils/themePreference';

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
    autoSync: true,
    automaticBackupEnabled: false,
    automaticBackupIntervalDays: 1,
    automaticBackupTime: '23:00',
    lastAutomaticBackupAt: null,
    lastAutomaticBackupStatus: 'not_run',
    lastAutomaticBackupError: '',
    nextAutomaticBackupAt: null,
    lowStockAlert: 10,
    desktopNotifications: true,
    maxStockLimit: 100,
    budgetRanges: {
        low: { min: 0, max: 500 },
        moderate: { min: 500, max: 2000 },
        high: { min: 2000, max: Number.MAX_SAFE_INTEGER },
    },
    adminUser: 'Owner',
    adminDisplayName: 'Admin User',
};

const DEFAULT_USER_PREFERENCES = {
    darkMode: false,
    autoPrintReceipts: false,
};

const mergeSettings = (incoming = {}) => ({
    ...DEFAULT_APP_SETTINGS,
    ...(incoming || {}),
    budgetRanges: {
        ...DEFAULT_APP_SETTINGS.budgetRanges,
        ...(incoming?.budgetRanges || {}),
    },
});

const mergeUserPreferences = (incoming = {}) => ({
    ...DEFAULT_USER_PREFERENCES,
    ...(incoming || {}),
    darkMode: Boolean(incoming?.darkMode),
    autoPrintReceipts: Boolean(incoming?.autoPrintReceipts),
});

const AUTH_FALLBACK = {
    userRole: ROLES.SUPER_ADMIN,
    setUserRole: () => {},
    appSettings: DEFAULT_APP_SETTINGS,
    updateSettings: () => {},
    userPreferences: DEFAULT_USER_PREFERENCES,
    updateUserPreferences: async () => DEFAULT_USER_PREFERENCES,
    currentUserName: 'User',
    setCurrentUserName: () => {},
    currentUserFullName: 'User',
    setCurrentUserFullName: () => {},
    currentUserAvatar: null,
    setCurrentUserAvatar: () => {},
    currentAuthUsername: '',
    currentAuthUserId: '',
    mustChangeCredentials: false,
    setMustChangeCredentials: () => {},
    isDarkMode: false,
    setIsDarkMode: () => {},
    isSettingsLoading: false,
    isSessionHydrating: false,
    isAuthBootstrapLoading: false,
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

// This module intentionally exports the context hook alongside its provider.
// eslint-disable-next-line react-refresh/only-export-components
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
    const [currentAuthUserId, setCurrentAuthUserId] = useState(() => sessionStorage.getItem('authUserId') || '');
    const [mustChangeCredentials, setMustChangeCredentials] = useState(() => sessionStorage.getItem('mustChangeCredentials') === 'true');

    // 2. App Settings (backend-first)
    const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
    const [userPreferences, setUserPreferences] = useState(DEFAULT_USER_PREFERENCES);
    const [isSettingsLoading, setIsSettingsLoading] = useState(true);
    const [isSessionHydrating, setIsSessionHydrating] = useState(true);
    const [hasHydratedUserPreferences, setHasHydratedUserPreferences] = useState(false);

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
            } finally {
                if (isMounted) {
                    setIsSettingsLoading(false);
                }
            }
        };

        loadSettings();

        return () => {
            isMounted = false;
        };
    }, [currentAuthUsername]);

    useEffect(() => {
        const token = getAuthToken();
        if (!token) {
            return undefined;
        }

        let disposed = false;
        let isRefreshInFlight = false;

        const refreshSettings = async () => {
            if (isRefreshInFlight || disposed) {
                return;
            }

            isRefreshInFlight = true;
            try {
                const remoteSettings = await getSettingsApi();
                if (!disposed && remoteSettings) {
                    setAppSettings(mergeSettings(remoteSettings));
                }
            } catch {
                // Ignore transient refresh failures; stream reconnect will retry later.
            } finally {
                isRefreshInFlight = false;
            }
        };

        const unsubscribe = subscribeRealtimeEvent('settings.updated', () => {
            void refreshSettings();
        });

        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [currentAuthUsername]);

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

    // 3. Current User Name Logic
    // The authenticated User record is the source of truth. Until it hydrates,
    // retain only the session value rather than a mutable global admin setting.
    const [currentUserName, setCurrentUserName] = useState(() => {
        const storedName = String(sessionStorage.getItem('userName') || '').trim();
        return storedName || (userRole === ROLES.CASHIER ? 'Cashier' : 'User');
    });
    const [currentUserFullName, setCurrentUserFullName] = useState(() => {
        const storedFullName = String(sessionStorage.getItem('userFullName') || '').trim();
        return storedFullName || String(sessionStorage.getItem('userName') || '').trim() || 'User';
    });

    // Preserve a usable fallback while the authenticated user is loading.
    useEffect(() => {
        if (!currentUserName) {
            setCurrentUserName(userRole === ROLES.CASHIER ? 'Cashier' : 'User');
        }
    }, [userRole, currentUserName]);

    // 4. Update Settings Helper
    const updateSettings = async (newSettings, { partial = false, throwOnError = false } = {}) => {
        const previousSettings = appSettings;
        const requestPayload = partial
            ? newSettings
            : mergeSettings(newSettings);
        const optimisticSettings = mergeSettings({
            ...previousSettings,
            ...(newSettings || {}),
        });
        setAppSettings(optimisticSettings);

        try {
            const savedSettings = await updateSettingsApi(requestPayload);
            if (savedSettings) {
                const nextSettings = mergeSettings(savedSettings);
                setAppSettings(nextSettings);
                return nextSettings;
            }
            setAppSettings(previousSettings);
        } catch (error) {
            console.error('Failed to persist settings to backend:', error);
            setAppSettings(previousSettings);
            if (throwOnError) {
                throw error;
            }
        }

        return null;
    };

    const updateUserPreferences = async (preferencesPatch) => {
        const previousPreferences = userPreferences;
        const optimisticPreferences = mergeUserPreferences({
            ...previousPreferences,
            ...(preferencesPatch || {}),
        });
        setUserPreferences(optimisticPreferences);

        try {
            const response = await updateMyPreferencesApi(preferencesPatch);
            const savedPreferences = mergeUserPreferences(response?.user?.preferences);
            setUserPreferences(savedPreferences);
            return savedPreferences;
        } catch (error) {
            setUserPreferences(previousPreferences);
            throw error;
        }
    };

    // 5. Theme preference: use the authenticated user's preference after hydration,
    // with local storage only as the early-render cache that prevents a light flash.
    const [isDarkModeState, setIsDarkModeState] = useState(() => readStoredThemePreference());
    const isDarkModeRef = useRef(isDarkModeState);

    const setThemeState = useCallback((nextDarkMode, { persist = true } = {}) => {
        const normalizedDarkMode = Boolean(nextDarkMode);
        isDarkModeRef.current = normalizedDarkMode;
        setIsDarkModeState(normalizedDarkMode);
        applyThemePreference(normalizedDarkMode);
        if (persist) {
            persistThemePreference(normalizedDarkMode);
        }
    }, []);

    useEffect(() => {
        applyThemePreference(isDarkModeState);
    }, [isDarkModeState]);

    useEffect(() => {
        if (!hasHydratedUserPreferences) return;
        setThemeState(userPreferences.darkMode);
    }, [hasHydratedUserPreferences, setThemeState, userPreferences.darkMode]);

    const setIsDarkMode = (nextValue) => {
        const previousDarkMode = isDarkModeRef.current;
        const nextDarkMode = typeof nextValue === 'function'
            ? Boolean(nextValue(previousDarkMode))
            : Boolean(nextValue);

        if (nextDarkMode === previousDarkMode) return;

        setThemeState(nextDarkMode);
        void updateUserPreferences({ darkMode: nextDarkMode }).catch(() => {
            // Keep the UI, cache, and root class aligned with the reverted backend preference.
            if (isDarkModeRef.current === nextDarkMode) {
                setThemeState(previousDarkMode);
            }
        });
    };

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
                const userId = String(user.id || '').trim();
                const username = String(user.username || '').trim();
                const backendName = String(user.name || '').trim();
                const backendDisplayName = String(user.displayName || '').trim();
                const isSuperAdminAccount = backendRole === ROLES.SUPER_ADMIN;
                const canonicalName = backendDisplayName || backendName || username || 'User';
                const backendAvatar = user.avatarUrl || user.avatar || '';
                const mustRotateCredentials = Boolean(user.mustChangeCredentials);
                setUserPreferences(mergeUserPreferences(user.preferences));
                setHasHydratedUserPreferences(true);

                if (username) {
                    sessionStorage.setItem('authUsername', username);
                    setCurrentAuthUsername(username);
                }

                if (userId) {
                    sessionStorage.setItem('authUserId', userId);
                    setCurrentAuthUserId(userId);
                }

                sessionStorage.setItem('userRole', backendRole);
                setUserRole(backendRole);

                sessionStorage.setItem('mustChangeCredentials', mustRotateCredentials ? 'true' : 'false');
                setMustChangeCredentials(mustRotateCredentials);

                sessionStorage.setItem('userName', canonicalName);
                setCurrentUserName(canonicalName);
                sessionStorage.setItem('userFullName', backendName || canonicalName);
                setCurrentUserFullName(backendName || canonicalName);

                if (backendAvatar) {
                    sessionStorage.setItem('userAvatar', backendAvatar);
                    setCurrentUserAvatar(backendAvatar);
                } else {
                    sessionStorage.removeItem('userAvatar');
                    setCurrentUserAvatar(isSuperAdminAccount ? (appSettings.avatar || null) : null);
                }
            } catch {
                // Keep session fallback values when user hydration is unavailable.
            } finally {
                if (isMounted) {
                    setIsSessionHydrating(false);
                }
            }
        };

        hydrateCurrentUserFromBackend();

        return () => {
            isMounted = false;
        };
    }, [appSettings.avatar]);

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

    const applyAuthenticatedSession = ({ role, name, fullName, avatar, username, userId, preferences, mustChangeCredentials: mustChangeCredentialsOverride }) => {
        const nextRole = role || userRole;
        const nextName = name || currentUserName;
        const nextFullName = String(fullName || currentUserFullName || nextName || '').trim() || 'User';
        const nextMustChangeCredentials = Boolean(mustChangeCredentialsOverride);
        setUserPreferences(mergeUserPreferences(preferences));
        setHasHydratedUserPreferences(true);

        if (typeof username === 'string') {
            sessionStorage.setItem('authUsername', username);
            setCurrentAuthUsername(username);
        }

        if (typeof userId === 'string' && userId.trim()) {
            const normalizedUserId = userId.trim();
            sessionStorage.setItem('authUserId', normalizedUserId);
            setCurrentAuthUserId(normalizedUserId);
        }

        if (role) {
            sessionStorage.setItem('userRole', role);
            setUserRole(role);
        }

        if (name) {
            sessionStorage.setItem('userName', name);
            setCurrentUserName(name);
        }

        sessionStorage.setItem('userFullName', nextFullName);
        setCurrentUserFullName(nextFullName);

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
        sessionStorage.removeItem('userFullName');
        sessionStorage.removeItem('userAvatar');
        sessionStorage.removeItem('authUsername');
        sessionStorage.removeItem('authUserId');
        sessionStorage.removeItem('mustChangeCredentials');
        setUserRole(ROLES.SUPER_ADMIN);
        setCurrentUserName('User');
        setCurrentUserFullName('User');
        setCurrentUserAvatar(null);
        setCurrentAuthUsername('');
        setCurrentAuthUserId('');
        setMustChangeCredentials(false);
        setUserPreferences(DEFAULT_USER_PREFERENCES);
        setHasHydratedUserPreferences(false);
        setAppSettings(DEFAULT_APP_SETTINGS);
    };

    const isAuthBootstrapLoading = isSettingsLoading || isSessionHydrating;

    return (
        <AuthContext.Provider value={{ 
            userRole, 
            setUserRole,
            appSettings, 
            updateSettings, 
            userPreferences,
            updateUserPreferences,
            currentUserName,
            setCurrentUserName,
            currentUserFullName,
            setCurrentUserFullName,
            currentUserAvatar,
            setCurrentUserAvatar,
            currentAuthUsername,
            currentAuthUserId,
            mustChangeCredentials,
            setMustChangeCredentials,
            isDarkMode: isDarkModeState,
            setIsDarkMode,
            isSettingsLoading,
            isSessionHydrating,
            isAuthBootstrapLoading,
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
