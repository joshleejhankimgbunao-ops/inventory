const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/security');

const resolveUserFromAuthorizationHeader = async (authHeader = '') => {
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return null;
  }

  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  const user = await User.findById(decoded.id).select('-password');

  if (!user || !user.isActive) {
    return null;
  }

  if (user.authRevokedAt) {
    const tokenIssuedAtMs = Number(decoded.iat || 0) * 1000;
    if (!tokenIssuedAtMs || tokenIssuedAtMs <= user.authRevokedAt.getTime()) {
      return null;
    }
  }

  return user;
};

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: missing token.' });
    }

    const user = await resolveUserFromAuthorizationHeader(authHeader);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized: invalid user.' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized: invalid token.' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return next();
    }

    const user = await resolveUserFromAuthorizationHeader(authHeader);
    if (user) {
      req.user = user;
    }

    return next();
  } catch {
    // Intentionally ignore invalid optional auth and continue as anonymous.
    return next();
  }
};

const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden: insufficient role.' });
  }

  return next();
};

module.exports = {
  requireAuth,
  optionalAuth,
  authorizeRoles,
};
