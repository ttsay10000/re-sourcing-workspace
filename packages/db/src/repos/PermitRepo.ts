import type { PoolClient } from "pg";

export const PERMIT_SOURCE = "dob_build_rbx6_tga4";

export interface UpsertPermitParams {
  propertyId: string;
  source: string;
  workPermit: string;
  sequenceNumber?: number | null;
  trackingNumber?: string | null;
  bbl?: string | null;
  status?: string | null;
  issuedDate?: string | null;
  approvedDate?: string | null;
  expiredDate?: string | null;
  normalizedJson: Record<string, unknown>;
  rawJson: Record<string, unknown>;
}

export interface PermitRow {
  id: string;
  propertyId: string;
  source: string;
  workPermit: string;
  sequenceNumber: number | null;
  trackingNumber: string | null;
  bbl: string | null;
  status: string | null;
  issuedDate: string | null;
  approvedDate: string | null;
  expiredDate: string | null;
  normalizedJson: Record<string, unknown>;
  rawJson: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface PermitRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function mapPermit(row: Record<string, unknown>): PermitRow {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    source: row.source as string,
    workPermit: row.work_permit as string,
    sequenceNumber: row.sequence_number != null ? Number(row.sequence_number) : null,
    trackingNumber: (row.tracking_number as string) ?? null,
    bbl: (row.bbl as string) ?? null,
    status: (row.status as string) ?? null,
    issuedDate: row.issued_date != null ? toIso(row.issued_date) : null,
    approvedDate: row.approved_date != null ? toIso(row.approved_date) : null,
    expiredDate: row.expired_date != null ? toIso(row.expired_date) : null,
    normalizedJson: (row.normalized_json as Record<string, unknown>) ?? {},
    rawJson: (row.raw_json as Record<string, unknown>) ?? {},
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class PermitRepo {
  constructor(private options: PermitRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: UpsertPermitParams): Promise<PermitRow> {
    const r = await this.client.query(
      `INSERT INTO property_permits (
        property_id, source, work_permit, sequence_number, tracking_number,
        bbl, status, issued_date, approved_date, expired_date,
        normalized_json, raw_json, first_seen_at, last_seen_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now(), now())
      ON CONFLICT (property_id, source, work_permit)
      DO UPDATE SET
        sequence_number = COALESCE(EXCLUDED.sequence_number, property_permits.sequence_number),
        tracking_number = COALESCE(EXCLUDED.tracking_number, property_permits.tracking_number),
        bbl = COALESCE(EXCLUDED.bbl, property_permits.bbl),
        status = EXCLUDED.status,
        issued_date = EXCLUDED.issued_date,
        approved_date = EXCLUDED.approved_date,
        expired_date = EXCLUDED.expired_date,
        normalized_json = EXCLUDED.normalized_json,
        raw_json = EXCLUDED.raw_json,
        last_seen_at = now(),
        updated_at = now()
      RETURNING *`,
      [
        params.propertyId,
        params.source,
        params.workPermit,
        params.sequenceNumber ?? null,
        params.trackingNumber ?? null,
        params.bbl ?? null,
        params.status ?? null,
        params.issuedDate ?? null,
        params.approvedDate ?? null,
        params.expiredDate ?? null,
        JSON.stringify(params.normalizedJson),
        JSON.stringify(params.rawJson),
      ]
    );
    return mapPermit(r.rows[0]);
  }

  async listByPropertyId(propertyId: string): Promise<PermitRow[]> {
    const r = await this.client.query(
      "SELECT * FROM property_permits WHERE property_id = $1 ORDER BY issued_date DESC NULLS LAST, approved_date DESC NULLS LAST",
      [propertyId]
    );
    return r.rows.map(mapPermit);
  }
}
