import type { IngestionJobStatus, IngestionRunStatus, ListingSource } from "./enums.js";
import type {
  OmIngestionRun,
  OmIngestionRunStatus,
  PropertyDealDossierGenerationStatus,
  PropertyDealDossierSummary,
  PropertyDocumentCategory,
  PropertySourcingUpdate,
  SavedDeal,
} from "./property.js";
import type {
  BrokerContact,
  ItemStatus,
  PropertyActionItem,
  PropertyDisposition,
  PropertyWorkflowState,
} from "./sourcing.js";

export type UiV2SortDirection = "asc" | "desc";

export type UiV2PipelineSortField =
  | "updatedAt"
  | "createdAt"
  | "canonicalAddress"
  | "askingPrice"
  | "dealScore"
  | "status"
  | "lastActivityAt"
  | "lastContactedAt"
  | "omStatus";

export type UiV2PipelineStatus =
  | "new"
  | "screening"
  | "interesting"
  | "saved"
  | "underwriting"
  | "outreach"
  | "awaiting_broker"
  | "om_received"
  | "dossier_generated"
  | "offer_review"
  | "rejected"
  | "archived";

export type UiV2StatusChipTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface UiV2StatusChip {
  status: UiV2PipelineStatus | PropertyWorkflowState | PropertyDisposition | string;
  label: string;
  tone?: UiV2StatusChipTone;
  editable: boolean;
}

export type UiV2RejectionReasonCode =
  | "price_too_high"
  | "low_cap_rate"
  | "insufficient_noi"
  | "weak_rent_roll"
  | "rent_stabilized_exposure"
  | "poor_location"
  | "asset_type_mismatch"
  | "too_small"
  | "too_large"
  | "deferred_maintenance"
  | "environmental_or_legal_risk"
  | "financing_not_viable"
  | "broker_unresponsive"
  | "duplicate"
  | "already_sold_or_unavailable"
  | "data_quality_issue"
  | "other";

export interface UiV2RejectionReason {
  reasonCode: UiV2RejectionReasonCode;
  note?: string | null;
}

export interface UiV2StatusUpdateInput {
  status: UiV2PipelineStatus;
  rejection?: UiV2RejectionReason;
}

export interface UiV2PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface UiV2PipelineQuery extends UiV2PaginationQuery {
  q?: string;
  status?: UiV2PipelineStatus | UiV2PipelineStatus[];
  source?: ListingSource | ListingSource[];
  tag?: string | string[];
  hasOm?: boolean;
  hasBrokerContact?: boolean;
  minDealScore?: number;
  maxDealScore?: number;
  updatedSince?: string;
  sortBy?: UiV2PipelineSortField;
  sortDirection?: UiV2SortDirection;
}

export interface UiV2ImageAsset {
  id?: string;
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
  source?: ListingSource | "om" | "manual" | string | null;
  order?: number | null;
}

export interface UiV2BrokerBlock {
  contactId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  firm?: string | null;
  source?: "sourced" | "llm" | "manual" | "overwrite" | string | null;
  overwrittenAt?: string | null;
  overwrittenBy?: string | null;
  notes?: string | null;
}

export interface UiV2BrokerOverwriteInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  firm?: string | null;
  notes?: string | null;
  overwriteReason?: string | null;
}

export interface UiV2DocumentStatus {
  hasOm: boolean;
  omStatus?: OmIngestionRunStatus | "not_requested" | "requested" | "available" | "missing" | null;
  latestOmRunId?: string | null;
  documentCount?: number;
  categories?: PropertyDocumentCategory[];
  lastUpdatedAt?: string | null;
}

export interface UiV2EnrichmentState {
  status: "not_started" | "queued" | "running" | "partial" | "complete" | "failed";
  completedKeys?: string[];
  pendingKeys?: string[];
  failedKeys?: string[];
  lastRefreshedAt?: string | null;
  errorMessage?: string | null;
}

export interface UiV2UnderwritingSummary {
  generationStatus?: PropertyDealDossierGenerationStatus | null;
  dealScore?: number | null;
  askingPrice?: number | null;
  recommendedOfferLow?: number | null;
  recommendedOfferHigh?: number | null;
  targetIrrPct?: number | null;
  irrPct?: number | null;
  cocPct?: number | null;
  currentNoi?: number | null;
  adjustedNoi?: number | null;
  summary?: PropertyDealDossierSummary | null;
}

export type UiV2ActivityItemType =
  | "status_changed"
  | "listing_seen"
  | "broker_edited"
  | "outreach_drafted"
  | "outreach_sent"
  | "broker_reply"
  | "om_uploaded"
  | "om_imported"
  | "om_processed"
  | "underwriting_generated"
  | "note_added"
  | "saved"
  | "rejected";

export interface UiV2ActivityTimelineItem {
  id: string;
  propertyId: string;
  type: UiV2ActivityItemType | string;
  title: string;
  body?: string | null;
  actorName?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface UiV2PipelineRow {
  propertyId: string;
  canonicalAddress: string;
  displayAddress?: string | null;
  source?: ListingSource | string | null;
  statusChip: UiV2StatusChip;
  tags: string[];
  askingPrice?: number | null;
  units?: number | null;
  buildingSqft?: number | null;
  neighborhood?: string | null;
  borough?: string | null;
  thumbnailUrl?: string | null;
  broker?: UiV2BrokerBlock | null;
  documentStatus?: UiV2DocumentStatus | null;
  enrichmentState?: UiV2EnrichmentState | null;
  underwriting?: UiV2UnderwritingSummary | null;
  openActionItemCount?: number;
  lastActivityAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiV2PipelineListPayload {
  rows: UiV2PipelineRow[];
  total: number;
  limit: number;
  offset: number;
  query?: UiV2PipelineQuery;
}

export interface UiV2PropertyOverview {
  propertyId: string;
  canonicalAddress: string;
  displayAddress?: string | null;
  neighborhood?: string | null;
  borough?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  source?: ListingSource | string | null;
  listingUrl?: string | null;
  askingPrice?: number | null;
  units?: number | null;
  beds?: number | null;
  baths?: number | null;
  buildingSqft?: number | null;
  lotSqft?: number | null;
  yearBuilt?: number | null;
  description?: string | null;
}

export interface UiV2PropertyDetailPayload {
  overview: UiV2PropertyOverview;
  statusChip: UiV2StatusChip;
  gallery: UiV2ImageAsset[];
  broker: UiV2BrokerBlock | null;
  tags: string[];
  documentStatus: UiV2DocumentStatus;
  enrichmentState: UiV2EnrichmentState;
  underwriting: UiV2UnderwritingSummary | null;
  sourcingUpdate?: PropertySourcingUpdate | null;
  activityTimeline: UiV2ActivityTimelineItem[];
  actionItems: PropertyActionItem[];
  savedDeal?: SavedDeal | null;
}

export type UiV2ImportJobType =
  | "om_upload"
  | "om_url"
  | "manual_entry"
  | "streeteasy_url"
  | "streeteasy_sale_id"
  | "streeteasy_pull"
  | "saved_search_run";

export interface UiV2ImportJobStatus {
  id: string;
  jobType: UiV2ImportJobType;
  propertyId?: string | null;
  runId?: string | null;
  status: IngestionJobStatus | IngestionRunStatus | OmIngestionRunStatus | "queued";
  label?: string | null;
  progressPct?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface UiV2OmUploadImportInput {
  propertyId: string;
  fileName: string;
  contentType?: string | null;
  category?: Extract<PropertyDocumentCategory, "OM" | "Brochure">;
}

export interface UiV2OmUrlImportInput {
  propertyId: string;
  url: string;
  fileName?: string | null;
}

export interface UiV2ManualEntryImportInput {
  canonicalAddress: string;
  listingUrl?: string | null;
  askingPrice?: number | null;
  broker?: UiV2BrokerOverwriteInput | null;
  tags?: string[];
}

export interface UiV2StreetEasyUrlImportInput {
  url: string;
  savedSearchId?: string | null;
}

export interface UiV2StreetEasySaleIdImportInput {
  saleId: string;
  savedSearchId?: string | null;
}

export interface UiV2StreetEasyPullInput {
  propertyId: string;
  saleId?: string | null;
  url?: string | null;
}

export interface UiV2SavedSearchRunInput {
  savedSearchId: string;
}

export interface UiV2ImportJobPayload {
  job: UiV2ImportJobStatus;
  omRun?: OmIngestionRun | null;
}

export interface UiV2CrmContactPayload {
  contact: BrokerContact;
  relatedPropertyIds?: string[];
  openActionItemCount?: number;
  lastActivityAt?: string | null;
}

export interface UiV2CrmListPayload {
  contacts: UiV2CrmContactPayload[];
  total: number;
  limit: number;
  offset: number;
}

export type UiV2OutreachDraftStatus = "draft" | "ready_for_review" | "queued" | "sent" | "failed";

export interface UiV2OutreachComposerPayload {
  propertyId: string;
  broker: UiV2BrokerBlock | null;
  suggestedRecipients: UiV2CrmContactPayload[];
  subject: string;
  body: string;
  followUpAt?: string | null;
  warnings?: string[];
}

export interface UiV2OutreachDraftInput {
  propertyId: string;
  contactId?: string | null;
  toAddress: string;
  subject: string;
  body: string;
  followUpAt?: string | null;
}

export interface UiV2OutreachDraftPayload {
  id: string;
  propertyId: string;
  contactId?: string | null;
  toAddress: string;
  subject: string;
  body: string;
  status: UiV2OutreachDraftStatus;
  followUpAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiV2OutreachFollowUpActionInput {
  draftId?: string | null;
  propertyId: string;
  contactId?: string | null;
  action: "schedule" | "send_now" | "cancel" | "mark_complete";
  followUpAt?: string | null;
  note?: string | null;
}

export interface UiV2OutreachFollowUpActionPayload {
  actionItem?: PropertyActionItem | null;
  draft?: UiV2OutreachDraftPayload | null;
  status: ItemStatus | UiV2OutreachDraftStatus | "scheduled";
}

export interface UiV2SavedDealsPayload {
  deals: SavedDeal[];
  total: number;
  limit: number;
  offset: number;
}

export interface UiV2DealProgressSummary {
  savedCount: number;
  underwritingCount: number;
  outreachCount: number;
  awaitingBrokerCount: number;
  omReceivedCount: number;
  rejectedCount: number;
  updatedAt?: string | null;
}
