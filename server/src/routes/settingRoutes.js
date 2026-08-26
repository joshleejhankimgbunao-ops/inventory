const express = require('express');
const {
	getSettings,
	updateSettings,
	getSystemBackup,
	restoreSystemBackup,
} = require('../controllers/settingController');
const { requireAuth, optionalAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', optionalAuth, getSettings);
router.patch('/', requireAuth, authorizeRoles('superadmin', 'admin'), updateSettings);
router.get('/backup', requireAuth, authorizeRoles('superadmin'), getSystemBackup);
router.post('/restore', requireAuth, authorizeRoles('superadmin'), restoreSystemBackup);

module.exports = router;
