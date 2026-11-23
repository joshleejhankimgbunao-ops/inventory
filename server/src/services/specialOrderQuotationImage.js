const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { R2StorageError, isObjectNotFoundError, r2Storage } = require('./r2StorageService');

const PREFIX = 'special-order-quotation-images/';
const LOCAL_DIRECTORY = path.resolve(__dirname, '../../uploads/special-order-quotation-images');
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const validKey = (key) => /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(String(key || ''));
const localAllowed = () => process.env.NODE_ENV !== 'production';

const inspectImage = (file) => {
  const bytes = file?.buffer;
  const jpeg = Buffer.isBuffer(bytes) && bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = Buffer.isBuffer(bytes) && bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'));
  if (!jpeg && !png && !webp) {
    const error = new Error('Product photos must be valid JPG, PNG, or WebP images.'); error.status = 400; throw error;
  }
  return jpeg ? { extension: 'jpg', mimeType: 'image/jpeg' } : png ? { extension: 'png', mimeType: 'image/png' } : { extension: 'webp', mimeType: 'image/webp' };
};

const uploadQuotationImage = async (file, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!file?.buffer || file.buffer.length > MAX_FILE_SIZE) { const error = new Error('Each product photo must be 5 MB or smaller.'); error.status = 400; throw error; }
  const { extension, mimeType } = inspectImage(file);
  const key = `${randomUUID()}.${extension}`;
  if (storage.isConfigured()) await storage.putObject({ key: `${PREFIX}${key}`, body: file.buffer, contentType: mimeType });
  else if (allowLocal) { await fs.mkdir(LOCAL_DIRECTORY, { recursive: true }); await fs.writeFile(path.join(LOCAL_DIRECTORY, key), file.buffer, { flag: 'wx' }); }
  else throw new R2StorageError('Cloud storage is required for quotation product photos in production.', { code: 'R2_NOT_CONFIGURED' });
  return { key, originalName: path.basename(String(file.originalname || `photo.${extension}`).replace(/\\/g, '/')), mimeType, size: file.buffer.length, uploadedAt: new Date() };
};

const removeQuotationImage = async (key, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!validKey(key)) return;
  if (storage.isConfigured()) return storage.deleteObject(`${PREFIX}${key}`);
  if (!allowLocal) return;
  try { await fs.unlink(path.join(LOCAL_DIRECTORY, key)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
};

const getQuotationImage = async (key, { storage = r2Storage, allowLocal = localAllowed() } = {}) => {
  if (!validKey(key)) return null;
  if (storage.isConfigured()) {
    try { return { type: 'r2', object: await storage.getObject(`${PREFIX}${key}`) }; }
    catch (error) { if (!isObjectNotFoundError(error) || !allowLocal) throw error; }
  } else if (!allowLocal) throw new R2StorageError('Cloud storage is required for quotation product photos in production.', { code: 'R2_NOT_CONFIGURED' });
  const filePath = path.join(LOCAL_DIRECTORY, key);
  try { await fs.access(filePath); return { type: 'local', filePath }; } catch { return null; }
};

module.exports = { MAX_FILE_SIZE, inspectImage, uploadQuotationImage, removeQuotationImage, getQuotationImage };
