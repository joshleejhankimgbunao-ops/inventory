const rateLimit = require('express-rate-limit');

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const createLimiter = ({ max, windowMinutes }) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many requests. Please try again later.',
    },
  });
};

const forgotWindowMinutes = parsePositiveInteger(process.env.AUTH_FORGOT_WINDOW_MINUTES, 15);
const forgotMaxAttempts = parsePositiveInteger(process.env.AUTH_FORGOT_MAX_ATTEMPTS, 5);
const resetWindowMinutes = parsePositiveInteger(process.env.AUTH_RESET_WINDOW_MINUTES, 15);
const resetMaxAttempts = parsePositiveInteger(process.env.AUTH_RESET_MAX_ATTEMPTS, 10);

const forgotPasswordLimiter = createLimiter({
  max: forgotMaxAttempts,
  windowMinutes: forgotWindowMinutes,
});

const forgotPinLimiter = createLimiter({
  max: forgotMaxAttempts,
  windowMinutes: forgotWindowMinutes,
});

const resetPasswordLimiter = createLimiter({
  max: resetMaxAttempts,
  windowMinutes: resetWindowMinutes,
});

const resetPinLimiter = createLimiter({
  max: resetMaxAttempts,
  windowMinutes: resetWindowMinutes,
});

module.exports = {
  forgotPasswordLimiter,
  forgotPinLimiter,
  resetPasswordLimiter,
  resetPinLimiter,
};
