import type {
  OmCoverage,
  OmExtractionMethod,
  OmIngestionRun,
  OmIngestionRunStatus,
  OmIngestionSourceType,
} from "@re-sourcing/contracts";
import type { PoolClient } from "pg";
import { mapOmIngestionRun } from "../map.js";

export interface OmIngestionRunRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface CreateOmIngestionRunParams {
  propertyId: string;
  sourceDocumentId?: string | null;
  sourceType: OmIngestionSourceType;
  status?: OmIngestionRunStatus;
  snapshotVersion?: number | null;
  extractionMethod?: OmExtractionMethod | null;
  pageCount?: number | null;
  financialPageCount?: number | null;
  ocrPageCount?: number | null;
  sourceMeta?: Record<string, unknown> | null;
  coverage?: OmCoverage | null;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  promotedAt?: string | null;
}

export interface UpdateOmIngestionRunParams {
  status: OmIngestionRunStatus;
  extractionMethod?: OmExtractionMethod | null;
  pageCount?: number | null;
  financialPageCount?: number | null;
  ocrPageCount?: number | null;
  coverage?: OmCoverage | null;
  lastError?: string | null;
  completedAt?: string | null;
  promotedAt?: string | null;
}

export class OmIngestionRunRepo {
  constructor(private options: OmIngestionRunRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async create(params: CreateOmIngestionRunParams): Promise<OmIngestionRun> {
    const r = await this.client.query(
      `INSERT INTO om_ingestion_runs (
        property_id,
        source_document_id,
        source_type,
        status,
        snapshot_version,
        extraction_method,
        page_count,
        financial_page_count,
        ocr_page_count,
        source_meta,
        coverage,
        last_error,
        started_at,
        completed_at,
        promoted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, COALESCE($13::timestamptz, now()), $14::timestamptz, $15::timestamptz)
      RETURNING *`,
      [
        params.propertyId,
        params.sourceDocumentId ?? null,
        params.sourceType,
        params.status ?? "queued",
        params.snapshotVersion ?? 2,
        params.extractionMethod ?? null,
        params.pageCount ?? null,
        params.financialPageCount ?? null,
        params.ocrPageCount ?? null,
        params.sourceMeta != null ? JSON.stringify(params.sourceMeta) : null,
        params.coverage != null ? JSON.stringify(params.coverage) : null,
        params.lastError ?? null,
        params.startedAt ?? null,
        params.completedAt ?? null,
        params.promotedAt ?? null,
      ]
    );
    return mapOmIngestionRun(r.rows[0]);
  }

  async byId(id: string): Promise<OmIngestionRun | null> {
    const r = await this.client.query("SELECT * FROM om_ingestion_runs WHERE id = $1", [id]);
    return r.rows[0] ? mapOmIngestionRun(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string, limit = 20): Promise<OmIngestionRun[]> {
    const r = await this.client.query(
      `SELECT * FROM om_ingestion_runs
       WHERE property_id = $1
       ORDER BY started_at DESC, created_at DESC
       LIMIT $2`,
      [propertyId, limit]
    );
    return r.rows.map((row: Record<string, unknown>) => mapOmIngestionRun(row));
  }

  async update(id: string, params: UpdateOmIngestionRunParams): Promise<OmIngestionRun | null> {
    const r = await this.client.query(
      `UPDATE om_ingestion_runs
       SET status = $2,
           extraction_method = COALESCE($3, extraction_method),
           page_count = COALESCE($4, page_count),
           financial_page_count = COALESCE($5, financial_page_count),
           ocr_page_count = COALESCE($6, ocr_page_count),
           coverage = COALESCE($7::jsonb, coverage),
           last_error = COALESCE($8, last_error),
           completed_at = COALESCE($9::timestamptz, completed_at),
           promoted_at = COALESCE($10::timestamptz, promoted_at),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        params.status,
        params.extractionMethod ?? null,
        params.pageCount ?? null,
        params.financialPageCount ?? null,
        params.ocrPageCount ?? null,
        params.coverage != null ? JSON.stringify(params.coverage) : null,
        params.lastError ?? null,
        params.completedAt ?? null,
        params.promotedAt ?? null,
      ]
    );
    return r.rows[0] ? mapOmIngestionRun(r.rows[0]) : null;
  }
}
