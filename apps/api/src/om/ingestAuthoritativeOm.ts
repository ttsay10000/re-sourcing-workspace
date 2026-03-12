import { readFile } from "fs/promises";
import type { Pool } from "pg";
import type {
  OmAuthoritativeSnapshot,
  OmAnalysis,
  OmCoverage,
  OmExtractionMethod,
  OmValidationFlag,
  PropertyDetails,
  RentalFinancials,
} from "@re-sourcing/contracts";
import {
  getPool,
  InquiryDocumentRepo,
  OmAuthoritativeSnapshotRepo,
  OmIngestionRunRepo,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import { resolveInquiryFilePath } from "../inquiry/storage.js";
import { runGenerateDossier } from "../deal/runGenerateDossier.js";
import {
  type OmInputDocument,
  isPdfLikeOmInputDocument,
} from "./omAnalysisShared.js";
import { extractOmAnalysisFromGeminiPdfOnly, resolveGeminiOmModel } from "./extractOmAnalysisFromGeminiPdfOnly.js";
import {
  type ResolvedCurrentFinancials,
  resolveCurrentFinancialsFromOmAnalysis,
} from "../rental/currentFinancials.js";
import {
  sanitizeExpenseTableRows,
  sanitizeOmRentRollRows,
} from "../rental/omAnalysisUtils.js";
import { resolveUploadedDocFilePath } from "../upload/uploadedDocStorage.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";

export type AuthoritativeOmSourceType =
  | "uploaded_document"
  | "inquiry_attachment"
  | "manual_refresh"
  | "backfill"
  | "other";

type OmDocumentOrigin = "uploaded_document" | "inquiry_attachment";

export interface OmAutomationDocument {
  id: string;
  origin: OmDocumentOrigin;
  filename: string;
  mimeType?: string | null;
  filePath?: string | null;
  buffer?: Buffer | null;
  category?: string | null;
  source?: string | null;
  createdAt?: string | null;
}

interface PreparedOmAutomationDocument extends OmAutomationDocument {
  buffer: Buffer;
  fileBytes: number;
}

export interface IngestAuthoritativeOmParams {
  propertyId: string;
  sourceType: AuthoritativeOmSourceType;
  documents: OmAutomationDocument[];
  triggerDossier?: boolean;
  pool?: Pool;
}

export interface RefreshAuthoritativeOmResult {
  documentsProcessed: number;
  documentsSkippedNoFile: number;
  runId: string | null;
  snapshotId: string | null;
  dossierGenerated: boolean;
  error?: string;
}

export interface RefreshAuthoritativeOmOptions {
  triggerDossier?: boolean;
}

const GEMINI_OM_EXTRACTION_METHOD: OmExtractionMethod = "hybrid";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function looksLikeOmStyleFilename(filename: string | null | undefined): boolean {
  if (!filename || typeof filename !== "string") return false;
  return /(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll|t-?12|operating)/i.test(filename);
}

function scoreDocument(doc: OmAutomationDocument): number {
  const filename = doc.filename.toLowerCase();
  let score = 0;
  if (doc.origin === "uploaded_document") score += 2;
  if ((doc.category ?? "").toLowerCase() === "om") score += 12;
  if ((doc.category ?? "").toLowerCase() === "brochure") score += 10;
  if ((doc.category ?? "").toLowerCase() === "rent roll") score += 14;
  if ((doc.category ?? "").toLowerCase() === "t12 / operating summary") score += 8;
  if (filename.includes("rent roll")) score += 14;
  if (filename.includes("offering")) score += 12;
  if (filename.includes("memorandum")) score += 12;
  if (/(^|[^a-z])om([^a-z]|$)/.test(filename)) score += 10;
  if (filename.includes("brochure")) score += 8;
  if (filename.endsWith(".pdf")) score += 2;
  if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) score += 1;
  return score;
}

function buildCoverage(snapshot: OmAuthoritativeSnapshot): OmCoverage {
  const current = snapshot.currentFinancials ?? null;
  const rentRoll = Array.isArray(snapshot.rentRoll) ? snapshot.rentRoll : [];
  const expenseRows = Array.isArray(snapshot.expenses?.expensesTable) ? snapshot.expenses?.expensesTable : [];
  const existingCoverage = isPlainObject(snapshot.coverage) ? snapshot.coverage : {};
  return {
    ...existingCoverage,
    propertyInfoExtracted:
      existingCoverage.propertyInfoExtracted ?? (isPlainObject(snapshot.propertyInfo) && Object.keys(snapshot.propertyInfo).length > 0),
    rentRollExtracted: existingCoverage.rentRollExtracted ?? rentRoll.length > 0,
    incomeStatementExtracted:
      existingCoverage.incomeStatementExtracted ?? (isPlainObject(snapshot.incomeStatement) && Object.keys(snapshot.incomeStatement).length > 0),
    expensesExtracted:
      existingCoverage.expensesExtracted ??
      (expenseRows.length > 0 || toFiniteNumber(snapshot.expenses?.totalExpenses) != null),
    currentFinancialsExtracted:
      existingCoverage.currentFinancialsExtracted ??
      [current?.noi, current?.grossRentalIncome, current?.operatingExpenses].some((value) => toFiniteNumber(value) != null),
    unitCountExtracted:
      existingCoverage.unitCountExtracted ??
      (rentRoll.length > 0 || toFiniteNumber((snapshot.propertyInfo as Record<string, unknown> | null)?.totalUnits) != null),
  };
}

function toAuthoritativeCurrentFinancials(
  current: ResolvedCurrentFinancials
): NonNullable<OmAuthoritativeSnapshot["currentFinancials"]> {
  return {
    noi: current.noi,
    grossRentalIncome: current.grossRentalIncome,
    otherIncome: current.otherIncome,
    vacancyLoss: current.vacancyLoss,
    effectiveGrossIncome: current.effectiveGrossIncome,
    operatingExpenses: current.operatingExpenses,
  };
}

function buildMissingDataFlags(snapshot: OmAuthoritativeSnapshot): OmValidationFlag[] {
  const flags: OmValidationFlag[] = Array.isArray(snapshot.validationFlags) ? [...snapshot.validationFlags] : [];
  const current = snapshot.currentFinancials ?? null;
  const coverage = buildCoverage(snapshot);

  if (!coverage.rentRollExtracted) {
    flags.push({
      flagType: "missing_om_field",
      field: "rentRoll",
      severity: "warning",
      source: "authoritative_om",
      message: "Rent roll not extracted from OM; review source document and request an updated rent roll if needed.",
    });
  }
  if (toFiniteNumber(current?.grossRentalIncome) == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "grossRentalIncome",
      severity: "warning",
      source: "authoritative_om",
      message: "Gross rental income is missing from the OM extraction and remains null.",
    });
  }
  if (toFiniteNumber(current?.operatingExpenses) == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "operatingExpenses",
      severity: "warning",
      source: "authoritative_om",
      message: "Operating expenses are missing from the OM extraction and remain null.",
    });
  }
  if (toFiniteNumber(current?.noi) == null) {
    flags.push({
      flagType: "missing_om_field",
      field: "noi",
      severity: "warning",
      source: "authoritative_om",
      message: "NOI is missing from the OM extraction and remains null.",
    });
  }

  return flags;
}

async function loadDocumentBuffer(
  doc: OmAutomationDocument,
  pool: Pool
): Promise<Buffer | null> {
  if (doc.buffer instanceof Buffer && doc.buffer.length > 0) return doc.buffer;

  if (doc.origin === "uploaded_document") {
    const repo = new PropertyUploadedDocumentRepo({ pool });
    const fromDb = await repo.getFileContent(doc.id);
    if (fromDb && fromDb.length > 0) return fromDb;
    if (doc.filePath) {
      try {
        return await readFile(resolveUploadedDocFilePath(doc.filePath));
      } catch {
        return null;
      }
    }
    return null;
  }

  const repo = new InquiryDocumentRepo({ pool });
  const fromDb = await repo.getFileContent(doc.id);
  if (fromDb && fromDb.length > 0) return fromDb;
  if (doc.filePath) {
    try {
      return await readFile(resolveInquiryFilePath(doc.filePath));
    } catch {
      return null;
    }
  }
  return null;
}

async function buildDocumentPayloads(
  documents: OmAutomationDocument[],
  pool: Pool
): Promise<{
  preparedDocuments: PreparedOmAutomationDocument[];
  skippedNoFile: number;
}> {
  const preparedDocuments: PreparedOmAutomationDocument[] = [];
  let skippedNoFile = 0;

  for (const doc of documents) {
    const buffer = await loadDocumentBuffer(doc, pool);
    if (!buffer || buffer.length === 0) {
      skippedNoFile++;
      continue;
    }
    const prepared: PreparedOmAutomationDocument = {
      ...doc,
      buffer,
      fileBytes: buffer.length,
    };
    preparedDocuments.push(prepared);
  }

  return {
    preparedDocuments,
    skippedNoFile,
  };
}

async function insertExtractedSnapshot(
  pool: Pool,
  params: { runId: string; propertyId: string; extractionMethod: string | null; snapshot: OmAuthoritativeSnapshot }
): Promise<void> {
  await pool.query(
    `INSERT INTO om_extracted_snapshots (run_id, property_id, extraction_method, snapshot)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET
       property_id = EXCLUDED.property_id,
       extraction_method = EXCLUDED.extraction_method,
       snapshot = EXCLUDED.snapshot,
       updated_at = now()`,
    [params.runId, params.propertyId, params.extractionMethod, JSON.stringify(params.snapshot)]
  );
}

function mergePropertyOmDetails(
  details: PropertyDetails | null | undefined,
  snapshot: OmAuthoritativeSnapshot,
  omAnalysis: OmAnalysis,
  fromLlm: RentalFinancials["fromLlm"],
  promotedSnapshotId: string,
  runId: string,
  completedAt: string
): { omData: NonNullable<PropertyDetails["omData"]>; rentalFinancials: RentalFinancials } {
  const existingDetails = details ?? {};
  const existingOmData = existingDetails.omData ?? {};
  const existingRentalFinancials = existingDetails.rentalFinancials ?? {};
  const authoritativeSnapshot: OmAuthoritativeSnapshot = {
    ...snapshot,
    id: promotedSnapshotId,
    runId,
    promotedAt: completedAt,
  };

  return {
    omData: {
      ...existingOmData,
      activeRunId: runId,
      activeSnapshotId: promotedSnapshotId,
      latestRunId: runId,
      status: "promoted",
      snapshotVersion: 2,
      lastProcessedAt: completedAt,
      authoritative: authoritativeSnapshot,
    },
    rentalFinancials: {
      ...existingRentalFinancials,
      fromLlm: fromLlm ?? undefined,
      omAnalysis,
      lastUpdatedAt: completedAt,
    },
  };
}

export async function listOmAutomationDocumentsForProperty(
  propertyId: string,
  pool: Pool = getPool()
): Promise<OmAutomationDocument[]> {
  const [uploadedRepo, inquiryRepo] = [
    new PropertyUploadedDocumentRepo({ pool }),
    new InquiryDocumentRepo({ pool }),
  ];
  const [uploadedDocs, inquiryDocs] = await Promise.all([
    uploadedRepo.listByPropertyId(propertyId),
    inquiryRepo.listByPropertyIdWithSource(propertyId),
  ]);

  const uploaded = uploadedDocs
    .filter((doc) => doc.category === "OM" || doc.category === "Brochure" || doc.category === "Rent Roll" || doc.category === "T12 / Operating Summary")
    .map<OmAutomationDocument>((doc) => ({
      id: doc.id,
      origin: "uploaded_document",
      filename: doc.filename,
      mimeType: doc.contentType ?? null,
      filePath: doc.filePath,
      category: doc.category,
      source: doc.source ?? null,
      createdAt: doc.createdAt,
    }));
  const inquiry = inquiryDocs
    .filter((doc) => looksLikeOmStyleFilename(doc.filename))
    .map<OmAutomationDocument>((doc) => ({
      id: doc.id,
      origin: "inquiry_attachment",
      filename: doc.filename,
      mimeType: doc.contentType ?? null,
      filePath: doc.filePath,
      source: doc.source ?? null,
      createdAt: doc.createdAt,
    }));

  return [...uploaded, ...inquiry].sort((left, right) => {
    const scoreDiff = scoreDocument(right) - scoreDocument(left);
    if (scoreDiff !== 0) return scoreDiff;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export async function ingestAuthoritativeOm(
  params: IngestAuthoritativeOmParams
): Promise<RefreshAuthoritativeOmResult> {
  const pool = params.pool ?? getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const ingestionRunRepo = new OmIngestionRunRepo({ pool });
  const authoritativeRepo = new OmAuthoritativeSnapshotRepo({ pool });
  const property = await propertyRepo.byId(params.propertyId);
  if (!property) {
    return {
      documentsProcessed: 0,
      documentsSkippedNoFile: 0,
      runId: null,
      snapshotId: null,
      dossierGenerated: false,
      error: `Property ${params.propertyId} not found.`,
    };
  }

  const candidateDocuments = [...params.documents]
    .filter((doc) => looksLikeOmStyleFilename(doc.filename) || doc.category === "OM" || doc.category === "Brochure" || doc.category === "Rent Roll" || doc.category === "T12 / Operating Summary")
    .sort((left, right) => {
      const scoreDiff = scoreDocument(right) - scoreDocument(left);
      if (scoreDiff !== 0) return scoreDiff;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      return rightTime - leftTime;
    });

  if (candidateDocuments.length === 0) {
    return {
      documentsProcessed: 0,
      documentsSkippedNoFile: 0,
      runId: null,
      snapshotId: null,
      dossierGenerated: false,
      error: "No OM, brochure, rent roll, or operating statement documents are available for ingestion.",
    };
  }

  const candidateDocumentSourceMeta = candidateDocuments.map((doc) => ({
    id: doc.id,
    origin: doc.origin,
    filename: doc.filename,
    category: doc.category ?? null,
    source: doc.source ?? null,
  }));
  let runId: string | null = null;

  try {
    const { preparedDocuments, skippedNoFile } = await buildDocumentPayloads(candidateDocuments, pool);
    const geminiDocuments: OmInputDocument[] = preparedDocuments
      .filter((doc) => isPdfLikeOmInputDocument(doc))
      .map((doc) => ({
        filename: doc.filename,
        mimeType: doc.mimeType ?? "application/pdf",
        buffer: doc.buffer,
      }));
    const geminiModel = resolveGeminiOmModel();
    const sourceMeta = {
      documents: candidateDocumentSourceMeta,
      parser: {
        provider: "gemini",
        mode: "pdf_only",
        model: geminiModel,
        documentCount: geminiDocuments.length,
        documentFilenames: geminiDocuments.map((doc) => doc.filename),
      },
    };
    const unreadableFileError =
      preparedDocuments.length === 0
        ? "OM ingestion could not read any document bytes from the available files."
        : null;
    const run = await ingestionRunRepo.create({
      propertyId: params.propertyId,
      sourceDocumentId: candidateDocuments[0]?.id ?? null,
      sourceType: params.sourceType,
      status: unreadableFileError ? "failed" : "processing",
      extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
      pageCount: null,
      financialPageCount: null,
      ocrPageCount: null,
      sourceMeta,
      coverage: null,
      lastError: unreadableFileError,
      completedAt: unreadableFileError ? new Date().toISOString() : null,
    });
    runId = run.id;

    if (preparedDocuments.length === 0) {
      return {
        documentsProcessed: 0,
        documentsSkippedNoFile: skippedNoFile,
        runId,
        snapshotId: null,
        dossierGenerated: false,
        error: unreadableFileError ?? "OM ingestion could not read any document bytes from the available files.",
      };
    }
    if (geminiDocuments.length === 0) {
      const error = "Authoritative OM ingestion requires at least one readable PDF document for Gemini parsing.";
      await ingestionRunRepo.update(run.id, {
        status: "failed",
        extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
        pageCount: null,
        financialPageCount: null,
        ocrPageCount: null,
        coverage: null,
        lastError: error,
        completedAt: new Date().toISOString(),
      });
      return {
        documentsProcessed: preparedDocuments.length,
        documentsSkippedNoFile: skippedNoFile,
        runId,
        snapshotId: null,
        dossierGenerated: false,
        error,
      };
    }

    const extracted = await extractOmAnalysisFromGeminiPdfOnly({
      documents: geminiDocuments,
      propertyContext: property.canonicalAddress ?? property.id,
      enrichmentContext: null,
      model: geminiModel,
    });
    if (!extracted.omAnalysis) {
      const error = extracted.parseError
        ? `Gemini authoritative OM extraction failed: ${extracted.parseError}`
        : "Gemini authoritative OM extraction returned no structured OM analysis.";
      await ingestionRunRepo.update(run.id, {
        status: "failed",
        extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
        pageCount: null,
        financialPageCount: null,
        ocrPageCount: null,
        coverage: null,
        lastError: error,
        completedAt: new Date().toISOString(),
      });
      return {
        documentsProcessed: preparedDocuments.length,
        documentsSkippedNoFile: skippedNoFile,
        runId,
        snapshotId: null,
        dossierGenerated: false,
        error,
      };
    }

    const sanitizedRentRoll = sanitizeOmRentRollRows(extracted.omAnalysis.rentRoll ?? []);
    const sanitizedExpenseRows = sanitizeExpenseTableRows(
      (extracted.omAnalysis.expenses as { expensesTable?: Array<{ lineItem?: unknown; amount?: unknown }> } | null)
        ?.expensesTable
    );
    const sanitizedExpenses =
      sanitizedExpenseRows.length > 0 ||
      toFiniteNumber(extracted.omAnalysis.expenses?.totalExpenses) != null
        ? {
            ...(isPlainObject(extracted.omAnalysis.expenses) ? extracted.omAnalysis.expenses : {}),
            expensesTable: sanitizedExpenseRows.length > 0 ? sanitizedExpenseRows : undefined,
            totalExpenses: toFiniteNumber(extracted.omAnalysis.expenses?.totalExpenses) ?? undefined,
          }
        : null;
    const sanitizedOmAnalysis: OmAnalysis = {
      ...extracted.omAnalysis,
      rentRoll: sanitizedRentRoll.length > 0 ? sanitizedRentRoll : undefined,
      expenses: sanitizedExpenses ?? undefined,
    };

    const currentFinancials = toAuthoritativeCurrentFinancials(
      resolveCurrentFinancialsFromOmAnalysis(sanitizedOmAnalysis, extracted.fromLlm ?? null)
    );
    const completedAt = new Date().toISOString();
    const snapshotCoverage = buildCoverage({
      propertyInfo: sanitizedOmAnalysis.propertyInfo ?? null,
      rentRoll: sanitizedOmAnalysis.rentRoll ?? null,
      incomeStatement: sanitizedOmAnalysis.income ?? null,
      expenses: sanitizedOmAnalysis.expenses ?? null,
      revenueComposition: sanitizedOmAnalysis.revenueComposition ?? null,
      currentFinancials,
      coverage: {
        ...(((sanitizedOmAnalysis.sourceCoverage as OmCoverage | null | undefined) ?? {})),
      },
    });
    const snapshotBase: OmAuthoritativeSnapshot = {
      runId: run.id,
      sourceDocumentId: candidateDocuments[0]?.id ?? null,
      extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
      propertyInfo: sanitizedOmAnalysis.propertyInfo ?? null,
      rentRoll: sanitizedOmAnalysis.rentRoll ?? null,
      incomeStatement: sanitizedOmAnalysis.income ?? null,
      expenses: sanitizedOmAnalysis.expenses ?? null,
      revenueComposition: sanitizedOmAnalysis.revenueComposition ?? null,
      currentFinancials,
      coverage: snapshotCoverage,
      validationFlags: [],
      investmentTakeaways: sanitizedOmAnalysis.investmentTakeaways ?? null,
      reportedDiscrepancies: sanitizedOmAnalysis.reportedDiscrepancies ?? null,
      sourceMeta: {
        sourceType: params.sourceType,
        documents: candidateDocumentSourceMeta,
        parser: sourceMeta.parser,
      },
      promotedAt: completedAt,
    };
    const snapshot: OmAuthoritativeSnapshot = {
      ...snapshotBase,
      validationFlags: buildMissingDataFlags(snapshotBase),
    };

    await insertExtractedSnapshot(pool, {
      runId: run.id,
      propertyId: params.propertyId,
      extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
      snapshot,
    });
    const promoted = await authoritativeRepo.promote({
      propertyId: params.propertyId,
      runId: run.id,
      sourceDocumentId: candidateDocuments[0]?.id ?? null,
      snapshotVersion: 2,
      snapshot,
    });

    const mergedDetails = mergePropertyOmDetails(
      property.details as PropertyDetails | null,
      snapshot,
      sanitizedOmAnalysis,
      extracted.fromLlm ?? null,
      promoted.id,
      run.id,
      completedAt
    );
    await propertyRepo.mergeDetails(params.propertyId, mergedDetails);
    await ingestionRunRepo.update(run.id, {
      status: "promoted",
      extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
      pageCount: null,
      financialPageCount: null,
      ocrPageCount: null,
      coverage: snapshot.coverage ?? null,
      completedAt,
      promotedAt: completedAt,
    });
    await syncPropertySourcingWorkflow(params.propertyId, { pool });

    let dossierGenerated = false;
    if (params.triggerDossier !== false) {
      try {
        await runGenerateDossier(params.propertyId, undefined, { sendEmail: false });
        dossierGenerated = true;
      } catch (err) {
        console.error(
          "[ingestAuthoritativeOm] dossier generation failed",
          params.propertyId,
          err instanceof Error ? err.message : err
        );
      }
    }

    return {
      documentsProcessed: preparedDocuments.length,
      documentsSkippedNoFile: skippedNoFile,
      runId,
      snapshotId: promoted.id,
      dossierGenerated,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const completedAt = new Date().toISOString();
    if (runId) {
      await ingestionRunRepo.update(runId, {
        status: "failed",
        lastError: error,
        completedAt,
      });
    } else {
      const failedRun = await ingestionRunRepo.create({
        propertyId: params.propertyId,
        sourceDocumentId: candidateDocuments[0]?.id ?? null,
        sourceType: params.sourceType,
        status: "failed",
        extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
        sourceMeta: {
          documents: candidateDocumentSourceMeta,
        },
        lastError: error,
        completedAt,
      });
      runId = failedRun.id;
    }
    return {
      documentsProcessed: 0,
      documentsSkippedNoFile: 0,
      runId,
      snapshotId: null,
      dossierGenerated: false,
      error,
    };
  }
}

export async function refreshAuthoritativeOmForProperty(
  propertyId: string,
  pool: Pool = getPool(),
  options?: RefreshAuthoritativeOmOptions
): Promise<RefreshAuthoritativeOmResult> {
  const documents = await listOmAutomationDocumentsForProperty(propertyId, pool);
  return ingestAuthoritativeOm({
    propertyId,
    sourceType: "manual_refresh",
    documents,
    pool,
    triggerDossier: options?.triggerDossier ?? false,
  });
}
