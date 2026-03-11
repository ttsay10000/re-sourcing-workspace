import type { PoolClient } from "pg";
import type { DealScoreOverride } from "@re-sourcing/contracts";
import { mapDealScoreOverride } from "../map.js";

export interface DealScoreOverridesRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface UpsertDealScoreOverrideParams {
  propertyId: string;
  score: number;
  reason: string;
  createdBy?: string | null;
}

export class DealScoreOverridesRepo {
  constructor(private options: DealScoreOverridesRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async getActiveByPropertyId(propertyId: string): Promise<DealScoreOverride | null> {
    const r = await this.client.query(
      `SELECT *
       FROM deal_score_overrides
       WHERE property_id = $1 AND cleared_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [propertyId]
    );
    return r.rows[0] ? mapDealScoreOverride(r.rows[0]) : null;
  }

  async setActive(params: UpsertDealScoreOverrideParams): Promise<DealScoreOverride> {
    await this.client.query(
      `UPDATE deal_score_overrides
       SET cleared_at = now()
       WHERE property_id = $1 AND cleared_at IS NULL`,
      [params.propertyId]
    );
    const r = await this.client.query(
      `INSERT INTO deal_score_overrides (property_id, score, reason, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [params.propertyId, params.score, params.reason, params.createdBy ?? null]
    );
    return mapDealScoreOverride(r.rows[0]);
  }

  async clearActive(propertyId: string): Promise<boolean> {
    const r = await this.client.query(
      `UPDATE deal_score_overrides
       SET cleared_at = now()
       WHERE property_id = $1 AND cleared_at IS NULL`,
      [propertyId]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
