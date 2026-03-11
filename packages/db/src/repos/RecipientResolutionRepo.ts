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

  async listByPropertyIds(propertyIds: string[]): Promise<RecipientResolution[]> {
    if (propertyIds.length === 0) return [];
    const r = await this.client.query(
      "SELECT * FROM property_recipient_resolution WHERE property_id = ANY($1::uuid[]) ORDER BY updated_at DESC",
      [propertyIds]
    );
    return r.rows.map(mapRecipientResolution);
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
}
