import type { PoolClient } from "pg";
import type { PropertyInquiryEmail } from "@re-sourcing/contracts";
import { mapInquiryEmail } from "../map.js";

export interface InquiryEmailRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface InsertInquiryEmailParams {
  propertyId: string;
  messageId: string;
  subject?: string | null;
  fromAddress?: string | null;
  receivedAt?: string | null;
  bodyText?: string | null;
}

/** Idempotent by message_id: inserts or updates and returns the row (so we have id for documents). */
export class InquiryEmailRepo {
  constructor(private options: InquiryEmailRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: InsertInquiryEmailParams): Promise<PropertyInquiryEmail> {
    const r = await this.client.query(
      `INSERT INTO property_inquiry_emails (property_id, message_id, subject, from_address, received_at, body_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (message_id) DO UPDATE SET
         subject = COALESCE(EXCLUDED.subject, property_inquiry_emails.subject),
         from_address = COALESCE(EXCLUDED.from_address, property_inquiry_emails.from_address),
         received_at = COALESCE(EXCLUDED.received_at, property_inquiry_emails.received_at),
         body_text = COALESCE(EXCLUDED.body_text, property_inquiry_emails.body_text)
       RETURNING *`,
      [
        params.propertyId,
        params.messageId,
        params.subject ?? null,
        params.fromAddress ?? null,
        params.receivedAt ?? null,
        params.bodyText ?? null,
      ]
    );
    return mapInquiryEmail(r.rows[0]);
  }

  async byMessageId(messageId: string): Promise<PropertyInquiryEmail | null> {
    const r = await this.client.query(
      "SELECT * FROM property_inquiry_emails WHERE message_id = $1",
      [messageId]
    );
    return r.rows[0] ? mapInquiryEmail(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string): Promise<PropertyInquiryEmail[]> {
    const r = await this.client.query(
      "SELECT * FROM property_inquiry_emails WHERE property_id = $1 ORDER BY received_at DESC NULLS LAST, created_at DESC",
      [propertyId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapInquiryEmail(row));
  }
}
