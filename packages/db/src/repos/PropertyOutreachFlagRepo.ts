import type { PoolClient } from "pg";
import type { PropertyOutreachFlag } from "@re-sourcing/contracts";
import { mapPropertyOutreachFlag } from "../map.js";

export interface PropertyOutreachFlagRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class PropertyOutreachFlagRepo {
  constructor(private options: PropertyOutreachFlagRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async listOpenByPropertyId(propertyId: string): Promise<PropertyOutreachFlag[]> {
    const r = await this.client.query(
      "SELECT * FROM property_outreach_flags WHERE property_id = $1 AND status = 'open' ORDER BY created_at DESC",
      [propertyId]
    );
    return r.rows.map(mapPropertyOutreachFlag);
  }

  async upsertOpen(
    propertyId: string,
    flagType: string,
    summary: string,
    details?: Record<string, unknown> | null
  ): Promise<PropertyOutreachFlag> {
    await this.client.query(
      `INSERT INTO property_outreach_flags (property_id, flag_type, status, summary, details)
       VALUES ($1, $2, 'open', $3, $4)
       ON CONFLICT (property_id, flag_type) WHERE status = 'open'
       DO UPDATE SET
         summary = EXCLUDED.summary,
         details = EXCLUDED.details,
         updated_at = now()`,
      [propertyId, flagType, summary, JSON.stringify(details ?? {})]
    );
    const existing = await this.client.query(
      `SELECT * FROM property_outreach_flags
       WHERE property_id = $1 AND flag_type = $2 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [propertyId, flagType]
    );
    return mapPropertyOutreachFlag(existing.rows[0]);
  }

  async resolve(propertyId: string, flagType: string): Promise<void> {
    await this.client.query(
      `UPDATE property_outreach_flags
       SET status = 'resolved', resolved_at = now(), updated_at = now()
       WHERE property_id = $1 AND flag_type = $2 AND status = 'open'`,
      [propertyId, flagType]
    );
  }
}
