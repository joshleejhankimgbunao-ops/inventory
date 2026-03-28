require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const readEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing environment file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const idx = trimmed.indexOf('=');
    if (idx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
};

const run = async () => {
  const rootDir = process.cwd();
  const localEnv = readEnvFile(path.join(rootDir, '.env.local'));
  const atlasEnv = readEnvFile(path.join(rootDir, '.env.atlas'));

  const localUri = localEnv.MONGO_URI;
  const atlasUri = atlasEnv.MONGO_URI;

  if (!localUri || !atlasUri) {
    throw new Error('MONGO_URI must be present in both .env.local and .env.atlas');
  }

  console.log('Connecting to local database...');
  const localConn = await mongoose.createConnection(localUri, { serverSelectionTimeoutMS: 15000 }).asPromise();
  console.log('Connected to local database.');

  console.log('Connecting to Atlas database...');
  const atlasConn = await mongoose.createConnection(atlasUri, { serverSelectionTimeoutMS: 15000 }).asPromise();
  console.log('Connected to Atlas database.');

  try {
    const localUsers = await localConn.db.collection('users').find({}).toArray();
    console.log(`Found ${localUsers.length} local user(s).`);

    if (!localUsers.length) {
      console.log('No users found in local database. Nothing to sync.');
      return;
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const sourceUser of localUsers) {
      const userDoc = { ...sourceUser };
      delete userDoc._id;

      const username = typeof userDoc.username === 'string' ? userDoc.username.trim().toLowerCase() : '';
      const email = typeof userDoc.email === 'string' ? userDoc.email.trim().toLowerCase() : '';

      if (!username && !email) {
        skipped += 1;
        continue;
      }

      if (username) {
        userDoc.username = username;
      }

      if (email) {
        userDoc.email = email;
      }

      const filter = username ? { username } : { email };
      const existing = await atlasConn.db.collection('users').findOne(filter, { projection: { _id: 1 } });

      await atlasConn.db.collection('users').updateOne(filter, { $set: userDoc }, { upsert: true });

      if (existing) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    console.log(`User sync complete. Inserted: ${inserted}, Updated: ${updated}, Skipped: ${skipped}`);
  } finally {
    await localConn.close();
    await atlasConn.close();
  }
};

run().catch((error) => {
  console.error('User sync failed:', error.message);
  process.exit(1);
});
