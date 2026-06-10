/**
 * Canonical stage recorder. Translates a saved-deal status change into the
 * coarse migration-056 stage model via StageTransitionRepo, which updates
 * properties.deal_stage/deal_state/stage_entered_at and appends a
 * stage_transitions row (no-op when the canonical position is unchanged).
 *
 * Fire-and-forget by contract: callers must not let a recording failure block
 * the user-facing status write.
 */
import type { Pool } from "pg";
import { STATUS_TO_CANONICAL } from "@re-sourcing/contracts";
import { StageTransitionRepo, isDealStage, isDealState } from "@re-sourcing/db";

export async function recordDealStageChange(
  pool: Pool,
  propertyId: string,
  newStatus: string,
  options?: { actor?: string | null; source?: string | null; reason?: string | null }
): Promise<void> {
  try {
    const target = STATUS_TO_CANONICAL[String(newStatus ?? "").trim().toLowerCase()];
    if (!target || !isDealStage(target.stage) || !isDealState(target.state)) return;

    await new StageTransitionRepo({ pool }).recordTransition({
      propertyId,
      toState: target.state,
      toStage: target.stage,
      actor: options?.actor ?? null,
      source: options?.source ?? "status_change",
      reason: options?.reason ?? null,
      metadata: { status: newStatus },
    });
  } catch (err) {
    // Missing 056 columns (un-migrated DB) or transient failures must never
    // break the status update itself.
    console.warn("[recordDealStageChange]", err instanceof Error ? err.message : err);
  }
}
