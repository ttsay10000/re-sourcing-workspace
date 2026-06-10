import { DEAL_FLOW_STAGE_BY_ID, dealFlowStageForStatus, type DealFlowStageId } from "@re-sourcing/contracts";
import { Badge, type BadgeTone } from "./Badge";

const STAGE_TONES: Record<DealFlowStageId, BadgeTone> = {
  sourced: "neutral",
  om_requested: "info",
  underwriting_awaiting_review: "warning",
  underwriting_review_completed: "info",
  tour_requested: "warning",
  tour_scheduled: "brand",
  tour_completed_awaiting_inputs: "warning",
  offer_review: "brand",
  negotiation: "brand",
  contract_signed: "success",
  deal_closed: "success",
};

type StageChipProps = {
  /** A known stage id, or a raw saved-deal status that will be mapped to one. */
  stage?: DealFlowStageId | null;
  status?: string | null;
  /** Use the compact label (default) or the full one. */
  full?: boolean;
  className?: string;
};

/** Compact colored chip showing where a deal sits in the canonical flow. */
export function StageChip({ stage, status, full = false, className }: StageChipProps) {
  const resolved = stage ? DEAL_FLOW_STAGE_BY_ID.get(stage) ?? null : dealFlowStageForStatus(status);
  if (!resolved) return null;
  return (
    <Badge tone={STAGE_TONES[resolved.id]} className={className} title={resolved.label}>
      {full ? resolved.label : resolved.shortLabel}
    </Badge>
  );
}
