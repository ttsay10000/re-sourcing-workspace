import type { PoolClient } from "pg";
import type { PropertyInquiryDocument } from "@re-sourcing/contracts";
import { mapInquiryDocument } from "../map.js";

export interface InquiryDocumentRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface InsertInquiryDocumentParams {
  propertyId: string;
  inquiryEmailId: string;
  filename: string;
  contentType?: string | null;
  filePath: string;
}

export class InquiryDocumentRepo {
  constructor(private options: InquiryDocumentRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertInquiryDocumentParams): Promise<PropertyInquiryDocument> {
    const r = await this.client.query(
      `INSERT INTO property_inquiry_documents (property_id, inquiry_email_id, filename, content_type, file_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        params.propertyId,
        params.inquiryEmailId,
        params.filename,
        params.contentType ?? null,
        params.filePath,
      ]
    );
    return mapInquiryDocument(r.rows[0]);
  }

  async byId(id: string): Promise<PropertyInquiryDocument | null> {
    const r = await this.client.query(
      "SELECT * FROM property_inquiry_documents WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapInquiryDocument(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string): Promise<PropertyInquiryDocument[]> {
    const r = await this.client.query(
      "SELECT * FROM property_inquiry_documents WHERE property_id = $1 ORDER BY created_at DESC",
      [propertyId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapInquiryDocument(row));
  }

  async listByInquiryEmailId(inquiryEmailId: string): Promise<PropertyInquiryDocument[]> {
    const r = await this.client.query(
      "SELECT * FROM property_inquiry_documents WHERE inquiry_email_id = $1 ORDER BY created_at",
      [inquiryEmailId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapInquiryDocument(row));
  }
}
