require('dotenv').config({ quiet: true });

const app = require('./app');
const connectDB = require('./config/db');
const { getJwtSecret } = require('./config/security');
const { initializeAutomaticBackupScheduler } = require('./services/automaticBackupService');

const port = process.env.PORT || 5000;
const host = String(process.env.API_HOST || '').trim();

const startServer = async () => {
  try {
    getJwtSecret();
    await connectDB();
    await initializeAutomaticBackupScheduler();

    const onListening = () => {
      const boundHost = host || 'all configured interfaces';
      console.log(`API server running on ${boundHost}:${port}`);
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
