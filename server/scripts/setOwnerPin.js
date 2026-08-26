require('dotenv').config({ quiet: true });

const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');
const { requireExplicitEnv, requireExplicitPinEnv } = require('../src/config/security');

(async () => {
  try {
    const username = requireExplicitEnv('SEED_SUPERADMIN_USERNAME').trim().toLowerCase();
    const pin = requireExplicitPinEnv('SEED_SUPERADMIN_PIN');
    await connectDB();

    const user = await User.findOne({ username }).select('+pinHash');
    if (!user) {
      console.error(`USER_NOT_FOUND: username='${username}'`);
      return process.exit(1);
    }

    if (user.role !== 'superadmin') {
      console.error('REFUSED: the selected account is not a Super Admin.');
      return process.exit(1);
    }

    user.pinHash = await bcrypt.hash(pin, 10);
    await user.save({ validateBeforeSave: false });

    console.log('PIN updated successfully.');
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message || err);
    process.exit(2);
  }
})();
