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
 * Coarser than the display flow: several display stages share one canonical
 * stage. Mirrored from @re-sourcing/db's DEAL_STAGES (db depends on
 * contracts, so the literal union is duplicated here and equality is
 * asserted by a test in apps/api).
 */
export type CanonicalDealStage =
  | "inbox"
  | "screening"
  | "pursuing"
  | "outreach"
  | "om_review"
  | "underwriting"
  | "tour"
  | "offer_loi"
  | "contract_dd"
  | "closed";

export type CanonicalDealState = "active" | "dead" | "closed";

/** Saved-deal status → canonical stage/state written to properties.deal_stage. */
export const STATUS_TO_CANONICAL: Record<string, { stage: CanonicalDealStage; state: CanonicalDealState }> = {
  new: { stage: "inbox", state: "active" },
  screening: { stage: "screening", state: "active" },
  interesting: { stage: "screening", state: "active" },
  saved: { stage: "pursuing", state: "active" },
  outreach: { stage: "outreach", state: "active" },
  awaiting_broker: { stage: "outreach", state: "active" },
  om_received: { stage: "om_review", state: "active" },
  underwriting: { stage: "underwriting", state: "active" },
  dossier_generated: { stage: "underwriting", state: "active" },
  tour_scheduled: { stage: "tour", state: "active" },
  tour_completed_awaiting_inputs: { stage: "tour", state: "active" },
  offer_review: { stage: "offer_loi", state: "active" },
  negotiation: { stage: "offer_loi", state: "active" },
  contract_signed: { stage: "contract_dd", state: "active" },
  deal_closed: { stage: "closed", state: "closed" },
  archived: { stage: "closed", state: "closed" },
  rejected: { stage: "screening", state: "dead" },
};

/** Aging thresholds (days in stage) shared by chips and recommendation rules. */
export const STAGE_AGING = {
  warnDays: 7,
  dangerDays: 14,
} as const;

/**
 * Funnel position of each ui-v2 pipeline status. Automatic flows (OM uploads,
 * OM analysis refresh, outreach sends, document post-processing) must only
 * move a deal to a status with a HIGHER rank than its current one — deals that
 * are moving forward are never pushed back by reworking the OM workspace or
 * re-running underwriting. Manual board moves are exempt: the user can drag a
 * deal anywhere. Statuses sharing a rank are lateral moves within one stage.
 * Terminal/dead states rank highest so no automatic flow ever "advances" out
 * of them.
 */
export const UI_V2_STATUS_FUNNEL_RANK: Record<string, number> = {
  new: 0,
  screening: 1,
  interesting: 1,
  saved: 2,
  outreach: 3,
  awaiting_broker: 3,
  om_received: 4,
  underwriting: 5,
  dossier_generated: 5,
  tour_scheduled: 6,
  tour_completed_awaiting_inputs: 7,
  offer_review: 8,
  negotiation: 9,
  contract_signed: 10,
  deal_closed: 11,
  rejected: 12,
  archived: 12,
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

export type DealFlowStageId =
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
    statuses: ["new", "screening", "interesting"],
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
    label: "Underwriting · Awaiting Review",
    shortLabel: "UW Review",
    statuses: ["saved", "underwriting", "om_received", "dossier_generated"],
    targetStatus: "underwriting",
  },
  {
    id: "underwriting_review_completed",
    label: "Underwriting · Review Completed",
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
    label: "Tour Completed · Awaiting Inputs",
    shortLabel: "Awaiting Inputs",
    statuses: ["tour_completed_awaiting_inputs"],
    targetStatus: "tour_completed_awaiting_inputs",
  },
  {
    id: "offer_review",
    label: "LOI Offered",
    shortLabel: "LOI",
    statuses: ["offer_review"],
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
    id: "contract_signed",
    label: "Contract Signed / Diligence",
    shortLabel: "Contract",
    statuses: ["contract_signed"],
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
