/* global require, module */
const express = require('express');
const { addProductRecommendation, editProductRecommendationBasis, archiveSelectedVariants, createProduct, correctExpiryBatchDate, listExpiryBatches, listExpiryBatchMonitoring, reconcileProductExpiryBatches, verifyExpiryBatchesAndAddStock, listProducts, removeProductRecommendation, updateProduct, updateProductStock } = require('../controllers/productController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { listActiveRecommendationProducts, reviewProductRecommendation } = require('../controllers/recommendationController');

const router = express.Router();

router.get('/', requireAuth, listProducts);
router.get('/recommendations/active', requireAuth, listActiveRecommendationProducts);
router.get('/expiry-batches/monitoring', requireAuth, listExpiryBatchMonitoring);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin'), createProduct);
router.get('/:id/expiry-batches', requireAuth, listExpiryBatches);
router.patch('/:id/expiry-batches/:batchId/correct-expiry', requireAuth, authorizeRoles('superadmin', 'admin'), correctExpiryBatchDate);
router.post('/:id/expiry-batches/reconcile', requireAuth, authorizeRoles('superadmin', 'admin'), reconcileProductExpiryBatches);
router.post('/:id/expiry-batches/verify-stock-in', requireAuth, authorizeRoles('superadmin', 'admin'), verifyExpiryBatchesAndAddStock);
router.post('/:id/recommendations', requireAuth, authorizeRoles('superadmin', 'admin'), addProductRecommendation);
router.patch('/:id/recommendations/:candidateId/basis', requireAuth, authorizeRoles('superadmin', 'admin'), editProductRecommendationBasis);
router.patch('/:id/recommendations/:candidateId/review', requireAuth, authorizeRoles('superadmin', 'admin'), reviewProductRecommendation);
router.delete('/:id/recommendations/:alternativeCode', requireAuth, authorizeRoles('superadmin', 'admin'), removeProductRecommendation);
router.patch('/:id/stock', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), updateProductStock);
router.patch('/family/:id/archive-selected', requireAuth, authorizeRoles('superadmin', 'admin'), archiveSelectedVariants);
router.patch('/:id', requireAuth, authorizeRoles('superadmin', 'admin'), updateProduct);

module.exports = router;
