/**
 * Convert dossier plain text into a presentation-focused PDF.
 * The renderer adds a cover block, cleaner section styling, and table rules that keep
 * wide financial tables legible.
 */

import PDFDocument from "pdfkit";

const PORTRAIT_WIDTH = 612;
const PORTRAIT_HEIGHT = 792;
const LANDSCAPE_WIDTH = 792;
const LANDSCAPE_HEIGHT = 612;
const MARGIN = 52;
const CONTENT_TOP_OFFSET = 12;
const FOOTER_RESERVE = 56;
const HERO_HEIGHT = 112;
const TITLE_FONT_SIZE = 10.5;
const HERO_ADDRESS_FONT_SIZE = 22;
const HEADING_KICKER_FONT_SIZE = 8;
const HEADING_FONT_SIZE = 17;
const BODY_FONT_SIZE = 10.2;
const BODY_LINE_GAP = 3;
const HEADING_SPACING = 16;
const PARAGRAPH_SPACING = 10;
const SECTION_HEADING_COLOR = "#0f172a";
const BODY_TEXT_COLOR = "#1f2937";
const MUTED_TEXT_COLOR = "#64748b";
const NEGATIVE_TEXT_COLOR = "#b42318";
const RULE_COLOR = "#cbd5e1";
const TABLE_HEADER_BG = "#e4eef9";
const TABLE_ALT_BG = "#f8fafc";
const TABLE_SECTION_BG = "#d7e5f4";
const TABLE_EMPHASIS_BG = "#edf5fd";
const LABEL_BG = "#eef3f8";
const VALUE_SURFACE_BG = "#ffffff";
const SENSITIVITY_BASE_BG = "#dbeafe";
const HERO_BG = "#0f172a";
const HERO_ACCENT = "#38bdf8";
const CHIP_BG = "#e0f2fe";
const CHIP_TEXT = "#0f172a";
const COVER_BG = "#dbe7f3";
const COVER_TINT = "#0f172a";
const COVER_PANEL_BG = "#ffffff";
const COVER_PANEL_BORDER = "#d7e3ef";
const COVER_ADDRESS_BG = "#0f172a";
const COVER_ADDRESS_TEXT = "#f8fafc";
const COVER_KICKER_TEXT = "#bfdbfe";
const COVER_SECTION_COLOR = "#111827";
const COVER_LABEL_COLOR = "#475569";
const COVER_VALUE_COLOR = "#0f172a";
const COVER_ADDRESS_FONT_SIZE = 28;
const COVER_KICKER_FONT_SIZE = 9;
const COVER_SECTION_FONT_SIZE = 14.5;
const COVER_LABEL_FONT_SIZE = 9.6;
const COVER_VALUE_FONT_SIZE = 12.4;
const COVER_VALUE_STRONG_FONT_SIZE = 14.2;
const COVER_IMAGE_TIMEOUT_MS = 8_000;
const COVER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

type TableCell = { text: string; bold: boolean };
type PageLayout = "portrait" | "landscape";
type ColumnKind = "label" | "number" | "text";
type DossierPdfMeta = ReturnType<typeof extractMeta>;
type LayoutState = {
  y: number;
  pageNumber: number;
  pageLayout: PageLayout;
  meta: DossierPdfMeta;
  currentSection: string | null;
};
type TableLayout = {
  tableWidth: number;
  widths: number[];
  fontSize: number;
  cellPadding: number;
  keyValue: boolean;
  landscape: boolean;
  columnKinds: ColumnKind[];
  hasHeader: boolean;
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

function pageDimensions(layout: PageLayout): { width: number; height: number } {
  return layout === "landscape"
    ? { width: LANDSCAPE_WIDTH, height: LANDSCAPE_HEIGHT }
    : { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT };
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

function bodyWidthForLayout(layout: PageLayout): number {
  return pageDimensions(layout).width - 2 * MARGIN;
}

function contentTop(): number {
  return MARGIN + CONTENT_TOP_OFFSET;
}

function maxY(doc: PDFKit.PDFDocument): number {
  return pageHeight(doc) - FOOTER_RESERVE;
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

function extractHeadingOrdinal(line: string): string | null {
  const match = line.match(/^(\d+)[.)]\s+/);
  return match?.[1] ?? null;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b([a-z])/g, (_, char: string) => char.toUpperCase());
}

function addPage(
  doc: PDFKit.PDFDocument,
  state: LayoutState,
  layout: PageLayout = state.pageLayout
): void {
  doc.addPage({ margin: MARGIN, size: "letter", layout });
  state.pageNumber += 1;
  state.pageLayout = layout;
  drawPageChrome(doc, state.meta, state.pageNumber, state.currentSection);
  state.y = contentTop();
}

function ensureSpace(doc: PDFKit.PDFDocument, state: LayoutState, needed: number): void {
  if (state.y + needed > maxY(doc)) addPage(doc, state);
}

function ensurePageLayout(
  doc: PDFKit.PDFDocument,
  state: LayoutState,
  layout: PageLayout
): void {
  if (state.pageLayout === layout) return;
  addPage(doc, state, layout);
}

function drawPageChrome(
  doc: PDFKit.PDFDocument,
  meta: DossierPdfMeta,
  pageNumber: number,
  currentSection: string | null
): void {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  const headerY = 22;
  const topRuleY = 34;
  const footerRuleY = height - 44;
  const footerTextY = height - 34;
  doc.save();
  doc.fillColor(MUTED_TEXT_COLOR).font("Helvetica-Bold").fontSize(8);
  doc.text(meta.title, MARGIN, headerY, {
    width: 140,
    lineBreak: false,
  });
  if (currentSection) {
    doc.font("Helvetica").fontSize(8);
    doc.text(titleCase(currentSection), MARGIN + 150, headerY, {
      width: width - MARGIN * 2 - 220,
      align: "center",
      lineBreak: false,
    });
  }
  if (meta.address) {
    doc.font("Helvetica").fontSize(8);
    doc.text(meta.address, width - MARGIN - 210, headerY, {
      width: 210,
      align: "right",
      lineBreak: false,
    });
  }
  doc.strokeColor(HERO_ACCENT).lineWidth(1.8);
  doc.moveTo(MARGIN, topRuleY).lineTo(width - MARGIN, topRuleY).stroke();
  doc.strokeColor(RULE_COLOR).lineWidth(0.75);
  doc.moveTo(MARGIN, footerRuleY).lineTo(width - MARGIN, footerRuleY).stroke();
  doc.fillColor(MUTED_TEXT_COLOR).font("Helvetica").fontSize(8);
  if (meta.generated) {
    doc.text(`Generated ${meta.generated}`, MARGIN, footerTextY, {
      width: 140,
      lineBreak: false,
    });
  }
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
  doc.opacity(0.35).fillColor("#c7d9ec").circle(width * 0.14, height * 0.12, 120).fill();
  doc.opacity(0.32).fillColor("#dbeafe").circle(width * 0.80, height * 0.16, 166).fill();
  doc.opacity(0.28).fillColor("#bae6fd").circle(width * 0.76, height * 0.82, 154).fill();
  doc.opacity(0.20).fillColor("#f8fafc").circle(width * 0.20, height * 0.84, 150).fill();
  doc.opacity(0.16).fillColor("#0f172a").rect(0, height * 0.60, width, height * 0.40).fill();
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
  doc.opacity(coverImage ? 0.34 : 0.14).fillColor(COVER_TINT).rect(0, 0, width, height).fill();
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
  doc.opacity(0.88).roundedRect(x, y, width, height, 26).fill(COVER_PANEL_BG);
  doc.opacity(0.42).lineWidth(1).roundedRect(x, y, width, height, 26).stroke(COVER_PANEL_BORDER);
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
  doc.fillColor("#7c93b2").rect(x, currentY + 24, Math.min(60, width), 2.2).fill();
  doc.restore();
  currentY += 36;

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
      lineGap: 2.5,
    });
    doc.fillColor(COVER_VALUE_COLOR)
      .font(row.emphasis ? "Helvetica-Bold" : "Helvetica")
      .fontSize(row.emphasis ? COVER_VALUE_STRONG_FONT_SIZE : COVER_VALUE_FONT_SIZE);
    doc.text(row.value, x + labelWidth + 10, currentY, {
      width: valueWidth,
      align: "right",
      lineGap: 2.5,
    });
    doc.restore();

    currentY += rowHeight + 14;
  });

  return currentY;
}

function drawCoverAddressBanner(doc: PDFKit.PDFDocument, address: string): number {
  const pageW = pageWidth(doc);
  const x = 34;
  const y = 34;
  const width = Math.min(450, pageW - 132);

  doc.font("Helvetica").fontSize(COVER_ADDRESS_FONT_SIZE);
  const textHeight = doc.heightOfString(address, {
    width: width - 36,
    lineGap: 4,
  });
  const height = Math.max(96, textHeight + 46);

  doc.save();
  doc.opacity(0.82).roundedRect(x, y, width, height, 24).fill(COVER_ADDRESS_BG);
  doc.opacity(0.24).lineWidth(1).roundedRect(x, y, width, height, 24).stroke("#dbeafe");
  doc.opacity(1);
  doc.fillColor(COVER_KICKER_TEXT).font("Helvetica-Bold").fontSize(COVER_KICKER_FONT_SIZE);
  doc.text("DEAL DOSSIER", x + 18, y + 16, {
    width: width - 36,
    lineBreak: false,
  });
  doc.fillColor(COVER_ADDRESS_TEXT).font("Helvetica-Bold").fontSize(COVER_ADDRESS_FONT_SIZE);
  doc.text(address, x + 18, y + 32, {
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
  const leftWidth = 224;
  const rightWidth = pageW - outerPad * 2 - gap - leftWidth;
  const panelTop = bannerBottom + 18;
  const panelHeight = pageH - panelTop - 34;
  const leftX = outerPad;
  const rightX = leftX + leftWidth + gap;
  const innerPad = 20;

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
  meta: DossierPdfMeta
): void {
  const x = MARGIN;
  const y = contentTop() - 4;
  const width = bodyWidth(doc);
  doc.save();
  doc.roundedRect(x, y, width, HERO_HEIGHT, 16).fill(HERO_BG);
  doc.opacity(0.18).fillColor("#38bdf8").circle(x + width - 48, y + 42, 56).fill();
  doc.opacity(1);
  doc.fillColor("#bae6fd").font("Helvetica-Bold").fontSize(TITLE_FONT_SIZE);
  doc.text(meta.title, x + 20, y + 18, { width: width - 190 });
  doc.fillColor("#ffffff").fontSize(HERO_ADDRESS_FONT_SIZE);
  doc.text(meta.address ?? "Investment Memorandum", x + 20, y + 36, {
    width: width - 180,
    lineGap: 2,
  });
  doc.strokeColor(HERO_ACCENT).lineWidth(2);
  doc.moveTo(x + 20, y + HERO_HEIGHT - 18).lineTo(x + 120, y + HERO_HEIGHT - 18).stroke();
  if (meta.score) drawChip(doc, x + width - 132, y + 18, 114, "Deal Score", meta.score);
  if (meta.generated) {
    drawChip(doc, x + width - 132, y + 54, 114, "Generated", meta.generated);
  }
  doc.restore();
  state.y = y + HERO_HEIGHT + 20;
}

function drawSectionHeading(doc: PDFKit.PDFDocument, state: LayoutState, heading: string): void {
  const clean = normalizeHeading(heading);
  const ordinal = extractHeadingOrdinal(heading);
  const displayHeading = titleCase(clean);
  state.currentSection = clean;
  ensureSpace(doc, state, 52);
  doc.save();
  doc.fillColor(MUTED_TEXT_COLOR).font("Helvetica-Bold").fontSize(HEADING_KICKER_FONT_SIZE);
  doc.text(ordinal ? `SECTION ${ordinal}` : "SECTION", MARGIN, state.y, {
    width: bodyWidth(doc),
    lineBreak: false,
  });
  state.y += HEADING_KICKER_FONT_SIZE + 6;
  doc.fillColor(SECTION_HEADING_COLOR).font("Helvetica-Bold").fontSize(HEADING_FONT_SIZE);
  const headingHeight = doc.heightOfString(displayHeading, {
    width: bodyWidth(doc),
    lineGap: 1,
  });
  doc.text(displayHeading, MARGIN, state.y, {
    width: bodyWidth(doc),
    lineGap: 1,
  });
  state.y += headingHeight + 8;
  doc.strokeColor(HERO_ACCENT).lineWidth(2.2);
  doc.moveTo(MARGIN, state.y).lineTo(MARGIN + 112, state.y).stroke();
  doc.restore();
  state.y += HEADING_SPACING;
}

function drawParagraph(doc: PDFKit.PDFDocument, state: LayoutState, line: string): void {
  ensurePageLayout(doc, state, "portrait");
  const bullet = isBullet(line);
  const text = bullet ? cleanBullet(line) : line.trim();
  const bulletOffset = bullet ? 18 : 0;
  doc.font("Helvetica").fontSize(BODY_FONT_SIZE);
  const height = doc.heightOfString(text, {
    width: bodyWidth(doc) - bulletOffset,
    lineGap: BODY_LINE_GAP,
  });
  ensureSpace(doc, state, height + PARAGRAPH_SPACING);
  if (bullet) {
    doc.save();
    doc.fillColor(HERO_ACCENT).circle(MARGIN + 6, state.y + 8, 2.6).fill();
    doc.restore();
  }
  doc.fillColor(BODY_TEXT_COLOR).text(text, MARGIN + bulletOffset, state.y, {
    width: bodyWidth(doc) - bulletOffset,
    lineGap: BODY_LINE_GAP,
  });
  state.y += height + PARAGRAPH_SPACING;
}

function looksNumericValue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "—") return false;
  if (
    /^\(?\$?[-+]?\d[\d,]*(\.\d+)?\)?%?$/.test(trimmed) ||
    /^[-+]?\d+(\.\d+)?x$/i.test(trimmed) ||
    /^Y\d+$/i.test(trimmed)
  ) {
    return true;
  }
  return /\b(LTV|rate|amort|year|yr|month|months|PSF|SQFT)\b/i.test(trimmed) && trimmed.length <= 40;
}

function detectColumnKind(rows: TableCell[][], colIndex: number, keyValue: boolean): ColumnKind {
  if (colIndex === 0) return "label";
  const startIndex = keyValue ? 0 : 1;
  const values = rows
    .slice(startIndex)
    .map((row) => row[colIndex]?.text.trim() ?? "")
    .filter((value) => value.length > 0);
  if (values.length === 0) return "text";
  const numericCount = values.filter(looksNumericValue).length;
  return numericCount >= Math.max(1, Math.ceil(values.length * 0.6)) ? "number" : "text";
}

function tableCellAlign(
  row: TableCell[],
  colIndex: number,
  layout: TableLayout
): "left" | "center" | "right" {
  if (colIndex === 0) return "left";
  if (layout.keyValue) {
    const value = row[colIndex]?.text ?? "";
    return looksNumericValue(value) || (value.length <= 28 && value.split(/\s+/).length <= 5)
      ? "right"
      : "left";
  }
  return layout.columnKinds[colIndex] === "number" ? "right" : "center";
}

function tableColumnWidths(
  tableWidth: number,
  colCount: number,
  options: { keyValue: boolean; landscape: boolean; hasLongValue: boolean }
): number[] {
  if (options.keyValue) {
    const labelWidth = tableWidth * (options.hasLongValue ? 0.31 : 0.42);
    return [labelWidth, tableWidth - labelWidth];
  }
  if (options.landscape && colCount >= 7) {
    const first = tableWidth * 0.36;
    const remaining = (tableWidth - first) / (colCount - 1);
    return [first, ...Array.from({ length: colCount - 1 }, () => remaining)];
  }
  if (options.landscape && colCount === 6) {
    const first = tableWidth * 0.34;
    const remaining = (tableWidth - first) / (colCount - 1);
    return [first, ...Array.from({ length: colCount - 1 }, () => remaining)];
  }
  if (colCount >= 7) {
    const first = tableWidth * 0.32;
    const remaining = (tableWidth - first) / (colCount - 1);
    return [first, ...Array.from({ length: colCount - 1 }, () => remaining)];
  }
  if (colCount === 6) {
    const first = tableWidth * 0.31;
    const remaining = (tableWidth - first) / (colCount - 1);
    return [first, ...Array.from({ length: colCount - 1 }, () => remaining)];
  }
  if (colCount === 5) {
    const first = tableWidth * 0.33;
    const remaining = (tableWidth - first) / 4;
    return [first, remaining, remaining, remaining, remaining];
  }
  if (colCount === 4) {
    const first = tableWidth * 0.36;
    const remaining = (tableWidth - first) / 3;
    return [first, remaining, remaining, remaining];
  }
  if (colCount === 3) {
    const first = tableWidth * 0.44;
    const remaining = (tableWidth - first) / 2;
    return [first, remaining, remaining];
  }
  return Array.from({ length: colCount }, () => tableWidth / colCount);
}

function tableLayout(
  _doc: PDFKit.PDFDocument,
  rows: TableCell[][],
  options?: { forceKeyValue?: boolean }
): TableLayout {
  const colCount = Math.max(...rows.map((row) => row.length));
  const keyValue = options?.forceKeyValue === true || (colCount === 2 && rows.length <= 8);
  const landscape = !keyValue && colCount >= 6;
  const hasLongValue = keyValue && rows.some((row) => (row[1]?.text.length ?? 0) > 34);
  const tableWidth = bodyWidthForLayout(landscape ? "landscape" : "portrait");
  const fontSize = keyValue ? 9.7 : landscape ? (colCount >= 7 ? 7.55 : 7.9) : colCount >= 5 ? 8.35 : 8.95;
  const cellPadding = keyValue ? 6.2 : landscape ? 4.1 : 5.0;
  const columnKinds = Array.from({ length: colCount }, (_, colIndex) =>
    detectColumnKind(rows, colIndex, keyValue)
  );
  return {
    tableWidth,
    widths: tableColumnWidths(tableWidth, colCount, { keyValue, landscape, hasLongValue }),
    fontSize,
    cellPadding,
    keyValue,
    landscape,
    columnKinds,
    hasHeader: !keyValue,
  };
}

function measureTableRowHeight(
  doc: PDFKit.PDFDocument,
  row: TableCell[],
  rowIndex: number,
  layout: TableLayout
): number {
  const isHeader = layout.hasHeader && rowIndex === 0;
  const isSectionRow = !isHeader && isSectionBreakRow(row);
  if (isSectionRow) return layout.fontSize + layout.cellPadding * 2 + 4;
  let rowHeight = layout.fontSize + layout.cellPadding * 2 + 2;
  row.forEach((cell, colIndex) => {
    doc.font(cell.bold || isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(layout.fontSize);
    const renderedText = isHeader ? cell.text.toUpperCase() : cell.text;
    const height = doc.heightOfString(renderedText, {
      width: (layout.widths[colIndex] ?? layout.widths[0] ?? 0) - layout.cellPadding * 2,
      align: tableCellAlign(row, colIndex, layout),
      lineGap: 1.2,
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
  const isHeader = options?.forceHeader === true || (layout.hasHeader && rowIndex === 0);
  const isSectionRow = !isHeader && isSectionBreakRow(row);
  const isEmphasisRow =
    !isHeader &&
    !isSectionRow &&
    row.some((cell) => cell.bold) &&
    row.filter((cell) => cell.text.trim().length > 0).every((cell) => cell.bold);

  if (isSectionRow) {
    doc.save();
    doc.rect(MARGIN, y, layout.tableWidth, rowHeight).fill(TABLE_SECTION_BG);
    doc.strokeColor(RULE_COLOR).lineWidth(0.65).rect(MARGIN, y, layout.tableWidth, rowHeight).stroke();
    doc.fillColor(SECTION_HEADING_COLOR).font("Helvetica-Bold").fontSize(layout.fontSize - 0.1);
    const textY = y + Math.max(layout.cellPadding - 0.5, (rowHeight - layout.fontSize) / 2);
    doc.text(row[0]?.text ?? "", MARGIN + layout.cellPadding, textY, {
      width: layout.tableWidth - layout.cellPadding * 2,
      lineGap: 1.1,
    });
    doc.restore();
    return y + rowHeight;
  }

  let currentX = MARGIN;
  row.forEach((cell, colIndex) => {
    const width = layout.widths[colIndex] ?? layout.widths[0] ?? 0;
    const fillColor = isHeader
      ? TABLE_HEADER_BG
      : options?.highlightRow === true
        ? SENSITIVITY_BASE_BG
        : isEmphasisRow
          ? TABLE_EMPHASIS_BG
        : layout.keyValue && colIndex === 0
          ? LABEL_BG
          : layout.keyValue
            ? VALUE_SURFACE_BG
            : rowIndex % 2 === 0
              ? VALUE_SURFACE_BG
            : TABLE_ALT_BG;
    doc.save();
    doc.rect(currentX, y, width, rowHeight).fill(fillColor);
    doc.restore();
    doc.strokeColor(RULE_COLOR).lineWidth(0.6).rect(currentX, y, width, rowHeight).stroke();
    const color = isHeader
      ? SECTION_HEADING_COLOR
      : /^\(/.test(cell.text.trim()) || /^-/.test(cell.text.trim())
        ? NEGATIVE_TEXT_COLOR
        : BODY_TEXT_COLOR;
    const renderedText = isHeader ? cell.text.toUpperCase() : cell.text;
    const align = tableCellAlign(row, colIndex, layout);
    doc.fillColor(color)
      .font(cell.bold || isHeader ? "Helvetica-Bold" : "Helvetica")
      .fontSize(layout.fontSize);
    const textHeight = doc.heightOfString(renderedText, {
      width: width - layout.cellPadding * 2,
      align,
      lineGap: 1.2,
    });
    const textY = y + Math.max(layout.cellPadding - 0.25, (rowHeight - textHeight) / 2);
    doc.text(renderedText, currentX + layout.cellPadding, textY, {
      width: width - layout.cellPadding * 2,
      align,
      lineGap: 1.2,
    });
    currentX += width;
  });

  return y + rowHeight;
}

function parseFactRow(line: string): TableCell[] | null {
  const trimmed = line.trim();
  if (!trimmed || isBullet(trimmed)) return null;
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9 ()/%&.,'/-]{1,40}):\s+(.+)$/);
  if (!match) return null;
  const label = match[1]?.trim() ?? "";
  const value = match[2]?.trim() ?? "";
  if (!label || !value) return null;
  return [
    { text: label, bold: false },
    { text: value, bold: false },
  ];
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

function sectionPreferredLayout(
  doc: PDFKit.PDFDocument,
  lines: string[],
  nextIndex: number
): PageLayout {
  const tableRows = collectImmediateTableRows(lines, nextIndex);
  if (tableRows.length === 0) return "portrait";
  return tableLayout(doc, tableRows).landscape ? "landscape" : "portrait";
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
  const needed = 40 + measureTableHeight(doc, previewRows, layout) + 10;
  if (state.y + needed > maxY(doc)) addPage(doc, state, layout.landscape ? "landscape" : "portrait");
}

function drawTable(
  doc: PDFKit.PDFDocument,
  state: LayoutState,
  rows: TableCell[][],
  options?: { highlightBoldRows?: boolean; forceKeyValue?: boolean }
): void {
  if (rows.length === 0) return;
  const layout = tableLayout(doc, rows, { forceKeyValue: options?.forceKeyValue });
  ensurePageLayout(doc, state, layout.landscape ? "landscape" : "portrait");
  const rowHeights = rows.map((row, rowIndex) => measureTableRowHeight(doc, row, rowIndex, layout));
  const headerHeight = layout.hasHeader && rows.length > 0 ? rowHeights[0] ?? 0 : 0;
  let currentY = state.y;
  let needsRepeatedHeader = false;

  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex] ?? measureTableRowHeight(doc, row, rowIndex, layout);
    const repeatedHeaderHeight = needsRepeatedHeader ? headerHeight : 0;
    const highlightRow =
      options?.highlightBoldRows === true &&
      rowIndex > 0 &&
      row.some((cell) => cell.bold) &&
      row.filter((cell) => cell.text.trim().length > 0).every((cell) => cell.bold);
    if (currentY + repeatedHeaderHeight + rowHeight > maxY(doc)) {
      addPage(doc, state, layout.landscape ? "landscape" : "portrait");
      currentY = state.y;
      needsRepeatedHeader = layout.hasHeader && rowIndex > 0;
    }

    if (needsRepeatedHeader && layout.hasHeader) {
      currentY = drawTableRow(doc, rows[0] ?? [], 0, currentY, headerHeight, layout, { forceHeader: true });
      needsRepeatedHeader = false;
    }

    currentY = drawTableRow(doc, row, rowIndex, currentY, rowHeight, layout, { highlightRow });
  });

  state.y = currentY + 12;
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
        const state: LayoutState = {
          y: contentTop(),
          pageNumber: 1,
          pageLayout: "portrait",
          meta,
          currentSection: null,
        };
        let tableBuffer: TableCell[][] = [];
        let factBuffer: TableCell[][] = [];
        let currentHeading: string | null = null;

        if (options?.cover) {
          const coverImage = await loadCoverImageBuffer(options.cover.backgroundImageUrl);
          drawStructuredCoverPage(doc, options.cover, coverImage);
          addPage(doc, state, "portrait");
        } else {
          drawPageChrome(doc, state.meta, state.pageNumber, state.currentSection);
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

        const flushFactTable = (): void => {
          if (factBuffer.length === 0) return;
          drawTable(doc, state, factBuffer, { forceKeyValue: true });
          factBuffer = [];
        };

        lines.forEach((raw, index) => {
          const line = raw.trimEnd();
          if (skipLine(line, index)) return;
          if (!line.trim()) {
            flushFactTable();
            flushTable();
            state.y += 4;
            return;
          }
          if (isHeading(line)) {
            flushFactTable();
            flushTable();
            ensurePageLayout(doc, state, sectionPreferredLayout(doc, lines, index + 1));
            ensureSectionFitsWithTable(doc, state, lines, index + 1);
            currentHeading = normalizeHeading(line);
            drawSectionHeading(doc, state, line);
            return;
          }
          if (isTableRow(line)) {
            flushFactTable();
            tableBuffer.push(parseTableRow(line));
            return;
          }
          const factRow = parseFactRow(line);
          if (factRow) {
            flushTable();
            factBuffer.push(factRow);
            return;
          }
          flushFactTable();
          flushTable();
          drawParagraph(doc, state, line);
        });

        flushFactTable();
        flushTable();
        doc.end();
      } catch (error) {
        reject(error);
      }
    })();
  });
}
