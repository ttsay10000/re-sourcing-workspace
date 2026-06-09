/**
 * UI v2 pipeline API.
 *
 * This router is intentionally isolated from the legacy properties router so it
 * can be mounted by a later integration step without disturbing existing flows.
 */

import { Router, type Request, type Response } from "express";
import type { Pool, PoolClient } from "pg";
import { deriveListingActivitySummary, describeListingActivity } from "@re-sourcing/contracts";
import {
  DocumentRepo,
  BrokerCompPackageRepo,
  getPool,
  InquiryDocumentRepo,
  OmIngestionRunRepo,
  PropertyActionItemRepo,
  PropertyPipelineEventRepo,
  PropertyRepo,
  PropertyRejectionRepo,
  PropertyUploadedDocumentRepo,
  SavedDealsRepo,
  UserProfileRepo,
} from "@re-sourcing/db";
import type { PropertyPipelineEvent } from "@re-sourcing/db";
import type { BrokerCompPackageDetails } from "@re-sourcing/db";
import type {
  AgentEnrichmentEntry,
  Document,
  PriceHistoryEntry,
  ListingSource,
  BrokerCompMarketSummary,
  OmIngestionRun,
  Property,
  PropertyActionItem,
  PropertyDetails,
  PropertyDocumentCategory,
  PropertyInquiryDocument,
  PropertyUploadedDocument,
  SavedDeal,
  UiV2ActivityTimelineItem,
  UiV2BrokerBlock,
  UiV2DealPathDecision,
  UiV2DealPathState,
  UiV2DealPathStatus,
  UiV2DetailItem,
  UiV2DocumentStatus,
  UiV2EnrichmentDetailPayload,
  UiV2EnrichmentModuleDetail,
  UiV2EnrichmentState,
  UiV2ImageAsset,
  UiV2ListingFactsPayload,
  UiV2MarketType,
  UiV2OmAnalysisPayload,
  UiV2PipelineListPayload,
  UiV2PipelineNewness,
  UiV2PipelineQuery,
  UiV2PipelineRow,
  UiV2PropertyDocumentItem,
  UiV2PipelineSortField,
  UiV2PipelineStatus,
  UiV2PropertyDetailPayload,
  UiV2PropertyOverview,
  UiV2RejectionReason,
  UiV2RejectionReasonCode,
  UiV2StatusChip,
  UiV2StatusChipTone,
  UiV2RentalFlowPayload,
  UiV2UnderwritingSummary,
} from "@re-sourcing/contracts";
import {
  getPropertyDossierAssumptions,
  getPropertyDossierGeneration,
  getPropertyDossierSummary,
} from "../deal/propertyDossierState.js";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import { resolveOmAskingPriceFromDetails } from "../deal/omAskingPrice.js";
import { computeYieldSignals } from "../deal/yieldSignals.js";
import { resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const MANUAL_NEWNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const UI_V2_STATUSES = new Set<UiV2PipelineStatus>([
  "new",
  "screening",
  "interesting",
  "saved",
  "underwriting",
  "tour_scheduled",
  "tour_completed_awaiting_inputs",
  "outreach",
  "awaiting_broker",
  "om_received",
  "dossier_generated",
  "offer_review",
  "negotiation",
  "contract_signed",
  "deal_closed",
  "rejected",
  "archived",
]);

const REJECTION_REASON_CODES = new Set<UiV2RejectionReasonCode>([
  "price_too_high",
  "low_cap_rate",
  "insufficient_noi",
  "weak_rent_roll",
  "rent_stabilized_exposure",
  "poor_location",
  "asset_type_mismatch",
  "too_small",
  "too_large",
  "deferred_maintenance",
  "environmental_or_legal_risk",
  "financing_not_viable",
  "broker_unresponsive",
  "duplicate",
  "already_sold_or_unavailable",
  "data_quality_issue",
  "other",
]);

const REJECTION_REASON_LABELS: Record<UiV2RejectionReasonCode, string> = {
  price_too_high: "Price too high",
  low_cap_rate: "Low cap rate",
  insufficient_noi: "Insufficient NOI",
  weak_rent_roll: "Weak rent roll",
  rent_stabilized_exposure: "Rent-stabilized exposure",
  poor_location: "Poor location",
  asset_type_mismatch: "Asset type mismatch",
  too_small: "Too small",
  too_large: "Too large",
  deferred_maintenance: "Deferred maintenance",
  environmental_or_legal_risk: "Environmental or legal risk",
  financing_not_viable: "Financing not viable",
  broker_unresponsive: "Broker unresponsive",
  duplicate: "Duplicate",
  already_sold_or_unavailable: "Already sold or unavailable",
  data_quality_issue: "Data quality issue",
  other: "Other",
};

type LegacyPipelineStatus =
  | "new_sourced"
  | "enrichment_running"
  | "enrichment_complete"
  | "needs_om"
  | "om_requested"
  | "follow_up_needed"
  | "om_received"
  | "underwriting"
  | "tour_scheduled"
  | "tour_completed_awaiting_inputs"
  | "saved_watchlist"
  | "loi_sent"
  | "negotiation"
  | "contract_signed"
  | "diligence_escrow"
  | "closed"
  | "rejected_removed";

interface PipelineDetailsState {
  status: string;
  uiV2Status?: UiV2PipelineStatus | null;
  omStatus?: string | null;
  enrichmentStatus?: string | null;
  rentalFlowStatus?: string | null;
  underwritingStatus?: string | null;
  dossierStatus?: string | null;
  excelStatus?: string | null;
  tags: string[];
  missingFields: string[];
  actionRequired: string[];
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  rejection?: UiV2RejectionReason & { rejectedAt?: string | null };
  previousStatus?: string | null;
  previousUiV2Status?: UiV2PipelineStatus | null;
  source?: string | null;
  sourceLinks?: Record<string, unknown>;
  lastActivityAt?: string | null;
  dealPath?: UiV2DealPathState | null;
  [key: string]: unknown;
}

const DEAL_PATH_DECISIONS = new Set<UiV2DealPathDecision>(["pending", "move_forward", "need_more_info", "reject"]);
const DEAL_PATH_STATUSES = new Set<UiV2DealPathStatus>([
  "not_scheduled",
  "tour_scheduled",
  "tour_completed_awaiting_inputs",
  "offer_candidate",
  "need_more_info",
  "rejected_after_tour",
  "canceled",
]);
const DEAL_PATH_DERIVED_PIPELINE_STATUSES = new Set<UiV2PipelineStatus>([
  "tour_scheduled",
  "tour_completed_awaiting_inputs",
]);
const DEAL_PATH_OVERRIDE_BLOCKING_STATUSES = new Set<UiV2PipelineStatus>([
  "offer_review",
  "negotiation",
  "contract_signed",
  "deal_closed",
  "rejected",
  "archived",
]);

interface PipelineBaseRow {
  property_id: string;
  canonical_address: string;
  details: PropertyDetails | null;
  property_created_at: Date | string;
  property_updated_at: Date | string;
  listing_id: string | null;
  listing_source: ListingSource | string | null;
  listing_price: number | string | null;
  listing_city: string | null;
  listing_state: string | null;
  listing_zip: string | null;
  listing_beds: number | string | null;
  listing_baths: number | string | null;
  listing_sqft: number | string | null;
  listing_url: string | null;
  listing_title: string | null;
  listing_description: string | null;
  listing_image_urls: string[] | null;
  listing_listed_at: Date | string | null;
  listing_uploaded_at: Date | string | null;
  listing_uploaded_run_id: string | null;
  listing_price_history: PriceHistoryEntry[] | null;
  listing_rental_price_history: PriceHistoryEntry[] | null;
  listing_lifecycle_state: string | null;
  listing_last_seen_at: Date | string | null;
  listing_agent_names: string[] | null;
  listing_agent_enrichment: AgentEnrichmentEntry[] | null;
  listing_extra: Record<string, unknown> | null;
  recipient_status: string | null;
  recipient_contact_id: string | null;
  recipient_contact_email: string | null;
  recipient_confidence: number | string | null;
  recipient_reason: string | null;
  recipient_candidates: unknown;
  recipient_updated_at: Date | string | null;
  manual_broker_name: string | null;
  manual_broker_email: string | null;
  manual_broker_phone: string | null;
  manual_broker_firm: string | null;
  manual_broker_notes: string | null;
  manual_overwritten_at: Date | string | null;
  manual_overwritten_by: string | null;
  broker_display_name: string | null;
  broker_firm: string | null;
  broker_phone: string | null;
  broker_source: string | null;
  broker_source_metadata: Record<string, unknown> | null;
  broker_last_outreach_at: Date | string | null;
  broker_last_reply_at: Date | string | null;
  broker_notes: string | null;
  uploaded_doc_count: number | string | null;
  uploaded_categories: PropertyDocumentCategory[] | null;
  uploaded_last_updated_at: Date | string | null;
  inquiry_doc_count: number | string | null;
  inquiry_filenames: string[] | null;
  inquiry_last_updated_at: Date | string | null;
  generated_doc_count: number | string | null;
  generated_sources: string[] | null;
  generated_last_updated_at: Date | string | null;
  latest_om_run_id: string | null;
  latest_om_status: string | null;
  latest_om_started_at: Date | string | null;
  latest_om_completed_at: Date | string | null;
  latest_signal_deal_score: number | string | null;
  latest_signal_irr_pct: number | string | null;
  latest_signal_coc_pct: number | string | null;
  latest_signal_current_noi: number | string | null;
  latest_signal_adjusted_noi: number | string | null;
  latest_signal_asset_cap_rate: number | string | null;
  latest_signal_adjusted_cap_rate: number | string | null;
  latest_signal_yield_spread: number | string | null;
  override_score: number | string | null;
  open_action_item_count: number | string | null;
  latest_inquiry_sent_at: Date | string | null;
  enrichment_count: number | string | null;
  enrichment_success_count: number | string | null;
  enrichment_failed_count: number | string | null;
  enrichment_last_refreshed_at: Date | string | null;
  enrichment_last_error: string | null;
  saved_deal_id: string | null;
  saved_deal_status: string | null;
  saved_deal_created_at: Date | string | null;
  latest_sourcing_run_id: string | null;
}

interface DetailCollections {
  actionItems: PropertyActionItem[];
  uploadedDocs: PropertyUploadedDocument[];
  inquiryDocs: PropertyInquiryDocument[];
  generatedDocs: Document[];
  omRuns: OmIngestionRun[];
  pipelineEvents: PropertyPipelineEvent[];
  brokerCompDetails: BrokerCompPackageDetails[];
}

interface ParsedPipelineQuery {
  q?: string;
  statuses: UiV2PipelineStatus[];
  sources: string[];
  tags: string[];
  mtrStates: string[];
  propertyTypes: string[];
  neighborhoods: string[];
  boroughs: string[];
  marketTypes: UiV2MarketType[];
  enrichmentStatuses: string[];
  hasOm?: boolean;
  hasBrokerContact?: boolean;
  hasOpenActions?: boolean;
  includeRejected: boolean;
  minDealScore?: number;
  maxDealScore?: number;
  minAskingPrice?: number;
  maxAskingPrice?: number;
  minLtrYoc?: number;
  updatedSince?: string;
  sortBy: UiV2PipelineSortField;
  sortDirection: "asc" | "desc";
  limit: number;
  offset: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toIso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function optionalIso(value: unknown): string | null {
  if (value == null) return null;
  const iso = toIso(value).trim();
  return iso ? iso : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableIsoDateTime(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseDealPathDecision(value: unknown): UiV2DealPathDecision | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return DEAL_PATH_DECISIONS.has(normalized as UiV2DealPathDecision)
    ? (normalized as UiV2DealPathDecision)
    : null;
}

function parseDealPathStatus(value: unknown): UiV2DealPathStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return DEAL_PATH_STATUSES.has(normalized as UiV2DealPathStatus)
    ? (normalized as UiV2DealPathStatus)
    : null;
}

function dealPathStatusLabel(status: UiV2DealPathStatus): string {
  const labels: Record<UiV2DealPathStatus, string> = {
    not_scheduled: "Not Scheduled",
    tour_scheduled: "Tour Scheduled",
    tour_completed_awaiting_inputs: "Tour Completed - Awaiting Inputs",
    offer_candidate: "Offer Candidate",
    need_more_info: "Need More Info",
    rejected_after_tour: "Rejected After Tour",
    canceled: "Canceled",
  };
  return labels[status];
}

function deriveDealPathStatus(input: {
  rawStatus?: UiV2DealPathStatus | null;
  tourScheduledAt?: string | null;
  tourCompletedAt?: string | null;
  postTourDecision?: UiV2DealPathDecision | null;
}): UiV2DealPathStatus {
  if (input.rawStatus === "canceled") return "canceled";
  if (input.postTourDecision === "reject") return "rejected_after_tour";
  if (input.postTourDecision === "move_forward") return "offer_candidate";
  if (input.postTourDecision === "need_more_info") return "need_more_info";
  if (input.tourCompletedAt) return "tour_completed_awaiting_inputs";
  if (input.tourScheduledAt) {
    const scheduledMs = Date.parse(input.tourScheduledAt);
    return Number.isFinite(scheduledMs) && scheduledMs <= Date.now()
      ? "tour_completed_awaiting_inputs"
      : "tour_scheduled";
  }
  return "not_scheduled";
}

function normalizeDealPathState(input: unknown): UiV2DealPathState | null {
  if (!isPlainRecord(input)) return null;
  const tourScheduledAt = nullableIsoDateTime(input.tourScheduledAt);
  const tourCompletedAt = nullableIsoDateTime(input.tourCompletedAt);
  const postTourDecision = parseDealPathDecision(input.postTourDecision);
  const rawStatus = parseDealPathStatus(input.status);
  const status = deriveDealPathStatus({ rawStatus, tourScheduledAt, tourCompletedAt, postTourDecision });
  const loiContingencies = uniqueStrings(Array.isArray(input.loiContingencies) ? input.loiContingencies : [])
    .map((value) => value.slice(0, 120))
    .slice(0, 20);
  return {
    status,
    statusLabel: dealPathStatusLabel(status),
    tourScheduledAt,
    tourCompletedAt,
    tourNotes: stringOrNull(input.tourNotes),
    postTourDecision,
    targetPrice: toFiniteNumber(input.targetPrice),
    offerAmount: toFiniteNumber(input.offerAmount),
    offerNotes: stringOrNull(input.offerNotes),
    loiContingencies,
    loiContingencyNotes: stringOrNull(input.loiContingencyNotes),
    rejectionReasonCode: parseRejectionReasonCode(input.rejectionReasonCode),
    rejectionNotes: stringOrNull(input.rejectionNotes),
    updatedAt: nullableIsoDateTime(input.updatedAt),
  };
}

function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || null;
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    ),
  ];
}

function firstQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function listQueryValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => listQueryValues(entry));
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseBooleanQuery(value: unknown): boolean | undefined {
  const raw = firstQueryValue(value)?.toLowerCase();
  if (raw == null) return undefined;
  if (["1", "true", "yes"].includes(raw)) return true;
  if (["0", "false", "no"].includes(raw)) return false;
  return undefined;
}

function parseNumberQuery(value: unknown): number | undefined {
  const parsed = toFiniteNumber(firstQueryValue(value));
  return parsed != null ? parsed : undefined;
}

function parseLimit(value: unknown): number {
  const parsed = parseNumberQuery(value);
  if (parsed == null) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function parseOffset(value: unknown): number {
  const parsed = parseNumberQuery(value);
  if (parsed == null) return 0;
  return Math.max(0, Math.floor(parsed));
}

function parseStatus(value: unknown): UiV2PipelineStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UI_V2_STATUSES.has(normalized as UiV2PipelineStatus) ? (normalized as UiV2PipelineStatus) : null;
}

function parseMarketType(value: unknown): UiV2MarketType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (normalized === "on_market" || normalized === "off_market" || normalized === "unknown") {
    return normalized as UiV2MarketType;
  }
  return null;
}

function parsePipelineQuery(req: Request): ParsedPipelineQuery {
  const sortByRaw = firstQueryValue(req.query.sort) ?? firstQueryValue(req.query.sortBy) ?? "updatedAt";
  const sortBy = (
    [
      "updatedAt",
      "createdAt",
      "listedAt",
      "canonicalAddress",
      "source",
      "propertyType",
      "marketType",
      "askingPrice",
      "buildingSqft",
      "pricePerSqft",
      "units",
      "capRate",
      "ltrYocPct",
      "mtrYocPct",
      "yocPct",
      "dealScore",
      "status",
      "lastActivityAt",
      "lastContactedAt",
      "omStatus",
    ] satisfies UiV2PipelineSortField[]
  ).includes(sortByRaw as UiV2PipelineSortField)
    ? (sortByRaw as UiV2PipelineSortField)
    : "updatedAt";
  const sortDirectionRaw = firstQueryValue(req.query.sortDirection)?.toLowerCase() ?? firstQueryValue(req.query.direction)?.toLowerCase();
  return {
    q: firstQueryValue(req.query.q) ?? undefined,
    statuses: listQueryValues(req.query.status).flatMap((status) => {
      const parsed = parseStatus(status);
      return parsed == null ? [] : [parsed];
    }),
    sources: listQueryValues(req.query.source).map((source) => source.toLowerCase()),
    tags: listQueryValues(req.query.tag).flatMap((tag) => {
      const normalized = normalizeTag(tag);
      return normalized == null ? [] : [normalized];
    }),
    mtrStates: listQueryValues(req.query.mtr)
      .map((value) => value.toLowerCase())
      .filter((value) => value === "good" || value === "watch" || value === "none"),
    propertyTypes: listQueryValues(req.query.propertyType).map((value) => value.toLowerCase()),
    neighborhoods: listQueryValues(req.query.neighborhood).map((value) => value.toLowerCase()),
    boroughs: listQueryValues(req.query.borough).map((value) => value.toLowerCase()),
    marketTypes: listQueryValues(req.query.marketType ?? req.query.type).flatMap((type) => {
      const parsed = parseMarketType(type);
      return parsed == null ? [] : [parsed];
    }),
    enrichmentStatuses: listQueryValues(req.query.enrichmentStatus)
      .map((value) => value.toLowerCase())
      .filter(Boolean),
    hasOm: parseBooleanQuery(req.query.hasOm),
    hasBrokerContact: parseBooleanQuery(req.query.hasBrokerContact),
    hasOpenActions: parseBooleanQuery(req.query.hasOpenActions),
    includeRejected: parseBooleanQuery(req.query.includeRejected) === true,
    minDealScore: parseNumberQuery(req.query.minDealScore ?? req.query.min),
    maxDealScore: parseNumberQuery(req.query.maxDealScore ?? req.query.max),
    minAskingPrice: parseNumberQuery(req.query.minAskingPrice),
    maxAskingPrice: parseNumberQuery(req.query.maxAskingPrice),
    minLtrYoc: parseNumberQuery(req.query.minLtrYoc),
    updatedSince: firstQueryValue(req.query.updatedSince) ?? undefined,
    sortBy,
    sortDirection: sortDirectionRaw === "asc" ? "asc" : "desc",
    limit: parseLimit(req.query.limit),
    offset: parseOffset(req.query.offset),
  };
}

function queryForResponse(query: ParsedPipelineQuery): UiV2PipelineQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.statuses.length === 1 ? { status: query.statuses[0] } : query.statuses.length > 1 ? { status: query.statuses } : {}),
    ...(query.sources.length === 1
      ? { source: query.sources[0] as ListingSource }
      : query.sources.length > 1
        ? { source: query.sources as ListingSource[] }
        : {}),
    ...(query.tags.length === 1 ? { tag: query.tags[0] } : query.tags.length > 1 ? { tag: query.tags } : {}),
    ...(query.mtrStates.length === 1 ? { mtr: query.mtrStates[0] } : query.mtrStates.length > 1 ? { mtr: query.mtrStates } : {}),
    ...(query.propertyTypes.length === 1
      ? { propertyType: query.propertyTypes[0] }
      : query.propertyTypes.length > 1
        ? { propertyType: query.propertyTypes }
        : {}),
    ...(query.neighborhoods.length === 1
      ? { neighborhood: query.neighborhoods[0] }
      : query.neighborhoods.length > 1
        ? { neighborhood: query.neighborhoods }
        : {}),
    ...(query.boroughs.length === 1
      ? { borough: query.boroughs[0] }
      : query.boroughs.length > 1
        ? { borough: query.boroughs }
        : {}),
    ...(query.marketTypes.length === 1
      ? { marketType: query.marketTypes[0] }
      : query.marketTypes.length > 1
        ? { marketType: query.marketTypes }
        : {}),
    ...(query.enrichmentStatuses.length === 1
      ? { enrichmentStatus: query.enrichmentStatuses[0] }
      : query.enrichmentStatuses.length > 1
        ? { enrichmentStatus: query.enrichmentStatuses }
        : {}),
    ...(query.hasOm != null ? { hasOm: query.hasOm } : {}),
    ...(query.hasBrokerContact != null ? { hasBrokerContact: query.hasBrokerContact } : {}),
    ...(query.hasOpenActions != null ? { hasOpenActions: query.hasOpenActions } : {}),
    includeRejected: query.includeRejected,
    ...(query.minDealScore != null ? { minDealScore: query.minDealScore } : {}),
    ...(query.maxDealScore != null ? { maxDealScore: query.maxDealScore } : {}),
    ...(query.minAskingPrice != null ? { minAskingPrice: query.minAskingPrice } : {}),
    ...(query.maxAskingPrice != null ? { maxAskingPrice: query.maxAskingPrice } : {}),
    ...(query.minLtrYoc != null ? { minLtrYoc: query.minLtrYoc } : {}),
    ...(query.updatedSince ? { updatedSince: query.updatedSince } : {}),
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    limit: query.limit,
    offset: query.offset,
  };
}

function readPipelineState(details: PropertyDetails | null | undefined): PipelineDetailsState {
  const detailsRecord = isPlainRecord(details) ? details : {};
  const rawPipeline = isPlainRecord(detailsRecord.pipeline) ? detailsRecord.pipeline : {};
  const rawUiStatus = parseStatus(rawPipeline.uiV2Status);
  const legacyStatus = typeof rawPipeline.status === "string" && rawPipeline.status.trim() ? rawPipeline.status.trim() : "new_sourced";
  const rawPreviousUiStatus = parseStatus(rawPipeline.previousUiV2Status);
  const rejection = isPlainRecord(rawPipeline.rejection)
    ? {
        reasonCode: parseRejectionReasonCode(rawPipeline.rejection.reasonCode) ?? "other",
        note: stringOrNull(rawPipeline.rejection.note),
        rejectedAt: stringOrNull(rawPipeline.rejection.rejectedAt),
      }
    : undefined;
  return {
    ...rawPipeline,
    status: legacyStatus,
    uiV2Status: rawUiStatus,
    tags: uniqueStrings(Array.isArray(rawPipeline.tags) ? rawPipeline.tags : Array.isArray(detailsRecord.tags) ? detailsRecord.tags : []),
    missingFields: uniqueStrings(Array.isArray(rawPipeline.missingFields) ? rawPipeline.missingFields : []),
    actionRequired: uniqueStrings(Array.isArray(rawPipeline.actionRequired) ? rawPipeline.actionRequired : []),
    rejectedAt: stringOrNull(rawPipeline.rejectedAt),
    rejectionReason: stringOrNull(rawPipeline.rejectionReason),
    rejection,
    previousStatus: stringOrNull(rawPipeline.previousStatus),
    previousUiV2Status: rawPreviousUiStatus,
    source: stringOrNull(rawPipeline.source),
    sourceLinks: isPlainRecord(rawPipeline.sourceLinks) ? rawPipeline.sourceLinks : {},
    lastActivityAt: stringOrNull(rawPipeline.lastActivityAt),
    dealPath: normalizeDealPathState(rawPipeline.dealPath),
  };
}

function parseRejectionReasonCode(value: unknown): UiV2RejectionReasonCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return REJECTION_REASON_CODES.has(normalized as UiV2RejectionReasonCode)
    ? (normalized as UiV2RejectionReasonCode)
    : null;
}

function extractRejectionReason(body: unknown): UiV2RejectionReason | null {
  if (!isPlainRecord(body)) return null;
  const source = isPlainRecord(body.rejection) ? body.rejection : body;
  const reasonCode = parseRejectionReasonCode(source.reasonCode);
  if (reasonCode == null) return null;
  return {
    reasonCode,
    note: stringOrNull(source.note),
  };
}

function formatRejectionReason(rejection: UiV2RejectionReason): string {
  const label = REJECTION_REASON_LABELS[rejection.reasonCode];
  return rejection.note ? `${label}: ${rejection.note}` : label;
}

function eventTitleForStatus(status: UiV2PipelineStatus): string {
  return `Status changed to ${statusLabel(status)}`;
}

function mapLegacyStatus(status: string): UiV2PipelineStatus {
  const direct = parseStatus(status);
  if (direct != null) return direct;
  const mapping: Record<LegacyPipelineStatus, UiV2PipelineStatus> = {
    new_sourced: "new",
    enrichment_running: "screening",
    enrichment_complete: "screening",
    needs_om: "outreach",
    om_requested: "outreach",
    follow_up_needed: "awaiting_broker",
    om_received: "om_received",
    underwriting: "underwriting",
    tour_scheduled: "tour_scheduled",
    tour_completed_awaiting_inputs: "tour_completed_awaiting_inputs",
    saved_watchlist: "saved",
    loi_sent: "offer_review",
    negotiation: "negotiation",
    contract_signed: "contract_signed",
    diligence_escrow: "contract_signed",
    closed: "deal_closed",
    rejected_removed: "rejected",
  };
  return status in mapping ? mapping[status as LegacyPipelineStatus] : "new";
}

function legacyStatusFromUiV2Status(status: UiV2PipelineStatus): LegacyPipelineStatus {
  const mapping: Record<UiV2PipelineStatus, LegacyPipelineStatus> = {
    new: "new_sourced",
    screening: "enrichment_complete",
    interesting: "enrichment_complete",
    saved: "saved_watchlist",
    underwriting: "underwriting",
    tour_scheduled: "underwriting",
    tour_completed_awaiting_inputs: "underwriting",
    outreach: "om_requested",
    awaiting_broker: "follow_up_needed",
    om_received: "om_received",
    dossier_generated: "underwriting",
    offer_review: "loi_sent",
    negotiation: "negotiation",
    contract_signed: "contract_signed",
    deal_closed: "closed",
    rejected: "rejected_removed",
    archived: "closed",
  };
  return mapping[status];
}

function statusLabel(status: UiV2PipelineStatus): string {
  const labels: Record<UiV2PipelineStatus, string> = {
    new: "Sourced",
    screening: "Screening",
    interesting: "Interesting",
    saved: "Saved",
    underwriting: "Underwriting",
    tour_scheduled: "Tour Scheduled",
    tour_completed_awaiting_inputs: "Tour Completed - Awaiting Inputs",
    outreach: "OM Requested",
    awaiting_broker: "OM Requested",
    om_received: "OM Received",
    dossier_generated: "Dossier Generated",
    offer_review: "LOI Sent",
    negotiation: "Negotiation",
    contract_signed: "Contract Signed",
    deal_closed: "Closed",
    rejected: "Rejected",
    archived: "Archived",
  };
  return labels[status];
}

function statusTone(status: UiV2PipelineStatus): UiV2StatusChipTone {
  const tones: Record<UiV2PipelineStatus, UiV2StatusChipTone> = {
    new: "neutral",
    screening: "info",
    interesting: "warning",
    saved: "success",
    underwriting: "warning",
    tour_scheduled: "info",
    tour_completed_awaiting_inputs: "warning",
    outreach: "info",
    awaiting_broker: "warning",
    om_received: "success",
    dossier_generated: "success",
    offer_review: "warning",
    negotiation: "warning",
    contract_signed: "success",
    deal_closed: "success",
    rejected: "danger",
    archived: "neutral",
  };
  return tones[status];
}

function deriveUiV2Status(row: PipelineBaseRow): UiV2PipelineStatus {
  const details = row.details;
  const pipeline = readPipelineState(details);
  if (pipeline.status === "rejected_removed" || pipeline.rejectedAt != null) return "rejected";
  const explicitStatus = pipeline.uiV2Status;
  const dealPathStatus = pipeline.dealPath?.status;
  if (
    dealPathStatus &&
    DEAL_PATH_DERIVED_PIPELINE_STATUSES.has(dealPathStatus as UiV2PipelineStatus) &&
    !DEAL_PATH_OVERRIDE_BLOCKING_STATUSES.has(explicitStatus ?? mapLegacyStatus(pipeline.status))
  ) {
    return dealPathStatus as UiV2PipelineStatus;
  }
  if (explicitStatus != null) return explicitStatus;
  if (row.saved_deal_status === "dossier_generated") return "dossier_generated";
  if (row.saved_deal_status === "rejected") return "rejected";
  if (row.saved_deal_status === "saved") return "saved";
  if (pipeline.status) return mapLegacyStatus(pipeline.status);
  return "new";
}

function buildStatusChip(row: PipelineBaseRow): UiV2StatusChip {
  const status = deriveUiV2Status(row);
  return {
    status,
    label: statusLabel(status),
    tone: statusTone(status),
    editable: true,
  };
}

function splitAddress(canonicalAddress: string): { displayAddress: string; city?: string | null; state?: string | null; zip?: string | null } {
  const parts = canonicalAddress.split(",").map((part) => part.trim()).filter(Boolean);
  const displayAddress = parts[0] ?? canonicalAddress;
  const city = parts[1] ?? null;
  const stateZip = parts[2] ?? "";
  const stateZipMatch = /^([A-Za-z]{2})(?:\s+(.+))?$/.exec(stateZip);
  return {
    displayAddress,
    city,
    state: stateZipMatch?.[1] ?? null,
    zip: stateZipMatch?.[2] ?? null,
  };
}

function neighborhoodName(details: PropertyDetails | null | undefined, listingExtra?: Record<string, unknown> | null): string | null {
  const primary = details?.neighborhood?.primary;
  return (
    readFirstStringPath(details, [
      ["manualSourceFacts", "neighborhood"],
      ["manualSourceFacts", "neighborhoodName"],
      ["omData", "authoritative", "propertyInfo", "neighborhood"],
      ["omData", "authoritative", "propertyInfo", "submarket"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "neighborhood"],
    ]) ??
    primary?.name ??
    readFirstStringPath(details, [
      ["neighborhoodName"],
      ["neighborhood", "name"],
      ["location", "neighborhood"],
      ["address", "neighborhood"],
      ["streetEasy", "neighborhood"],
      ["rapidApi", "neighborhood"],
      ["sourceFacts", "neighborhood"],
    ]) ??
    readFirstStringPath(listingExtra, [
      ["neighborhood"],
      ["neighborhoodName"],
      ["neighborhood_name"],
      ["area"],
      ["area_name"],
      ["location", "neighborhood"],
      ["address_components", "neighborhood"],
    ])
  );
}

function boroughName(details: PropertyDetails | null | undefined, listingExtra?: Record<string, unknown> | null): string | null {
  const primary = details?.neighborhood?.primary;
  return (
    readFirstStringPath(details, [
      ["manualSourceFacts", "borough"],
      ["manualSourceFacts", "boroughName"],
      ["omData", "authoritative", "propertyInfo", "borough"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "borough"],
    ]) ??
    primary?.borough ??
    readFirstStringPath(details, [
      ["borough"],
      ["boroughName"],
      ["location", "borough"],
      ["address", "borough"],
      ["streetEasy", "borough"],
      ["rapidApi", "borough"],
      ["sourceFacts", "borough"],
    ]) ??
    readFirstStringPath(listingExtra, [
      ["borough"],
      ["boroughName"],
      ["county"],
      ["location", "borough"],
      ["address_components", "borough"],
    ])
  );
}

function readNumericPath(root: unknown, path: string[]): number | null {
  let current: unknown = root;
  for (const part of path) {
    if (!isPlainRecord(current)) return null;
    current = current[part];
  }
  return toFiniteNumber(current);
}

function readStringPath(root: unknown, path: string[]): string | null {
  let current: unknown = root;
  for (const part of path) {
    if (!isPlainRecord(current)) return null;
    current = current[part];
  }
  return stringOrNull(current);
}

function readFirstNumericPath(root: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = readNumericPath(root, path);
    if (value != null) return value;
  }
  return null;
}

function readFirstPositiveNumericPath(root: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = toPositiveNumber(readNumericPath(root, path));
    if (value != null) return value;
  }
  return null;
}

function readFirstStringPath(root: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = readStringPath(root, path);
    if (value != null) return value;
  }
  return null;
}

function hasDisplayValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function displayValue(value: unknown): string | number | boolean | null {
  if (!hasDisplayValue(value)) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => displayValue(entry)).filter(hasDisplayValue).join(", ");
  if (isPlainRecord(value)) {
    return Object.entries(value)
      .filter(([, entry]) => hasDisplayValue(entry))
      .slice(0, 5)
      .map(([key, entry]) => `${key}: ${String(displayValue(entry))}`)
      .join(", ");
  }
  return String(value);
}

function formatMoneyValue(value: unknown): string | null {
  const numberValue = toFiniteNumber(value);
  if (numberValue == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numberValue);
}

function formatPercentValue(value: unknown): string | null {
  const numberValue = toFiniteNumber(value);
  if (numberValue == null) return null;
  return `${numberValue.toFixed(1)}%`;
}

function detailItem(
  label: string,
  value: unknown,
  options: { href?: string | null; tone?: UiV2StatusChipTone; format?: "money" | "percent" } = {}
): UiV2DetailItem | null {
  const formatted =
    options.format === "money"
      ? formatMoneyValue(value)
      : options.format === "percent"
        ? formatPercentValue(value)
        : displayValue(value);
  if (!hasDisplayValue(formatted)) return null;
  return {
    label,
    value: formatted,
    href: options.href ?? null,
    tone: options.tone,
  };
}

function compactItems(items: Array<UiV2DetailItem | null | undefined>): UiV2DetailItem[] {
  return items.filter((item): item is UiV2DetailItem => item != null);
}

function moduleStatus(items: UiV2DetailItem[], fallback?: string | null): UiV2EnrichmentModuleDetail["status"] {
  if (fallback) return fallback;
  return items.length > 0 ? "available" : "missing";
}

function getAskingPrice(row: PipelineBaseRow): number | null {
  const details = row.details;
  const hasCurrentSource = hasCurrentUnderwritingSource(row);
  const assumptions = hasCurrentSource ? getPropertyDossierAssumptions(details) : null;
  const summary = hasCurrentSource ? getPropertyDossierSummary(details) : null;
  return (
    readFirstPositiveNumericPath(details, [
      ["manualSourceFacts", "askingPrice"],
      ["manualSourceFacts", "listedPrice"],
      ["manualSourceFacts", "listingPrice"],
      ["manualSourceFacts", "askPrice"],
    ]) ??
    resolveOmAskingPriceFromDetails(details) ??
    summary?.askingPrice ??
    readFirstPositiveNumericPath(details, [
      ["omData", "authoritative", "propertyInfo", "askingPrice"],
      ["omData", "authoritative", "propertyInfo", "listedPrice"],
      ["omData", "authoritative", "propertyInfo", "listingPrice"],
      ["omData", "authoritative", "uiFinancialSummary", "askingPrice"],
      ["omData", "authoritative", "valuationMetrics", "askingPrice"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "askingPrice"],
      ["rentalFinancials", "omAnalysis", "valuationMetrics", "askingPrice"],
    ]) ??
    toPositiveNumber(row.listing_price) ??
    readFirstPositiveNumericPath(row.listing_extra, [
      ["price"],
      ["askingPrice"],
      ["asking_price"],
      ["listedPrice"],
      ["listed_price"],
      ["askPrice"],
      ["ask_price"],
    ]) ??
    readFirstPositiveNumericPath(details, [
      ["askingPrice"],
      ["asking_price"],
      ["listingPrice"],
      ["listing_price"],
      ["listedPrice"],
      ["listed_price"],
      ["askPrice"],
      ["ask_price"],
      ["sourceFacts", "askingPrice"],
      ["sourceFacts", "listedPrice"],
    ]) ??
    assumptions?.purchasePrice ??
    null
  );
}

function getUnitCount(row: PipelineBaseRow): number | null {
  const details = row.details;
  const rentalUnits = isPlainRecord(details?.rentalFinancials) && Array.isArray(details.rentalFinancials.rentalUnits)
    ? details.rentalFinancials.rentalUnits.length
    : null;
  return (
    readFirstPositiveNumericPath(details, [
      ["manualSourceFacts", "units"],
      ["manualSourceFacts", "unitCount"],
      ["manualSourceFacts", "numberOfUnits"],
      ["manualSourceFacts", "number_of_units"],
      ["manualSourceFacts", "totalUnits"],
    ]) ??
    resolvePreferredOmUnitCount(details) ??
    readFirstPositiveNumericPath(details, [
      ["omData", "authoritative", "propertyInfo", "unitCount"],
      ["omData", "authoritative", "propertyInfo", "units"],
      ["omData", "authoritative", "propertyInfo", "numberOfUnits"],
      ["omData", "authoritative", "propertyInfo", "totalUnits"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "unitCount"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "units"],
      ["unitCount"],
      ["units"],
      ["numberOfUnits"],
      ["number_of_units"],
      ["totalUnits"],
      ["total_units"],
      ["building", "units"],
      ["building", "unitCount"],
      ["property", "units"],
      ["rentalFinancials", "fromLlm", "unitCount"],
      ["rentalFinancials", "fromLlm", "units"],
    ]) ??
    readFirstPositiveNumericPath(row.listing_extra, [
      ["units"],
      ["unitCount"],
      ["unit_count"],
      ["totalUnits"],
      ["total_units"],
      ["numberOfUnits"],
      ["number_of_units"],
      ["num_units"],
      ["building_units"],
      ["building", "units"],
      ["property", "units"],
    ]) ??
    inferUnitCountFromText(row.listing_description, row.listing_title, row.listing_extra?.description, row.listing_extra?.propertyType) ??
    rentalUnits
  );
}

function inferUnitCountFromText(...values: unknown[]): number | null {
  const text = values.filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  if (!text.trim()) return null;
  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const numberToken = "\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
  const familyMatch = new RegExp(`\\b(?:set\\s+up\\s+as\\s+|configured\\s+as\\s+|legal\\s+)?(${numberToken})[-\\s]+family\\b`).exec(text);
  const unitMatch = new RegExp(`\\b(${numberToken})\\s+(?:residential\\s+|rental\\s+|dwelling\\s+|apartment\\s+|floor\\s+|full[-\\s]+floor\\s+)?(?:units?|apartments?|residences?|dwellings?)\\b`).exec(text);
  const raw = familyMatch?.[1] ?? unitMatch?.[1] ?? null;
  if (!raw) return null;
  const parsed = /^\d+$/.test(raw) ? Number(raw) : wordToNumber[raw];
  return parsed != null && parsed > 0 ? parsed : null;
}

function getBuildingSqft(row: PipelineBaseRow): number | null {
  return (
    readFirstPositiveNumericPath(row.details, [
      ["manualSourceFacts", "buildingSqft"],
      ["manualSourceFacts", "sqft"],
      ["manualSourceFacts", "squareFeet"],
      ["dealDossier", "assumptions", "buildingSqft"],
      ["omData", "authoritative", "propertyInfo", "buildingSqft"],
      ["omData", "authoritative", "propertyInfo", "squareFeet"],
      ["omData", "authoritative", "propertyInfo", "sqft"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "buildingSqft"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "squareFeet"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "sqft"],
      ["buildingSqft"],
      ["buildingSqftTotal"],
      ["squareFeet"],
      ["square_feet"],
      ["sqft"],
      ["grossSqft"],
      ["gross_square_feet"],
      ["building", "sqft"],
      ["building", "squareFeet"],
      ["building", "grossSqft"],
      ["property", "sqft"],
      ["property", "squareFeet"],
      ["sourceFacts", "sqft"],
      ["sourceFacts", "squareFeet"],
      ["sourceFacts", "buildingSqft"],
      ["listingFacts", "sqft"],
      ["listingFacts", "squareFeet"],
      ["listingFacts", "buildingSqft"],
    ]) ??
    toPositiveNumber(row.listing_sqft) ??
    readFirstPositiveNumericPath(row.listing_extra, [
      ["sqft"],
      ["squareFeet"],
      ["square_feet"],
      ["sqft_feet"],
      ["grossSqft"],
      ["gross_square_feet"],
      ["buildingSqft"],
      ["building_sqft"],
      ["buildingSize"],
      ["building_size"],
      ["building", "sqft"],
      ["building", "squareFeet"],
      ["building", "square_feet"],
      ["building", "grossSqft"],
      ["property", "sqft"],
      ["property", "squareFeet"],
    ]) ??
    readFirstPositiveNumericPath(row.details, [
      ["dealDossier", "assumptions", "buildingSqft"],
      ["assessedGrossSqft"],
      ["assessedResidentialAreaGross"],
    ])
  );
}

function getPricePerSqft(row: PipelineBaseRow): number | null {
  const price = getAskingPrice(row);
  const sqft = getBuildingSqft(row);
  if (price != null && sqft != null && price > 0 && sqft > 0) return Math.round(price / sqft);
  const sourcePricePerSqft = readFirstPositiveNumericPath(row.details, [
      ["manualSourceFacts", "pricePerSqft"],
      ["manualSourceFacts", "pricePsf"],
      ["pricePerSqft"],
      ["price_per_sqft"],
      ["omData", "authoritative", "valuationMetrics", "pricePerSqft"],
      ["omData", "authoritative", "valuationMetrics", "pricePsf"],
      ["omData", "authoritative", "uiFinancialSummary", "pricePerSqft"],
      ["omData", "authoritative", "propertyInfo", "pricePerSqft"],
      ["rentalFinancials", "omAnalysis", "valuationMetrics", "pricePerSqft"],
      ["rentalFinancials", "omAnalysis", "valuationMetrics", "pricePsf"],
      ["sourceFacts", "pricePerSqft"],
      ["listingFacts", "ppsqft"],
      ["listingFacts", "pricePerSqft"],
    ]) ??
    readFirstPositiveNumericPath(row.listing_extra, [
      ["ppsqft"],
      ["pricePerSqft"],
      ["price_per_sqft"],
      ["price_per_square_foot"],
      ["psf"],
      ["price_psf"],
    ]);
  if (sourcePricePerSqft != null) return Math.round(sourcePricePerSqft);
  return null;
}

function getYearBuilt(row: PipelineBaseRow): number | null {
  return (
    readFirstNumericPath(row.details, [
      ["manualSourceFacts", "yearBuilt"],
      ["manualSourceFacts", "builtIn"],
      ["omData", "authoritative", "propertyInfo", "yearBuilt"],
      ["omData", "authoritative", "propertyInfo", "builtIn"],
      ["yearBuilt"],
      ["year_built"],
      ["building", "yearBuilt"],
    ]) ??
    readFirstNumericPath(row.listing_extra, [["yearBuilt"], ["year_built"], ["built"], ["builtIn"]])
  );
}

function getLotSqft(row: PipelineBaseRow): number | null {
  return (
    readFirstNumericPath(row.details, [
      ["lotSqft"],
      ["lotSizeSqft"],
      ["lot_size_sqft"],
      ["assessedLandArea"],
      ["omData", "authoritative", "propertyInfo", "lotSqft"],
    ]) ??
    readFirstNumericPath(row.listing_extra, [["lotSqft"], ["lotSizeSqft"], ["lot_size_sqft"], ["lot_size"]])
  );
}

function looksLikeOmStyleFilename(filename: string | null | undefined): boolean {
  if (!filename || typeof filename !== "string") return false;
  return /(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)/i.test(filename);
}

function hasAuthoritativeOm(details: PropertyDetails | null | undefined): boolean {
  return isPlainRecord(details?.omData) && isPlainRecord(details.omData.authoritative);
}

function hasManualUnderwritingInputs(details: PropertyDetails | null | undefined): boolean {
  const assumptions = getPropertyDossierAssumptions(details);
  if (assumptions == null) return false;
  const hasNoiInput = toFiniteNumber(assumptions.currentNoi) != null;
  const hasUnitModelInput = (assumptions.unitModelRows ?? []).some(
    (unit) =>
      toFiniteNumber(unit.currentAnnualRent) != null ||
      toFiniteNumber(unit.underwrittenAnnualRent) != null ||
      toFiniteNumber(unit.rentUpliftPct) != null
  );
  const hasExpenseModelInput = (assumptions.expenseModelRows ?? []).some(
    (expense) => toFiniteNumber(expense.amount) != null
  );
  const hasBrokerFinancialNotes =
    typeof assumptions.brokerEmailNotes === "string" && assumptions.brokerEmailNotes.trim().length > 0;
  return hasNoiInput || hasUnitModelInput || hasExpenseModelInput || hasBrokerFinancialNotes;
}

function hasCurrentUnderwritingSource(row: PipelineBaseRow): boolean {
  return hasAuthoritativeOm(row.details) || hasManualUnderwritingInputs(row.details);
}

function getCurrentDossierSummary(row: PipelineBaseRow) {
  return hasCurrentUnderwritingSource(row) ? getPropertyDossierSummary(row.details) : null;
}

function hasOm(row: PipelineBaseRow): boolean {
  const categories = row.uploaded_categories ?? [];
  const inquiryFileNames = row.inquiry_filenames ?? [];
  return (
    hasAuthoritativeOm(row.details) ||
    categories.includes("OM") ||
    categories.includes("Brochure") ||
    inquiryFileNames.some((filename) => looksLikeOmStyleFilename(filename)) ||
    row.latest_om_status === "completed" ||
    row.latest_om_status === "promoted"
  );
}

function latestDocUpdatedAt(row: PipelineBaseRow): string | null {
  const dates = [
    optionalIso(row.uploaded_last_updated_at),
    optionalIso(row.inquiry_last_updated_at),
    optionalIso(row.generated_last_updated_at),
    optionalIso(row.latest_om_completed_at),
    optionalIso(row.latest_om_started_at),
  ].filter((value): value is string => value != null);
  return dates.sort().at(-1) ?? null;
}

function normalizeOmStatus(value: unknown, hasOmDocument: boolean, hasOmRequest: boolean): UiV2DocumentStatus["omStatus"] {
  const validStatuses = new Set([
    "queued",
    "processing",
    "completed",
    "promoted",
    "needs_review",
    "rejected",
    "failed",
    "not_requested",
    "requested",
    "available",
    "missing",
  ]);
  if (typeof value === "string" && validStatuses.has(value)) {
    return value as UiV2DocumentStatus["omStatus"];
  }
  if (hasOmRequest && !hasOmDocument) return "requested";
  return hasOmDocument ? "available" : "missing";
}

function buildDocumentStatus(row: PipelineBaseRow, collections?: DetailCollections): UiV2DocumentStatus {
  const uploadedDocs = collections?.uploadedDocs ?? [];
  const inquiryDocs = collections?.inquiryDocs ?? [];
  const generatedDocs = collections?.generatedDocs ?? [];
  const categories = uniqueStrings((collections ? uploadedDocs.map((doc) => doc.category) : row.uploaded_categories) ?? []) as PropertyDocumentCategory[];
  const documentCount =
    (collections ? uploadedDocs.length : Number(row.uploaded_doc_count ?? 0)) +
    (collections ? inquiryDocs.length : Number(row.inquiry_doc_count ?? 0)) +
    (collections ? generatedDocs.length : Number(row.generated_doc_count ?? 0));
  const hasOmDocument = collections
    ? hasAuthoritativeOm(row.details) ||
      uploadedDocs.some((doc) => doc.category === "OM" || doc.category === "Brochure") ||
      inquiryDocs.some((doc) => looksLikeOmStyleFilename(doc.filename)) ||
      collections.omRuns.some((run) => run.status === "completed" || run.status === "promoted")
    : hasOm(row);
  const pipeline = readPipelineState(row.details);
  const latestRequestAt = optionalIso(row.latest_inquiry_sent_at);
  return {
    hasOm: hasOmDocument,
    omStatus: normalizeOmStatus(row.latest_om_status ?? pipeline.omStatus, hasOmDocument, latestRequestAt != null),
    latestOmRunId: row.latest_om_run_id,
    latestRequestAt,
    documentCount,
    categories,
    lastUpdatedAt: latestDocUpdatedAt(row),
  };
}

function buildEnrichmentState(row: PipelineBaseRow): UiV2EnrichmentState {
  const pipeline = readPipelineState(row.details);
  const detailsEnrichment = isPlainRecord(row.details?.enrichment) ? row.details.enrichment : {};
  const completedKeys = Object.entries(detailsEnrichment).flatMap(([key, value]) => (value != null ? [key] : []));
  const enrichmentCount = Number(row.enrichment_count ?? 0);
  const successCount = Number(row.enrichment_success_count ?? 0);
  const failedCount = Number(row.enrichment_failed_count ?? 0);
  const status =
    pipeline.enrichmentStatus === "running"
      ? "running"
      : failedCount > 0 && successCount === 0 && completedKeys.length === 0
        ? "failed"
        : completedKeys.length > 0 || successCount > 0
          ? failedCount > 0
            ? "partial"
            : "complete"
          : enrichmentCount > 0
            ? "partial"
            : "not_started";
  return {
    status,
    completedKeys,
    failedKeys: failedCount > 0 ? ["see_error"] : [],
    lastRefreshedAt: optionalIso(row.enrichment_last_refreshed_at),
    errorMessage: row.enrichment_last_error,
  };
}

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry));
}

function coerceRecordList<T extends Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((entry): entry is T => isPlainRecord(entry)) : [];
}

function sourceUnitCount(row: PipelineBaseRow): number | null {
  return readFirstPositiveNumericPath(row.listing_extra, [
    ["units"],
    ["unitCount"],
    ["unit_count"],
    ["totalUnits"],
    ["total_units"],
    ["numberOfUnits"],
    ["number_of_units"],
    ["num_units"],
    ["building_units"],
    ["building", "units"],
    ["property", "units"],
  ]);
}

function listingStatus(row: PipelineBaseRow): string | null {
  const fromManual = readFirstStringPath(row.details, [
    ["manualSourceFacts", "listingStatus"],
    ["manualSourceFacts", "status"],
  ]);
  if (fromManual) return fromManual;
  const fromOm = readFirstStringPath(row.details, [
    ["omData", "authoritative", "propertyInfo", "listingStatus"],
    ["omData", "authoritative", "propertyInfo", "status"],
    ["rentalFinancials", "omAnalysis", "propertyInfo", "listingStatus"],
  ]);
  if (fromOm) return fromOm;
  const fromExtra = readFirstStringPath(row.listing_extra, [
    ["status"],
    ["listingStatus"],
    ["listing_status"],
    ["saleStatus"],
    ["sale_status"],
  ]);
  if (fromExtra) return fromExtra;
  return row.listing_lifecycle_state === "missing" ? "missing" : null;
}

function isUnavailableListingStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return [
    "temporary_off_market",
    "off_market",
    "in_contract",
    "contract_signed",
    "pending",
    "sold",
    "closed",
    "delisted",
    "withdrawn",
    "missing",
    "unavailable",
  ].includes(normalized);
}

function buildListingFacts(row: PipelineBaseRow): UiV2ListingFactsPayload | null {
  const details = row.details;
  const rentalFinancials = details?.rentalFinancials;
  const rentalUnits = isPlainRecord(rentalFinancials) && Array.isArray(rentalFinancials.rentalUnits)
    ? rentalFinancials.rentalUnits.length
    : null;
  const unitsFromManual = readFirstPositiveNumericPath(details, [
    ["manualSourceFacts", "units"],
    ["manualSourceFacts", "unitCount"],
    ["manualSourceFacts", "numberOfUnits"],
  ]);
  const unitsFromOm = resolvePreferredOmUnitCount(details);
  const unitsFromSource = sourceUnitCount(row);
  const units = getUnitCount(row);
  const buildingSqft = getBuildingSqft(row);
  const pricePerSqft = getPricePerSqft(row);
  const unitCountSource =
    unitsFromManual != null
      ? "manual"
      : unitsFromOm != null
        ? "om"
        : unitsFromSource != null
      ? "source"
        : rentalUnits != null && rentalUnits > 0
          ? "rental_flow"
          : units != null
            ? "inferred"
            : null;
  const amenities = coerceStringList(isPlainRecord(row.listing_extra) ? row.listing_extra.amenities : null);
  const facts: UiV2ListingFactsPayload = {
    status: listingStatus(row),
    propertyType: getPropertyType(row),
    bedrooms: readFirstNumericPath(details, [
      ["manualSourceFacts", "bedrooms"],
      ["manualSourceFacts", "beds"],
      ["omData", "authoritative", "propertyInfo", "bedrooms"],
      ["omData", "authoritative", "propertyInfo", "beds"],
    ]) ?? toFiniteNumber(row.listing_beds),
    bathrooms: readFirstNumericPath(details, [
      ["manualSourceFacts", "bathrooms"],
      ["manualSourceFacts", "baths"],
      ["omData", "authoritative", "propertyInfo", "bathrooms"],
      ["omData", "authoritative", "propertyInfo", "baths"],
    ]) ?? toFiniteNumber(row.listing_baths),
    sqft: buildingSqft,
    ppsqft: pricePerSqft,
    daysOnMarket: readFirstNumericPath(details, [["manualSourceFacts", "daysOnMarket"]]) ?? readFirstNumericPath(row.listing_extra, [["daysOnMarket"], ["days_on_market"], ["dom"]]),
    listedAt: getListedAt(row),
    closedAt: readFirstStringPath(row.listing_extra, [["closedAt"], ["closed_at"]]),
    monthlyHoa: readFirstNumericPath(details, [["manualSourceFacts", "monthlyHoa"]]) ?? readFirstNumericPath(row.listing_extra, [["monthlyHoa"], ["monthly_hoa"], ["hoa"]]),
    monthlyTax: readFirstNumericPath(details, [["manualSourceFacts", "monthlyTax"]]) ?? readFirstNumericPath(row.listing_extra, [["monthlyTax"], ["monthly_tax"], ["tax"]]),
    builtIn: getYearBuilt(row),
    amenities: amenities.length > 0 ? amenities : null,
    units,
    unitCountSource,
  };
  return Object.values(facts).some((value) => hasDisplayValue(value)) ? facts : null;
}

function getListedAt(row: PipelineBaseRow): string | null {
  return optionalIso(row.listing_listed_at) ?? readFirstStringPath(row.listing_extra, [["listedAt"], ["listed_at"]]);
}

function getPropertyType(row: PipelineBaseRow): string | null {
  return (
    readFirstStringPath(row.details, [
      ["manualSourceFacts", "propertyType"],
      ["omData", "authoritative", "propertyInfo", "propertyType"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "propertyType"],
    ]) ?? readFirstStringPath(row.listing_extra, [["propertyType"], ["property_type"], ["type"], ["building", "type"]])
  );
}

function buildRentalFlowPayload(
  rentalFinancials: Record<string, unknown> | null,
  fromLlm: Record<string, unknown>,
  authoritativeRentRoll: Record<string, unknown>[],
  omRentRoll: Record<string, unknown>[]
): UiV2RentalFlowPayload | null {
  const rentalUnits = coerceRecordList(isPlainRecord(rentalFinancials) ? rentalFinancials.rentalUnits : null);
  const payload: UiV2RentalFlowPayload = {
    source: readStringPath(rentalFinancials, ["source"]),
    lastUpdatedAt: readStringPath(rentalFinancials, ["lastUpdatedAt"]),
    rentalUnits,
    omRentRoll: authoritativeRentRoll.length > 0 ? authoritativeRentRoll : omRentRoll,
    grossRent: readNumericPath(fromLlm, ["grossRentTotal"]),
    noi: readNumericPath(fromLlm, ["noi"]),
    capRate: readNumericPath(fromLlm, ["capRate"]),
    dataGaps: readStringPath(fromLlm, ["dataGapSuggestions"]),
    rentNotes: readStringPath(fromLlm, ["rentalEstimates"]),
  };
  return Object.values(payload).some((value) => hasDisplayValue(value)) ? payload : null;
}

function normalizeTakeaways(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const list = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : null))
      .filter((entry): entry is string => Boolean(entry));
    return list.length > 0 ? list : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parts = value
    .split(/\n+|(?:^|[.;])\s*(?=[A-Z][A-Za-z /-]+:)/g)
    .map((part) => part.replace(/^[,.;\s]+|[,.;\s]+$/g, "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.slice(0, 8) : [value.trim()];
}

function buildOmAnalysisPayload(
  details: PropertyDetails | null | undefined,
  authoritativeOm: Record<string, unknown>,
  omAnalysis: Record<string, unknown>
): UiV2OmAnalysisPayload | null {
  const rentRoll = coerceRecordList(authoritativeOm.rentRoll).length > 0
    ? coerceRecordList(authoritativeOm.rentRoll)
    : coerceRecordList(omAnalysis.rentRoll);
  const validationFlags = Array.isArray(authoritativeOm.validationFlags) ? authoritativeOm.validationFlags : null;
  const payload: UiV2OmAnalysisPayload = {
    status: readStringPath(details, ["omData", "status"]),
    processedAt: readStringPath(details, ["omData", "lastProcessedAt"]),
    currentNoi: readNumericPath(authoritativeOm, ["currentFinancials", "noi"]),
    operatingExpenses: readNumericPath(authoritativeOm, ["currentFinancials", "operatingExpenses"]),
    rentRoll,
    takeaways: normalizeTakeaways(authoritativeOm.investmentTakeaways ?? omAnalysis.investmentTakeaways),
    validationFlags,
    coverage: isPlainRecord(authoritativeOm.coverage) ? authoritativeOm.coverage : isPlainRecord(omAnalysis.sourceCoverage) ? omAnalysis.sourceCoverage : null,
  };
  return Object.values(payload).some((value) => hasDisplayValue(value)) ? payload : null;
}

function buildEnrichmentDetails(row: PipelineBaseRow): UiV2EnrichmentDetailPayload {
  const details = row.details;
  const enrichment = isPlainRecord(details?.enrichment) ? details.enrichment : {};
  const neighborhood = details?.neighborhood ?? null;
  const resolvedNeighborhood = neighborhoodName(details, row.listing_extra);
  const resolvedBorough = boroughName(details, row.listing_extra);
  const rentalFinancials = details?.rentalFinancials ?? null;
  const fromLlm = isPlainRecord(rentalFinancials?.fromLlm) ? rentalFinancials.fromLlm : {};
  const omAnalysis = isPlainRecord(rentalFinancials?.omAnalysis) ? rentalFinancials.omAnalysis : {};
  const authoritativeOm = isPlainRecord(details?.omData?.authoritative) ? details.omData.authoritative : {};
  const sourceLinks = readPipelineState(details).sourceLinks ?? {};
  const manualLinks = isPlainRecord(details?.manualSourceLinks) ? details.manualSourceLinks : {};
  const sourceItems = compactItems([
    detailItem("Listing", row.listing_url ?? readStringPath(details, ["manualSourceLinks", "streetEasyUrl"]), {
      href: row.listing_url ?? readStringPath(details, ["manualSourceLinks", "streetEasyUrl"]),
    }),
    detailItem("OM source", readStringPath(details, ["manualSourceLinks", "omUrl"]), {
      href: readStringPath(details, ["manualSourceLinks", "omUrl"]),
    }),
    ...Object.entries(sourceLinks)
      .slice(0, 6)
      .map(([label, value]) => detailItem(label, value, typeof value === "string" ? { href: value } : {})),
    ...Object.entries(manualLinks)
      .filter(([key]) => !["streetEasyUrl", "omUrl"].includes(key))
      .slice(0, 6)
      .map(([label, value]) => detailItem(label, value)),
  ]);

  const modules: UiV2EnrichmentModuleDetail[] = [];
  const addModule = (
    key: string,
    label: string,
    summaryItems: Array<UiV2DetailItem | null | undefined>,
    detailItems: Array<UiV2DetailItem | null | undefined> = [],
    fallbackStatus?: string | null
  ) => {
    const summary = compactItems(summaryItems);
    const detail = compactItems(detailItems);
    if (summary.length === 0 && detail.length === 0 && !fallbackStatus) return;
    modules.push({
      key,
      label,
      status: moduleStatus([...summary, ...detail], fallbackStatus),
      summaryItems: summary,
      detailItems: detail,
    });
  };

  addModule("location", "Location", [
    detailItem("Neighborhood", resolvedNeighborhood),
    detailItem("Borough", resolvedBorough),
    detailItem("Zip", neighborhood?.primary?.zip ?? row.listing_zip),
    detailItem("Source", neighborhood?.primary?.source),
    detailItem("Units", getUnitCount(row)),
    detailItem("Building sqft", getBuildingSqft(row)),
  ], [
    detailItem("Median rent", neighborhood?.metrics?.medianRent, { format: "money" }),
    detailItem("Median sale", neighborhood?.metrics?.medianSalePrice, { format: "money" }),
    detailItem("Price / sf", neighborhood?.metrics?.medianPricePsf, { format: "money" }),
    detailItem("Walk score", neighborhood?.metrics?.walkScore),
    detailItem("Transit score", neighborhood?.metrics?.transitScore),
    detailItem("Narrative", neighborhood?.narrative),
  ]);
  addModule("tax_assessment", "Tax Assessment", [
    detailItem("Tax class", details?.taxClass ?? details?.taxCode),
    detailItem("BBL", details?.buildingLotBlock ?? details?.bbl),
    detailItem("Market value", details?.assessedMarketValue, { format: "money" }),
    detailItem("Actual value", details?.assessedActualValue, { format: "money" }),
  ], [
    detailItem("Tax before total", details?.assessedTaxBeforeTotal, { format: "money" }),
    detailItem("Gross sqft", details?.assessedGrossSqft),
    detailItem("Land area", details?.assessedLandArea),
    detailItem("Residential gross sqft", details?.assessedResidentialAreaGross),
    detailItem("Office gross sqft", details?.assessedOfficeAreaGross),
    detailItem("Retail gross sqft", details?.assessedRetailAreaGross),
    detailItem("Roll date", details?.assessedExtractDate),
  ]);
  addModule("owner", "Owner", [
    detailItem("Owner", details?.ownerInfo ?? details?.ownerValuations),
    detailItem("Permit owner business", readStringPath(enrichment, ["permits_summary", "owner_business_name"])),
    detailItem("Permit owner", readStringPath(enrichment, ["permits_summary", "owner_name"])),
  ]);
  addModule("zoning", "Zoning", [
    detailItem("District 1", readStringPath(enrichment, ["zoning", "zoningDistrict1"])),
    detailItem("District 2", readStringPath(enrichment, ["zoning", "zoningDistrict2"])),
    detailItem("Special district", readStringPath(enrichment, ["zoning", "specialDistrict1"])),
  ], [
    detailItem("Map number", readStringPath(enrichment, ["zoning", "zoningMapNumber"])),
    detailItem("Map code", readStringPath(enrichment, ["zoning", "zoningMapCode"])),
    detailItem("Refreshed", readStringPath(enrichment, ["zoning", "lastRefreshedAt"])),
  ]);
  addModule("certificate_of_occupancy", "Certificate of Occupancy", [
    detailItem("Status", readStringPath(enrichment, ["certificateOfOccupancy", "status"])),
    detailItem("Job type", readStringPath(enrichment, ["certificateOfOccupancy", "jobType"])),
    detailItem("Dwelling units", readNumericPath(enrichment, ["certificateOfOccupancy", "dwellingUnits"])),
  ], [
    detailItem("Filing type", readStringPath(enrichment, ["certificateOfOccupancy", "filingType"])),
    detailItem("Issued", readStringPath(enrichment, ["certificateOfOccupancy", "issuanceDate"])),
  ]);
  addModule("permits", "Permits", [
    detailItem("Count", readNumericPath(enrichment, ["permits_summary", "count"])),
    detailItem("Last issued", readStringPath(enrichment, ["permits_summary", "last_issued_date"])),
  ]);
  addModule("hpd_registration", "HPD Registration", [
    detailItem("Registration ID", readStringPath(enrichment, ["hpdRegistration", "registrationId"])),
    detailItem("Last registration", readStringPath(enrichment, ["hpdRegistration", "lastRegistrationDate"])),
  ]);
  addModule("hpd_violations", "HPD Violations", [
    detailItem("Open", readNumericPath(enrichment, ["hpd_violations_summary", "openCount"])),
    detailItem("Closed", readNumericPath(enrichment, ["hpd_violations_summary", "closedCount"])),
    detailItem("Rent impairing", readNumericPath(enrichment, ["hpd_violations_summary", "rentImpairingOpen"])),
  ], [
    detailItem("Total", readNumericPath(enrichment, ["hpd_violations_summary", "total"])),
    detailItem("Most recent", readStringPath(enrichment, ["hpd_violations_summary", "mostRecentApprovedDate"])),
    detailItem("By class", isPlainRecord(enrichment.hpd_violations_summary) ? enrichment.hpd_violations_summary.byClass : null),
  ]);
  addModule("dob_complaints", "DOB Complaints", [
    detailItem("30 days", readNumericPath(enrichment, ["dob_complaints_summary", "count30"])),
    detailItem("90 days", readNumericPath(enrichment, ["dob_complaints_summary", "count90"])),
    detailItem("365 days", readNumericPath(enrichment, ["dob_complaints_summary", "count365"])),
  ], [
    detailItem("Open", readNumericPath(enrichment, ["dob_complaints_summary", "openCount"])),
    detailItem("Closed", readNumericPath(enrichment, ["dob_complaints_summary", "closedCount"])),
    detailItem("Top categories", isPlainRecord(enrichment.dob_complaints_summary) ? enrichment.dob_complaints_summary.topCategories : null),
  ]);
  addModule("housing_litigations", "Housing Litigations", [
    detailItem("Total", readNumericPath(enrichment, ["housing_litigations_summary", "total"])),
    detailItem("Open", readNumericPath(enrichment, ["housing_litigations_summary", "openCount"])),
    detailItem("Penalty", readNumericPath(enrichment, ["housing_litigations_summary", "totalPenalty"]), { format: "money" }),
  ], [
    detailItem("Last finding", readStringPath(enrichment, ["housing_litigations_summary", "lastFindingDate"])),
    detailItem("By case type", isPlainRecord(enrichment.housing_litigations_summary) ? enrichment.housing_litigations_summary.byCaseType : null),
    detailItem("By status", isPlainRecord(enrichment.housing_litigations_summary) ? enrichment.housing_litigations_summary.byStatus : null),
  ]);
  addModule("affordable_housing", "Affordable Housing", [
    detailItem("Project count", readNumericPath(enrichment, ["affordable_housing_summary", "projectCount"])),
    detailItem("Total units", readNumericPath(enrichment, ["affordable_housing_summary", "totalUnits"])),
    detailItem("Latest project", readStringPath(enrichment, ["affordable_housing_summary", "latestProjectName"])),
  ], [
    detailItem("Start", readStringPath(enrichment, ["affordable_housing_summary", "latestProjectStartDate"])),
    detailItem("Completion", readStringPath(enrichment, ["affordable_housing_summary", "latestProjectCompletionDate"])),
    detailItem("By band", isPlainRecord(enrichment.affordable_housing_summary) ? enrichment.affordable_housing_summary.totalAffordableByBand : null),
  ]);

  const rentalUnits = Array.isArray(rentalFinancials?.rentalUnits) ? rentalFinancials.rentalUnits : [];
  const omRentRoll = Array.isArray(omAnalysis.rentRoll) ? omAnalysis.rentRoll : [];
  const authoritativeRentRoll = Array.isArray(authoritativeOm.rentRoll) ? authoritativeOm.rentRoll : [];
  const rentalItems = compactItems([
    detailItem("Rental flow status", readPipelineState(details).rentalFlowStatus),
    detailItem("Rental source", rentalFinancials?.source),
    detailItem("Rental units", rentalUnits.length || null),
    detailItem("OM rent roll rows", authoritativeRentRoll.length || omRentRoll.length || null),
    detailItem("Gross rent", fromLlm.grossRentTotal, { format: "money" }),
    detailItem("NOI", fromLlm.noi ?? readNumericPath(authoritativeOm, ["currentFinancials", "noi"]), { format: "money" }),
    detailItem("Cap rate", fromLlm.capRate, { format: "percent" }),
    detailItem("Last updated", rentalFinancials?.lastUpdatedAt),
    detailItem("Data gaps", fromLlm.dataGapSuggestions),
    detailItem("Rent notes", fromLlm.rentalEstimates),
  ]);
  addModule("rental_flow", "Rental Flow", rentalItems.slice(0, 6), rentalItems.slice(6));
  addModule("om_analysis", "OM Analysis", [
    detailItem("Status", details?.omData?.status),
    detailItem("Processed", details?.omData?.lastProcessedAt),
    detailItem("Income extracted", readNumericPath(authoritativeOm, ["coverage", "incomeStatementExtracted"])),
    detailItem("Rent roll extracted", readNumericPath(authoritativeOm, ["coverage", "rentRollExtracted"])),
  ], [
    detailItem("Current NOI", readNumericPath(authoritativeOm, ["currentFinancials", "noi"]), { format: "money" }),
    detailItem("Operating expenses", readNumericPath(authoritativeOm, ["currentFinancials", "operatingExpenses"]), { format: "money" }),
    detailItem("Takeaways", authoritativeOm.investmentTakeaways ?? omAnalysis.investmentTakeaways),
    detailItem("Validation flags", Array.isArray(authoritativeOm.validationFlags) ? authoritativeOm.validationFlags.length : null),
  ]);
  addModule("sourcing_update", "Sourcing Update", [
    detailItem("Status", details?.sourcingUpdate?.status),
    detailItem("Last evaluated", details?.sourcingUpdate?.lastEvaluatedAt),
    detailItem("Summary", details?.sourcingUpdate?.summary),
  ], (details?.sourcingUpdate?.changes ?? []).slice(0, 8).map((change) =>
    detailItem(change.label || change.field, change.currentValue ?? change.changeType)
  ));

  return {
    modules,
    sourceItems,
    rentalItems,
    listingFacts: buildListingFacts(row),
    rentalFlow: buildRentalFlowPayload(
      isPlainRecord(rentalFinancials) ? rentalFinancials : null,
      fromLlm,
      coerceRecordList(authoritativeRentRoll),
      coerceRecordList(omRentRoll)
    ),
    omAnalysis: buildOmAnalysisPayload(details, authoritativeOm, omAnalysis),
    sourcingUpdate: details?.sourcingUpdate ?? null,
  };
}

function getCalculatedDealScore(row: PipelineBaseRow): number | null {
  const summary = getCurrentDossierSummary(row);
  const calculated =
    summary?.calculatedDealScore ??
    summary?.dealScore ??
    (hasCurrentUnderwritingSource(row) ? toFiniteNumber(row.latest_signal_deal_score) : null);
  const override = row.override_score != null
    ? {
        score: Number(row.override_score),
        id: "ui-v2-row-override",
        propertyId: row.property_id,
        reason: "",
        createdAt: toIso(row.property_updated_at),
        createdBy: null,
        clearedAt: null,
      }
    : null;
  return resolveEffectiveDealScore(calculated ?? null, override);
}

function getCapRate(row: PipelineBaseRow): number | null {
  const details = row.details;
  const summary = getCurrentDossierSummary(row);
  const allowSignalFallback = hasCurrentUnderwritingSource(row);
  const explicit =
    readFirstNumericPath(details, [
      ["omData", "authoritative", "valuationMetrics", "capRate"],
      ["omData", "authoritative", "valuationMetrics", "currentCapRate"],
      ["omData", "authoritative", "uiFinancialSummary", "capRate"],
      ["rentalFinancials", "omAnalysis", "valuationMetrics", "capRate"],
      ["rentalFinancials", "omAnalysis", "valuationMetrics", "currentCapRate"],
      ["rentalFinancials", "fromLlm", "capRate"],
    ]);
  if (explicit != null) return explicit;
  const noi =
    readNumericPath(details, ["omData", "authoritative", "currentFinancials", "noi"]) ??
    readNumericPath(details, ["omData", "authoritative", "currentFinancials", "netOperatingIncome"]) ??
    readNumericPath(details, ["rentalFinancials", "omAnalysis", "currentFinancials", "noi"]) ??
    readNumericPath(details, ["rentalFinancials", "omAnalysis", "currentFinancials", "netOperatingIncome"]) ??
    readNumericPath(details, ["rentalFinancials", "fromLlm", "noi"]) ??
    summary?.currentNoi ??
    (allowSignalFallback ? toFiniteNumber(row.latest_signal_current_noi) : null) ??
    summary?.adjustedNoi ??
    (allowSignalFallback ? toFiniteNumber(row.latest_signal_adjusted_noi) : null);
  const price = getAskingPrice(row);
  if (noi == null || price == null || price <= 0) return null;
  return (noi / price) * 100;
}

function getCurrentNoi(row: PipelineBaseRow): number | null {
  const details = row.details;
  const summary = getCurrentDossierSummary(row);
  const allowSignalFallback = hasCurrentUnderwritingSource(row);
  return (
    summary?.currentNoi ??
    readNumericPath(details, ["omData", "authoritative", "currentFinancials", "noi"]) ??
    readNumericPath(details, ["omData", "authoritative", "currentFinancials", "netOperatingIncome"]) ??
    readNumericPath(details, ["rentalFinancials", "omAnalysis", "currentFinancials", "noi"]) ??
    readNumericPath(details, ["rentalFinancials", "omAnalysis", "currentFinancials", "netOperatingIncome"]) ??
    readNumericPath(details, ["rentalFinancials", "fromLlm", "noi"]) ??
    (allowSignalFallback ? toFiniteNumber(row.latest_signal_current_noi) : null)
  );
}

function getAdjustedNoi(row: PipelineBaseRow): number | null {
  const summary = getCurrentDossierSummary(row);
  return summary?.adjustedNoi ?? summary?.stabilizedNoi ?? (hasCurrentUnderwritingSource(row) ? toFiniteNumber(row.latest_signal_adjusted_noi) : null);
}

function getNoiYieldOnCost(row: PipelineBaseRow, noi: number | null, fallbackPct: number | string | null): number | null {
  const price = getAskingPrice(row);
  if (price != null && price > 0 && noi != null) return (noi / price) * 100;
  return toFiniteNumber(fallbackPct);
}

function buildUnderwriting(row: PipelineBaseRow): UiV2UnderwritingSummary | null {
  const details = row.details;
  const summary = getCurrentDossierSummary(row);
  const assumptions = getPropertyDossierAssumptions(details);
  const generation = getPropertyDossierGeneration(details);
  const allowSignalFallback = hasCurrentUnderwritingSource(row);
  const currentNoi = getCurrentNoi(row);
  const adjustedNoi = getAdjustedNoi(row);
  const ltrYocPct = getNoiYieldOnCost(row, currentNoi, allowSignalFallback ? row.latest_signal_asset_cap_rate : null);
  const mtrYocPct = getNoiYieldOnCost(row, adjustedNoi, allowSignalFallback ? row.latest_signal_adjusted_cap_rate : null);
  const yieldSignals = computeYieldSignals({ ltrYieldPct: ltrYocPct, mtrYieldPct: mtrYocPct });
  const hasAnyUnderwriting =
    summary != null ||
    assumptions != null ||
    generation != null ||
    (allowSignalFallback && row.latest_signal_deal_score != null) ||
    ltrYocPct != null ||
    mtrYocPct != null ||
    row.override_score != null;
  if (!hasAnyUnderwriting) return null;
  return {
    generationStatus: generation?.status ?? null,
    dealScore: getCalculatedDealScore(row),
    askingPrice: getAskingPrice(row),
    recommendedOfferLow: summary?.recommendedOfferLow ?? null,
    recommendedOfferHigh: summary?.recommendedOfferHigh ?? null,
    capRate: getCapRate(row),
    ltrYocPct,
    mtrYocPct,
    yocPct: mtrYocPct,
    yocBasis: mtrYocPct != null ? "adjusted_noi" : ltrYocPct != null ? "current_noi" : "unknown",
    marketCapRatePct: null,
    yocSpreadPct: yieldSignals.spreadPctPoints,
    mtrCalloutCode: yieldSignals.calloutCode,
    mtrCalloutLabel: yieldSignals.calloutLabel,
    targetIrrPct: summary?.targetIrrPct ?? assumptions?.targetIrrPct ?? null,
    irrPct: summary?.irrPct ?? (allowSignalFallback ? toFiniteNumber(row.latest_signal_irr_pct) : null),
    cocPct: summary?.cocPct ?? (allowSignalFallback ? toFiniteNumber(row.latest_signal_coc_pct) : null),
    currentNoi,
    adjustedNoi,
    summary,
  };
}

function candidateContacts(value: unknown): Array<{ email?: string | null; name?: string | null; firm?: string | null; contactId?: string | null }> {
  return Array.isArray(value)
    ? value.filter((entry): entry is { email?: string | null; name?: string | null; firm?: string | null; contactId?: string | null } => isPlainRecord(entry))
    : [];
}

function findEnrichedAgentForRecipient(
  row: PipelineBaseRow,
  contactEmail: string | null
): AgentEnrichmentEntry | null {
  const agents = Array.isArray(row.listing_agent_enrichment) ? row.listing_agent_enrichment : [];
  if (contactEmail) {
    const normalized = contactEmail.toLowerCase();
    const match = agents.find((agent) => agent.email?.toLowerCase() === normalized);
    if (match) return match;
  }
  return agents.find((agent) => agent.email || agent.name || agent.firm || agent.phone) ?? null;
}

function buildBroker(row: PipelineBaseRow): UiV2BrokerBlock | null {
  const manualEmail = stringOrNull(row.manual_broker_email);
  const recipientEmail = manualEmail ?? row.recipient_contact_email;
  const candidate = candidateContacts(row.recipient_candidates).find((entry) => {
    if (recipientEmail && entry.email?.toLowerCase() === recipientEmail.toLowerCase()) return true;
    return row.recipient_contact_id != null && entry.contactId === row.recipient_contact_id;
  });
  const enrichedAgent = findEnrichedAgentForRecipient(row, recipientEmail);
  const agentNameFallback = row.listing_agent_names?.find((name) => name.trim().length > 0) ?? null;
  const name = row.manual_broker_name ?? row.broker_display_name ?? candidate?.name ?? enrichedAgent?.name ?? agentNameFallback;
  const email = recipientEmail ?? candidate?.email ?? enrichedAgent?.email ?? null;
  const firm = row.manual_broker_firm ?? row.broker_firm ?? candidate?.firm ?? enrichedAgent?.firm ?? null;
  const phone = row.manual_broker_phone ?? row.broker_phone ?? enrichedAgent?.phone ?? null;
  const isManual = row.recipient_status === "manual_override" || row.manual_overwritten_at != null;
  if (!name && !email && !firm && !phone) return null;
  return {
    contactId: row.recipient_contact_id,
    name,
    email,
    phone,
    firm,
    source: isManual ? "overwrite" : row.broker_source ?? (enrichedAgent ? "llm" : "sourced"),
    overwrittenAt: isManual ? optionalIso(row.manual_overwritten_at ?? row.recipient_updated_at) : null,
    overwrittenBy: isManual ? row.manual_overwritten_by : null,
    notes: row.manual_broker_notes ?? row.broker_notes,
  };
}

function buildGallery(row: PipelineBaseRow): UiV2ImageAsset[] {
  const urls: string[] = [];
  if (Array.isArray(row.listing_image_urls)) urls.push(...row.listing_image_urls);
  const extraImages = isPlainRecord(row.listing_extra) ? row.listing_extra.images : null;
  if (Array.isArray(extraImages)) {
    for (const image of extraImages) {
      if (typeof image === "string") {
        urls.push(image);
      } else if (isPlainRecord(image)) {
        const url = stringOrNull(image.url) ?? stringOrNull(image.src) ?? stringOrNull(image.href);
        if (url) urls.push(url);
      }
    }
  }
  return [...new Set(urls)]
    .filter((url) => /^https?:\/\//i.test(url))
    .map((url, index) => ({
      id: `${row.property_id}-image-${index + 1}`,
      url,
      thumbnailUrl: url,
      altText: `${row.canonical_address} photo ${index + 1}`,
      source: row.listing_source,
      order: index,
    }));
}

function deriveMarketType(row: PipelineBaseRow): UiV2MarketType {
  const pipeline = readPipelineState(row.details);
  const explicit = parseMarketType(pipeline.marketType);
  if (explicit) return explicit;
  const tags = pipeline.tags.map(normalizeTag);
  if (tags.includes("on_market")) return "on_market";
  if (tags.includes("off_market")) return "off_market";
  const source = String(row.listing_source ?? pipeline.source ?? "").toLowerCase();
  if (source === "streeteasy" || source === "loopnet" || source === "marcus_millichap" || source === "zillow") {
    return "on_market";
  }
  if (source === "manual" || source === "other" || source === "nyc_api") return "off_market";
  if (row.listing_url) return "on_market";
  return "unknown";
}

function buildOverview(row: PipelineBaseRow): UiV2PropertyOverview {
  const addressParts = splitAddress(row.canonical_address);
  return {
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    displayAddress: addressParts.displayAddress,
    neighborhood: neighborhoodName(row.details, row.listing_extra),
    borough: boroughName(row.details, row.listing_extra),
    city: row.listing_city ?? addressParts.city,
    state: row.listing_state ?? addressParts.state,
    zip: row.listing_zip ?? addressParts.zip,
    source: row.listing_source ?? readPipelineState(row.details).source,
    propertyType: getPropertyType(row),
    marketType: deriveMarketType(row),
    listingUrl: row.listing_url ?? readStringPath(row.details, ["manualSourceLinks", "streetEasyUrl"]),
    askingPrice: getAskingPrice(row),
    units: getUnitCount(row),
    beds: readFirstNumericPath(row.details, [
      ["manualSourceFacts", "bedrooms"],
      ["manualSourceFacts", "beds"],
      ["omData", "authoritative", "propertyInfo", "bedrooms"],
      ["omData", "authoritative", "propertyInfo", "beds"],
    ]) ?? toFiniteNumber(row.listing_beds),
    baths: readFirstNumericPath(row.details, [
      ["manualSourceFacts", "bathrooms"],
      ["manualSourceFacts", "baths"],
      ["omData", "authoritative", "propertyInfo", "bathrooms"],
      ["omData", "authoritative", "propertyInfo", "baths"],
    ]) ?? toFiniteNumber(row.listing_baths),
    buildingSqft: getBuildingSqft(row),
    pricePerSqft: getPricePerSqft(row),
    lotSqft: getLotSqft(row),
    yearBuilt: getYearBuilt(row),
    description: row.listing_description ?? readStringPath(row.details, ["description"]),
  };
}

function savedDealFromRow(row: PipelineBaseRow, userId: string): SavedDeal | null {
  if (!row.saved_deal_id || !row.saved_deal_status || !row.saved_deal_created_at) return null;
  return {
    id: row.saved_deal_id,
    userId,
    propertyId: row.property_id,
    dealStatus: row.saved_deal_status as SavedDeal["dealStatus"],
    createdAt: toIso(row.saved_deal_created_at),
  };
}

function buildListingActivitySummary(row: PipelineBaseRow): ReturnType<typeof deriveListingActivitySummary> {
  return deriveListingActivitySummary({
    listedAt: optionalIso(row.listing_listed_at),
    currentPrice: getAskingPrice(row),
    priceHistory: Array.isArray(row.listing_price_history) ? row.listing_price_history : null,
  });
}

function buildPipelineRow(row: PipelineBaseRow, userId: string): UiV2PipelineRow {
  const overview = buildOverview(row);
  const gallery = buildGallery(row);
  const pipeline = readPipelineState(row.details);
  const status = listingStatus(row);
  const listingActivity = buildListingActivitySummary(row);
  const dealPath = pipeline.dealPath ?? null;
  const tags = uniqueStrings([
    ...pipeline.tags,
    isUnavailableListingStatus(status) ? "listing_unavailable" : null,
  ]);
  return {
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    displayAddress: overview.displayAddress,
    source: overview.source,
    statusChip: buildStatusChip(row),
    tags,
    askingPrice: overview.askingPrice,
    units: overview.units,
    buildingSqft: overview.buildingSqft,
    pricePerSqft: overview.pricePerSqft,
    propertyType: overview.propertyType,
    marketType: overview.marketType,
    neighborhood: overview.neighborhood,
    borough: overview.borough,
    thumbnailUrl: gallery[0]?.thumbnailUrl ?? null,
    broker: buildBroker(row),
    documentStatus: buildDocumentStatus(row),
    enrichmentState: buildEnrichmentState(row),
    underwriting: buildUnderwriting(row),
    openActionItemCount: Number(row.open_action_item_count ?? 0),
    savedDeal: savedDealFromRow(row, userId),
    dealPath,
    listingActivity,
    lastActivityAt: pipeline.lastActivityAt ?? optionalIso(row.property_updated_at),
    newness: buildPipelineNewness(row),
    listedAt: getListedAt(row),
    createdAt: toIso(row.property_created_at),
    updatedAt: toIso(row.property_updated_at),
  };
}

function isWithinManualNewnessWindow(value: string | null): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const ageMs = Date.now() - parsed;
  return ageMs >= 0 && ageMs <= MANUAL_NEWNESS_WINDOW_MS;
}

function isManualOrImportedPipelineRow(row: PipelineBaseRow): boolean {
  const pipeline = readPipelineState(row.details);
  const source = String(row.listing_source ?? pipeline.source ?? "").trim().toLowerCase();
  const jobType = readStringPath(row.details, ["importV2", "jobType"]);
  const manualAddedAt = readStringPath(row.details, ["manualSourceLinks", "addedAt"]);
  return Boolean(jobType || manualAddedAt || source === "manual" || row.listing_id == null);
}

function buildPipelineNewness(row: PipelineBaseRow): UiV2PipelineNewness | null {
  const sourcingUpdate = row.details?.sourcingUpdate ?? null;
  const sourcingRunId = stringOrNull(sourcingUpdate?.lastRunId);
  if (sourcingRunId) {
    const latestRunId = stringOrNull(row.latest_sourcing_run_id);
    const isLatestRun = latestRunId == null || latestRunId === sourcingRunId;
    if (sourcingUpdate?.status === "new" && isLatestRun) {
      return {
        isNew: true,
        reason: "saved_search_run",
        occurredAt:
          stringOrNull(sourcingUpdate.lastEvaluatedAt) ??
          optionalIso(row.listing_uploaded_at) ??
          optionalIso(row.property_created_at),
      };
    }
    return null;
  }

  const uploadedRunId = stringOrNull(row.listing_uploaded_run_id);
  if (uploadedRunId) {
    const uploadedAt = optionalIso(row.listing_uploaded_at);
    return isWithinManualNewnessWindow(uploadedAt)
      ? { isNew: true, reason: "saved_search_upload", occurredAt: uploadedAt }
      : null;
  }

  const manualAddedAt = readFirstStringPath(row.details, [
    ["importV2", "importedAt"],
    ["manualSourceLinks", "addedAt"],
  ]);
  const occurredAt = manualAddedAt ?? optionalIso(row.property_created_at);
  if (isManualOrImportedPipelineRow(row) && isWithinManualNewnessWindow(occurredAt)) {
    return {
      isNew: true,
      reason: readStringPath(row.details, ["importV2", "jobType"]) ? "manual_import" : "property_added",
      occurredAt,
    };
  }

  return null;
}

function buildActivityTimeline(row: PipelineBaseRow, collections: DetailCollections): UiV2ActivityTimelineItem[] {
  const items: UiV2ActivityTimelineItem[] = collections.pipelineEvents.map((event) => ({
    id: event.id,
    propertyId: event.propertyId,
    type: event.eventType,
    title: event.title,
    body: event.body ?? null,
    actorName: event.actor ?? null,
    metadata: event.metadata,
    createdAt: event.createdAt,
  }));
  const pipeline = readPipelineState(row.details);
  const activity = buildListingActivitySummary(row);
  const activityBody = describeListingActivity(activity);
  if (activityBody && activity?.lastActivityDate) {
    items.push({
      id: `${row.property_id}:listing-activity:${activity.lastActivityDate}`,
      propertyId: row.property_id,
      type: "listing_seen",
      title: "Listing activity",
      body: activityBody,
      metadata: {
        latestPriceChangePercent: activity.latestPriceChangePercent,
        totalPriceDrops: activity.totalPriceDrops,
      },
      createdAt: `${activity.lastActivityDate}T12:00:00.000Z`,
    });
  }
  const currentListingStatus = listingStatus(row);
  if (isUnavailableListingStatus(currentListingStatus)) {
    items.push({
      id: `${row.property_id}:listing-unavailable:${currentListingStatus ?? "unknown"}`,
      propertyId: row.property_id,
      type: "listing_status",
      title: "Listing unavailable",
      body: currentListingStatus ? `StreetEasy status: ${currentListingStatus}` : "Listing is not currently active.",
      metadata: { tone: "danger", rejectionReason: "already_sold_or_unavailable" },
      createdAt: optionalIso(row.listing_last_seen_at) ?? toIso(row.property_updated_at),
    });
  }
  if (row.details?.sourcingUpdate?.status === "updated" && row.details.sourcingUpdate.lastEvaluatedAt) {
    items.push({
      id: `${row.property_id}:sourcing-update:${row.details.sourcingUpdate.lastEvaluatedAt}`,
      propertyId: row.property_id,
      type: "listing_activity",
      title: "Sourcing update",
      body: row.details.sourcingUpdate.summary ?? null,
      metadata: { changes: row.details.sourcingUpdate.changes ?? [] },
      createdAt: row.details.sourcingUpdate.lastEvaluatedAt,
    });
  }
  items.push({
    id: `${row.property_id}:created`,
    propertyId: row.property_id,
    type: "listing_seen",
    title: "Property created",
    body: row.listing_source ? `Source: ${row.listing_source}` : null,
    createdAt: toIso(row.property_created_at),
  });
  if (pipeline.rejectedAt) {
    items.push({
      id: `${row.property_id}:rejected`,
      propertyId: row.property_id,
      type: "rejected",
      title: "Property rejected",
      body: pipeline.rejectionReason ?? null,
      metadata: pipeline.rejection ? { rejection: pipeline.rejection } : null,
      createdAt: pipeline.rejectedAt,
    });
  }
  if (row.saved_deal_created_at) {
    items.push({
      id: `${row.property_id}:saved:${toIso(row.saved_deal_created_at)}`,
      propertyId: row.property_id,
      type: "saved",
      title: "Deal saved",
      createdAt: toIso(row.saved_deal_created_at),
    });
  }
  if (row.recipient_status === "manual_override" && row.recipient_updated_at) {
    items.push({
      id: `${row.property_id}:broker-edited:${toIso(row.recipient_updated_at)}`,
      propertyId: row.property_id,
      type: "broker_edited",
      title: "Broker edited",
      body: row.recipient_contact_email ?? null,
      createdAt: toIso(row.recipient_updated_at),
    });
  }
  for (const doc of collections.uploadedDocs) {
    items.push({
      id: `${row.property_id}:uploaded:${doc.id}`,
      propertyId: row.property_id,
      type: doc.category === "OM" || doc.category === "Brochure" ? "om_uploaded" : "note_added",
      title: `${doc.category} uploaded`,
      body: doc.filename,
      metadata: { documentId: doc.id, category: doc.category, source: "uploaded" },
      createdAt: doc.createdAt,
    });
  }
  for (const doc of collections.inquiryDocs) {
    items.push({
      id: `${row.property_id}:inquiry-doc:${doc.id}`,
      propertyId: row.property_id,
      type: looksLikeOmStyleFilename(doc.filename) ? "om_uploaded" : "broker_reply",
      title: looksLikeOmStyleFilename(doc.filename) ? "OM received from broker" : "Broker attachment received",
      body: doc.filename,
      metadata: { documentId: doc.id, source: "inquiry" },
      createdAt: doc.createdAt,
    });
  }
  for (const run of collections.omRuns) {
    items.push({
      id: `${row.property_id}:om-run:${run.id}`,
      propertyId: row.property_id,
      type: run.status === "promoted" ? "om_imported" : "om_processed",
      title: `OM processing ${run.status}`,
      body: run.lastError ?? null,
      metadata: { runId: run.id, sourceType: run.sourceType },
      createdAt: run.completedAt ?? run.startedAt ?? run.createdAt,
    });
  }
  const generation = getPropertyDossierGeneration(row.details);
  if (generation?.completedAt || generation?.startedAt) {
    items.push({
      id: `${row.property_id}:underwriting:${generation.completedAt ?? generation.startedAt}`,
      propertyId: row.property_id,
      type: "underwriting_generated",
      title: generation.status === "completed" ? "Underwriting generated" : "Underwriting started",
      body: generation.stageLabel ?? null,
      createdAt: generation.completedAt ?? generation.startedAt ?? toIso(row.property_updated_at),
    });
  }
  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 50);
}

function buildDocumentItems(row: PipelineBaseRow, collections: DetailCollections): UiV2PropertyDocumentItem[] {
  const basePath = `/api/properties/${encodeURIComponent(row.property_id)}/documents`;
  return [
    ...collections.uploadedDocs.map((doc) => ({
      id: doc.id,
      fileName: doc.filename,
      fileType: doc.contentType ?? null,
      source: doc.source ?? doc.category,
      sourceType: "uploaded" as const,
      category: doc.category,
      sourceUrl: doc.sourceUrl ?? null,
      fileUrl: `${basePath}/${encodeURIComponent(doc.id)}/file`,
      createdAt: doc.createdAt,
    })),
    ...collections.inquiryDocs.map((doc) => ({
      id: doc.id,
      fileName: doc.filename,
      fileType: doc.contentType ?? null,
      source: "Broker inquiry",
      sourceType: "inquiry" as const,
      category: looksLikeOmStyleFilename(doc.filename) ? "OM" : "Other",
      sourceUrl: null,
      fileUrl: `${basePath}/${encodeURIComponent(doc.id)}/file`,
      createdAt: doc.createdAt,
    })),
    ...collections.generatedDocs.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      fileType: doc.fileType ?? null,
      source: doc.source,
      sourceType: "generated" as const,
      category: doc.source,
      sourceUrl: null,
      fileUrl: `${basePath}/${encodeURIComponent(doc.id)}/file`,
      createdAt: doc.createdAt,
    })),
  ].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

function buildBrokerCompMarketSummary(collections: DetailCollections): BrokerCompMarketSummary | null {
  if (collections.brokerCompDetails.length === 0) return null;
  const latestPackage = [...collections.brokerCompDetails]
    .map((detail) => detail.package)
    .sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)))[0];
  const itemCount = collections.brokerCompDetails.reduce((sum, detail) => sum + detail.items.length, 0);
  const approvedCount = collections.brokerCompDetails.reduce(
    (sum, detail) => sum + detail.items.filter((item) => item.reviewStatus === "accepted" || item.includeInDossier).length,
    0
  );
  return {
    status: latestPackage?.status ?? "ready_for_review",
    summary: `${collections.brokerCompDetails.length} broker comp package${collections.brokerCompDetails.length === 1 ? "" : "s"} / ${itemCount} extracted item${itemCount === 1 ? "" : "s"} / ${approvedCount} approved`,
    updatedAt: latestPackage?.updatedAt ?? latestPackage?.createdAt ?? null,
    packages: collections.brokerCompDetails as unknown as NonNullable<BrokerCompMarketSummary["packages"]>,
  };
}

function buildPropertyDetail(row: PipelineBaseRow, collections: DetailCollections, userId: string): UiV2PropertyDetailPayload {
  return {
    overview: buildOverview(row),
    statusChip: buildStatusChip(row),
    gallery: buildGallery(row),
    broker: buildBroker(row),
    tags: readPipelineState(row.details).tags,
    documentStatus: buildDocumentStatus(row, collections),
    documents: buildDocumentItems(row, collections),
    enrichmentState: buildEnrichmentState(row),
    enrichmentDetails: buildEnrichmentDetails(row),
    underwriting: buildUnderwriting(row),
    brokerComps: buildBrokerCompMarketSummary(collections),
    dealPath: readPipelineState(row.details).dealPath ?? null,
    sourcingUpdate: row.details?.sourcingUpdate ?? null,
    activityTimeline: buildActivityTimeline(row, collections),
    actionItems: collections.actionItems,
    savedDeal: savedDealFromRow(row, userId),
  };
}

async function getDefaultUserId(pool: Pool): Promise<string> {
  const profileRepo = new UserProfileRepo({ pool });
  return profileRepo.ensureDefault();
}

async function fetchPipelineRows(pool: Pool, userId: string): Promise<PipelineBaseRow[]> {
  const result = await pool.query<PipelineBaseRow>(
    `SELECT
       p.id AS property_id,
       p.canonical_address,
       p.details,
       p.created_at AS property_created_at,
       p.updated_at AS property_updated_at,
       l.id AS listing_id,
       l.source AS listing_source,
       l.price AS listing_price,
       l.city AS listing_city,
       l.state AS listing_state,
       l.zip AS listing_zip,
       l.beds AS listing_beds,
       l.baths AS listing_baths,
       l.sqft AS listing_sqft,
       l.url AS listing_url,
       l.title AS listing_title,
       l.description AS listing_description,
       l.image_urls AS listing_image_urls,
       l.listed_at AS listing_listed_at,
       l.uploaded_at AS listing_uploaded_at,
       l.uploaded_run_id AS listing_uploaded_run_id,
       l.price_history AS listing_price_history,
       l.rental_price_history AS listing_rental_price_history,
       l.lifecycle_state AS listing_lifecycle_state,
       l.last_seen_at AS listing_last_seen_at,
       l.agent_names AS listing_agent_names,
       l.agent_enrichment AS listing_agent_enrichment,
       l.extra AS listing_extra,
       rr.status AS recipient_status,
       rr.contact_id AS recipient_contact_id,
       rr.contact_email AS recipient_contact_email,
       rr.confidence AS recipient_confidence,
       rr.resolution_reason AS recipient_reason,
       rr.candidate_contacts AS recipient_candidates,
       rr.updated_at AS recipient_updated_at,
       rr.manual_broker_name,
       rr.manual_broker_email,
       rr.manual_broker_phone,
       rr.manual_broker_firm,
       rr.manual_broker_notes,
       rr.manual_overwritten_at,
       rr.manual_overwritten_by,
       bc.display_name AS broker_display_name,
       bc.firm AS broker_firm,
       bc.phone AS broker_phone,
       bc.source AS broker_source,
       bc.source_metadata AS broker_source_metadata,
       bc.last_outreach_at AS broker_last_outreach_at,
       bc.last_reply_at AS broker_last_reply_at,
       bc.notes AS broker_notes,
       COALESCE(ud.uploaded_doc_count, 0) AS uploaded_doc_count,
       ud.uploaded_categories,
       ud.uploaded_last_updated_at,
       COALESCE(idoc.inquiry_doc_count, 0) AS inquiry_doc_count,
       idoc.inquiry_filenames,
       idoc.inquiry_last_updated_at,
       COALESCE(gdoc.generated_doc_count, 0) AS generated_doc_count,
       gdoc.generated_sources,
       gdoc.generated_last_updated_at,
       om.id AS latest_om_run_id,
       om.status AS latest_om_status,
       om.started_at AS latest_om_started_at,
       om.completed_at AS latest_om_completed_at,
       ds.deal_score AS latest_signal_deal_score,
       ds.irr_pct AS latest_signal_irr_pct,
       ds.coc_pct AS latest_signal_coc_pct,
       ds.current_noi AS latest_signal_current_noi,
       ds.adjusted_noi AS latest_signal_adjusted_noi,
       ds.asset_cap_rate AS latest_signal_asset_cap_rate,
       ds.adjusted_cap_rate AS latest_signal_adjusted_cap_rate,
       ds.yield_spread AS latest_signal_yield_spread,
       dso.score AS override_score,
       COALESCE(ai.open_action_item_count, 0) AS open_action_item_count,
       pis.sent_at AS latest_inquiry_sent_at,
       COALESCE(es.enrichment_count, 0) AS enrichment_count,
       COALESCE(es.enrichment_success_count, 0) AS enrichment_success_count,
       COALESCE(es.enrichment_failed_count, 0) AS enrichment_failed_count,
       es.enrichment_last_refreshed_at,
       es.enrichment_last_error,
       sd.id AS saved_deal_id,
       sd.deal_status AS saved_deal_status,
       sd.created_at AS saved_deal_created_at,
       latest_sourcing_run.id::text AS latest_sourcing_run_id
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT l.*
       FROM listing_property_matches m
       INNER JOIN listings l ON l.id = m.listing_id
       WHERE m.property_id = p.id
       ORDER BY (m.status = 'accepted') DESC, m.confidence DESC, m.created_at DESC
       LIMIT 1
     ) l ON true
     LEFT JOIN property_recipient_resolution rr ON rr.property_id = p.id
     LEFT JOIN broker_contacts bc ON bc.id = rr.contact_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS uploaded_doc_count,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT category), NULL) AS uploaded_categories,
         MAX(created_at) AS uploaded_last_updated_at
       FROM property_uploaded_documents
       WHERE property_id = p.id
     ) ud ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS inquiry_doc_count,
         ARRAY_REMOVE(ARRAY_AGG(filename), NULL) AS inquiry_filenames,
         MAX(created_at) AS inquiry_last_updated_at
       FROM property_inquiry_documents
       WHERE property_id = p.id
     ) idoc ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS generated_doc_count,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT source), NULL) AS generated_sources,
         MAX(created_at) AS generated_last_updated_at
       FROM documents
       WHERE property_id = p.id
     ) gdoc ON true
     LEFT JOIN LATERAL (
       SELECT *
       FROM om_ingestion_runs
       WHERE property_id = p.id
       ORDER BY started_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) om ON true
     LEFT JOIN LATERAL (
       SELECT *
       FROM deal_signals
       WHERE property_id = p.id
       ORDER BY generated_at DESC
       LIMIT 1
     ) ds ON true
     LEFT JOIN LATERAL (
       SELECT *
       FROM deal_score_overrides
       WHERE property_id = p.id AND cleared_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
     ) dso ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS open_action_item_count
       FROM property_action_items
       WHERE property_id = p.id AND status = 'open'
     ) ai ON true
     LEFT JOIN LATERAL (
       SELECT sent_at
       FROM property_inquiry_sends
       WHERE property_id = p.id
       ORDER BY sent_at DESC NULLS LAST
       LIMIT 1
     ) pis ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS enrichment_count,
         COUNT(*) FILTER (WHERE last_success_at IS NOT NULL)::int AS enrichment_success_count,
         COUNT(*) FILTER (WHERE last_error IS NOT NULL)::int AS enrichment_failed_count,
         MAX(last_refreshed_at) AS enrichment_last_refreshed_at,
         (ARRAY_REMOVE(ARRAY_AGG(last_error ORDER BY last_refreshed_at DESC), NULL))[1] AS enrichment_last_error
       FROM property_enrichment_state
       WHERE property_id = p.id
     ) es ON true
     LEFT JOIN saved_deals sd ON sd.property_id = p.id AND sd.user_id = $1
     LEFT JOIN ingestion_runs sourcing_run ON sourcing_run.id::text = p.details->'sourcingUpdate'->>'lastRunId'
     LEFT JOIN LATERAL (
       SELECT id
       FROM ingestion_runs
       WHERE profile_id = sourcing_run.profile_id
         AND status <> 'running'
       ORDER BY started_at DESC
       LIMIT 1
     ) latest_sourcing_run ON true
     ORDER BY p.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

async function fetchPipelineRowById(pool: Pool, userId: string, propertyId: string): Promise<PipelineBaseRow | null> {
  const rows = await fetchPipelineRows(pool, userId);
  return rows.find((row) => row.property_id === propertyId) ?? null;
}

async function loadDetailCollections(pool: Pool, propertyId: string): Promise<DetailCollections> {
  const brokerCompRepo = new BrokerCompPackageRepo({ pool });
  const brokerCompDetailsPromise = brokerCompRepo
    .listPackagesByPropertyId(propertyId, 20)
    .then(async (packages) => {
      const details = await Promise.all(packages.map((pkg) => brokerCompRepo.getPackageDetails(pkg.id)));
      return details.filter((detail): detail is BrokerCompPackageDetails => detail != null);
    })
    .catch(() => []);
  const [actionItems, uploadedDocs, inquiryDocs, generatedDocs, omRuns, pipelineEvents, brokerCompDetails] = await Promise.all([
    new PropertyActionItemRepo({ pool }).listOpenByPropertyId(propertyId).catch(() => []),
    new PropertyUploadedDocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new InquiryDocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new DocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new OmIngestionRunRepo({ pool }).listByPropertyId(propertyId, 20).catch(() => []),
    new PropertyPipelineEventRepo({ pool }).listByPropertyId(propertyId, { limit: 50 }).catch(() => []),
    brokerCompDetailsPromise,
  ]);
  return { actionItems, uploadedDocs, inquiryDocs, generatedDocs, omRuns, pipelineEvents, brokerCompDetails };
}

function mtrState(row: UiV2PipelineRow): "good" | "watch" | "none" {
  const normalizedTags = row.tags.flatMap((tag) => {
    const normalized = normalizeTag(tag);
    return normalized == null ? [] : [normalized];
  });
  if (normalizedTags.includes("good_mtr_candidate")) return "good";
  if (normalizedTags.some((tag) => tag.includes("mtr"))) return "watch";
  return "none";
}

function filterRows(rows: UiV2PipelineRow[], query: ParsedPipelineQuery): UiV2PipelineRow[] {
  const q = query.q?.toLowerCase();
  const updatedSinceMs = query.updatedSince ? Date.parse(query.updatedSince) : Number.NaN;
  return rows.filter((row) => {
    const rowStatus = row.statusChip.status as UiV2PipelineStatus;
    if (
      !query.includeRejected &&
      (rowStatus === "rejected" || rowStatus === "archived" || rowStatus === "deal_closed") &&
      !query.statuses.includes(rowStatus)
    ) {
      return false;
    }
    if (q) {
      const haystack = [
        row.canonicalAddress,
        row.displayAddress,
        row.source,
        row.statusChip.label,
        row.propertyType,
        row.marketType,
        row.neighborhood,
        row.borough,
        row.broker?.name,
        row.broker?.email,
        row.broker?.firm,
        ...row.tags,
      ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (query.statuses.length > 0 && !query.statuses.includes(rowStatus)) return false;
    if (query.sources.length > 0 && !query.sources.includes(String(row.source ?? "").toLowerCase())) return false;
    if (query.tags.length > 0 && !query.tags.some((tag) => row.tags.map(normalizeTag).includes(tag))) return false;
    if (query.mtrStates.length > 0 && !query.mtrStates.includes(mtrState(row))) return false;
    if (query.propertyTypes.length > 0 && !query.propertyTypes.includes(String(row.propertyType ?? "").toLowerCase())) return false;
    if (query.neighborhoods.length > 0 && !query.neighborhoods.includes(String(row.neighborhood ?? "").toLowerCase())) return false;
    if (query.boroughs.length > 0 && !query.boroughs.includes(String(row.borough ?? "").toLowerCase())) return false;
    if (query.marketTypes.length > 0 && !query.marketTypes.includes(row.marketType ?? "unknown")) return false;
    if (
      query.enrichmentStatuses.length > 0 &&
      !query.enrichmentStatuses.includes(String(row.enrichmentState?.status ?? "missing").toLowerCase())
    ) {
      return false;
    }
    if (query.hasOm != null && Boolean(row.documentStatus?.hasOm) !== query.hasOm) return false;
    if (query.hasBrokerContact != null && Boolean(row.broker?.email) !== query.hasBrokerContact) return false;
    if (query.hasOpenActions != null && (Number(row.openActionItemCount ?? 0) > 0) !== query.hasOpenActions) return false;
    const score = row.underwriting?.dealScore ?? null;
    if (query.minDealScore != null && (score == null || score < query.minDealScore)) return false;
    if (query.maxDealScore != null && (score == null || score > query.maxDealScore)) return false;
    if (query.minAskingPrice != null && (row.askingPrice == null || row.askingPrice < query.minAskingPrice)) return false;
    if (query.maxAskingPrice != null && (row.askingPrice == null || row.askingPrice > query.maxAskingPrice)) return false;
    if (query.minLtrYoc != null) {
      const ltrYoc = row.underwriting?.ltrYocPct ?? null;
      if (ltrYoc == null || ltrYoc < query.minLtrYoc) return false;
    }
    if (Number.isFinite(updatedSinceMs) && Date.parse(row.updatedAt) < updatedSinceMs) return false;
    return true;
  });
}

function sortValue(row: UiV2PipelineRow, sortBy: UiV2PipelineSortField): string | number | null {
  switch (sortBy) {
    case "createdAt":
      return Date.parse(row.createdAt);
    case "listedAt":
      return row.listedAt ? Date.parse(row.listedAt) : null;
    case "canonicalAddress":
      return row.canonicalAddress.toLowerCase();
    case "source":
      return String(row.source ?? "").toLowerCase();
    case "propertyType":
      return String(row.propertyType ?? "").toLowerCase();
    case "marketType":
      return row.marketType ?? "unknown";
    case "askingPrice":
      return row.askingPrice ?? null;
    case "buildingSqft":
      return row.buildingSqft ?? null;
    case "pricePerSqft":
      return row.pricePerSqft ?? null;
    case "units":
      return row.units ?? null;
    case "capRate":
      return row.underwriting?.capRate ?? null;
    case "ltrYocPct":
      return row.underwriting?.ltrYocPct ?? null;
    case "mtrYocPct":
      return row.underwriting?.mtrYocPct ?? row.underwriting?.yocPct ?? null;
    case "yocPct":
      return row.underwriting?.yocPct ?? null;
    case "dealScore":
      return row.underwriting?.dealScore ?? null;
    case "status":
      return String(row.statusChip.status);
    case "lastActivityAt":
      return row.lastActivityAt ? Date.parse(row.lastActivityAt) : null;
    case "lastContactedAt":
      return row.broker?.overwrittenAt ? Date.parse(row.broker.overwrittenAt) : null;
    case "omStatus":
      return row.documentStatus?.omStatus ?? null;
    case "updatedAt":
    default:
      return Date.parse(row.updatedAt);
  }
}

function sortRows(rows: UiV2PipelineRow[], query: ParsedPipelineQuery): UiV2PipelineRow[] {
  const direction = query.sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, query.sortBy);
    const rightValue = sortValue(right, query.sortBy);
    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    if (typeof leftValue === "number" && typeof rightValue === "number") return (leftValue - rightValue) * direction;
    return String(leftValue).localeCompare(String(rightValue)) * direction;
  });
}

function buildPipelinePayload(baseRows: PipelineBaseRow[], query: ParsedPipelineQuery, userId: string): UiV2PipelineListPayload {
  const mappedRows = baseRows.map((row) => buildPipelineRow(row, userId));
  const filtered = filterRows(mappedRows, query);
  const sorted = sortRows(filtered, query);
  const rows =
    query.statuses.length > 0
      ? sorted
      : [
          ...sorted.filter((row) =>
            row.statusChip.status !== "rejected" &&
            row.statusChip.status !== "archived" &&
            row.statusChip.status !== "deal_closed"
          ),
          ...sorted.filter((row) =>
            row.statusChip.status === "rejected" ||
            row.statusChip.status === "archived" ||
            row.statusChip.status === "deal_closed"
          ),
        ];
  return {
    rows: rows.slice(query.offset, query.offset + query.limit),
    total: filtered.length,
    limit: query.limit,
    offset: query.offset,
    query: queryForResponse(query),
  };
}

async function updatePipelineState(
  pool: Pool,
  propertyId: string,
  patch: Partial<PipelineDetailsState>
): Promise<Property | null> {
  const propertyRepo = new PropertyRepo({ pool });
  const property = await propertyRepo.byId(propertyId);
  if (!property) return null;
  const existing = readPipelineState(property.details);
  const nextPipeline: PipelineDetailsState = {
    ...existing,
    ...patch,
    tags: patch.tags ?? existing.tags,
    missingFields: patch.missingFields ?? existing.missingFields,
    actionRequired: patch.actionRequired ?? existing.actionRequired,
    sourceLinks: patch.sourceLinks ?? existing.sourceLinks ?? {},
    lastActivityAt: patch.lastActivityAt ?? new Date().toISOString(),
  };
  await propertyRepo.mergeDetails(propertyId, { pipeline: nextPipeline });
  return propertyRepo.byId(propertyId);
}

const PROPERTY_MERGE_REASSIGN_TABLES = [
  "property_uploaded_documents",
  "property_inquiry_documents",
  "documents",
  "om_ingestion_runs",
  "om_extracted_snapshots",
  "deal_signals",
  "broker_comp_packages",
  "broker_comp_extracted_items",
  "broker_comp_promoted_items",
] as const;

function detailsRecord(details: PropertyDetails | null | undefined): Record<string, unknown> {
  return isPlainRecord(details) ? details : {};
}

function mergedSourceProperties(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainRecord) : [];
}

function mergePropertyDetailsForTarget(input: {
  source: Property;
  target: Property;
  actorName: string;
  now: string;
}): Record<string, unknown> {
  const sourceDetails = detailsRecord(input.source.details);
  const targetDetails = detailsRecord(input.target.details);
  const sourceManualLinks = isPlainRecord(sourceDetails.manualSourceLinks) ? sourceDetails.manualSourceLinks : {};
  const targetManualLinks = isPlainRecord(targetDetails.manualSourceLinks) ? targetDetails.manualSourceLinks : {};
  const mergedSourceProperty = {
    propertyId: input.source.id,
    canonicalAddress: input.source.canonicalAddress,
    mergedAt: input.now,
    mergedBy: input.actorName,
  };
  const mergedHistory = [
    ...mergedSourceProperties(sourceDetails.mergedSourceProperties),
    ...mergedSourceProperties(targetDetails.mergedSourceProperties),
    mergedSourceProperty,
  ];
  const seen = new Set<string>();
  const uniqueHistory = mergedHistory.filter((entry) => {
    const propertyId = stringOrNull(entry.propertyId);
    if (!propertyId) return true;
    if (seen.has(propertyId)) return false;
    seen.add(propertyId);
    return true;
  });
  return {
    ...sourceDetails,
    ...targetDetails,
    manualSourceLinks: {
      ...sourceManualLinks,
      ...targetManualLinks,
      mergedFromPropertyIds: uniqueStrings([
        ...(Array.isArray(targetManualLinks.mergedFromPropertyIds) ? targetManualLinks.mergedFromPropertyIds : []),
        input.source.id,
      ]),
      lastMergedFromPropertyId: input.source.id,
      lastMergedAt: input.now,
      lastMergedBy: input.actorName,
    },
    mergedSourceProperties: uniqueHistory,
  };
}

function mergePropertyDetailsForArchivedSource(input: {
  source: Property;
  target: Property;
  actorName: string;
  now: string;
}): Record<string, unknown> {
  const sourceDetails = detailsRecord(input.source.details);
  const existing = readPipelineState(input.source.details);
  const previousUiV2Status = existing.uiV2Status ?? mapLegacyStatus(existing.status);
  return {
    ...sourceDetails,
    pipeline: {
      ...existing,
      status: "rejected_removed",
      uiV2Status: "archived",
      previousStatus: existing.status,
      previousUiV2Status,
      rejectedAt: input.now,
      rejectionReason: `Merged into ${input.target.canonicalAddress}`,
      rejection: {
        reasonCode: "duplicate",
        note: `Merged into ${input.target.canonicalAddress}`,
        rejectedAt: input.now,
      },
      tags: uniqueStrings([...existing.tags, "duplicate", "merged"]),
      lastActivityAt: input.now,
    },
    mergedIntoPropertyId: input.target.id,
    mergedIntoCanonicalAddress: input.target.canonicalAddress,
    mergedAt: input.now,
    mergedBy: input.actorName,
  };
}

async function reassignPropertyReferences(
  client: PoolClient,
  sourcePropertyId: string,
  targetPropertyId: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of PROPERTY_MERGE_REASSIGN_TABLES) {
    const result = await client.query(
      `UPDATE ${table}
       SET property_id = $1
       WHERE property_id = $2`,
      [targetPropertyId, sourcePropertyId]
    );
    counts[table] = result.rowCount ?? 0;
  }
  await client.query(
    `UPDATE om_authoritative_snapshots source_snap
     SET is_active = false,
         updated_at = now()
     WHERE source_snap.property_id = $2
       AND source_snap.is_active = true
       AND EXISTS (
         SELECT 1
         FROM om_authoritative_snapshots target_snap
         WHERE target_snap.property_id = $1
           AND target_snap.is_active = true
       )`,
    [targetPropertyId, sourcePropertyId]
  );
  const authoritative = await client.query(
    `UPDATE om_authoritative_snapshots
     SET property_id = $1,
         updated_at = now()
     WHERE property_id = $2`,
    [targetPropertyId, sourcePropertyId]
  );
  counts.om_authoritative_snapshots = authoritative.rowCount ?? 0;

  await client.query(
    `INSERT INTO listing_property_matches (listing_id, property_id, confidence, reasons, status)
     SELECT
       listing_id,
       $1,
       confidence,
       COALESCE(reasons, '{}'::jsonb) || jsonb_build_object('mergedFromPropertyId', $2),
       status
     FROM listing_property_matches
     WHERE property_id = $2
     ON CONFLICT (listing_id, property_id) DO UPDATE SET
       confidence = GREATEST(listing_property_matches.confidence, EXCLUDED.confidence),
       reasons = COALESCE(listing_property_matches.reasons, '{}'::jsonb) || EXCLUDED.reasons,
       status = CASE
         WHEN listing_property_matches.status = 'accepted' OR EXCLUDED.status = 'accepted' THEN 'accepted'::match_status
         ELSE listing_property_matches.status
       END`,
    [targetPropertyId, sourcePropertyId]
  );
  const deletedMatches = await client.query(
    "DELETE FROM listing_property_matches WHERE property_id = $1",
    [sourcePropertyId]
  );
  counts.listing_property_matches = deletedMatches.rowCount ?? 0;
  return counts;
}

const MANUAL_SOURCE_FACT_NUMERIC_ALIASES: Record<string, string> = {
  askingPrice: "askingPrice",
  listedPrice: "askingPrice",
  listingPrice: "askingPrice",
  askPrice: "askingPrice",
  units: "units",
  unitCount: "units",
  numberOfUnits: "units",
  totalUnits: "units",
  buildingSqft: "buildingSqft",
  sqft: "buildingSqft",
  squareFeet: "buildingSqft",
  grossSqft: "buildingSqft",
  bedrooms: "bedrooms",
  beds: "bedrooms",
  bathrooms: "bathrooms",
  baths: "bathrooms",
  yearBuilt: "yearBuilt",
  builtIn: "yearBuilt",
  monthlyHoa: "monthlyHoa",
  monthlyTax: "monthlyTax",
  daysOnMarket: "daysOnMarket",
  pricePerSqft: "pricePerSqft",
  pricePsf: "pricePerSqft",
};

const MANUAL_SOURCE_FACT_STRING_ALIASES: Record<string, string> = {
  neighborhood: "neighborhood",
  neighborhoodName: "neighborhood",
  borough: "borough",
  boroughName: "borough",
  listingStatus: "listingStatus",
  status: "listingStatus",
  propertyType: "propertyType",
};

function cleanManualString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function cleanManualNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = toFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function extractManualSourceFactsPatch(body: unknown): { patch: Record<string, unknown>; invalidFields: string[] } {
  const source = isPlainRecord(body) && isPlainRecord(body.facts) ? body.facts : isPlainRecord(body) ? body : {};
  const patch: Record<string, unknown> = {};
  const invalidFields: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const numericKey = MANUAL_SOURCE_FACT_NUMERIC_ALIASES[rawKey];
    if (numericKey) {
      const value = cleanManualNumber(rawValue);
      const isBlank = rawValue == null || (typeof rawValue === "string" && rawValue.trim() === "");
      if (value == null && !isBlank) invalidFields.push(rawKey);
      patch[numericKey] = value;
      continue;
    }
    const stringKey = MANUAL_SOURCE_FACT_STRING_ALIASES[rawKey];
    if (stringKey) {
      patch[stringKey] = cleanManualString(rawValue);
    }
  }
  return { patch, invalidFields };
}

async function loadDetailForProperty(pool: Pool, userId: string, propertyId: string): Promise<UiV2PropertyDetailPayload | null> {
  const row = await fetchPipelineRowById(pool, userId, propertyId);
  if (!row) return null;
  const collections = await loadDetailCollections(pool, propertyId);
  return buildPropertyDetail(row, collections, userId);
}

async function handleStatusUpdate(req: Request, res: Response): Promise<void> {
  try {
    const propertyId = req.params.id;
    if (!propertyId) {
      res.status(400).json({ error: "property id required." });
      return;
    }
    const body = isPlainRecord(req.body) ? req.body : {};
    const status = parseStatus(body.status);
    if (status == null) {
      res.status(400).json({ error: "Valid v2 status is required." });
      return;
    }
    const rejection = status === "rejected" ? extractRejectionReason(body) : null;
    if (status === "rejected" && rejection == null) {
      res.status(400).json({
        error: "Rejection reason required.",
        reasonCodes: [...REJECTION_REASON_CODES],
      });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }
    const existing = readPipelineState(property.details);
    const now = new Date().toISOString();
    const actorName = stringOrNull(body.actorName) ?? "ui-v2";
    const patch: Partial<PipelineDetailsState> = {
      status: legacyStatusFromUiV2Status(status),
      uiV2Status: status,
      lastActivityAt: now,
    };
    if (status === "rejected" && rejection != null) {
      patch.previousStatus = existing.status === "rejected_removed" ? existing.previousStatus : existing.status;
      patch.previousUiV2Status = existing.uiV2Status === "rejected" ? existing.previousUiV2Status : existing.uiV2Status;
      patch.rejectedAt = now;
      patch.rejectionReason = formatRejectionReason(rejection);
      patch.rejection = { ...rejection, rejectedAt: now };
      patch.tags = uniqueStrings([...existing.tags, "rejected"]);
      await new PropertyRejectionRepo({ pool }).reject({
        propertyId,
        reasonCode: rejection.reasonCode,
        reasonLabel: REJECTION_REASON_LABELS[rejection.reasonCode],
        note: rejection.note ?? null,
        actor: actorName,
        source: "ui-v2",
        metadata: { previousStatus: existing.uiV2Status ?? mapLegacyStatus(existing.status) },
      });
    } else {
      patch.rejectedAt = null;
      patch.rejectionReason = null;
      patch.rejection = undefined;
      patch.tags = existing.tags.filter((tag) => normalizeTag(tag) !== "rejected");
      if (existing.uiV2Status === "rejected" || existing.status === "rejected_removed" || existing.rejectedAt) {
        await new PropertyRejectionRepo({ pool }).restoreActive(propertyId, {
          actor: actorName,
          restoredReason: "status_changed",
        });
      }
    }
    await updatePipelineState(pool, propertyId, patch);
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: status === "rejected" ? "rejected" : "status_changed",
      actor: actorName,
      source: "ui-v2",
      title: status === "rejected" ? "Property rejected" : eventTitleForStatus(status),
      body: status === "rejected" && rejection != null ? formatRejectionReason(rejection) : null,
      metadata: {
        status,
        previousStatus: existing.uiV2Status ?? mapLegacyStatus(existing.status),
        ...(rejection ? { rejection } : {}),
      },
    });
    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 status]", err);
    res.status(503).json({ error: "Failed to update property status.", details: message });
  }
}

router.get("/ui-v2/pipeline", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const userId = await getDefaultUserId(pool);
    const query = parsePipelineQuery(req);
    const rows = await fetchPipelineRows(pool, userId);
    const pipeline = buildPipelinePayload(rows, query, userId);
    res.json({ pipeline } satisfies { pipeline: UiV2PipelineListPayload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 list]", err);
    res.status(503).json({ error: "Failed to load v2 pipeline.", details: message });
  }
});

router.get("/ui-v2/properties/:id", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const userId = await getDefaultUserId(pool);
    const property = await loadDetailForProperty(pool, userId, req.params.id);
    if (!property) {
      res.status(404).json({ property: null, error: "Property not found." });
      return;
    }
    res.json({ property } satisfies { property: UiV2PropertyDetailPayload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 detail]", err);
    res.status(503).json({ error: "Failed to load v2 property detail.", details: message });
  }
});

router.post("/ui-v2/properties/:id/merge-into", async (req: Request, res: Response) => {
  const sourcePropertyId = req.params.id;
  const body = isPlainRecord(req.body) ? req.body : {};
  const targetPropertyId = stringOrNull(body.targetPropertyId);
  if (!sourcePropertyId || !targetPropertyId) {
    res.status(400).json({ error: "source property id and targetPropertyId are required." });
    return;
  }
  if (sourcePropertyId === targetPropertyId) {
    res.status(400).json({ error: "Cannot merge a property into itself." });
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  const actorName = stringOrNull(body.actorName) ?? "ui-v2";
  const now = new Date().toISOString();
  try {
    await client.query("BEGIN");
    const propertyRepo = new PropertyRepo({ pool, client });
    const source = await propertyRepo.byId(sourcePropertyId);
    const target = await propertyRepo.byId(targetPropertyId);
    if (!source || !target) {
      await client.query("ROLLBACK");
      res.status(404).json({
        error: !source ? "Source property not found." : "Target property not found.",
        sourcePropertyId,
        targetPropertyId,
      });
      return;
    }

    const mergedTargetDetails = mergePropertyDetailsForTarget({ source, target, actorName, now });
    const archivedSourceDetails = mergePropertyDetailsForArchivedSource({ source, target, actorName, now });
    await client.query(
      `UPDATE properties
       SET details = $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [targetPropertyId, JSON.stringify(mergedTargetDetails)]
    );
    const reassignedRows = await reassignPropertyReferences(client, sourcePropertyId, targetPropertyId);
    await client.query(
      `UPDATE properties
       SET details = $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [sourcePropertyId, JSON.stringify(archivedSourceDetails)]
    );

    const eventRepo = new PropertyPipelineEventRepo({ pool, client });
    await eventRepo.create({
      propertyId: targetPropertyId,
      eventType: "property_merged",
      actor: actorName,
      source: "ui-v2",
      title: "Property merged",
      body: `Merged ${source.canonicalAddress} into this source property.`,
      metadata: {
        sourcePropertyId,
        sourceCanonicalAddress: source.canonicalAddress,
        reassignedRows,
      },
    });
    await eventRepo.create({
      propertyId: sourcePropertyId,
      eventType: "property_merged_into_source",
      actor: actorName,
      source: "ui-v2",
      title: "Property merged into source",
      body: `Merged into ${target.canonicalAddress}.`,
      metadata: {
        targetPropertyId,
        targetCanonicalAddress: target.canonicalAddress,
        reassignedRows,
      },
    });
    await client.query("COMMIT");

    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, targetPropertyId);
    res.json({
      property: detail,
      merged: {
        sourcePropertyId,
        targetPropertyId,
        reassignedRows,
      },
    } satisfies {
      property: UiV2PropertyDetailPayload | null;
      merged: { sourcePropertyId: string; targetPropertyId: string; reassignedRows: Record<string, number> };
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 merge]", err);
    res.status(503).json({ error: "Failed to merge properties.", details: message });
  } finally {
    client.release();
  }
});

router.patch("/ui-v2/properties/:id/status", handleStatusUpdate);
router.post("/ui-v2/properties/:id/status", handleStatusUpdate);

function dealPathStatusForPipeline(status: UiV2DealPathStatus): UiV2PipelineStatus | null {
  if (status === "offer_candidate") return "offer_review";
  if (status === "need_more_info") return "tour_completed_awaiting_inputs";
  return DEAL_PATH_DERIVED_PIPELINE_STATUSES.has(status as UiV2PipelineStatus)
    ? (status as UiV2PipelineStatus)
    : null;
}

async function handleDealPathUpdate(req: Request, res: Response): Promise<void> {
  try {
    const propertyId = req.params.id;
    if (!propertyId) {
      res.status(400).json({ error: "property id required." });
      return;
    }
    const body = isPlainRecord(req.body) ? req.body : {};
    const input = isPlainRecord(body.dealPath) ? body.dealPath : body;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }

    const existing = readPipelineState(property.details);
    const now = new Date().toISOString();
    const actorName = stringOrNull(body.actorName) ?? "ui-v2";
    const nextDealPath = normalizeDealPathState({
      ...(existing.dealPath ?? {}),
      ...input,
      updatedAt: now,
    }) ?? {
      status: "not_scheduled",
      statusLabel: dealPathStatusLabel("not_scheduled"),
      loiContingencies: [],
      updatedAt: now,
    };

    if (nextDealPath.postTourDecision === "reject" && !nextDealPath.rejectionReasonCode) {
      res.status(400).json({
        error: "Rejection reason required for post-tour rejection.",
        reasonCodes: [...REJECTION_REASON_CODES],
      });
      return;
    }

    const currentPipelineStatus = existing.uiV2Status ?? mapLegacyStatus(existing.status);
    const derivedPipelineStatus = dealPathStatusForPipeline(nextDealPath.status);
    const patch: Partial<PipelineDetailsState> = {
      dealPath: nextDealPath,
      lastActivityAt: now,
    };
    if (!DEAL_PATH_OVERRIDE_BLOCKING_STATUSES.has(currentPipelineStatus)) {
      if (derivedPipelineStatus) {
        patch.status = "underwriting";
        patch.uiV2Status = derivedPipelineStatus;
      } else if (DEAL_PATH_DERIVED_PIPELINE_STATUSES.has(currentPipelineStatus)) {
        patch.status = "underwriting";
        patch.uiV2Status = "underwriting";
      }
    }

    const dealPathSystemTags = new Set(["tour_scheduled", "tour_inputs_needed", "offer_candidate", "post_tour_info_needed"]);
    const baseTags = existing.tags.filter((tag) => {
      const normalized = normalizeTag(tag);
      return normalized == null || !dealPathSystemTags.has(normalized);
    });
    const tagsToAdd = [
      nextDealPath.status === "tour_scheduled" ? "tour_scheduled" : null,
      nextDealPath.status === "tour_completed_awaiting_inputs" ? "tour_inputs_needed" : null,
      nextDealPath.status === "offer_candidate" ? "offer_candidate" : null,
      nextDealPath.status === "need_more_info" ? "post_tour_info_needed" : null,
    ].filter((tag): tag is string => Boolean(tag));
    if (tagsToAdd.length > 0 || baseTags.length !== existing.tags.length) {
      patch.tags = uniqueStrings([...baseTags, ...tagsToAdd]);
    }

    if (nextDealPath.postTourDecision === "reject" && nextDealPath.rejectionReasonCode) {
      const rejection: UiV2RejectionReason = {
        reasonCode: nextDealPath.rejectionReasonCode,
        note: nextDealPath.rejectionNotes ?? null,
      };
      patch.status = "rejected_removed";
      patch.uiV2Status = "rejected";
      patch.previousStatus = existing.status === "rejected_removed" ? existing.previousStatus : existing.status;
      patch.previousUiV2Status = existing.uiV2Status === "rejected" ? existing.previousUiV2Status : existing.uiV2Status;
      patch.rejectedAt = now;
      patch.rejectionReason = formatRejectionReason(rejection);
      patch.rejection = { ...rejection, rejectedAt: now };
      patch.tags = uniqueStrings([...(patch.tags ?? existing.tags), "rejected", "rejected_after_tour"]);
      await new PropertyRejectionRepo({ pool }).reject({
        propertyId,
        reasonCode: rejection.reasonCode,
        reasonLabel: REJECTION_REASON_LABELS[rejection.reasonCode],
        note: rejection.note ?? null,
        actor: actorName,
        source: "deal_path",
        metadata: {
          previousStatus: existing.uiV2Status ?? mapLegacyStatus(existing.status),
          dealPath: nextDealPath,
        },
      });
    }

    await updatePipelineState(pool, propertyId, patch);
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: "deal_path_updated",
      actor: actorName,
      source: "ui-v2",
      title: "Deal path updated",
      body: nextDealPath.statusLabel,
      metadata: { dealPath: nextDealPath },
    });
    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 deal path]", err);
    res.status(503).json({ error: "Failed to update deal path.", details: message });
  }
}

router.patch("/ui-v2/properties/:id/deal-path", handleDealPathUpdate);
router.post("/ui-v2/properties/:id/deal-path", handleDealPathUpdate);

async function handleSourceFactsUpdate(req: Request, res: Response): Promise<void> {
  try {
    const propertyId = req.params.id;
    if (!propertyId) {
      res.status(400).json({ error: "property id required." });
      return;
    }
    const { patch, invalidFields } = extractManualSourceFactsPatch(req.body);
    if (invalidFields.length > 0) {
      res.status(400).json({
        error: "Some property data fields are invalid.",
        invalidFields,
      });
      return;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "At least one property data field is required." });
      return;
    }

    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }

    const now = new Date().toISOString();
    const body = isPlainRecord(req.body) ? req.body : {};
    const actorName = stringOrNull(body.actorName) ?? "ui-v2";
    const existingManual = isPlainRecord(property.details?.manualSourceFacts)
      ? property.details.manualSourceFacts
      : {};
    const nextManualSourceFacts = {
      ...existingManual,
      ...patch,
      updatedAt: now,
      updatedBy: actorName,
      source: stringOrNull(body.source) ?? "property_sheet",
    };

    await propertyRepo.mergeDetails(propertyId, { manualSourceFacts: nextManualSourceFacts });
    await updatePipelineState(pool, propertyId, { lastActivityAt: now });
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: "source_facts_updated",
      actor: actorName,
      source: "ui-v2",
      title: "Property data updated",
      metadata: {
        changedFields: Object.keys(patch),
        manualSourceFacts: patch,
      },
    });

    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 source facts]", err);
    res.status(503).json({ error: "Failed to update property data.", details: message });
  }
}

router.patch("/ui-v2/properties/:id/source-facts", handleSourceFactsUpdate);
router.post("/ui-v2/properties/:id/source-facts", handleSourceFactsUpdate);

function tagsFromBody(body: unknown): string[] {
  if (!isPlainRecord(body)) return [];
  if (Array.isArray(body.tags)) return body.tags.flatMap((tag) => {
    const normalized = normalizeTag(tag);
    return normalized ? [normalized] : [];
  });
  const singleTag = normalizeTag(body.tag);
  return singleTag ? [singleTag] : [];
}

async function handleTagsUpdate(req: Request, res: Response): Promise<void> {
  try {
    const propertyId = req.params.id;
    const tags = tagsFromBody(req.body);
    if (!propertyId || tags.length === 0) {
      res.status(400).json({ error: "property id and at least one tag required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }
    const existing = readPipelineState(property.details);
    const replaceAll = isPlainRecord(req.body) && Array.isArray(req.body.tags);
    const nextTags = replaceAll ? tags : uniqueStrings([...existing.tags, ...tags]);
    await updatePipelineState(pool, propertyId, {
      tags: nextTags,
      lastActivityAt: new Date().toISOString(),
    });
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: replaceAll ? "tags_updated" : "tag_added",
      actor: stringOrNull(isPlainRecord(req.body) ? req.body.actorName : null) ?? "ui-v2",
      source: "ui-v2",
      title: replaceAll ? "Tags updated" : "Tag added",
      body: tags.join(", "),
      metadata: { tags, previousTags: existing.tags },
    });
    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.status(201).json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 add tag]", err);
    res.status(503).json({ error: "Failed to update tags.", details: message });
  }
}

router.post("/ui-v2/properties/:id/tags", handleTagsUpdate);
router.patch("/ui-v2/properties/:id/tags", handleTagsUpdate);
router.put("/ui-v2/properties/:id/tags", handleTagsUpdate);

router.delete("/ui-v2/properties/:id/tags/:tag", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const tag = normalizeTag(req.params.tag);
    if (!propertyId || !tag) {
      res.status(400).json({ error: "property id and tag required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }
    const existing = readPipelineState(property.details);
    await updatePipelineState(pool, propertyId, {
      tags: existing.tags.filter((existingTag) => normalizeTag(existingTag) !== tag),
      lastActivityAt: new Date().toISOString(),
    });
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: "tag_removed",
      actor: stringOrNull(isPlainRecord(req.body) ? req.body.actorName : null) ?? "ui-v2",
      source: "ui-v2",
      title: "Tag removed",
      body: tag,
      metadata: { tag },
    });
    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 remove tag]", err);
    res.status(503).json({ error: "Failed to remove tag.", details: message });
  }
});

router.post("/ui-v2/properties/:id/save", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    if (!propertyId) {
      res.status(400).json({ error: "property id required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }
    const userId = await getDefaultUserId(pool);
    await new SavedDealsRepo({ pool }).save(userId, propertyId, "saved");
    const existing = readPipelineState(property.details);
    await updatePipelineState(pool, propertyId, {
      status: "saved_watchlist",
      uiV2Status: "saved",
      tags: uniqueStrings([...existing.tags, "saved"]),
      rejectedAt: null,
      rejectionReason: null,
      rejection: undefined,
      lastActivityAt: new Date().toISOString(),
    });
    await new PropertyRejectionRepo({ pool }).restoreActive(propertyId, {
      actor: stringOrNull(isPlainRecord(req.body) ? req.body.actorName : null) ?? "ui-v2",
      restoredReason: "saved_deal",
    });
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: "saved",
      actor: stringOrNull(isPlainRecord(req.body) ? req.body.actorName : null) ?? "ui-v2",
      source: "ui-v2",
      title: "Deal saved",
      metadata: { status: "saved" },
    });
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.status(201).json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 save]", err);
    res.status(503).json({ error: "Failed to save deal.", details: message });
  }
});

router.post("/ui-v2/properties/:id/reject", async (req: Request, res: Response) => {
  const existingBody = isPlainRecord(req.body) ? req.body : {};
  req.body = {
    ...existingBody,
    status: "rejected",
    rejection: isPlainRecord(existingBody.rejection) ? existingBody.rejection : existingBody,
  } as Record<string, unknown>;
  await handleStatusUpdate(req, res);
});

router.post("/ui-v2/properties/:id/restore", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    if (!propertyId) {
      res.status(400).json({ error: "property id required." });
      return;
    }
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found.", propertyId });
      return;
    }
    const existing = readPipelineState(property.details);
    const restoredUiStatus = existing.previousUiV2Status ?? "screening";
    const actorName = stringOrNull(isPlainRecord(req.body) ? req.body.actorName : null) ?? "ui-v2";
    await updatePipelineState(pool, propertyId, {
      status: existing.previousStatus ?? legacyStatusFromUiV2Status(restoredUiStatus),
      uiV2Status: restoredUiStatus,
      rejectedAt: null,
      rejectionReason: null,
      rejection: undefined,
      tags: existing.tags.filter((tag) => normalizeTag(tag) !== "rejected"),
      lastActivityAt: new Date().toISOString(),
    });
    await new PropertyRejectionRepo({ pool }).restoreActive(propertyId, {
      actor: actorName,
      restoredReason: stringOrNull(isPlainRecord(req.body) ? req.body.reason : null) ?? "restored_to_pipeline",
    });
    await new PropertyPipelineEventRepo({ pool }).create({
      propertyId,
      eventType: "restored",
      actor: actorName,
      source: "ui-v2",
      title: "Property restored",
      metadata: { status: restoredUiStatus },
    });
    const userId = await getDefaultUserId(pool);
    const detail = await loadDetailForProperty(pool, userId, propertyId);
    res.json({ property: detail } satisfies { property: UiV2PropertyDetailPayload | null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipelineV2 restore]", err);
    res.status(503).json({ error: "Failed to restore property.", details: message });
  }
});

export default router;
