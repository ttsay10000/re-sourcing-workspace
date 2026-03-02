import type { PoolClient } from "pg";
import type { ListingSnapshot, SnapshotMetadata } from "@re-sourcing/contracts";
import { mapSnapshot } from "../map.js";

export interface SnapshotRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface ListSnapshotsFilters {
  listingId?: string;
  runId?: string;
  includePruned?: boolean;
  limit?: number;
  offset?: number;
}

export class SnapshotRepo {
  constructor(private options: SnapshotRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<ListingSnapshot | null> {
    const r = await this.client.query(
      "SELECT * FROM listing_snapshots WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapSnapshot(r.rows[0]) : null;
  }

  async list(filters?: ListSnapshotsFilters): Promise<{ snapshots: ListingSnapshot[]; total: number }> {
    const values: unknown[] = [];
    let i = 1;
    let sql = "SELECT * FROM listing_snapshots WHERE 1=1";
    let countSql = "SELECT count(*)::int FROM listing_snapshots WHERE 1=1";
    if (filters?.listingId) {
      sql += ` AND listing_id = $${i}`;
      countSql += ` AND listing_id = $${i}`;
      values.push(filters.listingId);
      i++;
    }
    if (filters?.runId) {
      sql += ` AND run_id = $${i}`;
      countSql += ` AND run_id = $${i}`;
      values.push(filters.runId);
      i++;
    }
    if (!filters?.includePruned) {
      sql += " AND pruned = false";
      countSql += " AND pruned = false";
    }
    sql += " ORDER BY captured_at DESC";
    const countValues = [...values];
    if (filters?.limit != null) {
      sql += ` LIMIT $${i}`;
      values.push(filters.limit);
      i++;
    }
    if (filters?.offset != null) {
      sql += ` OFFSET $${i}`;
      values.push(filters.offset);
    }
    const [rows, countResult] = await Promise.all([
      this.client.query(sql, values),
      this.client.query(countSql, countValues),
    ]);
    const total = (countResult.rows[0]?.count as number) ?? 0;
    return {
      snapshots: rows.rows.map(mapSnapshot),
      total,
    };
  }

  async create(params: {
    listingId: string;
    runId?: string | null;
    rawPayloadPath: string;
    metadata?: SnapshotMetadata;
  }): Promise<ListingSnapshot> {
    let metadataJson = "{}";
    try {
      metadataJson = JSON.stringify(params.metadata ?? {});
      if (typeof metadataJson !== "string" || metadataJson.trim() === "") {
        metadataJson = "{}";
      }
    } catch {
      metadataJson = "{}";
    }
    const r = await this.client.query(
      `INSERT INTO listing_snapshots (listing_id, run_id, raw_payload_path, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        params.listingId,
        params.runId ?? null,
        params.rawPayloadPath,
        metadataJson,
      ]
    );
    return mapSnapshot(r.rows[0]);
  }

  async setPruned(id: string, pruned: boolean): Promise<ListingSnapshot | null> {
    const r = await this.client.query(
      "UPDATE listing_snapshots SET pruned = $1 WHERE id = $2 RETURNING *",
      [pruned, id]
    );
    return r.rows[0] ? mapSnapshot(r.rows[0]) : null;
  }
}
