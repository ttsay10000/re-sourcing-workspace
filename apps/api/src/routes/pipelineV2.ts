/**
 * UI v2 pipeline API.
 *
 * This router is intentionally isolated from the legacy properties router so it
 * can be mounted by a later integration step without disturbing existing flows.
 */

import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import {
  DocumentRepo,
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
import type {
  AgentEnrichmentEntry,
  Document,
  ListingSource,
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
  UiV2DocumentStatus,
  UiV2EnrichmentState,
  UiV2ImageAsset,
  UiV2PipelineListPayload,
  UiV2PipelineQuery,
  UiV2PipelineRow,
  UiV2PipelineSortField,
  UiV2PipelineStatus,
  UiV2PropertyDetailPayload,
  UiV2PropertyOverview,
  UiV2RejectionReason,
  UiV2RejectionReasonCode,
  UiV2StatusChip,
  UiV2StatusChipTone,
  UiV2UnderwritingSummary,
} from "@re-sourcing/contracts";
import {
  getPropertyDossierAssumptions,
  getPropertyDossierGeneration,
  getPropertyDossierSummary,
  hasCompletedDealDossier,
} from "../deal/propertyDossierState.js";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import { resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const UI_V2_STATUSES = new Set<UiV2PipelineStatus>([
  "new",
  "screening",
  "interesting",
  "saved",
  "underwriting",
  "outreach",
  "awaiting_broker",
  "om_received",
  "dossier_generated",
  "offer_review",
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
  [key: string]: unknown;
}

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
}

interface DetailCollections {
  actionItems: PropertyActionItem[];
  uploadedDocs: PropertyUploadedDocument[];
  inquiryDocs: PropertyInquiryDocument[];
  generatedDocs: Document[];
  omRuns: OmIngestionRun[];
  pipelineEvents: PropertyPipelineEvent[];
}

interface ParsedPipelineQuery {
  q?: string;
  statuses: UiV2PipelineStatus[];
  sources: string[];
  tags: string[];
  neighborhoods: string[];
  boroughs: string[];
  hasOm?: boolean;
  hasBrokerContact?: boolean;
  includeRejected: boolean;
  minDealScore?: number;
  maxDealScore?: number;
  minAskingPrice?: number;
  maxAskingPrice?: number;
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function parsePipelineQuery(req: Request): ParsedPipelineQuery {
  const sortByRaw = firstQueryValue(req.query.sort) ?? firstQueryValue(req.query.sortBy) ?? "updatedAt";
  const sortBy = (
    [
      "updatedAt",
      "createdAt",
      "canonicalAddress",
      "askingPrice",
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
    neighborhoods: listQueryValues(req.query.neighborhood).map((value) => value.toLowerCase()),
    boroughs: listQueryValues(req.query.borough).map((value) => value.toLowerCase()),
    hasOm: parseBooleanQuery(req.query.hasOm),
    hasBrokerContact: parseBooleanQuery(req.query.hasBrokerContact),
    includeRejected: parseBooleanQuery(req.query.includeRejected) === true,
    minDealScore: parseNumberQuery(req.query.minDealScore ?? req.query.min),
    maxDealScore: parseNumberQuery(req.query.maxDealScore ?? req.query.max),
    minAskingPrice: parseNumberQuery(req.query.minAskingPrice),
    maxAskingPrice: parseNumberQuery(req.query.maxAskingPrice),
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
    ...(query.hasOm != null ? { hasOm: query.hasOm } : {}),
    ...(query.hasBrokerContact != null ? { hasBrokerContact: query.hasBrokerContact } : {}),
    includeRejected: query.includeRejected,
    ...(query.minDealScore != null ? { minDealScore: query.minDealScore } : {}),
    ...(query.maxDealScore != null ? { maxDealScore: query.maxDealScore } : {}),
    ...(query.minAskingPrice != null ? { minAskingPrice: query.minAskingPrice } : {}),
    ...(query.maxAskingPrice != null ? { maxAskingPrice: query.maxAskingPrice } : {}),
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
    saved_watchlist: "saved",
    loi_sent: "offer_review",
    negotiation: "offer_review",
    contract_signed: "offer_review",
    diligence_escrow: "offer_review",
    closed: "archived",
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
    outreach: "om_requested",
    awaiting_broker: "follow_up_needed",
    om_received: "om_received",
    dossier_generated: "underwriting",
    offer_review: "loi_sent",
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
    outreach: "Outreach",
    awaiting_broker: "Awaiting Broker",
    om_received: "OM Received",
    dossier_generated: "Dossier Generated",
    offer_review: "Offer Review",
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
    outreach: "info",
    awaiting_broker: "warning",
    om_received: "success",
    dossier_generated: "success",
    offer_review: "warning",
    rejected: "danger",
    archived: "neutral",
  };
  return tones[status];
}

function deriveUiV2Status(row: PipelineBaseRow): UiV2PipelineStatus {
  const details = row.details;
  const pipeline = readPipelineState(details);
  if (pipeline.status === "rejected_removed" || pipeline.rejectedAt != null) return "rejected";
  if (pipeline.uiV2Status != null) return pipeline.uiV2Status;
  if (row.saved_deal_status === "saved") return "saved";
  if (hasCompletedDealDossier(details)) return "dossier_generated";
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

function neighborhoodName(details: PropertyDetails | null | undefined): string | null {
  const primary = details?.neighborhood?.primary;
  return primary?.name ?? null;
}

function boroughName(details: PropertyDetails | null | undefined): string | null {
  const primary = details?.neighborhood?.primary;
  return primary?.borough ?? null;
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

function getAskingPrice(row: PipelineBaseRow): number | null {
  const details = row.details;
  const assumptions = getPropertyDossierAssumptions(details);
  const summary = getPropertyDossierSummary(details);
  return (
    summary?.askingPrice ??
    assumptions?.purchasePrice ??
    toFiniteNumber(row.listing_price) ??
    readNumericPath(details, ["askingPrice"]) ??
    readNumericPath(details, ["purchasePrice"]) ??
    readNumericPath(details, ["omData", "authoritative", "propertyInfo", "askingPrice"])
  );
}

function getUnitCount(row: PipelineBaseRow): number | null {
  const details = row.details;
  const rentalUnits = isPlainRecord(details?.rentalFinancials) && Array.isArray(details.rentalFinancials.rentalUnits)
    ? details.rentalFinancials.rentalUnits.length
    : null;
  return (
    resolvePreferredOmUnitCount(details) ??
    readNumericPath(details, ["unitCount"]) ??
    readNumericPath(row.listing_extra, ["units"]) ??
    rentalUnits
  );
}

function getBuildingSqft(row: PipelineBaseRow): number | null {
  return (
    readNumericPath(row.details, ["buildingSqft"]) ??
    readNumericPath(row.details, ["assessedGrossSqft"]) ??
    readNumericPath(row.details, ["assessedResidentialAreaGross"]) ??
    readNumericPath(row.details, ["dealDossier", "assumptions", "buildingSqft"]) ??
    readNumericPath(row.details, ["omData", "authoritative", "propertyInfo", "buildingSqft"]) ??
    toFiniteNumber(row.listing_sqft)
  );
}

function getYearBuilt(row: PipelineBaseRow): number | null {
  return (
    readNumericPath(row.details, ["yearBuilt"]) ??
    readNumericPath(row.details, ["omData", "authoritative", "propertyInfo", "yearBuilt"]) ??
    readNumericPath(row.listing_extra, ["yearBuilt"])
  );
}

function getLotSqft(row: PipelineBaseRow): number | null {
  return (
    readNumericPath(row.details, ["lotSqft"]) ??
    readNumericPath(row.details, ["assessedLandArea"]) ??
    readNumericPath(row.listing_extra, ["lotSizeSqft"])
  );
}

function looksLikeOmStyleFilename(filename: string | null | undefined): boolean {
  if (!filename || typeof filename !== "string") return false;
  return /(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll)/i.test(filename);
}

function hasAuthoritativeOm(details: PropertyDetails | null | undefined): boolean {
  return isPlainRecord(details?.omData) && isPlainRecord(details.omData.authoritative);
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

function normalizeOmStatus(value: unknown, hasOmDocument: boolean): UiV2DocumentStatus["omStatus"] {
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
  return {
    hasOm: hasOmDocument,
    omStatus: normalizeOmStatus(row.latest_om_status ?? pipeline.omStatus, hasOmDocument),
    latestOmRunId: row.latest_om_run_id,
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

function getCalculatedDealScore(row: PipelineBaseRow): number | null {
  const summary = getPropertyDossierSummary(row.details);
  const calculated = summary?.calculatedDealScore ?? summary?.dealScore ?? toFiniteNumber(row.latest_signal_deal_score);
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

function buildUnderwriting(row: PipelineBaseRow): UiV2UnderwritingSummary | null {
  const details = row.details;
  const summary = getPropertyDossierSummary(details);
  const assumptions = getPropertyDossierAssumptions(details);
  const generation = getPropertyDossierGeneration(details);
  const hasAnyUnderwriting =
    summary != null ||
    assumptions != null ||
    generation != null ||
    row.latest_signal_deal_score != null ||
    row.override_score != null;
  if (!hasAnyUnderwriting) return null;
  return {
    generationStatus: generation?.status ?? null,
    dealScore: getCalculatedDealScore(row),
    askingPrice: summary?.askingPrice ?? assumptions?.purchasePrice ?? getAskingPrice(row),
    recommendedOfferLow: summary?.recommendedOfferLow ?? null,
    recommendedOfferHigh: summary?.recommendedOfferHigh ?? null,
    targetIrrPct: summary?.targetIrrPct ?? assumptions?.targetIrrPct ?? null,
    irrPct: summary?.irrPct ?? toFiniteNumber(row.latest_signal_irr_pct),
    cocPct: summary?.cocPct ?? toFiniteNumber(row.latest_signal_coc_pct),
    currentNoi: summary?.currentNoi ?? toFiniteNumber(row.latest_signal_current_noi),
    adjustedNoi: summary?.adjustedNoi ?? toFiniteNumber(row.latest_signal_adjusted_noi),
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

function buildOverview(row: PipelineBaseRow): UiV2PropertyOverview {
  const addressParts = splitAddress(row.canonical_address);
  return {
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    displayAddress: addressParts.displayAddress,
    neighborhood: neighborhoodName(row.details),
    borough: boroughName(row.details),
    city: row.listing_city ?? addressParts.city,
    state: row.listing_state ?? addressParts.state,
    zip: row.listing_zip ?? addressParts.zip,
    source: row.listing_source ?? readPipelineState(row.details).source,
    listingUrl: row.listing_url ?? readStringPath(row.details, ["manualSourceLinks", "streetEasyUrl"]),
    askingPrice: getAskingPrice(row),
    units: getUnitCount(row),
    beds: toFiniteNumber(row.listing_beds),
    baths: toFiniteNumber(row.listing_baths),
    buildingSqft: getBuildingSqft(row),
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

function buildPipelineRow(row: PipelineBaseRow): UiV2PipelineRow {
  const overview = buildOverview(row);
  const gallery = buildGallery(row);
  const pipeline = readPipelineState(row.details);
  return {
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    displayAddress: overview.displayAddress,
    source: overview.source,
    statusChip: buildStatusChip(row),
    tags: pipeline.tags,
    askingPrice: overview.askingPrice,
    units: overview.units,
    buildingSqft: overview.buildingSqft,
    neighborhood: overview.neighborhood,
    borough: overview.borough,
    thumbnailUrl: gallery[0]?.thumbnailUrl ?? null,
    broker: buildBroker(row),
    documentStatus: buildDocumentStatus(row),
    enrichmentState: buildEnrichmentState(row),
    underwriting: buildUnderwriting(row),
    openActionItemCount: Number(row.open_action_item_count ?? 0),
    lastActivityAt: pipeline.lastActivityAt ?? optionalIso(row.property_updated_at),
    createdAt: toIso(row.property_created_at),
    updatedAt: toIso(row.property_updated_at),
  };
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

function buildPropertyDetail(row: PipelineBaseRow, collections: DetailCollections, userId: string): UiV2PropertyDetailPayload {
  return {
    overview: buildOverview(row),
    statusChip: buildStatusChip(row),
    gallery: buildGallery(row),
    broker: buildBroker(row),
    tags: readPipelineState(row.details).tags,
    documentStatus: buildDocumentStatus(row, collections),
    enrichmentState: buildEnrichmentState(row),
    underwriting: buildUnderwriting(row),
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
       sd.created_at AS saved_deal_created_at
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
  const [actionItems, uploadedDocs, inquiryDocs, generatedDocs, omRuns, pipelineEvents] = await Promise.all([
    new PropertyActionItemRepo({ pool }).listOpenByPropertyId(propertyId).catch(() => []),
    new PropertyUploadedDocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new InquiryDocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new DocumentRepo({ pool }).listByPropertyId(propertyId).catch(() => []),
    new OmIngestionRunRepo({ pool }).listByPropertyId(propertyId, 20).catch(() => []),
    new PropertyPipelineEventRepo({ pool }).listByPropertyId(propertyId, { limit: 50 }).catch(() => []),
  ]);
  return { actionItems, uploadedDocs, inquiryDocs, generatedDocs, omRuns, pipelineEvents };
}

function filterRows(rows: UiV2PipelineRow[], query: ParsedPipelineQuery): UiV2PipelineRow[] {
  const q = query.q?.toLowerCase();
  const updatedSinceMs = query.updatedSince ? Date.parse(query.updatedSince) : Number.NaN;
  return rows.filter((row) => {
    const rowStatus = row.statusChip.status as UiV2PipelineStatus;
    if (!query.includeRejected && rowStatus === "rejected" && !query.statuses.includes("rejected")) return false;
    if (q) {
      const haystack = [
        row.canonicalAddress,
        row.displayAddress,
        row.source,
        row.statusChip.label,
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
    if (query.neighborhoods.length > 0 && !query.neighborhoods.includes(String(row.neighborhood ?? "").toLowerCase())) return false;
    if (query.boroughs.length > 0 && !query.boroughs.includes(String(row.borough ?? "").toLowerCase())) return false;
    if (query.hasOm != null && Boolean(row.documentStatus?.hasOm) !== query.hasOm) return false;
    if (query.hasBrokerContact != null && Boolean(row.broker?.email) !== query.hasBrokerContact) return false;
    const score = row.underwriting?.dealScore ?? null;
    if (query.minDealScore != null && (score == null || score < query.minDealScore)) return false;
    if (query.maxDealScore != null && (score == null || score > query.maxDealScore)) return false;
    if (query.minAskingPrice != null && (row.askingPrice == null || row.askingPrice < query.minAskingPrice)) return false;
    if (query.maxAskingPrice != null && (row.askingPrice == null || row.askingPrice > query.maxAskingPrice)) return false;
    if (Number.isFinite(updatedSinceMs) && Date.parse(row.updatedAt) < updatedSinceMs) return false;
    return true;
  });
}

function sortValue(row: UiV2PipelineRow, sortBy: UiV2PipelineSortField): string | number | null {
  switch (sortBy) {
    case "createdAt":
      return Date.parse(row.createdAt);
    case "canonicalAddress":
      return row.canonicalAddress.toLowerCase();
    case "askingPrice":
      return row.askingPrice ?? null;
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

function buildPipelinePayload(baseRows: PipelineBaseRow[], query: ParsedPipelineQuery): UiV2PipelineListPayload {
  const mappedRows = baseRows.map(buildPipelineRow);
  const filtered = filterRows(mappedRows, query);
  const sorted = sortRows(filtered, query);
  return {
    rows: sorted.slice(query.offset, query.offset + query.limit),
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
    const pipeline = buildPipelinePayload(rows, query);
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

router.patch("/ui-v2/properties/:id/status", handleStatusUpdate);
router.post("/ui-v2/properties/:id/status", handleStatusUpdate);

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
