const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

router.get('/', (req, res) => {
  const dbName = mongoose?.connection?.name || null;
  const dbHost = mongoose?.connection?.host || null;

  res.json({
    status: 'ok',
    service: 'inventory-api',
    database: dbName,
    dbHost,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
