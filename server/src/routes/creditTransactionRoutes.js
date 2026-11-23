const express = require('express');
const {
  listCreditTransactions,
  getCustomerOverdueHistory,
  getCreditTransactionsSummary,
  getCreditTransactionById,
  recordCreditPayment,
  markCreditTransactionFullyPaid,
  getCreditTransactionProofOfPayment,
  getCreditPaymentHistoryProof,
  extendCreditTransactionTerm,
  cancelCreditTransaction,
  getCreditCancellationProof,
} = require('../controllers/creditTransactionController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { uploadCreditPaymentProof } = require('../middleware/creditProofUploadMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listCreditTransactions);
router.get('/customer-overdue-history', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCustomerOverdueHistory);
router.get('/summary', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditTransactionsSummary);
router.get('/:id', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditTransactionById);
router.get('/:id/proof', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditTransactionProofOfPayment);
router.post('/:id/payments', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadCreditPaymentProof, recordCreditPayment);
router.get('/:id/payments/:requestId/proof', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditPaymentHistoryProof);
router.get('/:id/payments/:requestId/proofs/:index', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditPaymentHistoryProof);
router.patch('/:id/mark-paid', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadCreditPaymentProof, markCreditTransactionFullyPaid);
router.patch('/:id/extend-term', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), extendCreditTransactionTerm);
router.patch('/:id/cancel', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadCreditPaymentProof, cancelCreditTransaction);
router.get('/:id/cancellation-proofs/:index', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getCreditCancellationProof);

module.exports = router;
