const express = require('express');
const {
	login,
	register,
	me,
	updateMyEmail,
	updateUserByUsername,
	requestPasswordReset,
	resetPassword,
	requestPinReset,
	resetPin,
} = require('../controllers/authController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const {
	forgotPasswordLimiter,
	forgotPinLimiter,
	resetPasswordLimiter,
	resetPinLimiter,
} = require('../middleware/authRateLimitMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPasswordLimiter, requestPasswordReset);
router.post('/reset-password', resetPasswordLimiter, resetPassword);
router.post('/forgot-pin', forgotPinLimiter, requestPinReset);
router.post('/reset-pin', resetPinLimiter, resetPin);
router.get('/me', requireAuth, me);
router.patch('/me/email', requireAuth, updateMyEmail);
router.patch('/users/:username', requireAuth, authorizeRoles('superadmin', 'admin'), updateUserByUsername);

module.exports = router;
