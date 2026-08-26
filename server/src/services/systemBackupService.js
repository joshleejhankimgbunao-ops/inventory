const mongoose = require('mongoose');
const Setting = require('../models/Setting');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const User = require('../models/User');
const Category = require('../models/Category');
const Partner = require('../models/Partner');
const ActivityLog = require('../models/ActivityLog');
const InventoryLog = require('../models/InventoryLog');
const CreditTransaction = require('../models/CreditTransaction');
const SpecialOrder = require('../models/SpecialOrder');

const BACKUP_SCHEMA_VERSION = '2.0.0';

const BACKUP_COLLECTIONS = [
  ['settings', Setting],
  ['users', User],
  ['categories', Category],
  ['partners', Partner],
  ['products', Product],
  ['sales', Sale],
  ['creditTransactions', CreditTransaction],
  ['specialOrders', SpecialOrder],
  ['activityLogs', ActivityLog],
  ['inventoryLogs', InventoryLog],
];

const generateSystemBackup = async ({ generatedBy = 'system' } = {}) => {
  let snapshotCollections;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      snapshotCollections = await Promise.all([
        Setting.find({}).session(session).lean(),
        User.find({})
          .select('+password +pinHash +passwordResetTokenHash +pinResetTokenHash')
          .session(session)
          .lean(),
        Product.find({}).session(session).lean(),
        Sale.find({}).session(session).lean(),
        Category.find({}).session(session).lean(),
        Partner.find({}).session(session).lean(),
        CreditTransaction.find({}).session(session).lean(),
        SpecialOrder.find({}).session(session).lean(),
        ActivityLog.find({}).session(session).lean(),
        InventoryLog.find({}).session(session).lean(),
      ]);
    });
  } finally {
    await session.endSession();
  }

  const [
    settings,
    users,
    products,
    sales,
    categories,
    partners,
    creditTransactions,
    specialOrders,
    activityLogs,
    inventoryLogs,
  ] = snapshotCollections;

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy,
    collections: {
      settings,
      users,
      products,
      sales,
      categories,
      partners,
      creditTransactions,
      specialOrders,
      activityLogs,
      inventoryLogs,
    },
  };
};

module.exports = {
  BACKUP_SCHEMA_VERSION,
  BACKUP_COLLECTIONS,
  generateSystemBackup,
};
