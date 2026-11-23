import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoSource from '../assets/logo.png';
export { buildQuotationPrintLayout, buildQuotationPrintLines } from './quotationThermalLayout.js';

export const buildQuotationReceiptModel = (quotation = {}, settings = {}) => {
    const storeName = String(settings?.storeName || 'Quotation').trim();
    const storeAddress = String(settings?.storeAddress || '').trim();
    const contactPhone = String(settings?.contactPhone || '').trim();
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
        quotationNumber: String(quotation?.quotationNumber || '').trim(),
        generatedAt: quotation?.generatedAt || new Date().toISOString(),
        cashierName: String(quotation?.cashierName || '').trim(),
        customerType: 'Walk-In',
        title: 'QUOTATION',
        items: normalizedItems,
        total: Number(quotation?.total) || 0,
        footer: 'This quotation is for estimation purposes only. Prices are subject to change without prior notice.',
    };
};

const loadQuotationLogo = () => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the company logo for the quotation PDF.'));
    image.src = logoSource;
});

export const downloadWalkInQuotationPdf = async (receipt = {}) => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    const safeText = (value) => String(value || '').trim();
    const formatPdfMoney = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
    const formatPdfAmount = (value) => Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const generatedDate = new Date(receipt.generatedAt || Date.now());
    const generatedDateText = Number.isNaN(generatedDate.getTime())
        ? ''
        : generatedDate.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
    const cashierName = safeText(receipt.cashierName) || 'POS Cashier';

    pdf.setFillColor(15, 23, 42);
    pdf.rect(0, 0, pageWidth, 8, 'F');
    pdf.setDrawColor(15, 23, 42);
    pdf.setLineWidth(0.5);
    pdf.line(margin, 17, pageWidth - margin, 17);

    const logo = await loadQuotationLogo();
    const logoSize = 14;
    pdf.addImage(logo, 'PNG', margin, 21, logoSize, logoSize);

    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text((safeText(receipt.storeName) || 'Tableria La Confianza Co., Inc.').toUpperCase(), margin + logoSize + 4, 27);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(100, 116, 139);
    const companyContact = [safeText(receipt.storeAddress), safeText(receipt.contactPhone) ? `Contact: ${safeText(receipt.contactPhone)}` : '']
        .filter(Boolean)
        .join('  |  ');
    if (companyContact) pdf.text(companyContact, margin + logoSize + 4, 34);

    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text('QUOTATION', pageWidth - margin, 27, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text('WALK-IN ESTIMATE', pageWidth - margin, 34, { align: 'right' });

    const metadataY = 47;
    const metadataHeight = 24;
    const metadataColumnWidth = contentWidth / 3;
    const metadata = [
        ['DATE AND TIME', generatedDateText],
        ['ISSUED BY', cashierName],
        ['TYPE', safeText(receipt.customerType) || 'Walk-In'],
    ];

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.25);
    pdf.line(margin, metadataY, pageWidth - margin, metadataY);
    pdf.line(margin, metadataY + metadataHeight, pageWidth - margin, metadataY + metadataHeight);
    metadata.forEach(([label, value], index) => {
        const columnX = margin + (index * metadataColumnWidth);
        if (index > 0) pdf.line(columnX, metadataY + 4, columnX, metadataY + metadataHeight - 4);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text(label, columnX + 4, metadataY + 8);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(15, 23, 42);
        const valueLines = pdf.splitTextToSize(value || '—', metadataColumnWidth - 8);
        pdf.text(valueLines.slice(0, 2), columnX + 4, metadataY + 15);
    });

    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('QUOTATION ESTIMATE', margin, 84);

    autoTable(pdf, {
        startY: 91,
        margin: { left: margin, right: margin },
        head: [['ITEM DESCRIPTION', 'QTY', 'UNIT PRICE (PHP)', 'AMOUNT (PHP)']],
        body: (Array.isArray(receipt.items) ? receipt.items : []).map((item) => [
            safeText(item.name) || 'Item',
            String(item.quantity ?? ''),
            formatPdfAmount(item.unitPrice),
            formatPdfAmount(item.amount),
        ]),
        theme: 'plain',
        styles: {
            font: 'helvetica',
            fontSize: 9.5,
            textColor: [51, 65, 85],
            cellPadding: { top: 3.5, right: 3, bottom: 3.5, left: 3 },
            lineColor: [226, 232, 240],
            lineWidth: 0.2,
            valign: 'middle',
        },
        headStyles: {
            fontStyle: 'bold',
            fontSize: 8,
            textColor: [71, 85, 105],
            fillColor: [248, 250, 252],
            lineColor: [15, 23, 42],
            lineWidth: { bottom: 0.6 },
        },
        alternateRowStyles: { fillColor: [251, 252, 253] },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { halign: 'right', cellWidth: 18 },
            2: { halign: 'right', cellWidth: 38 },
            3: { halign: 'right', cellWidth: 38 },
        },
    });

    const totalY = (pdf.lastAutoTable?.finalY || 91) + 10;
    const totalBoxWidth = 82;
    const totalBoxX = pageWidth - margin - totalBoxWidth;
    pdf.setDrawColor(15, 23, 42);
    pdf.setLineWidth(0.6);
    pdf.line(totalBoxX, totalY - 5, pageWidth - margin, totalY - 5);
    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text('TOTAL AMOUNT', totalBoxX, totalY + 3);
    pdf.setFontSize(12);
    pdf.text(formatPdfMoney(receipt.total), pageWidth - margin, totalY + 3, { align: 'right' });

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.25);
    pdf.line(margin, pageHeight - 29, pageWidth - margin, pageHeight - 29);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    const footerLines = pdf.splitTextToSize(safeText(receipt.footer), contentWidth - 12);
    pdf.text(footerLines, pageWidth / 2, pageHeight - 21, { align: 'center' });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `Quotation_WalkIn_${timestamp}.pdf`;
    pdf.save(filename);
    return filename;
};
