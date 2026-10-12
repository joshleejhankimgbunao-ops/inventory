const express = require('express');
const {
	listSales,
	listSalesHistoryView,
	getSaleHistoryView,
	createSale,
	voidSale,
	requestSaleVoid,
	getPendingSaleVoidRequestCount,
	declineSaleVoidRequest,
	getSaleVoidProof,
	updateSaleTransactionReference,
	correctSaleTransactionReference,
	getSaleSupportingDocument,
	archiveSale,
	restoreSale,
} = require('../controllers/saleController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { uploadSaleDocument } = require('../middleware/saleDocumentUploadMiddleware');
const { uploadSaleVoidProof } = require('../middleware/saleVoidProofUploadMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin'), listSales);
router.get('/history-view', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listSalesHistoryView);
router.get('/void-requests/pending-count', requireAuth, authorizeRoles('superadmin', 'admin'), getPendingSaleVoidRequestCount);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), createSale);
router.get('/:id/history-view', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSaleHistoryView);
router.post('/:id/void', requireAuth, authorizeRoles('superadmin', 'admin'), uploadSaleVoidProof, voidSale);
router.post('/:id/void-request', requireAuth, authorizeRoles('cashier'), uploadSaleVoidProof, requestSaleVoid);
router.patch('/:id/void-request/decline', requireAuth, authorizeRoles('superadmin', 'admin'), declineSaleVoidRequest);
router.get('/:id/void-proof', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSaleVoidProof);
router.patch('/:id/transaction-reference', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadSaleDocument, updateSaleTransactionReference);
router.patch('/:id/transaction-reference/correct', requireAuth, authorizeRoles('superadmin', 'admin'), uploadSaleDocument, correctSaleTransactionReference);
router.get('/:id/supporting-document', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSaleSupportingDocument);
router.patch('/:id/archive', requireAuth, authorizeRoles('superadmin', 'admin'), archiveSale);
router.patch('/:id/restore', requireAuth, authorizeRoles('superadmin', 'admin'), restoreSale);

module.exports = router;
