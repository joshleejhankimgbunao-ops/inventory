import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const hasSavedNumber = (value) => value !== null
  && value !== undefined
  && value !== ''
  && Number.isFinite(Number(value));

const formatMoney = (value) => `PHP ${new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))}`;

const formatDate = (value, includeTime = false) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
};

const formatLabel = (value) => String(value || '')
  .trim()
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const loadPdfLogo = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Unable to prepare the company logo for the PDF.'));
      return;
    }

    context.drawImage(image, 0, 0);
    resolve({
      dataUrl: canvas.toDataURL('image/png'),
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  };
  image.onerror = () => reject(new Error('Unable to load the company logo for the PDF.'));
  image.src = source;
});

export const buildSpecialOrderPdfFilename = (reference) => {
  const safeReference = String(reference || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'Transaction';

  return `Special-Order-Transaction-${safeReference}.pdf`;
};

export const createSpecialOrderTransactionPdf = ({ order = {}, transaction = {}, settings = {}, logo = null } = {}) => {
  if (!transaction?.id || !Array.isArray(transaction.items)) {
    throw new Error('Finalized Special Order transaction data is unavailable.');
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - (margin * 2);
  const storeName = String(settings.storeName || 'Tableria La Confianza Co., Inc.').trim();
  const specialOrderReference = order.orderNumber || transaction.specialOrderNumber || '';
  const customerName = transaction.customerName || order.customerName || '';
  const contactParts = [settings.contactPhone, settings.contactPhoneSecondary].filter(Boolean);
  const emailParts = [settings.storePrimaryEmail, settings.storeSecondaryEmail].filter(Boolean);
  const logoTop = 14;
  const maximumLogoSize = 18;
  const logoRatio = logo?.width && logo?.height ? logo.width / logo.height : 1;
  const logoWidth = logo ? (logoRatio >= 1 ? maximumLogoSize : maximumLogoSize * logoRatio) : 0;
  const logoHeight = logo ? (logoRatio >= 1 ? maximumLogoSize / logoRatio : maximumLogoSize) : 0;
  const companyContentX = logo ? margin + logoWidth + 6 : margin;
  const companyContentWidth = pageWidth - margin - companyContentX;

  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', margin, logoTop, logoWidth, logoHeight);
  }

  pdf.setTextColor(17, 24, 39);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text(storeName, companyContentX, 20, { maxWidth: companyContentWidth });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(75, 85, 99);
  let headerY = 26;
  [settings.storeAddress, contactParts.length ? `Contact: ${contactParts.join(' | ')}` : '', emailParts.join(' | ')]
    .filter(Boolean)
    .forEach((line) => {
      pdf.text(String(line), companyContentX, headerY, { maxWidth: companyContentWidth });
      headerY += 4.5;
    });

  const titleY = Math.max(headerY + 5, logoTop + logoHeight + 8, 42);
  pdf.setDrawColor(209, 213, 219);
  pdf.line(margin, titleY - 5, pageWidth - margin, titleY - 5);
  pdf.setTextColor(17, 24, 39);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('Special Order Transaction Summary', margin, titleY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);

  const details = [
    ['Special Order Reference', specialOrderReference],
    ['Transaction / Receipt No.', transaction.id],
    ['Customer', customerName],
    ['Order Date', formatDate(order.createdAt)],
    ['Completion Date', formatDate(transaction.date || order.completedAt, true)],
    ['Status', order.status || 'Completed'],
    ['Processed By', transaction.cashier],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim());

  autoTable(pdf, {
    startY: titleY + 6,
    body: details,
    theme: 'plain',
    margin: { left: margin, right: margin },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.7, textColor: [31, 41, 55] },
    columnStyles: {
      0: { cellWidth: 47, fontStyle: 'bold', textColor: [107, 114, 128] },
      1: { cellWidth: contentWidth - 47 },
    },
  });

  const itemRows = transaction.items.map((item) => [
    item.name || 'Item',
    String(Number(item.qty ?? item.quantity ?? 0)),
    formatMoney(item.price ?? item.unitPrice),
    formatMoney(item.subtotal),
  ]);

  autoTable(pdf, {
    startY: pdf.lastAutoTable.finalY + 7,
    head: [['Item', 'Quantity', 'Unit Price', 'Line Subtotal']],
    body: itemRows,
    theme: 'grid',
    margin: { left: margin, right: margin, bottom: 25 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, textColor: [31, 41, 55], lineColor: [229, 231, 235], lineWidth: 0.2 },
    headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 78 },
      1: { cellWidth: 24, halign: 'center' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 37, halign: 'right' },
    },
  });

  let summaryY = pdf.lastAutoTable.finalY + 9;
  if (summaryY > pageHeight - 65) {
    pdf.addPage();
    summaryY = margin;
  }

  const paymentRows = [
    ['Payment Method', formatLabel(transaction.paymentMethod)],
    ['Payment Status', transaction.paymentStatus],
    ...(hasSavedNumber(transaction.amountPaid) ? [['Amount Paid', formatMoney(transaction.amountPaid)]] : []),
    ...(hasSavedNumber(transaction.remainingBalance ?? transaction.balance)
      ? [['Remaining Balance', formatMoney(transaction.remainingBalance ?? transaction.balance)]]
      : []),
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim());

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(17, 24, 39);
  pdf.text('Payment Information', margin, summaryY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  paymentRows.forEach(([label, value], index) => {
    const rowY = summaryY + 6 + (index * 5);
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, margin, rowY);
    pdf.setTextColor(31, 41, 55);
    pdf.text(String(value), margin + 42, rowY);
  });

  const totalY = summaryY + Math.max(16, paymentRows.length * 5 + 7);
  pdf.setDrawColor(17, 24, 39);
  pdf.line(pageWidth - margin - 72, totalY - 5, pageWidth - margin, totalY - 5);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(17, 24, 39);
  pdf.text('TOTAL', pageWidth - margin - 72, totalY);
  pdf.text(formatMoney(transaction.total), pageWidth - margin, totalY, { align: 'right' });

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(229, 231, 235);
    pdf.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    pdf.text('Thank you for your business. Please keep this customer copy for your records.', margin, pageHeight - 12);
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 12, { align: 'right' });
  }

  return {
    pdf,
    filename: buildSpecialOrderPdfFilename(specialOrderReference || transaction.id),
  };
};

export const downloadSpecialOrderTransactionPdf = async (input) => {
  const logo = input?.logoSource ? await loadPdfLogo(input.logoSource) : input?.logo;
  const result = createSpecialOrderTransactionPdf({ ...input, logo });
  result.pdf.save(result.filename);
  return result.filename;
};
