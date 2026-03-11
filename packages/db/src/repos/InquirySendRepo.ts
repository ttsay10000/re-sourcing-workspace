import type { PoolClient } from "pg";
import type { Pool } from "pg";

export interface InquirySendRepoOptions {
  client?: PoolClient;
  pool: Pool;
}

export interface CreateInquirySendOptions {
  toAddress?: string | null;
  source?: string | null;
  sentAt?: string | Date | null;
}

export interface InquiryRecipientHistoryRow {
  propertyId: string;
  canonicalAddress: string;
  sentAt: string;
}

function normalizeToAddress(toAddress: string | null | undefined): string | null {
  const normalized = typeof toAddress === "string" ? toAddress.trim().toLowerCase() : "";
  return normalized || null;
}

function normalizeSentAt(sentAt: string | Date | null | undefined): Date | null {
  if (sentAt == null) return null;
  if (sentAt instanceof Date) return Number.isNaN(sentAt.getTime()) ? null : sentAt;
  const trimmed = sentAt.trim();
  if (!trimmed) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T12:00:00Z`)
    : new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Log outbound inquiry emails sent per property; used for last-sent date and to prevent duplicate sends. */
export class InquirySendRepo {
  constructor(private options: InquirySendRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async create(
    propertyId: string,
    gmailMessageId?: string | null,
    createOptions?: CreateInquirySendOptions
  ): Promise<{ id: string; sentAt: string }> {
    const requestedSentAt = normalizeSentAt(createOptions?.sentAt);
    const toAddress = normalizeToAddress(createOptions?.toAddress);
    const source = createOptions?.source?.trim() || null;
    const r = await this.client.query(
      `INSERT INTO property_inquiry_sends (property_id, sent_at, gmail_message_id, to_address, source)
       VALUES ($1, COALESCE($2, now()), $3, $4, $5)
       RETURNING id, sent_at`,
      [propertyId, requestedSentAt, gmailMessageId ?? null, toAddress, source]
    );
    const row = r.rows[0];
    const storedSentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at);
    return { id: row.id, sentAt: storedSentAt };
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

  async listByRecipient(toAddress: string): Promise<InquiryRecipientHistoryRow[]> {
    const normalized = normalizeToAddress(toAddress);
    if (!normalized) return [];
    const r = await this.client.query<{ property_id: string; canonical_address: string; sent_at: Date | string }>(
      `SELECT s.property_id, p.canonical_address, s.sent_at
       FROM property_inquiry_sends s
       INNER JOIN properties p ON p.id = s.property_id
       WHERE s.to_address = $1
       ORDER BY s.sent_at DESC`,
      [normalized]
    );
    return r.rows.map((row) => ({
      propertyId: row.property_id,
      canonicalAddress: row.canonical_address,
      sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at),
    }));
  }
}
