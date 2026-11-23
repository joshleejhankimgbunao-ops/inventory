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

const finalizationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(String(file?.mimetype || '').toLowerCase())) {
      const error = new Error('Supporting photos must be JPG, JPEG, or PNG images.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
}).fields([{ name: 'document', maxCount: 1 }, { name: 'downPaymentProofs', maxCount: 3 }]);

const uploadSaleDocument = (req, res, next) => upload(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE'
    ? 'Supporting Document must be 5 MB or smaller.'
    : error.message || 'Unable to upload Supporting Document.' });
});

const uploadSaleFinalization = (req, res, next) => finalizationUpload(req, res, (error) => {
  if (error) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE'
    ? 'Each supporting photo must be 5 MB or smaller.'
    : error.message || 'Unable to upload supporting photos.' });
  req.file = req.files?.document?.[0] || null;
  req.downPaymentProofFiles = req.files?.downPaymentProofs || [];
  return next();
});

module.exports = { uploadSaleDocument, uploadSaleFinalization };
