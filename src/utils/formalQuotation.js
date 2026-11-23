import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';
import { parseMoneyToCentavos } from './numericInput.js';

export const FORMAL_QUOTATION_INTRO = 'We are pleased to submit to you our quotation for your consideration.';
export const FORMAL_QUOTATION_DISCLAIMER = 'Prices are subject to change without prior notice.';

const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

const getExpiryLines = (item) => {
    if (item?.itemType === 'custom') {
        const manualDate = normalizeText(item.expiryDate);
        return manualDate ? [`Expiry: ${manualDate} (provided for quotation; not batch-verified)`] : [];
    }
    if (item?.itemType !== 'inventory' || item?.inventorySnapshot?.expiryTrackingEnabled !== true) return [];
    const quantity = Number(item.quantity ?? item.qty) || 0;
    const sellingUnit = normalizeText(item.sellingUnit || item.unit);
    const selections = Array.isArray(item.quotationExpirySelections) ? item.quotationExpirySelections : [];
    if (!selections.length) return [`Expiry: To be confirmed${quantity > 0 ? ` (${quantity}${sellingUnit ? ` ${sellingUnit}` : ''})` : ''}`];
    const selectedQuantity = selections.reduce((total, selection) => total + (Number(selection.quantity) || 0), 0);
    const lines = selections.map((selection) => {
        const selected = Number(selection.quantity) || 0;
        return `Expiry: ${normalizeText(selection.expiryDate)} · ${selected}${sellingUnit ? ` ${sellingUnit}` : ''} (selected for quotation only; batch not reserved or guaranteed)`;
    });
    const unassignedQuantity = Math.max(0, quantity - selectedQuantity);
    if (unassignedQuantity > 0) lines.push(`Expiry: To be confirmed (${unassignedQuantity}${sellingUnit ? ` ${sellingUnit}` : ''})`);
    return lines;
};

const getPrintedItemDescription = (item) => [item.description, ...(item.expiryLines || [])].filter(Boolean).join('\n');

const formatDate = (value) => {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
};

const localDateKey = (value) => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        return value.trim();
    }

    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatMoney = (value) => `PHP ${new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(Number(value) || 0)}`;

const categoryForItem = (categories, item) => (
    (Array.isArray(categories) ? categories : []).find(
        (category) => normalizeText(category?.name).toLowerCase() === normalizeText(item?.category).toLowerCase()
    ) || {}
);

const getItemSellingUnit = (item, category) => {
    const explicitUnit = normalizeText(item?.sellingUnit || item?.unit);
    if (explicitUnit) return explicitUnit;

    const categoryUnits = [...new Set(
        (Array.isArray(category?.sizeUnits) ? category.sizeUnits : [])
            .map(normalizeText)
            .filter(Boolean)
    )];

    // A single configured category unit is unambiguous. If a category supports
    // multiple units, do not guess which one applies to this product.
    return categoryUnits.length === 1 ? categoryUnits[0] : '';
};

const getItemVariantText = (item, category) => {
    const definitions = getEffectiveProductAttributes(category);
    const values = productAttributeValues(item, definitions);
    return definitions.map((definition) => {
        const value = values[definition.key];
        if (value === undefined || value === null || normalizeText(value) === '') return '';
        const formatted = definition.type === 'number_unit' && definition.unit
            ? `${value} ${definition.unit}`
            : String(value);
        return normalizeText(formatted);
    }).filter(Boolean).join(' · ');
};

const normalizeTaxTreatment = (customer = {}) => {
    const source = normalizeText(customer.taxTreatment).toLowerCase().replace(/[\s-]+/g, '_');
    if (source === 'vat_zero_rated') return { value: 'vat_zero_rated', label: 'VAT ZERO RATED' };
    if (source === 'exempt' || customer.isVatExempt === true) return { value: 'exempt', label: 'VAT EXEMPT' };
    return { value: 'standard', label: '' };
};

export const buildFormalQuotationModel = ({
    items = [],
    customer = {},
    settings = {},
    quotationDetails = {},
    categories = [],
    date = new Date(),
    allowPositionWithoutAttention = false,
} = {}) => {
    const customerName = normalizeText(customer.name);
    if (!customerName) throw new Error('Select a valid regular customer.');

    const attentionName = normalizeText(
        Object.prototype.hasOwnProperty.call(quotationDetails, 'attentionName')
            ? quotationDetails.attentionName
            : customer.attentionName
    );
    const attentionPosition = (attentionName || allowPositionWithoutAttention) ? normalizeText(
        Object.prototype.hasOwnProperty.call(quotationDetails, 'attentionPosition')
            ? quotationDetails.attentionPosition
            : customer.attentionPosition
    ) : '';
    const authorizedSignatoryName = normalizeText(
        Object.prototype.hasOwnProperty.call(quotationDetails, 'authorizedSignatoryName')
            ? quotationDetails.authorizedSignatoryName
            : settings.authorizedSignatoryName
    );
    if (!authorizedSignatoryName) {
        throw new Error('Authorized Signatory Name is required for a formal quotation.');
    }

    const taxTreatment = normalizeTaxTreatment(customer);
    const normalizedItems = (Array.isArray(items) ? items : []).map((item) => {
        const category = categoryForItem(categories, item);
        const quantity = Math.max(0, Number(item?.qty ?? item?.quantity) || 0);
        const sellingUnit = getItemSellingUnit(item, category);
        const productName = normalizeText(item?.name || item?.itemName) || 'Item';
        const requestedDescription = normalizeText(item?.description);
        const variantText = getItemVariantText(item, category);
        const descriptionParts = [
            [quantity, sellingUnit].filter((value) => value !== '').join(' '),
            productName,
            variantText,
        ].filter(Boolean);

        return {
            code: normalizeText(item?.code || item?.sku),
            quantity,
            sellingUnit,
            productName,
            variantText,
            description: requestedDescription
                ? `${descriptionParts.join(' ')} – ${requestedDescription}`
                : descriptionParts.join(' '),
            expiryLines: getExpiryLines(item),
            unitPrice: Number(item?.price ?? item?.unitPrice) || 0,
            lineAmount: quantity * (Number(item?.price ?? item?.unitPrice) || 0),
            images: Array.isArray(item?.images) ? item.images : [],
        };
    });

    return {
        quotationType: 'regular_customer',
        title: 'PRICE QUOTATION',
        quotationNumber: normalizeText(quotationDetails.quotationNumber),
        specialOrderNumber: normalizeText(quotationDetails.specialOrderNumber),
        dateIso: localDateKey(date),
        dateDisplay: formatDate(date),
        company: {
            name: normalizeText(settings.storeName) || 'Tableria La Confianza Co., Inc.',
            subtitle: normalizeText(settings.storeBusinessSubtitle),
            address: normalizeText(settings.storeAddress),
            contacts: [settings.contactPhone, settings.contactPhoneSecondary].map(normalizeText).filter(Boolean),
            emails: [settings.storePrimaryEmail, settings.storeSecondaryEmail].map(normalizeText).filter(Boolean),
        },
        customer: {
            id: normalizeText(customer._id || customer.id),
            name: customerName,
            address: normalizeText(customer.address),
            contact: normalizeText(customer.contact),
            email: normalizeText(customer.email),
            attentionName,
            attentionPosition,
        },
        items: normalizedItems,
        introduction: FORMAL_QUOTATION_INTRO,
        nothingFollows: '--nothing follows--',
        taxTreatment: taxTreatment.value,
        taxLabel: taxTreatment.label,
        disclaimer: FORMAL_QUOTATION_DISCLAIMER,
        signatory: {
            companyName: normalizeText(settings.storeName) || 'Tableria La Confianza Co., Inc.',
            name: authorizedSignatoryName,
        },
    };
};

// Special Orders render only the selected saved version. Never accept current
// company/customer/product settings as a fallback for a generated document.
export const buildSpecialOrderFormalQuotationModel = (document) => {
    if (document?.schemaVersion !== 1) throw new Error('Quotation document snapshot is unavailable. Request administrative review.');
    const date = document.quotationDate ? new Date(document.quotationDate) : null;
    if (!date || Number.isNaN(date.getTime())) throw new Error('Saved quotation date is unavailable. Request administrative review.');
    if (!normalizeText(document.settings?.storeName)) throw new Error('Saved company information is unavailable. Request administrative review.');
    if (!normalizeText(document.quotationDetails?.authorizedSignatoryName)) throw new Error('Authorized Signatory Name is missing from this version. Edit Draft and Generate Quotation, or request historical document review.');
    if (!normalizeText(document.quotationNumber) || !normalizeText(document.specialOrderNumber) || !Number.isSafeInteger(document.version) || document.version < 1) throw new Error('Saved quotation identifiers are unavailable. Request administrative review.');
    if (!Array.isArray(document.items) || !document.items.length) throw new Error('Saved quotation items are unavailable.');
    const amountCents = (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
        const cents = Math.round(value * 100);
        return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) <= Math.max(1e-7, Math.abs(value * 100) * Number.EPSILON * 4) ? cents : null;
    };
    let totalCents = 0;
    const lines = document.items.map((item) => {
        if (!normalizeText(item.itemName)) throw new Error('Saved quotation item name is unavailable.');
        const unitCents = parseMoneyToCentavos(String(item.unitPrice ?? ''));
        const lineCents = item.quantity * unitCents;
        if (unitCents === null || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(lineCents) || lineCents !== amountCents(item.lineAmount)) throw new Error('Saved quotation amounts do not match the item calculations. Request administrative review.');
        totalCents += lineCents;
        return lineCents / 100;
    });
    if (!Number.isSafeInteger(totalCents) || amountCents(document.subtotal) !== totalCents || amountCents(document.total) !== totalCents) throw new Error('Saved quotation amounts do not match the grand total. Request administrative review.');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type) => parts.find((value) => value.type === type).value;
    const dateIso = `${part('year')}-${part('month')}-${part('day')}`;
    const model = buildFormalQuotationModel({ items: document.items, customer: document.customer, settings: document.settings, quotationDetails: { ...document.quotationDetails, quotationNumber: document.quotationNumber, specialOrderNumber: document.specialOrderNumber }, date, allowPositionWithoutAttention: true });
    const fulfillment = document.fulfillment;
    const fulfillmentText = fulfillment?.method === 'Free Delivery'
        ? ['Free Delivery within Laguna', [fulfillment.addressLine, fulfillment.barangay, fulfillment.cityMunicipality].filter(Boolean).join(', '), fulfillment.preferredDate ? `Preferred date: ${fulfillment.preferredDate}` : ''].filter(Boolean).join(' · ')
        : fulfillment?.method === 'Store Pickup' ? ['Store Pickup', fulfillment.preferredDate ? `Preferred date: ${fulfillment.preferredDate}` : ''].filter(Boolean).join(' · ') : '';
    return {
        ...model,
        documentScope: 'special-order', version: document.version,
        ...(document.taxTreatment === 'standard' ? { taxTreatment: 'standard', taxLabel: 'VAT-RATED' } : {}),
        fulfillmentText,
        dateIso, dateDisplay: date.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' }),
        items: model.items.map((item, index) => ({ ...item, itemId: document.items[index].itemId || '', images: document.items[index].images || [], lineAmount: lines[index] })),
        subtotal: totalCents / 100, total: totalCents / 100,
    };
};

export const buildFormalQuotationFilename = (customerName, date = new Date(), { quotationNumber = '', version } = {}) => {
    const safeCustomer = normalizeText(customerName)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase()
        .slice(0, 80);
    const suffix = localDateKey(date) || localDateKey(new Date());
    const safeQuotation = normalizeText(quotationNumber).replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
    const versionSuffix = Number.isSafeInteger(version) && version > 0 ? `-v${version}` : '';
    return `Price-Quotation${safeCustomer ? `-${safeCustomer}` : ''}${safeQuotation ? `-${safeQuotation}${versionSuffix}` : ''}-${suffix}.pdf`;
};

export const createFormalQuotationPdf = (quotation) => {
    if (quotation?.quotationType !== 'regular_customer' || !Array.isArray(quotation?.items)) {
        throw new Error('Formal quotation data is unavailable.');
    }
    if (quotation.documentScope === 'special-order' && quotation.items.some((item) => (item.images || []).some((image) => image.key && !image.src))) {
        throw new Error('A saved product photo could not be loaded. Retry the quotation preview before downloading.');
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18;
    const verticalMargin = 16;
    const contentWidth = pageWidth - (margin * 2);
    let y = verticalMargin;

    const drawCenteredBlock = (value, { maxWidth = contentWidth, lineHeight = 4.5 } = {}) => {
        const lines = pdf.splitTextToSize(String(value || ''), maxWidth);
        pdf.text(lines, pageWidth / 2, y, { align: 'center' });
        y += Math.max(1, lines.length) * lineHeight;
    };

    pdf.setTextColor(17, 24, 39);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13.5);
    drawCenteredBlock(quotation.company.name, { lineHeight: 6.5 });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    if (quotation.company.subtitle) drawCenteredBlock(quotation.company.subtitle);
    if (quotation.company.address) {
        pdf.setFontSize(8.25);
        drawCenteredBlock(quotation.company.address);
    }
    const contacts = quotation.company.contacts.join(' | ');
    if (contacts) {
        pdf.setFontSize(7.5);
        drawCenteredBlock(contacts, { lineHeight: 4 });
    }
    const emails = quotation.company.emails.join(' | ');
    if (emails) {
        pdf.setFontSize(7.5);
        drawCenteredBlock(emails, { lineHeight: 4 });
    }

    y += 6;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(quotation.title, pageWidth / 2, y, { align: 'center' });
    y += 11;

    pdf.setFontSize(8.25);
    pdf.text('DATE:', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(quotation.dateDisplay, margin + 24, y);
    y += 7;
    if (quotation.documentScope !== 'special-order' && quotation.quotationNumber) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('QUOTE:', margin, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(quotation.quotationNumber, margin + 24, y);
        y += 7;
    }
    if (quotation.specialOrderNumber) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('ORDER:', margin, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(quotation.specialOrderNumber, margin + 24, y);
        y += 7;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.text('TO:', margin, y);
    pdf.setFont('helvetica', 'normal');
    const customerNameLines = pdf.splitTextToSize(quotation.customer.name, contentWidth - 24);
    pdf.text(customerNameLines, margin + 24, y);
    y += Math.max(1, customerNameLines.length) * 4.5;
    if (quotation.customer.address) {
        const addressLines = pdf.splitTextToSize(quotation.customer.address, contentWidth - 24);
        pdf.text(addressLines, margin + 24, y);
        y += addressLines.length * 4.5;
    }

    const attention = [quotation.customer.attentionName, quotation.customer.attentionPosition].filter(Boolean).join(' – ');
    if (attention) {
        y += 2;
        pdf.setFont('helvetica', 'bold');
        pdf.text('ATTN.:', margin, y);
        pdf.setFont('helvetica', 'normal');
        const attentionLines = pdf.splitTextToSize(attention, contentWidth - 24);
        pdf.text(attentionLines, margin + 24, y);
        y += Math.max(1, attentionLines.length) * 4.5 + 2.5;
    } else {
        y += 4;
    }

    if (quotation.documentScope === 'special-order' && quotation.fulfillmentText) {
        y += 2;
        pdf.setFont('helvetica', 'bold');
        pdf.text('PICKUP OR DELIVERY:', margin, y);
        pdf.setFont('helvetica', 'normal');
        const lines = pdf.splitTextToSize(quotation.fulfillmentText, contentWidth - 34);
        pdf.text(lines, margin + 34, y);
        y += Math.max(1, lines.length) * 4.5 + 2.5;
    }

    pdf.setFont('helvetica', 'normal');
    const introductionLines = pdf.splitTextToSize(quotation.introduction, contentWidth);
    pdf.text(introductionLines, margin, y);
    y += Math.max(1, introductionLines.length) * 4.5;

    const specialOrderPhotos = quotation.documentScope === 'special-order';
    const photoBox = { width: 54, height: 36, gap: 3 };
    const quantityWidth = 14.8;
    const priceWidth = contentWidth * 0.22;
    const amountWidth = contentWidth * 0.22;
    const tableWidths = [contentWidth - quantityWidth - priceWidth - amountWidth, quantityWidth, priceWidth, amountWidth];
    const tableCellHorizontalPadding = 2.1;
    const rowHeights = specialOrderPhotos ? quotation.items.map((item) => {
        const values = [getPrintedItemDescription(item), String(item.quantity), `${formatMoney(item.unitPrice)}${item.sellingUnit ? ` / ${item.sellingUnit}` : ''}`, formatMoney(item.lineAmount)];
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.25);
        const textHeight = Math.max(...values.map((value, index) => pdf.splitTextToSize(value, tableWidths[index] - (tableCellHorizontalPadding * 2)).length * 4.5));
        // The preview places photos immediately below each item's text, with
        // only the image-row bottom padding. Do not reserve an extra blank gap.
        return textHeight + 6.4 + ((item.images || []).some((image) => image.src) ? photoBox.height + 3.2 : 0);
    }) : [];
    const closingCompanyLines = pdf.splitTextToSize(quotation.signatory.companyName, contentWidth);
    const closingNameLines = pdf.splitTextToSize(quotation.signatory.name, contentWidth);
    const disclaimerLines = pdf.splitTextToSize(quotation.disclaimer, contentWidth);
    const hasGrandTotal = quotation.documentScope === 'special-order';
    const requiredFooterHeight = (hasGrandTotal ? 12 : 0)
        + 4.5 + 3.5
        + (quotation.taxLabel ? 4.5 + 2.5 : 0)
        + (disclaimerLines.length * 4.5) + 8.5
        + 4.5 + 3.5
        + (closingCompanyLines.length * 4.5) + 7.5
        + (closingNameLines.length * 4.5);
    const renderItems = (items, startY, indexOffset = 0, showHeader = true) => autoTable(pdf, {
        startY,
        head: showHeader ? [['Description', 'Qty', 'Unit Price', 'Amount']] : [],
        body: items.map((item) => [getPrintedItemDescription(item), String(item.quantity), `${formatMoney(item.unitPrice)}${item.sellingUnit ? ` / ${item.sellingUnit}` : ''}`, formatMoney(item.lineAmount)]),
        theme: 'grid',
        margin: { left: margin, right: margin, top: verticalMargin, bottom: verticalMargin },
        styles: { font: 'helvetica', fontSize: 8.25, cellPadding: { top: 3.2, right: tableCellHorizontalPadding, bottom: 3.2, left: tableCellHorizontalPadding }, textColor: [31, 41, 55], lineColor: [203, 213, 225], lineWidth: 0.25, overflow: 'linebreak' },
        headStyles: {
            fontSize: 7.5,
            fillColor: [255, 255, 255],
            textColor: [31, 41, 55],
            fontStyle: 'bold',
            lineColor: [203, 213, 225],
            lineWidth: 0.25,
        },
        columnStyles: { 0: { cellWidth: tableWidths[0] }, 1: { cellWidth: tableWidths[1], halign: 'right' }, 2: { cellWidth: tableWidths[2], halign: 'right' }, 3: { cellWidth: tableWidths[3], halign: 'right' } },
        didParseCell: (data) => {
            if (specialOrderPhotos && data.section === 'body' && rowHeights[indexOffset + data.row.index]) {
                data.cell.styles.minCellHeight = rowHeights[indexOffset + data.row.index];
            }
        },
        didDrawCell: (data) => {
            // Draw after the final cell so its fill cannot cover photos spanning
            // the full row beneath the item details.
            if (!specialOrderPhotos || data.section !== 'body' || data.column.index !== 3) return;
            const images = (quotation.items[indexOffset + data.row.index]?.images || []).filter((image) => image.src).slice(0, 3);
            if (!images.length) return;
            const imageY = data.cell.y + data.cell.height - 3.2 - photoBox.height;
            const rowX = data.cell.x - tableWidths.slice(0, 3).reduce((sum, width) => sum + width, 0);
            const rowBottom = data.cell.y + data.cell.height;
            pdf.setFillColor(255, 255, 255);
            // Clear the table's vertical cell rules through the photo area so
            // images sit below the details without being boxed into columns.
            pdf.rect(rowX - 0.5, imageY - 1, contentWidth + 1, rowBottom - imageY + 1, 'F');
            images.forEach((image, imageIndex) => {
                try {
                    const properties = pdf.getImageProperties(image.src);
                    const ratio = Math.min(photoBox.width / properties.width, photoBox.height / properties.height);
                    const width = properties.width * ratio;
                    const height = properties.height * ratio;
                    const boxX = rowX + tableCellHorizontalPadding + imageIndex * (photoBox.width + photoBox.gap);
                    pdf.addImage(image.src, undefined, boxX + (photoBox.width - width) / 2, imageY + (photoBox.height - height) / 2, width, height);
                } catch { throw new Error(`Unable to include product photo ${image.originalName || ''} in the quotation PDF.`); }
            });
            // Keep a continuous product separator below the ungridded photo
            // area; the next product's columns begin at this same boundary.
            pdf.setDrawColor(203, 213, 225);
            pdf.setLineWidth(0.25);
            pdf.line(rowX, rowBottom, rowX + contentWidth, rowBottom);
        },
        rowPageBreak: 'avoid',
        showHead: 'everyPage',
    });
    if (specialOrderPhotos && quotation.items.length > 1) {
        renderItems(quotation.items.slice(0, -1), y + 3);
        const lastIndex = quotation.items.length - 1;
        let lastStart = pdf.lastAutoTable.finalY;
        const newPage = lastStart + rowHeights[lastIndex] + requiredFooterHeight + 8 > pageHeight - verticalMargin;
        if (newPage) {
            pdf.addPage();
            lastStart = verticalMargin;
        }
        renderItems(quotation.items.slice(-1), lastStart, lastIndex, newPage);
    } else {
        renderItems(quotation.items, y + 3);
    }

    let footerY = pdf.lastAutoTable.finalY + 8;
    if (footerY + requiredFooterHeight > pageHeight - verticalMargin) {
        pdf.addPage();
        footerY = verticalMargin;
    }

    const footerText = (lines, x, options = {}) => {
        for (const line of (Array.isArray(lines) ? lines : [lines])) {
            if (footerY > pageHeight - verticalMargin) { pdf.addPage(); footerY = verticalMargin; }
            pdf.text(line, x, footerY, options);
            footerY += 4.5;
        }
    };
    if (hasGrandTotal) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.25);
        pdf.setTextColor(17, 24, 39);
        pdf.text('Grand Total', margin, footerY);
        pdf.text(formatMoney(quotation.total), pageWidth - margin, footerY, { align: 'right' });
        footerY += 12;
    }

    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(7.5);
    pdf.setTextColor(75, 85, 99);
    footerText(quotation.nothingFollows, pageWidth / 2, { align: 'center' });
    footerY += 3.5;
    if (quotation.taxLabel) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.25);
        pdf.setTextColor(17, 24, 39);
        footerText(quotation.taxLabel, margin);
        footerY += 2.5;
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(75, 85, 99);
    footerText(disclaimerLines, margin);
    footerY += 8.5;
    pdf.setTextColor(31, 41, 55);
    pdf.setFontSize(8.25);
    footerText('Very truly yours,', margin);
    footerY += 3.5;
    pdf.setFont('helvetica', 'bold');
    footerText(closingCompanyLines, margin);
    footerY += 7.5;
    footerText(closingNameLines, margin);
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
    }

    return {
        pdf,
        filename: buildFormalQuotationFilename(quotation.customer.name, quotation.dateIso, quotation.documentScope === 'special-order' ? quotation : {}),
    };
};

export const downloadFormalQuotationPdf = (quotation) => {
    const result = createFormalQuotationPdf(quotation);
    result.pdf.save(result.filename);
    return result.filename;
};
