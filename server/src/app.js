const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const saleRoutes = require('./routes/saleRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();

const parseAllowedOrigins = () => {
  const configured = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(configured);
};

const allowedOrigins = parseAllowedOrigins();
const localhostDevOriginPattern = /^http:\/\/localhost:(517\d|3000)$/;

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
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
