const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendResetEmail } = require('../services/emailService');
const { writeActivityLog } = require('../services/logService');

const RESET_RESPONSE_MESSAGE = 'If the account exists, a reset link has been sent.';

const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);
const PIN_RESET_TTL_MINUTES = Number(process.env.PIN_RESET_TTL_MINUTES || 30);
const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH || 8);
const PIN_LENGTH = Number(process.env.PIN_LENGTH || 6);

const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
};

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  username: user.username,
  email: user.email,
  phone: user.phone || '',
  avatarUrl: user.avatarUrl || '',
  preferences: {
    darkMode: Boolean(user.preferences?.darkMode),
    desktopNotifications: user.preferences?.desktopNotifications !== false,
    hasViewedLogs: Boolean(user.preferences?.hasViewedLogs),
    readLogCount: Number(user.preferences?.readLogCount || 0),
  },
  role: user.role,
  isActive: user.isActive,
  lastLogin: user.lastLogin,
});

const normalizeValue = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
};

const hashToken = (rawToken) => {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

const createResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');

  return {
    rawToken,
    tokenHash: hashToken(rawToken),
  };
};

const getResetBaseUrl = () => {
  return process.env.RESET_URL_BASE || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
};

const buildResetUrl = (purpose, rawToken) => {
  const path = purpose === 'pin'
    ? (process.env.PIN_RESET_PATH || '/reset-pin')
    : (process.env.PASSWORD_RESET_PATH || '/reset-password');

  const resetUrl = new URL(path, getResetBaseUrl());
  resetUrl.searchParams.set('token', rawToken);

  return resetUrl.toString();
};

const isValidPassword = (password) => {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return false;
  }

  return /[A-Za-z]/.test(password) && /\d/.test(password);
};

const isValidPin = (pin) => {
  if (typeof pin !== 'string') {
    return false;
  }

  const pinRegex = new RegExp(`^\\d{${PIN_LENGTH}}$`);
  return pinRegex.test(pin);
};

const isValidEmail = (email) => {
  if (typeof email !== 'string') {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidPhone = (phone) => {
  if (typeof phone !== 'string') {
    return false;
  }

  const digits = phone.replace(/\D/g, '');
  return digits.length === 11;
};

const sanitizePreferencesPayload = (raw = {}) => {
  const output = {};

  if (raw.darkMode !== undefined) {
    output.darkMode = Boolean(raw.darkMode);
  }

  if (raw.desktopNotifications !== undefined) {
    output.desktopNotifications = Boolean(raw.desktopNotifications);
  }

  if (raw.hasViewedLogs !== undefined) {
    output.hasViewedLogs = Boolean(raw.hasViewedLogs);
  }

  if (raw.readLogCount !== undefined) {
    const count = Number(raw.readLogCount);
    if (!Number.isFinite(count) || count < 0) {
      return { error: 'preferences.readLogCount must be a non-negative number.' };
    }
    output.readLogCount = Math.floor(count);
  }

  return { value: output };
};

const updateMyEmail = async (req, res, next) => {
  try {
    const normalizedEmail = normalizeValue(req.body?.email);

    if (!normalizedEmail) {
      return res.status(400).json({ message: 'email is required.' });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: req.user._id },
    });

    if (existingUser) {
      return res.status(409).json({ message: 'Email already in use by another account.' });
    }

    req.user.email = normalizedEmail;
    await req.user.save({ validateBeforeSave: false });

    return res.json({
      message: 'Account email updated.',
      user: sanitizeUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
};

const updateMyProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+password +pinHash');

    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const nextName = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : user.name;
    const nextUsername = req.body?.username ? normalizeValue(req.body.username) : user.username;
    const nextEmail = req.body?.email ? normalizeValue(req.body.email) : user.email;
    const nextPhone = req.body?.phone !== undefined ? String(req.body.phone).trim() : user.phone;
    const nextAvatarUrl = req.body?.avatarUrl !== undefined ? String(req.body.avatarUrl).trim() : user.avatarUrl;

    if (!nextUsername) {
      return res.status(400).json({ message: 'username is required.' });
    }

    if (!nextEmail || !isValidEmail(nextEmail)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    if (nextPhone && !isValidPhone(nextPhone)) {
      return res.status(400).json({ message: 'phone number must be exactly 11 digits.' });
    }

    const duplicate = await User.findOne({
      _id: { $ne: user._id },
      $or: [{ username: nextUsername }, { email: nextEmail }],
    });

    if (duplicate) {
      return res.status(409).json({ message: 'Username or email already in use.' });
    }

    const hasNewPassword = typeof req.body?.newPassword === 'string' && req.body.newPassword.length > 0;
    if (hasNewPassword) {
      if (!isValidPassword(req.body.newPassword)) {
        return res.status(400).json({
          message: `newPassword must be at least ${PASSWORD_MIN_LENGTH} characters and include letters and numbers.`,
        });
      }

      if (typeof req.body?.currentPassword !== 'string' || !req.body.currentPassword) {
        return res.status(400).json({ message: 'currentPassword is required to set a new password.' });
      }

      const passwordMatched = await bcrypt.compare(req.body.currentPassword, user.password);
      if (!passwordMatched) {
        return res.status(401).json({ message: 'Current password is incorrect.' });
      }

      user.password = await bcrypt.hash(req.body.newPassword, 10);
      user.authRevokedAt = new Date();
    }

    const hasNewPin = req.body?.newPin !== undefined && req.body?.newPin !== null && String(req.body.newPin) !== '';
    if (hasNewPin) {
      const nextPin = String(req.body.newPin);
      if (!isValidPin(nextPin)) {
        return res.status(400).json({ message: `newPin must be exactly ${PIN_LENGTH} digits.` });
      }

      if (req.body?.currentPin === undefined || req.body?.currentPin === null || String(req.body.currentPin) === '') {
        return res.status(400).json({ message: 'currentPin is required to set a new PIN.' });
      }

      if (!user.pinHash) {
        return res.status(400).json({ message: 'Current PIN is not set for this account.' });
      }

      const pinMatched = await bcrypt.compare(String(req.body.currentPin), user.pinHash);
      if (!pinMatched) {
        return res.status(401).json({ message: 'Current PIN is incorrect.' });
      }

      user.pinHash = await bcrypt.hash(nextPin, 10);
      user.authRevokedAt = new Date();
    }

    user.name = nextName;
    user.username = nextUsername;
    user.email = nextEmail;
  user.phone = nextPhone;
  user.avatarUrl = nextAvatarUrl;

    await user.save({ validateBeforeSave: false });

    return res.json({
      message: 'Profile updated.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

const verifyMyCurrentPassword = async (req, res, next) => {
  try {
    const currentPassword = req.body?.currentPassword;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ message: 'currentPassword is required.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    return res.json({ valid });
  } catch (error) {
    return next(error);
  }
};

const verifyMyCurrentPin = async (req, res, next) => {
  try {
    const currentPin = req.body?.currentPin;

    if (currentPin === undefined || currentPin === null || String(currentPin) === '') {
      return res.status(400).json({ message: 'currentPin is required.' });
    }

    const user = await User.findById(req.user._id).select('+pinHash');
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (!user.pinHash) {
      return res.json({ valid: false });
    }

    const valid = await bcrypt.compare(String(currentPin), user.pinHash);
    return res.json({ valid });
  } catch (error) {
    return next(error);
  }
};

const updateUserByUsername = async (req, res, next) => {
  try {
    const targetUsername = normalizeValue(req.params?.username);

    if (!targetUsername) {
      return res.status(400).json({ message: 'username parameter is required.' });
    }

    const user = await User.findOne({ username: targetUsername }).select('+password +pinHash');
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const nextUsername = req.body?.username ? normalizeValue(req.body.username) : user.username;
    const nextEmail = req.body?.email ? normalizeValue(req.body.email) : user.email;

    if (!nextUsername) {
      return res.status(400).json({ message: 'username is required.' });
    }

    if (!nextEmail || !isValidEmail(nextEmail)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const duplicate = await User.findOne({
      _id: { $ne: user._id },
      $or: [{ username: nextUsername }, { email: nextEmail }],
    });

    if (duplicate) {
      return res.status(409).json({ message: 'Username or email already in use.' });
    }

    user.name = req.body?.name || user.name;
    user.username = nextUsername;
    user.email = nextEmail;

    if (req.body?.phone !== undefined) {
      const normalizedPhone = String(req.body.phone).trim();
      if (normalizedPhone && !isValidPhone(normalizedPhone)) {
        return res.status(400).json({ message: 'phone number must be exactly 11 digits.' });
      }
      user.phone = normalizedPhone;
    }

    if (req.body?.avatarUrl !== undefined) {
      user.avatarUrl = String(req.body.avatarUrl).trim();
    }

    if (req.body?.preferences !== undefined && req.body?.preferences !== null) {
      const { value, error } = sanitizePreferencesPayload(req.body.preferences);
      if (error) {
        return res.status(400).json({ message: error });
      }

      user.preferences = {
        ...(user.preferences || {}),
        ...value,
      };
    }

    if (req.body?.role) {
      user.role = req.body.role;
    }

    if (typeof req.body?.isActive === 'boolean') {
      user.isActive = req.body.isActive;
    }

    if (req.body?.password) {
      if (!isValidPassword(req.body.password)) {
        return res.status(400).json({
          message: `password must be at least ${PASSWORD_MIN_LENGTH} characters and include letters and numbers.`,
        });
      }
      user.password = await bcrypt.hash(req.body.password, 10);
    }

    if (req.body?.pin !== undefined && req.body?.pin !== null && req.body?.pin !== '') {
      const pinValue = String(req.body.pin);
      if (!isValidPin(pinValue)) {
        return res.status(400).json({ message: `pin must be exactly ${PIN_LENGTH} digits.` });
      }
      user.pinHash = await bcrypt.hash(pinValue, 10);
    }

    await user.save({ validateBeforeSave: false });

    return res.json({
      message: 'User updated.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    return res.json(users.map(sanitizeUser));
  } catch (error) {
    return next(error);
  }
};

const getCredentialByIdentifier = (identifier) => {
  if (identifier.includes('@')) {
    return { email: identifier };
  }

  return { username: identifier };
};

const requestReset = async ({ req, res, next, purpose }) => {
  try {
    const resetEmail = normalizeValue(req.body?.email || req.body?.identifier);

    if (!resetEmail) {
      return res.status(400).json({ message: 'email is required.' });
    }

    if (!isValidEmail(resetEmail)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const user = await User.findOne({ email: resetEmail });

    if (user && user.isActive && user.email) {
      const { rawToken, tokenHash } = createResetToken();
      const expiresMinutes = purpose === 'pin' ? PIN_RESET_TTL_MINUTES : PASSWORD_RESET_TTL_MINUTES;
      const expiresAt = new Date(Date.now() + (expiresMinutes * 60 * 1000));

      if (purpose === 'pin') {
        user.pinResetTokenHash = tokenHash;
        user.pinResetExpiresAt = expiresAt;
        user.pinResetRequestedAt = new Date();
      } else {
        user.passwordResetTokenHash = tokenHash;
        user.passwordResetExpiresAt = expiresAt;
        user.passwordResetRequestedAt = new Date();
      }

      await user.save({ validateBeforeSave: false });

      try {
        await sendResetEmail({
          to: user.email,
          purpose,
          resetUrl: buildResetUrl(purpose, rawToken),
          expiresMinutes,
          recipientName: user.name,
        });
      } catch (mailError) {
        // If email cannot be delivered, invalidate the token and avoid leaking transport details to clients.
        if (purpose === 'pin') {
          user.pinResetTokenHash = undefined;
          user.pinResetExpiresAt = undefined;
          user.pinResetRequestedAt = undefined;
        } else {
          user.passwordResetTokenHash = undefined;
          user.passwordResetExpiresAt = undefined;
          user.passwordResetRequestedAt = undefined;
        }

        await user.save({ validateBeforeSave: false });
        console.warn(`[RESET EMAIL ERROR] Unable to deliver ${purpose} reset email to ${user.email}: ${mailError.message}`);
      }
    }

    return res.json({ message: RESET_RESPONSE_MESSAGE });
  } catch (error) {
    return next(error);
  }
};

const register = async (req, res, next) => {
  try {
    const {
      name,
      username,
      email,
      password,
      pin,
      role,
      phone,
      avatarUrl,
      preferences,
    } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: 'name, username, email, and password are required.' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: `password must be at least ${PASSWORD_MIN_LENGTH} characters and include letters and numbers.`,
      });
    }

    if (pin && !isValidPin(pin)) {
      return res.status(400).json({ message: `pin must be exactly ${PIN_LENGTH} digits.` });
    }

    const normalizedPhone = phone !== undefined && phone !== null ? String(phone).trim() : '';
    if (normalizedPhone && !isValidPhone(normalizedPhone)) {
      return res.status(400).json({ message: 'phone number must be exactly 11 digits.' });
    }

    const normalizedUsername = normalizeValue(username);
    const normalizedEmail = normalizeValue(email);

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const lookup = [{ username: normalizedUsername }];

    lookup.push({ email: normalizedEmail });

    const existing = await User.findOne({ $or: lookup });
    if (existing) {
      return res.status(409).json({ message: 'Username or email already exists.' });
    }

    const requestedRole = normalizeValue(role);
    const isSuperadminCreator = req.user?.role === 'superadmin';
    let assignedRole = 'cashier';

    if (isSuperadminCreator && ['admin', 'cashier'].includes(requestedRole)) {
      assignedRole = requestedRole;
    }

    const hashed = await bcrypt.hash(password, 10);
    const normalizedPreferencesResult = sanitizePreferencesPayload(preferences || {});
    if (normalizedPreferencesResult.error) {
      return res.status(400).json({ message: normalizedPreferencesResult.error });
    }

    const user = await User.create({
      name,
      username: normalizedUsername,
      email: normalizedEmail,
      phone: normalizedPhone,
      avatarUrl: avatarUrl ? String(avatarUrl).trim() : '',
      password: hashed,
      pinHash: pin ? await bcrypt.hash(pin, 10) : undefined,
      role: assignedRole,
      preferences: normalizedPreferencesResult.value,
    });

    const token = signToken(user._id);
    return res.status(201).json({
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { username, password, pin } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required.' });
    }

    const normalizedIdentifier = normalizeValue(username);
    const query = getCredentialByIdentifier(normalizedIdentifier);
    const user = await User.findOne(query).select('+password +pinHash');

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const matched = await bcrypt.compare(password, user.password);
    if (!matched) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (user.pinHash) {
      if (!pin) {
        return res.json({
          requiresPin: true,
          message: 'PIN verification required.',
        });
      }

      const pinMatched = await bcrypt.compare(String(pin), user.pinHash);
      if (!pinMatched) {
        return res.status(401).json({ message: 'Invalid PIN.' });
      }
    }

    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    await writeActivityLog({
      user,
      action: 'Logged In',
      details: 'Successful username/password login.',
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    const token = signToken(user._id);
    return res.json({
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

const me = async (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
};

const updateMyPreferences = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const { value, error } = sanitizePreferencesPayload(req.body || {});
    if (error) {
      return res.status(400).json({ message: error });
    }

    if (Object.keys(value).length === 0) {
      return res.status(400).json({ message: 'No valid preferences fields provided.' });
    }

    user.preferences = {
      ...(user.preferences || {}),
      ...value,
    };

    await user.save({ validateBeforeSave: false });

    return res.json({
      message: 'Preferences updated.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

const requestPasswordReset = async (req, res, next) => {
  return requestReset({ req, res, next, purpose: 'password' });
};

const requestPinReset = async (req, res, next) => {
  return requestReset({ req, res, next, purpose: 'pin' });
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'token and newPassword are required.' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        message: `newPassword must be at least ${PASSWORD_MIN_LENGTH} characters and include letters and numbers.`,
      });
    }

    const tokenHash = hashToken(token);
    const now = new Date();
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: now },
      isActive: true,
    }).select('+password');

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    user.passwordResetRequestedAt = undefined;
    user.authRevokedAt = now;
    await user.save();

    return res.json({ message: 'Password reset successful.' });
  } catch (error) {
    return next(error);
  }
};

const resetPin = async (req, res, next) => {
  try {
    const { token, newPin } = req.body;

    if (!token || !newPin) {
      return res.status(400).json({ message: 'token and newPin are required.' });
    }

    if (!isValidPin(newPin)) {
      return res.status(400).json({ message: `newPin must be exactly ${PIN_LENGTH} digits.` });
    }

    const tokenHash = hashToken(token);
    const now = new Date();
    const user = await User.findOne({
      pinResetTokenHash: tokenHash,
      pinResetExpiresAt: { $gt: now },
      isActive: true,
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    user.pinHash = await bcrypt.hash(newPin, 10);
    user.pinResetTokenHash = undefined;
    user.pinResetExpiresAt = undefined;
    user.pinResetRequestedAt = undefined;
    user.authRevokedAt = now;
    await user.save({ validateBeforeSave: false });

    return res.json({ message: 'PIN reset successful.' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  me,
  updateMyPreferences,
  verifyMyCurrentPassword,
  verifyMyCurrentPin,
  updateMyProfile,
  updateMyEmail,
  listUsers,
  updateUserByUsername,
  requestPasswordReset,
  resetPassword,
  requestPinReset,
  resetPin,
};
