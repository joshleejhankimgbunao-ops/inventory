export const persistAutomaticBackupEnabledImmediately = async (updateSettings, enabled) => {
  const savedSettings = await updateSettings(
    { automaticBackupEnabled: Boolean(enabled) },
    { partial: true, throwOnError: true },
  );

  if (!savedSettings || typeof savedSettings.automaticBackupEnabled !== 'boolean') {
    throw new Error('Automatic Backup setting could not be saved.');
  }

  return savedSettings.automaticBackupEnabled;
};

export const excludeAutomaticBackupEnabledFromScheduleSave = (settings = {}) => {
  const { automaticBackupEnabled: _automaticBackupEnabled, ...scheduleSettings } = settings;
  return scheduleSettings;
};
