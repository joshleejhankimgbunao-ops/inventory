require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Product = require('../src/models/Product');

const testProducts = [
  { brand: 'Holcim', name: 'Portland Cement', color: '', size: '40kg', sku: 'TST-CEM-001', supplierName: 'BuildMate Supply', category: 'Cement, Sand & Gravel', stock: 120, price: 248 },
  { brand: 'Republic', name: 'Portland Cement', color: '', size: '40kg', sku: 'TST-CEM-002', supplierName: 'BuildMate Supply', category: 'Cement, Sand & Gravel', stock: 80, price: 252 },
  { brand: 'Phoenix', name: 'Hollow Block', color: 'Gray', size: '4in', sku: 'TST-HB-001', supplierName: 'Calamba Masonry Depot', category: 'Masonry', stock: 300, price: 18 },
  { brand: 'Phoenix', name: 'Hollow Block', color: 'Gray', size: '6in', sku: 'TST-HB-002', supplierName: 'Calamba Masonry Depot', category: 'Masonry', stock: 210, price: 25 },
  { brand: 'PowerSteel', name: 'Deformed Bar', color: '', size: '10mm x 6m', sku: 'TST-RB-001', supplierName: 'SteelHub Trading', category: 'Steel Bars', stock: 55, price: 225 },
  { brand: 'PowerSteel', name: 'Deformed Bar', color: '', size: '12mm x 6m', sku: 'TST-RB-002', supplierName: 'SteelHub Trading', category: 'Steel Bars', stock: 36, price: 318 },
  { brand: 'CocoPrime', name: 'Coco Lumber', color: 'Natural', size: '2x3x8ft', sku: 'TST-LBR-001', supplierName: 'Laguna Timberline', category: 'Lumbers', stock: 95, price: 142 },
  { brand: 'CocoPrime', name: 'Coco Lumber', color: 'Natural', size: '2x4x8ft', sku: 'TST-LBR-002', supplierName: 'Laguna Timberline', category: 'Lumbers', stock: 70, price: 186 },
  { brand: 'MetroWire', name: 'THHN Wire', color: 'Black', size: '3.5mm2 x 150m', sku: 'TST-ELC-001', supplierName: 'ElectroSource', category: 'Electrical & Lighting', stock: 14, price: 4590 },
  { brand: 'MetroWire', name: 'THHN Wire', color: 'White', size: '2.0mm2 x 150m', sku: 'TST-ELC-002', supplierName: 'ElectroSource', category: 'Electrical & Lighting', stock: 9, price: 2790 },
  { brand: 'EcoPipe', name: 'PVC Pipe', color: 'White', size: '1/2in x 3m', sku: 'TST-PLB-001', supplierName: 'FlowRight Plumbing', category: 'Plumbing', stock: 46, price: 89 },
  { brand: 'EcoPipe', name: 'PVC Elbow', color: 'White', size: '1/2in', sku: 'TST-PLB-002', supplierName: 'FlowRight Plumbing', category: 'Plumbing', stock: 180, price: 16 },
  { brand: 'ColorGuard', name: 'Roofing Sheet', color: 'Blue', size: '0.4mm x 10ft', sku: 'TST-RFG-001', supplierName: 'TopShield Roofing', category: 'Roofing', stock: 22, price: 538 },
  { brand: 'ColorGuard', name: 'Roofing Screw', color: 'Silver', size: '2in', sku: 'TST-RFG-002', supplierName: 'TopShield Roofing', category: 'Roofing', stock: 500, price: 3.5 },
  { brand: 'PrimePaint', name: 'Latex Paint', color: 'White', size: '16L', sku: 'TST-PNT-001', supplierName: 'Spectrum Coatings', category: 'Paint', stock: 11, price: 1980 },
];

const run = async () => {
  try {
    await connectDB();

    let inserted = 0;
    let updated = 0;

    for (const payload of testProducts) {
      const existing = await Product.findOne({ sku: payload.sku });
      if (existing) {
        await Product.updateOne({ _id: existing._id }, { $set: payload });
        updated += 1;
      } else {
        await Product.create(payload);
        inserted += 1;
      }
    }

    const total = await Product.countDocuments();
    const testCount = await Product.countDocuments({ sku: { $regex: '^TST-' } });

    console.log('Test product seed complete.');
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated: ${updated}`);
    console.log(`Total products in DB: ${total}`);
    console.log(`Total TST- products: ${testCount}`);
  } catch (error) {
    console.error('Failed to seed test products:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

run();
