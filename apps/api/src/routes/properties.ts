/**
 * Canonical properties API: list, create from raw listings, link matches.
 * Optionally runs permit + 7 enrichment modules after creating/linking properties.
 */

import { Router, type Request, type Response } from "express";
import {
  getPool,
  ListingRepo,
  PropertyRepo,
  MatchRepo,
  SnapshotRepo,
  PermitRepo,
  PropertyEnrichmentStateRepo,
  HpdViolationsRepo,
  DobComplaintsRepo,
  HousingLitigationsRepo,
  InquiryEmailRepo,
  InquiryDocumentRepo,
  InquirySendRepo,
  PropertyUploadedDocumentRepo,
  DealSignalsRepo,
  DealScoreOverridesRepo,
  DocumentRepo,
  PropertyActionItemRepo,
  RecipientResolutionRepo,
  OmExtractedSnapshotRepo,
  OmIngestionRunRepo,
  SavedDealsRepo,
  UserProfileRepo,
} from "@re-sourcing/db";
import {
  deriveListingActivitySummary,
  type AgentEnrichmentEntry,
  type PriceHistoryEntry,
  type PropertyDocumentCategory,
  type PropertyManualSourceLinks,
  type RecipientContactCandidate,
} from "@re-sourcing/contracts";
import multer from "multer";
import { randomUUID } from "crypto";
import { resolveInquiryFilePath } from "../inquiry/storage.js";
import { saveUploadedDocument, resolveUploadedDocFilePath, deleteUploadedDocumentFile, uploadedDocFileExists } from "../upload/uploadedDocStorage.js";
import { sendMessage as gmailSendMessage } from "../inquiry/gmailClient.js";
import { findBrokerPropertyConversationHistory } from "../inquiry/gmailConversationHistory.js";
import { buildBrokerTeamRecords, findBrokerTeamOverlapMatches } from "../inquiry/brokerTeamOverlap.js";
import type { PropertyDetails, RentalFinancials, RentalFinancialsFromLlm } from "@re-sourcing/contracts";
import { runEnrichmentForProperty } from "../enrichment/runEnrichment.js";
import { normalizeAddressLineForDisplay, getBBLForProperty } from "../enrichment/resolvePropertyBBL.js";
import { runRentalApiStep } from "../rental/rentalApiClient.js";
import { extractRentalFinancialsFromListing } from "../rental/extractRentalFinancialsFromListing.js";
import { suggestRentalDataGaps } from "../rental/suggestRentalDataGaps.js";
import { getRentRollComparison } from "../rental/rentRollComparison.js";
import { fetchNyDosEntityByName } from "../enrichment/nyDosEntity.js";
import { fetchAcrisDocumentsByOwnerName } from "../enrichment/acrisDocuments.js";
import {
  brokerLookupContextFromListing,
  enrichBrokers,
  hasMeaningfulBrokerEnrichment,
  mergeBrokerEnrichment,
} from "../enrichment/brokerEnrichment.js";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import { getPersistedDossierSignals } from "../deal/persistedDossierSignals.js";
import {
  getPropertyDossierAssumptions,
  getRawPropertyDossierAssumptions,
  getPropertyDossierSummary,
  hasCompletedDealDossier,
  parsePropertyDealDossierExpenseModelRows,
  parsePropertyDealDossierUnitModelRows,
} from "../deal/propertyDossierState.js";
import { buildOmCalculationSnapshot } from "../deal/buildOmCalculation.js";
import type { DossierAssumptionOverrides } from "../deal/underwritingModel.js";
import { resolveGeneratedDocPath, deleteGeneratedDocumentFile } from "../deal/generatedDocStorage.js";
import { unlink } from "fs/promises";
import { extname } from "path";
import {
  createWorkflowRun,
  deriveWorkflowStatusFromCounts,
  listWorkflowRuns,
  mergeWorkflowRunMetadata,
  updateWorkflowRun,
  upsertWorkflowStep,
  WORKFLOW_BOARD_COLUMNS,
} from "../workflow/workflowTracker.js";
import type { WorkflowRunStepSeed } from "../workflow/workflowTracker.js";
import {
  getPrimaryListingForProperty,
  setManualRecipientResolution,
  syncPropertySourcingWorkflow,
  syncRecipientResolution,
} from "../sourcing/workflow.js";
import { normalizeStreetEasySaleDetails } from "../sourcing/normalizeStreetEasyListing.js";
import { withRefreshPriceHistory } from "../sourcing/priceHistoryRefresh.js";
import {
  ingestAuthoritativeOm,
  promoteOmExtractionForProperty,
  refreshAuthoritativeOmForProperty,
  rejectOmExtractionForProperty,
  type OmAutomationDocument,
} from "../om/ingestAuthoritativeOm.js";
import { extractStreetEasySaleIdFromUrl, fetchSaleDetailsById, fetchSaleDetailsByUrl, normalizeStreeteasyUrl } from "../nycRealEstateApi.js";
import { extractOmAnalysisFromGeminiPdfOnly } from "../om/extractOmAnalysisFromGeminiPdfOnly.js";
import { resolveOmPropertyAddress } from "../om/resolveOmPropertyAddress.js";
import {
  downloadOmDocument,
  formatByteLimit,
  resolveOmImportMaxBytes,
} from "../upload/downloadOmDocument.js";
import {
  analyzeAndPersistDealAnalysisOmDocuments,
  DealAnalysisOmImportError,
} from "../deal/dealAnalysisOmImport.js";
import { runGenerateDossier } from "../deal/runGenerateDossier.js";

const router = Router();

const ENRICHMENT_RATE_LIMIT_DELAY_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300;
const ENABLE_OM_AUTOMATION_V2 = process.env.ENABLE_OM_AUTOMATION_V2 === "1";
const OM_IMPORT_MAX_BYTES = resolveOmImportMaxBytes();
const OM_IMPORT_MAX_LABEL = formatByteLimit(OM_IMPORT_MAX_BYTES);
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

function normalizeManualUrl(
  value: unknown,
  options?: { requireStreetEasyHost?: boolean }
): string | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return "invalid";
    if (options?.requireStreetEasyHost) {
      const host = parsed.hostname.toLowerCase();
      if (host !== "streeteasy.com" && !host.endsWith(".streeteasy.com")) return "invalid";
    }
    return trimmed;
  } catch {
    return "invalid";
  }
}

function normalizeStreetEasySaleId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  return /^\d+$/.test(raw) ? raw : null;
}

function readManualSourceLinks(details: PropertyDetails | null | undefined): PropertyManualSourceLinks {
  const raw = details?.manualSourceLinks;
  if (!raw || typeof raw !== "object") return {};
  return raw as PropertyManualSourceLinks;
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

function coerceNonNegativeDetailNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = parseFloat(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function buildPropertyDetailsMergeFromListing(listing: {
  lat?: number | null;
  lon?: number | null;
  extra?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const merge: Record<string, unknown> = {};
  if (
    listing.lat != null &&
    typeof listing.lat === "number" &&
    !Number.isNaN(listing.lat) &&
    listing.lon != null &&
    typeof listing.lon === "number" &&
    !Number.isNaN(listing.lon)
  ) {
    merge.lat = listing.lat;
    merge.lon = listing.lon;
  }
  const extra = listing.extra;
  if (extra && typeof extra === "object") {
    const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
    const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
    const bblStr = typeof bbl === "string" && /^\d{10}$/.test(bbl.trim()) ? bbl.trim() : null;
    if (bblStr) {
      merge.bbl = bblStr;
      if (typeof bin === "string" && bin.trim()) merge.bin = bin.trim();
    }
    const monthlyHoa = coerceNonNegativeDetailNumber(extra.monthlyHoa ?? extra.monthly_hoa ?? extra.hoa);
    const monthlyTax = coerceNonNegativeDetailNumber(extra.monthlyTax ?? extra.monthly_tax ?? extra.tax);
    if (monthlyHoa != null) merge.monthlyHoa = monthlyHoa;
    if (monthlyTax != null) merge.monthlyTax = monthlyTax;
  }
  return merge;
}

function detectImportedDocumentCategory(label: string | null | undefined, url: string | null | undefined): PropertyDocumentCategory {
  const text = `${label ?? ""} ${url ?? ""}`.toLowerCase();
  if (/market[ _-]?analysis|comp(arable)?s?[ _-]?(package|set|book)?|broker[ _-]?comp/.test(text)) return "Broker Comp Package";
  if (/sale[ _-]?comp|cap[ _-]?rate[ _-]?comp|noi[ _-]?comp|whisper/.test(text)) return "Sale Comp Package";
  if (/rent[ _-]?comp|lease[ _-]?comp/.test(text)) return "Rent Comp Package";
  if (/expense[ _-]?comp|opex[ _-]?comp/.test(text)) return "Expense Comp Package";
  if (/rent[ _-]?roll/.test(text)) return "Rent Roll";
  if (/t-?12|operating|income[ _-]?expense/.test(text)) return "T12 / Operating Summary";
  if (/model|proforma|pro-forma|xlsx|xls/.test(text)) return "Financial Model";
  if (/brochure|flyer/.test(text)) return "Brochure";
  if (/offering|memorandum|\bom\b/.test(text)) return "OM";
  return "Other";
}

function loopNetAttachmentRecords(extra: Record<string, unknown> | null | undefined): Array<Record<string, unknown>> {
  const attachments = extra?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((attachment): attachment is Record<string, unknown> => {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return false;
    const url = attachment.url;
    const source = attachment.source;
    const ready =
      attachment.downloadableWithoutAuth === true ||
      attachment.handoffStatus === "ready_for_document_import" ||
      /\.pdf(?:[?#]|$)/i.test(typeof url === "string" ? url : "");
    return source === "loopnet" && typeof url === "string" && /^https?:\/\//i.test(url) && ready;
  });
}

async function importLoopNetPublicDocumentsForProperty(params: {
  propertyId: string;
  listingId: string;
  listingUrl: string;
  extra: Record<string, unknown> | null | undefined;
  pool: import("pg").Pool;
}): Promise<{ imported: number; skipped: number; errors: string[]; documentIds: string[] }> {
  const attachments = loopNetAttachmentRecords(params.extra);
  if (attachments.length === 0) return { imported: 0, skipped: 0, errors: [], documentIds: [] };
  const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool: params.pool });
  const existingDocs = await uploadedDocRepo.listByPropertyId(params.propertyId);
  const existingSourceUrls = new Set(existingDocs.map((doc) => doc.sourceUrl).filter(Boolean));
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const documentIds: string[] = [];
  for (const attachment of attachments) {
    const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
    if (!url || existingSourceUrls.has(url)) {
      skipped++;
      continue;
    }
    try {
      const downloaded = await downloadOmDocument(url, { maxBytes: OM_IMPORT_MAX_BYTES });
      const docId = randomUUID();
      const filePath = await saveUploadedDocument(params.propertyId, docId, downloaded.filename, downloaded.buffer);
      const label = typeof attachment.label === "string" ? attachment.label : null;
      const inserted = await uploadedDocRepo.insert({
        id: docId,
        propertyId: params.propertyId,
        filename: downloaded.filename,
        contentType: downloaded.contentType,
        filePath,
        category: detectImportedDocumentCategory(label, url),
        source: "loopnet",
        sourceUrl: downloaded.resolvedUrl || url,
        sourceMetadata: {
          source: "loopnet",
          originalUrl: url,
          resolvedUrl: downloaded.resolvedUrl,
          listingId: params.listingId,
          listingUrl: params.listingUrl,
          attachment,
          importedAt: new Date().toISOString(),
        },
        fileContent: downloaded.buffer,
      });
      existingSourceUrls.add(url);
      existingSourceUrls.add(downloaded.resolvedUrl);
      imported++;
      documentIds.push(inserted.id);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { imported, skipped, errors, documentIds };
}

async function refreshStreetEasyListingForProperty(
  propertyId: string,
  pool: import("pg").Pool
): Promise<{ attempted: boolean; ok: boolean; priceChanged: boolean; unavailable: boolean; listingStatus?: string | null; error?: string }> {
  const listing = await getPrimaryListingForProperty(propertyId, pool);
  const listingUrl = listing?.url?.trim() ?? "";
  const saleId = listingUrl ? extractStreetEasySaleIdFromUrl(listingUrl) : null;
  const isStreetEasyListing =
    listing?.source === "streeteasy" ||
    listing?.source === "nyc_api" ||
    (listingUrl ? extractStreetEasySaleIdFromUrl(listingUrl) != null || /streeteasy\.com/i.test(listingUrl) : false);
  if (!listing || !isStreetEasyListing || (!listingUrl && !saleId)) {
    return { attempted: false, ok: false, priceChanged: false, unavailable: false };
  }

  try {
    const normalizedUrl = listingUrl ? normalizeStreeteasyUrl(listingUrl) : saleId ? `https://streeteasy.com/sale/${saleId}` : "";
    let raw: Record<string, unknown>;
    if (saleId) {
      try {
        raw = await fetchSaleDetailsById(saleId);
      } catch (error) {
        if (!listingUrl) throw error;
        raw = await fetchSaleDetailsByUrl(listingUrl);
      }
    } else {
      raw = await fetchSaleDetailsByUrl(listingUrl);
    }

    const normalized = normalizeStreetEasySaleDetails(
      {
        ...raw,
        id: raw.id ?? raw.listing_id ?? saleId ?? listing.externalId,
        _fetchUrl: normalizedUrl || listingUrl,
      },
      0
    );
    const listingStatus = refreshedListingStatus(normalized);
    const listingUnavailable = isUnavailableStreetEasyStatus(listingStatus, refreshedListingInContract(normalized));
    const oldPrice = Number(listing.price);
    const newPrice = Number(normalized.price);
    const priceChanged = Number.isFinite(oldPrice) && Number.isFinite(newPrice) && Math.abs(oldPrice - newPrice) >= 1;

    const listingRepo = new ListingRepo({ pool });
    const snapshotRepo = new SnapshotRepo({ pool });
    const propertyRepo = new PropertyRepo({ pool });
    const matchRepo = new MatchRepo({ pool });
    const actionRepo = new PropertyActionItemRepo({ pool });
    const previousSnapshot = (await snapshotRepo.list({ listingId: listing.id, limit: 1 })).snapshots[0] ?? null;
    Object.assign(normalized, withRefreshPriceHistory({ normalized, existing: listing, previousSnapshot }));
    normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? listing.rentalPriceHistory ?? null;

    const sourceAgentEnrichment = normalized.agentEnrichment ?? null;
    if (Array.isArray(normalized.agentNames) && normalized.agentNames.length > 0) {
      try {
        const context = brokerLookupContextFromListing(normalized);
        const lookedUp = await enrichBrokers(normalized.agentNames, context);
        const merged = mergeBrokerEnrichment(normalized.agentNames, sourceAgentEnrichment, lookedUp, context);
        if (hasMeaningfulBrokerEnrichment(merged)) normalized.agentEnrichment = merged;
        else if (hasMeaningfulBrokerEnrichment(sourceAgentEnrichment)) normalized.agentEnrichment = sourceAgentEnrichment;
        else if (listing.agentEnrichment?.length) normalized.agentEnrichment = listing.agentEnrichment;
      } catch {
        if (listing.agentEnrichment?.length) normalized.agentEnrichment = listing.agentEnrichment;
        else if (hasMeaningfulBrokerEnrichment(sourceAgentEnrichment)) normalized.agentEnrichment = sourceAgentEnrichment;
      }
    } else if (listing.agentEnrichment?.length) {
      normalized.agentEnrichment = listing.agentEnrichment;
    }

    const upserted = await listingRepo.upsert(normalized, { uploadedRunId: null });
    if (listingUnavailable) {
      await listingRepo.setLifecycle(upserted.listing.id, "missing");
      await actionRepo.upsertOpen(propertyId, "review_listing_unavailable", {
        priority: "high",
        summary: `StreetEasy status is ${listingStatus ?? "unavailable"}; review/remove from pipeline`,
        details: {
          listingId: upserted.listing.id,
          listingUrl: normalized.url,
          listingStatus,
          source: "streeteasy_refresh",
        },
      });
    } else {
      await listingRepo.setLifecycle(upserted.listing.id, "active");
      await actionRepo.resolve(propertyId, "review_listing_unavailable");
    }
    if (upserted.listing.id !== listing.id) {
      await matchRepo.create({
        listingId: upserted.listing.id,
        propertyId,
        confidence: 1,
        reasons: {
          addressMatch: true,
          normalizedAddressDistance: 0,
          other: ["street_easy_refresh"],
        },
      });
    }
    await snapshotRepo.create({
      listingId: upserted.listing.id,
      runId: null,
      rawPayloadPath: "inline",
      metadata: {
        refreshSource: "street_easy_selected_refresh",
        propertyId,
        capturedAt: new Date().toISOString(),
        rawPayload: { ...raw, _fetchUrl: normalizedUrl || listingUrl },
        agentEnrichment: normalized.agentEnrichment ?? null,
        priceHistory: normalized.priceHistory ?? null,
        rentalPriceHistory: normalized.rentalPriceHistory ?? null,
        normalizedListing: normalized as unknown as Record<string, unknown>,
        priceChanged,
        listingUnavailable,
        listingStatus,
        previousPrice: Number.isFinite(oldPrice) ? oldPrice : null,
        currentPrice: Number.isFinite(newPrice) ? newPrice : null,
      },
    });
    const detailsMerge = buildPropertyDetailsMergeFromListing(normalized);
    if (Object.keys(detailsMerge).length > 0) await propertyRepo.mergeDetails(propertyId, detailsMerge);
    await refreshPropertyPipelineMetadata(propertyId, pool);
    return { attempted: true, ok: true, priceChanged, unavailable: listingUnavailable, listingStatus };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      priceChanged: false,
      unavailable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isMissingPropertyScoringSchemaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  const missingRelation = code === "42P01";
  const missingColumn = code === "42703";
  if (!(missingRelation || missingColumn)) return false;
  return normalized.includes("deal_signals")
    || normalized.includes("deal_score_overrides")
    || normalized.includes("score_breakdown")
    || normalized.includes("risk_profile")
    || normalized.includes("risk_flags")
    || normalized.includes("cap_reasons")
    || normalized.includes("confidence_score")
    || normalized.includes("score_sensitivity")
    || normalized.includes("score_version");
}

type PropertyPipelineStatus =
  | "new_sourced"
  | "enrichment_running"
  | "enrichment_complete"
  | "needs_om"
  | "om_requested"
  | "follow_up_needed"
  | "om_received"
  | "underwriting"
  | "saved_watchlist"
  | "loi_sent"
  | "negotiation"
  | "contract_signed"
  | "diligence_escrow"
  | "closed"
  | "rejected_removed";

type PropertyOmPipelineStatus =
  | "not_needed_yet"
  | "needed"
  | "requested"
  | "follow_up_needed"
  | "received"
  | "reviewed"
  | "missing_documents";

type PropertyJobStatus = "not_started" | "queued" | "running" | "complete" | "failed" | "needs_manual_review" | "insufficient_data";

type PropertyUnderwritingStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "needs_assumptions"
  | "needs_rent_roll"
  | "needs_partner_review";

interface PropertyPipelineState {
  status: PropertyPipelineStatus;
  omStatus: PropertyOmPipelineStatus;
  enrichmentStatus: PropertyJobStatus;
  rentalFlowStatus: PropertyJobStatus;
  underwritingStatus: PropertyUnderwritingStatus;
  dossierStatus: PropertyJobStatus;
  excelStatus: PropertyJobStatus;
  tags: string[];
  missingFields: string[];
  actionRequired: string[];
  rejectedAt: string | null;
  rejectionReason: string | null;
  source: string | null;
  sourceLinks: Record<string, unknown>;
  lastActivityAt: string;
}

const DEFAULT_PIPELINE_TAGS = [
  "property_toured",
  "high_priority",
  "follow_up",
  "broker_relationship",
  "off_market",
  "distressed_seller",
  "below_replacement_cost",
  "tax_class_advantage",
  "free_market_focus",
  "rent_stabilized_risk",
  "needs_city_data",
  "needs_rent_roll",
  "needs_om",
  "good_mtr_candidate",
  "rejected",
  "duplicate",
  "partner_review_needed",
];

function normalizedListingExtra(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function refreshedListingStatus(normalized: { extra?: Record<string, unknown> | null }): string | null {
  const extra = normalizedListingExtra(normalized.extra);
  return stringField(
    extra.listingStatus ??
      extra.listing_status ??
      extra.saleStatus ??
      extra.sale_status ??
      extra.marketStatus ??
      extra.market_status ??
      extra.status
  );
}

function refreshedListingInContract(normalized: { extra?: Record<string, unknown> | null }): boolean {
  const extra = normalizedListingExtra(normalized.extra);
  const raw = extra.inContract ?? extra.in_contract ?? extra.isInContract ?? extra.is_in_contract;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return ["true", "yes", "1"].includes(raw.trim().toLowerCase());
  return false;
}

function isUnavailableStreetEasyStatus(status: string | null | undefined, inContract: boolean): boolean {
  if (inContract) return true;
  if (!status) return false;
  return /\b(off[-_\s]?market|in[-_\s]?contract|contract|pending|sold|closed|delisted|withdrawn|unavailable|temporarily\s+off)\b/i.test(status);
}

function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || null;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

function readPropertyPipelineState(details: unknown): PropertyPipelineState {
  const detailRecord = isPlainRecord(details) ? details : {};
  const pipeline = isPlainRecord(detailRecord.pipeline) ? detailRecord.pipeline : {};
  const now = new Date().toISOString();
  return {
    status: (typeof pipeline.status === "string" ? pipeline.status : "new_sourced") as PropertyPipelineStatus,
    omStatus: (typeof pipeline.omStatus === "string" ? pipeline.omStatus : "needed") as PropertyOmPipelineStatus,
    enrichmentStatus: (typeof pipeline.enrichmentStatus === "string" ? pipeline.enrichmentStatus : "not_started") as PropertyJobStatus,
    rentalFlowStatus: (typeof pipeline.rentalFlowStatus === "string" ? pipeline.rentalFlowStatus : "not_started") as PropertyJobStatus,
    underwritingStatus: (typeof pipeline.underwritingStatus === "string" ? pipeline.underwritingStatus : "not_started") as PropertyUnderwritingStatus,
    dossierStatus: (typeof pipeline.dossierStatus === "string" ? pipeline.dossierStatus : "not_started") as PropertyJobStatus,
    excelStatus: (typeof pipeline.excelStatus === "string" ? pipeline.excelStatus : "not_started") as PropertyJobStatus,
    tags: uniqueStrings(Array.isArray(pipeline.tags) ? pipeline.tags : Array.isArray(detailRecord.tags) ? detailRecord.tags : []),
    missingFields: uniqueStrings(Array.isArray(pipeline.missingFields) ? pipeline.missingFields : []),
    actionRequired: uniqueStrings(Array.isArray(pipeline.actionRequired) ? pipeline.actionRequired : []),
    rejectedAt: typeof pipeline.rejectedAt === "string" && pipeline.rejectedAt.trim() ? pipeline.rejectedAt : null,
    rejectionReason: typeof pipeline.rejectionReason === "string" && pipeline.rejectionReason.trim() ? pipeline.rejectionReason : null,
    source: typeof pipeline.source === "string" && pipeline.source.trim() ? pipeline.source : null,
    sourceLinks: isPlainRecord(pipeline.sourceLinks) ? pipeline.sourceLinks : {},
    lastActivityAt: typeof pipeline.lastActivityAt === "string" && pipeline.lastActivityAt.trim() ? pipeline.lastActivityAt : now,
  };
}

function numericFromPath(root: unknown, path: string[]): number | null {
  let current: unknown = root;
  for (const part of path) {
    if (!isPlainRecord(current)) return null;
    current = current[part];
  }
  if (typeof current === "number" && Number.isFinite(current)) return current;
  if (typeof current === "string" && current.trim()) {
    const parsed = Number(current.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasAnyRecordValue(root: unknown, paths: string[][]): boolean {
  return paths.some((path) => {
    let current: unknown = root;
    for (const part of path) {
      if (!isPlainRecord(current)) return false;
      current = current[part];
    }
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current === "string") return current.trim().length > 0;
    if (Array.isArray(current)) return current.length > 0;
    return current != null;
  });
}

function sourceLinksFromDetails(details: Record<string, unknown>, listing: Awaited<ReturnType<typeof getPrimaryListingForProperty>> | null) {
  const manualSourceLinks = isPlainRecord(details.manualSourceLinks) ? details.manualSourceLinks : {};
  const links: Record<string, unknown> = { ...manualSourceLinks };
  if (listing?.url) links.listingUrl = listing.url;
  return links;
}

async function refreshPropertyPipelineMetadata(
  propertyId: string,
  pool: import("pg").Pool,
  overrides: Partial<PropertyPipelineState> = {}
): Promise<PropertyPipelineState | null> {
  const propertyRepo = new PropertyRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) return null;

  const details = isPlainRecord(property.details) ? property.details : {};
  const existing = readPropertyPipelineState(details);
  const [uploadedDocs, inquiryDocs, generatedDocs, listing, recipient] = await Promise.all([
    new PropertyUploadedDocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new InquiryDocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new DocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    getPrimaryListingForProperty(propertyId, pool).catch(() => null),
    new RecipientResolutionRepo({ pool }).get(propertyId).catch(() => null),
  ]);

  const generatedSources = new Set(generatedDocs.map((doc) => doc.source));
  const uploadedCategories = new Set(uploadedDocs.map((doc) => doc.category));
  const inquiryFileNames = inquiryDocs.map((doc) => doc.filename);
  const hasOmDocument =
    uploadedCategories.has("OM") ||
    uploadedCategories.has("Brochure") ||
    inquiryFileNames.some(looksLikeOmStyleFilename) ||
    hasAnyRecordValue(details, [["omData", "authoritative"]]);
  const hasRentRoll =
    uploadedCategories.has("Rent Roll") ||
    inquiryFileNames.some((filename) => /rent[ _-]?roll/i.test(filename)) ||
    hasAnyRecordValue(details, [["omData", "authoritative", "rentRoll"], ["rentalFinancials", "omAnalysis", "rentRoll"]]);
  const hasT12 =
    uploadedCategories.has("T12 / Operating Summary") ||
    inquiryFileNames.some((filename) => /(t-?12|operating|expense|financial)/i.test(filename));
  const hasBrokerContact =
    Boolean(recipient?.contactEmail) ||
    Boolean(listing?.agentEnrichment?.some((agent) => typeof agent.email === "string" && agent.email.trim().length > 0));
  const hasRentalFlow = hasAnyRecordValue(details, [["rentalFinancials", "lastUpdatedAt"], ["rentalFinancials", "rentalUnits"]]);
  const hasCityEnrichment =
    hasAnyRecordValue(details, [["bbl"], ["buildingLotBlock"], ["enrichment"]]) ||
    Object.keys(isPlainRecord(details.enrichment) ? details.enrichment : {}).length > 0;
  const hasDossier = hasCompletedDealDossier(property.details as PropertyDetails | null);
  const hasAssumptions = Boolean(getRawPropertyDossierAssumptions(property.details as PropertyDetails | null));
  const hasAskingPrice =
    listing?.price != null ||
    hasAnyRecordValue(details, [
      ["askingPrice"],
      ["purchasePrice"],
      ["dealDossier", "assumptions", "purchasePrice"],
      ["omData", "authoritative", "propertyInfo", "askingPrice"],
    ]);
  const unitCount =
    numericFromPath(details, ["unitCount"]) ??
    numericFromPath(details, ["dealDossier", "assumptions", "unitCount"]) ??
    numericFromPath(details, ["rentalFinancials", "fromLlm", "unitCount"]);
  const rentalUnits = isPlainRecord(details.rentalFinancials) && Array.isArray(details.rentalFinancials.rentalUnits)
    ? details.rentalFinancials.rentalUnits.length
    : 0;
  const hasUnitCount = (unitCount != null && unitCount > 0) || rentalUnits > 0;
  const hasBuildingSqft = hasAnyRecordValue(details, [
    ["buildingSqft"],
    ["assessedGrossSqft"],
    ["assessedResidentialAreaGross"],
    ["dealDossier", "assumptions", "buildingSqft"],
    ["omData", "authoritative", "propertyInfo", "buildingSqft"],
  ]);
  const hasTaxClass = hasAnyRecordValue(details, [["taxClass"], ["taxCode"], ["enrichment", "taxClass"]]);
  const lastInquirySentAt = await pool.query<{ sent_at: Date | string }>(
    "SELECT sent_at FROM property_inquiry_sends WHERE property_id = $1 ORDER BY sent_at DESC NULLS LAST LIMIT 1",
    [propertyId]
  ).then((result) => result.rows[0]?.sent_at ?? null).catch(() => null);

  const missingFields = uniqueStrings([
    hasAskingPrice ? null : "asking_price",
    hasUnitCount ? null : "unit_count",
    hasBuildingSqft ? null : "building_sqft",
    hasBrokerContact ? null : "broker_contact",
    hasOmDocument ? null : "om",
    hasRentRoll ? null : "rent_roll",
    hasT12 ? null : "t12",
    hasTaxClass ? null : "tax_class",
    hasCityEnrichment ? null : "city_enrichment",
    hasRentalFlow ? null : "rental_flow",
    hasAssumptions ? null : "underwriting_assumptions",
    hasDossier ? null : "dossier",
    generatedSources.has("generated_excel") ? null : "excel_export",
  ]);
  const rejected = overrides.status === "rejected_removed" || existing.status === "rejected_removed" || existing.rejectedAt != null;
  const omStatus: PropertyOmPipelineStatus =
    overrides.omStatus ??
    (hasOmDocument ? "received" : lastInquirySentAt ? "requested" : "needed");
  const enrichmentStatus: PropertyJobStatus =
    overrides.enrichmentStatus ??
    (hasCityEnrichment ? "complete" : property.canonicalAddress ? "not_started" : "needs_manual_review");
  const rentalFlowStatus: PropertyJobStatus =
    overrides.rentalFlowStatus ??
    (hasRentalFlow ? "complete" : property.canonicalAddress ? "not_started" : "insufficient_data");
  const dossierStatus: PropertyJobStatus = overrides.dossierStatus ?? (hasDossier ? "complete" : "not_started");
  const excelStatus: PropertyJobStatus = overrides.excelStatus ?? (generatedSources.has("generated_excel") ? "complete" : "not_started");
  const underwritingStatus: PropertyUnderwritingStatus =
    overrides.underwritingStatus ??
    (hasDossier ? "complete" : hasOmDocument && !hasRentRoll ? "needs_rent_roll" : hasOmDocument && !hasAssumptions ? "needs_assumptions" : hasOmDocument ? "in_progress" : "not_started");
  const inferredInitialStatus: PropertyPipelineStatus = hasCityEnrichment ? "enrichment_complete" : "new_sourced";
  const status: PropertyPipelineStatus =
    overrides.status ??
    (rejected
      ? "rejected_removed"
      : existing.status && existing.status !== "new_sourced"
        ? existing.status
        : inferredInitialStatus);
  const hasTagOverride = Object.prototype.hasOwnProperty.call(overrides, "tags");
  const tags = uniqueStrings(hasTagOverride ? (overrides.tags ?? []) : existing.tags ?? []);
  const next: PropertyPipelineState = {
    ...existing,
    status,
    omStatus,
    enrichmentStatus,
    rentalFlowStatus,
    underwritingStatus,
    dossierStatus,
    excelStatus,
    tags,
    missingFields,
    actionRequired: uniqueStrings(overrides.actionRequired ?? missingFields),
    rejectedAt: overrides.rejectedAt ?? existing.rejectedAt,
    rejectionReason: overrides.rejectionReason ?? existing.rejectionReason,
    source: overrides.source ?? existing.source ?? listing?.source ?? null,
    sourceLinks: { ...sourceLinksFromDetails(details, listing), ...(overrides.sourceLinks ?? {}) },
    lastActivityAt: overrides.lastActivityAt ?? new Date().toISOString(),
  };
  await propertyRepo.mergeDetails(propertyId, { pipeline: next });
  return next;
}

function mapPropertyListRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => {
    const details = row.details ?? null;
    const pipeline = readPropertyPipelineState(details);
    const dossierReady = hasCompletedDealDossier(details as PropertyDetails | null);
    const dossierSummary = getPropertyDossierSummary(details as PropertyDetails | null);
    const calculatedDealScore =
      dossierSummary?.calculatedDealScore
      ?? dossierSummary?.dealScore
      ?? (row.calculated_deal_score != null ? Number(row.calculated_deal_score) : null);
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
    const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "");
    const listingListedAt = row.listing_listed_at != null
      ? (row.listing_listed_at instanceof Date ? row.listing_listed_at.toISOString() : String(row.listing_listed_at))
      : null;
    const lastInquirySentAt = row.last_inquiry_sent_at != null
      ? (row.last_inquiry_sent_at instanceof Date ? row.last_inquiry_sent_at.toISOString() : String(row.last_inquiry_sent_at))
      : null;
    const listingActivity = deriveListingActivitySummary({
      listedAt: listingListedAt,
      currentPrice: row.listing_price != null ? Number(row.listing_price) : null,
      priceHistory: (row.listing_price_history as PriceHistoryEntry[] | null) ?? null,
    });
    const listMissingFields = pipeline.missingFields.length > 0
      ? pipeline.missingFields
      : uniqueStrings([
          row.listing_price != null || hasAnyRecordValue(details, [["askingPrice"], ["purchasePrice"], ["dealDossier", "assumptions", "purchasePrice"]]) ? null : "asking_price",
          hasAnyRecordValue(details, [["unitCount"], ["rentalFinancials", "rentalUnits"]]) ? null : "unit_count",
          hasAnyRecordValue(details, [["buildingSqft"], ["assessedGrossSqft"], ["dealDossier", "assumptions", "buildingSqft"]]) ? null : "building_sqft",
          row.om_status === "OM received" ? null : "om",
          hasAnyRecordValue(details, [["bbl"], ["buildingLotBlock"], ["enrichment"]]) ? null : "city_enrichment",
          hasAnyRecordValue(details, [["rentalFinancials", "lastUpdatedAt"], ["rentalFinancials", "rentalUnits"]]) ? null : "rental_flow",
        ]);
    const listPipelineStatus: PropertyPipelineStatus =
      pipeline.status !== "new_sourced"
        ? pipeline.status
        : row.om_status === "OM received"
          ? "underwriting"
          : lastInquirySentAt
            ? "om_requested"
            : "needs_om";
    return {
      id: row.id,
      canonicalAddress: row.canonical_address,
      details,
      createdAt,
      updatedAt,
      primaryListing: {
        price: row.listing_price != null ? Number(row.listing_price) : null,
        listedAt: listingListedAt,
        city: (row.listing_city as string) ?? null,
        lastActivity: listingActivity,
      },
      listingAgentEnrichment: (row.listing_agent_enrichment as AgentEnrichmentEntry[] | null) ?? null,
      omStatus: (row.om_status as string) ?? "Not received",
      recipientContactName: (row.recipient_contact_name as string) ?? null,
      recipientContactEmail: (row.recipient_contact_email as string) ?? null,
      lastInquirySentAt,
      pipelineStatus: listPipelineStatus,
      enrichmentStatus: pipeline.enrichmentStatus,
      rentalFlowStatus: pipeline.rentalFlowStatus,
      underwritingStatus: pipeline.underwritingStatus,
      dossierStatus: pipeline.dossierStatus,
      excelStatus: pipeline.excelStatus,
      propertyTags: pipeline.tags,
      defaultTags: DEFAULT_PIPELINE_TAGS,
      missingFields: listMissingFields,
      actionRequired: pipeline.actionRequired.length > 0 ? pipeline.actionRequired : listMissingFields,
      rejectedAt: pipeline.rejectedAt,
      rejectionReason: pipeline.rejectionReason,
      dealScore:
        dossierReady && row.score_override_score != null
          ? Number(row.score_override_score)
          : dossierReady && calculatedDealScore != null
            ? calculatedDealScore
            : null,
      calculatedDealScore: dossierReady ? calculatedDealScore : null,
      scoreOverride:
        row.score_override_id != null
          ? {
              id: String(row.score_override_id),
              propertyId: String(row.id),
              score: Number(row.score_override_score),
              reason: String(row.score_override_reason ?? ""),
              createdBy: (row.score_override_created_by as string) ?? null,
              createdAt:
                row.score_override_created_at instanceof Date
                  ? row.score_override_created_at.toISOString()
                  : String(row.score_override_created_at ?? ""),
              clearedAt: null,
            }
          : null,
    };
  });
}

async function listPropertiesWithListingSummary(pool: import("pg").Pool) {
  const advancedQuery = `SELECT DISTINCT ON (p.id)
      p.id, p.canonical_address, p.details, p.created_at, p.updated_at,
      l.price AS listing_price, l.listed_at AS listing_listed_at, l.city AS listing_city, l.price_history AS listing_price_history, l.agent_enrichment AS listing_agent_enrichment,
      rr.contact_email AS recipient_contact_email,
      bc.display_name AS recipient_contact_name,
      inquiry.sent_at AS last_inquiry_sent_at,
      (CASE
        WHEN (
          EXISTS (
            SELECT 1
            FROM property_inquiry_documents d
            WHERE d.property_id = p.id
              AND LOWER(COALESCE(d.filename, '')) ~ '(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)'
          )
            OR EXISTS (
              SELECT 1
              FROM property_uploaded_documents u
              WHERE u.property_id = p.id
                AND u.category IN ('OM', 'Brochure', 'Rent Roll')
            )
            OR COALESCE(p.details->'omData'->'authoritative', 'null'::jsonb) <> 'null'::jsonb
        )
        THEN 'OM received'
        WHEN EXISTS (SELECT 1 FROM property_inquiry_sends s WHERE s.property_id = p.id)
        THEN 'OM pending'
        ELSE 'Not received'
      END) AS om_status,
      ds.deal_score AS calculated_deal_score,
      ov.id AS score_override_id,
      ov.score AS score_override_score,
      ov.reason AS score_override_reason,
      ov.created_by AS score_override_created_by,
      ov.created_at AS score_override_created_at
    FROM properties p
    LEFT JOIN listing_property_matches m ON m.property_id = p.id
    LEFT JOIN listings l ON l.id = m.listing_id
    LEFT JOIN property_recipient_resolution rr ON rr.property_id = p.id
    LEFT JOIN broker_contacts bc ON bc.id = rr.contact_id
    LEFT JOIN LATERAL (
      SELECT sent_at
      FROM property_inquiry_sends
      WHERE property_id = p.id
      ORDER BY sent_at DESC NULLS LAST
      LIMIT 1
    ) inquiry ON true
    LEFT JOIN LATERAL (
      SELECT deal_score
      FROM deal_signals
      WHERE property_id = p.id
      ORDER BY generated_at DESC
      LIMIT 1
    ) ds ON true
    LEFT JOIN LATERAL (
      SELECT id, score, reason, created_by, created_at
      FROM deal_score_overrides
      WHERE property_id = p.id AND cleared_at IS NULL
      ORDER BY deal_score_overrides.created_at DESC
      LIMIT 1
    ) ov ON true
    ORDER BY p.id, m.confidence DESC NULLS LAST, m.created_at DESC
    LIMIT 500`;

  const fallbackQuery = `SELECT DISTINCT ON (p.id)
      p.id, p.canonical_address, p.details, p.created_at, p.updated_at,
      l.price AS listing_price, l.listed_at AS listing_listed_at, l.city AS listing_city, l.price_history AS listing_price_history, l.agent_enrichment AS listing_agent_enrichment,
      rr.contact_email AS recipient_contact_email,
      bc.display_name AS recipient_contact_name,
      inquiry.sent_at AS last_inquiry_sent_at,
      (CASE
        WHEN (
          EXISTS (
            SELECT 1
            FROM property_inquiry_documents d
            WHERE d.property_id = p.id
              AND LOWER(COALESCE(d.filename, '')) ~ '(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)'
          )
            OR EXISTS (
              SELECT 1
              FROM property_uploaded_documents u
              WHERE u.property_id = p.id
                AND u.category IN ('OM', 'Brochure', 'Rent Roll')
            )
            OR COALESCE(p.details->'omData'->'authoritative', 'null'::jsonb) <> 'null'::jsonb
        )
        THEN 'OM received'
        WHEN EXISTS (SELECT 1 FROM property_inquiry_sends s WHERE s.property_id = p.id)
        THEN 'OM pending'
        ELSE 'Not received'
      END) AS om_status,
      NULL::numeric AS calculated_deal_score,
      NULL::uuid AS score_override_id,
      NULL::numeric AS score_override_score,
      NULL::text AS score_override_reason,
      NULL::text AS score_override_created_by,
      NULL::timestamptz AS score_override_created_at
    FROM properties p
    LEFT JOIN listing_property_matches m ON m.property_id = p.id
    LEFT JOIN listings l ON l.id = m.listing_id
    LEFT JOIN property_recipient_resolution rr ON rr.property_id = p.id
    LEFT JOIN broker_contacts bc ON bc.id = rr.contact_id
    LEFT JOIN LATERAL (
      SELECT sent_at
      FROM property_inquiry_sends
      WHERE property_id = p.id
      ORDER BY sent_at DESC NULLS LAST
      LIMIT 1
    ) inquiry ON true
    ORDER BY p.id, m.confidence DESC NULLS LAST, m.created_at DESC
    LIMIT 500`;

  try {
    const result = await pool.query(advancedQuery);
    return mapPropertyListRows(result.rows);
  } catch (err) {
    if (!isMissingPropertyScoringSchemaError(err)) throw err;
    console.warn("[properties list] scoring schema unavailable; falling back to basic property list", err);
    const result = await pool.query(fallbackQuery);
    return mapPropertyListRows(result.rows);
  }
}

/**
 * Re-run OM/Brochure financial extraction for a property when it has uploaded OM/Brochure docs.
 * Successful extraction now lands as an OM review run; promotion is explicit.
 * Uses file on disk when present; otherwise uses file_content from DB (for hosted deployments).
 */
export async function refreshOmFinancialsForProperty(
  propertyId: string,
  pool: import("pg").Pool,
  options?: {
    autoPromote?: boolean;
    triggerDossier?: boolean;
  }
): Promise<{
  documentsProcessed: number;
  documentsSkippedNoFile: number;
  runId: string | null;
  extractedSnapshotId: string | null;
  authoritativeSnapshotId: string | null;
  status: "needs_review" | "promoted" | "failed" | null;
  reviewRequired: boolean;
  error?: string;
}> {
  const result = await refreshAuthoritativeOmForProperty(propertyId, pool, options);
  return {
    documentsProcessed: result.documentsProcessed,
    documentsSkippedNoFile: result.documentsSkippedNoFile,
    runId: result.runId,
    extractedSnapshotId: result.extractedSnapshotId ?? null,
    authoritativeSnapshotId: result.authoritativeSnapshotId ?? result.snapshotId ?? null,
    status: result.status ?? null,
    reviewRequired: result.reviewRequired === true,
    error: result.error,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapReviewActionCandidateToDocument(candidate: unknown): OmAutomationDocument | null {
  if (!isPlainRecord(candidate)) return null;
  const id = stringOrNull(candidate.id);
  const filename = stringOrNull(candidate.filename);
  if (!id || !filename) return null;
  return {
    id,
    origin: "inquiry_attachment",
    filename,
    mimeType: stringOrNull(candidate.mimeType),
    filePath: stringOrNull(candidate.filePath),
    category: stringOrNull(candidate.category) ?? stringOrNull(candidate.classificationLabel),
    source: "Broker email attachment",
  };
}

function reviewActionGroupKey(details: Record<string, unknown>, actionId: string): string {
  const batchIds = Array.isArray(details.matchedBatchIds)
    ? details.matchedBatchIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (batchIds.length > 0) return `batch:${batchIds.sort().join(",")}`;
  const threadId = stringOrNull(details.gmailThreadId);
  if (threadId) return `thread:${threadId}`;
  const messageId = stringOrNull(details.messageId);
  return messageId ? `message:${messageId}` : `action:${actionId}`;
}

function isAmbiguousReviewAction(details: Record<string, unknown>, groupedCount: number): boolean {
  const batchIds = Array.isArray(details.matchedBatchIds) ? details.matchedBatchIds : [];
  const matchSources = Array.isArray(details.matchSources) ? details.matchSources : [];
  return (
    groupedCount > 1 ||
    batchIds.length > 0 ||
    matchSources.includes("batch_thread") ||
    stringOrNull(details.matchedBatchId) != null
  );
}

/** GET /api/properties - list canonical properties. ?includeListingSummary=1 adds primary listing price, listedAt, city for filter/sort. */
router.get("/properties", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const includeListingSummary = req.query.includeListingSummary === "1" || req.query.includeListingSummary === "true";
    if (!includeListingSummary) {
      const repo = new PropertyRepo({ pool });
      const properties = await repo.list({ limit: 500 });
      res.json({ properties, total: properties.length });
      return;
    }
    const properties = await listPropertiesWithListingSummary(pool);
    res.json({ properties, total: properties.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties list]", err);
    res.status(503).json({ error: "Failed to load properties.", details: message });
  }
});

/** DELETE /api/properties - clear all canonical properties (matches and enrichment data CASCADE). Requires ?confirm=1. */
router.delete("/properties", async (req: Request, res: Response) => {
  const confirmed = req.query.confirm === "1";
  if (!confirmed) {
    res.status(400).json({
      error: "Confirmation required. Use ?confirm=1 to clear all canonical properties.",
    });
    return;
  }
  try {
    const pool = getPool();
    await pool.query("DELETE FROM properties");
    res.json({ ok: true, deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties delete all]", err);
    res.status(503).json({ error: "Failed to clear canonical properties.", details: message });
  }
});

/** DELETE /api/properties/:id - delete one canonical property and cascaded workspace/enrichment records. Requires ?confirm=1. */
router.delete("/properties/:id", async (req: Request, res: Response) => {
  const confirmed = req.query.confirm === "1";
  if (!confirmed) {
    res.status(400).json({
      error: "Confirmation required. Use ?confirm=1 to delete this canonical property.",
    });
    return;
  }

  const propertyId = req.params.id;
  try {
    const pool = getPool();
    const generatedDocRepo = new DocumentRepo({ pool });
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const inquiryDocRepo = new InquiryDocumentRepo({ pool });

    const [generatedDocs, uploadedDocs, inquiryDocs] = await Promise.all([
      generatedDocRepo.listByPropertyId(propertyId),
      uploadedDocRepo.listByPropertyId(propertyId),
      inquiryDocRepo.listByPropertyId(propertyId),
    ]);

    const result = await pool.query<{ id: string; canonical_address: string }>(
      "DELETE FROM properties WHERE id = $1 RETURNING id, canonical_address",
      [propertyId]
    );

    const deletedProperty = result.rows[0];
    if (!deletedProperty) {
      res.status(404).json({ error: "Canonical property not found." });
      return;
    }

    await Promise.allSettled([
      ...generatedDocs.map((doc) => deleteGeneratedDocumentFile(doc.storagePath)),
      ...uploadedDocs.map((doc) => deleteUploadedDocumentFile(doc.filePath)),
      ...inquiryDocs.map((doc) => unlink(resolveInquiryFilePath(doc.filePath)).catch(() => {})),
    ]);

    res.json({
      ok: true,
      deleted: true,
      propertyId: deletedProperty.id,
      canonicalAddress: deletedProperty.canonical_address,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties delete one]", err);
    res.status(503).json({ error: "Failed to delete canonical property.", details: message });
  }
});

/** POST /api/properties/:id/tags - add a workflow/custom tag to a canonical property. */
router.post("/properties/:id/tags", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const tag = normalizeTag(req.body?.tag);
    if (!tag) {
      res.status(400).json({ error: "tag is required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Canonical property not found." });
      return;
    }
    const existing = readPropertyPipelineState(property.details);
    const pipeline = await refreshPropertyPipelineMetadata(propertyId, pool, {
      tags: uniqueStrings([...existing.tags, tag]),
    });
    res.json({ ok: true, propertyId, tag, pipeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties add tag]", err);
    res.status(503).json({ error: "Failed to add property tag.", details: message });
  }
});

/** DELETE /api/properties/:id/tags/:tag - remove a workflow/custom tag from a canonical property. */
router.delete("/properties/:id/tags/:tag", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const tag = normalizeTag(req.params.tag);
    if (!tag) {
      res.status(400).json({ error: "tag is required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Canonical property not found." });
      return;
    }
    const existing = readPropertyPipelineState(property.details);
    const pipeline = await refreshPropertyPipelineMetadata(propertyId, pool, {
      tags: existing.tags.filter((value) => value !== tag),
    });
    res.json({ ok: true, propertyId, tag, pipeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties remove tag]", err);
    res.status(503).json({ error: "Failed to remove property tag.", details: message });
  }
});

/** POST /api/properties/:id/reject - soft reject/remove a property while preserving its history. */
router.post("/properties/:id/reject", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Canonical property not found." });
      return;
    }
    const existing = readPropertyPipelineState(property.details);
    const rejectedAt = new Date().toISOString();
    const pipeline = await refreshPropertyPipelineMetadata(propertyId, pool, {
      status: "rejected_removed",
      tags: uniqueStrings([...existing.tags, "rejected"]),
      rejectedAt,
      rejectionReason: reason,
      lastActivityAt: rejectedAt,
    });
    res.json({ ok: true, propertyId, pipeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties reject]", err);
    res.status(503).json({ error: "Failed to reject property.", details: message });
  }
});

/** POST /api/properties/:id/restore - restore a previously rejected property to the active pipeline. */
router.post("/properties/:id/restore", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Canonical property not found." });
      return;
    }
    const existing = readPropertyPipelineState(property.details);
    const pipelineWithoutReject = {
      ...existing,
      status: "new_sourced" as PropertyPipelineStatus,
      tags: existing.tags.filter((value) => value !== "rejected"),
      rejectedAt: null,
      rejectionReason: null,
      lastActivityAt: new Date().toISOString(),
    };
    await propertyRepo.mergeDetails(propertyId, { pipeline: pipelineWithoutReject });
    const pipeline = await refreshPropertyPipelineMetadata(propertyId, pool, {
      tags: pipelineWithoutReject.tags,
      rejectedAt: null,
      rejectionReason: null,
    });
    res.json({ ok: true, propertyId, pipeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties restore]", err);
    res.status(503).json({ error: "Failed to restore property.", details: message });
  }
});

/** POST /api/properties/manual-add - create/update a property directly from a StreetEasy URL/sale ID and optional OM document link. */
router.post("/properties/manual-add", async (req: Request, res: Response) => {
  const streetEasyUrl = normalizeManualUrl(req.body?.streetEasyUrl ?? req.body?.streeteasyUrl, {
    requireStreetEasyHost: true,
  });
  const explicitStreetEasySaleId = normalizeStreetEasySaleId(
    req.body?.streetEasySaleId ?? req.body?.streeteasySaleId ?? req.body?.saleId ?? req.body?.streetEasyId
  );
  const omUrl = normalizeManualUrl(req.body?.omUrl);

  if (streetEasyUrl == null && explicitStreetEasySaleId == null) {
    res.status(400).json({ error: "streetEasyUrl or streetEasySaleId is required." });
    return;
  }
  if (streetEasyUrl === "invalid") {
    res.status(400).json({ error: "streetEasyUrl must be a valid StreetEasy URL." });
    return;
  }
  if (omUrl === "invalid") {
    res.status(400).json({ error: "omUrl must be a valid http(s) URL when provided." });
    return;
  }

  let propertyId = "";
  let listingId = "";
  let canonicalAddress = "";
  let createdProperty = false;
  let createdListing = false;
  let manualSourceLinks: PropertyManualSourceLinks | null = null;
  let saleDetailsFetch: {
    method: "id" | "url";
    saleId: string | null;
    warning: string | null;
  } = {
    method: "url",
    saleId: explicitStreetEasySaleId,
    warning: null,
  };
  let enrichment: {
    attempted: boolean;
    ok: boolean;
    bbl: string | null;
    bin: string | null;
    warning: string | null;
  } = {
    attempted: false,
    ok: false,
    bbl: null,
    bin: null,
    warning: null,
  };
  let rentalFlow: {
    attempted: boolean;
    ok: boolean;
    rentalUnitsCount: number;
    hasLlmFinancials: boolean;
    warning: string | null;
  } = {
    attempted: false,
    ok: false,
    rentalUnitsCount: 0,
    hasLlmFinancials: false,
    warning: null,
  };

  try {
    const extractedSaleId =
      explicitStreetEasySaleId ??
      (typeof streetEasyUrl === "string" ? extractStreetEasySaleIdFromUrl(streetEasyUrl) : null);
    const normalizedStreetEasyUrl =
      typeof streetEasyUrl === "string"
        ? normalizeStreeteasyUrl(streetEasyUrl)
        : extractedSaleId
          ? `https://streeteasy.com/sale/${extractedSaleId}`
          : "";
    let raw: Record<string, unknown>;
    if (extractedSaleId) {
      try {
        raw = await fetchSaleDetailsById(extractedSaleId);
        saleDetailsFetch = { method: "id", saleId: extractedSaleId, warning: null };
      } catch (error) {
        if (!streetEasyUrl) throw error;
        raw = await fetchSaleDetailsByUrl(streetEasyUrl);
        saleDetailsFetch = {
          method: "url",
          saleId: extractedSaleId,
          warning: `Sale ID lookup failed; used URL lookup instead: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else {
      if (!streetEasyUrl) {
        res.status(400).json({ error: "StreetEasy URL is required when no sale ID is available." });
        return;
      }
      raw = await fetchSaleDetailsByUrl(streetEasyUrl);
      saleDetailsFetch = { method: "url", saleId: null, warning: null };
    }
    const normalized = normalizeStreetEasySaleDetails(
      {
        ...raw,
        id: raw.id ?? raw.listing_id ?? extractedSaleId ?? undefined,
        _fetchUrl: normalizedStreetEasyUrl || streetEasyUrl || undefined,
        _saleDetailsFetch: saleDetailsFetch,
      },
      0
    );
    const addressLine = normalizeAddressLineForDisplay(normalized.address?.trim() ?? "");
    canonicalAddress = [addressLine, normalized.city, normalized.state, normalized.zip].filter(Boolean).join(", ");
    if (!canonicalAddress || addressLine === "—") {
      res.status(422).json({ error: "StreetEasy response did not include a usable address." });
      return;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new ListingRepo({ pool, client });
      const propertyRepo = new PropertyRepo({ pool, client });
      const matchRepo = new MatchRepo({ pool, client });
      const snapshotRepo = new SnapshotRepo({ pool, client });

      const existingListing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);
      const previousSnapshot = existingListing
        ? (await snapshotRepo.list({ listingId: existingListing.id, limit: 1 })).snapshots[0] ?? null
        : null;
      if (existingListing) {
        Object.assign(normalized, withRefreshPriceHistory({ normalized, existing: existingListing, previousSnapshot }));
        normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? existingListing.rentalPriceHistory ?? null;
      }

      const sourceAgentEnrichment = normalized.agentEnrichment ?? null;
      if (Array.isArray(normalized.agentNames) && normalized.agentNames.length > 0) {
        try {
          const context = brokerLookupContextFromListing(normalized);
          const agentEnrichment = await enrichBrokers(normalized.agentNames, context);
          const merged = mergeBrokerEnrichment(normalized.agentNames, sourceAgentEnrichment, agentEnrichment, context);
          if (hasMeaningfulBrokerEnrichment(merged)) normalized.agentEnrichment = merged;
          else if (existingListing?.agentEnrichment?.length) normalized.agentEnrichment = existingListing.agentEnrichment;
          else if (hasMeaningfulBrokerEnrichment(sourceAgentEnrichment)) normalized.agentEnrichment = sourceAgentEnrichment;
        } catch (error) {
          if (existingListing?.agentEnrichment?.length) normalized.agentEnrichment = existingListing.agentEnrichment;
          else if (hasMeaningfulBrokerEnrichment(sourceAgentEnrichment)) normalized.agentEnrichment = sourceAgentEnrichment;
          console.warn(
            `[properties manual-add] broker enrichment failed for ${normalized.externalId}:`,
            error instanceof Error ? error.message : error
          );
        }
      } else if (existingListing?.agentEnrichment?.length) {
        normalized.agentEnrichment = existingListing.agentEnrichment;
      }

      const existingProperty = await propertyRepo.byCanonicalAddress(canonicalAddress);
      const listingUpsert = await listingRepo.upsert(normalized, { uploadedRunId: null });
      const property = await propertyRepo.create(canonicalAddress);
      await matchRepo.create({
        listingId: listingUpsert.listing.id,
        propertyId: property.id,
        confidence: 1,
        reasons: { addressMatch: true, normalizedAddressDistance: 0 },
      });
      await snapshotRepo.create({
        listingId: listingUpsert.listing.id,
        runId: null,
        rawPayloadPath: "inline",
        metadata: {
          manualAdd: true,
          saleDetailsFetch,
          capturedAt: new Date().toISOString(),
          rawPayload: { ...raw, _fetchUrl: normalizedStreetEasyUrl || streetEasyUrl, _saleDetailsFetch: saleDetailsFetch },
          agentEnrichment: normalized.agentEnrichment ?? null,
          priceHistory: normalized.priceHistory ?? null,
          rentalPriceHistory: normalized.rentalPriceHistory ?? null,
          normalizedListing: {
            source: normalized.source,
            externalId: normalized.externalId,
            address: normalized.address,
            city: normalized.city,
            state: normalized.state,
            zip: normalized.zip,
            url: normalized.url,
          },
        },
      });

      createdListing = listingUpsert.created;
      createdProperty = existingProperty == null;
      propertyId = property.id;
      listingId = listingUpsert.listing.id;
      manualSourceLinks = mergeManualSourceLinks(existingProperty?.details ?? property.details, {
        streetEasyUrl: normalizedStreetEasyUrl || streetEasyUrl || null,
        omUrl: omUrl ?? null,
        addedAt: new Date().toISOString(),
      });
      const propertyDetailsMerge = buildPropertyDetailsMergeFromListing(listingUpsert.listing);
      propertyDetailsMerge.manualSourceLinks = manualSourceLinks;
      await propertyRepo.mergeDetails(property.id, propertyDetailsMerge);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const propertyRepo = new PropertyRepo({ pool });
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const omImport: {
      requested: boolean;
      imported: boolean;
      omUrl: string | null;
      resolvedOmUrl: string | null;
      fileName: string | null;
      authoritativeOmBuilt: boolean;
      warning: string | null;
    } = {
      requested: Boolean(omUrl),
      imported: false,
      omUrl: omUrl ?? null,
      resolvedOmUrl: null,
      fileName: null,
      authoritativeOmBuilt: false,
      warning: null,
    };

    if (omUrl) {
      try {
        const downloaded = await downloadOmDocument(omUrl, { maxBytes: OM_IMPORT_MAX_BYTES });
        const docId = randomUUID();
        const filePath = await saveUploadedDocument(propertyId, docId, downloaded.filename, downloaded.buffer);
        const inserted = await uploadedDocRepo.insert({
          id: docId,
          propertyId,
          filename: downloaded.filename,
          contentType: downloaded.contentType,
          filePath,
          category: "OM",
          source: "Manual OM link",
          fileContent: downloaded.buffer,
        });
        omImport.imported = true;
        omImport.resolvedOmUrl = downloaded.resolvedUrl;
        omImport.fileName = inserted.filename;
        manualSourceLinks = mergeManualSourceLinks((await propertyRepo.byId(propertyId))?.details ?? null, {
          streetEasyUrl: normalizedStreetEasyUrl || streetEasyUrl || null,
          omUrl: downloaded.resolvedUrl,
          omImportedAt: inserted.createdAt,
          omDocumentId: inserted.id,
          omFileName: inserted.filename,
        });
        await propertyRepo.mergeDetails(propertyId, { manualSourceLinks });
        await syncPropertySourcingWorkflow(propertyId, { pool });

        const isPdf =
          downloaded.contentType?.toLowerCase().includes("pdf") ||
          extname(inserted.filename).toLowerCase() === ".pdf";
        if (isPdf) {
          const refreshResult = await refreshOmFinancialsForProperty(propertyId, pool);
          omImport.authoritativeOmBuilt = refreshResult.status === "promoted";
          if (refreshResult.error) omImport.warning = refreshResult.error;
          else if (refreshResult.reviewRequired) omImport.warning = "OM extraction is ready for manual review.";
        } else {
          omImport.warning = "OM document was saved, but authoritative OM build currently expects a PDF.";
        }
      } catch (error) {
        omImport.warning = error instanceof Error ? error.message : "Failed to import OM link.";
      }
    }

    try {
      const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
      enrichment.attempted = true;
      const resolvedBbl = await getBBLForProperty(propertyId, { appToken });
      enrichment.bbl = resolvedBbl?.bbl ?? null;
      enrichment.bin = resolvedBbl?.bin ?? null;
      if (!resolvedBbl?.bbl) {
        enrichment.warning = "Could not resolve BBL; BBL-dependent enrichment modules may be skipped.";
      }
      const result = await runEnrichmentForProperty(propertyId, undefined, {
        appToken,
        rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
      });
      enrichment.ok = result.ok;
      if (!result.ok && !enrichment.warning) {
        enrichment.warning = "Enrichment ran, but one or more modules failed.";
      }
    } catch (error) {
      enrichment.attempted = true;
      enrichment.warning = error instanceof Error ? error.message : "Failed to run enrichment.";
    }

    try {
      rentalFlow.attempted = true;
      const result = await runRentalFlowForProperty(propertyId, pool);
      rentalFlow = {
        attempted: true,
        ok: !result.error,
        rentalUnitsCount: result.rentalUnitsCount,
        hasLlmFinancials: result.hasLlmFinancials,
        warning: result.error ?? null,
      };
    } catch (error) {
      rentalFlow.attempted = true;
      rentalFlow.warning = error instanceof Error ? error.message : "Failed to run rental flow.";
    }

    await syncPropertySourcingWorkflow(propertyId, { pool });
    await refreshPropertyPipelineMetadata(propertyId, pool, {
      enrichmentStatus: enrichment.attempted ? (enrichment.ok ? "complete" : "failed") : "not_started",
      rentalFlowStatus: rentalFlow.attempted ? (rentalFlow.ok ? "complete" : "failed") : "not_started",
    });
    const property = await propertyRepo.byId(propertyId);

    res.status(createdProperty ? 201 : 200).json({
      ok: true,
      propertyId,
      listingId,
      canonicalAddress,
      createdProperty,
      createdListing,
      saleDetailsFetch,
      omImport,
      enrichment,
      rentalFlow,
      property,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties manual-add]", err);
    if (/DATABASE_URL|connection|ECONNREFUSED|getPool/i.test(message)) {
      res.status(503).json({ error: "Database unavailable.", details: message });
      return;
    }
    res.status(502).json({ error: "Failed to add property from links.", details: message });
  }
});

/** POST /api/properties/manual-add-from-om - create/update a property directly from a PDF OM URL using OM-extracted address. */
router.post("/properties/manual-add-from-om", async (req: Request, res: Response) => {
  const omUrl = normalizeManualUrl(req.body?.omUrl);

  if (omUrl == null) {
    res.status(400).json({ error: "omUrl is required." });
    return;
  }
  if (omUrl === "invalid") {
    res.status(400).json({ error: "omUrl must be a valid http(s) URL." });
    return;
  }

  let propertyId = "";
  let canonicalAddress = "";
  let createdProperty = false;
  let matchStrategy: "exact_canonical" | "address_line" | "new" = "new";
  let manualSourceLinks: PropertyManualSourceLinks | null = null;

  try {
    const downloaded = await downloadOmDocument(omUrl, { maxBytes: OM_IMPORT_MAX_BYTES });
    const isPdf =
      downloaded.contentType?.toLowerCase().includes("pdf") ||
      extname(downloaded.filename).toLowerCase() === ".pdf";
    if (!isPdf) {
      res.status(422).json({
        error: "OM-only property creation currently requires a PDF so the address can be extracted reliably.",
      });
      return;
    }

    const extracted = await extractOmAnalysisFromGeminiPdfOnly({
      documents: [
        {
          filename: downloaded.filename,
          mimeType: downloaded.contentType ?? "application/pdf",
          buffer: downloaded.buffer,
        },
      ],
      propertyContext: downloaded.filename,
    });
    if (!extracted.omAnalysis) {
      res.status(422).json({
        error: extracted.parseError
          ? `Failed to parse the OM PDF: ${extracted.parseError}`
          : "The OM PDF did not return structured property details.",
      });
      return;
    }

    const resolvedOmAddress = resolveOmPropertyAddress(extracted.omAnalysis.propertyInfo);
    if (!resolvedOmAddress) {
      res.status(422).json({
        error:
          "The OM parsed successfully, but it did not return a usable building address. Try a clearer OM PDF or use the StreetEasy path.",
      });
      return;
    }
    canonicalAddress = resolvedOmAddress.canonicalAddress;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const propertyRepo = new PropertyRepo({ pool, client });

      const exactProperty = await propertyRepo.byCanonicalAddress(canonicalAddress);
      const firstLineMatch =
        exactProperty == null
          ? await propertyRepo.findByAddressFirstLine(resolvedOmAddress.addressLine)
          : null;
      const matchedProperty = exactProperty ?? firstLineMatch;
      const property = matchedProperty ?? (await propertyRepo.create(canonicalAddress));

      createdProperty = matchedProperty == null;
      matchStrategy =
        exactProperty != null ? "exact_canonical" : firstLineMatch != null ? "address_line" : "new";
      propertyId = property.id;
      canonicalAddress = property.canonicalAddress;
      manualSourceLinks = mergeManualSourceLinks(matchedProperty?.details ?? property.details, {
        omUrl: downloaded.resolvedUrl,
        addedAt: new Date().toISOString(),
      });
      await propertyRepo.mergeDetails(property.id, {
        manualSourceLinks,
        omDerivedAddress: {
          rawAddress: resolvedOmAddress.rawAddress,
          addressLine: resolvedOmAddress.addressLine,
          locality: resolvedOmAddress.locality,
          zip: resolvedOmAddress.zip,
          canonicalAddress: resolvedOmAddress.canonicalAddress,
          addressSource: resolvedOmAddress.addressSource,
        },
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const propertyRepo = new PropertyRepo({ pool });
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const omImport: {
      requested: boolean;
      imported: boolean;
      omUrl: string | null;
      resolvedOmUrl: string | null;
      fileName: string | null;
      authoritativeOmBuilt: boolean;
      warning: string | null;
    } = {
      requested: true,
      imported: false,
      omUrl,
      resolvedOmUrl: downloaded.resolvedUrl,
      fileName: null,
      authoritativeOmBuilt: false,
      warning: null,
    };
    const enrichment: {
      attempted: boolean;
      ok: boolean;
      bbl: string | null;
      bin: string | null;
      warning: string | null;
    } = {
      attempted: false,
      ok: false,
      bbl: null,
      bin: null,
      warning: null,
    };
    let rentalFlow: {
      attempted: boolean;
      ok: boolean;
      rentalUnitsCount: number;
      hasLlmFinancials: boolean;
      warning: string | null;
    } = {
      attempted: false,
      ok: false,
      rentalUnitsCount: 0,
      hasLlmFinancials: false,
      warning: null,
    };

    try {
      const docId = randomUUID();
      const filePath = await saveUploadedDocument(propertyId, docId, downloaded.filename, downloaded.buffer);
      const inserted = await uploadedDocRepo.insert({
        id: docId,
        propertyId,
        filename: downloaded.filename,
        contentType: downloaded.contentType,
        filePath,
        category: "OM",
        source: "Manual OM link",
        fileContent: downloaded.buffer,
      });
      omImport.imported = true;
      omImport.fileName = inserted.filename;
      manualSourceLinks = mergeManualSourceLinks((await propertyRepo.byId(propertyId))?.details ?? null, {
        omUrl: downloaded.resolvedUrl,
        omImportedAt: inserted.createdAt,
        omDocumentId: inserted.id,
        omFileName: inserted.filename,
      });
      await propertyRepo.mergeDetails(propertyId, { manualSourceLinks });
      await syncPropertySourcingWorkflow(propertyId, { pool });

      const refreshResult = await refreshOmFinancialsForProperty(propertyId, pool);
      omImport.authoritativeOmBuilt = refreshResult.status === "promoted";
      if (refreshResult.error) omImport.warning = refreshResult.error;
      else if (refreshResult.reviewRequired) omImport.warning = "OM extraction is ready for manual review.";
    } catch (error) {
      omImport.warning = error instanceof Error ? error.message : "Failed to save the OM document.";
    }

    try {
      enrichment.attempted = true;
      const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
      const resolvedBbl = await getBBLForProperty(propertyId, { appToken });
      enrichment.bbl = resolvedBbl?.bbl ?? null;
      enrichment.bin = resolvedBbl?.bin ?? null;
      if (!resolvedBbl?.bbl && !resolvedBbl?.bin) {
        enrichment.warning =
          "Property record created from the OM, but BBL/BIN could not be resolved from the extracted address yet.";
      } else {
        const result = await runEnrichmentForProperty(propertyId, undefined, {
          appToken,
          rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
        });
        enrichment.ok = result.ok;
        if (!result.ok) {
          enrichment.warning = "Enrichment ran, but one or more modules failed.";
        }
      }
    } catch (error) {
      enrichment.attempted = true;
      enrichment.warning = error instanceof Error ? error.message : "Failed to run enrichment.";
    }

    try {
      rentalFlow.attempted = true;
      const result = await runRentalFlowForProperty(propertyId, pool);
      rentalFlow = {
        attempted: true,
        ok: !result.error,
        rentalUnitsCount: result.rentalUnitsCount,
        hasLlmFinancials: result.hasLlmFinancials,
        warning: result.error ?? null,
      };
    } catch (error) {
      rentalFlow.attempted = true;
      rentalFlow.warning = error instanceof Error ? error.message : "Failed to run rental flow.";
    }

    await syncPropertySourcingWorkflow(propertyId, { pool });
    await refreshPropertyPipelineMetadata(propertyId, pool, {
      enrichmentStatus: enrichment.attempted ? (enrichment.ok ? "complete" : "failed") : "not_started",
      rentalFlowStatus: rentalFlow.attempted ? (rentalFlow.ok ? "complete" : "failed") : "not_started",
    });
    const property = await propertyRepo.byId(propertyId);

    res.status(createdProperty ? 201 : 200).json({
      ok: true,
      propertyId,
      listingId: null,
      canonicalAddress,
      createdProperty,
      createdListing: false,
      matchStrategy,
      omAddress: resolvedOmAddress,
      omImport,
      enrichment,
      rentalFlow,
      property,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties manual-add-from-om]", err);
    if (/DATABASE_URL|connection|ECONNREFUSED|getPool/i.test(message)) {
      res.status(503).json({ error: "Database unavailable.", details: message });
      return;
    }
    res.status(502).json({ error: "Failed to add property from OM.", details: message });
  }
});

/** POST /api/properties/from-listings - create canonical properties from raw listings, link via matches. Runs permit enrichment unless ?skipPermitEnrichment=1. Body may include listingIds: string[] to send only those listings (must be active); otherwise all active listings are used. */
router.post("/properties/from-listings", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  let workflowStartedAt = new Date().toISOString();
  let trackedListingCount = 0;
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new ListingRepo({ pool, client });
      const propertyRepo = new PropertyRepo({ pool, client });
      const matchRepo = new MatchRepo({ pool, client });

      const listingIds = Array.isArray(req.body?.listingIds) && req.body.listingIds.length > 0
        ? (req.body.listingIds as string[]).filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
        : undefined;
      const listFilters: { lifecycleState: "active"; limit: number; ids?: string[] } = { lifecycleState: "active", limit: 1000 };
      if (listingIds != null && listingIds.length > 0) listFilters.ids = listingIds;
      const { listings } = await listingRepo.list(listFilters);
      trackedListingCount = listings.length;
      workflowStartedAt = new Date().toISOString();
      workflowRunId = await createWorkflowRun({
        runType: "add_to_canonical",
        displayName: "Add to canonical",
        scopeLabel: `${listings.length} listing${listings.length === 1 ? "" : "s"}`,
        triggerSource: "manual",
        totalItems: listings.length,
        metadata: {
          listingIds: listings.map((listing) => listing.id),
        },
        steps: [
          {
            stepKey: "canonical",
            totalItems: listings.length,
            completedItems: 0,
            failedItems: 0,
            status: listings.length === 0 ? "completed" : "running",
            startedAt: workflowStartedAt,
            finishedAt: listings.length === 0 ? workflowStartedAt : null,
            lastMessage:
              listings.length === 0
                ? "No active listings selected"
                : `Starting canonicalization for ${listings.length} listing${listings.length === 1 ? "" : "s"}`,
          },
        ],
      });
      const results: { listingId: string; propertyId: string; canonicalAddress: string }[] = [];

      for (const listing of listings) {
        const addressLine = normalizeAddressLineForDisplay(listing.address?.trim() ?? "");
        const canonicalAddress = [addressLine, listing.city, listing.state, listing.zip]
          .filter(Boolean)
          .join(", ") || listing.address || "Unknown";
        const property = await propertyRepo.create(canonicalAddress);
        await matchRepo.create({
          listingId: listing.id,
          propertyId: property.id,
          confidence: 1,
          reasons: { addressMatch: true, normalizedAddressDistance: 0 },
        });
        // If GET sale details (listing.extra) included BBL/BIN or monthly HOA/tax, persist on property.
        // Also copy lat/lon from listing so enrichment can resolve BBL via Geoclient when needed.
        const extra = listing.extra as Record<string, unknown> | null | undefined;
        const merge: Record<string, unknown> = {};
        if (listing.lat != null && typeof listing.lat === "number" && !Number.isNaN(listing.lat) &&
            listing.lon != null && typeof listing.lon === "number" && !Number.isNaN(listing.lon)) {
          merge.lat = listing.lat;
          merge.lon = listing.lon;
        }
        if (extra && typeof extra === "object") {
          const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
          const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
          const bblStr = typeof bbl === "string" && /^\d{10}$/.test(bbl.trim()) ? bbl.trim() : null;
          if (bblStr) {
            merge.bbl = bblStr;
            if (typeof bin === "string" && bin.trim()) merge.bin = bin.trim();
          }
          const hoa = extra.monthlyHoa ?? extra.monthly_hoa ?? extra.hoa;
          const tax = extra.monthlyTax ?? extra.monthly_tax ?? extra.tax;
          if (typeof hoa === "number" && !Number.isNaN(hoa) && hoa >= 0) merge.monthlyHoa = hoa;
          else if (typeof hoa === "string" && hoa.trim()) {
            const n = parseFloat(hoa.replace(/[$,]/g, ""));
            if (!Number.isNaN(n) && n >= 0) merge.monthlyHoa = n;
          }
          if (typeof tax === "number" && !Number.isNaN(tax) && tax >= 0) merge.monthlyTax = tax;
          else if (typeof tax === "string" && tax.trim()) {
            const n = parseFloat(tax.replace(/[$,]/g, ""));
            if (!Number.isNaN(n) && n >= 0) merge.monthlyTax = n;
          }
        }
        if (Object.keys(merge).length > 0) await propertyRepo.mergeDetails(property.id, merge);
        results.push({ listingId: listing.id, propertyId: property.id, canonicalAddress });
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "canonical",
          totalItems: listings.length,
          completedItems: results.length,
          failedItems: 0,
          status: deriveWorkflowStatusFromCounts({
            totalItems: listings.length,
            completedItems: results.length,
          }),
          startedAt: workflowStartedAt,
          finishedAt: results.length >= listings.length ? new Date().toISOString() : null,
          lastMessage: `${results.length}/${listings.length} listing${listings.length === 1 ? "" : "s"} canonicalized`,
        });
      }

      await client.query("COMMIT");

      const skipPermitEnrichment = req.query.skipPermitEnrichment === "1" || req.query.skipPermitEnrichment === "true";
      const propertyIds = [...new Set(results.map((r) => r.propertyId))];
      const loopNetDocumentSummary: {
        imported: number;
        skipped: number;
        failed: number;
        errors: string[];
        documentIds: string[];
        reviewRunIds: string[];
      } = {
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        documentIds: [],
        reviewRunIds: [],
      };
      const resultByListingId = new Map(results.map((result) => [result.listingId, result]));
      for (const listing of listings) {
        if (listing.source !== "loopnet") continue;
        const result = resultByListingId.get(listing.id);
        if (!result) continue;
        try {
          const imported = await importLoopNetPublicDocumentsForProperty({
            propertyId: result.propertyId,
            listingId: listing.id,
            listingUrl: listing.url,
            extra: listing.extra,
            pool,
          });
          loopNetDocumentSummary.imported += imported.imported;
          loopNetDocumentSummary.skipped += imported.skipped;
          loopNetDocumentSummary.failed += imported.errors.length;
          loopNetDocumentSummary.errors.push(...imported.errors);
          loopNetDocumentSummary.documentIds.push(...imported.documentIds);
          if (imported.imported > 0) {
            const refreshResult = await refreshOmFinancialsForProperty(result.propertyId, pool);
            if (refreshResult.runId) loopNetDocumentSummary.reviewRunIds.push(refreshResult.runId);
            if (refreshResult.error) {
              loopNetDocumentSummary.failed++;
              loopNetDocumentSummary.errors.push(`${listing.url}: ${refreshResult.error}`);
            }
          }
        } catch (error) {
          loopNetDocumentSummary.failed++;
          loopNetDocumentSummary.errors.push(`${listing.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await mergeWorkflowRunMetadata(workflowRunId, {
        listingIds: listings.map((listing) => listing.id),
        propertyIds,
        loopNetDocumentSummary,
      });
      let enrichmentSummary: { ran: boolean; success: number; failed: number; byModule?: Record<string, number> } = {
        ran: false,
        success: 0,
        failed: 0,
      };
      const enrichmentStepKeys = ["permits", ...ENRICHMENT_MODULES.map((module) => module.key)];
      const enrichmentProgress = Object.fromEntries(
        enrichmentStepKeys.map((stepKey) => [stepKey, { completed: 0, failed: 0, skipped: 0 }])
      ) as Record<string, { completed: number; failed: number; skipped: number }>;

      // Enrichment runs the same pipeline for every property: BBL resolve → Phase 1 (owner cascade + tax code) → permits → 7 modules. Pre-pass: resolve and persist BBL for every property first so CO and other BBL-dependent modules run for all.
      if (!skipPermitEnrichment && propertyIds.length > 0) {
        enrichmentSummary.ran = true;
        const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
        const enrichmentStartedAt = new Date().toISOString();
        for (const stepKey of enrichmentStepKeys) {
          await upsertWorkflowStep(workflowRunId, {
            stepKey,
            totalItems: propertyIds.length,
            completedItems: 0,
            failedItems: 0,
            skippedItems: 0,
            status: stepKey === "permits" ? "running" : "pending",
            startedAt: stepKey === "permits" ? enrichmentStartedAt : null,
            lastMessage: stepKey === "permits" ? `Starting ${propertyIds.length} property enrichment run` : null,
          });
        }
        for (let i = 0; i < propertyIds.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
          await getBBLForProperty(propertyIds[i]!, { appToken });
        }
        const byModule: Record<string, number> = {};
        for (let i = 0; i < propertyIds.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
          const out = await runEnrichmentForProperty(propertyIds[i]!, undefined, {
            appToken,
            rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
          });
          const allOk = out.ok;
          if (allOk) enrichmentSummary.success++;
          else enrichmentSummary.failed++;
          for (const [name, r] of Object.entries(out.results)) {
            byModule[name] = (byModule[name] ?? 0) + (r.ok ? 1 : 0);
            if (!(name in enrichmentProgress)) continue;
            if (r.ok) enrichmentProgress[name].completed++;
            else if (r.skipped) enrichmentProgress[name].skipped++;
            else enrichmentProgress[name].failed++;
            await upsertWorkflowStep(workflowRunId, {
              stepKey: name,
              totalItems: propertyIds.length,
              completedItems: enrichmentProgress[name].completed,
              failedItems: enrichmentProgress[name].failed,
              skippedItems: enrichmentProgress[name].skipped,
              status: deriveWorkflowStatusFromCounts({
                totalItems: propertyIds.length,
                completedItems: enrichmentProgress[name].completed,
                failedItems: enrichmentProgress[name].failed,
                skippedItems: enrichmentProgress[name].skipped,
              }),
              startedAt: enrichmentStartedAt,
              finishedAt:
                enrichmentProgress[name].completed + enrichmentProgress[name].failed + enrichmentProgress[name].skipped >= propertyIds.length
                  ? new Date().toISOString()
                  : null,
              lastMessage: `${enrichmentProgress[name].completed}/${propertyIds.length} completed`,
              lastError: r.ok || r.skipped ? null : r.error ?? null,
            });
          }
        }
        enrichmentSummary.byModule = byModule;
      }

      // Run rental flow for each new property: RapidAPI + LLM on listing to populate financials.
      let rentalFlowSummary: { ran: boolean; success: number; failed: number } = { ran: false, success: 0, failed: 0 };
      if (propertyIds.length > 0) {
        rentalFlowSummary.ran = true;
        const pool = getPool();
        const rentalStartedAt = new Date().toISOString();
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "rental_flow",
          totalItems: propertyIds.length,
          completedItems: 0,
          failedItems: 0,
          status: "running",
          startedAt: rentalStartedAt,
          lastMessage: `Starting rental flow for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
        });
        for (let i = 0; i < propertyIds.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
          try {
            const rentalResult = await runRentalFlowForProperty(propertyIds[i]!, pool);
            await syncPropertySourcingWorkflow(propertyIds[i]!, { pool });
            await refreshPropertyPipelineMetadata(propertyIds[i]!, pool, {
              enrichmentStatus: skipPermitEnrichment ? "not_started" : enrichmentSummary.failed > 0 ? "needs_manual_review" : "complete",
              rentalFlowStatus: rentalResult.error ? "failed" : "complete",
            });
            if (rentalResult.error) {
              rentalFlowSummary.failed++;
            } else {
              rentalFlowSummary.success++;
            }
          } catch {
            await refreshPropertyPipelineMetadata(propertyIds[i]!, pool, {
              enrichmentStatus: skipPermitEnrichment ? "not_started" : enrichmentSummary.failed > 0 ? "needs_manual_review" : "complete",
              rentalFlowStatus: "failed",
            }).catch(() => null);
            rentalFlowSummary.failed++;
          }
          await upsertWorkflowStep(workflowRunId, {
            stepKey: "rental_flow",
            totalItems: propertyIds.length,
            completedItems: rentalFlowSummary.success,
            failedItems: rentalFlowSummary.failed,
            status: deriveWorkflowStatusFromCounts({
              totalItems: propertyIds.length,
              completedItems: rentalFlowSummary.success,
              failedItems: rentalFlowSummary.failed,
            }),
            startedAt: rentalStartedAt,
            finishedAt:
              rentalFlowSummary.success + rentalFlowSummary.failed >= propertyIds.length
                ? new Date().toISOString()
                : null,
            lastMessage: `${rentalFlowSummary.success}/${propertyIds.length} properties completed`,
          });
        }
      }

      await mergeWorkflowRunMetadata(workflowRunId, {
        propertyIds,
        created: results.length,
        enrichmentSummary,
        rentalFlowSummary,
        loopNetDocumentSummary,
      });
      await updateWorkflowRun(workflowRunId, {
        status:
          enrichmentSummary.failed > 0 || rentalFlowSummary.failed > 0
            ? "partial"
            : "completed",
        finishedAt: new Date().toISOString(),
      });

      res.json({
        ok: true,
        created: results.length,
        results,
        permitEnrichment: enrichmentSummary.ran
          ? { ran: true, success: enrichmentSummary.success, failed: enrichmentSummary.failed, byModule: enrichmentSummary.byModule }
          : { ran: false },
        rentalFlow: rentalFlowSummary.ran ? rentalFlowSummary : undefined,
        loopNetDocuments: loopNetDocumentSummary,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties from-listings]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "canonical",
      totalItems: trackedListingCount,
      completedItems: 0,
      failedItems: trackedListingCount,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "Canonicalization failed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    if (/DATABASE_URL|connection|ECONNREFUSED|getPool/i.test(message)) {
      res.status(503).json({ error: "Database unavailable.", details: message });
    } else {
      res.status(503).json({ error: "Failed to create properties from listings.", details: message });
    }
  }
});

/** POST /api/properties/refresh-listings - refresh only existing StreetEasy/RapidAPI listing records for selected canonical properties. */
router.post("/properties/refresh-listings", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const raw = req.body?.propertyIds;
    const propertyIds = Array.isArray(raw)
      ? Array.from(
          new Set(
            (raw as unknown[])
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((id) => id.trim())
          )
        )
      : [];
    if (propertyIds.length === 0) {
      res.status(400).json({ error: "propertyIds required (non-empty array)." });
      return;
    }

    workflowRunId = await createWorkflowRun({
      runType: "refresh_listings",
      displayName: "Refresh listings",
      scopeLabel: `${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
      triggerSource: "manual",
      totalItems: propertyIds.length,
      metadata: { propertyIds },
      steps: [
        {
          stepKey: "streeteasy_refresh",
          totalItems: propertyIds.length,
          status: "running",
          startedAt: workflowStartedAt,
          lastMessage: `Refreshing listing activity for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
        },
      ],
    });

    const pool = getPool();
    const streetEasyRefresh = {
      attempted: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      priceChanged: 0,
      unavailable: 0,
      errors: [] as string[],
    };
    const results: Array<{
      propertyId: string;
      attempted: boolean;
      ok: boolean;
      priceChanged: boolean;
      unavailable: boolean;
      listingStatus?: string | null;
      error?: string;
    }> = [];

    for (let i = 0; i < propertyIds.length; i++) {
      const propertyId = propertyIds[i]!;
      const result = await refreshStreetEasyListingForProperty(propertyId, pool);
      results.push({ propertyId, ...result });
      if (!result.attempted) streetEasyRefresh.skipped++;
      else if (result.ok) {
        streetEasyRefresh.attempted++;
        streetEasyRefresh.success++;
        if (result.priceChanged) streetEasyRefresh.priceChanged++;
        if (result.unavailable) streetEasyRefresh.unavailable++;
      } else {
        streetEasyRefresh.attempted++;
        streetEasyRefresh.failed++;
        if (result.error) streetEasyRefresh.errors.push(`${propertyId}: ${result.error}`);
      }

      await upsertWorkflowStep(workflowRunId, {
        stepKey: "streeteasy_refresh",
        totalItems: propertyIds.length,
        completedItems: streetEasyRefresh.success,
        failedItems: streetEasyRefresh.failed,
        skippedItems: streetEasyRefresh.skipped,
        status: deriveWorkflowStatusFromCounts({
          totalItems: propertyIds.length,
          completedItems: streetEasyRefresh.success,
          failedItems: streetEasyRefresh.failed,
          skippedItems: streetEasyRefresh.skipped,
        }),
        startedAt: workflowStartedAt,
        finishedAt:
          streetEasyRefresh.success + streetEasyRefresh.failed + streetEasyRefresh.skipped >= propertyIds.length
            ? new Date().toISOString()
            : null,
        lastMessage:
          streetEasyRefresh.unavailable > 0
            ? `${streetEasyRefresh.unavailable} unavailable listing${streetEasyRefresh.unavailable === 1 ? "" : "s"} flagged`
            : streetEasyRefresh.priceChanged > 0
              ? `${streetEasyRefresh.priceChanged} ask change${streetEasyRefresh.priceChanged === 1 ? "" : "s"} found`
              : `${streetEasyRefresh.success}/${propertyIds.length} listing refreshes completed`,
        lastError: result.ok || !result.error ? null : result.error,
      });

      if (i < propertyIds.length - 1 && ENRICHMENT_RATE_LIMIT_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_RATE_LIMIT_DELAY_MS));
      }
    }

    await mergeWorkflowRunMetadata(workflowRunId, { propertyIds, results, streetEasyRefresh });
    await updateWorkflowRun(workflowRunId, {
      status: streetEasyRefresh.failed > 0 ? "partial" : "completed",
      finishedAt: new Date().toISOString(),
    });

    res.json({ ok: true, results, streetEasyRefresh });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties refresh-listings]", err);
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Listing refresh failed.", details: message });
  }
});

/** POST /api/properties/run-enrichment - re-run enrichment for existing canonical properties only. Body: { propertyIds: string[] }. Assumes BBL/details are already set; runs same pipeline (BBL resolve → Phase 1 → permits → 7 modules) and updates data. Returns same permitEnrichment shape as from-listings. */
router.post("/properties/run-enrichment", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const raw = req.body?.propertyIds;
    const propertyIds = Array.isArray(raw)
      ? (raw as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
      : [];
    if (propertyIds.length === 0) {
      res.status(400).json({ error: "propertyIds required (non-empty array)." });
      return;
    }

    const enrichmentStepKeys = ["permits", ...ENRICHMENT_MODULES.map((module) => module.key)];
    const enrichmentProgress = Object.fromEntries(
      enrichmentStepKeys.map((stepKey) => [stepKey, { completed: 0, failed: 0, skipped: 0 }])
    ) as Record<string, { completed: number; failed: number; skipped: number }>;
    const workflowSteps: WorkflowRunStepSeed[] = [
      {
        stepKey: "streeteasy_refresh",
        totalItems: propertyIds.length,
        status: "running",
        startedAt: workflowStartedAt,
        lastMessage: `Refreshing StreetEasy asks for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
      },
      ...enrichmentStepKeys.map((stepKey, index): WorkflowRunStepSeed => ({
        stepKey,
        totalItems: propertyIds.length,
        status: "pending",
        startedAt: null,
        lastMessage: index === 0 ? "Waiting for StreetEasy refresh" : null,
      })),
      {
        stepKey: "om_financials",
        totalItems: propertyIds.length,
        status: "pending",
      },
    ];

    workflowRunId = await createWorkflowRun({
      runType: "rerun_enrichment",
      displayName: "Re-run enrichment",
      scopeLabel: `${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
      triggerSource: "manual",
      totalItems: propertyIds.length,
      metadata: { propertyIds },
      steps: workflowSteps,
    });

    const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
    const sourcingPool = getPool();
    const streetEasyRefresh = { attempted: 0, success: 0, failed: 0, skipped: 0, priceChanged: 0, unavailable: 0, errors: [] as string[] };
    for (let i = 0; i < propertyIds.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
      const propertyId = propertyIds[i]!;
      const result = await refreshStreetEasyListingForProperty(propertyId, sourcingPool);
      if (!result.attempted) streetEasyRefresh.skipped++;
      else if (result.ok) {
        streetEasyRefresh.attempted++;
        streetEasyRefresh.success++;
        if (result.priceChanged) streetEasyRefresh.priceChanged++;
        if (result.unavailable) streetEasyRefresh.unavailable++;
      } else {
        streetEasyRefresh.attempted++;
        streetEasyRefresh.failed++;
        if (result.error) streetEasyRefresh.errors.push(`${propertyId}: ${result.error}`);
      }
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "streeteasy_refresh",
        totalItems: propertyIds.length,
        completedItems: streetEasyRefresh.success,
        failedItems: streetEasyRefresh.failed,
        skippedItems: streetEasyRefresh.skipped,
        status: deriveWorkflowStatusFromCounts({
          totalItems: propertyIds.length,
          completedItems: streetEasyRefresh.success,
          failedItems: streetEasyRefresh.failed,
          skippedItems: streetEasyRefresh.skipped,
        }),
        startedAt: workflowStartedAt,
        finishedAt:
          streetEasyRefresh.success + streetEasyRefresh.failed + streetEasyRefresh.skipped >= propertyIds.length
            ? new Date().toISOString()
            : null,
        lastMessage:
          streetEasyRefresh.unavailable > 0
            ? `${streetEasyRefresh.unavailable} unavailable listing${streetEasyRefresh.unavailable === 1 ? "" : "s"} flagged`
            : streetEasyRefresh.priceChanged > 0
            ? `${streetEasyRefresh.priceChanged} ask change${streetEasyRefresh.priceChanged === 1 ? "" : "s"} found`
            : `${streetEasyRefresh.success}/${propertyIds.length} StreetEasy refreshes completed`,
        lastError: result.ok || !result.error ? null : result.error,
      });
    }
    // Pre-pass: resolve and persist BBL for every property so CO and other BBL-dependent modules run for all.
    for (let i = 0; i < propertyIds.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
      await getBBLForProperty(propertyIds[i]!, { appToken });
    }
    const byModule: Record<string, number> = {};
    let success = 0;
    let failed = 0;
    for (let i = 0; i < propertyIds.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, ENRICHMENT_RATE_LIMIT_DELAY_MS));
      const out = await runEnrichmentForProperty(propertyIds[i]!, undefined, {
        appToken,
        rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
      });
      await syncPropertySourcingWorkflow(propertyIds[i]!, { pool: sourcingPool });
      await refreshPropertyPipelineMetadata(propertyIds[i]!, sourcingPool, {
        enrichmentStatus: out.ok ? "complete" : "failed",
      });
      if (out.ok) success++;
      else failed++;
      for (const [name, r] of Object.entries(out.results)) {
        byModule[name] = (byModule[name] ?? 0) + (r.ok ? 1 : 0);
        if (!(name in enrichmentProgress)) continue;
        if (r.ok) enrichmentProgress[name].completed++;
        else if (r.skipped) enrichmentProgress[name].skipped++;
        else enrichmentProgress[name].failed++;
        await upsertWorkflowStep(workflowRunId, {
          stepKey: name,
          totalItems: propertyIds.length,
          completedItems: enrichmentProgress[name].completed,
          failedItems: enrichmentProgress[name].failed,
          skippedItems: enrichmentProgress[name].skipped,
          status: deriveWorkflowStatusFromCounts({
            totalItems: propertyIds.length,
            completedItems: enrichmentProgress[name].completed,
            failedItems: enrichmentProgress[name].failed,
            skippedItems: enrichmentProgress[name].skipped,
          }),
          startedAt: workflowStartedAt,
          finishedAt:
            enrichmentProgress[name].completed + enrichmentProgress[name].failed + enrichmentProgress[name].skipped >= propertyIds.length
              ? new Date().toISOString()
              : null,
          lastMessage: `${enrichmentProgress[name].completed}/${propertyIds.length} completed`,
          lastError: r.ok || r.skipped ? null : r.error ?? null,
        });
      }
    }

    const pool = getPool();
    let omFinancialsProcessed = 0;
    let omFinancialsSkippedNoFile = 0;
    let omCompleted = 0;
    let omFailed = 0;
    const omStartedAt = new Date().toISOString();
    if (ENABLE_OM_AUTOMATION_V2) {
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "om_financials",
        totalItems: propertyIds.length,
        completedItems: 0,
        failedItems: 0,
        status: "running",
        startedAt: omStartedAt,
        lastMessage: `Refreshing OM financials for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
      });
      for (const propertyId of propertyIds) {
        try {
          const result = await refreshOmFinancialsForProperty(propertyId, pool);
          await refreshPropertyPipelineMetadata(propertyId, pool, {
            underwritingStatus: result.reviewRequired ? "needs_assumptions" : "in_progress",
          });
          if (result.error) omFailed++;
          else omCompleted++;
          omFinancialsProcessed += result.documentsProcessed;
          omFinancialsSkippedNoFile += result.documentsSkippedNoFile;
        } catch {
          omFailed++;
        }
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "om_financials",
          totalItems: propertyIds.length,
          completedItems: omCompleted,
          failedItems: omFailed,
          status: deriveWorkflowStatusFromCounts({
            totalItems: propertyIds.length,
            completedItems: omCompleted,
            failedItems: omFailed,
          }),
          startedAt: omStartedAt,
          finishedAt: omCompleted + omFailed >= propertyIds.length ? new Date().toISOString() : null,
          lastMessage: `${omCompleted}/${propertyIds.length} properties refreshed`,
        });
      }
    } else {
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "om_financials",
        totalItems: propertyIds.length,
        completedItems: 0,
        failedItems: 0,
        skippedItems: propertyIds.length,
        status: "completed",
        startedAt: omStartedAt,
        finishedAt: omStartedAt,
        lastMessage: "Skipped automatic OM financial refresh in v1",
      });
    }

    await mergeWorkflowRunMetadata(workflowRunId, {
      propertyIds,
      streetEasyRefresh,
      permitEnrichment: {
        ran: true,
        success,
        failed,
        byModule,
      },
      omFinancialsRefresh: {
        documentsProcessed: omFinancialsProcessed,
        documentsSkippedNoFile: omFinancialsSkippedNoFile,
      },
    });
    await updateWorkflowRun(workflowRunId, {
      status: failed > 0 || omFailed > 0 || streetEasyRefresh.failed > 0 ? "partial" : "completed",
      finishedAt: new Date().toISOString(),
    });

    res.json({
      ok: true,
      streetEasyRefresh,
      permitEnrichment: {
        ran: true,
        success,
        failed,
        byModule,
      },
      omFinancialsRefresh: {
        documentsProcessed: omFinancialsProcessed,
        documentsSkippedNoFile: omFinancialsSkippedNoFile,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties run-enrichment]", err);
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Failed to run enrichment.", details: message });
  }
});

/** GET /api/properties/om-attachment-review-queue - grouped manual queue for broker attachment review. */
router.get("/properties/om-attachment-review-queue", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const rows = await pool.query<{
      id: string;
      property_id: string;
      canonical_address: string;
      action_type: string;
      priority: string;
      summary: string | null;
      details: Record<string, unknown> | null;
      created_at: Date | string;
      due_at: Date | string | null;
      updated_at: Date | string;
    }>(
      `SELECT ai.id,
              ai.property_id,
              p.canonical_address,
              ai.action_type,
              ai.priority,
              ai.summary,
              ai.details,
              ai.created_at,
              ai.due_at,
              ai.updated_at
       FROM property_action_items ai
       INNER JOIN properties p ON p.id = ai.property_id
       WHERE ai.status = 'open'
         AND ai.action_type = 'review_om_attachment'
       ORDER BY ai.created_at DESC
       LIMIT 100`
    );
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows.rows) {
      const details = isPlainRecord(row.details) ? row.details : {};
      const groupKey = reviewActionGroupKey(details, row.id);
      const item = {
        id: row.id,
        propertyId: row.property_id,
        canonicalAddress: row.canonical_address,
        actionType: row.action_type,
        priority: row.priority,
        summary: row.summary,
        details,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        dueAt: row.due_at == null ? null : row.due_at instanceof Date ? row.due_at.toISOString() : String(row.due_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      };
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
    }
    res.json({
      groups: [...groups.entries()].map(([groupKey, items]) => ({
        groupKey,
        isAmbiguous: items.some((item) => isAmbiguousReviewAction(item.details as Record<string, unknown>, items.length)),
        items,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties om attachment review queue]", err);
    res.status(503).json({ error: "Failed to load OM attachment review queue.", details: message });
  }
});

/** POST /api/properties/:id/action-items/:actionItemId/create-om-review-run - manually create an OM/document review run from queued broker attachments. */
router.post("/properties/:id/action-items/:actionItemId/create-om-review-run", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, actionItemId } = req.params;
    const pool = getPool();
    const row = await pool.query<{
      id: string;
      property_id: string;
      action_type: string;
      status: string;
      details: Record<string, unknown> | null;
    }>(
      `SELECT id, property_id, action_type, status, details
       FROM property_action_items
       WHERE id = $1
       LIMIT 1`,
      [actionItemId]
    );
    const action = row.rows[0];
    if (!action || action.property_id !== propertyId || action.status !== "open" || action.action_type !== "review_om_attachment") {
      res.status(404).json({ error: "Open OM attachment review action not found for this property." });
      return;
    }
    const details = isPlainRecord(action.details) ? action.details : {};
    const candidates = Array.isArray(details.attachmentCandidates) ? details.attachmentCandidates : [];
    const requestedIds = Array.isArray(req.body?.documentIds)
      ? new Set(req.body.documentIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0))
      : null;
    const documents = candidates
      .filter((candidate) => {
        if (!requestedIds) return true;
        return isPlainRecord(candidate) && typeof candidate.id === "string" && requestedIds.has(candidate.id);
      })
      .map(mapReviewActionCandidateToDocument)
      .filter((doc): doc is OmAutomationDocument => doc != null);

    if (documents.length === 0) {
      res.status(400).json({ error: "No usable broker attachment candidates found for this action." });
      return;
    }

    const result = await ingestAuthoritativeOm({
      propertyId,
      sourceType: "inquiry_attachment",
      documents,
      autoPromote: false,
      triggerDossier: false,
      pool,
    });
    if (!result.error && result.runId) {
      await new PropertyActionItemRepo({ pool }).resolveById(action.id);
    }
    res.json({ ok: !result.error, actionItemId: action.id, propertyId, documents, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties create om review run from action]", err);
    res.status(503).json({ error: "Failed to create OM review run from action.", details: message });
  }
});

/** POST /api/properties/:id/refresh-om-financials - create a reviewable OM extraction run from uploaded/inquiry docs. */
router.post("/properties/:id/refresh-om-financials", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const propertyId = req.params.id as string;
    if (!propertyId?.trim()) {
      res.status(400).json({ error: "Property ID required." });
      return;
    }
    workflowRunId = await createWorkflowRun({
      runType: "refresh_om_financials",
      displayName: "Refresh OM financials",
      scopeLabel: "1 property",
      triggerSource: "manual",
      totalItems: 1,
      metadata: { propertyIds: [propertyId.trim()] },
      steps: [
        {
          stepKey: "om_financials",
          totalItems: 1,
          status: "running",
          startedAt: workflowStartedAt,
          lastMessage: "Refreshing OM financials",
        },
      ],
    });
    const pool = getPool();
    const result = await refreshOmFinancialsForProperty(propertyId.trim(), pool);
    if (result.error) {
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "om_financials",
        totalItems: 1,
        completedItems: 0,
        failedItems: 1,
        status: "failed",
        startedAt: workflowStartedAt,
        finishedAt: new Date().toISOString(),
        lastError: result.error,
        lastMessage: "OM refresh failed",
      });
      await mergeWorkflowRunMetadata(workflowRunId, { error: result.error });
      await updateWorkflowRun(workflowRunId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      res.status(404).json({ error: result.error });
      return;
    }
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "om_financials",
      totalItems: 1,
      completedItems: 1,
      failedItems: 0,
      status: "completed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: result.reviewRequired ? "OM extraction ready for review" : "OM financials refreshed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, {
      documentsProcessed: result.documentsProcessed,
      documentsSkippedNoFile: result.documentsSkippedNoFile,
      runId: result.runId,
      extractedSnapshotId: result.extractedSnapshotId,
      authoritativeSnapshotId: result.authoritativeSnapshotId,
      status: result.status,
      reviewRequired: result.reviewRequired,
    });
    await updateWorkflowRun(workflowRunId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
    await refreshPropertyPipelineMetadata(propertyId.trim(), pool, {
      underwritingStatus: result.reviewRequired ? "needs_assumptions" : "in_progress",
    });
    res.json({
      ok: true,
      documentsProcessed: result.documentsProcessed,
      documentsSkippedNoFile: result.documentsSkippedNoFile,
      runId: result.runId,
      extractedSnapshotId: result.extractedSnapshotId,
      authoritativeSnapshotId: result.authoritativeSnapshotId,
      status: result.status,
      reviewRequired: result.reviewRequired,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties refresh-om-financials]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "om_financials",
      totalItems: 1,
      completedItems: 0,
      failedItems: 1,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "OM refresh failed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Failed to refresh OM financials.", details: message });
  }
});

/** GET /api/properties/:id/om-review-runs - list extracted OM runs awaiting or past manual review. */
router.get("/properties/:id/om-review-runs", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const runRepo = new OmIngestionRunRepo({ pool });
    const extractedRepo = new OmExtractedSnapshotRepo({ pool });
    const [runs, extractedSnapshots] = await Promise.all([
      runRepo.listByPropertyId(propertyId, 20),
      extractedRepo.listByPropertyId(propertyId, 20),
    ]);
    const extractedByRunId = new Map(extractedSnapshots.map((snapshot) => [snapshot.runId, snapshot]));
    res.json({
      propertyId,
      omData: (property.details as PropertyDetails | null | undefined)?.omData ?? null,
      runs: runs.map((run) => {
        const extracted = extractedByRunId.get(run.id) ?? null;
        return {
          ...run,
          extractedSnapshotId: extracted?.id ?? null,
          extractedSnapshot: extracted?.snapshot ?? null,
        };
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties om review runs]", err);
    res.status(503).json({ error: "Failed to load OM review runs.", details: message });
  }
});

/** POST /api/properties/:id/om-review-runs/:runId/promote - mark a reviewed extraction authoritative. */
router.post("/properties/:id/om-review-runs/:runId/promote", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, runId } = req.params;
    const result = await promoteOmExtractionForProperty({
      propertyId,
      runId,
      triggerDossier: req.body?.triggerDossier === true,
      pool: getPool(),
    });
    if (!result.ok) {
      res.status(404).json({ error: result.error ?? "OM review run could not be promoted." });
      return;
    }
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties om review promote]", err);
    res.status(503).json({ error: "Failed to promote OM review run.", details: message });
  }
});

/** POST /api/properties/:id/om-review-runs/:runId/reject - reject an extracted OM candidate without replacing authoritative state. */
router.post("/properties/:id/om-review-runs/:runId/reject", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, runId } = req.params;
    const reason = optionalTrimmedText(req.body?.reason, 1_000);
    if (reason === "invalid") {
      res.status(400).json({ error: "reason must be a string under 1,000 characters." });
      return;
    }
    const result = await rejectOmExtractionForProperty({
      propertyId,
      runId,
      reason,
      pool: getPool(),
    });
    if (!result.ok) {
      res.status(404).json({ error: result.error ?? "OM review run could not be rejected." });
      return;
    }
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties om review reject]", err);
    res.status(503).json({ error: "Failed to reject OM review run.", details: message });
  }
});

/** Enrichment module names used in property_enrichment_state (order matches pipeline). */
const ENRICHMENT_MODULES: { key: string; label: string }[] = [
  { key: "permits", label: "Permits" },
  { key: "hpd_registration", label: "HPD Registration" },
  { key: "certificate_of_occupancy", label: "Certificate of Occupancy" },
  { key: "zoning_ztl", label: "Zoning" },
  { key: "dob_complaints", label: "DOB Complaints" },
  { key: "hpd_violations", label: "HPD Violations" },
  { key: "housing_litigations", label: "Housing Litigations" },
];

/** GET /api/properties/pipeline-stats - counts for raw listings, canonical properties, and per-module completion for pipeline progress. ?includeRemaining=1 adds remainingByModule (property IDs not yet completed per module). */
router.get("/properties/pipeline-stats", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const includeRemaining = req.query.includeRemaining === "1" || req.query.includeRemaining === "true";
    const [rawResult, canonicalResult, enrichmentResult] = await Promise.all([
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM listings WHERE lifecycle_state = 'active'"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM properties"),
      pool.query<{ enrichment_name: string; count: string }>(
        `SELECT enrichment_name, count(DISTINCT property_id)::text AS count
         FROM property_enrichment_state
         WHERE last_success_at IS NOT NULL
         GROUP BY enrichment_name`
      ),
    ]);
    const rawListings = parseInt(rawResult.rows[0]?.count ?? "0", 10);
    const canonicalProperties = parseInt(canonicalResult.rows[0]?.count ?? "0", 10);
    const byModule: Record<string, number> = {};
    for (const row of enrichmentResult.rows) {
      byModule[row.enrichment_name] = parseInt(row.count, 10);
    }
    const enrichment = ENRICHMENT_MODULES.map(({ key, label }) => ({
      key,
      label,
      completed: byModule[key] ?? 0,
    }));
    const payload: Record<string, unknown> = {
      rawListings,
      canonicalProperties,
      enrichment,
    };
    if (includeRemaining) {
      const remainingResult = await pool.query<{ enrichment_name: string; property_id: string }>(
        `WITH completed AS (
          SELECT property_id, enrichment_name FROM property_enrichment_state WHERE last_success_at IS NOT NULL
        ),
        modules AS (
          SELECT unnest(ARRAY['permits','hpd_registration','certificate_of_occupancy','zoning_ztl','dob_complaints','hpd_violations','housing_litigations']) AS enrichment_name
        )
        SELECT m.enrichment_name, p.id AS property_id
        FROM properties p
        CROSS JOIN modules m
        LEFT JOIN completed c ON c.property_id = p.id AND c.enrichment_name = m.enrichment_name
        WHERE c.property_id IS NULL`
      );
      const remainingByModule: Record<string, { count: number; propertyIds: string[] }> = {};
      for (const { key } of ENRICHMENT_MODULES) {
        const ids = remainingResult.rows.filter((r) => r.enrichment_name === key).map((r) => r.property_id);
        remainingByModule[key] = { count: ids.length, propertyIds: ids };
      }
      payload.remainingByModule = remainingByModule;
    }
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties pipeline-stats]", err);
    res.status(503).json({ error: "Failed to load pipeline stats.", details: message });
  }
});

/** GET /api/properties/workflow-board - recent workflow runs with per-step progress for the operations board. */
router.get("/properties/workflow-board", async (_req: Request, res: Response) => {
  const runs = await listWorkflowRuns(60);
  res.json({
    columns: WORKFLOW_BOARD_COLUMNS,
    runs,
  });
});

const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: OM_IMPORT_MAX_BYTES } });

/** Multer file-size error: return 413 with hint about Render proxy limits. */
function handleUploadMulterError(_req: Request, res: Response, next: (err?: unknown) => void) {
  return (err: unknown) => {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "File too large",
        details: `Max ${OM_IMPORT_MAX_LABEL} per file. Compress the PDF if it is over the OM import limit.`,
        maxBytes: OM_IMPORT_MAX_BYTES,
      });
      return;
    }
    next(err);
  };
}

const VALID_UPLOAD_CATEGORIES: PropertyDocumentCategory[] = [
  "OM",
  "Brochure",
  "Rent Roll",
  "Financial Model",
  "T12 / Operating Summary",
  "Broker Comp Package",
  "Sale Comp Package",
  "Rent Comp Package",
  "Expense Comp Package",
  "Market Analysis",
  "Other",
];

function parseUploadCategory(cat: unknown): PropertyDocumentCategory {
  const s = typeof cat === "string" ? cat.trim() : "";
  if (VALID_UPLOAD_CATEGORIES.includes(s as PropertyDocumentCategory)) return s as PropertyDocumentCategory;
  return "Other";
}

function classifyUploadCategory(file: { originalname?: string; mimetype?: string }, requestedCategory: unknown): PropertyDocumentCategory {
  const requested = typeof requestedCategory === "string" ? requestedCategory.trim() : "";
  if (requested && requested.toLowerCase() !== "auto" && VALID_UPLOAD_CATEGORIES.includes(requested as PropertyDocumentCategory)) {
    return requested as PropertyDocumentCategory;
  }
  return detectImportedDocumentCategory(file.originalname ?? "document", file.originalname ?? file.mimetype ?? "");
}

function isOmIngestionCategory(category: PropertyDocumentCategory): boolean {
  return (
    category === "OM" ||
    category === "Brochure" ||
    category === "Rent Roll" ||
    category === "T12 / Operating Summary" ||
    category === "Financial Model"
  );
}

async function autoSavePropertyWithUnderwritingDocument(propertyId: string, pool: import("pg").Pool): Promise<boolean> {
  const userId = await new UserProfileRepo({ pool }).ensureDefault();
  await new SavedDealsRepo({ pool }).save(userId, propertyId, "saved");
  return true;
}

type UploadMemoryFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
};

function uploadedFilesFromRequest(req: Request): UploadMemoryFile[] {
  const requestWithFiles = req as Request & {
    file?: UploadMemoryFile;
    files?: UploadMemoryFile[] | Record<string, UploadMemoryFile[]>;
  };
  if (Array.isArray(requestWithFiles.files)) return requestWithFiles.files;
  if (requestWithFiles.files && typeof requestWithFiles.files === "object") {
    return Object.values(requestWithFiles.files).flat();
  }
  return requestWithFiles.file ? [requestWithFiles.file] : [];
}

type PlannedDocumentUpload = {
  file: UploadMemoryFile;
  filename: string;
  category: PropertyDocumentCategory;
};

type AddressAwareOmUploadResult = {
  filename: string;
  status: "imported" | "failed";
  propertyId: string | null;
  canonicalAddress: string | null;
  createdProperty: boolean;
  matchStrategy: string | null;
  uploadedDocumentIds: string[];
  omReviewStatus: string | null;
  rentalFlow: { rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string } | null;
  dossier: { generated: boolean; dealScore: number | null; error?: string } | null;
  error?: string;
};

function parseBooleanFormFlag(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => parseBooleanFormFlag(entry));
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isPdfUpload(file: UploadMemoryFile): boolean {
  const mimeType = file.mimetype?.toLowerCase() ?? "";
  const filename = file.originalname?.toLowerCase() ?? "";
  return mimeType.includes("pdf") || extname(filename) === ".pdf";
}

function planDocumentUploads(files: UploadMemoryFile[], requestedCategory: unknown): PlannedDocumentUpload[] {
  return files.map((file) => ({
    file,
    filename: file.originalname?.trim() || "document",
    category: classifyUploadCategory(file, requestedCategory),
  }));
}

async function persistUploadedDocumentForProperty(params: {
  propertyId: string;
  docRepo: PropertyUploadedDocumentRepo;
  plan: PlannedDocumentUpload;
  source: string;
  uploadedAt: string;
  uploadedVia: string;
  extraMetadata?: Record<string, unknown> | null;
}) {
  const docId = randomUUID();
  const filePath = await saveUploadedDocument(params.propertyId, docId, params.plan.filename, params.plan.file.buffer);
  return params.docRepo.insert({
    id: docId,
    propertyId: params.propertyId,
    filename: params.plan.filename,
    contentType: params.plan.file.mimetype || null,
    filePath,
    category: params.plan.category,
    source: params.source,
    sourceMetadata: {
      uploadedVia: params.uploadedVia,
      uploadedAt: params.uploadedAt,
      classificationMethod: "filename_auto",
      originalFileName: params.plan.filename,
      sizeBytes: params.plan.file.size ?? params.plan.file.buffer.length,
      ...(params.extraMetadata ?? {}),
    },
    fileContent: params.plan.file.buffer,
  });
}

async function runAddressAwareOmPostProcessing(
  propertyId: string,
  pool: import("pg").Pool
): Promise<{
  autoSaved: boolean;
  rentalFlow: { rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string } | null;
  dossier: { generated: boolean; dealScore: number | null; error?: string };
}> {
  const autoSaved = await autoSavePropertyWithUnderwritingDocument(propertyId, pool).catch((error) => {
    console.warn("[properties address-aware OM upload] failed to auto-save OM-backed property", {
      propertyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  });
  const rentalFlow = await runRentalFlowForProperty(propertyId, pool).catch((error) => ({
    rentalUnitsCount: 0,
    hasLlmFinancials: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  const dossier = await runGenerateDossier(propertyId, undefined, { sendEmail: false })
    .then((result) => ({
      generated: true,
      dealScore: result.dealScore,
    }))
    .catch((error) => ({
      generated: false,
      dealScore: null,
      error: error instanceof Error ? error.message : String(error),
    }));

  await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
  await refreshPropertyPipelineMetadata(propertyId, pool, {
    rentalFlowStatus: rentalFlow.error ? "failed" : "complete",
    dossierStatus: dossier.generated ? "complete" : "failed",
    excelStatus: dossier.generated ? "complete" : "failed",
    underwritingStatus: dossier.generated ? "complete" : "in_progress",
  }).catch(() => {});

  return {
    autoSaved,
    rentalFlow,
    dossier,
  };
}

/** GET /api/properties/ny-dos-entity?name=... - NY DOS entity details for a business name (LLC, Corp, etc.). Returns N/A when name does not look like a business entity. */
router.get("/properties/ny-dos-entity", async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) {
      res.json({ entity: null, nA: true, reason: "No name provided." });
      return;
    }
    const entity = await fetchNyDosEntityByName(name, {
      appToken: process.env.SOCRATA_APP_TOKEN ?? process.env.NY_OPEN_DATA_APP_TOKEN ?? null,
      timeoutMs: 15_000,
    });
    res.json({ entity, nA: entity == null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties ny-dos-entity]", err);
    res.status(503).json({ error: "Failed to fetch NY DOS entity.", details: message });
  }
});

/** GET /api/properties/acris-documents?name=... - ACRIS documents from NYC Open Data by owner name. Optional ?bbl= to filter by BBL. */
router.get("/properties/acris-documents", async (req: Request, res: Response) => {
  try {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Query parameter 'name' is required.", documents: [] });
      return;
    }
    const bbl = typeof req.query.bbl === "string" ? req.query.bbl.trim() || null : null;
    const documents = await fetchAcrisDocumentsByOwnerName(name, {
      appToken: process.env.SOCRATA_APP_TOKEN ?? null,
      timeoutMs: 60_000,
      bbl,
    });
    res.json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties acris-documents]", err);
    res.status(503).json({ error: "Failed to fetch ACRIS documents.", details: message, documents: [] });
  }
});

/** GET /api/properties/:id/acris-documents - ACRIS documents for property, using owner name from details (owner module / permits). Optional BBL filter from property. */
router.get("/properties/:id/acris-documents", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId, documents: [] });
      return;
    }
    const details = (property.details as Record<string, unknown>) ?? {};
    const enrichment = details.enrichment as Record<string, unknown> | undefined;
    const permitsSummary = enrichment?.permits_summary as Record<string, unknown> | undefined;
    const ownerModuleName = details.ownerModuleName ?? details.owner_module_name;
    const ownerModuleBusiness = details.ownerModuleBusiness ?? details.owner_module_business;
    const permOwnerName = permitsSummary?.owner_name;
    const permOwnerBusiness = permitsSummary?.owner_business_name;
    const candidates = [
      ownerModuleBusiness,
      permOwnerBusiness,
      ownerModuleName,
      permOwnerName,
    ].filter((c) => c != null && String(c).trim() !== "");
    const ownerName = typeof candidates[0] === "string" ? candidates[0].trim() : "";
    if (!ownerName) {
      res.json({ propertyId, documents: [], reason: "No owner name on property (set owner module or run permit enrichment)." });
      return;
    }
    const bbl = details.bblBase ?? details.bbl ?? null;
    const bblStr = typeof bbl === "string" ? bbl : typeof bbl === "number" ? String(bbl) : null;
    const documents = await fetchAcrisDocumentsByOwnerName(ownerName, {
      appToken: process.env.SOCRATA_APP_TOKEN ?? null,
      timeoutMs: 60_000,
      bbl: bblStr,
    });
    res.json({ propertyId, documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties :id acris-documents]", err);
    res.status(503).json({ error: "Failed to fetch ACRIS documents for property.", details: message, documents: [] });
  }
});

/** GET /api/properties/:id/documents - unified list: inquiry docs + uploaded docs + generated (dossier, Excel). */
router.get("/properties/:id/documents", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const inquiryDocRepo = new InquiryDocumentRepo({ pool });
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const generatedDocRepo = new DocumentRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const [inquiryDocs, uploadedDocs, generatedDocs] = await Promise.all([
      inquiryDocRepo.listByPropertyIdWithSource(propertyId),
      uploadedDocRepo.listByPropertyId(propertyId),
      generatedDocRepo.listByPropertyId(propertyId),
    ]);
    const unified = [
      ...inquiryDocs.map((d) => ({
        id: d.id,
        fileName: d.filename,
        fileType: d.contentType ?? null,
        source: d.source ?? "inquiry",
        sourceType: "inquiry" as const,
        createdAt: d.createdAt,
      })),
      ...uploadedDocs.map((d) => ({
        id: d.id,
        fileName: d.filename,
        fileType: d.contentType ?? null,
        source: d.source ?? d.category ?? "uploaded",
        category: d.category,
        sourceType: "uploaded" as const,
        sourceUrl: d.sourceUrl ?? null,
        sourceMetadata: d.sourceMetadata ?? null,
        createdAt: d.createdAt,
      })),
      ...generatedDocs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType ?? null,
        source: d.source,
        sourceType: "generated" as const,
        createdAt: d.createdAt,
      })),
    ].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    res.json({ propertyId, documents: unified });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties documents list]", err);
    res.status(503).json({ error: "Failed to list documents.", details: message });
  }
});

/** DELETE /api/properties/:id/documents/:docId - delete a document. Query: sourceType=inquiry|uploaded|generated (required). */
router.delete("/properties/:id/documents/:docId", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const sourceType = req.query.sourceType as string | undefined;
    if (!sourceType || !["inquiry", "uploaded", "generated"].includes(sourceType)) {
      res.status(400).json({ error: "Query sourceType is required and must be inquiry, uploaded, or generated." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }

    if (sourceType === "generated") {
      const generatedDocRepo = new DocumentRepo({ pool });
      const doc = await generatedDocRepo.byId(docId);
      if (!doc || doc.propertyId !== propertyId) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      await deleteGeneratedDocumentFile(doc.storagePath);
      const deleted = await generatedDocRepo.delete(docId);
      if (!deleted) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      res.status(200).json({ ok: true, propertyId, docId });
      return;
    }

    if (sourceType === "inquiry") {
      const inquiryDocRepo = new InquiryDocumentRepo({ pool });
      const doc = await inquiryDocRepo.byId(docId);
      if (!doc || doc.propertyId !== propertyId) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      const absolutePath = resolveInquiryFilePath(doc.filePath);
      await unlink(absolutePath).catch(() => {});
      const deleted = await inquiryDocRepo.delete(docId);
      if (!deleted) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      res.status(200).json({ ok: true, propertyId, docId });
      return;
    }

    if (sourceType === "uploaded") {
      const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
      const doc = await uploadedDocRepo.byId(docId);
      if (!doc || doc.propertyId !== propertyId) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      await deleteUploadedDocumentFile(doc.filePath);
      const deleted = await uploadedDocRepo.delete(docId);
      if (!deleted) {
        res.status(404).json({ error: "Document not found", docId });
        return;
      }
      res.status(200).json({ ok: true, propertyId, docId });
      return;
    }

    res.status(400).json({ error: "Invalid sourceType." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties delete document]", err);
    if (!res.headersSent) res.status(503).json({ error: "Failed to delete document.", details: message });
  }
});

/** GET /api/properties/:id/documents/:docId/file - serve document file (generated, inquiry, or uploaded). */
router.get("/properties/:id/documents/:docId/file", async (req: Request, res: Response) => {
  try {
    const { id: propertyId, docId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const generatedDocRepo = new DocumentRepo({ pool });
    const genDoc = await generatedDocRepo.byId(docId);
    if (genDoc && genDoc.propertyId === propertyId) {
      const fileContent = await generatedDocRepo.getFileContent(docId);
      if (fileContent && fileContent.length > 0) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(genDoc.fileName)}"`);
        if (genDoc.fileType) res.setHeader("Content-Type", genDoc.fileType);
        res.send(fileContent);
        return;
      }
      const absolutePath = resolveGeneratedDocPath(genDoc.storagePath);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(genDoc.fileName)}"`);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          console.error("[documents/file] sendFile failed (generated):", err instanceof Error ? err.message : err);
          res.status(500).json({ error: "Failed to send file", details: err instanceof Error ? err.message : "File may be missing or inaccessible" });
        }
      });
      return;
    }
    const inquiryDocRepo = new InquiryDocumentRepo({ pool });
    const inquiryDoc = await inquiryDocRepo.byId(docId);
    if (inquiryDoc && inquiryDoc.propertyId === propertyId) {
      const fileContent = await inquiryDocRepo.getFileContent(docId);
      if (fileContent && fileContent.length > 0) {
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(inquiryDoc.filename)}"`);
        if (inquiryDoc.contentType) res.setHeader("Content-Type", inquiryDoc.contentType);
        res.send(fileContent);
        return;
      }
      const absolutePath = resolveInquiryFilePath(inquiryDoc.filePath);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(inquiryDoc.filename)}"`);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          console.error("[documents/file] sendFile failed (inquiry):", err instanceof Error ? err.message : err);
          res.status(500).json({ error: "Failed to send file", details: err instanceof Error ? err.message : "File may be missing or inaccessible" });
        }
      });
      return;
    }
    const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
    const uploadedDoc = await uploadedDocRepo.byId(docId);
    if (uploadedDoc && uploadedDoc.propertyId === propertyId) {
      const fileContent = await uploadedDocRepo.getFileContent(docId);
      if (fileContent && fileContent.length > 0) {
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(uploadedDoc.filename)}"`);
        if (uploadedDoc.contentType) res.setHeader("Content-Type", uploadedDoc.contentType);
        res.send(fileContent);
        return;
      }
      if (!uploadedDocFileExists(uploadedDoc.filePath)) {
        res.status(404).json({ error: "Document file not found on disk", docId, hint: "On hosted deployments (e.g. Render), use a persistent disk or set UPLOADED_DOCS_PATH to a path that persists across restarts." });
        return;
      }
      const absolutePath = resolveUploadedDocFilePath(uploadedDoc.filePath);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(uploadedDoc.filename)}"`);
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          console.error("[documents/file] sendFile failed (uploaded):", err instanceof Error ? err.message : err);
          res.status(500).json({ error: "Failed to send file", details: err instanceof Error ? err.message : "File may be missing or storage may not persist (e.g. ephemeral disk)." });
        }
      });
      return;
    }
    res.status(404).json({ error: "Document not found", docId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties document file]", err);
    if (!res.headersSent) res.status(503).json({ error: "Failed to serve file.", details: message });
  }
});

/** POST /api/properties/:id/documents/upload-batch - upload one or more documents and refresh OM package data. */
router.post(
  "/properties/:id/documents/upload-batch",
  (req, res, next) => {
    uploadMemory.fields([
      { name: "files", maxCount: 20 },
      { name: "file", maxCount: 20 },
    ])(req, res, handleUploadMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const { id: propertyId } = req.params;
      const pool = getPool();
      const propertyRepo = new PropertyRepo({ pool });
      const docRepo = new PropertyUploadedDocumentRepo({ pool });
      const property = await propertyRepo.byId(propertyId);
      if (!property) {
        res.status(404).json({ error: "Property not found", propertyId });
        return;
      }

      const files = uploadedFilesFromRequest(req).filter((file) => file.buffer?.length > 0);
      if (files.length === 0) {
        res.status(400).json({ error: "Missing files. Send multipart/form-data with field 'files'." });
        return;
      }

      const source = typeof req.body?.source === "string" ? req.body.source.trim() || "Pipeline document upload" : "Pipeline document upload";
      const uploadedAt = new Date().toISOString();
      const uploadPlans = planDocumentUploads(files, req.body?.category);
      const splitByAddress = parseBooleanFormFlag(req.body?.splitByAddress) || parseBooleanFormFlag(req.body?.addressAwareOmImport);
      const addressAwarePlans = splitByAddress ? uploadPlans.filter((plan) => isPdfUpload(plan.file)) : [];

      if (addressAwarePlans.length > 0) {
        const addressAwarePlanSet = new Set(addressAwarePlans);
        const selectedPropertyDocuments: Array<Awaited<ReturnType<PropertyUploadedDocumentRepo["insert"]>>> = [];
        const addressAwareDocuments: Array<{
          id: string;
          propertyId: string;
          filename: string;
          contentType: string | null;
          category: PropertyDocumentCategory;
          createdAt: string;
        }> = [];
        const addressAwareResults: AddressAwareOmUploadResult[] = [];
        const importedPropertyIds = new Set<string>();

        for (const plan of uploadPlans) {
          if (!addressAwarePlanSet.has(plan)) {
            const inserted = await persistUploadedDocumentForProperty({
              propertyId,
              docRepo,
              plan,
              source,
              uploadedAt,
              uploadedVia: "property_documents_batch",
            });
            selectedPropertyDocuments.push(inserted);
            continue;
          }

          try {
            const result = await analyzeAndPersistDealAnalysisOmDocuments({
              documents: [
                {
                  filename: plan.filename,
                  mimeType: plan.file.mimetype || "application/pdf",
                  buffer: plan.file.buffer,
                  sizeBytes: plan.file.size ?? plan.file.buffer.length,
                },
              ],
              sourceType: "pipeline_document_upload",
              sourceLabel: source,
              propertyContext: [
                `Uploaded from Pipeline OM / Docs for ${property.canonicalAddress}`,
                "Treat this PDF as its own possible OM package. Extract the document address and do not assume it belongs to the selected property if the PDF says otherwise.",
              ].join("\n"),
              sourceMetadata: {
                selectedPropertyId: propertyId,
                selectedCanonicalAddress: property.canonicalAddress,
                splitByAddress: true,
                originalFileName: plan.filename,
                uploadedAt,
              },
              pool,
            });
            importedPropertyIds.add(result.propertyId);
            for (const uploadedDocument of result.uploadedDocuments ?? []) {
              addressAwareDocuments.push({
                id: uploadedDocument.id,
                propertyId: result.propertyId,
                filename: uploadedDocument.fileName,
                contentType: uploadedDocument.mimeType ?? null,
                category: "OM",
                createdAt: uploadedDocument.createdAt,
              });
            }
            addressAwareResults.push({
              filename: plan.filename,
              status: "imported",
              propertyId: result.propertyId,
              canonicalAddress: result.canonicalAddress,
              createdProperty: result.createdProperty,
              matchStrategy: result.matchStrategy,
              uploadedDocumentIds: (result.uploadedDocuments ?? []).map((document) => document.id),
              omReviewStatus: result.omReview?.ok ? "promoted" : result.omReview?.error ? "failed" : null,
              rentalFlow: null,
              dossier: null,
            });
          } catch (error) {
            const inserted = await persistUploadedDocumentForProperty({
              propertyId,
              docRepo,
              plan,
              source,
              uploadedAt,
              uploadedVia: "property_documents_batch_address_parse_failed",
              extraMetadata: {
                addressAwareImportFailed: true,
                addressAwareError: error instanceof Error ? error.message : String(error),
              },
            });
            selectedPropertyDocuments.push(inserted);
            addressAwareResults.push({
              filename: plan.filename,
              status: "failed",
              propertyId,
              canonicalAddress: property.canonicalAddress,
              createdProperty: false,
              matchStrategy: "fallback_selected_property",
              uploadedDocumentIds: [inserted.id],
              omReviewStatus: null,
              rentalFlow: null,
              dossier: null,
              error:
                error instanceof DealAnalysisOmImportError || error instanceof Error
                  ? error.message
                  : String(error),
            });
          }
        }

        const automationByPropertyId = new Map<
          string,
          Awaited<ReturnType<typeof runAddressAwareOmPostProcessing>>
        >();
        for (const importedPropertyId of importedPropertyIds) {
          const automation = await runAddressAwareOmPostProcessing(importedPropertyId, pool);
          automationByPropertyId.set(importedPropertyId, automation);
        }
        for (const result of addressAwareResults) {
          if (!result.propertyId || result.status !== "imported") continue;
          const automation = automationByPropertyId.get(result.propertyId);
          if (!automation) continue;
          result.rentalFlow = automation.rentalFlow;
          result.dossier = automation.dossier;
        }

        const shouldRefreshSelectedProperty = selectedPropertyDocuments.some((document) =>
          isOmIngestionCategory(document.category)
        );
        const selectedAutoSaved = shouldRefreshSelectedProperty
          ? await autoSavePropertyWithUnderwritingDocument(propertyId, pool).catch((error) => {
              console.warn("[properties documents upload batch] failed to auto-save fallback OM-backed property", {
                propertyId,
                error: error instanceof Error ? error.message : String(error),
              });
              return false;
            })
          : false;
        const selectedOmRefresh = shouldRefreshSelectedProperty
          ? await refreshOmFinancialsForProperty(propertyId, pool, {
              autoPromote: true,
              triggerDossier: true,
            }).catch((error) => ({
              documentsProcessed: 0,
              documentsSkippedNoFile: 0,
              runId: null,
              extractedSnapshotId: null,
              authoritativeSnapshotId: null,
              status: "failed" as const,
              reviewRequired: false,
              error: error instanceof Error ? error.message : String(error),
            }))
          : null;
        let selectedRentalFlow: { rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string } | null = null;
        if (shouldRefreshSelectedProperty && selectedOmRefresh?.status !== "failed") {
          selectedRentalFlow = await runRentalFlowForProperty(propertyId, pool).catch((error) => ({
            rentalUnitsCount: 0,
            hasLlmFinancials: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
        await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
        await refreshPropertyPipelineMetadata(propertyId, pool, {
          ...(selectedOmRefresh ? { underwritingStatus: selectedOmRefresh.reviewRequired ? "needs_assumptions" : "in_progress" } : {}),
          ...(selectedRentalFlow ? { rentalFlowStatus: selectedRentalFlow.error ? "failed" : "complete" } : {}),
        }).catch(() => {});

        const allDocuments = [...selectedPropertyDocuments, ...addressAwareDocuments];
        res.status(201).json({
          propertyId,
          documents: allDocuments,
          classifiedDocuments: allDocuments.map((document) => ({
            id: document.id,
            propertyId: document.propertyId,
            filename: document.filename,
            category: document.category,
            contentType: document.contentType ?? null,
          })),
          omRefresh: selectedOmRefresh,
          rentalFlow: selectedRentalFlow,
          autoSaved: selectedAutoSaved || Array.from(automationByPropertyId.values()).some((automation) => automation.autoSaved),
          addressAwareOmImport: {
            enabled: true,
            processed: addressAwareResults.length,
            imported: addressAwareResults.filter((result) => result.status === "imported").length,
            failed: addressAwareResults.filter((result) => result.status === "failed").length,
            createdProperties: addressAwareResults.filter((result) => result.status === "imported" && result.createdProperty).length,
            matchedProperties: addressAwareResults.filter((result) => result.status === "imported" && !result.createdProperty).length,
            dossierGenerated: addressAwareResults.filter((result) => result.dossier?.generated).length,
            results: addressAwareResults,
          },
        });
        return;
      }

      const documents: Array<Awaited<ReturnType<PropertyUploadedDocumentRepo["insert"]>>> = [];
      for (const plan of uploadPlans) {
        const docId = randomUUID();
        const filename = plan.filename;
        const filePath = await saveUploadedDocument(propertyId, docId, filename, plan.file.buffer);
        const inserted = await docRepo.insert({
          id: docId,
          propertyId,
          filename,
          contentType: plan.file.mimetype || null,
          filePath,
          category: plan.category,
          source,
          sourceMetadata: {
            uploadedVia: "property_documents_batch",
            uploadedAt,
            classificationMethod:
              typeof req.body?.category === "string" && req.body.category.trim() && req.body.category.trim().toLowerCase() !== "auto"
                ? "user_selected"
                : "filename_auto",
            originalFileName: filename,
            sizeBytes: plan.file.size ?? plan.file.buffer.length,
          },
          fileContent: plan.file.buffer,
        });
        documents.push(inserted);
      }

      const shouldRefreshOm = documents.some((document) => isOmIngestionCategory(document.category));
      const autoSaved = shouldRefreshOm
        ? await autoSavePropertyWithUnderwritingDocument(propertyId, pool).catch((error) => {
            console.warn("[properties documents upload batch] failed to auto-save OM-backed property", {
              propertyId,
              error: error instanceof Error ? error.message : String(error),
            });
            return false;
          })
        : false;
      const omRefresh = shouldRefreshOm
        ? await refreshOmFinancialsForProperty(propertyId, pool, {
            autoPromote: true,
            triggerDossier: false,
          }).catch((error) => ({
            documentsProcessed: 0,
            documentsSkippedNoFile: 0,
            runId: null,
            extractedSnapshotId: null,
            authoritativeSnapshotId: null,
            status: "failed" as const,
            reviewRequired: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        : null;

      let rentalFlow: { rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string } | null = null;
      if (shouldRefreshOm && omRefresh?.status !== "failed") {
        rentalFlow = await runRentalFlowForProperty(propertyId, pool).catch((error) => ({
          rentalUnitsCount: 0,
          hasLlmFinancials: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }

      await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
      await refreshPropertyPipelineMetadata(propertyId, pool, {
        ...(omRefresh ? { underwritingStatus: omRefresh.reviewRequired ? "needs_assumptions" : "in_progress" } : {}),
        ...(rentalFlow ? { rentalFlowStatus: rentalFlow.error ? "failed" : "complete" } : {}),
      }).catch(() => {});

      res.status(201).json({
        propertyId,
        documents,
        classifiedDocuments: documents.map((document) => ({
          id: document.id,
          filename: document.filename,
          category: document.category,
          contentType: document.contentType ?? null,
        })),
        omRefresh,
        rentalFlow,
        autoSaved,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[properties documents upload batch]", err);
      res.status(503).json({ error: "Failed to upload documents.", details: message });
    }
  }
);

/** POST /api/properties/:id/documents/upload - upload a document (multipart: file + category). */
router.post(
  "/properties/:id/documents/upload",
  (req, res, next) => {
    uploadMemory.single("file")(req, res, handleUploadMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const { id: propertyId } = req.params;
      const pool = getPool();
      const propertyRepo = new PropertyRepo({ pool });
      const docRepo = new PropertyUploadedDocumentRepo({ pool });
      const property = await propertyRepo.byId(propertyId);
      if (!property) {
        res.status(404).json({ error: "Property not found", propertyId });
        return;
      }
      const file = (req as Request & { file?: { buffer: Buffer; originalname?: string; mimetype?: string } })?.file;
      if (!file || !file.buffer) {
        res.status(400).json({ error: "Missing file. Send multipart/form-data with field 'file'." });
        return;
      }
      const category = parseUploadCategory(req.body?.category);
      const source = typeof req.body?.source === "string" ? req.body.source.trim() || null : null;
      const docId = randomUUID();
      const filename = file.originalname?.trim() || "document";
      const filePath = await saveUploadedDocument(propertyId, docId, filename, file.buffer);
      const inserted = await docRepo.insert({
        id: docId,
        propertyId,
        filename,
        contentType: file.mimetype || null,
        filePath,
        category,
        source,
        fileContent: file.buffer,
      });

      const autoSaved = isOmIngestionCategory(inserted.category)
        ? await autoSavePropertyWithUnderwritingDocument(propertyId, pool).catch((error) => {
            console.warn("[properties documents upload] failed to auto-save OM-backed property", {
              propertyId,
              error: error instanceof Error ? error.message : String(error),
            });
            return false;
          })
        : false;

      await syncPropertySourcingWorkflow(propertyId, { pool });
      await refreshPropertyPipelineMetadata(propertyId, pool);

      // Upload only persists the document. Authoritative OM promotion is manual now
      // so inbox noise or partial uploads do not replace a stronger dossier-backed state.
      res.status(201).json({ propertyId, document: inserted, autoSaved });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[properties documents upload]", err);
      res.status(503).json({ error: "Failed to upload document.", details: message });
    }
  }
);

/** GET /api/properties/:id/inquiry-emails - list inquiry emails for property. */
router.get("/properties/:id/inquiry-emails", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const emailRepo = new InquiryEmailRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const emails = await emailRepo.listByPropertyId(propertyId);
    res.json({ propertyId, emails });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties inquiry-emails list]", err);
    res.status(503).json({ error: "Failed to list inquiry emails.", details: message });
  }
});

interface InquiryGuardState {
  propertyId: string;
  toAddress: string | null;
  lastInquirySentAt: string | null;
  hasOmDocument: boolean;
  sameRecipientSamePropertyAt: string | null;
  sameRecipientOtherProperties: Array<{ propertyId: string; canonicalAddress: string; sentAt: string }>;
  sameBrokerTeamOtherProperties: Array<{
    propertyId: string;
    canonicalAddress: string;
    sentAt: string;
    sharedBrokers: string[];
  }>;
}

function normalizeRecipientEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

interface InquiryGuardBrokerTeamHistoryRow {
  property_id: string;
  canonical_address: string;
  sent_at: Date | string;
  listing_agent_enrichment: AgentEnrichmentEntry[] | null;
  contact_email: string | null;
  candidate_contacts: RecipientContactCandidate[] | null;
}

function formatInquiryGuardSentAt(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function listBrokerTeamOverlapHistory(
  pool: import("pg").Pool,
  propertyId: string,
  toAddress?: string | null
): Promise<Array<{ propertyId: string; canonicalAddress: string; sentAt: string; sharedBrokers: string[] }>> {
  const recipientResolutionRepo = new RecipientResolutionRepo({ pool });
  const [listing, resolution, historyResult] = await Promise.all([
    getPrimaryListingForProperty(propertyId, pool),
    recipientResolutionRepo.get(propertyId),
    pool.query<InquiryGuardBrokerTeamHistoryRow>(
      `SELECT
         p.id AS property_id,
         p.canonical_address,
         inquiry.sent_at,
         listing.agent_enrichment AS listing_agent_enrichment,
         rr.contact_email,
         rr.candidate_contacts
       FROM properties p
       INNER JOIN LATERAL (
         SELECT sent_at
         FROM property_inquiry_sends s
         WHERE s.property_id = p.id
         ORDER BY s.sent_at DESC NULLS LAST
         LIMIT 1
       ) inquiry ON true
       LEFT JOIN LATERAL (
         SELECT l.agent_enrichment
         FROM listing_property_matches m
         INNER JOIN listings l ON l.id = m.listing_id
         WHERE m.property_id = p.id
         ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC
         LIMIT 1
       ) listing ON true
       LEFT JOIN property_recipient_resolution rr ON rr.property_id = p.id
       WHERE p.id <> $1
       ORDER BY inquiry.sent_at DESC NULLS LAST`,
      [propertyId]
    ),
  ]);

  const currentBrokers = buildBrokerTeamRecords({
    listingAgents: Array.isArray(listing?.agentEnrichment) ? listing.agentEnrichment : [],
    candidateContacts: resolution?.candidateContacts ?? [],
    resolvedContactEmail: resolution?.contactEmail ?? null,
    extraRecords: toAddress ? [{ email: toAddress }] : [],
  });
  if (currentBrokers.length === 0) return [];

  return findBrokerTeamOverlapMatches({
    currentBrokers,
    contactedProperties: historyResult.rows
      .map((row) => {
        const sentAt = formatInquiryGuardSentAt(row.sent_at);
        if (!sentAt) return null;
        return {
          propertyId: row.property_id,
          canonicalAddress: row.canonical_address,
          sentAt,
          brokers: buildBrokerTeamRecords({
            listingAgents: Array.isArray(row.listing_agent_enrichment) ? row.listing_agent_enrichment : [],
            candidateContacts: Array.isArray(row.candidate_contacts) ? row.candidate_contacts : [],
            resolvedContactEmail: row.contact_email ?? null,
          }),
        };
      })
      .filter(
        (
          row
        ): row is {
          propertyId: string;
          canonicalAddress: string;
          sentAt: string;
          brokers: ReturnType<typeof buildBrokerTeamRecords>;
        } => row != null
      ),
  });
}

type BulkInquiryRecipientSource =
  | "manual_override"
  | "primary_broker"
  | "secondary_broker"
  | "listing_candidate"
  | "missing";

interface BulkInquiryRecipient {
  email: string | null;
  name: string | null;
  source: BulkInquiryRecipientSource;
}

interface PreparedInquirySend {
  normalizedTo: string;
  guard: InquiryGuardState;
}

interface CompletedInquirySend {
  messageId: string;
  sentAt: string;
  threadId: string | null;
  guard: InquiryGuardState;
}

class InquirySendBlockedError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly guard: InquiryGuardState,
    public readonly gmailHistory?: unknown
  ) {
    super(message);
    this.name = "InquirySendBlockedError";
  }
}

function buildInquiryDraft(input: {
  canonicalAddress: string;
  recipientName?: string | null;
  to?: string | null;
}): { to: string; subject: string; body: string } {
  const addressLine = input.canonicalAddress.split(",")[0]?.trim() || input.canonicalAddress;
  const firstName = input.recipientName?.trim() ? input.recipientName.trim().split(/\s+/)[0] ?? null : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  return {
    to: input.to?.trim() ?? "",
    subject: `Inquiry about ${addressLine}`,
    body: `${greeting}

My name is Tyler Tsay, and I'm reaching out on behalf of a client regarding the property at ${addressLine} currently on the market. We are evaluating the building and would appreciate the opportunity to review further.

Would you be able to share the OM, T-12/operating statement, current rent roll, and expense detail? If available, we would also appreciate any broker comp package or market analysis, sale/rent comps, NOI/cap-rate support, and whisper pricing color.

Thanks in advance - looking forward to taking a look.

Best,
Tyler Tsay
617 306 3336
tyler@stayhaus.co`,
  };
}

function extractInquiryErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const g = err as Error & {
      response?: {
        data?: {
          error?: string | { message?: string; errors?: Array<{ message?: string }> };
          message?: string;
        };
      };
    };
    const d = g.response?.data;
    if (d) {
      const e = d.error;
      if (typeof e === "string") return e;
      if (e && typeof e === "object" && typeof e.message === "string") return e.message;
      if (e && typeof e === "object" && Array.isArray(e.errors) && e.errors[0]?.message) return e.errors[0].message;
      if (typeof d.message === "string") return d.message;
    }
    return g.message;
  }
  return String(err);
}

async function resolveBulkInquiryRecipient(
  propertyId: string,
  pool: import("pg").Pool
): Promise<BulkInquiryRecipient> {
  const resolution = await syncRecipientResolution(propertyId, pool);
  if (resolution.status === "manual_override" && resolution.contactEmail) {
    return {
      email: normalizeRecipientEmail(resolution.contactEmail),
      name: resolution.candidateContacts.find(
        (candidate) => normalizeRecipientEmail(candidate.email) === normalizeRecipientEmail(resolution.contactEmail)
      )?.name?.trim() || null,
      source: "manual_override",
    };
  }

  const listing = await getPrimaryListingForProperty(propertyId, pool);
  const seen = new Set<string>();
  const enrichedAgents = Array.isArray(listing?.agentEnrichment) ? listing.agentEnrichment : [];
  for (let index = 0; index < enrichedAgents.length; index += 1) {
    const agent = enrichedAgents[index] as AgentEnrichmentEntry | null | undefined;
    const email = normalizeRecipientEmail(agent?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    return {
      email,
      name: agent?.name?.trim() || null,
      source: index === 0 ? "primary_broker" : index === 1 ? "secondary_broker" : "listing_candidate",
    };
  }

  const fallbackCandidate = resolution.candidateContacts.find((candidate) => normalizeRecipientEmail(candidate.email));
  if (fallbackCandidate) {
    return {
      email: normalizeRecipientEmail(fallbackCandidate.email),
      name: fallbackCandidate.name?.trim() || null,
      source: "listing_candidate",
    };
  }

  return {
    email: null,
    name: null,
    source: "missing",
  };
}

async function prepareInquirySend(params: {
  pool: import("pg").Pool;
  propertyId: string;
  canonicalAddress: string;
  toAddress: string;
  force?: boolean;
}): Promise<PreparedInquirySend> {
  const normalizedTo = normalizeRecipientEmail(params.toAddress);
  if (!normalizedTo) {
    throw new Error("Missing or invalid 'to' address.");
  }
  const guard = await getInquiryGuardState(params.pool, params.propertyId, normalizedTo);
  if (guard.hasOmDocument && !params.force) {
    throw new InquirySendBlockedError(
      "OM already received for this property. Inquiry email blocked.",
      "om_already_received",
      guard
    );
  }
  if (guard.lastInquirySentAt && !params.force) {
    throw new InquirySendBlockedError(
      "An inquiry has already been logged for this property. Inquiry email blocked until you confirm a resend.",
      "inquiry_already_sent",
      guard
    );
  }
  if (guard.sameRecipientOtherProperties.length > 0 && !params.force) {
    throw new InquirySendBlockedError(
      "This broker email has already been contacted for another property. Inquiry email blocked until you confirm.",
      "recipient_contacted_elsewhere",
      guard
    );
  }
  if (guard.sameBrokerTeamOtherProperties.length > 0 && !params.force) {
    throw new InquirySendBlockedError(
      "A broker on this listing team was already contacted on another property. Inquiry email blocked until you confirm.",
      "broker_team_contacted_elsewhere",
      guard
    );
  }
  if (!params.force) {
    const gmailHistory = await findBrokerPropertyConversationHistory({
      toAddress: normalizedTo,
      canonicalAddress: params.canonicalAddress,
    });
    if (gmailHistory.matches.length > 0) {
      throw new InquirySendBlockedError(
        "A Gmail conversation already exists for this broker and property. Inquiry email blocked until you confirm a resend.",
        "gmail_history_exists",
        guard,
        gmailHistory
      );
    }
  }
  return { normalizedTo, guard };
}

async function completeInquirySend(params: {
  pool: import("pg").Pool;
  propertyId: string;
  canonicalAddress: string;
  normalizedTo: string;
  subject: string;
  body: string;
}): Promise<CompletedInquirySend> {
  const result = await gmailSendMessage(params.normalizedTo, params.subject.trim() || "Inquiry", params.body);
  const inquirySendRepo = new InquirySendRepo({ pool: params.pool });
  const { sentAt } = await inquirySendRepo.create(params.propertyId, result.id, {
    toAddress: params.normalizedTo,
    source: "gmail_api",
    gmailThreadId: result.threadId,
  });
  await syncPropertySourcingWorkflow(params.propertyId, { pool: params.pool });
  return {
    messageId: result.id,
    sentAt,
    threadId: result.threadId,
    guard: await getInquiryGuardState(params.pool, params.propertyId, params.normalizedTo),
  };
}

async function getInquiryGuardState(
  pool: import("pg").Pool,
  propertyId: string,
  toAddress?: string | null
): Promise<InquiryGuardState> {
  const inquirySendRepo = new InquirySendRepo({ pool });
  const normalizedTo = normalizeRecipientEmail(toAddress);
  const [lastInquirySentAt, omResult, recipientHistory, brokerTeamHistory] = await Promise.all([
    inquirySendRepo.getLastSentAt(propertyId),
    pool.query<{ has_om_document: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM property_inquiry_documents d
         WHERE d.property_id = $1
           AND LOWER(COALESCE(d.filename, '')) ~ '(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)'
       ) OR EXISTS (
         SELECT 1
         FROM property_uploaded_documents u
         WHERE u.property_id = $1
           AND u.category IN ('OM', 'Brochure', 'Rent Roll')
       ) OR EXISTS (
         SELECT 1
         FROM properties p
         WHERE p.id = $1
           AND COALESCE(p.details->'omData'->'authoritative', 'null'::jsonb) <> 'null'::jsonb
       ) AS has_om_document`,
      [propertyId]
    ),
    normalizedTo ? inquirySendRepo.listByRecipient(normalizedTo) : Promise.resolve([]),
    listBrokerTeamOverlapHistory(pool, propertyId, normalizedTo),
  ]);

  const sameRecipientSamePropertyAt =
    recipientHistory.find((row) => row.propertyId === propertyId)?.sentAt ?? null;
  const sameRecipientOtherProperties = recipientHistory.filter((row) => row.propertyId !== propertyId);
  const sameRecipientPropertyIds = new Set(sameRecipientOtherProperties.map((row) => row.propertyId));
  const sameBrokerTeamOtherProperties = brokerTeamHistory.filter((row) => !sameRecipientPropertyIds.has(row.propertyId));

  return {
    propertyId,
    toAddress: normalizedTo,
    lastInquirySentAt,
    hasOmDocument: Boolean(omResult.rows[0]?.has_om_document),
    sameRecipientSamePropertyAt,
    sameRecipientOtherProperties,
    sameBrokerTeamOtherProperties,
  };
}

/** GET /api/properties/:id/inquiry-guard - inquiry history for this property, recipient, and overlapping broker teams. */
router.get("/properties/:id/inquiry-guard", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const toAddress = typeof req.query.to === "string" ? req.query.to : null;
    const guard = await getInquiryGuardState(pool, propertyId, toAddress);
    res.json(guard);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties inquiry-guard]", err);
    res.status(503).json({ error: "Failed to load inquiry guard.", details: message });
  }
});

/** GET /api/properties/:id/recipient-resolution - current broker recipient resolution plus candidate emails from listing enrichment. */
router.get("/properties/:id/recipient-resolution", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const recipientResolution = await syncRecipientResolution(propertyId, pool);
    res.json({ propertyId, recipientResolution });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties recipient-resolution]", err);
    res.status(503).json({ error: "Failed to load broker recipient.", details: message });
  }
});

/** PUT /api/properties/:id/recipient-resolution/manual - save a manual preferred broker email override. */
router.put("/properties/:id/recipient-resolution/manual", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const email = normalizeRecipientEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: "Missing or invalid broker email." });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() || null : null;
    const firm = typeof req.body?.firm === "string" ? req.body.firm.trim() || null : null;
    await setManualRecipientResolution(
      propertyId,
      {
        email,
        name,
        firm,
      },
      pool
    );
    const summary = await syncPropertySourcingWorkflow(propertyId, { pool });
    res.json({
      ok: true,
      propertyId,
      recipientResolution: summary.recipientResolution,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties recipient-resolution manual put]", err);
    res.status(503).json({ error: "Failed to save broker email override.", details: message });
  }
});

/** DELETE /api/properties/:id/recipient-resolution/manual - clear the manual preferred broker email override. */
router.delete("/properties/:id/recipient-resolution/manual", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const recipientResolutionRepo = new RecipientResolutionRepo({ pool });
    await recipientResolutionRepo.delete(propertyId);
    const summary = await syncPropertySourcingWorkflow(propertyId, { pool });
    res.json({
      ok: true,
      propertyId,
      recipientResolution: summary.recipientResolution,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties recipient-resolution manual delete]", err);
    res.status(503).json({ error: "Failed to clear broker email override.", details: message });
  }
});

/** POST /api/properties/:id/mark-inquiry-sent - log a prior/manual inquiry so duplicate-send guardrails persist across refreshes. */
router.post("/properties/:id/mark-inquiry-sent", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const toAddress = normalizeRecipientEmail(req.body?.to);
    const sentAt = typeof req.body?.sentAt === "string" ? req.body.sentAt : null;
    workflowRunId = await createWorkflowRun({
      runType: "mark_inquiry_sent",
      displayName: "Mark inquiry sent",
      scopeLabel: property.canonicalAddress,
      triggerSource: "manual",
      totalItems: 1,
      metadata: { propertyIds: [propertyId], toAddress, sentAt },
      steps: [
        {
          stepKey: "inquiry",
          totalItems: 1,
          status: "running",
          startedAt: workflowStartedAt,
          lastMessage: "Recording inquiry history",
        },
      ],
    });
    const inquirySendRepo = new InquirySendRepo({ pool });
    const created = await inquirySendRepo.create(propertyId, null, {
      toAddress,
      source: "manual",
      sentAt,
      gmailThreadId: typeof req.body?.gmailThreadId === "string" ? req.body.gmailThreadId : null,
    });
    await syncPropertySourcingWorkflow(propertyId, { pool });
    const guard = await getInquiryGuardState(pool, propertyId, toAddress);
    res.status(201).json({
      ok: true,
      propertyId,
      inquirySend: {
        id: created.id,
        sentAt: created.sentAt,
        toAddress,
        source: "manual",
      },
      guard,
    });
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inquiry",
      totalItems: 1,
      completedItems: 1,
      failedItems: 0,
      status: "completed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: "Inquiry history recorded",
    });
    await updateWorkflowRun(workflowRunId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties mark-inquiry-sent]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inquiry",
      totalItems: 1,
      completedItems: 0,
      failedItems: 1,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "Failed to record inquiry history",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Failed to record inquiry send.", details: message });
  }
});

/** POST /api/properties/send-bulk-inquiry-emails - send inquiry emails for selected properties using manual override first, then listing broker order. */
router.post("/properties/send-bulk-inquiry-emails", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const rawPropertyIds: unknown[] = Array.isArray(req.body?.propertyIds) ? (req.body.propertyIds as unknown[]) : [];
    const propertyIds = rawPropertyIds.filter(
      (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
    );
    if (propertyIds.length === 0) {
      res.status(400).json({ error: "Provide at least one property ID." });
      return;
    }

    const uniquePropertyIds = [...new Set(propertyIds)];
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    workflowRunId = await createWorkflowRun({
      runType: "send_bulk_inquiry_email",
      displayName: "Send bulk inquiry emails",
      scopeLabel: `${uniquePropertyIds.length} selected propert${uniquePropertyIds.length === 1 ? "y" : "ies"}`,
      triggerSource: "manual",
      totalItems: uniquePropertyIds.length,
      metadata: { propertyIds: uniquePropertyIds },
      steps: [
        {
          stepKey: "inquiry",
          totalItems: uniquePropertyIds.length,
          status: "running",
          startedAt: workflowStartedAt,
          lastMessage: `Preparing inquiry emails for ${uniquePropertyIds.length} selected propert${uniquePropertyIds.length === 1 ? "y" : "ies"}`,
        },
      ],
    });

    const results: Array<{
      propertyId: string;
      canonicalAddress: string;
      status: "sent" | "skipped" | "failed";
      toAddress: string | null;
      recipientSource: BulkInquiryRecipientSource;
      messageId?: string | null;
      sentAt?: string | null;
      reasonCode?: string | null;
      reason?: string | null;
    }> = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const propertyId of uniquePropertyIds) {
      const property = await propertyRepo.byId(propertyId);
      if (!property) {
        failed += 1;
        results.push({
          propertyId,
          canonicalAddress: propertyId,
          status: "failed",
          toAddress: null,
          recipientSource: "missing",
          reasonCode: "property_not_found",
          reason: "Property not found.",
        });
        continue;
      }

      const recipient = await resolveBulkInquiryRecipient(propertyId, pool);
      if (!recipient.email) {
        skipped += 1;
        await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
        results.push({
          propertyId,
          canonicalAddress: property.canonicalAddress,
          status: "skipped",
          toAddress: null,
          recipientSource: recipient.source,
          reasonCode: "missing_recipient",
          reason: "No broker email is available for this property.",
        });
        continue;
      }

      const draft = buildInquiryDraft({
        canonicalAddress: property.canonicalAddress,
        recipientName: recipient.name,
        to: recipient.email,
      });

      try {
        const prepared = await prepareInquirySend({
          pool,
          propertyId,
          canonicalAddress: property.canonicalAddress,
          toAddress: recipient.email,
        });
        const completed = await completeInquirySend({
          pool,
          propertyId,
          canonicalAddress: property.canonicalAddress,
          normalizedTo: prepared.normalizedTo,
          subject: draft.subject,
          body: draft.body,
        });
        sent += 1;
        results.push({
          propertyId,
          canonicalAddress: property.canonicalAddress,
          status: "sent",
          toAddress: prepared.normalizedTo,
          recipientSource: recipient.source,
          messageId: completed.messageId,
          sentAt: completed.sentAt,
        });
      } catch (err) {
        if (err instanceof InquirySendBlockedError) {
          skipped += 1;
          results.push({
            propertyId,
            canonicalAddress: property.canonicalAddress,
            status: "skipped",
            toAddress: recipient.email,
            recipientSource: recipient.source,
            reasonCode: err.code,
            reason: err.message,
          });
          continue;
        }

        failed += 1;
        results.push({
          propertyId,
          canonicalAddress: property.canonicalAddress,
          status: "failed",
          toAddress: recipient.email,
          recipientSource: recipient.source,
          reasonCode: "send_failed",
          reason: extractInquiryErrorMessage(err),
        });
      }
    }

    const status = deriveWorkflowStatusFromCounts({
      totalItems: uniquePropertyIds.length,
      completedItems: sent,
      failedItems: failed,
      skippedItems: skipped,
    });
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inquiry",
      totalItems: uniquePropertyIds.length,
      completedItems: sent,
      failedItems: failed,
      skippedItems: skipped,
      status,
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: `${sent} sent, ${skipped} skipped, ${failed} failed`,
      lastError: failed > 0 ? results.find((result) => result.status === "failed")?.reason ?? null : null,
      metadata: { results },
    });
    await mergeWorkflowRunMetadata(workflowRunId, {
      sent,
      skipped,
      failed,
      results,
    });
    await updateWorkflowRun(workflowRunId, {
      status,
      finishedAt: new Date().toISOString(),
    });

    res.json({
      ok: true,
      sent,
      skipped,
      failed,
      results,
    });
  } catch (err) {
    const message = extractInquiryErrorMessage(err);
    console.error("[properties send-bulk-inquiry-emails]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inquiry",
      totalItems: 1,
      completedItems: 0,
      failedItems: 1,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "Bulk inquiry send failed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Failed to send bulk inquiry emails.", details: message });
  }
});

/** POST /api/properties/:id/send-inquiry-email - send inquiry email via Gmail API. Body: { to, subject, body }. */
router.post("/properties/:id/send-inquiry-email", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const { to, subject, body } = req.body ?? {};
    const force = req.body?.force === true;
    if (typeof to !== "string" || !to.trim()) {
      res.status(400).json({ error: "Missing or invalid 'to' address." });
      return;
    }
    const prepared = await prepareInquirySend({
      pool,
      propertyId,
      canonicalAddress: property.canonicalAddress,
      toAddress: to,
      force,
    });
    const subj = typeof subject === "string" ? subject.trim() : "";
    const b = typeof body === "string" ? body : "";
    workflowRunId = await createWorkflowRun({
      runType: "send_inquiry_email",
      displayName: "Send inquiry email",
      scopeLabel: property.canonicalAddress,
      triggerSource: "manual",
      totalItems: 1,
      metadata: { propertyIds: [propertyId], toAddress: prepared.normalizedTo },
      steps: [
        {
          stepKey: "inquiry",
          totalItems: 1,
          status: "running",
          startedAt: workflowStartedAt,
          lastMessage: `Sending inquiry to ${prepared.normalizedTo}`,
        },
      ],
    });
    const completed = await completeInquirySend({
      pool,
      propertyId,
      canonicalAddress: property.canonicalAddress,
      normalizedTo: prepared.normalizedTo,
      subject: subj,
      body: b,
    });
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inquiry",
      totalItems: 1,
      completedItems: 1,
      failedItems: 0,
      status: "completed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastMessage: "Inquiry email sent",
    });
    await mergeWorkflowRunMetadata(workflowRunId, {
      messageId: completed.messageId,
      sentAt: completed.sentAt,
    });
    await updateWorkflowRun(workflowRunId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
    res.json({ ok: true, messageId: completed.messageId, sentAt: completed.sentAt, guard: completed.guard });
  } catch (err) {
    if (err instanceof InquirySendBlockedError) {
      res.status(409).json({
        error: err.message,
        code: err.code,
        guard: err.guard,
        ...(err.gmailHistory ? { gmailHistory: err.gmailHistory } : {}),
      });
      return;
    }

    const message = extractInquiryErrorMessage(err);
    console.error("[properties send-inquiry-email]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "inquiry",
      totalItems: 1,
      completedItems: 0,
      failedItems: 1,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "Inquiry send failed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Failed to send email.", details: message });
  }
});

/** GET /api/properties/:id - single property with full details (for fresh enrichment data in UI). */
router.get("/properties/:id", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new PropertyRepo({ pool });
    const property = await repo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const inquirySendRepo = new InquirySendRepo({ pool });
    const signalsRepo = new DealSignalsRepo({ pool });
    const overridesRepo = new DealScoreOverridesRepo({ pool });
    const details = property.details as PropertyDetails | null;
    const [lastInquirySentAt, latestSignals, scoreOverride] = await Promise.all([
      inquirySendRepo.getLastSentAt(propertyId),
      getPersistedDossierSignals({ pool, propertyId, details, signalsRepo }),
      overridesRepo.getActiveByPropertyId(propertyId),
    ]);
    const dossierReady = hasCompletedDealDossier(details);
    const dossierSummary = getPropertyDossierSummary(details);
    const calculatedDealScore =
      dossierSummary?.calculatedDealScore
      ?? dossierSummary?.dealScore
      ?? latestSignals?.dealScore
      ?? null;
    const rentRollComparison = getRentRollComparison(details);
    res.json({
      id: property.id,
      canonicalAddress: property.canonicalAddress,
      details: property.details ?? null,
      createdAt: property.createdAt,
      updatedAt: property.updatedAt,
      lastInquirySentAt: lastInquirySentAt ?? null,
      rentRollComparison: rentRollComparison ?? undefined,
      dealScore: dossierReady ? resolveEffectiveDealScore(calculatedDealScore, scoreOverride) : null,
      calculatedDealScore: dossierReady ? calculatedDealScore : null,
      scoreOverride: dossierReady ? scoreOverride ?? null : null,
      dealSignals: dossierReady ? latestSignals ?? null : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties get by id]", err);
    res.status(503).json({ error: "Failed to load property.", details: message });
  }
});

function optionalNonNegativeNumber(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "invalid";
  return value;
}

function optionalNumber(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "invalid";
  return value;
}

function optionalTrimmedText(value: unknown, maxLength = 20_000): string | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : "invalid";
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

router.post("/properties/:id/om-calculation", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const requestBody = req.body as Record<string, unknown> | null | undefined;
    const assumptionOverrides = parseDossierAssumptionOverridesPayload(req.body?.assumptions);
    const brokerEmailNotes = optionalTrimmedText(req.body?.brokerEmailNotes);
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (assumptionOverrides === "invalid") {
      res.status(400).json({
        error:
          "assumptions must be an object containing valid numbers, an optional investment profile, and an optional YYYY-MM-DD acquisition date.",
      });
      return;
    }
    if (brokerEmailNotes === "invalid") {
      res.status(400).json({
        error: "brokerEmailNotes must be a string under 20,000 characters.",
      });
      return;
    }
    if (unitModelRows === "invalid" || expenseModelRows === "invalid") {
      res.status(400).json({
        error: "unitModelRows and expenseModelRows must be arrays of valid table rows.",
      });
      return;
    }

    const snapshot = await buildOmCalculationSnapshot({
      propertyId,
      assumptionOverrides,
      brokerEmailNotes,
      unitModelRows:
        requestBody && Object.prototype.hasOwnProperty.call(requestBody, "unitModelRows")
          ? unitModelRows
          : undefined,
      expenseModelRows:
        requestBody && Object.prototype.hasOwnProperty.call(requestBody, "expenseModelRows")
          ? expenseModelRows
          : undefined,
    });
    res.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 503;
    console.error("[properties om calculation]", err);
    res.status(status).json({ error: "Failed to build OM calculation.", details: message });
  }
});

/** PUT /api/properties/:id/dossier-settings - save per-property costs plus optional broker email notes. */
router.put("/properties/:id/dossier-settings", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const requestBody = req.body as Record<string, unknown> | null | undefined;
    const assumptionOverrides = parseDossierAssumptionOverridesPayload(req.body);
    const brokerEmailNotes = optionalTrimmedText(req.body?.brokerEmailNotes);
    const unitModelRows = parsePropertyDealDossierUnitModelRows(req.body?.unitModelRows);
    const expenseModelRows = parsePropertyDealDossierExpenseModelRows(req.body?.expenseModelRows);
    if (
      assumptionOverrides === "invalid" ||
      brokerEmailNotes === "invalid" ||
      unitModelRows === "invalid" ||
      expenseModelRows === "invalid"
    ) {
      res.status(400).json({
        error:
          "Assumption fields must be valid numbers or null with optional investment profile / acquisition date fields, brokerEmailNotes must be a string under 20,000 characters, and table rows must be valid arrays.",
      });
      return;
    }
    const pool = getPool();
    const repo = new PropertyRepo({ pool });
    const property = await repo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const rawExistingAssumptions = getRawPropertyDossierAssumptions(property.details);
    const existingAssumptions = getPropertyDossierAssumptions(property.details);
    const assumptionsPatch: Record<string, unknown> = {
      ...(rawExistingAssumptions ?? {}),
      ...(existingAssumptions ?? {}),
      updatedAt: new Date().toISOString(),
    };
    for (const key of DOSSIER_ASSUMPTION_NUMERIC_FIELDS) {
      if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, key)) {
        assumptionsPatch[key] = assumptionOverrides?.[key] ?? null;
      }
    }
    if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, "investmentProfile")) {
      assumptionsPatch.investmentProfile = assumptionOverrides?.investmentProfile ?? null;
    }
    if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, "targetAcquisitionDate")) {
      assumptionsPatch.targetAcquisitionDate = assumptionOverrides?.targetAcquisitionDate ?? null;
    }
    if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, "unitModelRows")) {
      assumptionsPatch.unitModelRows = unitModelRows;
    }
    if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, "expenseModelRows")) {
      assumptionsPatch.expenseModelRows = expenseModelRows;
    }
    if (requestBody && Object.prototype.hasOwnProperty.call(requestBody, "brokerEmailNotes")) {
      assumptionsPatch.brokerEmailNotes = brokerEmailNotes;
    }
    await repo.updateDetails(propertyId, "dealDossier.assumptions", assumptionsPatch);
    res.json({
      ok: true,
      propertyId,
      assumptions: assumptionsPatch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties dossier settings]", err);
    res.status(503).json({ error: "Failed to save dossier settings.", details: message });
  }
});

/** POST /api/properties/:id/compute-score - return the latest dossier-backed deal score/signals for this property. */
router.post("/properties/:id/compute-score", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const overridesRepo = new DealScoreOverridesRepo({ pool });
    const signalsRepo = new DealSignalsRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const details = property.details as PropertyDetails | null;
    if (!hasCompletedDealDossier(details)) {
      res.status(409).json({
        error: "Deal dossier has not been generated for this property.",
        propertyId,
      });
      return;
    }
    const [scoreOverride, latestSignals] = await Promise.all([
      overridesRepo.getActiveByPropertyId(propertyId),
      getPersistedDossierSignals({ pool, propertyId, details, signalsRepo }),
    ]);
    const dossierSummary = getPropertyDossierSummary(details);
    const calculatedDealScore =
      dossierSummary?.calculatedDealScore
      ?? dossierSummary?.dealScore
      ?? latestSignals?.dealScore
      ?? null;
    if (!latestSignals) {
      res.status(409).json({
        error: "No persisted deal signals found for this property's generated dossier.",
        propertyId,
      });
      return;
    }
    res.json({
      dealScore: resolveEffectiveDealScore(calculatedDealScore, scoreOverride),
      calculatedDealScore,
      scoreOverride: scoreOverride ?? null,
      dealSignals: latestSignals,
      scoringResult: {
        isScoreable: latestSignals.dealScore != null,
        assetYieldScore: latestSignals.scoreBreakdown?.returnScore ?? null,
        scoreBreakdown: latestSignals.scoreBreakdown ?? null,
        confidenceScore: latestSignals.confidenceScore ?? null,
        riskScore: latestSignals.riskScore ?? null,
        positiveSignals: [],
        negativeSignals: latestSignals.riskFlags ?? [],
        assetCapRate: latestSignals.assetCapRate ?? null,
        adjustedCapRate: latestSignals.adjustedCapRate ?? null,
        riskFlags: latestSignals.riskFlags ?? null,
        capReasons: latestSignals.capReasons ?? null,
        riskProfile: latestSignals.riskProfile ?? null,
        scoreSensitivity: latestSignals.scoreSensitivity ?? null,
        scoreVersion: latestSignals.scoreVersion ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties compute-score]", err);
    res.status(503).json({ error: "Failed to load dossier-backed deal score.", details: message });
  }
});

/** POST /api/properties/:id/score-override - set an active manual score override. */
router.post("/properties/:id/score-override", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const rawScore = req.body?.score;
    const score =
      typeof rawScore === "number"
        ? rawScore
        : typeof rawScore === "string"
          ? Number(rawScore)
          : Number.NaN;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const createdBy = typeof req.body?.createdBy === "string" ? req.body.createdBy.trim() : "web";
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      res.status(400).json({ error: "score must be a number between 0 and 100." });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "reason is required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const overridesRepo = new DealScoreOverridesRepo({ pool });
    const override = await overridesRepo.setActive({
      propertyId,
      score: Math.round(score),
      reason,
      createdBy,
    });
    const signalsRepo = new DealSignalsRepo({ pool });
    const details = property.details as PropertyDetails | null;
    const [dossierSignals, dossierSummary] = await Promise.all([
      getPersistedDossierSignals({ pool, propertyId, details, signalsRepo }),
      Promise.resolve(getPropertyDossierSummary(details)),
    ]);
    const calculatedDealScore =
      dossierSummary?.calculatedDealScore
      ?? dossierSummary?.dealScore
      ?? dossierSignals?.dealScore
      ?? null;
    res.json({
      ok: true,
      dealScore: resolveEffectiveDealScore(calculatedDealScore, override),
      calculatedDealScore,
      scoreOverride: override,
      dealSignals: dossierSignals ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties score-override create]", err);
    res.status(503).json({ error: "Failed to save score override.", details: message });
  }
});

/** DELETE /api/properties/:id/score-override - clear an active manual score override. */
router.delete("/properties/:id/score-override", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const overridesRepo = new DealScoreOverridesRepo({ pool });
    const cleared = await overridesRepo.clearActive(propertyId);
    const signalsRepo = new DealSignalsRepo({ pool });
    const details = property.details as PropertyDetails | null;
    const [dossierSignals, dossierSummary] = await Promise.all([
      getPersistedDossierSignals({ pool, propertyId, details, signalsRepo }),
      Promise.resolve(getPropertyDossierSummary(details)),
    ]);
    const dossierReady = hasCompletedDealDossier(details);
    const calculatedDealScore =
      dossierSummary?.calculatedDealScore
      ?? dossierSummary?.dealScore
      ?? dossierSignals?.dealScore
      ?? null;
    res.json({
      ok: true,
      cleared,
      dealScore: dossierReady ? calculatedDealScore : null,
      calculatedDealScore: dossierReady ? calculatedDealScore : null,
      scoreOverride: null,
      dealSignals: dossierReady ? dossierSignals ?? null : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties score-override delete]", err);
    res.status(503).json({ error: "Failed to clear score override.", details: message });
  }
});

/** GET /api/properties/:id/listing - primary (first) linked listing for this property, for display in canonical detail. */
router.get("/properties/:id/listing", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const matchRepo = new MatchRepo({ pool });
    const listingRepo = new ListingRepo({ pool });
    const { matches } = await matchRepo.list({ propertyId, limit: 1 });
    const match = matches[0];
    if (!match) {
      res.json({ propertyId, listing: null });
      return;
    }
    const listing = await listingRepo.byId(match.listingId);
    res.json({ propertyId, listing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties listing]", err);
    res.status(503).json({ error: "Failed to load primary listing.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/permits - DOB permit rows for unified violations/permits table. */
router.get("/properties/:id/enrichment/permits", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new PermitRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, permits: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment permits]", err);
    res.status(503).json({ error: "Failed to load permits.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/state - last run and outcome per enrichment module. */
router.get("/properties/:id/enrichment/state", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const stateRepo = new PropertyEnrichmentStateRepo({ pool });
    const names = [
      "permits",
      "zoning_ztl",
      "certificate_of_occupancy",
      "hpd_registration",
      "hpd_violations",
      "dob_complaints",
      "housing_litigations",
    ];
    const states: Record<string, { lastRefreshedAt: string; lastSuccessAt: string | null; lastError: string | null; statsJson: unknown }> = {};
    for (const name of names) {
      const row = await stateRepo.get(propertyId, name);
      if (row) {
        states[name] = {
          lastRefreshedAt: row.lastRefreshedAt,
          lastSuccessAt: row.lastSuccessAt,
          lastError: row.lastError,
          statsJson: row.statsJson ?? null,
        };
      }
    }
    res.json({ propertyId, states });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment state]", err);
    res.status(503).json({ error: "Failed to load enrichment state.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/violations - HPD violations rows. */
router.get("/properties/:id/enrichment/violations", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new HpdViolationsRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, violations: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment violations]", err);
    res.status(503).json({ error: "Failed to load violations.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/complaints - DOB complaints rows. */
router.get("/properties/:id/enrichment/complaints", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new DobComplaintsRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, complaints: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment complaints]", err);
    res.status(503).json({ error: "Failed to load complaints.", details: message });
  }
});

/** GET /api/properties/:id/enrichment/litigations - Housing litigations rows. */
router.get("/properties/:id/enrichment/litigations", async (req: Request, res: Response) => {
  try {
    const { id: propertyId } = req.params;
    const pool = getPool();
    const repo = new HousingLitigationsRepo({ pool });
    const rows = await repo.listByPropertyId(propertyId);
    res.json({ propertyId, litigations: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties enrichment litigations]", err);
    res.status(503).json({ error: "Failed to load litigations.", details: message });
  }
});

/** Merge new fromLlm into existing; only set non-null keys so we don't overwrite with null. */
function mergeFromLlm(
  existing: RentalFinancialsFromLlm | null | undefined,
  incoming: RentalFinancialsFromLlm | null | undefined
): RentalFinancialsFromLlm | null {
  if (!incoming || typeof incoming !== "object") return existing ?? null;
  const out = { ...(existing && typeof existing === "object" ? existing : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v != null && (typeof v !== "string" || v.trim() !== "")) (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function stripStructuredListingOnlyFields(
  value: RentalFinancialsFromLlm | null | undefined
): RentalFinancialsFromLlm | null {
  if (!value || typeof value !== "object") return value ?? null;
  const next = { ...value };
  delete next.expensesTable;
  delete next.rentalNumbersPerUnit;
  return Object.keys(next).length > 0 ? next : null;
}

function looksLikeOmStyleFilename(filename: string | null | undefined): boolean {
  if (!filename || typeof filename !== "string") return false;
  return /(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)/i.test(filename);
}

/** Run rental flow for a single property: RapidAPI rental-by-address + LLM extraction from linked listing. Used by from-listings, run-enrichment, and run-rental-flow. */
export async function runRentalFlowForProperty(
  propertyId: string,
  pool: import("pg").Pool
): Promise<{ rentalUnitsCount: number; hasLlmFinancials: boolean; error?: string }> {
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const uploadedDocRepo = new PropertyUploadedDocumentRepo({ pool });
  const inquiryDocRepo = new InquiryDocumentRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) {
    return { rentalUnitsCount: 0, hasLlmFinancials: false, error: "Property not found" };
  }
  const existing = (property.details?.rentalFinancials ?? null) as RentalFinancials | null;
  let apiResult: Partial<RentalFinancials> = {};
  let apiError: string | null = null;
  try {
    apiResult = await runRentalApiStep(property.canonicalAddress);
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
    console.warn(`[runRentalFlowForProperty] ${propertyId} RapidAPI step failed:`, apiError);
  }
  const rentalUnits = (apiResult.rentalUnits && apiResult.rentalUnits.length > 0)
    ? apiResult.rentalUnits
    : (existing?.rentalUnits ?? null);
  let fromLlm: RentalFinancialsFromLlm | null = null;
  const { matches } = await matchRepo.list({ propertyId, limit: 1 });
  const listing = matches[0] ? await listingRepo.byId(matches[0].listingId) : null;
  if (listing) {
    const desc = (listing.description ?? "").trim();
    const fallback = [listing.title, listing.address].filter(Boolean).join(" – ") || "";
    fromLlm = await extractRentalFinancialsFromListing(
      desc.length >= 20 ? listing.description : (fallback ? `Listing: ${fallback}. No description.` : null),
      listing.title ?? listing.address ?? undefined
    );
  }
  const [uploadedDocs, inquiryDocs] = await Promise.all([
    uploadedDocRepo.listByPropertyId(propertyId),
    inquiryDocRepo.listByPropertyId(propertyId),
  ]);
  const hasOmStyleDocument =
    uploadedDocs.some((doc) => doc.category === "OM" || doc.category === "Brochure" || doc.category === "Rent Roll") ||
    inquiryDocs.some((doc) => looksLikeOmStyleFilename(doc.filename));
  let mergedFromLlm = mergeFromLlm(existing?.fromLlm ?? null, fromLlm);
  if (!hasOmStyleDocument) {
    mergedFromLlm = stripStructuredListingOnlyFields(mergedFromLlm);
  }
  const dataGap = await suggestRentalDataGaps(
    listing ? { beds: listing.beds, baths: listing.baths, address: listing.address, title: listing.title, descriptionSnippet: listing.description?.slice(0, 400) } : null,
    rentalUnits ?? []
  );
  let finalFromLlm = mergedFromLlm;
  if (dataGap) {
    finalFromLlm = mergeFromLlm(finalFromLlm ?? null, { dataGapSuggestions: dataGap }) ?? { dataGapSuggestions: dataGap };
  }
  const rentalFinancials: RentalFinancials = {
    ...(existing ?? {}),
    rentalUnits: rentalUnits ?? undefined,
    fromLlm: finalFromLlm ?? undefined,
    omAnalysis: existing?.omAnalysis ?? undefined,
    source: apiResult.rentalUnits?.length ? "rapidapi" : (finalFromLlm ? "llm" : existing?.source ?? undefined),
    lastUpdatedAt: new Date().toISOString(),
    rentalFlowStatus: apiError ? "failed" : apiResult.rentalUnits?.length ? "complete" : "no_matches",
    rentalFlowError: apiError,
  };
  await propertyRepo.mergeDetails(propertyId, { rentalFinancials });
  return {
    rentalUnitsCount: rentalUnits?.length ?? 0,
    hasLlmFinancials: !!finalFromLlm && Object.keys(finalFromLlm).length > 0,
    error: apiError ?? undefined,
  };
}

/** POST /api/properties/run-rental-flow - Run rental flow for selected or all properties (on-demand re-run). Normally runs automatically after from-listings and run-enrichment. */
router.post("/properties/run-rental-flow", async (req: Request, res: Response) => {
  let workflowRunId: string | null = null;
  const workflowStartedAt = new Date().toISOString();
  try {
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const propertyIds = Array.isArray(req.body?.propertyIds) && req.body.propertyIds.length > 0
      ? (req.body.propertyIds as string[]).filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
      : (await propertyRepo.list({ limit: 200 })).map((p) => p.id);
    const shouldRefreshStreetEasy = req.body?.refreshStreetEasy !== false;
    workflowRunId = await createWorkflowRun({
      runType: "rerun_rental_flow",
      displayName: "Re-run rental flow",
      scopeLabel: `${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
      triggerSource: "manual",
      totalItems: propertyIds.length,
      metadata: { propertyIds },
      steps: [
        ...(shouldRefreshStreetEasy
          ? [
              {
                stepKey: "streeteasy_refresh",
                totalItems: propertyIds.length,
                status: propertyIds.length === 0 ? "completed" : "running",
                startedAt: workflowStartedAt,
                finishedAt: propertyIds.length === 0 ? workflowStartedAt : null,
                lastMessage:
                  propertyIds.length === 0
                    ? "No properties selected"
                    : `Refreshing StreetEasy asks for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
              } satisfies WorkflowRunStepSeed,
            ]
          : []),
        {
          stepKey: "rental_flow",
          totalItems: propertyIds.length,
          status: propertyIds.length === 0 ? "completed" : shouldRefreshStreetEasy ? "pending" : "running",
          startedAt: shouldRefreshStreetEasy ? null : workflowStartedAt,
          finishedAt: propertyIds.length === 0 ? workflowStartedAt : null,
          lastMessage:
            propertyIds.length === 0
              ? "No properties selected"
              : `Starting rental flow for ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"}`,
        },
      ],
    });

    const results: { propertyId: string; rentalUnitsCount: number; hasLlmFinancials: boolean; enrichmentStatus?: PropertyJobStatus; error?: string }[] = [];
    const delayMs = ENRICHMENT_RATE_LIMIT_DELAY_MS;
    const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
    let completed = 0;
    let failed = 0;
    const streetEasyRefresh = { attempted: 0, success: 0, failed: 0, skipped: 0, priceChanged: 0, unavailable: 0, errors: [] as string[] };

    if (shouldRefreshStreetEasy) {
      for (const propertyId of propertyIds) {
        const result = await refreshStreetEasyListingForProperty(propertyId, pool);
        if (!result.attempted) streetEasyRefresh.skipped++;
        else if (result.ok) {
          streetEasyRefresh.attempted++;
          streetEasyRefresh.success++;
          if (result.priceChanged) streetEasyRefresh.priceChanged++;
          if (result.unavailable) streetEasyRefresh.unavailable++;
        } else {
          streetEasyRefresh.attempted++;
          streetEasyRefresh.failed++;
          if (result.error) streetEasyRefresh.errors.push(`${propertyId}: ${result.error}`);
        }
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "streeteasy_refresh",
          totalItems: propertyIds.length,
          completedItems: streetEasyRefresh.success,
          failedItems: streetEasyRefresh.failed,
          skippedItems: streetEasyRefresh.skipped,
          status: deriveWorkflowStatusFromCounts({
            totalItems: propertyIds.length,
            completedItems: streetEasyRefresh.success,
            failedItems: streetEasyRefresh.failed,
            skippedItems: streetEasyRefresh.skipped,
          }),
          startedAt: workflowStartedAt,
          finishedAt:
            streetEasyRefresh.success + streetEasyRefresh.failed + streetEasyRefresh.skipped >= propertyIds.length
              ? new Date().toISOString()
              : null,
          lastMessage:
            streetEasyRefresh.unavailable > 0
              ? `${streetEasyRefresh.unavailable} unavailable listing${streetEasyRefresh.unavailable === 1 ? "" : "s"} flagged`
              : streetEasyRefresh.priceChanged > 0
              ? `${streetEasyRefresh.priceChanged} ask change${streetEasyRefresh.priceChanged === 1 ? "" : "s"} found`
              : `${streetEasyRefresh.success}/${propertyIds.length} StreetEasy refreshes completed`,
          lastError: result.ok || !result.error ? null : result.error,
        });
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    for (const propertyId of propertyIds) {
      let enrichmentStatus: PropertyJobStatus | undefined;
      try {
        await getBBLForProperty(propertyId, { appToken });
        const enrichment = await runEnrichmentForProperty(propertyId, undefined, {
          appToken,
          rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_DELAY_MS,
        });
        enrichmentStatus = enrichment.ok ? "complete" : "failed";
      } catch {
        enrichmentStatus = "failed";
      }
      try {
        const result = await runRentalFlowForProperty(propertyId, pool);
        await syncPropertySourcingWorkflow(propertyId, { pool });
        await refreshPropertyPipelineMetadata(propertyId, pool, {
          ...(enrichmentStatus ? { enrichmentStatus } : {}),
          rentalFlowStatus: result.error ? "failed" : "complete",
        });
        results.push({ propertyId, ...result, enrichmentStatus });
        if (result.error) failed++;
        else completed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await refreshPropertyPipelineMetadata(propertyId, pool, {
          ...(enrichmentStatus ? { enrichmentStatus } : {}),
          rentalFlowStatus: "failed",
        }).catch(() => null);
        results.push({ propertyId, rentalUnitsCount: 0, hasLlmFinancials: false, enrichmentStatus, error: message });
        failed++;
      }
      await upsertWorkflowStep(workflowRunId, {
        stepKey: "rental_flow",
        totalItems: propertyIds.length,
        completedItems: completed,
        failedItems: failed,
        status: deriveWorkflowStatusFromCounts({
          totalItems: propertyIds.length,
          completedItems: completed,
          failedItems: failed,
        }),
        startedAt: workflowStartedAt,
        finishedAt: completed + failed >= propertyIds.length ? new Date().toISOString() : null,
        lastMessage: `${completed}/${propertyIds.length} properties completed`,
      });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    await mergeWorkflowRunMetadata(workflowRunId, { propertyIds, results, streetEasyRefresh });
    await updateWorkflowRun(workflowRunId, {
      status: failed > 0 || streetEasyRefresh.failed > 0 ? "partial" : "completed",
      finishedAt: new Date().toISOString(),
    });

    res.json({ ok: true, results, streetEasyRefresh });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[properties run-rental-flow]", err);
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    res.status(503).json({ error: "Run rental flow failed.", details: message });
  }
});

export default router;
