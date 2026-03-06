import type { PoolClient } from "pg";
import type { SavedDeal, DealStatus } from "@re-sourcing/contracts";
import { mapSavedDeal } from "../map.js";

export interface SavedDealsRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class SavedDealsRepo {
  constructor(private options: SavedDealsRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async save(userId: string, propertyId: string, dealStatus: DealStatus = "saved"): Promise<SavedDeal> {
    const r = await this.client.query(
      `INSERT INTO saved_deals (user_id, property_id, deal_status)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, property_id) DO UPDATE SET deal_status = $3
       RETURNING *`,
      [userId, propertyId, dealStatus]
    );
    return mapSavedDeal(r.rows[0]);
  }

  async unsave(userId: string, propertyId: string): Promise<boolean> {
    const r = await this.client.query(
      "DELETE FROM saved_deals WHERE user_id = $1 AND property_id = $2",
      [userId, propertyId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async get(userId: string, propertyId: string): Promise<SavedDeal | null> {
    const r = await this.client.query(
      "SELECT * FROM saved_deals WHERE user_id = $1 AND property_id = $2",
      [userId, propertyId]
    );
    return r.rows[0] ? mapSavedDeal(r.rows[0]) : null;
  }

  async updateStatus(userId: string, propertyId: string, dealStatus: DealStatus): Promise<SavedDeal | null> {
    const r = await this.client.query(
      `UPDATE saved_deals SET deal_status = $3 WHERE user_id = $1 AND property_id = $2 RETURNING *`,
      [userId, propertyId, dealStatus]
    );
    return r.rows[0] ? mapSavedDeal(r.rows[0]) : null;
  }

  async listByUserId(userId: string): Promise<SavedDeal[]> {
    const r = await this.client.query(
      "SELECT * FROM saved_deals WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapSavedDeal(row));
  }
}
