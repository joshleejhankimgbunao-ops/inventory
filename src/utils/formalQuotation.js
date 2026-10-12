import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getEffectiveProductAttributes, productAttributeValues } from './productAttributes.js';

export const FORMAL_QUOTATION_INTRO = 'We are pleased to submit to you our quotation for your consideration.';
export const FORMAL_QUOTATION_DISCLAIMER = 'Prices are subject to change without prior notice.';

const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

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
} = {}) => {
    const customerName = normalizeText(customer.name);
    if (!customerName) throw new Error('Select a valid regular customer.');

    const attentionName = normalizeText(
        Object.prototype.hasOwnProperty.call(quotationDetails, 'attentionName')
            ? quotationDetails.attentionName
            : customer.attentionName
    );
    const attentionPosition = attentionName
        ? normalizeText(
            Object.prototype.hasOwnProperty.call(quotationDetails, 'attentionPosition')
                ? quotationDetails.attentionPosition
                : customer.attentionPosition
        )
        : '';
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
        const productName = normalizeText(item?.name) || 'Item';
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
            description: descriptionParts.join(' '),
            unitPrice: Number(item?.price ?? item?.unitPrice) || 0,
        };
    });

    return {
        quotationType: 'regular_customer',
        title: 'PRICE QUOTATION',
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

export const buildFormalQuotationFilename = (customerName, date = new Date()) => {
    const safeCustomer = normalizeText(customerName)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase()
        .slice(0, 80);
    const suffix = localDateKey(date) || localDateKey(new Date());
    return `Price-Quotation${safeCustomer ? `-${safeCustomer}` : ''}-${suffix}.pdf`;
};

export const createFormalQuotationPdf = (quotation) => {
    if (quotation?.quotationType !== 'regular_customer' || !Array.isArray(quotation?.items)) {
        throw new Error('Formal quotation data is unavailable.');
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - (margin * 2);
    let y = 18;

    const drawCenteredBlock = (value, { maxWidth = contentWidth, lineHeight = 4.5 } = {}) => {
        const lines = pdf.splitTextToSize(String(value || ''), maxWidth);
        pdf.text(lines, pageWidth / 2, y, { align: 'center' });
        y += Math.max(1, lines.length) * lineHeight;
    };

    pdf.setTextColor(17, 24, 39);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    drawCenteredBlock(quotation.company.name, { lineHeight: 6.5 });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    [quotation.company.subtitle, quotation.company.address, quotation.company.contacts.join(' | '), quotation.company.emails.join(' | ')]
        .filter(Boolean)
        .forEach((line) => {
            drawCenteredBlock(line);
        });

    y += 6;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text(quotation.title, pageWidth / 2, y, { align: 'center' });
    y += 11;

    pdf.setFontSize(9);
    pdf.text('DATE:', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(quotation.dateDisplay, margin + 24, y);
    y += 7;
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

    pdf.setFont('helvetica', 'normal');
    const introductionLines = pdf.splitTextToSize(quotation.introduction, contentWidth);
    pdf.text(introductionLines, margin, y);
    y += Math.max(1, introductionLines.length) * 4.5;

    autoTable(pdf, {
        startY: y + 3,
        head: [['Description', 'Unit Price']],
        body: quotation.items.map((item) => [item.description, `${formatMoney(item.unitPrice)}${item.sellingUnit ? ` / ${item.sellingUnit}` : ''}`]),
        theme: 'grid',
        margin: { left: margin, right: margin, bottom: 28 },
        styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3.2, textColor: [31, 41, 55], lineColor: [209, 213, 219], lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 121 }, 1: { cellWidth: 53, halign: 'right' } },
        rowPageBreak: 'avoid',
        showHead: 'everyPage',
    });

    let footerY = pdf.lastAutoTable.finalY + 8;
    const requiredFooterHeight = 58;
    if (footerY + requiredFooterHeight > pageHeight - margin) {
        pdf.addPage();
        footerY = margin;
    }

    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(75, 85, 99);
    pdf.text(quotation.nothingFollows, pageWidth / 2, footerY, { align: 'center' });
    footerY += 8;
    if (quotation.taxLabel) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(17, 24, 39);
        pdf.text(quotation.taxLabel, margin, footerY);
        footerY += 7;
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(75, 85, 99);
    pdf.text(quotation.disclaimer, margin, footerY, { maxWidth: contentWidth });
    footerY += 13;
    pdf.setTextColor(31, 41, 55);
    pdf.text('Very truly yours,', margin, footerY);
    footerY += 8;
    pdf.setFont('helvetica', 'bold');
    pdf.text(quotation.signatory.companyName, margin, footerY);
    footerY += 12;
    pdf.text(quotation.signatory.name, margin, footerY);
    footerY += 5;
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(107, 114, 128);
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
    }

    return {
        pdf,
        filename: buildFormalQuotationFilename(quotation.customer.name, quotation.dateIso),
    };
};

export const downloadFormalQuotationPdf = (quotation) => {
    const result = createFormalQuotationPdf(quotation);
    result.pdf.save(result.filename);
    return result.filename;
};
