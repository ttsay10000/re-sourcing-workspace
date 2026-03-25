import { Router, type Request, type Response } from "express";
import multer from "multer";
import type {
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
  resolveStandalonePropertyInput,
} from "../deal/standaloneDealAnalysis.js";
import { resolveOmPropertyAddress } from "../om/resolveOmPropertyAddress.js";
import {
  parsePropertyDealDossierExpenseModelRows,
  parsePropertyDealDossierUnitModelRows,
} from "../deal/propertyDossierState.js";
import type { DossierAssumptionOverrides } from "../deal/underwritingModel.js";
import { getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";

const router = Router();
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

const DOSSIER_ASSUMPTION_NUMERIC_FIELDS = [
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
  "annualOtherIncomeGrowthPct",
  "annualExpenseGrowthPct",
  "annualPropertyTaxGrowthPct",
  "recurringCapexAnnual",
  "holdPeriodYears",
  "exitCapPct",
  "exitClosingCostPct",
  "targetIrrPct",
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
  for (const key of DOSSIER_ASSUMPTION_NUMERIC_FIELDS) {
    const parsed = optionalNonNegativeNumber(record[key]);
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

function resolveWorkspaceProperty(details: PropertyDetails | null | undefined) {
  const omAnalysis = details?.rentalFinancials?.omAnalysis ?? null;
  return resolveStandalonePropertyInput({
    omAnalysis,
    details: details ?? null,
  });
}

async function previewMatchedProperty(
  canonicalAddress: string,
  addressLine: string
): Promise<{
  id: string;
  canonicalAddress: string;
  matchStrategy: "exact_canonical" | "address_line";
} | null> {
  try {
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const exact = await propertyRepo.byCanonicalAddress(canonicalAddress);
    if (exact) {
      return {
        id: exact.id,
        canonicalAddress: exact.canonicalAddress,
        matchStrategy: "exact_canonical",
      };
    }
    const firstLine = await propertyRepo.findByAddressFirstLine(addressLine);
    if (!firstLine) return null;
    return {
      id: firstLine.id,
      canonicalAddress: firstLine.canonicalAddress,
      matchStrategy: "address_line",
    };
  } catch {
    return null;
  }
}

function assumptionPatchFromPayload(params: {
  assumptionOverrides: DossierAssumptionOverrides | null;
  unitModelRows: PropertyDealDossierUnitModelRow[] | null;
  expenseModelRows: PropertyDealDossierExpenseModelRow[] | null;
}): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  for (const key of DOSSIER_ASSUMPTION_NUMERIC_FIELDS) {
    patch[key] = params.assumptionOverrides?.[key] ?? null;
  }
  patch.investmentProfile = params.assumptionOverrides?.investmentProfile ?? null;
  patch.targetAcquisitionDate = params.assumptionOverrides?.targetAcquisitionDate ?? null;
  patch.unitModelRows = params.unitModelRows;
  patch.expenseModelRows = params.expenseModelRows;
  const hasMeaningfulValue = Object.entries(patch).some(([key, value]) => {
    if (key === "updatedAt") return false;
    if (Array.isArray(value)) return value.length > 0;
    return value != null;
  });
  return hasMeaningfulValue ? patch : null;
}

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
      const property = resolveStandalonePropertyInput({
        omAnalysis: extracted.omAnalysis,
        details,
      });
      const calculation = (
        await buildStandaloneOmCalculation({
          property,
          details,
        })
      ).calculation;
      const resolvedAddress = resolveOmPropertyAddress(
        (extracted.omAnalysis.propertyInfo as Record<string, unknown> | null | undefined) ?? null
      );
      const matchedProperty =
        resolvedAddress != null
          ? await previewMatchedProperty(
              resolvedAddress.canonicalAddress,
              resolvedAddress.addressLine
            )
          : null;

      res.status(201).json({
        ok: true,
        property,
        resolvedAddress,
        matchedProperty,
        uploadedDocuments: files.map((file) => ({
          fileName: file.originalname?.trim() || "uploaded-om.pdf",
          mimeType: file.mimetype || "application/pdf",
          sizeBytes: file.size,
        })),
        details,
        calculation,
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
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (details === "invalid") {
      res.status(400).json({ error: "details must be a valid object." });
      return;
    }
    if (assumptionOverrides === "invalid") {
      res.status(400).json({
        error:
          "assumptions must be an object containing non-negative numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
      });
      return;
    }
    if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
      res.status(400).json({
        error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
      });
      return;
    }
    const property = resolveWorkspaceProperty(details);
    const calculation = (
      await buildStandaloneOmCalculation({
        property,
        details,
        assumptionOverrides,
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
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (details === "invalid") {
      res.status(400).json({ error: "details must be a valid object." });
      return;
    }
    if (assumptionOverrides === "invalid") {
      res.status(400).json({
        error:
          "assumptions must be an object containing non-negative numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
      });
      return;
    }
    if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
      res.status(400).json({
        error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
      });
      return;
    }
    const property = resolveWorkspaceProperty(details);
    const dossier = await buildStandaloneDossierPdf({
      property,
      details,
      assumptionOverrides,
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
      const assumptionOverrides = parseDossierAssumptionOverridesPayload(assumptionRecord);
      const unitModelRows = parsePropertyDealDossierUnitModelRows(unitModelRowsRaw);
      const expenseModelRows = parsePropertyDealDossierExpenseModelRows(expenseModelRowsRaw);
      if (assumptionOverrides === "invalid") {
        res.status(400).json({
          error:
            "assumptions must contain non-negative numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
        });
        return;
      }
      if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
        res.status(400).json({
          error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
        });
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
        if (details?.omData && typeof details.omData === "object") {
          const nextOmData = {
            ...(((existingDetails?.omData as Record<string, unknown> | null | undefined) ?? {}) as Record<
              string,
              unknown
            >),
            ...((details.omData as Record<string, unknown>) ?? {}),
          };
          await propertyRepo.updateDetails(propertyId, "omData", nextOmData);
        }
        if (details?.rentalFinancials && typeof details.rentalFinancials === "object") {
          const nextRentalFinancials = {
            ...(((existingDetails?.rentalFinancials as Record<string, unknown> | null | undefined) ?? {}) as Record<
              string,
              unknown
            >),
            ...((details.rentalFinancials as Record<string, unknown>) ?? {}),
          };
          await propertyRepo.updateDetails(propertyId, "rentalFinancials", nextRentalFinancials);
        }
        if (details?.taxCode) {
          await propertyRepo.mergeDetails(propertyId, { taxCode: details.taxCode });
        }
        const assumptionsPatch = assumptionPatchFromPayload({
          assumptionOverrides,
          unitModelRows,
          expenseModelRows,
        });
        if (assumptionsPatch) {
          await propertyRepo.updateDetails(propertyId, "dealDossier.assumptions", assumptionsPatch);
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
