const multer = require('multer');
const { Writable, pipeline } = require('node:stream');

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const MAX_QUOTATION_IMAGE_TOTAL_SIZE = 15 * 1024 * 1024;
const MAX_INITIAL_IMAGE_TOTAL_SIZE = 20 * 1024 * 1024;

const createAggregateMemoryStorage = (maxBytes) => ({
  _handleFile(req, file, callback) {
    const chunks = [];
    let fileSize = 0;
    let callbackCalled = false;
    const limitedStream = new Writable({
      write(chunk, _encoding, done) {
        const requestSize = Number(req._specialOrderImageBytes || 0) + chunk.length;
        if (requestSize > maxBytes) {
          const error = new Error(`Combined product photos must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`);
          error.code = 'LIMIT_TOTAL_FILE_SIZE';
          error.status = 400;
          return done(error);
        }
        req._specialOrderImageBytes = requestSize;
        fileSize += chunk.length;
        chunks.push(Buffer.from(chunk));
        return done();
      },
    });
    pipeline(file.stream, limitedStream, (error) => {
      if (callbackCalled) return;
      callbackCalled = true;
      if (error) return callback(error);
      return callback(null, { buffer: Buffer.concat(chunks, fileSize), size: fileSize });
    });
  },
  _removeFile(_req, file, callback) {
    delete file.buffer;
    return callback(null);
  },
});

const upload = multer({
  storage: createAggregateMemoryStorage(MAX_QUOTATION_IMAGE_TOTAL_SIZE),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE, files: 3 },
}).array('images', 3);
const uploadSpecialOrderQuotationImages = (req, res, next) => upload(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Each product photo must be 5 MB or smaller.' : error.code === 'LIMIT_TOTAL_FILE_SIZE' ? error.message : error.code === 'LIMIT_FILE_COUNT' ? 'A product can have at most 3 photos.' : error.message || 'Unable to upload product photos.' });
});

// Direct quotation creation carries photos for several products in one request.
// Item UUIDs in field names keep the association independent of row position.
const initialUpload = multer({
  storage: createAggregateMemoryStorage(MAX_INITIAL_IMAGE_TOTAL_SIZE),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE, files: 30, fields: 2 },
}).any();
const uploadInitialSpecialOrderQuotationImages = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  return initialUpload(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Each product photo must be 5 MB or smaller.' : error.code === 'LIMIT_TOTAL_FILE_SIZE' ? error.message : 'Too many product photos or invalid upload.' });
  });
};

module.exports = {
  MAX_INITIAL_IMAGE_TOTAL_SIZE,
  MAX_QUOTATION_IMAGE_TOTAL_SIZE,
  createAggregateMemoryStorage,
  uploadSpecialOrderQuotationImages,
  uploadInitialSpecialOrderQuotationImages,
};
