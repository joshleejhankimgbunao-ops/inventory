const express = require('express');
const {
  listSpecialOrders,
  getSpecialOrderReceipt,
  createSpecialOrder,
  updateSpecialOrder,
  updateSpecialOrderStatus,
  getSpecialOrderStockAvailability,
  getSpecialOrderPayments,
  listSpecialOrderCollections,
  recordSpecialOrderDownPayment,
  recordSpecialOrderAdditionalPayment,
  getSpecialOrderPaymentProof,
  sourceSpecialOrderCustomItem,
  completeSpecialOrderProcessing,
  reserveSpecialOrderStock,
  releaseSpecialOrderStock,
  cancelReservedSpecialOrder,
  listSpecialOrderQuotations,
  getSpecialOrderQuotationDocument,
  getSpecialOrderQuotationImage,
  prepareSpecialOrderQuotation,
  updateSpecialOrderQuotation,
  uploadSpecialOrderQuotationImages,
  removeSpecialOrderQuotationImage,
  issueSpecialOrderQuotation,
  decideSpecialOrderQuotation,
  reviseSpecialOrderQuotation,
  finalizeSpecialOrder,
} = require('../controllers/specialOrderController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { uploadSaleDocument } = require('../middleware/saleDocumentUploadMiddleware');
const { uploadSpecialOrderQuotationImages: uploadQuotationImages, uploadInitialSpecialOrderQuotationImages } = require('../middleware/specialOrderQuotationImageUploadMiddleware');
const { uploadCreditPaymentProof, uploadSpecialOrderFinalPaymentEvidence } = require('../middleware/creditProofUploadMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listSpecialOrders);
router.get('/collections', requireAuth, authorizeRoles('superadmin'), listSpecialOrderCollections);
router.get('/:id/receipt', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSpecialOrderReceipt);
router.get('/:id/stock-availability', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSpecialOrderStockAvailability);
router.get('/:id/payments', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSpecialOrderPayments);
router.get('/:id/payments/:requestId/proofs/:index', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSpecialOrderPaymentProof);
router.post('/:id/payments/down-payment', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadCreditPaymentProof, recordSpecialOrderDownPayment);
router.post('/:id/payments', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadSpecialOrderFinalPaymentEvidence, recordSpecialOrderAdditionalPayment);
router.post('/:id/reservations', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), reserveSpecialOrderStock);
router.post('/:id/fulfillment/custom-sourcing', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), sourceSpecialOrderCustomItem);
router.post('/:id/complete', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadSaleDocument, completeSpecialOrderProcessing);
router.post('/:id/reservations/release', requireAuth, authorizeRoles('superadmin', 'admin'), releaseSpecialOrderStock);
router.post('/:id/cancel', requireAuth, authorizeRoles('superadmin', 'admin'), cancelReservedSpecialOrder);
router.get('/:id/quotations', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listSpecialOrderQuotations);
router.get('/:id/quotations/:quotationId/document', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSpecialOrderQuotationDocument);
router.get('/:id/quotations/:quotationId/items/:itemId/images/:imageKey', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSpecialOrderQuotationImage);
router.post('/:id/quotations', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), prepareSpecialOrderQuotation);
router.patch('/:id/quotations/:quotationId', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), updateSpecialOrderQuotation);
router.post('/:id/quotations/:quotationId/items/:itemId/images', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadQuotationImages, uploadSpecialOrderQuotationImages);
router.delete('/:id/quotations/:quotationId/items/:itemId/images/:imageKey', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), removeSpecialOrderQuotationImage);
router.post('/:id/quotations/:quotationId/issue', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), issueSpecialOrderQuotation);
router.post('/:id/quotations/:quotationId/decision', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), decideSpecialOrderQuotation);
router.post('/:id/quotations/:quotationId/revise', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), reviseSpecialOrderQuotation);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadInitialSpecialOrderQuotationImages, createSpecialOrder);
router.patch('/:id', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), updateSpecialOrder);
router.patch('/:id/status', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), updateSpecialOrderStatus);
router.post('/:id/finalize', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), uploadSaleDocument, finalizeSpecialOrder);

module.exports = router;
