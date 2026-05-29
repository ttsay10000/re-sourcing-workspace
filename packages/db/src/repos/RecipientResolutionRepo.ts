import type { PoolClient } from "pg";
import type { RecipientResolution, RecipientContactCandidate } from "@re-sourcing/contracts";
import { mapRecipientResolution } from "../map.js";

export interface RecipientResolutionRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface UpsertRecipientResolutionParams {
  propertyId: string;
  status: RecipientResolution["status"];
  contactId?: string | null;
  contactEmail?: string | null;
  confidence?: number | null;
  resolutionReason?: string | null;
  candidateContacts?: RecipientContactCandidate[];
}

export interface PropertyBrokerOverwrite {
  propertyId: string;
  contactId?: string | null;
  contactEmail?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  firm?: string | null;
  notes?: string | null;
  overwriteSource?: string | null;
  overwrittenAt?: string | null;
  overwrittenBy?: string | null;
  overwriteMetadata: Record<string, unknown>;
  sourceBrokerSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SetPropertyBrokerOverwriteParams {
  propertyId: string;
  contactId?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  firm?: string | null;
  notes?: string | null;
  confidence?: number | null;
  resolutionReason?: string | null;
  candidateContacts?: RecipientContactCandidate[];
  overwriteSource?: string | null;
  overwrittenBy?: string | null;
  overwriteMetadata?: Record<string, unknown> | null;
  sourceBrokerSnapshot?: Record<string, unknown> | null;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function mapPropertyBrokerOverwrite(row: Record<string, unknown>): PropertyBrokerOverwrite {
  return {
    propertyId: row.property_id as string,
    contactId: (row.contact_id as string) ?? null,
    contactEmail: (row.contact_email as string) ?? null,
    name: (row.manual_broker_name as string) ?? null,
    email: (row.manual_broker_email as string) ?? null,
    phone: (row.manual_broker_phone as string) ?? null,
    firm: (row.manual_broker_firm as string) ?? null,
    notes: (row.manual_broker_notes as string) ?? null,
    overwriteSource: (row.manual_overwrite_source as string) ?? null,
    overwrittenAt: row.manual_overwritten_at != null ? toIso(row.manual_overwritten_at) : null,
    overwrittenBy: (row.manual_overwritten_by as string) ?? null,
    overwriteMetadata: toJsonObject(row.manual_overwrite_metadata),
    sourceBrokerSnapshot: toJsonObject(row.source_broker_snapshot),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class RecipientResolutionRepo {
  constructor(private options: RecipientResolutionRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async get(propertyId: string): Promise<RecipientResolution | null> {
    const r = await this.client.query(
      "SELECT * FROM property_recipient_resolution WHERE property_id = $1",
      [propertyId]
    );
    return r.rows[0] ? mapRecipientResolution(r.rows[0]) : null;
  }

  async getBrokerOverwrite(propertyId: string): Promise<PropertyBrokerOverwrite | null> {
    const r = await this.client.query(
      "SELECT * FROM property_recipient_resolution WHERE property_id = $1",
      [propertyId]
    );
    return r.rows[0] ? mapPropertyBrokerOverwrite(r.rows[0]) : null;
  }

  async listByPropertyIds(propertyIds: string[]): Promise<RecipientResolution[]> {
    if (propertyIds.length === 0) return [];
    const r = await this.client.query(
      "SELECT * FROM property_recipient_resolution WHERE property_id = ANY($1::uuid[]) ORDER BY updated_at DESC",
      [propertyIds]
    );
    return r.rows.map(mapRecipientResolution);
  }

  async listBrokerOverwritesByPropertyIds(propertyIds: string[]): Promise<PropertyBrokerOverwrite[]> {
    if (propertyIds.length === 0) return [];
    const r = await this.client.query(
      "SELECT * FROM property_recipient_resolution WHERE property_id = ANY($1::uuid[]) ORDER BY updated_at DESC",
      [propertyIds]
    );
    return r.rows.map(mapPropertyBrokerOverwrite);
  }

  async delete(propertyId: string): Promise<void> {
    await this.client.query("DELETE FROM property_recipient_resolution WHERE property_id = $1", [propertyId]);
  }

  async upsert(params: UpsertRecipientResolutionParams): Promise<RecipientResolution> {
    const r = await this.client.query(
      `INSERT INTO property_recipient_resolution (
         property_id, status, contact_id, contact_email, confidence, resolution_reason, candidate_contacts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (property_id) DO UPDATE SET
         status = EXCLUDED.status,
         contact_id = EXCLUDED.contact_id,
         contact_email = EXCLUDED.contact_email,
         confidence = EXCLUDED.confidence,
         resolution_reason = EXCLUDED.resolution_reason,
         candidate_contacts = EXCLUDED.candidate_contacts,
         updated_at = now()
       RETURNING *`,
      [
        params.propertyId,
        params.status,
        params.contactId ?? null,
        params.contactEmail ?? null,
        params.confidence ?? null,
        params.resolutionReason ?? null,
        JSON.stringify(params.candidateContacts ?? []),
      ]
    );
    return mapRecipientResolution(r.rows[0]);
  }

  async setBrokerOverwrite(params: SetPropertyBrokerOverwriteParams): Promise<PropertyBrokerOverwrite> {
    const r = await this.client.query(
      `INSERT INTO property_recipient_resolution (
         property_id, status, contact_id, contact_email, confidence, resolution_reason, candidate_contacts,
         manual_broker_name, manual_broker_email, manual_broker_phone, manual_broker_firm, manual_broker_notes,
         manual_overwrite_source, manual_overwritten_at, manual_overwritten_by, manual_overwrite_metadata,
         source_broker_snapshot
       ) VALUES (
         $1, 'manual_override', $2, $3, $13, $14, $15,
         $4, $5, $6, $7, $8, $9, now(), $10, $11, $12
       )
       ON CONFLICT (property_id) DO UPDATE SET
         status = 'manual_override',
         contact_id = EXCLUDED.contact_id,
         contact_email = EXCLUDED.contact_email,
         confidence = EXCLUDED.confidence,
         resolution_reason = EXCLUDED.resolution_reason,
         candidate_contacts = EXCLUDED.candidate_contacts,
         manual_broker_name = EXCLUDED.manual_broker_name,
         manual_broker_email = EXCLUDED.manual_broker_email,
         manual_broker_phone = EXCLUDED.manual_broker_phone,
         manual_broker_firm = EXCLUDED.manual_broker_firm,
         manual_broker_notes = EXCLUDED.manual_broker_notes,
         manual_overwrite_source = EXCLUDED.manual_overwrite_source,
         manual_overwritten_at = now(),
         manual_overwritten_by = EXCLUDED.manual_overwritten_by,
         manual_overwrite_metadata = EXCLUDED.manual_overwrite_metadata,
         source_broker_snapshot = EXCLUDED.source_broker_snapshot,
         updated_at = now()
       RETURNING *`,
      [
        params.propertyId,
        params.contactId ?? null,
        params.email ?? null,
        params.name ?? null,
        params.email ?? null,
        params.phone ?? null,
        params.firm ?? null,
        params.notes ?? null,
        params.overwriteSource ?? "manual",
        params.overwrittenBy ?? null,
        JSON.stringify(params.overwriteMetadata ?? {}),
        JSON.stringify(params.sourceBrokerSnapshot ?? {}),
        params.confidence ?? 100,
        params.resolutionReason ?? "manual_broker_overwrite",
        JSON.stringify(params.candidateContacts ?? []),
      ]
    );
    return mapPropertyBrokerOverwrite(r.rows[0]);
  }

  async clearBrokerOverwrite(propertyId: string): Promise<PropertyBrokerOverwrite | null> {
    const r = await this.client.query(
      `UPDATE property_recipient_resolution
       SET status = CASE WHEN status = 'manual_override' THEN 'missing' ELSE status END,
           manual_broker_name = NULL,
           manual_broker_email = NULL,
           manual_broker_phone = NULL,
           manual_broker_firm = NULL,
           manual_broker_notes = NULL,
           manual_overwrite_source = NULL,
           manual_overwritten_at = NULL,
           manual_overwritten_by = NULL,
           manual_overwrite_metadata = '{}'::jsonb,
           source_broker_snapshot = '{}'::jsonb,
           updated_at = now()
       WHERE property_id = $1
       RETURNING *`,
      [propertyId]
    );
    return r.rows[0] ? mapPropertyBrokerOverwrite(r.rows[0]) : null;
  }
}
