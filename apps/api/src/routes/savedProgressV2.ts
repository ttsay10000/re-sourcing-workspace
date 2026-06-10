/**
 * UI v2 saved deals and deal progress API.
 *
 * This router is intentionally isolated from the legacy profile/deals routes so
 * a later integration step can mount it without changing existing workflows.
 */

import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import { DEAL_FLOW_STAGES } from "@re-sourcing/contracts";
import type {
  DealFlowRecommendationsResponse,
  DealStatus,
  PropertyDetails,
  SavedDeal,
  UiV2DealProgressSummaryResponse,
  UiV2DealPathState,
  UiV2PipelineStatus,
  UiV2SavedDealsListResponse,
} from "@re-sourcing/contracts";
import { getPool, UserProfileRepo } from "@re-sourcing/db";
import { resolveEffectiveDealScore } from "../deal/effectiveDealScore.js";
import {
  buildProgressRecommendations,
  type RecommendationInputRow,
} from "../deal/progressRecommendations.js";
import { resolveOmAskingPriceFromDetails } from "../deal/omAskingPrice.js";
import {
  getPropertyDossierAssumptions,
  getPropertyDossierSummary,
  hasCompletedDealDossier,
} from "../deal/propertyDossierState.js";
import { resolvePreferredOmUnitCount } from "../om/authoritativeOm.js";
import { resolveReconstructedNoiBasisFromDetails } from "../deal/reconstructedNoiBasis.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const PROGRESS_SECTION_LIMIT = 250;

const DEAL_STATUSES = new Set<DealStatus>(["new", "interesting", "saved", "dossier_generated", "rejected"]);
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
const DEAL_PATH_PIPELINE_STATUSES = new Set<UiV2PipelineStatus>([
  "tour_scheduled",
  "tour_completed_awaiting_inputs",
]);
const DEAL_PATH_BLOCKING_STATUSES = new Set<UiV2PipelineStatus>([
  "offer_review",
  "negotiation",
  "contract_signed",
  "deal_closed",
  "rejected",
  "archived",
]);

type JsonRecord = Record<string, unknown>;

interface SavedProgressBaseRow {
  saved_deal_id: string | null;
  saved_user_id: string | null;
  saved_deal_status: DealStatus | string | null;
  saved_deal_created_at: Date | string | null;
  property_id: string;
  canonical_address: string;
  details: JsonRecord | null;
  property_created_at: Date | string;
  property_updated_at: Date | string;
  listing_id: string | null;
  listing_source: string | null;
  listing_price: number | string | null;
  listing_beds: number | string | null;
  listing_baths: number | string | null;
  listing_sqft: number | string | null;
  listing_url: string | null;
  listing_title: string | null;
  listing_description: string | null;
  listing_image_urls: string[] | null;
  listing_extra: JsonRecord | null;
  latest_signal_deal_score: number | string | null;
  latest_signal_asset_cap_rate: number | string | null;
  latest_signal_adjusted_cap_rate: number | string | null;
  latest_signal_current_noi: number | string | null;
  latest_signal_adjusted_noi: number | string | null;
  latest_signal_rent_upside: number | string | null;
  latest_signal_irr_pct: number | string | null;
  latest_signal_coc_pct: number | string | null;
  latest_signal_generated_at: Date | string | null;
  override_score: number | string | null;
  latest_om_status: string | null;
  latest_om_completed_at: Date | string | null;
  uploaded_doc_count: number | string | null;
  uploaded_categories: string[] | null;
  inquiry_doc_count: number | string | null;
  inquiry_filenames: string[] | null;
  generated_doc_count: number | string | null;
  broker_comp_package_count: number | string | null;
  open_action_item_count: number | string | null;
  latest_inquiry_sent_at: Date | string | null;
  manual_broker_name: string | null;
  manual_broker_email: string | null;
  recipient_contact_email: string | null;
  broker_display_name: string | null;
  stage_entered_at: Date | string | null;
  rejection_reason_code?: string | null;
  rejection_reason_label?: string | null;
  rejection_note?: string | null;
  rejected_at?: Date | string | null;
}

interface SavedDealV2Row {
  savedDeal: SavedDeal;
  propertyId: string;
  canonicalAddress: string;
  displayAddress: string;
  source: string | null;
  price: number | null;
  units: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerUnit: number | null;
  pricePerSqft: number | null;
  capRate: number | null;
  rentUpside: number | null;
  irrPct: number | null;
  cocPct: number | null;
  dealScore: number | null;
  ltrYocPct: number | null;
  mtrYocPct: number | null;
  hasOm: boolean;
  hasComps: boolean;
  hasDossier: boolean;
  status: UiV2PipelineStatus;
  tags: string[];
  neighborhood: string | null;
  borough: string | null;
  firstImageUrl: string | null;
  listingUrl: string | null;
  omStatus: string;
  documentCount: number;
  openActionItemCount: number;
  latestOutreachAt: string | null;
  rejection: {
    reasonCode: string;
    reasonLabel: string | null;
    note: string | null;
    rejectedAt: string | null;
  } | null;
  updatedAt: string;
}

interface ProgressPropertyRow {
  propertyId: string;
  canonicalAddress: string;
  displayAddress: string;
  source: string | null;
  price: number | null;
  units: number | null;
  sqft: number | null;
  pricePerSqft: number | null;
  dealScore: number | null;
  ltrYocPct: number | null;
  mtrYocPct: number | null;
  status: UiV2PipelineStatus;
  savedDealStatus: string | null;
  tags: string[];
  omStatus: string;
  hasOm: boolean;
  hasComps: boolean;
  hasDossier: boolean;
  underwritingReviewStatus: string | null;
  underwritingReviewRequired: boolean;
  underwritingReviewCompleted: boolean;
  dealPath: UiV2DealPathState | null;
  openActionItemCount: number;
  neighborhood: string | null;
  borough: string | null;
  firstImageUrl: string | null;
  brokerName: string | null;
  brokerEmail: string | null;
  stageEnteredAt: string | null;
  latestOutreachAt: string | null;
  updatedAt: string;
}

interface ProgressSection {
  id:
    | "sourced"
    | "om_requested"
    | "underwriting_awaiting_review"
    | "underwriting_review_completed"
    | "tour_requested"
    | "tour_scheduled"
    | "tour_completed_awaiting_inputs"
    | "offer_review"
    | "negotiation"
    | "contract_signed"
    | "deal_closed";
  label: string;
  count: number;
  rows: ProgressPropertyRow[];
}

type SavedDealsV2Response = UiV2SavedDealsListResponse & {
  savedDeals: UiV2SavedDealsListResponse["savedDeals"] & {
    rows: SavedDealV2Row[];
  };
};

type DealProgressV2Response = UiV2DealProgressSummaryResponse & {
  sections: ProgressSection[];
  rejectionReasons?: Array<{ reasonCode: string; count: number }>;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toIso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function toIsoOrNull(value: unknown): string | null {
  const iso = toIso(value);
  return iso.length > 0 ? iso : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function toInteger(value: unknown): number {
  const parsed = toNumber(value);
  return parsed == null ? 0 : Math.trunc(parsed);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumericPath(root: unknown, path: string[]): number | null {
  let current: unknown = root;
  for (const key of path) {
    if (!isJsonRecord(current)) return null;
    current = current[key];
  }
  return toNumber(current);
}

function readStringPath(root: unknown, path: string[]): string | null {
  let current: unknown = root;
  for (const key of path) {
    if (!isJsonRecord(current)) return null;
    current = current[key];
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

function clampLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function parseOffset(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function parseStatusFilter(value: unknown): DealStatus[] {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return rawValues
    .map((entry) => String(entry).trim())
    .filter((entry): entry is DealStatus => DEAL_STATUSES.has(entry as DealStatus));
}

function readPipeline(details: JsonRecord | null): JsonRecord {
  return isJsonRecord(details?.pipeline) ? details.pipeline : {};
}

function deriveDealPathPipelineStatus(pipeline: JsonRecord, currentStatus: UiV2PipelineStatus | null): UiV2PipelineStatus | null {
  if (currentStatus != null && DEAL_PATH_BLOCKING_STATUSES.has(currentStatus)) return null;
  const dealPath = isJsonRecord(pipeline.dealPath) ? pipeline.dealPath : null;
  if (dealPath == null) return null;
  const postTourDecision = stringOrNull(dealPath.postTourDecision);
  if (postTourDecision === "reject") return null;
  if (postTourDecision === "move_forward") return "offer_review";
  if (postTourDecision === "need_more_info") return "tour_completed_awaiting_inputs";
  const rawStatus = stringOrNull(dealPath.status);
  const tourCompletedAt = stringOrNull(dealPath.tourCompletedAt);
  const tourScheduledAt = stringOrNull(dealPath.tourScheduledAt);
  if (tourCompletedAt || rawStatus === "tour_completed_awaiting_inputs") return "tour_completed_awaiting_inputs";
  if (tourScheduledAt) {
    const scheduledMs = Date.parse(tourScheduledAt);
    return Number.isFinite(scheduledMs) && scheduledMs <= Date.now()
      ? "tour_completed_awaiting_inputs"
      : "tour_scheduled";
  }
  return rawStatus != null && DEAL_PATH_PIPELINE_STATUSES.has(rawStatus as UiV2PipelineStatus)
    ? (rawStatus as UiV2PipelineStatus)
    : null;
}

function readTags(details: JsonRecord | null): string[] {
  const pipeline = readPipeline(details);
  const source = Array.isArray(pipeline.tags) ? pipeline.tags : Array.isArray(details?.tags) ? details.tags : [];
  return Array.from(new Set(source.map((tag) => String(tag).trim()).filter(Boolean)));
}

function readLocation(details: JsonRecord | null, listingExtra: JsonRecord | null): { neighborhood: string | null; borough: string | null } {
  const overview = isJsonRecord(details?.propertyOverview) ? details.propertyOverview : {};
  const location = isJsonRecord(details?.location) ? details.location : {};
  const primaryNeighborhood = isJsonRecord(details?.neighborhood) && isJsonRecord(details.neighborhood.primary)
    ? details.neighborhood.primary
    : {};
  return {
    neighborhood:
      stringOrNull(overview.neighborhood)
      ?? stringOrNull(location.neighborhood)
      ?? stringOrNull(primaryNeighborhood.name)
      ?? readFirstStringPath(listingExtra, [["neighborhood"], ["neighborhoodName"], ["neighborhood_name"], ["area"], ["area_name"]])
      ?? stringOrNull(details?.neighborhood),
    borough:
      stringOrNull(overview.borough)
      ?? stringOrNull(location.borough)
      ?? stringOrNull(primaryNeighborhood.borough)
      ?? readFirstStringPath(listingExtra, [["borough"], ["boroughName"], ["county"]])
      ?? stringOrNull(details?.borough),
  };
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

function resolveSavedUnits(row: SavedProgressBaseRow): number | null {
  return (
    resolvePreferredOmUnitCount(row.details as never) ??
    readFirstPositiveNumericPath(row.details, [
      ["unitCount"],
      ["units"],
      ["numberOfUnits"],
      ["totalUnits"],
      ["building", "units"],
      ["property", "units"],
      ["rentalFinancials", "fromLlm", "unitCount"],
      ["rentalFinancials", "fromLlm", "units"],
      ["omData", "authoritative", "propertyInfo", "unitCount"],
      ["omData", "authoritative", "propertyInfo", "units"],
      ["omData", "authoritative", "propertyInfo", "numberOfUnits"],
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
    ]) ??
    inferUnitCountFromText(row.listing_description, row.listing_title, row.listing_extra?.description, row.listing_extra?.propertyType)
  );
}

function resolveSavedSqft(row: SavedProgressBaseRow): number | null {
  return (
    readFirstPositiveNumericPath(row.details, [
      ["buildingSqft"],
      ["buildingSqftTotal"],
      ["squareFeet"],
      ["square_feet"],
      ["sqft"],
      ["grossSqft"],
      ["gross_square_feet"],
      ["assessedGrossSqft"],
      ["assessedResidentialAreaGross"],
      ["building", "sqft"],
      ["building", "squareFeet"],
      ["building", "square_feet"],
      ["building", "grossSqft"],
      ["property", "sqft"],
      ["property", "squareFeet"],
      ["omData", "authoritative", "propertyInfo", "buildingSqft"],
      ["omData", "authoritative", "propertyInfo", "squareFeet"],
      ["omData", "authoritative", "propertyInfo", "sqft"],
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
    ])
  );
}

function resolveSavedBeds(row: SavedProgressBaseRow): number | null {
  return toNumber(row.listing_beds) ?? readFirstNumericPath(row.listing_extra, [["beds"], ["bedrooms"], ["bedroom_count"]]);
}

function resolveSavedBaths(row: SavedProgressBaseRow): number | null {
  return toNumber(row.listing_baths) ?? readFirstNumericPath(row.listing_extra, [["baths"], ["bathrooms"], ["bathroom_count"]]);
}

function readFirstImageUrl(row: SavedProgressBaseRow): string | null {
  if (Array.isArray(row.listing_image_urls)) {
    const image = row.listing_image_urls.find((url) => typeof url === "string" && url.trim().length > 0);
    if (image) return image.trim();
  }
  const images = isJsonRecord(row.listing_extra) && Array.isArray(row.listing_extra.images) ? row.listing_extra.images : [];
  const image = images.find((url) => typeof url === "string" && url.trim().length > 0);
  return typeof image === "string" ? image.trim() : null;
}

function mapLegacyStatus(status: string | null): UiV2PipelineStatus {
  const direct = status != null && UI_V2_STATUSES.has(status as UiV2PipelineStatus) ? (status as UiV2PipelineStatus) : null;
  if (direct != null) return direct;
  switch (status) {
    case "enrichment_running":
    case "enrichment_complete":
      return "screening";
    case "needs_om":
    case "om_requested":
      return "outreach";
    case "follow_up_needed":
      return "awaiting_broker";
    case "om_received":
      return "om_received";
    case "underwriting":
      return "underwriting";
    case "saved_watchlist":
      return "saved";
    case "loi_sent":
      return "offer_review";
    case "negotiation":
      return "negotiation";
    case "contract_signed":
    case "diligence_escrow":
      return "contract_signed";
    case "closed":
      return "deal_closed";
    case "rejected_removed":
      return "rejected";
    default:
      return "new";
  }
}

function deriveStatus(row: SavedProgressBaseRow): UiV2PipelineStatus {
  const details = row.details;
  const pipeline = readPipeline(details);
  if (row.rejected_at != null || stringOrNull(pipeline.rejectedAt) != null || pipeline.status === "rejected_removed") {
    return "rejected";
  }
  const uiStatus = stringOrNull(pipeline.uiV2Status);
  const currentStatus = uiStatus != null && UI_V2_STATUSES.has(uiStatus as UiV2PipelineStatus)
    ? (uiStatus as UiV2PipelineStatus)
    : null;
  const dealPathStatus = deriveDealPathPipelineStatus(pipeline, currentStatus);
  if (dealPathStatus != null) return dealPathStatus;
  if (currentStatus != null) return currentStatus;
  if (row.saved_deal_status === "dossier_generated") return "dossier_generated";
  if (row.saved_deal_status === "rejected") return "rejected";
  if (row.saved_deal_status === "saved") return "saved";
  return mapLegacyStatus(stringOrNull(pipeline.status));
}

function deriveOmStatus(row: SavedProgressBaseRow): string {
  if (row.latest_om_status != null) return row.latest_om_status;
  if (toInteger(row.inquiry_doc_count) > 0 || toInteger(row.uploaded_doc_count) > 0) return "received";
  return "none";
}

function readDealPath(details: JsonRecord | null): UiV2DealPathState | null {
  const pipeline = readPipeline(details);
  return isJsonRecord(pipeline.dealPath) ? (pipeline.dealPath as unknown as UiV2DealPathState) : null;
}

function readDealAnalysisWorkspace(details: JsonRecord | null): JsonRecord {
  return isJsonRecord(details?.dealAnalysisWorkspace) ? details.dealAnalysisWorkspace : {};
}

function deriveUnderwritingReviewState(row: SavedProgressBaseRow, hasOm: boolean, hasDossier: boolean): {
  status: string | null;
  required: boolean;
  completed: boolean;
} {
  const workspace = readDealAnalysisWorkspace(row.details);
  const rawStatus = stringOrNull(workspace.underwritingReviewStatus);
  const normalizedStatus = rawStatus?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? null;
  const reviewRequired =
    workspace.reviewRequired === true ||
    workspace.userVerified === false ||
    workspace.analysisVerified === false ||
    normalizedStatus === "user_review_required" ||
    normalizedStatus === "awaiting_user_review" ||
    normalizedStatus === "needs_review";
  if (reviewRequired) {
    return {
      status: normalizedStatus ?? "user_review_required",
      required: true,
      completed: false,
    };
  }

  const explicitlyCompleted =
    workspace.userVerified === true ||
    workspace.analysisVerified === true ||
    ["user_review_completed", "review_completed", "approved", "completed", "verified"].includes(normalizedStatus ?? "");
  const omStatus = String(row.latest_om_status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const promotedOrReviewed = ["promoted", "reviewed", "complete", "completed"].includes(omStatus);
  const completed = hasOm && (explicitlyCompleted || hasDossier || promotedOrReviewed);
  return {
    status: normalizedStatus,
    required: false,
    completed,
  };
}

function hasUnderwritingDocumentCategory(row: SavedProgressBaseRow): boolean {
  const categories = Array.isArray(row.uploaded_categories) ? row.uploaded_categories : [];
  return categories.some((category) =>
    [
      "OM",
      "Brochure",
      "Rent Roll",
      "Financial Model",
      "T12 / Operating Summary",
    ].includes(String(category))
  );
}

function hasComparablePackage(row: SavedProgressBaseRow): boolean {
  const categories = Array.isArray(row.uploaded_categories) ? row.uploaded_categories : [];
  return (
    toInteger(row.broker_comp_package_count) > 0 ||
    categories.some((category) =>
      [
        "Broker Comp Package",
        "Sale Comp Package",
        "Rent Comp Package",
        "Expense Comp Package",
        "Market Analysis",
      ].includes(String(category))
    )
  );
}

function hasUnderwritingInquiryFilename(row: SavedProgressBaseRow): boolean {
  const filenames = Array.isArray(row.inquiry_filenames) ? row.inquiry_filenames : [];
  return filenames.some((filename) =>
    /(offering|memorandum|(^|[^a-z])om([^a-z]|$)|brochure|rent[ _-]?roll|t-?12|operating|income[ _-]?expense|financial[ _-]?model|proforma|pro-forma)/i.test(
      String(filename)
    )
  );
}

function hasOmEvidence(row: SavedProgressBaseRow): boolean {
  const omStatus = String(row.latest_om_status ?? "").trim().toLowerCase();
  if (["received", "needs_review", "promoted", "complete", "completed"].includes(omStatus)) return true;
  return (
    hasUnderwritingDocumentCategory(row) ||
    hasUnderwritingInquiryFilename(row) ||
    readFirstPositiveNumericPath(row.details, [
      ["omData", "authoritative", "propertyInfo", "askingPrice"],
      ["omData", "authoritative", "uiFinancialSummary", "askingPrice"],
      ["rentalFinancials", "omAnalysis", "propertyInfo", "askingPrice"],
    ]) != null
  );
}

function hasAuthoritativeOm(row: SavedProgressBaseRow): boolean {
  return isJsonRecord(row.details?.omData) && isJsonRecord(row.details.omData.authoritative);
}

function hasManualUnderwritingInputs(row: SavedProgressBaseRow): boolean {
  const assumptions = getPropertyDossierAssumptions(row.details as never);
  if (assumptions == null) return false;
  const hasNoiInput = toNumber(assumptions.currentNoi) != null;
  const hasUnitModelInput = (assumptions.unitModelRows ?? []).some(
    (unit) =>
      toNumber(unit.currentAnnualRent) != null ||
      toNumber(unit.underwrittenAnnualRent) != null ||
      toNumber(unit.rentUpliftPct) != null
  );
  const hasExpenseModelInput = (assumptions.expenseModelRows ?? []).some(
    (expense) => toNumber(expense.amount) != null
  );
  const hasBrokerFinancialNotes =
    typeof assumptions.brokerEmailNotes === "string" && assumptions.brokerEmailNotes.trim().length > 0;
  return hasNoiInput || hasUnitModelInput || hasExpenseModelInput || hasBrokerFinancialNotes;
}

function hasCurrentUnderwritingSource(row: SavedProgressBaseRow): boolean {
  return hasAuthoritativeOm(row) || hasManualUnderwritingInputs(row);
}

function getCurrentDossierSummary(row: SavedProgressBaseRow) {
  return hasCurrentUnderwritingSource(row) ? getPropertyDossierSummary(row.details as never) : null;
}

function getSavedAskingPrice(row: SavedProgressBaseRow): number | null {
  const details = row.details;
  const summary = getCurrentDossierSummary(row);
  return (
    readFirstPositiveNumericPath(details, [
      ["manualSourceFacts", "askingPrice"],
      ["manualSourceFacts", "listedPrice"],
      ["manualSourceFacts", "listingPrice"],
      ["manualSourceFacts", "askPrice"],
    ]) ??
    resolveOmAskingPriceFromDetails(details as never) ??
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
    ])
  );
}

function getSavedCurrentNoi(row: SavedProgressBaseRow): number | null {
  const details = row.details;
  const summary = getCurrentDossierSummary(row);
  const allowSignalFallback = hasCurrentUnderwritingSource(row);
  return (
    // Same numerator as the pipeline and OM workspace: reconstructed actuals
    // basis first, broker-stated NOI only as a fallback.
    resolveReconstructedNoiBasisFromDetails(details as PropertyDetails | null) ??
    summary?.currentNoi ??
    readNumericPath(details, ["omData", "authoritative", "currentFinancials", "noi"]) ??
    readNumericPath(details, ["omData", "authoritative", "currentFinancials", "netOperatingIncome"]) ??
    readNumericPath(details, ["rentalFinancials", "omAnalysis", "currentFinancials", "noi"]) ??
    readNumericPath(details, ["rentalFinancials", "omAnalysis", "currentFinancials", "netOperatingIncome"]) ??
    readNumericPath(details, ["rentalFinancials", "fromLlm", "noi"]) ??
    (allowSignalFallback ? toNumber(row.latest_signal_current_noi) : null)
  );
}

function getSavedAdjustedNoi(row: SavedProgressBaseRow): number | null {
  const summary = getCurrentDossierSummary(row);
  return summary?.adjustedNoi ?? summary?.stabilizedNoi ?? (hasCurrentUnderwritingSource(row) ? toNumber(row.latest_signal_adjusted_noi) : null);
}

function getNoiYieldOnCost(row: SavedProgressBaseRow, noi: number | null, fallbackPct: number | string | null): number | null {
  const price = getSavedAskingPrice(row);
  if (price != null && price > 0 && noi != null) return (noi / price) * 100;
  return toNumber(fallbackPct);
}

function hasUnderwritingWorkup(row: SavedProgressBaseRow): boolean {
  if (!hasCurrentUnderwritingSource(row)) return false;
  return (
    hasCompletedDealDossier(row.details as never) ||
    toInteger(row.generated_doc_count) > 0 ||
    toNumber(row.latest_signal_deal_score) != null
  );
}

function resolveDealScore(row: SavedProgressBaseRow): number | null {
  const dossierSummary = getCurrentDossierSummary(row);
  const allowSignalFallback = hasCurrentUnderwritingSource(row);
  const calculated =
    dossierSummary?.calculatedDealScore
    ?? dossierSummary?.dealScore
    ?? (allowSignalFallback ? toNumber(row.latest_signal_deal_score) : null)
    ?? null;
  const override = row.override_score != null
    ? {
        id: "",
        propertyId: row.property_id,
        score: Number(row.override_score),
        reason: "",
        createdBy: null,
        createdAt: "",
        clearedAt: null,
      }
    : null;
  return resolveEffectiveDealScore(calculated, override);
}

function latestTimestamp(values: unknown[]): string {
  const timestamps = values
    .map((value) => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((value): value is number => value != null);
  if (timestamps.length === 0) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

function mapSavedDeal(row: SavedProgressBaseRow): SavedDeal {
  return {
    id: row.saved_deal_id ?? "",
    userId: row.saved_user_id ?? "",
    propertyId: row.property_id,
    dealStatus: DEAL_STATUSES.has(row.saved_deal_status as DealStatus) ? (row.saved_deal_status as DealStatus) : "saved",
    createdAt: toIso(row.saved_deal_created_at),
  };
}

function mapSavedRow(row: SavedProgressBaseRow): SavedDealV2Row {
  const details = row.details;
  const units = resolveSavedUnits(row);
  const sqft = resolveSavedSqft(row);
  const beds = resolveSavedBeds(row);
  const baths = resolveSavedBaths(row);
  const price = toNumber(row.listing_price) ?? getSavedAskingPrice(row);
  const currentNoi = getSavedCurrentNoi(row);
  const adjustedNoi = getSavedAdjustedNoi(row);
  const allowSignalFallback = hasCurrentUnderwritingSource(row);
  const location = readLocation(details, row.listing_extra);
  const documentCount = toInteger(row.uploaded_doc_count) + toInteger(row.inquiry_doc_count) + toInteger(row.generated_doc_count);
  return {
    savedDeal: mapSavedDeal(row),
    propertyId: row.property_id,
    canonicalAddress: row.canonical_address,
    displayAddress: row.canonical_address,
    source: row.listing_source,
    price,
    units,
    beds,
    baths,
    sqft,
    pricePerUnit: price != null && units != null && units > 0 ? Math.round(price / units) : null,
    pricePerSqft: price != null && sqft != null && sqft > 0 ? Math.round(price / sqft) : null,
    capRate: allowSignalFallback ? toNumber(row.latest_signal_adjusted_cap_rate) ?? toNumber(row.latest_signal_asset_cap_rate) : null,
    rentUpside: allowSignalFallback ? toNumber(row.latest_signal_rent_upside) : null,
    irrPct: allowSignalFallback ? toNumber(row.latest_signal_irr_pct) : null,
    cocPct: allowSignalFallback ? toNumber(row.latest_signal_coc_pct) : null,
    dealScore: resolveDealScore(row),
    ltrYocPct: getNoiYieldOnCost(row, currentNoi, allowSignalFallback ? row.latest_signal_asset_cap_rate : null),
    mtrYocPct: getNoiYieldOnCost(row, adjustedNoi, allowSignalFallback ? row.latest_signal_adjusted_cap_rate : null),
    hasOm: hasOmEvidence(row),
    hasComps: hasComparablePackage(row),
    hasDossier: hasUnderwritingWorkup(row),
    status: deriveStatus(row),
    tags: readTags(details),
    neighborhood: location.neighborhood,
    borough: location.borough,
    firstImageUrl: readFirstImageUrl(row),
    listingUrl: row.listing_url,
    omStatus: deriveOmStatus(row),
    documentCount,
    openActionItemCount: toInteger(row.open_action_item_count),
    latestOutreachAt: toIsoOrNull(row.latest_inquiry_sent_at),
    rejection: row.rejected_at != null || row.rejection_reason_code != null
      ? {
          reasonCode: row.rejection_reason_code ?? "other",
          reasonLabel: row.rejection_reason_label ?? null,
          note: row.rejection_note ?? null,
          rejectedAt: toIsoOrNull(row.rejected_at),
        }
      : null,
    updatedAt: latestTimestamp([
      row.property_updated_at,
      row.saved_deal_created_at,
      row.latest_signal_generated_at,
      row.latest_om_completed_at,
      row.rejected_at,
    ]),
  };
}

function mapProgressRow(row: SavedProgressBaseRow): ProgressPropertyRow {
  const saved = mapSavedRow(row);
  const underwritingReview = deriveUnderwritingReviewState(row, saved.hasOm, saved.hasDossier);
  return {
    propertyId: saved.propertyId,
    canonicalAddress: saved.canonicalAddress,
    displayAddress: saved.displayAddress,
    source: saved.source,
    price: saved.price,
    units: saved.units,
    sqft: saved.sqft,
    pricePerSqft: saved.pricePerSqft,
    dealScore: saved.dealScore,
    ltrYocPct: saved.ltrYocPct,
    mtrYocPct: saved.mtrYocPct,
    status: saved.status,
    savedDealStatus: row.saved_deal_status,
    tags: saved.tags,
    omStatus: saved.omStatus,
    hasOm: saved.hasOm,
    hasComps: saved.hasComps,
    hasDossier: saved.hasDossier,
    underwritingReviewStatus: underwritingReview.status,
    underwritingReviewRequired: underwritingReview.required,
    underwritingReviewCompleted: underwritingReview.completed,
    dealPath: readDealPath(row.details),
    openActionItemCount: saved.openActionItemCount,
    neighborhood: saved.neighborhood,
    borough: saved.borough,
    firstImageUrl: saved.firstImageUrl,
    brokerName: row.manual_broker_name ?? row.broker_display_name,
    brokerEmail: row.manual_broker_email ?? row.recipient_contact_email,
    stageEnteredAt: toIsoOrNull(row.stage_entered_at),
    latestOutreachAt: toIsoOrNull(row.latest_inquiry_sent_at),
    updatedAt: saved.updatedAt,
  };
}

async function getDefaultUserId(): Promise<string> {
  const pool = getPool();
  return new UserProfileRepo({ pool }).ensureDefault();
}

async function hasTable(pool: Pool, tableName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [tableName]);
  return result.rows[0]?.exists === true;
}

async function hasColumn(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    [tableName, columnName]
  );
  return result.rows[0]?.exists === true;
}

function rejectionSelect(hasRejections: boolean): string {
  if (!hasRejections) {
    return `
       NULL::text AS rejection_reason_code,
       NULL::text AS rejection_reason_label,
       NULL::text AS rejection_note,
       NULL::timestamptz AS rejected_at`;
  }
  return `
       pr.reason_code AS rejection_reason_code,
       pr.reason_label AS rejection_reason_label,
       pr.note AS rejection_note,
       pr.rejected_at`;
}

function rejectionJoin(hasRejections: boolean): string {
  if (!hasRejections) return "";
  return `
     LEFT JOIN LATERAL (
       SELECT reason_code, reason_label, note, rejected_at
       FROM property_rejections
       WHERE property_id = p.id AND restored_at IS NULL
       ORDER BY rejected_at DESC
       LIMIT 1
     ) pr ON true`;
}

function brokerSelect(includeBroker: boolean): string {
  if (!includeBroker) {
    return `
       NULL::text AS manual_broker_name,
       NULL::text AS manual_broker_email,
       NULL::text AS recipient_contact_email,
       NULL::text AS broker_display_name,`;
  }
  return `
       rr.manual_broker_name,
       rr.manual_broker_email,
       rr.contact_email AS recipient_contact_email,
       bc.display_name AS broker_display_name,`;
}

function brokerJoin(includeBroker: boolean): string {
  if (!includeBroker) return "";
  return `
     LEFT JOIN property_recipient_resolution rr ON rr.property_id = p.id
     LEFT JOIN broker_contacts bc ON bc.id = rr.contact_id`;
}

function baseSelectSql(hasRejections: boolean, savedOnly: boolean, includeBroker = false, includeStage = false): string {
  return `SELECT
       sd.id AS saved_deal_id,
       sd.user_id AS saved_user_id,
       sd.deal_status AS saved_deal_status,
       sd.created_at AS saved_deal_created_at,
       p.id AS property_id,
       p.canonical_address,
       p.details,
       p.created_at AS property_created_at,
       p.updated_at AS property_updated_at,
       l.id AS listing_id,
       l.source AS listing_source,
       l.price AS listing_price,
       l.beds AS listing_beds,
       l.baths AS listing_baths,
       l.sqft AS listing_sqft,
       l.url AS listing_url,
       l.title AS listing_title,
       l.description AS listing_description,
       l.image_urls AS listing_image_urls,
       l.extra AS listing_extra,
       ds.deal_score AS latest_signal_deal_score,
       ds.asset_cap_rate AS latest_signal_asset_cap_rate,
       ds.adjusted_cap_rate AS latest_signal_adjusted_cap_rate,
       ds.current_noi AS latest_signal_current_noi,
       ds.adjusted_noi AS latest_signal_adjusted_noi,
       ds.rent_upside AS latest_signal_rent_upside,
       ds.irr_pct AS latest_signal_irr_pct,
       ds.coc_pct AS latest_signal_coc_pct,
       ds.generated_at AS latest_signal_generated_at,
       dso.score AS override_score,
       om.status AS latest_om_status,
       om.completed_at AS latest_om_completed_at,
       COALESCE(ud.uploaded_doc_count, 0) AS uploaded_doc_count,
       COALESCE(ud.uploaded_categories, ARRAY[]::text[]) AS uploaded_categories,
       COALESCE(idoc.inquiry_doc_count, 0) AS inquiry_doc_count,
       COALESCE(idoc.inquiry_filenames, ARRAY[]::text[]) AS inquiry_filenames,
       COALESCE(gdoc.generated_doc_count, 0) AS generated_doc_count,
       COALESCE(bcp.broker_comp_package_count, 0) AS broker_comp_package_count,
       COALESCE(ai.open_action_item_count, 0) AS open_action_item_count,
       pis.sent_at AS latest_inquiry_sent_at,
       ${brokerSelect(includeBroker)}
       ${includeStage ? "p.stage_entered_at," : "NULL::timestamptz AS stage_entered_at,"}
       ${rejectionSelect(hasRejections)}
     FROM ${savedOnly ? "saved_deals sd INNER JOIN properties p ON p.id = sd.property_id" : "properties p LEFT JOIN saved_deals sd ON sd.property_id = p.id AND sd.user_id = $1"}${brokerJoin(includeBroker)}
     LEFT JOIN LATERAL (
       SELECT l.*
       FROM listing_property_matches m
       INNER JOIN listings l ON l.id = m.listing_id
       WHERE m.property_id = p.id
       ORDER BY (m.status = 'accepted') DESC, m.confidence DESC, m.created_at DESC
       LIMIT 1
     ) l ON true
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
       SELECT *
       FROM om_ingestion_runs
       WHERE property_id = p.id
       ORDER BY started_at DESC NULLS LAST, created_at DESC
       LIMIT 1
     ) om ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS uploaded_doc_count,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT category), NULL) AS uploaded_categories
       FROM property_uploaded_documents
       WHERE property_id = p.id
     ) ud ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS inquiry_doc_count,
         ARRAY_REMOVE(ARRAY_AGG(filename), NULL) AS inquiry_filenames
       FROM property_inquiry_documents
       WHERE property_id = p.id
     ) idoc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS generated_doc_count
       FROM documents
       WHERE property_id = p.id
     ) gdoc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS broker_comp_package_count
       FROM broker_comp_packages
       WHERE property_id = p.id
     ) bcp ON true
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
     ${rejectionJoin(hasRejections)}`;
}

async function fetchSavedRows(
  pool: Pool,
  userId: string,
  statuses: DealStatus[],
  limit: number,
  offset: number,
  hasRejections: boolean
): Promise<{ rows: SavedProgressBaseRow[]; total: number }> {
  const filters = ["sd.user_id = $1"];
  const params: unknown[] = [userId];
  if (statuses.length > 0) {
    params.push(statuses);
    filters.push(`sd.deal_status::text = ANY($${params.length}::text[])`);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM saved_deals sd ${where}`,
    params
  );
  const rowParams = [...params, limit, offset];
  const result = await pool.query<SavedProgressBaseRow>(
    `${baseSelectSql(hasRejections, true)}
     ${where}
     ORDER BY sd.created_at DESC
     LIMIT $${rowParams.length - 1}
     OFFSET $${rowParams.length}`,
    rowParams
  );
  return {
    rows: result.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

async function fetchProgressRows(pool: Pool, userId: string, hasRejections: boolean, hasStageColumns = false): Promise<SavedProgressBaseRow[]> {
  const result = await pool.query<SavedProgressBaseRow>(
    `${baseSelectSql(hasRejections, false, true, hasStageColumns)}
     ORDER BY p.updated_at DESC`,
    [userId]
  );
  return result.rows;
}

function buildProgressSections(rows: ProgressPropertyRow[]): ProgressSection[] {
  // Single source of truth for stage labels lives in @re-sourcing/contracts.
  const sectionLabels: Record<ProgressSection["id"], string> = Object.fromEntries(
    DEAL_FLOW_STAGES.map((stage) => [stage.id, stage.label])
  ) as Record<ProgressSection["id"], string>;
  const ids: ProgressSection["id"][] = [
    "sourced",
    "om_requested",
    "underwriting_awaiting_review",
    "underwriting_review_completed",
    "tour_requested",
    "tour_scheduled",
    "tour_completed_awaiting_inputs",
    "offer_review",
    "negotiation",
    "contract_signed",
    "deal_closed",
  ];
  const claimed = new Set<string>();
  return ids.map((id) => {
    const matches = rows.filter((row) => {
      if (claimed.has(row.propertyId)) return false;
      if (row.status === "rejected" || row.status === "archived") return false;
      const isLaterDealStage = [
        "tour_scheduled",
        "tour_completed_awaiting_inputs",
        "offer_review",
        "negotiation",
        "contract_signed",
        "deal_closed",
      ].includes(row.status);
      const matched =
        id === "sourced"
          ? !isLaterDealStage &&
            !row.hasOm &&
            !["outreach", "awaiting_broker", "om_received", "underwriting", "dossier_generated"].includes(row.status)
          : id === "om_requested"
          ? !isLaterDealStage && (row.status === "outreach" || row.status === "awaiting_broker")
          : id === "underwriting_awaiting_review"
            ? !isLaterDealStage &&
              row.hasOm &&
              (row.underwritingReviewRequired ||
                (!row.underwritingReviewCompleted &&
                  (row.status === "om_received" ||
                    row.status === "underwriting" ||
                    row.status === "dossier_generated" ||
                    row.status === "saved" ||
                    row.savedDealStatus != null)))
          : id === "underwriting_review_completed"
            ? !isLaterDealStage &&
              row.hasOm &&
              row.underwritingReviewCompleted
          : id === "tour_requested"
            ? row.status === "tour_scheduled" && !row.dealPath?.tourScheduledAt
          : id === "tour_scheduled"
            ? row.status === "tour_scheduled" && Boolean(row.dealPath?.tourScheduledAt)
            : row.status === id;
      if (matched) claimed.add(row.propertyId);
      return matched;
    });
    return {
      id,
      label: sectionLabels[id],
      count: matches.length,
      rows: matches.slice(0, PROGRESS_SECTION_LIMIT),
    };
  });
}

async function fetchRejectionReasonCounts(pool: Pool, hasRejections: boolean): Promise<Array<{ reasonCode: string; count: number }> | undefined> {
  if (!hasRejections) return undefined;
  const result = await pool.query<{ reason_code: string; count: string }>(
    `SELECT reason_code, COUNT(*)::text AS count
     FROM property_rejections
     WHERE restored_at IS NULL
     GROUP BY reason_code
     ORDER BY COUNT(*) DESC, reason_code ASC`
  );
  return result.rows.map((row) => ({ reasonCode: row.reason_code, count: Number(row.count) }));
}

router.get("/ui-v2/saved-deals", async (req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const pool = getPool();
    const limit = clampLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const statuses = parseStatusFilter(req.query.status);
    const hasRejections = await hasTable(pool, "property_rejections");
    const { rows, total } = await fetchSavedRows(pool, userId, statuses, limit, offset, hasRejections);
    const enrichedRows = rows.map(mapSavedRow);
    const response: SavedDealsV2Response = {
      savedDeals: {
        deals: enrichedRows.map((row) => row.savedDeal),
        rows: enrichedRows,
        total,
        limit,
        offset,
      },
    };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ui-v2 saved-deals]", err);
    res.status(503).json({ error: "Failed to list v2 saved deals.", details: message });
  }
});

router.get("/ui-v2/deal-progress", async (_req: Request, res: Response) => {
  try {
    const userId = await getDefaultUserId();
    const pool = getPool();
    const [hasRejections, hasStageColumns] = await Promise.all([
      hasTable(pool, "property_rejections"),
      hasColumn(pool, "properties", "stage_entered_at"),
    ]);
    const [baseRows, rejectionReasons] = await Promise.all([
      fetchProgressRows(pool, userId, hasRejections, hasStageColumns),
      fetchRejectionReasonCounts(pool, hasRejections),
    ]);
    const rows = baseRows.map(mapProgressRow);
    const sections = buildProgressSections(rows);
    const sectionCount = (id: ProgressSection["id"]) => sections.find((section) => section.id === id)?.count ?? 0;
    const underwritingCount =
      sectionCount("underwriting_awaiting_review") + sectionCount("underwriting_review_completed");
    const updatedAt = latestTimestamp(baseRows.flatMap((row) => [
      row.property_updated_at,
      row.saved_deal_created_at,
      row.latest_signal_generated_at,
      row.latest_om_completed_at,
      row.rejected_at,
    ]));
    const response: DealProgressV2Response = {
      summary: {
        savedCount: sectionCount("sourced"),
        underwritingCount,
        outreachCount: sectionCount("om_requested"),
        awaitingBrokerCount: sectionCount("om_requested"),
        omReceivedCount: underwritingCount,
        rejectedCount: rows.filter((row) => row.status === "rejected").length,
        updatedAt,
      },
      sections,
      ...(rejectionReasons ? { rejectionReasons } : {}),
    };
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ui-v2 deal-progress]", err);
    res.status(503).json({ error: "Failed to load v2 deal progress.", details: message });
  }
});

const RECOMMENDATIONS_TTL_MS = 10 * 60 * 1000;
/** Within this window the cached answer is served without re-querying the board. */
const RECOMMENDATIONS_SOFT_TTL_MS = 45 * 1000;
let recommendationsCache: {
  key: string;
  builtAt: number;
  expiresAt: number;
  payload: DealFlowRecommendationsResponse;
} | null = null;

router.get("/ui-v2/deal-progress/recommendations", async (req: Request, res: Response) => {
  try {
    const force = String(req.query.refresh ?? "") === "1";
    if (!force && recommendationsCache && Date.now() - recommendationsCache.builtAt < RECOMMENDATIONS_SOFT_TTL_MS) {
      res.json(recommendationsCache.payload);
      return;
    }
    const userId = await getDefaultUserId();
    const pool = getPool();
    const [hasRejections, hasStageColumns] = await Promise.all([
      hasTable(pool, "property_rejections"),
      hasColumn(pool, "properties", "stage_entered_at"),
    ]);
    const baseRows = await fetchProgressRows(pool, userId, hasRejections, hasStageColumns);
    const rows = baseRows.map(mapProgressRow);
    const sections = buildProgressSections(rows);

    const inputRows: RecommendationInputRow[] = sections.flatMap((section) =>
      section.rows.map((row) => ({
        sectionId: section.id,
        propertyId: row.propertyId,
        displayAddress: row.displayAddress || row.canonicalAddress,
        brokerEmail: row.brokerEmail,
        hasOm: row.hasOm,
        omStatus: row.omStatus,
        tourScheduledAt: row.dealPath?.tourScheduledAt ?? null,
        postTourDecision: row.dealPath?.postTourDecision ?? null,
        underwritingReviewRequired: row.underwritingReviewRequired,
        underwritingReviewCompleted: row.underwritingReviewCompleted,
        stageEnteredAt: row.stageEnteredAt,
        latestOutreachAt: row.latestOutreachAt,
      }))
    );

    // Board state digest: an unchanged board reuses the LLM answer until the TTL.
    const cacheKey = JSON.stringify(
      inputRows.map((row) => [row.sectionId, row.propertyId, row.brokerEmail != null, row.postTourDecision ?? ""])
    );
    if (recommendationsCache && recommendationsCache.key === cacheKey && recommendationsCache.expiresAt > Date.now()) {
      recommendationsCache.builtAt = Date.now();
      res.json(recommendationsCache.payload);
      return;
    }

    const payload = await buildProgressRecommendations(inputRows);
    recommendationsCache = { key: cacheKey, builtAt: Date.now(), expiresAt: Date.now() + RECOMMENDATIONS_TTL_MS, payload };
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ui-v2 deal-progress recommendations]", err);
    res.status(503).json({ error: "Failed to build recommendations.", details: message });
  }
});

export default router;
