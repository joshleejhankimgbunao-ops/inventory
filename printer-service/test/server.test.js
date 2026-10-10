const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPowerShellPrintScript,
  buildReceiptCopyPayloads,
  buildReceiptLines,
  printReceipt,
} = require('../src/server');

test('buildPowerShellPrintScript auto-detects an XP-58H-compatible queue when no printer name is set', () => {
  const script = buildPowerShellPrintScript('');

  assert.match(script, /if \(-not \[string\]::IsNullOrWhiteSpace\(\$printerName\)\)/);
  assert.match(script, /\$document\.PrinterSettings\.PrinterName = \$printerName/);
  assert.match(script, /XP-58H-compatible receipt queue/);
  assert.match(script, /SELECTED_PRINTER:/);
});

test('buildReceiptLines produces a compact 30-column cash receipt without clipping fields', () => {
  const lines = buildReceiptLines({
    store: {
      name: 'Tableria La Confianza Hardware and Construction Supplies',
      address: 'A very long street address that must wrap safely on 58mm receipt paper',
      contactPhone: '09123456789',
      contactPhoneSecondary: '09987654321',
    },
    receipt: {
      id: 'SALE-2026-VERY-LONG-REFERENCE-000001',
      date: '2026-08-17T12:34:56.000Z',
      cashier: 'Cashier With A Very Long Display Name',
      paymentMethod: 'Cash',
      total: 1550,
      cash: 2000,
      change: 450,
      netAmount: 1383.93,
      vatAmount: 166.07,
      grossAmount: 1550,
      items: [
        {
          label: 'Another Very Long Product Name — White That Must Wrap Instead Of Being Cut Off',
          code: 'PRODUCT-CODE-WITH-MORE-THAN-THIRTY-CHARACTERS',
          qty: 2,
          unitPrice: 775,
          subtotal: 1550,
        },
        {
          label: 'High Value Item',
          code: 'HIGH-VALUE-001',
          qty: 999999,
          unitPrice: 999999.99,
          subtotal: 999998990000.01,
        },
      ],
    },
  });

  assert.ok(lines.length > 0);
  assert.equal(Math.max(...lines.map((line) => line.length)), 30);
  assert.ok(lines.every((line) => line.length <= 30));
  assert.ok(lines.every((line) => /^[\x20-\x7e\u20b1]*$/.test(line)));
  assert.ok(lines.includes('-'.repeat(30)));
  assert.ok(lines.includes('ITEMS'));
  assert.ok(lines.some((line) => /Method:\s+Cash/.test(line)));
  assert.ok(lines.some((line) => /TOTAL:\s+\u20b11,550\.00/.test(line)));
  assert.match(lines.join('\n'), /- White/);
  assert.doesNotMatch(lines.join('\n'), /—/);
  assert.ok(lines.some((line) => line.trim() === 'THANK YOU!'));
});

test('buildReceiptLines preserves credit receipt details in the compact layout', () => {
  const lines = buildReceiptLines({
    receipt: {
      id: 'CREDIT-001',
      date: '2026-08-17',
      cashier: 'Cashier',
      customerName: 'Verified Regular Customer',
      orderReference: 'TRX-ORDER-001',
      paymentReference: 'CHK-001',
      paymentMethod: 'Credit',
      paymentStatus: 'Pending',
      termDays: 30,
      dueDate: '2026-09-16',
      creditPaymentMode: 'Credit + Cheque',
      balance: 75,
      amountPaid: 25,
      total: 100,
      netAmount: 89.29,
      vatAmount: 10.71,
      grossAmount: 100,
      items: [{ label: 'Test Item', qty: 1, unitPrice: 100, subtotal: 100 }],
    },
  });

  const output = lines.join('\n');
  assert.ok(lines.every((line) => line.length <= 30));
  assert.ok(lines.every((line) => /^[\x20-\x7e\u20b1]*$/.test(line)));
  assert.match(output, /Customer:/);
  assert.match(output, /Order Ref:/);
  assert.match(output, /TRX-ORDER-001/);
  assert.match(output, /Payment Ref:\s+CHK-001/);
  assert.match(output, /Verified Regular Customer/);
  assert.match(output, /Method:\s+Credit/);
  assert.match(output, /Status:\s+Pending/);
  assert.match(output, /Term:\s+30 days/);
  assert.match(output, /Due Date:\s+2026-09-16/);
  assert.match(output, /Mode:\s+Credit \+ Cheque/);
  assert.match(output, /Balance:\s+\u20b175\.00/);
  assert.match(output, /Amount Paid:\s+\u20b125\.00/);
});

test('buildReceiptLines safely wraps a long Credit Bank Transfer mode and calculated total above one million', () => {
  const lines = buildReceiptLines({
    receipt: {
      id: 'SPECIAL-ORDER-SALE-WITH-A-LONG-REFERENCE-001',
      date: '2026-08-17T20:25:00.000Z',
      cashier: 'Super Administrator With Long Name',
      customerName: 'Regular Customer With A Very Long Registered Business Name',
      paymentMethod: 'Credit',
      paymentStatus: 'Pending',
      termDays: 60,
      dueDate: '2026-10-16T00:00:00.000Z',
      creditPaymentMode: 'Bank Transfer With Long Account Description',
      total: 2500000,
      netAmount: 2232142.86,
      vatAmount: 267857.14,
      grossAmount: 2500000,
      items: [
        {
          label: 'GI Corrugated Sheet With An Extremely Long Product Description',
          code: 'SPECIAL-ORDER-GS-002-LONG-CODE',
          qty: 3,
          unitPrice: 833333.333,
          subtotal: 2500000,
        },
      ],
    },
  });

  const output = lines.join('\n');
  assert.ok(lines.every((line) => line.length <= 30));
  assert.ok(lines.every((line) => /^[\x20-\x7e\u20b1]*$/.test(line)));
  assert.match(output, /\u20b12,500,000\.00/);
  assert.match(output, /Bank Transfer With Long/);
  assert.match(output, /Account Description/);
});

test('buildPowerShellPrintScript uses a safe 58mm printable area and dynamic receipt height', () => {
  const script = buildPowerShellPrintScript('XP-58H');

  assert.match(script, /Get-Content -LiteralPath \$JsonPath -Raw -Encoding UTF8/);
  assert.match(script, /\$paperWidth = \[int\]\$document\.DefaultPageSettings\.PaperSize\.Width/);
  assert.match(script, /Margins\(4, 4, 5, 5\)/);
  assert.match(script, /Font\('Consolas', 7\.25\)/);
  assert.match(script, /\$paperHeight = \[Math\]::Max\(300,/);
  assert.match(script, /PaperSize\('Receipt', \$paperWidth, \$paperHeight\)/);
  assert.match(script, /\$contentBlockWidth = \$e\.Graphics\.MeasureString\(\$contentSample, \$font\)\.Width/);
  assert.match(script, /\$printableArea = \$e\.PageSettings\.PrintableArea/);
  assert.match(script, /\$centerOffset = \(\$printableArea\.Width - \$contentBlockWidth\) \/ 2/);
  assert.match(script, /if \(\$centerOffset -lt 0\)/);
  assert.match(script, /\$x = \[single\]\$printableArea\.Left \+ \[single\]\$centerOffset/);
  assert.match(script, /PRINT_LAYOUT: printableWidth=/);
  assert.match(script, /\$y = \$e\.MarginBounds\.Top/);
  assert.match(script, /if \(\[string\]::IsNullOrEmpty\(\$text\)\)/);
  assert.match(script, /\$y \+= \$lineHeight\s+continue/);
});

test('receipt copy payloads preserve one transaction as one customer receipt job', () => {
  const payload = {
    store: { name: 'Tableria La Confianza' },
    receipt: {
      id: 'TRX-SAME-001',
      paymentMethod: 'Credit',
      creditPaymentMode: 'Cheque',
      items: [{ label: 'Item', qty: 1, unitPrice: 100, subtotal: 100 }],
      total: 100,
    },
  };

  const copies = buildReceiptCopyPayloads(payload);

  assert.equal(copies.length, 1);
  assert.equal(Object.hasOwn(copies[0], 'copyLabel'), false);
  assert.deepEqual(copies[0].receipt, payload.receipt);
  assert.equal(copies[0].receipt.creditPaymentMode, 'Cheque');
});

test('original receipts omit reprint labels and reprints include one centered label', () => {
  const basePayload = {
    store: { name: 'Tableria La Confianza' },
    receipt: {
      id: 'TRX-COPY-LABEL-001',
      date: '2026-08-17',
      cashier: 'Cashier',
      paymentMethod: 'Cash',
      items: [{ label: 'Item', qty: 1, unitPrice: 100, subtotal: 100 }],
      netAmount: 89.29,
      vatAmount: 10.71,
      grossAmount: 100,
      total: 100,
      cash: 100,
      change: 0,
    },
  };

  const originalLines = buildReceiptLines(basePayload);
  const reprintLines = buildReceiptLines({ ...basePayload, receipt: { ...basePayload.receipt, isReprint: true } });
  const output = originalLines.join('\n');

  assert.doesNotMatch(output, /REPRINT/i);
  assert.match(reprintLines.join('\n'), /\*\*\* REPRINT \*\*\*/);
  assert.ok(originalLines.every((line) => line.length <= 30));
  assert.ok(reprintLines.every((line) => line.length <= 30));
});

test('POS order confirmation prints its distinct heading and optional transaction reference within 30 columns', () => {
  const lines = buildReceiptLines({
    store: { name: 'Tableria La Confianza' },
    receipt: {
      id: 'TRX-ABC12345', documentType: 'order-confirmation', transactionReference: 'REF-123',
      date: '2026-10-04', cashier: 'Cashier', paymentMethod: 'Cash',
      items: [{ label: 'Item', code: 'ITEM-001', qty: 1, unitPrice: 100, subtotal: 100 }],
      netAmount: 89.29, vatAmount: 10.71, grossAmount: 100, total: 100, cash: 100, change: 0,
    },
  });
  const output = lines.join('\n');
  assert.match(output, /ORDER CONFIRMATION/);
  assert.match(output, /Transaction Ref:\s+REF-123/);
  assert.match(output, /Transaction ID:\s+TRX-ABC12345/);
  const header = `${'QTY'.padStart(3)} ${'UNIT PRICE'.padStart(12)} ${'AMOUNT'.padStart(13)}`;
  const valueRow = `${'1'.padStart(3)} ${'₱100.00'.padStart(12)} ${'₱100.00'.padStart(13)}`;
  const codeIndex = lines.indexOf('Code: ITEM-001');
  assert.match(output, /Code: ITEM-001\n\nQTY   UNIT PRICE        AMOUNT/);
  assert.ok(lines.includes(header));
  assert.ok(lines.includes(valueRow));
  assert.equal(lines[codeIndex + 1], '');
  assert.equal(lines[codeIndex + 2], header);
  assert.ok(lines.every((line) => line.length <= 30));
});

test('Order Confirmation repeats aligned thermal price columns for multiple item blocks', () => {
  const lines = buildReceiptLines({
    receipt: {
      id: 'TRX-MULTI-001', documentType: 'order-confirmation',
      date: '2026-10-09', cashier: 'Cashier', paymentMethod: 'Cash',
      items: [
        { label: 'PVC Pipe', code: 'ABC-001', qty: 2, unitPrice: 89, subtotal: 178 },
        { label: 'GI Corrugated Sheet', code: 'GS-002', qty: 1, unitPrice: 450, subtotal: 450 },
      ],
      netAmount: 560.71, vatAmount: 67.29, grossAmount: 628, total: 628, cash: 700, change: 72,
    },
  });
  const header = `${'QTY'.padStart(3)} ${'UNIT PRICE'.padStart(12)} ${'AMOUNT'.padStart(13)}`;

  assert.equal(lines.filter((line) => line === header).length, 2);
  assert.ok(lines.includes(`${'2'.padStart(3)} ${'₱89.00'.padStart(12)} ${'₱178.00'.padStart(13)}`));
  assert.ok(lines.includes(`${'1'.padStart(3)} ${'₱450.00'.padStart(12)} ${'₱450.00'.padStart(13)}`));
  ['Code: ABC-001', 'Code: GS-002'].forEach((codeLine) => {
    const codeIndex = lines.indexOf(codeLine);
    assert.equal(lines[codeIndex + 1], '');
    assert.equal(lines[codeIndex + 2], header);
  });
});

test('Order Confirmation handles long names, codes, quantities, and monetary ranges without column overlap', () => {
  const lines = buildReceiptLines({
    receipt: {
      id: 'TRX-RANGES-001', documentType: 'order-confirmation',
      date: '2026-10-09', cashier: 'Cashier', paymentMethod: 'Cash',
      items: [
        { label: 'Extra Long Galvanized Corrugated Roofing Sheet', code: 'A', qty: 1, unitPrice: 3.5, subtotal: 89 },
        { label: 'PVC Pipe', code: 'PRODUCT-CODE-WITH-MORE-THAN-THIRTY-CHARACTERS', qty: 10, unitPrice: 4590, subtotal: 9180 },
        { label: 'Premium Item', code: 'PREM-100', qty: 100, unitPrice: 12345, subtotal: 12345 },
      ],
      netAmount: 19298.21, vatAmount: 2315.79, grossAmount: 21614, total: 21614, cash: 22000, change: 386,
    },
  });
  const output = lines.join('\n');

  assert.match(output, /Extra Long Galvanized/);
  assert.match(output, /Code:\nPRODUCT-CODE-WITH-MORE-THAN-TH/);
  assert.match(output, /IRTY-CHARACTERS\n\nQTY   UNIT PRICE        AMOUNT/);
  assert.ok(lines.includes(`${'1'.padStart(3)} ${'₱3.50'.padStart(12)} ${'₱89.00'.padStart(13)}`));
  assert.ok(lines.includes(`${'10'.padStart(3)} ${'₱4,590.00'.padStart(12)} ${'₱9,180.00'.padStart(13)}`));
  assert.ok(lines.includes(`${'100'.padStart(3)} ${'₱12,345.00'.padStart(12)} ${'₱12,345.00'.padStart(13)}`));
  assert.ok(lines.every((line) => line.length <= 30));
  assert.ok(lines.every((line) => !line.includes('\t')));
});

test('Order Confirmation gracefully stacks item values that exceed fixed thermal columns', () => {
  const lines = buildReceiptLines({
    receipt: {
      id: 'TRX-FALLBACK-001', documentType: 'order-confirmation',
      date: '2026-10-09', cashier: 'Cashier', paymentMethod: 'Cash',
      items: [{ label: 'Industrial Equipment', code: 'IND-001', qty: 1000, unitPrice: 999999999.99, subtotal: 999999999990 }],
      netAmount: 999999999990, vatAmount: 0, grossAmount: 999999999990, total: 999999999990,
    },
  });
  const output = lines.join('\n');

  assert.match(output, /Qty:\s+1000/);
  assert.match(output, /Unit Price:/);
  assert.match(output, /Amount:/);
  assert.ok(lines.every((line) => line.length <= 30));
});

test('Order Confirmation totals and tender amounts share the same right boundary', () => {
  const lines = buildReceiptLines({
    receipt: {
      id: 'TRX-TOTALS-001', documentType: 'order-confirmation',
      date: '2026-10-09', cashier: 'Cashier', paymentMethod: 'Cash',
      items: [{ label: 'GI Corrugated Sheet', code: 'GS-002', qty: 1, unitPrice: 450, subtotal: 450 }],
      netAmount: 401.79, vatAmount: 48.21, grossAmount: 450, total: 450, cash: 450, change: 0,
    },
  });
  const labels = ['Net:', 'VAT:', 'Gross:', 'TOTAL:', 'Cash:', 'Change:'];
  const totalLines = labels.map((label) => lines.find((line) => line.startsWith(label)));

  assert.ok(totalLines.every(Boolean));
  assert.ok(totalLines.every((line) => line.length === 30));
  assert.deepEqual(totalLines.map((line) => line.match(/₱[\d,.]+$/)?.[0]), [
    '₱401.79', '₱48.21', '₱450.00', '₱450.00', '₱450.00', '₱0.00',
  ]);
});

test('Sales History order confirmation print-again avoids receipt and reprint terminology', () => {
  const receipt = {
    id: 'TRX-HISTORY-001', documentType: 'order-confirmation', isReprint: true,
    date: '2026-10-04', cashier: 'Cashier', paymentMethod: 'Credit',
    customerName: 'Regular Customer',
    items: [{ label: 'Saved Item', qty: 1, unitPrice: 100, subtotal: 100 }],
    netAmount: 89.29, vatAmount: 10.71, grossAmount: 100, total: 100,
  };
  const withoutReference = buildReceiptLines({ store: { name: 'Tableria La Confianza' }, receipt }).join('\n');
  const withReference = buildReceiptLines({ store: { name: 'Tableria La Confianza' }, receipt: { ...receipt, transactionReference: 'REF-123' } }).join('\n');

  assert.match(withoutReference, /ORDER CONFIRMATION/);
  assert.match(withoutReference, /Transaction ID:\s+TRX-HISTORY-001/);
  assert.match(withoutReference, /For transaction reference\s+only\./);
  assert.doesNotMatch(withoutReference, /Receipt No|REPRINT|Please keep this receipt|Transaction Ref:/i);
  assert.match(withReference, /Transaction Ref:\s+REF-123/);
  assert.doesNotMatch(withReference, /REPRINT|Receipt No/i);
});

test('voided Order Confirmation prints visible void status, date, and reason without becoming a receipt', () => {
  const lines = buildReceiptLines({
    store: { name: 'Tableria La Confianza' },
    receipt: {
      id: 'TRX-VOID-001', documentType: 'order-confirmation', status: 'voided', isReprint: true,
      voidInfo: { reason: 'Duplicate checkout entered at register', voidedAt: '2026-10-05T01:02:03.000Z' },
      date: '2026-10-05', cashier: 'Admin', paymentMethod: 'Cash',
      items: [{ label: 'Saved Item', qty: 1, unitPrice: 100, subtotal: 100 }],
      netAmount: 89.29, vatAmount: 10.71, grossAmount: 100, total: 100,
    },
  });
  const output = lines.join('\n');

  assert.match(output, /\*\*\* VOIDED \*\*\*/);
  assert.match(output, /Void Date:/);
  assert.match(output, /Void Reason:/);
  assert.match(output, /Duplicate checkout entered at/);
  assert.doesNotMatch(output, /Receipt No|REPRINT|Please keep this receipt/i);
  assert.ok(lines.every((line) => line.length <= 30));
});

test('legacy cash receipts omit unavailable tender values instead of inventing zeroes', () => {
  const lines = buildReceiptLines({
    store: { name: 'Tableria La Confianza' },
    receipt: {
      id: 'TRX-LEGACY-CASH-001',
      date: '2026-08-17',
      cashier: 'Cashier',
      paymentMethod: 'Cash',
      items: [{ label: 'Saved Item', qty: 1, unitPrice: 100, subtotal: 100 }],
      netAmount: 89.29,
      vatAmount: 10.71,
      grossAmount: 100,
      total: 100,
      cash: null,
      change: null,
    },
  });

  const output = lines.join('\n');
  assert.doesNotMatch(output, /^Cash:/m);
  assert.doesNotMatch(output, /^Change:/m);
  assert.match(output, /TOTAL:\s+₱100\.00/);
});

test('Special Order receipts show the saved order reference and paid status', () => {
  const lines = buildReceiptLines({
    store: { name: 'Tableria La Confianza' },
    receipt: {
      id: 'TRX-SPECIAL-001',
      specialOrderNumber: 'SO-001',
      date: '2026-08-27T03:15:00.000Z',
      cashier: 'Saved Cashier',
      customerName: 'Saved Customer',
      paymentMethod: 'Cash',
      paymentStatus: 'Paid',
      items: [{ label: 'Finalized Special Item', qty: 1, unitPrice: 250, subtotal: 250 }],
      netAmount: 250,
      grossAmount: 250,
      total: 250,
    },
  });

  const output = lines.join('\n');
  assert.match(output, /Special Order:\s+SO-001/);
  assert.match(output, /Status:\s+Paid/);
  assert.match(output, /Finalized Special Item/);
});

test('printReceipt sends one job from one receipt payload', async () => {
  const calls = [];
  const payload = { receipt: { id: 'TRX-PRINT-ONCE-001', total: 100 } };
  const printJob = async (copyPayload, timingId) => {
    calls.push({ copyPayload, timingId });
    return { ok: true, printerName: 'XP-58H', queued: true };
  };

  const result = await printReceipt(payload, 'single-copy-test', printJob);

  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0].copyPayload, 'copyLabel'), false);
  assert.ok(calls[0].timingId.endsWith('copy-1'));
  assert.equal(calls[0].copyPayload.receipt.id, payload.receipt.id);
  assert.deepEqual(result.completedCopies, [1]);
  assert.equal(result.copyCount, 1);
});

test('a failed receipt job does not retry or repeat the completed sale', async () => {
  const calls = [];
  const payload = { receipt: { id: 'TRX-PARTIAL-PRINT-001', total: 100 } };
  const printJob = async (copyPayload) => {
    calls.push(copyPayload);
    throw new Error('Simulated printer failure');
  };

  await assert.rejects(
    () => printReceipt(payload, 'single-copy-failure-test', printJob),
    (error) => {
      assert.deepEqual(error.completedCopies, []);
      assert.equal(error.failedCopy, 1);
      assert.match(error.message, /completed sale remains valid and was not repeated/i);
      return true;
    },
  );

  assert.equal(calls.length, 1);
});

test('explicit document lines remain a single printer job', async () => {
  const calls = [];
  const printJob = async (payload) => {
    calls.push(payload);
    return { ok: true, printerName: 'XP-58H', queued: true };
  };

  const result = await printReceipt({ lines: ['QUOTATION'] }, 'document-test', printJob);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { lines: ['QUOTATION'] });
  assert.equal(result.copyCount, undefined);
});
