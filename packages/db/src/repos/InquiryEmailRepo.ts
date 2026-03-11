import type { PoolClient } from "pg";
import type { PropertyInquiryEmail } from "@re-sourcing/contracts";
import { mapInquiryEmail } from "../map.js";

export interface InquiryEmailRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface InsertInquiryEmailParams {
  propertyId: string;
  propertyLinks?: Array<{ propertyId: string; matchSource?: string | null }>;
  messageId: string;
  subject?: string | null;
  fromAddress?: string | null;
  receivedAt?: string | null;
  bodyText?: string | null;
  gmailThreadId?: string | null;
  matchedBatchId?: string | null;
  processingStatus?: string | null;
}

/** Idempotent by message_id: inserts or updates and returns the row (so we have id for documents). */
export class InquiryEmailRepo {
  constructor(private options: InquiryEmailRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  private normalizePropertyLinks(
    params: Pick<InsertInquiryEmailParams, "propertyId" | "propertyLinks">
  ): Array<{ propertyId: string; matchSource: string }> {
    const links = params.propertyLinks?.length
      ? params.propertyLinks
      : [{ propertyId: params.propertyId, matchSource: "legacy_property" }];
    const deduped = new Map<string, string>();
    for (const link of links) {
      const propertyId = link.propertyId?.trim();
      if (!propertyId) continue;
      if (!deduped.has(propertyId)) {
        deduped.set(propertyId, link.matchSource?.trim() || "legacy_property");
      }
    }
    if (!deduped.has(params.propertyId)) {
      deduped.set(params.propertyId, "legacy_property");
    }
    return [...deduped.entries()].map(([propertyId, matchSource]) => ({ propertyId, matchSource }));
  }

  private async attachProperties(
    inquiryEmailId: string,
    propertyLinks: Array<{ propertyId: string; matchSource: string }>
  ): Promise<void> {
    for (const link of propertyLinks) {
      await this.client.query(
        `INSERT INTO property_inquiry_email_properties (inquiry_email_id, property_id, match_source)
         VALUES ($1, $2, $3)
         ON CONFLICT (inquiry_email_id, property_id) DO UPDATE SET
           match_source = EXCLUDED.match_source`,
        [inquiryEmailId, link.propertyId, link.matchSource]
      );
    }
  }

  private async queryOne(sql: string, values: unknown[]): Promise<PropertyInquiryEmail | null> {
    const r = await this.client.query(sql, values);
    return r.rows[0] ? mapInquiryEmail(r.rows[0]) : null;
  }

  async upsert(params: InsertInquiryEmailParams): Promise<PropertyInquiryEmail> {
    const propertyLinks = this.normalizePropertyLinks(params);
    const primaryPropertyId = propertyLinks[0]?.propertyId ?? params.propertyId;
    const r = await this.client.query(
      `INSERT INTO property_inquiry_emails (
         property_id, message_id, subject, from_address, received_at, body_text,
         gmail_thread_id, matched_batch_id, processing_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (message_id) DO UPDATE SET
         subject = COALESCE(EXCLUDED.subject, property_inquiry_emails.subject),
         from_address = COALESCE(EXCLUDED.from_address, property_inquiry_emails.from_address),
         received_at = COALESCE(EXCLUDED.received_at, property_inquiry_emails.received_at),
         body_text = COALESCE(EXCLUDED.body_text, property_inquiry_emails.body_text),
         gmail_thread_id = COALESCE(EXCLUDED.gmail_thread_id, property_inquiry_emails.gmail_thread_id),
         matched_batch_id = COALESCE(EXCLUDED.matched_batch_id, property_inquiry_emails.matched_batch_id),
         processing_status = COALESCE(EXCLUDED.processing_status, property_inquiry_emails.processing_status)
      RETURNING *`,
      [
        primaryPropertyId,
        params.messageId,
        params.subject ?? null,
        params.fromAddress ?? null,
        params.receivedAt ?? null,
        params.bodyText ?? null,
        params.gmailThreadId ?? null,
        params.matchedBatchId ?? null,
        params.processingStatus ?? null,
      ]
    );
    const email = mapInquiryEmail(r.rows[0]);
    await this.attachProperties(email.id, propertyLinks);
    return (await this.byMessageId(params.messageId)) ?? email;
  }

  async byMessageId(messageId: string): Promise<PropertyInquiryEmail | null> {
    return this.queryOne(
      `SELECT e.*,
              COALESCE(links.property_ids, ARRAY[e.property_id]::uuid[]) AS property_ids
         FROM property_inquiry_emails e
         LEFT JOIN LATERAL (
           SELECT array_agg(link.property_id ORDER BY link.property_id) AS property_ids
           FROM property_inquiry_email_properties link
           WHERE link.inquiry_email_id = e.id
         ) links ON true
        WHERE e.message_id = $1`,
      [messageId]
    );
  }

  async listByPropertyId(propertyId: string): Promise<PropertyInquiryEmail[]> {
    const r = await this.client.query(
      `SELECT e.*,
              COALESCE(links.property_ids, ARRAY[e.property_id]::uuid[]) AS property_ids
         FROM property_inquiry_emails e
         LEFT JOIN LATERAL (
           SELECT array_agg(link.property_id ORDER BY link.property_id) AS property_ids
           FROM property_inquiry_email_properties link
           WHERE link.inquiry_email_id = e.id
         ) links ON true
        WHERE EXISTS (
          SELECT 1
          FROM property_inquiry_email_properties link
          WHERE link.inquiry_email_id = e.id
            AND link.property_id = $1
        )
        ORDER BY e.received_at DESC NULLS LAST, e.created_at DESC`,
      [propertyId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapInquiryEmail(row));
  }

  async getLastReceivedAtByPropertyId(propertyId: string): Promise<string | null> {
    const r = await this.client.query<{ received_at: Date | string | null }>(
      `SELECT MAX(e.received_at) AS received_at
         FROM property_inquiry_emails e
         INNER JOIN property_inquiry_email_properties link ON link.inquiry_email_id = e.id
        WHERE link.property_id = $1`,
      [propertyId]
    );
    const value = r.rows[0]?.received_at ?? null;
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : String(value);
  }

  async updateLlmFields(
    id: string,
    params: { bodySummary?: string | null; receiptDateFromBroker?: string | null; attachmentsList?: string | null }
  ): Promise<boolean> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.bodySummary !== undefined) {
      sets.push(`body_summary = $${i++}`);
      values.push(params.bodySummary);
    }
    if (params.receiptDateFromBroker !== undefined) {
      sets.push(`receipt_date_from_broker = $${i++}`);
      values.push(params.receiptDateFromBroker);
    }
    if (params.attachmentsList !== undefined) {
      sets.push(`attachments_list = $${i++}`);
      values.push(params.attachmentsList);
    }
    if (sets.length === 0) return false;
    values.push(id);
    const r = await this.client.query(
      `UPDATE property_inquiry_emails SET ${sets.join(", ")} WHERE id = $${i} RETURNING id`,
      values
    );
    return r.rowCount !== null && r.rowCount > 0;
  }
}
