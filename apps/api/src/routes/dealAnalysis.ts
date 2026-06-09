import { Router, type Request, type Response } from "express";
import multer from "multer";
import type {
  Property,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
  PropertyDetails,
  PropertyDocumentCategory,
  PropertyManualSourceLinks,
} from "@re-sourcing/contracts";
import { randomUUID } from "crypto";
import {
  getPool,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import { saveUploadedDocument } from "../upload/uploadedDocStorage.js";
import {
  buildStandaloneDossierPdf,
  buildStandaloneOmCalculation,
  buildStandaloneUnderwritingContext,
  resolveStandalonePropertyInput,
} from "../deal/standaloneDealAnalysis.js";
import { resolveOmPropertyAddress } from "../om/resolveOmPropertyAddress.js";
import {
  parsePropertyDealDossierExpenseModelRows,
  parsePropertyDealDossierUnitModelRows,
  getPropertyDossierAssumptions,
  getRawPropertyDossierAssumptions,
} from "../deal/propertyDossierState.js";
import type { DossierAssumptionOverrides } from "../deal/underwritingModel.js";
import { resolveOmAskingPriceFromDetails } from "../deal/omAskingPrice.js";
import { getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import { buildDealAnalysisWorkbook } from "../deal/dealAnalysisWorkbook.js";
import { promoteReviewedOmDetailsForProperty } from "../om/ingestAuthoritativeOm.js";
import {
  analyzeAndPersistDealAnalysisOmDocuments,
  DealAnalysisOmImportError,
  findOrCreateDealAnalysisDraftProperty,
  type DealAnalysisDraftPropertyMatchStrategy,
  type DealAnalysisDraftPropertyRepo,
} from "../deal/dealAnalysisOmImport.js";
import {
  downloadOmDocument,
  formatByteLimit,
  isPdfLikeDownloadedDocument,
  resolveOmImportMaxBytes,
} from "../upload/downloadOmDocument.js";

const router = Router();
const OM_IMPORT_MAX_BYTES = resolveOmImportMaxBytes();
const OM_IMPORT_MAX_LABEL = formatByteLimit(OM_IMPORT_MAX_BYTES);
const DEAL_ANALYSIS_MAX_FILES = 10;
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: OM_IMPORT_MAX_BYTES, files: DEAL_ANALYSIS_MAX_FILES },
});

const DOSSIER_ASSUMPTION_NON_NEGATIVE_NUMERIC_FIELDS = [
  "buildingSqft",
  "purchasePrice",
  "purchaseClosingCostPct",
  "renovationCosts",
  "furnishingSetupCosts",
  "ltvPct",
  "interestRatePct",
  "amortizationYears",
  "loanFeePct",
  "rentUpliftPct",
  "expenseIncreasePct",
  "managementFeePct",
  "occupancyTaxPct",
  "vacancyPct",
  "leadTimeMonths",
  "annualRentGrowthPct",
  "annualCommercialRentGrowthPct",
  "annualOtherIncomeGrowthPct",
  "annualExpenseGrowthPct",
  "annualPropertyTaxGrowthPct",
  "recurringCapexAnnual",
  "holdPeriodYears",
  "exitCapPct",
  "exitClosingCostPct",
  "targetIrrPct",
] as const satisfies ReadonlyArray<keyof DossierAssumptionOverrides>;

const DOSSIER_ASSUMPTION_SIGNED_NUMERIC_FIELDS = [
  "currentNoi",
] as const satisfies ReadonlyArray<keyof DossierAssumptionOverrides>;

const DOSSIER_ASSUMPTION_NUMERIC_FIELDS = [
  ...DOSSIER_ASSUMPTION_NON_NEGATIVE_NUMERIC_FIELDS,
  ...DOSSIER_ASSUMPTION_SIGNED_NUMERIC_FIELDS,
] as const satisfies ReadonlyArray<keyof DossierAssumptionOverrides>;

function handleUploadMulterError(_req: Request, res: Response, next: (err?: unknown) => void) {
  return (err: unknown) => {
    if (err && typeof err === "object" && "code" in err) {
      const code = String((err as { code?: string }).code ?? "");
      if (code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "File too large.",
          details: `Max ${OM_IMPORT_MAX_LABEL} per OM / broker financial file.`,
          maxBytes: OM_IMPORT_MAX_BYTES,
        });
        return;
      }
      if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
        res.status(413).json({
          error: "Too many files.",
          details: `Upload up to ${DEAL_ANALYSIS_MAX_FILES} OM / broker financial files at a time.`,
          maxFiles: DEAL_ANALYSIS_MAX_FILES,
        });
        return;
      }
    }
    next(err);
  };
}

function isPdfUpload(file: Express.Multer.File): boolean {
  const mimeType = file.mimetype?.toLowerCase() ?? "";
  if (mimeType.includes("pdf")) return true;
  return /\.pdf$/i.test(file.originalname ?? "");
}

function dealAnalysisUploadExtension(file: Express.Multer.File): string {
  const filename = file.originalname ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function isSupportedDealAnalysisUpload(file: Express.Multer.File): boolean {
  if (isPdfUpload(file)) return true;
  const extension = dealAnalysisUploadExtension(file);
  if (["xls", "xlsx", "xlsm", "csv", "txt", "text"].includes(extension)) return true;
  if (["png", "jpg", "jpeg", "webp", "heic", "heif", "gif"].includes(extension)) return true;
  const mimeType = file.mimetype?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) return true;
  return (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("csv") ||
    mimeType === "text/plain" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.ms-excel.sheet.macroenabled.12"
  );
}

function dealAnalysisUploadMimeType(file: Express.Multer.File): string {
  if (file.mimetype) return file.mimetype;
  const extension = dealAnalysisUploadExtension(file);
  if (extension === "pdf") return "application/pdf";
  if (extension === "csv") return "text/csv";
  if (extension === "txt" || extension === "text") return "text/plain";
  if (extension === "xls") return "application/vnd.ms-excel";
  if (extension === "xlsm") return "application/vnd.ms-excel.sheet.macroenabled.12";
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function dealAnalysisUploadFilename(file: Express.Multer.File): string {
  const originalName = file.originalname?.trim();
  if (originalName) return originalName;
  const extension = dealAnalysisUploadExtension(file);
  return extension ? `uploaded-om-source.${extension}` : "uploaded-om-source";
}

function dealAnalysisUploadCategory(file: Express.Multer.File): PropertyDocumentCategory {
  const haystack = `${file.originalname ?? ""} ${file.mimetype ?? ""}`.toLowerCase();
  if (/\b(rent[ _-]?roll|unit[ _-]?mix|tenant[ _-]?schedule)\b/i.test(haystack)) return "Rent Roll";
  if (/\b(t-?12|trailing[ _-]?12|operating|income[ _-]?expense|p\s*&\s*l|profit[ _-]?loss)\b/i.test(haystack)) {
    return "T12 / Operating Summary";
  }
  if (/\b(financial|model|pro[ _-]?forma|underwriting|workbook|analysis)\b/i.test(haystack)) return "Financial Model";
  if (/\b(brochure|flyer|teaser|marketing)\b/i.test(haystack)) return "Brochure";
  if (isPdfUpload(file) || /\b(offering|memorandum|(^|[^a-z])om([^a-z]|$))\b/i.test(haystack)) return "OM";
  return "Other";
}

function optionalTrimmedText(value: unknown, maxLength = 20_000): string | null | "invalid" {
  if (value == null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : "invalid";
}

function optionalNonNegativeNumber(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : "invalid";
  }
  if (typeof value !== "string") return "invalid";
  const trimmed = value.replace(/[$,%\s,]/g, "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : "invalid";
}

function optionalNumber(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "invalid";
  }
  if (typeof value !== "string") return "invalid";
  const trimmed = value.replace(/[$,%\s,]/g, "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

function optionalDateString(value: unknown): string | null | "invalid" {
  const parsed = optionalTrimmedText(value, 40);
  if (parsed == null || parsed === "invalid") return parsed;
  return /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : "invalid";
}

function parseDossierAssumptionOverridesPayload(
  raw: unknown
): DossierAssumptionOverrides | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const record = raw as Record<string, unknown>;
  const overrides: DossierAssumptionOverrides = {};
  for (const key of DOSSIER_ASSUMPTION_NON_NEGATIVE_NUMERIC_FIELDS) {
    const parsed = optionalNonNegativeNumber(record[key]);
    if (parsed === "invalid") return "invalid";
    overrides[key] = parsed;
  }
  for (const key of DOSSIER_ASSUMPTION_SIGNED_NUMERIC_FIELDS) {
    const parsed = optionalNumber(record[key]);
    if (parsed === "invalid") return "invalid";
    overrides[key] = parsed;
  }
  const investmentProfile = optionalTrimmedText(record.investmentProfile, 200);
  const targetAcquisitionDate = optionalDateString(record.targetAcquisitionDate);
  if (investmentProfile === "invalid" || targetAcquisitionDate === "invalid") return "invalid";
  overrides.investmentProfile = investmentProfile;
  overrides.targetAcquisitionDate = targetAcquisitionDate;
  return overrides;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value != null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return "invalid";
  try {
    const parsed = JSON.parse(value);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : "invalid";
  } catch {
    return "invalid";
  }
}

function parseJsonArray(value: unknown): unknown[] | null | "invalid" {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return "invalid";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : "invalid";
  } catch {
    return "invalid";
  }
}

function parsePropertyDetailsPayload(raw: unknown): PropertyDetails | null | "invalid" {
  const parsed = parseJsonRecord(raw);
  if (parsed === "invalid") return "invalid";
  return (parsed ?? null) as PropertyDetails | null;
}

function readManualSourceLinks(details: PropertyDetails | null | undefined): PropertyManualSourceLinks {
  const raw = details?.manualSourceLinks;
  return raw && typeof raw === "object" ? (raw as PropertyManualSourceLinks) : {};
}

function mergeManualSourceLinks(
  details: PropertyDetails | null | undefined,
  patch: Partial<PropertyManualSourceLinks>
): PropertyManualSourceLinks {
  return {
    ...readManualSourceLinks(details),
    ...patch,
  };
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOmUrl(value: unknown): string | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "invalid";
  } catch {
    return "invalid";
  }
}

function sendDealAnalysisOmImportError(res: Response, fallbackError: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DealAnalysisOmImportError) {
    res.status(err.statusCode).json({ error: fallbackError, details: message });
    return;
  }
  const statusCode =
    /too large|max \d+ mb/i.test(message) ? 413 :
    /valid http|requires a PDF|not a PDF|returned HTML|empty file|usable building address|parse/i.test(message) ? 422 :
    503;
  res.status(statusCode).json({ error: fallbackError, details: message });
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

interface LatestUploadedWorkspaceDocument {
  propertyId: string;
  fileName: string | null;
  category: string | null;
  createdAt: string | null;
}

function readDealAnalysisWorkspaceUpdatedAt(details: PropertyDetails | null | undefined): string | null {
  const workspace = details?.dealAnalysisWorkspace;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return null;
  const record = workspace as Record<string, unknown>;
  return trimmedString(record.updatedAt) ?? trimmedString(record.lastUploadedAt);
}

function resolveWorkspaceProperty(details: PropertyDetails | null | undefined) {
  const omAnalysis = details?.rentalFinancials?.omAnalysis ?? null;
  return resolveStandalonePropertyInput({
    omAnalysis,
    details: details ?? null,
  });
}

export { findOrCreateDealAnalysisDraftProperty };
export type { DealAnalysisDraftPropertyMatchStrategy, DealAnalysisDraftPropertyRepo };

function assumptionPatchFromPayload(params: {
  assumptionOverrides: DossierAssumptionOverrides | null;
  brokerEmailNotes: string | null;
  unitModelRows: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows: PropertyDealDossierExpenseModelRow[] | null;
  defaultPurchasePrice?: number | null;
}): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  for (const key of DOSSIER_ASSUMPTION_NUMERIC_FIELDS) {
    patch[key] = params.assumptionOverrides?.[key] ?? null;
  }
  if (patch.purchasePrice == null && params.defaultPurchasePrice != null) {
    patch.purchasePrice = params.defaultPurchasePrice;
  }
  patch.investmentProfile = params.assumptionOverrides?.investmentProfile ?? null;
  patch.targetAcquisitionDate = params.assumptionOverrides?.targetAcquisitionDate ?? null;
  patch.brokerEmailNotes = params.brokerEmailNotes;
  patch.unitModelRows = params.unitModelRows;
  patch.expenseModelRows = params.expenseModelRows;
  const hasMeaningfulValue = Object.entries(patch).some(([key, value]) => {
    if (key === "updatedAt") return false;
    if (Array.isArray(value)) return value.length > 0;
    return value != null;
  });
  return hasMeaningfulValue ? patch : null;
}

function mergeAssumptionsPatch(
  details: PropertyDetails | null | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(getRawPropertyDossierAssumptions(details) ?? {}),
    ...(getPropertyDossierAssumptions(details) ?? {}),
    ...patch,
  };
}

router.get("/deal-analysis/workspaces", async (req: Request, res: Response) => {
  try {
    const limit = parsePositiveInteger(req.query.limit, 48, 100);
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const [recentProperties, latestUploadedDocRows] = await Promise.all([
      propertyRepo.list({ limit: Math.max(limit * 8, 120) }),
      pool.query<{
        property_id: string;
        filename: string | null;
        category: string | null;
        created_at: string | null;
      }>(
        `WITH latest_docs AS (
           SELECT DISTINCT ON (u.property_id)
             u.property_id::text AS property_id,
             u.filename,
             u.category,
             u.created_at::text AS created_at
           FROM property_uploaded_documents u
           WHERE u.category IN ('OM', 'Brochure', 'Rent Roll', 'Financial Model', 'T12 / Operating Summary')
           ORDER BY u.property_id, u.created_at DESC
         )
         SELECT property_id, filename, category, created_at
         FROM latest_docs
         ORDER BY created_at DESC
         LIMIT 250`
      ),
    ]);
    const latestUploadedDocs = latestUploadedDocRows.rows.reduce<Map<string, LatestUploadedWorkspaceDocument>>(
      (acc, row) => {
        acc.set(row.property_id, {
          propertyId: row.property_id,
          fileName: trimmedString(row.filename),
          category: trimmedString(row.category),
          createdAt: trimmedString(row.created_at),
        });
        return acc;
      },
      new Map()
    );
    const propertiesById = new Map<string, Property>();
    for (const property of recentProperties) {
      propertiesById.set(property.id, property);
    }
    const uploadedOnlyPropertyIds = Array.from(latestUploadedDocs.keys()).filter(
      (propertyId) => !propertiesById.has(propertyId)
    );
    if (uploadedOnlyPropertyIds.length > 0) {
      const uploadedOnlyProperties = await Promise.all(
        uploadedOnlyPropertyIds.map((propertyId) => propertyRepo.byId(propertyId))
      );
      for (const property of uploadedOnlyProperties) {
        if (property) propertiesById.set(property.id, property);
      }
    }
    const properties = Array.from(propertiesById.values());
    const workspaces = properties
      .flatMap((property) => {
        const details = (property.details ?? null) as PropertyDetails | null;
        const savedAssumptions = getPropertyDossierAssumptions(details);
        const manualSourceLinks = readManualSourceLinks(details);
        const omImportedAt = trimmedString(manualSourceLinks.omImportedAt);
        const assumptionsUpdatedAt = trimmedString(savedAssumptions?.updatedAt);
        const workspaceUpdatedAt = readDealAnalysisWorkspaceUpdatedAt(details);
        const uploadedOmDocument = latestUploadedDocs.get(property.id) ?? null;
        const uploadedOmAt = uploadedOmDocument?.createdAt ?? null;
        const hasSavedWorkspace =
          uploadedOmAt != null ||
          omImportedAt != null ||
          assumptionsUpdatedAt != null ||
          workspaceUpdatedAt != null ||
          savedAssumptions != null ||
          details?.omData?.authoritative != null;
        if (!hasSavedWorkspace) return [];
        const sortTimestamp =
          [assumptionsUpdatedAt, workspaceUpdatedAt, omImportedAt, uploadedOmAt, trimmedString(property.updatedAt)].find(
            (value) => value != null
          ) ?? property.updatedAt;
        return [
          {
            propertyId: property.id,
            canonicalAddress: property.canonicalAddress,
            updatedAt: property.updatedAt,
            omImportedAt,
            assumptionsUpdatedAt,
            workspaceUpdatedAt,
            uploadedOmAt,
            uploadedOmFileName: uploadedOmDocument?.fileName ?? null,
            uploadedOmCategory: uploadedOmDocument?.category ?? null,
            omFileName: trimmedString(manualSourceLinks.omFileName) ?? uploadedOmDocument?.fileName ?? null,
            hasAuthoritativeOm: details?.omData?.authoritative != null,
            unitModelRowCount: savedAssumptions?.unitModelRows?.length ?? 0,
            expenseModelRowCount: savedAssumptions?.expenseModelRows?.length ?? 0,
            hasBrokerEmailNotes: trimmedString(savedAssumptions?.brokerEmailNotes) != null,
            dossierStatus:
              typeof details?.dealDossier?.generation?.status === "string"
                ? details.dealDossier.generation.status
                : null,
            sortTimestamp,
          },
        ];
      })
      .sort((left, right) => right.sortTimestamp.localeCompare(left.sortTimestamp))
      .slice(0, limit)
      .map(({ sortTimestamp: _sortTimestamp, ...workspace }) => workspace);

    res.json({ workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deal-analysis workspaces]", err);
    res.status(503).json({
      error: "Failed to load saved OM workspaces.",
      details: message,
    });
  }
});

router.post(
  "/deal-analysis/analyze-upload",
  (req, res, next) => {
    uploadMemory.array("files", DEAL_ANALYSIS_MAX_FILES)(
      req,
      res,
      handleUploadMulterError(req, res, next)
    );
  },
  async (req: Request, res: Response) => {
    try {
      const files = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).filter(
        (file) => file.buffer && file.buffer.length > 0
      );
      if (files.length === 0) {
        res.status(400).json({
          error: "Missing files. Send multipart/form-data with one or more 'files' fields.",
        });
        return;
      }
      const unsupportedFile = files.find((file) => !isSupportedDealAnalysisUpload(file));
      if (unsupportedFile) {
        res.status(422).json({
          error: `Unsupported OM / broker financial file. '${unsupportedFile.originalname}' must be a PDF, Excel workbook, CSV, text file, or image/screenshot.`,
        });
        return;
      }

      const result = await analyzeAndPersistDealAnalysisOmDocuments({
        documents: files.map((file) => ({
          filename: dealAnalysisUploadFilename(file),
          mimeType: dealAnalysisUploadMimeType(file),
          buffer: file.buffer,
          sizeBytes: file.size,
        })),
        sourceType: "deal_analysis_upload",
        sourceLabel: "Deal analysis upload",
        sourceMetadata: {
          sourceType: "deal_analysis_upload",
        },
      });
      res.status(result.createdProperty ? 201 : 200).json(result);
    } catch (err) {
      console.error("[deal-analysis analyze-upload]", err);
      sendDealAnalysisOmImportError(res, "Failed to analyze OM upload.", err);
    }
  }
);

router.post("/deal-analysis/analyze-notes", async (req: Request, res: Response) => {
  const rawNotes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  const addressHint = typeof req.body?.addressHint === "string" ? req.body.addressHint.trim() : "";
  if (rawNotes.length < 20) {
    res.status(400).json({
      error: "notes is required - paste the broker's rent/expense details (at least 20 characters).",
    });
    return;
  }
  if (rawNotes.length > 20_000) {
    res.status(413).json({ error: "notes is too long (20,000 character max)." });
    return;
  }

  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const noteBody = addressHint ? `Property address: ${addressHint}\n\n${rawNotes}` : rawNotes;
    const buffer = Buffer.from(noteBody, "utf-8");
    const result = await analyzeAndPersistDealAnalysisOmDocuments({
      documents: [
        {
          filename: `broker-notes-${stamp}.txt`,
          mimeType: "text/plain",
          buffer,
          sizeBytes: buffer.length,
        },
      ],
      sourceType: "deal_analysis_upload",
      sourceLabel: "Broker notes",
      propertyContext: [
        "Source: broker notes pasted by the operator (text message / call notes / email snippet).",
        addressHint ? `Operator-provided address hint: ${addressHint}` : null,
        "Treat stated rents, unit details, and expenses as broker-reported current figures.",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      sourceMetadata: {
        sourceType: "deal_analysis_upload",
        intakeKind: "broker_notes",
        addressHint: addressHint || null,
      },
    });
    res.status(result.createdProperty ? 201 : 200).json(result);
  } catch (err) {
    console.error("[deal-analysis analyze-notes]", err);
    sendDealAnalysisOmImportError(res, "Failed to analyze broker notes.", err);
  }
});

router.post("/deal-analysis/analyze-link", async (req: Request, res: Response) => {
  const omUrl = normalizeOmUrl(req.body?.omUrl ?? req.body?.url);
  if (omUrl == null) {
    res.status(400).json({ error: "omUrl is required." });
    return;
  }
  if (omUrl === "invalid") {
    res.status(400).json({ error: "omUrl must be a valid http(s) URL." });
    return;
  }

  try {
    const downloaded = await downloadOmDocument(omUrl, { maxBytes: OM_IMPORT_MAX_BYTES });
    if (
      !isPdfLikeDownloadedDocument({
        contentType: downloaded.contentType,
        filename: downloaded.filename,
      })
    ) {
      res.status(422).json({
        error: "OM link must point to a PDF document.",
      });
      return;
    }

    const result = await analyzeAndPersistDealAnalysisOmDocuments({
      documents: [
        {
          filename: downloaded.filename,
          mimeType: downloaded.contentType ?? "application/pdf",
          buffer: downloaded.buffer,
          sizeBytes: downloaded.buffer.length,
        },
      ],
      sourceType: "deal_analysis_om_link",
      sourceLabel: "Deal analysis OM link",
      propertyContext: `OM URL: ${downloaded.resolvedUrl}\nDownloaded file: ${downloaded.filename}`,
      sourceMetadata: {
        sourceType: "deal_analysis_om_link",
        omUrl: downloaded.resolvedUrl,
        requestedOmUrl: omUrl,
      },
    });
    res.status(result.createdProperty ? 201 : 200).json(result);
  } catch (err) {
    console.error("[deal-analysis analyze-link]", err);
    sendDealAnalysisOmImportError(res, "Failed to analyze OM link.", err);
  }
});

router.post("/deal-analysis/recalculate", async (req: Request, res: Response) => {
  try {
    const details = parsePropertyDetailsPayload(req.body?.details);
    const assumptionOverrides = parseDossierAssumptionOverridesPayload(req.body?.assumptions);
    const brokerEmailNotes = optionalTrimmedText(req.body?.brokerEmailNotes);
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (details === "invalid") {
      res.status(400).json({ error: "details must be a valid object." });
      return;
    }
    if (assumptionOverrides === "invalid") {
      res.status(400).json({
        error:
          "assumptions must be an object containing valid numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
      });
      return;
    }
    if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
      res.status(400).json({
        error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
      });
      return;
    }
    if (brokerEmailNotes === "invalid") {
      res.status(400).json({
        error: "brokerEmailNotes must be a string under 20,000 characters.",
      });
      return;
    }
    const property = resolveWorkspaceProperty(details);
    const calculation = (
      await buildStandaloneOmCalculation({
        property,
        details,
        assumptionOverrides,
        brokerEmailNotes,
        unitModelRows,
        expenseModelRows,
      })
    ).calculation;
    res.json({ ok: true, property, calculation });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deal-analysis recalculate]", err);
    res.status(503).json({ error: "Failed to recalculate OM analysis.", details: message });
  }
});

router.post("/deal-analysis/generate-dossier", async (req: Request, res: Response) => {
  try {
    const details = parsePropertyDetailsPayload(req.body?.details);
    const assumptionOverrides = parseDossierAssumptionOverridesPayload(req.body?.assumptions);
    const brokerEmailNotes = optionalTrimmedText(req.body?.brokerEmailNotes);
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (details === "invalid") {
      res.status(400).json({ error: "details must be a valid object." });
      return;
    }
    if (assumptionOverrides === "invalid") {
      res.status(400).json({
        error:
          "assumptions must be an object containing valid numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
      });
      return;
    }
    if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
      res.status(400).json({
        error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
      });
      return;
    }
    if (brokerEmailNotes === "invalid") {
      res.status(400).json({
        error: "brokerEmailNotes must be a string under 20,000 characters.",
      });
      return;
    }
    const property = resolveWorkspaceProperty(details);
    const dossier = await buildStandaloneDossierPdf({
      property,
      details,
      assumptionOverrides,
      brokerEmailNotes,
      unitModelRows,
      expenseModelRows,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${dossier.fileName}"`);
    res.send(dossier.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deal-analysis generate-dossier]", err);
    res.status(503).json({ error: "Failed to generate deal dossier PDF.", details: message });
  }
});

router.post("/deal-analysis/generate-dossier-excel", async (req: Request, res: Response) => {
  try {
    const details = parsePropertyDetailsPayload(req.body?.details);
    const assumptionOverrides = parseDossierAssumptionOverridesPayload(req.body?.assumptions);
    const brokerEmailNotes = optionalTrimmedText(req.body?.brokerEmailNotes);
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (details === "invalid") {
      res.status(400).json({ error: "details must be a valid object." });
      return;
    }
    if (assumptionOverrides === "invalid") {
      res.status(400).json({
        error:
          "assumptions must be an object containing valid numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
      });
      return;
    }
    if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
      res.status(400).json({
        error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
      });
      return;
    }
    if (brokerEmailNotes === "invalid") {
      res.status(400).json({
        error: "brokerEmailNotes must be a string under 20,000 characters.",
      });
      return;
    }

    const property = resolveWorkspaceProperty(details);
    const { ctx } = await buildStandaloneUnderwritingContext({
      property,
      details,
      assumptionOverrides,
      brokerEmailNotes,
      unitModelRows,
      expenseModelRows,
    });
    const workbook = await buildDealAnalysisWorkbook(ctx);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${workbook.fileName}"`);
    res.send(workbook.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deal-analysis generate-dossier-excel]", err);
    res.status(503).json({ error: "Failed to generate deal dossier Excel.", details: message });
  }
});

router.post(
  "/deal-analysis/create-property",
  (req, res, next) => {
    uploadMemory.array("files", DEAL_ANALYSIS_MAX_FILES)(
      req,
      res,
      handleUploadMulterError(req, res, next)
    );
  },
  async (req: Request, res: Response) => {
    try {
      const files = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).filter(
        (file) => file.buffer && file.buffer.length > 0
      );
      if (files.length === 0) {
        res.status(400).json({
          error: "Upload the OM / broker financial file(s) again when creating the property record.",
        });
        return;
      }
      const unsupportedFile = files.find((file) => !isSupportedDealAnalysisUpload(file));
      if (unsupportedFile) {
        res.status(422).json({
          error: `Unsupported OM / broker financial file. '${unsupportedFile.originalname}' must be a PDF, Excel workbook, CSV, text file, or image/screenshot.`,
        });
        return;
      }
      const details = parsePropertyDetailsPayload(req.body?.details);
      const assumptionRecord = parseJsonRecord(req.body?.assumptions);
      const brokerEmailNotes = optionalTrimmedText(req.body?.brokerEmailNotes);
      const unitModelRowsRaw = parseJsonArray(req.body?.unitModelRows);
      const expenseModelRowsRaw = parseJsonArray(req.body?.expenseModelRows);
      if (details === "invalid") {
        res.status(400).json({ error: "details must be a valid JSON object." });
        return;
      }
      if (assumptionRecord === "invalid") {
        res.status(400).json({ error: "assumptions must be valid JSON." });
        return;
      }
      if (unitModelRowsRaw === "invalid" || expenseModelRowsRaw === "invalid") {
        res.status(400).json({ error: "unitModelRows and expenseModelRows must be valid JSON arrays." });
        return;
      }
      if (brokerEmailNotes === "invalid") {
        res.status(400).json({
          error: "brokerEmailNotes must be a string under 20,000 characters.",
        });
        return;
      }
      const assumptionOverrides = parseDossierAssumptionOverridesPayload(assumptionRecord);
      const unitModelRows = parsePropertyDealDossierUnitModelRows(unitModelRowsRaw);
      const expenseModelRows = parsePropertyDealDossierExpenseModelRows(expenseModelRowsRaw);
      if (assumptionOverrides === "invalid") {
        res.status(400).json({
          error:
            "assumptions must contain valid numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
        });
        return;
      }
      if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
        res.status(400).json({
          error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
        });
        return;
      }
      if (!details) {
        res.status(400).json({ error: "details must include the reviewed OM analysis payload." });
        return;
      }

      const propertyInfo =
        (details?.omData?.authoritative?.propertyInfo as Record<string, unknown> | null | undefined) ??
        (details?.rentalFinancials?.omAnalysis?.propertyInfo as Record<string, unknown> | null | undefined) ??
        null;
      const resolvedAddress = resolveOmPropertyAddress(propertyInfo);
      if (!resolvedAddress) {
        res.status(422).json({
          error:
            "The uploaded document analysis did not return a usable building address, so a property record could not be created.",
        });
        return;
      }

      const pool = getPool();
      const client = await pool.connect();
      let propertyId = "";
      let canonicalAddress = resolvedAddress.canonicalAddress;
      let createdProperty = false;
      let matchStrategy: "exact_canonical" | "address_line" | "new" = "new";
      try {
        await client.query("BEGIN");
        const propertyRepo = new PropertyRepo({ pool, client });
        const exactProperty = await propertyRepo.byCanonicalAddress(resolvedAddress.canonicalAddress);
        const firstLineMatch =
          exactProperty == null
            ? await propertyRepo.findByAddressFirstLine(resolvedAddress.addressLine)
            : null;
        const matchedProperty = exactProperty ?? firstLineMatch;
        const property = matchedProperty ?? (await propertyRepo.create(resolvedAddress.canonicalAddress));
        propertyId = property.id;
        canonicalAddress = property.canonicalAddress;
        createdProperty = matchedProperty == null;
        matchStrategy =
          exactProperty != null ? "exact_canonical" : firstLineMatch != null ? "address_line" : "new";
        const existingDetails = (matchedProperty?.details ?? property.details ?? null) as PropertyDetails | null;
        const manualSourceLinks = mergeManualSourceLinks(existingDetails, {
          omImportedAt: new Date().toISOString(),
        });
        await propertyRepo.updateDetails(propertyId, "manualSourceLinks", {
          ...(manualSourceLinks as Record<string, unknown>),
        });
        await propertyRepo.mergeDetails(propertyId, {
          omDerivedAddress: {
            rawAddress: resolvedAddress.rawAddress,
            addressLine: resolvedAddress.addressLine,
            locality: resolvedAddress.locality,
            zip: resolvedAddress.zip,
            canonicalAddress: resolvedAddress.canonicalAddress,
            addressSource: resolvedAddress.addressSource,
          },
        });
        if (details?.taxCode) {
          await propertyRepo.mergeDetails(propertyId, { taxCode: details.taxCode });
        }
        const assumptionsPatch = assumptionPatchFromPayload({
          assumptionOverrides,
          brokerEmailNotes,
          unitModelRows,
          expenseModelRows,
          defaultPurchasePrice: resolveOmAskingPriceFromDetails(details),
        });
        if (assumptionsPatch) {
          await propertyRepo.updateDetails(
            propertyId,
            "dealDossier.assumptions",
            mergeAssumptionsPatch(existingDetails, assumptionsPatch)
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
      const uploadedDocuments = [];
      for (const file of files) {
        const docId = randomUUID();
        const filename = dealAnalysisUploadFilename(file);
        const category = dealAnalysisUploadCategory(file);
        const filePath = await saveUploadedDocument(propertyId, docId, filename, file.buffer);
        const inserted = await uploadedDocRepo.insert({
          id: docId,
          propertyId,
          filename,
          contentType: dealAnalysisUploadMimeType(file),
          filePath,
          category,
          source: "Deal analysis upload",
          fileContent: file.buffer,
        });
        uploadedDocuments.push({
          id: inserted.id,
          fileName: inserted.filename,
          contentType: inserted.contentType,
          category,
          createdAt: inserted.createdAt,
        });
      }

      if (uploadedDocuments.length > 0) {
        const primaryOmDocument = uploadedDocuments[0]!;
        const propertyRepo = new PropertyRepo({ pool });
        const manualSourceLinks = mergeManualSourceLinks((await propertyRepo.byId(propertyId))?.details ?? null, {
          omImportedAt: primaryOmDocument.createdAt,
          omDocumentId: primaryOmDocument.id,
          omFileName: primaryOmDocument.fileName,
        });
        await propertyRepo.mergeDetails(propertyId, { manualSourceLinks });
      }

      const primaryUploadedDocument = uploadedDocuments[0] ?? null;
      const promotedOm = primaryUploadedDocument
        ? await promoteReviewedOmDetailsForProperty({
            propertyId,
            details,
            sourceDocumentId: primaryUploadedDocument.id,
            sourceType: "uploaded_document",
            sourceMeta: {
              sourceType: "deal_analysis_upload",
              documents: uploadedDocuments.map((document) => ({
                id: document.id,
                filename: document.fileName,
                contentType: document.contentType ?? null,
                category: document.category ?? null,
                createdAt: document.createdAt,
              })),
              review: {
                decision: "promoted",
                reviewedVia: "deal_analysis_create_property",
              },
            },
            pool,
          })
        : null;
      if (promotedOm && !promotedOm.ok) {
        throw new Error(promotedOm.error ?? "Failed to save reviewed OM extraction to the property workspace.");
      }

      const resolvedBbl = await getBBLForProperty(propertyId).catch(() => null);
      const enrichmentRun = await runEnrichmentForProperty(propertyId).catch((error) => ({
        ok: false,
        results: {},
        error: error instanceof Error ? error.message : String(error),
      }));
      await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
      const propertyRepo = new PropertyRepo({ pool });
      const property = await propertyRepo.byId(propertyId);

      res.status(createdProperty ? 201 : 200).json({
        ok: true,
        propertyId,
        canonicalAddress,
        createdProperty,
        matchStrategy,
        uploadedDocuments,
        omReview: promotedOm,
        enrichment: {
          attempted: true,
          ok: enrichmentRun.ok,
          bbl: resolvedBbl?.bbl ?? null,
          bin: resolvedBbl?.bin ?? null,
          results: "results" in enrichmentRun ? enrichmentRun.results : {},
          warning: "error" in enrichmentRun ? enrichmentRun.error ?? null : null,
        },
        property,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[deal-analysis create-property]", err);
      res.status(503).json({ error: "Failed to create property record from OM.", details: message });
    }
  }
);

export default router;
