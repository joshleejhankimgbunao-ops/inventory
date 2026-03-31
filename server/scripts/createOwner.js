require('dotenv').config({ quiet: true });

const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');

const username = 'owner';
const plainPassword = 'owner123';

(async () => {
  try {
    await connectDB();

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    let user = await User.findOne({ username }).select('+password');

    if (user) {
      user.password = hashedPassword;
      user.role = 'superadmin';
      user.isActive = true;
      await user.save();
      console.log(`UPDATED_EXISTING: username='${username}'`);
      console.log(`name: ${user.name}`);
      return process.exit(0);
    }

    user = await User.create({
      name: 'Owner',
      username,
      email: 'owner@example.local',
      password: hashedPassword,
      role: 'superadmin',
      isActive: true,
    });

    console.log(`CREATED: username='${username}' id='${user._id}'`);
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message || err);
    process.exit(1);
  }
})();
