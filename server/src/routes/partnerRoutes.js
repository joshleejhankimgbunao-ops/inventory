const express = require('express');
const {
  listPartners,
  createPartner,
  updatePartner,
  archivePartner,
  restorePartner,
} = require('../controllers/partnerController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, listPartners);
router.post('/', requireAuth, authorizeRoles('superadmin', 'admin'), createPartner);
router.patch('/:id', requireAuth, authorizeRoles('superadmin', 'admin'), updatePartner);
router.patch('/:id/archive', requireAuth, authorizeRoles('superadmin', 'admin'), archivePartner);
router.patch('/:id/restore', requireAuth, authorizeRoles('superadmin', 'admin'), restorePartner);

module.exports = router;
