/**
 * Append-only versioned market knowledge base (market_knowledge_entries).
 * Each ingest appends one row carrying the full updated narrative plus the
 * brief for the triggering document; latest version = current state.
 */
import type {
  MarketDocumentBrief,
  MarketKnowledgeEntry,
  MarketKnowledgeNarrative,
} from "@re-sourcing/contracts";
import type { MarketContextRepoOptions } from "./MarketContextRepos.js";

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
}

const EMPTY_NARRATIVE: MarketKnowledgeNarrative = {
  asOf: null,
  submarketTrends: [],
  assetTypeAttention: [],
  capRatePsfMovements: [],
  discrepancies: [],
  sources: [],
};

function mapEntry(row: Row): MarketKnowledgeEntry {
  return {
    id: String(row.id),
    version: Number(row.version),
    documentId: str(row.document_id),
    narrative: (row.narrative as MarketKnowledgeNarrative | null) ?? EMPTY_NARRATIVE,
    brief: (row.brief as MarketDocumentBrief | null) ?? null,
    promptVersion: str(row.prompt_version),
    provider: str(row.provider),
    model: str(row.model),
    createdAt: iso(row.created_at),
  };
}

export interface AppendMarketKnowledgeEntryParams {
  documentId: string | null;
  narrative: MarketKnowledgeNarrative;
  brief: MarketDocumentBrief | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
}

const COLUMNS = "id, version, document_id, narrative, brief, prompt_version, provider, model, created_at";

export class MarketKnowledgeRepo {
  constructor(private options: MarketContextRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  /** Current knowledge-base state (highest version), or null when empty. */
  async latest(): Promise<MarketKnowledgeEntry | null> {
    const r = await this.client.query(
      `SELECT ${COLUMNS} FROM market_knowledge_entries ORDER BY version DESC LIMIT 1`
    );
    return r.rows[0] ? mapEntry(r.rows[0]) : null;
  }

  /** Append the next version (MAX(version)+1; UNIQUE guards concurrent writers). */
  async append(params: AppendMarketKnowledgeEntryParams): Promise<MarketKnowledgeEntry> {
    const r = await this.client.query(
      `INSERT INTO market_knowledge_entries (version, document_id, narrative, brief, prompt_version, provider, model)
       SELECT COALESCE(MAX(version), 0) + 1, $1, $2::jsonb, $3::jsonb, $4, $5, $6
       FROM market_knowledge_entries
       RETURNING ${COLUMNS}`,
      [
        params.documentId,
        JSON.stringify(params.narrative),
        params.brief != null ? JSON.stringify(params.brief) : null,
        params.promptVersion,
        params.provider,
        params.model,
      ]
    );
    return mapEntry(r.rows[0]);
  }

  /** Version history, newest first (audit trail). */
  async listVersions(limit = 20): Promise<MarketKnowledgeEntry[]> {
    const r = await this.client.query(
      `SELECT ${COLUMNS} FROM market_knowledge_entries ORDER BY version DESC LIMIT $1`,
      [Math.max(1, Math.min(limit, 200))]
    );
    return r.rows.map((row: Row) => mapEntry(row));
  }
}
