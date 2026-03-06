import type { PoolClient } from "pg";
import type { Document, DocumentSource } from "@re-sourcing/contracts";
import { mapDocument } from "../map.js";

export interface DocumentRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface InsertDocumentParams {
  id?: string;
  propertyId: string;
  fileName: string;
  fileType?: string | null;
  source: DocumentSource;
  uploadedBy?: string | null;
  storagePath: string;
}

export class DocumentRepo {
  constructor(private options: DocumentRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertDocumentParams): Promise<Document> {
    const r = await this.client.query(
      `INSERT INTO documents (property_id, file_name, file_type, source, uploaded_by, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.propertyId,
        params.fileName,
        params.fileType ?? null,
        params.source,
        params.uploadedBy ?? null,
        params.storagePath,
      ]
    );
    return mapDocument(r.rows[0]);
  }

  async byId(id: string): Promise<Document | null> {
    const r = await this.client.query("SELECT * FROM documents WHERE id = $1", [id]);
    return r.rows[0] ? mapDocument(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string): Promise<Document[]> {
    const r = await this.client.query(
      "SELECT * FROM documents WHERE property_id = $1 ORDER BY created_at DESC",
      [propertyId]
    );
    return r.rows.map((row: Record<string, unknown>) => mapDocument(row));
  }
}
