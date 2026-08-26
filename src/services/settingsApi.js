import { apiBlobRequest, apiRequest } from './apiClient';

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

export const downloadSystemBackupApi = async () => {
  const response = await apiRequest('/api/settings/backup');
  return response?.backup || null;
};

export const restoreSystemBackupApi = async (backupPayload) => {
  return apiRequest('/api/settings/restore', {
    method: 'POST',
    body: JSON.stringify({ backup: backupPayload }),
  });
};

export const listAutomaticBackupHistoryApi = async () => {
  const response = await apiRequest('/api/settings/automatic-backups');
  return Array.isArray(response?.backups) ? response.backups : [];
};

export const downloadAutomaticBackupApi = async (fileName) => {
  return apiBlobRequest(`/api/settings/automatic-backups/${encodeURIComponent(fileName)}/download`);
};

export const downloadLatestAutomaticBackupApi = async () => {
  return apiBlobRequest('/api/settings/automatic-backups/latest/download');
};
