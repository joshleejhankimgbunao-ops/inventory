const express = require('express');
const {
  listSpecialOrders,
  createSpecialOrder,
  updateSpecialOrder,
  updateSpecialOrderStatus,
  completeSpecialOrder,
} = require('../controllers/specialOrderController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listSpecialOrders);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), createSpecialOrder);
router.patch('/:id', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), updateSpecialOrder);
router.patch('/:id/status', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), updateSpecialOrderStatus);
router.patch('/:id/complete', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), completeSpecialOrder);

module.exports = router;
