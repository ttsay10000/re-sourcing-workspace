import type { PoolClient } from "pg";
import type { ListingPropertyMatch, DedupeReasons } from "@re-sourcing/contracts";
import type { MatchStatus } from "@re-sourcing/contracts";
import { mapMatch } from "../map.js";

export interface MatchRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface ListMatchesFilters {
  listingId?: string;
  propertyId?: string;
  status?: MatchStatus;
  limit?: number;
  offset?: number;
}

export class MatchRepo {
  constructor(private options: MatchRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<ListingPropertyMatch | null> {
    const r = await this.client.query(
      "SELECT * FROM listing_property_matches WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapMatch(r.rows[0]) : null;
  }

  async list(filters?: ListMatchesFilters): Promise<{ matches: ListingPropertyMatch[]; total: number }> {
    const values: unknown[] = [];
    let i = 1;
    let sql = "SELECT * FROM listing_property_matches WHERE 1=1";
    let countSql = "SELECT count(*)::int FROM listing_property_matches WHERE 1=1";
    if (filters?.listingId) {
      sql += ` AND listing_id = $${i}`;
      countSql += ` AND listing_id = $${i}`;
      values.push(filters.listingId);
      i++;
    }
    if (filters?.propertyId) {
      sql += ` AND property_id = $${i}`;
      countSql += ` AND property_id = $${i}`;
      values.push(filters.propertyId);
      i++;
    }
    if (filters?.status) {
      sql += ` AND status = $${i}`;
      countSql += ` AND status = $${i}`;
      values.push(filters.status);
      i++;
    }
    sql += " ORDER BY confidence DESC, created_at DESC";
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
      matches: rows.rows.map(mapMatch),
      total,
    };
  }

  async create(params: {
    listingId: string;
    propertyId: string;
    confidence: number;
    reasons: DedupeReasons;
  }): Promise<ListingPropertyMatch> {
    const r = await this.client.query(
      `INSERT INTO listing_property_matches (listing_id, property_id, confidence, reasons, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (listing_id, property_id) DO UPDATE SET confidence = EXCLUDED.confidence, reasons = EXCLUDED.reasons
       RETURNING *`,
      [params.listingId, params.propertyId, params.confidence, JSON.stringify(params.reasons)]
    );
    return mapMatch(r.rows[0]);
  }

  async updateStatus(id: string, status: MatchStatus): Promise<ListingPropertyMatch | null> {
    const r = await this.client.query(
      "UPDATE listing_property_matches SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );
    return r.rows[0] ? mapMatch(r.rows[0]) : null;
  }
}
