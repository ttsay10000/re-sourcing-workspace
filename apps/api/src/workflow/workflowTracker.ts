import { getPool } from "@re-sourcing/db";

export type WorkflowRunStatus = "pending" | "running" | "completed" | "failed" | "partial";
export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "partial";

export interface WorkflowBoardColumn {
  key: string;
  label: string;
  shortLabel: string;
}

export interface WorkflowRunStepSeed {
  stepKey: string;
  stepLabel?: string;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  skippedItems?: number;
  status?: WorkflowStepStatus;
  lastMessage?: string | null;
  lastError?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateWorkflowRunParams {
  runType: string;
  displayName: string;
  scopeLabel?: string | null;
  triggerSource?: string | null;
  totalItems?: number;
  status?: WorkflowRunStatus;
  metadata?: Record<string, unknown> | null;
  steps?: WorkflowRunStepSeed[];
}

export interface UpdateWorkflowRunParams {
  displayName?: string | null;
  scopeLabel?: string | null;
  totalItems?: number;
  status?: WorkflowRunStatus;
  finishedAt?: string | null;
}

export interface WorkflowBoardStep {
  key: string;
  label: string;
  status: WorkflowStepStatus;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  lastMessage: string | null;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WorkflowBoardRun {
  id: string;
  runNumber: number;
  runType: string;
  displayName: string;
  scopeLabel: string | null;
  triggerSource: string;
  totalItems: number;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string | null;
  metadata?: Record<string, unknown> | null;
  steps: WorkflowBoardStep[];
}

export const WORKFLOW_BOARD_COLUMNS: WorkflowBoardColumn[] = [
  { key: "raw_ingest", label: "Raw Ingest", shortLabel: "Raw" },
  { key: "canonical", label: "Canonical", shortLabel: "Canonical" },
  { key: "permits", label: "Permits", shortLabel: "Permits" },
  { key: "hpd_registration", label: "HPD Registration", shortLabel: "HPD Reg" },
  { key: "certificate_of_occupancy", label: "Certificate of Occupancy", shortLabel: "CO" },
  { key: "zoning_ztl", label: "Zoning", shortLabel: "Zoning" },
  { key: "dob_complaints", label: "DOB Complaints", shortLabel: "DOB" },
  { key: "hpd_violations", label: "HPD Violations", shortLabel: "HPD Viol." },
  { key: "housing_litigations", label: "Housing Litigations", shortLabel: "Litig." },
  { key: "rental_flow", label: "Rental Flow", shortLabel: "Rental" },
  { key: "om_financials", label: "OM Financials", shortLabel: "OM" },
  { key: "inquiry", label: "Inquiry", shortLabel: "Inquiry" },
  { key: "inbox", label: "Inbox", shortLabel: "Inbox" },
  { key: "dossier", label: "Dossier", shortLabel: "Dossier" },
];

const WORKFLOW_STEP_ORDER = new Map(WORKFLOW_BOARD_COLUMNS.map((column, index) => [column.key, index]));
const WORKFLOW_TRACKING_MISSING_RE =
  /relation "workflow_runs" does not exist|relation "workflow_run_steps" does not exist/i;

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function jsonOrNull(value: Record<string, unknown> | null | undefined): string | null {
  if (!value || typeof value !== "object") return null;
  return JSON.stringify(value);
}

function defaultStepLabel(stepKey: string): string {
  return WORKFLOW_BOARD_COLUMNS.find((column) => column.key === stepKey)?.label ?? stepKey;
}

function isTrackingMissing(error: unknown): boolean {
  return WORKFLOW_TRACKING_MISSING_RE.test(String(error));
}

export function workflowStepOrder(stepKey: string): number {
  return WORKFLOW_STEP_ORDER.get(stepKey) ?? WORKFLOW_BOARD_COLUMNS.length + 10;
}

export function deriveWorkflowStatusFromCounts(args: {
  totalItems: number;
  completedItems: number;
  failedItems?: number;
  skippedItems?: number;
}): WorkflowStepStatus {
  const totalItems = Math.max(0, args.totalItems);
  const completedItems = Math.max(0, args.completedItems);
  const failedItems = Math.max(0, args.failedItems ?? 0);
  const skippedItems = Math.max(0, args.skippedItems ?? 0);
  const processed = completedItems + failedItems + skippedItems;
  if (processed < totalItems) return "running";
  if (failedItems > 0 || skippedItems > 0) {
    return completedItems > 0 ? "partial" : "failed";
  }
  return "completed";
}

export async function createWorkflowRun(params: CreateWorkflowRunParams): Promise<string | null> {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO workflow_runs (
           run_type, display_name, scope_label, trigger_source, total_items, status, metadata, started_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         RETURNING id`,
        [
          params.runType,
          params.displayName,
          params.scopeLabel ?? null,
          params.triggerSource ?? "manual",
          Math.max(0, params.totalItems ?? 0),
          params.status ?? "running",
          jsonOrNull(params.metadata),
        ]
      );
      const runId = inserted.rows[0]?.id ?? null;
      if (runId && params.steps?.length) {
        for (const step of params.steps) {
          await client.query(
            `INSERT INTO workflow_run_steps (
               run_id, step_key, step_label, sort_order, total_items, completed_items, failed_items,
               skipped_items, status, last_message, last_error, metadata, started_at, finished_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14
             )`,
            [
              runId,
              step.stepKey,
              step.stepLabel ?? defaultStepLabel(step.stepKey),
              workflowStepOrder(step.stepKey),
              Math.max(0, step.totalItems ?? 0),
              Math.max(0, step.completedItems ?? 0),
              Math.max(0, step.failedItems ?? 0),
              Math.max(0, step.skippedItems ?? 0),
              step.status ?? "pending",
              step.lastMessage ?? null,
              step.lastError ?? null,
              jsonOrNull(step.metadata),
              step.startedAt ?? null,
              step.finishedAt ?? null,
            ]
          );
        }
      }
      await client.query("COMMIT");
      return runId;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (!isTrackingMissing(error)) {
        console.warn("[workflow-tracker create]", error);
      }
      return null;
    } finally {
      client.release();
    }
  } catch (error) {
    if (!isTrackingMissing(error)) {
      console.warn("[workflow-tracker create]", error);
    }
    return null;
  }
}

export async function updateWorkflowRun(runId: string | null | undefined, params: UpdateWorkflowRunParams): Promise<void> {
  if (!runId) return;
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  if ("displayName" in params) {
    fields.push(`display_name = $${index++}`);
    values.push(params.displayName ?? null);
  }
  if ("scopeLabel" in params) {
    fields.push(`scope_label = $${index++}`);
    values.push(params.scopeLabel ?? null);
  }
  if ("totalItems" in params) {
    fields.push(`total_items = $${index++}`);
    values.push(Math.max(0, params.totalItems ?? 0));
  }
  if ("status" in params) {
    fields.push(`status = $${index++}`);
    values.push(params.status ?? "running");
  }
  if ("finishedAt" in params) {
    fields.push(`finished_at = $${index++}`);
    values.push(params.finishedAt ?? null);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = now()");
  values.push(runId);
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE workflow_runs SET ${fields.join(", ")} WHERE id = $${index}`,
      values
    );
  } catch (error) {
    if (!isTrackingMissing(error)) {
      console.warn("[workflow-tracker update-run]", error);
    }
  }
}

export async function mergeWorkflowRunMetadata(
  runId: string | null | undefined,
  metadataPatch: Record<string, unknown> | null | undefined
): Promise<void> {
  if (!runId || !metadataPatch || typeof metadataPatch !== "object") return;
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE workflow_runs
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
             updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(metadataPatch), runId]
    );
  } catch (error) {
    if (!isTrackingMissing(error)) {
      console.warn("[workflow-tracker merge-metadata]", error);
    }
  }
}

export async function upsertWorkflowStep(
  runId: string | null | undefined,
  step: WorkflowRunStepSeed
): Promise<void> {
  if (!runId) return;
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO workflow_run_steps (
         run_id, step_key, step_label, sort_order, total_items, completed_items, failed_items,
         skipped_items, status, last_message, last_error, metadata, started_at, finished_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14
       )
       ON CONFLICT (run_id, step_key)
       DO UPDATE SET
         step_label = EXCLUDED.step_label,
         sort_order = EXCLUDED.sort_order,
         total_items = EXCLUDED.total_items,
         completed_items = EXCLUDED.completed_items,
         failed_items = EXCLUDED.failed_items,
         skipped_items = EXCLUDED.skipped_items,
         status = EXCLUDED.status,
         last_message = COALESCE(EXCLUDED.last_message, workflow_run_steps.last_message),
         last_error = COALESCE(EXCLUDED.last_error, workflow_run_steps.last_error),
         metadata = COALESCE(EXCLUDED.metadata, workflow_run_steps.metadata),
         started_at = COALESCE(EXCLUDED.started_at, workflow_run_steps.started_at),
         finished_at = COALESCE(EXCLUDED.finished_at, workflow_run_steps.finished_at),
         updated_at = now()`,
      [
        runId,
        step.stepKey,
        step.stepLabel ?? defaultStepLabel(step.stepKey),
        workflowStepOrder(step.stepKey),
        Math.max(0, step.totalItems ?? 0),
        Math.max(0, step.completedItems ?? 0),
        Math.max(0, step.failedItems ?? 0),
        Math.max(0, step.skippedItems ?? 0),
        step.status ?? "pending",
        step.lastMessage ?? null,
        step.lastError ?? null,
        jsonOrNull(step.metadata),
        step.startedAt ?? null,
        step.finishedAt ?? null,
      ]
    );
  } catch (error) {
    if (!isTrackingMissing(error)) {
      console.warn("[workflow-tracker upsert-step]", error);
    }
  }
}

export async function listWorkflowRuns(limit = 40): Promise<WorkflowBoardRun[]> {
  try {
    const pool = getPool();
    const runResult = await pool.query<Record<string, unknown>>(
      `SELECT *
         FROM workflow_runs
        ORDER BY started_at DESC
        LIMIT $1`,
      [Math.max(1, limit)]
    );
    const runs = runResult.rows;
    if (runs.length === 0) return [];
    const runIds = runs.map((row) => row.id as string);
    const stepResult = await pool.query<Record<string, unknown>>(
      `SELECT *
         FROM workflow_run_steps
        WHERE run_id = ANY($1::uuid[])
        ORDER BY sort_order ASC, created_at ASC`,
      [runIds]
    );
    const stepsByRunId = new Map<string, WorkflowBoardStep[]>();
    for (const row of stepResult.rows) {
      const runId = row.run_id as string;
      const list = stepsByRunId.get(runId) ?? [];
      list.push({
        key: row.step_key as string,
        label: row.step_label as string,
        status: (row.status as WorkflowStepStatus) ?? "pending",
        totalItems: Number(row.total_items ?? 0),
        completedItems: Number(row.completed_items ?? 0),
        failedItems: Number(row.failed_items ?? 0),
        skippedItems: Number(row.skipped_items ?? 0),
        lastMessage: (row.last_message as string) ?? null,
        lastError: (row.last_error as string) ?? null,
        startedAt: toIso(row.started_at),
        finishedAt: toIso(row.finished_at),
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      });
      stepsByRunId.set(runId, list);
    }
    return runs.map((row) => ({
      id: row.id as string,
      runNumber: Number(row.run_number ?? 0),
      runType: row.run_type as string,
      displayName: row.display_name as string,
      scopeLabel: (row.scope_label as string) ?? null,
      triggerSource: (row.trigger_source as string) ?? "manual",
      totalItems: Number(row.total_items ?? 0),
      status: (row.status as WorkflowRunStatus) ?? "running",
      startedAt: toIso(row.started_at) ?? new Date().toISOString(),
      finishedAt: toIso(row.finished_at),
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      steps: stepsByRunId.get(row.id as string) ?? [],
    }));
  } catch (error) {
    if (!isTrackingMissing(error)) {
      console.warn("[workflow-tracker list]", error);
    }
    return [];
  }
}
