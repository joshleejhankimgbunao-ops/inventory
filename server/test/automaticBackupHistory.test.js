const assert = require('node:assert/strict');
const test = require('node:test');
const { R2StorageError } = require('../src/services/r2StorageService');
const {
  getAutomaticBackupObject,
  getLatestAutomaticBackupObject,
  listAutomaticBackupHistory,
} = require('../src/services/automaticBackupService');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: { publishSettingsUpdated: () => {} },
};

const {
  downloadAutomaticBackup,
  downloadLatestAutomaticBackup,
  getAutomaticBackupHistory,
} = require('../src/controllers/settingController');

const olderFileName = 'automatic-inventory-backup-2026-08-25_004100.json';
const latestFileName = 'automatic-inventory-backup-2026-08-26_004100.json';

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  set(name, value) {
    this.headers[name] = value;
    return this;
  },
  type(value) {
    this.headers['Content-Type'] = value;
    return this;
  },
  send(value) {
    this.body = value;
    return this;
  },
});

const superAdminRequest = (params = {}) => ({ user: { role: 'superadmin' }, params });

test('automatic backup history lists only valid automatic-prefix objects newest first', async () => {
  let requestedPrefix = '';
  const history = await listAutomaticBackupHistory({
    storage: {
      isConfigured: () => true,
      listObjectsByPrefix: async (prefix) => {
        requestedPrefix = prefix;
        return [
          { key: `payment-proofs/${latestFileName}`, lastModified: new Date('2026-08-26T00:41:00.000Z'), size: 999 },
          { key: `database-backups/automatic/${olderFileName}`, lastModified: new Date('2026-08-25T00:41:00.000Z'), size: 10 },
          { key: `database-backups/automatic/nested/${latestFileName}`, lastModified: new Date('2026-08-26T00:41:00.000Z'), size: 11 },
          { key: `database-backups/automatic/${latestFileName}`, lastModified: new Date('2026-08-26T00:41:00.000Z'), size: 12 },
        ];
      },
    },
  });

  assert.equal(requestedPrefix, 'database-backups/automatic/');
  assert.deepEqual(history.map((backup) => backup.fileName), [latestFileName, olderFileName]);
  assert.deepEqual(history[0], {
    id: latestFileName,
    fileName: latestFileName,
    createdAt: new Date('2026-08-26T00:41:00.000Z'),
    size: 12,
    status: 'available',
  });
});

test('latest backup selection and specific retrieval use only the automatic-backup prefix', async () => {
  const requestedKeys = [];
  const storage = {
    isConfigured: () => true,
    listObjectsByPrefix: async () => [
      { key: `database-backups/automatic/${olderFileName}`, lastModified: new Date('2026-08-25T00:41:00.000Z') },
      { key: `database-backups/automatic/${latestFileName}`, lastModified: new Date('2026-08-26T00:41:00.000Z') },
    ],
    getObject: async (key) => {
      requestedKeys.push(key);
      return { Body: { transformToByteArray: async () => Uint8Array.from([1]) } };
    },
  };

  const latest = await getLatestAutomaticBackupObject({ storage });
  const specific = await getAutomaticBackupObject(olderFileName, { storage });

  assert.equal(latest.fileName, latestFileName);
  assert.equal(specific.fileName, olderFileName);
  assert.deepEqual(requestedKeys, [
    `database-backups/automatic/${latestFileName}`,
    `database-backups/automatic/${olderFileName}`,
  ]);
  await assert.rejects(
    getAutomaticBackupObject('../payment-proofs/secret.jpg', { storage }),
    (error) => error.code === 'R2_INVALID_KEY'
  );
});

test('automatic backup controllers reject unauthenticated and non-superadmin requests', async () => {
  const unauthenticated = createResponse();
  const nonSuperAdmin = createResponse();

  await getAutomaticBackupHistory({}, unauthenticated, assert.fail);
  await getAutomaticBackupHistory({ user: { role: 'admin' } }, nonSuperAdmin, assert.fail);

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(nonSuperAdmin.statusCode, 403);
});

test('automatic backup controllers reject payment-proof paths and stream valid JSON attachments', async () => {
  const invalidResponse = createResponse();
  let storageCalled = false;

  await downloadAutomaticBackup(
    superAdminRequest({ fileName: '../payment-proofs/proof.jpg' }),
    invalidResponse,
    assert.fail,
    { getBackup: async () => { storageCalled = true; } }
  );

  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(storageCalled, false);

  const downloadResponse = createResponse();
  await downloadAutomaticBackup(
    superAdminRequest({ fileName: latestFileName }),
    downloadResponse,
    assert.fail,
    {
      getBackup: async () => ({
        fileName: latestFileName,
        object: { Body: { transformToByteArray: async () => Uint8Array.from([123, 125]) } },
      }),
    }
  );

  assert.equal(downloadResponse.statusCode, 200);
  assert.equal(downloadResponse.headers['Cache-Control'], 'private, no-store');
  assert.equal(downloadResponse.headers['Content-Type'], 'application/json');
  assert.equal(downloadResponse.headers['Content-Disposition'], `attachment; filename="${latestFileName}"`);
  assert.deepEqual(downloadResponse.body, Buffer.from([123, 125]));
});

test('latest and specific download return controlled not-found responses', async () => {
  const missingResponse = createResponse();
  const latestEmptyResponse = createResponse();
  const missingObjectError = new R2StorageError('Cloud storage request failed.', {
    cause: { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } },
  });

  await downloadAutomaticBackup(
    superAdminRequest({ fileName: latestFileName }),
    missingResponse,
    assert.fail,
    { getBackup: async () => { throw missingObjectError; } }
  );
  await downloadLatestAutomaticBackup(
    superAdminRequest(),
    latestEmptyResponse,
    assert.fail,
    { getLatestBackup: async () => null }
  );

  assert.equal(missingResponse.statusCode, 404);
  assert.equal(latestEmptyResponse.statusCode, 404);
});
