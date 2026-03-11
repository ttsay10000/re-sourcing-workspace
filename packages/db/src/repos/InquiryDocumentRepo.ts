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
  fileContent?: Buffer | null;
}

export class InquiryDocumentRepo {
  constructor(private options: InquiryDocumentRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertInquiryDocumentParams): Promise<PropertyInquiryDocument> {
    const r = await this.client.query(
      `INSERT INTO property_inquiry_documents (property_id, inquiry_email_id, filename, content_type, file_path, file_content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.propertyId,
        params.inquiryEmailId,
        params.filename,
        params.contentType ?? null,
        params.filePath,
        params.fileContent ?? null,
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

  async getFileContent(id: string): Promise<Buffer | null> {
    const r = await this.client.query(
      "SELECT file_content FROM property_inquiry_documents WHERE id = $1",
      [id]
    );
    const row = r.rows[0] as { file_content?: Buffer | Uint8Array | null } | undefined;
    if (!row?.file_content) return null;
    return row.file_content instanceof Buffer ? row.file_content : Buffer.from(row.file_content);
  }

  /** List documents with source (from_address from the inquiry email). Returns rows with extra source field. */
  async listByPropertyIdWithSource(propertyId: string): Promise<Array<PropertyInquiryDocument & { source?: string | null }>> {
    const r = await this.client.query(
      `SELECT d.id, d.property_id, d.inquiry_email_id, d.filename, d.content_type, d.file_path, d.created_at,
              e.from_address AS source
       FROM property_inquiry_documents d
       JOIN property_inquiry_emails e ON e.id = d.inquiry_email_id
       WHERE d.property_id = $1
       ORDER BY d.created_at DESC`,
      [propertyId]
    );
    return r.rows.map((row: Record<string, unknown>) => {
      const doc = mapInquiryDocument(row);
      return { ...doc, source: (row.source as string) ?? null };
    });
  }

  async listByInquiryEmailId(inquiryEmailId: string): Promise<PropertyInquiryDocument[]> {
    const r = await this.client.query(
      "SELECT * FROM property_inquiry_documents WHERE inquiry_email_id = $1 ORDER BY created_at",
      [inquiryEmailId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapInquiryDocument(row));
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.client.query("DELETE FROM property_inquiry_documents WHERE id = $1 RETURNING id", [id]);
    return r.rowCount !== null && r.rowCount > 0;
  }
}
