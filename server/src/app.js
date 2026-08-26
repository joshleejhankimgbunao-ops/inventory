const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const saleRoutes = require('./routes/saleRoutes');
const specialOrderRoutes = require('./routes/specialOrderRoutes');
const settingRoutes = require('./routes/settingRoutes');
const partnerRoutes = require('./routes/partnerRoutes');
const logRoutes = require('./routes/logRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const realtimeRoutes = require('./routes/realtimeRoutes');
const creditTransactionRoutes = require('./routes/creditTransactionRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();

app.use((req, res, next) => {
  const requestPath = req.path || req.url || '';
  const isApiRequest = requestPath.startsWith('/api');
  const isHealthRequest = requestPath.startsWith('/api/health');
  const isPreflight = req.method === 'OPTIONS';

  // Keep terminal output focused on real API calls.
  if (!isApiRequest || isHealthRequest || isPreflight) {
    return next();
  }

  const startedAt = Date.now();
  res.on('finish', () => {
    if (req.method === 'GET' && res.statusCode === 304) {
      return;
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[API] ${req.method} ${requestPath} -> ${res.statusCode} (${durationMs}ms)`);
  });

  return next();
});

const parseAllowedOrigins = () => {
  const configured = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(configured);
};

const allowedOrigins = parseAllowedOrigins();
const localhostDevOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1):(517\d|3000)$/;

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients and same-origin requests with no Origin header.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.size === 0 || allowedOrigins.has(origin) || localhostDevOriginPattern.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error('CORS origin not allowed.'));
  },
}));
app.use(express.json({ limit: '25mb' }));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/special-orders', specialOrderRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/credit-transactions', creditTransactionRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
