const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { R2StorageError, isObjectNotFoundError, r2Storage } = require('./r2StorageService');

const PREFIX = 'transaction-supporting-documents/';
const LOCAL_DIRECTORY = path.resolve(__dirname, '../../uploads/transaction-supporting-documents');
const validKey = (key) => /^[a-f0-9-]+\.(jpg|png)$/i.test(String(key || ''));
const localAllowed = () => process.env.NODE_ENV !== 'production';

const getImageType = (file) => {
  const bytes = file?.buffer;
  const jpeg = file?.mimetype === 'image/jpeg' && Buffer.isBuffer(bytes)
    && bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = file?.mimetype === 'image/png' && Buffer.isBuffer(bytes)
    && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!jpeg && !png) {
    const error = new Error('Supporting Document must be a valid JPG, JPEG, or PNG image.');
    error.status = 400;
    throw error;
  }
  return { extension: png ? 'png' : 'jpg', mimeType: png ? 'image/png' : 'image/jpeg' };
};

const uploadDocument = async (file, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  const { extension, mimeType } = getImageType(file);
  if (file.buffer.length > 5 * 1024 * 1024) {
    const error = new Error('Supporting Document must be 5 MB or smaller.');
    error.status = 400;
    throw error;
  }
  const key = `${randomUUID()}.${extension}`;
  if (storage.isConfigured()) {
    await storage.putObject({ key: `${PREFIX}${key}`, body: file.buffer, contentType: mimeType });
  } else if (allowLocal) {
    await fs.mkdir(LOCAL_DIRECTORY, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIRECTORY, key), file.buffer, { flag: 'wx' });
  } else {
    throw new R2StorageError('Cloud storage is required for supporting documents in production.', { code: 'R2_NOT_CONFIGURED' });
  }
  return {
    key,
    originalName: path.basename(String(file.originalname || `document.${extension}`).replace(/\\/g, '/')),
    mimeType,
    size: file.buffer.length,
    uploadedAt: new Date(),
  };
};

const removeDocument = async (key, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!validKey(key)) return;
  if (storage.isConfigured()) return storage.deleteObject(`${PREFIX}${key}`);
  if (!allowLocal) return;
  try { await fs.unlink(path.join(LOCAL_DIRECTORY, key)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
};

const getDocument = async (key, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!validKey(key)) return null;
  if (storage.isConfigured()) {
    try { return { type: 'r2', object: await storage.getObject(`${PREFIX}${key}`) }; }
    catch (error) { if (!isObjectNotFoundError(error) || !allowLocal) throw error; }
  } else if (!allowLocal) {
    throw new R2StorageError('Cloud storage is required for supporting documents in production.', { code: 'R2_NOT_CONFIGURED' });
  }
  const filePath = path.join(LOCAL_DIRECTORY, key);
  try { await fs.access(filePath); return { type: 'local', filePath }; } catch { return null; }
};

module.exports = { PREFIX, getImageType, uploadDocument, removeDocument, getDocument };
