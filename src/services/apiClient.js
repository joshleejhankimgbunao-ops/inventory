const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const TOKEN_KEY = 'authToken';

export const getAuthToken = () => sessionStorage.getItem(TOKEN_KEY);

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

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body;
};
