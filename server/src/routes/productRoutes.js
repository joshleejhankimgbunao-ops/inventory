const express = require('express');
const { addProductRecommendation, createProduct, listProducts, removeProductRecommendation, updateProduct } = require('../controllers/productController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, listProducts);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin'), createProduct);
router.post('/:id/recommendations', requireAuth, authorizeRoles('superadmin', 'admin'), addProductRecommendation);
router.delete('/:id/recommendations/:alternativeCode', requireAuth, authorizeRoles('superadmin', 'admin'), removeProductRecommendation);
router.patch('/:id', requireAuth, authorizeRoles('superadmin', 'admin'), updateProduct);

module.exports = router;
