const PUBLIC_SETTINGS_FIELDS = Object.freeze([
  'storeName',
  'storeAddress',
  'contactPhone',
  'contactPhoneSecondary',
  'storeMapLink',
]);

const toPublicSettings = (settings) => {
  const source = typeof settings?.toObject === 'function' ? settings.toObject() : (settings || {});

  return PUBLIC_SETTINGS_FIELDS.reduce((projection, field) => {
    projection[field] = source[field];
    return projection;
  }, {});
};

module.exports = {
  PUBLIC_SETTINGS_FIELDS,
  toPublicSettings,
};
