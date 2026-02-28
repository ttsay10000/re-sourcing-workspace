import type { PoolClient } from "pg";
import type { IngestionJob } from "@re-sourcing/contracts";
import type { ListingSource } from "@re-sourcing/contracts";
import { mapJob } from "../map.js";

export interface JobRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class JobRepo {
  constructor(private options: JobRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<IngestionJob | null> {
    const r = await this.client.query(
      "SELECT * FROM ingestion_jobs WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapJob(r.rows[0]) : null;
  }

  async listByRunId(runId: string, options?: { limit?: number; offset?: number }): Promise<IngestionJob[]> {
    let sql = "SELECT * FROM ingestion_jobs WHERE run_id = $1 ORDER BY created_at";
    const values: unknown[] = [runId];
    let i = 2;
    if (options?.limit != null) {
      sql += ` LIMIT $${i++}`;
      values.push(options.limit);
    }
    if (options?.offset != null) {
      sql += ` OFFSET $${i++}`;
      values.push(options.offset);
    }
    const r = await this.client.query(sql, values);
    return r.rows.map(mapJob);
  }

  async create(runId: string, source: ListingSource): Promise<IngestionJob> {
    const r = await this.client.query(
      `INSERT INTO ingestion_jobs (run_id, source, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [runId, source]
    );
    return mapJob(r.rows[0]);
  }

  async start(id: string): Promise<IngestionJob | null> {
    const r = await this.client.query(
      `UPDATE ingestion_jobs SET status = 'running', started_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    return r.rows[0] ? mapJob(r.rows[0]) : null;
  }

  async finish(id: string, status: "completed" | "failed", errorMessage?: string | null): Promise<IngestionJob | null> {
    const r = await this.client.query(
      `UPDATE ingestion_jobs SET status = $1, finished_at = now(), error_message = $2 WHERE id = $3 RETURNING *`,
      [status, errorMessage ?? null, id]
    );
    return r.rows[0] ? mapJob(r.rows[0]) : null;
  }
}
