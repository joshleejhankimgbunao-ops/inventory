const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3 } }).array('images', 3);
const uploadSpecialOrderQuotationImages = (req, res, next) => upload(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Each product photo must be 5 MB or smaller.' : error.code === 'LIMIT_FILE_COUNT' ? 'A product can have at most 3 photos.' : error.message || 'Unable to upload product photos.' });
});

// Direct quotation creation carries photos for several products in one request.
// Item UUIDs in field names keep the association independent of row position.
const initialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 30, fields: 2 } }).any();
const uploadInitialSpecialOrderQuotationImages = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  return initialUpload(req, res, (error) => {
    if (!error) return next();
    return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Each product photo must be 5 MB or smaller.' : 'Too many product photos or invalid upload.' });
  });
};

module.exports = { uploadSpecialOrderQuotationImages, uploadInitialSpecialOrderQuotationImages };
