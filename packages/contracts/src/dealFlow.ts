/**
 * Canonical deal-flow display stages.
 *
 * Single source of truth for the funnel shown on the home dashboard, the
 * Deal Progress board columns, and stage chips elsewhere in the UI. The ids
 * match the section ids returned by `GET /api/ui-v2/deal-progress`, so a
 * stage count rendered anywhere always agrees with the board.
 */
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
