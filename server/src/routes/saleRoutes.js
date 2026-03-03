const express = require('express');
const { listSales, createSale } = require('../controllers/saleController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin'), listSales);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), createSale);

module.exports = router;
