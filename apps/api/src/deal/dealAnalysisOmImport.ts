import { randomUUID } from "crypto";
import type { Pool } from "pg";
import {
  getPool,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import type {
  Property,
  PropertyDetails,
  PropertyDocumentCategory,
  PropertyManualSourceLinks,
} from "@re-sourcing/contracts";
import { extractOmAnalysisFromGeminiPdfOnly } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";
import { isPdfLikeOmInputDocument } from "../om/omAnalysisShared.js";
import { resolveOmPropertyAddress } from "../om/resolveOmPropertyAddress.js";
import { saveUploadedDocument } from "../upload/uploadedDocStorage.js";
import { extractTextMetadataFromBuffer } from "../upload/extractTextFromUploadedFile.js";
import {
  buildStandaloneDetailsFromOmAnalysis,
  buildStandaloneOmCalculation,
  resolveStandalonePropertyInput,
} from "./standaloneDealAnalysis.js";
import {
  getPropertyDossierAssumptions,
  getRawPropertyDossierAssumptions,
} from "./propertyDossierState.js";
import { resolveOmAskingPriceFromDetails } from "./omAskingPrice.js";
import { getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import { promoteReviewedOmDetailsForProperty } from "../om/ingestAuthoritativeOm.js";

type JsonRecord = Record<string, unknown>;

export type DealAnalysisDraftPropertyMatchStrategy =
  | "exact_canonical"
  | "address_line"
  | "new";

export interface DealAnalysisDraftPropertyRepo {
  byCanonicalAddress(canonicalAddress: string): Promise<Property | null>;
  findByAddressFirstLine(addressLine: string): Promise<Property | null>;
  create(canonicalAddress: string): Promise<Property>;
}

export interface DealAnalysisOmInputDocument {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  sizeBytes: number;
}

export class DealAnalysisOmImportError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 422) {
    super(message);
    this.name = "DealAnalysisOmImportError";
    this.statusCode = statusCode;
  }
}

const DEAL_ANALYSIS_TEXT_CONTEXT_PER_DOCUMENT_CHARS = 45_000;
const DEAL_ANALYSIS_TEXT_CONTEXT_TOTAL_CHARS = 140_000;

function lowerDocumentName(document: Pick<DealAnalysisOmInputDocument, "filename" | "mimeType">): string {
  return `${document.filename ?? ""} ${document.mimeType ?? ""}`.toLowerCase();
}

function documentSizeLabel(sizeBytes: number | null | undefined): string {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "unknown size";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdfLikeDealAnalysisDocument(document: DealAnalysisOmInputDocument): boolean {
  return isPdfLikeOmInputDocument({
    filename: document.filename,
    mimeType: document.mimeType,
  });
}

function classifyDealAnalysisDocumentCategory(document: DealAnalysisOmInputDocument): PropertyDocumentCategory {
  const haystack = lowerDocumentName(document);
  if (/\b(rent[ _-]?roll|unit[ _-]?mix|tenant[ _-]?schedule)\b/i.test(haystack)) return "Rent Roll";
  if (/\b(t-?12|trailing[ _-]?12|operating|income[ _-]?expense|p\s*&\s*l|profit[ _-]?loss)\b/i.test(haystack)) {
    return "T12 / Operating Summary";
  }
  if (/\b(financial|model|pro[ _-]?forma|underwriting|workbook|analysis)\b/i.test(haystack)) return "Financial Model";
  if (/\b(brochure|flyer|teaser|marketing)\b/i.test(haystack)) return "Brochure";
  if (isPdfLikeDealAnalysisDocument(document) || /\b(offering|memorandum|(^|[^a-z])om([^a-z]|$))\b/i.test(haystack)) {
    return "OM";
  }
  return "Other";
}

function buildReviewMetadata(documents: DealAnalysisOmInputDocument[]): JsonRecord {
  return {
    reviewRequired: true,
    userVerified: false,
    underwritingReviewStatus: "user_review_required",
    documentClassifications: documents.map((document) => ({
      filename: document.filename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      category: classifyDealAnalysisDocumentCategory(document),
    })),
  };
}

export async function buildDealAnalysisDocumentTextContext(
  documents: DealAnalysisOmInputDocument[]
): Promise<string | null> {
  const sections: string[] = [];
  let remaining = DEAL_ANALYSIS_TEXT_CONTEXT_TOTAL_CHARS;
  for (const document of documents) {
    if (remaining <= 0) break;
    if (isPdfLikeDealAnalysisDocument(document)) continue;
    const metadata = await extractTextMetadataFromBuffer(document.buffer, document.filename);
    const text = metadata.text.trim();
    if (!text) continue;
    const maxForDocument = Math.min(remaining, DEAL_ANALYSIS_TEXT_CONTEXT_PER_DOCUMENT_CHARS);
    const clipped = text.slice(0, maxForDocument);
    const truncated = text.length > clipped.length ? "\n[truncated for LLM context]" : "";
    sections.push(
      [
        `SOURCE DOCUMENT: ${document.filename}`,
        `MIME TYPE: ${document.mimeType || "unknown"}`,
        `SIZE: ${documentSizeLabel(document.sizeBytes)}`,
        `TYPE HINT: ${classifyDealAnalysisDocumentCategory(document)}`,
        "EXTRACTED TEXT / WORKBOOK ROWS:",
        `${clipped}${truncated}`,
      ].join("\n")
    );
    remaining -= clipped.length;
  }
  if (sections.length === 0) return null;
  const omitted = documents.some((document) => !isPdfLikeDealAnalysisDocument(document)) && remaining <= 0
    ? "\n\n[Additional uploaded document text was omitted because the package exceeded the LLM context limit.]"
    : "";
  return `Broker OM / financial package text context:\n\n${sections.join("\n\n---\n\n")}${omitted}`;
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

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function mergeAssumptionsPatch(
  details: PropertyDetails | null | undefined,
  patch: JsonRecord
): JsonRecord {
  return {
    ...(getRawPropertyDossierAssumptions(details) ?? {}),
    ...(getPropertyDossierAssumptions(details) ?? {}),
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

export async function analyzeAndPersistDealAnalysisOmDocuments(params: {
  documents: DealAnalysisOmInputDocument[];
  sourceType: "deal_analysis_upload" | "deal_analysis_om_link" | "pipeline_document_upload";
  sourceLabel: string;
  targetPropertyId?: string | null;
  propertyContext?: string | null;
  sourceMetadata?: JsonRecord | null;
  pool?: Pool;
}) {
  if (params.documents.length === 0) {
    throw new DealAnalysisOmImportError("No OM or broker financial documents were provided.", 400);
  }

  const textContext = await buildDealAnalysisDocumentTextContext(params.documents);
  const hasPdfDocument = params.documents.some(isPdfLikeDealAnalysisDocument);
  if (!hasPdfDocument && !textContext) {
    throw new DealAnalysisOmImportError(
      "The uploaded package did not include a readable PDF, spreadsheet, CSV, or text document.",
      422
    );
  }
  const reviewMetadata = buildReviewMetadata(params.documents);
  const sourceMetadata = {
    ...(params.sourceMetadata ?? {}),
    ...reviewMetadata,
  };
  const uploadedFileContext = `Uploaded source files:\n${params.documents
    .map((document) => `- ${document.filename} (${document.mimeType || "unknown"}, ${documentSizeLabel(document.sizeBytes)}, ${classifyDealAnalysisDocumentCategory(document)})`)
    .join("\n")}`;
  const extracted = await extractOmAnalysisFromGeminiPdfOnly({
    documents: params.documents.map((document) => ({
      filename: document.filename,
      mimeType: document.mimeType,
      buffer: document.buffer,
    })),
    propertyContext:
      [params.propertyContext, uploadedFileContext].filter(Boolean).join("\n\n") ||
      params.documents.map((document) => document.filename).join(", "),
    enrichmentContext: textContext,
  });
  if (!extracted.omAnalysis) {
    throw new DealAnalysisOmImportError(
      extracted.parseError
        ? `Failed to parse OM / financial package: ${extracted.parseError}`
        : "The OM / financial package did not return structured property details."
    );
  }

  const details = buildStandaloneDetailsFromOmAnalysis({
    omAnalysis: extracted.omAnalysis,
    fromLlm: extracted.fromLlm ?? null,
    uploadedDocuments: params.documents.map((document) => ({
      fileName: document.filename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    })),
  });
  const resolvedAddress = resolveOmPropertyAddress(
    (extracted.omAnalysis.propertyInfo as Record<string, unknown> | null | undefined) ?? null
  );
  if (!resolvedAddress) {
    throw new DealAnalysisOmImportError(
      "The OM analysis did not return a usable building address, so a property workspace could not be created."
    );
  }

  const pool = params.pool ?? getPool();
  const client = await pool.connect();
  let propertyId = "";
  let canonicalAddress = resolvedAddress.canonicalAddress;
  let createdProperty = false;
  let matchStrategy: DealAnalysisDraftPropertyMatchStrategy = "new";
  try {
    await client.query("BEGIN");
    const propertyRepo = new PropertyRepo({ pool, client });
    const targetPropertyId = trimmedString(params.targetPropertyId);
    const targetProperty = targetPropertyId ? await propertyRepo.byId(targetPropertyId) : null;
    if (targetPropertyId && !targetProperty) {
      throw new DealAnalysisOmImportError("Target property not found.", 404);
    }
    const draftProperty = targetProperty
      ? {
          property: targetProperty,
          createdProperty: false,
          matchStrategy: "exact_canonical" as const,
        }
      : await findOrCreateDealAnalysisDraftProperty({
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
        ? (existingDetails.dealAnalysisWorkspace as JsonRecord)
        : {};
    const manualSourceLinks = mergeManualSourceLinks(existingDetails, {
      omImportedAt: now,
      ...(typeof params.sourceMetadata?.omUrl === "string" ? { omUrl: params.sourceMetadata.omUrl } : {}),
    });
    await propertyRepo.updateDetails(propertyId, "manualSourceLinks", {
      ...(manualSourceLinks as JsonRecord),
    });
    await propertyRepo.mergeDetails(propertyId, {
      dealAnalysisWorkspace: {
        ...existingWorkspace,
        status: "draft",
        reviewRequired: true,
        analysisVerified: false,
        analysisVerifiedAt: null,
        underwritingReviewStatus: "user_review_required",
        source: params.sourceType,
        createdAt:
          typeof existingWorkspace.createdAt === "string" ? existingWorkspace.createdAt : now,
        updatedAt: now,
        lastUploadedAt: now,
        uploadedFileNames: params.documents.map((document) => document.filename),
        documentClassifications: reviewMetadata.documentClassifications,
        sourceMetadata,
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
  for (const document of params.documents) {
    const docId = randomUUID();
    const filePath = await saveUploadedDocument(propertyId, docId, document.filename, document.buffer);
    const category = classifyDealAnalysisDocumentCategory(document);
    const inserted = await uploadedDocRepo.insert({
      id: docId,
      propertyId,
      filename: document.filename,
      contentType: document.mimeType,
      filePath,
      category,
      source: params.sourceLabel,
      sourceMetadata: {
        sourceType: params.sourceType,
        workspaceStatus: "draft",
        reviewRequired: true,
        userVerified: false,
        underwritingReviewStatus: "user_review_required",
        ...(sourceMetadata ?? {}),
      },
      fileContent: document.buffer,
    });
    persistedDocuments.push({
      id: inserted.id,
      fileName: inserted.filename,
      contentType: inserted.contentType,
      category,
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
        ? (currentDetails.dealAnalysisWorkspace as JsonRecord)
        : {};
    const manualSourceLinks = mergeManualSourceLinks(currentDetails, {
      ...(typeof params.sourceMetadata?.omUrl === "string" ? { omUrl: params.sourceMetadata.omUrl } : {}),
      omImportedAt: primaryOmDocument.createdAt,
      omDocumentId: primaryOmDocument.id,
      omFileName: primaryOmDocument.fileName,
    });
    await propertyRepo.mergeDetails(propertyId, {
      manualSourceLinks,
      dealAnalysisWorkspace: {
        ...currentWorkspace,
        status: "draft",
        reviewRequired: true,
        analysisVerified: false,
        analysisVerifiedAt: null,
        underwritingReviewStatus: "user_review_required",
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
          sourceType: params.sourceType,
          workspaceStatus: "draft",
          reviewRequired: true,
          userVerified: false,
          underwritingReviewStatus: "user_review_required",
          ...sourceMetadata,
          documents: persistedDocuments.map((document) => ({
            id: document.id,
            filename: document.fileName,
            contentType: document.contentType ?? null,
            category: document.category ?? null,
            createdAt: document.createdAt,
          })),
          review: {
            decision: "promoted",
            reviewedVia: params.sourceType,
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
  const propertyRecord = await propertyRepo.byId(propertyId);
  const savedDetails = (propertyRecord?.details ?? details) as PropertyDetails;
  const savedPropertyInput = resolveWorkspaceProperty(savedDetails);
  const savedCalculation = (
    await buildStandaloneOmCalculation({
      property: savedPropertyInput,
      details: savedDetails,
    })
  ).calculation;

  return {
    ok: true,
    property: savedPropertyInput,
    propertyId,
    canonicalAddress,
    createdProperty,
    matchStrategy,
    resolvedAddress,
    matchedProperty: {
      id: propertyId,
      canonicalAddress,
      matchStrategy,
    },
    uploadedDocuments: persistedDocuments.map((document, index) => ({
      id: document.id,
      fileName: document.fileName,
      mimeType: document.contentType ?? "application/pdf",
      category: document.category ?? null,
      sizeBytes: params.documents[index]?.sizeBytes ?? null,
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
  };
}
