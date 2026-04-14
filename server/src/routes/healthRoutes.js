const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

router.get('/', (req, res) => {
  const dbName = mongoose?.connection?.name || null;

  res.json({
    status: 'ok',
    service: 'inventory-api',
    database: dbName,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
