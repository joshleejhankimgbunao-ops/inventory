const assert = require('node:assert/strict');
const test = require('node:test');
const { getDocument, removeDocument, uploadDocument } = require('../src/services/transactionSupportingDocument');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

test('supporting documents are stored and retrieved from the private R2 service', async () => {
  const operations = [];
  const storage = {
    isConfigured: () => true,
    putObject: async (input) => operations.push({ type: 'put', ...input }),
    getObject: async (key) => { operations.push({ type: 'get', key }); return { Body: jpeg }; },
    deleteObject: async (key) => { operations.push({ type: 'delete', key }); return true; },
  };
  const saved = await uploadDocument({ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'invoice.jpg' }, { storage });
  assert.match(saved.key, /^[a-f0-9-]+\.jpg$/i);
  assert.equal(operations[0].key, `transaction-supporting-documents/${saved.key}`);
  assert.deepEqual(operations[0].body, jpeg);

  const retrieved = await getDocument(saved.key, { storage });
  assert.equal(retrieved.type, 'r2');
  assert.deepEqual(retrieved.object.Body, jpeg);
  await removeDocument(saved.key, { storage });
  assert.equal(operations.at(-1).type, 'delete');
});

test('supporting documents reject spoofed content and production uploads fail closed without R2', async () => {
  const storage = { isConfigured: () => false };
  await assert.rejects(
    uploadDocument({ buffer: jpeg, mimetype: 'image/png', originalname: 'invoice.png' }, { storage }),
    /valid JPG, JPEG, or PNG/,
  );

  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      uploadDocument({ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'invoice.jpg' }, { storage }),
      { code: 'R2_NOT_CONFIGURED' },
    );
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
