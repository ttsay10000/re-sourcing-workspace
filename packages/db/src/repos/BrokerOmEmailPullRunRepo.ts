import type { PoolClient } from "pg";

export interface BrokerOmEmailPullRunRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface BrokerOmEmailPullRunRecord {
  id: string;
  scopeKey: string;
  propertyId: string | null;
  mode: string;
  query: string | null;
  baselineAt: string | null;
  runAt: string;
  truncated: boolean;
  documentCount: number;
  newDocumentCount: number;
  skippedPreviouslyPulled: number;
  documents: unknown[];
  createdAt: string;
}

export interface InsertBrokerOmEmailPullRunParams {
  scopeKey: string;
  propertyId?: string | null;
  mode: string;
  query?: string | null;
  baselineAt?: string | null;
  runAt: string;
  truncated?: boolean;
  documentCount: number;
  newDocumentCount: number;
  skippedPreviouslyPulled: number;
  documents: unknown[];
}

export interface BrokerOmPulledAttachmentKey {
  messageId: string;
  attachmentId: string;
  filename: string | null;
}

export interface RecordBrokerOmPulledAttachmentParams extends BrokerOmPulledAttachmentKey {
  sizeBytes?: number | null;
}

function mapRun(row: Record<string, unknown>): BrokerOmEmailPullRunRecord {
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key),
    propertyId: row.property_id != null ? String(row.property_id) : null,
    mode: String(row.mode),
    query: row.query != null ? String(row.query) : null,
    baselineAt: row.baseline_at != null ? new Date(String(row.baseline_at)).toISOString() : null,
    runAt: new Date(String(row.run_at)).toISOString(),
    truncated: Boolean(row.truncated),
    documentCount: Number(row.document_count ?? 0),
    newDocumentCount: Number(row.new_document_count ?? 0),
    skippedPreviouslyPulled: Number(row.skipped_previously_pulled ?? 0),
    documents: Array.isArray(row.documents) ? (row.documents as unknown[]) : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

const RUN_COLUMNS =
  "id, scope_key, property_id, mode, query, baseline_at, run_at, truncated, document_count, new_document_count, skipped_previously_pulled, documents, created_at";

export class BrokerOmEmailPullRunRepo {
  constructor(private options: BrokerOmEmailPullRunRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insertRun(params: InsertBrokerOmEmailPullRunParams): Promise<BrokerOmEmailPullRunRecord> {
    const r = await this.client.query(
      `INSERT INTO broker_om_email_pull_runs
         (scope_key, property_id, mode, query, baseline_at, run_at, truncated, document_count, new_document_count, skipped_previously_pulled, documents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING ${RUN_COLUMNS}`,
      [
        params.scopeKey,
        params.propertyId ?? null,
        params.mode,
        params.query ?? null,
        params.baselineAt ?? null,
        params.runAt,
        params.truncated ?? false,
        params.documentCount,
        params.newDocumentCount,
        params.skippedPreviouslyPulled,
        JSON.stringify(params.documents ?? []),
      ]
    );
    return mapRun(r.rows[0]);
  }

  async latestForScope(scopeKey: string): Promise<BrokerOmEmailPullRunRecord | null> {
    const r = await this.client.query(
      `SELECT ${RUN_COLUMNS}
       FROM broker_om_email_pull_runs
       WHERE scope_key = $1
       ORDER BY run_at DESC
       LIMIT 1`,
      [scopeKey]
    );
    return r.rows[0] ? mapRun(r.rows[0]) : null;
  }

  /** Attachments already surfaced by previous pulls in this scope, narrowed to the given Gmail message ids. */
  async seenAttachmentsForMessages(
    scopeKey: string,
    messageIds: string[]
  ): Promise<BrokerOmPulledAttachmentKey[]> {
    if (messageIds.length === 0) return [];
    const r = await this.client.query(
      `SELECT message_id, attachment_id, filename
       FROM broker_om_pulled_attachments
       WHERE scope_key = $1 AND message_id = ANY($2)`,
      [scopeKey, messageIds]
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      messageId: String(row.message_id),
      attachmentId: String(row.attachment_id),
      filename: row.filename != null ? String(row.filename) : null,
    }));
  }

  async recordPulledAttachments(
    scopeKey: string,
    attachments: RecordBrokerOmPulledAttachmentParams[]
  ): Promise<void> {
    for (const attachment of attachments) {
      await this.client.query(
        `INSERT INTO broker_om_pulled_attachments (scope_key, message_id, attachment_id, filename, size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (scope_key, message_id, attachment_id) DO UPDATE SET
           filename = COALESCE(EXCLUDED.filename, broker_om_pulled_attachments.filename),
           size_bytes = COALESCE(EXCLUDED.size_bytes, broker_om_pulled_attachments.size_bytes),
           last_pulled_at = now(),
           pull_count = broker_om_pulled_attachments.pull_count + 1`,
        [scopeKey, attachment.messageId, attachment.attachmentId, attachment.filename, attachment.sizeBytes ?? null]
      );
    }
  }
}
