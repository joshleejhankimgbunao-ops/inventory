require('dotenv').config({ quiet: true });

const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');

const username = 'owner';
const pin = '111111'; // default PIN to set; change if you prefer

(async () => {
  try {
    await connectDB();

    const user = await User.findOne({ username }).select('+pinHash');
    if (!user) {
      console.error(`USER_NOT_FOUND: username='${username}'`);
      return process.exit(1);
    }

    user.pinHash = await bcrypt.hash(pin, 10);
    await user.save({ validateBeforeSave: false });

    console.log(`PIN_SET: username='${username}' pin='${pin}'`);
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message || err);
    process.exit(2);
  }
})();
