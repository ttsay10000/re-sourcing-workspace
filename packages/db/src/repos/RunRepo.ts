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

  async create(profileId: string): Promise<IngestionRun> {
    const r = await this.client.query(
      `INSERT INTO ingestion_runs (profile_id, started_at, status)
       VALUES ($1, now(), 'running')
       RETURNING *`,
      [profileId]
    );
    return mapRun(r.rows[0]);
  }

  async finish(id: string, status: "completed" | "failed" | "cancelled", summary?: RunSummary | null): Promise<IngestionRun | null> {
    const r = await this.client.query(
      `UPDATE ingestion_runs SET finished_at = now(), status = $1, summary = $2
       WHERE id = $3 RETURNING *`,
      [status, summary ? JSON.stringify(summary) : null, id]
    );
    return r.rows[0] ? mapRun(r.rows[0]) : null;
  }
}
