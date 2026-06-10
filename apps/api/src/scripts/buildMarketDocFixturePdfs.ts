/**
 * Render the five market-document fixtures into real PDFs (pdfkit) so the
 * pipeline can be exercised end-to-end with a live LLM provider.
 *
 * Usage: npx tsx src/scripts/buildMarketDocFixturePdfs.ts [--out <dir>]
 * Default output: apps/api/fixture-pdfs/
 */
import { mkdir } from "fs/promises";
import { createWriteStream } from "fs";
import { join, resolve } from "path";
import PDFDocument from "pdfkit";
import { MARKET_DOC_FIXTURES } from "../marketContext/fixtures.js";

function renderPdf(text: string, outPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const stream = createWriteStream(outPath);
    stream.on("finish", () => resolvePromise());
    stream.on("error", reject);
    doc.pipe(stream);
    doc.font("Helvetica").fontSize(9);
    for (const line of text.split("\n")) {
      doc.text(line, { lineGap: 2 });
    }
    doc.end();
  });
}

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf("--out");
  const outDir = resolve(outFlag >= 0 ? process.argv[outFlag + 1] : "fixture-pdfs");
  await mkdir(outDir, { recursive: true });
  for (const fixture of MARKET_DOC_FIXTURES) {
    const filename = fixture.filename.replace(/\.txt$/, ".pdf");
    const outPath = join(outDir, filename);
    await renderPdf(fixture.text, outPath);
    console.log(`[fixture-pdfs] wrote ${outPath}`);
  }
}

main().catch((err) => {
  console.error("[fixture-pdfs] failed:", err);
  process.exit(1);
});
