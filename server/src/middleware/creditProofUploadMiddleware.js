const multer = require('multer');

const MAX_PROOF_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROOF_FILE_SIZE,
    files: 3,
  },
  fileFilter: (req, file, callback) => {
    if (!ACCEPTED_MIME_TYPES.has(String(file?.mimetype || '').toLowerCase())) {
      const error = new Error('Proof of Payment must be a JPG, JPEG, or PNG image.');
      error.status = 400;
      return callback(error);
    }

    return callback(null, true);
  },
}).fields([{ name: 'proof', maxCount: 1 }, { name: 'proofs', maxCount: 3 }]);

const uploadCreditPaymentProof = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Proof of Payment must be 5 MB or smaller.' });
    }

    return res.status(error.status || 400).json({
      message: error.message || 'Unable to upload Proof of Payment.',
    });
  });
};

const specialOrderFinalPaymentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_FILE_SIZE, files: 4 },
  fileFilter: (_req, file, callback) => {
    if (!ACCEPTED_MIME_TYPES.has(String(file?.mimetype || '').toLowerCase())) {
      const error = new Error(file.fieldname === 'document'
        ? 'Supporting Document must be a JPG, JPEG, or PNG image.'
        : 'Proof of Payment must be a JPG, JPEG, or PNG image.');
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
}).fields([{ name: 'proof', maxCount: 1 }, { name: 'proofs', maxCount: 3 }, { name: 'document', maxCount: 1 }]);

const uploadSpecialOrderFinalPaymentEvidence = (req, res, next) => specialOrderFinalPaymentUpload(req, res, (error) => {
  if (!error) return next();
  return res.status(error.status || 400).json({ message: error.code === 'LIMIT_FILE_SIZE'
    ? 'Each payment photo or supporting document must be 5 MB or smaller.'
    : error.message || 'Unable to upload payment evidence.' });
});

module.exports = {
  MAX_PROOF_FILE_SIZE,
  uploadCreditPaymentProof,
  uploadSpecialOrderFinalPaymentEvidence,
};
