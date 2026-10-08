const path = require('path');
const multer = require('multer');

const ALLOWED_PROOF_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file?.originalname || '')).toLowerCase();
    const mimeType = String(file?.mimetype || '').toLowerCase();
    if (!ALLOWED_PROOF_TYPES[extension] || ALLOWED_PROOF_TYPES[extension] !== mimeType) {
      const error = new Error('Supporting Proof must be a JPG, JPEG, PNG, or PDF file.');
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
}).single('proof');

const uploadSaleVoidProof = (req, res, next) => upload(req, res, (error) => {
  if (!error) return next();
  return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE'
    ? 'Supporting Proof must be 5 MB or smaller.'
    : error.message || 'Unable to upload Supporting Proof.' });
});

module.exports = { ALLOWED_PROOF_TYPES, uploadSaleVoidProof };
