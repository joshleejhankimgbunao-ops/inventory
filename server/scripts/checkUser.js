require('dotenv').config({ quiet: true });

const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');

const usernameToCheck = 'owner';
const passwordToCheck = 'owner123';

const run = async () => {
  try {
    await connectDB();
    const user = await User.findOne({ username: usernameToCheck }).select('+password');

    if (!user) {
      console.log(`USER_NOT_FOUND: username='${usernameToCheck}'`);
      return process.exit(0);
    }

    const passwordMatches = await bcrypt.compare(passwordToCheck, user.password);

    console.log('USER_FOUND');
    console.log(`username: ${user.username}`);
    console.log(`name: ${user.name}`);
    console.log(`role: ${user.role}`);
    console.log(`isActive: ${user.isActive}`);
    console.log(`passwordMatches: ${passwordMatches}`);

    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message || err);
    process.exit(2);
  }
};

run();
