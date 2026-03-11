import type { PoolClient } from "pg";
import type { PropertySourcingState } from "@re-sourcing/contracts";
import { mapPropertySourcingState } from "../map.js";

export interface PropertySourcingStateRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface UpsertPropertySourcingStateParams {
  propertyId: string;
  workflowState?: PropertySourcingState["workflowState"];
  disposition?: PropertySourcingState["disposition"];
  holdReason?: string | null;
  holdNote?: string | null;
  originatingProfileId?: string | null;
  originatingRunId?: string | null;
  latestRunId?: string | null;
  outreachReason?: string | null;
  firstEligibleAt?: string | null;
  lastContactedAt?: string | null;
  lastReplyAt?: string | null;
  manualOmReviewAt?: string | null;
}

export class PropertySourcingStateRepo {
  constructor(private options: PropertySourcingStateRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async get(propertyId: string): Promise<PropertySourcingState | null> {
    const r = await this.client.query(
      "SELECT * FROM property_sourcing_state WHERE property_id = $1",
      [propertyId]
    );
    return r.rows[0] ? mapPropertySourcingState(r.rows[0]) : null;
  }

  async listByPropertyIds(propertyIds: string[]): Promise<PropertySourcingState[]> {
    if (propertyIds.length === 0) return [];
    const r = await this.client.query(
      "SELECT * FROM property_sourcing_state WHERE property_id = ANY($1::uuid[]) ORDER BY updated_at DESC",
      [propertyIds]
    );
    return r.rows.map(mapPropertySourcingState);
  }

  async upsert(params: UpsertPropertySourcingStateParams): Promise<PropertySourcingState> {
    const existing = await this.get(params.propertyId);
    const next = {
      workflowState: params.workflowState ?? existing?.workflowState ?? "new",
      disposition: params.disposition ?? existing?.disposition ?? "active",
      holdReason: params.holdReason !== undefined ? params.holdReason : (existing?.holdReason ?? null),
      holdNote: params.holdNote !== undefined ? params.holdNote : (existing?.holdNote ?? null),
      originatingProfileId:
        params.originatingProfileId !== undefined ? params.originatingProfileId : (existing?.originatingProfileId ?? null),
      originatingRunId:
        params.originatingRunId !== undefined ? params.originatingRunId : (existing?.originatingRunId ?? null),
      latestRunId:
        params.latestRunId !== undefined ? params.latestRunId : (existing?.latestRunId ?? null),
      outreachReason:
        params.outreachReason !== undefined ? params.outreachReason : (existing?.outreachReason ?? null),
      firstEligibleAt:
        params.firstEligibleAt !== undefined ? params.firstEligibleAt : (existing?.firstEligibleAt ?? null),
      lastContactedAt:
        params.lastContactedAt !== undefined ? params.lastContactedAt : (existing?.lastContactedAt ?? null),
      lastReplyAt:
        params.lastReplyAt !== undefined ? params.lastReplyAt : (existing?.lastReplyAt ?? null),
      manualOmReviewAt:
        params.manualOmReviewAt !== undefined ? params.manualOmReviewAt : (existing?.manualOmReviewAt ?? null),
    };
    const r = await this.client.query(
      `INSERT INTO property_sourcing_state (
         property_id, workflow_state, disposition, hold_reason, hold_note,
         originating_profile_id, originating_run_id, latest_run_id, outreach_reason,
         first_eligible_at, last_contacted_at, last_reply_at, manual_om_review_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (property_id) DO UPDATE SET
         workflow_state = EXCLUDED.workflow_state,
         disposition = EXCLUDED.disposition,
         hold_reason = EXCLUDED.hold_reason,
         hold_note = EXCLUDED.hold_note,
         originating_profile_id = COALESCE(property_sourcing_state.originating_profile_id, EXCLUDED.originating_profile_id),
         originating_run_id = COALESCE(property_sourcing_state.originating_run_id, EXCLUDED.originating_run_id),
         latest_run_id = EXCLUDED.latest_run_id,
         outreach_reason = EXCLUDED.outreach_reason,
         first_eligible_at = COALESCE(property_sourcing_state.first_eligible_at, EXCLUDED.first_eligible_at),
         last_contacted_at = EXCLUDED.last_contacted_at,
         last_reply_at = EXCLUDED.last_reply_at,
         manual_om_review_at = EXCLUDED.manual_om_review_at,
         updated_at = now()
       RETURNING *`,
      [
        params.propertyId,
        next.workflowState,
        next.disposition,
        next.holdReason,
        next.holdNote,
        next.originatingProfileId,
        next.originatingRunId,
        next.latestRunId,
        next.outreachReason,
        next.firstEligibleAt,
        next.lastContactedAt,
        next.lastReplyAt,
        next.manualOmReviewAt,
      ]
    );
    return mapPropertySourcingState(r.rows[0]);
  }
}
