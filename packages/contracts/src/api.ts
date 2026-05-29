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
import type {
  SavedSearchRun,
  BrokerContact,
  RecipientResolution,
  PropertyOutreachSummary,
  PropertyOutreachFlag,
  PropertyActionItem,
  OutreachBatch,
  HomeOperationsSummary,
  HomeActivityItem,
} from "./sourcing.js";
import type { ListingLifecycleState } from "./enums.js";
import type {
  UiV2BrokerBlock,
  UiV2BrokerOverwriteInput,
  UiV2CrmListPayload,
  UiV2DealProgressSummary,
  UiV2ImportJobInput,
  UiV2ImportJobPayload,
  UiV2ManualEntryImportInput,
  UiV2OmUploadImportInput,
  UiV2OmUrlImportInput,
  UiV2OutreachComposerPayload,
  UiV2OutreachDraftInput,
  UiV2OutreachDraftPayload,
  UiV2OutreachFollowUpActionInput,
  UiV2OutreachFollowUpActionPayload,
  UiV2PipelineListPayload,
  UiV2PipelineQuery,
  UiV2PipelineStatusOption,
  UiV2PropertyDetailPayload,
  UiV2RejectionReasonOption,
  UiV2RestorePropertyInput,
  UiV2SavePropertyInput,
  UiV2SavedDealsPayload,
  UiV2SavedSearchRunInput,
  UiV2StatusUpdateInput,
  UiV2StreetEasyPullInput,
  UiV2StreetEasySaleIdImportInput,
  UiV2StreetEasyUrlImportInput,
  UiV2TagUpdateInput,
} from "./uiV2.js";

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

// ---- Saved searches / sourcing automation ----
export interface SavedSearchesListResponse {
  savedSearches: SearchProfile[];
}

export interface SavedSearchGetResponse {
  savedSearch: SearchProfile | null;
}

export interface SavedSearchCreateRequest {
  body: SearchProfileInput;
}

export interface SavedSearchCreateResponse {
  savedSearch: SearchProfile;
}

export interface SavedSearchUpdateRequest {
  id: string;
  body: Partial<SearchProfileInput>;
}

export interface SavedSearchUpdateResponse {
  savedSearch: SearchProfile;
}

export interface SavedSearchRunsResponse {
  runs: SavedSearchRun[];
}

export interface HomeOperationsSummaryResponse {
  summary: HomeOperationsSummary;
  recentActivity: HomeActivityItem[];
}

export interface ActionItemsListResponse {
  actionItems: PropertyActionItem[];
}

export interface OutreachReviewQueueResponse {
  batches: OutreachBatch[];
}

export interface BrokerContactsListResponse {
  contacts: BrokerContact[];
}

export interface PropertyRecipientResolutionResponse {
  resolution: RecipientResolution | null;
}

export interface PropertyOutreachSummaryResponse {
  outreach: PropertyOutreachSummary | null;
  flags?: PropertyOutreachFlag[];
}

// ---- UI v2 backend contracts ----
export interface UiV2MetadataResponse {
  statusOptions: UiV2PipelineStatusOption[];
  rejectionReasonOptions: UiV2RejectionReasonOption[];
}

export interface UiV2PipelineListRequest {
  query?: UiV2PipelineQuery;
}

export interface UiV2PipelineListResponse {
  pipeline: UiV2PipelineListPayload;
}

export interface UiV2PropertyDetailResponse {
  property: UiV2PropertyDetailPayload | null;
}

export interface UiV2PropertyStatusUpdateRequest {
  propertyId: string;
  body: UiV2StatusUpdateInput;
}

export interface UiV2PropertyStatusUpdateResponse {
  property: UiV2PropertyDetailPayload;
}

export interface UiV2PropertySaveRequest {
  propertyId: string;
  body?: UiV2SavePropertyInput;
}

export interface UiV2PropertySaveResponse {
  property: UiV2PropertyDetailPayload;
}

export interface UiV2PropertyRejectRequest {
  propertyId: string;
  body: Extract<UiV2StatusUpdateInput, { status: "rejected" }>;
}

export interface UiV2PropertyRejectResponse {
  property: UiV2PropertyDetailPayload;
}

export interface UiV2PropertyRestoreRequest {
  propertyId: string;
  body?: UiV2RestorePropertyInput;
}

export interface UiV2PropertyRestoreResponse {
  property: UiV2PropertyDetailPayload;
}

export interface UiV2PropertyTagsUpdateRequest {
  propertyId: string;
  body: UiV2TagUpdateInput;
}

export interface UiV2PropertyTagsUpdateResponse {
  property: UiV2PropertyDetailPayload;
}

export interface UiV2BrokerOverwriteRequest {
  propertyId: string;
  body: UiV2BrokerOverwriteInput;
}

export interface UiV2BrokerOverwriteResponse {
  broker: UiV2BrokerBlock;
}

export interface UiV2CrmListRequest {
  query?: {
    q?: string;
    limit?: number;
    offset?: number;
  };
}

export interface UiV2CrmListResponse {
  crm: UiV2CrmListPayload;
}

export interface UiV2OutreachComposerRequest {
  propertyId: string;
}

export interface UiV2OutreachComposerResponse {
  composer: UiV2OutreachComposerPayload;
}

export interface UiV2OutreachDraftRequest {
  body: UiV2OutreachDraftInput;
}

export interface UiV2OutreachDraftResponse {
  draft: UiV2OutreachDraftPayload;
}

export interface UiV2OutreachFollowUpActionRequest {
  body: UiV2OutreachFollowUpActionInput;
}

export interface UiV2OutreachFollowUpActionResponse {
  followUp: UiV2OutreachFollowUpActionPayload;
}

export interface UiV2OmUploadImportRequest {
  body: UiV2OmUploadImportInput;
}

export interface UiV2OmUrlImportRequest {
  body: UiV2OmUrlImportInput;
}

export interface UiV2ManualEntryImportRequest {
  body: UiV2ManualEntryImportInput;
}

export interface UiV2StreetEasyUrlImportRequest {
  body: UiV2StreetEasyUrlImportInput;
}

export interface UiV2StreetEasySaleIdImportRequest {
  body: UiV2StreetEasySaleIdImportInput;
}

export interface UiV2StreetEasyPullRequest {
  body: UiV2StreetEasyPullInput;
}

export interface UiV2SavedSearchRunRequest {
  body: UiV2SavedSearchRunInput;
}

export interface UiV2CreateImportJobRequest {
  body: UiV2ImportJobInput;
}

export interface UiV2ImportJobResponse {
  importJob: UiV2ImportJobPayload;
}

export interface UiV2SavedDealsListRequest {
  query?: {
    status?: string | string[];
    limit?: number;
    offset?: number;
  };
}

export interface UiV2SavedDealsListResponse {
  savedDeals: UiV2SavedDealsPayload;
}

export interface UiV2DealProgressSummaryResponse {
  summary: UiV2DealProgressSummary;
}
