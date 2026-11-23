const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');
const { createAggregateMemoryStorage } = require('../src/middleware/specialOrderQuotationImageUploadMiddleware');

const saveFile = (storage, req, buffer) => new Promise((resolve, reject) => {
  storage._handleFile(req, { stream: Readable.from([buffer]) }, (error, file) => {
    if (error) reject(error); else resolve(file);
  });
});

test('Special Order image memory storage enforces a combined request byte limit while streaming', async () => {
  const storage = createAggregateMemoryStorage(8);
  const req = {};
  const first = await saveFile(storage, req, Buffer.alloc(5, 1));
  assert.equal(first.size, 5);
  assert.equal(req._specialOrderImageBytes, 5);
  await assert.rejects(saveFile(storage, req, Buffer.alloc(4, 2)), (error) => {
    assert.equal(error.code, 'LIMIT_TOTAL_FILE_SIZE');
    assert.match(error.message, /Combined product photos/);
    return true;
  });
  assert.equal(req._specialOrderImageBytes, 5, 'rejected chunk bytes are not retained in the request total');
});

test('Special Order image memory storage accepts files up to the configured aggregate limit', async () => {
  const storage = createAggregateMemoryStorage(8);
  const req = {};
  const first = await saveFile(storage, req, Buffer.alloc(5, 1));
  const second = await saveFile(storage, req, Buffer.alloc(3, 2));
  assert.equal(first.buffer.length + second.buffer.length, 8);
  assert.equal(req._specialOrderImageBytes, 8);
});
