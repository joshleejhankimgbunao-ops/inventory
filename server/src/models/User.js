const mongoose = require('mongoose');

const preferencesSchema = new mongoose.Schema(
  {
    darkMode: {
      type: Boolean,
      default: false,
    },
    desktopNotifications: {
      type: Boolean,
      default: true,
    },
    hasViewedLogs: {
      type: Boolean,
      default: false,
    },
    readLogCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    pinHash: {
      type: String,
      select: false,
    },
    role: {
      type: String,
      enum: ['superadmin', 'admin', 'cashier'],
      default: 'cashier',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    passwordResetTokenHash: {
      type: String,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
    },
    passwordResetRequestedAt: {
      type: Date,
    },
    pinResetTokenHash: {
      type: String,
      select: false,
    },
    pinResetExpiresAt: {
      type: Date,
    },
    pinResetRequestedAt: {
      type: Date,
    },
    authRevokedAt: {
      type: Date,
    },
    preferences: {
      type: preferencesSchema,
      default: () => ({
        darkMode: false,
        desktopNotifications: true,
        hasViewedLogs: false,
        readLogCount: 0,
      }),
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);