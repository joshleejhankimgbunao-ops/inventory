const express = require('express');
const { createProduct, listProducts, updateProduct } = require('../controllers/productController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, listProducts);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin'), createProduct);
router.patch('/:id', requireAuth, authorizeRoles('superadmin', 'admin'), updateProduct);

module.exports = router;
