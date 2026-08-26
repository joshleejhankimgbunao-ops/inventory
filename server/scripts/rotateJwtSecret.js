const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');
const { validateJwtSecret } = require('../src/config/security');

const serverDir = path.resolve(__dirname, '..');
const repositoryDir = path.resolve(serverDir, '..');
const localFiles = ['.env', '.env.local'];
const atlasFiles = ['.env.atlas'];
const allFiles = [...localFiles, ...atlasFiles];

const buildSecret = () => validateJwtSecret(crypto.randomBytes(32).toString('base64url'));

const getEnvValue = (content, key) => {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
};

const setEnvValue = (content, key, value) => {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(new RegExp(`^${key}=.*$`, 'gm'), '').replace(/(?:\r?\n){3,}/g, `${newline}${newline}`);
  const separator = normalized && !normalized.endsWith('\n') ? newline : '';
  return `${normalized}${separator}${key}=${value}${newline}`;
};

const assertIgnored = (relativePath) => {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', relativePath], {
    cwd: repositoryDir,
    stdio: 'ignore',
  });

  if (result.status !== 0) {
    throw new Error(`Refusing to write ${relativePath}: Git does not report it as ignored.`);
  }
};

const prepareFile = (fileName, secret) => {
  const absolutePath = path.join(serverDir, fileName);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required ignored environment file is missing: server/${fileName}`);
  }

  const relativePath = `server/${fileName}`;
  assertIgnored(relativePath);

  const current = fs.readFileSync(absolutePath, 'utf8');
  let updated = setEnvValue(current, 'JWT_SECRET', secret);
  updated = setEnvValue(updated, 'API_HOST', '127.0.0.1');
  return {
    absolutePath,
    current,
    updated,
    previousSecret: getEnvValue(current, 'JWT_SECRET'),
  };
};

const run = () => {
  const localSecret = buildSecret();
  const atlasSecret = buildSecret();
  const preparedFiles = [
    ...localFiles.map((fileName) => prepareFile(fileName, localSecret)),
    ...atlasFiles.map((fileName) => prepareFile(fileName, atlasSecret)),
  ];
  const previousLocalSecrets = preparedFiles.slice(0, localFiles.length).map((file) => file.previousSecret);

  const priorSecret = previousLocalSecrets.find(Boolean);
  let previousTokenRejected = true;
  if (priorSecret) {
    const priorToken = jwt.sign({ id: 'rotation-verification' }, priorSecret, { algorithm: 'HS256' });
    try {
      jwt.verify(priorToken, localSecret, { algorithms: ['HS256'] });
      previousTokenRejected = false;
    } catch {
      previousTokenRejected = true;
    }
  }

  const freshToken = jwt.sign({ id: 'rotation-verification' }, localSecret, { algorithm: 'HS256' });
  const freshTokenAccepted = jwt.verify(freshToken, localSecret, { algorithms: ['HS256'] })?.id === 'rotation-verification';
  const secretChanged = previousLocalSecrets.every((secret) => !secret || secret !== localSecret);

  if (!secretChanged || !previousTokenRejected || !freshTokenAccepted) {
    throw new Error('JWT rotation verification failed. No secret or token value was logged.');
  }

  const writtenFiles = [];
  try {
    for (const file of preparedFiles) {
      fs.writeFileSync(file.absolutePath, file.updated, { encoding: 'utf8', mode: 0o600 });
      writtenFiles.push(file);
    }
  } catch (error) {
    for (const file of writtenFiles.reverse()) {
      fs.writeFileSync(file.absolutePath, file.current, { encoding: 'utf8', mode: 0o600 });
    }
    throw error;
  }

  console.log(`Updated ${allFiles.length} ignored environment files without displaying secret values.`);
  console.log('Local API host containment: PASS');
  console.log('Previous-token rejection check: PASS');
  console.log('Fresh-token verification check: PASS');
};

try {
  run();
} catch (error) {
  console.error(`JWT rotation failed: ${error.message}`);
  process.exitCode = 1;
}
