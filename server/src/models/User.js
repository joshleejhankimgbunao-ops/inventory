const mongoose = require('mongoose');

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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);
