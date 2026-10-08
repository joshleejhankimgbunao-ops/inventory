const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { R2StorageError, isObjectNotFoundError, r2Storage } = require('./r2StorageService');

const PREFIX = 'sale-void-proofs/';
const MAX_SIZE = 5 * 1024 * 1024;
const LOCAL_DIRECTORY = path.resolve(__dirname, '../../uploads/sale-void-proofs');
const validKey = (key) => /^[a-f0-9-]+\.(jpg|png|pdf)$/i.test(String(key || ''));
const localAllowed = () => process.env.NODE_ENV !== 'production';

const detectedType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    return { extension: 'pdf', mimeType: 'application/pdf' };
  }
  return null;
};

const validateProofFile = (file) => {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('Supporting Proof file is empty or invalid.');
    error.status = 400;
    throw error;
  }
  if (buffer.length > MAX_SIZE) {
    const error = new Error('Supporting Proof must be 5 MB or smaller.');
    error.status = 400;
    throw error;
  }

  const originalName = path.basename(String(file.originalname || '').replace(/\\/g, '/'));
  const extension = path.extname(originalName).toLowerCase();
  const declaredMimeType = String(file.mimetype || '').toLowerCase();
  const declared = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
  }[extension];
  const actual = detectedType(buffer);

  if (!declared || declared !== declaredMimeType || !actual || actual.mimeType !== declaredMimeType) {
    const error = new Error('Supporting Proof must be a valid JPG, JPEG, PNG, or PDF file.');
    error.status = 400;
    throw error;
  }

  return { ...actual, originalName };
};

const uploadProof = async (file, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  const { extension, mimeType, originalName } = validateProofFile(file);
  const key = `${randomUUID()}.${extension}`;
  if (storage.isConfigured()) {
    await storage.putObject({ key: `${PREFIX}${key}`, body: file.buffer, contentType: mimeType });
  } else if (allowLocal) {
    await fs.mkdir(LOCAL_DIRECTORY, { recursive: true });
    await fs.writeFile(path.join(LOCAL_DIRECTORY, key), file.buffer, { flag: 'wx' });
  } else {
    throw new R2StorageError('Cloud storage is required for Sale Void proofs in production.', { code: 'R2_NOT_CONFIGURED' });
  }
  return {
    key,
    originalName: originalName || `proof.${extension}`,
    mimeType,
    size: file.buffer.length,
    uploadedAt: new Date(),
  };
};

const removeProof = async (key, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!validKey(key)) return false;
  if (storage.isConfigured()) return storage.deleteObject(`${PREFIX}${key}`);
  if (!allowLocal) return false;
  try {
    await fs.unlink(path.join(LOCAL_DIRECTORY, key));
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
};

const getProof = async (key, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!validKey(key)) return null;
  if (storage.isConfigured()) {
    try {
      return { type: 'r2', object: await storage.getObject(`${PREFIX}${key}`) };
    } catch (error) {
      if (!isObjectNotFoundError(error) || !allowLocal) throw error;
    }
  } else if (!allowLocal) {
    throw new R2StorageError('Cloud storage is required for Sale Void proofs in production.', { code: 'R2_NOT_CONFIGURED' });
  }
  const filePath = path.join(LOCAL_DIRECTORY, key);
  try {
    await fs.access(filePath);
    return { type: 'local', filePath };
  } catch {
    return null;
  }
};

module.exports = { MAX_SIZE, PREFIX, detectedType, getProof, removeProof, uploadProof, validateProofFile };
