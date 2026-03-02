import type { PoolClient } from "pg";

const SOURCE_DATASET = "wvxf-dwi5";

export interface UpsertHpdViolationParams {
  propertyId: string;
  sourceRowId: string;
  bbl?: string | null;
  bin?: string | null;
  normalizedJson: Record<string, unknown>;
  rawJson: Record<string, unknown>;
}

export interface HpdViolationRow {
  id: string;
  propertyId: string;
  bbl: string | null;
  bin: string | null;
  sourceDataset: string;
  sourceRowId: string;
  rawJson: Record<string, unknown>;
  normalizedJson: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface HpdViolationsRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function mapRow(row: Record<string, unknown>): HpdViolationRow {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    bbl: (row.bbl as string) ?? null,
    bin: (row.bin as string) ?? null,
    sourceDataset: (row.source_dataset as string) ?? SOURCE_DATASET,
    sourceRowId: row.source_row_id as string,
    rawJson: (row.raw_json as Record<string, unknown>) ?? {},
    normalizedJson: (row.normalized_json as Record<string, unknown>) ?? {},
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class HpdViolationsRepo {
  constructor(private options: HpdViolationsRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: UpsertHpdViolationParams): Promise<HpdViolationRow> {
    const r = await this.client.query(
      `INSERT INTO property_hpd_violations (
        property_id, bbl, bin, source_dataset, source_row_id, raw_json, normalized_json, first_seen_at, last_seen_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())
      ON CONFLICT (property_id, source_dataset, source_row_id)
      DO UPDATE SET
        bbl = COALESCE(EXCLUDED.bbl, property_hpd_violations.bbl),
        bin = COALESCE(EXCLUDED.bin, property_hpd_violations.bin),
        raw_json = EXCLUDED.raw_json,
        normalized_json = EXCLUDED.normalized_json,
        last_seen_at = now(),
        updated_at = now()
      RETURNING *`,
      [
        params.propertyId,
        params.bbl ?? null,
        params.bin ?? null,
        SOURCE_DATASET,
        params.sourceRowId,
        JSON.stringify(params.rawJson),
        JSON.stringify(params.normalizedJson),
      ]
    );
    return mapRow(r.rows[0]);
  }

  async listByPropertyId(propertyId: string): Promise<HpdViolationRow[]> {
    const r = await this.client.query(
      "SELECT * FROM property_hpd_violations WHERE property_id = $1 ORDER BY updated_at DESC",
      [propertyId]
    );
    return r.rows.map(mapRow);
  }
}
