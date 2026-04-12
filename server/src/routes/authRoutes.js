const express = require('express');
const {
	login,
	register,
	me,
	updateMyPreferences,
	verifyMyCurrentPassword,
	verifyMyCurrentPin,
	updateMyProfile,
	updateMyEmail,
	listUsers,
	updateUserByUsername,
	deleteUserByUsername,
	requestPasswordReset,
	resetPassword,
	requestPinReset,
	resetPin,
} = require('../controllers/authController');
const { requireAuth, optionalAuth, authorizeRoles } = require('../middleware/authMiddleware');
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
	router.post('/register', optionalAuth, register);
} else {
	router.post('/register', requireAuth, authorizeRoles('superadmin'), register);
}
router.post('/login', login);
router.post('/forgot-password', forgotPasswordLimiter, requestPasswordReset);
router.post('/reset-password', resetPasswordLimiter, resetPassword);
router.post('/forgot-pin', forgotPinLimiter, requestPinReset);
router.post('/reset-pin', resetPinLimiter, resetPin);
router.get('/me', requireAuth, me);
router.patch('/me/preferences', requireAuth, updateMyPreferences);
router.post('/me/verify-password', requireAuth, verifyMyCurrentPassword);
router.post('/me/verify-pin', requireAuth, verifyMyCurrentPin);
router.patch('/me/profile', requireAuth, updateMyProfile);
router.patch('/me/email', requireAuth, updateMyEmail);
router.get('/users', requireAuth, authorizeRoles('superadmin', 'admin'), listUsers);
router.patch('/users/:username', requireAuth, authorizeRoles('superadmin', 'admin'), updateUserByUsername);
router.delete('/users/:username', requireAuth, authorizeRoles('superadmin', 'admin'), deleteUserByUsername);

module.exports = router;
