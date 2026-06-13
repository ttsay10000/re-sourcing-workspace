import type { Pool } from "pg";

type PropertyStateRow = {
  id: string;
  deal_state: string | null;
  details: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isDeadOrRejectedPropertyState(row: Pick<PropertyStateRow, "deal_state" | "details">): boolean {
  if (row.deal_state === "dead") return true;
  const pipeline = isRecord(row.details?.pipeline) ? row.details.pipeline : {};
  const status = stringOrNull(pipeline.status);
  const uiStatus = stringOrNull(pipeline.uiV2Status);
  return (
    status === "rejected_removed" ||
    uiStatus === "rejected" ||
    uiStatus === "archived" ||
    stringOrNull(pipeline.rejectedAt) != null
  );
}

export async function filterActivePropertyIds(
  pool: Pool,
  propertyIds: string[]
): Promise<{ activePropertyIds: string[]; skippedDeadPropertyIds: string[] }> {
  const uniqueIds = [...new Set(propertyIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return { activePropertyIds: [], skippedDeadPropertyIds: [] };
  const result = await pool.query<PropertyStateRow>(
    `SELECT id, deal_state, details
     FROM properties
     WHERE id = ANY($1::text[])`,
    [uniqueIds]
  );
  const deadIds = new Set(
    result.rows
      .filter((row) => isDeadOrRejectedPropertyState(row))
      .map((row) => row.id)
  );
  return {
    activePropertyIds: uniqueIds.filter((id) => !deadIds.has(id)),
    skippedDeadPropertyIds: uniqueIds.filter((id) => deadIds.has(id)),
  };
}

export async function ensurePropertyRefreshable(pool: Pool, propertyId: string, actionLabel: string): Promise<void> {
  const result = await pool.query<PropertyStateRow>(
    `SELECT id, deal_state, details
     FROM properties
     WHERE id = $1`,
    [propertyId]
  );
  const row = result.rows[0] ?? null;
  if (row && isDeadOrRejectedPropertyState(row)) {
    const err = new Error(`Property is rejected/dead. Restore it before ${actionLabel}.`);
    (err as Error & { code?: string }).code = "property_dead";
    throw err;
  }
}
