import PDFDocument from "pdfkit";
import type {
  DossierTeaserCashFlowRow,
  DossierTeaserData,
  DossierTeaserHighlight,
  DossierTeaserKpi,
  DossierTeaserPhoto,
  DossierTeaserRentRow,
  DossierTeaserRow,
  DossierTeaserScenario,
} from "./dossierTeaser.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 34;
const HERO_HEIGHT = 218;
const FOOTER_Y = 758;
const TEXT = "#172033";
const MUTED = "#64748b";
const RULE = "#d8e0ea";
const PANEL = "#f7f9fc";
const PANEL_ALT = "#eef4fb";
const NAVY = "#111827";
const BLUE = "#2563eb";
const GREEN = "#0f766e";
const RED = "#b42318";
const WHITE = "#ffffff";
const IMAGE_TIMEOUT_MS = 7_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TOTAL_PAGES = 4;

interface LoadedPhoto extends DossierTeaserPhoto {
  image: Buffer | null;
}

function pageBottom(): number {
  return FOOTER_Y - 16;
}

function isSupportedImage(contentType: string | null, url: string): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg") || normalized.includes("image/png")) {
    return true;
  }
  return /\.(jpe?g|png)(?:$|[?#])/i.test(url);
}

async function loadImageBuffer(url: string | null): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !isSupportedImage(response.headers.get("content-type"), response.url || url)) {
      return null;
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > IMAGE_MAX_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= IMAGE_MAX_BYTES ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function clean(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value.trim() : "N/A";
}

function drawFooter(doc: PDFKit.PDFDocument, data: DossierTeaserData, pageNumber: number): void {
  const sponsor = data.sponsor.organization || data.sponsor.name || "Real Estate Sourcing Flow";
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(MUTED)
    .text(sponsor, MARGIN, FOOTER_Y, { width: 180, height: 9, ellipsis: true })
    .text(data.generatedAt.slice(0, 10), PAGE_WIDTH / 2 - 50, FOOTER_Y, { width: 100, align: "center" })
    .text(`Page ${pageNumber} of ${TOTAL_PAGES}`, PAGE_WIDTH - MARGIN - 90, FOOTER_Y, { width: 90, align: "right" });
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, x: number, y: number, width: number): number {
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(NAVY)
    .text(title.toUpperCase(), x, y, { width, characterSpacing: 0.2 });
  doc.moveTo(x, y + 15).lineTo(x + width, y + 15).strokeColor(RULE).lineWidth(0.8).stroke();
  return y + 24;
}

function drawWrappedText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  options?: { fontSize?: number; color?: string; bold?: boolean; maxHeight?: number }
): number {
  const fontSize = options?.fontSize ?? 8.2;
  doc.font(options?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(options?.color ?? TEXT);
  const height = doc.heightOfString(text, { width, lineGap: 1.2 });
  const maxHeight = options?.maxHeight ?? height;
  doc.text(text, x, y, { width, lineGap: 1.2, height: maxHeight, ellipsis: height > maxHeight });
  return y + Math.min(height, maxHeight);
}

function drawKpiCard(doc: PDFKit.PDFDocument, kpi: DossierTeaserKpi, x: number, y: number, width: number): void {
  const height = 62;
  doc.roundedRect(x, y, width, height, 5).fillColor(WHITE).fill().strokeColor(RULE).lineWidth(0.6).stroke();
  doc.font("Helvetica").fontSize(6.8).fillColor(MUTED).text(kpi.label.toUpperCase(), x + 9, y + 9, { width: width - 18 });
  doc.font("Helvetica-Bold").fontSize(15.5).fillColor(NAVY).text(clean(kpi.value), x + 9, y + 23, { width: width - 18, height: 18, ellipsis: true });
  if (kpi.sublabel) {
    doc.font("Helvetica").fontSize(6.6).fillColor(MUTED).text(kpi.sublabel, x + 9, y + 43, { width: width - 18, height: 11, ellipsis: true });
  }
}

function drawKpiStrip(doc: PDFKit.PDFDocument, kpis: DossierTeaserKpi[], y: number): number {
  const gap = 8;
  const width = (PAGE_WIDTH - MARGIN * 2 - gap * 2) / 3;
  kpis.slice(0, 6).forEach((kpi, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawKpiCard(doc, kpi, MARGIN + col * (width + gap), y + row * 70, width);
  });
  return y + 138;
}

function drawHighlight(doc: PDFKit.PDFDocument, highlight: DossierTeaserHighlight, x: number, y: number, width: number): number {
  doc.circle(x + 4, y + 5, 2.2).fillColor(BLUE).fill();
  doc.font("Helvetica-Bold").fontSize(8.6).fillColor(NAVY).text(highlight.title, x + 14, y, { width: width - 14, height: 11, ellipsis: true });
  return drawWrappedText(doc, highlight.body, x + 14, y + 13, width - 14, { fontSize: 7.8, color: TEXT, maxHeight: 31 }) + 10;
}

function drawRows(
  doc: PDFKit.PDFDocument,
  rows: DossierTeaserRow[],
  x: number,
  y: number,
  width: number,
  options?: { compact?: boolean; limit?: number }
): number {
  const rowHeight = options?.compact ? 30 : 37;
  const limitedRows = rows.slice(0, options?.limit ?? rows.length);
  limitedRows.forEach((row, index) => {
    const rowY = y + index * rowHeight;
    if (index % 2 === 0) doc.roundedRect(x, rowY, width, rowHeight - 3, 4).fillColor(PANEL).fill();
    doc.font("Helvetica").fontSize(7.2).fillColor(MUTED).text(row.label, x + 8, rowY + 7, { width: width * 0.44, height: 11, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(9.3).fillColor(NAVY).text(row.value, x + width * 0.48, rowY + 6, { width: width * 0.48, height: 12, align: "right", ellipsis: true });
    if (row.sublabel) {
      doc.font("Helvetica").fontSize(6.5).fillColor(MUTED).text(row.sublabel, x + 8, rowY + 20, { width: width - 16, height: 9, ellipsis: true });
    }
  });
  return y + limitedRows.length * rowHeight;
}

function drawScenarioStrip(
  doc: PDFKit.PDFDocument,
  scenarios: DossierTeaserScenario[],
  x: number,
  y: number,
  width: number
): number {
  const gap = 6;
  const cardWidth = (width - gap * 2) / 3;
  scenarios.slice(0, 3).forEach((scenario, index) => {
    const cardX = x + index * (cardWidth + gap);
    doc.roundedRect(cardX, y, cardWidth, 58, 5).fillColor(index === 1 ? PANEL_ALT : PANEL).fill();
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(NAVY).text(scenario.label, cardX + 8, y + 8, { width: cardWidth - 16, height: 10, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(index === 1 ? GREEN : NAVY).text(scenario.irr, cardX + 8, y + 21, { width: cardWidth - 16, height: 14, align: "center", ellipsis: true });
    doc.font("Helvetica").fontSize(6.4).fillColor(MUTED).text(`${scenario.cashOnCash} Y1 CoC`, cardX + 8, y + 37, { width: cardWidth - 16, height: 8, align: "center", ellipsis: true });
    doc.font("Helvetica").fontSize(5.9).fillColor(MUTED).text(scenario.note, cardX + 8, y + 47, { width: cardWidth - 16, height: 7, align: "center", ellipsis: true });
  });
  return y + 68;
}

function drawBullets(
  doc: PDFKit.PDFDocument,
  bullets: string[],
  x: number,
  y: number,
  width: number,
  options?: { color?: string; limit?: number }
): number {
  let currentY = y;
  bullets.slice(0, options?.limit ?? bullets.length).forEach((bullet) => {
    doc.circle(x + 3, currentY + 4.5, 1.6).fillColor(options?.color ?? MUTED).fill();
    currentY = drawWrappedText(doc, bullet, x + 11, currentY, width - 11, {
      fontSize: 7.5,
      color: TEXT,
      maxHeight: 23,
    }) + 7;
  });
  return currentY;
}

function drawCompactPageHeader(
  doc: PDFKit.PDFDocument,
  data: DossierTeaserData,
  title: string,
  subtitle?: string
): void {
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fillColor(WHITE).fill();
  doc.font("Helvetica").fontSize(7.2).fillColor(MUTED).text(data.strategyLabel.toUpperCase(), MARGIN, 30, { width: 230, characterSpacing: 0.3 });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text(title, MARGIN, 43, { width: 340, height: 18, ellipsis: true });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(data.address, MARGIN, 64, { width: 340, height: 11, ellipsis: true });
  if (subtitle) {
    doc.font("Helvetica-Oblique").fontSize(7).fillColor(MUTED).text(subtitle, MARGIN, 82, { width: PAGE_WIDTH - MARGIN * 2, height: 20, lineGap: 1, ellipsis: true });
  }
}

function drawPhotoStrip(
  doc: PDFKit.PDFDocument,
  photos: LoadedPhoto[],
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const limited = photos.slice(0, 3);
  if (limited.length === 0) {
    doc.roundedRect(x, y, width, height, 5).fillColor(PANEL).fill().strokeColor(RULE).lineWidth(0.6).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("No property photos or floor plans were available in the listing capture.", x + 10, y + height / 2 - 5, {
      width: width - 20,
      align: "center",
    });
    return y + height + 12;
  }
  const gap = 8;
  const cardWidth = (width - gap * (limited.length - 1)) / limited.length;
  limited.forEach((photo, index) => {
    const cardX = x + index * (cardWidth + gap);
    doc.roundedRect(cardX, y, cardWidth, height, 5).fillColor(PANEL).fill().strokeColor(RULE).lineWidth(0.6).stroke();
    if (photo.image) {
      try {
        doc.image(photo.image, cardX + 4, y + 4, { fit: [cardWidth - 8, height - 20], align: "center", valign: "center" });
      } catch {
        doc.font("Helvetica").fontSize(6.7).fillColor(MUTED).text("Image unavailable", cardX + 8, y + height / 2 - 5, { width: cardWidth - 16, align: "center" });
      }
    } else {
      doc.font("Helvetica").fontSize(6.7).fillColor(MUTED).text("Image unavailable", cardX + 8, y + height / 2 - 5, { width: cardWidth - 16, align: "center" });
    }
    doc.font("Helvetica").fontSize(5.9).fillColor(MUTED).text(photo.label, cardX + 6, y + height - 13, { width: cardWidth - 12, height: 8, ellipsis: true });
  });
  return y + height + 12;
}

function drawRentPlanTable(
  doc: PDFKit.PDFDocument,
  rows: DossierTeaserRentRow[],
  totals: DossierTeaserRentRow,
  x: number,
  y: number,
  width: number
): number {
  const columns = [
    { label: "Floor / unit", width: 92 },
    { label: "SF / beds / status", width: 128 },
    { label: "Current", width: 68 },
    { label: "Uplift", width: 48 },
    { label: "Final rent", width: 72 },
    { label: "Unit expenses", width: width - 92 - 128 - 68 - 48 - 72 },
  ];
  const headerHeight = 18;
  doc.roundedRect(x, y, width, headerHeight, 4).fillColor(NAVY).fill();
  let cursorX = x;
  columns.forEach((column) => {
    doc.font("Helvetica-Bold").fontSize(6.2).fillColor(WHITE).text(column.label.toUpperCase(), cursorX + 5, y + 5, { width: column.width - 10, height: 8, ellipsis: true });
    cursorX += column.width;
  });
  let rowY = y + headerHeight;
  const limitedRows = rows.slice(0, 8);
  [...limitedRows, totals].forEach((row, index) => {
    const isTotal = index === limitedRows.length;
    const rowHeight = isTotal ? 27 : 31;
    if (index % 2 === 0 || isTotal) {
      doc.rect(x, rowY, width, rowHeight).fillColor(isTotal ? PANEL_ALT : PANEL).fill();
    }
    const values = [row.unitLabel, row.unitDetail, row.currentRent, row.uplift, row.finalRent, row.unitExpenses];
    cursorX = x;
    values.forEach((value, colIndex) => {
      doc
        .font(isTotal || colIndex === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(colIndex === 1 ? 5.8 : 6.2)
        .fillColor(colIndex === 3 && value !== "N/A" ? GREEN : TEXT)
        .text(value, cursorX + 5, rowY + 6, {
          width: columns[colIndex].width - 10,
          height: colIndex === 1 || colIndex === 5 ? rowHeight - 9 : 9,
          ellipsis: true,
        });
      cursorX += columns[colIndex].width;
    });
    if (!isTotal && row.notes) {
      doc.font("Helvetica").fontSize(5.3).fillColor(MUTED).text(row.notes, x + 5, rowY + 20, { width: width - 10, height: 7, ellipsis: true });
    }
    rowY += rowHeight;
  });
  if (rows.length > limitedRows.length) {
    doc.font("Helvetica-Oblique").fontSize(6.2).fillColor(MUTED).text(`${rows.length - limitedRows.length} additional unit row(s) are summarized in the total row.`, x + 5, rowY + 3, { width: width - 10 });
    rowY += 14;
  }
  return rowY + 12;
}

function drawExpenseRollup(
  doc: PDFKit.PDFDocument,
  rows: DossierTeaserRow[],
  subtitle: string,
  x: number,
  y: number,
  width: number
): number {
  y = drawSectionTitle(doc, "Operating Expense Rollup", x, y, width);
  doc.font("Helvetica-Oblique").fontSize(6.7).fillColor(MUTED).text(subtitle, x, y, { width, height: 15, ellipsis: true });
  const limitedRows = rows.slice(0, 8);
  const rowWidth = (width - 8) / 2;
  limitedRows.forEach((row, index) => {
    const col = index % 2;
    const rowIndex = Math.floor(index / 2);
    const rowX = x + col * (rowWidth + 8);
    const rowY = y + 21 + rowIndex * 27;
    doc.roundedRect(rowX, rowY, rowWidth, 22, 4).fillColor(PANEL).fill();
    doc.font("Helvetica").fontSize(6.3).fillColor(MUTED).text(row.label, rowX + 7, rowY + 5, { width: rowWidth * 0.58, height: 8, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(6.8).fillColor(NAVY).text(row.value, rowX + rowWidth * 0.62, rowY + 5, { width: rowWidth * 0.34, height: 8, align: "right", ellipsis: true });
    if (row.sublabel) doc.font("Helvetica").fontSize(5.4).fillColor(MUTED).text(row.sublabel, rowX + 7, rowY + 14, { width: rowWidth - 14, height: 6, ellipsis: true });
  });
  return y + 25 + Math.ceil(limitedRows.length / 2) * 27 + 8;
}

function cashFlowCategoryColor(category: DossierTeaserCashFlowRow["category"]): string {
  if (category === "metric") return NAVY;
  if (category === "expense" || category === "debt") return RED;
  if (category === "noi" || category === "return") return GREEN;
  if (category === "capital") return MUTED;
  return BLUE;
}

function isAccountingTotal(row: DossierTeaserCashFlowRow): boolean {
  return row.emphasis === "subtotal" || row.emphasis === "total";
}

function drawCashFlowTable(
  doc: PDFKit.PDFDocument,
  rows: DossierTeaserCashFlowRow[],
  columns: string[],
  x: number,
  y: number,
  width: number
): number {
  if (columns.length === 0 || rows.length === 0) {
    doc.roundedRect(x, y, width, 56, 5).fillColor(PANEL).fill();
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Cash-flow projection unavailable for this dossier run.", x + 12, y + 22, { width: width - 24, align: "center" });
    return y + 68;
  }
  const labelWidth = 124;
  const valueWidth = (width - labelWidth) / columns.length;
  const headerHeight = 18;
  doc.roundedRect(x, y, width, headerHeight, 4).fillColor(NAVY).fill();
  doc.font("Helvetica-Bold").fontSize(6).fillColor(WHITE).text("LINE ITEM", x + 6, y + 5, { width: labelWidth - 12 });
  columns.forEach((column, index) => {
    doc.font("Helvetica-Bold").fontSize(6).fillColor(WHITE).text(column, x + labelWidth + index * valueWidth, y + 5, { width: valueWidth - 4, align: "right" });
  });
  let rowY = y + headerHeight;
  const dense = rows.length > 26;
  const rowHeight = dense ? 17 : rows.length > 24 ? 19 : 22;
  rows.forEach((row, rowIndex) => {
    const isMetric = row.emphasis === "metric";
    if (rowIndex % 2 === 0 || isMetric) doc.rect(x, rowY, width, rowHeight).fillColor(isMetric ? PANEL_ALT : PANEL).fill();
    if (isMetric && rows[rowIndex - 1]?.emphasis !== "metric") {
      doc.moveTo(x, rowY).lineTo(x + width, rowY).strokeColor(RULE).lineWidth(0.8).stroke();
    }
    if (isAccountingTotal(row)) {
      doc.moveTo(x + labelWidth, rowY + 1).lineTo(x + width, rowY + 1).strokeColor(TEXT).lineWidth(row.emphasis === "total" ? 0.8 : 0.55).stroke();
    }
    doc.circle(x + 5, rowY + 8, 1.4).fillColor(cashFlowCategoryColor(row.category)).fill();
    const labelInset = 11 + Math.max(0, row.indentLevel ?? 0) * 7;
    const boldRow = row.category === "noi" || row.category === "return" || row.emphasis != null;
    doc
      .font(boldRow ? "Helvetica-Bold" : "Helvetica")
      .fontSize(dense ? 5.3 : 5.8)
      .fillColor(isMetric ? NAVY : TEXT)
      .text(row.label, x + labelInset, rowY + 5, { width: labelWidth - labelInset - 4, height: 8, ellipsis: true });
    row.values.slice(0, columns.length).forEach((cell, index) => {
      const cellX = x + labelWidth + index * valueWidth;
      doc
        .font(boldRow ? "Helvetica-Bold" : "Helvetica")
        .fontSize(dense ? 5.2 : 5.8)
        .fillColor(isMetric ? NAVY : TEXT)
        .text(cell.value, cellX, rowY + 4, { width: valueWidth - 4, align: "right", height: 7, ellipsis: true });
      if (cell.percentLabel) {
        doc.font("Helvetica").fontSize(dense ? 4.3 : 4.8).fillColor(MUTED).text(cell.percentLabel, cellX, rowY + 11, { width: valueWidth - 4, align: "right", height: 6, ellipsis: true });
      }
    });
    if (row.emphasis === "total") {
      doc.moveTo(x + labelWidth, rowY + rowHeight - 3).lineTo(x + width, rowY + rowHeight - 3).strokeColor(TEXT).lineWidth(0.55).stroke();
      doc.moveTo(x + labelWidth, rowY + rowHeight - 1).lineTo(x + width, rowY + rowHeight - 1).strokeColor(TEXT).lineWidth(0.55).stroke();
    }
    rowY += rowHeight;
  });
  return rowY + 10;
}

function drawHero(doc: PDFKit.PDFDocument, data: DossierTeaserData, heroImage: Buffer | null): void {
  doc.rect(0, 0, PAGE_WIDTH, HERO_HEIGHT).fillColor(NAVY).fill();
  if (heroImage) {
    try {
      doc.image(heroImage, 0, 0, { fit: [PAGE_WIDTH, HERO_HEIGHT], align: "center", valign: "center" });
      doc.rect(0, 0, PAGE_WIDTH, HERO_HEIGHT).fillOpacity(0.52).fillColor(NAVY).fill().fillOpacity(1);
    } catch {
      doc.rect(0, 0, PAGE_WIDTH, HERO_HEIGHT).fillColor(NAVY).fill();
    }
  }
  doc.font("Helvetica").fontSize(8).fillColor("#bfdbfe").text(data.strategyLabel.toUpperCase(), MARGIN, 34, { width: 270, characterSpacing: 0.4 });
  doc.font("Helvetica-Bold").fontSize(23).fillColor(WHITE).text(data.address, MARGIN, 54, { width: PAGE_WIDTH - MARGIN * 2 - 118, lineGap: 1, height: 70, ellipsis: true });
  doc.font("Helvetica").fontSize(9).fillColor("#e5eef8").text(data.assetSummary, MARGIN, 128, { width: PAGE_WIDTH - MARGIN * 2 - 120, height: 15, ellipsis: true });
  if (data.neighborhoodLabel) {
    doc.font("Helvetica").fontSize(8).fillColor("#dbeafe").text(data.neighborhoodLabel, MARGIN, 148, { width: 240, height: 12, ellipsis: true });
  }
  doc.roundedRect(PAGE_WIDTH - MARGIN - 92, 38, 92, 82, 6).fillColor(WHITE).fillOpacity(0.94).fill().fillOpacity(1);
  doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("DEAL SCORE", PAGE_WIDTH - MARGIN - 78, 52, { width: 64, align: "center" });
  doc.font("Helvetica-Bold").fontSize(25).fillColor(data.score.value != null && data.score.value >= 70 ? GREEN : NAVY).text(data.score.value != null ? String(data.score.value) : "N/A", PAGE_WIDTH - MARGIN - 78, 67, { width: 64, align: "center" });
  doc.font("Helvetica").fontSize(6.6).fillColor(MUTED).text(data.score.confidenceLabel ? `${data.score.confidenceLabel} confidence` : data.score.profileLabel, PAGE_WIDTH - MARGIN - 82, 98, { width: 72, align: "center", height: 10, ellipsis: true });
}

function drawPageOne(doc: PDFKit.PDFDocument, data: DossierTeaserData, heroImage: Buffer | null): void {
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fillColor(WHITE).fill();
  drawHero(doc, data, heroImage);
  let y = drawKpiStrip(doc, data.kpis, HERO_HEIGHT + 18) + 22;
  const leftX = MARGIN;
  const rightX = PAGE_WIDTH / 2 + 8;
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - 18) / 2;
  const sectionY = y;
  y = drawSectionTitle(doc, "Investment Highlights", leftX, sectionY, colWidth);
  data.investmentHighlights.slice(0, 4).forEach((highlight) => {
    y = drawHighlight(doc, highlight, leftX, y, colWidth);
  });

  let rightY = drawSectionTitle(doc, "Operating Snapshot", rightX, sectionY, colWidth);
  rightY = drawRows(doc, data.operatingSnapshot, rightX, rightY, colWidth, { limit: 4 });
  rightY += 8;
  rightY = drawSectionTitle(doc, "Risks To Verify", rightX, rightY, colWidth);
  drawBullets(doc, data.risks.length > 0 ? data.risks : ["No material scoring caps or risk flags were produced by the current model."], rightX, rightY, colWidth, { color: RED, limit: 3 });
  drawFooter(doc, data, 1);
}

function drawPageTwo(doc: PDFKit.PDFDocument, data: DossierTeaserData): void {
  doc.addPage({ margin: 0, size: "letter" });
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fillColor(WHITE).fill();
  doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text("Investment Committee Teaser", MARGIN, 34, { width: 310 });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(data.address, MARGIN, 55, { width: 330, height: 11, ellipsis: true });
  doc.roundedRect(PAGE_WIDTH - MARGIN - 150, 34, 150, 35, 5).fillColor(PANEL_ALT).fill();
  doc.font("Helvetica").fontSize(6.8).fillColor(MUTED).text("SCORING PROFILE", PAGE_WIDTH - MARGIN - 140, 43, { width: 130 });
  doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY).text(data.score.profileLabel, PAGE_WIDTH - MARGIN - 140, 54, { width: 130, height: 10, ellipsis: true });

  const leftX = MARGIN;
  const rightX = PAGE_WIDTH / 2 + 8;
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - 18) / 2;
  let leftY = drawSectionTitle(doc, "Returns Scenarios", leftX, 92, colWidth);
  leftY = drawScenarioStrip(doc, data.returnScenarios, leftX, leftY, colWidth);
  leftY += 8;
  leftY = drawSectionTitle(doc, "Projected Returns", leftX, leftY, colWidth);
  leftY = drawRows(doc, data.projectedReturns, leftX, leftY, colWidth, { limit: 6 });
  leftY += 14;
  leftY = drawSectionTitle(doc, "Capital Stack", leftX, leftY, colWidth);
  drawRows(doc, data.capitalStack, leftX, leftY, colWidth, { limit: 4 });

  let rightY = drawSectionTitle(doc, "Risks And Diligence", rightX, 92, colWidth);
  rightY = drawBullets(doc, data.risks.length > 0 ? data.risks : ["No material scoring caps or risk flags were produced by the current model."], rightX, rightY, colWidth, { color: RED, limit: 5 });
  rightY = Math.min(rightY + 6, pageBottom() - 252);
  rightY = drawSectionTitle(doc, "Mitigants / Open Items", rightX, rightY, colWidth);
  rightY = drawBullets(doc, data.mitigants.length > 0 ? data.mitigants : ["No separate mitigants were generated by the current model."], rightX, rightY, colWidth, { color: GREEN, limit: 4 });
  rightY = Math.min(rightY + 8, pageBottom() - 154);
  rightY = drawSectionTitle(doc, "Provenance", rightX, rightY, colWidth);
  drawBullets(doc, data.provenance, rightX, rightY, colWidth, { color: BLUE, limit: 4 });

  doc.roundedRect(MARGIN, pageBottom() - 60, PAGE_WIDTH - MARGIN * 2, 42, 5).fillColor(PANEL_ALT).fill();
  const sponsorLabel = data.sponsor.organization || data.sponsor.name || "Real Estate Sourcing Flow";
  const contactLabel = [data.sponsor.name, data.sponsor.email].filter(Boolean).join(" | ");
  doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY).text(sponsorLabel, MARGIN + 12, pageBottom() - 48, { width: 120, height: 10, ellipsis: true });
  doc.font("Helvetica").fontSize(7.3).fillColor(TEXT).text(
    `${contactLabel ? `${contactLabel}. ` : ""}This teaser is assembled from the deterministic underwriting context and should be reviewed with the Excel model for line-item audit.`,
    MARGIN + 112,
    pageBottom() - 49,
    { width: PAGE_WIDTH - MARGIN * 2 - 126, height: 25, lineGap: 1.1 }
  );
  drawFooter(doc, data, 2);
}

function drawPageThree(doc: PDFKit.PDFDocument, data: DossierTeaserData, photos: LoadedPhoto[]): void {
  doc.addPage({ margin: 0, size: "letter" });
  drawCompactPageHeader(doc, data, "Rent Plan And Unit Detail", data.rentSummary.subtitle);
  let y = 112;
  y = drawSectionTitle(doc, "Current To Final Rent By Floor", MARGIN, y, PAGE_WIDTH - MARGIN * 2);
  y = drawRentPlanTable(
    doc,
    data.rentSummary.rows,
    data.rentSummary.totals,
    MARGIN,
    y,
    PAGE_WIDTH - MARGIN * 2
  );
  const rollupY = Math.min(y, pageBottom() - 210);
  y = drawExpenseRollup(
    doc,
    data.rentSummary.expenseRows,
    data.rentSummary.expenseSubtitle,
    MARGIN,
    rollupY,
    PAGE_WIDTH - MARGIN * 2
  );
  const photoY = Math.min(Math.max(y + 4, pageBottom() - 126), pageBottom() - 126);
  drawSectionTitle(doc, "Property / Floor Photos", MARGIN, photoY, PAGE_WIDTH - MARGIN * 2);
  drawPhotoStrip(doc, photos, MARGIN, photoY + 24, PAGE_WIDTH - MARGIN * 2, 82);
  drawFooter(doc, data, 3);
}

function drawPageFour(doc: PDFKit.PDFDocument, data: DossierTeaserData): void {
  doc.addPage({ margin: 0, size: "letter" });
  drawCompactPageHeader(doc, data, "Detailed Cash Flow", data.cashFlowSummary.subtitle);
  let y = 112;
  y = drawSectionTitle(doc, "Annual Projection", MARGIN, y, PAGE_WIDTH - MARGIN * 2);
  drawCashFlowTable(doc, data.cashFlowSummary.rows, data.cashFlowSummary.columns, MARGIN, y, PAGE_WIDTH - MARGIN * 2);
  drawFooter(doc, data, 4);
}

export async function dossierTeaserToPdf(data: DossierTeaserData): Promise<Buffer> {
  const heroImage = await loadImageBuffer(data.heroImageUrl);
  const loadedPhotos = await Promise.all(
    data.propertyPhotos.slice(0, 3).map(async (photo) => ({
      ...photo,
      image: await loadImageBuffer(photo.url),
    }))
  );
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, size: "letter" });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.addPage({ margin: 0, size: "letter" });
    drawPageOne(doc, data, heroImage);
    drawPageTwo(doc, data);
    drawPageThree(doc, data, loadedPhotos);
    drawPageFour(doc, data);
    doc.end();
  });
}
