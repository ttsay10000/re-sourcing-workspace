import type { PoolClient } from "pg";
import type { IngestionRun, RunSummary } from "@re-sourcing/contracts";
import { mapRun } from "../map.js";

export interface RunRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface RunningRunTimeoutOptions {
  staleAfterMs?: number | null;
  maxRuntimeMs?: number | null;
  now?: Date;
}

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

function positiveMs(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function positiveMinutesToMs(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 60 * 1000);
}

function resolveStaleAfterMs(input?: number | null): number {
  return (
    positiveMs(input) ??
    positiveMs(process.env.INGESTION_RUN_STALE_AFTER_MS) ??
    positiveMinutesToMs(process.env.INGESTION_RUN_STALE_AFTER_MINUTES) ??
    positiveMs(process.env.SAVED_SEARCH_RUN_STALE_AFTER_MS) ??
    positiveMinutesToMs(process.env.SAVED_SEARCH_RUN_STALE_AFTER_MINUTES) ??
    DEFAULT_STALE_AFTER_MS
  );
}

function resolveMaxRuntimeMs(input?: number | null): number | null {
  return (
    positiveMs(input) ??
    positiveMs(process.env.INGESTION_RUN_MAX_RUNTIME_MS) ??
    positiveMinutesToMs(process.env.INGESTION_RUN_MAX_RUNTIME_MINUTES) ??
    positiveMs(process.env.SAVED_SEARCH_RUN_MAX_RUNTIME_MS) ??
    positiveMinutesToMs(process.env.SAVED_SEARCH_RUN_MAX_RUNTIME_MINUTES)
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
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

  async expireStaleRunningForProfile(
    profileId: string,
    options?: RunningRunTimeoutOptions
  ): Promise<number> {
    const staleAfterMs = resolveStaleAfterMs(options?.staleAfterMs);
    const maxRuntimeMs = resolveMaxRuntimeMs(options?.maxRuntimeMs);
    if (staleAfterMs <= 0 && (maxRuntimeMs == null || maxRuntimeMs <= 0)) return 0;

    const now = options?.now ?? new Date();
    const nowIso = now.toISOString();
    const stale = await this.client.query<{
      id: string;
      workflow_run_id: string | null;
      started_at: Date | string;
      last_heartbeat_at: Date | string | null;
      timeout_reason: "max_runtime" | "stale_heartbeat";
    }>(
      `SELECT
         r.id,
         r.metadata->>'workflowRunId' AS workflow_run_id,
         r.started_at,
         COALESCE(step.last_step_at, w.updated_at, w.started_at, r.started_at) AS last_heartbeat_at,
         CASE
           WHEN $4::double precision > 0
            AND r.started_at <= $2::timestamptz - ($4::double precision * interval '1 millisecond')
             THEN 'max_runtime'
           ELSE 'stale_heartbeat'
         END AS timeout_reason
       FROM ingestion_runs r
       LEFT JOIN workflow_runs w
         ON w.id::text = r.metadata->>'workflowRunId'
       LEFT JOIN LATERAL (
         SELECT MAX(updated_at) AS last_step_at
           FROM workflow_run_steps
          WHERE run_id = w.id
       ) step ON true
       WHERE r.profile_id = $1
         AND r.status = 'running'
         AND (
           ($4::double precision > 0
             AND r.started_at <= $2::timestamptz - ($4::double precision * interval '1 millisecond'))
           OR
           ($3::double precision > 0
             AND COALESCE(step.last_step_at, w.updated_at, w.started_at, r.started_at)
               <= $2::timestamptz - ($3::double precision * interval '1 millisecond'))
         )`,
      [profileId, nowIso, staleAfterMs, maxRuntimeMs ?? 0]
    );

    for (const row of stale.rows) {
      const message =
        row.timeout_reason === "max_runtime" && maxRuntimeMs != null
          ? `Timed out after exceeding max runtime of ${formatDuration(maxRuntimeMs)}.`
          : `Timed out after no workflow progress for ${formatDuration(staleAfterMs)}.`;
      const metadataPatch = {
        timeout: {
          reason: row.timeout_reason,
          message,
          timedOutAt: nowIso,
          staleAfterMs,
          maxRuntimeMs,
          startedAt:
            row.started_at instanceof Date
              ? row.started_at.toISOString()
              : String(row.started_at),
          lastHeartbeatAt:
            row.last_heartbeat_at instanceof Date
              ? row.last_heartbeat_at.toISOString()
              : row.last_heartbeat_at != null
                ? String(row.last_heartbeat_at)
                : null,
        },
      };
      await this.client.query(
        `UPDATE ingestion_runs
            SET status = 'failed',
                finished_at = $1,
                summary = jsonb_set(
                  jsonb_set(
                    COALESCE(summary, '{}'::jsonb),
                    '{jobsFailed}',
                    to_jsonb(GREATEST(COALESCE((summary->>'jobsFailed')::int, 0), 1)),
                    true
                  ),
                  '{errors}',
                  COALESCE(summary->'errors', '[]'::jsonb) || to_jsonb($2::text),
                  true
                ),
                metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
          WHERE id = $4
            AND status = 'running'`,
        [nowIso, message, JSON.stringify(metadataPatch), row.id]
      );
      await this.client.query(
        `UPDATE ingestion_jobs
            SET status = 'failed',
                finished_at = $1,
                error_message = COALESCE(error_message, $2)
          WHERE run_id = $3
            AND status IN ('pending', 'running')`,
        [nowIso, message, row.id]
      );
      if (row.workflow_run_id) {
        await this.client.query(
          `UPDATE workflow_runs
              SET status = 'failed',
                  finished_at = COALESCE(finished_at, $1),
                  metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                  updated_at = $1
            WHERE id::text = $3
              AND status IN ('pending', 'running')`,
          [nowIso, JSON.stringify(metadataPatch), row.workflow_run_id]
        );
        await this.client.query(
          `UPDATE workflow_run_steps
              SET status = 'failed',
                  finished_at = COALESCE(finished_at, $1),
                  last_message = COALESCE(last_message, 'Timed out after no workflow progress'),
                  last_error = COALESCE(last_error, $2),
                  updated_at = $1
            WHERE run_id::text = $3
              AND status IN ('pending', 'running')`,
          [nowIso, message, row.workflow_run_id]
        );
      }
    }

    return stale.rowCount ?? 0;
  }

  async hasRunningForProfile(profileId: string, options?: RunningRunTimeoutOptions): Promise<boolean> {
    await this.expireStaleRunningForProfile(profileId, options);
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
