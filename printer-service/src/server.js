const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const HOST = String(process.env.PRINTER_HOST || '').trim() || '127.0.0.1';
const DEFAULT_PRINTER_NAME = String(process.env.THERMAL_PRINTER_NAME || '').trim();
const DEFAULT_PRINTER_TYPE = String(process.env.THERMAL_PRINTER_TYPE || 'EPSON').trim().toUpperCase();
const configuredWidth = Number(process.env.THERMAL_PRINTER_WIDTH_CHARS || 30);
const DEFAULT_WIDTH_CHARS = Number.isFinite(configuredWidth)
  ? Math.min(30, Math.max(24, Math.trunc(configuredWidth)))
  : 30;
const RECEIPT_COPY_COUNT = 1;
let selectedPrinterName = DEFAULT_PRINTER_NAME;
let printerSelectionSource = DEFAULT_PRINTER_NAME ? 'environment' : 'unresolved';

const createPrintTimingId = () => `print-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const logPrintTiming = (timingId, event, details = '') => {
  const suffix = details ? ` ${details}` : '';
  console.log(`[PRINT_TIMING][${timingId}] ${new Date().toISOString()} ${event}${suffix}`);
};

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));

const formatMoney = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0.00';

  const [whole, decimals] = numeric.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimals}`;
};

const toPrinterSafeText = (value) => String(value ?? '')
  .replace(/[\u2010-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/\u00a0/g, ' ')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7e\u20b1]/g, '?');

const wrapText = (text, width = DEFAULT_WIDTH_CHARS) => {
  const source = toPrinterSafeText(text).trim();
  if (!source) {
    return [''];
  }

  const words = source.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    if (word.length > width) {
      let start = 0;
      while (start < word.length) {
        lines.push(word.slice(start, start + width));
        start += width;
      }
      current = '';
      continue;
    }

    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
};

const centerText = (text, width = DEFAULT_WIDTH_CHARS) => {
  const source = toPrinterSafeText(text).trim();
  if (!source) return '';
  const padding = Math.max(0, Math.floor((width - source.length) / 2));
  return `${' '.repeat(padding)}${source}`;
};

const appendCenteredText = (lines, text, width = DEFAULT_WIDTH_CHARS) => {
  wrapText(text, width).forEach((line) => lines.push(centerText(line, width)));
};

const linePair = (left, right, width = DEFAULT_WIDTH_CHARS) => {
  const leftText = toPrinterSafeText(left).trim();
  const rightText = toPrinterSafeText(right).trim();
  const spacer = Math.max(1, width - leftText.length - rightText.length);
  return `${leftText}${' '.repeat(spacer)}${rightText}`;
};

const appendPair = (lines, left, right, width = DEFAULT_WIDTH_CHARS) => {
  const leftText = toPrinterSafeText(left).trim();
  const rightText = toPrinterSafeText(right).trim();

  if (!rightText) {
    wrapText(leftText, width).forEach((line) => lines.push(line));
    return;
  }

  if (leftText.length + rightText.length + 1 <= width) {
    lines.push(linePair(leftText, rightText, width));
    return;
  }

  wrapText(leftText, width).forEach((line) => lines.push(line));
  wrapText(rightText, width).forEach((line) => {
    lines.push(line.padStart(width));
  });
};

const appendField = (lines, label, value, width = DEFAULT_WIDTH_CHARS) => {
  const labelText = `${toPrinterSafeText(label).trim()}:`;
  const valueText = toPrinterSafeText(value).trim();

  if (!valueText) {
    lines.push(labelText);
    return;
  }

  appendPair(lines, labelText, valueText, width);
};

const formatReceiptAmount = (value) => `\u20b1${formatMoney(value)}`;

const getItemPriceColumnLayout = (width = DEFAULT_WIDTH_CHARS) => {
  const gap = 1;
  const quantityWidth = 3;
  const availablePriceWidth = width - quantityWidth - (gap * 2);
  const unitPriceWidth = Math.max('UNIT PRICE'.length, Math.floor(availablePriceWidth / 2));
  const amountWidth = availablePriceWidth - unitPriceWidth;

  if (amountWidth < 'AMOUNT'.length) return null;

  return {
    gap: ' '.repeat(gap),
    quantityWidth,
    unitPriceWidth,
    amountWidth,
  };
};

const appendItemPriceColumns = (lines, item, width = DEFAULT_WIDTH_CHARS) => {
  const quantity = String(Number(item?.qty || 0));
  const unitPrice = formatReceiptAmount(item?.unitPrice || 0);
  const amount = formatReceiptAmount(item?.subtotal || 0);
  const layout = getItemPriceColumnLayout(width);

  if (layout) {
    const { gap, quantityWidth, unitPriceWidth, amountWidth } = layout;
    const header = `${'QTY'.padStart(quantityWidth)}${gap}${'UNIT PRICE'.padStart(unitPriceWidth)}${gap}${'AMOUNT'.padStart(amountWidth)}`;
    lines.push(header);

    if (
      quantity.length <= quantityWidth
      && unitPrice.length <= unitPriceWidth
      && amount.length <= amountWidth
    ) {
      lines.push(
        `${quantity.padStart(quantityWidth)}${gap}${unitPrice.padStart(unitPriceWidth)}${gap}${amount.padStart(amountWidth)}`,
      );
      return;
    }
  }

  appendField(lines, 'Qty', quantity, width);
  appendField(lines, 'Unit Price', unitPrice, width);
  appendField(lines, 'Amount', amount, width);
};

const formatReceiptDateTime = (value) => {
  const source = toPrinterSafeText(value).trim();
  const parsed = new Date(value);

  if (!source || Number.isNaN(parsed.getTime())) {
    return { date: source, time: '' };
  }

  return {
    date: parsed.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }),
    time: parsed.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }),
  };
};

const buildReceiptLines = (payload = {}) => {
  if (Array.isArray(payload.lines) && payload.lines.length > 0) {
    return payload.lines.map((line) => String(line ?? ''));
  }

  const store = payload.store || {};
  const receipt = payload.receipt || {};
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const lines = [];
  const separator = '-'.repeat(DEFAULT_WIDTH_CHARS);
  const isCredit = String(receipt.paymentMethod || '').toLowerCase() === 'credit';
  const isOrderConfirmation = receipt.documentType === 'order-confirmation';
  const isVoidedConfirmation = isOrderConfirmation
    && String(receipt.status || '').toLowerCase() === 'voided';
  const receiptDateTime = formatReceiptDateTime(receipt.date || '');

  appendCenteredText(lines, store.name || 'Receipt');
  if (store.address) {
    appendCenteredText(lines, store.address);
  }
  if (store.contactPhone) {
    appendCenteredText(lines, `Contact: ${store.contactPhone}`);
  }
  if (store.contactPhoneSecondary) {
    appendCenteredText(lines, store.contactPhoneSecondary);
  }

  if (receipt.isReprint && receipt.documentType !== 'order-confirmation') {
    lines.push('');
    appendCenteredText(lines, '*** REPRINT ***');
  }

  if (isOrderConfirmation) {
    lines.push('');
    appendCenteredText(lines, 'ORDER CONFIRMATION');
    appendCenteredText(lines, 'For transaction reference only');
    if (isVoidedConfirmation) {
      appendCenteredText(lines, '*** VOIDED ***');
    }
  }

  lines.push('');
  lines.push(separator);
  appendField(lines, isOrderConfirmation ? 'Transaction ID' : 'Receipt No', receipt.id);
  if (receipt.transactionReference) {
    appendField(lines, 'Transaction Ref', receipt.transactionReference);
  }
  if (receipt.specialOrderNumber) {
    appendField(lines, 'Special Order', receipt.specialOrderNumber);
  }
  if (receipt.orderReference) {
    appendField(lines, 'Order Ref', receipt.orderReference);
  }
  if (receipt.paymentReference) {
    appendField(lines, 'Payment Ref', receipt.paymentReference);
  }
  appendField(lines, 'Date', receiptDateTime.date);
  if (receiptDateTime.time) {
    appendField(lines, 'Time', receiptDateTime.time);
  }
  appendField(lines, 'Cashier', receipt.cashier || '');
  appendField(lines, 'Method', receipt.paymentMethod || 'Cash');
  if (receipt.customerName) {
    appendField(lines, 'Customer', receipt.customerName);
  }

  lines.push(separator);
  lines.push(isOrderConfirmation ? 'ITEM' : 'ITEMS');
  lines.push('');

  items.forEach((item, index) => {
    const label = String(item?.label || item?.name || 'Item').trim();
    wrapText(label).forEach((line) => lines.push(line));

    if (item?.code) {
      wrapText(`Code: ${item.code}`).forEach((line) => lines.push(line));
      if (isOrderConfirmation) {
        lines.push('');
      }
    }

    if (isOrderConfirmation) {
      appendItemPriceColumns(lines, item);
    } else {
      appendPair(
        lines,
        `${Number(item?.qty || 0)} x ${formatMoney(item?.unitPrice || 0)}`,
        formatReceiptAmount(item?.subtotal || 0),
      );
    }

    if (index < items.length - 1) {
      lines.push('');
    }
  });

  lines.push(separator);
  appendPair(lines, 'Net:', formatReceiptAmount(receipt.netAmount || 0));
  appendPair(lines, 'VAT:', formatReceiptAmount(receipt.vatAmount || 0));
  appendPair(lines, 'Gross:', formatReceiptAmount(receipt.grossAmount || 0));
  appendPair(lines, 'TOTAL:', formatReceiptAmount(receipt.total || 0));

  if (isVoidedConfirmation) {
    lines.push(separator);
    appendCenteredText(lines, 'VOIDED');
    if (receipt.voidInfo?.voidedAt) {
      const voidDateTime = formatReceiptDateTime(receipt.voidInfo.voidedAt);
      appendField(lines, 'Void Date', voidDateTime.date);
      if (voidDateTime.time) appendField(lines, 'Void Time', voidDateTime.time);
    }
    if (receipt.voidInfo?.reason) {
      appendField(lines, 'Void Reason', receipt.voidInfo.reason);
    }
  }

  lines.push(separator);
  if (isCredit) {
    appendField(lines, 'Status', receipt.paymentStatus || 'Pending');
    if (Number(receipt.termDays) > 0) {
      appendField(lines, 'Term', `${Number(receipt.termDays)} days`);
    }
    if (receipt.dueDate) {
      appendField(lines, 'Due Date', receipt.dueDate);
    }
    if (receipt.creditPaymentMode) {
      appendField(lines, 'Mode', receipt.creditPaymentMode);
    }
    if (receipt.amountPaid !== null && receipt.amountPaid !== undefined) {
      appendPair(lines, 'Amount Paid:', formatReceiptAmount(receipt.amountPaid));
    }
    if (receipt.balance !== null && receipt.balance !== undefined) {
      appendPair(lines, 'Balance:', formatReceiptAmount(receipt.balance));
    }
  } else {
    if (receipt.specialOrderNumber && receipt.paymentStatus) {
      appendField(lines, 'Status', receipt.paymentStatus);
    }
    if (receipt.cash !== null && receipt.cash !== undefined && receipt.cash !== '') {
      appendPair(lines, 'Cash:', formatReceiptAmount(receipt.cash));
    }
    if (receipt.change !== null && receipt.change !== undefined && receipt.change !== '') {
      appendPair(lines, 'Change:', formatReceiptAmount(receipt.change));
    }
  }

  lines.push(separator);
  lines.push('');
  appendCenteredText(lines, 'THANK YOU!');
  appendCenteredText(lines, isOrderConfirmation
    ? 'For transaction reference only.'
    : 'Please keep this receipt.');
  lines.push('');
  return lines;
};

const buildReceiptCopyPayloads = (payload = {}) => {
  const { copyLabel: _legacyCopyLabel, ...basePayload } = payload;
  return Array.from({ length: RECEIPT_COPY_COUNT }, () => ({
    ...basePayload,
    receipt: { ...(basePayload.receipt || {}) },
  }));
};

const buildPowerShellPrintScript = (printerName = '') => {
  const normalizedPrinterName = String(printerName || '').trim();

  return `
param([string]$JsonPath, [string]$TimingId)

$ErrorActionPreference = 'Stop'

function Write-Timing([string]$Event) {
  Write-Output ("[PRINT_TIMING][$TimingId] $((Get-Date).ToString('o')) $Event")
}

Add-Type -AssemblyName System.Drawing
Write-Timing 'SYSTEM_DRAWING_LOADED'

$data = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$lines = @($data.lines)
$printerName = [string]$data.printerName
$contentWidthChars = [int]$data.contentWidthChars

Write-Timing 'PRINTER_RESOLUTION_STARTED'
$document = New-Object System.Drawing.Printing.PrintDocument
Write-Timing 'PRINT_DOCUMENT_CREATED'

if (-not [string]::IsNullOrWhiteSpace($printerName)) {
  $document.PrinterSettings.PrinterName = $printerName
} else {
  $installedPrinters = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
  $patterns = @('XP-58H', 'XP-58', 'XPrinter', 'Thermal', 'Receipt')
  foreach ($pattern in $patterns) {
    $match = $installedPrinters | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if ($match) {
      $document.PrinterSettings.PrinterName = [string]$match
      break
    }
  }
}

if (-not $document.PrinterSettings.IsValid) {
  $requestedName = if ([string]::IsNullOrWhiteSpace($printerName)) { 'an XP-58H-compatible receipt queue' } else { "'$printerName'" }
  throw "Printer $requestedName is not valid or not installed."
}
Write-Timing 'PRINTER_RESOLUTION_COMPLETED'
Write-Output ("SELECTED_PRINTER: {0}" -f $document.PrinterSettings.PrinterName)

$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$paperWidth = [int]$document.DefaultPageSettings.PaperSize.Width
if ($paperWidth -le 0) {
  $paperWidth = 189
}
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(4, 4, 5, 5)

$font = New-Object System.Drawing.Font('Consolas', 7.25)
$brush = [System.Drawing.Brushes]::Black
$lineHeight = 12
$paperHeight = [Math]::Max(300, (($lines.Count + 3) * $lineHeight))
$document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt', $paperWidth, $paperHeight)
$script:layoutMetrics = $null

try {
  $document.add_PrintPage({
      param($sender, $e)

      if ($contentWidthChars -gt 0) {
          $contentSample = '0' * $contentWidthChars
          $contentBlockWidth = $e.Graphics.MeasureString($contentSample, $font).Width
          $printableArea = $e.PageSettings.PrintableArea
          $centerOffset = ($printableArea.Width - $contentBlockWidth) / 2
          if ($centerOffset -lt 0) {
              $centerOffset = 0
          }
          $x = [single]$printableArea.Left + [single]$centerOffset
          $script:layoutMetrics = 'PRINT_LAYOUT: printableWidth={0:N2} blockWidth={1:N2} leftInset={2:N2} rightInset={3:N2}' -f $printableArea.Width, $contentBlockWidth, $x, ($printableArea.Width - $contentBlockWidth - $centerOffset)
      } else {
          $x = $e.MarginBounds.Left
      }
      $y = $e.MarginBounds.Top
      foreach ($line in $lines) {
          $text = [string]$line
          if ([string]::IsNullOrEmpty($text)) {
              $y += $lineHeight
              continue
          }
          $e.Graphics.DrawString($text, $font, $brush, $x, $y)
          $y += $lineHeight
      }

      $e.HasMorePages = $false
  })

  Write-Timing 'DOCUMENT_PRINT_STARTED'
  $document.Print()
  Write-Timing 'DOCUMENT_PRINT_RETURNED'
  if ($script:layoutMetrics) {
    Write-Output $script:layoutMetrics
  }
} catch {
  throw
} finally {
  $font.Dispose()
  $document.Dispose()
}
`;
};

const printWithPowerShell = async (payload = {}, timingId = createPrintTimingId()) => {
  const printerName = String(selectedPrinterName || '').trim();
  const lines = buildReceiptLines(payload);
  const tempFilePath = path.join(
    os.tmpdir(),
    `inventory-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const tempScriptPath = path.join(
    os.tmpdir(),
    `inventory-print-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`
  );

  const contentWidthChars = Array.isArray(payload.lines) && payload.lines.length > 0
    ? null
    : DEFAULT_WIDTH_CHARS;
  fs.writeFileSync(
    tempFilePath,
    JSON.stringify({ lines, printerName, contentWidthChars }, null, 2),
    'utf8',
  );
  logPrintTiming(timingId, 'RECEIPT_JSON_WRITTEN');

  const script = buildPowerShellPrintScript(printerName);

  fs.writeFileSync(tempScriptPath, script.trimStart(), 'utf8');
  logPrintTiming(timingId, 'POWERSHELL_SCRIPT_WRITTEN');

  try {
    const shellCandidates = ['pwsh', 'powershell'];
    let chosenShell = null;
    let output = '';

    for (const shellName of shellCandidates) {
      try {
        logPrintTiming(timingId, 'EXECFILE_CALLED', `shell=${shellName}`);
        const result = await new Promise((resolve, reject) => {
          const child = execFile(shellName, [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            tempScriptPath,
            tempFilePath,
            timingId,
          ], { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
              error.stdout = stdout;
              error.stderr = stderr;
              reject(error);
              return;
            }
            resolve({ stdout, stderr });
          });

          child.once('spawn', () => {
            logPrintTiming(timingId, 'POWERSHELL_PROCESS_STARTED', `shell=${shellName}`);
          });

          child.once('exit', (code, signal) => {
            logPrintTiming(timingId, 'POWERSHELL_PROCESS_EXITED', `code=${code ?? 'null'} signal=${signal || 'none'}`);
          });

          child.on('error', (error) => {
            logPrintTiming(timingId, 'POWERSHELL_PROCESS_ERROR', `message=${error.message}`);
          });
        });
        output = `${result.stdout || ''}${result.stderr || ''}`;
        if (output) console.log(output.trim());
        const match = output.match(/SELECTED_PRINTER:\s*(.+)/i);
        if (match) {
          selectedPrinterName = match[1].trim();
          printerSelectionSource = DEFAULT_PRINTER_NAME ? 'environment' : 'auto-detected';
        }
        chosenShell = shellName;
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.error('Print job failed:', error.stderr || error.stdout || error.message);
          throw error;
        }
      }
    }

    if (!chosenShell) {
      throw new Error('Unable to start PowerShell for printing.');
    }

    console.log(`Print succeeded on Windows queue: ${selectedPrinterName || printerName}`);
    return { ok: true, printerName: selectedPrinterName || printerName, source: chosenShell === 'pwsh' ? 'pwsh-printdocument' : 'powershell-printdocument', queued: true };
  } finally {
    try { fs.unlinkSync(tempFilePath); } catch {}
    try { fs.unlinkSync(tempScriptPath); } catch {}
  }
};

const printReceipt = async (
  payload = {},
  timingId = createPrintTimingId(),
  printJob = printWithPowerShell,
) => {
  // If caller provided explicit `lines` to print, allow printing without a receipt id.
  if (Array.isArray(payload.lines) && payload.lines.length > 0) {
    const result = await printJob(payload, timingId);
    return {
      ...result,
      fallbackUsed: true,
    };
  }

  const receipt = payload.receipt || {};
  if (!receipt.id) {
    const error = new Error('receipt.id is required.');
    error.status = 400;
    throw error;
  }

  const copyPayloads = buildReceiptCopyPayloads(payload);
  const completedCopies = [];
  let lastResult = null;

  for (let copyIndex = 0; copyIndex < copyPayloads.length; copyIndex += 1) {
    const copyPayload = copyPayloads[copyIndex];
    const copyNumber = copyIndex + 1;
    const copyTimingId = `${timingId}-copy-${copyNumber}`;

    try {
      logPrintTiming(timingId, 'COPY_PRINT_STARTED', `copy=${copyNumber}`);
      lastResult = await printJob(copyPayload, copyTimingId);
      completedCopies.push(copyNumber);
      logPrintTiming(timingId, 'COPY_PRINT_COMPLETED', `copy=${copyNumber}`);
    } catch (error) {
      const message = 'The receipt could not be printed. The completed sale remains valid and was not repeated.';
      const copyError = new Error(`${message} ${error?.message || 'Unable to print receipt copy.'}`);
      copyError.status = Number(error?.status || 500);
      copyError.completedCopies = completedCopies;
      copyError.failedCopy = copyNumber;
      copyError.cause = error;
      throw copyError;
    }
  }

  return {
    ...lastResult,
    fallbackUsed: true,
    copyCount: completedCopies.length,
    completedCopies,
  };
};

app.get('/health', (_req, res) => {
  return res.json({
    ok: true,
    printerName: selectedPrinterName || null,
    printerSelectionSource,
    configuredPrinterName: DEFAULT_PRINTER_NAME || null,
  });
});

app.post('/print', async (req, res) => {
  const timingId = createPrintTimingId();
  logPrintTiming(timingId, 'REQUEST_RECEIVED');

  try {
    const result = await printReceipt(req.body || {}, timingId);
    logPrintTiming(timingId, 'HTTP_202_RETURNED');
    return res.status(202).json(result);
  } catch (error) {
    console.error('Print request failed:', error);
    const status = Number(error.status || 500);
    return res.status(status).json({
      ok: false,
      message: error.message || 'Unable to print receipt.',
      completedCopies: Array.isArray(error.completedCopies) ? error.completedCopies : [],
      failedCopy: error.failedCopy || null,
    });
  }
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Receipt printer service listening on http://${HOST}:${PORT}`);
    if (DEFAULT_PRINTER_NAME) {
      console.log(`Target printer: ${DEFAULT_PRINTER_NAME}`);
    } else {
      console.log('Target printer: auto-detect XP-58H-compatible receipt queue');
    }
  });
}

module.exports = {
  app,
  buildPowerShellPrintScript,
  buildReceiptCopyPayloads,
  buildReceiptLines,
  printReceipt,
  printWithPowerShell,
};
