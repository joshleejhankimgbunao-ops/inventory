const express = require('express');
const {
	listSales,
	listSalesHistoryView,
	getSaleHistoryView,
	createSale,
	voidSale,
	archiveSale,
	restoreSale,
} = require('../controllers/saleController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin'), listSales);
router.get('/history-view', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listSalesHistoryView);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), createSale);
router.get('/:id/history-view', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), getSaleHistoryView);
router.post('/:id/void', requireAuth, authorizeRoles('superadmin', 'admin'), voidSale);
router.patch('/:id/archive', requireAuth, authorizeRoles('superadmin', 'admin'), archiveSale);
router.patch('/:id/restore', requireAuth, authorizeRoles('superadmin', 'admin'), restoreSale);

module.exports = router;
