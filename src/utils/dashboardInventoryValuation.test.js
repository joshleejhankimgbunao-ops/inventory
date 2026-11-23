import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateActiveInventorySellingValue } from './dashboardInventoryValuation.js';

test('values active physical stock only and includes reserved quantities', () => {
    const products = [
        { isActive: true, price: 125.5, stock: 4, reservedStock: 3 },
        { isActive: false, price: 900, stock: 10, reservedStock: 8 },
        { price: 20, stock: 2, reservedStock: 1 },
    ];

    assert.equal(calculateActiveInventorySellingValue(products), 542);
});

test('returns zero for missing or invalid product collections', () => {
    assert.equal(calculateActiveInventorySellingValue(undefined), 0);
    assert.equal(calculateActiveInventorySellingValue({ stock: 5, price: 10 }), 0);
});
