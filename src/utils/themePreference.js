export const THEME_PREFERENCE_STORAGE_KEY = 'tlc-theme-preference';

const getBrowserStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const readStoredThemePreference = (storage = getBrowserStorage()) => {
  try {
    return storage?.getItem(THEME_PREFERENCE_STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
};

export const persistThemePreference = (isDarkMode, storage = getBrowserStorage()) => {
  try {
    storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  } catch {
    // Theme storage is an early-render cache; the authenticated preference remains authoritative.
  }
};

export const applyThemePreference = (isDarkMode, root = typeof document === 'undefined' ? null : document.documentElement) => {
  root?.classList.toggle('dark', Boolean(isDarkMode));
};
