const express = require('express');
const User = require('../models/User');
const { createTicket, streamEvents } = require('../controllers/realtimeController');
const { requireAuth, authorizeRoles } = require('../middleware/authMiddleware');
const { consumeStreamTicket } = require('../services/realtimeService');

const router = express.Router();

const authenticateStreamTicket = async (req, res, next) => {
  try {
    // The former primary-JWT query parameter is deliberately not accepted.
    if (req.query?.token) {
      return res.status(400).json({ message: 'Use a realtime stream token.' });
    }

    const ticket = consumeStreamTicket(req.query?.streamToken);
    if (!ticket) {
      return res.status(401).json({ message: 'Unauthorized: invalid or expired realtime token.' });
    }

    const user = await User.findById(ticket.userId).select('-password');
    const sessionWasRevoked = user?.authRevokedAt
      && (!ticket.authIssuedAtMs || ticket.authIssuedAtMs <= user.authRevokedAt.getTime());

    if (!user || !user.isActive || sessionWasRevoked) {
      return res.status(401).json({ message: 'Unauthorized: invalid realtime session.' });
    }

    req.user = user;
    req.realtimeSession = ticket;
    return next();
  } catch (error) {
    return next(error);
  }
};

router.post(
  '/ticket',
  requireAuth,
  authorizeRoles('superadmin', 'admin', 'cashier'),
  createTicket
);

router.get(
  '/stream',
  authenticateStreamTicket,
  authorizeRoles('superadmin', 'admin', 'cashier'),
  streamEvents
);

module.exports = router;
