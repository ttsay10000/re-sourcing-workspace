/**
 * Convert dossier plain text into a presentation-focused PDF.
 * The renderer adds a cover block, cleaner section styling, and table rules that keep
 * wide financial tables legible.
 */

import PDFDocument from "pdfkit";

const MARGIN = 50;
const HERO_HEIGHT = 104;
const TITLE_FONT_SIZE = 11;
const HERO_ADDRESS_FONT_SIZE = 18;
const HEADING_FONT_SIZE = 12;
const BODY_FONT_SIZE = 9.5;
const BODY_LINE_GAP = 2;
const HEADING_SPACING = 12;
const PARAGRAPH_SPACING = 8;
const SECTION_HEADING_COLOR = "#1e3a5f";
const BODY_TEXT_COLOR = "#233041";
const MUTED_TEXT_COLOR = "#64748b";
const NEGATIVE_TEXT_COLOR = "#9f1239";
const RULE_COLOR = "#cbd5e1";
const TABLE_HEADER_BG = "#e9f0f7";
const TABLE_ALT_BG = "#f8fafc";
const LABEL_BG = "#f3f6fa";
const SENSITIVITY_BASE_BG = "#e3edf8";
const HERO_BG = "#1e3a5f";
const HERO_ACCENT = "#8fb9d8";
const CHIP_BG = "#f8fafc";
const CHIP_TEXT = "#1e3a5f";
const COVER_BG = "#e2e8f0";
const COVER_TINT = "#f8fafc";
const COVER_PANEL_BG = "#ffffff";
const COVER_PANEL_BORDER = "#dbe5ee";
const COVER_ADDRESS_BG = "#ffffff";
const COVER_ADDRESS_TEXT = "#0f172a";
const COVER_SECTION_COLOR = "#111827";
const COVER_LABEL_COLOR = "#334155";
const COVER_VALUE_COLOR = "#0f172a";
const COVER_ADDRESS_FONT_SIZE = 28;
const COVER_SECTION_FONT_SIZE = 13.5;
const COVER_LABEL_FONT_SIZE = 9.8;
const COVER_VALUE_FONT_SIZE = 12.2;
const COVER_VALUE_STRONG_FONT_SIZE = 13.5;
const COVER_IMAGE_TIMEOUT_MS = 8_000;
const COVER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

type TableCell = { text: string; bold: boolean };
type LayoutState = { y: number; pageNumber: number };
type TableLayout = {
  widths: number[];
  fontSize: number;
  cellPadding: number;
  keyValue: boolean;
};

export interface DossierPdfCoverField {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface DossierPdfCoverSection {
  title: string;
  rows: DossierPdfCoverField[];
}

export interface DossierPdfCoverData {
  address: string;
  backgroundImageUrl?: string | null;
  propertyInfo: DossierPdfCoverSection;
  acquisitionInfo: DossierPdfCoverSection;
  keyFinancials: DossierPdfCoverSection;
  expectedReturns: DossierPdfCoverSection;
}

export interface DossierTextToPdfOptions {
  cover?: DossierPdfCoverData | null;
}

function isSectionBreakRow(row: TableCell[]): boolean {
  return row.length > 0 && row[0]?.bold === true && row.slice(1).every((cell) => cell.text.trim() === "");
}

function pageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width;
}

function pageHeight(doc: PDFKit.PDFDocument): number {
  return doc.page.height;
}

function bodyWidth(doc: PDFKit.PDFDocument): number {
  return pageWidth(doc) - 2 * MARGIN;
}

function maxY(doc: PDFKit.PDFDocument): number {
  return pageHeight(doc) - MARGIN;
}

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,3}\s+.+/.test(t)) return true;
  if (/^\d+[.)]\s+.+/.test(t)) return true;
  if (t.length < 60 && /^[A-Z][A-Z0-9\s&'/-]+$/.test(t) && t.split(/\s+/).length <= 8) {
    return true;
  }
  return false;
}

function isDivider(line: string): boolean {
  return /^[-=]{3,}$/.test(line.trim());
}

function normalizeHeading(line: string): string {
  return line.replace(/^#+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.startsWith("|") && t.endsWith("|");
}

function parseTableRow(line: string): TableCell[] {
  const inner = line.trim().slice(1, -1);
  return inner.split("|").map((cell) => {
    const trimmed = cell.trim();
    const bold = trimmed.startsWith("**") && trimmed.endsWith("**");
    return {
      text: bold ? trimmed.slice(2, -2).trim() : trimmed,
      bold,
    };
  });
}

function isBullet(line: string): boolean {
  return /^([•*-])\s+/.test(line.trimStart());
}

function cleanBullet(line: string): string {
  return line.trimStart().replace(/^([•*-])\s+/, "");
}

function addPage(doc: PDFKit.PDFDocument, state: LayoutState): void {
  doc.addPage({ margin: MARGIN, size: "letter" });
  state.pageNumber += 1;
  drawPageChrome(doc, state.pageNumber);
  state.y = MARGIN + 8;
}

function ensureSpace(doc: PDFKit.PDFDocument, state: LayoutState, needed: number): void {
  if (state.y + needed > maxY(doc)) addPage(doc, state);
}

function drawPageChrome(doc: PDFKit.PDFDocument, pageNumber: number): void {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  const footerRuleY = height - 68;
  const footerTextY = height - 62;
  doc.save();
  doc.strokeColor(HERO_ACCENT).lineWidth(2);
  doc.moveTo(MARGIN, MARGIN - 18).lineTo(width - MARGIN, MARGIN - 18).stroke();
  doc.strokeColor(RULE_COLOR).lineWidth(0.75);
  doc.moveTo(MARGIN, footerRuleY).lineTo(width - MARGIN, footerRuleY).stroke();
  doc.fillColor(MUTED_TEXT_COLOR).font("Helvetica").fontSize(8);
  doc.text(`Page ${pageNumber}`, width - MARGIN - 48, footerTextY, {
    width: 48,
    align: "right",
    lineBreak: false,
  });
  doc.restore();
}

function imageContentTypeSupported(contentType: string | null, url: string): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg") || normalized.includes("image/png")) {
    return true;
  }
  return /\.(jpe?g|png)(\?|#|$)/i.test(url);
}

async function loadCoverImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url || typeof url !== "string" || url.trim().length === 0) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COVER_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) return null;
    if (!imageContentTypeSupported(response.headers.get("content-type"), response.url || url)) {
      return null;
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > COVER_IMAGE_MAX_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > COVER_IMAGE_MAX_BYTES) return null;
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function drawCoverFallback(doc: PDFKit.PDFDocument): void {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  doc.save();
  doc.rect(0, 0, width, height).fill(COVER_BG);
  doc.opacity(0.35).fillColor("#cbd5e1").circle(width * 0.18, height * 0.14, 110).fill();
  doc.opacity(0.30).fillColor("#bfdbfe").circle(width * 0.76, height * 0.18, 150).fill();
  doc.opacity(0.24).fillColor("#bbf7d0").circle(width * 0.86, height * 0.64, 170).fill();
  doc.opacity(0.20).fillColor("#fef3c7").circle(width * 0.16, height * 0.82, 140).fill();
  doc.restore();
}

function drawCoverBackground(doc: PDFKit.PDFDocument, coverImage: Buffer | null): void {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  if (coverImage) {
    try {
      doc.image(coverImage, 0, 0, { width, height });
    } catch {
      drawCoverFallback(doc);
    }
  } else {
    drawCoverFallback(doc);
  }
  doc.save();
  doc.opacity(0.20).fillColor(COVER_TINT).rect(0, 0, width, height).fill();
  doc.restore();
}

function drawGlassPanel(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  doc.save();
  doc.opacity(0.76).roundedRect(x, y, width, height, 28).fill(COVER_PANEL_BG);
  doc.opacity(0.18).lineWidth(1).roundedRect(x, y, width, height, 28).stroke(COVER_PANEL_BORDER);
  doc.restore();
}

function drawCoverDivider(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number
): void {
  doc.save();
  doc.strokeColor(COVER_PANEL_BORDER).lineWidth(0.85);
  doc.moveTo(x, y).lineTo(x + width, y).stroke();
  doc.restore();
}

function drawCoverSection(
  doc: PDFKit.PDFDocument,
  section: DossierPdfCoverSection,
  x: number,
  y: number,
  width: number,
  options?: { labelRatio?: number }
): number {
  const labelRatio = options?.labelRatio ?? 0.5;
  const labelWidth = width * labelRatio;
  const valueWidth = width - labelWidth - 10;
  let currentY = y;

  doc.save();
  doc.fillColor(COVER_SECTION_COLOR).font("Helvetica-Bold").fontSize(COVER_SECTION_FONT_SIZE);
  doc.text(section.title, x, currentY, { width });
  doc.restore();
  currentY += 30;

  section.rows.forEach((row) => {
    doc.font("Helvetica").fontSize(COVER_LABEL_FONT_SIZE);
    const labelHeight = doc.heightOfString(row.label, {
      width: labelWidth,
      lineGap: 2,
    });
    doc.font(row.emphasis ? "Helvetica-Bold" : "Helvetica")
      .fontSize(row.emphasis ? COVER_VALUE_STRONG_FONT_SIZE : COVER_VALUE_FONT_SIZE);
    const valueHeight = doc.heightOfString(row.value, {
      width: valueWidth,
      align: "right",
      lineGap: 2,
    });
    const rowHeight = Math.max(labelHeight, valueHeight, 14);

    doc.save();
    doc.fillColor(COVER_LABEL_COLOR).font("Helvetica").fontSize(COVER_LABEL_FONT_SIZE);
    doc.text(row.label, x, currentY, {
      width: labelWidth,
      lineGap: 2,
    });
    doc.fillColor(COVER_VALUE_COLOR)
      .font(row.emphasis ? "Helvetica-Bold" : "Helvetica")
      .fontSize(row.emphasis ? COVER_VALUE_STRONG_FONT_SIZE : COVER_VALUE_FONT_SIZE);
    doc.text(row.value, x + labelWidth + 10, currentY, {
      width: valueWidth,
      align: "right",
      lineGap: 2,
    });
    doc.restore();

    currentY += rowHeight + 13;
  });

  return currentY;
}

function drawCoverAddressBanner(doc: PDFKit.PDFDocument, address: string): number {
  const pageW = pageWidth(doc);
  const x = 34;
  const y = 36;
  const width = Math.min(430, pageW - 150);

  doc.font("Helvetica").fontSize(COVER_ADDRESS_FONT_SIZE);
  const textHeight = doc.heightOfString(address, {
    width: width - 36,
    lineGap: 4,
  });
  const height = Math.max(84, textHeight + 32);

  doc.save();
  doc.opacity(0.72).roundedRect(x, y, width, height, 24).fill(COVER_ADDRESS_BG);
  doc.opacity(0.16).lineWidth(1).roundedRect(x, y, width, height, 24).stroke(COVER_PANEL_BORDER);
  doc.fillColor(COVER_ADDRESS_TEXT).font("Helvetica").fontSize(COVER_ADDRESS_FONT_SIZE);
  doc.text(address, x + 18, y + 16, {
    width: width - 36,
    lineGap: 4,
  });
  doc.restore();

  return y + height;
}

function drawStructuredCoverPage(
  doc: PDFKit.PDFDocument,
  cover: DossierPdfCoverData,
  coverImage: Buffer | null
): void {
  const pageW = pageWidth(doc);
  const pageH = pageHeight(doc);
  drawCoverBackground(doc, coverImage);

  const bannerBottom = drawCoverAddressBanner(doc, cover.address);
  const outerPad = 34;
  const gap = 16;
  const leftWidth = 220;
  const rightWidth = pageW - outerPad * 2 - gap - leftWidth;
  const panelTop = bannerBottom + 18;
  const panelHeight = pageH - panelTop - 38;
  const leftX = outerPad;
  const rightX = leftX + leftWidth + gap;
  const innerPad = 18;

  drawGlassPanel(doc, leftX, panelTop, leftWidth, panelHeight);
  drawGlassPanel(doc, rightX, panelTop, rightWidth, panelHeight);

  let leftY = panelTop + innerPad;
  leftY = drawCoverSection(doc, cover.propertyInfo, leftX + innerPad, leftY, leftWidth - innerPad * 2, {
    labelRatio: 0.5,
  });
  drawCoverDivider(doc, leftX + innerPad, leftY + 4, leftWidth - innerPad * 2);
  leftY = drawCoverSection(
    doc,
    cover.acquisitionInfo,
    leftX + innerPad,
    leftY + 18,
    leftWidth - innerPad * 2,
    { labelRatio: 0.52 }
  );

  let rightY = panelTop + innerPad;
  rightY = drawCoverSection(doc, cover.keyFinancials, rightX + innerPad, rightY, rightWidth - innerPad * 2, {
    labelRatio: 0.55,
  });
  drawCoverDivider(doc, rightX + innerPad, rightY + 2, rightWidth - innerPad * 2);
  drawCoverSection(
    doc,
    cover.expectedReturns,
    rightX + innerPad,
    rightY + 18,
    rightWidth - innerPad * 2,
    { labelRatio: 0.55 }
  );
}

function extractMeta(lines: string[]): {
  title: string;
  address: string | null;
  score: string | null;
  generated: string | null;
} {
  const title = lines.find((line) => line.trim().length > 0) ?? "DEAL DOSSIER";
  const addressLine = lines.find((line) => line.startsWith("Address:"));
  const scoreLine = lines.find((line) => line.startsWith("Deal score:"));
  const generatedLine = lines.find((line) => line.startsWith("Generated:"));
  return {
    title: title.trim(),
    address: addressLine ? addressLine.replace(/^Address:\s*/, "").trim() : null,
    score: scoreLine ? scoreLine.replace(/^Deal score:\s*/, "").trim() : null,
    generated: generatedLine ? generatedLine.replace(/^Generated:\s*/, "").trim() : null,
  };
}

function drawChip(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string
): void {
  doc.save();
  doc.roundedRect(x, y, width, 28, 8).fill(CHIP_BG);
  doc.fillColor(CHIP_TEXT).font("Helvetica-Bold").fontSize(7.5);
  doc.text(label.toUpperCase(), x + 10, y + 6, { width: width - 20 });
  doc.font("Helvetica").fontSize(9.5);
  doc.text(value, x + 10, y + 14, { width: width - 20 });
  doc.restore();
}

function drawHero(
  doc: PDFKit.PDFDocument,
  state: LayoutState,
  meta: ReturnType<typeof extractMeta>
): void {
  const x = MARGIN;
  const y = MARGIN + 2;
  const width = bodyWidth(doc);
  doc.save();
  doc.roundedRect(x, y, width, HERO_HEIGHT, 14).fill(HERO_BG);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(TITLE_FONT_SIZE);
  doc.text(meta.title, x + 18, y + 16, { width: width - 180 });
  doc.fontSize(HERO_ADDRESS_FONT_SIZE);
  doc.text(meta.address ?? "Investment Memorandum", x + 18, y + 34, {
    width: width - 180,
  });
  doc.strokeColor(HERO_ACCENT).lineWidth(2);
  doc.moveTo(x + 18, y + HERO_HEIGHT - 18).lineTo(x + 96, y + HERO_HEIGHT - 18).stroke();
  if (meta.score) drawChip(doc, x + width - 132, y + 18, 114, "Deal Score", meta.score);
  if (meta.generated) {
    drawChip(doc, x + width - 132, y + 54, 114, "Generated", meta.generated);
  }
  doc.restore();
  state.y = y + HERO_HEIGHT + 18;
}

function drawSectionHeading(doc: PDFKit.PDFDocument, state: LayoutState, heading: string): void {
  ensureSpace(doc, state, 28);
  const clean = normalizeHeading(heading);
  doc.save();
  doc.fillColor(SECTION_HEADING_COLOR).font("Helvetica-Bold").fontSize(HEADING_FONT_SIZE);
  doc.text(clean, MARGIN, state.y, { width: bodyWidth(doc) });
  state.y += HEADING_FONT_SIZE + 4;
  doc.strokeColor(HERO_ACCENT).lineWidth(1.2);
  doc.moveTo(MARGIN, state.y).lineTo(MARGIN + 84, state.y).stroke();
  doc.restore();
  state.y += HEADING_SPACING;
}

function drawParagraph(doc: PDFKit.PDFDocument, state: LayoutState, line: string): void {
  const bullet = isBullet(line);
  const text = bullet ? cleanBullet(line) : line.trim();
  const bulletOffset = bullet ? 16 : 0;
  doc.font("Helvetica").fontSize(BODY_FONT_SIZE);
  const height = doc.heightOfString(text, {
    width: bodyWidth(doc) - bulletOffset,
    lineGap: BODY_LINE_GAP,
  });
  ensureSpace(doc, state, height + PARAGRAPH_SPACING);
  if (bullet) {
    doc.save();
    doc.fillColor(HERO_ACCENT).circle(MARGIN + 5, state.y + 6, 2.25).fill();
    doc.restore();
  }
  doc.fillColor(BODY_TEXT_COLOR).text(text, MARGIN + bulletOffset, state.y, {
    width: bodyWidth(doc) - bulletOffset,
    lineGap: BODY_LINE_GAP,
  });
  state.y += height + PARAGRAPH_SPACING;
}

function tableCellAlign(colIndex: number): "left" | "center" {
  return colIndex === 0 ? "left" : "center";
}

function tableColumnWidths(tableWidth: number, colCount: number, keyValue: boolean): number[] {
  if (keyValue) return [tableWidth * 0.56, tableWidth * 0.44];
  if (colCount >= 7) {
    const first = tableWidth * 0.29;
    const remaining = (tableWidth - first) / (colCount - 1);
    return [first, ...Array.from({ length: colCount - 1 }, () => remaining)];
  }
  if (colCount === 6) {
    const first = tableWidth * 0.28;
    const remaining = (tableWidth - first) / (colCount - 1);
    return [first, ...Array.from({ length: colCount - 1 }, () => remaining)];
  }
  if (colCount === 5) {
    const first = tableWidth * 0.28;
    const remaining = (tableWidth - first) / 4;
    return [first, remaining, remaining, remaining, remaining];
  }
  if (colCount === 4) {
    const first = tableWidth * 0.30;
    const remaining = (tableWidth - first) / 3;
    return [first, remaining, remaining, remaining];
  }
  if (colCount === 3) {
    const first = tableWidth * 0.42;
    const remaining = (tableWidth - first) / 2;
    return [first, remaining, remaining];
  }
  return Array.from({ length: colCount }, () => tableWidth / colCount);
}

function tableLayout(doc: PDFKit.PDFDocument, rows: TableCell[][]): TableLayout {
  const colCount = Math.max(...rows.map((row) => row.length));
  const keyValue = colCount === 2 && rows.length <= 8;
  const compact = colCount >= 6;
  const veryCompact = colCount >= 7;
  const fontSize = veryCompact ? 6.35 : compact ? 6.9 : keyValue ? 9.25 : 8.3;
  const cellPadding = veryCompact ? 2.8 : compact ? 3.2 : keyValue ? 5.8 : 4.8;
  return {
    widths: tableColumnWidths(bodyWidth(doc), colCount, keyValue),
    fontSize,
    cellPadding,
    keyValue,
  };
}

function measureTableRowHeight(
  doc: PDFKit.PDFDocument,
  row: TableCell[],
  rowIndex: number,
  layout: TableLayout
): number {
  const isHeader = !layout.keyValue && rowIndex === 0;
  let rowHeight = layout.fontSize + layout.cellPadding * 2;
  row.forEach((cell, colIndex) => {
    doc.font(cell.bold || isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(layout.fontSize);
    const height = doc.heightOfString(cell.text, {
      width: (layout.widths[colIndex] ?? layout.widths[0] ?? 0) - layout.cellPadding * 2,
      align: tableCellAlign(colIndex),
      lineGap: 1,
    });
    rowHeight = Math.max(rowHeight, height + layout.cellPadding * 2);
  });
  return rowHeight;
}

function measureTableHeight(
  doc: PDFKit.PDFDocument,
  rows: TableCell[][],
  layout: TableLayout
): number {
  let total = 0;
  rows.forEach((row, rowIndex) => {
    total += measureTableRowHeight(doc, row, rowIndex, layout);
  });
  return total;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  row: TableCell[],
  rowIndex: number,
  y: number,
  rowHeight: number,
  layout: TableLayout,
  options?: { forceHeader?: boolean; highlightRow?: boolean }
): number {
  const isHeader = options?.forceHeader === true || (!layout.keyValue && rowIndex === 0);
  const isSectionRow = !isHeader && isSectionBreakRow(row);
  let currentX = MARGIN;

  row.forEach((cell, colIndex) => {
    const width = layout.widths[colIndex] ?? layout.widths[0] ?? 0;
    const fillColor = isHeader || isSectionRow
      ? TABLE_HEADER_BG
      : options?.highlightRow === true
        ? SENSITIVITY_BASE_BG
        : layout.keyValue && colIndex === 0
          ? LABEL_BG
          : rowIndex % 2 === 0
            ? "#ffffff"
            : TABLE_ALT_BG;
    doc.save();
    doc.roundedRect(currentX, y, width, rowHeight, 0).fill(fillColor);
    doc.restore();
    doc.strokeColor(RULE_COLOR).lineWidth(0.6).rect(currentX, y, width, rowHeight).stroke();
    const color = isHeader || isSectionRow
      ? SECTION_HEADING_COLOR
      : /^\(/.test(cell.text.trim()) || /^-/.test(cell.text.trim())
        ? NEGATIVE_TEXT_COLOR
        : BODY_TEXT_COLOR;
    doc.fillColor(color).font(cell.bold || isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(layout.fontSize);
    const textHeight = doc.heightOfString(cell.text, {
      width: width - layout.cellPadding * 2,
      align: tableCellAlign(colIndex),
      lineGap: 1,
    });
    const textY = y + Math.max(layout.cellPadding - 0.5, (rowHeight - textHeight) / 2);
    doc.text(cell.text, currentX + layout.cellPadding, textY, {
      width: width - layout.cellPadding * 2,
      align: tableCellAlign(colIndex),
      lineGap: 1,
    });
    currentX += width;
  });

  return y + rowHeight;
}

function collectImmediateTableRows(lines: string[], startIndex: number): TableCell[][] {
  const rows: TableCell[][] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const candidate = lines[index]?.trimEnd() ?? "";
    if (!candidate.trim() || isDivider(candidate)) continue;
    if (!isTableRow(candidate)) return [];

    rows.push(parseTableRow(candidate));
    for (let tableIndex = index + 1; tableIndex < lines.length; tableIndex += 1) {
      const tableLine = lines[tableIndex]?.trimEnd() ?? "";
      if (!tableLine.trim()) return rows;
      if (!isTableRow(tableLine)) return rows;
      rows.push(parseTableRow(tableLine));
    }
    return rows;
  }

  return rows;
}

function ensureSectionFitsWithTable(
  doc: PDFKit.PDFDocument,
  state: LayoutState,
  lines: string[],
  nextIndex: number
): void {
  const tableRows = collectImmediateTableRows(lines, nextIndex);
  if (tableRows.length === 0) return;

  const layout = tableLayout(doc, tableRows);
  const previewRows = layout.keyValue ? tableRows : tableRows.slice(0, Math.min(tableRows.length, 3));
  const needed = 28 + measureTableHeight(doc, previewRows, layout) + 8;
  if (state.y + needed > maxY(doc)) addPage(doc, state);
}

function drawTable(
  doc: PDFKit.PDFDocument,
  state: LayoutState,
  rows: TableCell[][],
  options?: { highlightBoldRows?: boolean }
): void {
  if (rows.length === 0) return;
  const layout = tableLayout(doc, rows);
  const rowHeights = rows.map((row, rowIndex) => measureTableRowHeight(doc, row, rowIndex, layout));
  const headerHeight = !layout.keyValue && rows.length > 0 ? rowHeights[0] ?? 0 : 0;
  let currentY = state.y;
  let needsRepeatedHeader = false;

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex] ?? measureTableRowHeight(doc, row, rowIndex, layout);
    const repeatedHeaderHeight = needsRepeatedHeader ? headerHeight : 0;
    const highlightRow = options?.highlightBoldRows === true && rowIndex > 0 && row.every((cell) => cell.bold);
    if (currentY + repeatedHeaderHeight + rowHeight > maxY(doc)) {
      addPage(doc, state);
      currentY = state.y;
      needsRepeatedHeader = !layout.keyValue && rowIndex > 0;
    }

    if (needsRepeatedHeader && !layout.keyValue) {
      currentY = drawTableRow(doc, rows[0] ?? [], 0, currentY, headerHeight, layout, { forceHeader: true });
      needsRepeatedHeader = false;
    }

    currentY = drawTableRow(doc, row, rowIndex, currentY, rowHeight, layout, { highlightRow });
  });

  state.y = currentY + 10;
}

export function dossierTextToPdf(
  dossierText: string,
  options?: DossierTextToPdfOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: MARGIN, size: "letter" });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    void (async () => {
      try {
        const lines = dossierText.split(/\r?\n/);
        const meta = extractMeta(lines);
        const state: LayoutState = { y: MARGIN + 8, pageNumber: 1 };
        let tableBuffer: TableCell[][] = [];
        let currentHeading: string | null = null;

        if (options?.cover) {
          const coverImage = await loadCoverImageBuffer(options.cover.backgroundImageUrl);
          drawStructuredCoverPage(doc, options.cover, coverImage);
          addPage(doc, state);
        } else {
          drawPageChrome(doc, state.pageNumber);
          drawHero(doc, state, meta);
        }

        const skipLine = (line: string, index: number): boolean => {
          if (index === 0 && line.trim() === meta.title) return true;
          if (isDivider(line)) return true;
          if (line.startsWith("Deal score:") || line.startsWith("Generated:")) return true;
          if (options?.cover && line.startsWith("Address:")) return true;
          return false;
        };

        const flushTable = (): void => {
          if (tableBuffer.length === 0) return;
          drawTable(doc, state, tableBuffer, {
            highlightBoldRows: currentHeading === "SENSITIVITY ANALYSIS",
          });
          tableBuffer = [];
        };

        lines.forEach((raw, index) => {
          const line = raw.trimEnd();
          if (skipLine(line, index)) return;
          if (!line.trim()) {
            flushTable();
            state.y += 4;
            return;
          }
          if (isHeading(line)) {
            flushTable();
            ensureSectionFitsWithTable(doc, state, lines, index + 1);
            currentHeading = normalizeHeading(line);
            drawSectionHeading(doc, state, line);
            return;
          }
          if (isTableRow(line)) {
            tableBuffer.push(parseTableRow(line));
            return;
          }
          flushTable();
          drawParagraph(doc, state, line);
        });

        flushTable();
        doc.end();
      } catch (error) {
        reject(error);
      }
    })();
  });
}
