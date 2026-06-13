import type { Pool, PoolClient } from "pg";
import { DEAL_FLOW_STAGES, type DealFlowStageId } from "@re-sourcing/contracts";

export type DealState = "active" | "dead" | "closed";

export const DEAL_STAGES = [
  ...DEAL_FLOW_STAGES.map((stage) => stage.id),
] as readonly DealFlowStageId[];

export type DealStage = DealFlowStageId;

export interface StageTransition {
  id: string;
  propertyId: string;
  fromState: string | null;
  fromStage: string | null;
  toState: DealState;
  toStage: DealStage;
  actor: string | null;
  source: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export interface RecordStageTransitionParams {
  propertyId: string;
  toState: DealState;
  toStage: DealStage;
  actor?: string | null;
  source?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface StageTransitionRepoOptions {
  client?: PoolClient;
  pool: Pool;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function mapRow(row: Record<string, unknown>): StageTransition {
  return {
    id: String(row.id),
    propertyId: String(row.property_id),
    fromState: (row.from_state as string | null) ?? null,
    fromStage: (row.from_stage as string | null) ?? null,
    toState: row.to_state as DealState,
    toStage: row.to_stage as DealStage,
    actor: (row.actor as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    occurredAt: toIso(row.occurred_at),
  };
}

export function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && (DEAL_STAGES as readonly string[]).includes(value);
}

export function isDealState(value: unknown): value is DealState {
  return value === "active" || value === "dead" || value === "closed";
}

export class StageTransitionRepo {
  private readonly db: Pool | PoolClient;

  constructor(options: StageTransitionRepoOptions) {
    this.db = options.client ?? options.pool;
  }

  /**
   * Records a transition and updates the property's canonical stage columns in
   * one transaction-friendly statement pair. Returns the transition row, or
   * null when the property is already in the requested state+stage (no-op).
   */
  async recordTransition(params: RecordStageTransitionParams): Promise<StageTransition | null> {
    const current = await this.db.query(
      `SELECT deal_state, deal_stage FROM properties WHERE id = $1`,
      [params.propertyId]
    );
    if (current.rowCount === 0) throw new Error("Property not found");
    const fromState = (current.rows[0].deal_state as string | null) ?? null;
    const fromStage = (current.rows[0].deal_stage as string | null) ?? null;
    if (fromState === params.toState && fromStage === params.toStage) return null;

    await this.db.query(
      `UPDATE properties
         SET deal_state = $2,
             deal_stage = $3,
             stage_entered_at = now(),
             stage_order = NULL,
             updated_at = now()
       WHERE id = $1`,
      [params.propertyId, params.toState, params.toStage]
    );

    const inserted = await this.db.query(
      `INSERT INTO stage_transitions (
         property_id, from_state, from_stage, to_state, to_stage, actor, source, reason, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.propertyId,
        fromState,
        fromStage,
        params.toState,
        params.toStage,
        params.actor ?? null,
        params.source ?? null,
        params.reason ?? null,
        params.metadata != null ? JSON.stringify(params.metadata) : null,
      ]
    );
    return mapRow(inserted.rows[0]);
  }

  async listByPropertyId(propertyId: string, limit = 50): Promise<StageTransition[]> {
    const result = await this.db.query(
      `SELECT * FROM stage_transitions WHERE property_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [propertyId, Math.max(1, Math.min(limit, 500))]
    );
    return result.rows.map(mapRow);
  }

  /** Days each active property has spent in its current stage (for aging chips). */
  async stageAgingDays(propertyId: string): Promise<number | null> {
    const result = await this.db.query(
      `SELECT EXTRACT(EPOCH FROM (now() - stage_entered_at)) / 86400 AS days
         FROM properties WHERE id = $1 AND stage_entered_at IS NOT NULL`,
      [propertyId]
    );
    const days = result.rows[0]?.days;
    return days != null ? Math.floor(Number(days)) : null;
  }
}
