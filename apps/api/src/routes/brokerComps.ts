import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type {
  BrokerCompExtractionMethod,
  BrokerCompItemType,
  BrokerCompPackageStatus,
  BrokerCompPackageType,
  BrokerCompPageRef,
  BrokerCompPageType,
  BrokerCompReviewStatus,
  BrokerCompSelectionDecision,
  PropertyDocumentCategory,
} from "@re-sourcing/contracts";
import {
  getPool,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import {
  BrokerCompApiError,
  createBrokerCompPackage,
  getBrokerCompPackageDetails,
  listBrokerCompPackages,
  listBrokerCompPromotedItems,
  promoteBrokerCompPackageItems,
  reviewBrokerCompExtractedItem,
  type BrokerCompExtractedItemInput,
  type BrokerCompPageInput,
} from "../brokerComp/service.js";
import { extractBrokerCompPackageDraft, type BrokerCompExtractionDraft } from "../brokerComps/extractBrokerCompPackage.js";
import { saveUploadedDocument } from "../upload/uploadedDocStorage.js";
import { normalizeAddressLineForDisplay } from "../enrichment/resolvePropertyBBL.js";

const router = Router();
const BROKER_COMP_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BROKER_COMP_UPLOAD_MAX_BYTES },
});

const PACKAGE_TYPES: BrokerCompPackageType[] = [
  "market_analysis",
  "pricing_sellout",
  "sale_comps",
  "operating_comps",
  "rent_comps",
  "expense_comps",
  "broker_opinion",
  "other",
];
const PACKAGE_STATUSES: BrokerCompPackageStatus[] = [
  "uploaded",
  "classified",
  "extracted",
  "needs_review",
  "approved",
  "failed",
];
const REVIEW_STATUSES: BrokerCompReviewStatus[] = [
  "pending",
  "edited",
  "accepted",
  "rejected",
];
const PAGE_TYPES: BrokerCompPageType[] = [
  "cover",
  "subject_summary",
  "pipeline",
  "proximity_map",
  "comp_profile",
  "sale_comp_grid",
  "operating_comp_grid",
  "rent_roll_grid",
  "expense_grid",
  "projected_pricing",
  "broker_opinion",
  "disclaimer",
  "other",
];
const EXTRACTION_METHODS: BrokerCompExtractionMethod[] = ["text", "ocr", "vision", "spreadsheet", "manual"];
const ITEM_TYPES: BrokerCompItemType[] = [
  "sale_comp",
  "operating_snapshot",
  "rent_roll_row",
  "expense_row",
  "pricing_comp",
  "unit_breakdown_row",
  "subject_projected_pricing",
  "pricing_opinion",
  "subject_fact",
  "broker_note",
];
const SELECTION_DECISIONS: BrokerCompSelectionDecision[] = [
  "include",
  "exclude",
  "watch",
  "duplicate",
  "not_comparable",
];
const DOCUMENT_CATEGORIES: PropertyDocumentCategory[] = [
  "Broker Comp Package",
  "Sale Comp Package",
  "Rent Comp Package",
  "Expense Comp Package",
  "Market Analysis",
  "Other",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ParseResult<T> {
  value?: T;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseUuid(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    return { error: `${field} must be a UUID.` };
  }
  return { value: value.trim() };
}

function parseOptionalText(value: unknown, field: string, maxLength: number): ParseResult<string | null> {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > maxLength) return { error: `${field} must be under ${maxLength} characters.` };
  return { value: trimmed };
}

function parsePositiveInteger(value: unknown, field: string): ParseResult<number> {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) return { error: `${field} must be a positive integer.` };
  return { value: parsed };
}

function parseOptionalPositiveInteger(value: unknown, field: string): ParseResult<number | null> {
  if (value == null || value === "") return { value: null };
  return parsePositiveInteger(value, field);
}

function parseOptionalConfidence(value: unknown, field: string): ParseResult<number | null> {
  if (value == null || value === "") return { value: null };
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { error: `${field} must be a number between 0 and 1.` };
  }
  return { value: parsed };
}

function parsePositiveNumber(value: unknown, field: string): ParseResult<number> {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.replace(/[$,\s]/g, ""))
      : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${field} must be a positive number.` };
  }
  return { value: parsed };
}

function parseOptionalPositiveNumber(value: unknown, field: string): ParseResult<number | null> {
  if (value == null || value === "") return { value: null };
  return parsePositiveNumber(value, field);
}

function parseOptionalBoolean(value: unknown, field: string): ParseResult<boolean | undefined> {
  if (value == null || value === "") return { value: undefined };
  if (typeof value === "boolean") return { value };
  if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) {
    return { value: value.toLowerCase() === "true" };
  }
  return { error: `${field} must be a boolean.` };
}

function parsePackageType(value: unknown): ParseResult<BrokerCompPackageType> {
  if (value == null || value === "") return { value: "other" };
  if (typeof value !== "string") return { error: "packageType must be a string." };
  const normalized = value.trim();
  if (normalized === "mixed") return { value: "market_analysis" };
  if (normalized === "lease_comps") return { value: "rent_comps" };
  if (!PACKAGE_TYPES.includes(normalized as BrokerCompPackageType)) {
    return { error: `packageType must be one of: ${PACKAGE_TYPES.join(", ")}.` };
  }
  return { value: normalized as BrokerCompPackageType };
}

function parsePackageStatus(value: unknown, fallback: BrokerCompPackageStatus): ParseResult<BrokerCompPackageStatus> {
  if (value == null || value === "") return { value: fallback };
  if (typeof value !== "string") return { error: "status must be a string." };
  const normalized = value.trim();
  if (normalized === "ready_for_review") return { value: "needs_review" };
  if (normalized === "reviewed" || normalized === "promoted") return { value: "approved" };
  if (!PACKAGE_STATUSES.includes(normalized as BrokerCompPackageStatus)) {
    return { error: `status must be one of: ${PACKAGE_STATUSES.join(", ")}.` };
  }
  return { value: normalized as BrokerCompPackageStatus };
}

function parseReviewStatus(
  value: unknown,
  fallback: BrokerCompReviewStatus,
  field = "reviewStatus"
): ParseResult<BrokerCompReviewStatus> {
  if (value == null || value === "") return { value: fallback };
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const trimmed = value.trim();
  const normalized = trimmed === "approved" ? "accepted" : trimmed;
  if (!REVIEW_STATUSES.includes(normalized as BrokerCompReviewStatus)) {
    return { error: `${field} must be one of: ${REVIEW_STATUSES.join(", ")}.` };
  }
  return { value: normalized as BrokerCompReviewStatus };
}

function parsePageType(value: unknown, field: string): ParseResult<BrokerCompPageType> {
  if (value == null || value === "") return { value: "other" };
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const normalized = value.trim();
  if (!PAGE_TYPES.includes(normalized as BrokerCompPageType)) {
    return { error: `${field} must be one of: ${PAGE_TYPES.join(", ")}.` };
  }
  return { value: normalized as BrokerCompPageType };
}

function parseExtractionMethod(value: unknown, field: string): ParseResult<BrokerCompExtractionMethod | null> {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const normalized = value.trim();
  if (!EXTRACTION_METHODS.includes(normalized as BrokerCompExtractionMethod)) {
    return { error: `${field} must be one of: ${EXTRACTION_METHODS.join(", ")}.` };
  }
  return { value: normalized as BrokerCompExtractionMethod };
}

function parseItemType(value: unknown, field: string): ParseResult<BrokerCompItemType> {
  if (value == null || value === "") return { value: "broker_note" };
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const normalized = value.trim();
  if (normalized === "comp") return { value: "broker_note" };
  if (!ITEM_TYPES.includes(normalized as BrokerCompItemType)) {
    return { error: `${field} must be one of: ${ITEM_TYPES.join(", ")}.` };
  }
  return { value: normalized as BrokerCompItemType };
}

function parseSelectionDecision(value: unknown, field: string): ParseResult<BrokerCompSelectionDecision | null> {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const normalized = value.trim();
  if (!SELECTION_DECISIONS.includes(normalized as BrokerCompSelectionDecision)) {
    return { error: `${field} must be one of: ${SELECTION_DECISIONS.join(", ")}.` };
  }
  return { value: normalized as BrokerCompSelectionDecision };
}

function parseOptionalRecord(value: unknown, field: string): ParseResult<Record<string, unknown> | null> {
  if (value == null) return { value: null };
  if (!isRecord(value)) return { error: `${field} must be an object.` };
  return { value };
}

function parsePageRefs(value: unknown, fallbackPageNumber: number | null, fallbackLabel: string | null, field: string): ParseResult<BrokerCompPageRef[]> {
  if (value == null) {
    return {
      value: fallbackPageNumber != null ? [{ pageNumber: fallbackPageNumber, label: fallbackLabel }] : [],
    };
  }
  if (!Array.isArray(value)) return { error: `${field} must be an array.` };
  const refs: BrokerCompPageRef[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) return { error: `${field}[${index}] must be an object.` };
    const pageNumber = parsePositiveInteger(entry.pageNumber ?? entry.page_number, `${field}[${index}].pageNumber`);
    const label = parseOptionalText(entry.label, `${field}[${index}].label`, 500);
    const error = pageNumber.error ?? label.error;
    if (error) return { error };
    refs.push({ pageNumber: pageNumber.value ?? 0, label: label.value ?? null });
  }
  return { value: refs };
}

function parsePages(value: unknown): ParseResult<BrokerCompPageInput[]> {
  if (value == null) return { value: [] };
  if (!Array.isArray(value)) return { error: "pages must be an array." };
  const pages: BrokerCompPageInput[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) return { error: `pages[${index}] must be an object.` };
    const pageNumber = parsePositiveInteger(entry.pageNumber ?? entry.page_number, `pages[${index}].pageNumber`);
    const pageType = parsePageType(entry.pageType ?? entry.page_type, `pages[${index}].pageType`);
    const extractionMethod = parseExtractionMethod(entry.extractionMethod ?? entry.extraction_method, `pages[${index}].extractionMethod`);
    const pageRef = parseOptionalText(entry.pageRef ?? entry.page_ref, `pages[${index}].pageRef`, 500);
    const rawTextExcerpt = parseOptionalText(entry.rawTextExcerpt ?? entry.raw_text_excerpt ?? entry.textContent ?? entry.text_content, `pages[${index}].rawTextExcerpt`, 500_000);
    const regions = parseOptionalRecord(entry.regions, `pages[${index}].regions`);
    const rawPayload = parseOptionalRecord(entry.rawPayload ?? entry.raw_payload, `pages[${index}].rawPayload`);
    const normalizedPayload = parseOptionalRecord(entry.normalizedPayload ?? entry.normalized_payload, `pages[${index}].normalizedPayload`);
    const confidence = parseOptionalConfidence(entry.confidence, `pages[${index}].confidence`);
    const reviewStatus = parseReviewStatus(entry.reviewStatus ?? entry.review_status, "pending", `pages[${index}].reviewStatus`);
    const error =
      pageNumber.error ??
      pageType.error ??
      extractionMethod.error ??
      pageRef.error ??
      rawTextExcerpt.error ??
      regions.error ??
      rawPayload.error ??
      normalizedPayload.error ??
      confidence.error ??
      reviewStatus.error;
    if (error) return { error };
    pages.push({
      pageNumber: pageNumber.value ?? 0,
      pageType: pageType.value ?? "other",
      extractionMethod: extractionMethod.value ?? null,
      pageRef: pageRef.value ?? null,
      rawTextExcerpt: rawTextExcerpt.value ?? null,
      regions: regions.value ?? null,
      rawPayload: rawPayload.value ?? null,
      normalizedPayload: normalizedPayload.value ?? null,
      confidence: confidence.value ?? null,
      reviewStatus: reviewStatus.value ?? "pending",
    });
  }
  return { value: pages };
}

function parseExtractedItems(value: unknown): ParseResult<BrokerCompExtractedItemInput[]> {
  if (value == null) return { value: [] };
  if (!Array.isArray(value)) return { error: "extractedItems must be an array." };
  const items: BrokerCompExtractedItemInput[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) return { error: `extractedItems[${index}] must be an object.` };
    const itemType = parseItemType(entry.itemType ?? entry.item_type, `extractedItems[${index}].itemType`);
    const rawPayload = parseOptionalRecord(entry.rawPayload ?? entry.raw_payload, `extractedItems[${index}].rawPayload`);
    const normalizedPayload = parseOptionalRecord(entry.normalizedPayload ?? entry.normalized_payload, `extractedItems[${index}].normalizedPayload`);
    const reviewedPayload = parseOptionalRecord(entry.reviewedPayload ?? entry.reviewed_payload, `extractedItems[${index}].reviewedPayload`);
    const pageNumber = parseOptionalPositiveInteger(entry.pageNumber ?? entry.page_number, `extractedItems[${index}].pageNumber`);
    const pageRef = parseOptionalText(entry.pageRef ?? entry.page_ref, `extractedItems[${index}].pageRef`, 500);
    const pageRefs = parsePageRefs(entry.pageRefs ?? entry.page_refs, pageNumber.value ?? null, pageRef.value ?? null, `extractedItems[${index}].pageRefs`);
    const confidence = parseOptionalConfidence(entry.confidence, `extractedItems[${index}].confidence`);
    const reviewStatus = parseReviewStatus(entry.reviewStatus ?? entry.review_status, "pending", `extractedItems[${index}].reviewStatus`);
    const selectionDecision = parseSelectionDecision(entry.selectionDecision ?? entry.selection_decision, `extractedItems[${index}].selectionDecision`);
    const includeInDossier = parseOptionalBoolean(entry.includeInDossier ?? entry.include_in_dossier, `extractedItems[${index}].includeInDossier`);
    const analystNote = parseOptionalText(entry.analystNote ?? entry.analyst_note ?? entry.reviewerNotes ?? entry.reviewer_notes, `extractedItems[${index}].analystNote`, 10_000);
    const error =
      itemType.error ??
      rawPayload.error ??
      normalizedPayload.error ??
      reviewedPayload.error ??
      pageNumber.error ??
      pageRef.error ??
      pageRefs.error ??
      confidence.error ??
      reviewStatus.error ??
      selectionDecision.error ??
      includeInDossier.error ??
      analystNote.error;
    if (error) return { error };
    items.push({
      itemType: itemType.value ?? "broker_note",
      rawPayload: rawPayload.value ?? null,
      normalizedPayload: normalizedPayload.value ?? null,
      reviewedPayload: reviewedPayload.value ?? null,
      pageRefs: pageRefs.value ?? [],
      confidence: confidence.value ?? null,
      reviewStatus: reviewStatus.value ?? "pending",
      selectionDecision: selectionDecision.value ?? null,
      includeInDossier: includeInDossier.value,
      analystNote: analystNote.value ?? null,
    });
  }
  return { value: items };
}

function parseUuidList(value: unknown, field: string): ParseResult<string[] | null> {
  if (value == null) return { value: null };
  if (!Array.isArray(value)) return { error: `${field} must be an array of UUIDs.` };
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseUuid(item, `${field}[${index}]`);
    if (parsed.error) return { error: parsed.error };
    ids.push(parsed.value ?? "");
  }
  return { value: ids };
}

function parseLimit(value: unknown, fallback = 50, max = 200): number {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function defaultDocumentCategory(packageType: BrokerCompPackageType): PropertyDocumentCategory {
  if (packageType === "sale_comps") return "Sale Comp Package";
  if (packageType === "rent_comps") return "Rent Comp Package";
  if (packageType === "expense_comps") return "Expense Comp Package";
  if (packageType === "market_analysis") return "Market Analysis";
  return "Broker Comp Package";
}

function parseDocumentCategory(value: unknown, packageType: BrokerCompPackageType): PropertyDocumentCategory {
  if (typeof value !== "string") return defaultDocumentCategory(packageType);
  const trimmed = value.trim();
  return DOCUMENT_CATEGORIES.includes(trimmed as PropertyDocumentCategory)
    ? (trimmed as PropertyDocumentCategory)
    : defaultDocumentCategory(packageType);
}

function sendError(res: Response, fallback: string, err: unknown): void {
  if (err instanceof BrokerCompApiError) {
    res.status(err.statusCode).json({ error: err.message, ...(err.details ?? {}) });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[broker comps] ${fallback}`, err);
  res.status(503).json({ error: fallback, details: message });
}

function handleBrokerCompUploadMulterError(_req: Request, res: Response, next: (err?: unknown) => void) {
  return (err: unknown) => {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "File too large",
        details: "Max 50 MB per broker comp package upload.",
        maxBytes: BROKER_COMP_UPLOAD_MAX_BYTES,
      });
      return;
    }
    next(err);
  };
}

async function listBrokerCompPackageDetailsForProperty(propertyId: string, limit: number) {
  const pool = getPool();
  const packages = await listBrokerCompPackages(pool, propertyId, limit);
  const packageDetails = await Promise.all(
    packages.map((pkg) => getBrokerCompPackageDetails(pool, propertyId, pkg.id))
  );
  return { packages, packageDetails };
}

interface UploadedCompFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
}

/** Persist an uploaded comp file + its extraction draft as a package on a property. */
async function saveCompPackageForProperty(params: {
  propertyId: string;
  file: UploadedCompFile;
  filename: string;
  draft: BrokerCompExtractionDraft;
  packageType: BrokerCompPackageType;
  category: PropertyDocumentCategory;
  source: string | null;
  createdBy: string | null;
}) {
  const pool = getPool();
  const documentId = randomUUID();
  const filePath = await saveUploadedDocument(params.propertyId, documentId, params.filename, params.file.buffer);
  const documentRepo = new PropertyUploadedDocumentRepo({ pool });
  const document = await documentRepo.insert({
    id: documentId,
    propertyId: params.propertyId,
    filename: params.filename,
    contentType: params.file.mimetype || null,
    filePath,
    category: params.category,
    source: params.source,
    fileContent: params.file.buffer,
  });

  const details = await createBrokerCompPackage(pool, {
    propertyId: params.propertyId,
    sourceDocumentId: document.id,
    packageType: params.packageType,
    status: params.draft.extractedItems.length > 0 ? "approved" : "uploaded",
    replaceExistingForProperty: true,
    rawPayload: {
      filename: params.filename,
      contentType: params.file.mimetype || null,
      sizeBytes: params.file.buffer.length,
    },
    normalizedPayload: {
      summary: params.draft.extractedItems.length > 0
        ? "Broker comp package extracted for analyst review."
        : "Broker comp package uploaded. Structured comp rows were not detected yet.",
    },
    packageMeta: {
      ...params.draft.packageMeta,
      documentCategory: params.category,
      source: params.source,
    },
    createdBy: params.createdBy,
    pages: params.draft.pages,
    extractedItems: params.draft.extractedItems,
  });
  return { document, details };
}

/** Subject address from an extraction draft: the subject pricing item is authoritative; the filename is the fallback. */
function subjectAddressFromDraft(draft: BrokerCompExtractionDraft, filename: string): string | null {
  for (const item of draft.extractedItems) {
    if (item.itemType !== "subject_projected_pricing") continue;
    const payload = item.normalizedPayload ?? {};
    const address = typeof payload.address === "string" ? payload.address.trim() : "";
    if (address) return address;
  }
  // Filenames like "210 East 39th St - Sale Comps.pdf" carry the subject address.
  const stem = filename.replace(/\.[a-z0-9]+$/i, "");
  const match = stem.match(/^\s*(\d+[\w-]*\s+[A-Za-z][^,_–-]*)/);
  return match?.[1]?.trim() || null;
}

router.post(
  ["/properties/:id/broker-comp-packages/upload", "/properties/:id/broker-comps/upload"],
  (req, res, next) => {
    uploadMemory.single("file")(req, res, handleBrokerCompUploadMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const propertyId = parseUuid(req.params.id, "propertyId");
      if (propertyId.error) {
        res.status(400).json({ error: propertyId.error });
        return;
      }
      const file = (req as Request & { file?: { buffer: Buffer; originalname?: string; mimetype?: string } }).file;
      if (!file?.buffer) {
        res.status(400).json({ error: "Missing file. Send multipart/form-data with field 'file'." });
        return;
      }

      const filename = file.originalname?.trim() || "broker-comp-package";
      const draft = await extractBrokerCompPackageDraft(file.buffer, filename);
      const requestedType = parsePackageType(req.body?.packageType ?? req.body?.package_type);
      if (requestedType.error) {
        res.status(400).json({ error: requestedType.error });
        return;
      }
      const packageType = requestedType.value ?? draft.packageType;
      const category = parseDocumentCategory(req.body?.category, packageType);
      const source = typeof req.body?.source === "string" ? req.body.source.trim() || null : null;
      const createdBy = parseOptionalText(req.body?.createdBy ?? req.body?.created_by, "createdBy", 200);
      if (createdBy.error) {
        res.status(400).json({ error: createdBy.error });
        return;
      }

      const { document, details } = await saveCompPackageForProperty({
        propertyId: propertyId.value ?? "",
        file,
        filename,
        draft,
        packageType,
        category,
        source,
        createdBy: createdBy.value ?? null,
      });
      res.status(201).json({ propertyId: propertyId.value, document, ...details });
    } catch (err) {
      sendError(res, "Failed to upload broker comp package.", err);
    }
  }
);

/**
 * Import-surface comp upload: no property preselected. Extracts the package,
 * matches the subject address to a canonical property, and attaches the
 * package there. When no confident match exists the extraction summary plus
 * the parsed subject address come back with matched=false so the UI can ask
 * the user to pick a property and resubmit with propertyId.
 */
router.post(
  "/import/comp-package",
  (req, res, next) => {
    uploadMemory.single("file")(req, res, handleBrokerCompUploadMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname?: string; mimetype?: string } }).file;
      if (!file?.buffer) {
        res.status(400).json({ error: "Missing file. Send multipart/form-data with field 'file'." });
        return;
      }
      const requestedType = parsePackageType(req.body?.packageType ?? req.body?.package_type);
      if (requestedType.error) {
        res.status(400).json({ error: requestedType.error });
        return;
      }
      const createdBy = parseOptionalText(req.body?.createdBy ?? req.body?.created_by, "createdBy", 200);
      if (createdBy.error) {
        res.status(400).json({ error: createdBy.error });
        return;
      }
      const explicitPropertyId =
        typeof req.body?.propertyId === "string" && req.body.propertyId.trim()
          ? parseUuid(req.body.propertyId, "propertyId")
          : null;
      if (explicitPropertyId?.error) {
        res.status(400).json({ error: explicitPropertyId.error });
        return;
      }

      const pool = getPool();
      const propertyRepo = new PropertyRepo({ pool });
      const filename = file.originalname?.trim() || "broker-comp-package";
      const draft = await extractBrokerCompPackageDraft(file.buffer, filename);
      const packageType = requestedType.value ?? draft.packageType;
      const subjectAddress = subjectAddressFromDraft(draft, filename);

      let property = null;
      let matchSource: "explicit" | "subject_address" | null = null;
      if (explicitPropertyId?.value) {
        property = await propertyRepo.byId(explicitPropertyId.value);
        if (!property) {
          res.status(404).json({ error: "Property not found.", propertyId: explicitPropertyId.value });
          return;
        }
        matchSource = "explicit";
      } else if (subjectAddress) {
        const normalized = normalizeAddressLineForDisplay(subjectAddress.split(",")[0] ?? subjectAddress);
        property = await propertyRepo.findByAddressFirstLine(normalized);
        if (property) matchSource = "subject_address";
      }

      const meta = draft.packageMeta as Record<string, unknown>;
      const extractionSummary = {
        packageType,
        itemCount: draft.extractedItems.length,
        compCount: typeof meta.compCount === "number" ? meta.compCount : null,
        compsWithCapRate: typeof meta.compsWithCapRate === "number" ? meta.compsWithCapRate : null,
        psfOnlyComps: typeof meta.psfOnlyComps === "number" ? meta.psfOnlyComps : null,
        psfOnlyPackage: meta.psfOnlyPackage === true,
      };

      if (!property) {
        res.json({
          ok: true,
          matched: false,
          subjectAddress,
          extraction: extractionSummary,
          message: subjectAddress
            ? `No canonical property matched "${subjectAddress}". Pick the subject property and resubmit.`
            : "No subject address detected in the package. Pick the subject property and resubmit.",
        });
        return;
      }

      const category = parseDocumentCategory(req.body?.category, packageType);
      const source = typeof req.body?.source === "string" ? req.body.source.trim() || null : "import_comp_upload";
      const { document, details } = await saveCompPackageForProperty({
        propertyId: property.id,
        file,
        filename,
        draft,
        packageType,
        category,
        source,
        createdBy: createdBy.value ?? null,
      });
      res.status(201).json({
        ok: true,
        matched: true,
        matchSource,
        subjectAddress,
        property: { id: property.id, canonicalAddress: property.canonicalAddress },
        extraction: extractionSummary,
        document,
        ...details,
      });
    } catch (err) {
      sendError(res, "Failed to import comp package.", err);
    }
  }
);

router.post("/properties/:id/broker-comp-pricing-opinions", async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    if (propertyId.error) {
      res.status(400).json({ error: propertyId.error });
      return;
    }
    if (!isRecord(req.body)) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }

    const amount = parsePositiveNumber(req.body.amount ?? req.body.whisperPrice ?? req.body.whisper_price, "amount");
    const listedPrice = parseOptionalPositiveNumber(req.body.listedPrice ?? req.body.listed_price, "listedPrice");
    const source = parseOptionalText(req.body.source, "source", 200);
    const note = parseOptionalText(req.body.note ?? req.body.notes, "note", 10_000);
    const observedAt = parseOptionalText(req.body.observedAt ?? req.body.observed_at, "observedAt", 100);
    const createdBy = parseOptionalText(req.body.createdBy ?? req.body.created_by, "createdBy", 200);
    const error = amount.error ?? listedPrice.error ?? source.error ?? note.error ?? observedAt.error ?? createdBy.error;
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const pool = getPool();
    const price = amount.value ?? 0;
    const listed = listedPrice.value ?? null;
    const sourceLabel = source.value ?? "User";
    const documentId = randomUUID();
    const filename = "Manual whisper pricing opinion.txt";
    const body = [
      `Whisper price / pricing opinion: ${price}`,
      listed != null ? `Listed price: ${listed}` : null,
      `Source: ${sourceLabel}`,
      note.value ? `Note: ${note.value}` : null,
      observedAt.value ? `Observed at: ${observedAt.value}` : null,
    ].filter(Boolean).join("\n");
    const filePath = await saveUploadedDocument(propertyId.value ?? "", documentId, filename, Buffer.from(body, "utf-8"));
    const documentRepo = new PropertyUploadedDocumentRepo({ pool });
    const document = await documentRepo.insert({
      id: documentId,
      propertyId: propertyId.value ?? "",
      filename,
      contentType: "text/plain",
      filePath,
      category: "Broker Comp Package",
      source: sourceLabel,
      fileContent: Buffer.from(body, "utf-8"),
    });

    const discountToListedPct = listed != null ? ((listed - price) / listed) * 100 : null;
    const details = await createBrokerCompPackage(pool, {
      propertyId: propertyId.value ?? "",
      sourceDocumentId: document.id,
      packageType: "broker_opinion",
      status: "approved",
      sourceName: sourceLabel,
      parserVersion: "manual-pricing-opinion-v1",
      packageMeta: {
        entryMode: "manual",
        signalType: "whisper_price",
        listedPrice: listed,
        discountToListedPct,
      },
      createdBy: createdBy.value ?? null,
      pages: [{
        pageNumber: 1,
        pageType: "broker_opinion",
        extractionMethod: "manual",
        pageRef: "Manual entry",
        rawTextExcerpt: body,
        confidence: 1,
        reviewStatus: "accepted",
      }],
      extractedItems: [{
        itemType: "pricing_opinion",
        rawPayload: { amount: price, listedPrice: listed, note: note.value ?? null, source: sourceLabel },
        normalizedPayload: {
          amount: price,
          listedPrice: listed,
          discountToListedPct,
          source: sourceLabel,
          sourceType: "user",
          note: note.value ?? "Manual whisper price / pricing opinion",
          observedAt: observedAt.value ?? new Date().toISOString(),
          underwritingImpact: "market_signal_only",
        },
        pageRefs: [{ pageNumber: 1, label: "Manual entry" }],
        confidence: 1,
        reviewStatus: "accepted",
        selectionDecision: "watch",
        includeInDossier: false,
        analystNote: "Manual pricing opinion. Kept separate from underwriting offer assumptions.",
      }],
    });

    res.status(201).json({ propertyId: propertyId.value, document, ...details });
  } catch (err) {
    sendError(res, "Failed to save broker pricing opinion.", err);
  }
});

router.post("/properties/:id/broker-comp-packages", async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    if (propertyId.error) {
      res.status(400).json({ error: propertyId.error });
      return;
    }
    if (!isRecord(req.body)) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }

    const sourceDocumentId = parseUuid(req.body.sourceDocumentId ?? req.body.documentId, "sourceDocumentId");
    const packageType = parsePackageType(req.body.packageType ?? req.body.package_type);
    const pages = parsePages(req.body.pages);
    const extractedItems = parseExtractedItems(req.body.extractedItems ?? req.body.items);
    const rawPayload = parseOptionalRecord(req.body.rawPayload ?? req.body.raw_payload, "rawPayload");
    const normalizedPayload = parseOptionalRecord(req.body.normalizedPayload ?? req.body.normalized_payload, "normalizedPayload");
    const packageMeta = parseOptionalRecord(req.body.packageMeta ?? req.body.package_meta, "packageMeta");
    const createdBy = parseOptionalText(req.body.createdBy ?? req.body.created_by, "createdBy", 200);
    const inferredStatus: BrokerCompPackageStatus =
      (extractedItems.value?.length ?? 0) > 0 ? "needs_review" : "uploaded";
    const status = parsePackageStatus(req.body.status, inferredStatus);
    const error =
      sourceDocumentId.error ??
      packageType.error ??
      pages.error ??
      extractedItems.error ??
      rawPayload.error ??
      normalizedPayload.error ??
      packageMeta.error ??
      createdBy.error ??
      status.error;
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const details = await createBrokerCompPackage(getPool(), {
      propertyId: propertyId.value ?? "",
      sourceDocumentId: sourceDocumentId.value ?? "",
      packageType: packageType.value ?? "other",
      status: status.value ?? inferredStatus,
      rawPayload: rawPayload.value ?? null,
      normalizedPayload: normalizedPayload.value ?? null,
      packageMeta: packageMeta.value ?? null,
      createdBy: createdBy.value ?? null,
      pages: pages.value ?? [],
      extractedItems: extractedItems.value ?? [],
    });
    res.status(201).json(details);
  } catch (err) {
    sendError(res, "Failed to create broker comp package.", err);
  }
});

router.get(["/properties/:id/broker-comp-packages", "/properties/:id/broker-comps/review"], async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    if (propertyId.error) {
      res.status(400).json({ error: propertyId.error });
      return;
    }
    const includeDetails = req.path.endsWith("/broker-comps/review") || req.query.includeDetails === "true" || req.query.includeDetails === "1";
    const limit = parseLimit(req.query.limit, 50, 200);
    if (includeDetails) {
      const result = await listBrokerCompPackageDetailsForProperty(propertyId.value ?? "", limit);
      res.json({ propertyId: propertyId.value, ...result });
      return;
    }
    const packages = await listBrokerCompPackages(getPool(), propertyId.value ?? "", limit);
    res.json({ propertyId: propertyId.value, packages });
  } catch (err) {
    sendError(res, "Failed to list broker comp packages.", err);
  }
});

router.get("/properties/:id/broker-comp-promoted-items", async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    if (propertyId.error) {
      res.status(400).json({ error: propertyId.error });
      return;
    }
    const promotedItems = await listBrokerCompPromotedItems(
      getPool(),
      propertyId.value ?? "",
      parseLimit(req.query.limit, 100, 500)
    );
    res.json({ propertyId: propertyId.value, promotedItems });
  } catch (err) {
    sendError(res, "Failed to list broker comp promoted items.", err);
  }
});

router.get("/properties/:id/broker-comp-packages/:packageId", async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    const packageId = parseUuid(req.params.packageId, "packageId");
    const error = propertyId.error ?? packageId.error;
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const details = await getBrokerCompPackageDetails(getPool(), propertyId.value ?? "", packageId.value ?? "");
    res.json(details);
  } catch (err) {
    sendError(res, "Failed to load broker comp package.", err);
  }
});

router.patch("/properties/:id/broker-comp-packages/:packageId/items/:itemId/review", async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    const packageId = parseUuid(req.params.packageId, "packageId");
    const itemId = parseUuid(req.params.itemId, "itemId");
    if (!isRecord(req.body)) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }
    const reviewStatus = parseReviewStatus(req.body.reviewStatus ?? req.body.review_status, "accepted");
    const normalizedPayload = parseOptionalRecord(req.body.normalizedPayload ?? req.body.normalized_payload, "normalizedPayload");
    const reviewedPayload = parseOptionalRecord(req.body.reviewedPayload ?? req.body.reviewed_payload, "reviewedPayload");
    const pageRefs = parsePageRefs(req.body.pageRefs ?? req.body.page_refs, null, null, "pageRefs");
    const confidence = parseOptionalConfidence(req.body.confidence, "confidence");
    const selectionDecision = parseSelectionDecision(req.body.selectionDecision ?? req.body.selection_decision, "selectionDecision");
    const includeInDossier = parseOptionalBoolean(req.body.includeInDossier ?? req.body.include_in_dossier, "includeInDossier");
    const analystNote = parseOptionalText(req.body.analystNote ?? req.body.analyst_note ?? req.body.reviewerNotes ?? req.body.reviewer_notes, "analystNote", 10_000);
    const error =
      propertyId.error ??
      packageId.error ??
      itemId.error ??
      reviewStatus.error ??
      normalizedPayload.error ??
      reviewedPayload.error ??
      pageRefs.error ??
      confidence.error ??
      selectionDecision.error ??
      includeInDossier.error ??
      analystNote.error;
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const details = await reviewBrokerCompExtractedItem(getPool(), {
      propertyId: propertyId.value ?? "",
      packageId: packageId.value ?? "",
      itemId: itemId.value ?? "",
      reviewStatus: reviewStatus.value ?? "accepted",
      normalizedPayload: normalizedPayload.value ?? null,
      reviewedPayload: reviewedPayload.value ?? null,
      pageRefs: pageRefs.value,
      confidence: confidence.value ?? null,
      selectionDecision: selectionDecision.value ?? null,
      includeInDossier: includeInDossier.value,
      analystNote: analystNote.value ?? null,
    });
    res.json(details);
  } catch (err) {
    sendError(res, "Failed to review broker comp item.", err);
  }
});

router.post("/properties/:id/broker-comp-packages/:packageId/promote", async (req: Request, res: Response) => {
  try {
    const propertyId = parseUuid(req.params.id, "propertyId");
    const packageId = parseUuid(req.params.packageId, "packageId");
    if (!isRecord(req.body ?? {})) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }
    const itemIds = parseUuidList(req.body?.itemIds ?? req.body?.item_ids, "itemIds");
    const promotedBy = parseOptionalText(req.body?.promotedBy ?? req.body?.promoted_by, "promotedBy", 200);
    const error = propertyId.error ?? packageId.error ?? itemIds.error ?? promotedBy.error;
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const result = await promoteBrokerCompPackageItems(getPool(), {
      propertyId: propertyId.value ?? "",
      packageId: packageId.value ?? "",
      itemIds: itemIds.value,
      promotedBy: promotedBy.value ?? null,
    });
    res.json(result);
  } catch (err) {
    sendError(res, "Failed to promote broker comp package items.", err);
  }
});

export default router;
