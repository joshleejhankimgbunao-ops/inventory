const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('credit due-date creation, extensions, and status boundaries use Manila calendar days in any host timezone', () => {
  const creditControllerPath = path.resolve(__dirname, '../src/controllers/creditTransactionController.js');
  const saleControllerPath = path.resolve(__dirname, '../src/controllers/saleController.js');
  const realtimeServicePath = path.resolve(__dirname, '../src/services/realtimeService.js');
  const script = `
    const realtimePath = ${JSON.stringify(realtimeServicePath)};
    require.cache[realtimePath] = {
      id: realtimePath, filename: realtimePath, loaded: true,
      exports: {
        publishCreditTransactionsUpdated() {}, publishSaleCreated() {}, publishSaleUpdated() {},
        publishInventoryUpdated() {},
      },
    };
    const { __test: { applyCreditTermExtension, resolveStatus } } = require(${JSON.stringify(creditControllerPath)});
    const { __test: { computeDueDate } } = require(${JSON.stringify(saleControllerPath)});
    (async () => {
      const extension = { dueDate: new Date('2026-03-07T16:00:00.000Z'), termDays: 10, originalDueDate: null };
      await applyCreditTermExtension({ transaction: extension, extensionDays: 5 });
      const dueToday = resolveStatus({
        remainingBalance: 10, amountPaid: 0,
        dueDate: new Date('2026-03-07T16:00:00.000Z'),
        now: new Date('2026-03-08T15:30:00.000Z'),
      });
      const overdueTomorrow = resolveStatus({
        remainingBalance: 10, amountPaid: 0,
        dueDate: new Date('2026-03-07T16:00:00.000Z'),
        now: new Date('2026-03-08T16:30:00.000Z'),
      });
      const initialDueDate = computeDueDate({
        startDate: new Date('2026-03-08T15:30:00.000Z'), termDays: 10,
      });
      process.stdout.write(JSON.stringify({
        extendedDueDate: extension.dueDate.toISOString(),
        originalDueDate: extension.originalDueDate.toISOString(),
        dueToday, overdueTomorrow, initialDueDate: initialDueDate.toISOString(),
      }));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;

  const results = ['Asia/Manila', 'UTC', 'America/Los_Angeles'].map((timeZone) => {
    const output = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timeZone },
    });
    return JSON.parse(output);
  });

  assert.deepEqual(results[0], {
    extendedDueDate: '2026-03-12T16:00:00.000Z',
    originalDueDate: '2026-03-07T16:00:00.000Z',
    dueToday: 'Unpaid',
    overdueTomorrow: 'Overdue',
    initialDueDate: '2026-03-17T16:00:00.000Z',
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});
