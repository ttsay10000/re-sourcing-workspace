/**
 * Global activity feed: user/system actions (OM uploads, property creates,
 * dossier generations, imports, rejections) from property_pipeline_events,
 * merged with workflow runs (listing refreshes, enrichment, rental pulls).
 * Backs the /activity page's filterable record keeper.
 */

import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";

const router = Router();

type ActivityRunStep = {
  label?: unknown;
  status?: unknown;
  totalItems?: unknown;
  completedItems?: unknown;
  failedItems?: unknown;
  skippedItems?: unknown;
};

export interface ActivityFeedItem {
  /** "event" = property_pipeline_events row, "run" = workflow_runs row. */
  kind: "event" | "run";
  id: string;
  type: string;
  title: string;
  body: string | null;
  actor: string | null;
  source: string | null;
  /** Workflow runs only: running/completed/failed/partial. */
  status: string | null;
  propertyId: string | null;
  address: string | null;
  createdAt: string;
  runSteps?: Array<{
    label: string;
    status: string | null;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    skippedItems: number;
  }>;
}

function csvParam(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
}

/** GET /api/ui-v2/activity?limit=&before=&types=a,b&kinds=event,run&q= */
router.get("/ui-v2/activity", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 100;
    const before = typeof req.query.before === "string" && req.query.before.trim() ? req.query.before.trim() : null;
    const types = csvParam(req.query.types);
    const kinds = csvParam(req.query.kinds).filter((kind) => kind === "event" || kind === "run");
    const q = typeof req.query.q === "string" && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;

    const predicates: string[] = ["1=1"];
    const values: unknown[] = [];
    if (types.length > 0) {
      values.push(types);
      predicates.push(`feed.type = ANY($${values.length}::text[])`);
    }
    if (kinds.length > 0) {
      values.push(kinds);
      predicates.push(`feed.kind = ANY($${values.length}::text[])`);
    }
    if (before) {
      values.push(before);
      predicates.push(`feed.created_at < $${values.length}`);
    }
    if (q) {
      values.push(q);
      const param = `$${values.length}`;
      predicates.push(
        `(feed.title ILIKE ${param} OR feed.body ILIKE ${param} OR feed.address ILIKE ${param} OR feed.type ILIKE ${param})`
      );
    }
    values.push(limit);

    const result = await pool.query(
      `SELECT feed.* FROM (
         SELECT
           'event'::text AS kind,
           e.id::text AS id,
           e.event_type AS type,
           e.title,
           e.body,
           e.actor,
           e.source,
           NULL::text AS status,
           e.property_id::text AS property_id,
           p.canonical_address AS address,
           e.created_at,
           NULL::jsonb AS run_steps
         FROM property_pipeline_events e
         JOIN properties p ON p.id = e.property_id
         UNION ALL
         SELECT
           'run'::text AS kind,
           r.id::text AS id,
           r.run_type AS type,
           r.display_name AS title,
           r.scope_label AS body,
           r.trigger_source AS actor,
           'workflow'::text AS source,
           r.status,
           NULL::text AS property_id,
           NULL::text AS address,
           r.started_at AS created_at,
           COALESCE((
             SELECT jsonb_agg(
               jsonb_build_object(
                 'label', s.step_label,
                 'status', s.status,
                 'totalItems', s.total_items,
                 'completedItems', s.completed_items,
                 'failedItems', s.failed_items,
                 'skippedItems', s.skipped_items
               )
               ORDER BY s.sort_order
             )
             FROM workflow_run_steps s
             WHERE s.run_id = r.id
           ), '[]'::jsonb) AS run_steps
         FROM workflow_runs r
       ) feed
       WHERE ${predicates.join(" AND ")}
       ORDER BY feed.created_at DESC
       LIMIT $${values.length}`,
      values
    );

    const items: ActivityFeedItem[] = result.rows.map((row) => ({
      kind: row.kind === "run" ? "run" : "event",
      id: String(row.id),
      type: String(row.type ?? ""),
      title: String(row.title ?? ""),
      body: (row.body as string | null) ?? null,
      actor: (row.actor as string | null) ?? null,
      source: (row.source as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      propertyId: (row.property_id as string | null) ?? null,
      address: (row.address as string | null) ?? null,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
      runSteps:
        row.kind === "run" && Array.isArray(row.run_steps)
          ? row.run_steps.map((step: ActivityRunStep) => ({
              label: String(step?.label ?? "Stage"),
              status: typeof step?.status === "string" ? step.status : null,
              totalItems: Number(step?.totalItems ?? 0),
              completedItems: Number(step?.completedItems ?? 0),
              failedItems: Number(step?.failedItems ?? 0),
              skippedItems: Number(step?.skippedItems ?? 0),
            }))
          : undefined,
    }));
    const nextBefore = items.length === limit ? items[items.length - 1]!.createdAt : null;
    res.json({ items, nextBefore });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ui-v2 activity]", err);
    res.status(503).json({ error: "Failed to load the activity feed.", details: message });
  }
});

export default router;
