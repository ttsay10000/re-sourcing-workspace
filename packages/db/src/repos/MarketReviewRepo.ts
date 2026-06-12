/**
 * Append-only versioned live AI market review (market_reviews). Each refresh
 * appends one row carrying the full cross-document review plus the document
 * ids it was generated from; latest version = current state, and staleness is
 * the set difference between included_document_ids and the current corpus.
 */
import type { MarketReview, MarketReviewRecord } from "@re-sourcing/contracts";
import type { MarketContextRepoOptions } from "./MarketContextRepos.js";

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
}

function mapRecord(row: Row): MarketReviewRecord {
  return {
    id: String(row.id),
    version: Number(row.version),
    review: row.review as MarketReview,
    includedDocumentIds: Array.isArray(row.included_document_ids)
      ? (row.included_document_ids as string[])
      : [],
    promptVersion: str(row.prompt_version),
    provider: str(row.provider),
    model: str(row.model),
    createdAt: iso(row.created_at),
  };
}

export interface AppendMarketReviewParams {
  review: MarketReview;
  includedDocumentIds: string[];
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
}

const COLUMNS = "id, version, review, included_document_ids, prompt_version, provider, model, created_at";

export class MarketReviewRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async latest(): Promise<MarketReviewRecord | null> {
    const r = await this.client.query(`SELECT ${COLUMNS} FROM market_reviews ORDER BY version DESC LIMIT 1`);
    return r.rows[0] ? mapRecord(r.rows[0]) : null;
  }

  async append(params: AppendMarketReviewParams): Promise<MarketReviewRecord> {
    const r = await this.client.query(
      `INSERT INTO market_reviews (version, review, included_document_ids, prompt_version, provider, model)
       SELECT COALESCE(MAX(version), 0) + 1, $1::jsonb, $2::jsonb, $3, $4, $5
       FROM market_reviews
       RETURNING ${COLUMNS}`,
      [
        JSON.stringify(params.review),
        JSON.stringify(params.includedDocumentIds),
        params.promptVersion,
        params.provider,
        params.model,
      ]
    );
    return mapRecord(r.rows[0]);
  }
}
