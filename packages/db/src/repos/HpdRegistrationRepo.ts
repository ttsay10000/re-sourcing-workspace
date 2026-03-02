import type { PoolClient } from "pg";

const SOURCE_DATASET = "tesw-yqqr";

export interface UpsertHpdRegistrationParams {
  propertyId: string;
  bbl?: string | null;
  bin?: string | null;
  sourceRowId?: string | null;
  normalizedJson: Record<string, unknown>;
  rawJson: Record<string, unknown>;
}

export interface HpdRegistrationRow {
  id: string;
  propertyId: string;
  bbl: string | null;
  bin: string | null;
  sourceDataset: string;
  sourceRowId: string | null;
  rawJson: Record<string, unknown>;
  normalizedJson: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface HpdRegistrationRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function mapRow(row: Record<string, unknown>): HpdRegistrationRow {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    bbl: (row.bbl as string) ?? null,
    bin: (row.bin as string) ?? null,
    sourceDataset: (row.source_dataset as string) ?? SOURCE_DATASET,
    sourceRowId: (row.source_row_id as string) ?? null,
    rawJson: (row.raw_json as Record<string, unknown>) ?? {},
    normalizedJson: (row.normalized_json as Record<string, unknown>) ?? {},
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class HpdRegistrationRepo {
  constructor(private options: HpdRegistrationRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: UpsertHpdRegistrationParams): Promise<HpdRegistrationRow> {
    const r = await this.client.query(
      `INSERT INTO property_hpd_registrations (
        property_id, bbl, bin, source_dataset, source_row_id, raw_json, normalized_json, first_seen_at, last_seen_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())
      ON CONFLICT (property_id, source_dataset)
      DO UPDATE SET
        bbl = COALESCE(EXCLUDED.bbl, property_hpd_registrations.bbl),
        bin = COALESCE(EXCLUDED.bin, property_hpd_registrations.bin),
        source_row_id = COALESCE(EXCLUDED.source_row_id, property_hpd_registrations.source_row_id),
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
        params.sourceRowId ?? null,
        JSON.stringify(params.rawJson),
        JSON.stringify(params.normalizedJson),
      ]
    );
    return mapRow(r.rows[0]);
  }

  async listByPropertyId(propertyId: string): Promise<HpdRegistrationRow[]> {
    const r = await this.client.query(
      "SELECT * FROM property_hpd_registrations WHERE property_id = $1 ORDER BY updated_at DESC",
      [propertyId]
    );
    return r.rows.map(mapRow);
  }
}
