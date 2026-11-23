const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../src/controllers/specialOrderController');

test('Special Order down-payment percentages accept decimal entry and enforce bounds', () => {
  assert.equal(__test.parseDownPaymentPercentageBasisPoints('.5'), 50);
  assert.equal(__test.parseDownPaymentPercentageBasisPoints('0.01'), 1);
  assert.equal(__test.parseDownPaymentPercentageBasisPoints('50'), 5000);
  assert.equal(__test.parseDownPaymentPercentageBasisPoints('100'), 10000);
  for (const value of ['', '0', '-1', '100.01', '1.001', 'abc']) {
    assert.equal(__test.parseDownPaymentPercentageBasisPoints(value), null, `reject ${value}`);
  }
});

test('Special Order down-payment currency rounding is half-up to the centavo', () => {
  assert.equal(__test.calculateDownPaymentCentavos(101, 5000), 51);
  assert.equal(__test.calculateDownPaymentCentavos(1, 5000), 1);
  assert.equal(__test.calculateDownPaymentCentavos(12345, 10000), 12345);
});
