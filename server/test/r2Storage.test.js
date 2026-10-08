const assert = require('node:assert/strict');
const test = require('node:test');
const {
  R2StorageError,
  createR2StorageService,
} = require('../src/services/r2StorageService');

// The controller publishes realtime events in the application. Stub that service
// here so focused storage tests do not create the app's long-lived SSE timers.
const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: {
    publishCreditTransactionsUpdated: () => {},
    publishActivityLogged: () => {},
  },
};

const {
  __test: proofStorage,
  getCreditTransactionProofOfPayment,
  markCreditTransactionFullyPaid,
} = require('../src/controllers/creditTransactionController');

const configuredEnvironment = {
  R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  R2_BUCKET_NAME: 'tlc-system-storage',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
};

const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const proofFile = {
  buffer: validJpeg,
  mimetype: 'image/jpeg',
  originalname: 'payment-proof.jpg',
};
const storageKey = '123e4567-e89b-12d3-a456-426614174000.jpg';

const createResponse = () => {
  const response = {
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
  };
  return response;
};

test('R2 service sends private object operations to the configured bucket', async () => {
  const commands = [];
  const service = createR2StorageService({
    environment: configuredEnvironment,
    client: {
      send: async (command) => {
        commands.push(command.input);
        return { ETag: 'etag' };
      },
    },
  });

  const result = await service.putObject({
    key: 'payment-proofs/example.jpg',
    body: validJpeg,
    contentType: 'image/jpeg',
  });

  assert.equal(result.key, 'payment-proofs/example.jpg');
  assert.equal(commands[0].Bucket, 'tlc-system-storage');
  assert.equal(commands[0].Key, 'payment-proofs/example.jpg');
  assert.equal(commands[0].ContentType, 'image/jpeg');
  assert.equal(service.getConfiguration().accessKeyId, '[configured]');
  assert.equal(service.getConfiguration().secretAccessKey, '[configured]');
});

test('R2 configuration removes an accidental bucket path and new keys never repeat the bucket name', async () => {
  const commands = [];
  const service = createR2StorageService({
    environment: {
      ...configuredEnvironment,
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com/tlc-system-storage/',
    },
    client: {
      send: async (command) => {
        commands.push(command.input);
        return { ETag: 'etag' };
      },
    },
  });

  await service.putObject({
    key: 'tlc-system-storage/sale-void-proofs/example.jpg',
    body: validJpeg,
    contentType: 'image/jpeg',
  });

  assert.equal(service.getConfiguration().endpoint, 'https://example.r2.cloudflarestorage.com');
  assert.equal(commands[0].Bucket, 'tlc-system-storage');
  assert.equal(commands[0].Key, 'sale-void-proofs/example.jpg');
});

test('R2 reads and lists legacy bucket-prefixed objects without creating new nested keys', async () => {
  const commands = [];
  const service = createR2StorageService({
    environment: configuredEnvironment,
    client: {
      send: async (command) => {
        commands.push(command.input);
        const { Key, Prefix } = command.input;
        if (Key === 'sale-void-proofs/legacy.jpg') {
          const error = new Error('Not found.');
          error.name = 'NoSuchKey';
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        if (Key === 'tlc-system-storage/sale-void-proofs/legacy.jpg') {
          return { Body: Buffer.from('legacy') };
        }
        if (Prefix === 'database-backups/automatic/') {
          return { Contents: [], IsTruncated: false };
        }
        if (Prefix === 'tlc-system-storage/database-backups/automatic/') {
          return {
            Contents: [{
              Key: 'tlc-system-storage/database-backups/automatic/automatic-inventory-backup-2026-10-08_120000.json',
              Size: 10,
            }],
            IsTruncated: false,
          };
        }
        return {};
      },
    },
  });

  const storedObject = await service.getObject('sale-void-proofs/legacy.jpg');
  const backups = await service.listObjectsByPrefix('database-backups/automatic/');

  assert.deepEqual(storedObject.Body, Buffer.from('legacy'));
  assert.deepEqual(commands.slice(0, 2).map(({ Key }) => Key), [
    'sale-void-proofs/legacy.jpg',
    'tlc-system-storage/sale-void-proofs/legacy.jpg',
  ]);
  assert.deepEqual(commands.slice(2).map(({ Prefix }) => Prefix), [
    'database-backups/automatic/',
    'tlc-system-storage/database-backups/automatic/',
  ]);
  assert.equal(
    backups[0].key,
    'database-backups/automatic/automatic-inventory-backup-2026-10-08_120000.json'
  );
});

test('payment proof is persisted to R2 before the Paid-state operation', async () => {
  const events = [];
  const r2Operations = [];
  const storage = {
    isConfigured: () => true,
    putObject: async (operation) => {
      events.push('r2-upload');
      r2Operations.push(operation);
    },
  };
  const transaction = {
    _id: 'credit-1',
    orderId: 'sale-1',
    remainingBalance: 100,
    paymentHistory: [],
  };
  const response = createResponse();

  await markCreditTransactionFullyPaid({
    params: { id: 'credit-1' },
    file: proofFile,
    body: {},
    user: { _id: 'user-1' },
    get: () => '',
  }, response, assert.fail, {
    findTransaction: async () => transaction,
    ensureOwnership: async () => {},
    persistProof: async (input) => proofStorage.persistProofOfPayment(input, {
      storage,
      allowLocalStorage: false,
    }),
    applyPayment: async ({ transaction: updatedTransaction }) => {
      events.push('mark-paid');
      return updatedTransaction;
    },
  });

  assert.deepEqual(events, ['r2-upload', 'mark-paid']);
  assert.equal(r2Operations.length, 1);
  assert.match(r2Operations[0].key, /^payment-proofs\/[a-f0-9-]+\.jpg$/);
  assert.equal(transaction.proofOfPayment.mimeType, 'image/jpeg');
  assert.equal(response.statusCode, 200);
});

test('R2 upload failure prevents the Paid-state operation', async () => {
  let paymentApplied = false;
  const response = createResponse();

  await markCreditTransactionFullyPaid({
    params: { id: 'credit-1' },
    file: proofFile,
    body: {},
    user: { _id: 'user-1' },
    get: () => '',
  }, response, assert.fail, {
    findTransaction: async () => ({ remainingBalance: 100, paymentHistory: [] }),
    ensureOwnership: async () => {},
    persistProof: async () => {
      throw new R2StorageError('Cloud storage request failed.');
    },
    applyPayment: async () => {
      paymentApplied = true;
    },
  });

  assert.equal(paymentApplied, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.message, 'Cloud storage request failed.');
});

test('database failure after an upload attempts R2 payment-proof cleanup', async () => {
  const uploadedKeys = [];
  const removedKeys = [];
  const storage = {
    isConfigured: () => true,
    putObject: async ({ key }) => uploadedKeys.push(key),
    deleteObject: async (key) => removedKeys.push(key),
  };
  const response = createResponse();
  const nextErrors = [];

  await markCreditTransactionFullyPaid({
    params: { id: 'credit-1' },
    file: proofFile,
    body: {},
    user: { _id: 'user-1' },
    get: () => '',
  }, response, (error) => nextErrors.push(error), {
    findTransaction: async () => ({ remainingBalance: 100, paymentHistory: [] }),
    ensureOwnership: async () => {},
    persistProof: async (input) => proofStorage.persistProofOfPayment(input, {
      storage,
      allowLocalStorage: false,
    }),
    applyPayment: async () => {
      throw new Error('Database write failed.');
    },
    removeProof: async (key) => proofStorage.removeStoredProof(key, {
      storage,
      allowLocalStorage: false,
    }),
  });

  assert.equal(uploadedKeys.length, 1);
  assert.deepEqual(removedKeys, uploadedKeys);
  assert.equal(nextErrors.length, 1);
  assert.equal(nextErrors[0].message, 'Database write failed.');
});

test('authorized proof retrieval streams an R2 proof and missing proofs return controlled 404', async () => {
  const transaction = {
    orderId: 'sale-1',
    proofOfPayment: { storageKey, mimeType: 'image/jpeg' },
  };
  const authorizedResponse = createResponse();
  let ownershipChecked = false;

  await getCreditTransactionProofOfPayment({ params: { id: 'credit-1' }, user: { role: 'cashier' } }, authorizedResponse, assert.fail, {
    findTransaction: async () => transaction,
    ensureOwnership: async () => { ownershipChecked = true; },
    getProof: async () => ({
      type: 'r2',
      object: { Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } },
    }),
  });

  assert.equal(ownershipChecked, true);
  assert.deepEqual(authorizedResponse.body, Buffer.from([1, 2, 3]));
  assert.equal(authorizedResponse.headers['Content-Type'], 'image/jpeg');
  assert.equal(authorizedResponse.headers['Cache-Control'], 'private, no-store');

  const missingResponse = createResponse();
  await getCreditTransactionProofOfPayment({ params: { id: 'credit-1' }, user: {} }, missingResponse, assert.fail, {
    findTransaction: async () => transaction,
    ensureOwnership: async () => {},
    getProof: async () => null,
  });

  assert.equal(missingResponse.statusCode, 404);
  assert.equal(missingResponse.body.message, 'Proof of Payment is not available.');
});
