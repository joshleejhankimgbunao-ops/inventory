import { apiRequest } from './apiClient';

export const loginApi = async (username, password, pin) => {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...(pin ? { pin } : {}) }),
  });
};

export const registerApi = async ({ name, username, email, password, pin, role }) => {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, username, email, password, pin, role }),
  });
};

export const meApi = async () => {
  return apiRequest('/api/auth/me');
};

export const updateMyEmailApi = async (email) => {
  return apiRequest('/api/auth/me/email', {
    method: 'PATCH',
    body: JSON.stringify({ email }),
  });
};

export const updateUserByUsernameApi = async (username, payload) => {
  return apiRequest(`/api/auth/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

export const requestPasswordResetApi = async (identifier) => {
  return apiRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
};

export const resetPasswordApi = async (token, newPassword) => {
  return apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
};

export const requestPinResetApi = async (identifier) => {
  return apiRequest('/api/auth/forgot-pin', {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
};

export const resetPinApi = async (token, newPin) => {
  return apiRequest('/api/auth/reset-pin', {
    method: 'POST',
    body: JSON.stringify({ token, newPin }),
  });
};
