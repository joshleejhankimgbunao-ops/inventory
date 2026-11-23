import { formatCurrency } from './numberFormat.js';
import { buildQuotationThermalHeaderLines } from './quotationThermalHeader.js';

const THERMAL_LINE_WIDTH = 30;
const SEPARATOR = '-'.repeat(THERMAL_LINE_WIDTH);

const wrapQuotationLine = (value, width = THERMAL_LINE_WIDTH) => {
    const source = String(value || '').trim();
    if (!source) return [''];

    const lines = [];
    let currentLine = '';
    source.split(/\s+/).forEach((word) => {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length <= width) {
            currentLine = candidate;
            return;
        }

        if (currentLine) lines.push(currentLine);
        if (word.length > width) {
            for (let index = 0; index < word.length; index += width) {
                lines.push(word.slice(index, index + width));
            }
            currentLine = '';
            return;
        }

        currentLine = word;
    });

    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
};

const appendWrappedText = (lines, value) => {
    if (String(value || '').trim()) lines.push(...wrapQuotationLine(value));
};

export const buildQuotationPrintLayout = (receipt = {}) => {
    const headerLines = buildQuotationThermalHeaderLines(receipt);
    const lines = [...headerLines];
    const centeredLineIndexes = [];
    const alignedTextLines = [];
    const fullWidthSeparatorLineIndexes = [];
    const appendSeparator = () => {
        fullWidthSeparatorLineIndexes.push(lines.length);
        lines.push(SEPARATOR);
    };
    const appendAlignedLine = (leftText, rightText) => {
        const lineIndex = lines.length;
        alignedTextLines.push({ lineIndex, leftText, rightText });
        lines.push(`${leftText} ${rightText}`);
    };

    appendSeparator();
    if (String(receipt.title || '').trim()) {
        centeredLineIndexes.push(lines.length);
        lines.push(String(receipt.title).trim());
    }
    appendSeparator();

    const items = Array.isArray(receipt.items) ? receipt.items : [];
    items.forEach((item, index) => {
        lines.push(...wrapQuotationLine(item?.name));
        const quantity = String(item?.quantity ?? '');
        appendAlignedLine(
            `${quantity} × ${formatCurrency(item?.unitPrice)}`,
            formatCurrency(item?.amount),
        );
        if (index < items.length - 1) lines.push('');
    });

    appendSeparator();
    appendAlignedLine('TOTAL:', formatCurrency(receipt.total));
    lines.push('');
    appendWrappedText(lines, receipt.footer);

    return {
        lines,
        centeredHeaderLineCount: headerLines.length,
        centeredLineIndexes,
        alignedTextLines,
        fullWidthSeparatorLineIndexes,
    };
};

export const buildQuotationPrintLines = (receipt = {}) => buildQuotationPrintLayout(receipt).lines;
