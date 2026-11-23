const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_IMAGE_BYTES = 1 * 1024 * 1024;
const MAX_SETTINGS_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SOURCE_URL_LENGTH = 2048;

const invalidImage = (message) => Object.assign(new Error(message), { status: 400 });
const containsUnsafeUrlCharacters = (value) => {
  for (const character of String(value || '')) {
    const codePoint = character.codePointAt(0);
    if (character === '\\' || codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
};

const detectImageMimeType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from('RIFF')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  return '';
};

const parseImageDataUrl = (value, { maxBytes = MAX_PRODUCT_IMAGE_BYTES, fieldName = 'Image' } = {}) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(String(value || ''));
  if (!match) throw invalidImage(`${fieldName} must be a valid JPG, PNG, or WebP image.`);
  const encoded = match[2];
  if (encoded.length % 4 === 1 || encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw invalidImage(`${fieldName} must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`);
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > maxBytes || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw invalidImage(`${fieldName} must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller and contain valid image data.`);
  }
  const mimeType = match[1].toLowerCase();
  if (detectImageMimeType(buffer) !== mimeType) {
    throw invalidImage(`${fieldName} content does not match its declared image format.`);
  }
  return { mimeType, buffer, size: buffer.length };
};

const validateImageSource = (value, { maxBytes = MAX_PRODUCT_IMAGE_BYTES, fieldName = 'Image' } = {}) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw invalidImage(`${fieldName} must be an image or HTTPS image URL.`);
  const source = value.trim();
  if (!source) return '';
  if (source.length > Math.max(MAX_IMAGE_SOURCE_URL_LENGTH, Math.ceil(maxBytes / 3) * 4 + 64)) {
    throw invalidImage(`${fieldName} is too large.`);
  }
  if (/^data:/i.test(source)) {
    parseImageDataUrl(source, { maxBytes, fieldName });
    return source;
  }
  if (/^https:\/\//i.test(source)) {
    let parsed;
    try { parsed = new URL(source); } catch { throw invalidImage(`${fieldName} must use a valid HTTPS image URL.`); }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || source.length > MAX_IMAGE_SOURCE_URL_LENGTH) {
      throw invalidImage(`${fieldName} must use a valid HTTPS image URL.`);
    }
    return source;
  }
  // Keep same-origin legacy asset paths usable, but reject protocol-relative
  // URLs, backslashes, and control characters that can change URL parsing.
  if (source.startsWith('/') && !source.startsWith('//') && !containsUnsafeUrlCharacters(source)) return source;
  throw invalidImage(`${fieldName} must be an image data URL, a same-origin path, or an HTTPS image URL.`);
};

module.exports = {
  MAX_AVATAR_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_SETTINGS_IMAGE_BYTES,
  containsUnsafeUrlCharacters,
  detectImageMimeType,
  parseImageDataUrl,
  validateImageSource,
};
