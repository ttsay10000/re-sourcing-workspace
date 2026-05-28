import { Router, type Request, type Response } from "express";
import multer from "multer";
import type {
  Property,
  PropertyDealDossierExpenseModelRow,
  PropertyDealDossierUnitModelRow,
  PropertyDetails,
  PropertyManualSourceLinks,
} from "@re-sourcing/contracts";
import { randomUUID } from "crypto";
import {
  getPool,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import { extractOmAnalysisFromGeminiPdfOnly } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";
import { saveUploadedDocument } from "../upload/uploadedDocStorage.js";
import {
  buildStandaloneDetailsFromOmAnalysis,
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

const router = Router();
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

const DOSSIER_ASSUMPTION_NON_NEGATIVE_NUMERIC_FIELDS = [
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
          details: "Max 25 MB per OM PDF.",
          maxBytes: 25 * 1024 * 1024,
        });
        return;
      }
      if (code === "LIMIT_FILE_COUNT") {
        res.status(413).json({
          error: "Too many files.",
          details: "Upload up to 20 OM PDFs at a time.",
          maxFiles: 20,
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

export type DealAnalysisDraftPropertyMatchStrategy =
  | "exact_canonical"
  | "address_line"
  | "new";

export interface DealAnalysisDraftPropertyRepo {
  byCanonicalAddress(canonicalAddress: string): Promise<Property | null>;
  findByAddressFirstLine(addressLine: string): Promise<Property | null>;
  create(canonicalAddress: string): Promise<Property>;
}

export async function findOrCreateDealAnalysisDraftProperty(params: {
  propertyRepo: DealAnalysisDraftPropertyRepo;
  canonicalAddress: string;
  addressLine: string;
}): Promise<{
  property: Property;
  createdProperty: boolean;
  matchStrategy: DealAnalysisDraftPropertyMatchStrategy;
}> {
  const exactProperty = await params.propertyRepo.byCanonicalAddress(params.canonicalAddress);
  if (exactProperty) {
    return {
      property: exactProperty,
      createdProperty: false,
      matchStrategy: "exact_canonical",
    };
  }

  const firstLineMatch = await params.propertyRepo.findByAddressFirstLine(params.addressLine);
  if (firstLineMatch) {
    return {
      property: firstLineMatch,
      createdProperty: false,
      matchStrategy: "address_line",
    };
  }

  return {
    property: await params.propertyRepo.create(params.canonicalAddress),
    createdProperty: true,
    matchStrategy: "new",
  };
}

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
    uploadMemory.array("files", 20)(req, res, handleUploadMulterError(req, res, next));
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
      const nonPdfFile = files.find((file) => !isPdfUpload(file));
      if (nonPdfFile) {
        res.status(422).json({
          error: `Only PDF OM files are supported right now. '${nonPdfFile.originalname}' is not a PDF.`,
        });
        return;
      }

      const extracted = await extractOmAnalysisFromGeminiPdfOnly({
        documents: files.map((file) => ({
          filename: file.originalname?.trim() || "uploaded-om.pdf",
          mimeType: file.mimetype || "application/pdf",
          buffer: file.buffer,
        })),
        propertyContext: files.map((file) => file.originalname?.trim() || "uploaded-om.pdf").join(", "),
      });
      if (!extracted.omAnalysis) {
        res.status(422).json({
          error: extracted.parseError
            ? `Failed to parse uploaded OM PDF(s): ${extracted.parseError}`
            : "The uploaded OM PDF(s) did not return structured property details.",
        });
        return;
      }

      const details = buildStandaloneDetailsFromOmAnalysis({
        omAnalysis: extracted.omAnalysis,
        fromLlm: extracted.fromLlm ?? null,
        uploadedDocuments: files.map((file) => ({
          fileName: file.originalname?.trim() || "uploaded-om.pdf",
          mimeType: file.mimetype || "application/pdf",
          sizeBytes: file.size,
        })),
      });
      const resolvedAddress = resolveOmPropertyAddress(
        (extracted.omAnalysis.propertyInfo as Record<string, unknown> | null | undefined) ?? null
      );
      if (!resolvedAddress) {
        res.status(422).json({
          error:
            "The uploaded OM analysis did not return a usable building address, so a draft property workspace could not be created.",
        });
        return;
      }

      const pool = getPool();
      const client = await pool.connect();
      let propertyId = "";
      let canonicalAddress = resolvedAddress.canonicalAddress;
      let createdProperty = false;
      let matchStrategy: DealAnalysisDraftPropertyMatchStrategy = "new";
      try {
        await client.query("BEGIN");
        const propertyRepo = new PropertyRepo({ pool, client });
        const draftProperty = await findOrCreateDealAnalysisDraftProperty({
          propertyRepo,
          canonicalAddress: resolvedAddress.canonicalAddress,
          addressLine: resolvedAddress.addressLine,
        });
        propertyId = draftProperty.property.id;
        canonicalAddress = draftProperty.property.canonicalAddress;
        createdProperty = draftProperty.createdProperty;
        matchStrategy = draftProperty.matchStrategy;
        const existingDetails = (draftProperty.property.details ?? null) as PropertyDetails | null;
        const now = new Date().toISOString();
        const existingWorkspace =
          existingDetails?.dealAnalysisWorkspace &&
          typeof existingDetails.dealAnalysisWorkspace === "object" &&
          !Array.isArray(existingDetails.dealAnalysisWorkspace)
            ? (existingDetails.dealAnalysisWorkspace as Record<string, unknown>)
            : {};
        const manualSourceLinks = mergeManualSourceLinks(existingDetails, {
          omImportedAt: now,
        });
        await propertyRepo.updateDetails(propertyId, "manualSourceLinks", {
          ...(manualSourceLinks as Record<string, unknown>),
        });
        await propertyRepo.mergeDetails(propertyId, {
          dealAnalysisWorkspace: {
            ...existingWorkspace,
            status: "draft",
            source: "deal_analysis_upload",
            createdAt:
              typeof existingWorkspace.createdAt === "string" ? existingWorkspace.createdAt : now,
            updatedAt: now,
            lastUploadedAt: now,
            uploadedFileNames: files.map(
              (file) => file.originalname?.trim() || "uploaded-om.pdf"
            ),
          },
          omDerivedAddress: {
            rawAddress: resolvedAddress.rawAddress,
            addressLine: resolvedAddress.addressLine,
            locality: resolvedAddress.locality,
            zip: resolvedAddress.zip,
            canonicalAddress: resolvedAddress.canonicalAddress,
            addressSource: resolvedAddress.addressSource,
          },
          ...(details?.taxCode ? { taxCode: details.taxCode } : {}),
        });
        const existingAssumptions = getPropertyDossierAssumptions(existingDetails);
        const omAskingPrice = resolveOmAskingPriceFromDetails(details);
        if (existingAssumptions?.purchasePrice == null && omAskingPrice != null) {
          await propertyRepo.updateDetails(
            propertyId,
            "dealDossier.assumptions",
            mergeAssumptionsPatch(existingDetails, {
              updatedAt: now,
              purchasePrice: omAskingPrice,
            })
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
      const persistedDocuments = [];
      for (const file of files) {
        const docId = randomUUID();
        const filename = file.originalname?.trim() || "uploaded-om.pdf";
        const filePath = await saveUploadedDocument(propertyId, docId, filename, file.buffer);
        const inserted = await uploadedDocRepo.insert({
          id: docId,
          propertyId,
          filename,
          contentType: file.mimetype || "application/pdf",
          filePath,
          category: "OM",
          source: "Deal analysis upload",
          sourceMetadata: {
            sourceType: "deal_analysis_upload",
            workspaceStatus: "draft",
          },
          fileContent: file.buffer,
        });
        persistedDocuments.push({
          id: inserted.id,
          fileName: inserted.filename,
          contentType: inserted.contentType,
          createdAt: inserted.createdAt,
        });
      }

      if (persistedDocuments.length > 0) {
        const primaryOmDocument = persistedDocuments[0]!;
        const propertyRepo = new PropertyRepo({ pool });
        const propertyRecord = await propertyRepo.byId(propertyId);
        const currentDetails = (propertyRecord?.details ?? null) as PropertyDetails | null;
        const currentWorkspace =
          currentDetails?.dealAnalysisWorkspace &&
          typeof currentDetails.dealAnalysisWorkspace === "object" &&
          !Array.isArray(currentDetails.dealAnalysisWorkspace)
            ? (currentDetails.dealAnalysisWorkspace as Record<string, unknown>)
            : {};
        const manualSourceLinks = mergeManualSourceLinks(currentDetails, {
          omImportedAt: primaryOmDocument.createdAt,
          omDocumentId: primaryOmDocument.id,
          omFileName: primaryOmDocument.fileName,
        });
        await propertyRepo.mergeDetails(propertyId, {
          manualSourceLinks,
          dealAnalysisWorkspace: {
            ...currentWorkspace,
            status: "draft",
            updatedAt: new Date().toISOString(),
            uploadedDocumentIds: persistedDocuments.map((document) => document.id),
            primaryOmDocumentId: primaryOmDocument.id,
          },
        });
      }

      const primaryUploadedDocument = persistedDocuments[0] ?? null;
      const promotedOm = primaryUploadedDocument
        ? await promoteReviewedOmDetailsForProperty({
            propertyId,
            details,
            sourceDocumentId: primaryUploadedDocument.id,
            sourceType: "uploaded_document",
            sourceMeta: {
              sourceType: "deal_analysis_upload",
              workspaceStatus: "draft",
              documents: persistedDocuments.map((document) => ({
                id: document.id,
                filename: document.fileName,
                contentType: document.contentType ?? null,
                createdAt: document.createdAt,
              })),
              review: {
                decision: "promoted",
                reviewedVia: "deal_analysis_analyze_upload",
              },
            },
            pool,
          })
        : null;
      if (promotedOm && !promotedOm.ok) {
        throw new Error(promotedOm.error ?? "Failed to save reviewed OM extraction to the draft property workspace.");
      }

      const resolvedBbl = await getBBLForProperty(propertyId).catch(() => null);
      const enrichmentRun = await runEnrichmentForProperty(propertyId).catch((error) => ({
        ok: false,
        results: {},
        error: error instanceof Error ? error.message : String(error),
      }));
      await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
      const propertyRepo = new PropertyRepo({ pool });
      const propertyRecord = await propertyRepo.byId(propertyId);
      const savedDetails = (propertyRecord?.details ?? details) as PropertyDetails;
      const savedPropertyInput = resolveWorkspaceProperty(savedDetails);
      const savedCalculation = (
        await buildStandaloneOmCalculation({
          property: savedPropertyInput,
          details: savedDetails,
        })
      ).calculation;

      const matchedProperty = {
        id: propertyId,
        canonicalAddress,
        matchStrategy,
      };

      res.status(createdProperty ? 201 : 200).json({
        ok: true,
        property: savedPropertyInput,
        propertyId,
        canonicalAddress,
        createdProperty,
        matchStrategy,
        resolvedAddress,
        matchedProperty,
        uploadedDocuments: persistedDocuments.map((document, index) => ({
          id: document.id,
          fileName: document.fileName,
          mimeType: document.contentType ?? "application/pdf",
          sizeBytes: files[index]?.size ?? null,
          createdAt: document.createdAt,
        })),
        details: savedDetails,
        calculation: savedCalculation,
        omReview: promotedOm,
        enrichment: {
          attempted: true,
          ok: enrichmentRun.ok,
          bbl: resolvedBbl?.bbl ?? null,
          bin: resolvedBbl?.bin ?? null,
          results: "results" in enrichmentRun ? enrichmentRun.results : {},
          warning: "error" in enrichmentRun ? enrichmentRun.error ?? null : null,
        },
        propertyRecord,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[deal-analysis analyze-upload]", err);
      res.status(503).json({ error: "Failed to analyze OM upload.", details: message });
    }
  }
);

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
    uploadMemory.array("files", 20)(req, res, handleUploadMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const files = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).filter(
        (file) => file.buffer && file.buffer.length > 0
      );
      if (files.length === 0) {
        res.status(400).json({
          error: "Upload the OM PDF(s) again when creating the property record.",
        });
        return;
      }
      const nonPdfFile = files.find((file) => !isPdfUpload(file));
      if (nonPdfFile) {
        res.status(422).json({
          error: `Only PDF OM files are supported right now. '${nonPdfFile.originalname}' is not a PDF.`,
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
            "The uploaded OM analysis did not return a usable building address, so a property record could not be created.",
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
        const filename = file.originalname?.trim() || "uploaded-om.pdf";
        const filePath = await saveUploadedDocument(propertyId, docId, filename, file.buffer);
        const inserted = await uploadedDocRepo.insert({
          id: docId,
          propertyId,
          filename,
          contentType: file.mimetype || "application/pdf",
          filePath,
          category: "OM",
          source: "Deal analysis upload",
          fileContent: file.buffer,
        });
        uploadedDocuments.push({
          id: inserted.id,
          fileName: inserted.filename,
          contentType: inserted.contentType,
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
