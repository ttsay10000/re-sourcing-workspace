#!/usr/bin/env node
/**
 * Run the OM (senior-analyst) LLM on a PDF file. Extracts text, then calls OpenAI with forceOmStyle.
 *
 * Usage (from apps/api):
 *   OPENAI_API_KEY=xxx [OPENAI_MODEL=gpt-5.4] node scripts/runOmLlmOnPdf.mjs /path/to/file.pdf
 *
 * Or from repo root:
 *   OPENAI_API_KEY=xxx node apps/api/scripts/runOmLlmOnPdf.mjs /path/to/file.pdf
 */
import { readFile } from "fs/promises";
import { resolve } from "path";
import { extractRentalFinancialsFromText } from "../dist/rental/extractRentalFinancialsFromListing.js";
import { getEnrichmentModel } from "../dist/enrichment/openaiModels.js";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: OPENAI_API_KEY=xxx [OPENAI_MODEL=gpt-5.4] node scripts/runOmLlmOnPdf.mjs <path-to-pdf>");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("Set OPENAI_API_KEY to run this script.");
  process.exit(1);
}

const absolutePath = resolve(pdfPath);
console.log("PDF:", absolutePath);
console.log("Model:", getEnrichmentModel());

let buffer;
try {
  buffer = await readFile(absolutePath);
} catch (e) {
  console.error("Failed to read file:", e instanceof Error ? e.message : e);
  process.exit(1);
}

const pdfParse = (await import("pdf-parse")).default;
let text;
try {
  const data = await pdfParse(buffer);
  text = typeof data?.text === "string" ? data.text.trim() : "";
} catch (e) {
  console.error("Failed to parse PDF:", e instanceof Error ? e.message : e);
  process.exit(1);
}

console.log("Extracted text length:", text.length, "chars");
if (text.length < 50) {
  console.error("Text too short for OM analysis (need at least 50 chars). PDF may be image-only or empty.");
  process.exit(1);
}

console.log("Calling OpenAI (OM senior-analyst prompt, forceOmStyle: true)...\n");

const result = await extractRentalFinancialsFromText(text, { forceOmStyle: true });

console.log("Result:");
console.log("  fromLlm keys:", result.fromLlm && typeof result.fromLlm === "object" ? Object.keys(result.fromLlm) : "null");
console.log("  omAnalysis:", result.omAnalysis ? "present" : "null");
if (result.fromLlm?.noi != null) console.log("  noi:", result.fromLlm.noi);
if (result.fromLlm?.capRate != null) console.log("  capRate:", result.fromLlm.capRate);
if (result.fromLlm?.grossRentTotal != null) console.log("  grossRentTotal:", result.fromLlm.grossRentTotal);
if (result.omAnalysis?.uiFinancialSummary) {
  console.log("  uiFinancialSummary:", JSON.stringify(result.omAnalysis.uiFinancialSummary, null, 2));
}
if (result.omAnalysis?.investmentTakeaways?.length) {
  console.log("  investmentTakeaways:", result.omAnalysis.investmentTakeaways);
}
console.log("\nDone.");
process.exit(0);
