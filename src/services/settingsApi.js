import { apiRequest } from './apiClient';

export const getSettingsApi = async () => {
  return apiRequest('/api/settings');
};

export const updateSettingsApi = async (payload) => {
  const response = await apiRequest('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  return response?.settings || null;
};
