const jwt = require('jsonwebtoken');
const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized: missing token.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Unauthorized: invalid user.' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized: invalid token.' });
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
  authorizeRoles,
};
