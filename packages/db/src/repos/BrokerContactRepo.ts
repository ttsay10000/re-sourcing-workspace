import type { PoolClient } from "pg";
import type { BrokerContact } from "@re-sourcing/contracts";
import { mapBrokerContact } from "../map.js";

export interface BrokerContactRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface UpsertBrokerContactParams {
  normalizedEmail: string;
  displayName?: string | null;
  firm?: string | null;
}

export class BrokerContactRepo {
  constructor(private options: BrokerContactRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<BrokerContact | null> {
    const r = await this.client.query("SELECT * FROM broker_contacts WHERE id = $1", [id]);
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }

  async byEmail(email: string): Promise<BrokerContact | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const r = await this.client.query("SELECT * FROM broker_contacts WHERE normalized_email = $1", [normalized]);
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }

  async listByEmails(emails: string[]): Promise<BrokerContact[]> {
    const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) return [];
    const r = await this.client.query(
      "SELECT * FROM broker_contacts WHERE normalized_email = ANY($1::text[]) ORDER BY normalized_email",
      [normalized]
    );
    return r.rows.map(mapBrokerContact);
  }

  async upsert(params: UpsertBrokerContactParams): Promise<BrokerContact> {
    const normalizedEmail = params.normalizedEmail.trim().toLowerCase();
    const r = await this.client.query(
      `INSERT INTO broker_contacts (normalized_email, display_name, firm)
       VALUES ($1, $2, $3)
       ON CONFLICT (normalized_email) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, broker_contacts.display_name),
         firm = COALESCE(EXCLUDED.firm, broker_contacts.firm),
         updated_at = now()
       RETURNING *`,
      [normalizedEmail, params.displayName ?? null, params.firm ?? null]
    );
    return mapBrokerContact(r.rows[0]);
  }

  async update(
    id: string,
    params: Partial<{
      displayName: string | null;
      firm: string | null;
      preferredThreadId: string | null;
      lastOutreachAt: string | null;
      lastReplyAt: string | null;
      doNotContactUntil: string | null;
      manualReviewOnly: boolean;
      notes: string | null;
      activitySummary: Record<string, unknown>;
    }>
  ): Promise<BrokerContact | null> {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    let i = 1;
    if (params.displayName !== undefined) { sets.push(`display_name = $${i++}`); values.push(params.displayName); }
    if (params.firm !== undefined) { sets.push(`firm = $${i++}`); values.push(params.firm); }
    if (params.preferredThreadId !== undefined) { sets.push(`preferred_thread_id = $${i++}`); values.push(params.preferredThreadId); }
    if (params.lastOutreachAt !== undefined) { sets.push(`last_outreach_at = $${i++}`); values.push(params.lastOutreachAt); }
    if (params.lastReplyAt !== undefined) { sets.push(`last_reply_at = $${i++}`); values.push(params.lastReplyAt); }
    if (params.doNotContactUntil !== undefined) { sets.push(`do_not_contact_until = $${i++}`); values.push(params.doNotContactUntil); }
    if (params.manualReviewOnly !== undefined) { sets.push(`manual_review_only = $${i++}`); values.push(params.manualReviewOnly); }
    if (params.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(params.notes); }
    if (params.activitySummary !== undefined) { sets.push(`activity_summary = $${i++}`); values.push(JSON.stringify(params.activitySummary)); }
    values.push(id);
    const r = await this.client.query(
      `UPDATE broker_contacts SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }
}
