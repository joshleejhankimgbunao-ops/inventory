const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_SETTINGS_FIELDS,
  toPublicSettings,
} = require('../src/config/publicSettings');

test('anonymous settings projection is an exact positive allowlist', () => {
  const settings = {
    storeName: 'Store',
    storeAddress: 'Address',
    contactPhone: 'phone-one',
    contactPhoneSecondary: 'phone-two',
    storeMapLink: 'map-link',
    storePrimaryEmail: 'sensitive-email-sentinel',
    storeSecondaryEmail: 'sensitive-email-sentinel-two',
    adminUser: 'sensitive-admin-sentinel',
    adminDisplayName: 'sensitive-profile-sentinel',
    adminFullName: 'sensitive-name-sentinel',
    adminContactNumber: 'sensitive-contact-sentinel',
    avatar: 'sensitive-avatar-sentinel',
    autoSync: true,
    futureSensitiveField: 'must-not-leak',
    _id: 'must-not-leak',
  };

  const projection = toPublicSettings(settings);
  assert.deepEqual(Object.keys(projection), [...PUBLIC_SETTINGS_FIELDS]);
  assert.deepEqual(projection, {
    storeName: 'Store',
    storeAddress: 'Address',
    contactPhone: 'phone-one',
    contactPhoneSecondary: 'phone-two',
    storeMapLink: 'map-link',
  });
});

test('projection supports Mongoose-style documents without spreading future fields', () => {
  const projection = toPublicSettings({
    toObject: () => ({
      storeName: 'Store',
      storeAddress: 'Address',
      contactPhone: 'one',
      contactPhoneSecondary: 'two',
      storeMapLink: 'map',
      adminUser: 'must-not-leak',
    }),
  });

  assert.deepEqual(Object.keys(projection), [...PUBLIC_SETTINGS_FIELDS]);
  assert.equal(Object.prototype.hasOwnProperty.call(projection, 'adminUser'), false);
});
