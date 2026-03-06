/**
 * Convert dossier plain text (from LLM or template) to a PDF buffer.
 * Uses PDFKit; headings and body text with basic styling for a readable deal memo.
 */

import PDFDocument from "pdfkit";

const MARGIN = 50;
const PAGE_WIDTH = 612;
const BODY_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const TITLE_FONT_SIZE = 18;
const HEADING_FONT_SIZE = 12;
const BODY_FONT_SIZE = 10;
const LINE_HEIGHT_BODY = 1.25;
const LINE_HEIGHT_HEADING = 1.3;
const SPACING_AFTER_HEADING = 6;

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

/**
 * Convert dossier text to PDF. Returns a buffer suitable for saving or email attachment.
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

    function checkNewPage(needed: number): void {
      if (y + needed > maxY) {
        doc.addPage();
        y = MARGIN;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trimEnd();
      const isFirstLine = i === 0 && line.length > 0;

      if (!line) {
        y += BODY_FONT_SIZE * LINE_HEIGHT_BODY * 0.5;
        continue;
      }

      if (isFirstLine && line.toUpperCase().includes("DEAL") && line.length < 80) {
        doc.fontSize(TITLE_FONT_SIZE).font("Helvetica-Bold");
        checkNewPage(TITLE_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING);
        doc.text(line, MARGIN, y, { width: BODY_WIDTH });
        y += TITLE_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING;
        doc.font("Helvetica").fontSize(BODY_FONT_SIZE);
        continue;
      }

      if (isHeading(line)) {
        const clean = line.replace(/^#+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
        checkNewPage(HEADING_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING);
        doc.fontSize(HEADING_FONT_SIZE).font("Helvetica-Bold");
        doc.text(clean, MARGIN, y, { width: BODY_WIDTH });
        y += HEADING_FONT_SIZE * LINE_HEIGHT_HEADING + SPACING_AFTER_HEADING;
        doc.font("Helvetica").fontSize(BODY_FONT_SIZE);
        continue;
      }

      doc.fontSize(BODY_FONT_SIZE).font("Helvetica");
      const height = doc.heightOfString(line, { width: BODY_WIDTH });
      checkNewPage(height);
      doc.text(line, MARGIN, y, { width: BODY_WIDTH, lineBreak: true });
      y += height;
    }

    doc.end();
  });
}
