const express = require('express');
const { getSettings, updateSettings } = require('../controllers/settingController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', getSettings);
router.patch('/', requireAuth, authorizeRoles('superadmin', 'admin'), updateSettings);

module.exports = router;
