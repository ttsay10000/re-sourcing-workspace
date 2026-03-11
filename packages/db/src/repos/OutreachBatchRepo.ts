import type { PoolClient } from "pg";
import type { OutreachBatch, OutreachBatchItem } from "@re-sourcing/contracts";
import { mapOutreachBatch, mapOutreachBatchItem } from "../map.js";

export interface OutreachBatchRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface CreateOutreachBatchParams {
  contactId?: string | null;
  toAddress: string;
  status?: string;
  createdBy?: string;
  reviewReason?: string | null;
  metadata?: Record<string, unknown> | null;
  propertyIds?: string[];
}

export class OutreachBatchRepo {
  constructor(private options: OutreachBatchRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  private async loadItems(batchId: string): Promise<OutreachBatchItem[]> {
    const r = await this.client.query(
      "SELECT * FROM outreach_batch_items WHERE batch_id = $1 ORDER BY created_at",
      [batchId]
    );
    return r.rows.map(mapOutreachBatchItem);
  }

  async byId(id: string): Promise<OutreachBatch | null> {
    const r = await this.client.query("SELECT * FROM outreach_batches WHERE id = $1", [id]);
    if (!r.rows[0]) return null;
    const batch = mapOutreachBatch(r.rows[0]);
    batch.items = await this.loadItems(id);
    return batch;
  }

  async latestByPropertyId(propertyId: string): Promise<OutreachBatch | null> {
    const r = await this.client.query(
      `SELECT b.*
       FROM outreach_batches b
       INNER JOIN outreach_batch_items i ON i.batch_id = b.id
       WHERE i.property_id = $1
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [propertyId]
    );
    if (!r.rows[0]) return null;
    const batch = mapOutreachBatch(r.rows[0]);
    batch.items = await this.loadItems(batch.id);
    return batch;
  }

  async listReviewQueue(limit = 50): Promise<OutreachBatch[]> {
    const r = await this.client.query(
      `SELECT * FROM outreach_batches
       WHERE status = 'review_required'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    const batches = r.rows.map(mapOutreachBatch);
    for (const batch of batches) batch.items = await this.loadItems(batch.id);
    return batches;
  }

  async listRecent(limit = 20): Promise<OutreachBatch[]> {
    const r = await this.client.query(
      "SELECT * FROM outreach_batches ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    const batches = r.rows.map(mapOutreachBatch);
    for (const batch of batches) batch.items = await this.loadItems(batch.id);
    return batches;
  }

  async create(params: CreateOutreachBatchParams): Promise<OutreachBatch> {
    const r = await this.client.query(
      `INSERT INTO outreach_batches (contact_id, to_address, status, created_by, review_reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.contactId ?? null,
        params.toAddress,
        params.status ?? "queued",
        params.createdBy ?? "automation",
        params.reviewReason ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    const batch = mapOutreachBatch(r.rows[0]);
    batch.items = [];
    for (const propertyId of params.propertyIds ?? []) {
      const item = await this.client.query(
        `INSERT INTO outreach_batch_items (batch_id, property_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (batch_id, property_id) DO UPDATE SET updated_at = now()
         RETURNING *`,
        [batch.id, propertyId]
      );
      batch.items.push(mapOutreachBatchItem(item.rows[0]));
    }
    return batch;
  }

  async updateStatus(
    id: string,
    params: Partial<{
      status: string;
      reviewReason: string | null;
      gmailMessageId: string | null;
      gmailThreadId: string | null;
      sentAt: string | null;
      metadata: Record<string, unknown>;
    }>
  ): Promise<OutreachBatch | null> {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    let i = 1;
    if (params.status !== undefined) { sets.push(`status = $${i++}`); values.push(params.status); }
    if (params.reviewReason !== undefined) { sets.push(`review_reason = $${i++}`); values.push(params.reviewReason); }
    if (params.gmailMessageId !== undefined) { sets.push(`gmail_message_id = $${i++}`); values.push(params.gmailMessageId); }
    if (params.gmailThreadId !== undefined) { sets.push(`gmail_thread_id = $${i++}`); values.push(params.gmailThreadId); }
    if (params.sentAt !== undefined) { sets.push(`sent_at = $${i++}`); values.push(params.sentAt); }
    if (params.metadata !== undefined) { sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${i++}::jsonb`); values.push(JSON.stringify(params.metadata)); }
    values.push(id);
    const r = await this.client.query(
      `UPDATE outreach_batches SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!r.rows[0]) return null;
    const batch = mapOutreachBatch(r.rows[0]);
    batch.items = await this.loadItems(id);
    return batch;
  }
}
