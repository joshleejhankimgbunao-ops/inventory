const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const mode = (process.argv[2] || '').toLowerCase();
const runType = (process.argv[3] || 'dev').toLowerCase();

if (!['local', 'atlas'].includes(mode)) {
  console.error('Usage: node scripts/runWithEnv.js <local|atlas> [dev|start]');
  process.exit(1);
}

if (!['dev', 'start'].includes(runType)) {
  console.error('Run type must be either "dev" or "start".');
  process.exit(1);
}

const rootDir = process.cwd();
const sourceEnvPath = path.join(rootDir, `.env.${mode}`);
const targetEnvPath = path.join(rootDir, '.env');

if (!fs.existsSync(sourceEnvPath)) {
  console.error(`Missing environment file: ${sourceEnvPath}`);
  console.error('Create it first (e.g. copy from .env.example).');
  process.exit(1);
}

fs.copyFileSync(sourceEnvPath, targetEnvPath);
console.log(`Loaded ${path.basename(sourceEnvPath)} -> .env`);

const command = runType === 'dev' ? 'npx' : 'node';
const args = runType === 'dev' ? ['nodemon', 'src/server.js'] : ['src/server.js'];

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
