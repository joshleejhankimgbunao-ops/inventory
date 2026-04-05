const express = require('express');
const { listActivityLogs, listInventoryLogs } = require('../controllers/logController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/activity', requireAuth, authorizeRoles('superadmin', 'admin'), listActivityLogs);
router.get('/inventory', requireAuth, authorizeRoles('superadmin', 'admin'), listInventoryLogs);

module.exports = router;
