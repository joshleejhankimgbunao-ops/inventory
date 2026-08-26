const express = require('express');
const {
	getSettings,
	updateSettings,
	getSystemBackup,
	restoreSystemBackup,
	getAutomaticBackupHistory,
	downloadAutomaticBackup,
	downloadLatestAutomaticBackup,
} = require('../controllers/settingController');
const { requireAuth, optionalAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', optionalAuth, getSettings);
router.patch('/', requireAuth, authorizeRoles('superadmin', 'admin'), updateSettings);
router.get('/backup', requireAuth, authorizeRoles('superadmin'), getSystemBackup);
router.post('/restore', requireAuth, authorizeRoles('superadmin'), restoreSystemBackup);
router.get('/automatic-backups', requireAuth, authorizeRoles('superadmin'), getAutomaticBackupHistory);
router.get('/automatic-backups/latest/download', requireAuth, authorizeRoles('superadmin'), downloadLatestAutomaticBackup);
router.get('/automatic-backups/:fileName/download', requireAuth, authorizeRoles('superadmin'), downloadAutomaticBackup);

module.exports = router;
