require('dotenv').config({ quiet: true });

const { performance } = require('node:perf_hooks');
const app = require('./app');
const connectDB = require('./config/db');
const { getJwtSecret } = require('./config/security');
const { initializeAutomaticBackupScheduler } = require('./services/automaticBackupService');
const { backfillMissingExpiryBatchReferences } = require('./services/expiryBatchReferenceService');

const port = process.env.PORT || 5000;
const host = String(process.env.API_HOST || '').trim();

const runStartupStep = async (label, operation) => {
  const startedAt = performance.now();
  const result = await operation();
  console.log(`[STARTUP] ${label} completed in ${Math.round(performance.now() - startedAt)}ms`);
  return result;
};

const startServer = async () => {
  try {
    const startupStartedAt = performance.now();
    getJwtSecret();
    await runStartupStep('MongoDB connection', connectDB);
    await runStartupStep('Expiry batch reference check', backfillMissingExpiryBatchReferences);

    const onListening = () => {
      const boundHost = host || 'all configured interfaces';
      console.log(`API server running on ${boundHost}:${port}`);
      console.log(`[STARTUP] API listener ready in ${Math.round(performance.now() - startupStartedAt)}ms`);
      // A scheduled backup can be large or overdue after a Render sleep. Start
      // its scheduler once the API is accepting requests so backup work cannot
      // hold the listener closed during a cold start.
      void initializeAutomaticBackupScheduler();
    };

    if (host) {
      app.listen(port, host, onListening);
    } else {
      app.listen(port, onListening);
    }
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
