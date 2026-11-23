export const formatPdfMoneyAmount = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return '-';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
};

export const formatPdfCellText = (value) => value === '—' ? '-' : value;
export const formatPdfHeaderText = (value) => String(value ?? '').replaceAll('₱', 'P');

const applyPdfColor = (doc, setter, color) => {
  if (Array.isArray(color)) doc[setter](...color);
  else doc[setter](color);
};

// jsPDF's built-in Helvetica font does not include U+20B1. Draw the peso mark
// from supported Helvetica glyphs and vector rules so it renders consistently
// without embedding a restricted system font or changing the table layout.
export const drawPdfPesoSymbol = (doc, x, baselineY, fontSize = doc.getFontSize(), color = [30, 41, 59], fontStyle = 'normal') => {
  doc.setFont('helvetica', fontStyle);
  doc.setFontSize(fontSize);
  applyPdfColor(doc, 'setTextColor', color);
  doc.text('P', x, baselineY);
  const symbolWidth = doc.getTextWidth('P');
  const glyphHeight = fontSize * (25.4 / 72);
  applyPdfColor(doc, 'setDrawColor', color);
  doc.setLineWidth(Math.max(0.12, glyphHeight * 0.055));
  [0.55, 0.39].forEach((position) => {
    const y = baselineY - (glyphHeight * position);
    doc.line(x - 0.05, y, x + symbolWidth + 0.05, y);
  });
  return symbolWidth;
};

export const drawPdfPesoHeaderSymbol = (doc, cellData) => {
  const heading = cellData.cell.text.join('');
  const symbolIndex = heading.lastIndexOf('P');
  if (symbolIndex < 0) return;

  const textPosition = cellData.cell.getTextPos();
  const headingWidth = doc.getTextWidth(heading);
  const headingStartX = cellData.cell.styles.halign === 'right' ? textPosition.x - headingWidth : textPosition.x;
  const symbolX = headingStartX + doc.getTextWidth(heading.slice(0, symbolIndex));
  drawPdfPesoSymbol(doc, symbolX, textPosition.y, cellData.cell.styles.fontSize, cellData.cell.styles.textColor, cellData.cell.styles.fontStyle);
};

export const drawPdfPesoAmount = (doc, label, value, x, baselineY, fontSize = doc.getFontSize(), color = [15, 23, 42]) => {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  applyPdfColor(doc, 'setTextColor', color);
  doc.setCharSpace(0);
  doc.text(label, x, baselineY);
  const labelWidth = doc.getTextWidth(label);
  const symbolX = x + labelWidth + 0.8;
  const symbolWidth = drawPdfPesoSymbol(doc, symbolX, baselineY, fontSize, color);
  const amountX = symbolX + symbolWidth + 1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  applyPdfColor(doc, 'setTextColor', color);
  doc.text(formatPdfMoneyAmount(value), amountX, baselineY);
};
