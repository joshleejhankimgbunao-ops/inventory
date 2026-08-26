const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'authToken';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';

export const getAuthToken = () => {
  return sessionStorage.getItem(TOKEN_KEY);
};

export const setAuthToken = (token) => {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
};

export const clearAuthToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
};

export const isApiConnectionFailure = (error) => error?.isConnectionFailure === true;

const clearClientSessionState = () => {
  sessionStorage.removeItem('userRole');
  sessionStorage.removeItem('userName');
  sessionStorage.removeItem('userAvatar');
  sessionStorage.removeItem('authUsername');
  sessionStorage.removeItem('authUserId');
  sessionStorage.removeItem('mustChangeCredentials');
  clearAuthToken();
};

export const apiRequest = async (path, options = {}) => {
  const token = getAuthToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (networkError) {
    const error = new Error('Cannot reach API server. Please make sure the backend is running.');
    error.status = 0;
    error.isConnectionFailure = true;
    error.cause = networkError;
    throw error;
  }

  let body = null;
  let rawText = '';
  try {
    rawText = await response.text();
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const proxyConnectionError = /ECONNREFUSED|proxy error|127\.0\.0\.1:5000/i.test(rawText || '');
    const fallbackMessage = proxyConnectionError
      ? 'Cannot reach API server. Please make sure the backend is running.'
      : `Request failed (${response.status})`;
    const message = body?.message || fallbackMessage;
    if (token && response.status === 401) {
      clearClientSessionState();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, {
          detail: { message },
        }));
      }
    }

    const error = new Error(message);
    error.status = response.status;
    error.isConnectionFailure = false;
    throw error;
  }

  return body;
};

export const apiBlobRequest = async (path, options = {}) => {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (networkError) {
    const error = new Error('Cannot reach API server. Please make sure the backend is running.');
    error.status = 0;
    error.isConnectionFailure = true;
    error.cause = networkError;
    throw error;
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body?.message || message;
    } catch {
      // Keep the safe HTTP fallback when the server response is not JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    error.isConnectionFailure = false;
    throw error;
  }

  return response.blob();
};
