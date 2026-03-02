import type { PoolClient } from "pg";

export const ENRICHMENT_PERMITS = "permits";

export interface PropertyEnrichmentStateRow {
  propertyId: string;
  enrichmentName: string;
  lastRefreshedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  statsJson: Record<string, unknown> | null;
}

export interface UpsertEnrichmentStateParams {
  propertyId: string;
  enrichmentName: string;
  lastRefreshedAt: Date;
  lastSuccessAt?: Date | null;
  lastError?: string | null;
  statsJson?: Record<string, unknown> | null;
}

export interface PropertyEnrichmentStateRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function mapState(row: Record<string, unknown>): PropertyEnrichmentStateRow {
  return {
    propertyId: row.property_id as string,
    enrichmentName: row.enrichment_name as string,
    lastRefreshedAt: toIso(row.last_refreshed_at),
    lastSuccessAt: row.last_success_at != null ? toIso(row.last_success_at) : null,
    lastError: (row.last_error as string) ?? null,
    statsJson: (row.stats_json as Record<string, unknown>) ?? null,
  };
}

export class PropertyEnrichmentStateRepo {
  constructor(private options: PropertyEnrichmentStateRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async upsert(params: UpsertEnrichmentStateParams): Promise<PropertyEnrichmentStateRow> {
    const r = await this.client.query(
      `INSERT INTO property_enrichment_state (
        property_id, enrichment_name, last_refreshed_at, last_success_at, last_error, stats_json
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (property_id, enrichment_name)
      DO UPDATE SET
        last_refreshed_at = EXCLUDED.last_refreshed_at,
        last_success_at = EXCLUDED.last_success_at,
        last_error = EXCLUDED.last_error,
        stats_json = EXCLUDED.stats_json
      RETURNING *`,
      [
        params.propertyId,
        params.enrichmentName,
        params.lastRefreshedAt,
        params.lastSuccessAt ?? null,
        params.lastError ?? null,
        params.statsJson != null ? JSON.stringify(params.statsJson) : null,
      ]
    );
    return mapState(r.rows[0]);
  }

  async get(propertyId: string, enrichmentName: string): Promise<PropertyEnrichmentStateRow | null> {
    const r = await this.client.query(
      "SELECT * FROM property_enrichment_state WHERE property_id = $1 AND enrichment_name = $2",
      [propertyId, enrichmentName]
    );
    return r.rows[0] ? mapState(r.rows[0]) : null;
  }
}
