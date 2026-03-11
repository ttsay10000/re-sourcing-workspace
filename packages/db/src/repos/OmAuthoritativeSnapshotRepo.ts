import type {
  OmAuthoritativeSnapshot,
  OmAuthoritativeSnapshotRecord,
} from "@re-sourcing/contracts";
import type { PoolClient } from "pg";
import { mapOmAuthoritativeSnapshotRecord } from "../map.js";

export interface OmAuthoritativeSnapshotRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface PromoteOmAuthoritativeSnapshotParams {
  propertyId: string;
  runId: string;
  sourceDocumentId?: string | null;
  snapshotVersion?: number | null;
  snapshot: OmAuthoritativeSnapshot;
}

export class OmAuthoritativeSnapshotRepo {
  constructor(private options: OmAuthoritativeSnapshotRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async getActiveByPropertyId(propertyId: string): Promise<OmAuthoritativeSnapshotRecord | null> {
    const r = await this.client.query(
      `SELECT * FROM om_authoritative_snapshots
       WHERE property_id = $1 AND is_active = true
       ORDER BY created_at DESC
       LIMIT 1`,
      [propertyId]
    );
    return r.rows[0] ? mapOmAuthoritativeSnapshotRecord(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string, limit = 10): Promise<OmAuthoritativeSnapshotRecord[]> {
    const r = await this.client.query(
      `SELECT * FROM om_authoritative_snapshots
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [propertyId, limit]
    );
    return r.rows.map((row: Record<string, unknown>) => mapOmAuthoritativeSnapshotRecord(row));
  }

  async promote(
    params: PromoteOmAuthoritativeSnapshotParams
  ): Promise<OmAuthoritativeSnapshotRecord> {
    await this.client.query(
      `UPDATE om_authoritative_snapshots
       SET is_active = false,
           updated_at = now()
       WHERE property_id = $1 AND is_active = true`,
      [params.propertyId]
    );

    const r = await this.client.query(
      `INSERT INTO om_authoritative_snapshots (
        property_id,
        run_id,
        source_document_id,
        snapshot_version,
        snapshot,
        is_active
      ) VALUES ($1, $2, $3, $4, $5::jsonb, true)
      ON CONFLICT (run_id) DO UPDATE SET
        property_id = EXCLUDED.property_id,
        source_document_id = EXCLUDED.source_document_id,
        snapshot_version = EXCLUDED.snapshot_version,
        snapshot = EXCLUDED.snapshot,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      RETURNING *`,
      [
        params.propertyId,
        params.runId,
        params.sourceDocumentId ?? null,
        params.snapshotVersion ?? 2,
        JSON.stringify(params.snapshot),
      ]
    );
    return mapOmAuthoritativeSnapshotRecord(r.rows[0]);
  }
}
