import type { OmAuthoritativeSnapshot } from "@re-sourcing/contracts";
import type { PoolClient } from "pg";

export interface OmExtractedSnapshotRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface OmExtractedSnapshotRecord {
  id: string;
  runId: string;
  propertyId: string;
  extractionMethod: string | null;
  snapshot: OmAuthoritativeSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertOmExtractedSnapshotParams {
  runId: string;
  propertyId: string;
  extractionMethod: string | null;
  snapshot: OmAuthoritativeSnapshot;
}

function toIso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapOmExtractedSnapshotRecord(row: Record<string, unknown>): OmExtractedSnapshotRecord {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    propertyId: row.property_id as string,
    extractionMethod: (row.extraction_method as string) ?? null,
    snapshot: row.snapshot as OmAuthoritativeSnapshot,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class OmExtractedSnapshotRepo {
  constructor(private options: OmExtractedSnapshotRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: UpsertOmExtractedSnapshotParams): Promise<OmExtractedSnapshotRecord> {
    const r = await this.client.query(
      `INSERT INTO om_extracted_snapshots (run_id, property_id, extraction_method, snapshot)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (run_id) DO UPDATE SET
         property_id = EXCLUDED.property_id,
         extraction_method = EXCLUDED.extraction_method,
         snapshot = EXCLUDED.snapshot,
         updated_at = now()
       RETURNING *`,
      [
        params.runId,
        params.propertyId,
        params.extractionMethod,
        JSON.stringify(params.snapshot),
      ]
    );
    return mapOmExtractedSnapshotRecord(r.rows[0]);
  }

  async getByRunId(runId: string): Promise<OmExtractedSnapshotRecord | null> {
    const r = await this.client.query(
      `SELECT * FROM om_extracted_snapshots
       WHERE run_id = $1
       LIMIT 1`,
      [runId]
    );
    return r.rows[0] ? mapOmExtractedSnapshotRecord(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string, limit = 20): Promise<OmExtractedSnapshotRecord[]> {
    const r = await this.client.query(
      `SELECT * FROM om_extracted_snapshots
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [propertyId, limit]
    );
    return r.rows.map((row: Record<string, unknown>) => mapOmExtractedSnapshotRecord(row));
  }
}
