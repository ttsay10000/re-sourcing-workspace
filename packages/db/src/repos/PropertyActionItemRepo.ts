import type { PoolClient } from "pg";
import type { PropertyActionItem } from "@re-sourcing/contracts";
import { mapPropertyActionItem } from "../map.js";

export interface PropertyActionItemRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class PropertyActionItemRepo {
  constructor(private options: PropertyActionItemRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async listOpenByPropertyId(propertyId: string): Promise<PropertyActionItem[]> {
    const r = await this.client.query(
      "SELECT * FROM property_action_items WHERE property_id = $1 AND status = 'open' ORDER BY created_at DESC",
      [propertyId]
    );
    return r.rows.map(mapPropertyActionItem);
  }

  async listOpen(options?: { limit?: number }): Promise<PropertyActionItem[]> {
    let sql = "SELECT * FROM property_action_items WHERE status = 'open' ORDER BY created_at DESC";
    const values: unknown[] = [];
    if (options?.limit != null) {
      sql += " LIMIT $1";
      values.push(options.limit);
    }
    const r = await this.client.query(sql, values);
    return r.rows.map(mapPropertyActionItem);
  }

  async countsByPropertyIds(propertyIds: string[]): Promise<Record<string, number>> {
    if (propertyIds.length === 0) return {};
    const r = await this.client.query<{ property_id: string; count: string }>(
      `SELECT property_id, COUNT(*)::text AS count
       FROM property_action_items
       WHERE property_id = ANY($1::uuid[]) AND status = 'open'
       GROUP BY property_id`,
      [propertyIds]
    );
    return Object.fromEntries(r.rows.map((row) => [row.property_id, Number(row.count)]));
  }

  async upsertOpen(
    propertyId: string,
    actionType: string,
    params: { priority?: "low" | "medium" | "high"; summary?: string | null; details?: Record<string, unknown> | null; dueAt?: string | null }
  ): Promise<PropertyActionItem> {
    await this.client.query(
      `INSERT INTO property_action_items (property_id, action_type, status, priority, summary, details, due_at)
       VALUES ($1, $2, 'open', $3, $4, $5, $6)
       ON CONFLICT (property_id, action_type) WHERE status = 'open'
       DO UPDATE SET
         priority = EXCLUDED.priority,
         summary = EXCLUDED.summary,
         details = EXCLUDED.details,
         due_at = EXCLUDED.due_at,
         updated_at = now()`,
      [
        propertyId,
        actionType,
        params.priority ?? "medium",
        params.summary ?? null,
        JSON.stringify(params.details ?? {}),
        params.dueAt ?? null,
      ]
    );
    const existing = await this.client.query(
      `SELECT * FROM property_action_items
       WHERE property_id = $1 AND action_type = $2 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [propertyId, actionType]
    );
    return mapPropertyActionItem(existing.rows[0]);
  }

  async resolveById(id: string): Promise<PropertyActionItem | null> {
    const r = await this.client.query(
      `UPDATE property_action_items
       SET status = 'resolved', resolved_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return r.rows[0] ? mapPropertyActionItem(r.rows[0]) : null;
  }

  async resolve(propertyId: string, actionType: string): Promise<void> {
    await this.client.query(
      `UPDATE property_action_items
       SET status = 'resolved', resolved_at = now(), updated_at = now()
       WHERE property_id = $1 AND action_type = $2 AND status = 'open'`,
      [propertyId, actionType]
    );
  }
}
