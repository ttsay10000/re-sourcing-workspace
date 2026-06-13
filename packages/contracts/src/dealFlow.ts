/**
 * Canonical deal-flow display stages.
 *
 * Single source of truth for the funnel shown on the home dashboard, the
 * Deal Progress board columns, and stage chips elsewhere in the UI. The ids
 * match the section ids returned by `GET /api/ui-v2/deal-progress`, so a
 * stage count rendered anywhere always agrees with the board.
 */
/**
 * Canonical persistence stages (migration 056, `properties.deal_stage`).
 *
 * These are intentionally the same ids shown on the Deal Progress board. Older
 * UI/status values are adapted into this stage taxonomy while `deal_state`
 * carries lifecycle state (`active`, `dead`, `closed`).
 */
export type DealFlowStageId =
  | "sourced"
  | "om_requested"
  | "underwriting_awaiting_review"
  | "underwriting_review_completed"
  | "tour_requested"
  | "tour_scheduled"
  | "tour_completed_awaiting_inputs"
  | "drafting_loi"
  | "loi_sent_awaiting_response"
  | "negotiation"
  | "contract_signed_diligence"
  | "deal_closed";

export type CanonicalDealStage = DealFlowStageId;
export type CanonicalDealState = "active" | "dead" | "closed";

/** Saved-deal/status adapter to canonical stage/state written to properties.deal_stage. */
export const STATUS_TO_CANONICAL: Record<string, { stage: CanonicalDealStage; state: CanonicalDealState }> = {
  new: { stage: "sourced", state: "active" },
  screening: { stage: "sourced", state: "active" },
  interesting: { stage: "sourced", state: "active" },
  saved: { stage: "sourced", state: "active" },
  outreach: { stage: "om_requested", state: "active" },
  awaiting_broker: { stage: "om_requested", state: "active" },
  om_requested: { stage: "om_requested", state: "active" },
  om_received: { stage: "underwriting_awaiting_review", state: "active" },
  underwriting: { stage: "underwriting_awaiting_review", state: "active" },
  dossier_generated: { stage: "underwriting_awaiting_review", state: "active" },
  underwriting_awaiting_review: { stage: "underwriting_awaiting_review", state: "active" },
  underwriting_review_completed: { stage: "underwriting_review_completed", state: "active" },
  tour_requested: { stage: "tour_requested", state: "active" },
  tour_scheduled: { stage: "tour_scheduled", state: "active" },
  tour_completed_awaiting_inputs: { stage: "tour_completed_awaiting_inputs", state: "active" },
  offer_candidate: { stage: "drafting_loi", state: "active" },
  offer_review: { stage: "drafting_loi", state: "active" },
  drafting_loi: { stage: "drafting_loi", state: "active" },
  loi_sent: { stage: "loi_sent_awaiting_response", state: "active" },
  loi_sent_awaiting_response: { stage: "loi_sent_awaiting_response", state: "active" },
  negotiation: { stage: "negotiation", state: "active" },
  contract_signed: { stage: "contract_signed_diligence", state: "active" },
  diligence_escrow: { stage: "contract_signed_diligence", state: "active" },
  contract_signed_diligence: { stage: "contract_signed_diligence", state: "active" },
  deal_closed: { stage: "deal_closed", state: "closed" },
  closed: { stage: "deal_closed", state: "closed" },
  archived: { stage: "sourced", state: "dead" },
  rejected: { stage: "sourced", state: "dead" },
  rejected_removed: { stage: "sourced", state: "dead" },
};

/** Aging thresholds (days in stage) shared by chips and recommendation rules. */
export const STAGE_AGING = {
  warnDays: 7,
  dangerDays: 14,
} as const;

/**
 * Funnel position of each ui-v2 pipeline status. Automatic flows (OM uploads,
 * OM analysis refresh, outreach sends, document post-processing) must only
 * move a deal to a status with a HIGHER rank than its current one. Manual
 * board moves are exempt: the user can drag a deal anywhere.
 */
export const UI_V2_STATUS_FUNNEL_RANK: Record<string, number> = {
  new: 0,
  screening: 1,
  interesting: 1,
  saved: 2,
  sourced: 2,
  outreach: 3,
  awaiting_broker: 3,
  om_requested: 3,
  om_received: 4,
  underwriting: 5,
  dossier_generated: 5,
  underwriting_awaiting_review: 5,
  underwriting_review_completed: 6,
  tour_requested: 7,
  tour_scheduled: 8,
  tour_completed_awaiting_inputs: 9,
  offer_candidate: 10,
  offer_review: 10,
  drafting_loi: 10,
  loi_sent: 11,
  loi_sent_awaiting_response: 11,
  negotiation: 12,
  contract_signed: 13,
  diligence_escrow: 13,
  contract_signed_diligence: 13,
  deal_closed: 14,
  closed: 14,
  rejected: 15,
  archived: 15,
  rejected_removed: 15,
};

/** Funnel rank of a pipeline status; unknown/legacy statuses rank as 0 (new). */
export function pipelineStatusRank(status: string | null | undefined): number {
  const normalized = String(status ?? "").trim().toLowerCase();
  return UI_V2_STATUS_FUNNEL_RANK[normalized] ?? 0;
}

/**
 * Whether an automatic flow is allowed to move a deal from `current` to
 * `next`. True only when `next` is strictly further down the funnel (or the
 * current status is unknown). Lateral and backward moves return false.
 */
export function isForwardPipelineStatusMove(
  current: string | null | undefined,
  next: string
): boolean {
  const normalized = String(current ?? "").trim().toLowerCase();
  if (!normalized) return true;
  if (UI_V2_STATUS_FUNNEL_RANK[normalized] == null) return true;
  return pipelineStatusRank(next) > pipelineStatusRank(normalized);
}

export type DealFlowStage = {
  id: DealFlowStageId;
  /** Full label, used on board column headers and tooltips. */
  label: string;
  /** Compact label for dense surfaces (home funnel strip, stage chips). */
  shortLabel: string;
  /** Saved-deal statuses that land a row in this stage. */
  statuses: readonly string[];
  /** Status written when a deal is moved into this stage. */
  targetStatus: string;
  /** Terminal stages render as rails/counters rather than working columns. */
  terminal?: boolean;
};

export const DEAL_FLOW_STAGES: readonly DealFlowStage[] = [
  {
    id: "sourced",
    label: "Sourced",
    shortLabel: "Sourced",
    statuses: ["new", "screening", "interesting", "saved"],
    targetStatus: "saved",
  },
  {
    id: "om_requested",
    label: "OM Requested",
    shortLabel: "OM Requested",
    statuses: ["outreach", "awaiting_broker"],
    targetStatus: "awaiting_broker",
  },
  {
    id: "underwriting_awaiting_review",
    label: "Underwriting - Awaiting Review",
    shortLabel: "UW Review",
    statuses: ["underwriting", "om_received", "dossier_generated"],
    targetStatus: "underwriting",
  },
  {
    id: "underwriting_review_completed",
    label: "Underwriting - Review Completed",
    shortLabel: "UW Done",
    statuses: ["underwriting", "om_received", "dossier_generated"],
    targetStatus: "underwriting",
  },
  {
    id: "tour_requested",
    label: "Tour Requested",
    shortLabel: "Tour Req.",
    statuses: ["tour_scheduled"],
    targetStatus: "tour_scheduled",
  },
  {
    id: "tour_scheduled",
    label: "Tour Scheduled",
    shortLabel: "Tour Set",
    statuses: [],
    targetStatus: "tour_scheduled",
  },
  {
    id: "tour_completed_awaiting_inputs",
    label: "Tour Completed - Awaiting Inputs",
    shortLabel: "Awaiting Inputs",
    statuses: ["tour_completed_awaiting_inputs"],
    targetStatus: "tour_completed_awaiting_inputs",
  },
  {
    id: "drafting_loi",
    label: "Drafting LOI",
    shortLabel: "Draft LOI",
    statuses: ["offer_review", "offer_candidate", "drafting_loi"],
    targetStatus: "offer_review",
  },
  {
    id: "loi_sent_awaiting_response",
    label: "LOI Sent - Awaiting Response",
    shortLabel: "LOI Sent",
    statuses: ["loi_sent", "loi_sent_awaiting_response"],
    targetStatus: "offer_review",
  },
  {
    id: "negotiation",
    label: "Negotiation",
    shortLabel: "Negotiation",
    statuses: ["negotiation"],
    targetStatus: "negotiation",
  },
  {
    id: "contract_signed_diligence",
    label: "Contract Signed / Diligence",
    shortLabel: "Contract",
    statuses: ["contract_signed", "diligence_escrow", "contract_signed_diligence"],
    targetStatus: "contract_signed",
  },
  {
    id: "deal_closed",
    label: "Deal Closed",
    shortLabel: "Closed",
    statuses: ["deal_closed", "archived"],
    targetStatus: "deal_closed",
    terminal: true,
  },
] as const;

export const DEAL_FLOW_STAGE_BY_ID: ReadonlyMap<DealFlowStageId, DealFlowStage> = new Map(
  DEAL_FLOW_STAGES.map((stage) => [stage.id, stage])
);

/** Stage a saved-deal status belongs to (first matching stage wins). */
export function dealFlowStageForStatus(status: string | null | undefined): DealFlowStage | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return DEAL_FLOW_STAGES.find((stage) => stage.statuses.includes(normalized)) ?? null;
}

/* ── "What to do next" recommendations (GET /api/ui-v2/deal-progress/recommendations) ── */

export type DealFlowRecommendationKind =
  | "tour_inputs"
  | "confirm_tours"
  | "missing_broker_email"
  | "request_oms"
  | "om_request_stale"
  | "underwriting_stale"
  | "underwriting_review"
  | "loi_followup";

export type DealFlowRecommendation = {
  id: DealFlowRecommendationKind;
  /** Action phrased for the user, e.g. "Add tour outcomes for 2 properties". */
  title: string;
  /** Short supporting line listing example addresses. */
  detail: string | null;
  count: number;
  /** Board stage the action chip should filter to. */
  stageId: DealFlowStageId | null;
  propertyIds: string[];
};

export type DealFlowRecommendationsResponse = {
  /** One-sentence summary line above the items. */
  headline: string;
  items: DealFlowRecommendation[];
  generatedAt: string;
  /** Whether the LLM produced the phrasing/ordering or the rule engine did. */
  source: "llm" | "rules";
};
