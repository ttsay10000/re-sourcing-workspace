import type { PoolClient } from "pg";
import type { IngestionRun, RunSummary } from "@re-sourcing/contracts";
import { mapRun } from "../map.js";

export interface RunRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class RunRepo {
  constructor(private options: RunRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<IngestionRun | null> {
    const r = await this.client.query(
      "SELECT * FROM ingestion_runs WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapRun(r.rows[0]) : null;
  }

  async list(options?: { profileId?: string; limit?: number; offset?: number }): Promise<IngestionRun[]> {
    let sql = "SELECT * FROM ingestion_runs WHERE 1=1";
    const values: unknown[] = [];
    let i = 1;
    if (options?.profileId) {
      sql += ` AND profile_id = $${i++}`;
      values.push(options.profileId);
    }
    sql += " ORDER BY started_at DESC";
    if (options?.limit != null) {
      sql += ` LIMIT $${i++}`;
      values.push(options.limit);
    }
    if (options?.offset != null) {
      sql += ` OFFSET $${i++}`;
      values.push(options.offset);
    }
    const r = await this.client.query(sql, values);
    return r.rows.map(mapRun);
  }

  async create(
    profileId: string,
    options?: { triggerSource?: string; metadata?: Record<string, unknown> | null }
  ): Promise<IngestionRun> {
    const r = await this.client.query(
      `INSERT INTO ingestion_runs (profile_id, started_at, status, trigger_source, metadata)
       VALUES ($1, now(), 'running', $2, $3)
       RETURNING *`,
      [profileId, options?.triggerSource ?? "manual", JSON.stringify(options?.metadata ?? {})]
    );
    return mapRun(r.rows[0]);
  }

  async hasRunningForProfile(profileId: string): Promise<boolean> {
    const r = await this.client.query(
      `SELECT 1
         FROM ingestion_runs
        WHERE profile_id = $1
          AND status = 'running'
        LIMIT 1`,
      [profileId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async finish(
    id: string,
    status: "completed" | "failed" | "cancelled",
    summary?: RunSummary | null,
    metadata?: Record<string, unknown> | null
  ): Promise<IngestionRun | null> {
    const r = await this.client.query(
      `UPDATE ingestion_runs
       SET finished_at = now(),
           status = $1,
           summary = $2,
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
       WHERE id = $4
       RETURNING *`,
      [status, summary ? JSON.stringify(summary) : null, JSON.stringify(metadata ?? {}), id]
    );
    return r.rows[0] ? mapRun(r.rows[0]) : null;
  }
}
