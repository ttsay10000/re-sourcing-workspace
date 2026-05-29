import type { PoolClient } from "pg";
import type { BrokerContact } from "@re-sourcing/contracts";
import { mapBrokerContact } from "../map.js";

export interface BrokerContactRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface UpsertBrokerContactParams {
  normalizedEmail?: string | null;
  sourceKey?: string | null;
  displayName?: string | null;
  firm?: string | null;
  phone?: string | null;
  source?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  manualReviewOnly?: boolean | null;
  notes?: string | null;
  activitySummary?: Record<string, unknown> | null;
}

export interface SearchBrokerContactsFilters {
  query?: string;
  limit?: number;
  offset?: number;
}

export class BrokerContactRepo {
  constructor(private options: BrokerContactRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<BrokerContact | null> {
    const r = await this.client.query("SELECT * FROM broker_contacts WHERE id = $1", [id]);
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }

  async byEmail(email: string): Promise<BrokerContact | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const r = await this.client.query("SELECT * FROM broker_contacts WHERE normalized_email = $1", [normalized]);
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }

  async bySourceKey(sourceKey: string): Promise<BrokerContact | null> {
    const key = sourceKey.trim();
    if (!key) return null;
    const r = await this.client.query("SELECT * FROM broker_contacts WHERE source_key = $1", [key]);
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }

  async listByEmails(emails: string[]): Promise<BrokerContact[]> {
    const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) return [];
    const r = await this.client.query(
      "SELECT * FROM broker_contacts WHERE normalized_email = ANY($1::text[]) ORDER BY normalized_email",
      [normalized]
    );
    return r.rows.map(mapBrokerContact);
  }

  async search(filters?: SearchBrokerContactsFilters): Promise<{ contacts: BrokerContact[]; total: number }> {
    const values: unknown[] = [];
    let i = 1;
    let where = "WHERE 1=1";
    if (filters?.query?.trim()) {
      const term = `%${filters.query.trim()}%`;
      where += ` AND (
        normalized_email ILIKE $${i}
        OR source_key ILIKE $${i}
        OR display_name ILIKE $${i}
        OR firm ILIKE $${i}
        OR phone ILIKE $${i}
      )`;
      values.push(term);
      i++;
    }
    let sql = `SELECT * FROM broker_contacts ${where} ORDER BY updated_at DESC`;
    const countSql = `SELECT count(*)::int FROM broker_contacts ${where}`;
    const countValues = [...values];
    if (filters?.limit != null) {
      sql += ` LIMIT $${i}`;
      values.push(filters.limit);
      i++;
    }
    if (filters?.offset != null) {
      sql += ` OFFSET $${i}`;
      values.push(filters.offset);
    }
    const [rows, countResult] = await Promise.all([
      this.client.query(sql, values),
      this.client.query(countSql, countValues),
    ]);
    return {
      contacts: rows.rows.map(mapBrokerContact),
      total: (countResult.rows[0]?.count as number) ?? 0,
    };
  }

  async upsert(params: UpsertBrokerContactParams): Promise<BrokerContact> {
    const normalizedEmail = params.normalizedEmail?.trim().toLowerCase() || null;
    const sourceKey = params.sourceKey?.trim() || null;
    if (!normalizedEmail && !sourceKey) {
      throw new Error("Broker contact requires an email or source key.");
    }

    const existing =
      (normalizedEmail ? await this.byEmail(normalizedEmail) : null) ??
      (sourceKey ? await this.bySourceKey(sourceKey) : null);
    if (existing) {
      return (
        (await this.update(existing.id, {
          normalizedEmail: existing.normalizedEmail ?? normalizedEmail,
          sourceKey: existing.sourceKey ?? sourceKey,
          displayName: params.displayName ?? existing.displayName ?? null,
          firm: params.firm ?? existing.firm ?? null,
          phone: params.phone ?? existing.phone ?? null,
          source: params.source ?? existing.source ?? null,
          sourceMetadata: params.sourceMetadata ?? existing.sourceMetadata ?? {},
          manualReviewOnly: params.manualReviewOnly ?? existing.manualReviewOnly,
          notes: params.notes ?? existing.notes ?? null,
          activitySummary: params.activitySummary ?? existing.activitySummary ?? {},
        })) ?? existing
      );
    }

    const r = await this.client.query(
      `INSERT INTO broker_contacts (
         normalized_email,
         source_key,
         display_name,
         firm,
         phone,
         source,
         source_metadata,
         manual_review_only,
         notes,
         activity_summary
       )
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'sourced'), COALESCE($7::jsonb, '{}'::jsonb), COALESCE($8, false), $9, COALESCE($10::jsonb, '{}'::jsonb))
       RETURNING *`,
      [
        normalizedEmail,
        sourceKey,
        params.displayName ?? null,
        params.firm ?? null,
        params.phone ?? null,
        params.source ?? null,
        params.sourceMetadata != null ? JSON.stringify(params.sourceMetadata) : null,
        params.manualReviewOnly ?? null,
        params.notes ?? null,
        params.activitySummary != null ? JSON.stringify(params.activitySummary) : null,
      ]
    );
    return mapBrokerContact(r.rows[0]);
  }

  async update(
    id: string,
    params: Partial<{
      displayName: string | null;
      normalizedEmail: string | null;
      sourceKey: string | null;
      firm: string | null;
      phone: string | null;
      preferredThreadId: string | null;
      lastOutreachAt: string | null;
      lastReplyAt: string | null;
      doNotContactUntil: string | null;
      manualReviewOnly: boolean;
      notes: string | null;
      activitySummary: Record<string, unknown>;
      source: string | null;
      sourceMetadata: Record<string, unknown>;
      manualOverwrittenAt: string | null;
      manualOverwrittenBy: string | null;
    }>
  ): Promise<BrokerContact | null> {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    let i = 1;
    if (params.normalizedEmail !== undefined) { sets.push(`normalized_email = $${i++}`); values.push(params.normalizedEmail); }
    if (params.sourceKey !== undefined) { sets.push(`source_key = $${i++}`); values.push(params.sourceKey); }
    if (params.displayName !== undefined) { sets.push(`display_name = $${i++}`); values.push(params.displayName); }
    if (params.firm !== undefined) { sets.push(`firm = $${i++}`); values.push(params.firm); }
    if (params.phone !== undefined) { sets.push(`phone = $${i++}`); values.push(params.phone); }
    if (params.preferredThreadId !== undefined) { sets.push(`preferred_thread_id = $${i++}`); values.push(params.preferredThreadId); }
    if (params.lastOutreachAt !== undefined) { sets.push(`last_outreach_at = $${i++}`); values.push(params.lastOutreachAt); }
    if (params.lastReplyAt !== undefined) { sets.push(`last_reply_at = $${i++}`); values.push(params.lastReplyAt); }
    if (params.doNotContactUntil !== undefined) { sets.push(`do_not_contact_until = $${i++}`); values.push(params.doNotContactUntil); }
    if (params.manualReviewOnly !== undefined) { sets.push(`manual_review_only = $${i++}`); values.push(params.manualReviewOnly); }
    if (params.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(params.notes); }
    if (params.activitySummary !== undefined) { sets.push(`activity_summary = $${i++}`); values.push(JSON.stringify(params.activitySummary)); }
    if (params.source !== undefined) { sets.push(`source = $${i++}`); values.push(params.source); }
    if (params.sourceMetadata !== undefined) { sets.push(`source_metadata = $${i++}`); values.push(JSON.stringify(params.sourceMetadata)); }
    if (params.manualOverwrittenAt !== undefined) { sets.push(`manual_overwritten_at = $${i++}`); values.push(params.manualOverwrittenAt); }
    if (params.manualOverwrittenBy !== undefined) { sets.push(`manual_overwritten_by = $${i++}`); values.push(params.manualOverwrittenBy); }
    values.push(id);
    const r = await this.client.query(
      `UPDATE broker_contacts SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapBrokerContact(r.rows[0]) : null;
  }
}
