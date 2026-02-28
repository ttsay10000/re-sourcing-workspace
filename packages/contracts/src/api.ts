/**
 * Phase 1 API endpoint contracts (request/response interfaces).
 * Do not implement endpoints here; these are the contract other agents build against.
 */

// ---- Health (no DB required) ----
export interface HealthResponse {
  ok: boolean;
  version: string;
  env: string;
}

import type { SearchProfile, SearchProfileInput } from "./profile.js";
import type { IngestionRun, IngestionJob, StartRunInput } from "./ingestion.js";
import type { ListingRow, ListingNormalized } from "./listing.js";
import type { ListingSnapshot } from "./snapshot.js";
import type { Property, PropertyInput } from "./property.js";
import type { ListingPropertyMatch } from "./dedupe.js";
import type { SystemEvent } from "./events.js";
import type { ListingLifecycleState } from "./enums.js";

// ---- Profiles ----
export interface ProfilesListResponse {
  profiles: SearchProfile[];
}

export interface ProfileGetResponse {
  profile: SearchProfile | null;
}

export interface ProfileCreateRequest {
  body: SearchProfileInput;
}

export interface ProfileCreateResponse {
  profile: SearchProfile;
}

export interface ProfileUpdateRequest {
  id: string;
  body: Partial<SearchProfileInput>;
}

export interface ProfileUpdateResponse {
  profile: SearchProfile;
}

// ---- Ingestion runs ----
export interface RunsListRequest {
  query?: { profileId?: string; limit?: number; offset?: number };
}

export interface RunsListResponse {
  runs: IngestionRun[];
  total?: number;
}

export interface RunGetResponse {
  run: IngestionRun | null;
}

export interface RunStartRequest {
  body: StartRunInput;
}

export interface RunStartResponse {
  run: IngestionRun;
}

// ---- Ingestion jobs ----
export interface JobsListRequest {
  query?: { runId: string; limit?: number; offset?: number };
}

export interface JobsListResponse {
  jobs: IngestionJob[];
}

export interface JobGetResponse {
  job: IngestionJob | null;
}

// ---- Listings ----
export interface ListingsListRequest {
  query?: {
    source?: string;
    lifecycleState?: ListingLifecycleState;
    profileId?: string;
    limit?: number;
    offset?: number;
  };
}

export interface ListingsListResponse {
  listings: ListingRow[];
  total?: number;
}

export interface ListingGetResponse {
  listing: ListingRow | null;
}

export interface ListingUpsertRequest {
  body: ListingNormalized;
}

export interface ListingUpsertResponse {
  listing: ListingRow;
  created: boolean;
}

export interface ListingSetLifecycleRequest {
  id: string;
  body: { lifecycleState: ListingLifecycleState };
}

export interface ListingSetLifecycleResponse {
  listing: ListingRow;
}

// ---- Snapshots ----
export interface SnapshotsListRequest {
  query?: { listingId?: string; runId?: string; includePruned?: boolean; limit?: number; offset?: number };
}

export interface SnapshotsListResponse {
  snapshots: ListingSnapshot[];
  total?: number;
}

export interface SnapshotGetResponse {
  snapshot: ListingSnapshot | null;
}

// ---- Properties ----
export interface PropertiesListResponse {
  properties: Property[];
  total?: number;
}

export interface PropertyGetResponse {
  property: Property | null;
}

export interface PropertyCreateRequest {
  body: PropertyInput;
}

export interface PropertyCreateResponse {
  property: Property;
}

// ---- Listing–property matches ----
export interface MatchesListRequest {
  query?: { listingId?: string; propertyId?: string; status?: string; limit?: number; offset?: number };
}

export interface MatchesListResponse {
  matches: ListingPropertyMatch[];
  total?: number;
}

export interface MatchGetResponse {
  match: ListingPropertyMatch | null;
}

export interface MatchUpdateStatusRequest {
  id: string;
  body: { status: "accepted" | "rejected" };
}

export interface MatchUpdateStatusResponse {
  match: ListingPropertyMatch;
}

// ---- System events ----
export interface EventsListRequest {
  query?: { eventType?: string; limit?: number; offset?: number; since?: string };
}

export interface EventsListResponse {
  events: SystemEvent[];
  total?: number;
}
