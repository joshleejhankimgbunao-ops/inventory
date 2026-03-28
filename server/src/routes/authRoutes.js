const express = require('express');
const {
	login,
	register,
	me,
	verifyMyCurrentPassword,
	verifyMyCurrentPin,
	updateMyProfile,
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

const isPublicRegisterEnabled =
	process.env.ALLOW_PUBLIC_REGISTER === 'true' || process.env.NODE_ENV !== 'production';

if (isPublicRegisterEnabled) {
	router.post('/register', register);
} else {
	router.post('/register', requireAuth, authorizeRoles('superadmin'), register);
}
router.post('/login', login);
router.post('/forgot-password', forgotPasswordLimiter, requestPasswordReset);
router.post('/reset-password', resetPasswordLimiter, resetPassword);
router.post('/forgot-pin', forgotPinLimiter, requestPinReset);
router.post('/reset-pin', resetPinLimiter, resetPin);
router.get('/me', requireAuth, me);
router.post('/me/verify-password', requireAuth, verifyMyCurrentPassword);
router.post('/me/verify-pin', requireAuth, verifyMyCurrentPin);
router.patch('/me/profile', requireAuth, updateMyProfile);
router.patch('/me/email', requireAuth, updateMyEmail);
router.patch('/users/:username', requireAuth, authorizeRoles('superadmin', 'admin'), updateUserByUsername);

module.exports = router;
