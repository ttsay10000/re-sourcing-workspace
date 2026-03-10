import type { PoolClient } from "pg";
import type { PropertyUploadedDocument, PropertyDocumentCategory } from "@re-sourcing/contracts";
import { mapPropertyUploadedDocument } from "../map.js";

export interface PropertyUploadedDocumentRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface InsertPropertyUploadedDocumentParams {
  id?: string;
  propertyId: string;
  filename: string;
  contentType?: string | null;
  filePath: string;
  category: PropertyDocumentCategory;
  source?: string | null;
  /** When set, stored in DB so downloads work on ephemeral disks (e.g. Render). */
  fileContent?: Buffer | null;
}

const VALID_CATEGORIES: PropertyDocumentCategory[] = [
  "OM",
  "Brochure",
  "Rent Roll",
  "Financial Model",
  "T12 / Operating Summary",
  "Other",
];

function normalizeCategory(cat: string): PropertyDocumentCategory {
  const c = (cat ?? "").trim();
  if (VALID_CATEGORIES.includes(c as PropertyDocumentCategory)) return c as PropertyDocumentCategory;
  return "Other";
}

export class PropertyUploadedDocumentRepo {
  constructor(private options: PropertyUploadedDocumentRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertPropertyUploadedDocumentParams): Promise<PropertyUploadedDocument> {
    const category = normalizeCategory(params.category);
    const source = params.source?.trim() || null;
    const fileContent = params.fileContent ?? null;
    if (params.id) {
      const r = await this.client.query(
        `INSERT INTO property_uploaded_documents (id, property_id, filename, content_type, file_path, category, source, file_content)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, property_id, filename, content_type, file_path, category, source, created_at`,
        [
          params.id,
          params.propertyId,
          params.filename,
          params.contentType ?? null,
          params.filePath,
          category,
          source,
          fileContent,
        ]
      );
      return mapPropertyUploadedDocument(r.rows[0]);
    }
    const r = await this.client.query(
      `INSERT INTO property_uploaded_documents (property_id, filename, content_type, file_path, category, source, file_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, property_id, filename, content_type, file_path, category, source, created_at`,
      [
        params.propertyId,
        params.filename,
        params.contentType ?? null,
        params.filePath,
        category,
        source,
        fileContent,
      ]
    );
    return mapPropertyUploadedDocument(r.rows[0]);
  }

  async byId(id: string): Promise<PropertyUploadedDocument | null> {
    const r = await this.client.query(
      "SELECT id, property_id, filename, content_type, file_path, category, source, created_at FROM property_uploaded_documents WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapPropertyUploadedDocument(r.rows[0]) : null;
  }

  /** Returns file bytes when stored in DB (for download on ephemeral disk). */
  async getFileContent(id: string): Promise<Buffer | null> {
    const r = await this.client.query(
      "SELECT file_content FROM property_uploaded_documents WHERE id = $1",
      [id]
    );
    const row = r.rows[0];
    if (!row?.file_content) return null;
    return row.file_content instanceof Buffer ? row.file_content : Buffer.from(row.file_content);
  }

  async listByPropertyId(propertyId: string): Promise<PropertyUploadedDocument[]> {
    const r = await this.client.query(
      "SELECT id, property_id, filename, content_type, file_path, category, source, created_at FROM property_uploaded_documents WHERE property_id = $1 ORDER BY created_at DESC",
      [propertyId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapPropertyUploadedDocument(row));
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.client.query(
      "DELETE FROM property_uploaded_documents WHERE id = $1",
      [id]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
