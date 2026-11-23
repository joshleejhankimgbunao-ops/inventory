const fs = require('fs/promises');
const path = require('path');
const dns = require('node:dns/promises');
const https = require('node:https');
const net = require('node:net');
const { randomUUID } = require('crypto');
const { R2StorageError, isLocalStorageAllowed, isObjectNotFoundError, r2Storage } = require('./r2StorageService');
const { containsUnsafeUrlCharacters, parseImageDataUrl } = require('../utils/imageSourceValidation');
const { productImageSources } = require('../utils/specialOrderProductImages');

const PREFIX = 'special-order-quotation-images/';
const LOCAL_DIRECTORY = path.resolve(__dirname, '../../uploads/special-order-quotation-images');
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS = 3;
const REMOTE_FETCH_TIMEOUT_MS = 8000;
const validKey = (key) => /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(String(key || ''));
const localAllowed = () => isLocalStorageAllowed();

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

const isPublicAddress = (address) => {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a === 240 || (a === 255 && b === 255 && c === 255)) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    // Only global-unicast IPv6 is accepted; this rejects loopback, link-local,
    // unique-local, multicast, IPv4-mapped, and documentation ranges.
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith('2001:db8:');
  }
  return false;
};

const resolveProductImageSourceUrl = (sourceUrl, environment = process.env) => {
  const source = String(sourceUrl || '').trim();
  let parsed;
  try {
    if (source.startsWith('/')) {
      if (source.startsWith('//') || containsUnsafeUrlCharacters(source)) throw new Error('Unsafe relative image path.');
      const origin = String(environment.CLIENT_ORIGIN || '').split(',').map((value) => value.trim()).find(Boolean);
      if (!origin) throw new Error('A public application origin is required to snapshot this image.');
      parsed = new URL(source, origin);
    } else {
      parsed = new URL(source);
    }
  } catch (error) {
    throw Object.assign(new Error(error.message || 'The selected product image URL is invalid.'), { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.port && parsed.port !== '443') {
    throw Object.assign(new Error('Product image snapshots can only be fetched from public HTTPS URLs.'), { status: 400 });
  }
  if (net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) || parsed.hostname.endsWith('.localhost') || parsed.hostname.endsWith('.local') || parsed.hostname.endsWith('.internal')) {
    throw Object.assign(new Error('Product image snapshots must use a public HTTPS hostname.'), { status: 400 });
  }
  return parsed;
};

const fetchPublicImage = async (sourceUrl, { environment = process.env, redirectsRemaining = MAX_REMOTE_REDIRECTS } = {}) => {
  const url = resolveProductImageSourceUrl(sourceUrl, environment);
  let addresses;
  try { addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error('The selected Product Master image could not be reached.'), { status: 400 }); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw Object.assign(new Error('Product image snapshots cannot access private or reserved network addresses.'), { status: 400 });
  }
  const address = addresses[0];
  const requestImage = () => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(result);
    };
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      servername: url.hostname,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
      lookup: (_hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback;
        if (options && typeof options === 'object' && options.all) return done(null, [address]);
        return done(null, address.address, address.family);
      },
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectsRemaining <= 0) return finish(Object.assign(new Error('The selected product image has too many redirects.'), { status: 400 }));
        let redirected;
        try { redirected = new URL(location, url).toString(); }
        catch { return finish(Object.assign(new Error('The selected product image redirect is invalid.'), { status: 400 })); }
        fetchPublicImage(redirected, { environment, redirectsRemaining: redirectsRemaining - 1 }).then((result) => finish(null, result), finish);
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        return finish(Object.assign(new Error('The selected Product Master image could not be downloaded.'), { status: 400 }));
      }
      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > MAX_FILE_SIZE) {
        response.destroy();
        return finish(Object.assign(new Error('Each product photo must be 5 MB or smaller.'), { status: 400 }));
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_SIZE) {
          const error = Object.assign(new Error('Each product photo must be 5 MB or smaller.'), { status: 400 });
          response.destroy(error);
          request.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, Buffer.concat(chunks)));
      response.on('error', (error) => finish(error.status ? error : Object.assign(new Error('The selected Product Master image could not be downloaded.'), { status: 400, cause: error })));
    });
    request.setTimeout(REMOTE_FETCH_TIMEOUT_MS, () => request.destroy(Object.assign(new Error('The selected Product Master image timed out.'), { status: 400 })));
    request.on('error', (error) => finish(error.status ? error : Object.assign(new Error('The selected Product Master image could not be downloaded.'), { status: 400, cause: error })));
    request.end();
  });
  return requestImage();
};

const snapshotProductMasterImage = async (product, imageIndex, options = {}) => {
  const source = productImageSources(product).find((entry) => entry.imageIndex === imageIndex);
  if (!source) throw Object.assign(new Error('The selected Product Master image is no longer available. Refresh the product and retry.'), { status: 409 });

  let buffer;
  if (/^data:/i.test(source.sourceUrl)) {
    buffer = parseImageDataUrl(source.sourceUrl, { maxBytes: MAX_FILE_SIZE, fieldName: 'Product photo' }).buffer;
  } else {
    const fetchImage = options.fetchImage || fetchPublicImage;
    buffer = await fetchImage(source.sourceUrl, { environment: options.environment || process.env });
  }
  const detected = inspectImage({ buffer });
  const fallbackName = `${String(product?.sku || product?.name || 'product').replace(/[^a-z0-9-_]+/gi, '-')}-${imageIndex + 1}.${detected.extension}`;
  return uploadQuotationImage({
    buffer,
    mimetype: detected.mimeType,
    originalname: source.originalName || fallbackName,
  }, options);
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
  if (!allowLocal) throw new R2StorageError('Cloud storage is required to delete quotation product photos in this environment.', { code: 'R2_NOT_CONFIGURED' });
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

module.exports = {
  MAX_FILE_SIZE,
  fetchPublicImage,
  inspectImage,
  isPublicAddress,
  resolveProductImageSourceUrl,
  snapshotProductMasterImage,
  uploadQuotationImage,
  removeQuotationImage,
  getQuotationImage,
};
