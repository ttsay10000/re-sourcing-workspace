import type { PoolClient } from "pg";
import type { Pool } from "pg";

export interface InquirySendRepoOptions {
  client?: PoolClient;
  pool: Pool;
}

/** Log outbound inquiry emails sent per property; used for last-sent date and to prevent duplicate sends. */
export class InquirySendRepo {
  constructor(private options: InquirySendRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async create(propertyId: string, gmailMessageId?: string | null): Promise<{ id: string; sentAt: string }> {
    const r = await this.client.query(
      `INSERT INTO property_inquiry_sends (property_id, gmail_message_id)
       VALUES ($1, $2)
       RETURNING id, sent_at`,
      [propertyId, gmailMessageId ?? null]
    );
    const row = r.rows[0];
    const sentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at);
    return { id: row.id, sentAt };
  }

  /** Latest sent_at for this property, or null if none. */
  async getLastSentAt(propertyId: string): Promise<string | null> {
    const r = await this.client.query(
      `SELECT sent_at FROM property_inquiry_sends
       WHERE property_id = $1
       ORDER BY sent_at DESC
       LIMIT 1`,
      [propertyId]
    );
    if (!r.rows[0]) return null;
    const sentAt = r.rows[0].sent_at;
    return sentAt instanceof Date ? sentAt.toISOString() : String(sentAt);
  }

  /**
   * List sends that have a Gmail message ID (for thread-based reply matching).
   * Only returns rows where sent_at is within the last `withinDays` days (default 90).
   * Used to attribute replies in the same thread (e.g. from broker's alternate email or teammate) to the property.
   */
  async listRecentSendsWithMessageId(withinDays = 90): Promise<Array<{ propertyId: string; gmailMessageId: string }>> {
    const r = await this.client.query<{ property_id: string; gmail_message_id: string }>(
      `SELECT property_id, gmail_message_id FROM property_inquiry_sends
       WHERE gmail_message_id IS NOT NULL AND TRIM(gmail_message_id) <> ''
         AND sent_at >= now() - ($1::int * interval '1 day')
       ORDER BY sent_at DESC`,
      [withinDays]
    );
    return r.rows.map((row) => ({ propertyId: row.property_id, gmailMessageId: row.gmail_message_id }));
  }
}
