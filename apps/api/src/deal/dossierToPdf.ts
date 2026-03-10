/**
 * Convert dossier plain text (from LLM or template) to a PDF buffer.
 * Uses PDFKit with strong presentation: section colors, table borders and header styling, bullets, spacing.
 */

import PDFDocument from "pdfkit";

const MARGIN = 50;
const PAGE_WIDTH = 612;
const BODY_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const TITLE_FONT_SIZE = 20;
const HEADING_FONT_SIZE = 12;
const BODY_FONT_SIZE = 10;
const TABLE_FONT_SIZE = 9;
const LINE_HEIGHT_BODY = 1.25;
const LINE_HEIGHT_HEADING = 1.3;
const LINE_HEIGHT_TABLE = 1.2;
const SPACING_AFTER_HEADING = 8;
const SPACING_BETWEEN_SECTIONS = 4;
const TABLE_CELL_PADDING = 6;
const BULLET_INDENT = 18;

/** Section heading color (dark blue) */
const SECTION_HEADING_COLOR = "#1e3a5f";
/** Table header row background */
const TABLE_HEADER_BG = "#f0f4f8";
/** Table border and rule color */
const TABLE_BORDER_COLOR = "#cbd5e1";

/**
 * Detect section headings: lines that look like "1. Title", "## Title", or "TITLE" (all caps, short).
 */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,3}\s+.+/.test(t)) return true;
  if (/^\d+[.)]\s+.+/.test(t)) return true;
  if (t.length < 60 && /^[A-Z][A-Z0-9\s&'-]+$/.test(t) && t.split(/\s+/).length <= 6) return true;
  return false;
}

/** True if line looks like a pipe-separated table row. */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.startsWith("|") && t.endsWith("|");
}

/** Parse a table row into cells (strip ** for bold). */
function parseTableRow(line: string): { text: string; bold: boolean }[] {
  const t = line.trim();
  const inner = t.slice(1, -1);
  return inner.split("|").map((cell) => {
    const trimmed = cell.trim();
    const bold = trimmed.startsWith("**") && trimmed.endsWith("**");
    const text = bold ? trimmed.slice(2, -2).trim() : trimmed;
    return { text, bold };
  });
}

/**
 * Draw a table with borders and optional header row background. First row is styled as header.
 */
function drawTable(
  doc: PDFKit.PDFDocument,
  rows: { text: string; bold: boolean }[][],
  x: number,
  y: number,
  tableWidth: number
): number {
  if (rows.length === 0) return y;
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths: number[] = [];
  const minCol = tableWidth / colCount;
  doc.fontSize(TABLE_FONT_SIZE).font("Helvetica");
  for (let c = 0; c < colCount; c++) {
    let maxW = 0;
    for (const row of rows) {
      const cell = row[c];
      if (cell) {
        const w = doc.widthOfString(cell.text) + TABLE_CELL_PADDING * 2;
        if (w > maxW) maxW = w;
      }
    }
    colWidths.push(Math.max(minCol, Math.min(maxW, tableWidth * 0.45)));
  }
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  if (totalW > tableWidth) {
    const scale = tableWidth / totalW;
    for (let c = 0; c < colWidths.length; c++) colWidths[c] = colWidths[c]! * scale;
  }
  const rowHeight = TABLE_FONT_SIZE * LINE_HEIGHT_TABLE + 6;
  let currentY = y;
  doc.strokeColor(TABLE_BORDER_COLOR).lineWidth(0.5);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const isHeader = r === 0 && row.every((c) => !c.bold);
    let cellX = x;
    for (let c = 0; c < colCount; c++) {
      const cell = row[c];
      const w = colWidths[c] ?? minCol;
      if (isHeader) {
        doc.rect(cellX, currentY, w, rowHeight).fill(TABLE_HEADER_BG);
        doc.strokeColor(TABLE_BORDER_COLOR).rect(cellX, currentY, w, rowHeight).stroke();
      } else {
        doc.strokeColor(TABLE_BORDER_COLOR).rect(cellX, currentY, w, rowHeight).stroke();
      }
      if (cell) {
        doc.fontSize(TABLE_FONT_SIZE).font(cell.bold ? "Helvetica-Bold" : "Helvetica");
        if (isHeader) doc.fillColor(SECTION_HEADING_COLOR);
        doc.text(cell.text, cellX + TABLE_CELL_PADDING, currentY + 4, {
          width: w - TABLE_CELL_PADDING * 2,
          ellipsis: true,
        });
        doc.fillColor("black");
      }
      cellX += w;
    }
    currentY += rowHeight;
  }
  return currentY;
}

/**
 * Convert dossier text to PDF. Returns a buffer suitable for saving or email attachment.
 * Supports pipe-separated table rows (e.g. "| Col1 | Col2 |"); cells with **text** are rendered bold.
 */
export function dossierTextToPdf(dossierText: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: MARGIN, size: "letter" });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const lines = dossierText.split(/\r?\n/);
    let y = MARGIN;
    const maxY = 762 - MARGIN;
    let tableBuffer: { text: string; bold: boolean }[][] = [];

    function checkNewPage(needed: number): void {
      if (y + needed > maxY) {
        doc.addPage();
        y = MARGIN;
      }
    }

    function flushTable(): void {
      if (tableBuffer.length > 0) {
        const rowHeight = TABLE_FONT_SIZE * LINE_HEIGHT_TABLE + 2;
        const tableHeight = tableBuffer.length * rowHeight;
        checkNewPage(tableHeight);
        y = drawTable(doc, tableBuffer, MARGIN, y, BODY_WIDTH);
        y += 4;
        tableBuffer = [];
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trimEnd();
      const isFirstLine = i === 0 && line.length > 0;

      if (!line) {
        flushTable();
        y += BODY_FONT_SIZE * LINE_HEIGHT_BODY * 0.5;
        continue;
      }

      if (isFirstLine && line.toUpperCase().includes("DEAL") && line.length < 80) {
        flushTable();
        doc.fontSize(TITLE_FONT_SIZE).font("Helvetica-Bold").fillColor(SECTION_HEADING_COLOR);
        checkNewPage(TITLE_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING);
        doc.text(line, MARGIN, y, { width: BODY_WIDTH });
        y += TITLE_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING;
        doc.font("Helvetica").fontSize(BODY_FONT_SIZE).fillColor("black");
        continue;
      }

      if (isHeading(line)) {
        flushTable();
        const clean = line.replace(/^#+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
        checkNewPage(HEADING_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING);
        doc.fontSize(HEADING_FONT_SIZE).font("Helvetica-Bold").fillColor(SECTION_HEADING_COLOR);
        doc.text(clean, MARGIN, y, { width: BODY_WIDTH });
        y += HEADING_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING;
        doc.font("Helvetica").fontSize(BODY_FONT_SIZE).fillColor("black");
        continue;
      }

      if (isTableRow(line)) {
        tableBuffer.push(parseTableRow(line));
        continue;
      }

      flushTable();
      doc.fontSize(BODY_FONT_SIZE).font("Helvetica").fillColor("black");
      const isBullet = line.trimStart().startsWith("•");
      const textX = isBullet ? MARGIN + BULLET_INDENT : MARGIN;
      const textWidth = BODY_WIDTH - (isBullet ? BULLET_INDENT : 0);
      const height = doc.heightOfString(line, { width: textWidth });
      checkNewPage(height);
      doc.text(line.trimStart(), textX, y, { width: textWidth, lineBreak: true });
      y += height;
    }

    flushTable();
    doc.end();
  });
}
