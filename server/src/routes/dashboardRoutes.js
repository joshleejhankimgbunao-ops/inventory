const express = require('express');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { getStockMovement } = require('../services/stockMovement');

const router = express.Router();
router.get('/stock-movement', requireAuth, authorizeRoles('superadmin', 'admin'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(await getStockMovement(req.query));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
});
module.exports = router;
