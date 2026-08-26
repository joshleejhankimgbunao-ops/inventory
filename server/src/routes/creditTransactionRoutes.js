const express = require('express');
const {
  listCreditTransactions,
  getCreditTransactionsSummary,
  getCreditTransactionById,
  recordCreditPayment,
  markCreditTransactionFullyPaid,
  getCreditTransactionProofOfPayment,
  extendCreditTransactionTerm,
  cancelCreditTransaction,
} = require('../controllers/creditTransactionController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { uploadCreditPaymentProof } = require('../middleware/creditProofUploadMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listCreditTransactions);
router.get('/summary', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditTransactionsSummary);
router.get('/:id', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditTransactionById);
router.get('/:id/proof', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditTransactionProofOfPayment);
router.post('/:id/payments', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), recordCreditPayment);
router.patch('/:id/mark-paid', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadCreditPaymentProof, markCreditTransactionFullyPaid);
router.patch('/:id/extend-term', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), extendCreditTransactionTerm);
router.patch('/:id/cancel', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), cancelCreditTransaction);

module.exports = router;
