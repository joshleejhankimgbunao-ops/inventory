const express = require('express');
const { listActivityLogs, listInventoryLogs, getActivityUnreadCount, markActivityLogsRead } = require('../controllers/logController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/activity', requireAuth, authorizeRoles('superadmin', 'admin'), listActivityLogs);
router.get('/activity/unread-count', requireAuth, authorizeRoles('superadmin', 'admin'), getActivityUnreadCount);
router.post('/activity/mark-read', requireAuth, authorizeRoles('superadmin', 'admin'), markActivityLogsRead);
router.get('/inventory', requireAuth, authorizeRoles('superadmin', 'admin', 'cashier'), listInventoryLogs);

module.exports = router;
