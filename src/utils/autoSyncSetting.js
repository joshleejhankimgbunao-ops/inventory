export const beginAutoSyncSave = (inFlightRef) => {
  if (inFlightRef.current) return false;
  inFlightRef.current = true;
  return true;
};

export const endAutoSyncSave = (inFlightRef) => {
  inFlightRef.current = false;
};

export const persistAutoSyncImmediately = async (updateSettings, nextAutoSync) => {
  const savedSettings = await updateSettings(
    { autoSync: Boolean(nextAutoSync) },
    { partial: true, throwOnError: true },
  );

  if (!savedSettings || typeof savedSettings.autoSync !== 'boolean') {
    throw new Error('Auto-Sync setting could not be saved.');
  }

  return savedSettings.autoSync;
};

export const excludeAutoSyncFromBulkSettings = (settings = {}) => {
  const { autoSync: _autoSync, ...bulkSettings } = settings;
  return bulkSettings;
};
