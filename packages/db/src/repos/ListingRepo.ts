import type { PoolClient } from "pg";
import type { ListingRow, ListingNormalized } from "@re-sourcing/contracts";
import type { ListingLifecycleState } from "@re-sourcing/contracts";
import { mapListing, listingNormalizedToRow } from "../map.js";

export interface ListingRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface ListListingsFilters {
  source?: string;
  lifecycleState?: ListingLifecycleState;
  limit?: number;
  offset?: number;
}

export class ListingRepo {
  constructor(private options: ListingRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<ListingRow | null> {
    const r = await this.client.query(
      "SELECT * FROM listings WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapListing(r.rows[0]) : null;
  }

  async bySourceAndExternalId(source: string, externalId: string): Promise<ListingRow | null> {
    const r = await this.client.query(
      "SELECT * FROM listings WHERE source = $1 AND external_id = $2",
      [source, externalId]
    );
    return r.rows[0] ? mapListing(r.rows[0]) : null;
  }

  async list(filters?: ListListingsFilters): Promise<{ listings: ListingRow[]; total: number }> {
    const values: unknown[] = [];
    let i = 1;
    let sql = "SELECT * FROM listings WHERE 1=1";
    let countSql = "SELECT count(*)::int FROM listings WHERE 1=1";
    if (filters?.source) {
      sql += ` AND source = $${i}`;
      countSql += ` AND source = $${i}`;
      values.push(filters.source);
      i++;
    }
    if (filters?.lifecycleState) {
      sql += ` AND lifecycle_state = $${i}`;
      countSql += ` AND lifecycle_state = $${i}`;
      values.push(filters.lifecycleState);
      i++;
    }
    sql += " ORDER BY last_seen_at DESC";
    if (filters?.limit != null) {
      sql += ` LIMIT $${i}`;
      values.push(filters.limit);
      i++;
    }
    if (filters?.offset != null) {
      sql += ` OFFSET $${i}`;
      values.push(filters.offset);
      i++;
    }
    const [rows, countResult] = await Promise.all([
      this.client.query(sql, values),
      this.client.query(countSql, values.slice(0, values.length - (filters?.limit != null ? 1 : 0) - (filters?.offset != null ? 1 : 0))),
    ]);
    const total = (countResult.rows[0]?.count as number) ?? 0;
    return {
      listings: rows.rows.map(mapListing),
      total,
    };
  }

  /**
   * Upsert listing by (source, external_id). If exists: update normalized fields and last_seen_at.
   * If new: set first_seen_at and last_seen_at, lifecycle_state = 'active'.
   */
  async upsert(normalized: ListingNormalized): Promise<{ listing: ListingRow; created: boolean }> {
    const existing = await this.bySourceAndExternalId(normalized.source, normalized.externalId);
    const row = listingNormalizedToRow(normalized) as Record<string, unknown>;
    if (existing) {
      const r = await this.client.query(
        `UPDATE listings SET
          last_seen_at = now(),
          address = $1, city = $2, state = $3, zip = $4, price = $5, beds = $6, baths = $7,
          sqft = $8, url = $9, title = $10, description = $11, lat = $12, lon = $13,
          image_urls = $14, listed_at = $15, agent_names = $16, extra = $17, updated_at = now()
         WHERE id = $18 RETURNING *`,
        [
          row.address,
          row.city,
          row.state,
          row.zip,
          row.price,
          row.beds,
          row.baths,
          row.sqft,
          row.url,
          row.title,
          row.description,
          row.lat,
          row.lon,
          row.image_urls,
          row.listed_at,
          row.agent_names,
          row.extra,
          existing.id,
        ]
      );
      return { listing: mapListing(r.rows[0]), created: false };
    }
    const r = await this.client.query(
      `INSERT INTO listings (
        source, external_id, lifecycle_state, first_seen_at, last_seen_at,
        address, city, state, zip, price, beds, baths, sqft, url, title, description,
        lat, lon, image_urls, listed_at, agent_names, extra
      ) VALUES (
        $1, $2, 'active', now(), now(),
        $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      ) RETURNING *`,
      [
        normalized.source,
        normalized.externalId,
        row.address,
        row.city,
        row.state,
        row.zip,
        row.price,
        row.beds,
        row.baths,
        row.sqft,
        row.url,
        row.title,
        row.description,
        row.lat,
        row.lon,
        row.image_urls,
        row.listed_at,
        row.agent_names,
        row.extra,
      ]
    );
    return { listing: mapListing(r.rows[0]), created: true };
  }

  async setLifecycle(id: string, lifecycleState: ListingLifecycleState): Promise<ListingRow | null> {
    const updates: string[] = ["lifecycle_state = $1", "updated_at = now()"];
    const values: unknown[] = [lifecycleState];
    if (lifecycleState === "missing") {
      updates.push("missing_since = now()");
    } else if (lifecycleState === "pruned") {
      updates.push("pruned_at = now()");
    }
    values.push(id);
    const r = await this.client.query(
      `UPDATE listings SET ${updates.join(", ")} WHERE id = $2 RETURNING *`,
      values
    );
    return r.rows[0] ? mapListing(r.rows[0]) : null;
  }
}
