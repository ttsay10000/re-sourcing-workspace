import type { PoolClient } from "pg";

type JsonObject = Record<string, unknown>;

export interface PropertyRejection {
  id: string;
  propertyId: string;
  reasonCode: string;
  reasonLabel?: string | null;
  note?: string | null;
  actor?: string | null;
  source: string;
  metadata: JsonObject;
  rejectedAt: string;
  restoredAt?: string | null;
  restoredBy?: string | null;
  restoredReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RejectPropertyParams {
  propertyId: string;
  reasonCode: string;
  reasonLabel?: string | null;
  note?: string | null;
  actor?: string | null;
  source?: string | null;
  metadata?: JsonObject | null;
}

export interface RestorePropertyRejectionParams {
  actor?: string | null;
  restoredReason?: string | null;
}

export interface PropertyRejectionRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return {};
}

function mapPropertyRejection(row: Record<string, unknown>): PropertyRejection {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    reasonCode: row.reason_code as string,
    reasonLabel: (row.reason_label as string) ?? null,
    note: (row.note as string) ?? null,
    actor: (row.actor as string) ?? null,
    source: (row.source as string) ?? "user",
    metadata: toJsonObject(row.metadata),
    rejectedAt: toIso(row.rejected_at),
    restoredAt: row.restored_at != null ? toIso(row.restored_at) : null,
    restoredBy: (row.restored_by as string) ?? null,
    restoredReason: (row.restored_reason as string) ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class PropertyRejectionRepo {
  constructor(private options: PropertyRejectionRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async reject(params: RejectPropertyParams): Promise<PropertyRejection> {
    const r = await this.client.query(
      `WITH restored AS (
         UPDATE property_rejections
         SET restored_at = now(),
             restored_by = $5,
             restored_reason = 'superseded_by_new_rejection',
             updated_at = now()
         WHERE property_id = $1 AND restored_at IS NULL
         RETURNING id
       )
       INSERT INTO property_rejections (
         property_id, reason_code, reason_label, note, actor, source, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.propertyId,
        params.reasonCode,
        params.reasonLabel ?? null,
        params.note ?? null,
        params.actor ?? null,
        params.source ?? "user",
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return mapPropertyRejection(r.rows[0]);
  }

  async getActive(propertyId: string): Promise<PropertyRejection | null> {
    const r = await this.client.query(
      `SELECT * FROM property_rejections
       WHERE property_id = $1 AND restored_at IS NULL
       ORDER BY rejected_at DESC
       LIMIT 1`,
      [propertyId]
    );
    return r.rows[0] ? mapPropertyRejection(r.rows[0]) : null;
  }

  async listActiveByPropertyIds(propertyIds: string[]): Promise<PropertyRejection[]> {
    if (propertyIds.length === 0) return [];
    const r = await this.client.query(
      `SELECT * FROM property_rejections
       WHERE property_id = ANY($1::uuid[]) AND restored_at IS NULL
       ORDER BY rejected_at DESC`,
      [propertyIds]
    );
    return r.rows.map(mapPropertyRejection);
  }

  async listByPropertyId(propertyId: string, options?: { limit?: number; offset?: number }): Promise<PropertyRejection[]> {
    const values: unknown[] = [propertyId];
    let sql = "SELECT * FROM property_rejections WHERE property_id = $1 ORDER BY rejected_at DESC";
    if (options?.limit != null) {
      values.push(options.limit);
      sql += ` LIMIT $${values.length}`;
    }
    if (options?.offset != null) {
      values.push(options.offset);
      sql += ` OFFSET $${values.length}`;
    }
    const r = await this.client.query(sql, values);
    return r.rows.map(mapPropertyRejection);
  }

  async restoreActive(
    propertyId: string,
    params?: RestorePropertyRejectionParams
  ): Promise<PropertyRejection | null> {
    const r = await this.client.query(
      `UPDATE property_rejections
       SET restored_at = now(),
           restored_by = $2,
           restored_reason = $3,
           updated_at = now()
       WHERE property_id = $1 AND restored_at IS NULL
       RETURNING *`,
      [propertyId, params?.actor ?? null, params?.restoredReason ?? null]
    );
    return r.rows[0] ? mapPropertyRejection(r.rows[0]) : null;
  }

  async countsByReason(options?: { activeOnly?: boolean }): Promise<Record<string, number>> {
    const where = options?.activeOnly === false ? "" : "WHERE restored_at IS NULL";
    const r = await this.client.query<{ reason_code: string; count: string }>(
      `SELECT reason_code, COUNT(*)::text AS count
       FROM property_rejections
       ${where}
       GROUP BY reason_code`
    );
    return Object.fromEntries(r.rows.map((row) => [row.reason_code, Number(row.count)]));
  }
}
