const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const saleRoutes = require('./routes/saleRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
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
