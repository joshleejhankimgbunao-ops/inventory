import { formatCurrency } from './numberFormat.js';

const THERMAL_LINE_WIDTH = 32;
const SEPARATOR = '-'.repeat(THERMAL_LINE_WIDTH);
const ITEM_PRICE_COLUMNS_HEADER = 'QTY  UNIT PRICE  AMOUNT';

const wrapQuotationLine = (value, width = THERMAL_LINE_WIDTH) => {
    const source = String(value || '').trim();
    if (!source) return [''];

    const words = source.split(/\s+/);
    const lines = [];
    let currentLine = '';

    words.forEach((word) => {
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

const buildQuotationItemPriceLines = (item) => {
    const quantity = String(item?.quantity ?? '');
    const unitPrice = formatCurrency(item?.unitPrice);
    const amount = formatCurrency(item?.amount);
    const row = `${quantity.padStart(3)}  ${unitPrice.padStart(10)}  ${amount.padStart(10)}`;

    if (row.length <= THERMAL_LINE_WIDTH) return [row];

    return [
        `Qty: ${quantity}`,
        `Unit Price: ${unitPrice}`,
        `Amount: ${amount}`,
    ].flatMap((line) => wrapQuotationLine(line));
};

export const buildQuotationReceiptModel = (quotation = {}, settings = {}) => {
    const storeName = String(settings?.storeName || 'Quotation').trim();
    const storeAddress = String(settings?.storeAddress || '').trim();
    const contactPhone = String(settings?.contactPhone || '').trim();
    const customerName = String(quotation?.customerName || '').trim();
    const date = String(quotation?.date || '').trim();
    const items = Array.isArray(quotation?.items) ? quotation.items : [];

    const normalizedItems = items.map((item) => {
        const name = String(item?.name || item?.label || 'Item').trim();
        const code = String(item?.code || '').trim();
        const quantity = Number(item?.qty || 0) || 0;
        const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
        const amount = quantity * unitPrice;

        return {
            name,
            code,
            quantity,
            unitPrice,
            amount,
        };
    });

    return {
        storeName,
        storeAddress,
        contactPhone,
        title: 'QUOTATION',
        customerName,
        date,
        items: normalizedItems,
        total: Number(quotation?.total) || 0,
        footer: 'This quotation is for estimation purposes only. Prices are subject to change without prior notice.',
    };
};

export const buildQuotationPrintLines = (receipt = {}) => [
    receipt.storeName,
    receipt.storeAddress,
    receipt.contactPhone ? `Contact: ${receipt.contactPhone}` : '',
    SEPARATOR,
    receipt.title,
    `Customer: ${receipt.customerName}`,
    `Date: ${receipt.date}`,
    SEPARATOR,
    'ITEM',
    ITEM_PRICE_COLUMNS_HEADER,
    ...(Array.isArray(receipt.items) ? receipt.items : []).flatMap((item) => [
        ...wrapQuotationLine(item.name),
        ...buildQuotationItemPriceLines(item),
    ]),
    SEPARATOR,
    `TOTAL: ${formatCurrency(receipt.total)}`,
    '',
    receipt.footer,
].filter((line) => String(line || '').trim().length > 0);
