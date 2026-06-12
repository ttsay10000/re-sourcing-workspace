/**
 * Deal-progress board pipeline status, derived from a property row.
 *
 * Single source of truth for "what status does the board show for this
 * property right now". The board (savedProgressV2) and the yield map (comps)
 * both derive stage chips from this, so a stage move on the board is
 * reflected everywhere on the next read.
 *
 * Precedence (highest first):
 *   1. Active rejection (property_rejections row, pipeline.rejectedAt, or the
 *      legacy rejected_removed status) → "rejected"
 *   2. Deal-path signals (tour dates / post-tour decision) unless the current
 *      status is a later or terminal stage
 *   3. Explicit pipeline.uiV2Status written by board moves
 *   4. Saved-deal status specials (dossier_generated / rejected / saved)
 *   5. Legacy pipeline.status mapping
 */

import type { UiV2PipelineStatus } from "@re-sourcing/contracts";

type JsonRecord = Record<string, unknown>;

export const UI_V2_STATUSES = new Set<UiV2PipelineStatus>([
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

function isJsonRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The pipeline sub-record of properties.details ({} when absent). */
export function readPipelineRecord(details: JsonRecord | null | undefined): JsonRecord {
  return isJsonRecord(details?.pipeline) ? details.pipeline : {};
}

export function mapLegacyStatus(status: string | null): UiV2PipelineStatus {
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

export function deriveDealPathPipelineStatus(
  pipeline: JsonRecord,
  currentStatus: UiV2PipelineStatus | null
): UiV2PipelineStatus | null {
  if (currentStatus != null && DEAL_PATH_BLOCKING_STATUSES.has(currentStatus)) return null;
  const dealPath = isJsonRecord(pipeline.dealPath) ? pipeline.dealPath : null;
  if (dealPath == null) return null;
  // "canceled" = the deal was explicitly moved out of the tour/offer flow;
  // its dates and decision stop steering the board until a new signal lands.
  if (stringOrNull(dealPath.status) === "canceled") return null;
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

export interface BoardPipelineStatusInput {
  /** properties.details (or just its pipeline-bearing subset). */
  details: JsonRecord | null;
  /** True when an unrestored property_rejections row exists. */
  hasActiveRejection?: boolean;
  /** saved_deals.deal_status (legacy enum) when a saved-deal row exists. */
  savedDealStatus?: string | null;
}

export function deriveBoardPipelineStatus(input: BoardPipelineStatusInput): UiV2PipelineStatus {
  const pipeline = readPipelineRecord(input.details);
  if (
    input.hasActiveRejection === true ||
    stringOrNull(pipeline.rejectedAt) != null ||
    pipeline.status === "rejected_removed"
  ) {
    return "rejected";
  }
  const uiStatus = stringOrNull(pipeline.uiV2Status);
  const currentStatus = uiStatus != null && UI_V2_STATUSES.has(uiStatus as UiV2PipelineStatus)
    ? (uiStatus as UiV2PipelineStatus)
    : null;
  const dealPathStatus = deriveDealPathPipelineStatus(pipeline, currentStatus);
  if (dealPathStatus != null) return dealPathStatus;
  if (currentStatus != null) return currentStatus;
  if (input.savedDealStatus === "dossier_generated") return "dossier_generated";
  if (input.savedDealStatus === "rejected") return "rejected";
  if (input.savedDealStatus === "saved") return "saved";
  return mapLegacyStatus(stringOrNull(pipeline.status));
}
