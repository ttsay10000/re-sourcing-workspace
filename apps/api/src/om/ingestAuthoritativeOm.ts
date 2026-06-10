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
  ExpenseBenchmarkRepo,
  getPool,
  InquiryDocumentRepo,
  OmAuthoritativeSnapshotRepo,
  OmExtractedSnapshotRepo,
  OmIngestionRunRepo,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import { resolveInquiryFilePath } from "../inquiry/storage.js";
import { buildExpenseBenchmarkFlags, buildingSizeBracketForUnits } from "./expenseBenchmarkFlags.js";
import { runGenerateDossier } from "../deal/runGenerateDossier.js";
import {
  type OmInputDocument,
  isGeminiNativeOmInputDocument,
} from "./omAnalysisShared.js";
import { extractOmAnalysisFromGeminiPdfOnly, resolveGeminiOmModel } from "./extractOmAnalysisFromGeminiPdfOnly.js";
import { extractOmAnalysisFromOpenAiText, resolveOpenAiOmModel } from "./extractOmAnalysisFromOpenAiText.js";
import { buildOmValidationFlags } from "./omValidationFlags.js";
import {
  type ResolvedCurrentFinancials,
  resolveCurrentFinancialsFromOmAnalysis,
} from "../rental/currentFinancials.js";
import {
  sanitizeExpenseTableRows,
  sanitizeOmRentRollRows,
} from "../rental/omAnalysisUtils.js";
import { resolveUploadedDocFilePath } from "../upload/uploadedDocStorage.js";
import { extractTextFromBuffer } from "../upload/extractTextFromUploadedFile.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import { recordDealStageChange } from "../deal/recordDealStageChange.js";
import { getPropertyDossierAssumptions } from "../deal/propertyDossierState.js";
import { resolveOmAskingPriceFromDetails } from "../deal/omAskingPrice.js";

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
  autoPromote?: boolean;
  triggerDossier?: boolean;
  /** After a promote, recompute underwriting summary + deal signals (no document regeneration) so yield numbers stay current. Ignored when triggerDossier runs a full generation. */
  refreshUnderwritingSummary?: boolean;
  pool?: Pool;
}

export interface RefreshAuthoritativeOmResult {
  documentsProcessed: number;
  documentsSkippedNoFile: number;
  runId: string | null;
  snapshotId: string | null;
  extractedSnapshotId?: string | null;
  authoritativeSnapshotId?: string | null;
  status?: "needs_review" | "promoted" | "failed";
  reviewRequired?: boolean;
  dossierGenerated: boolean;
  underwritingRefreshed?: boolean;
  error?: string;
}

export interface RefreshAuthoritativeOmOptions {
  autoPromote?: boolean;
  triggerDossier?: boolean;
  refreshUnderwritingSummary?: boolean;
}

export interface PromoteOmExtractionResult {
  ok: boolean;
  propertyId: string;
  runId: string;
  snapshotId: string | null;
  dossierGenerated: boolean;
  underwritingRefreshed?: boolean;
  error?: string;
}

export interface RejectOmExtractionResult {
  ok: boolean;
  propertyId: string;
  runId: string;
  status: "rejected";
  reason: string | null;
  error?: string;
}

const GEMINI_OM_EXTRACTION_METHOD: OmExtractionMethod = "hybrid";

/** Per-document cap on extracted spreadsheet/text characters fed to the LLM. */
const MAX_TEXT_CONTEXT_CHARS_PER_DOCUMENT = 60_000;

export interface OmParserPlan {
  provider: "gemini" | "openai";
  mode: "pdf_only" | "pdf_plus_text_context" | "text_only";
}

/**
 * PDFs/images go to Gemini via its native Files API; packages containing only
 * spreadsheet/text content go to OpenAI (OPENAI_OM_MODEL, default gpt-5.5),
 * which handles delimited table text more reliably.
 */
export function resolveOmParserPlan(params: {
  geminiNativeDocumentCount: number;
  hasTextContext: boolean;
}): OmParserPlan {
  if (params.geminiNativeDocumentCount === 0 && params.hasTextContext) {
    return { provider: "openai", mode: "text_only" };
  }
  return {
    provider: "gemini",
    mode: params.hasTextContext ? "pdf_plus_text_context" : "pdf_only",
  };
}

export const NO_OM_DOCUMENTS_ERROR =
  "No OM, brochure, rent roll, or operating statement documents are available for ingestion.";

interface ManualOmConflict {
  field: string;
  manualValue?: unknown;
  omValue?: unknown;
  severity: "info" | "warning";
  message: string;
}

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

function valuesDiffer(left: unknown, right: unknown): boolean {
  const leftNumber = toFiniteNumber(left);
  const rightNumber = toFiniteNumber(right);
  if (leftNumber != null && rightNumber != null) {
    return Math.abs(leftNumber - rightNumber) > 0.005;
  }
  if (left == null || right == null) return false;
  return String(left).trim() !== String(right).trim();
}

function buildManualOverrideReviewMetadata(params: {
  existingDetails: PropertyDetails | null;
  promotedDetails: PropertyDetails | null;
  completedAt: string;
  runId: string;
}): Record<string, unknown> | null {
  const savedAssumptions = getPropertyDossierAssumptions(params.existingDetails);
  if (!savedAssumptions) return null;

  const conflicts: ManualOmConflict[] = [];
  const preservedFields = Object.entries(savedAssumptions)
    .filter(([key, value]) => key !== "updatedAt" && value != null)
    .map(([key]) => key);

  const omAskingPrice = resolveOmAskingPriceFromDetails(params.promotedDetails);
  if (savedAssumptions.purchasePrice != null && valuesDiffer(savedAssumptions.purchasePrice, omAskingPrice)) {
    conflicts.push({
      field: "purchasePrice",
      manualValue: savedAssumptions.purchasePrice,
      omValue: omAskingPrice,
      severity: "warning",
      message: "Saved purchase price was preserved over the promoted OM asking price.",
    });
  }

  const omNoi = params.promotedDetails?.omData?.authoritative?.currentFinancials?.noi ?? null;
  if (savedAssumptions.currentNoi != null && valuesDiffer(savedAssumptions.currentNoi, omNoi)) {
    conflicts.push({
      field: "currentNoi",
      manualValue: savedAssumptions.currentNoi,
      omValue: omNoi,
      severity: "warning",
      message: "Saved current NOI override was preserved over the promoted OM NOI.",
    });
  }

  const omRentRollCount = params.promotedDetails?.omData?.authoritative?.rentRoll?.length ?? 0;
  if ((savedAssumptions.unitModelRows?.length ?? 0) > 0) {
    conflicts.push({
      field: "unitModelRows",
      manualValue: savedAssumptions.unitModelRows?.length ?? 0,
      omValue: omRentRollCount,
      severity: "info",
      message: "Saved unit-level underwriting rows were preserved; review row mapping against the promoted OM rent roll.",
    });
  }

  const omExpenseRowCount =
    params.promotedDetails?.omData?.authoritative?.expenses?.expensesTable?.length ?? 0;
  if ((savedAssumptions.expenseModelRows?.length ?? 0) > 0) {
    conflicts.push({
      field: "expenseModelRows",
      manualValue: savedAssumptions.expenseModelRows?.length ?? 0,
      omValue: omExpenseRowCount,
      severity: "info",
      message: "Saved expense underwriting rows were preserved; review them against the promoted OM expense table.",
    });
  }

  if (preservedFields.length === 0 && conflicts.length === 0) return null;
  return {
    status: conflicts.length > 0 ? "needs_review" : "preserved",
    runId: params.runId,
    createdAt: params.completedAt,
    preservedManualOverrideFields: preservedFields,
    conflictCount: conflicts.length,
    conflicts,
  };
}

export function looksLikeOmStyleFilename(filename: string | null | undefined): boolean {
  if (!filename || typeof filename !== "string") return false;
  return /(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll|t-?12|operating|expense)/i.test(filename);
}

function looksLikeFinancialModelSource(doc: OmAutomationDocument): boolean {
  if ((doc.category ?? "").toLowerCase() !== "financial model") return false;
  return /(rent|expense|noi|income|cash[ _-]?flow|underwriting|pro[ _-]?forma|financial|model)/i.test(doc.filename);
}

function scoreDocument(doc: OmAutomationDocument): number {
  const filename = doc.filename.toLowerCase();
  let score = 0;
  if (doc.origin === "uploaded_document") score += 2;
  if ((doc.category ?? "").toLowerCase() === "om") score += 12;
  if ((doc.category ?? "").toLowerCase() === "brochure") score += 10;
  if ((doc.category ?? "").toLowerCase() === "rent roll") score += 14;
  if ((doc.category ?? "").toLowerCase() === "t12 / operating summary") score += 8;
  if ((doc.category ?? "").toLowerCase() === "financial model") score += 4;
  if (filename.includes("rent roll")) score += 14;
  if (filename.includes("expense")) score += 6;
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
    rentBasis: current.rentBasis,
    assumedLongTermOccupancyPct: current.assumedLongTermOccupancyPct,
    reportedOccupancyPct: current.reportedOccupancyPct,
    reportedVacancyPct: current.reportedVacancyPct,
  };
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

function omAnalysisFromAuthoritativeSnapshot(snapshot: OmAuthoritativeSnapshot): OmAnalysis {
  const sourceMeta = isPlainObject(snapshot.sourceMeta) ? snapshot.sourceMeta : {};
  const reviewArtifacts = isPlainObject(sourceMeta.reviewArtifacts) ? sourceMeta.reviewArtifacts : {};
  if (isPlainObject(reviewArtifacts.omAnalysis)) {
    return reviewArtifacts.omAnalysis as OmAnalysis;
  }
  const expenseRows = sanitizeExpenseTableRows(snapshot.expenses?.expensesTable ?? []);
  const totalExpenses = toFiniteNumber(snapshot.expenses?.totalExpenses);
  const expenses =
    isPlainObject(snapshot.expenses) || expenseRows.length > 0 || totalExpenses != null
      ? {
          ...(isPlainObject(snapshot.expenses) ? snapshot.expenses : {}),
          expensesTable: expenseRows.length > 0 ? expenseRows : undefined,
          totalExpenses: totalExpenses ?? undefined,
        }
      : undefined;
  return {
    propertyInfo: snapshot.propertyInfo ?? undefined,
    rentRoll: snapshot.rentRoll ?? undefined,
    income: snapshot.incomeStatement ?? undefined,
    expenses,
    revenueComposition: snapshot.revenueComposition ?? undefined,
    sourceCoverage: snapshot.coverage ?? undefined,
    investmentTakeaways: Array.isArray(snapshot.investmentTakeaways)
      ? snapshot.investmentTakeaways
      : undefined,
    reportedDiscrepancies: Array.isArray(snapshot.reportedDiscrepancies)
      ? snapshot.reportedDiscrepancies
      : undefined,
  };
}

function fromLlmFromAuthoritativeSnapshot(
  snapshot: OmAuthoritativeSnapshot
): RentalFinancials["fromLlm"] {
  const sourceMeta = isPlainObject(snapshot.sourceMeta) ? snapshot.sourceMeta : {};
  const reviewArtifacts = isPlainObject(sourceMeta.reviewArtifacts) ? sourceMeta.reviewArtifacts : {};
  return isPlainObject(reviewArtifacts.fromLlm)
    ? (reviewArtifacts.fromLlm as RentalFinancials["fromLlm"])
    : null;
}

export function mergePropertyOmReviewDetails(
  details: PropertyDetails | null | undefined,
  params: {
    runId: string;
    extractedSnapshotId: string;
    completedAt: string;
  }
): { omData: NonNullable<PropertyDetails["omData"]> } {
  const existingDetails = details ?? {};
  const existingOmData = existingDetails.omData ?? {};
  return {
    omData: {
      ...existingOmData,
      latestRunId: params.runId,
      status: "needs_review",
      snapshotVersion: 2,
      lastProcessedAt: params.completedAt,
      pendingRunId: params.runId,
      pendingSnapshotId: params.extractedSnapshotId,
      pendingExtractedAt: params.completedAt,
    },
  };
}

export function mergePropertyOmDetails(
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
  const promotedDetailsForReview: PropertyDetails = {
    ...existingDetails,
    omData: {
      ...existingOmData,
      authoritative: authoritativeSnapshot,
    },
  };
  const manualOverrideReview = buildManualOverrideReviewMetadata({
    existingDetails: existingDetails as PropertyDetails,
    promotedDetails: promotedDetailsForReview,
    completedAt,
    runId,
  });

  return {
    omData: {
      ...existingOmData,
      activeRunId: runId,
      activeSnapshotId: promotedSnapshotId,
      latestRunId: runId,
      status: "promoted",
      snapshotVersion: 2,
      lastProcessedAt: completedAt,
      pendingRunId: null,
      pendingSnapshotId: null,
      pendingExtractedAt: null,
      authoritative: authoritativeSnapshot,
      ...(manualOverrideReview ? { manualOverrideReview } : {}),
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
    .filter((doc) =>
      doc.category === "OM" ||
      doc.category === "Brochure" ||
      doc.category === "Rent Roll" ||
      doc.category === "T12 / Operating Summary" ||
      looksLikeFinancialModelSource({
        id: doc.id,
        origin: "uploaded_document",
        filename: doc.filename,
        category: doc.category,
      })
    )
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

async function promoteSnapshotForProperty(params: {
  propertyId: string;
  runId: string;
  sourceDocumentId?: string | null;
  snapshot: OmAuthoritativeSnapshot;
  omAnalysis?: OmAnalysis | null;
  fromLlm?: RentalFinancials["fromLlm"];
  triggerDossier?: boolean;
  refreshUnderwritingSummary?: boolean;
  pool: Pool;
}): Promise<PromoteOmExtractionResult> {
  const {
    propertyId,
    runId,
    sourceDocumentId,
    snapshot,
    omAnalysis,
    fromLlm,
    triggerDossier,
    refreshUnderwritingSummary,
    pool,
  } = params;
  const propertyRepo = new PropertyRepo({ pool });
  const authoritativeRepo = new OmAuthoritativeSnapshotRepo({ pool });
  const ingestionRunRepo = new OmIngestionRunRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) {
    return {
      ok: false,
      propertyId,
      runId,
      snapshotId: null,
      dossierGenerated: false,
      error: `Property ${propertyId} not found.`,
    };
  }

  const completedAt = new Date().toISOString();
  const sourceMeta = isPlainObject(snapshot.sourceMeta) ? snapshot.sourceMeta : {};
  const snapshotForPromotion: OmAuthoritativeSnapshot = {
    ...snapshot,
    runId,
    sourceDocumentId: sourceDocumentId ?? snapshot.sourceDocumentId ?? null,
    promotedAt: completedAt,
    sourceMeta: {
      ...sourceMeta,
      review: {
        decision: "promoted",
        reviewedAt: completedAt,
      },
    },
  };
  const promoted = await authoritativeRepo.promote({
    propertyId,
    runId,
    sourceDocumentId: sourceDocumentId ?? snapshot.sourceDocumentId ?? null,
    snapshotVersion: 2,
    snapshot: snapshotForPromotion,
  });

  const resolvedOmAnalysis = omAnalysis ?? omAnalysisFromAuthoritativeSnapshot(snapshotForPromotion);
  const resolvedFromLlm =
    fromLlm !== undefined ? fromLlm : fromLlmFromAuthoritativeSnapshot(snapshotForPromotion);
  const mergedDetails = mergePropertyOmDetails(
    property.details as PropertyDetails | null,
    snapshotForPromotion,
    resolvedOmAnalysis,
    resolvedFromLlm ?? null,
    promoted.id,
    runId,
    completedAt
  );
  await propertyRepo.mergeDetails(propertyId, mergedDetails);
  await ingestionRunRepo.markReview(runId, {
    status: "promoted",
    decision: "promoted",
    reviewedAt: completedAt,
    completedAt,
    promotedAt: completedAt,
  });
  await syncPropertySourcingWorkflow(propertyId, { pool });

  let dossierGenerated = false;
  if (triggerDossier) {
    try {
      await runGenerateDossier(propertyId, undefined, { sendEmail: false });
      dossierGenerated = true;
    } catch (err) {
      console.error(
        "[promoteSnapshotForProperty] dossier generation failed",
        propertyId,
        err instanceof Error ? err.message : err
      );
    }
  }

  let underwritingRefreshed = dossierGenerated;
  if (!dossierGenerated && refreshUnderwritingSummary) {
    try {
      await runGenerateDossier(propertyId, undefined, { sendEmail: false, skipDocuments: true });
      underwritingRefreshed = true;
    } catch (err) {
      console.warn(
        "[promoteSnapshotForProperty] underwriting summary refresh failed",
        propertyId,
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    ok: true,
    propertyId,
    runId,
    snapshotId: promoted.id,
    dossierGenerated,
    underwritingRefreshed,
  };
}

export interface OmReviewCorrections {
  askingPrice?: number | null;
  totalUnits?: number | null;
  noi?: number | null;
  grossRentalIncome?: number | null;
  operatingExpenses?: number | null;
}

/** Apply reviewer corrections to a snapshot copy, recording each as an info flag. */
function applyReviewCorrections(
  snapshot: OmAuthoritativeSnapshot,
  corrections: OmReviewCorrections,
  note: string | null
): OmAuthoritativeSnapshot {
  const next: OmAuthoritativeSnapshot = JSON.parse(JSON.stringify(snapshot)) as OmAuthoritativeSnapshot;
  const flags: OmValidationFlag[] = Array.isArray(next.validationFlags) ? [...next.validationFlags] : [];

  const record = (field: string, before: unknown, after: number) => {
    flags.push({
      flagType: "manual_correction",
      field,
      severity: "info",
      source: "om_review",
      message: `Corrected at review: ${field} ${before ?? "—"} → ${after}${note ? ` (${note})` : ""}`,
    });
  };

  const propertyInfo = (next.propertyInfo ?? {}) as Record<string, unknown>;
  if (corrections.askingPrice != null && Number.isFinite(corrections.askingPrice)) {
    record("askingPrice", propertyInfo.askingPrice, corrections.askingPrice);
    propertyInfo.askingPrice = corrections.askingPrice;
  }
  if (corrections.totalUnits != null && Number.isFinite(corrections.totalUnits)) {
    record("totalUnits", propertyInfo.totalUnits, corrections.totalUnits);
    propertyInfo.totalUnits = corrections.totalUnits;
  }
  next.propertyInfo = propertyInfo as OmAuthoritativeSnapshot["propertyInfo"];

  const current = { ...(next.currentFinancials ?? {}) } as NonNullable<OmAuthoritativeSnapshot["currentFinancials"]>;
  if (corrections.noi != null && Number.isFinite(corrections.noi)) {
    record("noi", current.noi, corrections.noi);
    current.noi = corrections.noi;
  }
  if (corrections.grossRentalIncome != null && Number.isFinite(corrections.grossRentalIncome)) {
    record("grossRentalIncome", current.grossRentalIncome, corrections.grossRentalIncome);
    current.grossRentalIncome = corrections.grossRentalIncome;
  }
  if (corrections.operatingExpenses != null && Number.isFinite(corrections.operatingExpenses)) {
    record("operatingExpenses", current.operatingExpenses, corrections.operatingExpenses);
    current.operatingExpenses = corrections.operatingExpenses;
  }
  next.currentFinancials = current;
  next.validationFlags = flags;
  return next;
}

export async function promoteOmExtractionForProperty(params: {
  propertyId: string;
  runId: string;
  triggerDossier?: boolean;
  refreshUnderwritingSummary?: boolean;
  corrections?: OmReviewCorrections | null;
  correctionNote?: string | null;
  pool?: Pool;
}): Promise<PromoteOmExtractionResult> {
  const pool = params.pool ?? getPool();
  const ingestionRunRepo = new OmIngestionRunRepo({ pool });
  const extractedRepo = new OmExtractedSnapshotRepo({ pool });
  const run = await ingestionRunRepo.byId(params.runId);
  if (!run || run.propertyId !== params.propertyId) {
    return {
      ok: false,
      propertyId: params.propertyId,
      runId: params.runId,
      snapshotId: null,
      dossierGenerated: false,
      error: "OM review run not found for this property.",
    };
  }
  const extracted = await extractedRepo.getByRunId(params.runId);
  if (!extracted || extracted.propertyId !== params.propertyId) {
    return {
      ok: false,
      propertyId: params.propertyId,
      runId: params.runId,
      snapshotId: null,
      dossierGenerated: false,
      error: "No extracted OM snapshot is available for this review run.",
    };
  }

  const hasCorrections =
    params.corrections != null && Object.values(params.corrections).some((value) => value != null && Number.isFinite(value));
  const snapshotForPromotion = hasCorrections
    ? applyReviewCorrections(extracted.snapshot, params.corrections!, params.correctionNote?.trim() || null)
    : extracted.snapshot;

  return promoteSnapshotForProperty({
    propertyId: params.propertyId,
    runId: params.runId,
    sourceDocumentId: run.sourceDocumentId ?? extracted.snapshot.sourceDocumentId ?? null,
    snapshot: snapshotForPromotion,
    triggerDossier: params.triggerDossier ?? false,
    refreshUnderwritingSummary: params.refreshUnderwritingSummary ?? false,
    pool,
  });
}

export async function rejectOmExtractionForProperty(params: {
  propertyId: string;
  runId: string;
  reason?: string | null;
  pool?: Pool;
}): Promise<RejectOmExtractionResult> {
  const pool = params.pool ?? getPool();
  const ingestionRunRepo = new OmIngestionRunRepo({ pool });
  const propertyRepo = new PropertyRepo({ pool });
  const run = await ingestionRunRepo.byId(params.runId);
  if (!run || run.propertyId !== params.propertyId) {
    return {
      ok: false,
      propertyId: params.propertyId,
      runId: params.runId,
      status: "rejected",
      reason: params.reason ?? null,
      error: "OM review run not found for this property.",
    };
  }
  const reviewedAt = new Date().toISOString();
  const reason = typeof params.reason === "string" && params.reason.trim().length > 0
    ? params.reason.trim()
    : null;
  await ingestionRunRepo.markReview(params.runId, {
    status: "rejected",
    decision: "rejected",
    reason,
    reviewedAt,
    completedAt: reviewedAt,
    lastError: reason ? `Rejected during OM review: ${reason}` : "Rejected during OM review.",
  });

  const property = await propertyRepo.byId(params.propertyId);
  const existingOmData = (property?.details as PropertyDetails | null | undefined)?.omData ?? {};
  if (property && existingOmData.latestRunId === params.runId) {
    await propertyRepo.mergeDetails(params.propertyId, {
      omData: {
        ...existingOmData,
        status: "rejected",
        pendingRunId: null,
        pendingSnapshotId: null,
        pendingExtractedAt: null,
        lastProcessedAt: reviewedAt,
        lastRejectedRunId: params.runId,
        lastRejectedAt: reviewedAt,
        lastRejectedReason: reason,
      },
    });
  }
  await syncPropertySourcingWorkflow(params.propertyId, { pool });

  return {
    ok: true,
    propertyId: params.propertyId,
    runId: params.runId,
    status: "rejected",
    reason,
  };
}

export async function promoteReviewedOmDetailsForProperty(params: {
  propertyId: string;
  details: PropertyDetails;
  sourceDocumentId?: string | null;
  sourceType: AuthoritativeOmSourceType;
  sourceMeta?: Record<string, unknown> | null;
  /** Run full dossier generation (documents + deal signals) after promotion. */
  triggerDossier?: boolean;
  /** Recompute deal signals without re-rendering documents (skipDocuments path). */
  refreshUnderwritingSummary?: boolean;
  pool?: Pool;
}): Promise<PromoteOmExtractionResult> {
  const pool = params.pool ?? getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const ingestionRunRepo = new OmIngestionRunRepo({ pool });
  const extractedRepo = new OmExtractedSnapshotRepo({ pool });
  const property = await propertyRepo.byId(params.propertyId);
  if (!property) {
    return {
      ok: false,
      propertyId: params.propertyId,
      runId: "",
      snapshotId: null,
      dossierGenerated: false,
      error: `Property ${params.propertyId} not found.`,
    };
  }
  const sourceAuthoritative = params.details.omData?.authoritative ?? null;
  if (!sourceAuthoritative) {
    return {
      ok: false,
      propertyId: params.propertyId,
      runId: "",
      snapshotId: null,
      dossierGenerated: false,
      error: "Reviewed OM details do not include an authoritative-style snapshot.",
    };
  }
  const omAnalysis =
    params.details.rentalFinancials?.omAnalysis ??
    omAnalysisFromAuthoritativeSnapshot(sourceAuthoritative);
  const fromLlm = params.details.rentalFinancials?.fromLlm ?? null;
  const startedAt = new Date().toISOString();
  const reviewedSourceMeta = {
    ...(isPlainObject(sourceAuthoritative.sourceMeta) ? sourceAuthoritative.sourceMeta : {}),
    ...(params.sourceMeta ?? {}),
  };
  const run = await ingestionRunRepo.create({
    propertyId: params.propertyId,
    sourceDocumentId: params.sourceDocumentId ?? sourceAuthoritative.sourceDocumentId ?? null,
    sourceType: params.sourceType,
    status: "needs_review",
    extractionMethod: sourceAuthoritative.extractionMethod ?? GEMINI_OM_EXTRACTION_METHOD,
    sourceMeta: reviewedSourceMeta,
    coverage: sourceAuthoritative.coverage ?? null,
    startedAt,
    completedAt: startedAt,
  });

  const sourceSnapshotWithoutId = { ...sourceAuthoritative };
  delete sourceSnapshotWithoutId.id;
  const snapshot: OmAuthoritativeSnapshot = {
    ...sourceSnapshotWithoutId,
    runId: run.id,
    sourceDocumentId: params.sourceDocumentId ?? sourceAuthoritative.sourceDocumentId ?? null,
    extractionMethod: sourceAuthoritative.extractionMethod ?? GEMINI_OM_EXTRACTION_METHOD,
    sourceMeta: {
      ...reviewedSourceMeta,
      reviewArtifacts: {
        omAnalysis,
        fromLlm,
      },
    },
    promotedAt: null,
  };
  await extractedRepo.upsert({
    runId: run.id,
    propertyId: params.propertyId,
    extractionMethod: snapshot.extractionMethod ?? GEMINI_OM_EXTRACTION_METHOD,
    snapshot,
  });

  // OM arrival counts for the board stage on this path too (deal-analysis
  // uploads, Gmail pulls), not just ingestAuthoritativeOm runs.
  await advancePipelineOnOmArrival(params.propertyId, pool);

  return promoteSnapshotForProperty({
    propertyId: params.propertyId,
    runId: run.id,
    sourceDocumentId: params.sourceDocumentId ?? sourceAuthoritative.sourceDocumentId ?? null,
    snapshot,
    omAnalysis,
    fromLlm,
    triggerDossier: params.triggerDossier ?? false,
    refreshUnderwritingSummary: params.refreshUnderwritingSummary ?? false,
    pool,
  });
}

/** Funnel positions an arriving OM should advance past (everything before the board's "UW · Awaiting Review"). */
const PRE_OM_PIPELINE_STATUSES = new Set(["new", "screening", "interesting", "saved", "outreach", "awaiting_broker"]);

/**
 * First OM upload for a deal moves it onto the deal-progress board's
 * "Underwriting · Awaiting Review" column (status om_received) so the queue
 * and home-page review flag light up the moment the document lands. Deals
 * already further along — or rejected — are left where they are, and any
 * failure here must never block the ingestion itself.
 */
async function advancePipelineOnOmArrival(propertyId: string, pool: Pool): Promise<void> {
  try {
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) return;
    const details = isPlainObject(property.details) ? (property.details as Record<string, unknown>) : {};
    const pipeline = isPlainObject(details.pipeline) ? (details.pipeline as Record<string, unknown>) : {};
    if (pipeline.rejectedAt != null) return;
    const uiStatus = typeof pipeline.uiV2Status === "string" ? pipeline.uiV2Status : null;
    const legacyStatus = typeof pipeline.status === "string" ? pipeline.status : null;
    const current = uiStatus ?? legacyStatus;
    if (current != null && !PRE_OM_PIPELINE_STATUSES.has(current)) return;
    await propertyRepo.mergeDetails(propertyId, {
      pipeline: { ...pipeline, uiV2Status: "om_received" },
    });
    await recordDealStageChange(pool, propertyId, "om_received", { source: "om_upload" });
  } catch (err) {
    console.warn("[advancePipelineOnOmArrival]", err instanceof Error ? err.message : err);
  }
}

export async function ingestAuthoritativeOm(
  params: IngestAuthoritativeOmParams
): Promise<RefreshAuthoritativeOmResult> {
  const pool = params.pool ?? getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const ingestionRunRepo = new OmIngestionRunRepo({ pool });
  const extractedSnapshotRepo = new OmExtractedSnapshotRepo({ pool });
  const property = await propertyRepo.byId(params.propertyId);
  if (!property) {
    return {
      documentsProcessed: 0,
      documentsSkippedNoFile: 0,
      runId: null,
      snapshotId: null,
      dossierGenerated: false,
      status: "failed",
      error: `Property ${params.propertyId} not found.`,
    };
  }

  const candidateDocuments = [...params.documents]
    .filter((doc) => looksLikeOmStyleFilename(doc.filename) || looksLikeFinancialModelSource(doc) || doc.category === "OM" || doc.category === "Brochure" || doc.category === "Rent Roll" || doc.category === "T12 / Operating Summary")
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
      status: "failed",
      error: NO_OM_DOCUMENTS_ERROR,
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
      .filter((doc) => isGeminiNativeOmInputDocument(doc))
      .map((doc) => ({
        filename: doc.filename,
        mimeType: doc.mimeType ?? "application/pdf",
        buffer: doc.buffer,
      }));
    const nonPdfTextContext = (
      await Promise.all(
        preparedDocuments
          .filter((doc) => !isGeminiNativeOmInputDocument(doc))
          .map(async (doc) => {
            const text = await extractTextFromBuffer(doc.buffer, doc.filename);
            if (!text.trim()) return null;
            return [
              `Document: ${doc.filename}`,
              `Category: ${doc.category ?? "Unclassified"}`,
              `Source: ${doc.source ?? doc.origin}`,
              text.slice(0, MAX_TEXT_CONTEXT_CHARS_PER_DOCUMENT),
            ].join("\n");
          })
      )
    )
      .filter((section): section is string => Boolean(section))
      .join("\n\n---\n\n");
    const parserPlan = resolveOmParserPlan({
      geminiNativeDocumentCount: geminiDocuments.length,
      hasTextContext: nonPdfTextContext.trim().length > 0,
    });
    const parserModel = parserPlan.provider === "openai" ? resolveOpenAiOmModel() : resolveGeminiOmModel();
    const sourceMeta = {
      documents: candidateDocumentSourceMeta,
      parser: {
        provider: parserPlan.provider,
        mode: parserPlan.mode,
        model: parserModel,
        documentCount: geminiDocuments.length,
        documentFilenames: geminiDocuments.map((doc) => doc.filename),
        textContextDocumentCount: preparedDocuments.filter((doc) => !isGeminiNativeOmInputDocument(doc)).length,
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
    if (!unreadableFileError) await advancePipelineOnOmArrival(params.propertyId, pool);

    if (preparedDocuments.length === 0) {
      return {
        documentsProcessed: 0,
        documentsSkippedNoFile: skippedNoFile,
        runId,
        snapshotId: null,
        dossierGenerated: false,
        status: "failed",
        error: unreadableFileError ?? "OM ingestion could not read any document bytes from the available files.",
      };
    }
    if (geminiDocuments.length === 0 && !nonPdfTextContext) {
      const error = "Authoritative OM ingestion requires at least one readable PDF document or extractable spreadsheet/text document.";
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
        status: "failed",
        error,
      };
    }

    const propertyContext = [
      property.canonicalAddress ?? property.id,
      candidateDocumentSourceMeta.length > 0
        ? `Candidate documents:\n${candidateDocumentSourceMeta
            .map((doc) => `- ${doc.filename} (${doc.category ?? "unclassified"}, ${doc.origin})`)
            .join("\n")}`
        : null,
    ].filter(Boolean).join("\n\n");
    const extracted =
      parserPlan.provider === "openai"
        ? await extractOmAnalysisFromOpenAiText({
            textContext: nonPdfTextContext,
            propertyContext,
            model: parserModel,
          })
        : await extractOmAnalysisFromGeminiPdfOnly({
            documents: geminiDocuments,
            propertyContext,
            enrichmentContext: nonPdfTextContext || null,
            model: parserModel,
          });
    if (!extracted.omAnalysis) {
      const providerLabel = parserPlan.provider === "openai" ? `OpenAI (${parserModel})` : "Gemini";
      const error = extracted.parseError
        ? `${providerLabel} authoritative OM extraction failed: ${extracted.parseError}`
        : `${providerLabel} authoritative OM extraction returned no structured OM analysis.`;
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
        status: "failed",
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
        reviewArtifacts: {
          omAnalysis: sanitizedOmAnalysis,
          fromLlm: extracted.fromLlm ?? null,
        },
      },
      promotedAt: null,
    };
    // Benchmark comparison rides the same flag channel; failures to load
    // benchmarks must never break extraction.
    let benchmarkFlags: OmValidationFlag[] = [];
    try {
      const detailsRecord = (property.details ?? {}) as Record<string, unknown>;
      const infoRecord =
        snapshotBase.propertyInfo && typeof snapshotBase.propertyInfo === "object"
          ? (snapshotBase.propertyInfo as Record<string, unknown>)
          : {};
      const unitCountRaw = Number(infoRecord.totalUnits ?? infoRecord.unitsTotal ?? detailsRecord.unitCount);
      const rentRollCount = Array.isArray(snapshotBase.rentRoll) ? snapshotBase.rentRoll.length : 0;
      const unitCount =
        Number.isFinite(unitCountRaw) && unitCountRaw > 0
          ? Math.round(unitCountRaw)
          : rentRollCount > 0
            ? rentRollCount
            : null;
      const egiRaw = Number(
        currentFinancials?.effectiveGrossIncome ?? currentFinancials?.grossRentalIncome
      );
      const assessedRaw = Number(detailsRecord.assessedTaxBeforeTotal);
      const benchmarkRepo = new ExpenseBenchmarkRepo({ pool });
      const benchmarks = await benchmarkRepo.listFor({
        geography: "nyc",
        buildingSizeBracket: buildingSizeBracketForUnits(unitCount),
      });
      benchmarkFlags = buildExpenseBenchmarkFlags({
        snapshot: snapshotBase,
        unitCount,
        egiAnnual: Number.isFinite(egiRaw) && egiRaw > 0 ? egiRaw : null,
        benchmarks,
        assessedTaxableValue: Number.isFinite(assessedRaw) && assessedRaw > 0 ? assessedRaw : null,
        taxCode: typeof detailsRecord.taxCode === "string" ? detailsRecord.taxCode : null,
      });
    } catch (err) {
      console.warn(
        "[ingestAuthoritativeOm] expense benchmark flags failed:",
        err instanceof Error ? err.message : err
      );
    }
    const snapshot: OmAuthoritativeSnapshot = {
      ...snapshotBase,
      validationFlags: [
        ...buildOmValidationFlags({
          snapshot: snapshotBase,
          omAnalysis: sanitizedOmAnalysis,
          rawRentRoll: extracted.omAnalysis.rentRoll ?? null,
        }),
        ...benchmarkFlags,
      ],
    };

    const extractedSnapshot = await extractedSnapshotRepo.upsert({
      runId: run.id,
      propertyId: params.propertyId,
      extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
      snapshot,
    });
    if (params.autoPromote) {
      const promoted = await promoteSnapshotForProperty({
        propertyId: params.propertyId,
        runId: run.id,
        sourceDocumentId: candidateDocuments[0]?.id ?? null,
        snapshot,
        omAnalysis: sanitizedOmAnalysis,
        fromLlm: extracted.fromLlm ?? null,
        triggerDossier: params.triggerDossier !== false,
        refreshUnderwritingSummary: params.refreshUnderwritingSummary === true,
        pool,
      });
      return {
        documentsProcessed: preparedDocuments.length,
        documentsSkippedNoFile: skippedNoFile,
        runId,
        snapshotId: promoted.snapshotId,
        extractedSnapshotId: extractedSnapshot.id,
        authoritativeSnapshotId: promoted.snapshotId,
        status: promoted.ok ? "promoted" : "failed",
        reviewRequired: false,
        dossierGenerated: promoted.dossierGenerated,
        underwritingRefreshed: promoted.underwritingRefreshed === true,
        error: promoted.error,
      };
    }

    await propertyRepo.mergeDetails(
      params.propertyId,
      mergePropertyOmReviewDetails(property.details as PropertyDetails | null, {
        runId: run.id,
        extractedSnapshotId: extractedSnapshot.id,
        completedAt,
      })
    );
    await ingestionRunRepo.update(run.id, {
      status: "needs_review",
      extractionMethod: GEMINI_OM_EXTRACTION_METHOD,
      pageCount: null,
      financialPageCount: null,
      ocrPageCount: null,
      coverage: snapshot.coverage ?? null,
      completedAt,
    });
    await ingestionRunRepo.markReview(run.id, {
      status: "needs_review",
      decision: "needs_review",
      reviewedAt: completedAt,
      completedAt,
    });
    await syncPropertySourcingWorkflow(params.propertyId, { pool });

    return {
      documentsProcessed: preparedDocuments.length,
      documentsSkippedNoFile: skippedNoFile,
      runId,
      snapshotId: null,
      extractedSnapshotId: extractedSnapshot.id,
      authoritativeSnapshotId: null,
      status: "needs_review",
      reviewRequired: true,
      dossierGenerated: false,
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
      status: "failed",
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
    autoPromote: options?.autoPromote ?? false,
    triggerDossier: options?.triggerDossier ?? false,
    refreshUnderwritingSummary: options?.refreshUnderwritingSummary ?? false,
  });
}
