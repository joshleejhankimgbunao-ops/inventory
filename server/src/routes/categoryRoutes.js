const express = require('express');
const router = express.Router();
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');

router.route('/')
  .get(requireAuth, getCategories)
  .post(requireAuth, authorizeRoles('superadmin', 'admin'), createCategory);

router.route('/:id')
  .put(requireAuth, authorizeRoles('superadmin', 'admin'), updateCategory)
  .delete(requireAuth, authorizeRoles('superadmin', 'admin'), deleteCategory);

module.exports = router;