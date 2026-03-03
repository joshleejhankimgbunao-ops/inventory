import { apiRequest } from './apiClient';

export const loginApi = async (username, password) => {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
};

export const meApi = async () => {
  return apiRequest('/api/auth/me');
};
