const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(String(file?.mimetype || '').toLowerCase())) {
      const error = new Error('Supporting Document must be a JPG, JPEG, or PNG image.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
}).single('document');

const uploadSaleDocument = (req, res, next) => upload(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE'
    ? 'Supporting Document must be 5 MB or smaller.'
    : error.message || 'Unable to upload Supporting Document.' });
});

module.exports = { uploadSaleDocument };
