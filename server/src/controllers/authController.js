const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
};

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  username: user.username,
  role: user.role,
  isActive: user.isActive,
});

const register = async (req, res, next) => {
  try {
    const { name, username, password, role } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ message: 'name, username, and password are required.' });
    }

    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      username,
      password: hashed,
      role,
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
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required.' });
    }

    const user = await User.findOne({ username: username.toLowerCase() }).select('+password');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const matched = await bcrypt.compare(password, user.password);
    if (!matched) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

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

module.exports = {
  register,
  login,
  me,
};
