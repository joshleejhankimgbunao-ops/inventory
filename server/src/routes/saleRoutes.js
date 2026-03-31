const express = require('express');
const {
	listSales,
	listSalesHistoryView,
	createSale,
	archiveSale,
	restoreSale,
} = require('../controllers/saleController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin'), listSales);
router.get('/history-view', requireAuth, authorizeRoles('superadmin', 'admin'), listSalesHistoryView);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), createSale);
router.patch('/:id/archive', requireAuth, authorizeRoles('superadmin', 'admin'), archiveSale);
router.patch('/:id/restore', requireAuth, authorizeRoles('superadmin', 'admin'), restoreSale);

module.exports = router;
