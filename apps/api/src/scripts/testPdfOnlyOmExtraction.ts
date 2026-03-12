/**
 * Run the standalone PDF-only OM extractor against local files and/or uploaded OM docs.
 *
 * Examples:
 * - npm run om:test-pdf -- --file "/path/to/om.pdf"
 * - npm run om:test-pdf -- --property "18 Christopher Street, Manhattan, NY, 10014"
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { mkdir, readFile, writeFile } from "fs/promises";
import { basename } from "path";
import { getPool, PropertyRepo, PropertyUploadedDocumentRepo } from "@re-sourcing/db";
import { extractOmAnalysisFromGeminiPdfOnly } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";
import { summarizeOmAnalysisCoverage, type OmInputDocument } from "../om/omAnalysisShared.js";
import { resolveCurrentFinancialsFromOmAnalysis } from "../rental/currentFinancials.js";

interface ParsedArgs {
  files: string[];
  properties: string[];
  outDir: string;
}

interface ExtractionSource {
  label: string;
  propertyContext?: string | null;
  documents: OmInputDocument[];
}

type SharedExtractionResult = {
  model: string;
  rawOutput: string | null;
  finishReason: string | null;
  omAnalysis?: Awaited<ReturnType<typeof extractOmAnalysisFromGeminiPdfOnly>>["omAnalysis"];
  fromLlm?: Awaited<ReturnType<typeof extractOmAnalysisFromGeminiPdfOnly>>["fromLlm"];
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    files: [],
    properties: [],
    outDir: resolve(process.cwd(), "tmp/pdf-only-om-results"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      const value = argv[index + 1];
      if (!value) throw new Error("--file requires a path");
      parsed.files.push(value);
      index += 1;
      continue;
    }
    if (arg === "--property") {
      const value = argv[index + 1];
      if (!value) throw new Error("--property requires a canonical address");
      parsed.properties.push(value);
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--out-dir requires a directory path");
      parsed.outDir = resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function buildLocalFileSources(files: string[]): Promise<ExtractionSource[]> {
  const sources: ExtractionSource[] = [];
  for (const filePath of files) {
    const buffer = await readFile(filePath);
    sources.push({
      label: `file:${filePath}`,
      propertyContext: basename(filePath),
      documents: [
        {
          filename: basename(filePath),
          mimeType: "application/pdf",
          buffer,
        },
      ],
    });
  }
  return sources;
}

async function buildPropertySources(properties: string[]): Promise<ExtractionSource[]> {
  if (properties.length === 0) return [];
  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const uploadedRepo = new PropertyUploadedDocumentRepo({ pool });
  const sources: ExtractionSource[] = [];

  for (const canonicalAddress of properties) {
    const property = await propertyRepo.byCanonicalAddress(canonicalAddress);
    if (!property) throw new Error(`Property not found: ${canonicalAddress}`);
    const uploadedDocs = await uploadedRepo.listByPropertyId(property.id);
    const candidateDocs = uploadedDocs.filter((doc) =>
      ["OM", "Brochure", "Rent Roll", "T12 / Operating Summary"].includes(doc.category ?? "")
    );
    if (candidateDocs.length === 0) throw new Error(`No OM-like uploaded documents found for ${canonicalAddress}`);

    for (const doc of candidateDocs) {
      const buffer = await uploadedRepo.getFileContent(doc.id);
      if (!buffer || buffer.length === 0) continue;
      sources.push({
        label: `property:${canonicalAddress}:${doc.filename}`,
        propertyContext: canonicalAddress,
        documents: [
          {
            filename: doc.filename,
            mimeType: doc.contentType ?? "application/pdf",
            buffer,
          },
        ],
      });
    }
  }

  return sources;
}

function summarizeReadiness(result: SharedExtractionResult) {
  const currentFinancials = resolveCurrentFinancialsFromOmAnalysis(result.omAnalysis ?? null, result.fromLlm ?? null);
  const propertyInfo = (result.omAnalysis?.propertyInfo ?? {}) as Record<string, unknown>;
  const coverage = summarizeOmAnalysisCoverage(result.omAnalysis ?? null);
  const missing: string[] = [];
  if (!coverage.hasUnitCount) missing.push("totalUnits");
  if (!coverage.hasPrice) missing.push("price");
  if (currentFinancials.grossRentalIncome == null) missing.push("grossRentalIncome");
  if (currentFinancials.operatingExpenses == null) missing.push("operatingExpenses");
  if (currentFinancials.noi == null) missing.push("noi");
  if (!coverage.hasRentRoll) missing.push("rentRoll");
  if (!coverage.hasExpenses) missing.push("expenses");

  return {
    propertyAddress: typeof propertyInfo.address === "string" ? propertyInfo.address : null,
    packageAddress: typeof propertyInfo.packageAddress === "string" ? propertyInfo.packageAddress : null,
    totalUnits: typeof propertyInfo.totalUnits === "number" ? propertyInfo.totalUnits : null,
    price: typeof propertyInfo.price === "number" ? propertyInfo.price : null,
    currentFinancials,
    coverage,
    missing,
    readyForDossierAndScoring: missing.length <= 2,
  };
}

async function runExtraction(params: Parameters<typeof extractOmAnalysisFromGeminiPdfOnly>[0]) {
  return extractOmAnalysisFromGeminiPdfOnly(params);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0 && args.properties.length === 0) {
    throw new Error("Provide at least one --file or --property target.");
  }

  const sources = [
    ...(await buildLocalFileSources(args.files)),
    ...(await buildPropertySources(args.properties)),
  ];
  await mkdir(args.outDir, { recursive: true });

  for (const source of sources) {
    console.log(`[testPdfOnlyOmExtraction] Running provider=gemini ${source.label}`);
    const result = await runExtraction({
      documents: source.documents,
      propertyContext: source.propertyContext ?? null,
    });
    const readiness = summarizeReadiness(result);
    const output = {
      source: source.label,
      provider: "gemini",
      model: result.model,
      finishReason: result.finishReason,
      readiness,
      takeaways: result.omAnalysis?.investmentTakeaways ?? [],
      omAnalysis: result.omAnalysis ?? null,
      fromLlm: result.fromLlm ?? null,
      rawOutput: result.rawOutput,
    };
    const filename = `${slugify(source.label)}.json`;
    const outputPath = resolve(args.outDir, filename);
    await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
    console.log(
      `[testPdfOnlyOmExtraction] Saved ${outputPath} ready=${readiness.readyForDossierAndScoring} missing=${readiness.missing.join(",") || "none"}`
    );
  }
}

main().catch((err) => {
  console.error("[testPdfOnlyOmExtraction]", err);
  process.exit(1);
});
