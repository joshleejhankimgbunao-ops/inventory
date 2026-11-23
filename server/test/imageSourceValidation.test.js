const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_AVATAR_IMAGE_BYTES,
  MAX_PRODUCT_IMAGE_BYTES,
  detectImageMimeType,
  parseImageDataUrl,
  validateImageSource,
} = require('../src/utils/imageSourceValidation');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.from('RIFFxxxxWEBP');
const dataUrl = (mimeType, bytes) => `data:${mimeType};base64,${bytes.toString('base64')}`;

test('image data URLs validate allowed format against actual signature and return decoded bytes', () => {
  for (const [mimeType, bytes] of [['image/jpeg', jpeg], ['image/png', png], ['image/webp', webp]]) {
    const value = dataUrl(mimeType, bytes);
    assert.equal(detectImageMimeType(bytes), mimeType);
    assert.deepEqual(parseImageDataUrl(value).buffer, bytes);
    assert.equal(validateImageSource(value), value);
  }
});

test('image data URLs reject spoofed MIME types, unsupported formats, invalid base64, and oversize payloads', () => {
  assert.throws(() => parseImageDataUrl(dataUrl('image/png', jpeg)), /does not match/);
  assert.throws(() => validateImageSource('data:image/svg+xml;base64,PHN2Zz4='), /valid JPG, PNG, or WebP/);
  assert.throws(() => validateImageSource('data:image/jpeg;base64,%%%'), /valid JPG, PNG, or WebP/);
  assert.throws(() => parseImageDataUrl(dataUrl('image/jpeg', Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1, 0xff))), /2 MB or smaller/);
  assert.throws(() => parseImageDataUrl(dataUrl('image/jpeg', Buffer.alloc(MAX_AVATAR_IMAGE_BYTES + 1, 0xff)), {
    maxBytes: MAX_AVATAR_IMAGE_BYTES,
    fieldName: 'Profile image',
  }), /Profile image/);
});

test('image references accept HTTPS and safe root-relative paths but reject unsafe URL schemes', () => {
  assert.equal(validateImageSource('https://images.example.com/item.jpg'), 'https://images.example.com/item.jpg');
  assert.equal(validateImageSource('/assets/item.png'), '/assets/item.png');
  for (const value of ['http://images.example.com/item.jpg', '//images.example.com/item.jpg', 'javascript:alert(1)', 'data:text/html;base64,WA==', '/images\\..\\private.png', '/images/unsafe\u0000.png']) {
    assert.throws(() => validateImageSource(value));
  }
});
