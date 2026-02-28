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
}
