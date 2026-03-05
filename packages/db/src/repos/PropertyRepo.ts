import type { PoolClient } from "pg";
import type { Property } from "@re-sourcing/contracts";
import { mapProperty } from "../map.js";

export interface PropertyRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class PropertyRepo {
  constructor(private options: PropertyRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<Property | null> {
    const r = await this.client.query(
      "SELECT * FROM properties WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapProperty(r.rows[0]) : null;
  }

  async byCanonicalAddress(canonicalAddress: string): Promise<Property | null> {
    const r = await this.client.query(
      "SELECT * FROM properties WHERE canonical_address = $1",
      [canonicalAddress]
    );
    return r.rows[0] ? mapProperty(r.rows[0]) : null;
  }

  /**
   * All normalized address first lines (trim + collapse spaces), for matching subjects that just contain the address.
   */
  async listAddressFirstLines(): Promise<string[]> {
    const r = await this.client.query<{ first_line: string }>(
      `SELECT DISTINCT TRIM(REGEXP_REPLACE(SPLIT_PART(canonical_address, ',', 1), '\\s+', ' ', 'g')) AS first_line
       FROM properties
       WHERE canonical_address IS NOT NULL AND TRIM(canonical_address) <> ''`
    );
    return r.rows.map((row) => row.first_line).filter((s) => s.length > 0);
  }

  /**
   * Find property by exact canonical_address or by first line of address (before first comma).
   * NormalizedFirstLine should be trim + collapse spaces, e.g. "416 West 20th Street".
   */
  async findByAddressFirstLine(normalizedFirstLine: string): Promise<Property | null> {
    if (!normalizedFirstLine.trim()) return null;
    const r = await this.client.query(
      `SELECT * FROM properties
       WHERE canonical_address = $1
          OR LOWER(TRIM(REGEXP_REPLACE(SPLIT_PART(canonical_address, ',', 1), '\\s+', ' ', 'g'))) = LOWER(TRIM($2))
       LIMIT 1`,
      [normalizedFirstLine, normalizedFirstLine]
    );
    return r.rows[0] ? mapProperty(r.rows[0]) : null;
  }

  async list(options?: { limit?: number; offset?: number }): Promise<Property[]> {
    let sql = "SELECT * FROM properties ORDER BY updated_at DESC";
    const values: unknown[] = [];
    let i = 1;
    if (options?.limit != null) {
      sql += ` LIMIT $${i++}`;
      values.push(options.limit);
    }
    if (options?.offset != null) {
      sql += ` OFFSET $${i++}`;
      values.push(options.offset);
    }
    const r = await this.client.query(sql, values);
    return r.rows.map(mapProperty);
  }

  async create(canonicalAddress: string): Promise<Property> {
    const r = await this.client.query(
      `INSERT INTO properties (canonical_address)
       VALUES ($1)
       ON CONFLICT (canonical_address) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [canonicalAddress]
    );
    return mapProperty(r.rows[0]);
  }

  /**
   * Merge a nested value into properties.details (e.g. enrichment.permits_summary).
   * Path is dot-separated; preserves other keys. Use mergeDetails for root-level merge.
   * Uses single-level jsonb_set and merges into parent for two-level paths (e.g. enrichment.zoning)
   * so that sibling keys under the parent are preserved.
   */
  async updateDetails(
    propertyId: string,
    path: string,
    value: Record<string, unknown>
  ): Promise<void> {
    const pathKeys = path.split(".").filter(Boolean);
    if (pathKeys.length === 0) return;
    const valueJson = JSON.stringify(value);
    if (pathKeys.length === 1) {
      await this.client.query(
        `UPDATE properties
         SET details = jsonb_set(COALESCE(details, '{}'::jsonb), ARRAY[$2]::text[], $3::jsonb, true),
             updated_at = now()
         WHERE id = $1`,
        [propertyId, pathKeys[0], valueJson]
      );
      return;
    }
    // Two-level path (e.g. enrichment.zoning): merge value into parent so siblings are preserved.
    const [parent, key] = pathKeys;
    await this.client.query(
      `UPDATE properties
       SET details = jsonb_set(
         COALESCE(details, '{}'::jsonb),
         ARRAY[$2]::text[],
         COALESCE(details->$2, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb),
         true
       ),
       updated_at = now()
       WHERE id = $1`,
      [propertyId, parent, key, valueJson]
    );
  }

  /**
   * Shallow merge an object into properties.details (e.g. { enrichment: { permits_summary: {...} } }).
   * Preserves other top-level keys; overwrites only the keys present in merge.
   */
  async mergeDetails(propertyId: string, merge: Record<string, unknown>): Promise<void> {
    await this.client.query(
      `UPDATE properties
       SET details = COALESCE(details, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [propertyId, JSON.stringify(merge)]
    );
  }
}
