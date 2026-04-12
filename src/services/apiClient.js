const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'authToken';

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

export const apiRequest = async (path, options = {}) => {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
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
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body;
};
